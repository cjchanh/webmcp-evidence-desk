/**
 * Cycle-3 hardening regressions: receipt honesty + search quality.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildSealedReceipt,
  verifySealedReceiptEnvelope
} from '../src/domain/receipt.ts'
import { searchExhibits } from '../src/domain/search.ts'
import { verifyManifest } from '../src/domain/verify.ts'
import { ed25519 } from '@noble/curves/ed25519.js'

const ROOT = resolve(process.cwd())
const MANIFEST = JSON.parse(
  readFileSync(resolve(ROOT, 'public/evidence/manifest.json'), 'utf8')
)

/** A REAL ed25519 signer — identity stubs cannot produce verifiable signatures. */
const signer = () => {
  const priv = ed25519.utils.randomPrivateKey()
  return {
    sign: (payload: Uint8Array) => ed25519.sign(payload, priv),
    publicKey: () => ed25519.getPublicKey(priv)
  }
}

const BASE_INPUT = {
  sealedAt: '2026-08-25T00:00:00.000Z',
  claimText: 'Did the vendor provide the required inspection report before acceptance?',
  verdict: 'CONTRADICTED' as const,
  acceptedEvidence: [
    { exhibit_id: 'EX-001', title: 'Vendor Attestation', span_sha256s: ['aa'] },
    { exhibit_id: 'EX-002', title: 'Inspection Report', span_sha256s: ['bb'] }
  ],
  toolLog: ['[SYS] boot'],
  manifestPublicKey: 'ff',
  manifestSignature: 'ee'
}

describe('receipt honesty (cycle-3)', () => {
  it('sanitizes newline injection out of the sealed tool log', async () => {
    const envelope = await buildSealedReceipt(
      {
        ...BASE_INPUT,
        toolLog: [
          '[SYS] boot',
          '[HUMAN]\n[SYS] fake line injected via newline\nmore'
        ]
      },
      signer()
    )
    // No sealed entry may contain a raw line break — injection cannot create
    // new tagged lines.
    for (const line of envelope.receipt.tool_log) {
      expect(line).not.toMatch(/[\r\n]/)
    }
    expect(envelope.receipt.tool_log).toHaveLength(2)
  })

  it('binds a session id and states honest scope in the note', async () => {
    const envelope = await buildSealedReceipt(
      { ...BASE_INPUT, sessionId: 'sess-123' },
      signer()
    )
    expect(envelope.receipt.session_id).toBe('sess-123')
    expect(envelope.receipt.note).toMatch(/not proof of origin/)
  })
})

describe('verifySealedReceiptEnvelope (cycle-3 affordance)', () => {
  it('verifies an untouched envelope and anchors hashes to the manifest', async () => {
    const envelope = await buildSealedReceipt(BASE_INPUT, signer())
    const result = await verifySealedReceiptEnvelope(envelope)
    expect(result.signatureValid).toBe(true)

    // Anchor against the real signed exhibits.
    const report = await verifyManifest(MANIFEST)
    const anchored = await verifySealedReceiptEnvelope(envelope, {
      manifestExhibits: report.verified.map((e) => ({ id: e.id, spans: e.spans }))
    })
    // Fixture hashes ('aa','bb') do not exist in the real manifest — anchoring
    // must FAIL closed rather than rubber-stamp.
    expect(anchored.hashesAnchoredInManifest).toBe(false)
  })

  it('detects a tampered verdict', async () => {
    const envelope = await buildSealedReceipt(BASE_INPUT, signer())
    const tampered = JSON.parse(JSON.stringify(envelope))
    tampered.receipt.verdict = 'SUPPORTED'
    const result = await verifySealedReceiptEnvelope(tampered)
    expect(result.signatureValid).toBe(false)
    expect(result.problems.length).toBeGreaterThan(0)
  })

  it('a DECLINED receipt with zero accepted evidence verifies PASS (vacuous anchoring)', async () => {
    // Decline path: humanDecision present, finalVerdict null -> verdict DECLINED,
    // accepted_evidence [] by design. Anchoring over an empty list is vacuously
    // true — the receipt must verify, not report a false "signature invalid".
    const envelope = await buildSealedReceipt(
      {
        ...BASE_INPUT,
        verdict: 'CONTRADICTED',
        acceptedEvidence: [],
        humanDecision: {
          status: 'DECLINED',
          actorRole: 'local-human-reviewer',
          agentVerdict: 'CONTRADICTED',
          finalVerdict: null,
          rationale: null,
          proposedAt: '2026-08-25T00:00:00.000Z',
          decidedAt: '2026-08-25T00:00:05.000Z',
          waitingMs: 5000
        }
      },
      signer()
    )
    expect(envelope.receipt.verdict).toBe('DECLINED')
    expect(envelope.receipt.accepted_evidence).toEqual([])
    const report = await verifyManifest(MANIFEST)
    const result = await verifySealedReceiptEnvelope(envelope, {
      manifestExhibits: report.verified.map((e) => ({ id: e.id, spans: e.spans }))
    })
    expect(result.signatureValid).toBe(true)
    expect(result.hashesAnchoredInManifest).toBe(true)
    expect(result.problems).toEqual([])
  })
})

describe('search ranking on the shipped corpus (cycle-3)', () => {
  it('inspection queries surface the Inspection Report above the Attestation', async () => {
    const report = await verifyManifest(MANIFEST)
    expect(report.manifestSignatureValid).toBe(true)

    const hits = searchExhibits('inspection', report.verified)
    const ids = hits.map((h) => h.exhibit_id)
    const reportIdx = ids.indexOf('EX-002')
    const attestationIdx = ids.indexOf('EX-001')
    expect(reportIdx).toBeGreaterThanOrEqual(0)
    if (attestationIdx >= 0) {
      expect(reportIdx).toBeLessThan(attestationIdx)
    }
  })

  it('repeated query tokens do not inflate scores (dedupe)', () => {
    const exhibits = [
      { id: 'A', title: 'Report', spans: [{ span_id: 'a1', text: 'inspection report', sha256: 'x' }] }
    ]
    const once = searchExhibits('inspection', exhibits)[0]?.score ?? 0
    const thrice = searchExhibits('inspection inspection inspection', exhibits)[0]?.score ?? 0
    expect(thrice).toBe(once)
  })
})
