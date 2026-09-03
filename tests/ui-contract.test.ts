// @vitest-environment happy-dom
/**
 * Cycle-2 hardening: minimal deterministic UI-contract layer.
 *
 * Contract enforced WITHOUT importing src/main.ts (its module scope runs
 * byId() + wiring + boot() at import time). index.html is mounted into
 * happy-dom and main.ts is parsed as SOURCE, so a renamed/removed #id fails
 * here instead of exploding at runtime boot.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  appendLog,
  formatFreshnessAge,
  renderExhibitGrid,
  renderReceiptSummary,
  selectPrimaryExhibits,
  setVerdict
} from '../src/ui/caseboard.ts'
import {
  applyAgentAction,
  applyHumanAction,
  createBoard
} from '../src/domain/board.ts'
import { buildSealedReceipt, collectAcceptedEvidence } from '../src/domain/receipt.ts'
import type { BoardState, Exhibit } from '../src/domain/types.ts'

// happy-dom rewrites import.meta.url to an http scheme — anchor at cwd instead.
const ROOT = resolve(process.cwd())
const INDEX_HTML = readFileSync(resolve(ROOT, 'index.html'), 'utf8')
const MAIN_TS = readFileSync(resolve(ROOT, 'src/main.ts'), 'utf8')

function mountIndex(): void {
  // Scripts injected via innerHTML never execute (HTML spec) — inert mount.
  const body = INDEX_HTML.slice(
    INDEX_HTML.indexOf('<body>') + '<body>'.length,
    INDEX_HTML.indexOf('</body>')
  ).replace(/<script[\s\S]*?<\/script>/g, '')
  document.body.innerHTML = body
}

const span = (id: string, text: string) => ({ span_id: id, text, sha256: `hash-${id}` })

const EXHIBITS: Exhibit[] = [
  { id: 'EX-001', title: 'Vendor attestation', spans: [span('s1', 'attestation text')] },
  { id: 'EX-002', title: 'Inspection report', spans: [span('s2', 'report text')] },
  { id: 'EX-003', title: 'Acceptance certificate', spans: [span('s3', 'acceptance text')] }
]

function add(
  board: BoardState,
  id: string,
  stance: 'supports' | 'contradicts'
): BoardState {
  const r = applyAgentAction(board, { action: 'add', exhibit_id: id, stance })
  if (!r.ok) throw new Error(r.reason)
  return r.board
}

const noopCbs = { onPin: () => {}, onRemove: () => {}, onReject: () => {} }

describe('UI contract — index.html ↔ main.ts element ids', () => {
  it('every byId target in main.ts exists exactly once in index.html', () => {
    mountIndex()
    const referenced = [...MAIN_TS.matchAll(/byId<[^>]*>\('([^']+)'\)/g)].map((m) => m[1])
    expect(referenced.length).toBeGreaterThanOrEqual(10)
    const domIds = [...document.querySelectorAll('[id]')].map((n) => n.id)
    for (const id of referenced) {
      expect(
        domIds.filter((x) => x === id),
        `#${id} referenced by main.ts but missing/dup in index.html`
      ).toHaveLength(1)
    }
  })

  it('index.html contains no duplicate ids anywhere', () => {
    const ids = [...INDEX_HTML.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1])
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('caseboard render contract', () => {
  it('shows EX-001 and EX-002 before proposals, then all proposed evidence', () => {
    const empty = createBoard()
    expect(selectPrimaryExhibits(EXHIBITS, empty, new Set()).map((e) => e.id)).toEqual([
      'EX-001',
      'EX-002'
    ])

    let proposed = add(empty, 'EX-003', 'supports')
    proposed = add(proposed, 'EX-001', 'supports')
    expect(selectPrimaryExhibits(EXHIBITS, proposed, new Set()).map((e) => e.id)).toEqual([
      'EX-001',
      'EX-003'
    ])
  })

  it('controls disabled before proposal, enabled after', () => {
    const grid = document.createElement('div')
    const empty = createBoard()

    renderExhibitGrid(grid, EXHIBITS, empty, new Set(), noopCbs)
    const card = grid.querySelector<HTMLElement>('[data-exhibit-id="EX-001"]')
    expect(card).toBeTruthy()
    const before = [...card!.querySelectorAll('button')]
    expect(before.map((b) => b.textContent)).toEqual(['PIN', 'REMOVE', 'REJECT'])
    for (const b of before) {
      expect(b.disabled).toBe(true)
      expect(b.getAttribute('aria-disabled')).toBe('true')
      expect(b.title).toMatch(/Awaiting agent proposal/)
    }

    const proposed = add(empty, 'EX-001', 'supports')
    renderExhibitGrid(grid, EXHIBITS, proposed, new Set(), noopCbs)
    const after = [
      ...grid.querySelectorAll<HTMLButtonElement>('[data-exhibit-id="EX-001"] button')
    ]
    for (const b of after) {
      expect(b.disabled).toBe(false)
      expect(b.hasAttribute('aria-disabled')).toBe(false)
    }
    expect(
      grid.querySelector('[data-exhibit-id="EX-001"]')?.textContent
    ).toContain('AGENT PROPOSED')
  })

  it('quarantined exhibits show SIG FAILED badge and render no controls', () => {
    const grid = document.createElement('div')
    renderExhibitGrid(grid, EXHIBITS, createBoard(), new Set(['EX-002']), noopCbs)
    const card = grid.querySelector('[data-exhibit-id="EX-002"]')
    expect(card?.querySelector('.badge-fail')?.textContent).toBe('SIG FAILED — QUARANTINED')
    expect(card?.querySelectorAll('button')).toHaveLength(0)
  })
})

describe('receipt summary', () => {
  it('renders human meaning and decision provenance ahead of raw JSON', () => {
    const summary = document.createElement('div')
    renderReceiptSummary(summary, {
      agentVerdict: 'CONTRADICTED',
      humanDecision: 'CORRECTED',
      finalVerdict: 'SUPPORTED',
      actorRole: 'local-human-reviewer',
      waitingMs: 4250,
      proposedCount: 3,
      acceptedCount: 2,
      rejectedCount: 1,
      qualityChecks: { passed: 6, total: 6 },
      evidenceConfidence: {
        level: 'HIGH',
        basis: 'Two decisive exhibits are signature verified and source tied.'
      },
      uncoveredScope: ['No external identity or authoritative seal-time attestation.']
    })
    expect(summary.textContent).toContain('Human decision: CORRECTED')
    expect(summary.textContent).toContain('Final verdict: SUPPORTED')
    expect(summary.textContent).toContain('Agent proposed: CONTRADICTED')
    expect(summary.textContent).toContain('local-human-reviewer')
    expect(summary.textContent).toContain('4.25 seconds')
    expect(summary.textContent).toContain('Agent proposed 3 exhibits')
    expect(summary.textContent).toContain('Human accepted 2')
    expect(summary.textContent).toContain('Rejected 1')
    expect(summary.textContent).toContain('Quality checks: 6/6')
    expect(summary.textContent).toContain('Evidence confidence: HIGH')
    expect(summary.textContent).toContain('Uncovered scope')
    expect(summary.textContent).toContain('Evidence integrity: VERIFIED')
    expect(summary.textContent).toContain('Signed locally')
  })
})

describe('status freshness', () => {
  it('ages from now to seconds and then a literal stale state', () => {
    const updatedAt = Date.parse('2026-09-03T12:00:00.000Z')
    expect(formatFreshnessAge(updatedAt, updatedAt + 2_000)).toBe('Updated now')
    expect(formatFreshnessAge(updatedAt, updatedAt + 32_000)).toBe('Updated 32s ago')
    expect(formatFreshnessAge(updatedAt, updatedAt + 92_000)).toBe('Updated 1m ago · STALE')
  })
})

describe('verdict stamp literal text', () => {
  const stamp = document.createElement('div')

  it('plain verdicts render VERDICT: <X>', () => {
    setVerdict(stamp, { verdict: 'SUPPORTED', missing: [] })
    expect(stamp.textContent).toBe('VERDICT: SUPPORTED')
    expect(stamp.className).toContain('verdict-supported')
    setVerdict(stamp, { verdict: 'CONTRADICTED', missing: [] })
    expect(stamp.textContent).toBe('VERDICT: CONTRADICTED')
  })

  it('INSUFFICIENT renders the missing-list inline', () => {
    setVerdict(stamp, {
      verdict: 'INSUFFICIENT',
      missing: ['Inspection Report IR-2219', 'Delivery Log DL-3092']
    })
    expect(stamp.textContent).toBe(
      'VERDICT: INSUFFICIENT — missing: Inspection Report IR-2219, Delivery Log DL-3092'
    )
  })

  it('INSUFFICIENT with empty missing list stays clean', () => {
    setVerdict(stamp, { verdict: 'INSUFFICIENT', missing: [] })
    expect(stamp.textContent).toBe('VERDICT: INSUFFICIENT')
  })
})

describe('appendLog tag contract', () => {
  it('creates bracket-prefixed entries with clean class tokens', () => {
    const ol = document.createElement('ol')
    appendLog(ol, 'SIM', 'search_evidence returned 3 hits')
    appendLog(ol, 'ERR', 'seal refused')
    expect(ol.children).toHaveLength(2)
    const first = ol.children[0] as HTMLElement
    const second = ol.children[1] as HTMLElement
    expect(first.textContent).toContain('[SIM]')
    expect(first.className).not.toContain('[')
    expect(second.textContent).toContain('[ERR]')
  })
})

describe('collectAcceptedEvidence → sealed receipt integration', () => {
  it('mixed board gates the receipt to verified non-rejected entries only', async () => {
    let board = add(createBoard(), 'EX-001', 'supports') // verified → accepted
    board = add(board, 'EX-002', 'contradicts') // quarantined → refused below
    board = add(board, 'EX-999', 'supports') // fabricated → refused below
    const rejected = applyHumanAction(board, { action: 'reject', exhibit_id: 'EX-003' })
    // EX-003 was never proposed; the refusal itself is the expected path here.
    void rejected

    const quarantined = new Set(['EX-002'])
    const { accepted, refused } = collectAcceptedEvidence(board.entries, EXHIBITS, quarantined)

    expect(accepted.map((a) => a.exhibit_id)).toEqual(['EX-001'])
    expect(refused).toEqual([
      { exhibit_id: 'EX-002', reason: 'quarantined' },
      { exhibit_id: 'EX-999', reason: 'not_in_verified_set' }
    ])

    const signer = {
      sign: (p: Uint8Array) => p,
      publicKey: () => new Uint8Array(32).fill(7)
    }
    const envelope = await buildSealedReceipt(
      {
        sealedAt: '2026-08-25T00:00:00.000Z',
        claimText: 'claim',
        verdict: 'INSUFFICIENT',
        acceptedEvidence: accepted,
        toolLog: ['[SYS] boot'],
        manifestPublicKey: 'aa',
        manifestSignature: 'bb',
        humanDecision: {
          status: 'DECLINED',
          actorRole: 'local-human-reviewer',
          agentVerdict: 'INSUFFICIENT',
          finalVerdict: null,
          rationale: null,
          proposedAt: '2026-08-24T23:59:58.000Z',
          decidedAt: '2026-08-25T00:00:00.000Z',
          waitingMs: 2000
        },
        priorBoardDigest: 'sha256:board-state',
        qualityChecks: { passed: 6, total: 6 },
        evidenceConfidence: { level: 'LOW', basis: 'Required evidence is missing.' },
        uncoveredScope: ['Missing inspection report.']
      },
      signer
    )
    expect(envelope.receipt.accepted_evidence).toEqual(accepted)
    expect(envelope.receipt.human_decision?.status).toBe('DECLINED')
    expect(envelope.receipt.verdict).toBe('DECLINED')
    expect(envelope.receipt.prior_board_digest).toBe('sha256:board-state')
    expect(envelope.receipt.hard_gate).toBe('HUMAN_DECISION_REQUIRED')
    expect(envelope.receipt.quality_checks).toEqual({ passed: 6, total: 6 })
    expect(
      envelope.receipt.accepted_evidence.some((a) => a.exhibit_id === 'EX-999')
    ).toBe(false)
  })
})
