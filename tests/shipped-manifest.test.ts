/**
 * Regression: the SHIPPED manifest must validate under the runtime verifier.
 *
 * The test suite elsewhere re-signs fresh fixtures, which cannot catch a stale
 * signature in the committed artifact. This test reads the real
 * public/evidence/manifest.json and runs the production verify path against
 * it, so a stale or mismatched signature fails CI instead of shipping.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { verifyManifest } from '../src/domain/verify.ts'

const ROOT = resolve(__dirname, '..')
const shipped = JSON.parse(
  readFileSync(resolve(ROOT, 'public/evidence/manifest.json'), 'utf8')
)

describe('shipped manifest integrity', () => {
  it('manifest signature validates against the embedded public key', async () => {
    const report = await verifyManifest(shipped)
    expect(report.manifestSignatureValid).toBe(true)
    expect(report.ok).toBe(true)
  })

  it('no exhibit is quarantined', async () => {
    const report = await verifyManifest(shipped)
    expect(
      report.quarantined.map((q) => `${q.exhibit_id}: ${q.reason}`)
    ).toEqual([])
  })

  it('hero corpus keeps both contradiction sides verifiable', async () => {
    const report = await verifyManifest(shipped)
    expect(report.verified.length).toBeGreaterThanOrEqual(12)
  })
})
