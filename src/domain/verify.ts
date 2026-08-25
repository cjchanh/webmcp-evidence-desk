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

  const allQuarantined = (reason: string): VerificationReport => ({
    ok: false,
    manifestSignatureValid: false,
    verified: [],
    quarantined: manifest.exhibits.map((e) => ({
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

  const payload = manifestSigningPayload(manifest.exhibits)
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

  const verified = []
  const quarantined: VerificationReport['quarantined'] = []
  for (const exhibit of manifest.exhibits) {
    throwIfAborted(opts?.signal)
    let intact = true
    let reason = ''
    for (const span of exhibit.spans) {
      const actual = await sha256Hex(span.text)
      if (actual !== span.sha256) {
        intact = false
        reason = `span hash mismatch on ${span.span_id}`
        break
      }
    }
    if (intact) {
      verified.push(exhibit)
    } else {
      quarantined.push({ exhibit_id: exhibit.id, title: exhibit.title, reason })
    }
  }

  return {
    ok: quarantined.length === 0,
    verified,
    quarantined,
    manifestSignatureValid: true
  }
}
