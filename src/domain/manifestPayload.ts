/**
 * Canonical signing payload for the evidence manifest.
 *
 * The Ed25519 signature covers the manifest OF EXHIBIT HASHES: exhibit ids,
 * titles, span ids, and recorded span sha256s — NOT the free span text.
 *
 * Layering:
 *   - flip span TEXT      -> signature stays valid, per-span sha256 recompute
 *                            fails -> that exhibit is surgically quarantined
 *   - flip ids/titles/HASHES -> signature breaks -> MANIFEST MISMATCH,
 *                            everything quarantined
 *
 * Single source of truth used by the build script, the runtime verifier, and
 * test fixtures so the three can never drift.
 */

import type { Exhibit } from './types.ts'

export interface SignedExhibitStructure {
  id: string
  title: string
  spans: Array<{ span_id: string; sha256: string }>
}

export function manifestSigningStructure(exhibits: Exhibit[]): SignedExhibitStructure[] {
  return exhibits.map((e) => ({
    id: e.id,
    title: e.title,
    spans: e.spans.map((s) => ({ span_id: s.span_id, sha256: s.sha256 }))
  }))
}

export function manifestSigningPayload(exhibits: Exhibit[]): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(manifestSigningStructure(exhibits)))
}
