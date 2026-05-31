/**
 * Constitution block factories.
 *
 * Three composable blocks that form the constitutional review pipeline:
 *
 * 1. `constitutionReview` — generator that LLM-evaluates content against principles
 * 2. `constitutionEnforce` — handler that computes final compliance from review
 * 3. `constitutionAuditor` — bundled sequencer: review → enforce
 *
 * Each block is exported individually for remixability — flow authors can
 * compose custom pipelines or use the bundled auditor.
 */

import { generator, handler, sequencer } from '@flow-state-dev/core'
import {
  constitutionReviewInputSchema,
  constitutionReviewOutputSchema,
  constitutionPrincipleResultSchema,
  constitutionViolationSchema,
  constitutionTradeoffSchema,
} from './constitution'
import type {
  ConstitutionDefinition,
  ConstitutionReviewOutput,
} from './constitution'
import {
  DEFAULT_CONSTITUTION_CONFIG,
  computeConstitutionCompliance,
  formatConstitution,
  rankConstitutionPrinciples,
} from './constitution-helpers'
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

/** Config for the constitutional review generator. */
export interface ConstitutionReviewBlockConfig {
  /** Override block name. Default: 'constitution/review'. */
  name?: string
  /** The constitution to evaluate against. */
  constitution: ConstitutionDefinition
  /** Model ID for the LLM review. Default: 'intent/utility'. */
  model?: string
}

/** Config for the constitutional enforce handler. */
export interface ConstitutionEnforceBlockConfig {
  /** Override block name. Default: 'constitution/enforce'. */
  name?: string
  /** The constitution (used for compliance scoring). */
  constitution: ConstitutionDefinition
  /** Per-principle compliance threshold. Default: 0.7. */
  complianceThreshold?: number
}

/** Config for the bundled constitutional auditor sequencer. */
export interface ConstitutionAuditorBlockConfig {
  /** Override block name prefix. Default: 'constitution'. */
  name?: string
  /** The constitution to audit against. */
  constitution: ConstitutionDefinition
  /** Model ID for the LLM review step. Default: 'intent/utility'. */
  model?: string
  /** Per-principle compliance threshold. Default: 0.7. */
  complianceThreshold?: number
}

// ---------------------------------------------------------------------------
// Intermediate schemas
// ---------------------------------------------------------------------------

/**
 * Output of the review step before enforcement.
 * Contains the raw LLM evaluation without final compliance computation.
 */
const reviewStepOutputSchema = z.object({
  principleResults: z.array(constitutionPrincipleResultSchema),
  violations: z.array(constitutionViolationSchema),
  tradeoffs: z.array(constitutionTradeoffSchema),
  reasoning: z.string(),
})

type ReviewStepOutput = z.infer<typeof reviewStepOutputSchema>

// ---------------------------------------------------------------------------
// Block 1: Constitutional review (generator)
// ---------------------------------------------------------------------------

/**
 * Generator that LLM-evaluates content against a constitution's principles.
 *
 * Scores each principle individually, identifies violations and tradeoffs,
 * and provides overall reasoning. The LLM receives the constitution in its
 * system prompt and the content to evaluate as user input.
 *
 * Input: `{ content: string, context?: string }`
 * Output: `{ principleResults, violations, tradeoffs, reasoning }`
 *
 * ```ts
 * import { constitutionReview } from '@thought-fabric/core/identity'
 *
 * const review = constitutionReview({
 *   constitution: advisorValues,
 *   model: 'intent/utility',
 * })
 * ```
 */
export function constitutionReview(config: ConstitutionReviewBlockConfig) {
  const name = config.name ?? 'constitution/review'
  const constitutionDef = config.constitution
  const formatted = formatConstitution(constitutionDef)
  const ranked = rankConstitutionPrinciples(constitutionDef)
  const principleIds = ranked.map((p) => p.id)

  return generator({
    name,
    model: config.model ?? 'intent/utility',
    inputSchema: constitutionReviewInputSchema,
    outputSchema: reviewStepOutputSchema,
    maxTokens: 4096,
    prompt: [
      'You are a constitutional compliance reviewer. Evaluate the provided content against',
      'a set of ranked principles and report per-principle compliance.',
      '',
      formatted,
      '',
      'For each principle, provide:',
      '- principleId: the principle ID',
      '- score: compliance score from 0 (complete violation) to 1 (full compliance)',
      '- satisfied: true if score >= 0.7',
      '- evidence: specific text or patterns from the content that support your assessment',
      '- reasoning: why you scored this principle the way you did',
      '',
      'For violations (score < 0.7), also add an entry to the violations array with:',
      '- principleId: the principle ID',
      '- severity: "minor" (score 0.5-0.69), "moderate" (score 0.3-0.49), or "severe" (score < 0.3)',
      '- description: what was violated and how',
      '- evidence: specific text from the content',
      '',
      'If you detect tradeoffs between principles (one was favored at the expense of another),',
      'report them in the tradeoffs array with promoted, demoted, and reasoning.',
      '',
      'Provide overall reasoning explaining your compliance assessment.',
      '',
      `Evaluate all ${principleIds.length} principles: ${principleIds.join(', ')}`,
    ].join('\n'),
    user: (input: z.infer<typeof constitutionReviewInputSchema>) => {
      const parts = ['## Content to Evaluate', input.content]
      if (input.context) {
        parts.push('', '## Situational Context', input.context)
      }
      return parts.join('\n')
    },
  })
}

// ---------------------------------------------------------------------------
// Block 2: Constitutional enforce (handler)
// ---------------------------------------------------------------------------

/**
 * Handler that computes final compliance from the LLM review step.
 *
 * Applies the constitution's conflict resolution mode to compute an
 * overall compliance score. Maps per-principle scores to a final
 * pass/fail using the threshold.
 *
 * Input: review step output.
 * Output: full `ConstitutionReviewOutput` with compliance verdict.
 */
export function constitutionEnforce(config: ConstitutionEnforceBlockConfig) {
  const name = config.name ?? 'constitution/enforce'
  const constitutionDef = config.constitution
  const threshold = config.complianceThreshold ?? DEFAULT_CONSTITUTION_CONFIG.complianceThreshold

  return handler({
    name,
    inputSchema: reviewStepOutputSchema,
    outputSchema: constitutionReviewOutputSchema,
    execute: (input: ReviewStepOutput): ConstitutionReviewOutput => {
      const score = computeConstitutionCompliance(
        input.principleResults,
        constitutionDef,
      )

      const compliant = score >= threshold &&
        !input.violations.some((v) => v.severity === 'severe')

      return {
        compliant,
        score,
        principleResults: input.principleResults,
        violations: input.violations,
        tradeoffs: input.tradeoffs,
        reasoning: input.reasoning,
      }
    },
  })
}

// ---------------------------------------------------------------------------
// Bundled sequencer
// ---------------------------------------------------------------------------

/**
 * Bundled sequencer: review → enforce.
 *
 * The primary block most flow authors will use. Accepts content to evaluate,
 * produces a full constitutional review with compliance verdict.
 *
 * ```ts
 * import { constitutionAuditor } from '@thought-fabric/core/identity'
 *
 * const auditor = constitutionAuditor({
 *   constitution: advisorValues,
 *   model: 'intent/utility',
 * })
 *
 * // As a sequencer step:
 * const pipeline = sequencer({ name: 'review-content' })
 *   .step(auditor)
 *
 * // As a .tap() sidechain:
 * const pipeline = sequencer({ name: 'chat-with-audit' })
 *   .step(chat)
 *   .tap(auditor)
 * ```
 */
export function constitutionAuditor(config: ConstitutionAuditorBlockConfig) {
  const prefix = config.name ?? 'constitution'

  const reviewBlock = constitutionReview({
    name: `${prefix}/review`,
    constitution: config.constitution,
    model: config.model,
  })

  const enforceBlock = constitutionEnforce({
    name: `${prefix}/enforce`,
    constitution: config.constitution,
    complianceThreshold: config.complianceThreshold,
  })

  return sequencer({ name: prefix, inputSchema: constitutionReviewInputSchema })
    .step(reviewBlock)
    .step(enforceBlock)
}
