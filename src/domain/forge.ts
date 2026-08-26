/**
 * Forgery bench — the adversarial challenge lane.
 *
 * The judge edits EX-002's exact signed spans; the bench rebuilds a candidate
 * exhibit carrying the forger's bytes under the manifest's RECORDED hashes,
 * then runs the identical per-span sha256 comparison verifyManifest runs
 * (src/domain/verify.ts). The manifest never signed the edited bytes, so an
 * edit fails by construction — the demo makes that failure visible instead
 * of hypothetical.
 *
 * Pure domain code: WebCrypto hashing only. No DOM, no network, no new crypto.
 */

import { throwIfAborted } from './errors.ts'
import { sha256Hex } from './hex.ts'
import type { Exhibit } from './types.ts'

export interface ForgeSpanProbe {
  span_id: string
  /** The text the forger submitted. */
  submitted_text: string
  /** sha256 of the submitted text — what the hash WOULD be if freshly signed. */
  recomputed_sha256: string
  /** The hash the signed manifest actually recorded for this span. */
  recorded_sha256: string
  intact: boolean
}

export interface ForgeProbeReport {
  exhibit_id: string
  title: string
  probes: ForgeSpanProbe[]
  /** True when at least one span hash mismatched — the forgery was caught. */
  caught: boolean
  /** First failing span_id; null when every span matched its recorded hash. */
  failed_span_id: string | null
}

/**
 * Build the candidate exhibit a forger would submit: edited span text carried
 * under the manifest's untouched recorded hashes. Pure — returns new objects;
 * the base exhibit is never mutated.
 */
export function buildForgedExhibitCandidate(
  base: Exhibit,
  editedTexts: ReadonlyArray<string>
): Exhibit {
  return {
    id: base.id,
    title: base.title,
    spans: base.spans.map((span, i) => ({
      span_id: span.span_id,
      text: editedTexts[i] ?? span.text,
      sha256: span.sha256
    }))
  }
}

/**
 * The exact span-hash comparison verifyManifest performs, isolated to one
 * exhibit so the bench can show the judge precisely which span betrayed them.
 * Abort-aware at entry, matching domain conventions.
 */
export async function probeForgedExhibit(
  candidate: Exhibit,
  opts?: { signal?: AbortSignal }
): Promise<ForgeProbeReport> {
  throwIfAborted(opts?.signal)
  const probes: ForgeSpanProbe[] = []
  let failed_span_id: string | null = null
  for (const span of candidate.spans) {
    const recomputed = await sha256Hex(span.text)
    const intact = recomputed === span.sha256
    if (!intact && failed_span_id === null) failed_span_id = span.span_id
    probes.push({
      span_id: span.span_id,
      submitted_text: span.text,
      recomputed_sha256: recomputed,
      recorded_sha256: span.sha256,
      intact
    })
  }
  return {
    exhibit_id: candidate.id,
    title: candidate.title,
    probes,
    caught: failed_span_id !== null,
    failed_span_id
  }
}
