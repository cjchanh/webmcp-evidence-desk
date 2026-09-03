/**
 * Real execution bridge: successful WebMCP calls must be observable in the UI
 * without changing their bounded output contract or weakening human controls.
 */

import { describe, expect, it } from 'vitest'
import { fixtureExhibits, HERO_CLAIM } from '../helpers/fixtures.ts'
import { makeToolContext } from '../helpers/mocks.ts'
import {
  TOOL_NAMES,
  buildToolDefs,
  type ToolLifecycleEvent
} from '../../src/webmcp/register.ts'
import type { ClaimEvaluation } from '../../src/domain/types.ts'

const exhibits = fixtureExhibits()

describe('real WebMCP execution bridge', () => {
  it('emits visible start and completion events for every successful tool call', async () => {
    const app = makeToolContext(exhibits)
    const events: ToolLifecycleEvent[] = []
    const defs = buildToolDefs({
      ...app.ctx,
      onLifecycle: (event) => events.push(event)
    })
    const inputs: Record<string, unknown> = {
      search_evidence: { query: 'inspection report' },
      inspect_exhibit: { exhibit_id: 'EX-001' },
      evaluate_claim: { claim: HERO_CLAIM },
      update_caseboard: {
        action: 'add',
        exhibit_id: 'EX-002',
        stance: 'contradicts'
      }
    }

    for (const def of defs) await def.execute(inputs[def.name])

    expect(events.map(({ toolName, phase }) => `${toolName}:${phase}`)).toEqual(
      TOOL_NAMES.flatMap((name) => [`${name}:started`, `${name}:completed`])
    )
    expect(events.every((event) => event.summary.length > 0)).toBe(true)
    expect(events.at(-1)?.summary).toContain('EX-002')
  })

  it('applies a real evaluate_claim result through the visible verdict callback', async () => {
    const app = makeToolContext(exhibits)
    const applied: ClaimEvaluation[] = []
    const evaluate = buildToolDefs({
      ...app.ctx,
      onVerdict: (evaluation) => applied.push(evaluation)
    }).find((tool) => tool.name === 'evaluate_claim')!

    const output = JSON.parse(await evaluate.execute({ claim: HERO_CLAIM })) as ClaimEvaluation

    expect(output.verdict).toBe('CONTRADICTED')
    expect(applied).toEqual([output])
  })

  it('reports forbidden agent actions as refused and leaves the board unchanged', async () => {
    const app = makeToolContext(exhibits)
    const events: ToolLifecycleEvent[] = []
    const update = buildToolDefs({
      ...app.ctx,
      onLifecycle: (event) => events.push(event)
    }).find((tool) => tool.name === 'update_caseboard')!

    await expect(
      update.execute({ action: 'seal', exhibit_id: 'EX-001', stance: 'supports' })
    ).rejects.toThrow(/human-exclusive control/)

    expect(app.board().entries).toEqual([])
    expect(events.map((event) => event.phase)).toEqual(['started', 'refused'])
    expect(events.at(-1)?.summary).toContain('human-exclusive')
  })

  it('labels an unknown exhibit_id as refused, not failed', async () => {
    const app = makeToolContext(exhibits)
    const events: ToolLifecycleEvent[] = []
    const inspect = buildToolDefs({
      ...app.ctx,
      onLifecycle: (event) => events.push(event)
    }).find((tool) => tool.name === 'inspect_exhibit')!

    await expect(inspect.execute({ exhibit_id: 'EX-999' })).rejects.toThrow(RangeError)

    expect(events.map((event) => event.phase)).toEqual(['started', 'refused'])
    expect(events.at(-1)?.summary).toContain('refused')
  })

  it('reports aborts and isolates UI callback failures from tool results', async () => {
    const app = makeToolContext(exhibits)
    const events: ToolLifecycleEvent[] = []
    const defs = buildToolDefs({
      ...app.ctx,
      onLifecycle: (event) => {
        events.push(event)
        if (event.phase === 'completed') throw new Error('broken UI listener')
      }
    })
    const search = defs.find((tool) => tool.name === 'search_evidence')!
    const output = await search.execute({ query: 'inspection' })
    expect(JSON.parse(output)).toHaveProperty('results')

    const controller = new AbortController()
    controller.abort()
    const inspect = defs.find((tool) => tool.name === 'inspect_exhibit')!
    await expect(
      inspect.execute({ exhibit_id: 'EX-001' }, { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(events.at(-1)?.phase).toBe('aborted')
  })
})
