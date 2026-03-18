import { generator, handler, sequencer } from '@flow-state-dev/core'
import type { ResourceContext } from '@flow-state-dev/core'
import { z } from 'zod'
import { workingMemoryResource, type WorkingMemoryState } from './working-memory.js'
import type { WorkingMemoryHelperConfig } from './working-memory-helpers.js'
import {
  add,
  advance,
  evict,
  formatForObserveContext,
  items as wmItems,
  pin,
} from './working-memory-helpers.js'
import type { EpisodicMemoryState } from './episodic-memory.js'
import { createEpisodicMemoryResource } from './episodic-memory.js'
import { encode, recent } from './episodic-memory-helpers.js'
import type { MemorySystemState } from './memory-system.js'
import { memorySystemResource } from './memory-system.js'

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

export interface MemorySystemBlocksConfig {
  name?: string
  model: string
  working: WorkingMemoryHelperConfig
  episodic?: {
    scope: 'user' | 'project'
    significanceThreshold: number
    maxEpisodes: number
  }
  /** Shared episodic resource reference — must be the same instance across blocks. */
  _episodicResource?: ReturnType<typeof createEpisodicMemoryResource>
  source?: (input: unknown, ctx: any) => string
}

// ---------------------------------------------------------------------------
// Shared schemas
// ---------------------------------------------------------------------------

/** Output schema for the unified observer generator. */
export const unifiedObservationsSchema = z.object({
  items: z.array(z.object({
    content: z.string(),
    importance: z.number().min(0).max(1),
    durability: z.enum(['transient', 'session', 'persistent', 'permanent']),
    category: z.enum(['fact', 'event', 'preference', 'task', 'relationship']),
    replaces: z.string().default(''),
  })),
})

export type UnifiedObservations = z.infer<typeof unifiedObservationsSchema>

// ---------------------------------------------------------------------------
// Internal type aliases
// ---------------------------------------------------------------------------

type WmRef = ResourceContext<WorkingMemoryState>
type SysRef = ResourceContext<MemorySystemState>
type EpRef = ResourceContext<EpisodicMemoryState>

// ---------------------------------------------------------------------------
// Block factories
// ---------------------------------------------------------------------------

/**
 * Creates the unified observer generator.
 *
 * Reads new items from `ctx.session.items` since `lastProcessedIndex` watermark.
 * One LLM call per turn. Returns classified items with durability and category.
 */
export function memorySystemObserve(config: MemorySystemBlocksConfig) {
  const episodicResource = config._episodicResource ?? (config.episodic
    ? createEpisodicMemoryResource(config.episodic.scope)
    : undefined)

  // Build resource declarations
  const sessionResources: Record<string, any> = {
    workingMemory: workingMemoryResource,
    memorySystem: memorySystemResource,
  }

  const userResources: Record<string, any> | undefined =
    config.episodic?.scope === 'user' && episodicResource
      ? { episodicMemory: episodicResource }
      : undefined

  const projectResources: Record<string, any> | undefined =
    config.episodic?.scope === 'project' && episodicResource
      ? { episodicMemory: episodicResource }
      : undefined

  return generator({
    name: config.name ? `${config.name}/observe` : 'tf.memory/observe',
    model: config.model,
    inputSchema: z.any(),
    outputSchema: unifiedObservationsSchema,
    sessionResources,
    ...(userResources ? { userResources } : {}),
    ...(projectResources ? { projectResources } : {}),
    prompt: [
      'You are a memory system for a cognitive AI agent.',
      'Analyze the conversation items below and extract information worth remembering.',
      '',
      'For each item, classify:',
      '- content: concise statement of what to remember',
      '- importance: 0-1 (goals/constraints: 0.8-1.0, key facts: 0.5-0.8, context: 0.3-0.5, trivial: 0.1-0.3)',
      '- durability: how long this should persist:',
      '  * transient: only relevant to current turn',
      '  * session: relevant for this session only',
      '  * persistent: should be remembered across sessions (e.g., user preferences, important facts)',
      '  * permanent: fundamental facts that never change (e.g., user\'s name, core identity facts)',
      '- category: fact | event | preference | task | relationship',
      '- replaces: exact ID of an existing working memory entry this supersedes, or empty string',
      '',
      'Rules:',
      '- Don\'t duplicate what\'s already in memory',
      '- When information is updated, use replaces to supersede the old entry',
      '- Prefer fewer, higher-quality memories over many low-quality ones',
      '- Return empty items array if nothing new is worth storing',
    ].join('\n'),
    context: (_input: unknown, ctx: any) => {
      // Read watermark from memory system resource
      const sysRef = ctx.session.resources.get('memorySystem') as SysRef
      const sysState = sysRef.state

      // Get items from session
      let newItemsText: string
      if (config.source) {
        newItemsText = config.source(_input, ctx)
        if (!newItemsText) return '__SKIP__'
      } else {
        const allItems = ctx.session?.items?.all?.() ?? []
        const newItems = allItems.filter((_item: any, idx: number) => idx > sysState.lastProcessedIndex)
        if (newItems.length === 0) return '__SKIP__'
        newItemsText = newItems
          .map((item: any) => `[${item.type ?? item.role ?? 'unknown'}] ${typeof item.content === 'string' ? item.content : JSON.stringify(item.payload ?? item.content ?? item)}`)
          .join('\n')
      }

      // Current working memory for dedup context
      const wmRef = ctx.session.resources.get('workingMemory') as WmRef
      const wmContext = formatForObserveContext(wmRef)

      // Episodic context for dedup (if installed)
      let episodicContext = ''
      try {
        const epRef = (config.episodic?.scope === 'user'
          ? ctx.user?.resources?.get?.('episodicMemory')
          : ctx.project?.resources?.get?.('episodicMemory')) as EpRef | undefined
        if (epRef) {
          const recentEps = recent(epRef, 5)
          if (recentEps.length > 0) {
            episodicContext = '\n\nRecent episodic memories:\n' +
              recentEps.map((e) => `- ${e.content}`).join('\n')
          }
        }
      } catch { /* episodic not installed — skip */ }

      return `New items to analyze:\n${newItemsText}\n\nCurrent working memory:\n${wmContext || '(empty)'}${episodicContext}`
    },
    user: (_input: unknown) => 'Analyze the items in context and extract memories.',
    emit: { messages: false, reasoning: false, toolCalls: false },
  })
}

/**
 * Creates the reflect handler.
 *
 * Routes observer output to appropriate stores:
 * - All items go to working memory
 * - Persistent/permanent items above significance threshold go to episodic memory
 */
export function memorySystemReflect(config: MemorySystemBlocksConfig) {
  const episodicResource = config._episodicResource ?? (config.episodic
    ? createEpisodicMemoryResource(config.episodic.scope)
    : undefined)

  const sessionResources: Record<string, any> = {
    workingMemory: workingMemoryResource,
    memorySystem: memorySystemResource,
  }

  const userResources: Record<string, any> | undefined =
    config.episodic?.scope === 'user' && episodicResource
      ? { episodicMemory: episodicResource }
      : undefined

  const projectResources: Record<string, any> | undefined =
    config.episodic?.scope === 'project' && episodicResource
      ? { episodicMemory: episodicResource }
      : undefined

  const helperConfig: WorkingMemoryHelperConfig = {
    capacity: config.working.capacity,
    maxPinnedSlots: config.working.maxPinnedSlots,
    decay: config.working.decay,
  }

  return handler({
    name: config.name ? `${config.name}/reflect` : 'tf.memory/reflect',
    inputSchema: unifiedObservationsSchema,
    outputSchema: z.any(),
    sessionResources,
    ...(userResources ? { userResources } : {}),
    ...(projectResources ? { projectResources } : {}),
    execute: async (input, ctx) => {
      const wmRef = (ctx as any).session.resources.get('workingMemory') as WmRef
      const sysRef = (ctx as any).session.resources.get('memorySystem') as SysRef

      // Get episodic ref if available
      let epRef: EpRef | undefined = undefined
      try {
        epRef = (config.episodic?.scope === 'user'
          ? (ctx as any).user?.resources?.get?.('episodicMemory')
          : (ctx as any).project?.resources?.get?.('episodicMemory')) as EpRef | undefined
      } catch { /* not installed */ }

      let episodicWrites = 0
      let evictedPersistent = 0

      for (const item of input.items) {
        try {
          // Handle superseded entries
          if (item.replaces) {
            // Check if the evicted entry was persistent/permanent
            const existingEntries = wmItems(wmRef)
            const evictedEntry = existingEntries.find((e) => e.id === item.replaces)
            if (evictedEntry && (evictedEntry.durability === 'persistent' || evictedEntry.durability === 'permanent')) {
              evictedPersistent++
            }
            await evict(wmRef, item.replaces)
          }

          // Add to working memory (all durabilities)
          const entry = await add(wmRef, {
            content: item.content,
            importance: item.importance,
            pinned: false,
            durability: item.durability,
            category: item.category,
          }, helperConfig)

          // Auto-pin high-importance items
          if (item.importance >= 0.85) {
            await pin(wmRef, entry.id, helperConfig)
          }

          // Route to episodic memory if applicable
          if (
            epRef &&
            config.episodic &&
            (item.durability === 'persistent' || item.durability === 'permanent') &&
            item.importance >= config.episodic.significanceThreshold
          ) {
            await encode(epRef, {
              content: item.content,
              occurredAtTurn: wmRef.state.currentTurn,
              significance: item.importance,
              category: item.category,
              context: {
                sessionId: (ctx as any).session?.instanceId ?? 'unknown',
                precedingTopic: undefined,
              },
            }, config.episodic.maxEpisodes)
            episodicWrites++
          }
        } catch (_err) {
          // Skip failed items — partial persistence preferred
        }
      }

      // Update tracking counters
      const allItems = (ctx as any).session?.items?.all?.() ?? []
      await sysRef.updateState((s) => ({
        ...s,
        lastProcessedIndex: allItems.length > 0 ? allItems.length - 1 : s.lastProcessedIndex,
        episodicWritesSinceLastConsolidation: s.episodicWritesSinceLastConsolidation + episodicWrites,
        evictedPersistentSinceLastConsolidation: s.evictedPersistentSinceLastConsolidation + evictedPersistent,
      }))

      return { episodicWrites, evictedPersistent }
    },
  })
}

/**
 * Creates the tick handler.
 *
 * Advances the decay clock and checks consolidation triggers.
 */
export function memorySystemTick(config: MemorySystemBlocksConfig) {
  const helperConfig: WorkingMemoryHelperConfig = {
    capacity: config.working.capacity,
    maxPinnedSlots: config.working.maxPinnedSlots,
    decay: config.working.decay,
  }

  return handler({
    name: config.name ? `${config.name}/tick` : 'tf.memory/tick',
    inputSchema: z.any(),
    sessionResources: {
      workingMemory: workingMemoryResource,
      memorySystem: memorySystemResource,
    },
    execute: async (_input, ctx) => {
      const wmRef = ctx.session.resources.get('workingMemory')
      const sysRef = ctx.session.resources.get('memorySystem')

      // Advance working memory turn counter and recompute salience
      await advance(wmRef, helperConfig)

      // Check consolidation trigger (infrastructure only — actual consolidation
      // is deferred to the semantic memory ticket FIX-268)
      const sysState = sysRef.state
      const turnsSinceConsolidation = wmRef.state.currentTurn - sysState.lastConsolidationTurn
      const minInterval = 10

      if (
        turnsSinceConsolidation >= minInterval &&
        (sysState.episodicWritesSinceLastConsolidation >= 5 ||
          sysState.evictedPersistentSinceLastConsolidation > 0)
      ) {
        // Consolidation trigger met — reset counters
        // Actual consolidation LLM call will be added with semantic memory
        await sysRef.updateState((s) => ({
          ...s,
          episodicWritesSinceLastConsolidation: 0,
          evictedPersistentSinceLastConsolidation: 0,
          lastConsolidationTurn: wmRef.state.currentTurn,
        }))
      }
    },
  })
}

/**
 * Assembles the full capture pipeline: observe → reflect → tick.
 */
export function memorySystemCapture(config: MemorySystemBlocksConfig) {
  const observeBlock = memorySystemObserve(config)
  const reflectBlock = memorySystemReflect(config)
  const tickBlock = memorySystemTick(config)

  return sequencer({
    name: config.name ?? 'tf.memory/capture',
    inputSchema: z.any(),
  })
    .then(observeBlock)
    .then(reflectBlock)
    .tap(tickBlock)
}
