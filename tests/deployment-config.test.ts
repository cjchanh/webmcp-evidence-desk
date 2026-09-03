import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REQUIRED_HEADERS: Record<string, string> = {
  'Origin-Agent-Cluster': '?1',
  'Permissions-Policy': 'tools=self',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'none'",
  'X-Frame-Options': 'DENY',
  'Access-Control-Allow-Origin': 'https://evidence.centennialdefense.systems'
}

describe('Vercel deployment contract', () => {
  it('builds dist and applies every required security header to all routes', () => {
    const configPath = fileURLToPath(new URL('../vercel.json', import.meta.url))
    expect(existsSync(configPath), 'tracked vercel.json is required for reproducible deploys').toBe(true)
    if (!existsSync(configPath)) return

    const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
      buildCommand?: string
      outputDirectory?: string
      headers?: Array<{
        source: string
        headers: Array<{ key: string; value: string }>
      }>
    }
    expect(config.buildCommand).toBe('npm run build')
    expect(config.outputDirectory).toBe('dist')
    expect(config.headers).toHaveLength(1)
    expect(config.headers?.[0]?.source).toBe('/(.*)')

    const actual = Object.fromEntries(
      (config.headers?.[0]?.headers ?? []).map(({ key, value }) => [key, value])
    )
    expect(actual).toEqual(REQUIRED_HEADERS)
  })
})
