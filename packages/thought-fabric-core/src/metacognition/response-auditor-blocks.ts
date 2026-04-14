/**
 * Response auditor block factories.
 *
 * The primary export is `responseAuditor()`, a factory that builds a
 * sequencer running configured analyzers in parallel and aggregating
 * results into an AuditReport.
 *
 * Also exports `auditAggregate()`, the standalone aggregation handler,
 * for flow authors who want to compose custom audit pipelines.
 */

import { handler, sequencer } from '@flow-state-dev/core'
import {
  auditorInputSchema,
  auditReportSchema,
  DEFAULT_AUDIT_THRESHOLDS,
} from './response-auditor.js'
import type {
  AnalyzerResult,
  AuditReport,
  AuditThresholds,
} from './response-auditor.js'
import { buildAuditReport } from './response-auditor-helpers.js'

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

/**
 * A block that accepts auditor input and returns an AnalyzerResult.
 * Matches any block kind (handler, generator, sequencer, router).
 */
type AnalyzerBlock = {
  kind: string
  name: string
  run: (input: { userInput: string; aiResponse: string }, ctx: any) => Promise<AnalyzerResult>
}

/** Configuration for the response auditor factory. */
export interface ResponseAuditorConfig {
  /** Block name. Default: "responseAuditor". */
  name?: string
  /**
   * Analyzers to run. Each entry maps an ID to a block that accepts
   * `{ userInput, aiResponse }` and returns `AnalyzerResult`.
   *
   * Example:
   * ```ts
   * responseAuditor({
   *   analyzers: {
   *     'bias-sycophancy': biasAnalyzer(),
   *   },
   * })
   * ```
   */
  analyzers: Record<string, AnalyzerBlock>
  /** Thresholds for verdict determination. */
  thresholds?: AuditThresholds
}

// ---------------------------------------------------------------------------
// Aggregation handler
// ---------------------------------------------------------------------------

/**
 * Handler that aggregates parallel analyzer results into an AuditReport.
 *
 * Used internally by `responseAuditor()` but exported for flow authors
 * who want to build custom audit pipelines with their own parallel
 * execution strategy.
 *
 * Input: an object keyed by analyzer ID, each value an AnalyzerResult.
 * Output: AuditReport.
 */
export function auditAggregate(config?: {
  name?: string
  thresholds?: AuditThresholds
}) {
  const name = config?.name ?? 'responseAuditor/aggregate'
  const thresholds = config?.thresholds ?? DEFAULT_AUDIT_THRESHOLDS

  return handler({
    name,
    outputSchema: auditReportSchema,
    execute: (input: Record<string, AnalyzerResult>): AuditReport => {
      const results = Object.values(input)
      return buildAuditReport(results, thresholds)
    },
  })
}

// ---------------------------------------------------------------------------
// Response auditor sequencer
// ---------------------------------------------------------------------------

/**
 * Factory that builds a response auditor sequencer.
 *
 * Runs configured analyzers in parallel, then aggregates results into
 * a single AuditReport with a pass/review/fail verdict.
 *
 * ```ts
 * import { responseAuditor } from '@thought-fabric/core/metacognition'
 * import { biasAnalyzer } from '@thought-fabric/core/metacognition'
 *
 * const auditor = responseAuditor({
 *   analyzers: {
 *     'bias-sycophancy': biasAnalyzer({ model: 'preset/fast' }),
 *   },
 *   thresholds: { reviewThreshold: 0.3, failThreshold: 0.7 },
 * })
 *
 * // Standalone:
 * const report = await auditor.run({ userInput: '...', aiResponse: '...' }, ctx)
 *
 * // As a sidechain in a chat pipeline:
 * const pipeline = sequencer({ name: 'chat-with-audit' })
 *   .then(chat)
 *   .work(auditor)
 * ```
 */
export function responseAuditor(config: ResponseAuditorConfig) {
  const name = config.name ?? 'responseAuditor'
  const thresholds = config.thresholds ?? DEFAULT_AUDIT_THRESHOLDS

  const analyzerEntries = config.analyzers
  const aggregate = auditAggregate({ name: `${name}/aggregate`, thresholds })

  return sequencer({ name, inputSchema: auditorInputSchema })
    .parallel(analyzerEntries as any)
    .then(aggregate)
}
