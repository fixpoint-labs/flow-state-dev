/**
 * Bias & sycophancy detection schemas and types.
 *
 * This file defines the data contracts for the bias analyzer: the six bias
 * types it can detect, structured annotations, sycophancy scoring with
 * labeled thresholds, counter-argument generation, and the final output
 * schema that conforms to the Response Auditor's AnalyzerResult contract.
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Bias taxonomy
// ---------------------------------------------------------------------------

/** The six cognitive bias types the analyzer can detect. */
export const biasTypeSchema = z.enum([
  'sycophancy',
  'confirmation_bias',
  'anchoring_bias',
  'authority_deference',
  'recency_bias',
  'false_consensus',
])

export type BiasType = z.infer<typeof biasTypeSchema>

// ---------------------------------------------------------------------------
// Annotations
// ---------------------------------------------------------------------------

/** A single detected bias instance with type, confidence, and evidence. */
export const biasAnnotationSchema = z.object({
  /** Which bias type was detected. */
  biasType: biasTypeSchema,
  /** Confidence that this bias is present. Range [0, 1]. */
  confidence: z.number().min(0).max(1),
  /** Human-readable description of how the bias manifests. */
  description: z.string(),
  /** Specific text or pattern from the AI response that evidences the bias. */
  evidence: z.string(),
})

export type BiasAnnotation = z.infer<typeof biasAnnotationSchema>

// ---------------------------------------------------------------------------
// Counter-arguments
// ---------------------------------------------------------------------------

/** A substantive counter-argument generated when bias exceeds threshold. */
export const counterArgumentSchema = z.object({
  /** The claim or position from the AI response being challenged. */
  claim: z.string(),
  /** A reasoned counterpoint to the claim. */
  counterpoint: z.string(),
  /** How strong this counter-argument is. Range [0, 1]. */
  strength: z.number().min(0).max(1),
  /** Optional sources or reasoning backing the counterpoint. */
  sources: z.array(z.string()).optional(),
})

export type CounterArgument = z.infer<typeof counterArgumentSchema>

// ---------------------------------------------------------------------------
// Sycophancy scoring
// ---------------------------------------------------------------------------

/** Labeled thresholds for sycophancy scores. */
export const sycophancyLabelSchema = z.enum([
  'balanced',
  'mild_bias',
  'moderate_bias',
  'sycophantic',
])

export type SycophancyLabel = z.infer<typeof sycophancyLabelSchema>

/** Four-dimension breakdown of sycophancy signals. */
export const sycophancyBreakdownSchema = z.object({
  /** AI agrees with user claims without providing evidence. Range [0, 1]. */
  agreementWithoutEvidence: z.number().min(0).max(1),
  /** AI uses validating/flattering language toward user's position. Range [0, 1]. */
  validatingLanguage: z.number().min(0).max(1),
  /** AI omits relevant counterpoints to user's position. Range [0, 1]. */
  omittedCounterpoints: z.number().min(0).max(1),
  /** AI adopts user's framing without critical examination. Range [0, 1]. */
  uncriticalFramingAdoption: z.number().min(0).max(1),
})

export type SycophancyBreakdown = z.infer<typeof sycophancyBreakdownSchema>

/** Composite sycophancy score with labeled threshold and dimension breakdown. */
export const sycophancyScoreSchema = z.object({
  /** Composite score. Range [0, 1]. */
  overall: z.number().min(0).max(1),
  /** Human-readable label derived from score thresholds. */
  label: sycophancyLabelSchema,
  /** Per-dimension scores that compose the overall score. */
  breakdown: sycophancyBreakdownSchema,
})

export type SycophancyScore = z.infer<typeof sycophancyScoreSchema>

// ---------------------------------------------------------------------------
// Analyzer input
// ---------------------------------------------------------------------------

/** Input to the bias analyzer: a user message and the AI's response. */
export const biasAnalyzerInputSchema = z.object({
  /** The user's original input/message. */
  userInput: z.string(),
  /** The AI's response to audit for bias. */
  aiResponse: z.string(),
})

export type BiasAnalyzerInput = z.infer<typeof biasAnalyzerInputSchema>

// ---------------------------------------------------------------------------
// Analyzer result (conforms to FIX-307 AnalyzerResult contract)
// ---------------------------------------------------------------------------

/**
 * Generic AnalyzerResult contract from FIX-307 (Response Auditor pattern).
 *
 * Defined here as a forward declaration until FIX-307 ships its own
 * canonical schema. The bias analyzer output extends this base contract
 * with bias-specific fields.
 */
export const analyzerResultSchema = z.object({
  /** Unique identifier for this analyzer type. */
  analyzerId: z.string(),
  /** Domain category this analyzer belongs to. */
  category: z.string(),
  /** Overall severity of findings. */
  severity: z.enum(['info', 'warning', 'critical']),
  /** Composite score. Range [0, 1]. */
  score: z.number().min(0).max(1),
  /** Human-readable label for the score. */
  label: z.string(),
  /** Brief summary of findings. */
  summary: z.string(),
  /** Structured annotations (analyzer-specific detail). */
  annotations: z.array(z.object({
    type: z.string(),
    content: z.string(),
    confidence: z.number().min(0).max(1),
    evidence: z.string().optional(),
  })),
  /** Suggested actions or improvements. */
  suggestions: z.array(z.string()).optional(),
  /** Arbitrary metadata for extensibility. */
  metadata: z.record(z.unknown()).optional(),
})

export type AnalyzerResult = z.infer<typeof analyzerResultSchema>

/**
 * Full output of the bias analyzer.
 *
 * Includes the AnalyzerResult base fields plus bias-specific detail:
 * per-type annotations, sycophancy scoring breakdown, and counter-arguments.
 */
export const biasAnalyzerOutputSchema = z.object({
  analyzerId: z.literal('bias-sycophancy'),
  category: z.literal('metacognition'),
  severity: z.enum(['info', 'warning', 'critical']),
  score: z.number().min(0).max(1),
  label: sycophancyLabelSchema,
  summary: z.string(),
  annotations: z.array(biasAnnotationSchema),
  counterArguments: z.array(counterArgumentSchema),
  sycophancyScore: sycophancyScoreSchema,
})

export type BiasAnalyzerOutput = z.infer<typeof biasAnalyzerOutputSchema>

// ---------------------------------------------------------------------------
// Internal intermediate schemas (block chaining)
// ---------------------------------------------------------------------------

/** Output of the agreement-pattern detection step. */
export const agreementDetectionOutputSchema = z.object({
  userInput: z.string(),
  aiResponse: z.string(),
  agreementPattern: sycophancyBreakdownSchema,
})

export type AgreementDetectionOutput = z.infer<typeof agreementDetectionOutputSchema>

/** Output of the bias classification step. */
export const biasClassificationOutputSchema = agreementDetectionOutputSchema.extend({
  biases: z.array(biasAnnotationSchema),
})

export type BiasClassificationOutput = z.infer<typeof biasClassificationOutputSchema>

/** Output of the sycophancy scoring step. */
export const biasScoringOutputSchema = z.object({
  userInput: z.string(),
  aiResponse: z.string(),
  biases: z.array(biasAnnotationSchema),
  sycophancyScore: sycophancyScoreSchema,
})

export type BiasScoringOutput = z.infer<typeof biasScoringOutputSchema>

/** Output of the counter-argument generation step. */
export const counterpointOutputSchema = biasScoringOutputSchema.extend({
  counterArguments: z.array(counterArgumentSchema),
})

export type CounterpointOutput = z.infer<typeof counterpointOutputSchema>
