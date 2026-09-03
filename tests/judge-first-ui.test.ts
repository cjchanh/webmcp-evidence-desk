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
  it('states the case question, proof contract, and primary judge action literally', () => {
    mount()
    expect(document.querySelector('.brand-sub')?.textContent).toContain(
      'Judge-first WebMCP evidence review'
    )
    expect(document.getElementById('page-title')?.textContent).toContain(
      'Can an agent prove its answer before you act?'
    )
    expect(document.getElementById('btn-copy-judge-prompt')?.textContent).toBe(
      'INVESTIGATE WITH MY AGENT'
    )
    expect(document.getElementById('btn-run-sim-inline')?.textContent).toBe(
      'WATCH 20-SECOND GUIDED REPLAY'
    )
    expect(document.getElementById('trust-strip')?.textContent?.replace(/\s+/g, ' ')).toContain(
      '13 VERIFIED · 4 WEBMCP TOOLS · HUMAN-ONLY FINAL ACTION'
    )
  })

  it('puts the contested claim beside the live tool trace in one judge stage', () => {
    mount()
    const stage = document.getElementById('judge-stage')!
    expect(stage).toBeTruthy()
    expect(stage.querySelector('#claim-text')).toBeTruthy()
    expect(stage.querySelector('#review-status')?.textContent).toContain('INITIAL')
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

  it('makes approval, correction, decline, and sealing literal human-only actions', () => {
    mount()
    const approve = document.getElementById('btn-approve-verdict') as HTMLButtonElement
    const correct = document.getElementById('btn-correct-verdict') as HTMLButtonElement
    const decline = document.getElementById('btn-decline-verdict') as HTMLButtonElement
    expect(approve.textContent).toBe('APPROVE AGENT VERDICT')
    expect(correct.textContent).toBe('CORRECT VERDICT')
    expect(decline.textContent).toBe('DECLINE PROPOSAL')
    expect(approve.disabled).toBe(true)
    expect(correct.disabled).toBe(true)
    expect(decline.disabled).toBe(true)
    expect(document.getElementById('correction-form')).toBeTruthy()
    expect(document.getElementById('corrected-verdict')).toBeTruthy()
    expect(document.getElementById('correction-rationale')).toBeTruthy()
    expect(document.getElementById('human-authority')?.textContent).toContain(
      'Only you can approve, correct, or decline the agent verdict.'
    )
  })

  it('includes a non-color status anatomy and a first-class abstention notice', () => {
    mount()
    expect(document.getElementById('review-state-signal')?.textContent).toBeTruthy()
    expect(document.getElementById('review-freshness')?.textContent).toContain('Updated')
    expect(document.querySelector<HTMLAnchorElement>('#review-detail-link')?.hash).toBe('#tool-log')
    expect(document.getElementById('abstention-notice')).toBeTruthy()
    expect(document.getElementById('abstention-reason')).toBeTruthy()
    expect(document.getElementById('abstention-missing')).toBeTruthy()
    expect(document.getElementById('abstention-next-action')).toBeTruthy()
  })

  it('uses restrained Mission Calm motion without theatrical verdict effects', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/ui/styles.css'), 'utf8')
    expect(css).not.toContain('verdict-slam')
    expect(css).not.toContain('board-shake')
    expect(css).not.toContain('hash-sweep')
    expect(css).not.toContain('caret-blink')
    expect(css).not.toContain('receipt-line-in')
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
