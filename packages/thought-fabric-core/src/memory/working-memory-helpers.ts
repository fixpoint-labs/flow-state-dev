/**
 * Working memory helper functions.
 *
 * Pure operations on a ResourceRef<WorkingMemoryState>. These accept a ref
 * and config, keeping the logic independent of block context so it can be
 * used from any handler, generator, or standalone code.
 */

import type { ResourceRef } from '@flow-state-dev/core/types'
import type { WorkingMemoryEntry, WorkingMemoryState } from './working-memory.js'

export interface DecayConfig {
  strategy: 'power-law' | 'exponential' | 'none'
  rate: number
}

export interface WorkingMemoryHelperConfig {
  capacity: number
  maxPinnedSlots: number
  decay: DecayConfig
}

export const DEFAULT_HELPER_CONFIG: WorkingMemoryHelperConfig = {
  capacity: 7,
  maxPinnedSlots: 2,
  decay: { strategy: 'power-law', rate: 0.5 }
}

/** Returns a decay factor in [0, 1] based on elapsed turns. */
export function computeDecay(
  elapsed: number,
  strategy: DecayConfig['strategy'],
  rate: number
): number {
  const clamped = Math.max(0, elapsed)

  if (strategy === 'none') return 1
  if (strategy === 'exponential') return Math.exp(-rate * clamped)

  // power-law: ACT-R style — (1 + elapsed)^(-rate)
  return Math.pow(1 + clamped, -rate)
}

/** Computes current salience as importance × decay(elapsed). */
export function computeSalience(
  entry: WorkingMemoryEntry,
  currentTurn: number,
  decay: DecayConfig
): number {
  const elapsed = currentTurn - entry.lastAccessedAtTurn
  const factor = computeDecay(elapsed, decay.strategy, decay.rate)
  return Math.max(0, Math.min(1, entry.importance * factor))
}

function resolveConfig(partial?: Partial<WorkingMemoryHelperConfig>): WorkingMemoryHelperConfig {
  return {
    capacity: partial?.capacity ?? DEFAULT_HELPER_CONFIG.capacity,
    maxPinnedSlots: partial?.maxPinnedSlots ?? DEFAULT_HELPER_CONFIG.maxPinnedSlots,
    decay: partial?.decay ?? DEFAULT_HELPER_CONFIG.decay
  }
}

/**
 * Finds the lowest-salience unpinned entry. On ties, picks the first in
 * array order (stable, deterministic).
 */
function findEvictionCandidate(entries: WorkingMemoryEntry[]): WorkingMemoryEntry | undefined {
  let candidate: WorkingMemoryEntry | undefined
  for (const entry of entries) {
    if (entry.pinned) continue
    if (!candidate || entry.salience < candidate.salience) {
      candidate = entry
    }
  }
  return candidate
}

export interface AddEntryInput {
  id: string
  content: string
  importance?: number
  pinned?: boolean
  metadata?: Record<string, unknown>
}

/**
 * Inserts an entry into working memory. When capacity is exceeded, evicts
 * the lowest-salience unpinned entry. Returns the evicted entry if any.
 */
export async function add(
  ref: ResourceRef<WorkingMemoryState>,
  entry: AddEntryInput,
  config?: Partial<WorkingMemoryHelperConfig>
): Promise<{ evicted?: WorkingMemoryEntry }> {
  const resolved = resolveConfig(config)
  let evicted: WorkingMemoryEntry | undefined

  await ref.updateState((state) => {
    const newEntry: WorkingMemoryEntry = {
      id: entry.id,
      content: entry.content,
      salience: entry.importance ?? 0.5,
      pinned: entry.pinned ?? false,
      addedAtTurn: state.currentTurn,
      lastAccessedAtTurn: state.currentTurn,
      importance: entry.importance ?? 0.5,
      metadata: entry.metadata
    }

    let existing = state.entries

    if (existing.length >= resolved.capacity) {
      const candidate = findEvictionCandidate(existing)
      if (candidate) {
        evicted = candidate
        existing = existing.filter((e) => e.id !== candidate.id)
      }
    }

    return { ...state, entries: [...existing, newEntry] }
  })

  return { evicted }
}

/** Removes an entry by ID. Explicit eviction overrides pin status. */
export async function evict(
  ref: ResourceRef<WorkingMemoryState>,
  entryId: string
): Promise<WorkingMemoryEntry | undefined> {
  let removed: WorkingMemoryEntry | undefined

  await ref.updateState((state) => {
    const idx = state.entries.findIndex((e) => e.id === entryId)
    if (idx === -1) return state

    removed = state.entries[idx]
    return {
      ...state,
      entries: state.entries.filter((_, i) => i !== idx)
    }
  })

  return removed
}

/**
 * Protects an entry from automatic eviction. Returns false if
 * maxPinnedSlots is already reached.
 */
export async function pin(
  ref: ResourceRef<WorkingMemoryState>,
  entryId: string,
  config?: Partial<WorkingMemoryHelperConfig>
): Promise<boolean> {
  const resolved = resolveConfig(config)
  let success = false

  await ref.updateState((state) => {
    const entry = state.entries.find((e) => e.id === entryId)
    if (!entry) return state
    if (entry.pinned) {
      success = true
      return state
    }

    const pinnedCount = state.entries.filter((e) => e.pinned).length
    if (pinnedCount >= resolved.maxPinnedSlots) {
      success = false
      return state
    }

    success = true
    return {
      ...state,
      entries: state.entries.map((e) =>
        e.id === entryId ? { ...e, pinned: true } : e
      )
    }
  })

  return success
}

/** Removes pin protection from an entry. */
export async function unpin(
  ref: ResourceRef<WorkingMemoryState>,
  entryId: string
): Promise<void> {
  await ref.updateState((state) => ({
    ...state,
    entries: state.entries.map((e) =>
      e.id === entryId ? { ...e, pinned: false } : e
    )
  }))
}

/** Resets lastAccessedAtTurn to the current turn and recomputes salience. */
export async function refresh(
  ref: ResourceRef<WorkingMemoryState>,
  entryId: string,
  config?: Partial<WorkingMemoryHelperConfig>
): Promise<void> {
  const resolved = resolveConfig(config)

  await ref.updateState((state) => {
    const entry = state.entries.find((e) => e.id === entryId)
    if (!entry) return state

    return {
      ...state,
      entries: state.entries.map((e) => {
        if (e.id !== entryId) return e
        const refreshed = { ...e, lastAccessedAtTurn: state.currentTurn }
        return {
          ...refreshed,
          salience: computeSalience(refreshed, state.currentTurn, resolved.decay)
        }
      })
    }
  })
}

/** Advances the turn counter and recomputes salience for all entries. */
export async function tick(
  ref: ResourceRef<WorkingMemoryState>,
  config?: Partial<WorkingMemoryHelperConfig>
): Promise<void> {
  const resolved = resolveConfig(config)

  await ref.updateState((state) => {
    const nextTurn = state.currentTurn + 1
    return {
      currentTurn: nextTurn,
      entries: state.entries.map((e) => ({
        ...e,
        salience: computeSalience(e, nextTurn, resolved.decay)
      }))
    }
  })
}

/** Returns current entries sorted by salience descending (synchronous read). */
export function items(
  ref: ResourceRef<WorkingMemoryState>
): WorkingMemoryEntry[] {
  return [...ref.state.entries].sort((a, b) => b.salience - a.salience)
}

/**
 * Formats current working memory entries into a string suitable for LLM
 * system context. Returns empty string if no entries exist.
 */
export function formatForContext(
  ref: ResourceRef<WorkingMemoryState>
): string {
  const sorted = items(ref)
  if (sorted.length === 0) return ''

  const lines = sorted.map((entry, i) => {
    const pin = entry.pinned ? ' [pinned]' : ''
    return `${i + 1}. ${entry.content} (salience: ${entry.salience.toFixed(2)}${pin})`
  })

  return `Working Memory:\n${lines.join('\n')}`
}
