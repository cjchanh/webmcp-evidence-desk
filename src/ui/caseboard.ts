/**
 * Caseboard rendering. All statuses are LITERAL TEXT
 * (SUPPORTED / CONTRADICTED / INSUFFICIENT / SIG VERIFIED / SIG FAILED /
 * MANIFEST MISMATCH); color is secondary, never the sole meaning.
 * Every data string is written via textContent.
 */

import { el, btn } from './dom.ts'
import type { BoardState, ClaimEvaluation, Exhibit, Verdict } from '../domain/types.ts'

export type LogTag = 'WEBMCP' | 'SIM' | 'HUMAN' | 'SYS' | 'ERR'

/** True when the operator asked the OS for reduced motion. Typing is JS-driven
 * (timers, not CSS), so the global CSS kill block cannot cover it — gate here. */
function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

// --- provenance rail typing (P1) ---------------------------------------------
// Only the NEWEST entry types; any newer arrival completes the previous one
// instantly. One click anywhere on the log finishes the active entry.

interface ActiveTyping {
  finish(): void
}

let activeTyping: ActiveTyping | null = null
const typingLogs = new WeakSet<HTMLElement>()

function typeLogText(logEl: HTMLElement, textSpan: HTMLElement, text: string): void {
  activeTyping?.finish()
  if (prefersReducedMotion()) {
    textSpan.textContent = text
    return
  }

  const caret = el('span', 'log-caret')
  caret.setAttribute('aria-hidden', 'true')
  textSpan.after(caret)

  let i = 0
  const finish = () => {
    clearInterval(timer)
    textSpan.textContent = text
    caret.remove()
    if (activeTyping && activeTyping.finish === finish) activeTyping = null
  }
  const timer = setInterval(() => {
    i += 1
    textSpan.textContent = text.slice(0, i)
    logEl.scrollTop = logEl.scrollHeight
    if (i >= text.length) finish()
  }, 12)
  activeTyping = { finish }

  // Click-to-complete: one listener per log element, installed once.
  if (!typingLogs.has(logEl)) {
    typingLogs.add(logEl)
    logEl.addEventListener('click', () => activeTyping?.finish())
  }
}

export function appendLog(logEl: HTMLOListElement, tag: LogTag, text: string): HTMLLIElement {
  const li = el('li', 'log-entry')
  // Bracket text belongs in content only — bracketed CSS class tokens require
  // escaping and duplicated the tag already rendered via textContent.
  const tagSpan = el('span', `log-tag log-tag-${tag.toLowerCase()}`, `[${tag}]`)
  const textSpan = el('span', 'log-text')
  li.append(tagSpan, textSpan)
  logEl.appendChild(li)
  logEl.scrollTop = logEl.scrollHeight
  // Cycle-3 a11y: single polite announcement of the LATEST entry instead of an
  // aria-live storm over every burst line. The live region receives the FULL
  // text immediately — visual typing is presentation, never a content delay.
  const liveStatus = document.getElementById('log-live-status')
  if (liveStatus) liveStatus.textContent = `[${tag}] ${text}`
  typeLogText(logEl, textSpan, text)
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
  // P0 signature sequence: every verdict through this path is non-PENDING
  // (Verdict = SUPPORTED | CONTRADICTED | INSUFFICIENT; the PENDING stamp is
  // written directly by boot). className reset above clears any prior slam;
  // forced reflow lets consecutive verdicts retrigger.
  void stampEl.offsetWidth
  stampEl.classList.add('verdict-slam')
}

export interface ExhibitCardCallbacks {
  onPin(exhibitId: string): void
  onRemove(exhibitId: string): void
  onReject(exhibitId: string): void
}

/** Presentation-only render options. arriveIds marks exhibits playing their
 * ONE-TIME agent-arrival animation on this mount; persisted content never
 * animates (anti-pattern A2). */
export interface RenderOptions {
  arriveIds?: ReadonlySet<string>
}

export const MAX_RENDERED_CARDS = 100

/**
 * Judge-first projection: before an agent proposes anything, show only the
 * deliberate contradiction pair. Afterwards show every proposed or
 * quarantined exhibit, in canonical packet order. The full verified packet is
 * rendered separately behind disclosure.
 */
export function selectPrimaryExhibits(
  exhibits: Exhibit[],
  board: BoardState,
  quarantinedIds: ReadonlySet<string>
): Exhibit[] {
  const visible = new Set(
    board.entries.length > 0
      ? board.entries.map((entry) => entry.exhibit_id)
      : ['EX-001', 'EX-002']
  )
  for (const id of quarantinedIds) visible.add(id)
  return exhibits.filter((exhibit) => visible.has(exhibit.id))
}

export function renderExhibitGrid(
  gridEl: HTMLElement,
  exhibits: Exhibit[],
  board: BoardState,
  quarantinedIds: ReadonlySet<string>,
  cb: ExhibitCardCallbacks,
  opts?: RenderOptions
): void {
  gridEl.textContent = ''

  // Cycle-3 hardening: bound DOM fan-out. Shipped corpus is 13 cards; this cap
  // keeps a future larger signed manifest from exploding layout.
  const rendered = exhibits.slice(0, MAX_RENDERED_CARDS)

  for (const exhibit of rendered) {
    const entry = board.entries.find((e) => e.exhibit_id === exhibit.id)
    const quarantined = quarantinedIds.has(exhibit.id)
    const arriving = opts?.arriveIds?.has(exhibit.id) ?? false

    const card = el('article', arriving ? 'exhibit-card exhibit-arrive' : 'exhibit-card')
    card.dataset.exhibitId = exhibit.id
    // Quarantine treatment hook: CSS draws the red left rule from this
    // attribute; the literal-text badge below stays the semantic carrier.
    if (quarantined) card.dataset.quarantined = 'true'
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
      const stanceBadge = el(
        'span',
        `badge ${entry.stance === 'supports' ? 'badge-supports' : 'badge-contradicts'}`,
        `${stanceTag} ${entry.origin === 'agent' ? 'AGENT PROPOSED' : 'HUMAN ADDED'} — ${entry.status.toUpperCase()}`
      )
      if (entry.origin === 'agent') stanceBadge.classList.add('stance-ink')
      badges.append(stanceBadge)
    }
    card.appendChild(badges)

    const preview = el('p', 'exhibit-preview', exhibit.spans[0]?.text ?? '')
    card.appendChild(preview)

    // Cycle-1 UX hardening: controls are ALWAYS rendered on verified cards so
    // the board never reads as inert; before the agent proposes anything they
    // are disabled with an explanation instead of absent.
    if (!quarantined) {
      const controls = el('div', 'control-row')
      const awaiting = entry === undefined
      for (const [label, action] of [
        ['PIN', cb.onPin],
        ['REMOVE', cb.onRemove],
        ['REJECT', cb.onReject]
      ] as const) {
        const b = btn(label, () => action(exhibit.id))
        if (awaiting) {
          b.disabled = true
          b.title = 'Awaiting agent proposal — run the review to enable adjudication'
          b.setAttribute('aria-disabled', 'true')
        }
        controls.append(b)
      }
      card.appendChild(controls)
    }

    gridEl.appendChild(card)

    // Ink draw rides the arrival: two frames so the 0% state commits before
    // the transition to 100% starts. Non-arriving renders are already final.
    if (arriving) {
      const ink = card.querySelector<HTMLElement>('.stance-ink')
      if (ink) {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => ink.classList.add('ink-drawn'))
        )
      }
    }
  }

  if (exhibits.length > rendered.length) {
    const stub = el('p', 'hint', `Showing first ${rendered.length} of ${exhibits.length} verified exhibits.`)
    gridEl.appendChild(stub)
  }
}

/** P2 — receipt preview reveals line-by-line on open. Each JSON line becomes a
 * block span with a staggered animation-delay; the stagger caps at the first
 * MAX_STAGGER_LINES lines so the whole receipt is readable after one wave.
 * All content still enters via textContent. */
const MAX_STAGGER_LINES = 12

export function renderReceiptPreview(previewEl: HTMLElement, jsonText: string): void {
  previewEl.textContent = ''
  const lines = jsonText.split('\n')
  lines.forEach((line, i) => {
    const lineSpan = el('span', 'receipt-line', line)
    lineSpan.style.animationDelay = `${Math.min(i, MAX_STAGGER_LINES - 1) * 40}ms`
    previewEl.appendChild(lineSpan)
  })
}

export function renderReceiptSummary(
  summaryEl: HTMLElement,
  summary: {
    verdict: Verdict
    proposedCount: number
    acceptedCount: number
    rejectedCount: number
  }
): void {
  summaryEl.textContent = ''
  const heading = el('p', 'receipt-summary-verdict', `Final verdict: ${summary.verdict}`)
  const counts = el(
    'p',
    'receipt-summary-counts',
    `Agent proposed ${summary.proposedCount} exhibit${summary.proposedCount === 1 ? '' : 's'} · ` +
      `Human accepted ${summary.acceptedCount} · Rejected ${summary.rejectedCount}`
  )
  const integrity = el(
    'p',
    'receipt-summary-integrity',
    'Evidence integrity: VERIFIED · Signed locally · accepted hashes anchored in the signed manifest'
  )
  summaryEl.append(heading, counts, integrity)
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
