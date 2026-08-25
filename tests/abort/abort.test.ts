/**
 * Abort tests: AbortSignal threads from the WebMCP execute options through
 * every domain call. Aborted work rejects with AbortError — never partial
 * results.
 */

import { describe, expect, it } from 'vitest'
import { fixtureExhibits, HERO_CLAIM } from '../helpers/fixtures.ts'
import { makeToolContext } from '../helpers/mocks.ts'
import { buildToolDefs } from '../../src/webmcp/register.ts'
import { searchExhibits } from '../../src/domain/search.ts'
import { inspectExhibit } from '../../src/domain/inspect.ts'
import { evaluateClaim } from '../../src/domain/evaluate.ts'
import { applyAgentAction, createBoard } from '../../src/domain/board.ts'
import { verifyManifest } from '../../src/domain/verify.ts'
import { runSimulatedAgent } from '../../src/simulated/runSimulatedAgent.ts'
import { signFixture } from '../helpers/fixtures.ts'

function aborted(): AbortSignal {
  const controller = new AbortController()
  controller.abort()
  return controller.signal
}

describe('domain functions honor an already-aborted signal', () => {
  it('searchExhibits', () => {
    expect(() =>
      searchExhibits('inspection', fixtureExhibits(), { signal: aborted() })
    ).toThrow(/abort/i)
  })

  it('inspectExhibit', () => {
    expect(() =>
      inspectExhibit('EX-001', fixtureExhibits(), { signal: aborted() })
    ).toThrow(/abort/i)
  })

  it('evaluateClaim', () => {
    expect(() =>
      evaluateClaim(HERO_CLAIM, fixtureExhibits(), { signal: aborted() })
    ).toThrow(/abort/i)
  })

  it('applyAgentAction', () => {
    expect(() =>
      applyAgentAction(createBoard(), {
        action: 'add',
        exhibit_id: 'EX-001',
        stance: 'supports'
      }, { signal: aborted() })
    ).toThrow(/abort/i)
  })

  it('verifyManifest (async)', async () => {
    const { manifest } = signFixture(fixtureExhibits())
    await expect(verifyManifest(manifest, { signal: aborted() })).rejects.toThrow(/abort/i)
  })
})

describe('tool execute honors options.signal', () => {
  it('every tool rejects AbortError on a pre-aborted signal', async () => {
    const app = makeToolContext(fixtureExhibits())
    const defs = buildToolDefs(app.ctx)
    const inputs: Record<string, unknown> = {
      search_evidence: { query: 'inspection' },
      inspect_exhibit: { exhibit_id: 'EX-001' },
      evaluate_claim: { claim: HERO_CLAIM },
      update_caseboard: { action: 'add', exhibit_id: 'EX-001', stance: 'supports' }
    }
    for (const def of defs) {
      await expect(def.execute(inputs[def.name], { signal: aborted() })).rejects.toThrow(
        /abort/i
      )
    }
  })

  it('aborted tool call leaves the caseboard untouched', async () => {
    const app = makeToolContext(fixtureExhibits())
    const defs = buildToolDefs(app.ctx)
    const add = defs.find((d) => d.name === 'update_caseboard')!
    await expect(
      add.execute(
        { action: 'add', exhibit_id: 'EX-001', stance: 'supports' },
        { signal: aborted() }
      )
    ).rejects.toThrow(/abort/i)
    expect(app.board().entries).toHaveLength(0)
  })

  it('AbortError carries the right name for client dispatchers', async () => {
    const app = makeToolContext(fixtureExhibits())
    const defs = buildToolDefs(app.ctx)
    const search = defs.find((d) => d.name === 'search_evidence')!
    await expect(
      search.execute({ query: 'x' }, { signal: aborted() })
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('simulated agent aborts mid-flight', () => {
  it('rejects when the controller fires during the review sequence', async () => {
    const controller = new AbortController()
    const logs: string[] = []
    const run = runSimulatedAgent(
      {
        exhibits: () => fixtureExhibits(),
        log: (t) => logs.push(t),
        onVerdict: () => {},
        addToBoard: () => ({ ok: true, board: { entries: [] }, message: '' })
      },
      { signal: controller.signal }
    )
    setTimeout(() => controller.abort(), 20)
    await expect(run).rejects.toMatchObject({ name: 'AbortError' })
    // It never reported completion.
    expect(logs.some((l) => l.includes('complete'))).toBe(false)
  })
})
