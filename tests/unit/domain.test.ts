/**
 * Unit tests: domain functions.
 * Verdict correctness on the deliberate contradiction pair is the flagship case.
 */

import { describe, expect, it } from 'vitest'
import { searchExhibits } from '../../src/domain/search.ts'
import { inspectExhibit } from '../../src/domain/inspect.ts'
import { evaluateClaim } from '../../src/domain/evaluate.ts'
import {
  applyAgentAction,
  applyHumanAction,
  createBoard,
  type ActionResult
} from '../../src/domain/board.ts'
import { parseExhibitSource } from '../../src/domain/exhibitParse.ts'
import { fixtureExhibits, HERO_CLAIM } from '../helpers/fixtures.ts'

/** Narrow a refused ActionResult so `.reason` is type-safe under strict mode. */
function refusalReason(result: ActionResult): string {
  if (result.ok) throw new Error('expected action to be refused')
  return result.reason
}

describe('searchExhibits', () => {
  const exhibits = fixtureExhibits()

  it('ranks matching exhibits and returns bounded results with snippets', () => {
    const results = searchExhibits('inspection report', exhibits)
    expect(results.length).toBeGreaterThan(0)
    expect(results.length).toBeLessThanOrEqual(4)
    expect(results[0]?.exhibit_id).toBe('EX-002')
    for (const r of results) {
      expect(r.snippet.length).toBeLessThanOrEqual(141)
      expect(typeof r.score).toBe('number')
    }
  })

  it('title matches outrank body-only matches', () => {
    const results = searchExhibits('attestation', exhibits)
    expect(results[0]?.exhibit_id).toBe('EX-001')
  })

  it('returns empty array when nothing matches', () => {
    expect(searchExhibits('zeppelin', exhibits)).toEqual([])
  })

  it('rejects empty queries', () => {
    expect(() => searchExhibits('', exhibits)).toThrow(TypeError)
    expect(() => searchExhibits('!!!', exhibits)).toThrow(TypeError)
  })
})

describe('inspectExhibit', () => {
  const exhibits = fixtureExhibits()

  it('returns full spans with hashes', () => {
    const detail = inspectExhibit('EX-002', exhibits)
    expect(detail.exhibit_id).toBe('EX-002')
    expect(detail.spans[0]?.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(detail.spans[0]?.text).toContain('2026-03-19')
  })

  it('throws on unknown exhibit id', () => {
    expect(() => inspectExhibit('NOPE', exhibits)).toThrow(RangeError)
  })
})

describe('evaluateClaim — verdict correctness', () => {
  it('CONTRADICTED on the contradiction pair (report after acceptance vs attestation before)', () => {
    const evaluation = evaluateClaim(HERO_CLAIM, fixtureExhibits())
    expect(evaluation.verdict).toBe('CONTRADICTED')
    expect(evaluation.missing).toEqual([])
    // Both sides of the contradiction must be surfaced as span-tied reasons.
    const bases = evaluation.reasons.map((r) => r.verdict_basis)
    expect(bases.some((b) => b.includes('2026-03-19') && b.includes('AFTER'))).toBe(true)
    expect(bases.some((b) => b.includes('2026-03-10') && b.includes('BEFORE'))).toBe(true)
    for (const reason of evaluation.reasons) {
      expect(reason.span_id).toMatch(/^EX-\d{3}-\d$/)
      expect(reason.exhibit_id).toMatch(/^EX-\d{3}$/)
    }
  })

  it('SUPPORTED when the report predates acceptance', () => {
    const exhibits = fixtureExhibits().map((e) => {
      if (e.id !== 'EX-002') return e
      return {
        ...e,
        spans: [
          {
            span_id: 'EX-002-1',
            text: 'All checks were performed on 2026-03-12 at the Meridian Fab 2 facility.',
            sha256: e.spans[0]!.sha256
          }
        ]
      }
    })
    const evaluation = evaluateClaim(HERO_CLAIM, exhibits)
    expect(evaluation.verdict).toBe('SUPPORTED')
    expect(evaluation.reasons[0]?.span_id).toBe('EX-002-1')
  })

  it('INSUFFICIENT with no relevant evidence, naming missing document types', () => {
    const evaluation = evaluateClaim(HERO_CLAIM, [])
    expect(evaluation.verdict).toBe('INSUFFICIENT')
    expect(evaluation.missing).toContain('inspection report')
    expect(evaluation.missing).toContain('acceptance certificate')
    expect(evaluation.reasons).toEqual([])
  })

  it('INSUFFICIENT when only the self-serving attestation exists', () => {
    const onlyAttestation = fixtureExhibits().filter((e) => e.id === 'EX-001')
    const evaluation = evaluateClaim(HERO_CLAIM, onlyAttestation)
    expect(evaluation.verdict).toBe('INSUFFICIENT')
    expect(evaluation.missing).toContain('independent inspection report')
  })

  it('INSUFFICIENT for unrelated claims, naming the absent document class', () => {
    const evaluation = evaluateClaim('Was the vendor pricing fair?', fixtureExhibits())
    expect(evaluation.verdict).toBe('INSUFFICIENT')
    expect(evaluation.missing).toContain('pricing or invoice records')
  })

  it('rejects empty claims', () => {
    expect(() => evaluateClaim('', fixtureExhibits())).toThrow(TypeError)
  })

  it('F1: acceptance anchor never falls back to a register date in another sentence', () => {
    const exhibits = [
      {
        id: 'EX-A',
        title: 'Acceptance Certificate AC-1',
        spans: [
          { span_id: 'EX-A-1', text: 'The customer accepted Lot HX-17 into service following receiving verification at Dock 4.', sha256: 'x' },
          { span_id: 'EX-A-2', text: 'Certificate recorded in the acceptance register on 2026-03-16.', sha256: 'x' }
        ]
      },
      {
        id: 'EX-B',
        title: 'Inspection Report IR-1',
        spans: [
          { span_id: 'EX-B-1', text: 'All checks were performed on 2026-03-15 at the facility.', sha256: 'x' }
        ]
      }
    ]
    const evaluation = evaluateClaim(HERO_CLAIM, exhibits)
    // No date in the "accepted" sentence -> abstain, never anchor on 03-16.
    expect(evaluation.verdict).toBe('INSUFFICIENT')
    expect(evaluation.missing).toContain('dated acceptance certificate')
  })

  it('F2: report anchor never falls back to a release date in another sentence', () => {
    const exhibits = [
      {
        id: 'EX-C',
        title: 'Acceptance Certificate AC-2',
        spans: [
          { span_id: 'EX-C-1', text: 'The customer accepted Lot HX-17 into service on 2026-03-14.', sha256: 'x' }
        ]
      },
      {
        id: 'EX-D',
        title: 'Inspection Report IR-2',
        spans: [
          { span_id: 'EX-D-1', text: 'All electrical continuity checks were performed at the Meridian Fab 2 facility.', sha256: 'x' },
          { span_id: 'EX-D-2', text: 'Report approved and released by Quality Manager on 2026-03-20.', sha256: 'x' }
        ]
      }
    ]
    const evaluation = evaluateClaim(HERO_CLAIM, exhibits)
    // No date in the "performed" sentence -> abstain, never anchor on 03-20.
    expect(evaluation.verdict).toBe('INSUFFICIENT')
    expect(evaluation.missing).toContain('dated inspection report')
  })

  it('F3: a revised report dated after acceptance contradicts even when an earlier report predates it', () => {
    const exhibits = [
      {
        id: 'EX-E',
        title: 'Acceptance Certificate AC-3',
        spans: [
          { span_id: 'EX-E-1', text: 'The customer accepted Lot HX-17 into service on 2026-03-14.', sha256: 'x' }
        ]
      },
      {
        id: 'EX-F',
        title: 'Inspection Report IR-3',
        spans: [
          { span_id: 'EX-F-1', text: 'All checks were performed on 2026-03-10 at the facility.', sha256: 'x' }
        ]
      },
      {
        id: 'EX-G',
        title: 'Inspection Report IR-4 REV B',
        spans: [
          { span_id: 'EX-G-1', text: 'Revised inspection record: all checks were performed on 2026-03-19 at the facility.', sha256: 'x' }
        ]
      }
    ]
    const evaluation = evaluateClaim(HERO_CLAIM, exhibits)
    expect(evaluation.verdict).toBe('CONTRADICTED')
    const bases = evaluation.reasons.map((r) => r.verdict_basis)
    expect(bases.some((b) => b.includes('2026-03-19') && b.includes('AFTER'))).toBe(true)
    expect(evaluation.reasons.some((r) => r.exhibit_id === 'EX-G')).toBe(true)
  })

  it('multiple reports all predating acceptance -> SUPPORTED on the latest', () => {
    const exhibits = [
      {
        id: 'EX-H',
        title: 'Acceptance Certificate AC-4',
        spans: [
          { span_id: 'EX-H-1', text: 'The customer accepted Lot HX-17 into service on 2026-03-14.', sha256: 'x' }
        ]
      },
      {
        id: 'EX-I',
        title: 'Inspection Report IR-5',
        spans: [
          { span_id: 'EX-I-1', text: 'All checks were performed on 2026-03-10 at the facility.', sha256: 'x' }
        ]
      },
      {
        id: 'EX-J',
        title: 'Inspection Report IR-6',
        spans: [
          { span_id: 'EX-J-1', text: 'All checks were performed on 2026-03-12 at the facility.', sha256: 'x' }
        ]
      }
    ]
    const evaluation = evaluateClaim(HERO_CLAIM, exhibits)
    expect(evaluation.verdict).toBe('SUPPORTED')
    expect(evaluation.reasons[0]?.verdict_basis).toContain('2026-03-12')
  })

  it('calendar-invalid dates never anchor a confident verdict', () => {
    const badAcceptance = [
      {
        id: 'EX-K',
        title: 'Acceptance Certificate AC-5',
        spans: [
          { span_id: 'EX-K-1', text: 'The customer accepted Lot HX-17 into service on 2026-99-99.', sha256: 'x' }
        ]
      },
      {
        id: 'EX-L',
        title: 'Inspection Report IR-7',
        spans: [
          { span_id: 'EX-L-1', text: 'All checks were performed on 2026-03-19 at the facility.', sha256: 'x' }
        ]
      }
    ]
    const badAcceptanceEval = evaluateClaim(HERO_CLAIM, badAcceptance)
    expect(badAcceptanceEval.verdict).toBe('INSUFFICIENT')
    expect(badAcceptanceEval.missing).toContain('dated acceptance certificate')

    const badReport = [
      {
        id: 'EX-M',
        title: 'Acceptance Certificate AC-6',
        spans: [
          { span_id: 'EX-M-1', text: 'The customer accepted Lot HX-17 into service on 2026-03-14.', sha256: 'x' }
        ]
      },
      {
        id: 'EX-N',
        title: 'Inspection Report IR-8',
        spans: [
          { span_id: 'EX-N-1', text: 'All checks were performed on 2026-99-99 at the facility.', sha256: 'x' }
        ]
      }
    ]
    const badReportEval = evaluateClaim(HERO_CLAIM, badReport)
    expect(badReportEval.verdict).toBe('INSUFFICIENT')
    expect(badReportEval.missing).toContain('dated inspection report')
  })
})

describe('board ops — agentAddOnly enforcement', () => {
  it('agent may add with a stance; entry is proposed + agent-origin', () => {
    let board = createBoard()
    const result = applyAgentAction(board, {
      action: 'add',
      exhibit_id: 'EX-002',
      stance: 'contradicts'
    })
    expect(result.ok).toBe(true)
    board = result.ok ? result.board : board
    expect(board.entries).toHaveLength(1)
    expect(board.entries[0]).toMatchObject({
      exhibit_id: 'EX-002',
      stance: 'contradicts',
      origin: 'agent',
      status: 'proposed'
    })
  })

  it('agent pin/remove/reject/seal are refused at the domain layer', () => {
    const board = createBoard()
    for (const action of ['pin', 'remove', 'reject', 'seal'] as const) {
      const result = applyAgentAction(board, { action, exhibit_id: 'EX-001' })
      expect(result.ok).toBe(false)
      expect(refusalReason(result)).toBe(`human_exclusive_action:${action}`)
      expect(result.board.entries).toHaveLength(0)
    }
  })

  it('duplicate adds are refused', () => {
    let board = createBoard()
    const first = applyAgentAction(board, {
      action: 'add',
      exhibit_id: 'EX-001',
      stance: 'supports'
    })
    board = first.ok ? first.board : board
    const second = applyAgentAction(board, {
      action: 'add',
      exhibit_id: 'EX-001',
      stance: 'supports'
    })
    expect(second.ok).toBe(false)
    expect(refusalReason(second)).toBe('duplicate_entry')
  })

  it('invalid stance refused', () => {
    const result = applyAgentAction(createBoard(), {
      action: 'add',
      exhibit_id: 'EX-001',
      stance: 'neutral' as never
    })
    expect(result.ok).toBe(false)
    expect(refusalReason(result)).toBe('invalid_stance')
  })

  it('human may pin then reject then remove', () => {
    let board = createBoard()
    const added = applyAgentAction(board, {
      action: 'add',
      exhibit_id: 'EX-001',
      stance: 'supports'
    })
    board = added.ok ? added.board : board

    const pinned = applyHumanAction(board, { action: 'pin', exhibit_id: 'EX-001' })
    expect(pinned.ok).toBe(true)
    board = pinned.ok ? pinned.board : board
    expect(board.entries[0]?.status).toBe('pinned')

    const rejected = applyHumanAction(board, { action: 'reject', exhibit_id: 'EX-001' })
    board = rejected.ok ? rejected.board : board
    expect(board.entries[0]?.status).toBe('rejected')

    const removed = applyHumanAction(board, { action: 'remove', exhibit_id: 'EX-001' })
    board = removed.ok ? removed.board : board
    expect(board.entries).toHaveLength(0)
  })

  it('human actions on unknown entries are refused', () => {
    const result = applyHumanAction(createBoard(), {
      action: 'pin',
      exhibit_id: 'EX-999'
    })
    expect(result.ok).toBe(false)
    expect(refusalReason(result)).toBe('unknown_entry')
  })
})

describe('corpus parser', () => {
  it('parses the real corpus format round-trip', () => {
    const parsed = parseExhibitSource(
      [
        'EXHIBIT: EX-042',
        'TITLE: Test Exhibit',
        '[SPAN EX-042-1]',
        'first span text',
        '',
        '[SPAN EX-042-2]',
        'second span text'
      ].join('\n')
    )
    expect(parsed.id).toBe('EX-042')
    expect(parsed.title).toBe('Test Exhibit')
    expect(parsed.spans).toHaveLength(2)
    expect(parsed.spans[1]?.text).toBe('second span text')
  })

  it('fails closed on malformed sources', () => {
    expect(() => parseExhibitSource('TITLE: no exhibit header')).toThrow()
    expect(() => parseExhibitSource('EXHIBIT: EX-001\nTITLE: X')).toThrow()
  })
})
