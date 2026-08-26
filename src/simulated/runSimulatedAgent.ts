/**
 * Simulated agent lane.
 *
 * Drives the IDENTICAL domain functions the WebMCP tools call, but is always
 * visually labeled: the SIMULATED AGENT ribbon shows while running and every
 * log line carries the [SIM] tag. This demonstrates the review flow in
 * browsers without WebMCP and is NEVER presented as proof WebMCP executed.
 */

import { searchExhibits } from '../domain/search.ts'
import { inspectExhibit } from '../domain/inspect.ts'
import { evaluateClaim } from '../domain/evaluate.ts'
import { throwIfAborted } from '../domain/errors.ts'
import type { ActionResult } from '../domain/board.ts'
import type {
  ClaimEvaluation,
  Exhibit,
  Stance
} from '../domain/types.ts'

export interface SimulatedAgentCallbacks {
  exhibits(): Exhibit[]
  log(text: string): void
  onVerdict(verdict: ClaimEvaluation): void
  addToBoard(exhibitId: string, stance: Stance): ActionResult
}

const HERO_CLAIM = 'Did the vendor provide the required inspection report before acceptance?'

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('The operation was aborted.', 'AbortError'))
      return
    }
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(new DOMException('The operation was aborted.', 'AbortError'))
      },
      { once: true }
    )
  })
}

/**
 * Review sequence mirroring what a real agent would do with the four tools:
 * search -> inspect both sides of the contradiction -> evaluate -> add to board.
 *
 * Pacing contract: impatient judges see the whole arc fast — total scripted
 * delay budget <= 6s, log lines terse and verb-first.
 */
export async function runSimulatedAgent(
  cb: SimulatedAgentCallbacks,
  opts?: { signal?: AbortSignal }
): Promise<void> {
  const signal = opts?.signal
  const exhibits = cb.exhibits()

  cb.log('searching…')
  await delay(350, signal)

  const hits = searchExhibits('inspection report acceptance attestation', exhibits, { signal })
  cb.log(`found ${hits.length} hits — reading both sides`)
  await delay(300, signal)

  for (const id of ['EX-003', 'EX-001', 'EX-002']) {
    try {
      inspectExhibit(id, exhibits, { signal })
      cb.log(`reading ${id} span r1…`)
    } catch {
      cb.log(`reading ${id}… unavailable (quarantined or absent)`)
    }
    await delay(260, signal)
  }

  const evaluation = evaluateClaim(HERO_CLAIM, exhibits, { signal })
  cb.onVerdict(evaluation)
  cb.log(
    `verdict: ${evaluation.verdict.toLowerCase()}` +
      (evaluation.missing.length ? ` — missing: ${evaluation.missing.join('; ')}` : '')
  )
  await delay(320, signal)

  const additions: Array<[string, Stance]> = [
    ['EX-002', 'contradicts'],
    ['EX-001', 'supports']
  ]
  for (const [exhibitId, stance] of additions) {
    if (!exhibits.some((e) => e.id === exhibitId)) continue
    const result = cb.addToBoard(exhibitId, stance)
    cb.log(
      result.ok
        ? `adding ${exhibitId} (${stance})`
        : `refusing ${exhibitId} (${result.reason})`
    )
    await delay(240, signal)
  }

  throwIfAborted(signal)
  cb.log('complete — your move: pin, reject, seal')
}
