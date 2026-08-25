/**
 * evaluateClaim — deterministic verdict over verified exhibits only.
 *
 * Verdict contract (frozen):
 *   SUPPORTED    — evidence supports the claim; every reason is span-tied.
 *   CONTRADICTED — evidence contradicts the claim; every reason is span-tied.
 *   INSUFFICIENT — abstention. `missing` names the absent document type(s).
 *
 * The hero corpus contains a deliberate contradiction: the vendor attestation
 * asserts inspection completed BEFORE acceptance, while the actual inspection
 * report is dated AFTER the acceptance date. Both sides are surfaced as
 * span-tied reasons and the verdict is CONTRADICTED.
 *
 * Pure: no DOM, no IO. Abort-aware at entry.
 */

import { throwIfAborted } from './errors.ts'
import type { ClaimEvaluation, ClaimReason, Exhibit, Span } from './types.ts'

// Lookarounds reject 5+ digit year fragments ("10000-01-01" must not yield
// "0000-01-01" via substring match — cycle-2 fuzz finding).
const ISO_DATE = /(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)/

type Role = 'attestation' | 'inspection_report' | 'acceptance' | 'other'

interface DateHit {
  date: string
  span: Span
}

function roleOf(exhibit: Exhibit): Role {
  const t = exhibit.title.toLowerCase()
  if (/attestation/.test(t)) return 'attestation'
  if (/inspection report/.test(t)) return 'inspection_report'
  if (/acceptance certificate/.test(t)) return 'acceptance'
  return 'other'
}

/** Find the first ISO date within spans whose text matches `pattern`. */
function findDatedSpan(exhibit: Exhibit, pattern: RegExp): DateHit | null {
  for (const span of exhibit.spans) {
    const m = pattern.exec(span.text)
    if (m) {
      const date = ISO_DATE.exec(m[0])
      if (date) {
        return { date: date[0], span }
      }
    }
  }
  return null
}

function maxIsoDateInSpans(exhibit: Exhibit): DateHit | null {
  let best: DateHit | null = null
  for (const span of exhibit.spans) {
    for (const m of span.text.matchAll(new RegExp(ISO_DATE, 'g'))) {
      if (!best || m[0] > best.date) {
        best = { date: m[0], span }
      }
    }
  }
  return best
}

/**
 * Keyword → document-type map used to name what is MISSING on abstention.
 * Claims that match no known document class abstain naming the class that
 * would be required.
 */
const CLAIM_KEYWORDS: Array<{ re: RegExp; docType: string }> = [
  { re: /inspection report/i, docType: 'inspection report' },
  { re: /inspect/i, docType: 'inspection report' },
  { re: /accept/i, docType: 'acceptance certificate' },
  { re: /attest/i, docType: 'vendor attestation letter' },
  { re: /deliver|shipment|receiv/i, docType: 'delivery log' },
  { re: /specification|spec sheet|requirement/i, docType: 'specification sheet' },
  { re: /purchase order|\bPO\b/i, docType: 'purchase order clause extract' },
  { re: /packing slip/i, docType: 'packing slip' },
  { re: /corrective action|\bCAR\b/i, docType: 'corrective action request' },
  { re: /conformance/i, docType: 'certificate of conformance' },
  { re: /serial|inventory/i, docType: 'serial inventory log' },
  { re: /minutes|meeting/i, docType: 'meeting minutes' },
  { re: /email|correspondence/i, docType: 'email correspondence' },
  { re: /price|pricing|cost|invoice|payment/i, docType: 'pricing or invoice records' },
  { re: /warranty/i, docType: 'warranty records' },
  { re: /training|certification of personnel/i, docType: 'training records' }
]

/** Title evidence that indicates a document class exists in the corpus. */
const DOC_TYPE_TITLE_RE: Record<string, RegExp> = {
  'inspection report': /inspection report/i,
  'acceptance certificate': /acceptance certificate/i,
  'vendor attestation letter': /attestation/i,
  'delivery log': /delivery log/i,
  'specification sheet': /specification sheet/i,
  'purchase order clause extract': /purchase order/i,
  'packing slip': /packing slip/i,
  'corrective action request': /corrective action/i,
  'certificate of conformance': /certificate of conformance/i,
  'serial inventory log': /serial inventory|inventory log/i,
  'meeting minutes': /minutes/i,
  'email correspondence': /email/i,
  'pricing or invoice records': /invoice|pricing|price/i,
  'warranty records': /warranty/i,
  'training records': /training/i
}

/**
 * This engine adjudicates exactly ONE claim class: whether the required
 * inspection report was provided before acceptance. Any other claim class
 * abstains INSUFFICIENT, naming implicated document types that are absent
 * from the corpus (or the general gap when everything implicated exists).
 */
const ADJUDICATED_CLASS_RE = /inspect|accept|attest/i

export function evaluateClaim(
  claim: string,
  exhibits: Exhibit[],
  opts?: { signal?: AbortSignal }
): ClaimEvaluation {
  throwIfAborted(opts?.signal)
  if (typeof claim !== 'string' || claim.trim().length === 0) {
    throw new TypeError('invalid params: claim must be a non-empty string')
  }

  // Which document classes does this claim implicate?
  const implicatedDocTypes = new Set<string>()
  for (const kw of CLAIM_KEYWORDS) {
    if (kw.re.test(claim)) implicatedDocTypes.add(kw.docType)
  }

  if (!ADJUDICATED_CLASS_RE.test(claim)) {
    const corpusTitles = exhibits.map((e) => e.title).join(' | ')
    const missing = [...implicatedDocTypes].filter((docType) => {
      const titleRe = DOC_TYPE_TITLE_RE[docType]
      return !(titleRe && titleRe.test(corpusTitles))
    })
    if (missing.length === 0) {
      missing.push('documentary evidence sufficient to adjudicate this claim class')
    }
    return { verdict: 'INSUFFICIENT', reasons: [], missing }
  }

  const byRole = new Map<Role, Exhibit[]>()
  for (const exhibit of exhibits) {
    const role = roleOf(exhibit)
    const list = byRole.get(role) ?? []
    list.push(exhibit)
    byRole.set(role, list)
  }

  const attestation = byRole.get('attestation')?.[0]
  const report = byRole.get('inspection_report')?.[0]
  const acceptanceCert = byRole.get('acceptance')?.[0]

  // Nothing relevant at all → abstain naming what an adjudicator would need.
  if (!acceptanceCert && !report && !attestation) {
    const missing =
      implicatedDocTypes.size > 0
        ? [...implicatedDocTypes]
        : ['acceptance certificate', 'inspection report', 'vendor attestation letter']
    return { verdict: 'INSUFFICIENT', reasons: [], missing }
  }

  // Acceptance date anchors every comparison.
  if (!acceptanceCert) {
    return {
      verdict: 'INSUFFICIENT',
      reasons: [],
      missing: dedupe([
        'acceptance certificate',
        ...(report ? [] : ['independent inspection report']),
        ...implicatedDocTypes
      ])
    }
  }
  const acceptanceHit =
    findDatedSpan(acceptanceCert, /accept(?:ed|ance)[^\n]{0,80}?\d{4}-\d{2}-\d{2}/i) ??
    maxIsoDateInSpans(acceptanceCert)
  if (!acceptanceHit) {
    return {
      verdict: 'INSUFFICIENT',
      reasons: [],
      missing: dedupe(['dated acceptance certificate'])
    }
  }

  // Actual inspection report drives the verdict when present.
  if (report) {
    const performedHit =
      findDatedSpan(
        report,
        /(?:performed|conducted|inspected|completed)[^\n]{0,80}?\d{4}-\d{2}-\d{2}/i
      ) ?? maxIsoDateInSpans(report)
    if (!performedHit) {
      return {
        verdict: 'INSUFFICIENT',
        reasons: [],
        missing: dedupe(['dated inspection report'])
      }
    }

    if (performedHit.date > acceptanceHit.date) {
      const reasons: ClaimReason[] = [
        {
          verdict_basis: `inspection report is dated ${performedHit.date}, AFTER the acceptance date ${acceptanceHit.date}; the required report was not provided before acceptance`,
          span_id: performedHit.span.span_id,
          exhibit_id: report.id
        }
      ]
      const asserted = attestation
        ? findDatedSpan(attestation, /inspection\b[^.\n]{0,120}?\bcompleted\b[^.\n]{0,40}?\d{4}-\d{2}-\d{2}/i)
        : null
      if (attestation && asserted && asserted.date <= acceptanceHit.date) {
        reasons.push({
          verdict_basis: `vendor attestation asserts inspection completed ${asserted.date}, BEFORE acceptance ${acceptanceHit.date}, directly conflicting with the report date`,
          span_id: asserted.span.span_id,
          exhibit_id: attestation.id
        })
      }
      return { verdict: 'CONTRADICTED', reasons, missing: [] }
    }

    return {
      verdict: 'SUPPORTED',
      reasons: [
        {
          verdict_basis: `inspection report is dated ${performedHit.date}, on or before the acceptance date ${acceptanceHit.date}`,
          span_id: performedHit.span.span_id,
          exhibit_id: report.id
        }
      ],
      missing: []
    }
  }

  // Attestation only: self-asserted, never sufficient on its own.
  if (attestation) {
    return {
      verdict: 'INSUFFICIENT',
      reasons: [
        {
          verdict_basis:
            'only a vendor attestation is present; a self-asserted letter cannot establish that the report was provided before acceptance',
          span_id: attestation.spans[0]?.span_id ?? '',
          exhibit_id: attestation.id
        }
      ],
      missing: dedupe(['independent inspection report', ...implicatedDocTypes])
    }
  }

  return {
    verdict: 'INSUFFICIENT',
    reasons: [],
    missing: dedupe(['inspection report', ...implicatedDocTypes])
  }
}

function dedupe(items: Iterable<string>): string[] {
  return [...new Set(items)]
}
