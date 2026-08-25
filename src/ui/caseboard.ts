/**
 * Caseboard rendering. All statuses are LITERAL TEXT
 * (SUPPORTED / CONTRADICTED / INSUFFICIENT / SIG VERIFIED / SIG FAILED /
 * MANIFEST MISMATCH); color is secondary, never the sole meaning.
 * Every data string is written via textContent.
 */

import { el, btn } from './dom.ts'
import type { BoardState, ClaimEvaluation, Exhibit } from '../domain/types.ts'

export type LogTag = 'WEBMCP' | 'SIM' | 'HUMAN' | 'SYS' | 'ERR'

export function appendLog(logEl: HTMLOListElement, tag: LogTag, text: string): HTMLLIElement {
  const li = el('li', 'log-entry')
  const tagSpan = el('span', `log-tag log-tag-${tag.toLowerCase()} [${tag}]`, `[${tag}]`)
  const textSpan = el('span', 'log-text', text)
  li.append(tagSpan, textSpan)
  logEl.appendChild(li)
  logEl.scrollTop = logEl.scrollHeight
  return li
}

export function setVerdict(
  stampEl: HTMLElement,
  evaluation: Pick<ClaimEvaluation, 'verdict' | 'missing'>
): void {
  stampEl.textContent =
    evaluation.verdict === 'INSUFFICIENT' && evaluation.missing.length > 0
      ? `VERDICT: INSUFFICIENT — missing: ${evaluation.missing.join(', ')}`
      : `VERDICT: ${evaluation.verdict}`
  stampEl.className = `verdict-stamp verdict-${evaluation.verdict.toLowerCase()}`
}

export interface ExhibitCardCallbacks {
  onPin(exhibitId: string): void
  onRemove(exhibitId: string): void
  onReject(exhibitId: string): void
}

export function renderExhibitGrid(
  gridEl: HTMLElement,
  exhibits: Exhibit[],
  board: BoardState,
  quarantinedIds: ReadonlySet<string>,
  cb: ExhibitCardCallbacks
): void {
  gridEl.textContent = ''

  for (const exhibit of exhibits) {
    const entry = board.entries.find((e) => e.exhibit_id === exhibit.id)
    const quarantined = quarantinedIds.has(exhibit.id)

    const card = el('article', 'exhibit-card')
    card.dataset.exhibitId = exhibit.id
    card.tabIndex = 0

    const head = el('div', 'exhibit-head')
    head.append(
      el('span', 'exhibit-id', exhibit.id),
      el('h3', 'exhibit-title', exhibit.title)
    )
    card.appendChild(head)

    const badges = el('div', 'badge-row')
    if (quarantined) {
      badges.append(el('span', 'badge badge-fail', 'SIG FAILED — QUARANTINED'))
    } else {
      badges.append(el('span', 'badge badge-ok', 'SIG VERIFIED'))
    }
    if (entry) {
      const stanceTag =
        entry.stance === 'supports' ? '[SUPPORTS]' : '[CONTRADICTS]'
      badges.append(
        el(
          'span',
          `badge ${entry.stance === 'supports' ? 'badge-supports' : 'badge-contradicts'}`,
          `${stanceTag} ${entry.origin === 'agent' ? 'AGENT PROPOSED' : 'HUMAN ADDED'} — ${entry.status.toUpperCase()}`
        )
      )
    }
    card.appendChild(badges)

    const preview = el('p', 'exhibit-preview', exhibit.spans[0]?.text ?? '')
    card.appendChild(preview)

    if (!quarantined && entry) {
      const controls = el('div', 'control-row')
      controls.append(
        btn('PIN', () => cb.onPin(exhibit.id)),
        btn('REMOVE', () => cb.onRemove(exhibit.id)),
        btn('REJECT', () => cb.onReject(exhibit.id))
      )
      card.appendChild(controls)
    }

    gridEl.appendChild(card)
  }
}

/** Arrow-key cycling across exhibit cards (roving focus). */
export function cycleExhibits(gridEl: HTMLElement, direction: 1 | -1): void {
  const cards = Array.from(gridEl.querySelectorAll<HTMLElement>('.exhibit-card'))
  if (cards.length === 0) return
  const currentIdx = cards.findIndex((c) => c === document.activeElement)
  const nextIdx =
    currentIdx === -1
      ? 0
      : (currentIdx + direction + cards.length) % cards.length
  cards[nextIdx]?.focus()
}
