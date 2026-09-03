// @vitest-environment happy-dom
/**
 * Forge-demo hardening: the adversarial challenge lane.
 *
 * Covers:
 *  1. a forged candidate FAILS the span-hash compare (the same comparison
 *     verifyManifest performs, isolated per exhibit by the forge probe);
 *  2. the full caught sequence through the REAL page: quarantined card with
 *     arrival animation, INSUFFICIENT verdict, seal refusal;
 *  3. RESET CASE restores pristine board / verdict / exhibits;
 *  4. collectAcceptedEvidence refusal path reused for quarantined material.
 */

import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { buildForgedExhibitCandidate, probeForgedExhibit } from '../src/domain/forge.ts'
import { collectAcceptedEvidence } from '../src/domain/receipt.ts'
import { applyAgentAction, createBoard } from '../src/domain/board.ts'
import { fixtureExhibits, HERO_CLAIM } from './helpers/fixtures.ts'
import type { BoardState, Exhibit } from '../src/domain/types.ts'

// --- 1. forged candidate fails span-hash compare -----------------------------

describe('forged candidate fails span-hash compare', () => {
  const base: Exhibit = fixtureExhibits().find((e) => e.id === 'EX-002')!

  it('buildForgedExhibitCandidate swaps text only; recorded hashes untouched', () => {
    const lie = base.spans[0]!.text.replace('2026-03-19', '2026-03-09')
    const candidate = buildForgedExhibitCandidate(base, [lie])
    expect(candidate.id).toBe('EX-002')
    expect(candidate.title).toBe(base.title)
    expect(candidate.spans[0]!.sha256).toBe(base.spans[0]!.sha256)
    expect(candidate.spans[0]!.text).toBe(lie)
    // The base exhibit is never mutated.
    expect(base.spans[0]!.text).toContain('2026-03-19')
  })

  it('edited date -> caught; recomputed sha256 differs from the recorded hash', async () => {
    const edited = base.spans.map((s) =>
      s.text === base.spans[0]!.text ? s.text.replace('2026-03-19', '2026-03-09') : s.text
    )
    const candidate = buildForgedExhibitCandidate(base, edited)
    const report = await probeForgedExhibit(candidate)
    expect(report.caught).toBe(true)
    expect(report.failed_span_id).toBe('EX-002-1')
    const failed = report.probes.find((p) => p.span_id === 'EX-002-1')!
    expect(failed.intact).toBe(false)
    expect(failed.recomputed_sha256).not.toBe(failed.recorded_sha256)
    expect(failed.submitted_text).toContain('2026-03-09')
  })

  it('unedited submission passes the probe — the desk never fakes a catch', async () => {
    const candidate = buildForgedExhibitCandidate(
      base,
      base.spans.map((s) => s.text)
    )
    const report = await probeForgedExhibit(candidate)
    expect(report.caught).toBe(false)
    expect(report.failed_span_id).toBe(null)
    for (const probe of report.probes) {
      expect(probe.recomputed_sha256).toBe(probe.recorded_sha256)
      expect(probe.intact).toBe(true)
    }
  })
})

// --- 4. collectAcceptedEvidence refusal path (seal internals) ----------------

describe('collectAcceptedEvidence refuses quarantined material', () => {
  const exhibits = fixtureExhibits()

  function add(board: BoardState, id: string): BoardState {
    const r = applyAgentAction(board, {
      action: 'add',
      exhibit_id: id,
      stance: id === 'EX-002' ? 'contradicts' : 'supports'
    })
    if (!r.ok) throw new Error(r.reason)
    return r.board
  }

  it('a forged-and-quarantined board entry is refused with reason "quarantined"', () => {
    let board = add(createBoard(), 'EX-001')
    board = add(board, 'EX-002')
    const quarantined = new Set(['EX-002'])
    const { accepted, refused } = collectAcceptedEvidence(board.entries, exhibits, quarantined)
    expect(refused).toEqual([{ exhibit_id: 'EX-002', reason: 'quarantined' }])
    expect(accepted.map((a) => a.exhibit_id)).toEqual(['EX-001'])
    expect(HERO_CLAIM).toContain('inspection report')
  })
})

// --- 2 + 3. full caught sequence and reset through the real page -------------

describe('caught sequence through the real page', () => {
  it('forge -> SIG FAILED card + INSUFFICIENT verdict + seal refusal; reset restores pristine', async () => {
    // Mount index.html BEFORE importing main.ts — its module scope boots
    // immediately against the live DOM.
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')
    document.body.innerHTML = html.slice(
      html.indexOf('<body>') + '<body>'.length,
      html.indexOf('</body>')
    ).replace(/<script[\s\S]*?<\/script>/g, '')
    await import('../src/main.ts')

    // Boot completes when the stamp settles at PENDING over verified evidence.
    await vi.waitFor(() => {
      expect(document.getElementById('verdict-stamp')?.textContent).toBe(
        'VERDICT: PENDING REVIEW'
      )
    })
    const grid = document.getElementById('exhibit-grid')!
    const packetGrid = document.getElementById('packet-grid')!
    expect(grid.querySelectorAll('.exhibit-card')).toHaveLength(2)
    expect(packetGrid.querySelectorAll('.exhibit-card')).toHaveLength(13)

    // Open the bench; editors preload EX-002's exact signed spans.
    ;(document.getElementById('btn-open-forge-bench') as HTMLButtonElement).click()
    const editors = document.getElementById('forge-span-editors')!
    const textareas = [...editors.querySelectorAll<HTMLTextAreaElement>('textarea')]
    expect(textareas).toHaveLength(3)
    expect(textareas[1]!.value).toContain('2026-03-19')

    // Slip the lie: move the performed-on date ahead of acceptance.
    textareas[1]!.value = textareas[1]!.value.replace('2026-03-19', '2026-03-09')
    ;(document.getElementById('btn-submit-forgery') as HTMLButtonElement).click()

    await vi.waitFor(() => {
      expect(document.getElementById('forge-status')?.textContent).toContain(
        'CAUGHT — span hash mismatch on EX-002-2'
      )
    })

    // a. The forged card renders quarantined with the arrival animation…
    const forgedCard = grid.querySelector('[data-exhibit-id="EX-002"]')!
    expect(forgedCard.querySelector('.badge-fail')?.textContent).toBe(
      'SIG FAILED — QUARANTINED'
    )
    expect(forgedCard.getAttribute('data-quarantined')).toBe('true')
    expect(forgedCard.className).toContain('exhibit-arrive')
    expect(forgedCard.querySelectorAll('button')).toHaveLength(0)

    // Mission Calm keeps the integrity failure calm and literal, without a board shake.
    const boardCard = grid.closest<HTMLElement>('.board-card')
    expect(boardCard?.classList.contains('board-shake')).toBe(false)
    expect(document.getElementById('review-status')?.textContent).toBe('ABSTAIN')
    expect(document.getElementById('abstention-notice')?.hidden).toBe(false)

    // …and c. the verdict flips INSUFFICIENT with the integrity missing-entry.
    const stamp = document.getElementById('verdict-stamp')!
    expect(stamp.textContent).toBe(
      'VERDICT: INSUFFICIENT — missing: integrity: forged exhibit rejected'
    )
    expect(stamp.className).toContain('verdict-insufficient')

    // e. Bench status names the betrayal and what survived.
    const status = document.getElementById('forge-status')?.textContent ?? ''
    expect(status).toContain('Your edit changed bytes the manifest never signed.')
    expect(status).toContain('The other 12 exhibits remain SIG VERIFIED.')

    // d. The seal gate refuses while quarantined material is present.
    ;(document.getElementById('btn-seal-receipt') as HTMLButtonElement).click()
    expect(document.getElementById('seal-status')?.textContent).toBe(
      'SEAL REFUSED — board contains quarantined material.'
    )

    // RESET CASE restores pristine state: original exhibits, PENDING, empty board.
    ;(document.getElementById('btn-reset-case') as HTMLButtonElement).click()
    await vi.waitFor(() => {
      expect(document.getElementById('verdict-stamp')?.textContent).toBe(
        'VERDICT: PENDING REVIEW'
      )
    })
    expect(grid.querySelectorAll('.exhibit-card')).toHaveLength(2)
    expect(packetGrid.querySelectorAll('.exhibit-card')).toHaveLength(13)
    expect(grid.querySelectorAll('.badge-fail')).toHaveLength(0)
    expect(grid.querySelectorAll('[data-quarantined]')).toHaveLength(0)
    const ex002 = grid.querySelector('[data-exhibit-id="EX-002"]')!
    expect(ex002.querySelector('.badge-ok')?.textContent).toBe('SIG VERIFIED')
    // Cards render spans[0] only — EX-002's signed header span.
    expect(ex002.querySelector('.exhibit-preview')?.textContent).toContain(
      'Inspection Report IR-2219'
    )
    // Board cleared: no stance badges anywhere.
    expect(grid.textContent).not.toContain('AGENT PROPOSED')
    expect(grid.textContent).not.toContain('HUMAN ADDED')
    // Reset button hides again; bench closed.
    expect((document.getElementById('btn-reset-case') as HTMLButtonElement).hidden).toBe(true)
    expect(document.getElementById('forge-bench-backdrop')?.hidden).toBe(true)
  })
})
