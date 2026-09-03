import type { Verdict } from './types.ts'

export const HUMAN_ACTOR_ROLE = 'local-human-reviewer' as const

export interface PendingHumanDecision {
  status: 'NEEDS APPROVAL'
  actorRole: typeof HUMAN_ACTOR_ROLE
  agentVerdict: Verdict
  proposedAt: string
}

export interface RecordedHumanDecision {
  status: 'APPROVED' | 'CORRECTED' | 'DECLINED'
  actorRole: typeof HUMAN_ACTOR_ROLE
  agentVerdict: Verdict
  finalVerdict: Verdict | null
  rationale: string | null
  proposedAt: string
  decidedAt: string
  waitingMs: number
}

function instant(value: string, label: string): number {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new TypeError(`${label} must be a valid ISO timestamp`)
  return parsed
}

function recordBase(
  pending: PendingHumanDecision,
  decidedAt: string
): Pick<RecordedHumanDecision, 'actorRole' | 'agentVerdict' | 'proposedAt' | 'decidedAt' | 'waitingMs'> {
  const proposed = instant(pending.proposedAt, 'proposedAt')
  const decided = instant(decidedAt, 'decidedAt')
  return {
    actorRole: HUMAN_ACTOR_ROLE,
    agentVerdict: pending.agentVerdict,
    proposedAt: pending.proposedAt,
    decidedAt,
    waitingMs: Math.max(0, decided - proposed)
  }
}

export function createPendingDecision(
  agentVerdict: Verdict,
  proposedAt: string
): PendingHumanDecision {
  instant(proposedAt, 'proposedAt')
  return {
    status: 'NEEDS APPROVAL',
    actorRole: HUMAN_ACTOR_ROLE,
    agentVerdict,
    proposedAt
  }
}

export function approveDecision(
  pending: PendingHumanDecision,
  decidedAt: string
): RecordedHumanDecision {
  return {
    status: 'APPROVED',
    ...recordBase(pending, decidedAt),
    finalVerdict: pending.agentVerdict,
    rationale: null
  }
}

export function correctDecision(
  pending: PendingHumanDecision,
  finalVerdict: Verdict,
  rationale: string,
  decidedAt: string
): RecordedHumanDecision {
  if (finalVerdict === pending.agentVerdict) {
    throw new TypeError('corrected verdict must differ from the agent verdict')
  }
  const cleanRationale = rationale.trim()
  if (!cleanRationale) throw new TypeError('correction rationale is required')
  return {
    status: 'CORRECTED',
    ...recordBase(pending, decidedAt),
    finalVerdict,
    rationale: cleanRationale
  }
}

export function declineDecision(
  pending: PendingHumanDecision,
  decidedAt: string,
  rationale?: string
): RecordedHumanDecision {
  return {
    status: 'DECLINED',
    ...recordBase(pending, decidedAt),
    finalVerdict: null,
    rationale: rationale?.trim() || null
  }
}
