/**
 * Runtime purity gates, enforced mechanically (Constraints Over Plasticity):
 *
 * 1. src/domain/** contains NO DOM access — pure functions only.
 * 2. src/** runtime code makes ZERO network calls — no fetch/XHR/WebSocket/
 *    EventSource/dynamic URL imports. The signed manifest is bundled at
 *    build time; nothing is fetched.
 */

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SRC = path.join(ROOT, 'src')

function tsFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...tsFiles(full))
    } else if (/\.ts$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

function readAll(dir: string): Array<{ file: string; code: string }> {
  return tsFiles(dir).map((file) => ({ file: path.relative(SRC, file), code: readFileSync(file, 'utf8') }))
}

describe('domain purity — no DOM access', () => {
  const domainFiles = readAll(path.join(SRC, 'domain'))

  it('every domain file exists to guard against a silent empty sweep', () => {
    expect(domainFiles.length).toBeGreaterThanOrEqual(8)
  })

  for (const pattern of [
    /\bdocument\b/,
    /\bwindow\b/,
    /\bnavigator\b/,
    /\blocalStorage\b/,
    /\binnerHTML\b/,
    /createElement/,
    /querySelector/
  ]) {
    it(`no ${pattern} in domain layer`, () => {
      for (const { file, code } of domainFiles) {
        const stripped = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
        expect(stripped, `${file} contains DOM access: ${pattern}`).not.toMatch(pattern)
      }
    })
  }
})

describe('runtime purity — zero network calls', () => {
  const allSrc = readAll(SRC)

  it('scanned the whole src tree', () => {
    expect(allSrc.length).toBeGreaterThan(10)
  })

  for (const pattern of [
    /\bfetch\s*\(/,
    /XMLHttpRequest/,
    /\bWebSocket\s*\(/,
    /EventSource\s*\(/,
    /sendBeacon/,
    /\bimport\s*\(\s*['"`]https?:/,
    /navigator\.sendBeacon/
  ]) {
    it(`no ${pattern} anywhere in src runtime code`, () => {
      for (const { file, code } of allSrc) {
        const stripped = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
        expect(stripped, `${file} contains network access: ${pattern}`).not.toMatch(pattern)
      }
    })
  }

  it('the only http(s) strings allowed are license links in comments', () => {
    for (const { file, code } of allSrc) {
      const liveStrings = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      const matches = liveStrings.match(/https?:\/\/[^\s'"`)]+/g) ?? []
      // No runtime code should reference remote URLs at all.
      expect(matches, `${file} references remote URLs: ${matches.join(', ')}`).toEqual([])
    }
  })
})
