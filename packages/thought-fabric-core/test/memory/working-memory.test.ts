import { describe, it, expect } from 'vitest'
import type { ResourceRef } from '@flow-state-dev/core/types'
import {
  workingMemoryEntrySchema,
  workingMemoryStateSchema,
  workingMemoryResource,
  type WorkingMemoryEntry,
  type WorkingMemoryState
} from '../../src/memory/working-memory.js'
import {
  computeDecay,
  computeSalience,
  add,
  evict,
  pin,
  unpin,
  refresh,
  tick,
  items,
  formatForContext,
  DEFAULT_HELPER_CONFIG,
  type WorkingMemoryHelperConfig
} from '../../src/memory/working-memory-helpers.js'
import {
  workingMemoryTick,
  workingMemorySnapshot,
  workingMemoryAdd,
  workingMemoryObserve,
  workingMemoryCapture
} from '../../src/memory/working-memory-blocks.js'

// ---------- Mock ResourceRef ----------

function createMockRef(
  initialState: WorkingMemoryState = { entries: [], currentTurn: 0 }
): ResourceRef<WorkingMemoryState> {
  let state = structuredClone(initialState)
  return {
    name: 'workingMemory',
    scope: 'session' as const,
    get state() {
      return state
    },
    patchState: async (updates: Partial<WorkingMemoryState>) => {
      state = { ...state, ...updates }
    },
    setState: async (next: WorkingMemoryState) => {
      state = next
    },
    updateState: async (fn: (s: WorkingMemoryState) => WorkingMemoryState | Promise<WorkingMemoryState>) => {
      state = await fn(state)
    },
    readContent: async () => JSON.stringify(state),
    readContentRaw: async () => JSON.stringify(state),
    writeContent: async () => {},
    config: { stateSchema: workingMemoryStateSchema, writable: true }
  } as ResourceRef<WorkingMemoryState>
}

function makeEntry(overrides: Partial<WorkingMemoryEntry> & { id: string; content: string }): WorkingMemoryEntry {
  return {
    salience: 0.5,
    pinned: false,
    addedAtTurn: 0,
    lastAccessedAtTurn: 0,
    importance: 0.5,
    ...overrides
  }
}

// ===== Schema Validation =====

describe('schemas', () => {
  it('validates a well-formed entry', () => {
    const result = workingMemoryEntrySchema.safeParse({
      id: 'e1',
      content: 'User prefers TypeScript',
      salience: 0.8,
      pinned: false,
      addedAtTurn: 0,
      lastAccessedAtTurn: 0,
      importance: 0.7
    })
    expect(result.success).toBe(true)
  })

  it('rejects entry with salience out of range', () => {
    const result = workingMemoryEntrySchema.safeParse({
      id: 'e1',
      content: 'test',
      salience: 1.5,
      pinned: false,
      addedAtTurn: 0,
      lastAccessedAtTurn: 0,
      importance: 0.5
    })
    expect(result.success).toBe(false)
  })

  it('applies defaults for optional fields', () => {
    const result = workingMemoryEntrySchema.parse({
      id: 'e1',
      content: 'test',
      salience: 0.5,
      addedAtTurn: 0,
      lastAccessedAtTurn: 0
    })
    expect(result.pinned).toBe(false)
    expect(result.importance).toBe(0.5)
  })

  it('validates a well-formed state', () => {
    const result = workingMemoryStateSchema.safeParse({
      entries: [],
      currentTurn: 0
    })
    expect(result.success).toBe(true)
  })

  it('applies default currentTurn', () => {
    const result = workingMemoryStateSchema.parse({ entries: [] })
    expect(result.currentTurn).toBe(0)
  })
})

// ===== Resource Definition =====

describe('workingMemoryResource', () => {
  it('has stateSchema and default', () => {
    expect(workingMemoryResource.stateSchema).toBe(workingMemoryStateSchema)
    expect(workingMemoryResource.default).toEqual({ entries: [], currentTurn: 0 })
    expect(workingMemoryResource.writable).toBe(true)
  })
})

// ===== computeDecay =====

describe('computeDecay', () => {
  it('returns 1 for strategy "none"', () => {
    expect(computeDecay(10, 'none', 0.5)).toBe(1)
  })

  it('returns 1 for elapsed = 0 with power-law', () => {
    expect(computeDecay(0, 'power-law', 0.5)).toBe(1)
  })

  it('returns 1 for elapsed = 0 with exponential', () => {
    expect(computeDecay(0, 'exponential', 0.2)).toBe(1)
  })

  it('computes correct power-law decay for known values', () => {
    // (1 + 4)^(-0.5) = 5^(-0.5) ≈ 0.4472
    const result = computeDecay(4, 'power-law', 0.5)
    expect(result).toBeCloseTo(0.4472, 3)
  })

  it('computes correct exponential decay for known values', () => {
    // exp(-0.2 * 5) = exp(-1) ≈ 0.3679
    const result = computeDecay(5, 'exponential', 0.2)
    expect(result).toBeCloseTo(0.3679, 3)
  })

  it('clamps negative elapsed to 0', () => {
    expect(computeDecay(-5, 'power-law', 0.5)).toBe(1)
    expect(computeDecay(-5, 'exponential', 0.2)).toBe(1)
  })

  it('decays more steeply with higher rate (power-law)', () => {
    const low = computeDecay(3, 'power-law', 0.3)
    const high = computeDecay(3, 'power-law', 0.8)
    expect(high).toBeLessThan(low)
  })
})

// ===== computeSalience =====

describe('computeSalience', () => {
  it('returns importance when elapsed is 0', () => {
    const entry = makeEntry({ id: 'e1', content: 'x', importance: 0.9, lastAccessedAtTurn: 5 })
    const result = computeSalience(entry, 5, { strategy: 'power-law', rate: 0.5 })
    expect(result).toBeCloseTo(0.9, 5)
  })

  it('decays salience over turns', () => {
    const entry = makeEntry({ id: 'e1', content: 'x', importance: 0.8, lastAccessedAtTurn: 0 })
    const at0 = computeSalience(entry, 0, { strategy: 'power-law', rate: 0.5 })
    const at5 = computeSalience(entry, 5, { strategy: 'power-law', rate: 0.5 })
    expect(at5).toBeLessThan(at0)
  })

  it('clamps result to [0, 1]', () => {
    const entry = makeEntry({ id: 'e1', content: 'x', importance: 1.0, lastAccessedAtTurn: 0 })
    const result = computeSalience(entry, 0, { strategy: 'none', rate: 0 })
    expect(result).toBeLessThanOrEqual(1)
    expect(result).toBeGreaterThanOrEqual(0)
  })

  it('returns 0 for importance=0 regardless of decay', () => {
    const entry = makeEntry({ id: 'e1', content: 'x', importance: 0, lastAccessedAtTurn: 0 })
    const result = computeSalience(entry, 0, { strategy: 'none', rate: 0 })
    expect(result).toBe(0)
  })
})

// ===== add =====

describe('add', () => {
  it('adds an entry to empty memory', async () => {
    const ref = createMockRef()
    await add(ref, { id: 'e1', content: 'hello' })

    expect(ref.state.entries).toHaveLength(1)
    expect(ref.state.entries[0].id).toBe('e1')
    expect(ref.state.entries[0].content).toBe('hello')
  })

  it('sets default importance and salience to 0.5', async () => {
    const ref = createMockRef()
    await add(ref, { id: 'e1', content: 'hello' })

    expect(ref.state.entries[0].importance).toBe(0.5)
    expect(ref.state.entries[0].salience).toBe(0.5)
  })

  it('uses provided importance for salience', async () => {
    const ref = createMockRef()
    await add(ref, { id: 'e1', content: 'goal', importance: 0.9 })

    expect(ref.state.entries[0].importance).toBe(0.9)
    expect(ref.state.entries[0].salience).toBe(0.9)
  })

  it('evicts lowest-salience entry when at capacity', async () => {
    const ref = createMockRef({
      currentTurn: 0,
      entries: [
        makeEntry({ id: 'e1', content: 'a', salience: 0.3 }),
        makeEntry({ id: 'e2', content: 'b', salience: 0.8 })
      ]
    })

    const result = await add(ref, { id: 'e3', content: 'c', importance: 0.7 }, { capacity: 2 })

    expect(ref.state.entries).toHaveLength(2)
    expect(result.evicted?.id).toBe('e1')
    expect(ref.state.entries.find((e) => e.id === 'e1')).toBeUndefined()
    expect(ref.state.entries.find((e) => e.id === 'e3')).toBeDefined()
  })

  it('does not evict pinned entries', async () => {
    const ref = createMockRef({
      currentTurn: 0,
      entries: [
        makeEntry({ id: 'e1', content: 'a', salience: 0.1, pinned: true }),
        makeEntry({ id: 'e2', content: 'b', salience: 0.8 })
      ]
    })

    const result = await add(ref, { id: 'e3', content: 'c', importance: 0.5 }, { capacity: 2 })

    expect(result.evicted?.id).toBe('e2')
    expect(ref.state.entries.find((e) => e.id === 'e1')).toBeDefined()
  })

  it('exceeds capacity when all entries are pinned', async () => {
    const ref = createMockRef({
      currentTurn: 0,
      entries: [
        makeEntry({ id: 'e1', content: 'a', salience: 0.1, pinned: true }),
        makeEntry({ id: 'e2', content: 'b', salience: 0.2, pinned: true })
      ]
    })

    const result = await add(ref, { id: 'e3', content: 'c', importance: 0.5 }, { capacity: 2 })

    expect(ref.state.entries).toHaveLength(3)
    expect(result.evicted).toBeUndefined()
  })

  it('sets addedAtTurn and lastAccessedAtTurn to currentTurn', async () => {
    const ref = createMockRef({ entries: [], currentTurn: 5 })
    await add(ref, { id: 'e1', content: 'test' })

    expect(ref.state.entries[0].addedAtTurn).toBe(5)
    expect(ref.state.entries[0].lastAccessedAtTurn).toBe(5)
  })

  it('picks first entry in array on identical salience (deterministic)', async () => {
    const ref = createMockRef({
      currentTurn: 0,
      entries: [
        makeEntry({ id: 'first', content: 'a', salience: 0.5 }),
        makeEntry({ id: 'second', content: 'b', salience: 0.5 })
      ]
    })

    const result = await add(ref, { id: 'e3', content: 'c', importance: 0.9 }, { capacity: 2 })

    expect(result.evicted?.id).toBe('first')
  })
})

// ===== evict =====

describe('evict', () => {
  it('removes entry by ID', async () => {
    const ref = createMockRef({
      currentTurn: 0,
      entries: [
        makeEntry({ id: 'e1', content: 'a' }),
        makeEntry({ id: 'e2', content: 'b' })
      ]
    })

    const removed = await evict(ref, 'e1')

    expect(removed?.id).toBe('e1')
    expect(ref.state.entries).toHaveLength(1)
    expect(ref.state.entries[0].id).toBe('e2')
  })

  it('removes pinned entries (explicit eviction overrides pin)', async () => {
    const ref = createMockRef({
      currentTurn: 0,
      entries: [makeEntry({ id: 'e1', content: 'a', pinned: true })]
    })

    const removed = await evict(ref, 'e1')

    expect(removed?.id).toBe('e1')
    expect(ref.state.entries).toHaveLength(0)
  })

  it('returns undefined for non-existent ID', async () => {
    const ref = createMockRef({
      currentTurn: 0,
      entries: [makeEntry({ id: 'e1', content: 'a' })]
    })

    const removed = await evict(ref, 'not-here')

    expect(removed).toBeUndefined()
    expect(ref.state.entries).toHaveLength(1)
  })
})

// ===== pin =====

describe('pin', () => {
  it('pins an entry', async () => {
    const ref = createMockRef({
      currentTurn: 0,
      entries: [makeEntry({ id: 'e1', content: 'a' })]
    })

    const result = await pin(ref, 'e1')

    expect(result).toBe(true)
    expect(ref.state.entries[0].pinned).toBe(true)
  })

  it('returns false when maxPinnedSlots is reached', async () => {
    const ref = createMockRef({
      currentTurn: 0,
      entries: [
        makeEntry({ id: 'e1', content: 'a', pinned: true }),
        makeEntry({ id: 'e2', content: 'b', pinned: true }),
        makeEntry({ id: 'e3', content: 'c' })
      ]
    })

    const result = await pin(ref, 'e3', { maxPinnedSlots: 2 })

    expect(result).toBe(false)
    expect(ref.state.entries[2].pinned).toBe(false)
  })

  it('returns true if entry is already pinned', async () => {
    const ref = createMockRef({
      currentTurn: 0,
      entries: [makeEntry({ id: 'e1', content: 'a', pinned: true })]
    })

    const result = await pin(ref, 'e1')

    expect(result).toBe(true)
  })

  it('no-ops for non-existent entry', async () => {
    const ref = createMockRef({ currentTurn: 0, entries: [] })
    const result = await pin(ref, 'not-here')
    expect(result).toBe(false) // entry not found, updateState returns early but success stays false
  })
})

// ===== unpin =====

describe('unpin', () => {
  it('unpins a pinned entry', async () => {
    const ref = createMockRef({
      currentTurn: 0,
      entries: [makeEntry({ id: 'e1', content: 'a', pinned: true })]
    })

    await unpin(ref, 'e1')

    expect(ref.state.entries[0].pinned).toBe(false)
  })

  it('no-ops on already unpinned entry', async () => {
    const ref = createMockRef({
      currentTurn: 0,
      entries: [makeEntry({ id: 'e1', content: 'a', pinned: false })]
    })

    await unpin(ref, 'e1')

    expect(ref.state.entries[0].pinned).toBe(false)
  })
})

// ===== refresh =====

describe('refresh', () => {
  it('resets lastAccessedAtTurn to currentTurn', async () => {
    const ref = createMockRef({
      currentTurn: 10,
      entries: [makeEntry({ id: 'e1', content: 'a', lastAccessedAtTurn: 2, importance: 0.8 })]
    })

    await refresh(ref, 'e1')

    expect(ref.state.entries[0].lastAccessedAtTurn).toBe(10)
  })

  it('recomputes salience after refresh', async () => {
    const ref = createMockRef({
      currentTurn: 10,
      entries: [
        makeEntry({ id: 'e1', content: 'a', lastAccessedAtTurn: 2, importance: 0.8, salience: 0.2 })
      ]
    })

    await refresh(ref, 'e1')

    // elapsed is now 0, so salience = importance * 1.0 = 0.8
    expect(ref.state.entries[0].salience).toBeCloseTo(0.8, 5)
  })

  it('no-ops for non-existent entry', async () => {
    const ref = createMockRef({ currentTurn: 5, entries: [] })
    await refresh(ref, 'not-here')
    expect(ref.state.entries).toHaveLength(0)
  })
})

// ===== tick =====

describe('tick', () => {
  it('increments currentTurn', async () => {
    const ref = createMockRef({ entries: [], currentTurn: 3 })
    await tick(ref)
    expect(ref.state.currentTurn).toBe(4)
  })

  it('recomputes salience for all entries', async () => {
    const ref = createMockRef({
      currentTurn: 0,
      entries: [
        makeEntry({ id: 'e1', content: 'a', importance: 0.8, lastAccessedAtTurn: 0, salience: 0.8 }),
        makeEntry({ id: 'e2', content: 'b', importance: 0.4, lastAccessedAtTurn: 0, salience: 0.4 })
      ]
    })

    await tick(ref)

    // After tick, currentTurn = 1, elapsed = 1
    // power-law: (1+1)^(-0.5) = 2^(-0.5) ≈ 0.7071
    // e1 salience: 0.8 * 0.7071 ≈ 0.5657
    // e2 salience: 0.4 * 0.7071 ≈ 0.2828
    expect(ref.state.entries[0].salience).toBeCloseTo(0.5657, 3)
    expect(ref.state.entries[1].salience).toBeCloseTo(0.2828, 3)
  })

  it('handles empty entries', async () => {
    const ref = createMockRef({ entries: [], currentTurn: 0 })
    await tick(ref)
    expect(ref.state.currentTurn).toBe(1)
    expect(ref.state.entries).toHaveLength(0)
  })

  it('uses provided decay config', async () => {
    const ref = createMockRef({
      currentTurn: 0,
      entries: [
        makeEntry({ id: 'e1', content: 'a', importance: 1.0, lastAccessedAtTurn: 0, salience: 1.0 })
      ]
    })

    await tick(ref, { decay: { strategy: 'exponential', rate: 0.5 } })

    // exp(-0.5 * 1) ≈ 0.6065
    expect(ref.state.entries[0].salience).toBeCloseTo(0.6065, 3)
  })
})

// ===== items =====

describe('items', () => {
  it('returns entries sorted by salience descending', () => {
    const ref = createMockRef({
      currentTurn: 0,
      entries: [
        makeEntry({ id: 'e1', content: 'low', salience: 0.2 }),
        makeEntry({ id: 'e2', content: 'high', salience: 0.9 }),
        makeEntry({ id: 'e3', content: 'mid', salience: 0.5 })
      ]
    })

    const sorted = items(ref)

    expect(sorted[0].id).toBe('e2')
    expect(sorted[1].id).toBe('e3')
    expect(sorted[2].id).toBe('e1')
  })

  it('returns empty array for empty memory', () => {
    const ref = createMockRef()
    expect(items(ref)).toEqual([])
  })

  it('does not mutate the original entries array', () => {
    const ref = createMockRef({
      currentTurn: 0,
      entries: [
        makeEntry({ id: 'e1', content: 'a', salience: 0.3 }),
        makeEntry({ id: 'e2', content: 'b', salience: 0.7 })
      ]
    })

    items(ref)

    expect(ref.state.entries[0].id).toBe('e1')
  })
})

// ===== formatForContext =====

describe('formatForContext', () => {
  it('returns empty string for empty memory', () => {
    const ref = createMockRef()
    expect(formatForContext(ref)).toBe('')
  })

  it('formats entries with salience and pin status', () => {
    const ref = createMockRef({
      currentTurn: 0,
      entries: [
        makeEntry({ id: 'e1', content: 'User goal: build a dashboard', salience: 0.9, pinned: true }),
        makeEntry({ id: 'e2', content: 'Prefers dark mode', salience: 0.5 })
      ]
    })

    const result = formatForContext(ref)

    expect(result).toContain('Working Memory:')
    expect(result).toContain('User goal: build a dashboard')
    expect(result).toContain('[pinned]')
    expect(result).toContain('Prefers dark mode')
    expect(result).toContain('0.90')
    expect(result).toContain('0.50')
  })

  it('orders by salience descending', () => {
    const ref = createMockRef({
      currentTurn: 0,
      entries: [
        makeEntry({ id: 'e1', content: 'low', salience: 0.2 }),
        makeEntry({ id: 'e2', content: 'high', salience: 0.9 })
      ]
    })

    const result = formatForContext(ref)
    const highIdx = result.indexOf('high')
    const lowIdx = result.indexOf('low')
    expect(highIdx).toBeLessThan(lowIdx)
  })
})

// ===== DEFAULT_HELPER_CONFIG =====

describe('DEFAULT_HELPER_CONFIG', () => {
  it('has capacity 7', () => {
    expect(DEFAULT_HELPER_CONFIG.capacity).toBe(7)
  })

  it('has maxPinnedSlots 2', () => {
    expect(DEFAULT_HELPER_CONFIG.maxPinnedSlots).toBe(2)
  })

  it('uses power-law decay with rate 0.5', () => {
    expect(DEFAULT_HELPER_CONFIG.decay.strategy).toBe('power-law')
    expect(DEFAULT_HELPER_CONFIG.decay.rate).toBe(0.5)
  })
})

// ===== Composable Blocks =====

describe('workingMemoryTick block', () => {
  it('returns a handler BlockDefinition', () => {
    const block = workingMemoryTick()
    expect(block.kind).toBe('handler')
    expect(block.name).toBe('wm-tick')
  })

  it('declares sessionResources with workingMemory', () => {
    const block = workingMemoryTick()
    const declared = (block as any).declaredResources
    expect(declared?.session?.workingMemory).toBe(workingMemoryResource)
  })
})

describe('workingMemorySnapshot block', () => {
  it('returns a handler BlockDefinition', () => {
    const block = workingMemorySnapshot()
    expect(block.kind).toBe('handler')
    expect(block.name).toBe('wm-snapshot')
  })

  it('declares sessionResources with workingMemory', () => {
    const block = workingMemorySnapshot()
    const declared = (block as any).declaredResources
    expect(declared?.session?.workingMemory).toBe(workingMemoryResource)
  })
})

describe('workingMemoryAdd block', () => {
  it('returns a handler BlockDefinition', () => {
    const block = workingMemoryAdd()
    expect(block.kind).toBe('handler')
    expect(block.name).toBe('wm-add')
  })

  it('declares sessionResources with workingMemory', () => {
    const block = workingMemoryAdd()
    const declared = (block as any).declaredResources
    expect(declared?.session?.workingMemory).toBe(workingMemoryResource)
  })
})

describe('workingMemoryObserve block', () => {
  it('returns a sequencer BlockDefinition', () => {
    const block = workingMemoryObserve({ model: 'gpt-5-mini' })
    expect(block.kind).toBe('sequencer')
    expect(block.name).toBe('wm-observe')
  })

  it('declares sessionResources with workingMemory (via child block bubbling)', () => {
    const block = workingMemoryObserve({ model: 'gpt-5-mini' })
    const declared = (block as any).declaredResources
    expect(declared?.session?.workingMemory).toBe(workingMemoryResource)
  })
})

describe('workingMemoryCapture block', () => {
  it('returns a sequencer BlockDefinition', () => {
    const block = workingMemoryCapture({ model: 'gpt-5-mini' })
    expect(block.kind).toBe('sequencer')
    expect(block.name).toBe('wm-capture')
  })

  it('declares sessionResources with workingMemory (via child block bubbling)', () => {
    const block = workingMemoryCapture({ model: 'gpt-5-mini' })
    const declared = (block as any).declaredResources
    expect(declared?.session?.workingMemory).toBe(workingMemoryResource)
  })
})

// ===== Integration: multi-step helper workflows =====

describe('integration: multi-turn workflow', () => {
  it('supports add → tick → eviction lifecycle', async () => {
    const ref = createMockRef()
    const cfg: Partial<WorkingMemoryHelperConfig> = { capacity: 3 }

    await add(ref, { id: 'e1', content: 'first', importance: 0.9 }, cfg)
    await add(ref, { id: 'e2', content: 'second', importance: 0.5 }, cfg)
    await add(ref, { id: 'e3', content: 'third', importance: 0.7 }, cfg)

    expect(ref.state.entries).toHaveLength(3)

    // Tick advances time, reducing salience
    await tick(ref)
    await tick(ref)

    // Add a 4th entry — should evict the lowest-salience (e2, started at 0.5)
    const result = await add(ref, { id: 'e4', content: 'fourth', importance: 0.8 }, cfg)

    expect(ref.state.entries).toHaveLength(3)
    expect(result.evicted?.id).toBe('e2')
  })

  it('pin protects from eviction, unpin exposes', async () => {
    const ref = createMockRef()
    const cfg: Partial<WorkingMemoryHelperConfig> = { capacity: 2, maxPinnedSlots: 1 }

    await add(ref, { id: 'e1', content: 'pinned', importance: 0.3 }, cfg)
    await add(ref, { id: 'e2', content: 'normal', importance: 0.8 }, cfg)

    await pin(ref, 'e1', cfg)

    // Add third — e2 should be evicted (e1 is pinned despite lower salience)
    // Wait, e1 has salience 0.3, e2 has 0.8. e1 is pinned. So the eviction candidate is e2? No. After pin, e1 is protected. The new entry has salience 0.5 (default). We add e3 at capacity 2, so we need to evict. Candidates are unpinned: e2. But e2 has salience 0.8, which is higher than e3's 0.5. Wait — we add e3, making 3 entries. We need to evict one unpinned. The unpinned are e2 and e3. e3 has salience 0.5, e2 has 0.8. So e3 would be evicted.
    // Actually, the new entry was just added, so it's in the array. The eviction candidate is the lowest-salience unpinned. e3 (0.5) < e2 (0.8). So e3 gets evicted — the one we just added!

    // Let's make e3 have higher importance to avoid this issue
    const result = await add(ref, { id: 'e3', content: 'new', importance: 0.9 }, cfg)

    // Unpinned entries: e2 (0.8), e3 (0.9). Lowest is e2.
    expect(result.evicted?.id).toBe('e2')
    expect(ref.state.entries.find((e) => e.id === 'e1')).toBeDefined()

    // Unpin e1, tick to decay it, then add another
    await unpin(ref, 'e1')
    await tick(ref)
    await tick(ref)
    await tick(ref)

    const result2 = await add(ref, { id: 'e4', content: 'newer', importance: 0.9 }, cfg)

    // e1 had low importance (0.3) and decayed further. Should be evicted.
    expect(result2.evicted?.id).toBe('e1')
  })

  it('refresh boosts salience and prevents eviction', async () => {
    const ref = createMockRef()
    const cfg: Partial<WorkingMemoryHelperConfig> = { capacity: 2 }

    await add(ref, { id: 'e1', content: 'referenced', importance: 0.5 }, cfg)
    await add(ref, { id: 'e2', content: 'stale', importance: 0.5 }, cfg)

    // Several ticks of decay
    for (let i = 0; i < 5; i++) await tick(ref)

    // Refresh e1 — resets its lastAccessedAtTurn, boosting salience
    await refresh(ref, 'e1')

    // Now add e3 — e2 should be evicted (stale), not e1 (refreshed)
    const result = await add(ref, { id: 'e3', content: 'new', importance: 0.5 }, cfg)

    expect(result.evicted?.id).toBe('e2')
  })
})

// ===== Edge cases from spec =====

describe('edge cases', () => {
  it('refresh non-existent entry is a no-op', async () => {
    const ref = createMockRef({ entries: [], currentTurn: 3 })
    await refresh(ref, 'ghost')
    expect(ref.state.entries).toHaveLength(0)
  })

  it('tick with no entries only increments turn', async () => {
    const ref = createMockRef({ entries: [], currentTurn: 0 })
    await tick(ref)
    expect(ref.state.currentTurn).toBe(1)
    expect(ref.state.entries).toEqual([])
  })

  it('evict non-existent entry returns undefined', async () => {
    const ref = createMockRef({
      currentTurn: 0,
      entries: [makeEntry({ id: 'e1', content: 'a' })]
    })
    const removed = await evict(ref, 'ghost')
    expect(removed).toBeUndefined()
    expect(ref.state.entries).toHaveLength(1)
  })
})
