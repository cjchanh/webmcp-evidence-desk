/**
 * verifyManifest — client-side trust chain.
 *
 * 1. Ed25519 signature over utf8(JSON.stringify(manifest.exhibits)) against
 *    the shipped public key (build-time signing key never ships).
 * 2. Per-span sha256 recomputation: every span text must match its recorded
 *    hash. Any mismatch quarantines that exhibit.
 *
 * Quarantined exhibits are excluded from evaluation downstream, which forces
 * the verdict to INSUFFICIENT when the contradicting document is tampered.
 *
 * Tamper-evident, NOT tamper-proof: a determined local attacker can rewrite
 * the page and its data in memory. This raises the cost of silent tampering;
 * it does not eliminate it. Pure domain code (WebCrypto + @noble only).
 */

import { ed25519 } from '@noble/curves/ed25519.js'
import { throwIfAborted } from './errors.ts'
import { hexToBytes, sha256Hex } from './hex.ts'
import { manifestSigningPayload } from './manifestPayload.ts'
import type { EvidenceManifest, VerificationReport } from './types.ts'

export async function verifyManifest(
  manifest: EvidenceManifest,
  opts?: { signal?: AbortSignal }
): Promise<VerificationReport> {
  throwIfAborted(opts?.signal)

  // Fail-closed shape gate: a malformed manifest must report nothing verified
  // and never throw mid-verification (defense-in-depth — the shipped import
  // path shape-validates first, but verifyManifest is a public domain entry).
  const rawExhibits = (manifest as { exhibits?: unknown } | null)?.exhibits
  if (!manifest || typeof manifest !== 'object' || !Array.isArray(rawExhibits)) {
    return { ok: false, manifestSignatureValid: false, verified: [], quarantined: [] }
  }
  const exhibits = rawExhibits as EvidenceManifest['exhibits']
  if (
    exhibits.some(
      (e) =>
        !e ||
        typeof e !== 'object' ||
        !Array.isArray(e.spans) ||
        e.spans.some(
          (s) => !s || typeof s !== 'object' || typeof s.text !== 'string' || typeof s.sha256 !== 'string'
        )
    )
  ) {
    return { ok: false, manifestSignatureValid: false, verified: [], quarantined: [] }
  }

  const allQuarantined = (reason: string): VerificationReport => ({
    ok: false,
    manifestSignatureValid: false,
    verified: [],
    quarantined: exhibits.map((e) => ({
      exhibit_id: e.id,
      title: e.title,
      reason
    }))
  })

  let publicKey: Uint8Array
  let signature: Uint8Array
  try {
    publicKey = hexToBytes(manifest.publicKey)
    signature = hexToBytes(manifest.signature)
    if (publicKey.length !== 32) throw new TypeError('public key must be 32 bytes')
    if (signature.length !== 64) throw new TypeError('signature must be 64 bytes')
  } catch {
    return allQuarantined('malformed manifest key material')
  }

  // Cycle-1 hardening: the format/algorithm fields are part of the artifact
  // contract — refuse anything this verifier was not built to check.
  if (manifest.format !== 'evidence-desk-manifest/v1' || manifest.algorithm !== 'ed25519') {
    return allQuarantined('unsupported manifest format or algorithm')
  }

  const payload = manifestSigningPayload(exhibits)
  // Defense-in-depth: a crypto-library throw must degrade to quarantine-all,
  // never crash boot into an unverified-accepting state.
  let signatureValid = false
  try {
    signatureValid = ed25519.verify(signature, payload, publicKey)
  } catch {
    signatureValid = false
  }
  if (!signatureValid) {
    return allQuarantined('manifest signature invalid')
  }

  const verified: EvidenceManifest['exhibits'] = []
  const quarantined: VerificationReport['quarantined'] = []
  // Cycle-3 hardening: chunked digest computation (order-preserving). sha256
  // of span text is independent per span, so chunks of 64 cut wall time ~2x at
  // large corpus scale while keeping identical semantics and abort granularity.
  // Results are written back by original index — output order matches manifest.
  const CHUNK = 64
  const intactFlags = new Array<boolean>(exhibits.length).fill(true)
  const failReasons = new Array<string>(exhibits.length).fill('')
  for (let start = 0; start < exhibits.length; start += CHUNK) {
    throwIfAborted(opts?.signal)
    const chunk = exhibits.slice(start, start + CHUNK)
    await Promise.all(
      chunk.map(async (exhibit, offset) => {
        const idx = start + offset
        for (const span of exhibit.spans) {
          const actual = await sha256Hex(span.text)
          if (actual !== span.sha256) {
            intactFlags[idx] = false
            failReasons[idx] = `span hash mismatch on ${span.span_id}`
            break
          }
        }
      })
    )
  }
  exhibits.forEach((exhibit, idx) => {
    if (intactFlags[idx]) {
      verified.push(exhibit)
    } else {
      quarantined.push({
        exhibit_id: exhibit.id,
        title: exhibit.title,
        reason: failReasons[idx] ?? 'span hash mismatch'
      })
    }
  })

  return {
    ok: quarantined.length === 0,
    verified,
    quarantined,
    manifestSignatureValid: true
  }
}
