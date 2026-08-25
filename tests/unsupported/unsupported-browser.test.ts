/**
 * Unsupported-browser path: without document.modelContext the app must remain
 * fully functional. Registration reports unsupported; the simulated lane still
 * completes a full review over identical domain functions.
 */

import { describe, expect, it } from 'vitest'
import { registerEvidenceTools } from '../../src/webmcp/register.ts'
import { runSimulatedAgent } from '../../src/simulated/runSimulatedAgent.ts'
import { verifyManifest } from '../../src/domain/verify.ts'
import { applyAgentAction, createBoard } from '../../src/domain/board.ts'
import {
  fixtureExhibits,
  signFixture,
  HERO_CLAIM
} from '../helpers/fixtures.ts'
import { evaluateClaim } from '../../src/domain/evaluate.ts'

describe('graceful path without WebMCP', () => {
  it('registration is a no-op reporting supported:false', async () => {
    const result = await registerEvidenceTools(undefined, {
      exhibits: () => fixtureExhibits(),
      addToBoard: () => ({ ok: false, board: createBoard(), reason: 'unused' })
    })
    expect(result.supported).toBe(false)
    expect(result.outcomes).toEqual([])
  })

  it('the full review flow still works end to end via domain functions', async () => {
    const { manifest } = signFixture(fixtureExhibits())
    const report = await verifyManifest(manifest)
    expect(report.ok).toBe(true)

    let board = createBoard()
    const logs: string[] = []
    let verdict = ''

    await runSimulatedAgent({
      exhibits: () => report.verified,
      log: (t) => logs.push(t),
      onVerdict: (evaluation) => {
        verdict = evaluation.verdict
      },
      addToBoard: (id, stance) => {
        const result = applyAgentAction(board, {
          action: 'add',
          exhibit_id: id,
          stance
        })
        if (result.ok) board = result.board
        return result
      }
    })

    expect(verdict).toBe('CONTRADICTED')
    expect(board.entries).toHaveLength(2)
    expect(logs.some((l) => l.includes('complete'))).toBe(true)

    // And the claim evaluates identically outside any agent lane.
    expect(evaluateClaim(HERO_CLAIM, report.verified).verdict).toBe('CONTRADICTED')
  })
})
