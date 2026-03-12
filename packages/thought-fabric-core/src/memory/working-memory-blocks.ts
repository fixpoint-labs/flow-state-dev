import { generator, handler, sequencer } from '@flow-state-dev/core'
import { z } from 'zod'
import { workingMemoryEntrySchema, workingMemoryResource } from './working-memory.js'
import type { WorkingMemoryDecayConfig } from './working-memory-helpers.js'
import {
  add,
  evict,
  formatForObserveContext,
  items,
  tick,
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
// Internal schemas
// ---------------------------------------------------------------------------

const observeOutputSchema = z.object({
  observations: z.array(z.object({
    content: z.string(),
    importance: z.number().min(0).max(1),
    pinned: z.boolean().optional(),
    replaces: z.string().optional(),
  })),
})

type ObserveOutput = z.infer<typeof observeOutputSchema>

// ---------------------------------------------------------------------------
// Block factories
// ---------------------------------------------------------------------------

/**
 * Generator that uses an LLM to extract memories from input text.
 *
 * Input: a string (the text to analyze).
 * Output: structured observations.
 *
 * On completion, extracted observations are persisted to the working memory
 * resource. If an observation includes a `replaces` field, the old entry is
 * evicted before the new one is added.
 *
 * Exported for flow authors who want to compose observe and tick independently
 * (the "full control" path). Most users should use `workingMemoryCapture` instead.
 */
export function workingMemoryObserve(config?: WorkingMemoryObserveConfig) {
  const maxExtract = config?.maxExtractPerTurn ?? 3
  const helperConfig = {
    capacity: config?.capacity,
    maxPinnedSlots: config?.maxPinnedSlots,
    decay: config?.decay,
  }

  return generator({
    name: config?.name ?? 'workingMemory/observe',
    model: config?.model ?? 'gpt-5-mini',
    inputSchema: z.string(),
    outputSchema: observeOutputSchema,
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
      '- pinned: true only for explicit user goals or critical constraints',
      '- replaces: ID of an existing entry this supersedes (optional)',
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
    emit: { messages: false },
    onCompleted: async (output: ObserveOutput, ctx) => {
      const ref = ctx.session.resources.get('workingMemory')

      for (const obs of output.observations) {
        // Handle replacements: evict old entry before adding new one.
        // If the replaced ID doesn't exist, evict is a no-op.
        if (obs.replaces) {
          await evict(ref, obs.replaces)
        }

        await add(ref, {
          content: obs.content,
          importance: obs.importance,
          pinned: obs.pinned ?? false,
        }, helperConfig)
      }
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
      await tick(ref, helperConfig)
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
      metadata: z.record(z.unknown()).optional(),
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
 * Bundled sequencer: observe (LLM extraction) → tick (decay clock).
 *
 * This is the primary block most flow authors will use. One line to add
 * working memory capture to a pipeline:
 *
 * ```ts
 * const pipeline = sequencer({ name: 'pipeline', inputSchema: chatInput })
 *   .then(chat)
 *   .work(memory.workingMemoryCapture({ model: 'gpt-5-mini' }))
 * ```
 *
 * Input: `z.string()` — the text to extract memories from.
 * Runs observe first (extracts and stores memories), then tick advances the
 * clock and recomputes salience on all entries.
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

  const tickBlock = workingMemoryTick({
    capacity: config?.capacity,
    maxPinnedSlots: config?.maxPinnedSlots,
    decay: config?.decay,
  })

  return sequencer({ name: config?.name ?? 'workingMemory/capture', inputSchema: z.string() })
    .then(observeBlock)
    .tap(tickBlock)
}
