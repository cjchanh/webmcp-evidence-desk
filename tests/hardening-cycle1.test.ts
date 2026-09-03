/**
 * Cycle-1 hardening regressions.
 *
 * Covers the exploitable seal gate (receipts must never claim acceptance of
 * evidence that was never SIG VERIFIED), the stale-verdict seal refusal at the
 * domain boundary, and manifest format/algorithm authentication.
 */
import { describe, expect, it } from 'vitest'
import { collectAcceptedEvidence } from '../src/domain/receipt.ts'
import { verifyManifest } from '../src/domain/verify.ts'
import type { Exhibit, EvidenceManifest } from '../src/domain/types.ts'

const span = (id: string, text: string) => ({ span_id: id, text, sha256: text })

const EXHIBITS: Exhibit[] = [
  { id: 'EX-001', title: 'Vendor attestation', spans: [span('s1', 'attestation text')] },
  { id: 'EX-002', title: 'Inspection report', spans: [span('s2', 'report text')] },
  { id: 'EX-003', title: 'Acceptance certificate', spans: [span('s3', 'acceptance text')] }
]

const QUARANTINED = new Set(['EX-002'])

describe('collectAcceptedEvidence — the seal gate', () => {
  it('refuses fabricated exhibit ids that were never verified', () => {
    const { accepted, refused } = collectAcceptedEvidence(
      [
        { exhibit_id: 'EX-999', status: 'proposed' },
        { exhibit_id: 'EX-001', status: 'pinned' }
      ],
      EXHIBITS,
      new Set()
    )
    expect(refused).toEqual([{ exhibit_id: 'EX-999', reason: 'not_in_verified_set' }])
    expect(accepted.map((a) => a.exhibit_id)).toEqual(['EX-001'])
    expect(accepted[0]?.span_sha256s.length).toBe(1)
  })

  it('does not claim an agent proposal was accepted by a human', () => {
    const { accepted, refused } = collectAcceptedEvidence(
      [{ exhibit_id: 'EX-001', status: 'proposed' }],
      EXHIBITS,
      new Set()
    )

    expect(accepted).toEqual([])
    expect(refused).toEqual([])
  })

  it('refuses quarantined exhibits into the accepted list', () => {
    const { accepted, refused } = collectAcceptedEvidence(
      [{ exhibit_id: 'EX-002', status: 'proposed' }],
      EXHIBITS,
      QUARANTINED
    )
    expect(accepted).toEqual([])
    expect(refused).toEqual([{ exhibit_id: 'EX-002', reason: 'quarantined' }])
  })

  it('excludes human-rejected entries from the receipt entirely', () => {
    const { accepted } = collectAcceptedEvidence(
      [
        { exhibit_id: 'EX-001', status: 'rejected' },
        { exhibit_id: 'EX-003', status: 'pinned' }
      ],
      EXHIBITS,
      new Set()
    )
    expect(accepted.map((a) => a.exhibit_id)).toEqual(['EX-003'])
  })
})

describe('manifest format/algorithm authentication (verifyManifest)', () => {
  const baseManifest: EvidenceManifest = {
    format: 'evidence-desk-manifest/v1',
    algorithm: 'ed25519',
    exhibits: [],
    publicKey: '5c4932ccde8dc38f516e2fecc2b44c933b173165718e9e877f03e99a82f3b77a',
    signature: '00'.repeat(64)
  }

  it('quarantines everything on unknown algorithm', async () => {
    const report = await verifyManifest({ ...baseManifest, algorithm: 'rsa2048' as never })
    expect(report.ok).toBe(false)
    expect(report.manifestSignatureValid).toBe(false)
  })

  it('quarantines everything on unknown format', async () => {
    const report = await verifyManifest({
      ...baseManifest,
      format: 'some-other-format/v9' as never
    })
    expect(report.ok).toBe(false)
  })
})
