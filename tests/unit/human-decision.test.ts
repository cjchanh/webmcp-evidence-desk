import { describe, expect, it } from 'vitest'

import {
  approveDecision,
  correctDecision,
  createPendingDecision,
  declineDecision
} from '../../src/domain/decision.ts'

describe('human decision boundary', () => {
  const proposedAt = '2026-09-03T12:00:00.000Z'
  const decidedAt = '2026-09-03T12:00:04.250Z'

  it('records approval without rewriting the agent verdict', () => {
    const decision = approveDecision(
      createPendingDecision('CONTRADICTED', proposedAt),
      decidedAt
    )

    expect(decision).toEqual({
      status: 'APPROVED',
      actorRole: 'local-human-reviewer',
      agentVerdict: 'CONTRADICTED',
      finalVerdict: 'CONTRADICTED',
      rationale: null,
      proposedAt,
      decidedAt,
      waitingMs: 4250
    })
  })

  it('records a correction only when verdict and rationale both change meaning', () => {
    const pending = createPendingDecision('CONTRADICTED', proposedAt)
    const decision = correctDecision(
      pending,
      'SUPPORTED',
      'The signed exception authorizes post-acceptance inspection.',
      decidedAt
    )

    expect(decision.status).toBe('CORRECTED')
    expect(decision.agentVerdict).toBe('CONTRADICTED')
    expect(decision.finalVerdict).toBe('SUPPORTED')
    expect(decision.rationale).toContain('signed exception')
    expect(() => correctDecision(pending, 'CONTRADICTED', 'unchanged', decidedAt)).toThrow(
      /must differ/i
    )
    expect(() => correctDecision(pending, 'SUPPORTED', '   ', decidedAt)).toThrow(
      /rationale/i
    )
  })

  it('records a declined proposal as a sealable human outcome', () => {
    const decision = declineDecision(
      createPendingDecision('INSUFFICIENT', proposedAt),
      decidedAt
    )

    expect(decision.status).toBe('DECLINED')
    expect(decision.agentVerdict).toBe('INSUFFICIENT')
    expect(decision.finalVerdict).toBeNull()
    expect(decision.waitingMs).toBe(4250)
  })
})
