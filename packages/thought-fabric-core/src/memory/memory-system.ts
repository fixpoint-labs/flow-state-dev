import { defineResource, defineCapability } from '@flow-state-dev/core'
import type { ResourceContext, CapabilityRef } from '@flow-state-dev/core'
import { z } from 'zod'
import type { ZodTypeAny } from 'zod'
import { tokenOverlap } from '../helpers.js'
import {
  workingMemoryResource,
  type WorkingMemoryState,
  type WorkingMemoryEntry,
} from './working-memory.js'
import {
  DEFAULT_WORKING_MEMORY_CONFIG,
  items as wmItems,
  computeSalience,
  formatForContext,
  add,
  evict,
  pin,
  unpin,
  refresh,
  advance,
  computeDecay,
} from './working-memory-helpers.js'
import type { WorkingMemoryDecayConfig, WorkingMemoryHelperConfig } from './working-memory-helpers.js'
import {
  createEpisodicMemoryResource,
  type EpisodicMemoryState,
  type Episode,
} from './episodic-memory.js'
import {
  encode,
  recent,
  markConsolidated,
} from './episodic-memory-helpers.js'
import {
  createSemanticMemoryResource,
  type SemanticMemoryState,
  type SemanticFact,
} from './semantic-memory.js'
import {
  addFact,
  updateFact,
  reinforce,
  removeFact,
  allFacts,
  query,
} from './semantic-memory-helpers.js'
import { memorySystemCapture, memorySystemConsolidate, memorySystemPrune } from './memory-system-blocks.js'
import {
  createWorkingMemoryCapability,
  createEpisodicMemoryCapability,
  createSemanticMemoryCapability,
  createDigestMemoryCapability,
} from './capabilities.js'
import {
  createDigestMemoryResource,
  type DigestMemoryState,
  type Digest,
} from './digest-memory.js'
import {
  computeSourceSignature as digestComputeSourceSignature,
  isStale as digestIsStale,
} from './digest-helpers.js'
import { digestRegenerate } from './digest-blocks.js'
import {
  createMemoryContextFormatter,
  createDigestEntry,
  createWorkingEntry,
  createSemanticEntry,
  createEpisodicEntry,
} from './formatter.js'
import { createRecallTool } from './tools/recall-tool.js'
import { resolveStrategy } from './tools/strategies/index.js'
import type { BuiltInStrategyName } from './tools/strategies/index.js'
import type { RetrievalStrategy } from './tools/types.js'

// ---------------------------------------------------------------------------
// Memory system tracking resource
// ---------------------------------------------------------------------------

/** Schema for the memory system tracking state. */
export const memorySystemStateSchema = z.object({
  /** Index of the last processed session item. */
  lastProcessedIndex: z.number().default(-1),
  /** Episodic writes since the last consolidation check. */
  episodicWritesSinceLastConsolidation: z.number().default(0),
  /** Persistent/permanent entries evicted since the last consolidation. */
  evictedPersistentSinceLastConsolidation: z.number().default(0),
  /** Turn number of the last consolidation. */
  lastConsolidationTurn: z.number().default(0),
})

/** Memory system tracking state type. */
export type MemorySystemState = z.infer<typeof memorySystemStateSchema>

/**
 * Session-scoped resource for memory system tracking (watermark + consolidation counters).
 */
export const memorySystemResource = defineResource({
  ref: 'memorySystem',
  scope: 'session',
  stateSchema: memorySystemStateSchema,
  default: {
    lastProcessedIndex: -1,
    episodicWritesSinceLastConsolidation: 0,
    evictedPersistentSinceLastConsolidation: 0,
    lastConsolidationTurn: 0,
  },
  writable: true,
})

// ---------------------------------------------------------------------------
// Preset names
// ---------------------------------------------------------------------------

/**
 * Orthogonal section presets exposed on the composed memory capability.
 *
 * Each preset toggles one slice of the memory surface independently:
 *
 * - `digest`   — inject the rolling digest into the prompt under
 *                `<memory><digest>…</digest></memory>` (default on).
 *                No-op when no digest tier is configured.
 * - `working`  — inject working-memory entries under
 *                `<memory><working>…</working></memory>` (default on).
 * - `recall`   — install the agent-invocable `tf.memory/recall` tool that
 *                searches semantic + episodic stores on demand (default on).
 * - `semantic` — inject the top-N semantic facts (by reinforcement count)
 *                under `<memory><semantic>…</semantic></memory>`
 *                (default off; opt-in for content-rich generators).
 *                No-op when no semantic tier is configured.
 * - `episodic` — inject the most-recent episodes under
 *                `<memory><episodic>…</episodic></memory>` (default off).
 *                No-op when no episodic tier is configured.
 *
 * Inclusion is independent of processing: the capture pipeline still runs
 * `tf.memory/digest/regenerate`, consolidation, prune, etc. for whichever
 * tiers are configured on `memorySystem({...})` — turning off a preset
 * just suppresses the section in that one generator's prompt.
 *
 * Default-on set: `['digest', 'working', 'recall']`. Authors who want
 * non-default `topN` / `limit` values should bypass the preset and use
 * `createMemoryContextFormatter({...})` directly in `context: { memory: … }`.
 */
export const MEMORY_CAPABILITY_PRESETS = [
  'digest',
  'working',
  'semantic',
  'episodic',
  'recall',
] as const

/** Union of valid preset names on the composed memory capability. */
export type MemoryCapabilityPreset = (typeof MEMORY_CAPABILITY_PRESETS)[number]

// ---------------------------------------------------------------------------
// Default config constants
// ---------------------------------------------------------------------------

/** Default configuration for episodic memory. */
export const DEFAULT_EPISODIC_CONFIG = {
  scope: 'user' as const,
  significanceThreshold: 0.6,
  maxEpisodes: 200,
}

/** Default configuration for semantic memory consolidation. */
export const DEFAULT_CONSOLIDATION_CONFIG = {
  episodicThreshold: 5,
  onEviction: true,
  minInterval: 4,
}

/** Default configuration for the memory observer. */
export const DEFAULT_OBSERVER_CONFIG = {
  maxAssistantChars: 500,
}

/** Default configuration for semantic memory pruning. */
export const DEFAULT_PRUNE_CONFIG = {
  pruneThreshold: 20,
}

/** Default configuration for the digest tier. */
export const DEFAULT_DIGEST_CONFIG = {
  maxTokens: 400,
  topN: { facts: 30, episodes: 10 },
} as const

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

/** Configuration for the working memory module within memory.system(). */
export interface WorkingMemorySystemConfig {
  capacity?: number
  maxPinnedSlots?: number
  decay?: Partial<WorkingMemoryDecayConfig>
}

/** Configuration for the episodic memory module within memory.system(). */
export interface EpisodicMemoryConfig {
  /** Scope for episodic storage. Default: 'user'. */
  scope?: 'user' | 'org'
  /** Minimum importance for an item to be encoded as an episode. Default: 0.6. */
  significanceThreshold?: number
  /** Maximum episodes to retain. Default: 200. */
  maxEpisodes?: number
}

/** Configuration for the digest tier within memory.system(). */
export interface DigestSystemConfig {
  /** Hard cap on digest output tokens. Default: 400. */
  maxTokens?: number
  /** Top-N inputs to the regeneration prompt. */
  topN?: {
    /** Top-N semantic facts by reinforcement count. Default: 30. */
    facts?: number
    /** Top-N recent-and-significant episodes. Default: 10. */
    episodes?: number
  }
}

/** Configuration for the semantic memory module within memory.system(). */
export interface SemanticMemoryConfig {
  /** Scope for semantic storage. Default: same as episodic, or 'user'. */
  scope?: 'user' | 'org'
  consolidation?: {
    /** Consolidate after this many new episodic entries. Default: 5. */
    episodicThreshold?: number
    /** Also consolidate when persistent items evicted from WM. Default: true. */
    onEviction?: boolean
    /** Don't consolidate more than once per N turns. Default: DEFAULT_CONSOLIDATION_CONFIG.minInterval. */
    minInterval?: number
  }
  /** Prune when fact count reaches this threshold. Default: 20. 0 to disable. */
  pruneThreshold?: number
}

/** Configuration for the agent-invocable recall tool (FIX-409). */
export interface MemoryToolConfig {
  /**
   * Retrieval strategy. Either a built-in name or a custom `RetrievalStrategy`
   * object. Default: `'llm-filter'`.
   */
  strategy?: BuiltInStrategyName | RetrievalStrategy
  /**
   * Model id for the strategy's LLM filter call (when applicable).
   * Defaults to `MemorySystemConfig.model`.
   */
  model?: string
  /** Defaults for tool input handling. */
  defaults?: {
    /** Default `limit`. Default: 5. */
    limit?: number
    /** Per-item char cap on returned content. Default: 400. */
    perItemCharCap?: number
  }
}

/** Top-level configuration for memory.system(). */
export interface MemorySystemConfig {
  /** Model ID for the observer LLM. */
  model: string
  /** Working memory config. `true` for defaults. Required. */
  working: WorkingMemorySystemConfig | true
  /** Episodic memory config. `true` for defaults. Omit to disable. */
  episodic?: EpisodicMemoryConfig | true
  /** Semantic memory config. `true` for defaults. Omit to disable. Requires episodic. */
  semantic?: SemanticMemoryConfig | true
  /**
   * Digest tier config. `true` for defaults; omit to disable.
   *
   * Requires `semantic` (the digest summarises the same store the semantic
   * tier owns). Scope is inherited from semantic; there is no separate
   * `digest.scope` knob — see [FIX-408] simplification.
   */
  digest?: DigestSystemConfig | true
  /** Optional custom name for the capture pipeline. */
  name?: string
  /** Optional input schema for source override. */
  inputSchema?: ZodTypeAny
  /** Optional custom source function — overrides reading from ctx.session.items. */
  source?: (input: unknown, ctx: any) => string
  /** Max chars of assistant response to include in captureFromItems. Default: 500. */
  maxAssistantChars?: number
  /** Recall-tool config. Omit to use defaults (`llm-filter` strategy). */
  tool?: MemoryToolConfig
}

// ---------------------------------------------------------------------------
// Return types
// ---------------------------------------------------------------------------

/** A ranked memory item from cross-store recall. */
export type RankedMemoryItem = {
  content: string
  source: 'working' | 'episodic' | 'semantic'
  relevance: number
  category: string
  id: string
  /** Subject of the fact (semantic items only). */
  subject?: string
}

/** The full memory system returned by memory.system(). */
export interface MemorySystem {
  /** Unified capture pipeline: observe → reflect → tick (+ consolidation when semantic). Takes string input. */
  capture: ReturnType<typeof memorySystemCapture>
  /** Self-serving capture: reads last user message + truncated assistant response from session items. Use with `.work()` after the generator. */
  captureFromItems: ReturnType<ReturnType<typeof memorySystemCapture>['connectInput']>
  /** Standalone consolidation sequencer (when semantic configured). */
  consolidate?: ReturnType<typeof memorySystemConsolidate>
  /** Standalone prune sequencer (when semantic configured). */
  prune?: ReturnType<typeof memorySystemPrune>
  /** Cross-store recall helper. */
  recall: (ctx: any, cue?: string) => RankedMemoryItem[]
  /**
   * Context formatter for generator context arrays.
   *
   * Returns an object whose keys become nested XML tags under the parent
   * key the formatter is registered against — e.g.
   * `context: { memory: mem.contextFormatter }` produces
   * `<memory><digest>…</digest><working>…</working></memory>`. Returning a
   * pre-formatted string with embedded tags would be XML-escaped by the
   * context aggregator's leaf renderer. Returns `undefined` when every
   * section is empty so the generator omits `<memory>` entirely.
   *
   * The convenience export uses the default `{ digest, working }`
   * configuration — equivalent to `createMemoryContextFormatter()`. For
   * richer mixes (semantic facts, recent episodes, custom limits) call
   * `createMemoryContextFormatter(options)` directly.
   */
  contextFormatter: (
    input: unknown,
    ctx: any
  ) => {
    digest?: string
    working?: string
    semantic?: string
    episodic?: string
  } | undefined
  /** Working memory module — resource and helpers. */
  working: {
    resource: typeof workingMemoryResource
    helpers: {
      add: typeof add
      evict: typeof evict
      pin: typeof pin
      unpin: typeof unpin
      refresh: typeof refresh
      tick: typeof advance
      items: typeof wmItems
      computeDecay: typeof computeDecay
      computeSalience: typeof computeSalience
    }
  }
  /** Episodic memory module — resource and helpers. Undefined if not configured. */
  episodic?: {
    resource: ReturnType<typeof createEpisodicMemoryResource>
    helpers: {
      encode: typeof encode
      recent: typeof recent
      markConsolidated: typeof markConsolidated
    }
  }
  /** Semantic memory module — resource and helpers. Undefined if not configured. */
  semantic?: {
    resource: ReturnType<typeof createSemanticMemoryResource>
    helpers: {
      addFact: typeof addFact
      updateFact: typeof updateFact
      reinforce: typeof reinforce
      removeFact: typeof removeFact
      allFacts: typeof allFacts
      query: typeof query
    }
  }
  /**
   * Digest tier — resource and helpers. Undefined if not configured.
   * The digest is the always-on, narrative-shaped memory summary used by
   * the simplified formatter ([FIX-407]).
   */
  digest?: {
    resource: ReturnType<typeof createDigestMemoryResource>
    helpers: {
      computeSourceSignature: typeof digestComputeSourceSignature
      isStale: typeof digestIsStale
    }
  }
  /**
   * Manual digest regeneration block. Pre-bound with `force: true` so it
   * always runs regardless of staleness — useful in tests and after
   * bulk-loading memory in setup. Undefined when digest is not configured.
   */
  regenerateDigest?: ReturnType<ReturnType<typeof digestRegenerate>['connectInput']>
  /**
   * Session-scoped resources for this memory system. Spread into `defineFlow`'s
   * single flat `resources` map (FIX-435):
   * ```ts
   * resources: { ...mem.sessionResources, ...mem.userResources }
   * ```
   * Always includes `workingMemory` and `memorySystem`.
   */
  sessionResources: {
    workingMemory: typeof workingMemoryResource
    memorySystem: typeof memorySystemResource
  }
  /**
   * User-scoped resources for this memory system. Spread into `defineFlow`'s
   * single flat `resources` map alongside `sessionResources`. Populated based
   * on which memory tiers are configured: `episodicMemory` (if episodic
   * enabled), `semanticMemory` (if semantic enabled).
   */
  userResources: {
    episodicMemory?: ReturnType<typeof createEpisodicMemoryResource>
    semanticMemory?: ReturnType<typeof createSemanticMemoryResource>
    digestMemory?: ReturnType<typeof createDigestMemoryResource>
  }

  /**
   * Composed memory capability for all configured tiers.
   *
   * Use on generators to auto-install resources, context formatting, typed
   * helpers, and the agent-invocable recall tool. Five orthogonal section
   * presets toggle independently — three default-on, two default-off:
   *
   *   - `digest` (default-on)   — render the rolling digest in the prompt.
   *                               No-op when no digest tier is configured.
   *   - `working` (default-on)  — render current working-memory entries.
   *   - `recall` (default-on)   — install the `tf.memory/recall` tool.
   *   - `semantic` (default-off) — render top-N semantic facts.
   *   - `episodic` (default-off) — render most-recent episodes.
   *
   * Inclusion is independent of processing — the capture pipeline still runs
   * `digestRegenerate`, consolidation, prune etc. for whichever tiers are
   * configured. Turning off a preset just suppresses the section in that
   * one generator's prompt.
   *
   * ```ts
   * // Primary agent — default; digest + working + recall
   * generator({ uses: [mem.capability] })
   *
   * // Worker — recall tool only, no memory injected into the prompt
   * generator({
   *   uses: [mem.capability.presets({ digest: false, working: false })],
   * })
   *
   * // Add semantic facts alongside the defaults
   * generator({ uses: [mem.capability.presets({ semantic: true })] })
   *
   * // For non-default top-N / limit values, bypass presets and use the
   * // factory directly:
   * generator({
   *   uses: [mem.capability.presets({ digest: false, working: false })],
   *   context: {
   *     memory: createMemoryContextFormatter({
   *       digest: true,
   *       working: true,
   *       episodic: { limit: 10 },
   *     }),
   *   },
   * })
   * ```
   *
   * For handlers, opt out of every section preset to keep just resources +
   * helpers:
   * ```ts
   * handler({
   *   uses: [mem.capability.presets({
   *     digest: false, working: false, recall: false,
   *   })],
   *   execute: async (input, ctx) => {
   *     const items = ctx.cap.memory.recall()
   *     await ctx.cap.workingMemory.add({ content: '...', importance: 0.8 })
   *   },
   * })
   * ```
   */
  capability: CapabilityRef

  /** Working memory capability. Available on all block kinds. */
  workingMemoryCapability: CapabilityRef

  /** Episodic memory capability (when episodic configured). */
  episodicMemoryCapability?: CapabilityRef

  /** Semantic memory capability (when semantic configured). */
  semanticMemoryCapability?: CapabilityRef

  /** Digest memory capability (when digest configured). */
  digestMemoryCapability?: CapabilityRef

  /**
   * Agent-invocable memory tools (FIX-409).
   *
   * Install on a generator via `tools: [mem.tool.recall()]`. The tool
   * searches stored memory (semantic facts + past episodes) on demand;
   * working memory is intentionally excluded — it lives in the formatter.
   *
   * Strategy and defaults are configured at `memory.system({ tool })` time.
   */
  tool: {
    /** Recall-tool factory — returns the handler block, ready to install. */
    recall: () => ReturnType<typeof createRecallTool>
  }
}

// ---------------------------------------------------------------------------
// Recall helper
// ---------------------------------------------------------------------------

/**
 * Unified cross-store recall.
 *
 * Queries working memory, (if installed) episodic memory, and (if installed) semantic memory.
 * Deduplication priority: semantic > working > episodic.
 * Returns ranked by relevance descending.
 */
function createRecall(
  episodicConfig?: { scope: 'user' | 'org' },
  semanticConfig?: { scope: 'user' | 'org' },
) {
  return function recall(ctx: any, cue?: string): RankedMemoryItem[] {
    const results: RankedMemoryItem[] = []

    // 1. Read semantic facts first (highest authority)
    if (semanticConfig) {
      try {
        const semRef = semanticConfig.scope === 'user'
          ? ctx.resources?.semanticMemory as ResourceContext<SemanticMemoryState> | undefined
          : ctx.resources?.semanticMemory as ResourceContext<SemanticMemoryState> | undefined

        if (semRef) {
          const facts = allFacts(semRef)
          for (const fact of facts) {
            // Relevance: confidence × (0.5 + 0.5 × normalizedReinforcement)
            const normalizedReinforcement = Math.min(1, fact.reinforcementCount / 10)
            let relevance = fact.confidence * (0.5 + 0.5 * normalizedReinforcement)

            if (cue) {
              const overlap = tokenOverlap(cue, fact.content)
              if (overlap > 0) relevance = Math.min(1, relevance + overlap * 0.4)
            }

            results.push({
              content: fact.content,
              source: 'semantic',
              relevance,
              category: fact.category,
              id: fact.id,
              subject: fact.subject,
            })
          }
        }
      } catch { /* semantic not available */ }
    }

    // 2. Read working memory
    try {
      const wmRef = ctx.resources?.workingMemory as ResourceContext<WorkingMemoryState> | undefined
      if (wmRef) {
        const entries = wmItems(wmRef)
        for (const entry of entries) {
          // Dedup: skip if semantic already has similar content
          const isDupOfSemantic = results.some(
            (r) => r.source === 'semantic' && tokenOverlap(entry.content, r.content) > 0.6,
          )
          if (isDupOfSemantic) continue

          let relevance = entry.salience
          if (cue) {
            const overlap = tokenOverlap(cue, entry.content)
            if (overlap > 0) relevance = Math.min(1, relevance + overlap * 0.2)
          }
          results.push({
            content: entry.content,
            source: 'working',
            relevance,
            category: entry.category ?? 'identity',
            id: entry.id,
          })
        }
      }
    } catch { /* working memory not available */ }

    // 3. Read episodic memory (if installed)
    if (episodicConfig) {
      try {
        const epRef = episodicConfig.scope === 'user'
          ? ctx.resources?.episodicMemory as ResourceContext<EpisodicMemoryState> | undefined
          : ctx.resources?.episodicMemory as ResourceContext<EpisodicMemoryState> | undefined

        if (epRef) {
          const episodes = recent(epRef)
          const maxTurn = episodes.length > 0 ? Math.max(...episodes.map((e) => e.occurredAtTurn)) : 1

          for (const ep of episodes) {
            // Dedup: skip if semantic or WM already has similar content
            const isDuplicate = results.some(
              (r) => (r.source === 'working' || r.source === 'semantic') &&
                tokenOverlap(ep.content, r.content) > 0.6,
            )
            if (isDuplicate) continue

            const recencyFactor = maxTurn > 0 ? (ep.occurredAtTurn / maxTurn) : 1
            let relevance = ep.significance * (0.5 + 0.5 * recencyFactor)

            if (cue) {
              const overlap = tokenOverlap(cue, ep.content)
              if (overlap > 0) relevance = Math.min(1, relevance + overlap * 0.3)
            }

            results.push({
              content: ep.content,
              source: 'episodic',
              relevance,
              category: ep.category,
              id: ep.id,
            })
          }
        }
      } catch { /* episodic not available */ }
    }

    // Sort by relevance descending
    return results.sort((a, b) => b.relevance - a.relevance)
  }
}

// ---------------------------------------------------------------------------
// Items connector for captureFromItems
// ---------------------------------------------------------------------------

/**
 * Extract text content from a session item.
 */
function extractItemText(item: any): string {
  return typeof item.payload === 'string'
    ? item.payload
    : typeof item.content === 'string'
      ? item.content
      : ''
}

/**
 * Build a connector function that reads recent conversation context,
 * the current user message, and truncated assistant response from session
 * items. Used by `captureFromItems`.
 *
 * Includes up to `priorTurns` previous user messages as context so the
 * observer can resolve pronouns and references (e.g., "her name is Jane"
 * makes sense when the prior message mentioned "my wife").
 */
function buildItemsConnector(maxAssistantChars: number, priorTurns = 3) {
  return (_input: unknown, ctx: any): string => {
    const items = ctx.session?.items?.all?.() ?? []
    if (items.length === 0) return ''

    // Find all user messages in order
    const userMessages = items.filter(
      (item: any) => item.type === 'message' && (item as any).role === 'user',
    )
    if (userMessages.length === 0) return ''

    const lastUser = userMessages[userMessages.length - 1]
    const currentText = extractItemText(lastUser)
    if (!currentText) return ''

    // Build result with recent context → current message → assistant response
    const parts: string[] = []

    // Prior user messages for context (up to priorTurns, excluding current)
    if (userMessages.length > 1) {
      const priorMessages = userMessages.slice(
        Math.max(0, userMessages.length - 1 - priorTurns),
        userMessages.length - 1,
      )
      if (priorMessages.length > 0) {
        const priorTexts = priorMessages
          .map((item: any) => extractItemText(item))
          .filter(Boolean)
        if (priorTexts.length > 0) {
          parts.push('Recently said:\n' + priorTexts.map((t: string) => `[user] ${t}`).join('\n'))
        }
      }
    }

    // Current user message
    parts.push(`Currently told us:\n[user] ${currentText}`)

    // Assistant response after the current user message
    const lastUserIdx = items.indexOf(lastUser)
    const assistantItems = items.slice(lastUserIdx + 1).filter(
      (item: any) => item.type === 'message' && (item as any).role === 'assistant',
    )

    if (assistantItems.length > 0) {
      const assistantText = assistantItems
        .map((item: any) => extractItemText(item))
        .filter(Boolean)
        .join('\n')

      if (assistantText) {
        const truncated = assistantText.length > maxAssistantChars
          ? assistantText.slice(0, maxAssistantChars) + ' [truncated]'
          : assistantText
        parts.push(`Assistant response:\n[assistant] ${truncated}`)
      }
    }

    return parts.join('\n\n')
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a unified memory system.
 *
 * Composes working memory, (optionally) episodic memory, and (optionally)
 * semantic memory into a single capture pipeline, recall helper, and
 * context formatter.
 *
 * ```ts
 * import { memory } from '@thought-fabric/core'
 *
 * const mem = memory.system({
 *   model: 'gpt-5-mini',
 *   working: { capacity: 7 },
 *   episodic: true,
 *   semantic: true,
 * })
 *
 * // Use in a flow:
 * const pipeline = sequencer({ name: 'chat', inputSchema })
 *   .then(chat)
 *   .work(mem.capture)
 * ```
 */
export function system(config: MemorySystemConfig): MemorySystem {
  // Validate: semantic requires episodic
  if (config.semantic && !config.episodic) {
    throw new Error('Semantic memory requires episodic memory to be configured')
  }

  // Validate: digest requires semantic (the digest summarises stable knowledge,
  // and semantic owns that store).
  if (config.digest && !config.semantic) {
    throw new Error('Digest requires semantic memory to be configured')
  }

  // Resolve working memory config
  const workingConfig: WorkingMemorySystemConfig = config.working === true
    ? {}
    : config.working

  const resolvedWorking: WorkingMemoryHelperConfig = {
    capacity: workingConfig.capacity ?? DEFAULT_WORKING_MEMORY_CONFIG.capacity,
    maxPinnedSlots: workingConfig.maxPinnedSlots ?? DEFAULT_WORKING_MEMORY_CONFIG.maxPinnedSlots,
    decay: {
      strategy: workingConfig.decay?.strategy ?? DEFAULT_WORKING_MEMORY_CONFIG.decay.strategy,
      rate: workingConfig.decay?.rate ?? DEFAULT_WORKING_MEMORY_CONFIG.decay.rate,
    },
  }

  // Resolve episodic config
  const episodicConfig = config.episodic
    ? {
        scope: (config.episodic === true ? DEFAULT_EPISODIC_CONFIG.scope : config.episodic.scope) ?? DEFAULT_EPISODIC_CONFIG.scope,
        significanceThreshold: config.episodic === true ? DEFAULT_EPISODIC_CONFIG.significanceThreshold : (config.episodic.significanceThreshold ?? DEFAULT_EPISODIC_CONFIG.significanceThreshold),
        maxEpisodes: config.episodic === true ? DEFAULT_EPISODIC_CONFIG.maxEpisodes : (config.episodic.maxEpisodes ?? DEFAULT_EPISODIC_CONFIG.maxEpisodes),
      }
    : undefined

  // Resolve semantic config
  const semanticConfig = config.semantic
    ? {
        scope: ((config.semantic === true
          ? (episodicConfig?.scope ?? DEFAULT_EPISODIC_CONFIG.scope)
          : config.semantic.scope) ?? (episodicConfig?.scope ?? DEFAULT_EPISODIC_CONFIG.scope)) as 'user' | 'org',
        consolidation: {
          episodicThreshold: config.semantic === true ? DEFAULT_CONSOLIDATION_CONFIG.episodicThreshold : (config.semantic.consolidation?.episodicThreshold ?? DEFAULT_CONSOLIDATION_CONFIG.episodicThreshold),
          onEviction: config.semantic === true ? DEFAULT_CONSOLIDATION_CONFIG.onEviction : (config.semantic.consolidation?.onEviction ?? DEFAULT_CONSOLIDATION_CONFIG.onEviction),
          minInterval: config.semantic === true ? DEFAULT_CONSOLIDATION_CONFIG.minInterval : (config.semantic.consolidation?.minInterval ?? DEFAULT_CONSOLIDATION_CONFIG.minInterval),
        },
        pruneThreshold: config.semantic === true ? DEFAULT_PRUNE_CONFIG.pruneThreshold : (config.semantic.pruneThreshold ?? DEFAULT_PRUNE_CONFIG.pruneThreshold),
      }
    : undefined

  // Resolve digest config. Scope is inherited from semantic — there is no
  // separate digest.scope knob ([FIX-408] simplification).
  const digestConfig = config.digest && semanticConfig
    ? {
        scope: semanticConfig.scope,
        maxTokens: config.digest === true
          ? DEFAULT_DIGEST_CONFIG.maxTokens
          : (config.digest.maxTokens ?? DEFAULT_DIGEST_CONFIG.maxTokens),
        topN: {
          facts: config.digest === true
            ? DEFAULT_DIGEST_CONFIG.topN.facts
            : (config.digest.topN?.facts ?? DEFAULT_DIGEST_CONFIG.topN.facts),
          episodes: config.digest === true
            ? DEFAULT_DIGEST_CONFIG.topN.episodes
            : (config.digest.topN?.episodes ?? DEFAULT_DIGEST_CONFIG.topN.episodes),
        },
      }
    : undefined

  // Create tier capabilities FIRST — these own the resource references.
  // Blocks and the system both derive resources from capabilities to avoid
  // resource conflicts (same defineResource() reference everywhere).
  const wmCapability = createWorkingMemoryCapability(resolvedWorking)

  const epCapability = episodicConfig
    ? createEpisodicMemoryCapability({
        scope: episodicConfig.scope,
        maxEpisodes: episodicConfig.maxEpisodes,
      })
    : undefined

  const semCapability = semanticConfig
    ? createSemanticMemoryCapability({
        scope: semanticConfig.scope,
      })
    : undefined

  const digestCapability = digestConfig
    ? createDigestMemoryCapability({ scope: digestConfig.scope })
    : undefined

  // Extract resource references from capabilities for shared use by blocks.
  // Cast required: capability types store resources as DeclaredResourceEntry
  // (broad), but the MemorySystem interface uses specific resource types.
  // Resources live on the flat `resources` map (FIX-435); the resource's
  // intrinsic scope determines storage placement.
  const episodicResource = epCapability
    ? epCapability.resources!.episodicMemory as ReturnType<typeof createEpisodicMemoryResource>
    : undefined

  const semanticResource = semCapability
    ? semCapability.resources!.semanticMemory as ReturnType<typeof createSemanticMemoryResource>
    : undefined

  const digestResource = digestCapability
    ? digestCapability.resources!.digestMemory as ReturnType<typeof createDigestMemoryResource>
    : undefined

  // Build blocks config — pass shared resources to avoid resource conflicts
  const blocksConfig = {
    name: config.name,
    model: config.model,
    working: resolvedWorking,
    episodic: episodicConfig,
    _episodicResource: episodicResource,
    semantic: semanticConfig,
    _semanticResource: semanticResource,
    digest: digestConfig,
    _digestResource: digestResource,
    source: config.source,
  }

  // Create capture pipeline
  const capture = memorySystemCapture(blocksConfig)

  // Create standalone consolidation and prune sequencers (when semantic configured)
  const consolidate = semanticConfig
    ? memorySystemConsolidate(blocksConfig)
    : undefined

  const prune = semanticConfig
    ? memorySystemPrune(blocksConfig)
    : undefined

  // Create recall and contextFormatter
  const recallFn = createRecall(
    episodicConfig ? { scope: episodicConfig.scope } : undefined,
    semanticConfig ? { scope: semanticConfig.scope } : undefined,
  )
  // The bundled formatter retains the previous default behaviour (digest +
  // working) for direct consumers of `mem.contextFormatter`. Capability
  // presets register their own per-section entries below so each toggle is
  // truly independent.
  const contextFormatterFn = createMemoryContextFormatter({
    digest: !!digestConfig,
    working: true,
  })

  // Create captureFromItems — self-serving variant that reads from session items
  const maxAssistantChars = config.maxAssistantChars ?? DEFAULT_OBSERVER_CONFIG.maxAssistantChars
  const captureFromItems = capture.connectInput(buildItemsConnector(maxAssistantChars))

  // Build the recall tool (FIX-409). Constructed once and reused across
  // every generator that installs it. Strategy is created here so the
  // underlying generator block (for llm-filter) is cached.
  const toolConfig = config.tool ?? {}
  const recallStrategy = resolveStrategy(toolConfig.strategy ?? 'llm-filter', {
    model: toolConfig.model ?? config.model,
  })
  const recallToolBlock = createRecallTool({
    strategy: recallStrategy,
    defaults: toolConfig.defaults,
  })

  // Compose the unified memory capability
  const capUses: CapabilityRef[] = [wmCapability]
  if (epCapability) capUses.push(epCapability)
  if (semCapability) capUses.push(semCapability)
  if (digestCapability) capUses.push(digestCapability)

  const composedCapability = defineCapability({
    name: 'memory' as const,
    uses: capUses,
    resources: { memorySystem: memorySystemResource },
    fns: (ctx: any) => ({
      /** Cross-store recall — queries all configured stores, deduplicates, ranks by relevance. */
      recall: (cue?: string) => recallFn(ctx, cue),
    }),
    presets: {
      /**
       * Inject the rolling digest into the prompt under
       * `<memory><digest>…</digest></memory>`. Default-on. No-op when no
       * digest tier is configured on `memorySystem({...})` — the entry's
       * function returns `undefined` and the framework drops the section.
       */
      digest: digestConfig
        ? { context: { memory: createDigestEntry() } }
        : {},
      /**
       * Inject working-memory entries under
       * `<memory><working>…</working></memory>`. Default-on. Working memory
       * is the base tier, so this is always wired when memory is enabled.
       */
      working: {
        context: { memory: createWorkingEntry() },
      },
      /**
       * Inject the top-N semantic facts under
       * `<memory><semantic>…</semantic></memory>`. Default-off — opt in for
       * generators that benefit from a flat fact list alongside the digest.
       * Uses a fixed default top-N; reach for `createMemoryContextFormatter`
       * directly for a custom limit. No-op when no semantic tier is
       * configured.
       */
      semantic: semanticConfig
        ? { context: { memory: createSemanticEntry() } }
        : {},
      /**
       * Inject the most-recent episodes under
       * `<memory><episodic>…</episodic></memory>`. Default-off. Uses a fixed
       * default count; reach for `createMemoryContextFormatter` directly
       * for a custom limit. No-op when no episodic tier is configured.
       */
      episodic: episodicConfig
        ? { context: { memory: createEpisodicEntry() } }
        : {},
      /**
       * Install the `tf.memory/recall` tool so the model can search semantic
       * facts and past episodes on demand. Default-on. No-op when neither
       * episodic nor semantic is configured (recall has nothing to search).
       */
      recall: {
        context: { memory: { 
          recall: "There are additional memories stored, use the tf_memory_recall tool to access them."
        }},
        tools: () => [recallToolBlock],
      },
      default: ['digest', 'working', 'recall'],
    },
  })

  // Assemble the system
  const result: MemorySystem = {
    capture,
    captureFromItems,
    recall: recallFn,
    contextFormatter: contextFormatterFn,
    working: {
      resource: workingMemoryResource,
      helpers: {
        add,
        evict,
        pin,
        unpin,
        refresh,
        tick: advance,
        items: wmItems,
        computeDecay,
        computeSalience,
      },
    },
    sessionResources: {
      workingMemory: workingMemoryResource,
      memorySystem: memorySystemResource,
    },
    userResources: {
      ...(episodicResource ? { episodicMemory: episodicResource } : {}),
      ...(semanticResource ? { semanticMemory: semanticResource } : {}),
      ...(digestResource ? { digestMemory: digestResource } : {}),
    },
    capability: composedCapability,
    workingMemoryCapability: wmCapability,
    tool: {
      recall: () => recallToolBlock,
    },
  }

  if (consolidate) {
    result.consolidate = consolidate
  }

  if (prune) {
    result.prune = prune
  }

  if (episodicConfig && episodicResource) {
    result.episodic = {
      resource: episodicResource,
      helpers: {
        encode,
        recent,
        markConsolidated,
      },
    }
  }

  if (epCapability) {
    result.episodicMemoryCapability = epCapability
  }

  if (semanticConfig && semanticResource) {
    result.semantic = {
      resource: semanticResource,
      helpers: {
        addFact,
        updateFact,
        reinforce,
        removeFact,
        allFacts,
        query,
      },
    }
  }

  if (semCapability) {
    result.semanticMemoryCapability = semCapability
  }

  if (digestConfig && digestResource) {
    result.digest = {
      resource: digestResource,
      helpers: {
        computeSourceSignature: digestComputeSourceSignature,
        isStale: digestIsStale,
      },
    }

    // Manual escape hatch — pre-bound with `force: true` so it bypasses the
    // staleness guard. Same block used internally; specialised via connectInput.
    const manualBlock = digestRegenerate(blocksConfig as any)
    result.regenerateDigest = manualBlock.connectInput(() => ({ force: true })) as any
  }

  if (digestCapability) {
    result.digestMemoryCapability = digestCapability
  }

  return result
}
