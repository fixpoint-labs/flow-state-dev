/**
 * Memory capabilities — defineCapability() surfaces for the memory subsystems.
 *
 * Each memory tier (working, episodic, semantic) is packaged as an independent
 * capability. Blocks declare `uses: [workingMemoryCapability]` to auto-install
 * resources and gain typed helpers via `ctx.cap.workingMemory.*`.
 *
 * Factory functions allow custom config. Default instances use standard defaults.
 * The composed `memory` capability is created by `memory.system()` — see
 * memory-system.ts for the composition layer.
 */

import { defineCapability } from '@flow-state-dev/core'
import type { ResourceContext } from '@flow-state-dev/core'

import { workingMemoryResource, type WorkingMemoryState } from './working-memory.js'
import {
  DEFAULT_WORKING_MEMORY_CONFIG,
  add,
  evict,
  pin,
  unpin,
  refresh,
  advance,
  items,
  formatForContext,
} from './working-memory-helpers.js'
import type { WorkingMemoryHelperConfig, AddEntryInput } from './working-memory-helpers.js'

import { createEpisodicMemoryResource, type EpisodicMemoryState } from './episodic-memory.js'
import { encode, recent, markConsolidated } from './episodic-memory-helpers.js'
import type { EncodeEpisodeInput } from './episodic-memory-helpers.js'

import { createSemanticMemoryResource, type SemanticMemoryState } from './semantic-memory.js'
import type { SemanticFact } from './semantic-memory.js'
import { addFact, updateFact, reinforce, removeFact, allFacts, query } from './semantic-memory-helpers.js'

// ---------------------------------------------------------------------------
// Working Memory Capability
// ---------------------------------------------------------------------------

/**
 * Create a working memory capability with custom config.
 *
 * Declares `workingMemory` session resource and exposes typed helpers
 * via `ctx.cap.workingMemory`. No presets — works on all block kinds.
 *
 * For generator context injection, use `workingMemoryContextFormatter`
 * in the generator's `context` array alongside this capability.
 */
export function createWorkingMemoryCapability(config?: WorkingMemoryHelperConfig) {
  const resolved = {
    capacity: config?.capacity ?? DEFAULT_WORKING_MEMORY_CONFIG.capacity,
    maxPinnedSlots: config?.maxPinnedSlots ?? DEFAULT_WORKING_MEMORY_CONFIG.maxPinnedSlots,
    decay: {
      strategy: config?.decay?.strategy ?? DEFAULT_WORKING_MEMORY_CONFIG.decay.strategy,
      rate: config?.decay?.rate ?? DEFAULT_WORKING_MEMORY_CONFIG.decay.rate,
    },
  }

  return defineCapability({
    name: 'workingMemory' as const,
    sessionResources: { workingMemory: workingMemoryResource },
    fns: (ctx: any) => {
      const ref = ctx.session.resources.workingMemory as ResourceContext<WorkingMemoryState>
      return {
        /** Add an entry. Lowest-salience non-pinned entry is evicted if at capacity. */
        add: (entry: AddEntryInput) => add(ref, entry, resolved),
        /** Remove an entry by ID. Overrides pin status. */
        evict: (id: string) => evict(ref, id),
        /** Pin an entry to protect from auto-eviction. */
        pin: (id: string) => pin(ref, id, resolved),
        /** Unpin an entry. */
        unpin: (id: string) => unpin(ref, id),
        /** Refresh an entry — reset access turn, recompute salience. */
        refresh: (id: string) => refresh(ref, id, resolved),
        /** Advance turn counter by 1, recomputing salience for all entries. */
        tick: () => advance(ref, resolved),
        /** Get current entries sorted by salience (highest first). */
        items: () => items(ref),
        /** Format current entries for LLM context (bullet list). */
        format: () => formatForContext(ref),
      }
    },
  })
}

/** Working memory capability with default config (capacity 7, power-law decay). */
export const workingMemoryCapability = createWorkingMemoryCapability()

// ---------------------------------------------------------------------------
// Episodic Memory Capability
// ---------------------------------------------------------------------------

/** Config for episodic memory capability. */
export interface EpisodicMemoryCapabilityConfig {
  /** Resource scope. Default: 'user'. */
  scope?: 'user' | 'project'
  /** Max episodes to retain. Default: 200. */
  maxEpisodes?: number
}

/**
 * Create an episodic memory capability.
 *
 * Declares `episodicMemory` resource in the configured scope and exposes
 * typed helpers via `ctx.cap.episodicMemory`.
 */
export function createEpisodicMemoryCapability(config?: EpisodicMemoryCapabilityConfig) {
  const scope = config?.scope ?? 'user'
  const maxEpisodes = config?.maxEpisodes ?? 200

  const resource = createEpisodicMemoryResource(scope)

  return defineCapability({
    name: 'episodicMemory' as const,
    ...(scope === 'user'
      ? { userResources: { episodicMemory: resource } }
      : { projectResources: { episodicMemory: resource } }),
    fns: (ctx: any) => {
      const scopeCtx = scope === 'user' ? ctx.user : ctx.project
      const ref = scopeCtx?.resources?.episodicMemory as ResourceContext<EpisodicMemoryState>
      return {
        /** Encode a new episode. Auto-evicts oldest when over capacity. */
        encode: (episode: EncodeEpisodeInput) => encode(ref, episode, maxEpisodes),
        /** Get recent episodes sorted by turn (most recent first). */
        recent: (limit?: number) => recent(ref, limit),
        /** Mark episodes as consolidated (promoted to semantic memory). */
        markConsolidated: (episodeIds: string[]) => markConsolidated(ref, episodeIds),
      }
    },
  })
}

/** Episodic memory capability with default config (user-scoped, 200 max episodes). */
export const episodicMemoryCapability = createEpisodicMemoryCapability()

// ---------------------------------------------------------------------------
// Semantic Memory Capability
// ---------------------------------------------------------------------------

/** Config for semantic memory capability. */
export interface SemanticMemoryCapabilityConfig {
  /** Resource scope. Default: 'user'. */
  scope?: 'user' | 'project'
}

/** Input type for adding a new semantic fact via capability helpers. */
export type AddSemanticFactInput = Omit<
  SemanticFact,
  'id' | 'extractedAt' | 'lastReinforced' | 'reinforcementCount' | 'subject'
> & { subject?: string }

/**
 * Create a semantic memory capability.
 *
 * Declares `semanticMemory` resource in the configured scope and exposes
 * typed helpers via `ctx.cap.semanticMemory`.
 */
export function createSemanticMemoryCapability(config?: SemanticMemoryCapabilityConfig) {
  const scope = config?.scope ?? 'user'

  const resource = createSemanticMemoryResource(scope)

  return defineCapability({
    name: 'semanticMemory' as const,
    ...(scope === 'user'
      ? { userResources: { semanticMemory: resource } }
      : { projectResources: { semanticMemory: resource } }),
    fns: (ctx: any) => {
      const scopeCtx = scope === 'user' ? ctx.user : ctx.project
      const ref = scopeCtx?.resources?.semanticMemory as ResourceContext<SemanticMemoryState>
      return {
        /** Add a new semantic fact. */
        addFact: (fact: AddSemanticFactInput) => addFact(ref, fact),
        /** Update an existing fact's content. */
        updateFact: (factId: string, newContent: string, sourceEpisodeIds: string[], newConfidence?: number) =>
          updateFact(ref, factId, newContent, sourceEpisodeIds, newConfidence),
        /** Reinforce a fact — bump confidence and provenance. */
        reinforce: (factId: string, sourceEpisodeIds: string[], confidenceBoost?: number) =>
          reinforce(ref, factId, sourceEpisodeIds, confidenceBoost),
        /** Remove a fact by ID. */
        removeFact: (factId: string) => removeFact(ref, factId),
        /** Get all facts, sorted by reinforcement count. */
        allFacts: (subject?: string) => allFacts(ref, subject),
        /** Query facts by keyword relevance. */
        query: (q: string, limit?: number, subject?: string) => query(ref, q, limit, subject),
      }
    },
  })
}

/** Semantic memory capability with default config (user-scoped). */
export const semanticMemoryCapability = createSemanticMemoryCapability()
