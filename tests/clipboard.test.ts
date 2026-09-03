// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

describe('judge prompt clipboard fallback', () => {
  it('reveals a selectable briefing when both automatic copy paths are blocked', async () => {
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')
    document.body.innerHTML = html
      .slice(html.indexOf('<body>') + '<body>'.length, html.indexOf('</body>'))
      .replace(/<script[\s\S]*?<\/script>/g, '')

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new DOMException('blocked', 'NotAllowedError')) }
    })
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        throw new DOMException('blocked', 'NotAllowedError')
      })
    })

    await import('../src/main.ts')
    ;(document.getElementById('btn-copy-judge-prompt') as HTMLButtonElement).click()

    await vi.waitFor(() => {
      expect(document.getElementById('copy-feedback')?.textContent).toContain(
        'AUTOMATIC COPY BLOCKED'
      )
    })
    const fallback = document.getElementById('judge-prompt-manual') as HTMLDetailsElement
    const text = document.getElementById('judge-prompt-text') as HTMLTextAreaElement
    expect(fallback.hidden).toBe(false)
    expect(fallback.open).toBe(true)
    expect(text.value).toContain(
      'Did the vendor provide the required inspection report before acceptance?'
    )
    expect(document.querySelectorAll('body > textarea')).toHaveLength(0)
  })
})
