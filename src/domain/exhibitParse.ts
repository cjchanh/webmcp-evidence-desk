/**
 * Parser for the plain-text exhibit source format used by corpus/*.txt.
 *
 * Format:
 *   EXHIBIT: EX-001
 *   TITLE: Vendor Attestation Letter
 *   [SPAN EX-001-1]
 *   free text, possibly multiple lines
 *   [SPAN EX-001-2]
 *   more text
 *
 * Pure function — used by scripts/build-manifest.mts and by tests.
 */

export interface ParsedSpan {
  span_id: string
  text: string
}

export interface ParsedExhibit {
  id: string
  title: string
  spans: ParsedSpan[]
}

const EXHIBIT_RE = /^EXHIBIT:\s*(.+)$/
const TITLE_RE = /^TITLE:\s*(.+)$/
const SPAN_RE = /^\[SPAN\s+([A-Za-z0-9._-]+)\]\s*$/

export function parseExhibitSource(source: string): ParsedExhibit {
  let id = ''
  let title = ''
  const spans: ParsedSpan[] = []
  let current: ParsedSpan | null = null
  const currentLines: string[] = []

  const flush = (): void => {
    if (current) {
      current.text = currentLines.join('\n').trim()
      if (current.text.length > 0) {
        spans.push(current)
      }
    }
    current = null
    currentLines.length = 0
  }

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim()
    const exhibitMatch = EXHIBIT_RE.exec(line)
    if (exhibitMatch) {
      id = exhibitMatch[1]?.trim() ?? ''
      continue
    }
    const titleMatch = TITLE_RE.exec(line)
    if (titleMatch) {
      title = titleMatch[1]?.trim() ?? ''
      continue
    }
    const spanMatch = SPAN_RE.exec(line)
    if (spanMatch) {
      flush()
      current = { span_id: spanMatch[1] ?? '', text: '' }
      continue
    }
    if (current && line.length > 0) {
      currentLines.push(line)
    }
  }
  flush()

  if (!id) {
    throw new Error('exhibit source missing EXHIBIT header')
  }
  if (!title) {
    throw new Error(`exhibit ${id} missing TITLE header`)
  }
  if (spans.length === 0) {
    throw new Error(`exhibit ${id} has no spans`)
  }
  return { id, title, spans }
}
