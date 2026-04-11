/**
 * Bias detection helper functions.
 *
 * Pure functions for sycophancy scoring, threshold labeling, and severity
 * mapping. These are deterministic operations that don't depend on LLM
 * output or framework context — they compute derived values from the
 * structured data produced by the detection and classification blocks.
 */

import type { BiasAnnotation, SycophancyBreakdown, SycophancyLabel } from './bias-detection.js'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Default configuration for the bias analyzer. */
export const DEFAULT_BIAS_ANALYZER_CONFIG = {
  /** Sycophancy score above which counter-arguments are generated. */
  counterpointThreshold: 0.4,
  /**
   * Weights for composing the overall sycophancy score from the four
   * breakdown dimensions. Higher weight = more influence on the final score.
   */
  breakdownWeights: {
    agreementWithoutEvidence: 0.35,
    validatingLanguage: 0.15,
    omittedCounterpoints: 0.30,
    uncriticalFramingAdoption: 0.20,
  },
  /**
   * Weight given to per-type bias confidence scores when adjusting
   * the composite score upward. Prevents the composite from being
   * lower than what the individual bias detections warrant.
   */
  biasConfidenceWeight: 0.3,
} as const

export type BiasAnalyzerConfig = typeof DEFAULT_BIAS_ANALYZER_CONFIG

// ---------------------------------------------------------------------------
// Threshold labeling
// ---------------------------------------------------------------------------

/**
 * Map a sycophancy score [0, 1] to a human-readable label.
 *
 * | Score Range | Label |
 * |---|---|
 * | 0.0 - 0.2 | balanced |
 * | 0.2 - 0.4 | mild_bias |
 * | 0.4 - 0.7 | moderate_bias |
 * | 0.7 - 1.0 | sycophantic |
 */
export function labelForSycophancyScore(score: number): SycophancyLabel {
  if (score < 0.2) return 'balanced'
  if (score < 0.4) return 'mild_bias'
  if (score < 0.7) return 'moderate_bias'
  return 'sycophantic'
}

/**
 * Map a sycophancy score [0, 1] to a severity level for the AnalyzerResult.
 *
 * - balanced / mild_bias → info
 * - moderate_bias → warning
 * - sycophantic → critical
 */
export function severityForSycophancyScore(score: number): 'info' | 'warning' | 'critical' {
  if (score < 0.4) return 'info'
  if (score < 0.7) return 'warning'
  return 'critical'
}

// ---------------------------------------------------------------------------
// Composite scoring
// ---------------------------------------------------------------------------

/**
 * Compute a composite sycophancy score from the four-dimension breakdown
 * and detected bias annotations.
 *
 * The composite is a weighted average of the breakdown dimensions, adjusted
 * upward if per-type bias confidence scores warrant it. The adjustment
 * prevents the composite from being artificially low when individual bias
 * detections are high-confidence.
 *
 * Returns a value clamped to [0, 1].
 */
export function computeCompositeSycophancyScore(
  breakdown: SycophancyBreakdown,
  biases: BiasAnnotation[],
  config: BiasAnalyzerConfig = DEFAULT_BIAS_ANALYZER_CONFIG,
): number {
  const w = config.breakdownWeights

  // Weighted average of breakdown dimensions.
  const baseScore =
    breakdown.agreementWithoutEvidence * w.agreementWithoutEvidence +
    breakdown.validatingLanguage * w.validatingLanguage +
    breakdown.omittedCounterpoints * w.omittedCounterpoints +
    breakdown.uncriticalFramingAdoption * w.uncriticalFramingAdoption

  // Average confidence across detected biases (0 if none detected).
  const avgBiasConfidence =
    biases.length > 0
      ? biases.reduce((sum, b) => sum + b.confidence, 0) / biases.length
      : 0

  // Blend: base score dominates, bias confidence can push it up.
  const composite =
    baseScore * (1 - config.biasConfidenceWeight) +
    avgBiasConfidence * config.biasConfidenceWeight

  return Math.max(0, Math.min(1, composite))
}

/**
 * Whether the sycophancy score warrants generating counter-arguments.
 */
export function shouldGenerateCounterpoints(
  score: number,
  threshold: number = DEFAULT_BIAS_ANALYZER_CONFIG.counterpointThreshold,
): boolean {
  return score >= threshold
}

/**
 * Generate a human-readable summary from a sycophancy score, label, and
 * detected bias annotations.
 */
export function summarizeBiasFindings(
  score: number,
  label: SycophancyLabel,
  biases: BiasAnnotation[],
): string {
  if (biases.length === 0) {
    return `No significant cognitive biases detected (score: ${score.toFixed(2)}, ${label}).`
  }

  const biasTypes = [...new Set(biases.map((b) => b.biasType.replace(/_/g, ' ')))]
  const typeList = biasTypes.join(', ')

  if (label === 'balanced') {
    return `Minor bias signals detected (${typeList}) but overall response is balanced (score: ${score.toFixed(2)}).`
  }

  if (label === 'mild_bias') {
    return `Mild bias detected: ${typeList}. Score: ${score.toFixed(2)}.`
  }

  if (label === 'moderate_bias') {
    return `Moderate bias detected: ${typeList}. Counter-arguments recommended. Score: ${score.toFixed(2)}.`
  }

  return `Sycophantic response detected: ${typeList}. Counter-arguments strongly recommended. Score: ${score.toFixed(2)}.`
}
