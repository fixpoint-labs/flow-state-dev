import type { ResourceContext } from '@flow-state-dev/core'
import type { DecayStrategy, WorkingMemoryEntry, WorkingMemoryState } from './working-memory.js'
import { shortId } from '../helpers.js'

/** Decay configuration for working memory salience computation. */
export interface WorkingMemoryDecayConfig {
  strategy: DecayStrategy
  rate: number
}

/** Configuration for working memory helper operations. */
export interface WorkingMemoryHelperConfig {
  /** Maximum number of entries. Default: 7 (Miller's number). */
  capacity?: number
  /** Maximum pinned slots. Default: 2. */
  maxPinnedSlots?: number
  /** Decay configuration. Default: power-law with rate 0.5. */
  decay?: Partial<WorkingMemoryDecayConfig>
}

/** Default configuration values. */
export const DEFAULT_WORKING_MEMORY_CONFIG = {
  capacity: 7,
  maxPinnedSlots: 2,
  decay: { strategy: 'power-law' as const, rate: 0.5 },
} as const

function resolveConfig(config?: WorkingMemoryHelperConfig) {
  return {
    capacity: config?.capacity ?? DEFAULT_WORKING_MEMORY_CONFIG.capacity,
    maxPinnedSlots: config?.maxPinnedSlots ?? DEFAULT_WORKING_MEMORY_CONFIG.maxPinnedSlots,
    decay: {
      strategy: config?.decay?.strategy ?? DEFAULT_WORKING_MEMORY_CONFIG.decay.strategy,
      rate: config?.decay?.rate ?? DEFAULT_WORKING_MEMORY_CONFIG.decay.rate,
    },
  }
}

// ---------------------------------------------------------------------------
// Pure math
// ---------------------------------------------------------------------------

/**
 * Compute the decay factor for a given elapsed turn count.
 *
 * - `power-law`: ACT-R activation decay — `(1 + elapsed)^(-rate)`.
 *   With default rate 0.5 this gives fast initial decay with a long tail.
 * - `exponential`: `exp(-rate × elapsed)`.
 * - `none`: always returns 1 (no decay).
 *
 * Negative elapsed values are clamped to 0.
 */
export function computeDecay(elapsed: number, strategy: DecayStrategy, rate: number): number {
  const t = Math.max(0, elapsed)

  switch (strategy) {
    case 'none':
      return 1
    case 'exponential':
      return Math.exp(-rate * t)
    case 'power-law':
      return Math.pow(1 + t, -rate)
  }
}

/**
 * Compute the current salience of an entry: `importance × decay(elapsed)`.
 * Result is clamped to [0, 1].
 */
export function computeSalience(
  entry: WorkingMemoryEntry,
  currentTurn: number,
  decay: WorkingMemoryDecayConfig,
): number {
  const elapsed = currentTurn - entry.lastAccessedAtTurn
  const factor = computeDecay(elapsed, decay.strategy, decay.rate)
  return Math.min(1, Math.max(0, entry.importance * factor))
}

// ---------------------------------------------------------------------------
// Resource operations
// ---------------------------------------------------------------------------

type WmRef = ResourceContext<WorkingMemoryState>

/** Input for adding an entry. ID is auto-generated if omitted. */
export type AddEntryInput = {
  id?: string
  content: string
  importance: number
  pinned?: boolean
  durability?: 'transient' | 'session' | 'persistent' | 'permanent'
  category?: 'identity' | 'event' | 'preference' | 'task' | 'relationship' | 'profession' | 'belief' | 'attribute' | 'pattern'
  metadata?: Record<string, any>
}


/**
 * Add an entry to working memory.
 *
 * If the number of entries reaches capacity, the lowest-salience non-pinned
 * entry is evicted. If all entries are pinned, the new entry is added anyway
 * (exceeding capacity).
 *
 * Returns the fully-formed entry that was added.
 */
export async function add(
  ref: WmRef,
  entry: AddEntryInput,
  config?: WorkingMemoryHelperConfig,
): Promise<WorkingMemoryEntry> {
  const resolved = resolveConfig(config)
  const state = ref.state

  const newEntry: WorkingMemoryEntry = {
    id: entry.id ?? `wm_${shortId()}`,
    content: entry.content,
    importance: entry.importance,
    salience: entry.importance, // initial salience = importance (no decay yet)
    pinned: entry.pinned ?? false,
    addedAtTurn: state.currentTurn,
    lastAccessedAtTurn: state.currentTurn,
    durability: entry.durability ?? 'session',
    category: entry.category ?? 'identity',
    metadata: entry.metadata,
  }

  await ref.updateState((s: WorkingMemoryState) => {
    const entries = [...s.entries]

    // Evict lowest-salience non-pinned entry if at capacity
    if (entries.length >= resolved.capacity) {
      let lowestIdx = -1
      let lowestSalience = Infinity

      for (let i = 0; i < entries.length; i++) {
        if (!entries[i].pinned && entries[i].salience < lowestSalience) {
          lowestSalience = entries[i].salience
          lowestIdx = i
        }
      }

      if (lowestIdx >= 0) {
        entries.splice(lowestIdx, 1)
      }
      // If all pinned, add anyway (exceed capacity per spec)
    }

    entries.push(newEntry)
    return { ...s, entries }
  })

  return newEntry
}

/**
 * Remove an entry by ID. Explicit eviction overrides pin status.
 * Returns true if the entry was found and removed, false otherwise.
 */
export async function evict(ref: WmRef, id: string): Promise<boolean> {
  let found = false

  await ref.updateState((s: WorkingMemoryState) => {
    const idx = s.entries.findIndex((e) => e.id === id)
    if (idx < 0) return s

    found = true
    const entries = [...s.entries]
    entries.splice(idx, 1)
    return { ...s, entries }
  })

  return found
}

/**
 * Pin an entry to protect it from automatic eviction.
 * Returns false if the entry doesn't exist or if maxPinnedSlots is reached.
 */
export async function pin(
  ref: WmRef,
  id: string,
  config?: WorkingMemoryHelperConfig,
): Promise<boolean> {
  const resolved = resolveConfig(config)
  let success = false

  await ref.updateState((s: WorkingMemoryState) => {
    const idx = s.entries.findIndex((e) => e.id === id)
    if (idx < 0) return s

    const entry = s.entries[idx]
    if (entry.pinned) {
      success = true
      return s // already pinned
    }

    const pinnedCount = s.entries.filter((e) => e.pinned).length
    if (pinnedCount >= resolved.maxPinnedSlots) return s

    success = true
    const entries = [...s.entries]
    entries[idx] = { ...entry, pinned: true }
    return { ...s, entries }
  })

  return success
}

/**
 * Remove pin protection from an entry.
 * Returns true if the entry was found (regardless of prior pin state), false if not found.
 */
export async function unpin(ref: WmRef, id: string): Promise<boolean> {
  let found = false

  await ref.updateState((s: WorkingMemoryState) => {
    const idx = s.entries.findIndex((e) => e.id === id)
    if (idx < 0) return s

    found = true
    const entry = s.entries[idx]
    if (!entry.pinned) return s

    const entries = [...s.entries]
    entries[idx] = { ...entry, pinned: false }
    return { ...s, entries }
  })

  return found
}

/**
 * Refresh an entry: reset its lastAccessedAtTurn to the current turn and
 * recompute its salience. Models the "access boost" in memory theory.
 * Returns true if the entry was found, false otherwise (no-op for missing IDs).
 */
export async function refresh(
  ref: WmRef,
  id: string,
  config?: WorkingMemoryHelperConfig,
): Promise<boolean> {
  const resolved = resolveConfig(config)
  let found = false

  await ref.updateState((s: WorkingMemoryState) => {
    const idx = s.entries.findIndex((e) => e.id === id)
    if (idx < 0) return s

    found = true
    const entries = [...s.entries]
    const entry = { ...entries[idx], lastAccessedAtTurn: s.currentTurn }
    entry.salience = computeSalience(entry, s.currentTurn, resolved.decay)
    entries[idx] = entry
    return { ...s, entries }
  })

  return found
}

/**
 * Advance the turn counter by 1 and recompute salience for all entries.
 * This is the "clock" for decay — call it once per interaction turn.
 */
export async function advance(
  ref: WmRef,
  config?: WorkingMemoryHelperConfig,
): Promise<void> {
  const resolved = resolveConfig(config)

  await ref.updateState((s: WorkingMemoryState) => {
    const newTurn = s.currentTurn + 1
    const entries = s.entries.map((entry) => ({
      ...entry,
      salience: computeSalience(entry, newTurn, resolved.decay),
    }))
    return { entries, currentTurn: newTurn }
  })
}

/**
 * Get current working memory entries sorted by salience descending.
 * Synchronous read — returns a snapshot of the current state.
 * Ties are broken by array position (stable sort).
 */
export function items(ref: WmRef): WorkingMemoryEntry[] {
  return [...ref.state.entries].sort((a, b) => b.salience - a.salience)
}

/**
 * Format current working memory entries as a numbered list for LLM context.
 * Returns empty string if there are no entries.
 *
 * Format: `- (pinned) The user prefers TypeScript`
 *
 * Entries are ordered by salience (most relevant first). Salience scores are
 * intentionally omitted — they're an internal eviction mechanism, not a
 * confidence signal, and risk being over-interpreted by the consuming LLM.
 *
 * Use this when injecting memory into a generator's `context:` slot.
 * For a ready-made slot function, see {@link workingMemoryContextFormatter}.
 */
export function formatForContext(ref: WmRef): string {
  const sorted = items(ref)
  if (sorted.length === 0) return ''

  return sorted
    .map((entry) => {
      const pin = entry.pinned ? '(pinned) ' : ''
      return `- ${pin}${entry.content}`
    })
    .join('\n')
}

/**
 * Format entries with IDs exposed, for the observe block's LLM context.
 *
 * Format: `1. [id=wm_123_1] [0.85] (pinned) The user prefers TypeScript`
 *
 * The observe block's prompt instructs the LLM to return `replaces: ID` when
 * a new observation supersedes an existing entry. This format gives the LLM
 * the actual entry IDs it needs to reference.
 *
 * @internal Used by `workingMemoryObserve`. Not intended for external use.
 */
export function formatForObserveContext(ref: WmRef): string {
  const sorted = items(ref)
  if (sorted.length === 0) return ''

  return sorted
    .map((entry, i) => {
      const pin = entry.pinned ? ' (pinned)' : ''
      return `${i + 1}. [id=${entry.id}] [${entry.salience.toFixed(2)}]${pin} ${entry.content}`
    })
    .join('\n')
}

/**
 * Ready-made `context:` slot for generators that need working memory.
 *
 * Reads the `workingMemory` resource (session-scoped via its intrinsic
 * `defineResource({ scope: 'session' })` declaration) and formats it as a
 * bullet list. Assign to the generator's `context` array. The generator
 * must declare `resources: { workingMemory: workingMemoryResource }` under
 * the unified resource map (FIX-435).
 *
 * ```ts
 * const chat = generator({
 *   name: 'chat',
 *   model: 'gpt-5',
 *   inputSchema: z.string(),
 *   resources: { workingMemory: workingMemoryResource },
 *   context: [workingMemoryContextFormatter],
 *   user: (input) => input,
 * })
 * ```
 *
 * Note: the `ctx` parameter uses an inline structural type rather than
 * importing `BlockContext` because `BlockContext` is not part of
 * `@flow-state-dev/core`'s public API. The structural type matches the
 * subset of BlockContext that this function actually uses.
 */
export function workingMemoryContextFormatter(_input: unknown, ctx: { resources: { get(name: 'workingMemory'): WmRef } }): string {
  const ref = ctx.resources.get('workingMemory')
  const formatted = formatForContext(ref)
  return formatted ? `Active memories:\n${formatted}` : ''
}
