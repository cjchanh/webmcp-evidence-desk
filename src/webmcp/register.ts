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
import { evaluateClaim } from '../domain/evaluate.ts'
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
 */
export function toBoundedJson(value: unknown, maxChars = MAX_TOOL_OUTPUT_CHARS): string {
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

  const preview = JSON.stringify(value) ?? String(value)
  return JSON.stringify({
    truncated: true,
    note: 'output exceeded size bound',
    preview: preview.slice(0, Math.min(600, maxChars - 80))
  }).slice(0, maxChars)
}

function structuredCloneSafe(value: unknown): unknown {
  try {
    return structuredClone(value)
  } catch {
    return JSON.parse(JSON.stringify(value ?? null))
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

  const searchExecute = async (
    input: unknown,
    options?: { signal?: AbortSignal }
  ): Promise<string> => {
    throwIfAborted(options?.signal)
    const query = reqString(asRecord(input), 'query', 512)
    const results: SearchResult[] = searchExhibits(query, ctx.exhibits(), {
      signal: options?.signal
    })
    return toBoundedJson({ results })
  }

  const inspectExecute = async (
    input: unknown,
    options?: { signal?: AbortSignal }
  ): Promise<string> => {
    throwIfAborted(options?.signal)
    const exhibitId = reqString(asRecord(input), 'exhibit_id', 64)
    const detail = inspectExhibit(exhibitId, ctx.exhibits(), { signal: options?.signal })
    return toBoundedJson(detail)
  }

  const evaluateExecute = async (
    input: unknown,
    options?: { signal?: AbortSignal }
  ): Promise<string> => {
    throwIfAborted(options?.signal)
    const claimText = reqString(asRecord(input), 'claim', 1000)
    const evaluation: ClaimEvaluation = evaluateClaim(claimText, ctx.exhibits(), {
      signal: options?.signal
    })
    return toBoundedJson(evaluation)
  }

  const boardExecute = async (
    input: unknown,
    options?: { signal?: AbortSignal }
  ): Promise<string> => {
    throwIfAborted(options?.signal)
    const obj = asRecord(input)
    if (obj.action !== 'add') {
      throw new TypeError(
        `invalid params: agents may only add; '${String(obj.action)}' is a human-exclusive control`
      )
    }
    const exhibitId = reqString(obj, 'exhibit_id', 64)
    const stance = obj.stance
    if (stance !== 'supports' && stance !== 'contradicts') {
      throw new TypeError("invalid params: stance must be 'supports' or 'contradicts'")
    }
    const result = ctx.addToBoard(exhibitId, stance)
    return toBoundedJson({
      added: result.ok,
      reason: result.ok ? undefined : result.reason,
      board: boardSummary(result.board)
    })
  }

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
        properties: { claim: { type: 'string' } },
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
