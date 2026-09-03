/**
 * Caseboard rendering. All statuses are LITERAL TEXT
 * (SUPPORTED / CONTRADICTED / INSUFFICIENT / SIG VERIFIED / SIG FAILED /
 * MANIFEST MISMATCH); color is secondary, never the sole meaning.
 * Every data string is written via textContent.
 */

import { el, btn } from './dom.ts'
import type { BoardState, ClaimEvaluation, Exhibit, Verdict } from '../domain/types.ts'

export type LogTag = 'WEBMCP' | 'SIM' | 'HUMAN' | 'SYS' | 'ERR' | 'USER'

export function formatFreshnessAge(updatedAtMs: number, nowMs = Date.now()): string {
  const elapsedMs = Math.max(0, nowMs - updatedAtMs)
  if (elapsedMs < 5_000) return 'Updated now'
  if (elapsedMs < 60_000) return `Updated ${Math.floor(elapsedMs / 1_000)}s ago`
  return `Updated ${Math.floor(elapsedMs / 60_000)}m ago · STALE`
}

export function appendLog(logEl: HTMLOListElement, tag: LogTag, text: string): HTMLLIElement {
  const li = el('li', 'log-entry')
  // Bracket text belongs in content only — bracketed CSS class tokens require
  // escaping and duplicated the tag already rendered via textContent.
  const tagSpan = el('span', `log-tag log-tag-${tag.toLowerCase()}`, `[${tag}]`)
  const textSpan = el('span', 'log-text')
  textSpan.textContent = text
  li.append(tagSpan, textSpan)
  logEl.appendChild(li)
  logEl.scrollTop = logEl.scrollHeight
  // Single polite announcement of the latest entry avoids an aria-live storm.
  const liveStatus = document.getElementById('log-live-status')
  if (liveStatus) liveStatus.textContent = `[${tag}] ${text}`
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

export function renderReceiptPreview(previewEl: HTMLElement, jsonText: string): void {
  previewEl.textContent = jsonText
}

export function renderReceiptSummary(
  summaryEl: HTMLElement,
  summary: {
    agentVerdict: Verdict
    humanDecision: 'APPROVED' | 'CORRECTED' | 'DECLINED'
    finalVerdict: Verdict | null
    actorRole: string
    waitingMs: number
    proposedCount: number
    acceptedCount: number
    rejectedCount: number
    qualityChecks: { passed: number; total: number }
    evidenceConfidence: { level: 'HIGH' | 'MEDIUM' | 'LOW'; basis: string }
    uncoveredScope: string[]
  }
): void {
  summaryEl.textContent = ''
  const decision = el('p', 'receipt-summary-state', `Human decision: ${summary.humanDecision}`)
  const heading = el(
    'p',
    'receipt-summary-verdict',
    summary.finalVerdict ? `Final verdict: ${summary.finalVerdict}` : 'Final verdict: NOT ADOPTED'
  )
  const provenance = el(
    'p',
    'receipt-summary-provenance',
    `Agent proposed: ${summary.agentVerdict} · Actor: ${summary.actorRole} · Wait: ${(summary.waitingMs / 1000).toFixed(2)} seconds`
  )
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
  const quality = el(
    'p',
    'receipt-summary-quality',
    `Quality checks: ${summary.qualityChecks.passed}/${summary.qualityChecks.total} · Evidence confidence: ${summary.evidenceConfidence.level} — ${summary.evidenceConfidence.basis}`
  )
  const scope = el(
    'p',
    'receipt-summary-scope',
    `Uncovered scope: ${summary.uncoveredScope.join(' ') || 'None reported.'}`
  )
  summaryEl.append(decision, heading, provenance, counts, integrity, quality, scope)
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
