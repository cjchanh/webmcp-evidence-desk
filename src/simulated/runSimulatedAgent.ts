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
 */
export async function runSimulatedAgent(
  cb: SimulatedAgentCallbacks,
  opts?: { signal?: AbortSignal }
): Promise<void> {
  const signal = opts?.signal
  const exhibits = cb.exhibits()

  cb.log('simulated review starting over verified evidence')
  await delay(300, signal)

  const hits = searchExhibits('inspection report acceptance attestation', exhibits, { signal })
  cb.log(
    `search_evidence -> ${hits.length} hits: ` +
      hits.map((h) => `${h.exhibit_id}(${h.score})`).join(', ')
  )
  await delay(350, signal)

  for (const id of ['EX-003', 'EX-001', 'EX-002']) {
    try {
      const detail = inspectExhibit(id, exhibits, { signal })
      cb.log(`inspect_exhibit ${id} -> ${detail.spans.length} spans read`)
    } catch {
      cb.log(`inspect_exhibit ${id} -> unavailable (quarantined or absent)`)
    }
    await delay(300, signal)
  }

  const evaluation = evaluateClaim(HERO_CLAIM, exhibits, { signal })
  cb.onVerdict(evaluation)
  cb.log(
    `evaluate_claim -> ${evaluation.verdict}` +
      (evaluation.missing.length ? ` (missing: ${evaluation.missing.join('; ')})` : '')
  )
  await delay(350, signal)

  const additions: Array<[string, Stance]> = [
    ['EX-002', 'contradicts'],
    ['EX-001', 'supports']
  ]
  for (const [exhibitId, stance] of additions) {
    if (!exhibits.some((e) => e.id === exhibitId)) continue
    const result = cb.addToBoard(exhibitId, stance)
    cb.log(
      result.ok
        ? `update_caseboard add ${exhibitId} (${stance}) -> accepted`
        : `update_caseboard add ${exhibitId} -> refused (${result.reason})`
    )
    await delay(300, signal)
  }

  throwIfAborted(signal)
  cb.log('simulated review complete — human adjudication required')
}
