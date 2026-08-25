/**
 * Hero-flow regression: on the SHIPPED manifest, the adjudicated claim must
 * come back CONTRADICTED with BOTH sides of the deliberate corpus
 * contradiction surfaced as span-tied reasons:
 *   1. vendor attestation asserts inspection completed BEFORE acceptance
 *   2. inspection report is dated AFTER acceptance
 *
 * Guards against evaluator patterns that silently over-fit fixture wording
 * and drop one side on real corpus text.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { evaluateClaim } from '../src/domain/evaluate.ts'
import { verifyManifest } from '../src/domain/verify.ts'

const ROOT = resolve(__dirname, '..')
const shipped = JSON.parse(
  readFileSync(resolve(ROOT, 'public/evidence/manifest.json'), 'utf8')
)

const HERO_CLAIM =
  'Did the vendor provide the required inspection report before acceptance?'

describe('hero flow on shipped artifact', () => {
  it('verifies cleanly then returns CONTRADICTED with both sides', async () => {
    const report = await verifyManifest(shipped)
    expect(report.manifestSignatureValid).toBe(true)

    const evaluation = evaluateClaim(HERO_CLAIM, report.verified)
    expect(evaluation.verdict).toBe('CONTRADICTED')
    expect(evaluation.reasons.length).toBeGreaterThanOrEqual(2)

    const bases = evaluation.reasons.map((r) => r.verdict_basis)
    expect(bases.some((b) => /AFTER the acceptance date/i.test(b))).toBe(true)
    expect(bases.some((b) => /BEFORE acceptance/i.test(b))).toBe(true)
  })
})
