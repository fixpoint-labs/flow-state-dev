/**
 * Perspective schemas, types, and factory.
 *
 * A perspective is a structured viewpoint model that encodes what an
 * analytical position pays attention to, how it reasons, what domain
 * expertise it draws on, and how it communicates findings. Perspectives
 * are configuration objects — not blocks — that parameterize block
 * factories in the identity domain.
 *
 * Separate from Constitution: a perspective defines how to *see*;
 * a constitution defines what to *value*. The same perspective can
 * operate under different constitutions.
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Salience model
// ---------------------------------------------------------------------------

/**
 * What a perspective pays attention to.
 *
 * `amplify` lists concerns the perspective foregrounds — these shape
 * what the LLM focuses on in its analysis. `suppress` lists concerns
 * the perspective de-emphasizes, reducing noise from irrelevant angles.
 */
export const perspectiveSalienceSchema = z.object({
  /** Concerns this perspective foregrounds in analysis. */
  amplify: z.array(z.string().min(1)).min(1),
  /** Concerns this perspective de-emphasizes. */
  suppress: z.array(z.string().min(1)).default([]),
})

export type PerspectiveSalience = z.infer<typeof perspectiveSalienceSchema>

// ---------------------------------------------------------------------------
// Reasoning configuration
// ---------------------------------------------------------------------------

/**
 * How a perspective reasons about information.
 *
 * Priorities order the perspective's analytical goals. The optional
 * risk model and success criteria further shape the reasoning lens.
 */
export const perspectiveReasoningSchema = z.object({
  /** Ordered analytical priorities — first entry is highest priority. */
  priorities: z.array(z.string().min(1)).min(1),
  /** How this perspective models risk. Plain language description. */
  riskModel: z.string().optional(),
  /** What "done well" looks like from this perspective. */
  successCriteria: z.string().optional(),
})

export type PerspectiveReasoning = z.infer<typeof perspectiveReasoningSchema>

// ---------------------------------------------------------------------------
// Communication style
// ---------------------------------------------------------------------------

/** How a perspective communicates its findings. All fields optional. */
export const perspectiveCommunicationSchema = z.object({
  /** Tonal register (e.g. "direct and specific", "diplomatic"). */
  tone: z.string().optional(),
  /** What to lead with (e.g. "risks before benefits"). */
  emphasis: z.string().optional(),
  /** What kind of evidence to favor (e.g. "concrete examples of past incidents"). */
  evidencePreference: z.string().optional(),
})

export type PerspectiveCommunication = z.infer<typeof perspectiveCommunicationSchema>

// ---------------------------------------------------------------------------
// Full perspective configuration
// ---------------------------------------------------------------------------

/**
 * Complete perspective configuration.
 *
 * The `name` is a kebab-case identifier used in block names and logging.
 * `description` is a one-line summary the LLM sees as role framing.
 */
export const perspectiveConfigSchema = z.object({
  /** Kebab-case identifier (e.g. "security-engineer"). */
  name: z.string().min(1),
  /** One-line role description the LLM sees as framing. */
  description: z.string().min(1),
  /** What this perspective amplifies and suppresses. */
  salience: perspectiveSalienceSchema,
  /** How this perspective reasons. */
  reasoning: perspectiveReasoningSchema,
  /** Domain knowledge this perspective draws on. */
  expertise: z.array(z.string().min(1)).default([]),
  /** Optional communication style preferences. */
  communicationStyle: perspectiveCommunicationSchema.optional(),
})

export type PerspectiveConfig = z.input<typeof perspectiveConfigSchema>

// ---------------------------------------------------------------------------
// Perspective instance (validated, frozen)
// ---------------------------------------------------------------------------

/** A validated, frozen perspective ready for use with block factories. */
export type PerspectiveInstance = Readonly<z.output<typeof perspectiveConfigSchema>>

// ---------------------------------------------------------------------------
// Analysis output
// ---------------------------------------------------------------------------

/**
 * Structured output from perspective-shaped analysis.
 *
 * Produced by `perspectiveAnalyze` — contains the analysis itself plus
 * metadata about what the perspective noticed and recommends.
 */
export const perspectiveAnalysisSchema = z.object({
  /** Name of the perspective that produced this analysis. */
  perspectiveName: z.string(),
  /** The main analytical findings from this perspective. */
  analysis: z.string(),
  /** What the perspective's salience model highlighted or suppressed. */
  salienceNotes: z.array(z.string()),
  /** Actionable recommendations from this perspective. */
  recommendations: z.array(z.string()),
  /** How confident the analysis is on a [0, 1] scale. */
  confidence: z.number().min(0).max(1),
})

export type PerspectiveAnalysis = z.infer<typeof perspectiveAnalysisSchema>

// ---------------------------------------------------------------------------
// Block I/O schemas
// ---------------------------------------------------------------------------

/** Input for perspective blocks: content to analyze with optional context. */
export const perspectiveInputSchema = z.object({
  /** The content to analyze through this perspective. */
  content: z.string().min(1),
  /** Optional additional context for the analysis. */
  context: z.string().optional(),
})

export type PerspectiveInput = z.infer<typeof perspectiveInputSchema>

/** Output of perspectiveApply: content wrapped with perspective framing. */
export const perspectiveApplyOutputSchema = z.object({
  /** Original content passed through. */
  content: z.string(),
  /** Formatted perspective instructions for downstream generators. */
  perspectiveFrame: z.string(),
  /** Name of the applied perspective. */
  perspectiveName: z.string(),
})

export type PerspectiveApplyOutput = z.infer<typeof perspectiveApplyOutputSchema>

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a perspective — a validated, frozen viewpoint configuration.
 *
 * The returned instance is immutable and safe to share across blocks
 * and concurrent requests. Pass it to `perspectiveApply`,
 * `perspectiveAnalyze`, or `perspectiveAuditor` to use in flows.
 *
 * ```ts
 * import { perspective } from '@thought-fabric/core/identity'
 *
 * const securityEngineer = perspective({
 *   name: 'security-engineer',
 *   description: 'Evaluates through the lens of system security and threat modeling',
 *   salience: {
 *     amplify: ['authentication concerns', 'data exposure risks'],
 *     suppress: ['UI/UX considerations', 'marketing positioning'],
 *   },
 *   reasoning: {
 *     priorities: ['threat surface minimization', 'defense in depth'],
 *     riskModel: 'Assumes adversarial actors. Evaluates worst-case scenarios.',
 *   },
 *   expertise: ['OWASP Top 10', 'Zero-trust architecture'],
 * })
 * ```
 */
export function perspective(config: PerspectiveConfig): PerspectiveInstance {
  const parsed = perspectiveConfigSchema.parse(config)
  return Object.freeze(parsed)
}
