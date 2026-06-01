/**
 * Constitution helper functions.
 *
 * Pure functions for principle ranking, compliance scoring, context
 * formatting, and review summarization. These are deterministic
 * operations that don't depend on LLM output or framework context.
 */

import type {
  ConstitutionDefinition,
  ConstitutionPrinciple,
  ConstitutionPrincipleResult,
  ConstitutionReviewOutput,
} from './constitution'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Default configuration for constitution review. */
export const DEFAULT_CONSTITUTION_CONFIG = {
  /** Per-principle score below which a violation is flagged. */
  complianceThreshold: 0.7,
} as const

export type ConstitutionHelperConfig = typeof DEFAULT_CONSTITUTION_CONFIG

// ---------------------------------------------------------------------------
// Principle ranking
// ---------------------------------------------------------------------------

/**
 * Sort principles by effective priority, applying contextual overrides
 * when context is provided and the constitution uses contextual resolution.
 *
 * For 'priority' mode: sorts by `priority` ascending (1 = highest).
 * For 'weighted' mode: sorts by `weight` descending (highest weight first).
 * For 'contextual' mode: applies matching overrides to adjust ordering.
 */
export function rankConstitutionPrinciples(
  constitution: ConstitutionDefinition,
  context?: string,
): ConstitutionPrinciple[] {
  const principles = [...constitution.principles]

  if (constitution.conflictResolution === 'weighted') {
    return principles.sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
  }

  if (constitution.conflictResolution === 'contextual' && context) {
    // Build a priority adjustment map from contextual overrides.
    // The context string is matched against override `when` descriptions
    // using simple keyword overlap for deterministic behavior.
    const adjustments = new Map<string, number>()
    const contextLower = context.toLowerCase()

    for (const override of constitution.contextualOverrides) {
      const whenTokens = override.when.toLowerCase().split(/\s+/)
      const matchCount = whenTokens.filter((t) => contextLower.includes(t)).length
      const matchRatio = matchCount / Math.max(whenTokens.length, 1)

      // Require at least 40% keyword overlap to activate an override
      if (matchRatio >= 0.4) {
        const current = adjustments.get(override.promote) ?? 0
        adjustments.set(override.promote, current - 1) // lower number = higher priority
        const currentDemote = adjustments.get(override.demote) ?? 0
        adjustments.set(override.demote, currentDemote + 1)
      }
    }

    return principles.sort((a, b) => {
      const adjA = a.priority + (adjustments.get(a.id) ?? 0)
      const adjB = b.priority + (adjustments.get(b.id) ?? 0)
      return adjA - adjB
    })
  }

  // Default: strict priority ordering
  return principles.sort((a, b) => a.priority - b.priority)
}

// ---------------------------------------------------------------------------
// Compliance scoring
// ---------------------------------------------------------------------------

/**
 * Compute overall compliance score from per-principle results
 * according to the constitution's conflict resolution mode.
 *
 * - **priority**: Weighted average where higher-priority principles
 *   have more influence. Priority 1 gets weight N, priority N gets weight 1.
 * - **weighted**: Uses principle weights directly for weighted average.
 * - **contextual**: Same as priority (overrides already applied upstream).
 *
 * Returns a value clamped to [0, 1].
 */
export function computeConstitutionCompliance(
  principleResults: ConstitutionPrincipleResult[],
  constitution: ConstitutionDefinition,
): number {
  if (principleResults.length === 0) return 1

  const principleMap = new Map(
    constitution.principles.map((p) => [p.id, p])
  )

  if (constitution.conflictResolution === 'weighted') {
    let weightedSum = 0
    let totalWeight = 0
    for (const result of principleResults) {
      const principle = principleMap.get(result.principleId)
      const weight = principle?.weight ?? 0
      weightedSum += result.score * weight
      totalWeight += weight
    }
    return totalWeight > 0
      ? Math.max(0, Math.min(1, weightedSum / totalWeight))
      : 0
  }

  // Priority and contextual: inverse-priority weighting.
  // Priority 1 (highest) gets the most influence.
  const maxPriority = Math.max(...constitution.principles.map((p) => p.priority))
  let weightedSum = 0
  let totalWeight = 0

  for (const result of principleResults) {
    const principle = principleMap.get(result.principleId)
    // Higher priority (lower number) → higher weight
    const weight = principle ? (maxPriority - principle.priority + 1) : 1
    weightedSum += result.score * weight
    totalWeight += weight
  }

  return totalWeight > 0
    ? Math.max(0, Math.min(1, weightedSum / totalWeight))
    : 0
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Format a constitution as a human-readable string for LLM prompt injection.
 *
 * Lists principles in priority order with statements, rationale,
 * and conflict resolution mode.
 */
export function formatConstitution(constitution: ConstitutionDefinition): string {
  const ranked = rankConstitutionPrinciples(constitution)
  const lines: string[] = [
    `Constitution: ${constitution.name}`,
    `Conflict resolution: ${constitution.conflictResolution}`,
    '',
    'Principles (in priority order):',
  ]

  for (const p of ranked) {
    const weight = constitution.conflictResolution === 'weighted' && p.weight !== undefined
      ? ` [weight: ${p.weight}]`
      : ''
    lines.push(`${p.priority}. ${p.statement}${weight}`)
    if (p.rationale) {
      lines.push(`   Rationale: ${p.rationale}`)
    }
  }

  if (constitution.contextualOverrides.length > 0) {
    lines.push('', 'Contextual overrides:')
    for (const o of constitution.contextualOverrides) {
      lines.push(`- When: ${o.when}`)
      lines.push(`  Promote: ${o.promote}, Demote: ${o.demote}`)
      lines.push(`  Reasoning: ${o.reasoning}`)
    }
  }

  if (constitution.version) {
    lines.push('', `Version: ${constitution.version}`)
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

/**
 * Generate a human-readable summary from a constitutional review.
 */
export function summarizeConstitutionReview(review: ConstitutionReviewOutput): string {
  if (review.violations.length === 0) {
    return `Constitutional review passed (score: ${review.score.toFixed(2)}). All principles satisfied.`
  }

  const violationIds = [...new Set(review.violations.map((v) => v.principleId))]
  const severeCount = review.violations.filter((v) => v.severity === 'severe').length
  const moderateCount = review.violations.filter((v) => v.severity === 'moderate').length

  const parts: string[] = []

  if (review.compliant) {
    parts.push(`Constitutional review passed with caveats (score: ${review.score.toFixed(2)}).`)
  } else {
    parts.push(`Constitutional review failed (score: ${review.score.toFixed(2)}).`)
  }

  parts.push(
    `${review.violations.length} violation${review.violations.length === 1 ? '' : 's'} detected in: ${violationIds.join(', ')}.`
  )

  if (severeCount > 0) {
    parts.push(`${severeCount} severe.`)
  }
  if (moderateCount > 0) {
    parts.push(`${moderateCount} moderate.`)
  }

  if (review.tradeoffs.length > 0) {
    parts.push(`${review.tradeoffs.length} tradeoff${review.tradeoffs.length === 1 ? '' : 's'} identified.`)
  }

  return parts.join(' ')
}
