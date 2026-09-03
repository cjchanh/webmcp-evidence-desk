/**
 * User-authored evidence manifest — build your OWN signed manifest entirely
 * client-side.
 *
 * A user pastes plain-text corpus-format documents, and this module turns them
 * into a fully self-signed EvidenceManifest that `verifyManifest()` accepts
 * unchanged. The Ed25519 keypair is generated locally; the private key is
 * returned to the caller (browser holds it in memory only) and is NEVER
 * persisted by this module.
 *
 * Pure TypeScript: no DOM, no fetch, no `node:` imports. Runs in the browser
 * bundle and in Node >= 22 (WebCrypto + @noble/curves only).
 *
 * This is tamper-EVIDENT, not tamper-PROOF, and is not an authoritative legal
 * signature — the same trust posture as the shipped manifest and receipt.
 */

import { ed25519 } from '@noble/curves/ed25519.js'
import { throwIfAborted } from './errors.ts'
import { bytesToHex, hexToBytes, sha256Hex } from './hex.ts'
import { manifestSigningPayload } from './manifestPayload.ts'
import type { EvidenceManifest, Exhibit, Span } from './types.ts'

/** Hard caps enforced by parseUserDocuments (cycle-1 hardening). */
export const USER_MANIFEST_MAX_EXHIBITS = 20
export const USER_MANIFEST_MAX_SPANS_PER_EXHIBIT = 10

/** Export envelope format string (single source of truth for export/import). */
export const USER_MANIFEST_FORMAT = 'evidence-desk-user-manifest/v1'

const EXHIBIT_ID_RE = /^EX-[A-Z0-9-]+$/
const EXHIBIT_RE = /^EXHIBIT:\s*(.+)$/
const TITLE_RE = /^TITLE:\s*(.+)$/
const SPAN_RE = /^\[SPAN\s+([A-Za-z0-9._-]+)\]\s*$/

export interface ParseUserDocumentsResult {
  exhibits: Exhibit[]
  errors: string[]
}

/**
 * Parse one or more corpus-format exhibit documents concatenated in a single
 * raw string. Same format the shipped manifest uses (see corpus/exhibits/EX-001.txt):
 *
 *   EXHIBIT: EX-001
 *   TITLE: Vendor Attestation Letter
 *   [SPAN EX-001-1]
 *   free text, possibly multiple lines
 *   [SPAN EX-001-2]
 *   more text
 *
 * Never throws: malformed input is reported in `errors` and the offending
 * exhibit is dropped. Validation:
 *   - exhibit id matches /^EX-[A-Z0-9-]+$/
 *   - span ids unique within an exhibit
 *   - non-empty title and non-empty span text
 *   - hard cap of 20 exhibits and 10 spans per exhibit
 */
export function parseUserDocuments(rawText: string): ParseUserDocumentsResult {
  const errors: string[] = []
  const exhibits: Exhibit[] = []

  if (typeof rawText !== 'string' || rawText.trim().length === 0) {
    return { exhibits, errors: ['input is empty'] }
  }

  // Accumulate raw parsed exhibits first so we can enforce the global cap and
  // report per-exhibit errors without partial state leaking into the result.
  interface RawExhibit {
    id: string
    title: string
    spans: Array<{ span_id: string; text: string }>
  }
  const rawExhibits: RawExhibit[] = []

  let current: RawExhibit | null = null
  let currentSpan: { span_id: string; text: string } | null = null
  const currentLines: string[] = []

  const flushSpan = (): void => {
    if (currentSpan && current) {
      currentSpan.text = currentLines.join('\n').trim()
      if (currentSpan.text.length > 0) {
        current.spans.push(currentSpan)
      }
    }
    currentSpan = null
    currentLines.length = 0
  }

  const flushExhibit = (): void => {
    flushSpan()
    if (current) {
      rawExhibits.push(current)
    }
    current = null
  }

  for (const rawLine of rawText.split(/\r?\n/)) {
    const line = rawLine.trim()
    const exhibitMatch = EXHIBIT_RE.exec(line)
    if (exhibitMatch) {
      flushExhibit()
      current = { id: (exhibitMatch[1] ?? '').trim(), title: '', spans: [] }
      continue
    }
    const titleMatch = TITLE_RE.exec(line)
    if (titleMatch) {
      if (current) {
        current.title = (titleMatch[1] ?? '').trim()
      }
      continue
    }
    const spanMatch = SPAN_RE.exec(line)
    if (spanMatch) {
      flushSpan()
      if (current) {
        currentSpan = { span_id: spanMatch[1] ?? '', text: '' }
      }
      continue
    }
    if (currentSpan && line.length > 0) {
      currentLines.push(line)
    }
  }
  flushExhibit()

  if (rawExhibits.length === 0) {
    return { exhibits, errors: ['no EXHIBIT blocks found'] }
  }
  if (rawExhibits.length > USER_MANIFEST_MAX_EXHIBITS) {
    errors.push(
      `too many exhibits: ${rawExhibits.length} (max ${USER_MANIFEST_MAX_EXHIBITS})`
    )
  }

  const seenExhibitIds = new Set<string>()
  for (const raw of rawExhibits) {
    const localErrors: string[] = []
    if (!EXHIBIT_ID_RE.test(raw.id)) {
      localErrors.push(`exhibit id "${raw.id}" does not match ${EXHIBIT_ID_RE.source}`)
    }
    if (seenExhibitIds.has(raw.id)) {
      localErrors.push(`duplicate exhibit id "${raw.id}"`)
    }
    seenExhibitIds.add(raw.id)
    if (raw.title.length === 0) {
      localErrors.push(`exhibit "${raw.id}" missing TITLE`)
    }
    if (raw.spans.length === 0) {
      localErrors.push(`exhibit "${raw.id}" has no spans`)
    }
    if (raw.spans.length > USER_MANIFEST_MAX_SPANS_PER_EXHIBIT) {
      localErrors.push(
        `exhibit "${raw.id}" has ${raw.spans.length} spans (max ${USER_MANIFEST_MAX_SPANS_PER_EXHIBIT})`
      )
    }
    const seenSpanIds = new Set<string>()
    for (const span of raw.spans) {
      if (seenSpanIds.has(span.span_id)) {
        localErrors.push(`exhibit "${raw.id}" has duplicate span id "${span.span_id}"`)
      }
      seenSpanIds.add(span.span_id)
    }

    if (localErrors.length > 0) {
      errors.push(...localErrors)
      continue // drop the offending exhibit
    }

    exhibits.push({
      id: raw.id,
      title: raw.title,
      spans: raw.spans.map((s) => ({ span_id: s.span_id, text: s.text, sha256: '' }))
    })
  }

  return { exhibits, errors }
}

export interface BuildUserManifestResult {
  manifest: EvidenceManifest
  privateKey: Uint8Array
}

/**
 * Generate an Ed25519 keypair, stamp each span with its sha256, and sign the
 * canonical manifest payload via `manifestSigningPayload()` so `verifyManifest()`
 * accepts the result unchanged. The private key is returned to the caller and
 * never persisted here.
 *
 * Async because span hashing uses WebCrypto (same `sha256Hex` the verifier
 * uses), and abort-aware to match the shipped domain functions.
 */
export async function buildUserManifest(
  exhibits: Exhibit[],
  opts?: { signal?: AbortSignal }
): Promise<BuildUserManifestResult> {
  throwIfAborted(opts?.signal)

  const privateKey = ed25519.utils.randomPrivateKey()
  const publicKey = ed25519.getPublicKey(privateKey)

  // Stamp sha256s. Chunked + abort-granular like verifyManifest.
  const CHUNK = 64
  for (let start = 0; start < exhibits.length; start += CHUNK) {
    throwIfAborted(opts?.signal)
    const chunk = exhibits.slice(start, start + CHUNK)
    await Promise.all(
      chunk.map(async (exhibit) => {
        for (const span of exhibit.spans) {
          span.sha256 = await sha256Hex(span.text)
        }
      })
    )
  }

  throwIfAborted(opts?.signal)
  const payload = manifestSigningPayload(exhibits)
  const signature = ed25519.sign(payload, privateKey)

  const manifest: EvidenceManifest = {
    format: 'evidence-desk-manifest/v1',
    algorithm: 'ed25519',
    exhibits,
    publicKey: bytesToHex(publicKey),
    signature: bytesToHex(signature)
  }

  return { manifest, privateKey }
}

export interface UserManifestExport {
  format: typeof USER_MANIFEST_FORMAT
  manifest: EvidenceManifest
  private_key_hex: string
}

/**
 * Serialize a manifest + its private key to a JSON string the user can save.
 *
 * Format (documented for the UI lane):
 *   {
 *     "format": "evidence-desk-user-manifest/v1",
 *     "manifest": { ...EvidenceManifest... },
 *     "private_key_hex": "<64 hex chars>"
 *   }
 */
export function exportUserManifest(
  manifest: EvidenceManifest,
  privateKey: Uint8Array
): string {
  const envelope: UserManifestExport = {
    format: USER_MANIFEST_FORMAT,
    manifest,
    private_key_hex: bytesToHex(privateKey)
  }
  return JSON.stringify(envelope, null, 2)
}

export type ImportUserManifestResult =
  | { manifest: EvidenceManifest; privateKey: Uint8Array }
  | { error: string }

/**
 * Parse + shape-validate an export string. Fails closed on any mismatch:
 * wrong format tag, malformed manifest, or bad key material.
 */
export function importUserManifest(json: string): ImportUserManifestResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return { error: 'invalid JSON' }
  }

  if (!parsed || typeof parsed !== 'object') {
    return { error: 'envelope is not an object' }
  }
  const env = parsed as Partial<UserManifestExport>
  if (env.format !== USER_MANIFEST_FORMAT) {
    return { error: 'unknown envelope format' }
  }

  const manifest = env.manifest
  if (!manifest || typeof manifest !== 'object') {
    return { error: 'missing manifest' }
  }
  const m = manifest as Partial<EvidenceManifest>
  if (m.format !== 'evidence-desk-manifest/v1' || m.algorithm !== 'ed25519') {
    return { error: 'unsupported manifest format or algorithm' }
  }
  if (!Array.isArray(m.exhibits)) {
    return { error: 'manifest exhibits is not an array' }
  }
  if (typeof m.publicKey !== 'string' || typeof m.signature !== 'string') {
    return { error: 'manifest missing publicKey or signature' }
  }

  let privateKey: Uint8Array
  try {
    privateKey = hexToBytes(String(env.private_key_hex))
  } catch {
    return { error: 'malformed private key material' }
  }
  if (privateKey.length !== 32) {
    return { error: 'private key must be 32 bytes' }
  }

  // Shape-validate exhibits/spans so downstream consumers never see garbage.
  for (const exhibit of m.exhibits) {
    if (!exhibit || typeof exhibit !== 'object') {
      return { error: 'exhibit is not an object' }
    }
    const e = exhibit as Partial<Exhibit>
    if (typeof e.id !== 'string' || typeof e.title !== 'string' || !Array.isArray(e.spans)) {
      return { error: 'exhibit missing id, title, or spans' }
    }
    for (const span of e.spans) {
      if (!span || typeof span !== 'object') {
        return { error: 'span is not an object' }
      }
      const s = span as Partial<Span>
      if (
        typeof s.span_id !== 'string' ||
        typeof s.text !== 'string' ||
        typeof s.sha256 !== 'string'
      ) {
        return { error: 'span missing span_id, text, or sha256' }
      }
    }
  }

  return { manifest: m as EvidenceManifest, privateKey }
}
