/**
 * Working memory resource definition and schemas.
 *
 * Working memory is a bounded, salience-scored active store that manages what
 * stays in cognitive focus. Items are scored by importance × decay, with
 * automatic eviction when capacity is exceeded.
 */

import { defineResource } from '@flow-state-dev/core'
import { z } from 'zod'

export const workingMemoryEntrySchema = z.object({
  id: z.string(),
  content: z.string(),
  salience: z.number().min(0).max(1),
  pinned: z.boolean().default(false),
  addedAtTurn: z.number(),
  lastAccessedAtTurn: z.number(),
  importance: z.number().min(0).max(1).default(0.5),
  metadata: z.record(z.any()).optional()
})

export type WorkingMemoryEntry = z.infer<typeof workingMemoryEntrySchema>

export const workingMemoryStateSchema = z.object({
  entries: z.array(workingMemoryEntrySchema),
  currentTurn: z.number().default(0)
})

export type WorkingMemoryState = z.infer<typeof workingMemoryStateSchema>

export const workingMemoryResource = defineResource({
  stateSchema: workingMemoryStateSchema,
  default: { entries: [], currentTurn: 0 },
  writable: true
})
