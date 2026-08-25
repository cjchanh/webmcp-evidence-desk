/**
 * Domain types for Evidence Desk.
 * Pure data contracts only — no DOM, no network, no IO.
 */

export interface Span {
  span_id: string
  text: string
  /** sha256 hex of `text` (utf8), computed at build time and checked at runtime. */
  sha256: string
}

export interface Exhibit {
  id: string
  title: string
  spans: Span[]
}

export interface EvidenceManifest {
  format: 'evidence-desk-manifest/v1'
  algorithm: 'ed25519'
  exhibits: Exhibit[]
  /** Ed25519 public key, hex. The ONLY key material that ships in the bundle. */
  publicKey: string
  /** Ed25519 signature over utf8(JSON.stringify(exhibits)), hex. */
  signature: string
}

export interface SearchResult {
  exhibit_id: string
  title: string
  snippet: string
  score: number
}

/** Tool-contract span shape for inspect_exhibit output (hash key, per spec §3). */
export interface InspectSpan {
  span_id: string
  text: string
  hash: string
}

export interface InspectResult {
  exhibit_id: string
  title: string
  spans: InspectSpan[]
}

export type Verdict = 'SUPPORTED' | 'CONTRADICTED' | 'INSUFFICIENT'

export interface ClaimReason {
  verdict_basis: string
  span_id: string
  exhibit_id: string
}

export interface ClaimEvaluation {
  verdict: Verdict
  reasons: ClaimReason[]
  /** Document types that would be needed to decide the claim. Non-empty iff INSUFFICIENT. */
  missing: string[]
}

export type Stance = 'supports' | 'contradicts'

export type BoardEntryStatus = 'proposed' | 'pinned' | 'rejected'

export interface BoardEntry {
  exhibit_id: string
  stance: Stance
  origin: 'agent' | 'human'
  status: BoardEntryStatus
}

export interface BoardState {
  entries: BoardEntry[]
}

/** Actions an agent may request. Only `add` is honored; the rest are human-exclusive. */
export type AgentAction =
  | { action: 'add'; exhibit_id: string; stance: Stance }
  | { action: 'pin' | 'remove' | 'reject' | 'seal'; exhibit_id?: string }

export type HumanAction = {
  action: 'pin' | 'remove' | 'reject'
  exhibit_id: string
}

export interface QuarantinedExhibit {
  exhibit_id: string
  title: string
  reason: string
}

export interface VerificationReport {
  /** True iff the manifest signature verified AND every shipped span hash matched. */
  ok: boolean
  verified: Exhibit[]
  quarantined: QuarantinedExhibit[]
  manifestSignatureValid: boolean
}
