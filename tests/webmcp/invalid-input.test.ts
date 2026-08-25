/**
 * Invalid-input tests: bad tool arguments are rejected cleanly (rejected
 * promise with a TypeError/RangeError), never silently coerced.
 */

import { describe, expect, it } from 'vitest'
import { fixtureExhibits, HERO_CLAIM } from '../helpers/fixtures.ts'
import { makeToolContext } from '../helpers/mocks.ts'
import { buildToolDefs } from '../../src/webmcp/register.ts'

const app = makeToolContext(fixtureExhibits())
const defs = buildToolDefs(app.ctx)

function tool(name: string) {
  const def = defs.find((d) => d.name === name)
  if (!def) throw new Error(`missing tool ${name}`)
  return def
}

describe('search_evidence invalid inputs', () => {
  it('rejects non-object input', async () => {
    await expect(tool('search_evidence').execute('inspection')).rejects.toThrow(TypeError)
    await expect(tool('search_evidence').execute(null)).rejects.toThrow(TypeError)
    await expect(tool('search_evidence').execute([1, 2])).rejects.toThrow(TypeError)
  })

  it('rejects missing or empty query', async () => {
    await expect(tool('search_evidence').execute({})).rejects.toThrow(/query/)
    await expect(tool('search_evidence').execute({ query: '' })).rejects.toThrow(/query/)
    await expect(tool('search_evidence').execute({ query: '   ' })).rejects.toThrow(/query/)
    await expect(tool('search_evidence').execute({ query: 42 })).rejects.toThrow(TypeError)
  })

  it('rejects oversized query', async () => {
    await expect(tool('search_evidence').execute({ query: 'a'.repeat(513) })).rejects.toThrow(
      /exceeds/
    )
  })
})

describe('inspect_exhibit invalid inputs', () => {
  it('rejects missing exhibit_id', async () => {
    await expect(tool('inspect_exhibit').execute({})).rejects.toThrow(/exhibit_id/)
  })

  it('rejects unknown exhibit_id with RangeError', async () => {
    await expect(tool('inspect_exhibit').execute({ exhibit_id: 'EX-999' })).rejects.toThrow(
      RangeError
    )
  })
})

describe('evaluate_claim invalid inputs', () => {
  it('rejects missing or empty claim', async () => {
    await expect(tool('evaluate_claim').execute({})).rejects.toThrow(/claim/)
    await expect(tool('evaluate_claim').execute({ claim: HERO_CLAIM.slice(0, 0) })).rejects.toThrow(
      /claim/
    )
  })

  it('rejects oversized claim', async () => {
    await expect(tool('evaluate_claim').execute({ claim: 'a'.repeat(1001) })).rejects.toThrow(
      /exceeds/
    )
  })
})

describe('update_caseboard invalid inputs', () => {
  it('rejects human-exclusive actions at the tool boundary', async () => {
    for (const action of ['pin', 'remove', 'reject', 'seal']) {
      await expect(
        tool('update_caseboard').execute({ action, exhibit_id: 'EX-001' })
      ).rejects.toThrow(/human-exclusive/)
    }
  })

  it('rejects missing fields and bad stance', async () => {
    await expect(tool('update_caseboard').execute({ action: 'add' })).rejects.toThrow(
      /exhibit_id/
    )
    await expect(
      tool('update_caseboard').execute({ action: 'add', exhibit_id: 'EX-001' })
    ).rejects.toThrow(/stance/)
    await expect(
      tool('update_caseboard').execute({
        action: 'add',
        exhibit_id: 'EX-001',
        stance: 'neutral'
      })
    ).rejects.toThrow(/stance/)
  })

  it('refuses duplicate adds through the result object (not an exception)', async () => {
    const add = tool('update_caseboard')
    await add.execute({ action: 'add', exhibit_id: 'EX-004', stance: 'supports' })
    const out = JSON.parse(
      (await add.execute({ action: 'add', exhibit_id: 'EX-004', stance: 'supports' })) as string
    ) as { added: boolean; reason?: string }
    expect(out.added).toBe(false)
    expect(out.reason).toBe('duplicate_entry')
  })
})
