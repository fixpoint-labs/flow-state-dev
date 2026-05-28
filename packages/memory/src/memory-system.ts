import { defineResource } from '@flow-state-dev/core'
import type { CapabilityRef } from '@flow-state-dev/core'
import { z } from 'zod'
import type { ZodTypeAny } from 'zod'
import type {
  MemoryProvider,
  RankedMemoryItem as ProviderRankedMemoryItem,
  MemoryContextSections,
} from './provider.js'
import {
  workingMemoryResource,
  type WorkingMemoryEntry,
} from './working-memory.js'
import {
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
import type { WorkingMemoryDecayConfig } from './working-memory-helpers.js'
import {
  createEpisodicMemoryResource,
  type Episode,
} from './episodic-memory.js'
import {
  encode,
  recent,
  markConsolidated,
} from './episodic-memory-helpers.js'
import {
  createSemanticMemoryResource,
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
import { memorySystemJanitor } from './janitor-blocks.js'
import {
  janitorResource,
  DEFAULT_HYGIENE_CONFIG,
} from './janitor.js'
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
import { createMemoryContextFormatter } from './formatter.js'
import { createRecallTool } from './tools/recall-tool.js'
import { buildMemoryCapability } from './memory-capability.js'
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
 * - `recall`   — install the agent-invocable `memory/recall` tool that
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
 * `memory/digest/regenerate`, consolidation, prune, etc. for whichever
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

/**
 * Configuration for the memory hygiene pass (FIX-411).
 *
 * Drives the janitor block that decays semantic-fact confidence over time
 * and applies durability-based TTL to episodic episodes. Default-on:
 * omitting `hygiene` from `memory.system()` opts into
 * `DEFAULT_HYGIENE_CONFIG`. Pass `false` to revert to pre-FIX-411 behaviour
 * — no decay, unbounded growth.
 */
export interface HygieneConfig {
  /**
   * Confidence-decay configuration. `true` uses defaults; an object
   * overrides selected fields; `false` disables the semantic branch
   * entirely (recall ranking falls back to raw `fact.confidence`).
   */
  confidenceDecay?: boolean | {
    /** Half-life in days. Default 180. */
    halfLife?: number
    /** Effective-confidence threshold below which facts are culled. Default 0.1. */
    cullFloor?: number
  }
  /**
   * Episodic TTL configuration. `true` uses defaults; an object overrides
   * selected fields; `false` disables the episodic branch entirely.
   */
  episodicTTL?: boolean | {
    /** Cull persistent episodes encoded more than this many turns ago. Default 500. */
    persistentTurns?: number
    /** Cull persistent episodes encoded more than this many days ago. Default 90. */
    persistentDays?: number
    /** `'OR'` (default) — cull when either threshold fires. `'AND'` — require both. */
    operator?: 'OR' | 'AND'
    /** Days of silence after which permanent episodes pick up `stale: true`. Default 180. */
    permanentStaleDays?: number
  }
  /**
   * When the janitor runs.
   *
   * - `'onConsolidation'` (default): appended to the consolidation chain;
   *   runs whenever consolidation runs (matches the cadence of fact updates).
   * - `'onCapture'`: appended to the capture pipeline; runs every turn.
   *   Decay is slow, so this is rarely worth the cost — reserved for
   *   high-churn deployments.
   * - `'manual'`: never auto-wired. Invoke `mem.janitor` directly when
   *   custom scheduling is required.
   */
  schedule?: 'onConsolidation' | 'onCapture' | 'manual'
}

/** Default hygiene configuration. Mirrors `DEFAULT_HYGIENE_CONFIG` in `./janitor.ts`. */
export { DEFAULT_HYGIENE_CONFIG } from './janitor.js'

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
  /**
   * Default model id (or fallback chain) used by every memory generator
   * unless overridden. Pass an array (e.g. `['gpt-5-mini', 'gpt-5']`) to
   * build a fallback chain — the generator walks the list on retryable
   * provider errors.
   */
  model: string | string[]
  /**
   * Model override for the consolidation generator. Defaults to `model`.
   * Consolidation has heavier structured-output demands than the observer,
   * so a stronger primary with a cheap fallback (e.g.
   * `['gpt-5', 'gpt-5-mini']`) is a common configuration.
   */
  consolidationModel?: string | string[]
  /** Model override for the prune generator. Defaults to `model`. */
  pruneModel?: string | string[]
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
  /**
   * Memory hygiene configuration (FIX-411). Default-on. Pass `false` to
   * revert to pre-FIX-411 behaviour: no confidence decay, no episodic TTL,
   * stores grow without bound.
   */
  hygiene?: HygieneConfig | true | false
}

// ---------------------------------------------------------------------------
// Return types
// ---------------------------------------------------------------------------

/**
 * A ranked memory item from cross-store recall.
 *
 * Re-exported from `./provider.ts` so existing import paths
 * (`@flow-state-dev/memory`) keep resolving.
 */
export type RankedMemoryItem = ProviderRankedMemoryItem

/** The full memory system returned by memory.system(). */
export interface MemorySystem extends MemoryProvider {
  /** Unified capture pipeline: observe → reflect → tick (+ consolidation when semantic). Takes string input. */
  capture: ReturnType<typeof memorySystemCapture>
  /** Self-serving capture: reads last user message + truncated assistant response from session items. Use with `.work()` after the generator. */
  captureFromItems: ReturnType<ReturnType<typeof memorySystemCapture>['connectInput']>
  /** Standalone consolidation sequencer (when semantic configured). */
  consolidate?: ReturnType<typeof memorySystemConsolidate>
  /** Standalone prune sequencer (when semantic configured). */
  prune?: ReturnType<typeof memorySystemPrune>
  /**
   * Memory hygiene janitor block (when `hygiene !== false` and at least one
   * of semantic/episodic is configured). State-mutation-only — invoke
   * directly via `.tap()`/`.work()` for custom scheduling, or rely on the
   * auto-wiring driven by `hygiene.schedule`.
   */
  janitor?: ReturnType<typeof memorySystemJanitor>
  /** Session-scoped janitor tracking resource (when janitor is configured). */
  janitorResource?: typeof janitorResource
  /** Cross-store recall helper. */
  recall: (ctx: any, cue?: string) => Promise<RankedMemoryItem[]>
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
  contextFormatter: (input: unknown, ctx: any) => Promise<MemoryContextSections | undefined>
  /** Alias of `contextFormatter` exposed under the `MemoryProvider` name. */
  formatContext: (input: unknown, ctx: any) => Promise<MemoryContextSections | undefined>
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
    /** Session-scoped janitor resource — included when hygiene is enabled. */
    janitor?: typeof janitorResource
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
   *   - `recall` (default-on)   — install the `memory/recall` tool.
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
 * import { system } from '@flow-state-dev/memory'
 *
 * const mem = system({
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
  // Build the composed memory capability first. It validates tier
  // dependencies and the required model, resolves the tier configs, and owns
  // the resource references. system() reuses its resources, tiers, and recall
  // tool below so the same defineResource() references flow everywhere
  // (FIX-435) and `mem.capability === memCap` holds by construction.
  const built = buildMemoryCapability({
    model: config.model,
    working: config.working,
    episodic: config.episodic,
    semantic: config.semantic,
    digest: config.digest,
    tool: config.tool,
    hygiene: config.hygiene,
  })
  const memCap = built.capability

  // Reuse the resolved tier configs, hygiene, and recall helper the capability
  // already produced — single resolution pass, no drift between the capability
  // and the lifecycle blocks below.
  const { resolvedWorking, episodicConfig, semanticConfig, digestConfig } = built.resolved
  const hygiene = built.hygiene

  // Operator-visibility warning: the janitor is being asked to run but
  // there's nothing for it to operate on. Only fires when the caller
  // EXPLICITLY opted into hygiene — silent for the default-on path on
  // working-only configurations (spec §10.3).
  const hygieneExplicit = config.hygiene !== undefined && config.hygiene !== false
  if (
    hygieneExplicit &&
    hygiene &&
    hygiene.schedule !== 'manual' &&
    !config.semantic &&
    !config.episodic
  ) {
    console.warn(
      '[memory] hygiene is enabled but neither semantic nor episodic memory is configured — janitor will no-op.',
    )
  }

  // Source the typed resource references from the composed capability so the
  // lifecycle blocks below share the exact same defineResource() references
  // the capability bundled (FIX-435 — no divergent refs for one accessor key).
  const episodicResource = memCap.userResources.episodicMemory
  const semanticResource = memCap.userResources.semanticMemory
  const digestResource = memCap.userResources.digestMemory

  // Build blocks config — pass shared resources to avoid resource conflicts
  const blocksConfig = {
    name: config.name,
    model: config.model,
    consolidationModel: config.consolidationModel,
    pruneModel: config.pruneModel,
    working: resolvedWorking,
    episodic: episodicConfig,
    _episodicResource: episodicResource,
    semantic: semanticConfig,
    _semanticResource: semanticResource,
    digest: digestConfig,
    _digestResource: digestResource,
    source: config.source,
    hygiene: hygiene === false ? undefined : hygiene,
  }

  // Build the janitor block exposed as `mem.janitor` (manual scheduling /
  // direct invocation). Auto-wired pipelines (consolidation, capture) build
  // their own janitor instances from `blocksConfig.hygiene`. All instances
  // share the session-scoped `janitorResource`, so their writes converge on
  // the same snapshot. Skipped when `hygiene: false` or when neither
  // semantic nor episodic is configured.
  const janitorBlock = hygiene && (semanticConfig || episodicConfig)
    ? memorySystemJanitor({ ...blocksConfig, hygiene })
    : undefined

  // Create capture pipeline
  const capture = memorySystemCapture(blocksConfig)

  // Create standalone consolidation and prune sequencers (when semantic configured)
  const consolidate = semanticConfig
    ? memorySystemConsolidate(blocksConfig)
    : undefined

  const prune = semanticConfig
    ? memorySystemPrune(blocksConfig)
    : undefined

  // Standalone recall helper exposed as `mem.recall` — the same instance the
  // capability wired into `fns.recall`.
  const recallFn = built.recall
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

  // Assemble the system
  const result: MemorySystem = {
    capture,
    captureFromItems,
    recall: recallFn,
    contextFormatter: contextFormatterFn,
    formatContext: contextFormatterFn,
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
      ...memCap.sessionResources,
      ...(janitorBlock ? { janitor: janitorResource } : {}),
    },
    userResources: memCap.userResources,
    capability: memCap,
    workingMemoryCapability: memCap.tiers.working,
    tool: {
      recall: () => memCap.recallToolBlock,
    },
  }

  if (consolidate) {
    result.consolidate = consolidate
  }

  if (janitorBlock) {
    result.janitor = janitorBlock
    result.janitorResource = janitorResource
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

  if (memCap.tiers.episodic) {
    result.episodicMemoryCapability = memCap.tiers.episodic
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

  if (memCap.tiers.semantic) {
    result.semanticMemoryCapability = memCap.tiers.semantic
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

  if (memCap.tiers.digest) {
    result.digestMemoryCapability = memCap.tiers.digest
  }

  return result
}
