import { generator, handler, sequencer } from '@flow-state-dev/core'
import { z } from 'zod'
import { workingMemoryEntrySchema, workingMemoryResource } from './working-memory.js'
import type { WorkingMemoryDecayConfig } from './working-memory-helpers.js'
import {
  add,
  advance,
  evict,
  formatForObserveContext,
  items,
} from './working-memory-helpers.js'

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

/** Base config shared by all working memory blocks. */
export interface WorkingMemoryBlockConfig {
  capacity?: number
  maxPinnedSlots?: number
  decay?: Partial<WorkingMemoryDecayConfig>
}

/** Config for the observe generator. */
export interface WorkingMemoryObserveConfig extends WorkingMemoryBlockConfig {
  name?: string
  /** Model ID for the extraction LLM. Default: 'gpt-5-mini'. */
  model?: string
  /** Maximum observations to extract per turn. Default: 3. */
  maxExtractPerTurn?: number
}

/** Config for the bundled capture sequencer. */
export interface WorkingMemoryCaptureConfig extends WorkingMemoryObserveConfig {}

// ---------------------------------------------------------------------------
// Shared schemas
// ---------------------------------------------------------------------------

/**
 * Schema for the observations array produced by the observe block and
 * consumed by the remember block. Exported so flow authors can build
 * custom pipelines between observe and remember.
 */
export const observationsSchema = z.object({
  observations: z.array(z.object({
    content: z.string(),
    importance: z.number().min(0).max(1),
    pinned: z.boolean(),
    replaces: z.string(),
  })),
})

export type Observations = z.infer<typeof observationsSchema>

// ---------------------------------------------------------------------------
// Block factories
// ---------------------------------------------------------------------------

/**
 * Generator that uses an LLM to extract memories from input text.
 *
 * Input: a string (the text to analyze).
 * Output: structured observations (content, importance, pinned, replaces).
 *
 * This block only *extracts* — it does not persist anything. Pair it with
 * `workingMemoryRemember` to write observations into the resource, or use
 * the bundled `workingMemoryCapture` sequencer which wires both together.
 */
export function workingMemoryObserve(config?: WorkingMemoryObserveConfig) {
  const maxExtract = config?.maxExtractPerTurn ?? 3

  return generator({
    name: config?.name ?? 'workingMemory/observe',
    model: config?.model ?? 'gpt-5-mini',
    inputSchema: z.string(),
    outputSchema: observationsSchema,
    sessionResources: { workingMemory: workingMemoryResource },
    prompt: [
      'You are a working memory manager for a cognitive AI system.',
      'Review the following text and determine if any new information should be stored in working memory.',
      '',
      'Current working memory entries are provided in the system context (if any).',
      '',
      `Extract 0-${maxExtract} items. For each:`,
      '- content: what to remember (be concise)',
      '- importance: 0-1 (goals/constraints: 0.8-1.0, key facts: 0.5-0.8, context: 0.3-0.5)',
      '- pinned: true only for explicit user goals or critical constraints, false otherwise',
      '- replaces: the exact ID of an existing entry this supersedes (e.g. "wm_abc1"), or empty string "" if not replacing anything',
      '',
      'Rules:',
      '- Don\'t duplicate what\'s already in working memory',
      '- When the user changes their mind, replace the old entry (use replaces field)',
      '- Prefer fewer, higher-quality memories over many low-quality ones',
      '- Return empty observations array if nothing new is worth storing',
    ].join('\n'),
    context: (_input: string, ctx) => {
      const ref = ctx.session.resources.get('workingMemory')
      const formatted = formatForObserveContext(ref)
      return formatted || 'Working memory is empty.'
    },
    user: (input: string) => input,
    // Suppress all item emission — this is an internal extraction step,
    // not a conversational response visible to the end user.
    emit: { messages: false, reasoning: false, toolCalls: false },
  })
}

/**
 * Handler that persists observations into the working memory resource.
 *
 * Input: the structured output from `workingMemoryObserve` (observations array).
 * Output: the array of entries that were successfully added.
 *
 * For each observation:
 * - If `replaces` is set, the referenced entry is evicted first (no-op if ID doesn't exist).
 * - The observation is added as a new entry with auto-eviction at capacity.
 *
 * Errors on individual observations are caught and skipped — partial persistence
 * is preferred over all-or-nothing failure for a background memory system.
 */
export function workingMemoryRemember(config?: WorkingMemoryBlockConfig) {
  const helperConfig = {
    capacity: config?.capacity,
    maxPinnedSlots: config?.maxPinnedSlots,
    decay: config?.decay,
  }

  return handler({
    name: 'workingMemory/remember',
    inputSchema: observationsSchema,
    outputSchema: z.array(workingMemoryEntrySchema),
    sessionResources: { workingMemory: workingMemoryResource },
    execute: async (input, ctx) => {
      const ref = ctx.session.resources.get('workingMemory')
      const added: z.infer<typeof workingMemoryEntrySchema>[] = []

      for (const obs of input.observations) {
        try {
          // Handle replacements: evict old entry before adding new one.
          // If the replaced ID doesn't exist, evict is a no-op.
          if (obs.replaces) {
            await evict(ref, obs.replaces)
          }

          const entry = await add(ref, {
            content: obs.content,
            importance: obs.importance,
            pinned: obs.pinned ?? false,
          }, helperConfig)

          added.push(entry)
        } catch (_err) {
          // Skip failed observations rather than aborting the entire batch.
          // In a background memory system, partial persistence is better than
          // losing all observations because one failed.
        }
      }

      return added
    },
  })
}

/**
 * Handler that advances the decay clock and recomputes salience for all entries.
 * Use with `.tap()` in a sequencer — this is a side-effect with no meaningful output.
 */
export function workingMemoryTick(config?: WorkingMemoryBlockConfig) {
  const helperConfig = {
    capacity: config?.capacity,
    maxPinnedSlots: config?.maxPinnedSlots,
    decay: config?.decay,
  }

  return handler({
    name: 'workingMemory/tick',
    inputSchema: z.any(),
    sessionResources: { workingMemory: workingMemoryResource },
    execute: async (_input, ctx) => {
      const ref = ctx.session.resources.get('workingMemory')
      await advance(ref, helperConfig)
    },
  })
}

/**
 * Handler that returns the current working memory state: entries sorted by
 * salience and the current turn counter.
 */
export function workingMemorySnapshot() {
  return handler({
    name: 'workingMemory/snapshot',
    inputSchema: z.any(),
    outputSchema: z.object({
      entries: z.array(workingMemoryEntrySchema),
      currentTurn: z.number(),
    }),
    sessionResources: { workingMemory: workingMemoryResource },
    execute: (_input, ctx) => {
      const ref = ctx.session.resources.get('workingMemory')
      return {
        entries: items(ref),
        currentTurn: ref.state.currentTurn,
      }
    },
  })
}

/**
 * Handler that explicitly adds an entry to working memory.
 * For manual control when you don't want LLM-based extraction.
 */
export function workingMemoryAdd(config?: WorkingMemoryBlockConfig) {
  const helperConfig = {
    capacity: config?.capacity,
    maxPinnedSlots: config?.maxPinnedSlots,
    decay: config?.decay,
  }

  return handler({
    name: 'workingMemory/add',
    inputSchema: z.object({
      content: z.string(),
      importance: z.number().min(0).max(1),
      pinned: z.boolean().optional(),
      id: z.string().optional(),
      metadata: z.record(z.any()).optional(),
    }),
    outputSchema: workingMemoryEntrySchema,
    sessionResources: { workingMemory: workingMemoryResource },
    execute: async (input, ctx) => {
      const ref = ctx.session.resources.get('workingMemory')
      return add(ref, {
        content: input.content,
        importance: input.importance,
        pinned: input.pinned ?? false,
        id: input.id,
        metadata: input.metadata,
      }, helperConfig)
    },
  })
}

/**
 * Bundled sequencer: observe → remember → tick.
 *
 * This is the primary block most flow authors will use. One line to add
 * working memory capture to a pipeline:
 *
 * ```ts
 * import { workingMemoryCapture } from '@thought-fabric/core/memory'
 *
 * const pipeline = sequencer({ name: 'pipeline', inputSchema: chatInput })
 *   .then(chat)
 *   .work(workingMemoryCapture({ model: 'gpt-5-mini' }))
 * ```
 *
 * Input: `z.string()` — the text to extract memories from.
 * Runs observe first (LLM extraction), then remember (persists observations),
 * then tick advances the clock and recomputes salience on all entries.
 */
export function workingMemoryCapture(config?: WorkingMemoryCaptureConfig) {
  const observeBlock = workingMemoryObserve({
    name: config?.name ? `${config.name}/observe` : undefined,
    model: config?.model,
    capacity: config?.capacity,
    maxPinnedSlots: config?.maxPinnedSlots,
    decay: config?.decay,
    maxExtractPerTurn: config?.maxExtractPerTurn,
  })

  const rememberBlock = workingMemoryRemember({
    capacity: config?.capacity,
    maxPinnedSlots: config?.maxPinnedSlots,
    decay: config?.decay,
  })

  const tickBlock = workingMemoryTick({
    capacity: config?.capacity,
    maxPinnedSlots: config?.maxPinnedSlots,
    decay: config?.decay,
  })

  return sequencer({ name: config?.name ?? 'workingMemory/capture', inputSchema: z.string() })
    .then(observeBlock)
    .then(rememberBlock)
    .tap(tickBlock)
}
