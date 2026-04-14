/**
 * Response auditor helper functions.
 *
 * Pure functions for aggregating analyzer results into an audit report:
 * severity escalation, score aggregation, verdict determination, and
 * report summarization. No framework or LLM dependencies.
 */

import type {
  AnalyzerResult,
  AuditReport,
  AuditThresholds,
  AuditVerdict,
  Severity,
} from './response-auditor.js'
import { DEFAULT_AUDIT_THRESHOLDS } from './response-auditor.js'

// ---------------------------------------------------------------------------
// Severity ordering
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: Record<Severity, number> = {
  info: 0,
  warning: 1,
  critical: 2,
}

/**
 * Return the more severe of two severity levels.
 *
 * info < warning < critical.
 */
export function worstSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_ORDER[a] >= SEVERITY_ORDER[b] ? a : b
}

/**
 * Return the worst severity across an array of analyzer results.
 *
 * Returns "info" for an empty array.
 */
export function aggregateSeverity(results: AnalyzerResult[]): Severity {
  let worst: Severity = 'info'
  for (const r of results) {
    worst = worstSeverity(worst, r.severity)
  }
  return worst
}

// ---------------------------------------------------------------------------
// Score aggregation
// ---------------------------------------------------------------------------

/**
 * Compute an aggregated score from multiple analyzer results.
 *
 * Uses the maximum score across all analyzers. This reflects a
 * worst-case approach: if any single analyzer flags a serious
 * concern, the overall score reflects it.
 *
 * Returns 0 for an empty array.
 */
export function aggregateScore(results: AnalyzerResult[]): number {
  if (results.length === 0) return 0
  return Math.max(...results.map((r) => r.score))
}

// ---------------------------------------------------------------------------
// Verdict determination
// ---------------------------------------------------------------------------

/**
 * Determine the audit verdict from an aggregated score.
 *
 * - score < reviewThreshold → "pass"
 * - reviewThreshold <= score < failThreshold → "review"
 * - score >= failThreshold → "fail"
 */
export function determineVerdict(
  score: number,
  thresholds: AuditThresholds = DEFAULT_AUDIT_THRESHOLDS,
): AuditVerdict {
  if (score >= thresholds.failThreshold) return 'fail'
  if (score >= thresholds.reviewThreshold) return 'review'
  return 'pass'
}

// ---------------------------------------------------------------------------
// Report summarization
// ---------------------------------------------------------------------------

/**
 * Generate a human-readable summary from analyzer results.
 *
 * Covers four cases: no analyzers run, all passed, some flagged,
 * or critical findings.
 */
export function summarizeAudit(
  results: AnalyzerResult[],
  verdict: AuditVerdict,
): string {
  if (results.length === 0) {
    return 'No analyzers were configured. Audit skipped.'
  }

  const totalAnnotations = results.reduce(
    (sum, r) => sum + r.annotations.length,
    0,
  )
  const analyzerNames = results.map((r) => r.analyzerId).join(', ')

  if (verdict === 'pass') {
    return `Audit passed. ${results.length} analyzer(s) ran (${analyzerNames}) with ${totalAnnotations} finding(s), none exceeding thresholds.`
  }

  if (verdict === 'review') {
    const flagged = results.filter((r) => r.severity !== 'info')
    const flaggedNames = flagged.map((r) => r.analyzerId).join(', ')
    return `Audit flagged for review. ${flagged.length} analyzer(s) raised concerns (${flaggedNames}). ${totalAnnotations} total finding(s).`
  }

  // verdict === 'fail'
  const critical = results.filter((r) => r.severity === 'critical')
  const criticalNames = critical.map((r) => r.analyzerId).join(', ')
  return `Audit failed. Critical findings from: ${criticalNames}. ${totalAnnotations} total finding(s) across ${results.length} analyzer(s).`
}

// ---------------------------------------------------------------------------
// Report building
// ---------------------------------------------------------------------------

/**
 * Build an AuditReport from a list of analyzer results.
 *
 * Aggregates severity, score, verdict, annotations, and suggestions
 * from all analyzer results into a single report.
 */
export function buildAuditReport(
  results: AnalyzerResult[],
  thresholds: AuditThresholds = DEFAULT_AUDIT_THRESHOLDS,
): AuditReport {
  const severity = aggregateSeverity(results)
  const score = aggregateScore(results)
  const verdict = determineVerdict(score, thresholds)
  const summary = summarizeAudit(results, verdict)

  const annotationCount = results.reduce(
    (sum, r) => sum + r.annotations.length,
    0,
  )

  const suggestions = results.flatMap(
    (r) => r.suggestions ?? [],
  )

  return {
    verdict,
    severity,
    score,
    summary,
    results,
    annotationCount,
    suggestions,
  }
}
