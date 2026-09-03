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
import { buildSealedReceipt, collectAcceptedEvidence, verifySealedReceiptEnvelope } from './domain/receipt.ts'
import { buildForgedExhibitCandidate, probeForgedExhibit } from './domain/forge.ts'
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
  renderReceiptPreview,
  renderReceiptSummary,
  selectPrimaryExhibits,
  setVerdict,
  type LogTag
} from './ui/caseboard.ts'
import { renderTimeline } from './ui/timeline.ts'
import { el } from './ui/dom.ts'
import { ed25519 } from '@noble/curves/ed25519.js'

const HERO_CLAIM = 'Did the vendor provide the required inspection report before acceptance?'

// Self-contained: embeds the claim so it works even where this page's tools
// are unreachable, names the exact tools, and sets the expectation line so a
// judge knows what should happen after pasting.
const JUDGE_PROMPT = [
  'Review this contested procurement claim using the Evidence Desk page open in your agent browser:',
  `CLAIM: "${HERO_CLAIM}"`,
  'Use the page\'s WebMCP tools:',
  '1. search_evidence — find relevant exhibits.',
  '2. inspect_exhibit — read exact source spans (start with EX-001, EX-002).',
  '3. evaluate_claim — return SUPPORTED / CONTRADICTED / INSUFFICIENT with span-tied reasons.',
  "4. update_caseboard — action:'add' with exhibit_id and stance (supports|contradicts).",
  'Expected flow: search first, inspect both sides, then evaluate; added exhibits appear on the caseboard.',
  'Pin, remove, reject, and seal are human-exclusive controls.'
].join('\n')

interface AppState {
  board: BoardState
  verified: Exhibit[]
  /** Exhibits caught forged in-session; rendered quarantined, never evaluated. */
  forged: Exhibit[]
  quarantinedIds: Set<string>
  verdict: Verdict | 'PENDING'
  verdictAccepted: boolean
  proposalCount: number
  toolLog: string[]
  lastReceipt: SealedReceiptEnvelope | null
}

const state: AppState = {
  board: createBoard(),
  verified: [],
  forged: [],
  quarantinedIds: new Set<string>(),
  verdict: 'PENDING',
  verdictAccepted: false,
  proposalCount: 0,
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
  reviewStatus: byId<HTMLElement>('review-status'),
  reviewStatusDetail: byId<HTMLElement>('review-status-detail'),
  verdictStamp: byId<HTMLDivElement>('verdict-stamp'),
  log: byId<HTMLOListElement>('tool-log'),
  grid: byId<HTMLDivElement>('exhibit-grid'),
  packetGrid: byId<HTMLDivElement>('packet-grid'),
  timeline: byId<HTMLDivElement>('timeline-spine'),
  acceptVerdictBtn: byId<HTMLButtonElement>('btn-accept-verdict'),
  verdictAcceptStatus: byId<HTMLSpanElement>('verdict-accept-status'),
  sealBtn: byId<HTMLButtonElement>('btn-seal-receipt'),
  sealStatus: byId<HTMLSpanElement>('seal-status'),
  verifyReceiptBtn: byId<HTMLButtonElement>('btn-verify-receipt'),
  receiptVerifyStatus: byId<HTMLSpanElement>('receipt-verify-status'),
  simInline: byId<HTMLButtonElement>('btn-run-sim-inline'),
  modalBackdrop: byId<HTMLDivElement>('seal-modal-backdrop'),
  receiptSummary: byId<HTMLDivElement>('receipt-summary'),
  receiptPreview: byId<HTMLPreElement>('seal-receipt-preview'),
  downloadBtn: byId<HTMLButtonElement>('btn-download-receipt'),
  closeModalBtn: byId<HTMLButtonElement>('btn-close-modal'),
  simRibbon: byId<HTMLDivElement>('sim-ribbon'),
  forgeOpenBtn: byId<HTMLButtonElement>('btn-open-forge-bench'),
  forgeResetBtn: byId<HTMLButtonElement>('btn-reset-case'),
  forgeBackdrop: byId<HTMLDivElement>('forge-bench-backdrop'),
  forgeBenchTitle: byId<HTMLHeadingElement>('forge-bench-title'),
  forgeEditors: byId<HTMLDivElement>('forge-span-editors'),
  forgeSubmitBtn: byId<HTMLButtonElement>('btn-submit-forgery'),
  forgeCloseBtn: byId<HTMLButtonElement>('btn-close-forge-bench'),
  forgeStatus: byId<HTMLSpanElement>('forge-status')
}

// --- logging ----------------------------------------------------------------

function log(tag: LogTag, text: string): void {
  if (state.toolLog.length >= MAX_LOG_ENTRIES) {
    // Drop oldest half; mark the truncation so sealed receipts disclose it.
    const dropped = state.toolLog.length - Math.floor(MAX_LOG_ENTRIES / 2)
    state.toolLog.splice(0, dropped)
    state.toolLog.unshift(`[SYS] log truncated — ${dropped} oldest entries dropped`)
    while (els.log.children.length > Math.floor(MAX_LOG_ENTRIES / 2) + 1) {
      els.log.firstChild?.remove()
    }
  }
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

// Cycle-2 hardening: bounded session history. The receipt embeds the full log,
// so an uncapped log means an unbounded receipt on long judge sessions.
const MAX_LOG_ENTRIES = 400

function setReviewStatus(status: string, detail: string): void {
  els.reviewStatus.textContent = status
  els.reviewStatusDetail.textContent = detail
}

// --- board ------------------------------------------------------------------

// P0 exhibit arrival: exhibit ids whose agent-add has not yet played its
// one-time mount animation. Populated ONLY on the agent add path — persisted
// and pre-loaded exhibits never animate (anti-pattern A2).
const pendingArrival = new Set<string>()

function addToBoardFromAgent(exhibitId: string, stance: 'supports' | 'contradicts') {
  // Cycle-2 hardening: referential gate at the agent boundary — the agent may
  // only propose exhibits that are SIG VERIFIED, never quarantined ones.
  const known = state.verified.some((v) => v.id === exhibitId)
  if (!known || state.quarantinedIds.has(exhibitId)) {
    return {
      ok: false as const,
      board: state.board,
      reason: `exhibit_not_verified:${exhibitId}`
    }
  }
  const result = applyAgentAction(state.board, { action: 'add', exhibit_id: exhibitId, stance })
  if (result.ok) {
    state.board = result.board
    state.proposalCount += 1
    invalidateVerdictAcceptance('Agent proposal changed — review the final verdict again.')
    pendingArrival.add(exhibitId)
    renderGrid()
  } else if (result.reason !== 'duplicate_entry') {
    log('ERR', `agent add ${exhibitId} refused: ${result.reason}`)
  }
  return result
}

function humanAction(kind: 'pin' | 'remove' | 'reject', exhibitId: string): void {
  const result = applyHumanAction(state.board, { action: kind, exhibit_id: exhibitId })
  if (result.ok) {
    state.board = result.board
    invalidateVerdictAcceptance('Evidence changed — review the final verdict again.')
    log('HUMAN', `${kind} ${exhibitId}`)
    renderGrid()
  } else {
    log('ERR', `human ${kind} ${exhibitId} refused: ${result.reason}`)
  }
}

function renderGrid(): void {
  // Forged exhibits caught this session render AFTER the verified set: their
  // ids sit in quarantinedIds, so caseboard gives them the SIG FAILED badge,
  // no controls, and the quarantine treatment — the tamper machinery itself.
  const allExhibits = [...state.verified, ...state.forged]
  const callbacks = {
    onPin: (id: string) => humanAction('pin', id),
    onRemove: (id: string) => humanAction('remove', id),
    onReject: (id: string) => humanAction('reject', id)
  }
  renderExhibitGrid(
    els.grid,
    selectPrimaryExhibits(allExhibits, state.board, state.quarantinedIds),
    state.board,
    state.quarantinedIds,
    callbacks,
    { arriveIds: pendingArrival }
  )
  renderExhibitGrid(
    els.packetGrid,
    allExhibits,
    state.board,
    state.quarantinedIds,
    callbacks,
    { arriveIds: pendingArrival }
  )
  // One mount, one animation: clear so later re-renders (pin/remove/reject)
  // rebuild these cards in their final state with no replay.
  pendingArrival.clear()
}

// --- verdict ----------------------------------------------------------------

/** P0 signature sequence: the stamp SLAMs (caseboard) and the board shakes. */
function shakeBoard(): void {
  const boardCard = els.grid.closest<HTMLElement>('.board-card')
  if (!boardCard) return
  boardCard.classList.remove('board-shake')
  void boardCard.offsetWidth
  boardCard.classList.add('board-shake')
  boardCard.addEventListener(
    'animationend',
    () => boardCard.classList.remove('board-shake'),
    { once: true }
  )
}

function applyVerdict(evaluation: ClaimEvaluation): void {
  state.verdict = evaluation.verdict
  state.verdictAccepted = false
  setVerdict(els.verdictStamp, evaluation)
  els.acceptVerdictBtn.disabled = false
  els.acceptVerdictBtn.textContent = 'ACCEPT AGENT VERDICT'
  els.verdictAcceptStatus.textContent = `Agent proposes ${evaluation.verdict}. Human acceptance required.`
  setReviewStatus(
    'AGENT ANALYSIS COMPLETE — YOUR DECISION IS REQUIRED',
    `${evaluation.reasons.length} source-tied reason${evaluation.reasons.length === 1 ? '' : 's'} returned. Review the board below.`
  )
  shakeBoard()
}

function invalidateVerdictAcceptance(message: string): void {
  if (!state.verdictAccepted) return
  state.verdictAccepted = false
  els.acceptVerdictBtn.disabled = state.verdict === 'PENDING'
  els.acceptVerdictBtn.textContent = 'ACCEPT AGENT VERDICT'
  els.verdictAcceptStatus.textContent = message
}

function acceptVerdict(): void {
  if (state.verdict === 'PENDING') {
    els.verdictAcceptStatus.textContent = 'No agent verdict exists yet.'
    return
  }
  state.verdictAccepted = true
  els.acceptVerdictBtn.disabled = true
  els.acceptVerdictBtn.textContent = 'VERDICT ACCEPTED BY HUMAN'
  els.verdictAcceptStatus.textContent = `${state.verdict} accepted by human. Receipt can now be sealed.`
  setReviewStatus('HUMAN DECISION RECORDED', `${state.verdict} accepted — ready to seal locally.`)
  log('HUMAN', `accepted final verdict: ${state.verdict}`)
}

// --- simulated lane ---------------------------------------------------------

let simRunning = false

async function runSimulated(): Promise<void> {
  if (simRunning) return
  // Cycle-4: refuse a pre-boot or empty-corpus run — reviewing zero exhibits
  // produces a misleading INSUFFICIENT that reads as broken.
  if (state.verified.length === 0) {
    showSealStatus('EVIDENCE NOT VERIFIED YET — retry once SIG VERIFIED appears in the log.')
    log('ERR', 'simulated review refused: evidence not verified yet')
    return
  }
  simRunning = true
  els.simRibbon.hidden = false
  setReviewStatus('GUIDED REPLAY RUNNING', 'Simulated lane is labeled and does not count as WebMCP proof.')
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
    els.copyFeedback.textContent =
      'PROMPT COPIED — paste into your agent with this page open; expect tool calls to appear in the log'
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

// Cycle-2 hardening: one seal at a time. buildSealedReceipt yields internally,
// so rapid clicks interleave without this gate and sign duplicate/divergent receipts.
let sealInFlight = false

async function sealReceipt(): Promise<void> {
  if (sealInFlight) return
  // Forge-demo hardening: compromised evidence refuses the seal outright.
  // collectAcceptedEvidence would exclude quarantined entries, but a session
  // that contains caught forgeries does not get a clean receipt — fail closed.
  if (state.quarantinedIds.size > 0) {
    showSealStatus('SEAL REFUSED — board contains quarantined material.')
    log('ERR', `seal refused: quarantined material present (${[...state.quarantinedIds].join(', ')})`)
    return
  }
  // Cycle-1 hardening: sealing is refused until an evaluation exists, and the
  // receipt is rebuilt from the ACCEPTED set at seal time so verdict and
  // accepted_evidence can never disagree.
  if (state.verdict === 'PENDING') {
    showSealStatus('SEAL REFUSED — run the review first (agent or simulated), then seal.')
    log('ERR', 'seal refused: no evaluation yet (verdict PENDING)')
    return
  }
  if (!state.verdictAccepted) {
    showSealStatus('SEAL REFUSED — a human must accept the final verdict first.')
    log('ERR', 'seal refused: final verdict has not been accepted by a human')
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
    showSealStatus(`SEAL PARTIAL — ${refused.length} board entries lacked SIG VERIFIED and were excluded.`)
  }

  sealInFlight = true
  try {
    const envelope = await buildSealedReceipt(
      {
        sealedAt: new Date().toISOString(),
        sessionId: sessionId(),
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
    renderReceiptSummary(els.receiptSummary, {
      verdict: envelope.receipt.verdict as Verdict,
      proposedCount: state.proposalCount,
      acceptedCount: accepted.length,
      rejectedCount: state.board.entries.filter((entry) => entry.status === 'rejected').length
    })
    renderReceiptPreview(els.receiptPreview, JSON.stringify(envelope, null, 2))
    els.modalBackdrop.hidden = false
    lastFocusedBeforeModal = document.activeElement as HTMLElement | null
    els.closeModalBtn.focus()
    showSealStatus('')
    log('HUMAN', `receipt sealed over ${accepted.length} accepted exhibits`)
  } catch (err) {
    showSealStatus('SEAL FAILED — see tool log.')
    log('ERR', `seal failed: ${(err as Error)?.message ?? String(err)}`)
  } finally {
    sealInFlight = false
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

/** Cycle-3: re-verify the sealed envelope on demand and show the verdict. */
async function verifyLastReceipt(): Promise<void> {
  if (!state.lastReceipt) return
  els.receiptVerifyStatus.textContent = 'VERIFYING RECEIPT…'
  setWaxSeal(false)
  const result = await verifySealedReceiptEnvelope(state.lastReceipt, {
    manifestExhibits: MANIFEST.exhibits,
    expectedManifestPublicKey: MANIFEST.publicKey
  })
  const pass = result.signatureValid === true && result.hashesAnchoredInManifest === true
  if (pass) {
    els.receiptVerifyStatus.textContent =
      'RECEIPT VERIFY PASS — internal signature valid; accepted hashes anchored in the signed manifest'
  } else {
    els.receiptVerifyStatus.textContent = `RECEIPT VERIFY FAILED — ${result.problems.join('; ') || 'signature invalid'}`
  }
  setWaxSeal(pass)
}

/** P2 archival finish: conic-gradient wax-disc motif beside PASS results.
 * Decorative only — aria-hidden, removed on any non-PASS result. */
function setWaxSeal(pass: boolean): void {
  els.receiptVerifyStatus.parentElement?.querySelector('.wax-seal')?.remove()
  if (!pass) return
  const wax = el('span', 'wax-seal')
  wax.setAttribute('aria-hidden', 'true')
  els.receiptVerifyStatus.before(wax)
}

/** Cycle-1 a11y: trap Tab inside an open modal; restore focus on close. */
let lastFocusedBeforeModal: HTMLElement | null = null

function closeModal(): void {
  els.modalBackdrop.hidden = true
  // Focus restore on EVERY close path — Esc handler and Close button share this.
  lastFocusedBeforeModal?.focus()
  lastFocusedBeforeModal = null
}

function trapModalFocus(e: KeyboardEvent, backdrop: HTMLElement): void {
  if (e.key !== 'Tab' || backdrop.hidden) return
  const focusables = Array.from(
    backdrop.querySelectorAll<HTMLElement>(
      'button, [href], [tabindex]:not([tabindex="-1"]), textarea'
    )
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

// --- forgery bench -----------------------------------------------------------
//
// The adversarial challenge: the judge edits EX-002's exact signed spans and
// submits. The probe recomputes each span's sha256 — what the hash WOULD be —
// and compares it to the hash the manifest actually recorded. Any edit fails
// by construction, and the full caught sequence fires: quarantined card with
// arrival animation, board shake, INSUFFICIENT verdict, sealed-shut seal gate.

const FORGE_TARGET_ID = 'EX-002'
let lastFocusedBeforeForge: HTMLElement | null = null

function openForgeBench(): void {
  const base = MANIFEST.exhibits.find((e) => e.id === FORGE_TARGET_ID)
  if (!base) return
  // The bench always loads the PRISTINE signed spans from the manifest —
  // never session state — so every attempt starts from what was signed.
  els.forgeBenchTitle.textContent = `Forgery bench — ${base.id} · ${base.title}`
  els.forgeEditors.textContent = ''
  for (const span of base.spans) {
    const field = el('div', 'forge-span-field')
    const label = el(
      'label',
      'forge-span-label',
      `${span.span_id} · signed sha256 ${span.sha256.slice(0, 16)}…`
    )
    label.setAttribute('for', `forge-input-${span.span_id}`)
    const ta = document.createElement('textarea')
    ta.id = `forge-input-${span.span_id}`
    ta.dataset.spanId = span.span_id
    ta.value = span.text
    ta.setAttribute('spellcheck', 'false')
    field.append(label, ta)
    els.forgeEditors.appendChild(field)
  }
  els.forgeStatus.textContent = ''
  els.forgeBackdrop.hidden = false
  lastFocusedBeforeForge = document.activeElement as HTMLElement | null
  const firstEditor = els.forgeEditors.querySelector<HTMLTextAreaElement>('textarea')
  ;(firstEditor ?? els.forgeCloseBtn).focus()
}

function closeForgeBench(): void {
  els.forgeBackdrop.hidden = true
  lastFocusedBeforeForge?.focus()
  lastFocusedBeforeForge = null
}

async function submitForgery(): Promise<void> {
  const base = MANIFEST.exhibits.find((e) => e.id === FORGE_TARGET_ID)
  if (!base) return
  if (state.quarantinedIds.has(FORGE_TARGET_ID)) {
    els.forgeStatus.textContent =
      'EX-002 IS ALREADY QUARANTINED — reset the case to forge again.'
    return
  }
  const editedTexts = base.spans.map((span) => {
    const ta = els.forgeEditors.querySelector<HTMLTextAreaElement>(
      `textarea[data-span-id="${span.span_id}"]`
    )
    return ta ? ta.value : span.text
  })
  const candidate = buildForgedExhibitCandidate(base, editedTexts)
  const report = await probeForgedExhibit(candidate)

  if (!report.caught || report.failed_span_id === null) {
    els.forgeStatus.textContent =
      'NOTHING TO CATCH — every span still matches its signed hash. Edit something and submit again.'
    log('HUMAN', 'forgery submitted — bytes matched the manifest; nothing forged yet')
    return
  }

  // CAUGHT. The forged card lands on the board quarantined so the judge sees
  // exactly what got caught; evaluation never touches forged bytes because
  // they live outside state.verified.
  const failedSpanId = report.failed_span_id
  const failedProbe = report.probes.find((p) => p.span_id === failedSpanId)
  state.verified = state.verified.filter((v) => v.id !== FORGE_TARGET_ID)
  state.quarantinedIds.add(FORGE_TARGET_ID)
  state.forged.push(candidate)
  pendingArrival.add(FORGE_TARGET_ID)
  renderGrid()
  renderTimeline(els.timeline, state.verified)
  log('ERR', `CAUGHT — span hash mismatch on ${failedSpanId} — ${FORGE_TARGET_ID} quarantined`)
  if (failedProbe) {
    log(
      'ERR',
      `sha256(${failedSpanId}) recomputed ${failedProbe.recomputed_sha256.slice(0, 16)}… ≠ recorded ${failedProbe.recorded_sha256.slice(0, 16)}…`
    )
  }
  applyVerdict({
    verdict: 'INSUFFICIENT',
    reasons: [],
    missing: ['integrity: forged exhibit rejected']
  })
  els.forgeResetBtn.hidden = false
  const survivors = state.verified.length
  els.forgeStatus.textContent =
    `CAUGHT — span hash mismatch on ${failedSpanId}. Your edit changed bytes the manifest never signed. ` +
    `The other ${survivors} exhibits remain SIG VERIFIED.`
}

/** RESET CASE: pristine board, PENDING verdict, original verified exhibits. */
async function resetCase(): Promise<void> {
  try {
    const report = await verifyManifest(MANIFEST)
    state.verified = report.verified
    state.quarantinedIds = new Set(report.quarantined.map((q) => q.exhibit_id))
    state.forged = []
    state.board = createBoard()
    state.verdict = 'PENDING'
    state.verdictAccepted = false
    state.proposalCount = 0
    pendingArrival.clear()
    els.verdictStamp.textContent = 'VERDICT: PENDING REVIEW'
    els.verdictStamp.className = 'verdict-stamp verdict-pending'
    els.acceptVerdictBtn.disabled = true
    els.acceptVerdictBtn.textContent = 'ACCEPT AGENT VERDICT'
    els.verdictAcceptStatus.textContent = 'Awaiting an agent evaluation.'
    setReviewStatus('AWAITING AGENT', 'Copy the briefing to start a real WebMCP review.')
    renderGrid()
    renderTimeline(els.timeline, state.verified)
    closeForgeBench()
    els.forgeStatus.textContent = ''
    els.forgeResetBtn.hidden = true
    log('SYS', 'case reset — pristine signed exhibits restored')
  } catch (err) {
    log('ERR', `case reset failed: ${(err as Error)?.message ?? String(err)}`)
    showSealStatus('RESET FAILED — see tool log.')
  }
}

// --- boot -------------------------------------------------------------------

/** P0 hash-verification sweep: one shimmer pass across each exhibit id/hash
 * line, staggered 60ms per card, terminating solid. Runs ONCE after
 * verifyManifest passes; later re-renders never re-add the class. Under the
 * global reduced-motion kill block no animation runs and the class is inert. */
function runHashSweep(): void {
  const idLines = document.querySelectorAll<HTMLElement>('#exhibit-grid .exhibit-id, #packet-grid .exhibit-id')
  idLines.forEach((line, i) => {
    line.classList.add('hash-sweep')
    line.style.animationDelay = `${i * 60}ms`
    line.addEventListener(
      'animationend',
      () => {
        line.classList.remove('hash-sweep')
        line.style.animationDelay = ''
      },
      { once: true }
    )
  })
}

async function boot(): Promise<void> {
  els.verdictStamp.textContent = 'VERIFYING EVIDENCE…'
  log('SYS', 'verifying signed manifest client-side')
  try {
    await bootInner()
  } catch (err) {
    // Cycle-2 hardening: a thrown verify/crypto error must never dead-init the
    // page into a state that LOOKS alive. Surface it and stop clean.
    log('ERR', `boot failed: ${(err as Error)?.message ?? String(err)}`)
    els.verdictStamp.textContent = 'BOOT FAILED — evidence could not be verified'
    els.webmcpStatus.textContent = 'WEBMCP: OFFLINE'
    showSealStatus('BOOT FAILED — reload or run the simulated review.')
  }
}

async function bootInner(): Promise<void> {

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
  runHashSweep()
  renderTimeline(els.timeline, state.verified)

  // Sim button appears only after verification lands (cycle-4 ordering fix).
  els.simInline.hidden = false

  // WebMCP progressive enhancement. The registration signal doubles as the
  // page-lifetime unregister path (spec §5) — exercised, not just supported.
  const bootController = new AbortController()
  window.addEventListener('pagehide', () => bootController.abort(), { once: true })
  const docLike = document as unknown as { modelContext?: ModelContextLike }
  const ctx: ToolContext = {
    exhibits: () => state.verified,
    addToBoard: (id, stance) => addToBoardFromAgent(id, stance),
    onVerdict: applyVerdict,
    onLifecycle: (event) => {
      log('WEBMCP', event.summary)
      if (event.phase === 'started') {
        setReviewStatus('AGENT INVESTIGATING', `${event.toolName} is running…`)
      } else if (event.phase === 'completed' && event.toolName !== 'evaluate_claim') {
        if (state.verdict !== 'PENDING' && event.toolName === 'update_caseboard') {
          setReviewStatus(
            'AGENT ANALYSIS COMPLETE — YOUR DECISION IS REQUIRED',
            'Evidence proposed on the caseboard. Review it, then accept the final verdict.'
          )
        } else {
          els.reviewStatusDetail.textContent = event.summary
        }
      } else if (event.phase === 'refused' || event.phase === 'failed' || event.phase === 'aborted') {
        setReviewStatus(`AGENT CALL ${event.phase.toUpperCase()}`, event.summary)
      }
    }
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
els.acceptVerdictBtn.addEventListener('click', acceptVerdict)
els.sealBtn.addEventListener('click', () => void sealReceipt())
els.downloadBtn.addEventListener('click', downloadReceipt)
els.verifyReceiptBtn.addEventListener('click', () => void verifyLastReceipt())
els.closeModalBtn.addEventListener('click', closeModal)
els.bannerSim.addEventListener('click', () => void runSimulated())
els.simInline.addEventListener('click', () => void runSimulated())
els.simRibbon.addEventListener('click', () => {})
els.forgeOpenBtn.addEventListener('click', openForgeBench)
els.forgeCloseBtn.addEventListener('click', closeForgeBench)
els.forgeSubmitBtn.addEventListener('click', () => void submitForgery())
els.forgeResetBtn.addEventListener('click', () => void resetCase())

els.forgeBackdrop.addEventListener('click', (e) => {
  if (e.target === els.forgeBackdrop) closeForgeBench()
})

// Simulated lane is reachable even when WebMCP IS present (cycle-1 UX hardening),
// but only AFTER boot verification lands (cycle-4): a mid-boot run would review
// zero exhibits and read as broken.
function sessionId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  // Fallback for engines without randomUUID (older WebKit / non-secure ctx).
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  const b6 = bytes[6] ?? 0
  const b8 = bytes[8] ?? 0
  bytes[6] = (b6 & 0x0f) | 0x40
  bytes[8] = (b8 & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

els.modalBackdrop.addEventListener('click', (e) => {
  if (e.target === els.modalBackdrop) closeModal()
})

document.addEventListener('keydown', (e) => {
  trapModalFocus(e, els.modalBackdrop)
  trapModalFocus(e, els.forgeBackdrop)
  if (e.key === 'Escape' && !els.modalBackdrop.hidden) {
    closeModal()
    return
  }
  if (e.key === 'Escape' && !els.forgeBackdrop.hidden) {
    closeForgeBench()
    return
  }
  const modalOpen = !els.modalBackdrop.hidden || !els.forgeBackdrop.hidden
  if (modalOpen) return
  if (e.key === 'ArrowRight') cycleExhibits(els.grid, 1)
  if (e.key === 'ArrowLeft') cycleExhibits(els.grid, -1)
})

void boot()
