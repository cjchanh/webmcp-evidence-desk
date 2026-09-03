// @vitest-environment happy-dom

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * User-authored evidence UI — happy-dom mount of the live page (same pattern
 * as live-page-flow.test.ts). modelContext is deliberately ABSENT so the
 * WebMCP lane reports UNAVAILABLE and the user-evidence lane is exercised in
 * isolation.
 */

const TWO_EXHIBIT_CORPUS = `EXHIBIT: EX-101
TITLE: Vendor Attestation Letter
[SPAN EX-101-1]
We attest the final inspection completed 2026-03-10, prior to acceptance.

EXHIBIT: EX-102
TITLE: Inspection Report IR-2219
[SPAN EX-102-1]
All electrical continuity checks performed 2026-03-19 at Meridian Fab 2.
`

function mountPage(): void {
  const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')
  const body = html
    .slice(html.indexOf('<body>') + '<body>'.length, html.indexOf('</body>'))
    .replace(/<script[\s\S]*?<\/script>/g, '')
  document.body.innerHTML = body
}

describe('user evidence UI through the live page', () => {
  beforeAll(async () => {
    mountPage()
    // modelContext intentionally NOT defined -> WebMCP UNAVAILABLE path.
      await import('../src/main.ts')
    await vi.waitFor(() => {
      expect(document.getElementById('webmcp-status')?.textContent).toBe(
        'WEBMCP: UNAVAILABLE'
      )
    })
  })

  it('boots without touching the panel: verdict PENDING REVIEW, WebMCP UNAVAILABLE', () => {
    expect(document.getElementById('verdict-stamp')?.textContent).toBe(
      'VERDICT: PENDING REVIEW'
    )
    expect(document.getElementById('webmcp-status')?.textContent).toBe(
      'WEBMCP: UNAVAILABLE'
    )
    expect(document.getElementById('provenance-mode')?.textContent).toBe('SIMULATED')
  })

  it('all new user-evidence ids exist exactly once', () => {
    const NEW_IDS = [
      'user-evidence-section',
      'user-evidence-input',
      'user-evidence-file',
      'user-evidence-import-file',
      'btn-sign-user-evidence',
      'btn-export-user-manifest',
      'btn-import-user-manifest',
      'user-evidence-status',
      'user-evidence-format-help'
    ]
    for (const id of NEW_IDS) {
      expect(
        document.querySelectorAll(`#${id}`),
        `#${id} should exist exactly once`
      ).toHaveLength(1)
    }
  })

  it('user-evidence-section appears after forgery-section in document order', () => {
    const forge = document.getElementById('forgery-section')!
    const user = document.getElementById('user-evidence-section')!
    expect(
      forge.compareDocumentPosition(user) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('SIGN with empty textarea shows a status error and keeps verdict PENDING REVIEW', async () => {
    const input = document.getElementById('user-evidence-input') as HTMLTextAreaElement
    input.value = ''
    ;(document.getElementById('btn-sign-user-evidence') as HTMLButtonElement).click()

    await vi.waitFor(() => {
      expect(document.getElementById('user-evidence-status')?.textContent).toContain(
        'PARSE FAILED'
      )
    })
    expect(document.getElementById('verdict-stamp')?.textContent).toBe(
      'VERDICT: PENDING REVIEW'
    )
  })

  it('export button without a prior sign shows the nothing-to-save status', () => {
    ;(document.getElementById('btn-export-user-manifest') as HTMLButtonElement).click()
    expect(document.getElementById('user-evidence-status')?.textContent).toBe(
      'Nothing to save yet — sign evidence first.'
    )
  })

  it('signs a 2-exhibit corpus, resets the board to PENDING REVIEW, and never leaks the private key', async () => {
    const input = document.getElementById('user-evidence-input') as HTMLTextAreaElement
    input.value = TWO_EXHIBIT_CORPUS
    ;(document.getElementById('btn-sign-user-evidence') as HTMLButtonElement).click()

    await vi.waitFor(() => {
      expect(document.getElementById('user-evidence-status')?.textContent).toContain(
        'SIGNED LOCALLY'
      )
    })

    // Board reset after load.
    expect(document.getElementById('verdict-stamp')?.textContent).toBe(
      'VERDICT: PENDING REVIEW'
    )

    // No 64-char hex private key (or any key material) may leak into the DOM.
    const html = document.body.innerHTML
    expect(html).not.toMatch(/[\da-f]{64}/i)
  })

  it('a tampered packet import shows LOAD REFUSED and never overwrites it with LOADED', async () => {
    // Sign a real corpus first so a prior user manifest is active.
    const input = document.getElementById('user-evidence-input') as HTMLTextAreaElement
    input.value = TWO_EXHIBIT_CORPUS
    ;(document.getElementById('btn-sign-user-evidence') as HTMLButtonElement).click()
    await vi.waitFor(() => {
      expect(document.getElementById('user-evidence-status')?.textContent).toContain(
        'SIGNED LOCALLY'
      )
    })

    // Capture the exported packet, tamper a span text (hash mismatch), import it.
    const packet = await new Promise<string>((resolve) => {
      let captured: string | null = null
      const origCreate = URL.createObjectURL
      URL.createObjectURL = (blob: Blob) => {
        void blob.text().then((t) => {
          captured = t
        })
        return origCreate.call(URL, blob)
      }
      ;(document.getElementById('btn-export-user-manifest') as HTMLButtonElement).click()
      const iv = setInterval(() => {
        if (captured !== null) {
          clearInterval(iv)
          URL.createObjectURL = origCreate
          resolve(captured as string)
        }
      }, 20)
      setTimeout(() => {
        clearInterval(iv)
        URL.createObjectURL = origCreate
        resolve('')
      }, 5000)
    })
    expect(packet).not.toBe('')

    const env = JSON.parse(packet) as {
      manifest: { exhibits: Array<{ spans: Array<{ text: string }> }> }
    }
    env.manifest.exhibits[0]!.spans[0]!.text += ' TAMPERED'
    const tamperedJson = JSON.stringify(env)

    const fileInput = document.getElementById(
      'user-evidence-import-file'
    ) as HTMLInputElement
    const file = new File([tamperedJson], 'packet.json', { type: 'application/json' })
    const dt = new DataTransfer()
    dt.items.add(file)
    fileInput.files = dt.files
    fileInput.dispatchEvent(new Event('change', { bubbles: true }))

    await vi.waitFor(() => {
      expect(document.getElementById('user-evidence-status')?.textContent).toContain(
        'LOAD REFUSED'
      )
    })
    // The refusal copy must survive — never overwritten by success copy.
    expect(document.getElementById('user-evidence-status')?.textContent).not.toContain(
      'LOADED —'
    )
    // Prior case left unchanged: the earlier signed corpus is still active.
    expect(document.getElementById('verdict-stamp')?.textContent).toBe(
      'VERDICT: PENDING REVIEW'
    )
  })
})
