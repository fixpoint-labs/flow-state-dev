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

import { defineResource } from '@flow-state-dev/core'
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

// ===========================================================================
// Phase B — Resource-backed runtime state
// ===========================================================================

// ---------------------------------------------------------------------------
// Observations — things the perspective noticed
// ---------------------------------------------------------------------------

/**
 * A single observation recorded by the perspective.
 *
 * Observations are atomic notice events — discrete things the perspective
 * picked up while analyzing content. They accumulate over a session and
 * can be queried, filtered, formatted, or summarized into positions.
 */
export const perspectiveObservationSchema = z.object({
  /** Unique identifier for this observation. */
  id: z.string(),
  /** Concise statement of what the perspective noticed. */
  content: z.string(),
  /** Semantic category — e.g. 'risk', 'opportunity', 'pattern', 'concern', 'strength'. */
  category: z.string(),
  /** Confidence the observation is real and significant. Range [0, 1]. */
  confidence: z.number().min(0).max(1),
  /** Optional: what input or context triggered this observation. */
  source: z.string().optional(),
  /** Turn number when this observation was added. */
  addedAt: z.number().int().min(0),
})

export type PerspectiveObservation = z.infer<typeof perspectiveObservationSchema>

/** Observations resource state: the observation log + a turn counter. */
export const perspectiveObservationsStateSchema = z.object({
  /** All recorded observations, in insertion order. */
  observations: z.array(perspectiveObservationSchema),
  /** Monotonic turn counter — bumped via `advancePerspectiveObservations`. */
  turnCounter: z.number().int().min(0),
})

export type PerspectiveObservationsState = z.infer<typeof perspectiveObservationsStateSchema>

/**
 * Resource holding a perspective's observations.
 *
 * The capability and bundled blocks always declare this at session scope —
 * observations are inherently tied to the conversation they emerged from.
 */
export const perspectiveObservationsResource = defineResource({
  stateSchema: perspectiveObservationsStateSchema,
  default: { observations: [], turnCounter: 0 },
  writable: true,
})

// ---------------------------------------------------------------------------
// Positions — conclusions the perspective has reached
// ---------------------------------------------------------------------------

/**
 * A counter-evidence record attached to a position.
 *
 * Positions can be challenged with new evidence that weakens (or contradicts)
 * the original claim. Challenges are append-only — they don't remove the
 * position, but they do reduce its effective confidence in formatters.
 */
export const perspectivePositionChallengeSchema = z.object({
  /** The counter-evidence text. */
  evidence: z.string(),
  /** Turn number when the challenge was added. */
  addedAt: z.number().int().min(0),
})

export type PerspectivePositionChallenge = z.infer<typeof perspectivePositionChallengeSchema>

/**
 * A position the perspective has taken — a synthesized conclusion drawn
 * from one or more observations.
 *
 * Positions are more stable and declarative than observations. They link
 * back to the supporting observation IDs and can carry challenges that
 * weaken their effective confidence over time.
 */
export const perspectivePositionSchema = z.object({
  /** Unique identifier for this position. */
  id: z.string(),
  /** The claim or conclusion. */
  claim: z.string(),
  /** Reasoning behind the position. */
  reasoning: z.string(),
  /** Initial confidence at the time of recording. Range [0, 1]. */
  confidence: z.number().min(0).max(1),
  /** IDs of observations that support this position. */
  supportingObservations: z.array(z.string()),
  /** Counter-evidence challenges accumulated over time. */
  challenges: z.array(perspectivePositionChallengeSchema),
  /** Turn number when the position was first recorded. */
  addedAt: z.number().int().min(0),
})

export type PerspectivePosition = z.infer<typeof perspectivePositionSchema>

/** Positions resource state: just the array of positions. */
export const perspectivePositionsStateSchema = z.object({
  /** All recorded positions, in insertion order. */
  positions: z.array(perspectivePositionSchema),
})

export type PerspectivePositionsState = z.infer<typeof perspectivePositionsStateSchema>

/**
 * Resource holding a perspective's positions.
 *
 * Scope is decided by where the capability or block declares this resource
 * (`sessionResources` / `userResources` / `orgResources`), not by the
 * resource definition itself. The bundled `system()` factory installs it at
 * the configured `positionScope` (default `'session'`).
 */
export const perspectivePositionsResource = defineResource({
  stateSchema: perspectivePositionsStateSchema,
  default: { positions: [] },
  writable: true,
})

// ---------------------------------------------------------------------------
// Block I/O schemas (Phase B)
// ---------------------------------------------------------------------------

/**
 * Input to `perspectiveObserve` — accepts either a raw observation batch
 * or a `PerspectiveAnalysis` whose `salienceNotes` will be promoted to
 * observations.
 */
export const perspectiveObserveInputSchema = z.union([
  perspectiveAnalysisSchema,
  z.object({
    /** Explicit observation entries to record. */
    observations: z.array(z.object({
      content: z.string().min(1),
      category: z.string().min(1).default('observation'),
      confidence: z.number().min(0).max(1).default(0.7),
      source: z.string().optional(),
    })).min(1),
  }),
])

export type PerspectiveObserveInput = z.infer<typeof perspectiveObserveInputSchema>

/** Output of `perspectiveObserve` — the IDs of newly recorded observations. */
export const perspectiveObserveOutputSchema = z.object({
  /** The observations that were recorded. */
  observations: z.array(perspectiveObservationSchema),
})

export type PerspectiveObserveOutput = z.infer<typeof perspectiveObserveOutputSchema>

/** Input to `perspectivePosition` — claim, reasoning, optional supporting refs. */
export const perspectivePositionInputSchema = z.object({
  claim: z.string().min(1),
  reasoning: z.string().min(1),
  confidence: z.number().min(0).max(1).default(0.7),
  supportingObservations: z.array(z.string()).default([]),
})

export type PerspectivePositionInput = z.infer<typeof perspectivePositionInputSchema>

/** Input to `perspectiveChallenge` — position id + counter-evidence. */
export const perspectiveChallengeInputSchema = z.object({
  positionId: z.string().min(1),
  evidence: z.string().min(1),
})

export type PerspectiveChallengeInput = z.infer<typeof perspectiveChallengeInputSchema>

/** Snapshot output: current observations and positions. */
export const perspectiveSnapshotOutputSchema = z.object({
  observations: z.array(perspectiveObservationSchema),
  positions: z.array(perspectivePositionSchema),
  turnCounter: z.number().int().min(0),
})

export type PerspectiveSnapshotOutput = z.infer<typeof perspectiveSnapshotOutputSchema>
