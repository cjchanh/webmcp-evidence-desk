/**
 * Evidence Desk bootstrap.
 *
 * Progressive enhancement contract: the app is fully functional without
 * WebMCP. When document.modelContext exists, the four tools register and the
 * real agent path lights up; otherwise a banner offers the clearly-labeled
 * simulated lane. Both paths call identical domain functions.
 */

import './ui/styles.css'
import { MANIFEST } from './generated/manifest.ts'
import { verifyManifest } from './domain/verify.ts'
import {
  applyAgentAction,
  applyHumanAction,
  createBoard
} from './domain/board.ts'
import { buildSealedReceipt } from './domain/receipt.ts'
import type { SealedReceiptEnvelope } from './domain/receipt.ts'
import type {
  BoardState,
  ClaimEvaluation,
  Exhibit,
  Verdict
} from './domain/types.ts'
import {
  registerEvidenceTools,
  type ModelContextLike,
  type ToolContext
} from './webmcp/register.ts'
import { runSimulatedAgent } from './simulated/runSimulatedAgent.ts'
import {
  appendLog,
  cycleExhibits,
  renderExhibitGrid,
  setVerdict,
  type LogTag
} from './ui/caseboard.ts'
import { ed25519 } from '@noble/curves/ed25519.js'

const HERO_CLAIM = 'Did the vendor provide the required inspection report before acceptance?'

const JUDGE_PROMPT = [
  'You are reviewing a procurement evidence caseboard open on this page.',
  'Use this page\'s WebMCP tools:',
  "1. search_evidence — find exhibits relevant to the claim.",
  '2. inspect_exhibit — read exact source spans for any exhibit id.',
  "3. evaluate_claim — test the claim: \"" + HERO_CLAIM + "\"",
  "4. update_caseboard — action:'add' with exhibit_id and stance (supports|contradicts).",
  'Report span-tied reasons. Pin, remove, reject, and seal are human-exclusive controls.'
].join('\n')

interface AppState {
  board: BoardState
  verified: Exhibit[]
  quarantinedIds: Set<string>
  verdict: Verdict | 'PENDING'
  toolLog: string[]
  lastReceipt: SealedReceiptEnvelope | null
}

const state: AppState = {
  board: createBoard(),
  verified: [],
  quarantinedIds: new Set<string>(),
  verdict: 'PENDING',
  toolLog: [],
  lastReceipt: null
}

// --- element refs -----------------------------------------------------------

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id)
  if (!node) throw new Error(`missing #${id} in index.html`)
  return node as T
}

const els = {
  webmcpStatus: byId<HTMLSpanElement>('webmcp-status'),
  clusterStatus: byId<HTMLSpanElement>('agent-cluster-status'),
  banner: byId<HTMLDivElement>('unsupported-banner'),
  bannerSim: byId<HTMLButtonElement>('btn-run-sim-banner'),
  copyBtn: byId<HTMLButtonElement>('btn-copy-judge-prompt'),
  copyFeedback: byId<HTMLSpanElement>('copy-feedback'),
  verdictStamp: byId<HTMLDivElement>('verdict-stamp'),
  log: byId<HTMLOListElement>('tool-log'),
  grid: byId<HTMLDivElement>('exhibit-grid'),
  sealBtn: byId<HTMLButtonElement>('btn-seal-receipt'),
  modalBackdrop: byId<HTMLDivElement>('seal-modal-backdrop'),
  receiptPreview: byId<HTMLPreElement>('seal-receipt-preview'),
  downloadBtn: byId<HTMLButtonElement>('btn-download-receipt'),
  closeModalBtn: byId<HTMLButtonElement>('btn-close-modal'),
  simRibbon: byId<HTMLDivElement>('sim-ribbon')
}

// --- logging ----------------------------------------------------------------

function log(tag: LogTag, text: string): void {
  state.toolLog.push(`[${tag}] ${text}`)
  appendLog(els.log, tag, text)
}

// --- board ------------------------------------------------------------------

function addToBoardFromAgent(exhibitId: string, stance: 'supports' | 'contradicts') {
  const result = applyAgentAction(state.board, { action: 'add', exhibit_id: exhibitId, stance })
  if (result.ok) {
    state.board = result.board
    renderGrid()
  }
  return result
}

function humanAction(kind: 'pin' | 'remove' | 'reject', exhibitId: string): void {
  const result = applyHumanAction(state.board, { action: kind, exhibit_id: exhibitId })
  if (result.ok) {
    state.board = result.board
    log('HUMAN', `${kind} ${exhibitId}`)
    renderGrid()
  } else {
    log('ERR', `human ${kind} ${exhibitId} refused: ${result.reason}`)
  }
}

function renderGrid(): void {
  renderExhibitGrid(els.grid, state.verified, state.board, state.quarantinedIds, {
    onPin: (id) => humanAction('pin', id),
    onRemove: (id) => humanAction('remove', id),
    onReject: (id) => humanAction('reject', id)
  })
}

// --- verdict ----------------------------------------------------------------

function applyVerdict(evaluation: ClaimEvaluation): void {
  state.verdict = evaluation.verdict
  setVerdict(els.verdictStamp, evaluation)
}

// --- simulated lane ---------------------------------------------------------

let simRunning = false

async function runSimulated(): Promise<void> {
  if (simRunning) return
  simRunning = true
  els.simRibbon.hidden = false
  try {
    await runSimulatedAgent(
      {
        exhibits: () => state.verified,
        log: (text) => log('SIM', text),
        onVerdict: applyVerdict,
        addToBoard: (id, stance) => addToBoardFromAgent(id, stance)
      },
      { signal: undefined }
    )
  } catch (err) {
    if ((err as Error)?.name !== 'AbortError') {
      log('ERR', `simulated review failed: ${(err as Error)?.message ?? String(err)}`)
    }
  } finally {
    simRunning = false
    els.simRibbon.hidden = true
  }
}

// --- judge prompt copy ------------------------------------------------------

async function copyJudgePrompt(): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(JUDGE_PROMPT)
    } else {
      const ta = document.createElement('textarea')
      ta.value = JUDGE_PROMPT
      ta.setAttribute('readonly', 'true')
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
    els.copyFeedback.textContent = 'PROMPT COPIED TO CLIPBOARD'
  } catch {
    els.copyFeedback.textContent = 'COPY FAILED — GRANT CLIPBOARD PERMISSION OR COPY FROM README'
  }
  setTimeout(() => {
    els.copyFeedback.textContent = ''
  }, 4000)
}

// --- sealing ----------------------------------------------------------------

function makeEphemeralSigner() {
  // The build-time key never ships, so session receipts are signed by an
  // ephemeral locally-generated Ed25519 keypair. Tamper-evident, not tamper-proof.
  const priv = ed25519.utils.randomPrivateKey()
  return {
    sign: (payload: Uint8Array) => ed25519.sign(payload, priv),
    publicKey: () => ed25519.getPublicKey(priv)
  }
}

async function sealReceipt(): Promise<void> {
  try {
    const accepted = state.board.entries
      .filter((e) => e.status !== 'rejected')
      .map((e) => {
        const exhibit = state.verified.find((v) => v.id === e.exhibit_id)
        return {
          exhibit_id: e.exhibit_id,
          title: exhibit?.title ?? '(unknown)',
          span_sha256s: exhibit ? exhibit.spans.map((s) => s.sha256) : []
        }
      })

    const envelope = await buildSealedReceipt(
      {
        sealedAt: new Date().toISOString(),
        claimText: HERO_CLAIM,
        verdict: state.verdict,
        acceptedEvidence: accepted,
        toolLog: state.toolLog,
        manifestPublicKey: MANIFEST.publicKey,
        manifestSignature: MANIFEST.signature
      },
      makeEphemeralSigner()
    )

    state.lastReceipt = envelope
    els.receiptPreview.textContent = JSON.stringify(envelope, null, 2)
    els.modalBackdrop.hidden = false
    els.closeModalBtn.focus()
    log('HUMAN', `receipt sealed over ${accepted.length} accepted exhibits`)
  } catch (err) {
    log('ERR', `seal failed: ${(err as Error)?.message ?? String(err)}`)
  }
}

function downloadReceipt(): void {
  if (!state.lastReceipt) return
  const blob = new Blob([JSON.stringify(state.lastReceipt, null, 2)], {
    type: 'application/json'
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `evidence-desk-receipt-${Date.now()}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
  log('HUMAN', 'receipt JSON downloaded')
}

function closeModal(): void {
  els.modalBackdrop.hidden = true
}

// --- boot -------------------------------------------------------------------

async function boot(): Promise<void> {
  log('SYS', 'verifying signed manifest client-side')

  // Runtime check of origin agent cluster — headers alone are not trusted.
  const cluster = (window as unknown as { originAgentCluster?: boolean }).originAgentCluster
  els.clusterStatus.textContent =
    cluster === true ? 'AGENT CLUSTER: ?1 CONFIRMED' : 'AGENT CLUSTER: NOT CONFIRMED'
  els.clusterStatus.className = `badge ${cluster === true ? 'badge-ok' : 'badge-neutral'}`

  const report = await verifyManifest(MANIFEST)
  state.verified = report.verified
  state.quarantinedIds = new Set(report.quarantined.map((q) => q.exhibit_id))

  if (!report.manifestSignatureValid) {
    log('ERR', 'MANIFEST MISMATCH — signature invalid; all exhibits quarantined')
  } else if (report.quarantined.length > 0) {
    log(
      'ERR',
      `span hash mismatch — quarantined: ${report.quarantined.map((q) => q.exhibit_id).join(', ')}`
    )
  } else {
    log('SYS', `SIG VERIFIED — ${report.verified.length} exhibits intact`)
  }

  renderGrid()

  // WebMCP progressive enhancement.
  const docLike = document as unknown as { modelContext?: ModelContextLike }
  const ctx: ToolContext = {
    exhibits: () => state.verified,
    addToBoard: (id, stance) => addToBoardFromAgent(id, stance)
  }
  const registration = await registerEvidenceTools(docLike, ctx)

  if (!registration.supported) {
    els.webmcpStatus.textContent = 'WEBMCP: UNAVAILABLE'
    els.banner.hidden = false
    log('SYS', 'document.modelContext absent — tools not registered; simulated lane available')
    return
  }

  const failures = registration.outcomes.filter((o) => !o.ok)
  if (failures.length === 0) {
    els.webmcpStatus.textContent = 'WEBMCP: ACTIVE (4 TOOLS)'
    els.webmcpStatus.className = 'badge badge-active'
  } else {
    els.webmcpStatus.textContent = `WEBMCP: DEGRADED (${failures.length} FAILED)`
    els.webmcpStatus.className = 'badge badge-fail'
  }
  for (const outcome of registration.outcomes) {
    log(
      'WEBMCP',
      outcome.ok
        ? `registered ${outcome.name}`
        : `register ${outcome.name} failed (${outcome.errorKind}): ${outcome.message ?? ''}`
    )
  }
}

// --- wiring -----------------------------------------------------------------

els.copyBtn.addEventListener('click', () => void copyJudgePrompt())
els.sealBtn.addEventListener('click', () => void sealReceipt())
els.downloadBtn.addEventListener('click', downloadReceipt)
els.closeModalBtn.addEventListener('click', closeModal)
els.bannerSim.addEventListener('click', () => void runSimulated())
els.simRibbon.addEventListener('click', () => {})

els.modalBackdrop.addEventListener('click', (e) => {
  if (e.target === els.modalBackdrop) closeModal()
})

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !els.modalBackdrop.hidden) {
    closeModal()
    els.sealBtn.focus()
    return
  }
  const modalOpen = !els.modalBackdrop.hidden
  if (modalOpen) return
  if (e.key === 'ArrowRight') cycleExhibits(els.grid, 1)
  if (e.key === 'ArrowLeft') cycleExhibits(els.grid, -1)
})

void boot()
