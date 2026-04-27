/**
 * Constitution — ranked principle hierarchies with conflict resolution.
 *
 * A constitution defines what an AI system stands for. When principles
 * conflict ("be helpful" vs. "be cautious"), the constitution provides a
 * structured resolution strategy. The system can reason about *why* its
 * principles are ordered and articulate tradeoffs explicitly.
 *
 * This file defines the data contracts (Layer 1) and the configuration
 * factory. Blocks that operate on constitutions live in constitution-blocks.ts.
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Principle
// ---------------------------------------------------------------------------

/** A single constitutional principle with priority and rationale. */
export const constitutionPrincipleSchema = z.object({
  /** Unique identifier for referencing in overrides and results. */
  id: z.string().min(1),
  /** Human-readable statement of the principle. */
  statement: z.string().min(1),
  /** Priority rank — lower number = higher priority. */
  priority: z.number().int().min(1),
  /** Why this principle matters. Helps the LLM reason about tradeoffs. */
  rationale: z.string().optional(),
  /** Weight for 'weighted' conflict resolution mode. Range [0, 1]. */
  weight: z.number().min(0).max(1).optional(),
})

export type ConstitutionPrinciple = z.infer<typeof constitutionPrincipleSchema>

// ---------------------------------------------------------------------------
// Contextual overrides
// ---------------------------------------------------------------------------

/** A rule that re-ranks principles in specific situations. */
export const constitutionContextualOverrideSchema = z.object({
  /** Description of when this override applies. */
  when: z.string().min(1),
  /** Principle ID to promote (increase priority). */
  promote: z.string().min(1),
  /** Principle ID to demote (decrease priority). */
  demote: z.string().min(1),
  /** Why this override exists. */
  reasoning: z.string().min(1),
})

export type ConstitutionContextualOverride = z.infer<typeof constitutionContextualOverrideSchema>

// ---------------------------------------------------------------------------
// Conflict resolution
// ---------------------------------------------------------------------------

/**
 * How to resolve conflicting principles:
 * - `priority`: Lower number wins. Strict ordering.
 * - `weighted`: Composite score from principle weights.
 * - `contextual`: Rules-based overrides re-rank per situation.
 */
export const constitutionConflictResolutionSchema = z.enum([
  'priority',
  'weighted',
  'contextual',
])

export type ConstitutionConflictResolution = z.infer<typeof constitutionConflictResolutionSchema>

// ---------------------------------------------------------------------------
// Constitution config
// ---------------------------------------------------------------------------

/** Full constitution configuration. */
export const constitutionConfigSchema = z.object({
  /** Name identifying this constitution. */
  name: z.string().min(1),
  /** Ordered list of principles. */
  principles: z.array(constitutionPrincipleSchema).min(1),
  /** Conflict resolution strategy. Default: 'priority'. */
  conflictResolution: constitutionConflictResolutionSchema.default('priority'),
  /** Override rules for 'contextual' mode. */
  contextualOverrides: z.array(constitutionContextualOverrideSchema).optional(),
  /** Optional version string for tracking constitution evolution. */
  version: z.string().optional(),
})

export type ConstitutionConfig = z.input<typeof constitutionConfigSchema>

// ---------------------------------------------------------------------------
// Constitution definition (the frozen config object)
// ---------------------------------------------------------------------------

/** The validated, frozen constitution returned by the factory. */
export interface ConstitutionDefinition {
  readonly name: string
  readonly principles: readonly ConstitutionPrinciple[]
  readonly conflictResolution: ConstitutionConflictResolution
  readonly contextualOverrides: readonly ConstitutionContextualOverride[]
  readonly version: string | undefined
}

// ---------------------------------------------------------------------------
// Review schemas
// ---------------------------------------------------------------------------

/** Per-principle evaluation result from a constitutional review. */
export const constitutionPrincipleResultSchema = z.object({
  /** Which principle was evaluated. */
  principleId: z.string(),
  /** Compliance score for this principle. Range [0, 1]. */
  score: z.number().min(0).max(1),
  /** Whether this principle is satisfied (score >= threshold). */
  satisfied: z.boolean(),
  /** Specific evidence from the content. */
  evidence: z.string(),
  /** Reasoning about compliance. */
  reasoning: z.string(),
})

export type ConstitutionPrincipleResult = z.infer<typeof constitutionPrincipleResultSchema>

/** A detected violation of a constitutional principle. */
export const constitutionViolationSchema = z.object({
  /** Which principle was violated. */
  principleId: z.string(),
  /** How severe the violation is. */
  severity: z.enum(['minor', 'moderate', 'severe']),
  /** Description of the violation. */
  description: z.string(),
  /** Specific evidence from the content. */
  evidence: z.string(),
})

export type ConstitutionViolation = z.infer<typeof constitutionViolationSchema>

/** A tradeoff between two principles identified during review. */
export const constitutionTradeoffSchema = z.object({
  /** Principle ID that was favored. */
  promoted: z.string(),
  /** Principle ID that was deprioritized. */
  demoted: z.string(),
  /** Why this tradeoff was made. */
  reasoning: z.string(),
})

export type ConstitutionTradeoff = z.infer<typeof constitutionTradeoffSchema>

/** Input to a constitutional review block. */
export const constitutionReviewInputSchema = z.object({
  /** The text content to evaluate against the constitution. */
  content: z.string(),
  /** Optional situational context (used for contextual conflict resolution). */
  context: z.string().optional(),
})

export type ConstitutionReviewInput = z.infer<typeof constitutionReviewInputSchema>

/** Output of a constitutional review. */
export const constitutionReviewOutputSchema = z.object({
  /** Overall compliance verdict. */
  compliant: z.boolean(),
  /** Aggregate compliance score. Range [0, 1]. */
  score: z.number().min(0).max(1),
  /** Per-principle evaluation results. */
  principleResults: z.array(constitutionPrincipleResultSchema),
  /** Detected violations (principles that were not satisfied). */
  violations: z.array(constitutionViolationSchema),
  /** Identified tradeoffs between principles. */
  tradeoffs: z.array(constitutionTradeoffSchema),
  /** Overall reasoning about compliance. */
  reasoning: z.string(),
})

export type ConstitutionReviewOutput = z.infer<typeof constitutionReviewOutputSchema>

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a constitution — a ranked set of principles with conflict resolution.
 *
 * Validates that:
 * - All principle IDs are unique
 * - 'weighted' mode requires all principles to have a `weight`
 * - 'contextual' mode requires `contextualOverrides`
 * - Override principle IDs reference existing principles
 *
 * ```ts
 * import { identity } from '@thought-fabric/core'
 *
 * const values = identity.constitution({
 *   name: 'advisor-values',
 *   principles: [
 *     { id: 'accuracy', statement: 'Provide accurate information', priority: 1 },
 *     { id: 'clarity', statement: 'Communicate clearly', priority: 2 },
 *   ],
 *   conflictResolution: 'priority',
 * })
 * ```
 */
export function constitution(config: ConstitutionConfig): ConstitutionDefinition {
  const parsed = constitutionConfigSchema.parse(config)

  // Validate unique principle IDs
  const ids = new Set<string>()
  for (const p of parsed.principles) {
    if (ids.has(p.id)) {
      throw new Error(`Duplicate principle ID: '${p.id}'`)
    }
    ids.add(p.id)
  }

  // Validate weighted mode requires weights on all principles
  if (parsed.conflictResolution === 'weighted') {
    for (const p of parsed.principles) {
      if (p.weight === undefined) {
        throw new Error(
          `Principle '${p.id}' must have a weight when conflictResolution is 'weighted'`
        )
      }
    }
  }

  // Validate contextual mode requires overrides
  if (parsed.conflictResolution === 'contextual') {
    if (!parsed.contextualOverrides || parsed.contextualOverrides.length === 0) {
      throw new Error(
        "conflictResolution 'contextual' requires at least one contextualOverride"
      )
    }

    // Validate override principle IDs exist
    for (const override of parsed.contextualOverrides) {
      if (!ids.has(override.promote)) {
        throw new Error(
          `Contextual override references unknown principle '${override.promote}' in promote`
        )
      }
      if (!ids.has(override.demote)) {
        throw new Error(
          `Contextual override references unknown principle '${override.demote}' in demote`
        )
      }
    }
  }

  return Object.freeze({
    name: parsed.name,
    principles: Object.freeze(parsed.principles.map((p) => Object.freeze({ ...p }))),
    conflictResolution: parsed.conflictResolution,
    contextualOverrides: Object.freeze(
      (parsed.contextualOverrides ?? []).map((o) => Object.freeze({ ...o }))
    ),
    version: parsed.version,
  })
}
