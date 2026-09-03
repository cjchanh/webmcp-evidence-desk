/**
 * User-authored evidence manifest — domain-level tests (node env).
 *
 * Exercises parseUserDocuments, buildUserManifest, verifyManifest,
 * exportUserManifest, and importUserManifest end to end with the real
 * Ed25519 + sha256 path (no mocks).
 */

import { describe, expect, it } from 'vitest'
import {
  buildUserManifest,
  exportUserManifest,
  importUserManifest,
  parseUserDocuments,
  USER_MANIFEST_MAX_EXHIBITS
} from '../src/domain/userManifest.ts'
import { verifyManifest } from '../src/domain/verify.ts'

/** One corpus-format exhibit block, matching corpus/exhibits/EX-001.txt shape. */
function corpusExhibit(id: string, title: string, spanId: string, text: string): string {
  return `EXHIBIT: ${id}\nTITLE: ${title}\n[SPAN ${spanId}]\n${text}\n`
}

const TWO_EXHIBIT_CORPUS =
  corpusExhibit(
    'EX-101',
    'Vendor Attestation Letter',
    'EX-101-1',
    'We attest the final inspection completed 2026-03-10, prior to acceptance.'
  ) +
  '\n' +
  corpusExhibit(
    'EX-102',
    'Inspection Report IR-2219',
    'EX-102-1',
    'All electrical continuity checks performed 2026-03-19 at Meridian Fab 2.'
  )

describe('parseUserDocuments', () => {
  it('parses two concatenated corpus-format exhibits into 2 exhibits with 0 errors', () => {
    const { exhibits, errors } = parseUserDocuments(TWO_EXHIBIT_CORPUS)
    expect(errors).toEqual([])
    expect(exhibits).toHaveLength(2)
    expect(exhibits.map((e) => e.id)).toEqual(['EX-101', 'EX-102'])
    expect(exhibits[0]?.spans).toHaveLength(1)
    expect(exhibits[0]?.spans[0]?.span_id).toBe('EX-101-1')
  })

  it('rejects an exhibit id that does not match /^EX-[A-Z0-9-]+$/', () => {
    const bad = corpusExhibit(
      'ex-101',
      'Lowercase id',
      'EX-101-1',
      'some text'
    )
    const { exhibits, errors } = parseUserDocuments(bad)
    expect(exhibits).toHaveLength(0)
    expect(errors.some((e) => e.includes('does not match'))).toBe(true)
  })

  it('reports the 21st exhibit as an error rather than silently dropping it', () => {
    const blocks: string[] = []
    for (let i = 1; i <= USER_MANIFEST_MAX_EXHIBITS + 1; i++) {
      const id = `EX-${String(i).padStart(3, '0')}`
      blocks.push(corpusExhibit(id, `Exhibit ${i}`, `${id}-1`, `text for ${id}`))
    }
    const { errors } = parseUserDocuments(blocks.join('\n'))
    expect(errors.some((e) => e.includes('too many exhibits'))).toBe(true)
    expect(errors.some((e) => e.includes(String(USER_MANIFEST_MAX_EXHIBITS + 1)))).toBe(true)
  })

  it('reports empty input as an error', () => {
    const { exhibits, errors } = parseUserDocuments('   \n  ')
    expect(exhibits).toHaveLength(0)
    expect(errors).toContain('input is empty')
  })
})

describe('buildUserManifest + verifyManifest', () => {
  it('produces a manifest that verifies cleanly (signature valid, ok, no quarantine)', async () => {
    const { exhibits } = parseUserDocuments(TWO_EXHIBIT_CORPUS)
    const { manifest } = await buildUserManifest(exhibits)
    const report = await verifyManifest(manifest)
    expect(report.manifestSignatureValid).toBe(true)
    expect(report.ok).toBe(true)
    expect(report.quarantined).toEqual([])
    expect(report.verified).toHaveLength(2)
  })

  it('returns a 32-byte Uint8Array private key', async () => {
    const { exhibits } = parseUserDocuments(TWO_EXHIBIT_CORPUS)
    const { privateKey } = await buildUserManifest(exhibits)
    expect(privateKey).toBeInstanceOf(Uint8Array)
    expect(privateKey).toHaveLength(32)
  })
})

describe('exportUserManifest / importUserManifest', () => {
  it('round-trips an exported manifest through importUserManifest', async () => {
    const { exhibits } = parseUserDocuments(TWO_EXHIBIT_CORPUS)
    const { manifest, privateKey } = await buildUserManifest(exhibits)
    const json = exportUserManifest(manifest, privateKey)
    const result = importUserManifest(json)
    expect('error' in result).toBe(false)
    if ('error' in result) return
    expect(result.manifest.exhibits).toHaveLength(2)
    expect(result.manifest.publicKey).toBe(manifest.publicKey)
    expect(result.manifest.signature).toBe(manifest.signature)
    expect(Array.from(result.privateKey)).toEqual(Array.from(privateKey))
  })

  it('returns {error} for non-JSON input', () => {
    const result = importUserManifest('not json')
    expect('error' in result).toBe(true)
  })

  it("returns {error} for '{}' (empty object envelope)", () => {
    const result = importUserManifest('{}')
    expect('error' in result).toBe(true)
  })

  it('returns {error} for a wrong-format envelope', () => {
    const result = importUserManifest('{"format":"nope"}')
    expect('error' in result).toBe(true)
  })
})
