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
import { bytesToHex, hexToBytes, utf8Bytes } from './hex.ts'
import { ed25519 } from '@noble/curves/ed25519.js'
import type { Verdict } from './types.ts'
import type { RecordedHumanDecision } from './decision.ts'

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
 * Seal-time gate (cycle-1 hardening): only exhibits explicitly PINNED by the
 * human and PRESENT in the verified set may enter a sealed receipt. Unknown or
 * quarantined exhibit ids are refused and reported — a receipt can never claim
 * acceptance of evidence that was never SIG VERIFIED or human accepted.
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
    if (entry.status !== 'pinned') continue
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
  /** Random session identifier (cycle-3): ties envelope to one sealing session. */
  sessionId?: string
  humanDecision?: RecordedHumanDecision
  priorBoardDigest?: string
  qualityChecks?: { passed: number; total: number }
  evidenceConfidence?: { level: 'HIGH' | 'MEDIUM' | 'LOW'; basis: string }
  uncoveredScope?: string[]
}

export interface HumanDecisionReceipt {
  status: RecordedHumanDecision['status']
  actor_role: RecordedHumanDecision['actorRole']
  agent_verdict: Verdict
  final_verdict: Verdict | null
  rationale: string | null
  proposed_at: string
  decided_at: string
  waiting_ms: number
}

export interface SealedReceiptEnvelope {
  format: 'evidence-desk-receipt/v1'
  receipt: {
    sealed_at: string
    session_id?: string
    claim_text: string
    verdict: Verdict | 'PENDING' | 'DECLINED'
    accepted_evidence: AcceptedEvidenceItem[]
    tool_log: string[]
    manifest_public_key: string
    manifest_signature: string
    hard_gate: 'HUMAN_DECISION_REQUIRED'
    human_decision?: HumanDecisionReceipt
    prior_board_digest?: string
    quality_checks?: { passed: number; total: number }
    evidence_confidence?: { level: 'HIGH' | 'MEDIUM' | 'LOW'; basis: string }
    uncovered_scope?: string[]
    note: string
  }
  receipt_signature: string
  receipt_public_key: string
}

/**
 * Cycle-3 hardening: the tool log is a rendering of agent-influenced strings.
 * Collapse line breaks so a crafted claim can never inject fake [TAG] lines
 * into the sealed record.
 */
function sanitizeLogLine(line: string): string {
  return line.replace(/[\r\n\t]+/g, ' ').slice(0, 500)
}

export async function buildSealedReceipt(
  input: SealedReceiptInput,
  signer: ReceiptSigner,
  opts?: { signal?: AbortSignal }
): Promise<SealedReceiptEnvelope> {
  throwIfAborted(opts?.signal)

  if (!input.humanDecision) {
    throw new TypeError('seal requires a recorded human decision')
  }
  if (input.humanDecision.status !== 'DECLINED' && input.acceptedEvidence.length === 0) {
    throw new TypeError('an approved or corrected receipt requires at least one accepted exhibit')
  }

  const humanDecision: HumanDecisionReceipt | undefined = input.humanDecision
    ? {
        status: input.humanDecision.status,
        actor_role: input.humanDecision.actorRole,
        agent_verdict: input.humanDecision.agentVerdict,
        final_verdict: input.humanDecision.finalVerdict,
        rationale: input.humanDecision.rationale,
        proposed_at: input.humanDecision.proposedAt,
        decided_at: input.humanDecision.decidedAt,
        waiting_ms: input.humanDecision.waitingMs
      }
    : undefined
  const recordedVerdict: Verdict | 'PENDING' | 'DECLINED' = input.humanDecision
    ? input.humanDecision.finalVerdict ?? 'DECLINED'
    : input.verdict

  const receipt = {
    sealed_at: input.sealedAt,
    ...(input.sessionId ? { session_id: input.sessionId } : {}),
    claim_text: input.claimText,
    verdict: recordedVerdict,
    accepted_evidence: input.acceptedEvidence,
    tool_log: input.toolLog.map(sanitizeLogLine),
    manifest_public_key: input.manifestPublicKey,
    manifest_signature: input.manifestSignature,
    hard_gate: 'HUMAN_DECISION_REQUIRED' as const,
    ...(humanDecision ? { human_decision: humanDecision } : {}),
    ...(input.priorBoardDigest ? { prior_board_digest: input.priorBoardDigest } : {}),
    ...(input.qualityChecks ? { quality_checks: input.qualityChecks } : {}),
    ...(input.evidenceConfidence ? { evidence_confidence: input.evidenceConfidence } : {}),
    ...(input.uncoveredScope ? { uncovered_scope: input.uncoveredScope } : {}),
    note: 'Tamper-evident local session receipt signed with an ephemeral key. Detects post-download modification; not proof of origin, signer identity, or seal time; not an authoritative legal signature.'
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

export interface ReceiptVerificationResult {
  /** Envelope shape + signature integrity over the as-parsed receipt object. */
  signatureValid: boolean
  /** accepted_evidence span hashes cross-checked against the signed manifest. */
  hashesAnchoredInManifest: boolean | null
  problems: string[]
}

/**
 * Cycle-3 hardening: verify a sealed envelope WITHOUT trusting it.
 *
 * What this establishes:
 *  - internal signature integrity over the receipt exactly as parsed;
 *  - that every accepted span hash exists in the manifest whose (publicKey,
 *    signature) the receipt chains to.
 * What it cannot establish: who held the session key, when sealing happened,
 * or authenticity of exhibit text beyond the manifest's own hash chain.
 */
export async function verifySealedReceiptEnvelope(
  envelope: unknown,
  opts?: {
    signal?: AbortSignal
    /** When provided, accepted span hashes are cross-checked against it. */
    manifestExhibits?: ReadonlyArray<{
      id: string
      spans: ReadonlyArray<{ sha256: string }>
    }>
    /**
     * Cycle-4: when provided, the receipt's chained manifest public key must
     * match — defeats self-consistent forgeries that swap session keys while
     * copying an authentic-looking manifest reference.
     */
    expectedManifestPublicKey?: string
  }
): Promise<ReceiptVerificationResult> {
  throwIfAborted(opts?.signal)
  const problems: string[] = []
  const result: ReceiptVerificationResult = {
    signatureValid: false,
    hashesAnchoredInManifest: null,
    problems
  }

  if (!envelope || typeof envelope !== 'object') {
    problems.push('envelope is not an object')
    return result
  }
  const env = envelope as Partial<SealedReceiptEnvelope>
  if (env.format !== 'evidence-desk-receipt/v1') {
    problems.push('unknown envelope format')
    return result
  }
  if (!env.receipt || typeof env.receipt !== 'object') {
    problems.push('missing receipt object')
    return result
  }
  let pub: Uint8Array
  let sig: Uint8Array
  try {
    pub = hexToBytes(String(env.receipt_public_key))
    sig = hexToBytes(String(env.receipt_signature))
  } catch {
    problems.push('malformed receipt key material')
    return result
  }

  // Signature is over the receipt EXACTLY as parsed — re-serialization with
  // different key order would invalidate, by design (as-parsed rule).
  const payload = utf8Bytes(JSON.stringify(env.receipt))
  let ok = false
  try {
    ok = ed25519.verify(sig, payload, pub)
  } catch {
    ok = false
  }
  result.signatureValid = ok
  if (!ok) {
    problems.push('receipt signature does not verify against receipt_public_key')
  }

  // Cross-check accepted hashes against the signed manifest when the caller
  // supplies the authentic exhibit list.
  const receipt = env.receipt as {
    accepted_evidence?: unknown
    human_decision?: {
      status?: unknown
      agent_verdict?: unknown
      final_verdict?: unknown
      rationale?: unknown
    }
    manifest_public_key?: string
    verdict?: unknown
  }
  const acceptedEvidence: Array<{ exhibitId: string; spanHashes: string[] }> = []
  let acceptedEvidenceShapeValid = true
  if (!receipt.human_decision || typeof receipt.human_decision !== 'object') {
    problems.push('receipt has no recorded human decision')
  } else {
    const decision = receipt.human_decision
    const status = decision.status
    const validVerdicts = new Set<Verdict>(['SUPPORTED', 'CONTRADICTED', 'INSUFFICIENT'])
    if (status !== 'APPROVED' && status !== 'CORRECTED' && status !== 'DECLINED') {
      problems.push('receipt has an invalid human decision status')
    } else if (status === 'DECLINED') {
      if (decision.final_verdict !== null || receipt.verdict !== 'DECLINED') {
        problems.push('declined decision must seal verdict DECLINED')
      }
    } else {
      if (!validVerdicts.has(decision.final_verdict as Verdict)) {
        problems.push('adopted decision has an invalid final verdict')
      } else if (receipt.verdict !== decision.final_verdict) {
        problems.push('sealed verdict does not match the human final verdict')
      }
      if (status === 'APPROVED' && decision.final_verdict !== decision.agent_verdict) {
        problems.push('approved decision must preserve the agent verdict')
      }
      if (status === 'CORRECTED') {
        if (decision.final_verdict === decision.agent_verdict) {
          problems.push('corrected decision must change the agent verdict')
        }
        if (typeof decision.rationale !== 'string' || decision.rationale.trim().length === 0) {
          problems.push('corrected decision requires a rationale')
        }
      }
    }
  }
  if (!Array.isArray(receipt.accepted_evidence)) {
    problems.push('receipt accepted_evidence is not an array')
    acceptedEvidenceShapeValid = false
  } else {
    if (
      receipt.human_decision?.status !== 'DECLINED' &&
      receipt.accepted_evidence.length === 0
    ) {
      problems.push('adopted verdict has no accepted evidence')
    }
    for (const [index, item] of receipt.accepted_evidence.entries()) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        acceptedEvidenceShapeValid = false
        problems.push(`accepted evidence entry ${index} is not an object`)
        continue
      }
      const candidate = item as Record<string, unknown>
      if (typeof candidate.exhibit_id !== 'string' || candidate.exhibit_id.trim().length === 0) {
        acceptedEvidenceShapeValid = false
        problems.push(`accepted evidence entry ${index} has an invalid exhibit_id`)
        continue
      }
      const exhibitId = candidate.exhibit_id
      if (!Array.isArray(candidate.span_sha256s) || candidate.span_sha256s.length === 0) {
        acceptedEvidenceShapeValid = false
        problems.push(
          `accepted exhibit ${exhibitId.slice(0, 64)} has no span hashes`
        )
        continue
      }
      const spanHashes: string[] = []
      for (const [hashIndex, hash] of candidate.span_sha256s.entries()) {
        if (typeof hash !== 'string' || hash.length === 0) {
          acceptedEvidenceShapeValid = false
          problems.push(
            `accepted exhibit ${exhibitId.slice(0, 64)} has an invalid span hash at index ${hashIndex}`
          )
          continue
        }
        spanHashes.push(hash)
      }
      acceptedEvidence.push({ exhibitId, spanHashes })
    }
  }
  if (
    opts?.expectedManifestPublicKey &&
    receipt.manifest_public_key !== opts.expectedManifestPublicKey
  ) {
    result.hashesAnchoredInManifest = false
    problems.push('receipt chains to a manifest public key that is not the shipped one')
  }
  if (opts?.manifestExhibits && !Array.isArray(receipt.accepted_evidence)) {
    result.hashesAnchoredInManifest = false
  } else if (opts?.manifestExhibits && Array.isArray(receipt.accepted_evidence)) {
    const byId = new Map(opts.manifestExhibits.map((m) => [m.id, m]))
    // Vacuous anchoring: a DECLINED receipt seals zero accepted evidence by
    // design — an empty list is anchored (nothing to check), not a failure.
    let anchored = acceptedEvidenceShapeValid
    for (const item of acceptedEvidence) {
      const manifestExhibit = byId.get(item.exhibitId)
      if (!manifestExhibit) {
        anchored = false
        problems.push(`accepted exhibit ${item.exhibitId.slice(0, 64)} not present in signed manifest`)
        continue
      }
      const manifestHashes = new Set(manifestExhibit.spans.map((s) => s.sha256))
      for (const h of item.spanHashes) {
        if (!manifestHashes.has(h)) {
          anchored = false
          problems.push(`accepted hash ${h.slice(0, 12)}… not in manifest spans for ${item.exhibitId.slice(0, 64)}`)
        }
      }
    }
    if (result.hashesAnchoredInManifest !== false) {
      result.hashesAnchoredInManifest = anchored
    }
  }

  return result
}
