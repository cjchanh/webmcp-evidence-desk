/**
 * inspectExhibit — full text spans for one exhibit.
 * Pure: no DOM, no IO. Abort-aware at entry.
 */

import { throwIfAborted } from './errors.ts'
import type { Exhibit, InspectResult } from './types.ts'

export function inspectExhibit(
  exhibitId: string,
  exhibits: Exhibit[],
  opts?: { signal?: AbortSignal }
): InspectResult {
  throwIfAborted(opts?.signal)
  if (typeof exhibitId !== 'string' || exhibitId.trim().length === 0) {
    throw new TypeError('invalid params: exhibit_id must be a non-empty string')
  }
  const exhibit = exhibits.find((e) => e.id === exhibitId)
  if (!exhibit) {
    throw new RangeError(`unknown exhibit_id: ${exhibitId}`)
  }
  return {
    exhibit_id: exhibit.id,
    title: exhibit.title,
    spans: exhibit.spans.map((s) => ({ span_id: s.span_id, text: s.text, hash: s.sha256 }))
  }
}
