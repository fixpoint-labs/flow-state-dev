/**
 * Minimum read-side consumption contract for memory implementations.
 *
 * Names the read-side surface (`recall`, `formatContext`) so future variants
 * can plug in behind the same shape. Write-side helpers and full contract
 * design are deferred to a follow-up.
 */

import type { MemoryItem } from './tools/types.js'

export type { MemoryItem }

/** Source store of a ranked recall result. */
export type RankedMemorySource = 'working' | 'episodic' | 'semantic'

/** A ranked memory item from cross-store recall. */
export type RankedMemoryItem = {
  content: string
  source: RankedMemorySource
  relevance: number
  category: string
  id: string
  /** Subject of the fact (semantic items only). */
  subject?: string
}

/** Sections returned by a memory context formatter. Each is omitted when empty. */
export type MemoryContextSections = {
  digest?: string
  working?: string
  semantic?: string
  episodic?: string
}

/** Read-side contract a memory implementation must satisfy. */
export interface MemoryProvider {
  recall(ctx: any, cue?: string): RankedMemoryItem[]
  formatContext(input: unknown, ctx: any): MemoryContextSections | undefined
}
