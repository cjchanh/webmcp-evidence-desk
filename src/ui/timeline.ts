/**
 * Timeline spine — pure presentational strip of exhibit dates above the
 * caseboard grid. Dates are DERIVED by scanning the shipped manifest span
 * texts for ISO dates; contested markers are semantic constants from the
 * case narrative (attestation claim / acceptance / report performed), which
 * no text scan could infer. No state, no callbacks, no animation.
 * SECURITY RULE: every string enters the DOM via textContent.
 */

import { el } from './dom.ts'
import type { Exhibit } from '../domain/types.ts'

const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/g

/** Contested dates per the case narrative. */
const CONTESTED_DATES: ReadonlySet<string> = new Set([
  '2026-03-10', // attestation claims inspection completed this day
  '2026-03-14', // customer accepted the lot
  '2026-03-19' // inspection report work performed
])

/** Fallback window if span parsing ever yields fewer than two distinct dates. */
const FALLBACK_MIN = '2026-03-10'
const FALLBACK_MAX = '2026-03-24'

export function collectExhibitDates(exhibits: readonly Exhibit[]): string[] {
  const found = new Set<string>()
  for (const exhibit of exhibits) {
    for (const s of exhibit.spans) {
      for (const m of s.text.matchAll(ISO_DATE)) found.add(m[0])
    }
  }
  return [...found].sort()
}

export function renderTimeline(container: HTMLElement, exhibits: readonly Exhibit[]): void {
  container.textContent = ''

  let dates = collectExhibitDates(exhibits)
  if (dates.length < 2) {
    dates = [...new Set([...dates, FALLBACK_MIN, FALLBACK_MAX])].sort()
  }
  const min = dates[0] ?? FALLBACK_MIN
  const max = dates[dates.length - 1] ?? FALLBACK_MAX
  const minT = Date.parse(min)
  const maxT = Date.parse(max)
  const range = Math.max(maxT - minT, 1)

  const legend = el('div', 'timeline-legend')
  legend.append(
    el('span', 'timeline-legend-dot'),
    document.createTextNode('contested')
  )

  const track = el('div', 'timeline-track')
  dates.forEach((date, i) => {
    const contested = CONTESTED_DATES.has(date)
    const tick = el('div', 'timeline-tick')
    tick.style.left = `${((Date.parse(date) - minT) / range) * 100}%`
    const dot = el(
      'span',
      contested ? 'timeline-dot timeline-dot-contested' : 'timeline-dot'
    )
    dot.title = contested ? `${date} (contested)` : date
    const label = el(
      'span',
      `timeline-label${i % 2 === 1 ? ' timeline-label-alt' : ''}${contested ? ' timeline-label-contested' : ''}`,
      date
    )
    tick.append(dot, label)
    track.appendChild(tick)
  })

  container.append(legend, track)
}
