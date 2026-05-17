/**
 * Digest regeneration blocks ([FIX-408]).
 *
 * Three internal blocks composed into one exported sequencer:
 *   guard     — staleness short-circuit; reads sources, decides if regen is needed
 *   generate  — single LLM call; iterative (previous digest is included)
 *   persist   — writes the new digest + bumps `totalGenerated`
 *
 * Generate and persist are gated behind the guard's `triggered` flag so the
 * LLM call is skipped entirely when the underlying stores haven't changed
 * since the last digest. The persist block reads source state and computes
 * its own signature at write time; per-scope mutation serialization makes
 * this race-free across the single-sequencer run.
 */

import { generator, handler, sequencer } from '@flow-state-dev/core'
import { z } from 'zod'
import { workingMemoryResource } from './working-memory.js'
import { createEpisodicMemoryResource } from './episodic-memory.js'
import { recent as recentEpisodes } from './episodic-memory-helpers.js'
import { createSemanticMemoryResource } from './semantic-memory.js'
import { topFacts } from './semantic-memory-helpers.js'
import {
  createDigestMemoryResource,
  type Digest,
  type DigestMemoryState,
} from './digest-memory.js'
import { computeSourceSignature } from './digest-helpers.js'
import { memorySystemResource } from './memory-system.js'
import type { MemorySystemBlocksConfig } from './memory-system-blocks.js'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Resolved digest configuration passed into the digest blocks. */
export interface DigestBlocksConfig {
  /** Resource scope (mirrors semantic). */
  scope: 'user' | 'org'
  /** Hard cap on digest output tokens. */
  maxTokens: number
  /** How many top-by-reinforcement facts to feed into the prompt. */
  topN: { facts: number; episodes: number }
}

/**
 * Combined config for the digest blocks. Adds an optional shared resource
 * reference so all digest blocks (and the memory system at large) share
 * the same `defineResource()` instance.
 */
export type DigestRegenerateConfig = MemorySystemBlocksConfig & {
  digest: DigestBlocksConfig
  _digestResource?: ReturnType<typeof createDigestMemoryResource>
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/** Input to the digest sequencer. `force: true` bypasses the staleness guard. */
export const digestRegenerateInputSchema = z.object({
  force: z.boolean().optional(),
}).optional()

/** Guard handler output — feeds into the generator's context. */
const digestGuardOutputSchema = z.object({
  triggered: z.boolean(),
  /** Previous digest narrative (if any), included for iterative regeneration. */
  previous: z.string().optional(),
  /** Top-N facts in prompt-ready form. */
  facts: z.array(z.object({
    subject: z.string(),
    content: z.string(),
    category: z.string(),
    confidence: z.number(),
    reinforcementCount: z.number(),
  })),
  /** Top-N episodes in prompt-ready form. */
  episodes: z.array(z.object({
    content: z.string(),
    category: z.string(),
    significance: z.number(),
    occurredAtTurn: z.number(),
  })),
})

type DigestGuardOutput = z.infer<typeof digestGuardOutputSchema>

/**
 * Generator output schema — bare text per FIX-408's design ("the digest is
 * text, not a structured object"). Using `z.string()` opts the generator into
 * core's streaming text path, so a response that hits `maxTokens` produces a
 * shorter-but-valid string rather than an unparseable truncated JSON object.
 */
export const digestOutputSchema = z.string()

// ---------------------------------------------------------------------------
// Helpers exposed for testing
// ---------------------------------------------------------------------------

/**
 * Score-and-rank episodes by significance × recency. Pure; exported so
 * tests can verify ranking independently from the guard handler.
 *
 * `recencyFactor` is normalised against the maximum `occurredAtTurn` in
 * the input set so older absolute turn numbers don't suppress the score.
 */
export function rankEpisodesForDigest<E extends { significance: number; occurredAtTurn: number }>(
  episodes: E[],
  limit: number,
): E[] {
  if (episodes.length === 0) return []
  const maxTurn = episodes.reduce((m, e) => Math.max(m, e.occurredAtTurn), 0)
  const scored = episodes.map((e) => ({
    ep: e,
    score: e.significance * (0.5 + 0.5 * (maxTurn > 0 ? e.occurredAtTurn / maxTurn : 1)),
  }))
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map((s) => s.ep)
}

/**
 * Build the user-message context for the digest generator. Pure function
 * so tests can verify prompt shape (especially: previous digest is
 * included for iterative regeneration) without an LLM call.
 */
export function buildDigestContext(input: DigestGuardOutput): string {
  if (!input.triggered) return 'No digest regeneration needed. Return empty content.'

  const parts: string[] = []

  if (input.previous && input.previous.trim().length > 0) {
    parts.push(`Previous digest (revise rather than rewrite):\n${input.previous}`)
  } else {
    parts.push('No previous digest exists yet — generate the first one.')
  }

  if (input.facts.length > 0) {
    const lines = input.facts.map(
      (f) =>
        `- (${f.category}, ×${f.reinforcementCount}, conf ${f.confidence.toFixed(2)}) [subject=${f.subject}] ${f.content}`,
    )
    parts.push(`Top semantic facts by reinforcement:\n${lines.join('\n')}`)
  } else {
    parts.push('No semantic facts yet.')
  }

  if (input.episodes.length > 0) {
    const lines = input.episodes.map(
      (e) =>
        `- (${e.category}, sig ${e.significance.toFixed(2)}, turn ${e.occurredAtTurn}) ${e.content}`,
    )
    parts.push(`Recent significant episodes:\n${lines.join('\n')}`)
  }

  return parts.join('\n\n')
}

// ---------------------------------------------------------------------------
// Block factories
// ---------------------------------------------------------------------------

/**
 * Guard handler — reads digest, semantic, and episodic state; decides whether
 * to trigger regeneration based on `sourceSignature` drift.
 *
 * `force: true` on the input bypasses the staleness check (used by the
 * manual `mem.regenerateDigest()` escape hatch).
 */
export function digestRegenerateGuard(config: DigestRegenerateConfig) {
  const semanticResource = config._semanticResource ?? (config.semantic
    ? createSemanticMemoryResource(config.semantic.scope)
    : undefined)
  const episodicResource = config._episodicResource ?? (config.episodic
    ? createEpisodicMemoryResource(config.episodic.scope)
    : undefined)
  const digestResource = config._digestResource ?? createDigestMemoryResource(config.digest.scope)

  const resources: Record<string, any> = {
    workingMemory: workingMemoryResource,
    memorySystem: memorySystemResource,
    digestMemory: digestResource,
  }
  if (semanticResource) resources.semanticMemory = semanticResource
  if (episodicResource) resources.episodicMemory = episodicResource

  return handler({
    name: config.name ? `${config.name}/digest/guard` : 'memory/digest/guard',
    inputSchema: digestRegenerateInputSchema,
    outputSchema: digestGuardOutputSchema,
    resources,
    execute: async (input, ctx: any): Promise<DigestGuardOutput> => {
      const digestRef = ctx.resources.digestMemory
      const semRef = ctx.resources.semanticMemory
      const epRef = ctx.resources.episodicMemory

      // Without a semantic store there is nothing to summarise — never trigger.
      if (!semRef) {
        return { triggered: false, facts: [], episodes: [] }
      }

      const signature = computeSourceSignature(semRef, epRef)
      const stored = digestRef?.state?.digest as Digest | undefined

      const force = !!input?.force
      const stale =
        !stored ||
        stored.sourceSignature.semanticFactCount !== signature.semanticFactCount ||
        stored.sourceSignature.semanticReinforcementSum !== signature.semanticReinforcementSum ||
        stored.sourceSignature.episodeCount !== signature.episodeCount

      if (!force && !stale) {
        return { triggered: false, previous: stored?.content, facts: [], episodes: [] }
      }

      const facts = topFacts(semRef, config.digest.topN.facts).map((f) => ({
        subject: f.subject,
        content: f.content,
        category: f.category as string,
        confidence: f.confidence,
        reinforcementCount: f.reinforcementCount,
      }))

      const episodes = epRef
        ? rankEpisodesForDigest(recentEpisodes(epRef), config.digest.topN.episodes).map((e) => ({
            content: e.content,
            category: e.category as string,
            significance: e.significance,
            occurredAtTurn: e.occurredAtTurn,
          }))
        : []

      return { triggered: true, previous: stored?.content, facts, episodes }
    },
  })
}

/**
 * Generator block — one LLM call producing the digest narrative.
 *
 * Iterative: the previous digest is fed back in as the framing baseline.
 * Bounded by `config.digest.maxTokens` at the provider level.
 */
export function digestRegenerateGenerate(config: DigestRegenerateConfig) {
  const digestPrompt = [
    'You produce a rolling DIGEST of what is known about a user.',
    '',
    'A digest is a single short narrative paragraph (or two) — connective prose,',
    'not a bullet list — that captures the stable framing a downstream agent needs',
    'to understand who it is talking to. It is read on every turn, so it must be',
    'concise, coherent, and free of turn-to-turn detail.',
    '',
    'Inputs you will receive:',
    '- The previous digest (if any). Treat it as the framing baseline; revise',
    '  rather than rewrite. Keep what still holds; only change what new evidence',
    '  demands.',
    '- Top semantic facts by reinforcement count. Preserve high-reinforcement facts',
    '  verbatim-in-meaning — these are the most established knowledge.',
    '- Recent and significant episodes. Use only as supporting evidence; do not',
    '  narrate them as events.',
    '',
    'Rules:',
    '- Organise by themes you infer (identity, profession, preferences, active',
    '  concerns, relationships) — NOT by source store.',
    '- Use connective prose. No bullet lists. No headers.',
    '- Include only stable "what I know". Leave session-specific or task-specific',
    `  detail out. Stay under roughly ${config.digest.maxTokens} tokens.`,
    '- If the inputs are empty or trivial, return a brief honest digest',
    '  ("Little is known about the user yet.") rather than fabricating content.',
    '- Do NOT include negative claims ("the user does NOT ...").',
    '- Do NOT mention the digest itself, the consolidation system, or these rules.',
  ].join('\n')

  return generator({
    name: config.name ? `${config.name}/digest/generate` : 'memory/digest/generate',
    model: config.model,
    inputSchema: z.any(),
    outputSchema: digestOutputSchema,
    prompt: digestPrompt,
    context: (input: any) => buildDigestContext(input as DigestGuardOutput),
    user: () => 'Produce the digest.',
    maxTokens: config.digest.maxTokens,
    agentType: 'trace',
  })
}

/**
 * Persist handler — writes the generated digest along with a fresh
 * source-state signature. Reads `semanticMemory` (and optional `episodicMemory`)
 * to compute the signature at write time; per-scope mutation serialization
 * means the signature observed here equals the one the guard observed for
 * any single sequencer run. No-ops on empty content so a truncated LLM
 * response doesn't overwrite a previous good digest.
 */
export function digestRegeneratePersist(config: DigestRegenerateConfig) {
  const semanticResource = config._semanticResource ?? (config.semantic
    ? createSemanticMemoryResource(config.semantic.scope)
    : undefined)
  const episodicResource = config._episodicResource ?? (config.episodic
    ? createEpisodicMemoryResource(config.episodic.scope)
    : undefined)
  const digestResource = config._digestResource ?? createDigestMemoryResource(config.digest.scope)

  const resources: Record<string, any> = {
    workingMemory: workingMemoryResource,
    digestMemory: digestResource,
  }
  if (semanticResource) resources.semanticMemory = semanticResource
  if (episodicResource) resources.episodicMemory = episodicResource

  return handler({
    name: config.name ? `${config.name}/digest/persist` : 'memory/digest/persist',
    inputSchema: digestOutputSchema,
    outputSchema: z.any(),
    resources,
    execute: async (input, ctx: any) => {
      const digestRef = ctx.resources.digestMemory
      const semRef = ctx.resources.semanticMemory
      const epRef = ctx.resources.episodicMemory
      const wmRef = ctx.resources.workingMemory
      const content = typeof input === 'string' ? input : ''
      if (!digestRef || content.trim().length === 0) {
        return { persisted: false }
      }

      const signature = semRef
        ? computeSourceSignature(semRef, epRef)
        : { semanticFactCount: 0, semanticReinforcementSum: 0, episodeCount: 0 }
      const currentTurn = wmRef?.state?.currentTurn ?? 0

      const next: Digest = {
        content,
        generatedAt: new Date().toISOString(),
        generatedAtTurn: currentTurn,
        sourceSignature: signature,
      }

      await digestRef.updateState((s: DigestMemoryState) => ({
        ...s,
        digest: next,
        totalGenerated: s.totalGenerated + 1,
      }))

      return { persisted: true, digest: next }
    },
  })
}

/**
 * Assembles the digest regeneration sequencer:
 *   guard → (if triggered) → generate → persist
 *
 * Manual invocation (via `mem.regenerateDigest()`) pre-binds `force: true`
 * to bypass the guard's staleness check.
 */
export function digestRegenerate(config: DigestRegenerateConfig) {
  const sharedDigestResource = config._digestResource ?? createDigestMemoryResource(config.digest.scope)
  const digestConfig = { ...config, _digestResource: sharedDigestResource }

  const guardBlock = digestRegenerateGuard(digestConfig)
  const generateBlock = digestRegenerateGenerate(digestConfig)
  const persistBlock = digestRegeneratePersist(digestConfig)

  return sequencer({
    name: config.name ? `${config.name}/digest/regenerate` : 'memory/digest/regenerate',
    inputSchema: digestRegenerateInputSchema,
  })
    .then(guardBlock)
    .exitIf((result: DigestGuardOutput) => !result.triggered)
    .then(generateBlock)
    .then(persistBlock)
}
