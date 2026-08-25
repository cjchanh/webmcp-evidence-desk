/**
 * Sealed session receipt.
 *
 * The build-time signing key NEVER ships, so the runtime receipt is signed by
 * an EPHEMERAL session keypair generated locally at seal time. The receipt
 * chains to the build-time manifest via its public key + signature, and binds
 * the accepted evidence hash list under the session key.
 *
 * This is tamper-EVIDENT, not tamper-PROOF, and is not an authoritative legal
 * signature. The signer is injected so the domain layer stays testable and
 * the crypto choice stays at the edge.
 */

import { throwIfAborted } from './errors.ts'
import { bytesToHex, utf8Bytes } from './hex.ts'
import type { Verdict } from './types.ts'

export interface ReceiptSigner {
  /** Sign the canonical payload bytes with the ephemeral session key. */
  sign(payload: Uint8Array): Uint8Array
  /** Ephemeral session public key bytes (32 for Ed25519). */
  publicKey(): Uint8Array
}

export interface AcceptedEvidenceItem {
  exhibit_id: string
  title: string
  span_sha256s: string[]
}

/**
 * Seal-time gate (cycle-1 hardening): only exhibits that are PRESENT in the
 * verified set may enter a sealed receipt. Unknown or quarantined exhibit ids
 * are refused and reported — a receipt can never claim acceptance of evidence
 * that was never SIG VERIFIED.
 */
export function collectAcceptedEvidence(
  boardEntries: ReadonlyArray<{ exhibit_id: string; status: string }>,
  verifiedExhibits: ReadonlyArray<{ id: string; title: string; spans: ReadonlyArray<{ sha256: string }> }>,
  quarantinedIds: ReadonlySet<string>
): { accepted: AcceptedEvidenceItem[]; refused: Array<{ exhibit_id: string; reason: string }> } {
  const byId = new Map(verifiedExhibits.map((v) => [v.id, v]))
  const accepted: AcceptedEvidenceItem[] = []
  const refused: Array<{ exhibit_id: string; reason: string }> = []
  for (const entry of boardEntries) {
    if (entry.status === 'rejected') continue // human rejection excludes from receipt
    if (quarantinedIds.has(entry.exhibit_id)) {
      refused.push({ exhibit_id: entry.exhibit_id, reason: 'quarantined' })
      continue
    }
    const exhibit = byId.get(entry.exhibit_id)
    if (!exhibit) {
      refused.push({ exhibit_id: entry.exhibit_id, reason: 'not_in_verified_set' })
      continue
    }
    accepted.push({
      exhibit_id: exhibit.id,
      title: exhibit.title,
      span_sha256s: exhibit.spans.map((s) => s.sha256)
    })
  }
  return { accepted, refused }
}

export interface SealedReceiptInput {
  sealedAt: string
  claimText: string
  verdict: Verdict | 'PENDING'
  acceptedEvidence: AcceptedEvidenceItem[]
  toolLog: string[]
  manifestPublicKey: string
  manifestSignature: string
}

export interface SealedReceiptEnvelope {
  format: 'evidence-desk-receipt/v1'
  receipt: {
    sealed_at: string
    claim_text: string
    verdict: Verdict | 'PENDING'
    accepted_evidence: AcceptedEvidenceItem[]
    tool_log: string[]
    manifest_public_key: string
    manifest_signature: string
    note: string
  }
  receipt_signature: string
  receipt_public_key: string
}

export async function buildSealedReceipt(
  input: SealedReceiptInput,
  signer: ReceiptSigner,
  opts?: { signal?: AbortSignal }
): Promise<SealedReceiptEnvelope> {
  throwIfAborted(opts?.signal)

  const receipt = {
    sealed_at: input.sealedAt,
    claim_text: input.claimText,
    verdict: input.verdict,
    accepted_evidence: input.acceptedEvidence,
    tool_log: input.toolLog,
    manifest_public_key: input.manifestPublicKey,
    manifest_signature: input.manifestSignature,
    note: 'Tamper-evident local session receipt signed with an ephemeral key. Not an authoritative legal signature.'
  }

  const payload = utf8Bytes(JSON.stringify(receipt))
  // Yield once so callers can abort between hashing and signing on long boards.
  await Promise.resolve()
  throwIfAborted(opts?.signal)
  const signature = signer.sign(payload)

  return {
    format: 'evidence-desk-receipt/v1',
    receipt,
    receipt_signature: bytesToHex(signature),
    receipt_public_key: bytesToHex(signer.publicKey())
  }
}
