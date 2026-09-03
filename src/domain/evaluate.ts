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

export const CONTESTED_CLAIM =
  'Did the vendor provide the required inspection report before acceptance?'

const normalizeClaim = (claim: string): string =>
  claim.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

const NORMALIZED_CONTESTED_CLAIM = normalizeClaim(CONTESTED_CLAIM)

// Lookarounds reject 5+ digit year fragments ("10000-01-01" must not yield
// "0000-01-01" via substring match — cycle-2 fuzz finding).
const ISO_DATE = /(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)/

/** Gregorian calendar validation. Impossible dates must never anchor a
 * confident verdict. */
function isValidIsoDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return false
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12) return false
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day >= 1 && day <= (daysInMonth[month - 1] ?? 0)
}

/**
 * Same-sentence date anchors. [^.\n] forbids crossing a sentence boundary, so
 * a register date, release date, or any unrelated date in a LATER sentence can
 * never anchor the match — the date must belong to the sentence that carries
 * the keyword. No max-date fallback exists anywhere: a missing anchor date is
 * an abstention (INSUFFICIENT), never a guess.
 *
 * The acceptance anchor requires the acceptance EVENT: the verb "accepted",
 * or the noun "acceptance" immediately followed by date/dated/on. A noun
 * phrase like "acceptance register on 2026-03-16" is a record-keeping date,
 * not the acceptance date, and must not anchor the comparison.
 */
const ACCEPTANCE_ANCHOR_RE =
  /(?:accept(?:ed)\b[^.\n]{0,80}?|acceptance\s+(?:date|dated|on)\b[^.\n]{0,40}?)\d{4}-\d{2}-\d{2}/i
const PERFORMED_RE = /(?:performed|conducted|inspected|completed|done)\b[^.\n]{0,80}?\d{4}-\d{2}-\d{2}/i
const ATTESTATION_RE = /inspection\b[^.\n]{0,120}?\bcompleted\b[^.\n]{0,40}?\d{4}-\d{2}-\d{2}/i

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

/**
 * Find the first calendar-valid ISO date within spans whose text matches
 * `pattern`. Patterns are same-sentence ([^.\n]) so a date in a LATER sentence
 * (a register date, a release date) can never anchor the match — the date must
 * belong to the sentence that carries the keyword.
 */
function findDatedSpan(exhibit: Exhibit, pattern: RegExp): DateHit | null {
  for (const span of exhibit.spans) {
    const m = pattern.exec(span.text)
    if (m) {
      const date = ISO_DATE.exec(m[0])
      if (date && isValidIsoDate(date[0])) {
        return { date: date[0], span }
      }
    }
  }
  return null
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
function isAdjudicatedClaim(claim: string): boolean {
  const normalized = normalizeClaim(claim)
  return (
    normalized === NORMALIZED_CONTESTED_CLAIM ||
    normalized === `inspect ${NORMALIZED_CONTESTED_CLAIM}`
  )
}

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

  if (!isAdjudicatedClaim(claim)) {
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
  const reports = byRole.get('inspection_report') ?? []
  const acceptanceCert = byRole.get('acceptance')?.[0]

  // Nothing relevant at all → abstain naming what an adjudicator would need.
  if (!acceptanceCert && reports.length === 0 && !attestation) {
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
        ...(reports.length > 0 ? [] : ['independent inspection report']),
        ...implicatedDocTypes
      ])
    }
  }
  // The acceptance anchor must be a date in the SAME sentence as an
  // acceptance verb — never a register/record date elsewhere in the cert.
  const acceptanceHit = findDatedSpan(acceptanceCert, ACCEPTANCE_ANCHOR_RE)
  if (!acceptanceHit) {
    return {
      verdict: 'INSUFFICIENT',
      reasons: [],
      missing: dedupe(['dated acceptance certificate'])
    }
  }

  // Actual inspection reports drive the verdict. EVERY report is adjudicated:
  // a revision dated after acceptance contradicts the claim even when an
  // earlier report predates it — the record contains a report showing the
  // inspection happened after acceptance.
  if (reports.length > 0) {
    const dated = reports.flatMap((r) => {
      const hit = findDatedSpan(r, PERFORMED_RE)
      return hit ? [{ report: r, hit }] : []
    })
    const after = dated.filter((d) => d.hit.date > acceptanceHit.date)
    if (after.length > 0) {
      const reasons: ClaimReason[] = after.map((d) => ({
        verdict_basis: `inspection report is dated ${d.hit.date}, AFTER the acceptance date ${acceptanceHit.date}; the required report was not provided before acceptance`,
        span_id: d.hit.span.span_id,
        exhibit_id: d.report.id
      }))
      const asserted = attestation
        ? findDatedSpan(attestation, ATTESTATION_RE)
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

    // A positive verdict requires every report to carry a usable performance
    // date. Known after-acceptance evidence above is already conclusive, but an
    // undated report must never be silently ignored on the SUPPORTED path.
    if (dated.length !== reports.length) {
      return {
        verdict: 'INSUFFICIENT',
        reasons: [],
        missing: dedupe([
          reports.length === 1
            ? 'dated inspection report'
            : 'dated inspection report for every report'
        ])
      }
    }

    const latest = dated.reduce((a, b) => (b.hit.date > a.hit.date ? b : a))
    return {
      verdict: 'SUPPORTED',
      reasons: [
        {
          verdict_basis: `inspection report is dated ${latest.hit.date}, on or before the acceptance date ${acceptanceHit.date}`,
          span_id: latest.hit.span.span_id,
          exhibit_id: latest.report.id
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
