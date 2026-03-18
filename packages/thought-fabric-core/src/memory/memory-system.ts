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
import { memorySystemCapture } from './memory-system-blocks.js'

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

/** Top-level configuration for memory.system(). */
export interface MemorySystemConfig {
  /** Model ID for the observer LLM. */
  model: string
  /** Working memory config. `true` for defaults. Required. */
  working: WorkingMemorySystemConfig | true
  /** Episodic memory config. `true` for defaults. Omit to disable. */
  episodic?: EpisodicMemoryConfig | true
  /** Optional custom name for the capture pipeline. */
  name?: string
  /** Optional input schema for source override. */
  inputSchema?: ZodTypeAny
  /** Optional custom source function — overrides reading from ctx.session.items. */
  source?: (input: unknown, ctx: any) => string
}

// ---------------------------------------------------------------------------
// Return types
// ---------------------------------------------------------------------------

/** A ranked memory item from cross-store recall. */
export type RankedMemoryItem = {
  content: string
  source: 'working' | 'episodic'
  relevance: number
  category: string
  id: string
}

/** The full memory system returned by memory.system(). */
export interface MemorySystem {
  /** Unified capture pipeline: observe → reflect → tick. */
  capture: ReturnType<typeof memorySystemCapture>
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
 * Queries working memory and (if installed) episodic memory.
 * Deduplicates across stores — working memory wins over episodic.
 * Returns ranked by relevance descending.
 */
function createRecall(
  episodicConfig?: { scope: 'user' | 'project' },
) {
  return function recall(ctx: any, cue?: string): RankedMemoryItem[] {
    const results: RankedMemoryItem[] = []

    // Read working memory
    try {
      const wmRef = ctx.session?.resources?.workingMemory as ResourceContext<WorkingMemoryState> | undefined
      if (wmRef) {
        const entries = wmItems(wmRef)
        for (const entry of entries) {
          let relevance = entry.salience
          // Boost if cue matches
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

    // Read episodic memory (if installed)
    if (episodicConfig) {
      try {
        const epRef = episodicConfig.scope === 'user'
          ? ctx.user?.resources?.episodicMemory as ResourceContext<EpisodicMemoryState> | undefined
          : ctx.project?.resources?.episodicMemory as ResourceContext<EpisodicMemoryState> | undefined

        if (epRef) {
          const episodes = recent(epRef)
          const maxTurn = episodes.length > 0 ? Math.max(...episodes.map((e) => e.occurredAtTurn)) : 1

          for (const ep of episodes) {
            // Check dedup: skip if WM already has similar content
            const isDuplicate = results.some(
              (r) => r.source === 'working' && tokenOverlap(ep.content, r.content) > 0.6,
            )
            if (isDuplicate) continue

            // Compute relevance from significance × recency
            const recencyFactor = maxTurn > 0 ? (ep.occurredAtTurn / maxTurn) : 1
            let relevance = ep.significance * (0.5 + 0.5 * recencyFactor)

            // Boost if cue matches
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

    return output.trimEnd()
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a unified memory system.
 *
 * Composes working memory and (optionally) episodic memory into a single
 * capture pipeline, recall helper, and context formatter.
 *
 * ```ts
 * import { memory } from '@thought-fabric/core'
 *
 * const mem = memory.system({
 *   model: 'gpt-5-mini',
 *   working: { capacity: 7 },
 *   episodic: true,
 * })
 *
 * // Use in a flow:
 * const pipeline = sequencer({ name: 'chat', inputSchema })
 *   .then(chat)
 *   .work(mem.capture)
 * ```
 */
export function system(config: MemorySystemConfig): MemorySystem {
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
        scope: (config.episodic === true ? 'user' : config.episodic.scope) ?? 'user' as const,
        significanceThreshold: config.episodic === true ? 0.6 : (config.episodic.significanceThreshold ?? 0.6),
        maxEpisodes: config.episodic === true ? 200 : (config.episodic.maxEpisodes ?? 200),
      }
    : undefined

  // Create episodic resource if configured
  const episodicResource = episodicConfig
    ? createEpisodicMemoryResource(episodicConfig.scope)
    : undefined

  // Build blocks config — pass shared episodic resource to avoid resource conflicts
  const blocksConfig = {
    name: config.name,
    model: config.model,
    working: resolvedWorking,
    episodic: episodicConfig,
    _episodicResource: episodicResource,
    source: config.source,
  }

  // Create capture pipeline
  const capture = memorySystemCapture(blocksConfig)

  // Create recall and contextFormatter
  const recallFn = createRecall(
    episodicConfig ? { scope: episodicConfig.scope } : undefined,
  )
  const contextFormatterFn = createContextFormatter(recallFn)

  // Assemble the system
  const result: MemorySystem = {
    capture,
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

  return result
}
