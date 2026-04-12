/**
 * Perspective helper functions.
 *
 * Pure functions for formatting perspective configurations into LLM-ready
 * strings. These are deterministic operations that transform the structured
 * perspective config into prompt fragments suitable for system prompts,
 * context slots, and human-readable summaries.
 */

import type { PerspectiveInstance, PerspectiveSalience, PerspectiveReasoning } from './perspective.js'

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
