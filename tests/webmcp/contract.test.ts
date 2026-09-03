/**
 * Contract tests: tool registration shape, JSON-string outputs, size bounds,
 * untrustedContentHint annotations.
 */

import { describe, expect, it } from 'vitest'
import { fixtureExhibits, HERO_CLAIM } from '../helpers/fixtures.ts'
import { makeMockModelContext, makeToolContext } from '../helpers/mocks.ts'
import {
  MAX_TOOL_OUTPUT_CHARS,
  TOOL_NAMES,
  buildToolDefs,
  registerEvidenceTools,
  toBoundedJson,
  type WebMcpToolDefinition
} from '../../src/webmcp/register.ts'

const exhibits = fixtureExhibits()

async function registeredTools(): Promise<WebMcpToolDefinition[]> {
  const { mc, registered } = makeMockModelContext()
  const app = makeToolContext(exhibits)
  const result = await registerEvidenceTools({ modelContext: mc }, app.ctx)
  expect(result.supported).toBe(true)
  expect(result.outcomes.every((o) => o.ok)).toBe(true)
  return registered
}

describe('registration contract', () => {
  it('registers exactly the four frozen tools', async () => {
    const tools = await registeredTools()
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort())
  })

  it('every tool carries the full definition dictionary', async () => {
    const tools = await registeredTools()
    for (const tool of tools) {
      expect(typeof tool.name).toBe('string')
      expect(tool.name.length).toBeLessThanOrEqual(128)
      expect(tool.name).toMatch(/^[a-z_]+$/)
      expect(typeof tool.title).toBe('string')
      expect(tool.title.length).toBeGreaterThan(0)
      expect(typeof tool.description).toBe('string')
      expect(tool.description.length).toBeGreaterThan(0)
      expect(tool.inputSchema.type).toBe('object')
      expect(typeof tool.execute).toBe('function')
      expect(typeof tool.annotations).toBe('object')
    }
  })

  it('tools returning corpus-derived text set untrustedContentHint', async () => {
    const tools = await registeredTools()
    for (const tool of tools) {
      // All four surface corpus-derived strings (snippets, spans, reasons, titles).
      expect(tool.annotations.untrustedContentHint).toBe(true)
    }
  })
})

describe('output contract — plain bounded JSON strings', () => {
  it.each(TOOL_NAMES)('%s output parses as JSON and stays under the size bound', async (name) => {
    const tools = await registeredTools()
    const tool = tools.find((t) => t.name === name)
    expect(tool).toBeDefined()

    const inputs: Record<string, unknown> = {
      search_evidence: { query: 'inspection report' },
      inspect_exhibit: { exhibit_id: 'EX-002' },
      evaluate_claim: { claim: HERO_CLAIM },
      update_caseboard: { action: 'add', exhibit_id: 'EX-002', stance: 'contradicts' }
    }

    const output = await tool!.execute(inputs[name])
    expect(typeof output).toBe('string')
    expect(output.length).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_CHARS)
    const parsed = JSON.parse(output) as Record<string, unknown>
    expect(parsed).toBeTypeOf('object')
  })

  it('search_evidence returns ranked results with the frozen shape', async () => {
    const tools = await registeredTools()
    const search = tools.find((t) => t.name === 'search_evidence')!
    const parsed = JSON.parse(await search.execute({ query: 'inspection' })) as {
      results: Array<{ exhibit_id: string; title: string; snippet: string; score: number }>
    }
    expect(parsed.results.length).toBeGreaterThan(0)
    for (const r of parsed.results) {
      expect(Object.keys(r).sort()).toEqual(['exhibit_id', 'score', 'snippet', 'title'])
    }
  })

  it('inspect_exhibit returns spans carrying build-time hashes', async () => {
    const tools = await registeredTools()
    const inspect = tools.find((t) => t.name === 'inspect_exhibit')!
    const parsed = JSON.parse(await inspect.execute({ exhibit_id: 'EX-001' })) as {
      exhibit_id: string
      title: string
      spans: Array<{ span_id: string; text: string; hash: string }>
    }
    expect(parsed.exhibit_id).toBe('EX-001')
    expect(parsed.spans[0]?.hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('evaluate_claim returns CONTRADICTED with span-tied reasons on the fixture pair', async () => {
    const tools = await registeredTools()
    const evaluate = tools.find((t) => t.name === 'evaluate_claim')!
    const parsed = JSON.parse(await evaluate.execute({ claim: HERO_CLAIM })) as {
      verdict: string
      reasons: Array<{ verdict_basis: string; span_id: string; exhibit_id: string }>
      missing: string[]
    }
    expect(parsed.verdict).toBe('CONTRADICTED')
    expect(parsed.reasons.length).toBeGreaterThanOrEqual(2)
    expect(parsed.missing).toEqual([])
  })

  it('update_caseboard adds only and reports updated board state', async () => {
    const app = makeToolContext(exhibits)
    const defs = buildToolDefs(app.ctx)
    const add = defs.find((t) => t.name === 'update_caseboard')!
    const parsed = JSON.parse(
      await add.execute({ action: 'add', exhibit_id: 'EX-001', stance: 'supports' })
    ) as { added: boolean; board: { count: number; entries: unknown[] } }
    expect(parsed.added).toBe(true)
    expect(parsed.board.count).toBe(1)

    const dup = JSON.parse(
      await add.execute({ action: 'add', exhibit_id: 'EX-001', stance: 'supports' })
    ) as { added: boolean; reason?: string }
    expect(dup.added).toBe(false)
    expect(dup.reason).toBe('duplicate_entry')
  })

  it('toBoundedJson hard-caps pathological outputs at the limit', () => {
    const giant = {
      results: Array.from({ length: 500 }, (_, i) => ({
        exhibit_id: `EX-${String(i).padStart(4, '0')}`,
        snippet: 'x'.repeat(400)
      }))
    }
    const out = toBoundedJson(giant)
    expect(out.length).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_CHARS)
    expect(() => JSON.parse(out)).not.toThrow()
  })

  it('discloses when a many-report evaluation is shortened to fit the tool limit', async () => {
    const manyReports = [
      {
        id: 'EX-ACCEPT',
        title: 'Acceptance Certificate AC-MANY',
        spans: [
          {
            span_id: 'EX-ACCEPT-1',
            text: 'The customer accepted Lot HX-17 on 2026-03-14.',
            sha256: 'a'.repeat(64)
          }
        ]
      },
      ...Array.from({ length: 19 }, (_, index) => ({
        id: `EX-REPORT-${index + 1}`,
        title: `Inspection Report IR-MANY-${index + 1}`,
        spans: [
          {
            span_id: `EX-REPORT-${index + 1}-1`,
            text: `All electrical continuity checks were performed on 2026-03-${String(15 + (index % 10)).padStart(2, '0')} at the Meridian facility.`,
            sha256: String(index).padStart(64, '0')
          }
        ]
      }))
    ]
    const evaluate = buildToolDefs(makeToolContext(manyReports).ctx).find(
      (tool) => tool.name === 'evaluate_claim'
    )!

    const output = await evaluate.execute({ claim: HERO_CLAIM })
    const parsed = JSON.parse(output) as {
      verdict: string
      reasons: unknown[]
      truncated?: boolean
      truncation_note?: string
    }

    expect(output.length).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_CHARS)
    expect(parsed.verdict).toBe('CONTRADICTED')
    expect(parsed.reasons.length).toBeLessThan(19)
    expect(parsed.truncated).toBe(true)
    expect(parsed.truncation_note).toContain('arrays were shortened')
  })

  it('toBoundedJson never exceeds the bound even without arrays to shrink', () => {
    const blob = { text: 'y'.repeat(10_000) }
    const out = toBoundedJson(blob)
    expect(out.length).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_CHARS)
  })
})

describe('duplicate registration', () => {
  it('second registration attempt rejects cleanly per tool without throwing', async () => {
    const app = makeToolContext(exhibits)
    const first = await registerEvidenceTools(
      { modelContext: makeMockModelContext().mc },
      app.ctx
    )
    expect(first.outcomes.every((o) => o.ok)).toBe(true)

    // Simulate re-registration against a context that already holds the names.
    const { mc } = makeMockModelContext({
      search_evidence: 'InvalidStateError',
      inspect_exhibit: 'InvalidStateError',
      evaluate_claim: 'InvalidStateError',
      update_caseboard: 'InvalidStateError'
    })
    const second = await registerEvidenceTools({ modelContext: mc }, app.ctx)
    expect(second.supported).toBe(true)
    expect(second.outcomes).toHaveLength(4)
    for (const outcome of second.outcomes) {
      expect(outcome.ok).toBe(false)
      expect(outcome.errorKind).toBe('duplicate')
    }
  })

  it('partial failure isolates to the failing tool', async () => {
    const { mc } = makeMockModelContext({ evaluate_claim: 'NotAllowedError' })
    const app = makeToolContext(exhibits)
    const result = await registerEvidenceTools({ modelContext: mc }, app.ctx)
    const byName = Object.fromEntries(result.outcomes.map((o) => [o.name, o]))
    expect(byName.search_evidence?.ok).toBe(true)
    expect(byName.inspect_exhibit?.ok).toBe(true)
    expect(byName.update_caseboard?.ok).toBe(true)
    expect(byName.evaluate_claim?.ok).toBe(false)
    expect(byName.evaluate_claim?.errorKind).toBe('permission')
  })
})

describe('unsupported browser', () => {
  it('reports unsupported when modelContext is absent', async () => {
    const app = makeToolContext(exhibits)
    for (const target of [undefined, {}, { modelContext: undefined }, { modelContext: {} }]) {
      const result = await registerEvidenceTools(
        target as { modelContext?: never },
        app.ctx
      )
      expect(result).toEqual({ supported: false, outcomes: [] })
    }
  })
})
