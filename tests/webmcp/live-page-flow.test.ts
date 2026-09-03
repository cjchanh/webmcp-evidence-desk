// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { WebMcpToolDefinition } from '../../src/webmcp/register.ts'
import { HERO_CLAIM } from '../helpers/fixtures.ts'

describe('real WebMCP flow through the live page', () => {
  it('shows all four tools, preserves the agent verdict, records a human correction, then seals', async () => {
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
    expect(document.getElementById('review-status')?.textContent).toBe('NEEDS APPROVAL')
    expect(document.getElementById('review-status-detail')?.textContent).toContain(
      'Agent analysis complete. Your decision is required.'
    )

    const approve = document.getElementById('btn-approve-verdict') as HTMLButtonElement
    const correct = document.getElementById('btn-correct-verdict') as HTMLButtonElement
    const decline = document.getElementById('btn-decline-verdict') as HTMLButtonElement
    expect(approve.disabled).toBe(false)
    expect(correct.disabled).toBe(false)
    expect(decline.disabled).toBe(false)
    ;(document.getElementById('btn-seal-receipt') as HTMLButtonElement).click()
    expect(document.getElementById('seal-status')?.textContent).toBe(
      'SEAL REFUSED — a human must approve, correct, or decline the final verdict first.'
    )
    correct.click()
    const form = document.getElementById('correction-form') as HTMLFormElement
    expect(form.hidden).toBe(false)
    const corrected = document.getElementById('corrected-verdict') as HTMLSelectElement
    const rationale = document.getElementById('correction-rationale') as HTMLTextAreaElement
    corrected.value = 'SUPPORTED'
    rationale.value = 'The signed exception authorizes the later inspection date.'
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    expect(document.getElementById('verdict-accept-status')?.textContent).toContain(
      'CORRECTED'
    )
    expect(approve.disabled).toBe(true)
    expect(correct.disabled).toBe(true)
    expect(decline.disabled).toBe(true)

    ;(document.getElementById('btn-seal-receipt') as HTMLButtonElement).click()
    await vi.waitFor(() => {
      expect(document.getElementById('seal-modal-backdrop')?.hidden).toBe(false)
    })
    const summary = document.getElementById('receipt-summary')?.textContent ?? ''
    expect(summary).toContain('Human decision: CORRECTED')
    expect(summary).toContain('Final verdict: SUPPORTED')
    expect(summary).toContain('Agent proposed: CONTRADICTED')
    expect(summary).toContain('Agent proposed 2 exhibits')
    expect(summary).toContain('Human accepted 2')
    expect(summary).toContain('Rejected 0')
    expect(summary).toContain('Evidence integrity: VERIFIED')
    expect(summary).toContain('Quality checks: 6/6')
  })
})
