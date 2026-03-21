import { generator, handler, sequencer } from '@flow-state-dev/core'
import { z } from 'zod'
import { workingMemoryResource } from './working-memory.js'
import type { WorkingMemoryHelperConfig } from './working-memory-helpers.js'
import {
  add,
  advance,
  evict,
  formatForObserveContext,
  items as wmItems,
  pin,
} from './working-memory-helpers.js'
import { createEpisodicMemoryResource } from './episodic-memory.js'
import { encode, recent, markConsolidated } from './episodic-memory-helpers.js'
import { createSemanticMemoryResource } from './semantic-memory.js'
import {
  addFact,
  updateFact,
  reinforce,
  removeFact,
  allFacts,
} from './semantic-memory-helpers.js'
import { memorySystemResource, DEFAULT_CONSOLIDATION_CONFIG, DEFAULT_PRUNE_CONFIG } from './memory-system.js'
import { findBestOverlap } from '../helpers.js'

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
  /** Semantic memory config. */
  semantic?: {
    scope: 'user' | 'project'
    consolidation: {
      episodicThreshold: number
      onEviction: boolean
      minInterval: number
    }
    /** Prune when fact count reaches this threshold. Default: 20. 0 to disable. */
    pruneThreshold?: number
  }
  /** Shared semantic resource reference — must be the same instance across blocks. */
  _semanticResource?: ReturnType<typeof createSemanticMemoryResource>
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

/** Output schema for the consolidation generator. */
export const consolidationOutputSchema = z.object({
  facts: z.array(z.object({
    content: z.string(),
    confidence: z.number().min(0).max(1),
    category: z.enum(['fact', 'preference', 'relationship', 'pattern']),
    sourceEpisodeIds: z.array(z.string()),
    /** What to do with this fact. */
    action: z.enum(['new', 'reinforce', 'update', 'invalidate']),
    /** ID of existing fact for reinforce/update/invalidate actions. Empty for 'new'. */
    targetFactId: z.string().default(''),
  })),
})

export type ConsolidationOutput = z.infer<typeof consolidationOutputSchema>

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

  const sessionResources = {
    workingMemory: workingMemoryResource,
    memorySystem: memorySystemResource,
  }

  const observePrompt = [
    'You are a memory system for a cognitive AI agent.',
    'Analyze the conversation items below and extract information worth remembering.',
    '',
    'For each item, classify:',
    '- content: concise statement of what to remember',
    '- importance: 0-1 (goals/constraints: 0.8-1.0, key facts: 0.5-0.8, context: 0.3-0.5, trivial: 0.1-0.3)',
    '- durability: how long this should persist:',
    '  * transient: only relevant to current turn',
    '  * session: relevant for this session only (e.g., current task, what user asked to do)',
    '  * persistent: should be remembered across sessions (e.g., user preferences, important facts about the user)',
    '  * permanent: fundamental facts that never change (e.g., user\'s name, birthday, core identity facts)',
    '- category: fact | event | preference | task | relationship',
    '- replaces: exact ID of an existing working memory entry this supersedes, or empty string',
    '',
    'Durability guidance:',
    '- What the user ASKED the assistant to do → session (it\'s a task, not a fact about the user)',
    '- What the assistant CREATED or SAVED → session (session activity, not stable knowledge)',
    '- Specific queries or searches → session (asking about X is not a preference for X)',
    '- Facts ABOUT THE USER (name, job, location, birthday) → persistent or permanent',
    '- Explicit preferences the user STATED → persistent',
    '- Relationships the user described → persistent',
    '',
    'Rules:',
    '- Don\'t duplicate what\'s already in memory',
    '- CRITICAL: Check for contradictions with existing working memory entries.',
    '  When new information contradicts, corrects, or updates an existing memory,',
    '  use \'replaces\' with that entry\'s exact ID. Examples:',
    '  * "works at Google" in memory + user says "I joined Stripe" → replaces the Google entry',
    '  * "prefers TypeScript" in memory + user says "I\'ve switched to Go" → replaces the TS entry',
    '  * "name is Jon" in memory + user says "it\'s actually John" → replaces the name entry',
    '- Stale memories are worse than missing memories — always prefer updating over adding alongside',
    '- Prefer fewer, higher-quality memories over many low-quality ones',
    '- Return empty items array if nothing new is worth storing',
    '- When assistant messages are included, focus on:',
    '  * Corrections or clarifications about user statements',
    '  * Facts about the user or task discovered or inferred (e.g., from tool use)',
    '- Do NOT extract memories from instructional content, code examples, or generic responses',
    '- Do NOT mark session activities (saved an artifact, ran a search) as persistent',
  ].join('\n')

  // Context function reads from session items using the watermark.
  // Uses `any` ctx since the generator context slot signature is (input, ctx) => unknown
  // and the context arg type is a structural subset, not the full BlockContext.
  function buildContext(_input: unknown, ctx: any): string | undefined {
    const sysRef = ctx.session.resources.memorySystem
    const sysState = sysRef.state

    // Get items from session
    let newItemsText: string
    if (config.source) {
      newItemsText = config.source(_input, ctx)
      if (!newItemsText) return undefined
    } else {
      const allItems = ctx.session?.items?.all?.() ?? []
      const newItems = allItems.filter((_item: any, idx: number) => idx > sysState.lastProcessedIndex)
      if (newItems.length > 0) {
        newItemsText = newItems
          .map((item: any) => {
            const label = item.role ?? item.type ?? 'unknown'
            const text = typeof item.payload === 'string'
              ? item.payload
              : typeof item.content === 'string'
                ? item.content
                : JSON.stringify(item.payload ?? item.content ?? item)
            return `[${label}] ${text}`
          })
          .join('\n')
      } else if (typeof _input === 'string' && _input.trim().length > 0) {
        // Fallback: live items from the current request may not yet be
        // flushed when the observer runs. Use the block input directly.
        newItemsText = `[user] ${_input}`
      } else {
        return undefined
      }
    }

    // Current working memory for dedup context
    const wmRef = ctx.session.resources.workingMemory
    const wmContext = formatForObserveContext(wmRef)

    // Episodic context for dedup (if installed)
    let episodicContext = ''
    try {
      const epRef = config.episodic?.scope === 'user'
        ? ctx.user?.resources?.episodicMemory
        : ctx.project?.resources?.episodicMemory
      if (epRef) {
        const recentEps = recent(epRef, 5)
        if (recentEps.length > 0) {
          episodicContext = '\n\nRecent episodic memories:\n' +
            recentEps.map((e: any) => `- ${e.content}`).join('\n')
        }
      }
    } catch { /* episodic not installed — skip */ }

    return `New items to analyze:\n${newItemsText}\n\nCurrent working memory:\n${wmContext || '(empty)'}${episodicContext}`
  }

  // Build the generator with typed sessionResources and conditional episodic scope
  if (config.episodic?.scope === 'user' && episodicResource) {
    return generator({
      name: config.name ? `${config.name}/observe` : 'tf.memory/observe',
      model: config.model,
      inputSchema: z.any(),
      outputSchema: unifiedObservationsSchema,
      sessionResources,
      userResources: { episodicMemory: episodicResource },
      prompt: observePrompt,
      context: buildContext,
      user: (_input: unknown) => 'Analyze the items in context and extract memories.',
      emit: { messages: false, reasoning: false, toolCalls: false },
    })
  }

  if (config.episodic?.scope === 'project' && episodicResource) {
    return generator({
      name: config.name ? `${config.name}/observe` : 'tf.memory/observe',
      model: config.model,
      inputSchema: z.any(),
      outputSchema: unifiedObservationsSchema,
      sessionResources,
      projectResources: { episodicMemory: episodicResource },
      prompt: observePrompt,
      context: buildContext,
      user: (_input: unknown) => 'Analyze the items in context and extract memories.',
      emit: { messages: false, reasoning: false, toolCalls: false },
    })
  }

  return generator({
    name: config.name ? `${config.name}/observe` : 'tf.memory/observe',
    model: config.model,
    inputSchema: z.any(),
    outputSchema: unifiedObservationsSchema,
    sessionResources,
    prompt: observePrompt,
    context: buildContext,
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
 * - Permanent facts go directly to semantic memory (direct extraction)
 */
export function memorySystemReflect(config: MemorySystemBlocksConfig) {
  const episodicResource = config._episodicResource ?? (config.episodic
    ? createEpisodicMemoryResource(config.episodic.scope)
    : undefined)

  const semanticResource = config._semanticResource ?? (config.semantic
    ? createSemanticMemoryResource(config.semantic.scope)
    : undefined)

  const sessionResources = {
    workingMemory: workingMemoryResource,
    memorySystem: memorySystemResource,
  }

  const helperConfig: WorkingMemoryHelperConfig = {
    capacity: config.working.capacity,
    maxPinnedSlots: config.working.maxPinnedSlots,
    decay: config.working.decay,
  }

  // Shared execute logic — extracted to avoid duplication across scope variants
  async function executeReflect(input: UnifiedObservations, ctx: any) {
    const wmRef = ctx.session.resources.workingMemory
    const sysRef = ctx.session.resources.memorySystem

    // Get episodic ref if available
    let epRef: any = undefined
    try {
      epRef = config.episodic?.scope === 'user'
        ? ctx.user?.resources?.episodicMemory
        : ctx.project?.resources?.episodicMemory
    } catch { /* not installed */ }

    // Get semantic ref if available
    let semRef: any = undefined
    try {
      semRef = config.semantic?.scope === 'user'
        ? ctx.user?.resources?.semanticMemory
        : ctx.project?.resources?.semanticMemory
    } catch { /* not installed */ }

    let episodicWrites = 0
    let evictedPersistent = 0

    for (const item of input.items) {
      try {
        // Handle superseded entries
        if (item.replaces) {
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
              sessionId: ctx.session?.instanceId ?? 'unknown',
              precedingTopic: undefined,
            },
          }, config.episodic.maxEpisodes)
          episodicWrites++
        }

        // Direct extraction to semantic memory: persistent/permanent items with
        // stable categories bypass consolidation. This avoids waiting 10+ turns
        // for consolidation to distill clearly stable knowledge like user facts
        // and preferences.
        //
        // Dedup: check existing facts for high token overlap. If found, update
        // (new content is more specific) or reinforce (same idea). This prevents
        // near-duplicate entries like "born in May" + "born in May (8th)".
        const isStableCategory = item.category === 'fact' || item.category === 'preference' || item.category === 'relationship'
        if (
          semRef &&
          config.semantic &&
          (item.durability === 'permanent' || item.durability === 'persistent') &&
          isStableCategory
        ) {
          const existing = allFacts(semRef)
          const match = findBestOverlap(item.content, existing)

          if (match) {
            // High overlap — update if content is meaningfully different, reinforce if same.
            // Use minOverlap (both directions must be high) to detect true identity.
            // When one is a subset of the other (min < 0.95 but max >= 0.6), update with the richer version.
            if (match.minOverlap < 0.95) {
              // Content differs (e.g., "born in May" → "born in May 8th") — update with richer version
              const richer = item.content.length >= match.fact.content.length ? item.content : match.fact.content
              await updateFact(semRef, match.fact.id, richer, [], Math.max(match.fact.confidence, item.importance))
            } else {
              await reinforce(semRef, match.fact.id, [])
            }
          } else {
            await addFact(semRef, {
              content: item.content,
              confidence: item.importance,
              category: item.category as 'fact' | 'preference' | 'relationship',
              sourceEpisodeIds: [],
            })
          }
        }
      } catch (err) {
        console.warn('[tf.memory] Failed to persist memory item:', (err as Error).message ?? err)
      }
    }

    // Update tracking counters
    const allItems = ctx.session?.items?.all?.() ?? []
    await sysRef.updateState((s: any) => ({
      ...s,
      lastProcessedIndex: allItems.length > 0 ? allItems.length - 1 : s.lastProcessedIndex,
      episodicWritesSinceLastConsolidation: s.episodicWritesSinceLastConsolidation + episodicWrites,
      evictedPersistentSinceLastConsolidation: s.evictedPersistentSinceLastConsolidation + evictedPersistent,
    }))

    return { episodicWrites, evictedPersistent }
  }

  // Build handler variants for scope-dependent resource declarations.
  // When semantic is configured, we need to declare the semantic resource on the same scope.
  const epScope = config.episodic?.scope
  const semScope = config.semantic?.scope

  // Combine user/project resources for both episodic and semantic
  const userResources: Record<string, any> = {}
  const projectResources: Record<string, any> = {}

  if (epScope === 'user' && episodicResource) userResources.episodicMemory = episodicResource
  if (epScope === 'project' && episodicResource) projectResources.episodicMemory = episodicResource
  if (semScope === 'user' && semanticResource) userResources.semanticMemory = semanticResource
  if (semScope === 'project' && semanticResource) projectResources.semanticMemory = semanticResource

  const hasUser = Object.keys(userResources).length > 0
  const hasProject = Object.keys(projectResources).length > 0

  if (hasUser && hasProject) {
    return handler({
      name: config.name ? `${config.name}/reflect` : 'tf.memory/reflect',
      inputSchema: unifiedObservationsSchema,
      outputSchema: z.any(),
      sessionResources,
      userResources,
      projectResources,
      execute: executeReflect,
    })
  }

  if (hasUser) {
    return handler({
      name: config.name ? `${config.name}/reflect` : 'tf.memory/reflect',
      inputSchema: unifiedObservationsSchema,
      outputSchema: z.any(),
      sessionResources,
      userResources,
      execute: executeReflect,
    })
  }

  if (hasProject) {
    return handler({
      name: config.name ? `${config.name}/reflect` : 'tf.memory/reflect',
      inputSchema: unifiedObservationsSchema,
      outputSchema: z.any(),
      sessionResources,
      projectResources,
      execute: executeReflect,
    })
  }

  return handler({
    name: config.name ? `${config.name}/reflect` : 'tf.memory/reflect',
    inputSchema: unifiedObservationsSchema,
    outputSchema: z.any(),
    sessionResources,
    execute: executeReflect,
  })
}

/**
 * Creates the tick handler.
 *
 * Advances the decay clock. When semantic memory is NOT configured, also checks
 * consolidation triggers and resets counters. When semantic IS configured, counter
 * resets are handled by the consolidation persist handler.
 */
export function memorySystemTick(config: MemorySystemBlocksConfig) {
  const hasSemantic = !!config.semantic

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
      const wmRef = ctx.session.resources.workingMemory
      const sysRef = ctx.session.resources.memorySystem

      // Advance working memory turn counter and recompute salience
      await advance(wmRef, helperConfig)

      // When semantic is configured, consolidation counters are managed by
      // the consolidation persist handler — tick only advances decay.
      if (hasSemantic) return

      // Legacy behavior (no semantic): check trigger and reset counters here
      const sysState = sysRef.state
      const turnsSinceConsolidation = wmRef.state.currentTurn - sysState.lastConsolidationTurn

      if (
        turnsSinceConsolidation >= DEFAULT_CONSOLIDATION_CONFIG.minInterval &&
        (sysState.episodicWritesSinceLastConsolidation >= DEFAULT_CONSOLIDATION_CONFIG.episodicThreshold ||
          sysState.evictedPersistentSinceLastConsolidation > 0)
      ) {
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

// ---------------------------------------------------------------------------
// Consolidation blocks
// ---------------------------------------------------------------------------

/**
 * Creates the consolidation guard handler.
 * Checks whether consolidation should run based on trigger conditions.
 */
export function consolidationGuard(config: MemorySystemBlocksConfig) {
  const semanticResource = config._semanticResource ?? (config.semantic
    ? createSemanticMemoryResource(config.semantic.scope)
    : undefined)

  const episodicResource = config._episodicResource ?? (config.episodic
    ? createEpisodicMemoryResource(config.episodic.scope)
    : undefined)

  const guardOutputSchema = z.object({
    triggered: z.boolean(),
    episodes: z.array(z.any()),
    existingFacts: z.array(z.any()),
  })

  const sessionResources = {
    workingMemory: workingMemoryResource,
    memorySystem: memorySystemResource,
  }

  async function executeGuard(_input: unknown, ctx: any) {
    const sysRef = ctx.session.resources.memorySystem
    const wmRef = ctx.session.resources.workingMemory
    const sysState = sysRef.state

    const minInterval = config.semantic?.consolidation?.minInterval ?? DEFAULT_CONSOLIDATION_CONFIG.minInterval
    const episodicThreshold = config.semantic?.consolidation?.episodicThreshold ?? DEFAULT_CONSOLIDATION_CONFIG.episodicThreshold
    const onEviction = config.semantic?.consolidation?.onEviction ?? DEFAULT_CONSOLIDATION_CONFIG.onEviction

    const turnsSinceConsolidation = wmRef.state.currentTurn - sysState.lastConsolidationTurn

    const triggered = turnsSinceConsolidation >= minInterval &&
      (sysState.episodicWritesSinceLastConsolidation >= episodicThreshold ||
        (onEviction && sysState.evictedPersistentSinceLastConsolidation > 0))

    if (!triggered) return { triggered: false, episodes: [], existingFacts: [] }

    // Read unconsolidated episodes
    let epRef: any = undefined
    try {
      epRef = config.episodic?.scope === 'user'
        ? ctx.user?.resources?.episodicMemory
        : ctx.project?.resources?.episodicMemory
    } catch { /* not installed */ }

    const unconsolidated = epRef
      ? epRef.state.episodes.filter((e: any) => !e.consolidated)
      : []

    // Read existing semantic facts
    let semRef: any = undefined
    try {
      semRef = config.semantic?.scope === 'user'
        ? ctx.user?.resources?.semanticMemory
        : ctx.project?.resources?.semanticMemory
    } catch { /* not installed */ }

    const existingFacts = semRef ? allFacts(semRef) : []

    return { triggered: true, episodes: unconsolidated, existingFacts }
  }

  // Build handler with scope-dependent resource declarations
  const epScope = config.episodic?.scope
  const semScope = config.semantic?.scope
  const userResources: Record<string, any> = {}
  const projectResources: Record<string, any> = {}

  if (epScope === 'user' && episodicResource) userResources.episodicMemory = episodicResource
  if (epScope === 'project' && episodicResource) projectResources.episodicMemory = episodicResource
  if (semScope === 'user' && semanticResource) userResources.semanticMemory = semanticResource
  if (semScope === 'project' && semanticResource) projectResources.semanticMemory = semanticResource

  const hasUser = Object.keys(userResources).length > 0
  const hasProject = Object.keys(projectResources).length > 0

  const base = {
    name: config.name ? `${config?.name ?? 'tf.memory'}/consolidate/guard` : 'tf.memory/consolidate/guard',
    inputSchema: z.any(),
    outputSchema: guardOutputSchema,
    sessionResources,
    execute: executeGuard,
  }

  if (hasUser && hasProject) return handler({ ...base, userResources, projectResources })
  if (hasUser) return handler({ ...base, userResources })
  if (hasProject) return handler({ ...base, projectResources })
  return handler(base)
}

/**
 * Creates the consolidation generator.
 * LLM call that synthesizes semantic facts from episodic observations.
 */
export function consolidationGenerate(config: MemorySystemBlocksConfig) {
  const consolidationPrompt = [
    'You are a knowledge consolidation system. You receive a batch of episodic memories',
    '(individual observations from conversations) and a set of existing semantic facts',
    '(stable knowledge about the user).',
    '',
    'Semantic memory stores STABLE KNOWLEDGE that is useful across sessions:',
    '- Who the user is (name, role, location, background)',
    '- What the user likes or dislikes (preferences, opinions, style)',
    '- Relationships between people, projects, or concepts the user cares about',
    '- Recurring patterns in how the user works or communicates',
    '',
    'Semantic memory does NOT store:',
    '- What happened in a specific session (that\'s episodic memory\'s job)',
    '- What the user asked the assistant to do or create',
    '- Specific content the user generated, saved, or viewed',
    '- One-time requests or queries (asking about X ≠ preferring X)',
    '- Transient context like current tasks, recent searches, or session activities',
    '',
    'Your job:',
    '1. Look for stable knowledge that will be useful in FUTURE conversations',
    '2. Reinforce existing facts when episodes confirm them',
    '3. Update or invalidate existing facts when episodes contradict them',
    '4. Only create new facts when the evidence clearly points to stable knowledge',
    '5. Assign confidence based on evidence strength:',
    '   - Single source episode: 0.4-0.6',
    '   - Multiple corroborating episodes: 0.6-0.8',
    '   - Reinforcing an existing high-confidence fact: 0.8-1.0',
    '',
    'Contradiction handling is critical:',
    '- Existing: "User works at Google" + Episode: "User joined Stripe last month"',
    '  → action: \'update\', targetFactId: <id>, content: "User works at Stripe"',
    '- Existing: "User is learning Python" + Episode: "User gave up on Python"',
    '  → action: \'invalidate\', targetFactId: <id>',
    '- Existing: "User\'s name is Jake" + Episode: "User spells their name Jake"',
    '  → action: \'reinforce\', targetFactId: <id>',
    '',
    'Rules:',
    '- Ask: "Would this help me serve this user better in a future conversation?"',
    '  If not, skip it.',
    '- Do NOT infer preferences from single interactions. Asking "what are the best',
    '  restaurants?" does not mean the user prefers a particular ranking system.',
    '- Do NOT record session activities as facts. "User saved a poem about X" is',
    '  episodic, not semantic — it describes what happened, not who the user is.',
    '- Prefer reinforcing existing facts over creating near-duplicates',
    '- ALWAYS check existing facts for contradictions — stale facts are worse than missing ones',
    '- Return empty facts array if nothing qualifies as stable knowledge',
    '- Categories: fact (objective info), preference (explicit likes/dislikes),',
    '  relationship (connections between entities), pattern (recurring behaviors)',
  ].join('\n')

  function buildContext(input: any): string {
    if (!input.triggered) return 'No consolidation needed. Return empty facts array.'

    let ctx = 'Episodes to consolidate:\n'
    for (const ep of input.episodes) {
      ctx += `- [${ep.id}] (${ep.category}) ${ep.content}\n`
    }

    if (input.existingFacts.length > 0) {
      ctx += '\nExisting semantic facts (check for contradictions):\n'
      for (const f of input.existingFacts) {
        ctx += `- [${f.id}] (${f.category}, confidence: ${f.confidence}, ×${f.reinforcementCount}) ${f.content}\n`
      }
    } else {
      ctx += '\nNo existing semantic facts yet.\n'
    }

    return ctx
  }

  return generator({
    name: config.name ? `${config.name}/consolidate/generate` : 'tf.memory/consolidate/generate',
    model: config.model,
    inputSchema: z.any(),
    outputSchema: consolidationOutputSchema,
    prompt: consolidationPrompt,
    context: buildContext,
    user: (_input: unknown) => 'Consolidate the episodes into semantic facts.',
    emit: { messages: false, reasoning: false, toolCalls: false },
  })
}

/**
 * Creates the consolidation persist handler.
 * Processes the consolidation output and writes to stores.
 */
export function consolidationPersist(config: MemorySystemBlocksConfig) {
  const semanticResource = config._semanticResource ?? (config.semantic
    ? createSemanticMemoryResource(config.semantic.scope)
    : undefined)

  const episodicResource = config._episodicResource ?? (config.episodic
    ? createEpisodicMemoryResource(config.episodic.scope)
    : undefined)

  const sessionResources = {
    workingMemory: workingMemoryResource,
    memorySystem: memorySystemResource,
  }

  async function executePersist(input: ConsolidationOutput, ctx: any) {
    if (input.facts.length === 0) return { added: 0, reinforced: 0, updated: 0, invalidated: 0 }

    // Get semantic ref
    let semRef: any = undefined
    try {
      semRef = config.semantic?.scope === 'user'
        ? ctx.user?.resources?.semanticMemory
        : ctx.project?.resources?.semanticMemory
    } catch { /* not installed */ }

    if (!semRef) return { added: 0, reinforced: 0, updated: 0, invalidated: 0 }

    // Get episodic ref for marking consolidated
    let epRef: any = undefined
    try {
      epRef = config.episodic?.scope === 'user'
        ? ctx.user?.resources?.episodicMemory
        : ctx.project?.resources?.episodicMemory
    } catch { /* not installed */ }

    const sysRef = ctx.session.resources.memorySystem
    const wmRef = ctx.session.resources.workingMemory

    let added = 0
    let reinforced = 0
    let updated = 0
    let invalidated = 0
    const consolidatedEpisodeIds = new Set<string>()

    for (const fact of input.facts) {
      try {
        for (const id of fact.sourceEpisodeIds) consolidatedEpisodeIds.add(id)

        switch (fact.action) {
          case 'new': {
            // Dedup: check existing facts before adding. The consolidation LLM
            // sometimes creates near-duplicates of existing facts with action 'new'
            // instead of 'reinforce'.
            const existing = allFacts(semRef)
            const match = findBestOverlap(fact.content, existing)
            if (match) {
              if (match.minOverlap < 0.95) {
                const richer = fact.content.length >= match.fact.content.length ? fact.content : match.fact.content
                await updateFact(semRef, match.fact.id, richer, fact.sourceEpisodeIds, Math.max(match.fact.confidence, fact.confidence))
                updated++
              } else {
                await reinforce(semRef, match.fact.id, fact.sourceEpisodeIds)
                reinforced++
              }
            } else {
              await addFact(semRef, {
                content: fact.content,
                confidence: fact.confidence,
                category: fact.category,
                sourceEpisodeIds: fact.sourceEpisodeIds,
              })
              added++
            }
            break
          }

          case 'reinforce':
            if (fact.targetFactId) {
              const result = await reinforce(semRef, fact.targetFactId, fact.sourceEpisodeIds)
              if (result) reinforced++
              else console.warn(`[tf.memory] Reinforce target not found: ${fact.targetFactId}`)
            }
            break

          case 'update':
            if (fact.targetFactId) {
              const result = await updateFact(semRef, fact.targetFactId, fact.content, fact.sourceEpisodeIds, fact.confidence)
              if (result) updated++
              else console.warn(`[tf.memory] Update target not found: ${fact.targetFactId}`)
            }
            break

          case 'invalidate':
            if (fact.targetFactId) {
              await removeFact(semRef, fact.targetFactId)
              invalidated++
            }
            break
        }
      } catch (err) {
        console.warn('[tf.memory] Failed to process consolidation fact:', (err as Error).message ?? err)
      }
    }

    // Mark episodes as consolidated
    if (epRef && consolidatedEpisodeIds.size > 0) {
      await markConsolidated(epRef, [...consolidatedEpisodeIds])
    }

    // Increment consolidation counter
    await semRef.updateState((s: any) => ({
      ...s,
      totalConsolidations: s.totalConsolidations + 1,
    }))

    // Reset memory system consolidation counters
    await sysRef.updateState((s: any) => ({
      ...s,
      episodicWritesSinceLastConsolidation: 0,
      evictedPersistentSinceLastConsolidation: 0,
      lastConsolidationTurn: wmRef.state.currentTurn,
    }))

    return { added, reinforced, updated, invalidated }
  }

  // Build handler with scope-dependent resource declarations
  const epScope = config.episodic?.scope
  const semScope = config.semantic?.scope
  const userResources: Record<string, any> = {}
  const projectResources: Record<string, any> = {}

  if (epScope === 'user' && episodicResource) userResources.episodicMemory = episodicResource
  if (epScope === 'project' && episodicResource) projectResources.episodicMemory = episodicResource
  if (semScope === 'user' && semanticResource) userResources.semanticMemory = semanticResource
  if (semScope === 'project' && semanticResource) projectResources.semanticMemory = semanticResource

  const hasUser = Object.keys(userResources).length > 0
  const hasProject = Object.keys(projectResources).length > 0

  const base = {
    name: config.name ? `${config.name}/consolidate/persist` : 'tf.memory/consolidate/persist',
    inputSchema: consolidationOutputSchema,
    outputSchema: z.any(),
    sessionResources,
    execute: executePersist,
  }

  if (hasUser && hasProject) return handler({ ...base, userResources, projectResources })
  if (hasUser) return handler({ ...base, userResources })
  if (hasProject) return handler({ ...base, projectResources })
  return handler(base)
}

/**
 * Assembles the consolidation sequencer: guard → generate → persist.
 * Generate and persist are gated behind the guard's `triggered` flag so
 * the LLM call is skipped entirely when consolidation isn't needed.
 */
export function memorySystemConsolidate(config: MemorySystemBlocksConfig) {
  const guardBlock = consolidationGuard(config)
  const generateBlock = consolidationGenerate(config)
  const persistBlock = consolidationPersist(config)

  const generateAndPersist = sequencer({
    name: config.name ? `${config.name}/consolidate/generate-and-persist` : 'tf.memory/consolidate/generate-and-persist',
    inputSchema: z.any(),
  })
    .then(generateBlock)
    .then(persistBlock)

  return sequencer({
    name: config.name ? `${config.name}/consolidate` : 'tf.memory/consolidate',
    inputSchema: z.any(),
  })
    .then(guardBlock)
    .thenIf((result) => result.triggered, generateAndPersist)
}

// ---------------------------------------------------------------------------
// Prune blocks
// ---------------------------------------------------------------------------

/** Output schema for the prune generator. */
export const pruneOutputSchema = z.object({
  removals: z.array(z.object({
    factId: z.string(),
    reason: z.string(),
  })),
  merges: z.array(z.object({
    sourceFactIds: z.array(z.string()),
    mergedContent: z.string(),
    reason: z.string(),
  })),
})

export type PruneOutput = z.infer<typeof pruneOutputSchema>

/**
 * Creates the prune guard handler.
 * Checks whether the semantic fact store has grown past the prune threshold
 * and passes all facts forward for evaluation.
 */
export function pruneGuard(config: MemorySystemBlocksConfig) {
  const semanticResource = config._semanticResource ?? (config.semantic
    ? createSemanticMemoryResource(config.semantic.scope)
    : undefined)

  const pruneGuardOutputSchema = z.object({
    triggered: z.boolean(),
    facts: z.array(z.any()),
  })

  const threshold = config.semantic?.pruneThreshold ?? DEFAULT_PRUNE_CONFIG.pruneThreshold

  async function executeGuard(_input: unknown, ctx: any) {
    let semRef: any = undefined
    try {
      semRef = config.semantic?.scope === 'user'
        ? ctx.user?.resources?.semanticMemory
        : ctx.project?.resources?.semanticMemory
    } catch { /* not installed */ }

    if (!semRef) return { triggered: false, facts: [] }

    const facts = allFacts(semRef)
    const triggered = threshold > 0 && facts.length >= threshold

    if (!triggered) return { triggered: false, facts: [] }
    return { triggered: true, facts }
  }

  const semScope = config.semantic?.scope
  const userResources: Record<string, any> = {}
  const projectResources: Record<string, any> = {}

  if (semScope === 'user' && semanticResource) userResources.semanticMemory = semanticResource
  if (semScope === 'project' && semanticResource) projectResources.semanticMemory = semanticResource

  const hasUser = Object.keys(userResources).length > 0
  const hasProject = Object.keys(projectResources).length > 0

  const base = {
    name: config.name ? `${config.name}/prune/guard` : 'tf.memory/prune/guard',
    inputSchema: z.any(),
    outputSchema: pruneGuardOutputSchema,
    execute: executeGuard,
  }

  if (hasUser && hasProject) return handler({ ...base, userResources, projectResources })
  if (hasUser) return handler({ ...base, userResources })
  if (hasProject) return handler({ ...base, projectResources })
  return handler(base)
}

/**
 * Creates the prune generator.
 * LLM call that evaluates the full semantic fact set and identifies
 * facts to remove (noisy/redundant) or merge (overlapping unique info).
 */
export function pruneGenerate(config: MemorySystemBlocksConfig) {
  const prunePrompt = [
    'You are a knowledge maintenance system. You receive the full set of semantic facts',
    'stored about a user. Your job is to identify facts to remove and facts to merge.',
    '',
    '## Removals',
    'Remove facts that are:',
    '- **Redundant**: Fully covered by another fact (use merge instead if both have unique info)',
    '- **Noisy**: Session artifacts that leaked into semantic memory',
    '- **Contradicted**: Superseded by a newer/higher-confidence fact',
    '- **Low-value**: Too vague or generic to be useful in future conversations',
    '',
    '## Merges',
    'Merge facts when 2+ facts each contain unique information about the same topic that',
    'would be better expressed as a single fact. Example:',
    '- "User was born in Maryland" + "User was born in May" → "User was born in May in Maryland"',
    '',
    'Do NOT merge facts that are about different topics even if related.',
    'The mergedContent should be a natural sentence combining all unique information.',
    '',
    '## Rules',
    '- Be conservative. When in doubt, keep facts as-is.',
    '- Never remove facts with reinforcementCount >= 5 unless clearly contradicted.',
    '- High-confidence facts (>= 0.8) require strong justification to remove.',
    '- Prefer merging over removing when both facts contribute unique information.',
    '- A fact referenced in removals must NOT also appear in merges.',
    '- Return empty arrays if nothing should be changed.',
  ].join('\n')

  function buildContext(input: any): string {
    if (!input.triggered) return 'Fact count below threshold. Return empty arrays.'

    let ctx = `Current semantic facts (${input.facts.length} total):\n`
    for (const f of input.facts) {
      ctx += `- [${f.id}] (${f.category}, confidence: ${f.confidence}, `
      ctx += `reinforced: ${f.reinforcementCount}x, extracted: ${f.extractedAt}) ${f.content}\n`
    }
    return ctx
  }

  return generator({
    name: config.name ? `${config.name}/prune/generate` : 'tf.memory/prune/generate',
    model: config.model,
    inputSchema: z.any(),
    outputSchema: pruneOutputSchema,
    prompt: prunePrompt,
    context: buildContext,
    user: (_input: unknown) => 'Review the facts and identify removals and merges.',
    emit: { messages: false, reasoning: false, toolCalls: false },
  })
}

/**
 * Creates the prune persist handler.
 * Processes removals and merges from the prune generator output.
 */
export function prunePersist(config: MemorySystemBlocksConfig) {
  const semanticResource = config._semanticResource ?? (config.semantic
    ? createSemanticMemoryResource(config.semantic.scope)
    : undefined)

  async function executePersist(input: PruneOutput, ctx: any) {
    let semRef: any = undefined
    try {
      semRef = config.semantic?.scope === 'user'
        ? ctx.user?.resources?.semanticMemory
        : ctx.project?.resources?.semanticMemory
    } catch { /* not installed */ }

    if (!semRef) return { removed: 0, merged: 0 }

    let removed = 0
    let merged = 0

    // Track all fact IDs referenced in merges to avoid double-removal
    const mergedFactIds = new Set<string>()
    for (const merge of (input.merges ?? [])) {
      for (const id of merge.sourceFactIds) mergedFactIds.add(id)
    }

    // Process removals (skip any that are also in a merge)
    for (const removal of (input.removals ?? [])) {
      if (mergedFactIds.has(removal.factId)) continue
      try {
        await removeFact(semRef, removal.factId)
        removed++
      } catch (err) {
        console.warn('[tf.memory] Failed to remove fact during prune:', (err as Error).message ?? err)
      }
    }

    // Process merges: update first source fact with merged content, remove the rest
    for (const merge of (input.merges ?? [])) {
      if (merge.sourceFactIds.length < 2) continue
      try {
        const [keepId, ...removeIds] = merge.sourceFactIds
        // Collect source episode IDs from all source facts
        const existingFacts = allFacts(semRef)
        const sourceEpisodeIds: string[] = []
        for (const id of merge.sourceFactIds) {
          const fact = existingFacts.find((f) => f.id === id)
          if (fact) sourceEpisodeIds.push(...fact.sourceEpisodeIds)
        }
        const uniqueSources = [...new Set(sourceEpisodeIds)]

        await updateFact(semRef, keepId, merge.mergedContent, uniqueSources)
        for (const id of removeIds) {
          await removeFact(semRef, id)
        }
        merged++
      } catch (err) {
        console.warn('[tf.memory] Failed to merge facts during prune:', (err as Error).message ?? err)
      }
    }

    return { removed, merged }
  }

  const semScope = config.semantic?.scope
  const userResources: Record<string, any> = {}
  const projectResources: Record<string, any> = {}

  if (semScope === 'user' && semanticResource) userResources.semanticMemory = semanticResource
  if (semScope === 'project' && semanticResource) projectResources.semanticMemory = semanticResource

  const hasUser = Object.keys(userResources).length > 0
  const hasProject = Object.keys(projectResources).length > 0

  const base = {
    name: config.name ? `${config.name}/prune/persist` : 'tf.memory/prune/persist',
    inputSchema: pruneOutputSchema,
    outputSchema: z.any(),
    execute: executePersist,
  }

  if (hasUser && hasProject) return handler({ ...base, userResources, projectResources })
  if (hasUser) return handler({ ...base, userResources })
  if (hasProject) return handler({ ...base, projectResources })
  return handler(base)
}

/**
 * Assembles the prune sequencer: guard → generate → persist.
 * Generate and persist are gated behind the guard's `triggered` flag so
 * the LLM call is skipped entirely when the fact store is below threshold.
 */
export function memorySystemPrune(config: MemorySystemBlocksConfig) {
  // Ensure all prune blocks share the same semantic resource reference
  const sharedResource = config._semanticResource ?? (config.semantic
    ? createSemanticMemoryResource(config.semantic.scope)
    : undefined)

  const pruneConfig = { ...config, _semanticResource: sharedResource }

  const guardBlock = pruneGuard(pruneConfig)
  const generateBlock = pruneGenerate(pruneConfig)
  const persistBlock = prunePersist(pruneConfig)

  const generateAndPersist = sequencer({
    name: config.name ? `${config.name}/prune/generate-and-persist` : 'tf.memory/prune/generate-and-persist',
    inputSchema: z.any(),
  })
    .then(generateBlock)
    .then(persistBlock)

  return sequencer({
    name: config.name ? `${config.name}/prune` : 'tf.memory/prune',
    inputSchema: z.any(),
  })
    .then(guardBlock)
    .thenIf((result) => result.triggered, generateAndPersist)
}

/**
 * Assembles the full capture pipeline: observe → reflect → tick.
 * When semantic is configured, adds consolidation and prune as .work() steps.
 */
export function memorySystemCapture(config: MemorySystemBlocksConfig) {
  const observeBlock = memorySystemObserve(config)
  const reflectBlock = memorySystemReflect(config)
  const tickBlock = memorySystemTick(config)

  const pipeline = sequencer({
    name: config.name ?? 'tf.memory/capture',
    inputSchema: z.any(),
  })
    .then(observeBlock)
    .then(reflectBlock)
    .tap(tickBlock)

  if (config.semantic) {
    const consolidateBlock = memorySystemConsolidate(config)
    const pruneBlock = memorySystemPrune(config)
    return pipeline.work(consolidateBlock).work(pruneBlock)
  }

  return pipeline
}
