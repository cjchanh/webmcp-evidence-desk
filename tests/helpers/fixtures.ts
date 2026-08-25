/**
 * Shared test fixtures: builds real signed manifests with @noble/curves so
 * verify/tamper tests exercise the actual crypto path end to end.
 */

import { ed25519 } from '@noble/curves/ed25519.js'
import { createHash } from 'node:crypto'
import { manifestSigningPayload } from '../../src/domain/manifestPayload.ts'
import type { EvidenceManifest, Exhibit } from '../../src/domain/types.ts'

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export function makeSpan(spanId: string, text: string) {
  return { span_id: spanId, text, sha256: sha256Hex(text) }
}

/** Corpus-shaped fixture mirroring the deliberate contradiction. */
export function fixtureExhibits(): Exhibit[] {
  return [
    {
      id: 'EX-001',
      title: 'Vendor Attestation Letter - Inspection Completion',
      spans: [
        makeSpan(
          'EX-001-1',
          'We hereby attest that the required final inspection was completed on 2026-03-10, prior to acceptance.'
        )
      ]
    },
    {
      id: 'EX-002',
      title: 'Inspection Report IR-2219 - Final Inspection',
      spans: [
        makeSpan(
          'EX-002-1',
          'All electrical continuity checks were performed on 2026-03-19 at the Meridian Fab 2 facility.'
        )
      ]
    },
    {
      id: 'EX-003',
      title: 'Acceptance Certificate AC-1147',
      spans: [
        makeSpan(
          'EX-003-1',
          'The customer accepted Lot HX-17 into service on 2026-03-14 following receiving verification.'
        )
      ]
    },
    {
      id: 'EX-004',
      title: 'Delivery Log DL-3092',
      spans: [
        makeSpan('EX-004-1', 'Shipment MS-77102 from Meridian Components Ltd received 2026-03-11.')
      ]
    }
  ]
}

export interface SignedFixture {
  privateKey: Uint8Array
  manifest: EvidenceManifest
}

export function signFixture(exhibits: Exhibit[]): SignedFixture {
  const privateKey = ed25519.utils.randomPrivateKey()
  const publicKey = ed25519.getPublicKey(privateKey)
  // Mirror production signing exactly: signature over the manifest of
  // exhibit hashes (structure + recorded sha256s), not the free text.
  const payload = manifestSigningPayload(exhibits)
  const signature = ed25519.sign(payload, privateKey)
  return {
    privateKey,
    manifest: {
      format: 'evidence-desk-manifest/v1',
      algorithm: 'ed25519',
      exhibits,
      publicKey: Buffer.from(publicKey).toString('hex'),
      signature: Buffer.from(signature).toString('hex')
    }
  }
}

export const HERO_CLAIM =
  'Did the vendor provide the required inspection report before acceptance?'
