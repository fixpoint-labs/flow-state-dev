/**
 * Response Auditor schemas and types.
 *
 * Defines the canonical AnalyzerResult contract that any metacognition
 * analyzer must produce, the AuditReport that aggregates results from
 * multiple analyzers, and the configuration types for the response
 * auditor pattern.
 *
 * Previously, AnalyzerResult was forward-declared in bias-detection.ts.
 * This module is the canonical source.
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Severity
// ---------------------------------------------------------------------------

/** Severity levels for analyzer findings. */
export const severitySchema = z.enum(['info', 'warning', 'critical'])

export type Severity = z.infer<typeof severitySchema>

// ---------------------------------------------------------------------------
// Analyzer annotation (generic)
// ---------------------------------------------------------------------------

/**
 * A single finding annotation from an analyzer.
 *
 * Each annotation captures one specific observation — a bias instance,
 * a hallucination, a safety concern, etc. The `type` field is
 * analyzer-specific (e.g. "sycophancy", "unsupported_claim").
 */
export const analyzerAnnotationSchema = z.object({
  /** Analyzer-specific annotation type (e.g. "sycophancy", "factual_error"). */
  type: z.string(),
  /** Human-readable description of the finding. */
  content: z.string(),
  /** Confidence that this finding is genuine. Range [0, 1]. */
  confidence: z.number().min(0).max(1),
  /** Specific text or pattern from the response evidencing the finding. */
  evidence: z.string().optional(),
})

export type AnalyzerAnnotation = z.infer<typeof analyzerAnnotationSchema>

// ---------------------------------------------------------------------------
// AnalyzerResult — the canonical contract
// ---------------------------------------------------------------------------

/**
 * Canonical output contract for any metacognition analyzer.
 *
 * Every analyzer (bias detection, hallucination detection, safety checks,
 * etc.) produces an AnalyzerResult. This contract enables the response
 * auditor to aggregate heterogeneous analyzers into a single audit report.
 *
 * Fields:
 * - `analyzerId` — unique key for the analyzer (e.g. "bias-sycophancy")
 * - `category` — domain grouping (e.g. "metacognition", "safety")
 * - `severity` — worst severity across findings
 * - `score` — composite score [0, 1] (higher = more concerning)
 * - `label` — human-readable label for the score
 * - `summary` — brief textual summary
 * - `annotations` — structured finding details
 * - `suggestions` — recommended actions
 * - `metadata` — extensibility escape hatch
 */
export const analyzerResultSchema = z.object({
  /** Unique identifier for this analyzer type. */
  analyzerId: z.string(),
  /** Domain category this analyzer belongs to. */
  category: z.string(),
  /** Overall severity of findings. */
  severity: severitySchema,
  /** Composite score. Range [0, 1]. Higher = more concerning. */
  score: z.number().min(0).max(1),
  /** Human-readable label for the score. */
  label: z.string(),
  /** Brief summary of findings. */
  summary: z.string(),
  /** Structured annotations (analyzer-specific detail). */
  annotations: z.array(analyzerAnnotationSchema),
  /** Suggested actions or improvements. */
  suggestions: z.array(z.string()).optional(),
  /** Arbitrary metadata for extensibility. */
  metadata: z.record(z.unknown()).optional(),
})

export type AnalyzerResult = z.infer<typeof analyzerResultSchema>

// ---------------------------------------------------------------------------
// Auditor input
// ---------------------------------------------------------------------------

/**
 * Input to the response auditor: a user message and the AI's response.
 *
 * Matches the shape used by individual analyzers so the auditor can
 * forward the same input to each one.
 */
export const auditorInputSchema = z.object({
  /** The user's original input/message. */
  userInput: z.string(),
  /** The AI's response to audit. */
  aiResponse: z.string(),
})

export type AuditorInput = z.infer<typeof auditorInputSchema>

// ---------------------------------------------------------------------------
// Audit verdict
// ---------------------------------------------------------------------------

/** Overall audit verdict. */
export const auditVerdictSchema = z.enum(['pass', 'review', 'fail'])

export type AuditVerdict = z.infer<typeof auditVerdictSchema>

// ---------------------------------------------------------------------------
// Audit report
// ---------------------------------------------------------------------------

/**
 * Aggregated report from the response auditor.
 *
 * Combines results from all configured analyzers into a single verdict
 * with the worst-case severity, aggregated score, and per-analyzer
 * breakdown.
 */
export const auditReportSchema = z.object({
  /** Overall verdict: pass, review, or fail. */
  verdict: auditVerdictSchema,
  /** Worst severity across all analyzer results. */
  severity: severitySchema,
  /** Aggregated score across analyzers. Range [0, 1]. */
  score: z.number().min(0).max(1),
  /** Brief summary of the audit. */
  summary: z.string(),
  /** Per-analyzer results, keyed by analyzerId. */
  results: z.array(analyzerResultSchema),
  /** Total count of annotations across all analyzers. */
  annotationCount: z.number().int().min(0),
  /** All suggestions aggregated from analyzers. */
  suggestions: z.array(z.string()),
})

export type AuditReport = z.infer<typeof auditReportSchema>

// ---------------------------------------------------------------------------
// Analyzer definition (for registration)
// ---------------------------------------------------------------------------

/**
 * An analyzer definition for the response auditor.
 *
 * Each entry is either a block (a sequencer/handler/generator that
 * produces AnalyzerResult from AuditorInput) or a factory function
 * that creates one.
 */
export interface AnalyzerEntry {
  /** Unique analyzer ID (must match the analyzerId in its output). */
  id: string
  /** The block that runs the analysis. Must accept AuditorInput and return AnalyzerResult. */
  block: { run: (input: AuditorInput, ctx: any) => Promise<AnalyzerResult> }
}

// ---------------------------------------------------------------------------
// Auditor config
// ---------------------------------------------------------------------------

/**
 * Thresholds for audit verdict determination.
 *
 * The auditor determines the verdict by checking the aggregated score
 * against these thresholds:
 * - score < reviewThreshold → "pass"
 * - reviewThreshold <= score < failThreshold → "review"
 * - score >= failThreshold → "fail"
 */
export interface AuditThresholds {
  /** Score at or above which the verdict becomes "review". Default: 0.3. */
  reviewThreshold: number
  /** Score at or above which the verdict becomes "fail". Default: 0.7. */
  failThreshold: number
}

export const DEFAULT_AUDIT_THRESHOLDS: AuditThresholds = {
  reviewThreshold: 0.3,
  failThreshold: 0.7,
}
