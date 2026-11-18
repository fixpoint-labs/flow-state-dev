/**
 * Memory as an installable kit.
 *
 * The kit builds one memory system and hands it to every entry in its `flows`
 * slot. A builder puts `mem.capability` in the flow's `uses` and spreads
 * `mem.sessionResources` and `mem.userResources` into the flow resources.
 */
import { defineKit, slot } from '@flow-state-dev/core'
import type { FlowInstance } from '@flow-state-dev/core/types'
import { z } from 'zod'
import { system, type MemorySystem, type MemorySystemConfig } from '../memory-system'

const modelSchema = z.union([
  z.string().min(1),
  z.array(z.string().min(1)).min(1),
])
const objectSchema = z.custom<Record<string, unknown>>(
  (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
  { message: 'expected an object' },
)
const tierSchema = z.union([z.literal(true), objectSchema])

/** The memory kit's config: the same options accepted by {@link system}. */
export type MemoryKitConfig = MemorySystemConfig

const configSchema: z.ZodType<MemoryKitConfig, z.ZodTypeDef, MemoryKitConfig> = z
  .object({
    model: modelSchema,
    consolidationModel: modelSchema.optional(),
    pruneModel: modelSchema.optional(),
    working: tierSchema,
    episodic: tierSchema.optional(),
    semantic: tierSchema.optional(),
    digest: tierSchema.optional(),
    name: z.string().min(1).optional(),
    inputSchema: z.custom<MemorySystemConfig['inputSchema']>((value) => value != null).optional(),
    source: z.custom<NonNullable<MemorySystemConfig['source']>>((value) => typeof value === 'function').optional(),
    maxAssistantChars: z.number().int().nonnegative().optional(),
    tool: objectSchema.optional(),
    hygiene: z.union([z.boolean(), objectSchema]).optional(),
    evaluator: z.custom<MemorySystemConfig['evaluator']>((value) => typeof value === 'object' && value !== null).optional(),
  })
  .strict()
  .superRefine((config, ctx) => {
    if (config.semantic !== undefined && config.episodic === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['semantic'], message: 'semantic memory requires episodic memory' })
    }
    if (config.digest !== undefined && config.semantic === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['digest'], message: 'digest memory requires semantic memory' })
    }
  }) as z.ZodType<MemoryKitConfig, z.ZodTypeDef, MemoryKitConfig>

/** A flow builder installed by the memory kit, handed the built memory system. */
export type MemoryFlowBuilder = (memory: MemorySystem) => FlowInstance<any, any> | readonly FlowInstance<any, any>[]

const flowBuilderSchema = z.custom<MemoryFlowBuilder>((value) => typeof value === 'function', {
  message: 'a `flows` entry is a function that builds a flow on the memory system',
})

/**
 * Install memory into an app with one config object.
 *
 * Plain agent flows join through `memory.slots.flows`; each builder receives
 * the same system and returns a flow carrying its resources and capability.
 */
export const memory = defineKit({
  name: 'memory',
  config: configSchema,
  slots: { flows: slot.keyed(flowBuilderSchema) },
  install: ({ config, slots }) => {
    const installed = system(config)
    return {
      flows: Object.values(slots.flows).flatMap((build) => {
        const flows = build(installed)
        return Array.isArray(flows) ? [...flows] : [flows]
      }),
    }
  },
})
