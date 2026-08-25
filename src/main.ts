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
import { buildSealedReceipt, collectAcceptedEvidence } from './domain/receipt.ts'
import { evaluateClaim } from './domain/evaluate.ts'
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

// Self-contained: embeds the claim so it works even where this page's tools
// are unreachable, names the exact tools, and sets the expectation line so a
// judge knows what should happen after pasting.
const JUDGE_PROMPT = [
  'Review this contested procurement claim using the Evidence Desk page open in your agent browser:',
  `CLAIM: "${HERO_CLAIM}"`,
  'Use the page\'s WebMCP tools:',
  "1. search_evidence — find exhibits relevant to the claim.",
  '2. inspect_exhibit — read exact source spans (start with EX-001 vendor attestation and EX-002 inspection report).',
  "3. evaluate_claim — test the claim and return SUPPORTED / CONTRADICTED / INSUFFICIENT with span-tied reasons.",
  "4. update_caseboard — action:'add' with exhibit_id and stance (supports|contradicts).",
  'Expected flow: search first, inspect both sides, then evaluate; exhibits you add appear on the caseboard.',
  'Pin, remove, reject, and seal are human-exclusive controls.'
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
  sealStatus: byId<HTMLSpanElement>('seal-status'),
  simInline: byId<HTMLButtonElement>('btn-run-sim-inline'),
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

/** Visible, non-log-only status for the seal affordance (cycle-1 UX hardening). */
let sealStatusTimer: ReturnType<typeof setTimeout> | undefined
function showSealStatus(text: string): void {
  els.sealStatus.textContent = text
  if (sealStatusTimer) clearTimeout(sealStatusTimer)
  if (text) {
    sealStatusTimer = setTimeout(() => {
      els.sealStatus.textContent = ''
    }, 8000)
  }
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
  // Cycle-1 hardening: sealing is refused until an evaluation exists, and the
  // receipt is rebuilt from the ACCEPTED set at seal time so verdict and
  // accepted_evidence can never disagree.
  if (state.verdict === 'PENDING') {
    showSealStatus('SEAL REFUSED — run the review first (agent or simulated), then seal.')
    log('ERR', 'seal refused: no evaluation yet (verdict PENDING)')
    return
  }

  const { accepted, refused } = collectAcceptedEvidence(
    state.board.entries,
    state.verified,
    state.quarantinedIds
  )
  for (const r of refused) {
    log('ERR', `seal excluded ${r.exhibit_id}: ${r.reason}`)
  }
  if (refused.length > 0) {
    showSealStatus(`SEAL PARTIAL — ${refused.length} board item(s) not SIG VERIFIED were excluded.`)
  }

  try {
    const acceptedExhibits = accepted
      .map((a) => state.verified.find((v) => v.id === a.exhibit_id))
      .filter((v): v is Exhibit => Boolean(v))
    const sealedVerdict =
      acceptedExhibits.length > 0
        ? evaluateClaim(HERO_CLAIM, acceptedExhibits).verdict
        : state.verdict

    const envelope = await buildSealedReceipt(
      {
        sealedAt: new Date().toISOString(),
        claimText: HERO_CLAIM,
        verdict: sealedVerdict,
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
    lastFocusedBeforeModal = document.activeElement as HTMLElement | null
    els.closeModalBtn.focus()
    showSealStatus('')
    log('HUMAN', `receipt sealed over ${accepted.length} accepted exhibits`)
  } catch (err) {
    showSealStatus('SEAL FAILED — see tool log.')
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

/** Cycle-1 a11y: trap Tab inside the open modal; restore focus on close. */
let lastFocusedBeforeModal: HTMLElement | null = null

function closeModal(): void {
  els.modalBackdrop.hidden = true
  // Focus restore on EVERY close path — Esc handler and Close button share this.
  lastFocusedBeforeModal?.focus()
  lastFocusedBeforeModal = null
}

function trapModalFocus(e: KeyboardEvent): void {
  if (e.key !== 'Tab' || els.modalBackdrop.hidden) return
  const focusables = Array.from(
    els.modalBackdrop.querySelectorAll<HTMLElement>('button, [href], [tabindex]:not([tabindex="-1"])')
  ).filter((n) => !n.hasAttribute('disabled'))
  if (focusables.length === 0) return
  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  if (!first || !last) return
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first.focus()
  }
}

// --- boot -------------------------------------------------------------------

async function boot(): Promise<void> {
  els.verdictStamp.textContent = 'VERIFYING EVIDENCE…'
  log('SYS', 'verifying signed manifest client-side')

  // Runtime check of origin agent cluster — headers alone are not trusted.
  const cluster = (window as unknown as { originAgentCluster?: boolean }).originAgentCluster
  els.clusterStatus.textContent =
    cluster === true ? 'AGENT CLUSTER: CONFIRMED' : 'AGENT CLUSTER: NOT CONFIRMED'
  els.clusterStatus.className = `badge ${cluster === true ? 'badge-ok' : 'badge-neutral'}`

  const report = await verifyManifest(MANIFEST)
  state.verified = report.verified
  state.quarantinedIds = new Set(report.quarantined.map((q) => q.exhibit_id))
  els.verdictStamp.textContent = 'VERDICT: PENDING REVIEW'

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

  // WebMCP progressive enhancement. The registration signal doubles as the
  // page-lifetime unregister path (spec §5) — exercised, not just supported.
  const bootController = new AbortController()
  window.addEventListener('pagehide', () => bootController.abort(), { once: true })
  const docLike = document as unknown as { modelContext?: ModelContextLike }
  const ctx: ToolContext = {
    exhibits: () => state.verified,
    addToBoard: (id, stance) => addToBoardFromAgent(id, stance)
  }
  const registration = await registerEvidenceTools(docLike, ctx, {
    signal: bootController.signal
  })

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
els.simInline.addEventListener('click', () => void runSimulated())
els.simRibbon.addEventListener('click', () => {})

// Simulated lane is reachable even when WebMCP IS present (cycle-1 UX hardening):
// a judge whose agent path fails still gets the full review flow, honestly labeled.
els.simInline.hidden = false

els.modalBackdrop.addEventListener('click', (e) => {
  if (e.target === els.modalBackdrop) closeModal()
})

document.addEventListener('keydown', (e) => {
  trapModalFocus(e)
  if (e.key === 'Escape' && !els.modalBackdrop.hidden) {
    closeModal()
    return
  }
  const modalOpen = !els.modalBackdrop.hidden
  if (modalOpen) return
  if (e.key === 'ArrowRight') cycleExhibits(els.grid, 1)
  if (e.key === 'ArrowLeft') cycleExhibits(els.grid, -1)
})

void boot()
