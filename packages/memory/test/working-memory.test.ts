import { runForTest } from "@flow-state-dev/testing";
import { describe, it, expect } from 'vitest'
import type { ResourceHandle } from '@flow-state-dev/core'
import {
  workingMemoryEntrySchema,
  workingMemoryStateSchema,
  workingMemoryResource,
} from '../src/working-memory.js'
import type { WorkingMemoryEntry, WorkingMemoryState } from '../src/working-memory.js'
import {
  computeDecay,
  computeSalience,
  add,
  evict,
  pin,
  unpin,
  refresh,
  advance,
  items,
  formatForContext,
  formatForObserveContext,
  workingMemoryContextFormatter,
  DEFAULT_WORKING_MEMORY_CONFIG,
} from '../src/working-memory-helpers.js'
import {
  workingMemoryTick,
  workingMemorySnapshot,
  workingMemoryAdd,
  workingMemoryObserve,
  workingMemoryCapture,
  workingMemoryRemember,
} from '../src/working-memory-blocks.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createMockRef(
  initialState?: Partial<WorkingMemoryState>,
): ResourceHandle<WorkingMemoryState> {
  let state: WorkingMemoryState = {
    entries: [],
    currentTurn: 0,
    ...initialState,
  }

  return {
    name: 'workingMemory',
    scope: 'session',
    get state() { return state; },
    patchState: async (updates) => {
      state = { ...state, ...updates } as WorkingMemoryState
    },
    setState: async (next) => { state = next },
    updateState: async (fn) => { state = await fn(state) },
    readContent: async () => JSON.stringify(state),
    writeContent: async () => {},
    config: { stateSchema: workingMemoryStateSchema, writable: true },
  } as ResourceHandle<WorkingMemoryState>
}

function makeEntry(overrides: Partial<WorkingMemoryEntry> & { id: string }): WorkingMemoryEntry {
  return {
    content: `entry ${overrides.id}`,
    salience: 0.5,
    pinned: false,
    addedAtTurn: 0,
    lastAccessedAtTurn: 0,
    importance: 0.5,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

describe('memory/workingMemory', () => {
  describe('schemas', () => {
    it('workingMemoryEntrySchema validates a complete entry', () => {
      const entry = {
        id: 'e1',
        content: 'test',
        salience: 0.8,
        pinned: false,
        addedAtTurn: 0,
        lastAccessedAtTurn: 0,
        importance: 0.8,
      }
      expect(workingMemoryEntrySchema.safeParse(entry).success).toBe(true)
    })

    it('workingMemoryEntrySchema accepts optional metadata', () => {
      const entry = {
        id: 'e1',
        content: 'test',
        salience: 0.5,
        pinned: false,
        addedAtTurn: 0,
        lastAccessedAtTurn: 0,
        importance: 0.5,
        metadata: { source: 'user' },
      }
      expect(workingMemoryEntrySchema.safeParse(entry).success).toBe(true)
    })

    it('workingMemoryEntrySchema rejects missing required fields', () => {
      expect(workingMemoryEntrySchema.safeParse({ id: 'e1' }).success).toBe(false)
      expect(workingMemoryEntrySchema.safeParse({}).success).toBe(false)
    })

    it('workingMemoryEntrySchema rejects out-of-range salience', () => {
      const entry = {
        id: 'e1', content: 'test', salience: 1.5, pinned: false,
        addedAtTurn: 0, lastAccessedAtTurn: 0, importance: 0.5,
      }
      expect(workingMemoryEntrySchema.safeParse(entry).success).toBe(false)
    })

    it('workingMemoryStateSchema validates default empty state', () => {
      expect(workingMemoryStateSchema.safeParse({ entries: [], currentTurn: 0 }).success).toBe(true)
    })

    it('workingMemoryResource is a valid resource definition', () => {
      expect(workingMemoryResource.stateSchema).toBeDefined()
      expect(workingMemoryResource.writable).toBe(true)
      expect(workingMemoryResource.default).toEqual({ entries: [], currentTurn: 0 })
    })
  })

  // ---------------------------------------------------------------------------
  // computeDecay
  // ---------------------------------------------------------------------------

  describe('computeDecay', () => {
    it('power-law with known inputs', () => {
      // (1 + 0)^(-0.5) = 1
      expect(computeDecay(0, 'power-law', 0.5)).toBeCloseTo(1, 5)
      // (1 + 1)^(-0.5) ≈ 0.7071
      expect(computeDecay(1, 'power-law', 0.5)).toBeCloseTo(0.7071, 3)
      // (1 + 10)^(-0.5) ≈ 0.3015
      expect(computeDecay(10, 'power-law', 0.5)).toBeCloseTo(0.3015, 3)
    })

    it('exponential with known inputs', () => {
      // exp(-0.5 * 0) = 1
      expect(computeDecay(0, 'exponential', 0.5)).toBeCloseTo(1, 5)
      // exp(-0.5 * 1) ≈ 0.6065
      expect(computeDecay(1, 'exponential', 0.5)).toBeCloseTo(0.6065, 3)
      // exp(-0.5 * 5) ≈ 0.0821
      expect(computeDecay(5, 'exponential', 0.5)).toBeCloseTo(0.0821, 3)
    })

    it('none strategy always returns 1', () => {
      expect(computeDecay(0, 'none', 0.5)).toBe(1)
      expect(computeDecay(100, 'none', 0.5)).toBe(1)
    })

    it('clamps negative elapsed to 0', () => {
      expect(computeDecay(-5, 'power-law', 0.5)).toBeCloseTo(1, 5)
      expect(computeDecay(-10, 'exponential', 0.5)).toBeCloseTo(1, 5)
    })

    it('zero elapsed returns 1 for all strategies', () => {
      expect(computeDecay(0, 'power-law', 0.5)).toBe(1)
      expect(computeDecay(0, 'exponential', 0.5)).toBe(1)
      expect(computeDecay(0, 'none', 0.5)).toBe(1)
    })
  })

  // ---------------------------------------------------------------------------
  // computeSalience
  // ---------------------------------------------------------------------------

  describe('computeSalience', () => {
    it('combines importance and decay', () => {
      const entry = makeEntry({ id: 'e1', importance: 0.8, lastAccessedAtTurn: 0 })
      // currentTurn=1, elapsed=1: 0.8 * (1+1)^(-0.5) ≈ 0.8 * 0.7071 ≈ 0.5657
      const result = computeSalience(entry, 1, { strategy: 'power-law', rate: 0.5 })
      expect(result).toBeCloseTo(0.5657, 3)
    })

    it('returns importance when elapsed is 0', () => {
      const entry = makeEntry({ id: 'e1', importance: 0.9, lastAccessedAtTurn: 5 })
      const result = computeSalience(entry, 5, { strategy: 'power-law', rate: 0.5 })
      expect(result).toBeCloseTo(0.9, 5)
    })

    it('clamps result to [0, 1]', () => {
      // importance is already clamped by schema, but verify the function itself
      const entry = makeEntry({ id: 'e1', importance: 1.0, lastAccessedAtTurn: 0 })
      const result = computeSalience(entry, 0, { strategy: 'none', rate: 0 })
      expect(result).toBeLessThanOrEqual(1)
      expect(result).toBeGreaterThanOrEqual(0)
    })
  })

  // ---------------------------------------------------------------------------
  // Helper: add
  // ---------------------------------------------------------------------------

  describe('add()', () => {
    it('appends entry and returns it', async () => {
      const ref = createMockRef()
      const result = await add(ref, { content: 'hello', importance: 0.7 })

      expect(result.content).toBe('hello')
      expect(result.importance).toBe(0.7)
      expect(result.salience).toBe(0.7) // initial salience = importance
      expect(result.pinned).toBe(false)
      expect(result.addedAtTurn).toBe(0)
      expect((ref.state).entries).toHaveLength(1)
    })

    it('generates a short random id when not provided', async () => {
      const ref = createMockRef()
      const result = await add(ref, { content: 'test', importance: 0.5 })
      expect(result.id).toMatch(/^wm_[A-Za-z0-9]{4}$/)
    })

    it('uses provided id', async () => {
      const ref = createMockRef()
      const result = await add(ref, { id: 'custom-id', content: 'test', importance: 0.5 })
      expect(result.id).toBe('custom-id')
    })

    it('preserves metadata on added entry', async () => {
      const ref = createMockRef()
      const result = await add(ref, {
        content: 'test',
        importance: 0.5,
        metadata: { source: 'user', tags: ['important'] },
      })
      expect(result.metadata).toEqual({ source: 'user', tags: ['important'] })
      expect((ref.state).entries[0].metadata).toEqual({ source: 'user', tags: ['important'] })
    })

    it('evicts lowest-salience non-pinned entry at capacity', async () => {
      const ref = createMockRef({
        entries: [
          makeEntry({ id: 'low', salience: 0.1, importance: 0.1 }),
          makeEntry({ id: 'high', salience: 0.9, importance: 0.9 }),
        ],
      })

      await add(ref, { content: 'new', importance: 0.5 }, { capacity: 2 })

      expect((ref.state).entries).toHaveLength(2)
      const ids = (ref.state).entries.map((e) => e.id)
      expect(ids).not.toContain('low')
      expect(ids).toContain('high')
    })

    it('exceeds capacity when all entries are pinned', async () => {
      const ref = createMockRef({
        entries: [
          makeEntry({ id: 'p1', salience: 0.1, pinned: true }),
          makeEntry({ id: 'p2', salience: 0.2, pinned: true }),
        ],
      })

      await add(ref, { content: 'new', importance: 0.5 }, { capacity: 2 })

      expect((ref.state).entries).toHaveLength(3)
    })

    it('evicts first entry on salience tie (stable)', async () => {
      const ref = createMockRef({
        entries: [
          makeEntry({ id: 'first', salience: 0.3, importance: 0.3 }),
          makeEntry({ id: 'second', salience: 0.3, importance: 0.3 }),
        ],
      })

      await add(ref, { content: 'new', importance: 0.5 }, { capacity: 2 })

      const ids = (ref.state).entries.map((e) => e.id)
      expect(ids).not.toContain('first') // first in array is evicted
      expect(ids).toContain('second')
    })
  })

  // ---------------------------------------------------------------------------
  // Helper: evict
  // ---------------------------------------------------------------------------

  describe('evict()', () => {
    it('removes entry by id', async () => {
      const ref = createMockRef({
        entries: [makeEntry({ id: 'e1' }), makeEntry({ id: 'e2' })],
      })

      const result = await evict(ref, 'e1')

      expect(result).toBe(true)
      expect((ref.state).entries).toHaveLength(1)
      expect((ref.state).entries[0].id).toBe('e2')
    })

    it('removes pinned entry (overrides pin)', async () => {
      const ref = createMockRef({
        entries: [makeEntry({ id: 'pinned', pinned: true })],
      })

      const result = await evict(ref, 'pinned')

      expect(result).toBe(true)
      expect((ref.state).entries).toHaveLength(0)
    })

    it('returns false for non-existent id', async () => {
      const ref = createMockRef({ entries: [makeEntry({ id: 'e1' })] })
      const result = await evict(ref, 'missing')

      expect(result).toBe(false)
      expect((ref.state).entries).toHaveLength(1)
    })
  })

  // ---------------------------------------------------------------------------
  // Helper: pin / unpin
  // ---------------------------------------------------------------------------

  describe('pin()', () => {
    it('sets entry pinned to true', async () => {
      const ref = createMockRef({ entries: [makeEntry({ id: 'e1', pinned: false })] })
      const result = await pin(ref, 'e1')

      expect(result).toBe(true)
      expect((ref.state).entries[0].pinned).toBe(true)
    })

    it('returns true for already-pinned entry', async () => {
      const ref = createMockRef({ entries: [makeEntry({ id: 'e1', pinned: true })] })
      const result = await pin(ref, 'e1')
      expect(result).toBe(true)
    })

    it('returns false when maxPinnedSlots reached', async () => {
      const ref = createMockRef({
        entries: [
          makeEntry({ id: 'p1', pinned: true }),
          makeEntry({ id: 'p2', pinned: true }),
          makeEntry({ id: 'e3', pinned: false }),
        ],
      })

      const result = await pin(ref, 'e3', { maxPinnedSlots: 2 })
      expect(result).toBe(false)
      expect((ref.state).entries[2].pinned).toBe(false)
    })

    it('returns false for non-existent id', async () => {
      const ref = createMockRef()
      const result = await pin(ref, 'missing')
      expect(result).toBe(false)
    })
  })

  describe('unpin()', () => {
    it('sets entry pinned to false', async () => {
      const ref = createMockRef({ entries: [makeEntry({ id: 'e1', pinned: true })] })
      const result = await unpin(ref, 'e1')

      expect(result).toBe(true)
      expect((ref.state).entries[0].pinned).toBe(false)
    })

    it('returns true for already-unpinned entry', async () => {
      const ref = createMockRef({ entries: [makeEntry({ id: 'e1', pinned: false })] })
      const result = await unpin(ref, 'e1')
      expect(result).toBe(true)
    })

    it('returns false for non-existent id', async () => {
      const ref = createMockRef()
      const result = await unpin(ref, 'missing')
      expect(result).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // Helper: refresh
  // ---------------------------------------------------------------------------

  describe('refresh()', () => {
    it('updates lastAccessedAtTurn to current turn', async () => {
      const ref = createMockRef({
        currentTurn: 5,
        entries: [makeEntry({ id: 'e1', lastAccessedAtTurn: 0, importance: 0.8 })],
      })

      const result = await refresh(ref, 'e1')

      expect(result).toBe(true)
      expect((ref.state).entries[0].lastAccessedAtTurn).toBe(5)
      // salience should be recomputed: importance * decay(0) = 0.8 * 1.0
      expect((ref.state).entries[0].salience).toBeCloseTo(0.8, 3)
    })

    it('boosts salience of a decayed entry back to importance', async () => {
      // Entry was added at turn 0, decayed over 10 turns
      const entry = makeEntry({
        id: 'e1',
        importance: 0.8,
        lastAccessedAtTurn: 0,
        // salience after 10 turns: 0.8 * (1+10)^(-0.5) ≈ 0.241
        salience: 0.241,
      })
      const ref = createMockRef({ currentTurn: 10, entries: [entry] })

      await refresh(ref, 'e1')

      // After refresh: lastAccessedAtTurn = 10, elapsed = 0, salience = 0.8 * 1.0
      expect((ref.state).entries[0].lastAccessedAtTurn).toBe(10)
      expect((ref.state).entries[0].salience).toBeCloseTo(0.8, 3)
    })

    it('returns false for non-existent id (no-op)', async () => {
      const ref = createMockRef({ entries: [makeEntry({ id: 'e1' })] })
      const result = await refresh(ref, 'missing')
      expect(result).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // Helper: advance
  // ---------------------------------------------------------------------------

  describe('advance()', () => {
    it('increments currentTurn by 1', async () => {
      const ref = createMockRef({ currentTurn: 3 })
      await advance(ref)
      expect((ref.state).currentTurn).toBe(4)
    })

    it('recomputes salience for all entries', async () => {
      const ref = createMockRef({
        currentTurn: 0,
        entries: [
          makeEntry({ id: 'e1', importance: 1.0, lastAccessedAtTurn: 0, salience: 1.0 }),
        ],
      })

      await advance(ref)

      // After advance: currentTurn=1, elapsed=1, salience = 1.0 * (1+1)^(-0.5) ≈ 0.7071
      expect((ref.state).entries[0].salience).toBeCloseTo(0.7071, 3)
    })

    it('handles empty entries (increments turn only)', async () => {
      const ref = createMockRef({ currentTurn: 0 })
      await advance(ref)
      expect((ref.state).currentTurn).toBe(1)
      expect((ref.state).entries).toHaveLength(0)
    })

    it('cumulative decay over multiple advances', async () => {
      const ref = createMockRef({
        currentTurn: 0,
        entries: [
          makeEntry({ id: 'e1', importance: 0.8, lastAccessedAtTurn: 0, salience: 0.8 }),
        ],
      })

      // Advance 4 times
      await advance(ref)
      await advance(ref)
      await advance(ref)
      await advance(ref)

      expect((ref.state).currentTurn).toBe(4)
      // salience = 0.8 * (1+4)^(-0.5) = 0.8 * 5^(-0.5) ≈ 0.8 * 0.4472 ≈ 0.3578
      expect((ref.state).entries[0].salience).toBeCloseTo(0.3578, 3)
    })

    it('decayed entry eventually loses to newer entry at eviction', async () => {
      const ref = createMockRef({
        currentTurn: 0,
        entries: [
          makeEntry({ id: 'old', importance: 0.6, lastAccessedAtTurn: 0, salience: 0.6 }),
          makeEntry({ id: 'recent', importance: 0.6, lastAccessedAtTurn: 0, salience: 0.6 }),
        ],
      })

      // Advance 5 turns — both decay equally
      for (let i = 0; i < 5; i++) await advance(ref)

      // Refresh 'recent' so its salience recovers
      await refresh(ref, 'recent')

      // Now add a new entry at capacity 2 — old should be evicted
      await add(ref, { content: 'newcomer', importance: 0.5 }, { capacity: 2 })

      const ids = (ref.state).entries.map((e) => e.id)
      expect(ids).not.toContain('old')
      expect(ids).toContain('recent')
    })
  })

  // ---------------------------------------------------------------------------
  // Helper: items
  // ---------------------------------------------------------------------------

  describe('items()', () => {
    it('returns entries sorted by salience descending', async () => {
      const ref = createMockRef({
        entries: [
          makeEntry({ id: 'low', salience: 0.2 }),
          makeEntry({ id: 'high', salience: 0.9 }),
          makeEntry({ id: 'mid', salience: 0.5 }),
        ],
      })

      const result = await items(ref)
      expect(result.map((e) => e.id)).toEqual(['high', 'mid', 'low'])
    })

    it('preserves array order on salience tie (stable)', async () => {
      const ref = createMockRef({
        entries: [
          makeEntry({ id: 'first', salience: 0.5 }),
          makeEntry({ id: 'second', salience: 0.5 }),
          makeEntry({ id: 'third', salience: 0.5 }),
        ],
      })

      const result = await items(ref)
      expect(result.map((e) => e.id)).toEqual(['first', 'second', 'third'])
    })

    it('returns empty array for empty state', async () => {
      const ref = createMockRef()
      expect(await items(ref)).toEqual([])
    })
  })

  // ---------------------------------------------------------------------------
  // Helper: formatForContext
  // ---------------------------------------------------------------------------

  describe('formatForContext()', () => {
    it('returns bullet list with pin indicators, no scores or IDs', async () => {
      const ref = createMockRef({
        entries: [
          makeEntry({ id: 'e1', salience: 0.85, pinned: true, content: 'User prefers TypeScript' }),
          makeEntry({ id: 'e2', salience: 0.62, pinned: false, content: 'Refactoring auth module' }),
        ],
      })

      const result = await formatForContext(ref)
      expect(result).toContain('- (pinned) User prefers TypeScript')
      expect(result).toContain('- Refactoring auth module')
      // Salience scores and IDs are internal — not exposed to consuming LLMs
      expect(result).not.toContain('id=')
      expect(result).not.toContain('[0.')
    })

    it('returns empty string for no entries', async () => {
      const ref = createMockRef()
      expect(await formatForContext(ref)).toBe('')
    })
  })

  // ---------------------------------------------------------------------------
  // Helper: formatForObserveContext
  // ---------------------------------------------------------------------------

  describe('formatForObserveContext()', () => {
    it('includes entry IDs for the observe block LLM', async () => {
      const ref = createMockRef({
        entries: [
          makeEntry({ id: 'e1', salience: 0.85, pinned: true, content: 'User prefers TypeScript' }),
          makeEntry({ id: 'e2', salience: 0.62, pinned: false, content: 'Refactoring auth module' }),
        ],
      })

      const result = await formatForObserveContext(ref)
      expect(result).toContain('1. [id=e1] [0.85] (pinned) User prefers TypeScript')
      expect(result).toContain('2. [id=e2] [0.62] Refactoring auth module')
    })

    it('returns empty string for no entries', async () => {
      const ref = createMockRef()
      expect(await formatForObserveContext(ref)).toBe('')
    })
  })

  // ---------------------------------------------------------------------------
  // Helper: workingMemoryContextFormatter
  // ---------------------------------------------------------------------------

  describe('workingMemoryContextFormatter()', () => {
    it('returns formatted string with header when entries exist', async () => {
      const ref = createMockRef({
        entries: [
          makeEntry({ id: 'e1', salience: 0.85, content: 'User prefers TypeScript' }),
        ],
      })
      const ctx = { resources: { get: () => ref } } as any

      const result = await workingMemoryContextFormatter(undefined, ctx)
      expect(result).toContain('Active memories:')
      expect(result).toContain('User prefers TypeScript')
      expect(result).not.toContain('[0.')
    })

    it('returns empty string when no entries', async () => {
      const ref = createMockRef()
      const ctx = { resources: { get: () => ref } } as any

      const result = await workingMemoryContextFormatter(undefined, ctx)
      expect(result).toBe('')
    })
  })

  // ---------------------------------------------------------------------------
  // Defaults
  // ---------------------------------------------------------------------------

  describe('defaults', () => {
    it('DEFAULT_WORKING_MEMORY_CONFIG has expected values', () => {
      expect(DEFAULT_WORKING_MEMORY_CONFIG.capacity).toBe(7)
      expect(DEFAULT_WORKING_MEMORY_CONFIG.maxPinnedSlots).toBe(2)
      expect(DEFAULT_WORKING_MEMORY_CONFIG.decay.strategy).toBe('power-law')
      expect(DEFAULT_WORKING_MEMORY_CONFIG.decay.rate).toBe(0.5)
    })
  })

  // ---------------------------------------------------------------------------
  // Block shapes
  // ---------------------------------------------------------------------------

  describe('blocks', () => {
    describe('workingMemoryTick', () => {
      it('returns a handler BlockDefinition', () => {
        const block = workingMemoryTick()
        expect(block.kind).toBe('handler')
      })

      it('has correct name', () => {
        const block = workingMemoryTick()
        expect(block.name).toBe('workingMemory/tick')
      })

      it('declares workingMemory resource', () => {
        const block = workingMemoryTick()
        expect(block.declaredResources).toHaveProperty('workingMemory')
      })
    })

    describe('workingMemorySnapshot', () => {
      it('returns a handler BlockDefinition', () => {
        const block = workingMemorySnapshot()
        expect(block.kind).toBe('handler')
      })

      it('has correct name', () => {
        const block = workingMemorySnapshot()
        expect(block.name).toBe('workingMemory/snapshot')
      })

      it('declares workingMemory sessionResource', () => {
        const block = workingMemorySnapshot()
        expect(block.declaredResources).toHaveProperty('workingMemory')
      })
    })

    describe('workingMemoryAdd', () => {
      it('returns a handler BlockDefinition', () => {
        const block = workingMemoryAdd()
        expect(block.kind).toBe('handler')
      })

      it('has correct name', () => {
        const block = workingMemoryAdd()
        expect(block.name).toBe('workingMemory/add')
      })

      it('declares workingMemory sessionResource', () => {
        const block = workingMemoryAdd()
        expect(block.declaredResources).toHaveProperty('workingMemory')
      })
    })

    describe('workingMemoryRemember', () => {
      it('returns a handler BlockDefinition', () => {
        const block = workingMemoryRemember()
        expect(block.kind).toBe('handler')
      })

      it('has correct name', () => {
        const block = workingMemoryRemember()
        expect(block.name).toBe('workingMemory/remember')
      })

      it('declares workingMemory sessionResource', () => {
        const block = workingMemoryRemember()
        expect(block.declaredResources).toHaveProperty('workingMemory')
      })
    })

    describe('workingMemoryObserve', () => {
      it('returns a generator BlockDefinition', () => {
        const block = workingMemoryObserve()
        expect(block.kind).toBe('generator')
      })

      it('has correct name', () => {
        const block = workingMemoryObserve()
        expect(block.name).toBe('workingMemory/observe')
      })

      it('accepts custom name', () => {
        const block = workingMemoryObserve({ name: 'custom-observe' })
        expect(block.name).toBe('custom-observe')
      })

      it('declares workingMemory sessionResource', () => {
        const block = workingMemoryObserve()
        expect(block.declaredResources).toHaveProperty('workingMemory')
      })

      it('has no onCompleted hook (persistence moved to remember block)', () => {
        const block = workingMemoryObserve()
        expect((block.config as any).onCompleted).toBeUndefined()
      })
    })

    describe('workingMemoryCapture', () => {
      it('returns a sequencer BlockDefinition', () => {
        const block = workingMemoryCapture()
        expect(block.kind).toBe('sequencer')
      })

      it('has correct name', () => {
        const block = workingMemoryCapture()
        expect(block.name).toBe('workingMemory/capture')
      })

      it('accepts custom name', () => {
        const block = workingMemoryCapture({ name: 'custom-capture' })
        expect(block.name).toBe('custom-capture')
      })

      it('inherits sessionResources from child blocks', () => {
        const block = workingMemoryCapture()
        expect(block.declaredResources).toHaveProperty('workingMemory')
      })
    })
  })

  // ---------------------------------------------------------------------------
  // Remember block: persistence behavior
  // ---------------------------------------------------------------------------

  describe('workingMemoryRemember (persistence)', () => {
    // We can test the remember block's execute function directly by extracting
    // it from the block definition. The block accepts observations as input
    // and persists them to the mock resource.

    async function runRemember(
      ref: ResourceHandle<WorkingMemoryState>,
      observations: Array<{ content: string; importance: number; pinned?: boolean; replaces?: string }>,
      config?: { capacity?: number; maxPinnedSlots?: number },
    ) {
      const block = workingMemoryRemember(config)
      const ctx = {
        resources: { get: () => ref },
        response: { emit: async () => {} },
      } as any
      // The schema uses .default() for pinned and replaces, so Zod applies
      // defaults during input validation — no manual normalization needed.
      return runForTest(block, { observations } as any, ctx)
    }

    it('persists observations as entries', async () => {
      const ref = createMockRef()
      const result = await runRemember(ref, [
        { content: 'User wants REST API', importance: 0.8 },
        { content: 'Using TypeScript', importance: 0.6 },
      ])

      expect(result).toHaveLength(2)
      expect((ref.state).entries).toHaveLength(2)
      expect((ref.state).entries[0].content).toBe('User wants REST API')
      expect((ref.state).entries[1].content).toBe('Using TypeScript')
    })

    it('handles replaces by evicting old entry before adding', async () => {
      const ref = createMockRef({
        entries: [makeEntry({ id: 'old-goal', content: 'Build a CLI tool' })],
      })

      await runRemember(ref, [
        { content: 'Build a REST API', importance: 0.8, replaces: 'old-goal' },
      ])

      expect((ref.state).entries).toHaveLength(1)
      expect((ref.state).entries[0].content).toBe('Build a REST API')
    })

    it('ignores replaces for non-existent IDs (no-op eviction)', async () => {
      const ref = createMockRef()

      await runRemember(ref, [
        { content: 'New memory', importance: 0.5, replaces: 'nonexistent' },
      ])

      expect((ref.state).entries).toHaveLength(1)
      expect((ref.state).entries[0].content).toBe('New memory')
    })

    it('handles empty observations array', async () => {
      const ref = createMockRef()
      const result = await runRemember(ref, [])

      expect(result).toHaveLength(0)
      expect((ref.state).entries).toHaveLength(0)
    })

    it('respects pinned flag from observations', async () => {
      const ref = createMockRef()

      await runRemember(ref, [
        { content: 'Critical goal', importance: 0.9, pinned: true },
      ])

      expect((ref.state).entries[0].pinned).toBe(true)
    })

    it('defaults pinned to false when not specified', async () => {
      const ref = createMockRef()

      await runRemember(ref, [
        { content: 'Regular fact', importance: 0.5 },
      ])

      expect((ref.state).entries[0].pinned).toBe(false)
    })

    it('respects capacity config for eviction', async () => {
      const ref = createMockRef({
        entries: [
          makeEntry({ id: 'low', salience: 0.1, importance: 0.1 }),
          makeEntry({ id: 'high', salience: 0.9, importance: 0.9 }),
        ],
      })

      await runRemember(ref, [
        { content: 'New memory', importance: 0.5 },
      ], { capacity: 2 })

      expect((ref.state).entries).toHaveLength(2)
      const ids = (ref.state).entries.map((e) => e.id)
      expect(ids).not.toContain('low')
      expect(ids).toContain('high')
    })
  })
})
