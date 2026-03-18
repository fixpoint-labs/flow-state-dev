import { describe, it, expect } from 'vitest'
import type { ResourceHandle } from '@flow-state-dev/core'
import {
  workingMemoryStateSchema,
} from '../../src/memory/working-memory.js'
import type { WorkingMemoryState } from '../../src/memory/working-memory.js'
import {
  episodicMemoryStateSchema,
} from '../../src/memory/episodic-memory.js'
import type { EpisodicMemoryState, Episode } from '../../src/memory/episodic-memory.js'
import {
  memorySystemStateSchema,
  memorySystemResource,
  system,
} from '../../src/memory/memory-system.js'
import type { MemorySystemState } from '../../src/memory/memory-system.js'
import {
  memorySystemObserve,
  memorySystemReflect,
  memorySystemTick,
  memorySystemCapture,
} from '../../src/memory/memory-system-blocks.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createMockWmRef(
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
    get state() { return state },
    patchState: async (updates) => { state = { ...state, ...updates } as WorkingMemoryState },
    setState: async (next) => { state = next },
    updateState: async (fn) => { state = await fn(state) },
    readContent: async () => JSON.stringify(state),
    writeContent: async () => {},
    config: { stateSchema: workingMemoryStateSchema, writable: true },
  } as ResourceHandle<WorkingMemoryState>
}

function createMockSysRef(
  initialState?: Partial<MemorySystemState>,
): ResourceHandle<MemorySystemState> {
  let state: MemorySystemState = {
    lastProcessedIndex: -1,
    episodicWritesSinceLastConsolidation: 0,
    evictedPersistentSinceLastConsolidation: 0,
    lastConsolidationTurn: 0,
    ...initialState,
  }

  return {
    name: 'memorySystem',
    scope: 'session',
    get state() { return state },
    patchState: async (updates) => { state = { ...state, ...updates } as MemorySystemState },
    setState: async (next) => { state = next },
    updateState: async (fn) => { state = await fn(state) },
    readContent: async () => JSON.stringify(state),
    writeContent: async () => {},
    config: { stateSchema: memorySystemStateSchema, writable: true },
  } as ResourceHandle<MemorySystemState>
}

function createMockEpRef(
  initialState?: Partial<EpisodicMemoryState>,
): ResourceHandle<EpisodicMemoryState> {
  let state: EpisodicMemoryState = {
    episodes: [],
    totalEncoded: 0,
    ...initialState,
  }

  return {
    name: 'episodicMemory',
    scope: 'user',
    get state() { return state },
    patchState: async (updates) => { state = { ...state, ...updates } as EpisodicMemoryState },
    setState: async (next) => { state = next },
    updateState: async (fn) => { state = await fn(state) },
    readContent: async () => JSON.stringify(state),
    writeContent: async () => {},
    config: { stateSchema: episodicMemoryStateSchema, writable: true },
  } as ResourceHandle<EpisodicMemoryState>
}

function makeEpisode(overrides: Partial<Episode> & { id: string }): Episode {
  return {
    content: `episode ${overrides.id}`,
    occurredAtTurn: 0,
    encodedAt: new Date().toISOString(),
    significance: 0.7,
    category: 'fact',
    context: { sessionId: 'test-session' },
    consolidated: false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Memory System Resource
// ---------------------------------------------------------------------------

describe('memory/memorySystem', () => {
  describe('memorySystemResource', () => {
    it('has valid schema and defaults', () => {
      expect(memorySystemResource.stateSchema).toBeDefined()
      expect(memorySystemResource.writable).toBe(true)
      expect(memorySystemResource.default).toEqual({
        lastProcessedIndex: -1,
        episodicWritesSinceLastConsolidation: 0,
        evictedPersistentSinceLastConsolidation: 0,
        lastConsolidationTurn: 0,
      })
    })

    it('validates state schema', () => {
      const valid = memorySystemStateSchema.safeParse({
        lastProcessedIndex: 5,
        episodicWritesSinceLastConsolidation: 2,
        evictedPersistentSinceLastConsolidation: 1,
        lastConsolidationTurn: 3,
      })
      expect(valid.success).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // system() factory
  // ---------------------------------------------------------------------------

  describe('system() factory', () => {
    it('returns all expected properties with working only', () => {
      const mem = system({
        model: 'gpt-5-mini',
        working: { capacity: 7 },
      })

      expect(mem.capture).toBeDefined()
      expect(mem.recall).toBeTypeOf('function')
      expect(mem.contextFormatter).toBeTypeOf('function')
      expect(mem.working).toBeDefined()
      expect(mem.working.resource).toBeDefined()
      expect(mem.working.helpers).toBeDefined()
      expect(mem.episodic).toBeUndefined()
    })

    it('returns episodic module when configured', () => {
      const mem = system({
        model: 'gpt-5-mini',
        working: { capacity: 7 },
        episodic: true,
      })

      expect(mem.episodic).toBeDefined()
      expect(mem.episodic!.resource).toBeDefined()
      expect(mem.episodic!.helpers).toBeDefined()
      expect(mem.episodic!.helpers.encode).toBeTypeOf('function')
      expect(mem.episodic!.helpers.recent).toBeTypeOf('function')
      expect(mem.episodic!.helpers.markConsolidated).toBeTypeOf('function')
    })

    it('accepts working: true for defaults', () => {
      const mem = system({
        model: 'gpt-5-mini',
        working: true,
      })

      expect(mem.capture).toBeDefined()
      expect(mem.working.resource).toBeDefined()
    })

    it('accepts episodic: true for defaults', () => {
      const mem = system({
        model: 'gpt-5-mini',
        working: true,
        episodic: true,
      })

      expect(mem.episodic).toBeDefined()
    })

    it('accepts custom episodic config', () => {
      const mem = system({
        model: 'gpt-5-mini',
        working: true,
        episodic: {
          scope: 'project',
          significanceThreshold: 0.7,
          maxEpisodes: 100,
        },
      })

      expect(mem.episodic).toBeDefined()
    })

    it('exposes all working memory helpers', () => {
      const mem = system({ model: 'gpt-5-mini', working: true })
      const h = mem.working.helpers

      expect(h.add).toBeTypeOf('function')
      expect(h.evict).toBeTypeOf('function')
      expect(h.pin).toBeTypeOf('function')
      expect(h.unpin).toBeTypeOf('function')
      expect(h.refresh).toBeTypeOf('function')
      expect(h.tick).toBeTypeOf('function')
      expect(h.items).toBeTypeOf('function')
      expect(h.computeDecay).toBeTypeOf('function')
      expect(h.computeSalience).toBeTypeOf('function')
    })
  })

  // ---------------------------------------------------------------------------
  // Block shapes
  // ---------------------------------------------------------------------------

  describe('blocks', () => {
    const baseConfig = {
      model: 'gpt-5-mini',
      working: { capacity: 7, maxPinnedSlots: 2, decay: { strategy: 'power-law' as const, rate: 0.5 } },
    }

    describe('memorySystemObserve', () => {
      it('returns a generator BlockDefinition', () => {
        const block = memorySystemObserve(baseConfig)
        expect(block.kind).toBe('generator')
      })

      it('has correct default name', () => {
        const block = memorySystemObserve(baseConfig)
        expect(block.name).toBe('tf.memory/observe')
      })

      it('accepts custom name prefix', () => {
        const block = memorySystemObserve({ ...baseConfig, name: 'custom' })
        expect(block.name).toBe('custom/observe')
      })

      it('declares session resources', () => {
        const block = memorySystemObserve(baseConfig)
        expect(block.declaredResources?.session).toHaveProperty('workingMemory')
        expect(block.declaredResources?.session).toHaveProperty('memorySystem')
      })

      it('declares user resources when episodic scope is user', () => {
        const block = memorySystemObserve({
          ...baseConfig,
          episodic: { scope: 'user', significanceThreshold: 0.6, maxEpisodes: 200 },
        })
        expect(block.declaredResources?.user).toHaveProperty('episodicMemory')
      })

      it('declares project resources when episodic scope is project', () => {
        const block = memorySystemObserve({
          ...baseConfig,
          episodic: { scope: 'project', significanceThreshold: 0.6, maxEpisodes: 200 },
        })
        expect(block.declaredResources?.project).toHaveProperty('episodicMemory')
      })
    })

    describe('memorySystemReflect', () => {
      it('returns a handler BlockDefinition', () => {
        const block = memorySystemReflect(baseConfig)
        expect(block.kind).toBe('handler')
      })

      it('has correct default name', () => {
        const block = memorySystemReflect(baseConfig)
        expect(block.name).toBe('tf.memory/reflect')
      })

      it('declares session resources', () => {
        const block = memorySystemReflect(baseConfig)
        expect(block.declaredResources?.session).toHaveProperty('workingMemory')
        expect(block.declaredResources?.session).toHaveProperty('memorySystem')
      })
    })

    describe('memorySystemTick', () => {
      it('returns a handler BlockDefinition', () => {
        const block = memorySystemTick(baseConfig)
        expect(block.kind).toBe('handler')
      })

      it('has correct default name', () => {
        const block = memorySystemTick(baseConfig)
        expect(block.name).toBe('tf.memory/tick')
      })

      it('declares session resources', () => {
        const block = memorySystemTick(baseConfig)
        expect(block.declaredResources?.session).toHaveProperty('workingMemory')
        expect(block.declaredResources?.session).toHaveProperty('memorySystem')
      })
    })

    describe('memorySystemCapture', () => {
      it('returns a sequencer BlockDefinition', () => {
        const block = memorySystemCapture(baseConfig)
        expect(block.kind).toBe('sequencer')
      })

      it('has correct default name', () => {
        const block = memorySystemCapture(baseConfig)
        expect(block.name).toBe('tf.memory/capture')
      })

      it('accepts custom name', () => {
        const block = memorySystemCapture({ ...baseConfig, name: 'my-capture' })
        expect(block.name).toBe('my-capture')
      })

      it('inherits session resources from child blocks', () => {
        const block = memorySystemCapture(baseConfig)
        expect(block.declaredResources?.session).toHaveProperty('workingMemory')
        expect(block.declaredResources?.session).toHaveProperty('memorySystem')
      })
    })
  })

  // ---------------------------------------------------------------------------
  // recall()
  // ---------------------------------------------------------------------------

  describe('recall()', () => {
    it('returns working memory items sorted by salience', () => {
      const wmRef = createMockWmRef({
        entries: [
          { id: 'e1', content: 'Low priority', salience: 0.3, pinned: false, addedAtTurn: 0, lastAccessedAtTurn: 0, importance: 0.3, category: 'fact', durability: 'session' },
          { id: 'e2', content: 'High priority', salience: 0.9, pinned: false, addedAtTurn: 0, lastAccessedAtTurn: 0, importance: 0.9, category: 'task', durability: 'session' },
        ],
      })

      const mem = system({ model: 'gpt-5-mini', working: true })
      const ctx = {
        session: { resources: { get: (name: string) => name === 'workingMemory' ? wmRef : undefined } },
      }

      const result = mem.recall(ctx)
      expect(result).toHaveLength(2)
      expect(result[0].content).toBe('High priority')
      expect(result[0].source).toBe('working')
      expect(result[1].content).toBe('Low priority')
    })

    it('returns empty array when no memories', () => {
      const wmRef = createMockWmRef()
      const mem = system({ model: 'gpt-5-mini', working: true })
      const ctx = {
        session: { resources: { get: () => wmRef } },
      }

      const result = mem.recall(ctx)
      expect(result).toEqual([])
    })

    it('includes episodic items when episodic is configured', () => {
      const wmRef = createMockWmRef()
      const epRef = createMockEpRef({
        episodes: [
          makeEpisode({ id: 'ep1', content: 'User likes React', occurredAtTurn: 5, significance: 0.8, category: 'preference' }),
        ],
      })

      const mem = system({ model: 'gpt-5-mini', working: true, episodic: true })
      const ctx = {
        session: { resources: { get: () => wmRef } },
        user: { resources: { get: () => epRef } },
      }

      const result = mem.recall(ctx)
      expect(result).toHaveLength(1)
      expect(result[0].source).toBe('episodic')
      expect(result[0].content).toBe('User likes React')
    })

    it('deduplicates WM over episodic when content overlaps', () => {
      const wmRef = createMockWmRef({
        entries: [
          { id: 'e1', content: 'User prefers TypeScript', salience: 0.8, pinned: false, addedAtTurn: 0, lastAccessedAtTurn: 0, importance: 0.8, category: 'preference', durability: 'persistent' },
        ],
      })
      const epRef = createMockEpRef({
        episodes: [
          makeEpisode({ id: 'ep1', content: 'User prefers TypeScript', occurredAtTurn: 3, significance: 0.7, category: 'preference' }),
        ],
      })

      const mem = system({ model: 'gpt-5-mini', working: true, episodic: true })
      const ctx = {
        session: { resources: { get: () => wmRef } },
        user: { resources: { get: () => epRef } },
      }

      const result = mem.recall(ctx)
      // Should only have WM version, episodic deduped
      expect(result).toHaveLength(1)
      expect(result[0].source).toBe('working')
    })

    it('boosts items matching cue', () => {
      const wmRef = createMockWmRef({
        entries: [
          { id: 'e1', content: 'User likes React', salience: 0.5, pinned: false, addedAtTurn: 0, lastAccessedAtTurn: 0, importance: 0.5, category: 'preference', durability: 'session' },
          { id: 'e2', content: 'Working on backend', salience: 0.6, pinned: false, addedAtTurn: 0, lastAccessedAtTurn: 0, importance: 0.6, category: 'task', durability: 'session' },
        ],
      })

      const mem = system({ model: 'gpt-5-mini', working: true })
      const ctx = {
        session: { resources: { get: () => wmRef } },
      }

      const withCue = mem.recall(ctx, 'React')
      const reactItem = withCue.find((i) => i.content === 'User likes React')!
      expect(reactItem.relevance).toBeGreaterThan(0.5) // boosted
    })
  })

  // ---------------------------------------------------------------------------
  // contextFormatter()
  // ---------------------------------------------------------------------------

  describe('contextFormatter()', () => {
    it('returns categorized sections when memories exist', () => {
      const wmRef = createMockWmRef({
        entries: [
          { id: 'e1', content: 'User name is Jake', salience: 0.9, pinned: true, addedAtTurn: 0, lastAccessedAtTurn: 0, importance: 0.9, category: 'fact', durability: 'permanent' },
          { id: 'e2', content: 'Debugging React crash', salience: 0.7, pinned: false, addedAtTurn: 0, lastAccessedAtTurn: 0, importance: 0.7, category: 'task', durability: 'session' },
          { id: 'e3', content: 'Prefers dark mode', salience: 0.6, pinned: false, addedAtTurn: 0, lastAccessedAtTurn: 0, importance: 0.6, category: 'preference', durability: 'persistent' },
        ],
      })

      const mem = system({ model: 'gpt-5-mini', working: true })
      const ctx = {
        session: { resources: { get: () => wmRef } },
      }

      const result = mem.contextFormatter(undefined, ctx)
      expect(result).toContain('Known facts:')
      expect(result).toContain('- User name is Jake')
      expect(result).toContain('Current focus:')
      expect(result).toContain('- Debugging React crash')
      expect(result).toContain('User preferences:')
      expect(result).toContain('- Prefers dark mode')
    })

    it('returns empty string when no memories', () => {
      const wmRef = createMockWmRef()
      const mem = system({ model: 'gpt-5-mini', working: true })
      const ctx = {
        session: { resources: { get: () => wmRef } },
      }

      const result = mem.contextFormatter(undefined, ctx)
      expect(result).toBe('')
    })

    it('omits empty sections', () => {
      const wmRef = createMockWmRef({
        entries: [
          { id: 'e1', content: 'User name is Jake', salience: 0.9, pinned: true, addedAtTurn: 0, lastAccessedAtTurn: 0, importance: 0.9, category: 'fact', durability: 'permanent' },
        ],
      })

      const mem = system({ model: 'gpt-5-mini', working: true })
      const ctx = {
        session: { resources: { get: () => wmRef } },
      }

      const result = mem.contextFormatter(undefined, ctx)
      expect(result).toContain('Known facts:')
      expect(result).not.toContain('Current focus:')
      expect(result).not.toContain('User preferences:')
    })
  })

  // ---------------------------------------------------------------------------
  // Reflect handler: persistence behavior
  // ---------------------------------------------------------------------------

  describe('memorySystemReflect (persistence)', () => {
    const baseConfig = {
      model: 'gpt-5-mini',
      working: { capacity: 7, maxPinnedSlots: 2, decay: { strategy: 'power-law' as const, rate: 0.5 } },
    }

    async function runReflect(
      wmRef: ResourceHandle<WorkingMemoryState>,
      sysRef: ResourceHandle<MemorySystemState>,
      items: Array<{ content: string; importance: number; durability: string; category: string; replaces?: string }>,
      config?: typeof baseConfig & { episodic?: any },
      epRef?: ResourceHandle<EpisodicMemoryState>,
    ) {
      const block = memorySystemReflect(config ?? baseConfig)
      const ctx = {
        session: {
          resources: { get: (name: string) => name === 'workingMemory' ? wmRef : sysRef },
          items: { all: () => [] },
          instanceId: 'test-session',
        },
        user: epRef ? { resources: { get: () => epRef } } : undefined,
        response: { emit: async () => {} },
      } as any
      return block.run({ items } as any, ctx)
    }

    it('adds items to working memory', async () => {
      const wmRef = createMockWmRef()
      const sysRef = createMockSysRef()

      await runReflect(wmRef, sysRef, [
        { content: 'User likes TypeScript', importance: 0.7, durability: 'session', category: 'preference' },
      ])

      expect(wmRef.state.entries).toHaveLength(1)
      expect(wmRef.state.entries[0].content).toBe('User likes TypeScript')
    })

    it('auto-pins high-importance items (>= 0.85)', async () => {
      const wmRef = createMockWmRef()
      const sysRef = createMockSysRef()

      await runReflect(wmRef, sysRef, [
        { content: 'Critical goal', importance: 0.9, durability: 'permanent', category: 'task' },
      ])

      expect(wmRef.state.entries[0].pinned).toBe(true)
    })

    it('does not auto-pin items below 0.85', async () => {
      const wmRef = createMockWmRef()
      const sysRef = createMockSysRef()

      await runReflect(wmRef, sysRef, [
        { content: 'Minor fact', importance: 0.6, durability: 'session', category: 'fact' },
      ])

      expect(wmRef.state.entries[0].pinned).toBe(false)
    })

    it('routes persistent items to episodic memory', async () => {
      const wmRef = createMockWmRef()
      const sysRef = createMockSysRef()
      const epRef = createMockEpRef()

      const configWithEpisodic = {
        ...baseConfig,
        episodic: { scope: 'user' as const, significanceThreshold: 0.6, maxEpisodes: 200 },
      }

      await runReflect(wmRef, sysRef, [
        { content: 'User name is Jake', importance: 0.9, durability: 'permanent', category: 'fact' },
      ], configWithEpisodic, epRef)

      expect(epRef.state.episodes).toHaveLength(1)
      expect(epRef.state.episodes[0].content).toBe('User name is Jake')
      expect(sysRef.state.episodicWritesSinceLastConsolidation).toBe(1)
    })

    it('does not route transient items to episodic memory', async () => {
      const wmRef = createMockWmRef()
      const sysRef = createMockSysRef()
      const epRef = createMockEpRef()

      const configWithEpisodic = {
        ...baseConfig,
        episodic: { scope: 'user' as const, significanceThreshold: 0.6, maxEpisodes: 200 },
      }

      await runReflect(wmRef, sysRef, [
        { content: 'Transient thought', importance: 0.8, durability: 'transient', category: 'event' },
      ], configWithEpisodic, epRef)

      expect(epRef.state.episodes).toHaveLength(0)
    })

    it('does not route items below significance threshold to episodic', async () => {
      const wmRef = createMockWmRef()
      const sysRef = createMockSysRef()
      const epRef = createMockEpRef()

      const configWithEpisodic = {
        ...baseConfig,
        episodic: { scope: 'user' as const, significanceThreshold: 0.8, maxEpisodes: 200 },
      }

      await runReflect(wmRef, sysRef, [
        { content: 'Moderate fact', importance: 0.7, durability: 'persistent', category: 'fact' },
      ], configWithEpisodic, epRef)

      expect(epRef.state.episodes).toHaveLength(0)
    })

    it('handles replaces by evicting old entry', async () => {
      const wmRef = createMockWmRef({
        entries: [
          { id: 'old-goal', content: 'Build CLI', salience: 0.7, pinned: false, addedAtTurn: 0, lastAccessedAtTurn: 0, importance: 0.7, durability: 'session', category: 'task' },
        ],
      })
      const sysRef = createMockSysRef()

      await runReflect(wmRef, sysRef, [
        { content: 'Build REST API', importance: 0.8, durability: 'session', category: 'task', replaces: 'old-goal' },
      ])

      expect(wmRef.state.entries).toHaveLength(1)
      expect(wmRef.state.entries[0].content).toBe('Build REST API')
    })

    it('handles empty items array', async () => {
      const wmRef = createMockWmRef()
      const sysRef = createMockSysRef()

      await runReflect(wmRef, sysRef, [])

      expect(wmRef.state.entries).toHaveLength(0)
    })
  })

  // ---------------------------------------------------------------------------
  // Tick handler: consolidation triggers
  // ---------------------------------------------------------------------------

  describe('memorySystemTick (consolidation)', () => {
    const baseConfig = {
      model: 'gpt-5-mini',
      working: { capacity: 7, maxPinnedSlots: 2, decay: { strategy: 'power-law' as const, rate: 0.5 } },
    }

    async function runTick(
      wmRef: ResourceHandle<WorkingMemoryState>,
      sysRef: ResourceHandle<MemorySystemState>,
    ) {
      const block = memorySystemTick(baseConfig)
      const ctx = {
        session: {
          resources: { get: (name: string) => name === 'workingMemory' ? wmRef : sysRef },
        },
        response: { emit: async () => {} },
      } as any
      return block.run(undefined as any, ctx)
    }

    it('advances working memory turn counter', async () => {
      const wmRef = createMockWmRef({ currentTurn: 3 })
      const sysRef = createMockSysRef()

      await runTick(wmRef, sysRef)

      expect(wmRef.state.currentTurn).toBe(4)
    })

    it('recomputes salience on all entries', async () => {
      const wmRef = createMockWmRef({
        currentTurn: 0,
        entries: [
          { id: 'e1', content: 'test', salience: 1.0, pinned: false, addedAtTurn: 0, lastAccessedAtTurn: 0, importance: 1.0, durability: 'session', category: 'fact' },
        ],
      })
      const sysRef = createMockSysRef()

      await runTick(wmRef, sysRef)

      // After tick: currentTurn=1, elapsed=1, salience = 1.0 * (1+1)^(-0.5) ≈ 0.7071
      expect(wmRef.state.entries[0].salience).toBeCloseTo(0.7071, 3)
    })

    it('resets consolidation counters when trigger is met', async () => {
      const wmRef = createMockWmRef({ currentTurn: 14 })
      const sysRef = createMockSysRef({
        lastConsolidationTurn: 0,
        episodicWritesSinceLastConsolidation: 6,
        evictedPersistentSinceLastConsolidation: 0,
      })

      await runTick(wmRef, sysRef)

      // After tick: currentTurn=15, 15 turns since consolidation, 6 episodic writes >= 5
      expect(sysRef.state.episodicWritesSinceLastConsolidation).toBe(0)
      expect(sysRef.state.lastConsolidationTurn).toBe(15)
    })

    it('does not trigger consolidation before minInterval', async () => {
      const wmRef = createMockWmRef({ currentTurn: 4 })
      const sysRef = createMockSysRef({
        lastConsolidationTurn: 0,
        episodicWritesSinceLastConsolidation: 10,
      })

      await runTick(wmRef, sysRef)

      // Only 5 turns since last consolidation (< 10 minInterval)
      expect(sysRef.state.episodicWritesSinceLastConsolidation).toBe(10)
    })
  })
})
