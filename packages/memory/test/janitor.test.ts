/**
 * Tests for FIX-411: confidence decay + durability-TTL janitor.
 *
 * Covers:
 *   - effectiveConfidence formula and clamps
 *   - addFact V1 bug fix (lastReinforced populated on creation)
 *   - cullByEffectiveConfidence
 *   - cullByTTL (operator OR/AND, durability gating)
 *   - markStale idempotency
 *   - memorySystemJanitor end-to-end
 *   - factory plumbing (default-on, schedule routing, hygiene: false revert)
 *   - ranking sites (createRecall + intrinsicSemanticScore)
 *   - config validation (halfLife <= 0, cullFloor out of range)
 */

import { runForTest } from '@flow-state-dev/testing'
import { describe, it, expect } from 'vitest'
import type { ResourceHandle } from '@flow-state-dev/core'
import {
  workingMemoryStateSchema,
} from '../src/working-memory.js'
import type { WorkingMemoryState } from '../src/working-memory.js'
import {
  episodicMemoryStateSchema,
} from '../src/episodic-memory.js'
import type { Episode, EpisodicMemoryState } from '../src/episodic-memory.js'
import {
  semanticMemoryStateSchema,
} from '../src/semantic-memory.js'
import type { SemanticFact, SemanticMemoryState } from '../src/semantic-memory.js'
import {
  memorySystemStateSchema,
} from '../src/memory-system.js'
import type { MemorySystemState } from '../src/memory-system.js'
import { addFact, cullByEffectiveConfidence } from '../src/semantic-memory-helpers.js'
import { cullByTTL, markStale } from '../src/episodic-memory-helpers.js'
import {
  effectiveConfidence,
  janitorStateSchema,
  DEFAULT_HYGIENE_CONFIG,
} from '../src/janitor.js'
import type { JanitorState } from '../src/janitor.js'
import { memorySystemJanitor } from '../src/janitor-blocks.js'
import { system } from '../src/memory-system.js'
import { intrinsicSemanticScore } from '../src/tools/strategies/llm-filter-strategy.js'

const DAY = 1000 * 60 * 60 * 24

// ---------------------------------------------------------------------------
// Test ref factories
// ---------------------------------------------------------------------------

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
    get state() { return state; },
    patchState: async (u) => { state = { ...state, ...u } as SemanticMemoryState },
    setState: async (n) => { state = n },
    updateState: async (fn) => { state = await fn(state) },
    readContent: async () => JSON.stringify(state),
    writeContent: async () => {},
    config: { stateSchema: semanticMemoryStateSchema, writable: true },
  } as ResourceHandle<SemanticMemoryState>
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
    get state() { return state; },
    patchState: async (u) => { state = { ...state, ...u } as EpisodicMemoryState },
    setState: async (n) => { state = n },
    updateState: async (fn) => { state = await fn(state) },
    readContent: async () => JSON.stringify(state),
    writeContent: async () => {},
    config: { stateSchema: episodicMemoryStateSchema, writable: true },
  } as ResourceHandle<EpisodicMemoryState>
}

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
    get state() { return state; },
    patchState: async (u) => { state = { ...state, ...u } as WorkingMemoryState },
    setState: async (n) => { state = n },
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
    get state() { return state; },
    patchState: async (u) => { state = { ...state, ...u } as MemorySystemState },
    setState: async (n) => { state = n },
    updateState: async (fn) => { state = await fn(state) },
    readContent: async () => JSON.stringify(state),
    writeContent: async () => {},
    config: { stateSchema: memorySystemStateSchema, writable: true },
  } as ResourceHandle<MemorySystemState>
}

function createMockJanitorRef(
  initialState?: Partial<JanitorState>,
): ResourceHandle<JanitorState> {
  let state: JanitorState = {
    lastRunTurn: 0,
    totalRuns: 0,
    lastCulledFactIds: [],
    lastCulledEpisodeIds: [],
    lastMarkedStaleEpisodeIds: [],
    ...initialState,
  }
  return {
    name: 'janitor',
    scope: 'session',
    get state() { return state; },
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
    confidence: 0.8,
    category: 'identity',
    sourceEpisodeIds: [],
    extractedAt: '2026-01-01T00:00:00.000Z',
    lastReinforced: '2026-01-01T00:00:00.000Z',
    reinforcementCount: 1,
    ...overrides,
  }
}

function makeEpisode(overrides: Partial<Episode> & { id: string }): Episode {
  return {
    content: `episode ${overrides.id}`,
    occurredAtTurn: 0,
    encodedAt: '2026-01-01T00:00:00.000Z',
    significance: 0.7,
    category: 'identity',
    context: { sessionId: 'test-session' },
    consolidated: false,
    durability: 'persistent',
    stale: false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 1. effectiveConfidence
// ---------------------------------------------------------------------------

describe('memory/janitor — effectiveConfidence', () => {
  it('returns raw confidence at zero elapsed', () => {
    const fact = makeFact({ id: 'a', confidence: 0.8, lastReinforced: '2026-01-01T00:00:00.000Z' })
    const now = Date.parse('2026-01-01T00:00:00.000Z')
    expect(effectiveConfidence(fact, now, 180)).toBe(0.8)
  })

  it('returns half raw confidence at one half-life', () => {
    const fact = makeFact({ id: 'a', confidence: 0.8, lastReinforced: '2026-01-01T00:00:00.000Z' })
    const now = Date.parse('2026-01-01T00:00:00.000Z') + 180 * DAY
    expect(effectiveConfidence(fact, now, 180)).toBeCloseTo(0.4, 5)
  })

  it('returns quarter raw confidence at two half-lives', () => {
    const fact = makeFact({ id: 'a', confidence: 0.8, lastReinforced: '2026-01-01T00:00:00.000Z' })
    const now = Date.parse('2026-01-01T00:00:00.000Z') + 360 * DAY
    expect(effectiveConfidence(fact, now, 180)).toBeCloseTo(0.2, 5)
  })

  it('falls back to extractedAt when lastReinforced is missing', () => {
    const fact = {
      id: 'a',
      subject: 'user',
      content: 'x',
      confidence: 0.6,
      category: 'identity' as const,
      sourceEpisodeIds: [],
      extractedAt: '2026-01-01T00:00:00.000Z',
      // lastReinforced intentionally omitted
      reinforcementCount: 1,
    }
    const now = Date.parse('2026-01-01T00:00:00.000Z') + 180 * DAY
    expect(effectiveConfidence(fact, now, 180)).toBeCloseTo(0.3, 5)
  })

  it('clamps to raw confidence when elapsed is negative (clock skew)', () => {
    const fact = makeFact({ id: 'a', confidence: 0.8, lastReinforced: '2026-06-01T00:00:00.000Z' })
    const now = Date.parse('2026-01-01T00:00:00.000Z')
    expect(effectiveConfidence(fact, now, 180)).toBe(0.8)
  })

  it('uses default half-life when not specified', () => {
    const fact = makeFact({ id: 'a', confidence: 1, lastReinforced: '2026-01-01T00:00:00.000Z' })
    const now = Date.parse('2026-01-01T00:00:00.000Z') + DEFAULT_HYGIENE_CONFIG.confidenceDecay.halfLife * DAY
    expect(effectiveConfidence(fact, now)).toBeCloseTo(0.5, 5)
  })
})

// ---------------------------------------------------------------------------
// 2. addFact V1 bug fix
// ---------------------------------------------------------------------------

describe('memory/janitor — addFact lastReinforced fix', () => {
  it('populates lastReinforced on new facts (matches extractedAt)', async () => {
    const ref = createMockSemRef()
    const f = await addFact(ref, {
      content: 'User name is Jake',
      confidence: 0.7,
      category: 'identity',
      sourceEpisodeIds: [],
    })
    expect(f.lastReinforced).toBeDefined()
    expect(f.lastReinforced).toBe(f.extractedAt)
  })
})

// ---------------------------------------------------------------------------
// 3. cullByEffectiveConfidence
// ---------------------------------------------------------------------------

describe('memory/janitor — cullByEffectiveConfidence', () => {
  it('removes facts whose effective confidence is below floor', async () => {
    const fact = makeFact({
      id: 'sf1',
      confidence: 0.2,
      lastReinforced: '2026-01-01T00:00:00.000Z',
    })
    const ref = createMockSemRef({ facts: [fact], totalExtracted: 1 })
    const now = Date.parse('2026-01-01T00:00:00.000Z') + 200 * DAY
    const culled = await cullByEffectiveConfidence(ref, now, 30, 0.1)
    expect(culled).toEqual(['sf1'])
    expect((ref.state).facts).toEqual([])
  })

  it('keeps facts at or above the floor', async () => {
    const fact = makeFact({
      id: 'sf1',
      confidence: 0.8,
      lastReinforced: '2026-01-01T00:00:00.000Z',
    })
    const ref = createMockSemRef({ facts: [fact], totalExtracted: 1 })
    const now = Date.parse('2026-01-01T00:00:00.000Z') + 100 * DAY
    const culled = await cullByEffectiveConfidence(ref, now, 180, 0.1)
    expect(culled).toEqual([])
    expect((ref.state).facts).toHaveLength(1)
  })

  it('returns culled IDs and leaves survivors in place', async () => {
    const fresh = makeFact({
      id: 'fresh',
      confidence: 0.9,
      lastReinforced: '2026-05-30T00:00:00.000Z',
    })
    const ancient = makeFact({
      id: 'ancient',
      confidence: 0.5,
      lastReinforced: '2025-01-01T00:00:00.000Z',
    })
    const ref = createMockSemRef({ facts: [fresh, ancient], totalExtracted: 2 })
    const now = Date.parse('2026-06-01T00:00:00.000Z')
    const culled = await cullByEffectiveConfidence(ref, now, 30, 0.1)
    expect(culled).toEqual(['ancient'])
    expect((ref.state).facts.map((f) => f.id)).toEqual(['fresh'])
  })
})

// ---------------------------------------------------------------------------
// 4. cullByTTL
// ---------------------------------------------------------------------------

describe('memory/janitor — cullByTTL', () => {
  it('culls persistent episodes past the turn threshold (operator OR)', async () => {
    const ep = makeEpisode({ id: 'ep1', occurredAtTurn: 50, durability: 'persistent' })
    const ref = createMockEpRef({ episodes: [ep], totalEncoded: 1 })
    const culled = await cullByTTL(ref, 600, Date.parse('2026-01-02T00:00:00.000Z'), {
      persistentTurns: 500,
      persistentDays: 365,
      operator: 'OR',
    })
    expect(culled).toEqual(['ep1'])
    expect((ref.state).episodes).toEqual([])
  })

  it('culls persistent episodes past the wall-time threshold (operator OR)', async () => {
    const ep = makeEpisode({
      id: 'ep1',
      occurredAtTurn: 0,
      encodedAt: '2026-01-01T00:00:00.000Z',
      durability: 'persistent',
    })
    const ref = createMockEpRef({ episodes: [ep], totalEncoded: 1 })
    const now = Date.parse('2026-01-01T00:00:00.000Z') + 120 * DAY
    const culled = await cullByTTL(ref, 0, now, {
      persistentTurns: 10_000,
      persistentDays: 90,
      operator: 'OR',
    })
    expect(culled).toEqual(['ep1'])
  })

  it("with operator 'AND' requires both thresholds to fire", async () => {
    const ep = makeEpisode({
      id: 'ep1',
      occurredAtTurn: 50,
      encodedAt: '2026-01-01T00:00:00.000Z',
      durability: 'persistent',
    })
    const ref = createMockEpRef({ episodes: [ep], totalEncoded: 1 })
    // Turn threshold fires (600 - 50 = 550 > 500) but day threshold does NOT (10 < 90).
    const now = Date.parse('2026-01-01T00:00:00.000Z') + 10 * DAY
    const culled = await cullByTTL(ref, 600, now, {
      persistentTurns: 500,
      persistentDays: 90,
      operator: 'AND',
    })
    expect(culled).toEqual([])
    expect((ref.state).episodes).toHaveLength(1)
  })

  it('never culls permanent episodes', async () => {
    const ep = makeEpisode({
      id: 'ep1',
      occurredAtTurn: 0,
      encodedAt: '2024-01-01T00:00:00.000Z',
      durability: 'permanent',
    })
    const ref = createMockEpRef({ episodes: [ep], totalEncoded: 1 })
    const culled = await cullByTTL(ref, 9999, Date.now(), {
      persistentTurns: 1,
      persistentDays: 1,
      operator: 'OR',
    })
    expect(culled).toEqual([])
    expect((ref.state).episodes).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// 5. markStale
// ---------------------------------------------------------------------------

describe('memory/janitor — markStale', () => {
  it('flips stale on permanent episodes past the silence threshold', async () => {
    const ep = makeEpisode({
      id: 'ep1',
      durability: 'permanent',
      encodedAt: '2025-01-01T00:00:00.000Z',
      stale: false,
    })
    const ref = createMockEpRef({ episodes: [ep], totalEncoded: 1 })
    const now = Date.parse('2026-01-01T00:00:00.000Z')
    const marked = await markStale(ref, now, 180)
    expect(marked).toEqual(['ep1'])
    expect((ref.state).episodes[0].stale).toBe(true)
  })

  it('leaves persistent episodes untouched', async () => {
    const ep = makeEpisode({
      id: 'ep1',
      durability: 'persistent',
      encodedAt: '2025-01-01T00:00:00.000Z',
    })
    const ref = createMockEpRef({ episodes: [ep], totalEncoded: 1 })
    const marked = await markStale(ref, Date.parse('2026-01-01T00:00:00.000Z'), 180)
    expect(marked).toEqual([])
    expect((ref.state).episodes[0].stale).toBe(false)
  })

  it('is idempotent — already-stale episodes are not re-marked', async () => {
    const ep = makeEpisode({
      id: 'ep1',
      durability: 'permanent',
      encodedAt: '2025-01-01T00:00:00.000Z',
      stale: true,
    })
    const ref = createMockEpRef({ episodes: [ep], totalEncoded: 1 })
    const marked = await markStale(ref, Date.parse('2026-01-01T00:00:00.000Z'), 180)
    expect(marked).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 6. memorySystemJanitor block
// ---------------------------------------------------------------------------

describe('memory/janitor — memorySystemJanitor block', () => {
  const baseConfig: any = {
    name: 'test',
    model: 'gpt-test',
    working: { capacity: 5, maxPinnedSlots: 2, decay: { strategy: 'linear', rate: 0.1 } },
    episodic: { scope: 'user', significanceThreshold: 0.6, maxEpisodes: 100 },
    semantic: { scope: 'user', consolidation: { episodicThreshold: 5, onEviction: true, minInterval: 4 } },
    hygiene: {
      confidenceDecay: { halfLife: 30, cullFloor: 0.1 },
      episodicTTL: { persistentTurns: 100, persistentDays: 30, operator: 'OR' as const, permanentStaleDays: 180 },
      schedule: 'manual' as const,
    },
  }

  async function runJanitor(opts: {
    facts?: SemanticFact[]
    episodes?: Episode[]
    currentTurn?: number
    config?: any
  } = {}) {
    const wmRef = createMockWmRef({ currentTurn: opts.currentTurn ?? 0 })
    const sysRef = createMockSysRef()
    const janRef = createMockJanitorRef()
    const semRef = createMockSemRef({ facts: opts.facts ?? [], totalExtracted: opts.facts?.length ?? 0 })
    const epRef = createMockEpRef({ episodes: opts.episodes ?? [], totalEncoded: opts.episodes?.length ?? 0 })

    const block = memorySystemJanitor(opts.config ?? baseConfig)
    const ctx = {
      resources: createMockResources({
        workingMemory: wmRef,
        memorySystem: sysRef,
        janitor: janRef,
        semanticMemory: semRef,
        episodicMemory: epRef,
      }),
      session: { items: { all: () => [] }, instanceId: 'test' },
      response: { emit: async () => {} },
    } as any
    await runForTest(block, undefined as any, ctx)
    return { semRef, epRef, janRef, wmRef }
  }

  it('culls decayed facts, evicts persistent episodes, marks permanents stale, records on the janitor resource', async () => {
    const decayed = makeFact({
      id: 'decayed',
      confidence: 0.5,
      lastReinforced: new Date(Date.now() - 365 * DAY).toISOString(),
    })
    const fresh = makeFact({
      id: 'fresh',
      confidence: 0.9,
      lastReinforced: new Date(Date.now() - 1 * DAY).toISOString(),
    })
    const oldPersistent = makeEpisode({
      id: 'oldp',
      occurredAtTurn: 0,
      durability: 'persistent',
      encodedAt: new Date(Date.now() - 365 * DAY).toISOString(),
    })
    const recentPersistent = makeEpisode({
      id: 'recp',
      occurredAtTurn: 1000,
      durability: 'persistent',
      encodedAt: new Date().toISOString(),
    })
    const oldPermanent = makeEpisode({
      id: 'oldperm',
      occurredAtTurn: 0,
      durability: 'permanent',
      encodedAt: new Date(Date.now() - 365 * DAY).toISOString(),
    })

    const { semRef, epRef, janRef } = await runJanitor({
      facts: [decayed, fresh],
      episodes: [oldPersistent, recentPersistent, oldPermanent],
      currentTurn: 1001,
    })

    expect((semRef.state).facts.map((f) => f.id)).toEqual(['fresh'])
    // oldPersistent culled; oldPermanent kept; recentPersistent kept
    expect((epRef.state).episodes.map((e) => e.id).sort()).toEqual(['oldperm', 'recp'])
    expect((epRef.state).episodes.find((e) => e.id === 'oldperm')!.stale).toBe(true)
    expect((janRef.state).totalRuns).toBe(1)
    expect((janRef.state).lastCulledFactIds).toEqual(['decayed'])
    expect((janRef.state).lastCulledEpisodeIds).toEqual(['oldp'])
    expect((janRef.state).lastMarkedStaleEpisodeIds).toEqual(['oldperm'])
    expect((janRef.state).lastRunAt).toBeDefined()
    expect((janRef.state).lastRunTurn).toBe(1001)
  })

  it('is a no-op when both stores are empty', async () => {
    const { janRef } = await runJanitor()
    expect((janRef.state).totalRuns).toBe(1)
    expect((janRef.state).lastCulledFactIds).toEqual([])
    expect((janRef.state).lastCulledEpisodeIds).toEqual([])
  })

  it('skips the semantic branch when confidenceDecay is false', async () => {
    const decayed = makeFact({
      id: 'decayed',
      confidence: 0.1,
      lastReinforced: new Date(Date.now() - 365 * DAY).toISOString(),
    })
    const cfg = { ...baseConfig, hygiene: { ...baseConfig.hygiene, confidenceDecay: false } }
    const { semRef, janRef } = await runJanitor({ facts: [decayed], config: cfg })
    expect((semRef.state).facts).toHaveLength(1)
    expect((janRef.state).lastCulledFactIds).toEqual([])
  })

  it('skips the episodic branch when episodicTTL is false', async () => {
    const oldp = makeEpisode({
      id: 'oldp',
      durability: 'persistent',
      encodedAt: new Date(Date.now() - 365 * DAY).toISOString(),
    })
    const cfg = { ...baseConfig, hygiene: { ...baseConfig.hygiene, episodicTTL: false } }
    const { epRef, janRef } = await runJanitor({ episodes: [oldp], config: cfg })
    expect((epRef.state).episodes).toHaveLength(1)
    expect((janRef.state).lastCulledEpisodeIds).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 7. system() factory plumbing
// ---------------------------------------------------------------------------

describe('memory/janitor — system() factory plumbing', () => {
  it('exposes mem.janitor and mem.janitorResource by default when semantic is configured', () => {
    const mem = system({
      model: 'gpt-test',
      working: true,
      episodic: true,
      semantic: true,
    })
    expect(mem.janitor).toBeDefined()
    expect(mem.janitorResource).toBeDefined()
    expect(mem.sessionResources.janitor).toBeDefined()
  })

  it('does not expose janitor when hygiene is explicitly false', () => {
    const mem = system({
      model: 'gpt-test',
      working: true,
      episodic: true,
      semantic: true,
      hygiene: false,
    })
    expect(mem.janitor).toBeUndefined()
    expect(mem.sessionResources.janitor).toBeUndefined()
  })

  it('does not expose janitor when neither semantic nor episodic is configured', () => {
    const mem = system({ model: 'gpt-test', working: true })
    expect(mem.janitor).toBeUndefined()
  })

  it('exposes janitor for an episodic-only configuration (no semantic)', () => {
    const mem = system({
      model: 'gpt-test',
      working: true,
      episodic: true,
    })
    expect(mem.janitor).toBeDefined()
    expect(mem.janitorResource).toBeDefined()
  })

  it('accepts partial overrides (halfLife only) and preserves other defaults', () => {
    const mem = system({
      model: 'gpt-test',
      working: true,
      episodic: true,
      semantic: true,
      hygiene: { confidenceDecay: { halfLife: 30 } },
    })
    expect(mem.janitor).toBeDefined()
  })

  it('throws on halfLife <= 0', () => {
    expect(() => system({
      model: 'gpt-test',
      working: true,
      episodic: true,
      semantic: true,
      hygiene: { confidenceDecay: { halfLife: 0 } },
    })).toThrow(/halfLife must be > 0/)
  })

  it('throws on cullFloor out of range', () => {
    expect(() => system({
      model: 'gpt-test',
      working: true,
      episodic: true,
      semantic: true,
      hygiene: { confidenceDecay: { cullFloor: 1.5 } },
    })).toThrow(/cullFloor/)
  })

  it('throws on episodicTTL persistentTurns <= 0', () => {
    expect(() => system({
      model: 'gpt-test',
      working: true,
      episodic: true,
      hygiene: { episodicTTL: { persistentTurns: 0 } },
    })).toThrow(/persistentTurns must be > 0/)
  })

  it('throws on episodicTTL persistentDays <= 0', () => {
    expect(() => system({
      model: 'gpt-test',
      working: true,
      episodic: true,
      hygiene: { episodicTTL: { persistentDays: 0 } },
    })).toThrow(/persistentDays must be > 0/)
  })

  it('throws on episodicTTL permanentStaleDays <= 0', () => {
    expect(() => system({
      model: 'gpt-test',
      working: true,
      episodic: true,
      hygiene: { episodicTTL: { permanentStaleDays: 0 } },
    })).toThrow(/permanentStaleDays must be > 0/)
  })
})

// ---------------------------------------------------------------------------
// 8. Ranking sites use effectiveConfidence
// ---------------------------------------------------------------------------

describe('memory/janitor — ranking sites use effectiveConfidence', () => {
  it('intrinsicSemanticScore deprioritizes older facts of the same raw confidence', () => {
    const now = Date.parse('2026-06-01T00:00:00.000Z')
    const old = makeFact({ id: 'old', confidence: 0.8, lastReinforced: '2026-01-01T00:00:00.000Z' })
    const fresh = makeFact({ id: 'fresh', confidence: 0.8, lastReinforced: '2026-05-30T00:00:00.000Z' })
    const oldScore = intrinsicSemanticScore(old, now, 30)
    const freshScore = intrinsicSemanticScore(fresh, now, 30)
    expect(freshScore).toBeGreaterThan(oldScore)
  })

  it('createRecall ranks fresh facts higher than ancient facts of the same raw confidence (hygiene on)', async () => {
    const mem = system({
      model: 'gpt-test',
      working: true,
      episodic: true,
      semantic: true,
      hygiene: { confidenceDecay: { halfLife: 30 } },
    })
    const fresh = makeFact({
      id: 'fresh',
      content: 'fresh fact',
      confidence: 0.8,
      lastReinforced: new Date(Date.now() - 1 * DAY).toISOString(),
    })
    const old = makeFact({
      id: 'old',
      content: 'old fact',
      confidence: 0.8,
      lastReinforced: new Date(Date.now() - 365 * DAY).toISOString(),
    })
    const semRef = createMockSemRef({ facts: [old, fresh], totalExtracted: 2 })
    const ctx = { resources: createMockResources({ semanticMemory: semRef, workingMemory: createMockWmRef() }) }
    const results = await mem.recall(ctx)
    const freshResult = results.find((r) => r.id === 'fresh')!
    const oldResult = results.find((r) => r.id === 'old')!
    expect(freshResult.relevance).toBeGreaterThan(oldResult.relevance)
  })

  it('createRecall uses raw confidence when hygiene is false (pre-FIX-411 ordering)', async () => {
    const mem = system({
      model: 'gpt-test',
      working: true,
      episodic: true,
      semantic: true,
      hygiene: false,
    })
    const fresh = makeFact({
      id: 'fresh',
      content: 'fresh fact',
      confidence: 0.8,
      lastReinforced: new Date(Date.now() - 1 * DAY).toISOString(),
    })
    const old = makeFact({
      id: 'old',
      content: 'old fact',
      confidence: 0.8,
      lastReinforced: new Date(Date.now() - 365 * DAY).toISOString(),
    })
    const semRef = createMockSemRef({ facts: [old, fresh], totalExtracted: 2 })
    const ctx = { resources: createMockResources({ semanticMemory: semRef, workingMemory: createMockWmRef() }) }
    const results = await mem.recall(ctx)
    const freshResult = results.find((r) => r.id === 'fresh')!
    const oldResult = results.find((r) => r.id === 'old')!
    expect(freshResult.relevance).toBe(oldResult.relevance)
  })
})
