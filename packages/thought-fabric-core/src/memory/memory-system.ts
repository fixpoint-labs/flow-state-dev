import { defineResource } from '@flow-state-dev/core'
import type { ResourceContext } from '@flow-state-dev/core'
import { z } from 'zod'
import type { ZodTypeAny } from 'zod'
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
import { memorySystemCapture, memorySystemConsolidate } from './memory-system-blocks.js'

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
  scope?: 'user' | 'project'
  /** Minimum importance for an item to be encoded as an episode. Default: 0.6. */
  significanceThreshold?: number
  /** Maximum episodes to retain. Default: 200. */
  maxEpisodes?: number
}

/** Configuration for the semantic memory module within memory.system(). */
export interface SemanticMemoryConfig {
  /** Scope for semantic storage. Default: same as episodic, or 'user'. */
  scope?: 'user' | 'project'
  consolidation?: {
    /** Consolidate after this many new episodic entries. Default: 5. */
    episodicThreshold?: number
    /** Also consolidate when persistent items evicted from WM. Default: true. */
    onEviction?: boolean
    /** Don't consolidate more than once per N turns. Default: DEFAULT_CONSOLIDATION_CONFIG.minInterval. */
    minInterval?: number
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
  /** Optional custom name for the capture pipeline. */
  name?: string
  /** Optional input schema for source override. */
  inputSchema?: ZodTypeAny
  /** Optional custom source function — overrides reading from ctx.session.items. */
  source?: (input: unknown, ctx: any) => string
  /** Max chars of assistant response to include in captureFromItems. Default: 500. */
  maxAssistantChars?: number
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
}

/** The full memory system returned by memory.system(). */
export interface MemorySystem {
  /** Unified capture pipeline: observe → reflect → tick (+ consolidation when semantic). Takes string input. */
  capture: ReturnType<typeof memorySystemCapture>
  /** Self-serving capture: reads last user message + truncated assistant response from session items. Use with `.work()` after the generator. */
  captureFromItems: ReturnType<ReturnType<typeof memorySystemCapture>['connectInput']>
  /** Standalone consolidation sequencer (when semantic configured). */
  consolidate?: ReturnType<typeof memorySystemConsolidate>
  /** Cross-store recall helper. */
  recall: (ctx: any, cue?: string) => RankedMemoryItem[]
  /** Context formatter for generator context arrays. */
  contextFormatter: (input: unknown, ctx: any) => string
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
}

// ---------------------------------------------------------------------------
// Recall helper
// ---------------------------------------------------------------------------

/**
 * Tokenize a string into lowercase word tokens for comparison.
 */
function tokenize(text: string): string[] {
  return text.toLowerCase().split(/\s+/).filter((t) => t.length > 0)
}

/**
 * Compute token overlap ratio between two strings.
 * Returns a value [0, 1] representing the fraction of tokens in `a` that appear in `b`.
 */
function tokenOverlap(a: string, b: string): number {
  const tokensA = tokenize(a)
  const tokensB = new Set(tokenize(b))
  if (tokensA.length === 0) return 0
  const matches = tokensA.filter((t) => tokensB.has(t)).length
  return matches / tokensA.length
}

/**
 * Unified cross-store recall.
 *
 * Queries working memory, (if installed) episodic memory, and (if installed) semantic memory.
 * Deduplication priority: semantic > working > episodic.
 * Returns ranked by relevance descending.
 */
function createRecall(
  episodicConfig?: { scope: 'user' | 'project' },
  semanticConfig?: { scope: 'user' | 'project' },
) {
  return function recall(ctx: any, cue?: string): RankedMemoryItem[] {
    const results: RankedMemoryItem[] = []

    // 1. Read semantic facts first (highest authority)
    if (semanticConfig) {
      try {
        const semRef = semanticConfig.scope === 'user'
          ? ctx.user?.resources?.semanticMemory as ResourceContext<SemanticMemoryState> | undefined
          : ctx.project?.resources?.semanticMemory as ResourceContext<SemanticMemoryState> | undefined

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
            })
          }
        }
      } catch { /* semantic not available */ }
    }

    // 2. Read working memory
    try {
      const wmRef = ctx.session?.resources?.workingMemory as ResourceContext<WorkingMemoryState> | undefined
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
            category: entry.category ?? 'fact',
            id: entry.id,
          })
        }
      }
    } catch { /* working memory not available */ }

    // 3. Read episodic memory (if installed)
    if (episodicConfig) {
      try {
        const epRef = episodicConfig.scope === 'user'
          ? ctx.user?.resources?.episodicMemory as ResourceContext<EpisodicMemoryState> | undefined
          : ctx.project?.resources?.episodicMemory as ResourceContext<EpisodicMemoryState> | undefined

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
// Context formatter
// ---------------------------------------------------------------------------

/**
 * Creates a context formatter function for generator context arrays.
 * Calls recall() internally and formats memories into categorized sections.
 */
function createContextFormatter(
  recallFn: (ctx: any, cue?: string) => RankedMemoryItem[],
) {
  return function contextFormatter(_input: unknown, ctx: any): string {
    const items = recallFn(ctx)
    if (items.length === 0) return ''

    const facts = items.filter((i) => i.category === 'fact' || i.category === 'relationship')
    const focus = items.filter((i) => i.category === 'task' || i.category === 'event')
    const prefs = items.filter((i) => i.category === 'preference')
    const patterns = items.filter((i) => i.category === 'pattern')

    let output = ''
    if (facts.length > 0) {
      output += 'Known facts:\n' + facts.map((i) => `- ${i.content}`).join('\n') + '\n\n'
    }
    if (focus.length > 0) {
      output += 'Current focus:\n' + focus.map((i) => `- ${i.content}`).join('\n') + '\n\n'
    }
    if (prefs.length > 0) {
      output += 'User preferences:\n' + prefs.map((i) => `- ${i.content}`).join('\n') + '\n\n'
    }
    if (patterns.length > 0) {
      output += 'Patterns:\n' + patterns.map((i) => `- ${i.content}`).join('\n') + '\n\n'
    }

    return output.trimEnd()
  }
}

// ---------------------------------------------------------------------------
// Items connector for captureFromItems
// ---------------------------------------------------------------------------

/**
 * Build a connector function that reads the last user message and truncated
 * assistant response from session items. Used by `captureFromItems`.
 */
function buildItemsConnector(maxAssistantChars: number) {
  return (_input: unknown, ctx: any): string => {
    const items = ctx.session?.items?.all?.() ?? []
    if (items.length === 0) return ''

    // Find last user message
    const lastUser = [...items].reverse().find(
      (item: any) => item.type === 'message' && (item as any).role === 'user',
    )
    if (!lastUser) return ''

    const userText = typeof lastUser.payload === 'string'
      ? lastUser.payload
      : typeof lastUser.content === 'string'
        ? lastUser.content
        : ''

    // Find assistant messages after the last user message
    const lastUserIdx = items.indexOf(lastUser)
    const assistantItems = items.slice(lastUserIdx + 1).filter(
      (item: any) => item.type === 'message' && (item as any).role === 'assistant',
    )

    let result = `[user] ${userText}`

    if (assistantItems.length > 0) {
      const assistantText = assistantItems
        .map((item: any) => typeof item.payload === 'string' ? item.payload : '')
        .filter(Boolean)
        .join('\n')

      if (assistantText) {
        const truncated = assistantText.length > maxAssistantChars
          ? assistantText.slice(0, maxAssistantChars) + ' [truncated]'
          : assistantText

        result += `\n[assistant] ${truncated}`
      }
    }

    return result
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
          : config.semantic.scope) ?? (episodicConfig?.scope ?? DEFAULT_EPISODIC_CONFIG.scope)) as 'user' | 'project',
        consolidation: {
          episodicThreshold: config.semantic === true ? DEFAULT_CONSOLIDATION_CONFIG.episodicThreshold : (config.semantic.consolidation?.episodicThreshold ?? DEFAULT_CONSOLIDATION_CONFIG.episodicThreshold),
          onEviction: config.semantic === true ? DEFAULT_CONSOLIDATION_CONFIG.onEviction : (config.semantic.consolidation?.onEviction ?? DEFAULT_CONSOLIDATION_CONFIG.onEviction),
          minInterval: config.semantic === true ? DEFAULT_CONSOLIDATION_CONFIG.minInterval : (config.semantic.consolidation?.minInterval ?? DEFAULT_CONSOLIDATION_CONFIG.minInterval),
        },
      }
    : undefined

  // Create resources if configured (shared instances across blocks)
  const episodicResource = episodicConfig
    ? createEpisodicMemoryResource(episodicConfig.scope)
    : undefined

  const semanticResource = semanticConfig
    ? createSemanticMemoryResource(semanticConfig.scope)
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
    source: config.source,
  }

  // Create capture pipeline
  const capture = memorySystemCapture(blocksConfig)

  // Create standalone consolidation sequencer (when semantic configured)
  const consolidate = semanticConfig
    ? memorySystemConsolidate(blocksConfig)
    : undefined

  // Create recall and contextFormatter
  const recallFn = createRecall(
    episodicConfig ? { scope: episodicConfig.scope } : undefined,
    semanticConfig ? { scope: semanticConfig.scope } : undefined,
  )
  const contextFormatterFn = createContextFormatter(recallFn)

  // Create captureFromItems — self-serving variant that reads from session items
  const maxAssistantChars = config.maxAssistantChars ?? DEFAULT_OBSERVER_CONFIG.maxAssistantChars
  const captureFromItems = capture.connectInput(buildItemsConnector(maxAssistantChars))

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
  }

  if (consolidate) {
    result.consolidate = consolidate
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

  return result
}
