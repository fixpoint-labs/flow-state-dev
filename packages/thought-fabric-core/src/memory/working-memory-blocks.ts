/**
 * Working memory composable blocks.
 *
 * Pre-built blocks for sequencer chains. Each block declares sessionResources
 * so the workingMemory resource bubbles up automatically through sequencer
 * resource merging.
 */

import { generator, handler, sequencer } from '@flow-state-dev/core'
import type { ResourceRef } from '@flow-state-dev/core/types'
import { z } from 'zod'

import { workingMemoryResource, type WorkingMemoryState } from './working-memory.js'
import {
  add,
  evict,
  tick as tickHelper,
  items,
  formatForContext,
  type DecayConfig,
  type WorkingMemoryHelperConfig,
  type AddEntryInput
} from './working-memory-helpers.js'

// ---------- Shared schemas ----------

const extractedMemorySchema = z.object({
  content: z.string(),
  importance: z.number().min(0).max(1),
  pinned: z.boolean().optional(),
  replaces: z.string().optional()
})

const extractionOutputSchema = z.object({
  memories: z.array(extractedMemorySchema)
})

type ExtractionOutput = z.infer<typeof extractionOutputSchema>

// ---------- Config types ----------

export interface WorkingMemoryObserveConfig {
  model: string
  capacity?: number
  maxPinnedSlots?: number
  maxExtractPerTurn?: number
  decay?: DecayConfig
}

export interface WorkingMemoryCaptureConfig extends WorkingMemoryObserveConfig {}

export interface WorkingMemoryTickConfig {
  decay?: DecayConfig
  capacity?: number
  maxPinnedSlots?: number
}

export interface WorkingMemoryAddConfig {
  capacity?: number
  maxPinnedSlots?: number
  decay?: DecayConfig
}

// ---------- Utility ----------

function generateEntryId(): string {
  return `wm_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

function buildHelperConfig(config: {
  capacity?: number
  maxPinnedSlots?: number
  decay?: DecayConfig
}): Partial<WorkingMemoryHelperConfig> {
  return {
    capacity: config.capacity,
    maxPinnedSlots: config.maxPinnedSlots,
    decay: config.decay
  }
}

// ---------- workingMemoryObserve ----------

function buildObservePrompt(maxExtract: number): string {
  return [
    'Review the following text. Determine if any new information should be stored in working memory.',
    '',
    'Current working memory is provided in context.',
    '',
    `Extract 0-${maxExtract} items. For each:`,
    '- content: what to remember (be concise)',
    '- importance: 0-1 (goals/constraints: 0.8-1.0, key facts: 0.5-0.8, context: 0.3-0.5)',
    '- pinned: true only for explicit user goals or critical constraints',
    '- replaces: ID of an existing entry this supersedes (optional)',
    '',
    'Rules:',
    "- Don't duplicate what's already in working memory",
    '- When the user changes their mind, replace the old entry (use replaces field)',
    '- Prefer fewer, higher-quality memories over many low-quality ones',
    '- Return empty memories array if nothing new is worth storing'
  ].join('\n')
}

/**
 * Observe step: uses an LLM to extract memories from text and stores them.
 * Exported for flow authors who want to compose observe and tick independently.
 */
export function workingMemoryObserve(config: WorkingMemoryObserveConfig) {
  const maxExtract = config.maxExtractPerTurn ?? 3
  const helperCfg = buildHelperConfig(config)

  const extract = generator({
    name: 'wm-extract',
    model: config.model,
    inputSchema: z.string(),
    outputSchema: extractionOutputSchema,
    sessionResources: { workingMemory: workingMemoryResource },
    prompt: buildObservePrompt(maxExtract),
    context: [
      (_input: string, ctx: any) => {
        const ref = ctx.session.resources.workingMemory as ResourceRef<WorkingMemoryState>
        return formatForContext(ref) || 'Working memory is currently empty.'
      }
    ],
    user: (input: string) => input
  })

  const store = handler({
    name: 'wm-store',
    inputSchema: extractionOutputSchema,
    sessionResources: { workingMemory: workingMemoryResource },
    execute: async (input: ExtractionOutput, ctx: any) => {
      const ref = ctx.session.resources.workingMemory as ResourceRef<WorkingMemoryState>

      const limited = input.memories.slice(0, maxExtract)

      for (const mem of limited) {
        if (mem.replaces) {
          const existing = ref.state.entries.find((e) => e.id === mem.replaces)
          if (existing) {
            await evict(ref, mem.replaces)
          }
        }

        await add(
          ref,
          {
            id: generateEntryId(),
            content: mem.content,
            importance: mem.importance,
            pinned: mem.replaces ? false : (mem.pinned ?? false)
          },
          helperCfg
        )
      }

      return input
    }
  })

  return sequencer({ name: 'wm-observe', inputSchema: z.string() })
    .then(extract)
    .then(store)
}

/**
 * Standalone tick handler. Advances the decay clock and recomputes salience
 * for all entries. Pass-through: returns its input unchanged.
 */
export function workingMemoryTick(config?: WorkingMemoryTickConfig) {
  const decay = config?.decay
  const helperCfg = decay
    ? { decay, capacity: config?.capacity, maxPinnedSlots: config?.maxPinnedSlots }
    : undefined

  return handler({
    name: 'wm-tick',
    sessionResources: { workingMemory: workingMemoryResource },
    execute: async (input: unknown, ctx: any) => {
      const ref = ctx.session.resources.workingMemory as ResourceRef<WorkingMemoryState>
      await tickHelper(ref, helperCfg)
      return input
    }
  })
}

/**
 * Snapshot handler. Returns the current working memory entries sorted by
 * salience descending.
 */
export function workingMemorySnapshot() {
  return handler({
    name: 'wm-snapshot',
    sessionResources: { workingMemory: workingMemoryResource },
    execute: (_input: unknown, ctx: any) => {
      const ref = ctx.session.resources.workingMemory as ResourceRef<WorkingMemoryState>
      return {
        entries: items(ref),
        currentTurn: ref.state.currentTurn
      }
    }
  })
}

const addInputSchema = z.object({
  id: z.string().optional(),
  content: z.string(),
  importance: z.number().min(0).max(1).optional(),
  pinned: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional()
})

/**
 * Explicit add handler. Adds a single entry to working memory.
 */
export function workingMemoryAdd(config?: WorkingMemoryAddConfig) {
  const helperCfg = config ? buildHelperConfig(config) : undefined

  return handler({
    name: 'wm-add',
    inputSchema: addInputSchema,
    sessionResources: { workingMemory: workingMemoryResource },
    execute: async (input: z.infer<typeof addInputSchema>, ctx: any) => {
      const ref = ctx.session.resources.workingMemory as ResourceRef<WorkingMemoryState>
      const entry: AddEntryInput = {
        id: input.id ?? generateEntryId(),
        content: input.content,
        importance: input.importance,
        pinned: input.pinned,
        metadata: input.metadata
      }
      const result = await add(ref, entry, helperCfg)
      return { added: entry, evicted: result.evicted ?? null }
    }
  })
}

/**
 * Bundled capture block: observe (extract + store) → tick.
 * The primary block most flow authors use. Takes z.string() input (the text
 * to extract memories from). Designed to run via .work() so it doesn't block
 * the response.
 */
export function workingMemoryCapture(config: WorkingMemoryCaptureConfig) {
  const observe = workingMemoryObserve(config)
  const tick = workingMemoryTick({
    decay: config.decay,
    capacity: config.capacity,
    maxPinnedSlots: config.maxPinnedSlots
  })

  return sequencer({ name: 'wm-capture', inputSchema: z.string() })
    .then(observe)
    .tap(tick)
}
