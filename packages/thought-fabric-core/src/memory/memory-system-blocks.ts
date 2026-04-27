import { generator, handler, sequencer } from '@flow-state-dev/core'
import { z } from 'zod'
import { workingMemoryResource } from './working-memory.js'
import type { WorkingMemoryHelperConfig } from './working-memory-helpers.js'
import {
  add,
  advance,
  evict,
  items as wmItems,
  pin,
} from './working-memory-helpers.js'
import { createEpisodicMemoryResource } from './episodic-memory.js'
import { encode, markConsolidated } from './episodic-memory-helpers.js'
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
    scope: 'user' | 'org'
    significanceThreshold: number
    maxEpisodes: number
  }
  /** Shared episodic resource reference — must be the same instance across blocks. */
  _episodicResource?: ReturnType<typeof createEpisodicMemoryResource>
  /** Semantic memory config. */
  semantic?: {
    scope: 'user' | 'org'
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
    subject: z.string().default('user'),
    content: z.string(),
    importance: z.number().min(0).max(1),
    durability: z.enum(['transient', 'session', 'persistent', 'permanent']),
    category: z.enum(['identity', 'event', 'preference', 'task', 'relationship', 'profession', 'belief', 'attribute', 'pattern']),
  })),
})

export type UnifiedObservations = z.infer<typeof unifiedObservationsSchema>

/** Output schema for the consolidation generator. */
export const consolidationOutputSchema = z.object({
  facts: z.array(z.object({
    subject: z.string().default('user'),
    content: z.string(),
    confidence: z.number().min(0).max(1),
    category: z.enum(['identity', 'relationship', 'preference', 'belief', 'profession', 'attribute', 'pattern']),
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
    'Extract memorable information from the conversation provided in context.',
    '',
    'For each item extracted, classify:',
    '- subject: who or what this is about. Use \'user\' for the primary user. For other people,',
    '  use their lowercase first name. For organizations, use lowercase hyphenated name.',
    '  Each fact should be about ONE subject — don\'t cram multiple entities into one fact.',
    '- content: concise statement of what to remember (about the subject)',
    '- importance: 0-1 (goals/constraints: 0.8-1.0, key facts: 0.5-0.8, context: 0.3-0.5, trivial: 0.1-0.3)',
    '- durability: how long this should persist:',
    '  * transient: only relevant to current turn',
    '  * session: relevant for this session only (e.g., current task, what user asked to do)',
    '  * persistent: should be remembered across sessions (e.g., user preferences, important facts)',
    '  * permanent: fundamental facts that never change (e.g., user\'s name, birthday)',
    '- category:',
    '  * identity: who someone is — name, birthdate, location, background',
    '  * profession: what someone does — job, company, role, skills',
    '  * preference: likes, dislikes, style choices',
    '  * belief: opinions, worldviews, values',
    '  * relationship: connections to other named entities — spouse, pet, employer',
    '  * attribute: properties/characteristics — possessions, abilities, circumstances',
    '  * pattern: recurring behaviors',
    '  * event: something that happened (session-only)',
    '  * task: something the user asked to do (session-only)',
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
    '- ONE fact per subject. If user says "I\'m Joe and my wife is Jane",',
    '  that\'s TWO facts: subject=user "Name is Joe" + subject=jane "Is the user\'s wife"',
    '- Do NOT store negative facts ("X is NOT Y"). Simply omit if nothing positive to store.',
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
  //
  // IMPORTANT: We intentionally do NOT include existing working memory or episodic
  // memory here. LLMs reliably re-extract from any content they can see, regardless
  // of instructions. Dedup is handled structurally in the reflect handler via
  // findBestOverlap. The observer's job is pure extraction from new conversation items.
  function buildContext(_input: unknown, ctx: any): string | undefined {
    const sysRef = ctx.resources.memorySystem
    const sysState = sysRef.state

    // Get items from session
    if (config.source) {
      const text = config.source(_input, ctx)
      return text || undefined
    }

    const allItems = ctx.session?.items?.all?.() ?? []
    const newItems = allItems.filter((_item: any, idx: number) => idx > sysState.lastProcessedIndex)
    if (newItems.length > 0) {
      return newItems
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
    }

    if (typeof _input === 'string' && _input.trim().length > 0) {
      // Fallback: live items from the current request may not yet be
      // flushed when the observer runs. Use the block input directly.
      return `[user] ${_input}`
    }

    return undefined
  }

  // FIX-435: flat resources map; intrinsic scope on each resource routes
  // it to the right storage layer.
  const resources: Record<string, any> = { ...sessionResources }
  if (episodicResource) resources.episodicMemory = episodicResource

  return generator({
    name: config.name ? `${config.name}/observe` : 'tf.memory/observe',
    model: config.model,
    inputSchema: z.any(),
    outputSchema: unifiedObservationsSchema,
    resources,
    prompt: observePrompt,
    context: buildContext,
    user: (_input: unknown) => 'Analyze the items in context and extract memories.',
    agentType: "trace",
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
    const wmRef = ctx.resources.workingMemory
    const sysRef = ctx.resources.memorySystem

    // Get episodic ref if available (FIX-435: flat resource registry)
    let epRef: any = undefined
    try {
      epRef = ctx.resources?.episodicMemory
    } catch { /* not installed */ }

    // Get semantic ref if available
    let semRef: any = undefined
    try {
      semRef = ctx.resources?.semanticMemory
    } catch { /* not installed */ }

    let episodicWrites = 0
    let evictedPersistent = 0

    for (const item of input.items) {
      try {
        // Working memory dedup: check if this observation overlaps with an
        // existing WM entry. The observer doesn't see existing memory (to
        // prevent re-extraction), so dedup happens here structurally.
        const existingEntries = wmItems(wmRef)
        const wmMatch = findBestOverlap(item.content, existingEntries)

        if (wmMatch) {
          if (wmMatch.minOverlap >= 0.95) {
            // Near-identical — skip entirely, nothing new to store
            continue
          }
          // Partial overlap — supersede the old entry with the richer version
          if (wmMatch.fact.durability === 'persistent' || wmMatch.fact.durability === 'permanent') {
            evictedPersistent++
          }
          await evict(wmRef, wmMatch.fact.id)
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
        // Stable categories = all semantic categories. Session-only categories
        // (event, task) skip semantic — they belong in working/episodic only.
        //
        // Dedup is subject-scoped: only compare against facts with the same subject.
        // This prevents "born in May" about user deduping against an unrelated
        // fact about a different person.
        const sessionOnlyCategories = new Set(['event', 'task'])
        const isStableCategory = !sessionOnlyCategories.has(item.category)
        const normalizedSubject = (item.subject ?? 'user').toLowerCase()
        if (
          semRef &&
          config.semantic &&
          (item.durability === 'permanent' || item.durability === 'persistent') &&
          isStableCategory
        ) {
          const existing = allFacts(semRef, normalizedSubject)
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
              subject: normalizedSubject,
              content: item.content,
              confidence: item.importance,
              category: item.category as any,
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

  // FIX-435: flat resources map; intrinsic scope on each resource routes
  // it to the right storage layer.
  const resources: Record<string, any> = { ...sessionResources }
  if (episodicResource) resources.episodicMemory = episodicResource
  if (semanticResource) resources.semanticMemory = semanticResource

  return handler({
    name: config.name ? `${config.name}/reflect` : 'tf.memory/reflect',
    inputSchema: unifiedObservationsSchema,
    outputSchema: z.any(),
    resources,
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
    resources: {
      workingMemory: workingMemoryResource,
      memorySystem: memorySystemResource,
    },
    execute: async (_input, ctx) => {
      const wmRef = ctx.resources.workingMemory
      const sysRef = ctx.resources.memorySystem

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
        await sysRef.updateState((s: any) => ({
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
    const sysRef = ctx.resources.memorySystem
    const wmRef = ctx.resources.workingMemory
    const sysState = sysRef.state

    const minInterval = config.semantic?.consolidation?.minInterval ?? DEFAULT_CONSOLIDATION_CONFIG.minInterval
    const episodicThreshold = config.semantic?.consolidation?.episodicThreshold ?? DEFAULT_CONSOLIDATION_CONFIG.episodicThreshold
    const onEviction = config.semantic?.consolidation?.onEviction ?? DEFAULT_CONSOLIDATION_CONFIG.onEviction

    const turnsSinceConsolidation = wmRef.state.currentTurn - sysState.lastConsolidationTurn

    const triggered = turnsSinceConsolidation >= minInterval &&
      (sysState.episodicWritesSinceLastConsolidation >= episodicThreshold ||
        (onEviction && sysState.evictedPersistentSinceLastConsolidation > 0))

    if (!triggered) return { triggered: false, episodes: [], existingFacts: [] }

    // Read unconsolidated episodes (FIX-435: flat resource registry)
    let epRef: any = undefined
    try {
      epRef = ctx.resources?.episodicMemory
    } catch { /* not installed */ }

    const unconsolidated = epRef
      ? epRef.state.episodes.filter((e: any) => !e.consolidated)
      : []

    // Read existing semantic facts
    let semRef: any = undefined
    try {
      semRef = ctx.resources?.semanticMemory
    } catch { /* not installed */ }

    const existingFacts = semRef ? allFacts(semRef) : []

    return { triggered: true, episodes: unconsolidated, existingFacts }
  }

  // FIX-435: flat resources map; intrinsic scope routes each resource.
  const resources: Record<string, any> = { ...sessionResources }
  if (episodicResource) resources.episodicMemory = episodicResource
  if (semanticResource) resources.semanticMemory = semanticResource

  return handler({
    name: config.name ? `${config?.name ?? 'tf.memory'}/consolidate/guard` : 'tf.memory/consolidate/guard',
    inputSchema: z.any(),
    outputSchema: guardOutputSchema,
    resources,
    execute: executeGuard,
  })
}

/**
 * Creates the consolidation generator.
 * LLM call that synthesizes semantic facts from episodic observations.
 */
export function consolidationGenerate(config: MemorySystemBlocksConfig) {
  const consolidationPrompt = [
    'You are a knowledge consolidation system. You receive a batch of episodic memories',
    '(individual observations from conversations) and a set of existing semantic facts',
    '(stable knowledge about the user and related entities).',
    '',
    'Semantic memory stores STABLE KNOWLEDGE that is useful across sessions:',
    '- Who the user is (name, role, location, background)',
    '- What the user likes or dislikes (preferences, opinions, style)',
    '- Relationships between people, orgs, or concepts the user cares about',
    '- Recurring patterns in how the user works or communicates',
    '',
    'Semantic memory does NOT store:',
    '- What happened in a specific session (that\'s episodic memory\'s job)',
    '- What the user asked the assistant to do or create',
    '- Specific content the user generated, saved, or viewed',
    '- One-time requests or queries (asking about X ≠ preferring X)',
    '- Transient context like current tasks, recent searches, or session activities',
    '',
    'Each fact has a SUBJECT — who or what it\'s about:',
    '- \'user\' for the primary user',
    '- Lowercase first name for other people (e.g., \'jennifer\', \'max\')',
    '- Lowercase hyphenated name for organizations (e.g., \'fixpoint-labs\')',
    '- ONE fact per subject. Don\'t cram multiple entities into one fact.',
    '',
    'Categories:',
    '- identity: who someone is — name, birthdate, location, background',
    '- profession: what someone does — job, company, role, skills',
    '- preference: likes, dislikes, style choices',
    '- belief: opinions, worldviews, values',
    '- relationship: connections to other named entities — spouse, pet, employer',
    '- attribute: properties/characteristics — possessions, abilities, circumstances',
    '- pattern: recurring behaviors',
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
    '  → action: \'update\', targetFactId: <id>, content: "Works at Stripe"',
    '- Existing: "User is learning Python" + Episode: "User gave up on Python"',
    '  → action: \'invalidate\', targetFactId: <id>',
    '- Existing: "User\'s name is Jake" + Episode: "User spells their name Jake"',
    '  → action: \'reinforce\', targetFactId: <id>',
    '',
    'Rules:',
    '- Ask: "Would this help me serve this user better in a future conversation?"',
    '  If not, skip it.',
    '- Do NOT store negative facts ("X is NOT Y"). Update or invalidate the positive form.',
    '- Do NOT infer preferences from single interactions. Asking "what are the best',
    '  restaurants?" does not mean the user prefers a particular ranking system.',
    '- Do NOT record session activities as facts. "User saved a poem about X" is',
    '  episodic, not semantic — it describes what happened, not who the user is.',
    '- Prefer reinforcing existing facts over creating near-duplicates',
    '- ALWAYS check existing facts for contradictions — stale facts are worse than missing ones',
    '- Return empty facts array if nothing qualifies as stable knowledge',
  ].join('\n')

  function buildContext(input: any): string {
    if (!input.triggered) return 'No consolidation needed. Return empty facts array.'

    let ctx = 'Episodes to consolidate:\n'
    for (const ep of input.episodes) {
      ctx += `- [${ep.id}] (${ep.category}) ${ep.content}\n`
    }

    if (input.existingFacts.length > 0) {
      // Group existing facts by subject for clearer context
      const bySubject = new Map<string, typeof input.existingFacts>()
      for (const f of input.existingFacts) {
        const subj = f.subject ?? 'user'
        if (!bySubject.has(subj)) bySubject.set(subj, [])
        bySubject.get(subj)!.push(f)
      }

      ctx += '\nExisting semantic facts (check for contradictions):\n'
      for (const [subject, facts] of bySubject) {
        ctx += `\n  About ${subject}:\n`
        for (const f of facts) {
          ctx += `  - [${f.id}] (${f.category}, confidence: ${f.confidence}, ×${f.reinforcementCount}) ${f.content}\n`
        }
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
    agentType: "trace",
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

    // FIX-435: flat resource registry — intrinsic scope routes lookups.
    let semRef: any = undefined
    try {
      semRef = ctx.resources?.semanticMemory
    } catch { /* not installed */ }

    if (!semRef) return { added: 0, reinforced: 0, updated: 0, invalidated: 0 }

    // Get episodic ref for marking consolidated
    let epRef: any = undefined
    try {
      epRef = ctx.resources?.episodicMemory
    } catch { /* not installed */ }

    const sysRef = ctx.resources.memorySystem
    const wmRef = ctx.resources.workingMemory

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
            // Dedup: check existing facts (same subject) before adding. The consolidation
            // LLM sometimes creates near-duplicates of existing facts with action 'new'
            // instead of 'reinforce'.
            const normalizedSubject = (fact.subject ?? 'user').toLowerCase()
            const existing = allFacts(semRef, normalizedSubject)
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
                subject: normalizedSubject,
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

  // FIX-435: flat resources map; intrinsic scope routes each resource.
  const resources: Record<string, any> = { ...sessionResources }
  if (episodicResource) resources.episodicMemory = episodicResource
  if (semanticResource) resources.semanticMemory = semanticResource

  return handler({
    name: config.name ? `${config.name}/consolidate/persist` : 'tf.memory/consolidate/persist',
    inputSchema: consolidationOutputSchema,
    outputSchema: z.any(),
    resources,
    execute: executePersist,
  })
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
      semRef = ctx.resources?.semanticMemory
    } catch { /* not installed */ }

    if (!semRef) return { triggered: false, facts: [] }

    const facts = allFacts(semRef)
    const triggered = threshold > 0 && facts.length >= threshold

    if (!triggered) return { triggered: false, facts: [] }
    return { triggered: true, facts }
  }

  // FIX-435: flat resources map; intrinsic scope routes the resource.
  const resources: Record<string, any> = {}
  if (semanticResource) resources.semanticMemory = semanticResource

  return handler({
    name: config.name ? `${config.name}/prune/guard` : 'tf.memory/prune/guard',
    inputSchema: z.any(),
    outputSchema: pruneGuardOutputSchema,
    resources,
    execute: executeGuard,
  })
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
    'Merge facts when 2+ facts about the SAME SUBJECT each contain unique information',
    'about the same topic that would be better expressed as a single fact. Example:',
    '- "User was born in Maryland" + "User was born in May" → "Born in May in Maryland"',
    '',
    'Do NOT merge facts about different subjects.',
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

    // Group facts by subject for clearer context
    const bySubject = new Map<string, typeof input.facts>()
    for (const f of input.facts) {
      const subj = f.subject ?? 'user'
      if (!bySubject.has(subj)) bySubject.set(subj, [])
      bySubject.get(subj)!.push(f)
    }

    let ctx = `Current semantic facts (${input.facts.length} total):\n`
    for (const [subject, facts] of bySubject) {
      ctx += `\n  About ${subject}:\n`
      for (const f of facts) {
        ctx += `  - [${f.id}] (${f.category}, confidence: ${f.confidence}, `
        ctx += `reinforced: ${f.reinforcementCount}x, extracted: ${f.extractedAt}) ${f.content}\n`
      }
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
    agentType: "trace",
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
      semRef = ctx.resources?.semanticMemory
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

  // FIX-435: flat resources map; intrinsic scope routes the resource.
  const resources: Record<string, any> = {}
  if (semanticResource) resources.semanticMemory = semanticResource

  return handler({
    name: config.name ? `${config.name}/prune/persist` : 'tf.memory/prune/persist',
    inputSchema: pruneOutputSchema,
    outputSchema: z.any(),
    resources,
    execute: executePersist,
  })
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
