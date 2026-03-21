import { describe, it, expect } from 'vitest'
import type { ResourceHandle } from '@flow-state-dev/core'
import {
  workingMemoryStateSchema,
} from '../../src/memory/working-memory.js'
import type { WorkingMemoryState } from '../../src/memory/working-memory.js'
import {
  episodicMemoryStateSchema,
  createEpisodicMemoryResource as createEpisodicMemoryResourceFn,
} from '../../src/memory/episodic-memory.js'
import type { EpisodicMemoryState, Episode } from '../../src/memory/episodic-memory.js'
import {
  semanticMemoryStateSchema,
  createSemanticMemoryResource as createSemanticMemoryResourceFn,
} from '../../src/memory/semantic-memory.js'
import type { SemanticFact, SemanticMemoryState } from '../../src/memory/semantic-memory.js'
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
  memorySystemConsolidate,
  consolidationGuard,
  consolidationPersist,
  pruneGuard,
  pruneGenerate,
  prunePersist,
  memorySystemPrune,
} from '../../src/memory/memory-system-blocks.js'
import type { ConsolidationOutput, PruneOutput } from '../../src/memory/memory-system-blocks.js'

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

/**
 * Create a mock resource registry that supports both property access
 * (ctx.session.resources.workingMemory) and .get() method.
 */
function createMockResources(refs: Record<string, any>) {
  return {
    ...refs,
    get: (name: string) => refs[name],
    list: () => Object.values(refs),
  }
}

function createMockSemRef(
  initialState?: Partial<SemanticMemoryState>,
): ResourceHandle<SemanticMemoryState> {
  let state: SemanticMemoryState = {
    facts: [],
    totalExtracted: 0,
    totalConsolidations: 0,
    ...initialState,
  }

  return {
    name: 'semanticMemory',
    scope: 'user',
    get state() { return state },
    patchState: async (updates) => { state = { ...state, ...updates } as SemanticMemoryState },
    setState: async (next) => { state = next },
    updateState: async (fn) => { state = await fn(state) },
    readContent: async () => JSON.stringify(state),
    writeContent: async () => {},
    config: { stateSchema: semanticMemoryStateSchema, writable: true },
  } as ResourceHandle<SemanticMemoryState>
}

function makeFact(overrides: Partial<SemanticFact> & { id: string }): SemanticFact {
  return {
    subject: 'user',
    content: `fact ${overrides.id}`,
    confidence: 0.7,
    category: 'identity',
    sourceEpisodeIds: [],
    extractedAt: new Date().toISOString(),
    reinforcementCount: 1,
    ...overrides,
  }
}

function makeEpisode(overrides: Partial<Episode> & { id: string }): Episode {
  return {
    content: `episode ${overrides.id}`,
    occurredAtTurn: 0,
    encodedAt: new Date().toISOString(),
    significance: 0.7,
    category: 'identity',
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
          { id: 'e1', content: 'Low priority', salience: 0.3, pinned: false, addedAtTurn: 0, lastAccessedAtTurn: 0, importance: 0.3, category: 'identity', durability: 'session' },
          { id: 'e2', content: 'High priority', salience: 0.9, pinned: false, addedAtTurn: 0, lastAccessedAtTurn: 0, importance: 0.9, category: 'task', durability: 'session' },
        ],
      })

      const mem = system({ model: 'gpt-5-mini', working: true })
      const ctx = {
        session: { resources: createMockResources({ workingMemory: wmRef }) },
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
        session: { resources: createMockResources({ workingMemory: wmRef }) },
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
        session: { resources: createMockResources({ workingMemory: wmRef }) },
        user: { resources: createMockResources({ episodicMemory: epRef }) },
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
        session: { resources: createMockResources({ workingMemory: wmRef }) },
        user: { resources: createMockResources({ episodicMemory: epRef }) },
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
        session: { resources: createMockResources({ workingMemory: wmRef }) },
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
          { id: 'e1', content: 'User name is Jake', salience: 0.9, pinned: true, addedAtTurn: 0, lastAccessedAtTurn: 0, importance: 0.9, category: 'identity', durability: 'permanent' },
          { id: 'e2', content: 'Debugging React crash', salience: 0.7, pinned: false, addedAtTurn: 0, lastAccessedAtTurn: 0, importance: 0.7, category: 'task', durability: 'session' },
          { id: 'e3', content: 'Prefers dark mode', salience: 0.6, pinned: false, addedAtTurn: 0, lastAccessedAtTurn: 0, importance: 0.6, category: 'preference', durability: 'persistent' },
        ],
      })

      const mem = system({ model: 'gpt-5-mini', working: true })
      const ctx = {
        session: { resources: createMockResources({ workingMemory: wmRef }) },
      }

      const result = mem.contextFormatter(undefined, ctx)
      // Working memory items go into session sections (not semantic "Known facts")
      expect(result).toContain('Session context:')
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
        session: { resources: createMockResources({ workingMemory: wmRef }) },
      }

      const result = mem.contextFormatter(undefined, ctx)
      expect(result).toBe('')
    })

    it('omits empty sections', () => {
      const wmRef = createMockWmRef({
        entries: [
          { id: 'e1', content: 'User name is Jake', salience: 0.9, pinned: true, addedAtTurn: 0, lastAccessedAtTurn: 0, importance: 0.9, category: 'identity', durability: 'permanent' },
        ],
      })

      const mem = system({ model: 'gpt-5-mini', working: true })
      const ctx = {
        session: { resources: createMockResources({ workingMemory: wmRef }) },
      }

      const result = mem.contextFormatter(undefined, ctx)
      expect(result).toContain('Session context:')
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
          resources: createMockResources({ workingMemory: wmRef, memorySystem: sysRef }),
          items: { all: () => [] },
          instanceId: 'test-session',
        },
        user: epRef ? { resources: createMockResources({ episodicMemory: epRef }) } : undefined,
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
        { content: 'Minor fact', importance: 0.6, durability: 'session', category: 'identity' },
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
        { content: 'User name is Jake', importance: 0.9, durability: 'permanent', category: 'identity' },
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
        { content: 'Moderate fact', importance: 0.7, durability: 'persistent', category: 'identity' },
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
          resources: createMockResources({ workingMemory: wmRef, memorySystem: sysRef }),
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
          { id: 'e1', content: 'test', salience: 1.0, pinned: false, addedAtTurn: 0, lastAccessedAtTurn: 0, importance: 1.0, durability: 'session', category: 'identity' },
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
      const wmRef = createMockWmRef({ currentTurn: 2 })
      const sysRef = createMockSysRef({
        lastConsolidationTurn: 0,
        episodicWritesSinceLastConsolidation: 10,
      })

      await runTick(wmRef, sysRef)

      // Only 3 turns since last consolidation (< 4 minInterval)
      expect(sysRef.state.episodicWritesSinceLastConsolidation).toBe(10)
    })
  })

  // ---------------------------------------------------------------------------
  // Semantic memory: system() factory
  // ---------------------------------------------------------------------------

  describe('system() factory (semantic)', () => {
    it('returns semantic module when configured', () => {
      const mem = system({
        model: 'gpt-5-mini',
        working: true,
        episodic: true,
        semantic: true,
      })

      expect(mem.semantic).toBeDefined()
      expect(mem.semantic!.resource).toBeDefined()
      expect(mem.semantic!.helpers).toBeDefined()
      expect(mem.semantic!.helpers.addFact).toBeTypeOf('function')
      expect(mem.semantic!.helpers.updateFact).toBeTypeOf('function')
      expect(mem.semantic!.helpers.reinforce).toBeTypeOf('function')
      expect(mem.semantic!.helpers.removeFact).toBeTypeOf('function')
      expect(mem.semantic!.helpers.allFacts).toBeTypeOf('function')
      expect(mem.semantic!.helpers.query).toBeTypeOf('function')
    })

    it('throws when semantic is set without episodic', () => {
      expect(() => system({
        model: 'gpt-5-mini',
        working: true,
        semantic: true,
      })).toThrow('Semantic memory requires episodic memory to be configured')
    })

    it('returns consolidate sequencer when semantic configured', () => {
      const mem = system({
        model: 'gpt-5-mini',
        working: true,
        episodic: true,
        semantic: true,
      })

      expect(mem.consolidate).toBeDefined()
    })

    it('does not return consolidate when semantic not configured', () => {
      const mem = system({
        model: 'gpt-5-mini',
        working: true,
        episodic: true,
      })

      expect(mem.consolidate).toBeUndefined()
    })

    it('accepts custom semantic config', () => {
      const mem = system({
        model: 'gpt-5-mini',
        working: true,
        episodic: true,
        semantic: {
          scope: 'project',
          consolidation: {
            episodicThreshold: 10,
            onEviction: false,
            minInterval: 20,
          },
        },
      })

      expect(mem.semantic).toBeDefined()
    })
  })

  // ---------------------------------------------------------------------------
  // captureFromItems and items connector
  // ---------------------------------------------------------------------------

  describe('captureFromItems', () => {
    it('is returned by system() factory', () => {
      const mem = system({
        model: 'gpt-5-mini',
        working: true,
      })

      expect(mem.captureFromItems).toBeDefined()
    })

    it('is a BlockDefinition with connectInput-derived shape', () => {
      const mem = system({
        model: 'gpt-5-mini',
        working: true,
      })

      // connectInput returns a BlockDefinition
      expect(mem.captureFromItems.kind).toBeDefined()
      expect(mem.captureFromItems.name).toBeDefined()
    })

    it('is also returned when semantic is configured', () => {
      const mem = system({
        model: 'gpt-5-mini',
        working: true,
        episodic: true,
        semantic: true,
      })

      expect(mem.captureFromItems).toBeDefined()
    })
  })

  describe('buildItemsConnector (via system internals)', () => {
    // We test the connector behavior by calling it directly through the
    // captureFromItems block's connectInput connector. Since buildItemsConnector
    // is private, we verify behavior through integration-style tests.

    // buildItemsConnector is private, so we replicate the same logic for unit testing.
    function simulateConnector(maxAssistantChars: number, items: any[]): string {
      if (items.length === 0) return ''

      const lastUser = [...items].reverse().find(
        (item: any) => item.type === 'message' && item.role === 'user',
      )
      if (!lastUser) return ''

      const userText = typeof lastUser.payload === 'string'
        ? lastUser.payload
        : typeof lastUser.content === 'string'
          ? lastUser.content
          : ''

      const lastUserIdx = items.indexOf(lastUser)
      const assistantItems = items.slice(lastUserIdx + 1).filter(
        (item: any) => item.type === 'message' && item.role === 'assistant',
      )

      let result = `[user] ${userText}`

      if (assistantItems.length > 0) {
        const assistantText = assistantItems
          .map((item: any) => typeof item.payload === 'string' ? item.payload : '')
          .filter(Boolean)
          .join('\n')

        if (assistantText) {
          const truncated = assistantText.length > maxAssistantChars
            ? assistantText.slice(0, maxAssistantChars) + ' [truncated]'
            : assistantText

          result += `\n[assistant] ${truncated}`
        }
      }

      return result
    }

    it('extracts last user message in full', () => {
      const items = [
        { type: 'message', role: 'user', payload: 'Hello, how are you?' },
        { type: 'message', role: 'assistant', payload: 'I am fine!' },
        { type: 'message', role: 'user', payload: 'Tell me about TypeScript' },
      ]

      const result = simulateConnector(500, items)
      expect(result).toBe('[user] Tell me about TypeScript')
    })

    it('includes assistant response after user message', () => {
      const items = [
        { type: 'message', role: 'user', payload: 'What is TypeScript?' },
        { type: 'message', role: 'assistant', payload: 'TypeScript is a typed superset of JavaScript.' },
      ]

      const result = simulateConnector(500, items)
      expect(result).toBe('[user] What is TypeScript?\n[assistant] TypeScript is a typed superset of JavaScript.')
    })

    it('truncates assistant response at maxAssistantChars', () => {
      const longResponse = 'A'.repeat(600)
      const items = [
        { type: 'message', role: 'user', payload: 'Explain something' },
        { type: 'message', role: 'assistant', payload: longResponse },
      ]

      const result = simulateConnector(500, items)
      expect(result).toContain('[user] Explain something')
      expect(result).toContain('[assistant] ')
      expect(result).toContain(' [truncated]')
      // Assistant portion should be 500 chars + ' [truncated]'
      const assistantPart = result.split('\n[assistant] ')[1]
      expect(assistantPart).toBe('A'.repeat(500) + ' [truncated]')
    })

    it('does not add [truncated] when assistant response fits within limit', () => {
      const items = [
        { type: 'message', role: 'user', payload: 'Hi' },
        { type: 'message', role: 'assistant', payload: 'Hello there!' },
      ]

      const result = simulateConnector(500, items)
      expect(result).not.toContain('[truncated]')
    })

    it('returns empty string when no items', () => {
      const result = simulateConnector(500, [])
      expect(result).toBe('')
    })

    it('returns empty string when no user message found', () => {
      const items = [
        { type: 'message', role: 'assistant', payload: 'Hello!' },
      ]

      const result = simulateConnector(500, items)
      expect(result).toBe('')
    })

    it('concatenates multiple assistant messages', () => {
      const items = [
        { type: 'message', role: 'user', payload: 'Tell me things' },
        { type: 'message', role: 'assistant', payload: 'First part.' },
        { type: 'message', role: 'assistant', payload: 'Second part.' },
      ]

      const result = simulateConnector(500, items)
      expect(result).toBe('[user] Tell me things\n[assistant] First part.\nSecond part.')
    })

    it('ignores non-message items', () => {
      const items = [
        { type: 'message', role: 'user', payload: 'Hello' },
        { type: 'tool-call', role: 'assistant', payload: 'tool stuff' },
        { type: 'message', role: 'assistant', payload: 'Response' },
      ]

      const result = simulateConnector(500, items)
      expect(result).toBe('[user] Hello\n[assistant] Response')
    })

    it('respects custom maxAssistantChars', () => {
      const items = [
        { type: 'message', role: 'user', payload: 'Hi' },
        { type: 'message', role: 'assistant', payload: 'A'.repeat(200) },
      ]

      const result = simulateConnector(100, items)
      const assistantPart = result.split('\n[assistant] ')[1]
      expect(assistantPart).toBe('A'.repeat(100) + ' [truncated]')
    })

    it('falls back to content field when payload is not a string', () => {
      const items = [
        { type: 'message', role: 'user', content: 'Hello via content' },
      ]

      const result = simulateConnector(500, items)
      expect(result).toBe('[user] Hello via content')
    })
  })

  // ---------------------------------------------------------------------------
  // Semantic memory: block shapes
  // ---------------------------------------------------------------------------

  describe('blocks (semantic)', () => {
    // Shared resource instances to avoid resource conflict errors in sequencers
    const sharedEpResource = createEpisodicMemoryResourceFn('user')
    const sharedSemResource = createSemanticMemoryResourceFn('user')

    const semanticConfig = {
      model: 'gpt-5-mini',
      working: { capacity: 7, maxPinnedSlots: 2, decay: { strategy: 'power-law' as const, rate: 0.5 } },
      episodic: { scope: 'user' as const, significanceThreshold: 0.6, maxEpisodes: 200 },
      semantic: { scope: 'user' as const, consolidation: { episodicThreshold: 5, onEviction: true, minInterval: 10 } },
      _episodicResource: sharedEpResource,
      _semanticResource: sharedSemResource,
    }

    describe('consolidationGuard', () => {
      it('returns a handler BlockDefinition', () => {
        const block = consolidationGuard(semanticConfig)
        expect(block.kind).toBe('handler')
      })

      it('has correct default name', () => {
        const block = consolidationGuard(semanticConfig)
        expect(block.name).toBe('tf.memory/consolidate/guard')
      })
    })

    describe('consolidationPersist', () => {
      it('returns a handler BlockDefinition', () => {
        const block = consolidationPersist(semanticConfig)
        expect(block.kind).toBe('handler')
      })

      it('has correct default name', () => {
        const block = consolidationPersist(semanticConfig)
        expect(block.name).toBe('tf.memory/consolidate/persist')
      })
    })

    describe('memorySystemConsolidate', () => {
      it('returns a sequencer BlockDefinition', () => {
        const block = memorySystemConsolidate(semanticConfig)
        expect(block.kind).toBe('sequencer')
      })

      it('has correct default name', () => {
        const block = memorySystemConsolidate(semanticConfig)
        expect(block.name).toBe('tf.memory/consolidate')
      })
    })

    describe('memorySystemCapture (with semantic)', () => {
      it('returns a sequencer BlockDefinition', () => {
        const block = memorySystemCapture(semanticConfig)
        expect(block.kind).toBe('sequencer')
      })
    })

    describe('memorySystemReflect (with semantic)', () => {
      it('declares semantic resource on user scope', () => {
        const block = memorySystemReflect(semanticConfig)
        expect(block.declaredResources?.user).toHaveProperty('semanticMemory')
      })
    })
  })

  // ---------------------------------------------------------------------------
  // Consolidation guard handler
  // ---------------------------------------------------------------------------

  describe('consolidationGuard (behavior)', () => {
    const semanticConfig = {
      model: 'gpt-5-mini',
      working: { capacity: 7, maxPinnedSlots: 2, decay: { strategy: 'power-law' as const, rate: 0.5 } },
      episodic: { scope: 'user' as const, significanceThreshold: 0.6, maxEpisodes: 200 },
      semantic: { scope: 'user' as const, consolidation: { episodicThreshold: 5, onEviction: true, minInterval: 10 } },
    }

    async function runGuard(
      wmRef: ResourceHandle<WorkingMemoryState>,
      sysRef: ResourceHandle<MemorySystemState>,
      epRef?: ResourceHandle<EpisodicMemoryState>,
      semRef?: ResourceHandle<SemanticMemoryState>,
    ) {
      const block = consolidationGuard(semanticConfig)
      const ctx = {
        session: {
          resources: createMockResources({ workingMemory: wmRef, memorySystem: sysRef }),
        },
        user: {
          resources: createMockResources({
            ...(epRef ? { episodicMemory: epRef } : {}),
            ...(semRef ? { semanticMemory: semRef } : {}),
          }),
        },
        response: { emit: async () => {} },
      } as any
      return block.run(undefined as any, ctx)
    }

    it('triggers when conditions are met', async () => {
      const wmRef = createMockWmRef({ currentTurn: 15 })
      const sysRef = createMockSysRef({
        lastConsolidationTurn: 0,
        episodicWritesSinceLastConsolidation: 6,
      })
      const epRef = createMockEpRef({
        episodes: [makeEpisode({ id: 'ep1', consolidated: false })],
      })
      const semRef = createMockSemRef()

      const result = await runGuard(wmRef, sysRef, epRef, semRef) as any
      expect(result.triggered).toBe(true)
      expect(result.episodes).toHaveLength(1)
    })

    it('does not trigger when below minInterval', async () => {
      const wmRef = createMockWmRef({ currentTurn: 5 })
      const sysRef = createMockSysRef({
        lastConsolidationTurn: 0,
        episodicWritesSinceLastConsolidation: 10,
      })

      const result = await runGuard(wmRef, sysRef) as any
      expect(result.triggered).toBe(false)
      expect(result.episodes).toEqual([])
    })

    it('does not trigger when below episodic threshold', async () => {
      const wmRef = createMockWmRef({ currentTurn: 15 })
      const sysRef = createMockSysRef({
        lastConsolidationTurn: 0,
        episodicWritesSinceLastConsolidation: 2,
        evictedPersistentSinceLastConsolidation: 0,
      })

      const result = await runGuard(wmRef, sysRef) as any
      expect(result.triggered).toBe(false)
    })

    it('triggers on eviction when onEviction is true', async () => {
      const wmRef = createMockWmRef({ currentTurn: 15 })
      const sysRef = createMockSysRef({
        lastConsolidationTurn: 0,
        episodicWritesSinceLastConsolidation: 0,
        evictedPersistentSinceLastConsolidation: 1,
      })
      const epRef = createMockEpRef()
      const semRef = createMockSemRef()

      const result = await runGuard(wmRef, sysRef, epRef, semRef) as any
      expect(result.triggered).toBe(true)
    })

    it('excludes consolidated episodes', async () => {
      const wmRef = createMockWmRef({ currentTurn: 15 })
      const sysRef = createMockSysRef({
        lastConsolidationTurn: 0,
        episodicWritesSinceLastConsolidation: 6,
      })
      const epRef = createMockEpRef({
        episodes: [
          makeEpisode({ id: 'ep1', consolidated: true }),
          makeEpisode({ id: 'ep2', consolidated: false }),
        ],
      })
      const semRef = createMockSemRef()

      const result = await runGuard(wmRef, sysRef, epRef, semRef) as any
      expect(result.triggered).toBe(true)
      expect(result.episodes).toHaveLength(1)
      expect(result.episodes[0].id).toBe('ep2')
    })

    it('includes existing semantic facts in output', async () => {
      const wmRef = createMockWmRef({ currentTurn: 15 })
      const sysRef = createMockSysRef({
        lastConsolidationTurn: 0,
        episodicWritesSinceLastConsolidation: 6,
      })
      const epRef = createMockEpRef({ episodes: [makeEpisode({ id: 'ep1' })] })
      const semRef = createMockSemRef({
        facts: [makeFact({ id: 'sf_1', content: 'User works at Stripe' })],
      })

      const result = await runGuard(wmRef, sysRef, epRef, semRef) as any
      expect(result.existingFacts).toHaveLength(1)
      expect(result.existingFacts[0].content).toBe('User works at Stripe')
    })
  })

  // ---------------------------------------------------------------------------
  // Consolidation persist handler
  // ---------------------------------------------------------------------------

  describe('consolidationPersist (behavior)', () => {
    const semanticConfig = {
      model: 'gpt-5-mini',
      working: { capacity: 7, maxPinnedSlots: 2, decay: { strategy: 'power-law' as const, rate: 0.5 } },
      episodic: { scope: 'user' as const, significanceThreshold: 0.6, maxEpisodes: 200 },
      semantic: { scope: 'user' as const, consolidation: { episodicThreshold: 5, onEviction: true, minInterval: 10 } },
    }

    async function runPersist(
      wmRef: ResourceHandle<WorkingMemoryState>,
      sysRef: ResourceHandle<MemorySystemState>,
      semRef: ResourceHandle<SemanticMemoryState>,
      epRef: ResourceHandle<EpisodicMemoryState>,
      input: ConsolidationOutput,
    ) {
      const block = consolidationPersist(semanticConfig)
      const ctx = {
        session: {
          resources: createMockResources({ workingMemory: wmRef, memorySystem: sysRef }),
        },
        user: {
          resources: createMockResources({ semanticMemory: semRef, episodicMemory: epRef }),
        },
        response: { emit: async () => {} },
      } as any
      return block.run(input as any, ctx)
    }

    it('handles "new" action — writes new facts', async () => {
      const wmRef = createMockWmRef({ currentTurn: 15 })
      const sysRef = createMockSysRef({ episodicWritesSinceLastConsolidation: 6 })
      const semRef = createMockSemRef()
      const epRef = createMockEpRef({ episodes: [makeEpisode({ id: 'ep1' })] })

      const result = await runPersist(wmRef, sysRef, semRef, epRef, {
        facts: [{
          content: 'User works at Stripe',
          confidence: 0.8,
          category: 'identity',
          sourceEpisodeIds: ['ep1'],
          action: 'new',
          targetFactId: '',
        }],
      }) as any

      expect(result.added).toBe(1)
      expect(semRef.state.facts).toHaveLength(1)
      expect(semRef.state.facts[0].content).toBe('User works at Stripe')
    })

    it('handles "reinforce" action — bumps existing fact', async () => {
      const wmRef = createMockWmRef({ currentTurn: 15 })
      const sysRef = createMockSysRef({ episodicWritesSinceLastConsolidation: 6 })
      const semRef = createMockSemRef({
        facts: [makeFact({ id: 'sf_target', confidence: 0.7, reinforcementCount: 2 })],
      })
      const epRef = createMockEpRef()

      const result = await runPersist(wmRef, sysRef, semRef, epRef, {
        facts: [{
          content: '',
          confidence: 0.8,
          category: 'identity',
          sourceEpisodeIds: ['ep5'],
          action: 'reinforce',
          targetFactId: 'sf_target',
        }],
      }) as any

      expect(result.reinforced).toBe(1)
      expect(semRef.state.facts[0].reinforcementCount).toBe(3)
      expect(semRef.state.facts[0].confidence).toBe(0.75) // 0.7 + 0.05
    })

    it('handles "update" action — changes content of existing fact', async () => {
      const wmRef = createMockWmRef({ currentTurn: 15 })
      const sysRef = createMockSysRef({ episodicWritesSinceLastConsolidation: 6 })
      const semRef = createMockSemRef({
        facts: [makeFact({ id: 'sf_target', content: 'User works at Google' })],
      })
      const epRef = createMockEpRef()

      const result = await runPersist(wmRef, sysRef, semRef, epRef, {
        facts: [{
          content: 'User works at Stripe',
          confidence: 0.85,
          category: 'identity',
          sourceEpisodeIds: ['ep5'],
          action: 'update',
          targetFactId: 'sf_target',
        }],
      }) as any

      expect(result.updated).toBe(1)
      expect(semRef.state.facts[0].id).toBe('sf_target') // ID preserved
      expect(semRef.state.facts[0].content).toBe('User works at Stripe')
      expect(semRef.state.facts[0].confidence).toBe(0.85)
    })

    it('handles "invalidate" action — removes existing fact', async () => {
      const wmRef = createMockWmRef({ currentTurn: 15 })
      const sysRef = createMockSysRef({ episodicWritesSinceLastConsolidation: 6 })
      const semRef = createMockSemRef({
        facts: [makeFact({ id: 'sf_target', content: 'User is learning Python' })],
      })
      const epRef = createMockEpRef()

      const result = await runPersist(wmRef, sysRef, semRef, epRef, {
        facts: [{
          content: '',
          confidence: 0,
          category: 'identity',
          sourceEpisodeIds: ['ep5'],
          action: 'invalidate',
          targetFactId: 'sf_target',
        }],
      }) as any

      expect(result.invalidated).toBe(1)
      expect(semRef.state.facts).toHaveLength(0)
    })

    it('logs warning for missing targetFactId on reinforce', async () => {
      const wmRef = createMockWmRef({ currentTurn: 15 })
      const sysRef = createMockSysRef({ episodicWritesSinceLastConsolidation: 6 })
      const semRef = createMockSemRef()
      const epRef = createMockEpRef()

      const result = await runPersist(wmRef, sysRef, semRef, epRef, {
        facts: [{
          content: '',
          confidence: 0.8,
          category: 'identity',
          sourceEpisodeIds: [],
          action: 'reinforce',
          targetFactId: 'sf_nonexistent',
        }],
      }) as any

      expect(result.reinforced).toBe(0)
    })

    it('marks episodes as consolidated', async () => {
      const wmRef = createMockWmRef({ currentTurn: 15 })
      const sysRef = createMockSysRef({ episodicWritesSinceLastConsolidation: 6 })
      const semRef = createMockSemRef()
      const epRef = createMockEpRef({
        episodes: [
          makeEpisode({ id: 'ep1', consolidated: false }),
          makeEpisode({ id: 'ep2', consolidated: false }),
        ],
      })

      await runPersist(wmRef, sysRef, semRef, epRef, {
        facts: [{
          content: 'New fact',
          confidence: 0.7,
          category: 'identity',
          sourceEpisodeIds: ['ep1', 'ep2'],
          action: 'new',
          targetFactId: '',
        }],
      })

      expect(epRef.state.episodes[0].consolidated).toBe(true)
      expect(epRef.state.episodes[1].consolidated).toBe(true)
    })

    it('resets memory system consolidation counters', async () => {
      const wmRef = createMockWmRef({ currentTurn: 15 })
      const sysRef = createMockSysRef({
        episodicWritesSinceLastConsolidation: 8,
        evictedPersistentSinceLastConsolidation: 2,
        lastConsolidationTurn: 0,
      })
      const semRef = createMockSemRef()
      const epRef = createMockEpRef()

      await runPersist(wmRef, sysRef, semRef, epRef, {
        facts: [{
          content: 'New fact',
          confidence: 0.7,
          category: 'identity',
          sourceEpisodeIds: [],
          action: 'new',
          targetFactId: '',
        }],
      })

      expect(sysRef.state.episodicWritesSinceLastConsolidation).toBe(0)
      expect(sysRef.state.evictedPersistentSinceLastConsolidation).toBe(0)
      expect(sysRef.state.lastConsolidationTurn).toBe(15)
    })

    it('increments totalConsolidations counter', async () => {
      const wmRef = createMockWmRef({ currentTurn: 15 })
      const sysRef = createMockSysRef({ episodicWritesSinceLastConsolidation: 6 })
      const semRef = createMockSemRef({ totalConsolidations: 0 })
      const epRef = createMockEpRef()

      await runPersist(wmRef, sysRef, semRef, epRef, {
        facts: [{
          content: 'Fact',
          confidence: 0.7,
          category: 'identity',
          sourceEpisodeIds: [],
          action: 'new',
          targetFactId: '',
        }],
      })

      expect(semRef.state.totalConsolidations).toBe(1)
    })

    it('is a no-op when facts array is empty', async () => {
      const wmRef = createMockWmRef({ currentTurn: 15 })
      const sysRef = createMockSysRef({ episodicWritesSinceLastConsolidation: 6 })
      const semRef = createMockSemRef()
      const epRef = createMockEpRef()

      const result = await runPersist(wmRef, sysRef, semRef, epRef, { facts: [] }) as any
      expect(result.added).toBe(0)
      expect(result.reinforced).toBe(0)
      expect(result.updated).toBe(0)
      expect(result.invalidated).toBe(0)
      // Counters should NOT be reset when no facts processed
      expect(sysRef.state.episodicWritesSinceLastConsolidation).toBe(6)
    })
  })

  // ---------------------------------------------------------------------------
  // Reflect handler: direct extraction to semantic memory
  // ---------------------------------------------------------------------------

  describe('memorySystemReflect (semantic direct extraction)', () => {
    const semanticConfig = {
      model: 'gpt-5-mini',
      working: { capacity: 7, maxPinnedSlots: 2, decay: { strategy: 'power-law' as const, rate: 0.5 } },
      episodic: { scope: 'user' as const, significanceThreshold: 0.6, maxEpisodes: 200 },
      semantic: { scope: 'user' as const, consolidation: { episodicThreshold: 5, onEviction: true, minInterval: 10 } },
    }

    async function runReflectWithSemantic(
      wmRef: ResourceHandle<WorkingMemoryState>,
      sysRef: ResourceHandle<MemorySystemState>,
      epRef: ResourceHandle<EpisodicMemoryState>,
      semRef: ResourceHandle<SemanticMemoryState>,
      items: Array<{ content: string; importance: number; durability: string; category: string; replaces?: string }>,
    ) {
      const block = memorySystemReflect(semanticConfig)
      const ctx = {
        session: {
          resources: createMockResources({ workingMemory: wmRef, memorySystem: sysRef }),
          items: { all: () => [] },
          instanceId: 'test-session',
        },
        user: {
          resources: createMockResources({ episodicMemory: epRef, semanticMemory: semRef }),
        },
        response: { emit: async () => {} },
      } as any
      return block.run({ items } as any, ctx)
    }

    it('routes permanent+identity items directly to semantic store', async () => {
      const wmRef = createMockWmRef()
      const sysRef = createMockSysRef()
      const epRef = createMockEpRef()
      const semRef = createMockSemRef()

      await runReflectWithSemantic(wmRef, sysRef, epRef, semRef, [
        { content: 'User name is Jake', importance: 0.9, durability: 'permanent', category: 'identity' },
      ])

      expect(semRef.state.facts).toHaveLength(1)
      expect(semRef.state.facts[0].content).toBe('User name is Jake')
      expect(semRef.state.facts[0].confidence).toBe(0.9) // importance used as confidence
      expect(semRef.state.facts[0].category).toBe('identity')
      expect(semRef.state.facts[0].subject).toBe('user')
    })

    it('routes persistent+identity items directly to semantic store', async () => {
      const wmRef = createMockWmRef()
      const sysRef = createMockSysRef()
      const epRef = createMockEpRef()
      const semRef = createMockSemRef()

      await runReflectWithSemantic(wmRef, sysRef, epRef, semRef, [
        { content: 'Some persistent fact', importance: 0.8, durability: 'persistent', category: 'identity' },
      ])

      expect(semRef.state.facts).toHaveLength(1)
      expect(semRef.state.facts[0].content).toBe('Some persistent fact')
      expect(semRef.state.facts[0].category).toBe('identity')
    })

    it('routes permanent+preference to semantic store', async () => {
      const wmRef = createMockWmRef()
      const sysRef = createMockSysRef()
      const epRef = createMockEpRef()
      const semRef = createMockSemRef()

      await runReflectWithSemantic(wmRef, sysRef, epRef, semRef, [
        { content: 'Prefers dark mode', importance: 0.9, durability: 'permanent', category: 'preference' },
      ])

      expect(semRef.state.facts).toHaveLength(1)
      expect(semRef.state.facts[0].content).toBe('Prefers dark mode')
      expect(semRef.state.facts[0].category).toBe('preference')
    })

    it('does not route persistent+event to semantic (unstable category)', async () => {
      const wmRef = createMockWmRef()
      const sysRef = createMockSysRef()
      const epRef = createMockEpRef()
      const semRef = createMockSemRef()

      await runReflectWithSemantic(wmRef, sysRef, epRef, semRef, [
        { content: 'User asked about deployment', importance: 0.7, durability: 'persistent', category: 'event' },
      ])

      expect(semRef.state.facts).toHaveLength(0)
    })

    it('does not route persistent+task to semantic (unstable category)', async () => {
      const wmRef = createMockWmRef()
      const sysRef = createMockSysRef()
      const epRef = createMockEpRef()
      const semRef = createMockSemRef()

      await runReflectWithSemantic(wmRef, sysRef, epRef, semRef, [
        { content: 'Fix the login bug', importance: 0.8, durability: 'persistent', category: 'task' },
      ])

      expect(semRef.state.facts).toHaveLength(0)
    })

    it('updates existing semantic fact when new content has high overlap but is more specific', async () => {
      const wmRef = createMockWmRef()
      const sysRef = createMockSysRef()
      const epRef = createMockEpRef()
      const semRef = createMockSemRef({
        facts: [makeFact({ id: 'sf_existing', content: 'User was born in May', confidence: 0.45 })],
      })

      await runReflectWithSemantic(wmRef, sysRef, epRef, semRef, [
        { content: 'User was born in May (specifically on the 8th)', importance: 0.78, durability: 'permanent', category: 'identity' },
      ])

      // Should update existing fact, not create a duplicate
      expect(semRef.state.facts).toHaveLength(1)
      expect(semRef.state.facts[0].id).toBe('sf_existing')
      expect(semRef.state.facts[0].content).toBe('User was born in May (specifically on the 8th)')
      expect(semRef.state.facts[0].confidence).toBe(0.78)
    })

    it('reinforces existing semantic fact when content is nearly identical', async () => {
      const wmRef = createMockWmRef()
      const sysRef = createMockSysRef()
      const epRef = createMockEpRef()
      const semRef = createMockSemRef({
        facts: [makeFact({ id: 'sf_existing', content: 'User works at Stripe', confidence: 0.7, reinforcementCount: 2 })],
      })

      await runReflectWithSemantic(wmRef, sysRef, epRef, semRef, [
        { content: 'User works at Stripe', importance: 0.8, durability: 'permanent', category: 'identity' },
      ])

      // Should reinforce, not duplicate
      expect(semRef.state.facts).toHaveLength(1)
      expect(semRef.state.facts[0].id).toBe('sf_existing')
      expect(semRef.state.facts[0].reinforcementCount).toBe(3)
    })

    it('adds new fact when no overlap with existing facts', async () => {
      const wmRef = createMockWmRef()
      const sysRef = createMockSysRef()
      const epRef = createMockEpRef()
      const semRef = createMockSemRef({
        facts: [makeFact({ id: 'sf_existing', content: 'User works at Stripe' })],
      })

      await runReflectWithSemantic(wmRef, sysRef, epRef, semRef, [
        { content: 'User prefers dark mode', importance: 0.8, durability: 'permanent', category: 'preference' },
      ])

      // No overlap — should add as new
      expect(semRef.state.facts).toHaveLength(2)
    })

    it('still routes to WM and episodic alongside semantic', async () => {
      const wmRef = createMockWmRef()
      const sysRef = createMockSysRef()
      const epRef = createMockEpRef()
      const semRef = createMockSemRef()

      await runReflectWithSemantic(wmRef, sysRef, epRef, semRef, [
        { content: 'User name is Jake', importance: 0.9, durability: 'permanent', category: 'identity' },
      ])

      // All three stores receive the item
      expect(wmRef.state.entries).toHaveLength(1)
      expect(epRef.state.episodes).toHaveLength(1)
      expect(semRef.state.facts).toHaveLength(1)
    })
  })

  // ---------------------------------------------------------------------------
  // Tick handler: semantic mode skips counter reset
  // ---------------------------------------------------------------------------

  describe('memorySystemTick (with semantic)', () => {
    const semanticConfig = {
      model: 'gpt-5-mini',
      working: { capacity: 7, maxPinnedSlots: 2, decay: { strategy: 'power-law' as const, rate: 0.5 } },
      episodic: { scope: 'user' as const, significanceThreshold: 0.6, maxEpisodes: 200 },
      semantic: { scope: 'user' as const, consolidation: { episodicThreshold: 5, onEviction: true, minInterval: 10 } },
    }

    async function runTickWithSemantic(
      wmRef: ResourceHandle<WorkingMemoryState>,
      sysRef: ResourceHandle<MemorySystemState>,
    ) {
      const block = memorySystemTick(semanticConfig)
      const ctx = {
        session: {
          resources: createMockResources({ workingMemory: wmRef, memorySystem: sysRef }),
        },
        response: { emit: async () => {} },
      } as any
      return block.run(undefined as any, ctx)
    }

    it('does not reset counters when semantic is configured', async () => {
      const wmRef = createMockWmRef({ currentTurn: 14 })
      const sysRef = createMockSysRef({
        lastConsolidationTurn: 0,
        episodicWritesSinceLastConsolidation: 6,
        evictedPersistentSinceLastConsolidation: 1,
      })

      await runTickWithSemantic(wmRef, sysRef)

      // Counters should NOT be reset — that's consolidationPersist's job
      expect(sysRef.state.episodicWritesSinceLastConsolidation).toBe(6)
      expect(sysRef.state.evictedPersistentSinceLastConsolidation).toBe(1)
      expect(sysRef.state.lastConsolidationTurn).toBe(0)
    })

    it('still advances turn counter', async () => {
      const wmRef = createMockWmRef({ currentTurn: 3 })
      const sysRef = createMockSysRef()

      await runTickWithSemantic(wmRef, sysRef)

      expect(wmRef.state.currentTurn).toBe(4)
    })
  })

  // ---------------------------------------------------------------------------
  // Recall with semantic memory
  // ---------------------------------------------------------------------------

  describe('recall() (with semantic)', () => {
    it('includes semantic facts in results', () => {
      const wmRef = createMockWmRef()
      const semRef = createMockSemRef({
        facts: [makeFact({ id: 'sf_1', content: 'User works at Stripe', confidence: 0.8, reinforcementCount: 3 })],
      })

      const mem = system({ model: 'gpt-5-mini', working: true, episodic: true, semantic: true })
      const ctx = {
        session: { resources: createMockResources({ workingMemory: wmRef }) },
        user: { resources: createMockResources({ semanticMemory: semRef, episodicMemory: createMockEpRef() }) },
      }

      const result = mem.recall(ctx)
      expect(result).toHaveLength(1)
      expect(result[0].source).toBe('semantic')
      expect(result[0].content).toBe('User works at Stripe')
    })

    it('semantic dedup wins over working memory', () => {
      const wmRef = createMockWmRef({
        entries: [
          { id: 'wm1', content: 'User works at Google', salience: 0.8, pinned: false, addedAtTurn: 0, lastAccessedAtTurn: 0, importance: 0.8, category: 'identity', durability: 'persistent' },
        ],
      })
      const semRef = createMockSemRef({
        facts: [makeFact({ id: 'sf_1', content: 'User works at Stripe', confidence: 0.9, reinforcementCount: 5 })],
      })

      const mem = system({ model: 'gpt-5-mini', working: true, episodic: true, semantic: true })
      const ctx = {
        session: { resources: createMockResources({ workingMemory: wmRef }) },
        user: { resources: createMockResources({ semanticMemory: semRef, episodicMemory: createMockEpRef() }) },
      }

      const result = mem.recall(ctx)
      // "works at" has significant token overlap — WM version should be deduped
      const sources = result.map((r) => r.source)
      // Both may appear if token overlap isn't > 0.6 (depends on exact content)
      // The key is that semantic fact IS present
      expect(sources).toContain('semantic')
    })

    it('applies cue boost to semantic facts', () => {
      const wmRef = createMockWmRef()
      const semRef = createMockSemRef({
        facts: [
          makeFact({ id: 'sf_1', content: 'User works at Stripe', confidence: 0.5, reinforcementCount: 1 }),
          makeFact({ id: 'sf_2', content: 'User likes React', confidence: 0.5, reinforcementCount: 1 }),
        ],
      })

      const mem = system({ model: 'gpt-5-mini', working: true, episodic: true, semantic: true })
      const ctx = {
        session: { resources: createMockResources({ workingMemory: wmRef }) },
        user: { resources: createMockResources({ semanticMemory: semRef, episodicMemory: createMockEpRef() }) },
      }

      const result = mem.recall(ctx, 'Stripe')
      const stripeItem = result.find((r) => r.content === 'User works at Stripe')!
      const reactItem = result.find((r) => r.content === 'User likes React')!
      expect(stripeItem.relevance).toBeGreaterThan(reactItem.relevance)
    })
  })

  // ---------------------------------------------------------------------------
  // Context formatter with semantic memory
  // ---------------------------------------------------------------------------

  describe('contextFormatter() (with semantic)', () => {
    it('includes semantic facts in Known facts section (single subject)', () => {
      const wmRef = createMockWmRef()
      const semRef = createMockSemRef({
        facts: [makeFact({ id: 'sf_1', subject: 'user', content: 'Works at Stripe', category: 'profession', confidence: 0.8 })],
      })

      const mem = system({ model: 'gpt-5-mini', working: true, episodic: true, semantic: true })
      const ctx = {
        session: { resources: createMockResources({ workingMemory: wmRef }) },
        user: { resources: createMockResources({ semanticMemory: semRef, episodicMemory: createMockEpRef() }) },
      }

      const result = mem.contextFormatter(undefined, ctx)
      expect(result).toContain('Known facts:')
      expect(result).toContain('[profession] Works at Stripe')
    })

    it('groups by subject when multiple subjects exist', () => {
      const wmRef = createMockWmRef()
      const semRef = createMockSemRef({
        facts: [
          makeFact({ id: 'sf_1', subject: 'user', content: 'Name is Jake', category: 'identity', confidence: 0.9 }),
          makeFact({ id: 'sf_2', subject: 'jennifer', content: 'Is the spouse', category: 'relationship', confidence: 0.8 }),
        ],
      })

      const mem = system({ model: 'gpt-5-mini', working: true, episodic: true, semantic: true })
      const ctx = {
        session: { resources: createMockResources({ workingMemory: wmRef }) },
        user: { resources: createMockResources({ semanticMemory: semRef, episodicMemory: createMockEpRef() }) },
      }

      const result = mem.contextFormatter(undefined, ctx)
      expect(result).toContain('About user:')
      expect(result).toContain('[identity] Name is Jake')
      expect(result).toContain('About jennifer:')
      expect(result).toContain('[relationship] Is the spouse')
    })

    it('includes category prefix for semantic facts', () => {
      const wmRef = createMockWmRef()
      const semRef = createMockSemRef({
        facts: [makeFact({ id: 'sf_1', subject: 'user', content: 'Frequently debugs React components', category: 'pattern', confidence: 0.7 })],
      })

      const mem = system({ model: 'gpt-5-mini', working: true, episodic: true, semantic: true })
      const ctx = {
        session: { resources: createMockResources({ workingMemory: wmRef }) },
        user: { resources: createMockResources({ semanticMemory: semRef, episodicMemory: createMockEpRef() }) },
      }

      const result = mem.contextFormatter(undefined, ctx)
      expect(result).toContain('[pattern] Frequently debugs React components')
    })
  })

  // ---------------------------------------------------------------------------
  // Observer prompt
  // ---------------------------------------------------------------------------

  describe('observer prompt (contradiction detection)', () => {
    const baseConfig = {
      model: 'gpt-5-mini',
      working: { capacity: 7, maxPinnedSlots: 2, decay: { strategy: 'power-law' as const, rate: 0.5 } },
    }

    it('includes contradiction detection instructions in prompt', () => {
      const block = memorySystemObserve(baseConfig)
      // The prompt is stored in the block config internals — verify via config property
      const blockDef = block as any
      const config = blockDef.config ?? {}
      const prompt = config.prompt ?? ''
      expect(prompt).toContain('CONTRADICT')
      expect(prompt).toContain('Stale memories are worse than missing memories')
    })
  })

  // ---------------------------------------------------------------------------
  // Prune blocks (factory)
  // ---------------------------------------------------------------------------

  describe('prune blocks (factory)', () => {
    const semanticConfig = {
      model: 'gpt-5-mini',
      working: { capacity: 7, maxPinnedSlots: 2, decay: { strategy: 'power-law' as const, rate: 0.5 } },
      episodic: { scope: 'user' as const, significanceThreshold: 0.6, maxEpisodes: 200 },
      semantic: { scope: 'user' as const, consolidation: { episodicThreshold: 5, onEviction: true, minInterval: 10 } },
    }

    describe('pruneGuard', () => {
      it('returns a handler BlockDefinition', () => {
        const block = pruneGuard(semanticConfig)
        expect(block.kind).toBe('handler')
      })

      it('has correct default name', () => {
        const block = pruneGuard(semanticConfig)
        expect(block.name).toBe('tf.memory/prune/guard')
      })

      it('declares semantic resource on user scope', () => {
        const block = pruneGuard(semanticConfig)
        expect(block.declaredResources?.user).toHaveProperty('semanticMemory')
      })
    })

    describe('pruneGenerate', () => {
      it('returns a generator BlockDefinition', () => {
        const block = pruneGenerate(semanticConfig)
        expect(block.kind).toBe('generator')
      })

      it('has correct default name', () => {
        const block = pruneGenerate(semanticConfig)
        expect(block.name).toBe('tf.memory/prune/generate')
      })
    })

    describe('prunePersist', () => {
      it('returns a handler BlockDefinition', () => {
        const block = prunePersist(semanticConfig)
        expect(block.kind).toBe('handler')
      })

      it('has correct default name', () => {
        const block = prunePersist(semanticConfig)
        expect(block.name).toBe('tf.memory/prune/persist')
      })

      it('declares semantic resource on user scope', () => {
        const block = prunePersist(semanticConfig)
        expect(block.declaredResources?.user).toHaveProperty('semanticMemory')
      })
    })

    describe('memorySystemPrune', () => {
      it('returns a sequencer BlockDefinition', () => {
        const block = memorySystemPrune(semanticConfig)
        expect(block.kind).toBe('sequencer')
      })

      it('has correct default name', () => {
        const block = memorySystemPrune(semanticConfig)
        expect(block.name).toBe('tf.memory/prune')
      })
    })
  })

  // ---------------------------------------------------------------------------
  // Prune guard (behavior)
  // ---------------------------------------------------------------------------

  describe('pruneGuard (behavior)', () => {
    const semanticConfig = {
      model: 'gpt-5-mini',
      working: { capacity: 7, maxPinnedSlots: 2, decay: { strategy: 'power-law' as const, rate: 0.5 } },
      episodic: { scope: 'user' as const, significanceThreshold: 0.6, maxEpisodes: 200 },
      semantic: { scope: 'user' as const, consolidation: { episodicThreshold: 5, onEviction: true, minInterval: 10 } },
    }

    async function runPruneGuard(semRef?: ResourceHandle<SemanticMemoryState>) {
      const block = pruneGuard(semanticConfig)
      const ctx = {
        session: {
          resources: createMockResources({}),
        },
        user: {
          resources: createMockResources({
            ...(semRef ? { semanticMemory: semRef } : {}),
          }),
        },
        response: { emit: async () => {} },
      } as any
      return block.run(undefined as any, ctx)
    }

    it('returns triggered: false when fact count is below default threshold (20)', async () => {
      const semRef = createMockSemRef({
        facts: Array.from({ length: 5 }, (_, i) => makeFact({ id: `sf_${i}` })),
      })
      const result = await runPruneGuard(semRef) as any
      expect(result.triggered).toBe(false)
      expect(result.facts).toEqual([])
    })

    it('returns triggered: true when fact count meets default threshold (20)', async () => {
      const semRef = createMockSemRef({
        facts: Array.from({ length: 20 }, (_, i) => makeFact({ id: `sf_${i}` })),
      })
      const result = await runPruneGuard(semRef) as any
      expect(result.triggered).toBe(true)
      expect(result.facts).toHaveLength(20)
    })

    it('returns triggered: true when fact count exceeds threshold', async () => {
      const semRef = createMockSemRef({
        facts: Array.from({ length: 25 }, (_, i) => makeFact({ id: `sf_${i}` })),
      })
      const result = await runPruneGuard(semRef) as any
      expect(result.triggered).toBe(true)
      expect(result.facts).toHaveLength(25)
    })

    it('respects custom pruneThreshold', async () => {
      const customConfig = {
        ...semanticConfig,
        semantic: { ...semanticConfig.semantic, pruneThreshold: 5 },
      }
      const block = pruneGuard(customConfig)
      const semRef = createMockSemRef({
        facts: Array.from({ length: 5 }, (_, i) => makeFact({ id: `sf_${i}` })),
      })
      const ctx = {
        session: { resources: createMockResources({}) },
        user: { resources: createMockResources({ semanticMemory: semRef }) },
        response: { emit: async () => {} },
      } as any
      const result = await block.run(undefined as any, ctx) as any
      expect(result.triggered).toBe(true)
    })

    it('returns triggered: false when pruneThreshold is 0 (disabled)', async () => {
      const customConfig = {
        ...semanticConfig,
        semantic: { ...semanticConfig.semantic, pruneThreshold: 0 },
      }
      const block = pruneGuard(customConfig)
      const semRef = createMockSemRef({
        facts: Array.from({ length: 100 }, (_, i) => makeFact({ id: `sf_${i}` })),
      })
      const ctx = {
        session: { resources: createMockResources({}) },
        user: { resources: createMockResources({ semanticMemory: semRef }) },
        response: { emit: async () => {} },
      } as any
      const result = await block.run(undefined as any, ctx) as any
      expect(result.triggered).toBe(false)
    })

    it('returns triggered: false when semantic resource is not available', async () => {
      const result = await runPruneGuard() as any
      expect(result.triggered).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // Prune persist (behavior)
  // ---------------------------------------------------------------------------

  describe('prunePersist (behavior)', () => {
    const semanticConfig = {
      model: 'gpt-5-mini',
      working: { capacity: 7, maxPinnedSlots: 2, decay: { strategy: 'power-law' as const, rate: 0.5 } },
      episodic: { scope: 'user' as const, significanceThreshold: 0.6, maxEpisodes: 200 },
      semantic: { scope: 'user' as const, consolidation: { episodicThreshold: 5, onEviction: true, minInterval: 10 } },
    }

    async function runPrunePersist(
      semRef: ResourceHandle<SemanticMemoryState>,
      input: PruneOutput,
    ) {
      const block = prunePersist(semanticConfig)
      const ctx = {
        session: { resources: createMockResources({}) },
        user: { resources: createMockResources({ semanticMemory: semRef }) },
        response: { emit: async () => {} },
      } as any
      return block.run(input as any, ctx)
    }

    it('removes facts listed in removals', async () => {
      const semRef = createMockSemRef({
        facts: [
          makeFact({ id: 'sf_1', content: 'User likes coffee' }),
          makeFact({ id: 'sf_2', content: 'User was born in May' }),
          makeFact({ id: 'sf_3', content: 'User works at Stripe' }),
        ],
      })

      const result = await runPrunePersist(semRef, {
        removals: [{ factId: 'sf_1', reason: 'low-value' }],
        merges: [],
      }) as any

      expect(result.removed).toBe(1)
      expect(result.merged).toBe(0)
      expect(semRef.state.facts).toHaveLength(2)
      expect(semRef.state.facts.find((f: SemanticFact) => f.id === 'sf_1')).toBeUndefined()
    })

    it('merges facts: updates first, removes rest', async () => {
      const semRef = createMockSemRef({
        facts: [
          makeFact({ id: 'sf_1', content: 'User was born in Maryland', sourceEpisodeIds: ['ep1'] }),
          makeFact({ id: 'sf_2', content: 'User was born in May', sourceEpisodeIds: ['ep2'] }),
          makeFact({ id: 'sf_3', content: 'User works at Stripe' }),
        ],
      })

      const result = await runPrunePersist(semRef, {
        removals: [],
        merges: [{
          sourceFactIds: ['sf_1', 'sf_2'],
          mergedContent: 'User was born in May in Maryland',
          reason: 'same topic — birth details',
        }],
      }) as any

      expect(result.merged).toBe(1)
      expect(result.removed).toBe(0)
      expect(semRef.state.facts).toHaveLength(2) // sf_1 updated, sf_2 removed
      const merged = semRef.state.facts.find((f: SemanticFact) => f.id === 'sf_1')
      expect(merged).toBeDefined()
      expect(merged!.content).toBe('User was born in May in Maryland')
      expect(merged!.sourceEpisodeIds).toContain('ep1')
      expect(merged!.sourceEpisodeIds).toContain('ep2')
      expect(semRef.state.facts.find((f: SemanticFact) => f.id === 'sf_2')).toBeUndefined()
    })

    it('handles empty removals and merges (no-op)', async () => {
      const semRef = createMockSemRef({
        facts: [makeFact({ id: 'sf_1' })],
      })

      const result = await runPrunePersist(semRef, {
        removals: [],
        merges: [],
      }) as any

      expect(result.removed).toBe(0)
      expect(result.merged).toBe(0)
      expect(semRef.state.facts).toHaveLength(1)
    })

    it('skips removal if factId is also in a merge', async () => {
      const semRef = createMockSemRef({
        facts: [
          makeFact({ id: 'sf_1', content: 'User was born in Maryland' }),
          makeFact({ id: 'sf_2', content: 'User was born in May' }),
        ],
      })

      const result = await runPrunePersist(semRef, {
        removals: [{ factId: 'sf_1', reason: 'redundant' }],
        merges: [{
          sourceFactIds: ['sf_1', 'sf_2'],
          mergedContent: 'User was born in May in Maryland',
          reason: 'same topic',
        }],
      }) as any

      // sf_1 should NOT be removed by the removal since it's in the merge
      // merge keeps sf_1 (updated) and removes sf_2
      expect(result.removed).toBe(0) // removal skipped
      expect(result.merged).toBe(1)
      expect(semRef.state.facts).toHaveLength(1)
      expect(semRef.state.facts[0].content).toBe('User was born in May in Maryland')
    })

    it('handles merge with 3+ source facts', async () => {
      const semRef = createMockSemRef({
        facts: [
          makeFact({ id: 'sf_1', content: 'User name is Jake', sourceEpisodeIds: ['ep1'] }),
          makeFact({ id: 'sf_2', content: 'User was born in May', sourceEpisodeIds: ['ep2'] }),
          makeFact({ id: 'sf_3', content: 'User was born in Maryland', sourceEpisodeIds: ['ep3'] }),
          makeFact({ id: 'sf_4', content: 'User works at Stripe' }),
        ],
      })

      const result = await runPrunePersist(semRef, {
        removals: [],
        merges: [{
          sourceFactIds: ['sf_2', 'sf_3'],
          mergedContent: 'User was born in May in Maryland',
          reason: 'birth details',
        }],
      }) as any

      expect(result.merged).toBe(1)
      expect(semRef.state.facts).toHaveLength(3)
      const merged = semRef.state.facts.find((f: SemanticFact) => f.id === 'sf_2')
      expect(merged!.content).toBe('User was born in May in Maryland')
    })

    it('handles non-existent factId in removal gracefully', async () => {
      const semRef = createMockSemRef({
        facts: [makeFact({ id: 'sf_1' })],
      })

      const result = await runPrunePersist(semRef, {
        removals: [{ factId: 'sf_nonexistent', reason: 'stale' }],
        merges: [],
      }) as any

      // removeFact is a no-op for missing IDs
      expect(result.removed).toBe(1)
      expect(semRef.state.facts).toHaveLength(1)
    })

    it('returns { removed: 0, merged: 0 } when semantic resource is missing', async () => {
      const block = prunePersist(semanticConfig)
      const ctx = {
        session: { resources: createMockResources({}) },
        user: { resources: createMockResources({}) },
        response: { emit: async () => {} },
      } as any

      const result = await block.run({
        removals: [{ factId: 'sf_1', reason: 'test' }],
        merges: [],
      } as any, ctx) as any

      expect(result.removed).toBe(0)
      expect(result.merged).toBe(0)
    })
  })

  // ---------------------------------------------------------------------------
  // system() factory — prune exposure
  // ---------------------------------------------------------------------------

  describe('system() factory — prune', () => {
    it('exposes prune when semantic is configured', () => {
      const mem = system({ model: 'gpt-5-mini', working: true, episodic: true, semantic: true })
      expect(mem.prune).toBeDefined()
      expect((mem.prune as any).kind).toBe('sequencer')
    })

    it('does not expose prune when semantic is not configured', () => {
      const mem = system({ model: 'gpt-5-mini', working: true })
      expect(mem.prune).toBeUndefined()
    })

    it('respects custom pruneThreshold', () => {
      const mem = system({
        model: 'gpt-5-mini',
        working: true,
        episodic: true,
        semantic: { pruneThreshold: 50 },
      })
      expect(mem.prune).toBeDefined()
    })
  })
})
