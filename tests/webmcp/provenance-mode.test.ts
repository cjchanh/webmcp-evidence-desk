// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { WebMcpToolDefinition } from '../../src/webmcp/register.ts'

describe('provenance mode', () => {
  it('keeps a simulation-only session out of MIXED until a real tool executes', async () => {
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

    ;(document.getElementById('btn-run-sim-inline') as HTMLButtonElement).click()
    expect(document.getElementById('provenance-mode')?.textContent).toBe('SIMULATED')
    expect(document.getElementById('tool-log')?.textContent).toContain('[SIM]')

    await registered[0]!.execute({ query: 'inspection report' })
    expect(document.getElementById('provenance-mode')?.textContent).toBe('MIXED')
  })
})
