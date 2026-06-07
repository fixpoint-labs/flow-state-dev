/**
 * Relations write-side spec (FIX-745, Tasks 3+4).
 *
 * Locks the opt-in relation-edge behaviour folded into the semantic tier:
 * - DISABLED by default — zero new state, zero new behaviour (regression guard
 *   for the chat-personalization path).
 * - ENABLED — consolidation extracts typed directed edges between subjects and
 *   persists them onto the semantic resource's framework `edges` field with
 *   provenance, honouring vocabulary, implicit-entity, and supersede semantics.
 * - Cleanup — the janitor drops edges whose endpoints were culled.
 *
 * Edge writes flow through `ref.edges` (ResourceEdgeApi). In production the
 * framework attaches that API to the live ref; the mock refs here wire
 * `createResourceEdgeApi` the same way the server resource-registry does, so
 * the block code exercises the real API surface.
 */

import { describe, it, expect, vi } from 'vitest'
import { runForTest } from '@flow-state-dev/testing'
import type { ResourceHandle } from '@flow-state-dev/core'
import { system } from '../src/memory-system.js'
import { createResourceEdgeApi } from '@flow-state-dev/core/graph'
import type { EdgeSlotConfig } from '@flow-state-dev/core/graph'

import {
  createSemanticMemoryResource,
  semanticMemoryStateSchema,
} from '../src/semantic-memory.js'
import type { SemanticFact, SemanticMemoryState } from '../src/semantic-memory.js'
import { allEdges, knownSubjects } from '../src/semantic-memory-helpers.js'
import { workingMemoryStateSchema } from '../src/working-memory.js'
import type { WorkingMemoryState } from '../src/working-memory.js'
import { episodicMemoryStateSchema } from '../src/episodic-memory.js'
import type { EpisodicMemoryState } from '../src/episodic-memory.js'
import { memorySystemStateSchema } from '../src/memory-system.js'
import type { MemorySystemState } from '../src/memory-system.js'
import { janitorStateSchema } from '../src/janitor.js'
import type { JanitorState } from '../src/janitor.js'
import {
  consolidationPersist,
  type ConsolidationOutput,
} from '../src/memory-system-blocks.js'
import { memorySystemJanitor } from '../src/janitor-blocks.js'

// ---------------------------------------------------------------------------
// Mock resource refs
// ---------------------------------------------------------------------------

/**
 * Semantic mock ref. When `relations` is passed, attaches the real
 * `ResourceEdgeApi` over its own state, mirroring what the server
 * resource-registry does on the live ref.
 */
function createMockSemRef(
  initial?: Partial<SemanticMemoryState>,
  relations?: EdgeSlotConfig,
): ResourceHandle<SemanticMemoryState> {
  let state: SemanticMemoryState = {
    facts: [],
    totalExtracted: 0,
    totalConsolidations: 0,
    ...(relations ? { edges: [] } : {}),
    ...initial,
  } as SemanticMemoryState
  const ref = {
    name: 'semanticMemory',
    scope: 'user',
    get state() { return state },
    patchState: async (u: any) => { state = { ...state, ...u } as SemanticMemoryState },
    setState: async (n: any) => { state = n },
    updateState: async (fn: any) => { state = await fn(state) },
    readContent: async () => JSON.stringify(state),
    writeContent: async () => {},
    config: { stateSchema: semanticMemoryStateSchema, writable: true },
  } as unknown as ResourceHandle<SemanticMemoryState>
  if (relations) {
    ;(ref as { edges?: unknown }).edges = createResourceEdgeApi(ref as never, relations)
  }
  return ref
}

function createMockWmRef(initial?: Partial<WorkingMemoryState>): ResourceHandle<WorkingMemoryState> {
  let state: WorkingMemoryState = { entries: [], currentTurn: 0, ...initial }
  return {
    name: 'workingMemory',
    scope: 'session',
    get state() { return state },
    patchState: async (u) => { state = { ...state, ...u } as WorkingMemoryState },
    setState: async (n) => { state = n },
    updateState: async (fn) => { state = await fn(state) },
    readContent: async () => JSON.stringify(state),
    writeContent: async () => {},
    config: { stateSchema: workingMemoryStateSchema, writable: true },
  } as ResourceHandle<WorkingMemoryState>
}

function createMockSysRef(initial?: Partial<MemorySystemState>): ResourceHandle<MemorySystemState> {
  let state: MemorySystemState = {
    lastProcessedIndex: -1,
    episodicWritesSinceLastConsolidation: 0,
    evictedPersistentSinceLastConsolidation: 0,
    lastConsolidationTurn: 0,
    ...initial,
  }
  return {
    name: 'memorySystem',
    scope: 'session',
    get state() { return state },
    patchState: async (u) => { state = { ...state, ...u } as MemorySystemState },
    setState: async (n) => { state = n },
    updateState: async (fn) => { state = await fn(state) },
    readContent: async () => JSON.stringify(state),
    writeContent: async () => {},
    config: { stateSchema: memorySystemStateSchema, writable: true },
  } as ResourceHandle<MemorySystemState>
}

function createMockEpRef(initial?: Partial<EpisodicMemoryState>): ResourceHandle<EpisodicMemoryState> {
  let state: EpisodicMemoryState = { episodes: [], totalEncoded: 0, ...initial }
  return {
    name: 'episodicMemory',
    scope: 'user',
    get state() { return state },
    patchState: async (u) => { state = { ...state, ...u } as EpisodicMemoryState },
    setState: async (n) => { state = n },
    updateState: async (fn) => { state = await fn(state) },
    readContent: async () => JSON.stringify(state),
    writeContent: async () => {},
    config: { stateSchema: episodicMemoryStateSchema, writable: true },
  } as ResourceHandle<EpisodicMemoryState>
}

function createMockJanRef(initial?: Partial<JanitorState>): ResourceHandle<JanitorState> {
  let state: JanitorState = {
    lastRunTurn: 0,
    totalRuns: 0,
    lastCulledFactIds: [],
    lastCulledEpisodeIds: [],
    lastMarkedStaleEpisodeIds: [],
    ...initial,
  }
  return {
    name: 'janitor',
    scope: 'session',
    get state() { return state },
    patchState: async (u) => { state = { ...state, ...u } as JanitorState },
    setState: async (n) => { state = n },
    updateState: async (fn) => { state = await fn(state) },
    readContent: async () => JSON.stringify(state),
    writeContent: async () => {},
    config: { stateSchema: janitorStateSchema, writable: true },
  } as ResourceHandle<JanitorState>
}

function createMockResources(refs: Record<string, any>) {
  return {
    ...refs,
    get: (name: string) => refs[name],
    list: () => Object.values(refs),
  }
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

// Base config (relations disabled). Tests opt relations in per-case.
const baseConfig = {
  model: 'gpt-5-mini',
  working: { capacity: 7, maxPinnedSlots: 2, decay: { strategy: 'power-law' as const, rate: 0.5 } },
  episodic: { scope: 'user' as const, significanceThreshold: 0.6, maxEpisodes: 200 },
  semantic: {
    scope: 'user' as const,
    consolidation: { episodicThreshold: 5, onEviction: true, minInterval: 10 },
    pruneThreshold: 20,
  },
}

async function runPersist(
  config: any,
  semRef: ResourceHandle<SemanticMemoryState>,
  input: ConsolidationOutput,
  epRef: ResourceHandle<EpisodicMemoryState> = createMockEpRef(),
) {
  const block = consolidationPersist(config)
  const ctx = {
    resources: createMockResources({
      workingMemory: createMockWmRef({ currentTurn: 12 }),
      memorySystem: createMockSysRef({ episodicWritesSinceLastConsolidation: 6 }),
      semanticMemory: semRef,
      episodicMemory: epRef,
    }),
    response: { emit: async () => {} },
  } as any
  return runForTest(block, input as any, ctx)
}

// ---------------------------------------------------------------------------
// A. Relations DISABLED — regression guard
// ---------------------------------------------------------------------------

describe('memory/relations DISABLED (regression)', () => {
  it('createSemanticMemoryResource("user") declares no edges slot and no edges field', () => {
    const resource = createSemanticMemoryResource('user') as any
    expect(resource.edges).toBeUndefined()
    expect('edges' in (resource.default as object)).toBe(false)
    expect('edges' in resource.stateSchema.shape).toBe(false)
  })

  it('consolidation persist writes no edges when relations is off', async () => {
    const semRef = createMockSemRef() // no edge API attached
    const result = await runPersist(baseConfig, semRef, {
      facts: [{
        subject: 'user',
        content: 'Name is Jake',
        confidence: 0.9,
        category: 'identity',
        sourceEpisodeIds: ['ep1'],
        action: 'new',
        targetFactId: '',
      }],
      edges: [{
        from: 'user', to: 'moni', type: 'married to',
        confidence: 0.9, action: 'new', targetEdgeId: '',
      }],
    } as any) as any

    expect(result.added).toBe(1)
    // No edges field appeared on state — the personalization path is unchanged.
    expect('edges' in (semRef.state as object)).toBe(false)
    expect(allEdges(semRef as any)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// system() wiring — relations threads end-to-end
// ---------------------------------------------------------------------------

describe('memory/relations system() wiring', () => {
  it('semantic resource carries no edges field when relations is omitted', () => {
    const mem = system({
      model: 'gpt-5-mini',
      working: true,
      episodic: true,
      semantic: true,
    })
    const res = mem.userResources.semanticMemory as any
    expect(res.edges).toBeUndefined()
    expect('edges' in (res.default as object)).toBe(false)
  })

  it('semantic resource gains an edges slot when relations is enabled', () => {
    const mem = system({
      model: 'gpt-5-mini',
      working: true,
      episodic: true,
      semantic: { relations: true },
    })
    const res = mem.userResources.semanticMemory as any
    expect(res.edges).toBeDefined()
    expect('edges' in (res.default as object)).toBe(true)
  })

  it('forwards a curated vocabulary to the edge slot', () => {
    const mem = system({
      model: 'gpt-5-mini',
      working: true,
      episodic: true,
      semantic: { relations: { vocabulary: ['married to', 'works at'] } },
    })
    const res = mem.userResources.semanticMemory as any
    expect(res.edges.vocabulary).toEqual(['married to', 'works at'])
  })
})

// ---------------------------------------------------------------------------
// B. Relations ENABLED — extraction + persistence
// ---------------------------------------------------------------------------

describe('memory/relations ENABLED', () => {
  const relConfig = {
    ...baseConfig,
    semantic: { ...baseConfig.semantic, relations: {} as any },
  }

  it('createSemanticMemoryResource with relations declares an edges slot and field', () => {
    const resource = createSemanticMemoryResource('user', {}) as any
    expect(resource.edges).toBeDefined()
    expect('edges' in (resource.default as object)).toBe(true)
    expect('edges' in resource.stateSchema.shape).toBe(true)
  })

  it('persists a new edge between known subjects with provenance', async () => {
    const semRef = createMockSemRef(
      {
        facts: [
          makeFact({ id: 'sf_user', subject: 'user', content: 'Name is Jake' }),
          makeFact({ id: 'sf_moni', subject: 'moni', content: "Is the user's wife" }),
        ],
      },
      {},
    )

    await runPersist(relConfig, semRef, {
      facts: [],
      edges: [{
        from: 'User', to: 'Moni', type: 'married to',
        confidence: 0.9, action: 'new', targetEdgeId: '',
      }],
    } as any)

    const edges = allEdges(semRef as any)
    expect(edges).toHaveLength(1)
    expect(edges[0].from).toBe('user')
    expect(edges[0].to).toBe('moni')
    expect(edges[0].type).toBe('married to')
    expect(edges[0].confidence).toBe(0.9)
    // Provenance: empty here (no source episode ids on the edge proposal),
    // but the field is present so recall can attribute later.
    expect(Array.isArray(edges[0].source)).toBe(true)
  })

  it('dedups a duplicate new edge into a reinforcement (single active edge)', async () => {
    const semRef = createMockSemRef(
      {
        facts: [
          makeFact({ id: 'sf_user', subject: 'user' }),
          makeFact({ id: 'sf_moni', subject: 'moni' }),
        ],
      },
      {},
    )

    const input = {
      facts: [],
      edges: [{
        from: 'user', to: 'moni', type: 'married to',
        confidence: 0.8, action: 'new', targetEdgeId: '',
      }],
    } as any

    await runPersist(relConfig, semRef, input)
    await runPersist(relConfig, semRef, input)

    // Second identical 'new' is treated as reinforce — still one active edge.
    const active = allEdges(semRef as any, { at: new Date().toISOString() })
    expect(active).toHaveLength(1)
    expect(active[0].confidence).toBeGreaterThanOrEqual(0.8)
  })

  it('supersede sets validUntil — old edge excluded from active set', async () => {
    const semRef = createMockSemRef(
      { facts: [makeFact({ id: 'sf_user', subject: 'user' }), makeFact({ id: 'sf_acme', subject: 'acme' }), makeFact({ id: 'sf_stripe', subject: 'stripe' })] },
      {},
    )

    // Seed an edge to supersede.
    await runPersist(relConfig, semRef, {
      facts: [],
      edges: [{ from: 'user', to: 'acme', type: 'works at', confidence: 0.8, action: 'new', targetEdgeId: '' }],
    } as any)

    const seeded = allEdges(semRef as any)
    expect(seeded).toHaveLength(1)
    const oldId = seeded[0].id

    // Supersede it and add the replacement.
    await runPersist(relConfig, semRef, {
      facts: [],
      edges: [{ from: 'user', to: 'stripe', type: 'works at', confidence: 0.9, action: 'supersede', targetEdgeId: oldId }],
    } as any)

    const now = new Date().toISOString()
    const all = allEdges(semRef as any)
    const active = allEdges(semRef as any, { at: now })

    // Old edge retained in the full set but excluded from active.
    expect(all.find((e) => e.id === oldId)?.validUntil).not.toBeNull()
    expect(active.find((e) => e.id === oldId)).toBeUndefined()
    // Replacement present and active.
    expect(active.find((e) => e.to === 'stripe')).toBeDefined()
  })

  it('drops an out-of-vocab edge type when vocabulary is set, warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const vocab = { vocabulary: ['married to', 'works at'] }
    const semRef = createMockSemRef(
      { facts: [makeFact({ id: 'sf_user', subject: 'user' }), makeFact({ id: 'sf_moni', subject: 'moni' })] },
      vocab,
    )
    const cfg = { ...baseConfig, semantic: { ...baseConfig.semantic, relations: vocab as any } }

    await runPersist(cfg, semRef, {
      facts: [],
      edges: [{ from: 'user', to: 'moni', type: 'despises', confidence: 0.7, action: 'new', targetEdgeId: '' }],
    } as any)

    expect(allEdges(semRef as any)).toHaveLength(0)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('vocab'))
    warn.mockRestore()
  })

  it('keeps a free-text edge type when no vocabulary is set', async () => {
    const semRef = createMockSemRef(
      { facts: [makeFact({ id: 'sf_user', subject: 'user' }), makeFact({ id: 'sf_moni', subject: 'moni' })] },
      {},
    )
    await runPersist(relConfig, semRef, {
      facts: [],
      edges: [{ from: 'user', to: 'moni', type: 'occasionally argues with', confidence: 0.6, action: 'new', targetEdgeId: '' }],
    } as any)
    expect(allEdges(semRef as any)).toHaveLength(1)
  })

  it('drops an edge with an unknown endpoint by default', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const semRef = createMockSemRef(
      { facts: [makeFact({ id: 'sf_user', subject: 'user' })] },
      {},
    )
    await runPersist(relConfig, semRef, {
      facts: [],
      edges: [{ from: 'user', to: 'ghost', type: 'knows', confidence: 0.6, action: 'new', targetEdgeId: '' }],
    } as any)
    expect(allEdges(semRef as any)).toHaveLength(0)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('mints an unknown endpoint when createImplicitEntities is true', async () => {
    const rel = { createImplicitEntities: true }
    const semRef = createMockSemRef(
      { facts: [makeFact({ id: 'sf_user', subject: 'user' })] },
      {},
    )
    const cfg = { ...baseConfig, semantic: { ...baseConfig.semantic, relations: rel as any } }
    await runPersist(cfg, semRef, {
      facts: [],
      edges: [{ from: 'user', to: 'ghost', type: 'knows', confidence: 0.6, action: 'new', targetEdgeId: '' }],
    } as any)
    const edges = allEdges(semRef as any)
    expect(edges).toHaveLength(1)
    expect(edges[0].to).toBe('ghost')
  })

  it('does not rewrite any fact subject when extracting edges (FIX-703 invariant)', async () => {
    const semRef = createMockSemRef(
      {
        facts: [
          makeFact({ id: 'sf_user', subject: 'user', content: 'Name is Jake' }),
          makeFact({ id: 'sf_moni', subject: 'moni', content: "Is the user's wife" }),
        ],
      },
      {},
    )
    await runPersist(relConfig, semRef, {
      facts: [],
      edges: [{ from: 'user', to: 'moni', type: 'married to', confidence: 0.9, action: 'new', targetEdgeId: '' }],
    } as any)

    expect(semRef.state.facts.find((f) => f.id === 'sf_user')?.subject).toBe('user')
    expect(semRef.state.facts.find((f) => f.id === 'sf_moni')?.subject).toBe('moni')
    expect(semRef.state.facts.find((f) => f.id === 'sf_user')?.content).toBe('Name is Jake')
  })
})

// ---------------------------------------------------------------------------
// D. Cleanup — dangling-edge removal
// ---------------------------------------------------------------------------

describe('memory/relations cleanup', () => {
  it('janitor prunes edges whose endpoint subject was culled', async () => {
    // A fact about "ghost" exists, then is removed; an edge user→ghost dangles.
    const rel = {}
    const semRef = createMockSemRef(
      { facts: [makeFact({ id: 'sf_user', subject: 'user' })] },
      rel,
    )
    // Seed an edge whose 'to' endpoint has no corresponding fact subject.
    await semRef.updateState((s) => ({
      ...s,
      edges: [
        {
          id: 'e_keep', from: 'user', to: 'user', type: 'self',
          confidence: 1, validFrom: null, validUntil: null, source: [],
          createdAt: new Date().toISOString(),
        },
        {
          id: 'e_dangle', from: 'user', to: 'ghost', type: 'knew',
          confidence: 1, validFrom: null, validUntil: null, source: [],
          createdAt: new Date().toISOString(),
        },
      ],
    }) as any)

    expect(knownSubjects(semRef as any)).toEqual(new Set(['user']))

    const cfg = {
      ...baseConfig,
      semantic: { ...baseConfig.semantic, relations: rel as any },
      _semanticResource: semRef as any,
      hygiene: {
        confidenceDecay: false as const,
        episodicTTL: false as const,
        schedule: 'onConsolidation' as const,
      },
    }
    const block = memorySystemJanitor(cfg as any)
    const ctx = {
      resources: createMockResources({
        workingMemory: createMockWmRef({ currentTurn: 5 }),
        memorySystem: createMockSysRef(),
        janitor: createMockJanRef(),
        semanticMemory: semRef,
      }),
      response: { emit: async () => {} },
    } as any
    await runForTest(block, {} as any, ctx)

    const edges = allEdges(semRef as any)
    expect(edges.map((e) => e.id)).toEqual(['e_keep'])
  })
})
