// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { WebMcpToolDefinition } from '../../src/webmcp/register.ts'
import { HERO_CLAIM } from '../helpers/fixtures.ts'

describe('real WebMCP flow through the live page', () => {
  it('shows all four tools, applies the verdict, preserves human acceptance, then seals', async () => {
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')
    const body = html
      .slice(html.indexOf('<body>') + '<body>'.length, html.indexOf('</body>'))
      .replace(/<script[\s\S]*?<\/script>/g, '')
    document.body.innerHTML = body

    const registered: WebMcpToolDefinition[] = []
    Object.defineProperty(document, 'modelContext', {
      configurable: true,
      value: {
        async registerTool(tool: WebMcpToolDefinition): Promise<void> {
          registered.push(tool)
        }
      }
    })
    Object.defineProperty(window, 'originAgentCluster', {
      configurable: true,
      value: true
    })

    await import('../../src/main.ts')
    await vi.waitFor(() => {
      expect(document.getElementById('webmcp-status')?.textContent).toBe(
        'WEBMCP: ACTIVE (4 TOOLS)'
      )
    })
    expect(registered).toHaveLength(4)

    const byName = Object.fromEntries(registered.map((tool) => [tool.name, tool]))
    await byName.search_evidence!.execute({ query: 'inspection report acceptance' })
    await byName.inspect_exhibit!.execute({ exhibit_id: 'EX-002' })
    await byName.evaluate_claim!.execute({ claim: HERO_CLAIM })
    await byName.update_caseboard!.execute({
      action: 'add',
      exhibit_id: 'EX-001',
      stance: 'supports'
    })
    await byName.update_caseboard!.execute({
      action: 'add',
      exhibit_id: 'EX-002',
      stance: 'contradicts'
    })

    await vi.waitFor(() => {
      const log = document.getElementById('tool-log')?.textContent ?? ''
      for (const name of ['search_evidence', 'inspect_exhibit', 'evaluate_claim', 'update_caseboard']) {
        expect(log).toContain(`${name} started`)
        expect(log).toContain(`${name} completed`)
      }
    })
    expect(document.getElementById('verdict-stamp')?.textContent).toBe(
      'VERDICT: CONTRADICTED'
    )
    expect(document.getElementById('review-status')?.textContent).toBe(
      'AGENT ANALYSIS COMPLETE — YOUR DECISION IS REQUIRED'
    )

    const accept = document.getElementById('btn-accept-verdict') as HTMLButtonElement
    expect(accept.disabled).toBe(false)
    ;(document.getElementById('btn-seal-receipt') as HTMLButtonElement).click()
    expect(document.getElementById('seal-status')?.textContent).toBe(
      'SEAL REFUSED — a human must accept the final verdict first.'
    )
    accept.click()
    expect(accept.textContent).toBe('VERDICT ACCEPTED BY HUMAN')
    expect(accept.disabled).toBe(true)

    ;(document.getElementById('btn-seal-receipt') as HTMLButtonElement).click()
    await vi.waitFor(() => {
      expect(document.getElementById('seal-modal-backdrop')?.hidden).toBe(false)
    })
    const summary = document.getElementById('receipt-summary')?.textContent ?? ''
    expect(summary).toContain('Final verdict: CONTRADICTED')
    expect(summary).toContain('Agent proposed 2 exhibits')
    expect(summary).toContain('Human accepted 2')
    expect(summary).toContain('Rejected 0')
    expect(summary).toContain('Evidence integrity: VERIFIED')
  })
})
