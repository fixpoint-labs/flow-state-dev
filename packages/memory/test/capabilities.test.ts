import { describe, it, expect } from 'vitest'
import type { ResourceHandle } from '@flow-state-dev/core'
import { generator } from '@flow-state-dev/core'
import { workingMemoryStateSchema } from '../src/working-memory.js'
import type { WorkingMemoryState } from '../src/working-memory.js'
import { episodicMemoryStateSchema } from '../src/episodic-memory.js'
import type { EpisodicMemoryState } from '../src/episodic-memory.js'
import { semanticMemoryStateSchema } from '../src/semantic-memory.js'
import type { SemanticMemoryState } from '../src/semantic-memory.js'
import {
  createWorkingMemoryCapability,
  workingMemoryCapability,
  createEpisodicMemoryCapability,
  episodicMemoryCapability,
  createSemanticMemoryCapability,
  semanticMemoryCapability,
} from '../src/capabilities.js'
import { system } from '../src/memory-system.js'
import { createMemoryCapability } from '../src/memory-capability.js'

// ---------------------------------------------------------------------------
// Test helpers — mock resource refs that simulate the runtime context
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

/** Build a mock block context with the given resource refs. */
function mockCtx(opts: {
  wm?: ResourceHandle<WorkingMemoryState>
  ep?: ResourceHandle<EpisodicMemoryState>
  sem?: ResourceHandle<SemanticMemoryState>
}) {
  const refs: Record<string, unknown> = {
    workingMemory: opts.wm ?? createMockWmRef(),
    episodicMemory: opts.ep ?? createMockEpRef(),
    semanticMemory: opts.sem ?? createMockSemRef(),
  }
  return {
    resources: {
      ...refs,
      get: (name: string) => refs[name],
      list: () => Object.values(refs),
    },
  }
}

// ---------------------------------------------------------------------------
// Working Memory Capability
// ---------------------------------------------------------------------------

describe('memory/capabilities', () => {
  describe('workingMemoryCapability', () => {
    it('is branded as a Capability', () => {
      expect(workingMemoryCapability.__brand).toBe('Capability')
      expect(workingMemoryCapability.name).toBe('workingMemory')
    })

    it('declares workingMemory resource', () => {
      expect(workingMemoryCapability.resources).toBeDefined()
      expect(workingMemoryCapability.resources!.workingMemory).toBeDefined()
      expect((workingMemoryCapability.resources!.workingMemory as any).scope).toBe('session')
    })

    it('has no presets (works on all block kinds)', () => {
      expect(workingMemoryCapability.__presetDefs).toBeUndefined()
    })

    it('fns returns bound helpers', () => {
      const wmRef = createMockWmRef()
      const ctx = mockCtx({ wm: wmRef })
      const fns = workingMemoryCapability.fns!(ctx as any)

      expect(typeof fns.add).toBe('function')
      expect(typeof fns.evict).toBe('function')
      expect(typeof fns.pin).toBe('function')
      expect(typeof fns.unpin).toBe('function')
      expect(typeof fns.refresh).toBe('function')
      expect(typeof fns.tick).toBe('function')
      expect(typeof fns.items).toBe('function')
      expect(typeof fns.format).toBe('function')
    })

    it('add() creates an entry in the resource', async () => {
      const wmRef = createMockWmRef()
      const ctx = mockCtx({ wm: wmRef })
      const fns = workingMemoryCapability.fns!(ctx as any)

      const entry = await fns.add({ content: 'User likes TypeScript', importance: 0.8 })
      expect(entry.content).toBe('User likes TypeScript')
      expect(entry.importance).toBe(0.8)
      expect(wmRef.state.entries).toHaveLength(1)
    })

    it('items() returns entries sorted by salience', async () => {
      const wmRef = createMockWmRef()
      const ctx = mockCtx({ wm: wmRef })
      const fns = workingMemoryCapability.fns!(ctx as any)

      await fns.add({ content: 'Low', importance: 0.2 })
      await fns.add({ content: 'High', importance: 0.9 })

      const sorted = fns.items()
      expect(sorted[0].content).toBe('High')
      expect(sorted[1].content).toBe('Low')
    })

    it('tick() advances the turn counter and recomputes salience', async () => {
      const wmRef = createMockWmRef()
      const ctx = mockCtx({ wm: wmRef })
      const fns = workingMemoryCapability.fns!(ctx as any)

      await fns.add({ content: 'test', importance: 0.8 })
      expect(wmRef.state.currentTurn).toBe(0)

      await fns.tick()
      expect(wmRef.state.currentTurn).toBe(1)
      // Salience should be recomputed (lower due to decay)
      expect(wmRef.state.entries[0].salience).toBeLessThan(0.8)
    })

    it('evict() removes an entry', async () => {
      const wmRef = createMockWmRef()
      const ctx = mockCtx({ wm: wmRef })
      const fns = workingMemoryCapability.fns!(ctx as any)

      const entry = await fns.add({ content: 'temp', importance: 0.5 })
      expect(wmRef.state.entries).toHaveLength(1)

      const removed = await fns.evict(entry.id)
      expect(removed).toBe(true)
      expect(wmRef.state.entries).toHaveLength(0)
    })

    it('pin() and unpin() toggle pin status', async () => {
      const wmRef = createMockWmRef()
      const ctx = mockCtx({ wm: wmRef })
      const fns = workingMemoryCapability.fns!(ctx as any)

      const entry = await fns.add({ content: 'pin me', importance: 0.5 })
      expect(wmRef.state.entries[0].pinned).toBe(false)

      await fns.pin(entry.id)
      expect(wmRef.state.entries[0].pinned).toBe(true)

      await fns.unpin(entry.id)
      expect(wmRef.state.entries[0].pinned).toBe(false)
    })

    it('format() returns bullet-list formatted entries', async () => {
      const wmRef = createMockWmRef()
      const ctx = mockCtx({ wm: wmRef })
      const fns = workingMemoryCapability.fns!(ctx as any)

      await fns.add({ content: 'Fact A', importance: 0.8 })
      await fns.add({ content: 'Fact B', importance: 0.6 })

      const formatted = fns.format()
      expect(formatted).toContain('- Fact A')
      expect(formatted).toContain('- Fact B')
    })

    it('createWorkingMemoryCapability() respects custom config', async () => {
      const customCap = createWorkingMemoryCapability({ capacity: 2 })
      const wmRef = createMockWmRef()
      const ctx = mockCtx({ wm: wmRef })
      const fns = customCap.fns!(ctx as any)

      // Fill to capacity
      await fns.add({ content: 'A', importance: 0.3 })
      await fns.add({ content: 'B', importance: 0.5 })

      // Third entry should evict the lowest-salience one
      await fns.add({ content: 'C', importance: 0.9 })
      expect(wmRef.state.entries).toHaveLength(2)
      // 'A' (lowest salience) should have been evicted
      const contents = wmRef.state.entries.map((e) => e.content)
      expect(contents).not.toContain('A')
      expect(contents).toContain('B')
      expect(contents).toContain('C')
    })
  })

  // ---------------------------------------------------------------------------
  // Episodic Memory Capability
  // ---------------------------------------------------------------------------

  describe('episodicMemoryCapability', () => {
    it('is branded as a Capability', () => {
      expect(episodicMemoryCapability.__brand).toBe('Capability')
      expect(episodicMemoryCapability.name).toBe('episodicMemory')
    })

    it('declares episodicMemory user resource by default', () => {
      expect(episodicMemoryCapability.resources).toBeDefined()
      expect(episodicMemoryCapability.resources!.episodicMemory).toBeDefined()
      expect((episodicMemoryCapability.resources!.episodicMemory as any).scope).toBe('user')
    })

    it('org scope sets resource scope to org', () => {
      const cap = createEpisodicMemoryCapability({ scope: 'org' })
      expect(cap.resources).toBeDefined()
      expect(cap.resources!.episodicMemory).toBeDefined()
      expect((cap.resources!.episodicMemory as any).scope).toBe('org')
    })

    it('fns returns bound helpers', () => {
      const epRef = createMockEpRef()
      const ctx = mockCtx({ ep: epRef })
      const fns = episodicMemoryCapability.fns!(ctx as any)

      expect(typeof fns.encode).toBe('function')
      expect(typeof fns.recent).toBe('function')
      expect(typeof fns.markConsolidated).toBe('function')
    })

    it('encode() creates an episode', async () => {
      const epRef = createMockEpRef()
      const ctx = mockCtx({ ep: epRef })
      const fns = episodicMemoryCapability.fns!(ctx as any)

      const episode = await fns.encode({
        content: 'User discussed TypeScript',
        occurredAtTurn: 3,
        significance: 0.7,
        category: 'event',
        context: { sessionId: 'sess_1' },
      })

      expect(episode.content).toBe('User discussed TypeScript')
      expect(episode.id).toMatch(/^ep_/)
      expect(epRef.state.episodes).toHaveLength(1)
      expect(epRef.state.totalEncoded).toBe(1)
    })

    it('recent() returns episodes sorted by turn', async () => {
      const epRef = createMockEpRef()
      const ctx = mockCtx({ ep: epRef })
      const fns = episodicMemoryCapability.fns!(ctx as any)

      await fns.encode({
        content: 'Early',
        occurredAtTurn: 1,
        significance: 0.5,
        category: 'event',
        context: { sessionId: 's1' },
      })
      await fns.encode({
        content: 'Late',
        occurredAtTurn: 5,
        significance: 0.6,
        category: 'event',
        context: { sessionId: 's1' },
      })

      const episodes = fns.recent()
      expect(episodes[0].content).toBe('Late')
      expect(episodes[1].content).toBe('Early')
    })

    it('markConsolidated() marks episodes', async () => {
      const epRef = createMockEpRef()
      const ctx = mockCtx({ ep: epRef })
      const fns = episodicMemoryCapability.fns!(ctx as any)

      const ep = await fns.encode({
        content: 'to consolidate',
        occurredAtTurn: 1,
        significance: 0.8,
        category: 'identity',
        context: { sessionId: 's1' },
      })

      expect(epRef.state.episodes[0].consolidated).toBe(false)
      await fns.markConsolidated([ep.id])
      expect(epRef.state.episodes[0].consolidated).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // Semantic Memory Capability
  // ---------------------------------------------------------------------------

  describe('semanticMemoryCapability', () => {
    it('is branded as a Capability', () => {
      expect(semanticMemoryCapability.__brand).toBe('Capability')
      expect(semanticMemoryCapability.name).toBe('semanticMemory')
    })

    it('declares semanticMemory user resource by default', () => {
      expect(semanticMemoryCapability.resources).toBeDefined()
      expect(semanticMemoryCapability.resources!.semanticMemory).toBeDefined()
      expect((semanticMemoryCapability.resources!.semanticMemory as any).scope).toBe('user')
    })

    it('org scope sets resource scope to org', () => {
      const cap = createSemanticMemoryCapability({ scope: 'org' })
      expect(cap.resources).toBeDefined()
      expect(cap.resources!.semanticMemory).toBeDefined()
      expect((cap.resources!.semanticMemory as any).scope).toBe('org')
    })

    it('fns returns bound helpers', () => {
      const semRef = createMockSemRef()
      const ctx = mockCtx({ sem: semRef })
      const fns = semanticMemoryCapability.fns!(ctx as any)

      expect(typeof fns.addFact).toBe('function')
      expect(typeof fns.updateFact).toBe('function')
      expect(typeof fns.reinforce).toBe('function')
      expect(typeof fns.removeFact).toBe('function')
      expect(typeof fns.allFacts).toBe('function')
      expect(typeof fns.query).toBe('function')
    })

    it('addFact() creates a fact in the resource', async () => {
      const semRef = createMockSemRef()
      const ctx = mockCtx({ sem: semRef })
      const fns = semanticMemoryCapability.fns!(ctx as any)

      const fact = await fns.addFact({
        content: 'User is a software engineer',
        confidence: 0.9,
        category: 'profession',
        sourceEpisodeIds: ['ep_1'],
      })

      expect(fact.content).toBe('User is a software engineer')
      expect(fact.subject).toBe('user')
      expect(fact.id).toMatch(/^sf_/)
      expect(semRef.state.facts).toHaveLength(1)
    })

    it('updateFact() modifies fact content', async () => {
      const semRef = createMockSemRef()
      const ctx = mockCtx({ sem: semRef })
      const fns = semanticMemoryCapability.fns!(ctx as any)

      const fact = await fns.addFact({
        content: 'Works at Google',
        confidence: 0.8,
        category: 'profession',
        sourceEpisodeIds: ['ep_1'],
      })

      const updated = await fns.updateFact(fact.id, 'Works at Stripe', ['ep_2'])
      expect(updated?.content).toBe('Works at Stripe')
      expect(updated?.sourceEpisodeIds).toContain('ep_1')
      expect(updated?.sourceEpisodeIds).toContain('ep_2')
    })

    it('removeFact() deletes a fact', async () => {
      const semRef = createMockSemRef()
      const ctx = mockCtx({ sem: semRef })
      const fns = semanticMemoryCapability.fns!(ctx as any)

      const fact = await fns.addFact({
        content: 'temporary',
        confidence: 0.5,
        category: 'attribute',
        sourceEpisodeIds: [],
      })

      expect(semRef.state.facts).toHaveLength(1)
      await fns.removeFact(fact.id)
      expect(semRef.state.facts).toHaveLength(0)
    })

    it('query() searches facts by keyword', async () => {
      const semRef = createMockSemRef()
      const ctx = mockCtx({ sem: semRef })
      const fns = semanticMemoryCapability.fns!(ctx as any)

      await fns.addFact({
        content: 'Likes TypeScript',
        confidence: 0.9,
        category: 'preference',
        sourceEpisodeIds: [],
      })
      await fns.addFact({
        content: 'Lives in Tokyo',
        confidence: 0.8,
        category: 'identity',
        sourceEpisodeIds: [],
      })

      const all = fns.allFacts()
      expect(all).toHaveLength(2)
    })
  })

  // ---------------------------------------------------------------------------
  // Composed memory capability from system()
  // ---------------------------------------------------------------------------

  describe('system() capability integration', () => {
    it('system() returns capability fields', () => {
      const mem = system({
        model: 'intent/utility',
        working: true,
        episodic: true,
        semantic: true,
      })

      expect(mem.capability).toBeDefined()
      expect(mem.capability.__brand).toBe('Capability')
      expect(mem.workingMemoryCapability).toBeDefined()
      expect(mem.episodicMemoryCapability).toBeDefined()
      expect(mem.semanticMemoryCapability).toBeDefined()
    })

    it('composed capability has name "memory"', () => {
      const mem = system({
        model: 'intent/utility',
        working: true,
      })

      expect(mem.capability.name).toBe('memory')
    })

    it('composed capability uses working memory sub-capability', () => {
      const mem = system({
        model: 'intent/utility',
        working: true,
      })

      expect(mem.capability.uses).toBeDefined()
      expect(mem.capability.uses!.length).toBeGreaterThanOrEqual(1)
    })

    it('composed capability declares the five orthogonal section presets with the standard default-on set', () => {
      const mem = system({
        model: 'intent/utility',
        working: true,
        episodic: true,
        semantic: true,
        digest: true,
      })

      expect(mem.capability.__presetDefs).toBeDefined()
      expect(mem.capability.__presetDefs!.digest).toBeDefined()
      expect(mem.capability.__presetDefs!.working).toBeDefined()
      expect(mem.capability.__presetDefs!.semantic).toBeDefined()
      expect(mem.capability.__presetDefs!.episodic).toBeDefined()
      expect(mem.capability.__presetDefs!.recall).toBeDefined()
      // Default-on: digest + working + recall. semantic + episodic are opt-in.
      expect(mem.capability.__presetDefs!.default).toEqual(['digest', 'working', 'recall'])
    })

    it('digest + working presets register their own context entries; recall installs the recall tool', () => {
      const mem = system({
        model: 'intent/utility',
        working: true,
        episodic: true,
        semantic: true,
        digest: true,
      })

      const presets = mem.capability.__presetDefs as Record<string, {
        context?: { memory: unknown }
        tools?: () => unknown[]
      }>

      expect(presets.digest.context?.memory).toBeDefined()
      expect(presets.working.context?.memory).toBeDefined()
      expect(presets.recall.tools).toBeDefined()
      const recallTools = (presets.recall.tools as () => unknown[])()
      expect(Array.isArray(recallTools)).toBe(true)
      expect(recallTools.length).toBe(1)
    })

    it('digest preset is empty (no context entry) when digest tier is not configured', () => {
      const mem = system({
        model: 'intent/utility',
        working: true,
      })

      // Preset is still declared so `.presets({ digest: false })` doesn't
      // error, but it contributes nothing.
      const digestPreset = mem.capability.__presetDefs!.digest as {
        context?: unknown
      }
      expect(digestPreset.context).toBeUndefined()
    })

    it('semantic + episodic presets are empty when their tier is not configured', () => {
      const mem = system({
        model: 'intent/utility',
        working: true,
      })

      const semanticPreset = mem.capability.__presetDefs!.semantic as { context?: unknown }
      const episodicPreset = mem.capability.__presetDefs!.episodic as { context?: unknown }
      expect(semanticPreset.context).toBeUndefined()
      expect(episodicPreset.context).toBeUndefined()
    })

    it('composed capability fns expose recall', () => {
      const mem = system({
        model: 'intent/utility',
        working: true,
      })

      const wmRef = createMockWmRef()
      const ctx = mockCtx({ wm: wmRef })
      const fns = mem.capability.fns!(ctx as any)
      expect(typeof fns.recall).toBe('function')
    })

    it('recall() returns working memory entries', async () => {
      const mem = system({
        model: 'intent/utility',
        working: true,
      })

      const wmRef = createMockWmRef({
        entries: [{
          id: 'wm_1',
          content: 'User likes pizza',
          salience: 0.8,
          pinned: false,
          addedAtTurn: 0,
          lastAccessedAtTurn: 0,
          importance: 0.8,
          durability: 'session',
          category: 'preference',
        }],
      })
      const ctx = mockCtx({ wm: wmRef })
      const fns = mem.capability.fns!(ctx as any)

      const results = fns.recall()
      expect(results.length).toBeGreaterThanOrEqual(1)
      expect(results[0].content).toBe('User likes pizza')
      expect(results[0].source).toBe('working')
    })

    it('system() without episodic does not include episodic capability', () => {
      const mem = system({
        model: 'intent/utility',
        working: true,
      })

      expect(mem.episodicMemoryCapability).toBeUndefined()
      expect(mem.semanticMemoryCapability).toBeUndefined()
    })

    it('system() with episodic+semantic includes all capabilities', () => {
      const mem = system({
        model: 'intent/utility',
        working: true,
        episodic: true,
        semantic: true,
      })

      expect(mem.workingMemoryCapability).toBeDefined()
      expect(mem.episodicMemoryCapability).toBeDefined()
      expect(mem.semanticMemoryCapability).toBeDefined()
      expect(mem.capability.uses!.length).toBe(3)
    })

    it('tier capabilities from system() have correct names', () => {
      const mem = system({
        model: 'intent/utility',
        working: true,
        episodic: true,
        semantic: true,
      })

      expect(mem.workingMemoryCapability.name).toBe('workingMemory')
      expect(mem.episodicMemoryCapability!.name).toBe('episodicMemory')
      expect(mem.semanticMemoryCapability!.name).toBe('semanticMemory')
    })
  })

  // ---------------------------------------------------------------------------
  // Config propagation
  // ---------------------------------------------------------------------------

  describe('config propagation', () => {
    it('createWorkingMemoryCapability passes capacity to helpers', async () => {
      const cap = createWorkingMemoryCapability({ capacity: 3 })
      const wmRef = createMockWmRef()
      const ctx = mockCtx({ wm: wmRef })
      const fns = cap.fns!(ctx as any)

      // Fill to capacity
      await fns.add({ content: 'A', importance: 0.3 })
      await fns.add({ content: 'B', importance: 0.5 })
      await fns.add({ content: 'C', importance: 0.7 })
      expect(wmRef.state.entries).toHaveLength(3)

      // 4th entry evicts lowest salience
      await fns.add({ content: 'D', importance: 0.9 })
      expect(wmRef.state.entries).toHaveLength(3)
      expect(wmRef.state.entries.map((e) => e.content)).not.toContain('A')
    })

    it('createEpisodicMemoryCapability respects scope and maxEpisodes', async () => {
      const cap = createEpisodicMemoryCapability({
        scope: 'org',
        maxEpisodes: 2,
      })

      expect(cap.resources).toBeDefined()
      expect((cap.resources!.episodicMemory as any).scope).toBe('org')

      // Verify maxEpisodes by encoding 3 episodes
      const epRef = createMockEpRef()
      const refs: Record<string, unknown> = { episodicMemory: epRef }
      const ctx = {
        resources: {
          ...refs,
          get: (name: string) => refs[name],
          list: () => Object.values(refs),
        },
      }
      const fns = cap.fns!(ctx as any)

      await fns.encode({
        content: 'E1', occurredAtTurn: 1, significance: 0.5,
        category: 'event', context: { sessionId: 's1' },
      })
      await fns.encode({
        content: 'E2', occurredAtTurn: 2, significance: 0.6,
        category: 'event', context: { sessionId: 's1' },
      })
      await fns.encode({
        content: 'E3', occurredAtTurn: 3, significance: 0.7,
        category: 'event', context: { sessionId: 's1' },
      })

      // maxEpisodes is 2, so oldest should have been evicted
      expect(epRef.state.episodes).toHaveLength(2)
      expect(epRef.state.episodes.map((e) => e.content)).not.toContain('E1')
    })

    it('createSemanticMemoryCapability respects org scope', () => {
      const cap = createSemanticMemoryCapability({ scope: 'org' })
      expect(cap.resources).toBeDefined()
      expect(cap.resources!.semanticMemory).toBeDefined()
      expect((cap.resources!.semanticMemory as any).scope).toBe('org')
    })
  })

  // ---------------------------------------------------------------------------
  // Composed memory capability factory — createMemoryCapability (FIX-647)
  // ---------------------------------------------------------------------------

  describe('createMemoryCapability', () => {
    it('returns a defineCapability-branded object named "memory"', () => {
      const cap = createMemoryCapability({ model: 'intent/utility', working: true })
      expect(cap.__brand).toBe('Capability')
      expect(cap.name).toBe('memory')
    })

    it('sessionResources holds workingMemory + memorySystem; userResources empty for working-only', () => {
      const cap = createMemoryCapability({ model: 'intent/utility', working: true })
      expect(cap.sessionResources.workingMemory).toBeDefined()
      expect(cap.sessionResources.memorySystem).toBeDefined()
      expect(Object.keys(cap.userResources)).toHaveLength(0)
    })

    it('userResources gains a tier resource only when that tier is configured', () => {
      const epOnly = createMemoryCapability({ model: 'intent/utility', working: true, episodic: true })
      expect(epOnly.userResources.episodicMemory).toBeDefined()
      expect(epOnly.userResources.semanticMemory).toBeUndefined()
      expect(epOnly.userResources.digestMemory).toBeUndefined()

      const full = createMemoryCapability({
        model: 'intent/utility',
        working: true,
        episodic: true,
        semantic: true,
        digest: true,
      })
      expect(full.userResources.episodicMemory).toBeDefined()
      expect(full.userResources.semanticMemory).toBeDefined()
      expect(full.userResources.digestMemory).toBeDefined()
    })

    it('tiers.working is always defined; other tiers present only when configured', () => {
      const wmOnly = createMemoryCapability({ model: 'intent/utility', working: true })
      expect(wmOnly.tiers.working).toBeDefined()
      expect(wmOnly.tiers.episodic).toBeUndefined()
      expect(wmOnly.tiers.semantic).toBeUndefined()
      expect(wmOnly.tiers.digest).toBeUndefined()

      const full = createMemoryCapability({
        model: 'intent/utility',
        working: true,
        episodic: true,
        semantic: true,
        digest: true,
      })
      expect(full.tiers.working.name).toBe('workingMemory')
      expect(full.tiers.episodic!.name).toBe('episodicMemory')
      expect(full.tiers.semantic!.name).toBe('semanticMemory')
      expect(full.tiers.digest!.name).toBe('digestMemory')
    })

    it('attaches the SAME resource reference on userResources and the owning tier (FIX-435)', () => {
      const cap = createMemoryCapability({
        model: 'intent/utility',
        working: true,
        episodic: true,
        semantic: true,
        digest: true,
      })
      // The resource the caller registers must be the exact reference the tier
      // capability owns — divergent refs would conflict at mergeResourcesInto.
      expect(cap.sessionResources.workingMemory)
        .toBe(cap.tiers.working.resources!.workingMemory)
      expect(cap.userResources.episodicMemory)
        .toBe(cap.tiers.episodic!.resources!.episodicMemory)
      expect(cap.userResources.semanticMemory)
        .toBe(cap.tiers.semantic!.resources!.semanticMemory)
      expect(cap.userResources.digestMemory)
        .toBe(cap.tiers.digest!.resources!.digestMemory)
      // The tier capabilities the composed capability uses are the same refs.
      expect(cap.uses).toContain(cap.tiers.working)
      expect(cap.uses).toContain(cap.tiers.episodic)
    })

    it('declares the orthogonal presets with the standard default-on set', () => {
      const cap = createMemoryCapability({
        model: 'intent/utility',
        working: true,
        episodic: true,
        semantic: true,
        digest: true,
      })
      const defs = cap.__presetDefs!
      // `connect` is always declared (a no-op when relations are off), like the
      // tier presets — so it appears in the key set but not the default-on set.
      expect(Object.keys(defs).filter((k) => k !== 'default').sort())
        .toEqual(['connect', 'digest', 'episodic', 'recall', 'semantic', 'working'])
      expect(defs.default).toEqual(['digest', 'working', 'recall'])
    })

    it('connect preset joins the default-on set and carries a tools thunk when relations is enabled', () => {
      const cap = createMemoryCapability({
        model: 'intent/utility',
        working: true,
        episodic: true,
        semantic: { relations: true },
      })
      const defs = cap.__presetDefs as Record<string, { tools?: unknown }> & { default: string[] }
      expect(defs.default).toEqual(['digest', 'working', 'recall', 'connect'])
      expect(typeof defs.connect.tools).toBe('function')
    })

    it('connect preset is an empty no-op when relations is disabled', () => {
      const cap = createMemoryCapability({
        model: 'intent/utility',
        working: true,
        episodic: true,
        semantic: true,
      })
      const defs = cap.__presetDefs as Record<string, { tools?: unknown }>
      expect(defs.connect.tools).toBeUndefined()
    })

    it('digest/semantic/episodic presets are empty no-ops when their tier is absent', () => {
      const cap = createMemoryCapability({ model: 'intent/utility', working: true })
      const defs = cap.__presetDefs as Record<string, { context?: unknown; tools?: unknown }>
      expect(defs.digest.context).toBeUndefined()
      expect(defs.semantic.context).toBeUndefined()
      expect(defs.episodic.context).toBeUndefined()
      // working always carries a context entry
      expect(defs.working.context).toBeDefined()
    })

    it('recall preset tools slot is a thunk returning the recallToolBlock', () => {
      const cap = createMemoryCapability({ model: 'intent/utility', working: true, episodic: true })
      const recallPreset = cap.__presetDefs!.recall as { tools: () => unknown[] }
      expect(typeof recallPreset.tools).toBe('function')
      const tools = recallPreset.tools()
      expect(tools).toHaveLength(1)
      expect(tools[0]).toBe(cap.recallToolBlock)
    })

    it('fns.recall returns [] for an empty store and ranked items when data exists', () => {
      const cap = createMemoryCapability({ model: 'intent/utility', working: true })

      const emptyFns = cap.fns!(mockCtx({}) as any)
      expect(emptyFns.recall()).toEqual([])

      const wmRef = createMockWmRef({
        entries: [{
          id: 'wm_1', content: 'User likes pizza', salience: 0.8, pinned: false,
          addedAtTurn: 0, lastAccessedAtTurn: 0, importance: 0.8,
          durability: 'session', category: 'preference',
        }],
      })
      const fns = cap.fns!(mockCtx({ wm: wmRef }) as any)
      const results = fns.recall()
      expect(results[0].content).toBe('User likes pizza')
      expect(results[0].source).toBe('working')
    })

    it('throws on invalid tier dependencies and missing model', () => {
      expect(() => createMemoryCapability({ model: 'm', working: true, semantic: true }))
        .toThrow(/Semantic memory requires episodic/)
      expect(() => createMemoryCapability({ model: 'm', working: true, episodic: true, digest: true }))
        .toThrow(/Digest requires semantic/)
      expect(() => createMemoryCapability({ working: true } as any))
        .toThrow(/requires a `model`/)
    })

    it('hygiene: false ranks semantic facts by raw confidence (no decay)', () => {
      const cap = createMemoryCapability({
        model: 'intent/utility',
        working: true,
        episodic: true,
        semantic: true,
        hygiene: false,
      })
      const now = Date.now()
      const oldIso = new Date(now - 1000 * 60 * 60 * 24 * 365).toISOString() // a year ago
      const nowIso = new Date(now).toISOString()
      const semRef = createMockSemRef({
        facts: [
          { id: 'sf_old', subject: 'user', content: 'fact OLD', confidence: 0.9, category: 'identity', reinforcementCount: 1, sourceEpisodeIds: [], extractedAt: oldIso, lastReinforced: oldIso },
          { id: 'sf_new', subject: 'user', content: 'fact NEW', confidence: 0.8, category: 'identity', reinforcementCount: 1, sourceEpisodeIds: [], extractedAt: nowIso, lastReinforced: nowIso },
        ],
      })
      const fns = cap.fns!(mockCtx({ sem: semRef }) as any)
      const results = fns.recall().filter((r) => r.source === 'semantic')
      // No decay: the higher raw-confidence fact (OLD, 0.9) ranks first despite age.
      expect(results[0].id).toBe('sf_old')
    })

    it('hygiene confidenceDecay ranks a fresh fact above an aged one of equal raw confidence', () => {
      const cap = createMemoryCapability({
        model: 'intent/utility',
        working: true,
        episodic: true,
        semantic: true,
        hygiene: { confidenceDecay: { halfLife: 1 } },
      })
      const now = Date.now()
      const oldIso = new Date(now - 1000 * 60 * 60 * 24 * 30).toISOString() // 30 days ago (30 half-lives)
      const nowIso = new Date(now).toISOString()
      const semRef = createMockSemRef({
        facts: [
          { id: 'sf_aged', subject: 'user', content: 'fact aged', confidence: 0.9, category: 'identity', reinforcementCount: 1, sourceEpisodeIds: [], extractedAt: oldIso, lastReinforced: oldIso },
          { id: 'sf_fresh', subject: 'user', content: 'fact fresh', confidence: 0.9, category: 'identity', reinforcementCount: 1, sourceEpisodeIds: [], extractedAt: nowIso, lastReinforced: nowIso },
        ],
      })
      const fns = cap.fns!(mockCtx({ sem: semRef }) as any)
      const results = fns.recall().filter((r) => r.source === 'semantic')
      expect(results[0].id).toBe('sf_fresh')
    })

    it('system() reuses the factory: capability identity and shared resource refs', () => {
      const mem = system({
        model: 'intent/utility',
        working: true,
        episodic: true,
        semantic: true,
      })
      // The capability surface system() exposes uses the factory's resources.
      expect(mem.sessionResources.workingMemory)
        .toBe(mem.workingMemoryCapability.resources!.workingMemory)
      expect(mem.userResources.episodicMemory)
        .toBe(mem.episodicMemoryCapability!.resources!.episodicMemory)
      expect(mem.userResources.semanticMemory)
        .toBe(mem.semanticMemoryCapability!.resources!.semanticMemory)
    })

    it('AC3: a generator wired with uses:[createMemoryCapability(...)] gains memory resources + recall tool', () => {
      const cap = createMemoryCapability({
        model: 'intent/utility',
        working: true,
        episodic: true,
        semantic: true,
      })
      const gen = generator({
        name: 'reader',
        model: 'intent/utility',
        prompt: 'You are helpful.',
        uses: [cap],
      })
      // Resources installed through `uses` — no manual plumbing.
      expect(gen.declaredResources?.workingMemory).toBe(cap.sessionResources.workingMemory)
      expect(gen.declaredResources?.memorySystem).toBe(cap.sessionResources.memorySystem)
      expect(gen.declaredResources?.episodicMemory).toBe(cap.userResources.episodicMemory)
      expect(gen.declaredResources?.semanticMemory).toBe(cap.userResources.semanticMemory)
      // Recall tool reachable via the recall preset (default-on).
      const recallTools = (cap.__presetDefs!.recall as { tools: () => unknown[] }).tools()
      expect(recallTools[0]).toBe(cap.recallToolBlock)
    })
  })
})
