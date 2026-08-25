/**
 * Caseboard operations.
 *
 * HARD RULE: agents may only ADD entries. Pin / remove / reject / seal are
 * human-exclusive controls and are refused here at the domain layer, not just
 * in the UI. Pure functions — every mutation returns a new BoardState.
 */

import { throwIfAborted } from './errors.ts'
import type { AgentAction, BoardEntry, BoardState, HumanAction } from './types.ts'

export type ActionResult =
  | { ok: true; board: BoardState; message: string }
  | { ok: false; board: BoardState; reason: string }

export function createBoard(): BoardState {
  return { entries: [] }
}

/** Agent lane. Only `{action:'add'}` passes; everything else is human-exclusive. */
export function applyAgentAction(
  board: BoardState,
  action: AgentAction,
  opts?: { signal?: AbortSignal }
): ActionResult {
  throwIfAborted(opts?.signal)

  if (!action || typeof action !== 'object' || typeof action.action !== 'string') {
    return { ok: false, board, reason: 'invalid_action' }
  }

  if (action.action !== 'add') {
    return {
      ok: false,
      board,
      reason: `human_exclusive_action:${action.action}`
    }
  }

  const { exhibit_id, stance } = action
  if (typeof exhibit_id !== 'string' || exhibit_id.trim().length === 0) {
    return { ok: false, board, reason: 'invalid_exhibit_id' }
  }
  if (stance !== 'supports' && stance !== 'contradicts') {
    return { ok: false, board, reason: 'invalid_stance' }
  }
  if (board.entries.some((e) => e.exhibit_id === exhibit_id)) {
    return { ok: false, board, reason: 'duplicate_entry' }
  }

  const entry: BoardEntry = {
    exhibit_id,
    stance,
    origin: 'agent',
    status: 'proposed'
  }
  return {
    ok: true,
    board: { entries: [...board.entries, entry] },
    message: `agent added ${exhibit_id} (${stance})`
  }
}

/** Human lane. Pin / remove / reject operate on existing entries. */
export function applyHumanAction(
  board: BoardState,
  action: HumanAction,
  opts?: { signal?: AbortSignal }
): ActionResult {
  throwIfAborted(opts?.signal)

  const { action: kind, exhibit_id } = action
  if (
    (kind !== 'pin' && kind !== 'remove' && kind !== 'reject') ||
    typeof exhibit_id !== 'string'
  ) {
    return { ok: false, board, reason: 'invalid_human_action' }
  }

  const existing = board.entries.find((e) => e.exhibit_id === exhibit_id)
  if (!existing) {
    return { ok: false, board, reason: 'unknown_entry' }
  }

  if (kind === 'remove') {
    return {
      ok: true,
      board: { entries: board.entries.filter((e) => e.exhibit_id !== exhibit_id) },
      message: `removed ${exhibit_id}`
    }
  }

  const status = kind === 'pin' ? 'pinned' : 'rejected'
  return {
    ok: true,
    board: {
      entries: board.entries.map((e) =>
        e.exhibit_id === exhibit_id ? { ...e, status } : e
      )
    },
    message: `${kind}ned ${exhibit_id}`.replace('rejectned', 'rejected')
  }
}

/** Compact summary used by tool output and the receipt. */
export function boardSummary(board: BoardState): {
  count: number
  entries: Array<{ exhibit_id: string; stance: string; origin: string; status: string }>
} {
  return {
    count: board.entries.length,
    entries: board.entries.map((e) => ({
      exhibit_id: e.exhibit_id,
      stance: e.stance,
      origin: e.origin,
      status: e.status
    }))
  }
}
