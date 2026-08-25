/**
 * Manifest verification + tamper tests.
 *
 * Layered trust model (see src/domain/manifestPayload.ts):
 *   - flip span TEXT      -> signature stays valid, per-span sha256 recompute
 *                            fails -> SIG FAILED + surgical quarantine
 *   - flip ids/titles/HASHES -> signature breaks -> MANIFEST MISMATCH,
 *                            everything quarantined
 * Either path forces evaluate_claim to INSUFFICIENT downstream.
 */

import { describe, expect, it } from 'vitest'
import { ed25519 } from '@noble/curves/ed25519.js'
import { verifyManifest } from '../../src/domain/verify.ts'
import { evaluateClaim } from '../../src/domain/evaluate.ts'
import { fixtureExhibits, signFixture, HERO_CLAIM } from '../helpers/fixtures.ts'

describe('verifyManifest', () => {
  it('verifies an honestly signed manifest with zero quarantines', async () => {
    const { manifest } = signFixture(fixtureExhibits())
    const report = await verifyManifest(manifest)
    expect(report.ok).toBe(true)
    expect(report.manifestSignatureValid).toBe(true)
    expect(report.verified).toHaveLength(4)
    expect(report.quarantined).toEqual([])
  })

  it('flipped span TEXT -> SIG FAILED + surgical quarantine of that exhibit', async () => {
    const { manifest } = signFixture(fixtureExhibits())
    const tampered = structuredClone(manifest)
    tampered.exhibits[1]!.spans[0]!.text =
      'All checks were performed on 2026-03-12 (forged earlier date).'
    const report = await verifyManifest(tampered)
    // Structure + recorded hashes unchanged -> signature still valid.
    expect(report.manifestSignatureValid).toBe(true)
    // But the text no longer matches its recorded hash -> quarantined.
    expect(report.quarantined.map((q) => q.exhibit_id)).toEqual(['EX-002'])
    expect(report.quarantined[0]?.reason).toContain('span hash mismatch')
    expect(report.ok).toBe(false)
    expect(report.verified.some((e) => e.id === 'EX-002')).toBe(false)
    // Untampered exhibits stay usable.
    expect(report.verified.some((e) => e.id === 'EX-003')).toBe(true)
  })

  it('flipped span HASH -> signature break -> MANIFEST MISMATCH, all quarantined', async () => {
    const { manifest } = signFixture(fixtureExhibits())
    const tampered = structuredClone(manifest)
    tampered.exhibits[1]!.spans[0]!.sha256 = 'f'.repeat(64)
    const report = await verifyManifest(tampered)
    expect(report.manifestSignatureValid).toBe(false)
    expect(report.ok).toBe(false)
    expect(report.quarantined).toHaveLength(4)
    expect(report.verified).toHaveLength(0)
  })

  it('tampered title -> signature break -> all quarantined', async () => {
    const { manifest } = signFixture(fixtureExhibits())
    const tampered = structuredClone(manifest)
    tampered.exhibits[1]!.title = 'Forged Inspection Report'
    const report = await verifyManifest(tampered)
    expect(report.manifestSignatureValid).toBe(false)
    expect(report.quarantined).toHaveLength(4)
  })

  it('corrupted signature bytes -> all quarantined', async () => {
    const { manifest } = signFixture(fixtureExhibits())
    const tampered = { ...manifest, signature: 'ab'.repeat(64) }
    const report = await verifyManifest(tampered)
    expect(report.manifestSignatureValid).toBe(false)
    expect(report.verified).toHaveLength(0)
  })

  it('malformed key material fails closed without throwing', async () => {
    const { manifest } = signFixture(fixtureExhibits())
    const bad = { ...manifest, publicKey: 'not-hex' }
    const report = await verifyManifest(bad)
    expect(report.ok).toBe(false)
    expect(report.verified).toHaveLength(0)
  })

  it('a different key cannot produce a verifying signature over the same payload', async () => {
    const other = ed25519.utils.randomPrivateKey()
    const exhibits = fixtureExhibits()
    const { manifestSigningPayload } = await import('../../src/domain/manifestPayload.ts')
    const wrongSig = ed25519.sign(manifestSigningPayload(exhibits), other)
    const { manifest } = signFixture(exhibits)
    const forged = { ...manifest, signature: Buffer.from(wrongSig).toString('hex') }
    const report = await verifyManifest(forged)
    expect(report.manifestSignatureValid).toBe(false)
  })
})

describe('tamper -> INSUFFICIENT end to end', () => {
  it('text tamper on the contradicting report forces the verdict to INSUFFICIENT', async () => {
    const { manifest } = signFixture(fixtureExhibits())

    // Before tampering: CONTRADICTED.
    const cleanReport = await verifyManifest(manifest)
    const cleanVerdict = evaluateClaim(HERO_CLAIM, cleanReport.verified)
    expect(cleanVerdict.verdict).toBe('CONTRADICTED')

    // Rewrite the report's performed-on date (content tamper).
    const tampered = structuredClone(manifest)
    const reportExhibit = tampered.exhibits.find((e) => e.id === 'EX-002')!
    const span0 = reportExhibit.spans[0]!
    reportExhibit.spans[0] = {
      ...span0,
      text: 'All checks were performed on 2026-03-09, before acceptance.'
    }

    const report = await verifyManifest(tampered)
    expect(report.quarantined.map((q) => q.exhibit_id)).toEqual(['EX-002'])

    // Downstream evaluation sees verified exhibits only: attestation remains,
    // but the independent report is gone -> honest abstention.
    const verdict = evaluateClaim(HERO_CLAIM, report.verified)
    expect(verdict.verdict).toBe('INSUFFICIENT')
    expect(verdict.missing).toContain('independent inspection report')
  })

  it('structural tamper (flipped hash) quarantines everything -> INSUFFICIENT', async () => {
    const { manifest } = signFixture(fixtureExhibits())
    const tampered = structuredClone(manifest)
    tampered.exhibits[2]!.spans[0]!.sha256 = '0'.repeat(64)

    const report = await verifyManifest(tampered)
    expect(report.verified).toHaveLength(0)
    const verdict = evaluateClaim(HERO_CLAIM, report.verified)
    expect(verdict.verdict).toBe('INSUFFICIENT')
    expect(verdict.missing).toContain('inspection report')
  })
})
