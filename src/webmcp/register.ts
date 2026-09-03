/**
 * WebMCP registration layer — progressive enhancement ONLY.
 *
 * Registers the four frozen tools on document.modelContext when present.
 * Every registerTool call is awaited and individually caught so one bad
 * registration (duplicate name, permission disabled, security error) never
 * breaks the page. When modelContext is absent the app runs fully without
 * WebMCP and this layer reports `supported: false`.
 *
 * All tool outputs are plain JSON strings bounded to <= 1500 chars.
 * Tools that surface corpus-derived text set annotations.untrustedContentHint.
 */

import { searchExhibits } from '../domain/search.ts'
import { inspectExhibit } from '../domain/inspect.ts'
import { CONTESTED_CLAIM, evaluateClaim } from '../domain/evaluate.ts'
import { applyAgentAction, boardSummary, type ActionResult } from '../domain/board.ts'
import { isAbortError, throwIfAborted } from '../domain/errors.ts'
import type {
  ClaimEvaluation,
  Exhibit,
  InspectResult,
  SearchResult,
  Stance
} from '../domain/types.ts'

export const MAX_TOOL_OUTPUT_CHARS = 1500

/** Minimal structural type for the WebMCP entry point we depend on. */
export interface ModelContextLike {
  registerTool(tool: WebMcpToolDefinition): Promise<void>
}

export interface WebMcpToolDefinition {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  execute(input: unknown, options?: { signal?: AbortSignal }): Promise<string>
  annotations: Record<string, unknown>
}

/** Everything the tools need from the app, injectable for tests. */
export interface ToolContext {
  /** Verified exhibits only — quarantined exhibits are never exposed. */
  exhibits(): Exhibit[]
  /** Agent lane into the caseboard; domain layer enforces add-only. */
  addToBoard(exhibitId: string, stance: Stance): ActionResult
  /** Optional UI bridge. Listener failures never change a tool result. */
  onLifecycle?(event: ToolLifecycleEvent): void
  /** Applies a real evaluate_claim result to the visible verdict surface. */
  onVerdict?(evaluation: ClaimEvaluation): void
}

export type ToolLifecyclePhase =
  | 'started'
  | 'completed'
  | 'refused'
  | 'failed'
  | 'aborted'

export interface ToolLifecycleEvent {
  toolName: string
  phase: ToolLifecyclePhase
  /** Bounded, prewritten status text. Never contains raw tool input. */
  summary: string
}

export type RegisterErrorKind =
  | 'duplicate'
  | 'permission'
  | 'security'
  | 'aborted'
  | 'unknown'

export interface ToolOutcome {
  name: string
  ok: boolean
  errorKind?: RegisterErrorKind
  message?: string
}

export interface RegistrationResult {
  supported: boolean
  outcomes: ToolOutcome[]
}

// ---------------------------------------------------------------------------
// Bounded JSON output
// ---------------------------------------------------------------------------

/**
 * Deterministic shrinker: try full JSON; then progressively halve nested
 * arrays; final fallback is a truncated preview object. Always <= max.
 *
 * Cycle-2 hardening: total over ALL inputs — BigInt, cycles, functions,
 * pathological nesting depths degrade to a bounded classified envelope and
 * never throw out of a tool execute path.
 */
export function toBoundedJson(value: unknown, maxChars = MAX_TOOL_OUTPUT_CHARS): string {
  const notSerializable = (): string =>
    JSON.stringify({
      truncated: true,
      note: 'output could not be serialized within the size bound'
    }).slice(0, maxChars)

  try {
    const attempt = (v: unknown): string | null => {
      try {
        const s = JSON.stringify(v)
        return s !== undefined && s.length <= maxChars ? s : null
      } catch {
        return null
      }
    }

    const direct = attempt(value)
    if (direct) return direct

    let current = structuredCloneSafe(value)
    for (let i = 0; i < 12; i++) {
      current = halveArrays(current)
      const s = attempt(current)
      if (s) return s
    }

    let preview = ''
    try {
      preview = JSON.stringify(value) ?? String(value)
    } catch {
      preview = String(typeof value)
    }
    return JSON.stringify({
      truncated: true,
      note: 'output exceeded size bound',
      preview: preview.slice(0, Math.min(600, Math.max(0, maxChars - 80)))
    }).slice(0, maxChars)
  } catch {
    return notSerializable()
  }
}

function structuredCloneSafe(value: unknown): unknown {
  try {
    return structuredClone(value)
  } catch {
    try {
      return JSON.parse(JSON.stringify(value ?? null))
    } catch {
      return null
    }
  }
}

function halveArrays(node: unknown): unknown {
  if (Array.isArray(node)) {
    const next = node.slice(0, Math.max(1, Math.floor(node.length / 2)))
    return next.map(halveArrays)
  }
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      out[k] = halveArrays(v)
    }
    return out
  }
  return node
}

// ---------------------------------------------------------------------------
// Input validation (schema validation is unspecified upstream — fail closed)
// ---------------------------------------------------------------------------

function asRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('invalid params: expected a JSON object')
  }
  return input as Record<string, unknown>
}

function reqString(obj: Record<string, unknown>, key: string, maxLen: number): string {
  const v = obj[key]
  if (typeof v !== 'string' || v.trim().length === 0) {
    throw new TypeError(`invalid params: ${key} must be a non-empty string`)
  }
  if (v.length > maxLen) {
    throw new TypeError(`invalid params: ${key} exceeds ${maxLen} chars`)
  }
  return v
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export function buildToolDefs(ctx: ToolContext): WebMcpToolDefinition[] {
  const UNTRUSTED = { untrustedContentHint: true }

  interface ExecutionResult {
    output: string
    phase: 'completed' | 'refused'
    summary: string
  }

  const notify = (event: ToolLifecycleEvent): void => {
    try {
      ctx.onLifecycle?.(event)
    } catch {
      // The page is an observer, never part of the tool's correctness path.
    }
  }

  const notifyVerdict = (evaluation: ClaimEvaluation): void => {
    try {
      ctx.onVerdict?.(evaluation)
    } catch {
      // A broken renderer cannot corrupt or suppress a valid tool result.
    }
  }

  const observable = (
    toolName: string,
    execute: (input: unknown, options?: { signal?: AbortSignal }) => Promise<ExecutionResult>
  ): WebMcpToolDefinition['execute'] => {
    return async (input, options) => {
      notify({ toolName, phase: 'started', summary: `${toolName} started` })
      try {
        const result = await execute(input, options)
        notify({ toolName, phase: result.phase, summary: result.summary })
        return result.output
      } catch (err) {
        const aborted = isAbortError(err)
        // RangeError (unknown exhibit_id) is a well-formed request the tool
        // cannot satisfy — label it `refused`, not `failed`, so a normal agent
        // mistake reads as a refusal rather than a tool crash.
        const refused = err instanceof TypeError || err instanceof RangeError
        notify({
          toolName,
          phase: aborted ? 'aborted' : refused ? 'refused' : 'failed',
          summary: aborted
            ? `${toolName} aborted`
            : refused
              ? `${toolName} refused — invalid or human-exclusive request`
              : `${toolName} failed`
        })
        throw err
      }
    }
  }

  const searchExecute = observable('search_evidence', async (
    input: unknown,
    options?: { signal?: AbortSignal }
  ): Promise<ExecutionResult> => {
    throwIfAborted(options?.signal)
    const query = reqString(asRecord(input), 'query', 512)
    const results: SearchResult[] = searchExhibits(query, ctx.exhibits(), {
      signal: options?.signal
    })
    return {
      output: toBoundedJson({ results }),
      phase: 'completed',
      summary: `search_evidence completed with ${results.length} result${results.length === 1 ? '' : 's'}`
    }
  })

  const inspectExecute = observable('inspect_exhibit', async (
    input: unknown,
    options?: { signal?: AbortSignal }
  ): Promise<ExecutionResult> => {
    throwIfAborted(options?.signal)
    const exhibitId = reqString(asRecord(input), 'exhibit_id', 64)
    const detail = inspectExhibit(exhibitId, ctx.exhibits(), { signal: options?.signal })
    return {
      output: toBoundedJson(detail),
      phase: 'completed',
      summary: `inspect_exhibit completed for ${detail.exhibit_id} with ${detail.spans.length} source spans`
    }
  })

  const evaluateExecute = observable('evaluate_claim', async (
    input: unknown,
    options?: { signal?: AbortSignal }
  ): Promise<ExecutionResult> => {
    throwIfAborted(options?.signal)
    const claimText = reqString(asRecord(input), 'claim', 1000)
    const evaluation: ClaimEvaluation = evaluateClaim(claimText, ctx.exhibits(), {
      signal: options?.signal
    })
    notifyVerdict(evaluation)
    return {
      output: toBoundedJson(evaluation),
      phase: 'completed',
      summary: `evaluate_claim completed: ${evaluation.verdict} with ${evaluation.reasons.length} span-tied reason${evaluation.reasons.length === 1 ? '' : 's'}`
    }
  })

  const boardExecute = observable('update_caseboard', async (
    input: unknown,
    options?: { signal?: AbortSignal }
  ): Promise<ExecutionResult> => {
    throwIfAborted(options?.signal)
    const obj = asRecord(input)
    if (obj.action !== 'add') {
      // Cap interpolated values: tool inputs are untrusted and error strings
      // become tool outputs — never let an oversized input escape bounded paths.
      const shown = String(obj.action).slice(0, 64)
      throw new TypeError(
        `invalid params: agents may only add; '${shown}' is a human-exclusive control`
      )
    }
    const exhibitId = reqString(obj, 'exhibit_id', 64)
    const stance = obj.stance
    if (stance !== 'supports' && stance !== 'contradicts') {
      throw new TypeError("invalid params: stance must be 'supports' or 'contradicts'")
    }
    const result = ctx.addToBoard(exhibitId, stance)
    return {
      output: toBoundedJson({
        added: result.ok,
        reason: result.ok ? undefined : result.reason,
        board: boardSummary(result.board)
      }),
      phase: result.ok ? 'completed' : 'refused',
      summary: result.ok
        ? `update_caseboard completed: added ${exhibitId} as ${stance}`
        : `update_caseboard refused ${exhibitId}: ${result.reason}`
    }
  })

  return [
    {
      name: 'search_evidence',
      title: 'Search evidence exhibits',
      description:
        'Ranked keyword search over the verified vendor handoff packet. Returns exhibit ids, titles, snippets, scores.',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string', description: 'search terms' } },
        required: ['query']
      },
      execute: searchExecute,
      annotations: UNTRUSTED
    },
    {
      name: 'inspect_exhibit',
      title: 'Inspect one exhibit',
      description:
        'Full text spans for one exhibit id, each span carrying its sha256 hash from the signed manifest.',
      inputSchema: {
        type: 'object',
        properties: { exhibit_id: { type: 'string' } },
        required: ['exhibit_id']
      },
      execute: inspectExecute,
      annotations: UNTRUSTED
    },
    {
      name: 'evaluate_claim',
      title: 'Evaluate the contested claim',
      description:
        'Deterministic verdict SUPPORTED | CONTRADICTED | INSUFFICIENT for a claim against verified evidence. Reasons are span-tied; abstentions name the missing document type.',
      inputSchema: {
        type: 'object',
        properties: { claim: { type: 'string', enum: [CONTESTED_CLAIM] } },
        required: ['claim']
      },
      execute: evaluateExecute,
      annotations: UNTRUSTED
    },
    {
      name: 'update_caseboard',
      title: 'Add exhibit to caseboard',
      description:
        'Agents may ONLY add an exhibit with a stance (supports|contradicts). Pin, remove, reject, and seal are human-exclusive controls.',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['add'] },
          exhibit_id: { type: 'string' },
          stance: { type: 'string', enum: ['supports', 'contradicts'] }
        },
        required: ['action', 'exhibit_id', 'stance']
      },
      execute: boardExecute,
      annotations: UNTRUSTED
    }
  ]
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

function classifyRegisterError(err: unknown): RegisterErrorKind {
  const name = (err as { name?: string })?.name
  if (name === 'InvalidStateError') return 'duplicate'
  if (name === 'NotAllowedError') return 'permission'
  if (name === 'SecurityError') return 'security'
  if (isAbortError(err)) return 'aborted'
  return 'unknown'
}

/**
 * Register all four tools. Resolves (never throws) with per-tool outcomes so
 * callers can render failure states instead of crashing.
 */
export async function registerEvidenceTools(
  target: { modelContext?: ModelContextLike } | undefined,
  ctx: ToolContext,
  options?: { signal?: AbortSignal }
): Promise<RegistrationResult> {
  const mc = target?.modelContext
  if (!mc || typeof mc.registerTool !== 'function') {
    return { supported: false, outcomes: [] }
  }

  const outcomes: ToolOutcome[] = []
  for (const def of buildToolDefs(ctx)) {
    try {
      throwIfAborted(options?.signal)
      await mc.registerTool(def)
      outcomes.push({ name: def.name, ok: true })
    } catch (err) {
      outcomes.push({
        name: def.name,
        ok: false,
        errorKind: classifyRegisterError(err),
        message: err instanceof Error ? err.message : String(err)
      })
    }
  }
  return { supported: true, outcomes }
}

/** Names of the frozen tool contract, for docs and tests. */
export const TOOL_NAMES = [
  'search_evidence',
  'inspect_exhibit',
  'evaluate_claim',
  'update_caseboard'
] as const
