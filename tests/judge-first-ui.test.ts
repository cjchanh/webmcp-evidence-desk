// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const HTML = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')

function mount(): void {
  document.body.innerHTML = HTML.slice(
    HTML.indexOf('<body>') + '<body>'.length,
    HTML.indexOf('</body>')
  ).replace(/<script[\s\S]*?<\/script>/g, '')
}

describe('judge-first first viewport', () => {
  it('states the category, trust contract, and primary judge action literally', () => {
    mount()
    expect(document.querySelector('.brand-sub')?.textContent).toContain(
      'Judge-first WebMCP evidence review'
    )
    expect(document.getElementById('trust-contract')?.textContent).toContain(
      'Agent proposes. Human decides. Evidence preserves what happened.'
    )
    expect(document.getElementById('btn-copy-judge-prompt')?.textContent).toBe(
      'COPY AGENT BRIEFING'
    )
    expect(document.getElementById('btn-run-sim-inline')?.textContent).toBe(
      'WATCH 20-SECOND GUIDED REPLAY'
    )
  })

  it('puts the contested claim beside the live tool trace in one judge stage', () => {
    mount()
    const stage = document.getElementById('judge-stage')!
    expect(stage).toBeTruthy()
    expect(stage.querySelector('#claim-text')).toBeTruthy()
    expect(stage.querySelector('#review-status')?.textContent).toContain('AWAITING AGENT')
    expect(stage.querySelector('#tool-log')).toBeTruthy()
    expect(stage.querySelector('#date-conflict')).toBeTruthy()
    expect(stage.querySelector('#date-conflict')?.textContent).toContain('MAR 14')
    expect(stage.querySelector('#date-conflict')?.textContent).toContain('MAR 19')
  })
})

describe('progressive disclosure and human authority', () => {
  it('keeps the 13-exhibit packet collapsed behind the decisive evidence', () => {
    mount()
    const disclosure = document.getElementById('all-exhibits-disclosure') as HTMLDetailsElement
    expect(disclosure).toBeTruthy()
    expect(disclosure.open).toBe(false)
    expect(disclosure.querySelector('#packet-grid')).toBeTruthy()
    expect(document.getElementById('exhibit-grid')).toBeTruthy()
  })

  it('makes final verdict acceptance and sealing literal human-only actions', () => {
    mount()
    const accept = document.getElementById('btn-accept-verdict') as HTMLButtonElement
    expect(accept.textContent).toBe('ACCEPT AGENT VERDICT')
    expect(accept.disabled).toBe(true)
    expect(document.getElementById('human-authority')?.textContent).toContain(
      'Only you can accept the verdict and seal the receipt.'
    )
  })

  it('places the Forgery Bench after the primary decide-and-seal flow', () => {
    expect(HTML.indexOf('id="forgery-section"')).toBeGreaterThan(
      HTML.indexOf('id="seal-section"')
    )
  })

  it('shows a readable receipt summary before the raw signed JSON', () => {
    mount()
    const summary = document.getElementById('receipt-summary')!
    const raw = document.getElementById('seal-receipt-preview')!
    expect(summary).toBeTruthy()
    expect(raw).toBeTruthy()
    expect(summary.compareDocumentPosition(raw) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect((raw.closest('details') as HTMLDetailsElement)?.open).toBe(false)
  })
})
