/**
 * searchExhibits — ranked keyword search over verified exhibits.
 * Pure: no DOM, no IO. Abort-aware at entry.
 */

import { throwIfAborted } from './errors.ts'
import type { Exhibit, SearchResult } from './types.ts'

export const SEARCH_MAX_RESULTS = 4
const SNIPPET_CHARS = 140

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1)
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0
  let idx = haystack.indexOf(needle)
  while (idx !== -1) {
    count += 1
    idx = haystack.indexOf(needle, idx + needle.length)
  }
  return count
}

export function searchExhibits(
  query: string,
  exhibits: Exhibit[],
  opts?: { signal?: AbortSignal; limit?: number }
): SearchResult[] {
  throwIfAborted(opts?.signal)
  const tokens = tokenize(query)
  if (tokens.length === 0) {
    throw new TypeError('invalid params: query must contain searchable terms')
  }
  const limit = opts?.limit ?? SEARCH_MAX_RESULTS

  const scored: Array<SearchResult & { bestSpanText: string }> = []
  for (const exhibit of exhibits) {
    const titleLower = exhibit.title.toLowerCase()
    let score = 0
    let bestSpanText = ''
    let bestSpanScore = 0
    for (const span of exhibit.spans) {
      const textLower = span.text.toLowerCase()
      let spanScore = 0
      for (const token of tokens) {
        if (titleLower.includes(token)) score += 3
        spanScore += countOccurrences(textLower, token)
      }
      score += spanScore
      if (spanScore > bestSpanScore) {
        bestSpanScore = spanScore
        bestSpanText = span.text
      }
    }
    if (score > 0) {
      scored.push({
        exhibit_id: exhibit.id,
        title: exhibit.title,
        snippet:
          bestSpanText.length > SNIPPET_CHARS
            ? bestSpanText.slice(0, SNIPPET_CHARS) + '…'
            : bestSpanText,
        score,
        bestSpanText
      })
    }
  }

  scored.sort((a, b) => b.score - a.score || a.exhibit_id.localeCompare(b.exhibit_id))
  return scored.slice(0, limit).map(({ bestSpanText: _drop, ...rest }) => rest)
}
