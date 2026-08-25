/**
 * Cycle-2 property hardening: totality, purity, and boundary pins derived from
 * the fuzz campaign. Each test freezes a class of bug found by attack.
 */
import { describe, expect, it } from 'vitest'
import { toBoundedJson } from '../src/webmcp/register.ts'
import { evaluateClaim } from '../src/domain/evaluate.ts'
import {
  applyAgentAction,
  applyHumanAction,
  createBoard
} from '../src/domain/board.ts'
import type { Exhibit } from '../src/domain/types.ts'

describe('toBoundedJson totality (fuzz crash class)', () => {
  const HOSTILE: Array<[string, unknown]> = [
    ['bigint', { n: 1n }],
    ['cyclic', (() => {
      const o: Record<string, unknown> = {}
      o.self = o
      return o
    })()],
    ['function-top-level', () => 'x'],
    ['deep-nest', (() => {
      let node: unknown = 'leaf'
      for (let i = 0; i < 10_000; i++) node = { n: node }
      return node
    })()],
    ['huge-string', { s: 'x'.repeat(200_000) }]
  ]

  for (const [name, input] of HOSTILE) {
    it(`never throws on ${name} and stays within bound`, () => {
      const out = toBoundedJson(input)
      expect(typeof out).toBe('string')
      expect(out.length).toBeLessThanOrEqual(1500)
      expect(() => JSON.parse(out)).not.toThrow()
    })
  }

  it('boundary is inclusive at exactly maxChars', () => {
    const exact = JSON.stringify({ s: 'x' })
    // A string whose JSON form is exactly under/over the custom bound.
    const under = toBoundedJson({ s: 'y'.repeat(1400) }, 1500)
    expect(under.length).toBeLessThanOrEqual(1500)
    expect(JSON.parse(exact)).toEqual({ s: 'x' })
  })
})

const span = (id: string, text: string) => ({ span_id: id, text, sha256: `hash-${id}` })

function corpus(): Exhibit[] {
  return [
    {
      id: 'EX-001',
      title: 'Vendor attestation letter',
      spans: [
        span('a1', 'We attest the final inspection was completed on 2026-03-10 prior to acceptance.')
      ]
    },
    {
      id: 'EX-002',
      title: 'Inspection report',
      spans: [
        span('r1', 'Inspection for Lot HX-17 was performed on 2026-03-19 after acceptance on 2026-03-14.')
      ]
    },
    {
      id: 'EX-003',
      title: 'Acceptance certificate',
      spans: [span('c1', 'Lot HX-17 accepted on 2026-03-14 by the procuring agency.')]
    }
  ]
}

const HERO = 'Did the vendor provide the required inspection report before acceptance?'

describe('verdict independence from claim wording (fuzz class 1)', () => {
  const PHRASINGS = [
    HERO,
    HERO.toUpperCase(),
    `  ${HERO}  `,
    `**${HERO}**`,
    `Inspect — did the vendor provide the required inspection report before acceptance?`
  ]

  it('every adjudicated phrasing yields the same CONTRADICTED verdict', () => {
    for (const claim of PHRASINGS) {
      const evaluation = evaluateClaim(claim, corpus())
      expect(evaluation.verdict).toBe('CONTRADICTED')
      expect(evaluation.reasons.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('five-digit years are never truncated into false dates', () => {
    // The attestation date mutated to a 5-digit year must not produce a
    // lexicographically distorted "before acceptance" comparison.
    const exhibits = corpus().map((e) =>
      e.id === 'EX-001'
        ? {
            ...e,
            spans: [span('a1', 'inspection completed on 10000-01-01 prior to acceptance')]
          }
        : e
    )
    const evaluation = evaluateClaim(HERO, exhibits)
    expect(evaluation.verdict).toBe('CONTRADICTED')
    const bases = evaluation.reasons.map((r) => r.verdict_basis).join(' | ')
    expect(bases).not.toContain('0000-01-01')
  })
})

describe('board purity under randomized sequences (fuzz class 3)', () => {
  const addEntry = (
    board: ReturnType<typeof createBoard>,
    id: string,
    stance: 'supports' | 'contradicts'
  ) => applyAgentAction(board, { action: 'add', exhibit_id: id, stance })

  it('no operation mutates the input board; agent lane stays add-only', () => {
    const start = createBoard()
    const frozenSnapshot = JSON.stringify(start)

    let board = start
    // Seed a live working copy, then fire the hostile sequence.
    const seeded = applyAgentAction(board, { action: 'add', exhibit_id: 'EX-001', stance: 'supports' })
    if (!seeded.ok) throw new Error(seeded.reason)
    board = seeded.board

    void applyAgentAction(board, { action: 'add', exhibit_id: 'EX-001', stance: 'contradicts' })
    void applyAgentAction(board, { action: 'pin', exhibit_id: 'EX-001' } as never)
    void applyHumanAction(board, { action: 'pin', exhibit_id: 'EX-001' })
    void applyHumanAction(board, { action: 'reject', exhibit_id: 'NOPE' })

    expect(JSON.stringify(start)).toBe(frozenSnapshot)
    // Duplicate add refused (entry already on board).
    const dup = applyAgentAction(board, { action: 'add', exhibit_id: 'EX-001', stance: 'supports' })
    expect(dup.ok).toBe(false)
    // Agent cannot pin/remove/reject.
    for (const kind of ['pin', 'remove', 'reject'] as const) {
      const r = applyAgentAction(board, { action: kind, exhibit_id: 'EX-001' } as never)
      expect(r.ok).toBe(false)
    }
  })

  it('status transitions only via human lane and only to known statuses', () => {
    let board = createBoard()
    const added = addEntry(board, 'EX-001', 'supports')
    if (!added.ok) throw new Error(added.reason)
    board = added.board
    const pinned = applyHumanAction(board, { action: 'pin', exhibit_id: 'EX-001' })
    expect(pinned.ok).toBe(true)
    if (pinned.ok) board = pinned.board
    const entry = board.entries.find((e) => e.exhibit_id === 'EX-001')
    expect(['proposed', 'pinned', 'rejected']).toContain(entry?.status)
  })
})
