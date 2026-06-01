/**
 * Perspective helper functions.
 *
 * Pure functions for formatting perspective configurations into LLM-ready
 * strings. These are deterministic operations that transform the structured
 * perspective config into prompt fragments suitable for system prompts,
 * context slots, and human-readable summaries.
 */

import type { ResourceContext } from '@flow-state-dev/core'
import { shortId } from '../helpers'
import type {
  PerspectiveInstance,
  PerspectiveSalience,
  PerspectiveReasoning,
  PerspectiveObservation,
  PerspectiveObservationsState,
  PerspectivePosition,
  PerspectivePositionsState,
} from './perspective'

/** Reference type for the observations resource. */
export type PerspectiveObservationsRef = ResourceContext<PerspectiveObservationsState>

/** Reference type for the positions resource. */
export type PerspectivePositionsRef = ResourceContext<PerspectivePositionsState>

/** Input shape for `addPerspectiveObservation` — server fills id and addedAt. */
export interface AddPerspectiveObservationInput {
  content: string
  category?: string
  confidence?: number
  source?: string
}

/** Input shape for `addPerspectivePosition` — server fills id, addedAt, challenges. */
export interface AddPerspectivePositionInput {
  claim: string
  reasoning: string
  confidence?: number
  supportingObservations?: string[]
}

// ---------------------------------------------------------------------------
// Section formatters
// ---------------------------------------------------------------------------

/**
 * Format a perspective's salience model for LLM consumption.
 *
 * Produces a bullet list of amplified and suppressed concerns.
 */
export function formatPerspectiveSalience(salience: PerspectiveSalience): string {
  const lines: string[] = ['## Salience Model']

  lines.push('')
  lines.push('**Pay close attention to:**')
  for (const item of salience.amplify) {
    lines.push(`- ${item}`)
  }

  if (salience.suppress.length > 0) {
    lines.push('')
    lines.push('**De-emphasize:**')
    for (const item of salience.suppress) {
      lines.push(`- ${item}`)
    }
  }

  return lines.join('\n')
}

/**
 * Format a perspective's reasoning configuration for LLM consumption.
 *
 * Produces the priorities list plus optional risk model and success criteria.
 */
export function formatPerspectiveReasoning(reasoning: PerspectiveReasoning): string {
  const lines: string[] = ['## Reasoning Approach']

  lines.push('')
  lines.push('**Priorities (in order):**')
  for (let i = 0; i < reasoning.priorities.length; i++) {
    lines.push(`${i + 1}. ${reasoning.priorities[i]}`)
  }

  if (reasoning.riskModel) {
    lines.push('')
    lines.push(`**Risk model:** ${reasoning.riskModel}`)
  }

  if (reasoning.successCriteria) {
    lines.push('')
    lines.push(`**Success criteria:** ${reasoning.successCriteria}`)
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Full perspective formatter
// ---------------------------------------------------------------------------

/**
 * Format a complete perspective for LLM system prompt injection.
 *
 * Produces a structured document with role framing, salience model,
 * reasoning approach, expertise, and communication style.
 */
export function formatPerspective(instance: PerspectiveInstance): string {
  const sections: string[] = []

  // Role framing
  sections.push(`# Perspective: ${instance.name}`)
  sections.push('')
  sections.push(instance.description)

  // Salience
  sections.push('')
  sections.push(formatPerspectiveSalience(instance.salience))

  // Reasoning
  sections.push('')
  sections.push(formatPerspectiveReasoning(instance.reasoning))

  // Expertise
  if (instance.expertise.length > 0) {
    sections.push('')
    sections.push('## Domain Expertise')
    sections.push('')
    sections.push('Draw on knowledge of:')
    for (const area of instance.expertise) {
      sections.push(`- ${area}`)
    }
  }

  // Communication style
  if (instance.communicationStyle) {
    const style = instance.communicationStyle
    const styleParts: string[] = []

    if (style.tone) styleParts.push(`**Tone:** ${style.tone}`)
    if (style.emphasis) styleParts.push(`**Emphasis:** ${style.emphasis}`)
    if (style.evidencePreference) styleParts.push(`**Evidence preference:** ${style.evidencePreference}`)

    if (styleParts.length > 0) {
      sections.push('')
      sections.push('## Communication Style')
      sections.push('')
      sections.push(styleParts.join('\n'))
    }
  }

  return sections.join('\n')
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

/**
 * One-line summary of a perspective.
 *
 * Useful for logging, trace labels, and multi-perspective comparison headers.
 */
export function summarizePerspective(instance: PerspectiveInstance): string {
  const expertiseNote = instance.expertise.length > 0
    ? ` (${instance.expertise.slice(0, 3).join(', ')}${instance.expertise.length > 3 ? ', ...' : ''})`
    : ''
  return `${instance.name}: ${instance.description}${expertiseNote}`
}

// ---------------------------------------------------------------------------
// Context formatter
// ---------------------------------------------------------------------------

/**
 * Ready-made context formatter for generators.
 *
 * Reads the perspective instance from the block's config closure and
 * produces the formatted perspective as a context string. Use with the
 * generator's `context: [...]` slot.
 *
 * ```ts
 * import { perspectiveContextFormatter } from '@thought-fabric/core/identity'
 *
 * // Create a formatter bound to a specific perspective
 * const formatter = perspectiveContextFormatter(myPerspective)
 *
 * const gen = generator({
 *   context: [formatter],
 *   ...
 * })
 * ```
 */
export function perspectiveContextFormatter(instance: PerspectiveInstance) {
  return (_input: unknown, _ctx: unknown): string => {
    return formatPerspective(instance)
  }
}

// ===========================================================================
// Phase B — Observation helpers
// ===========================================================================

/**
 * Add an observation to the observations resource.
 *
 * Fills in `id` and `addedAt` from the resource state's turn counter.
 * Returns the fully-formed observation that was recorded.
 */
export async function addPerspectiveObservation(
  ref: PerspectiveObservationsRef,
  input: AddPerspectiveObservationInput,
): Promise<PerspectiveObservation> {
  const state = ref.state

  const observation: PerspectiveObservation = {
    id: `pobs_${shortId()}`,
    content: input.content,
    category: input.category ?? 'observation',
    confidence: input.confidence ?? 0.7,
    source: input.source,
    addedAt: state.turnCounter,
  }

  await ref.updateState((s) => ({
    ...s,
    observations: [...s.observations, observation],
  }))

  return observation
}

/**
 * Remove an observation by ID. Returns true if found and removed.
 */
export async function removePerspectiveObservation(
  ref: PerspectiveObservationsRef,
  id: string,
): Promise<boolean> {
  let removed = false

  await ref.updateState((s) => {
    const idx = s.observations.findIndex((o) => o.id === id)
    if (idx < 0) return s

    removed = true
    const observations = [...s.observations]
    observations.splice(idx, 1)
    return { ...s, observations }
  })

  return removed
}

/**
 * Read observations from the resource, optionally filtered by category.
 *
 * Returns observations in insertion order (oldest first). Use array methods
 * to sort by recency, confidence, or other criteria as needed.
 */
export function perspectiveObservations(
  ref: PerspectiveObservationsRef,
  category?: string,
): PerspectiveObservation[] {
  const all = ref.state.observations
  return category === undefined ? [...all] : all.filter((o) => o.category === category)
}

/**
 * Advance the observation turn counter by one.
 *
 * Future observations added after this call will have a higher `addedAt`.
 * Useful for marking session boundaries or interaction turns.
 */
export async function advancePerspectiveObservations(
  ref: PerspectiveObservationsRef,
): Promise<void> {
  await ref.updateState((s) => ({
    ...s,
    turnCounter: s.turnCounter + 1,
  }))
}

/**
 * Format observations as a categorized bullet list for LLM context.
 *
 * Groups by category and shows confidence in parentheses. Returns an empty
 * string when there are no observations.
 */
export function formatPerspectiveObservations(ref: PerspectiveObservationsRef): string {
  const observations = ref.state.observations
  if (observations.length === 0) return ''

  const lines: string[] = ['## Observations recorded so far']
  lines.push('')

  // Group by category
  const byCategory = new Map<string, PerspectiveObservation[]>()
  for (const obs of observations) {
    const list = byCategory.get(obs.category)
    if (list) list.push(obs)
    else byCategory.set(obs.category, [obs])
  }

  for (const [category, items] of byCategory) {
    lines.push(`**${category}:**`)
    for (const obs of items) {
      lines.push(`- ${obs.content} _(confidence: ${obs.confidence.toFixed(2)})_`)
    }
    lines.push('')
  }

  return lines.join('\n').trimEnd()
}

// ===========================================================================
// Phase B — Position helpers
// ===========================================================================

/**
 * Add a position to the positions resource.
 *
 * Fills in `id`, `addedAt`, and an empty `challenges` array. The `addedAt`
 * value is the current turn counter from the *observations* resource if
 * provided; otherwise positions are stamped with the count of existing
 * positions (positions don't have their own turn counter).
 */
export async function addPerspectivePosition(
  ref: PerspectivePositionsRef,
  input: AddPerspectivePositionInput,
  observationsRef?: PerspectiveObservationsRef,
): Promise<PerspectivePosition> {
  const addedAt = observationsRef
    ? observationsRef.state.turnCounter
    : ref.state.positions.length

  const position: PerspectivePosition = {
    id: `ppos_${shortId()}`,
    claim: input.claim,
    reasoning: input.reasoning,
    confidence: input.confidence ?? 0.7,
    supportingObservations: input.supportingObservations ?? [],
    challenges: [],
    addedAt,
  }

  await ref.updateState((s) => ({
    ...s,
    positions: [...s.positions, position],
  }))

  return position
}

/**
 * Append counter-evidence to a position. Does not remove the position —
 * challenges accumulate, and downstream formatters can use them to weaken
 * the position's effective confidence.
 *
 * Returns true if the position existed and was challenged, false otherwise.
 */
export async function challengePerspectivePosition(
  ref: PerspectivePositionsRef,
  positionId: string,
  evidence: string,
  observationsRef?: PerspectiveObservationsRef,
): Promise<boolean> {
  const addedAt = observationsRef ? observationsRef.state.turnCounter : 0
  let challenged = false

  await ref.updateState((s) => {
    const idx = s.positions.findIndex((p) => p.id === positionId)
    if (idx < 0) return s

    challenged = true
    const positions = [...s.positions]
    positions[idx] = {
      ...positions[idx],
      challenges: [...positions[idx].challenges, { evidence, addedAt }],
    }
    return { ...s, positions }
  })

  return challenged
}

/**
 * Remove a position by ID. Returns true if found and removed.
 */
export async function removePerspectivePosition(
  ref: PerspectivePositionsRef,
  id: string,
): Promise<boolean> {
  let removed = false

  await ref.updateState((s) => {
    const idx = s.positions.findIndex((p) => p.id === id)
    if (idx < 0) return s

    removed = true
    const positions = [...s.positions]
    positions.splice(idx, 1)
    return { ...s, positions }
  })

  return removed
}

/** Read all positions in insertion order. */
export function perspectivePositions(ref: PerspectivePositionsRef): PerspectivePosition[] {
  return [...ref.state.positions]
}

/**
 * Format positions as a numbered list with claims, reasoning, and any
 * accumulated challenges. Returns an empty string when there are no
 * positions.
 */
export function formatPerspectivePositions(ref: PerspectivePositionsRef): string {
  const positions = ref.state.positions
  if (positions.length === 0) return ''

  const lines: string[] = ['## Positions taken']
  lines.push('')

  for (let i = 0; i < positions.length; i++) {
    const p = positions[i]
    lines.push(`${i + 1}. **${p.claim}** _(confidence: ${p.confidence.toFixed(2)})_`)
    lines.push(`   _Reasoning:_ ${p.reasoning}`)
    if (p.challenges.length > 0) {
      lines.push(`   _Challenged by:_`)
      for (const c of p.challenges) {
        lines.push(`     - ${c.evidence}`)
      }
    }
    lines.push('')
  }

  return lines.join('\n').trimEnd()
}

// ---------------------------------------------------------------------------
// Combined formatter
// ---------------------------------------------------------------------------

/**
 * Format both observations and positions into a single context block.
 *
 * Returns an empty string when both resources are empty. Useful for the
 * `accumulated` capability preset that injects evolving state into
 * generator prompts alongside the static perspective framing.
 */
export function formatPerspectiveAccumulated(
  observationsRef: PerspectiveObservationsRef | undefined,
  positionsRef?: PerspectivePositionsRef,
): string {
  const sections: string[] = []

  if (observationsRef) {
    const obs = formatPerspectiveObservations(observationsRef)
    if (obs) sections.push(obs)
  }

  if (positionsRef) {
    const pos = formatPerspectivePositions(positionsRef)
    if (pos) sections.push(pos)
  }

  return sections.join('\n\n')
}
