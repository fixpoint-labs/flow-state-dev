/**
 * Tests for the agent-invocable memory recall tool (FIX-409).
 *
 * Two layers of coverage:
 *   - Tool surface: input/output envelope, char cap, sinceTurn, empty stores,
 *     strategy errors, hallucinated IDs — all driven through stub strategies
 *     so tests are deterministic and don't make LLM calls.
 *   - llm-filter strategy: query-blind intrinsic pre-rank ordering, recency
 *     decay, exact-phrase pass-through, working-memory exclusion. The Stage 2
 *     LLM call is verified via the registry-level tool surface tests.
 */

import { describe, it, expect } from 'vitest'
import type { ResourceHandle } from '@flow-state-dev/core'
import { runForTest } from '@flow-state-dev/testing'
import {
  workingMemoryStateSchema,
  type WorkingMemoryState,
} from '../../../src/memory/working-memory.js'
import {
  episodicMemoryStateSchema,
  type EpisodicMemoryState,
  type Episode,
} from '../../../src/memory/episodic-memory.js'
import {
  semanticMemoryStateSchema,
  type SemanticMemoryState,
  type SemanticFact,
} from '../../../src/memory/semantic-memory.js'
import {
  createRecallTool,
  capContent,
  TRUNCATION_MARKER,
  DEFAULT_PER_ITEM_CHAR_CAP,
  PRE_RANK_CAP,
  RECENCY_HALF_LIFE,
  intrinsicSemanticScore,
  intrinsicEpisodicScore,
  recallToolDescription,
  recallToolInputSchema,
  type RetrievalStrategy,
  type RetrievalStrategyContext,
  type MemoryItem,
} from '../../../src/memory/tools/index.js'

// ---------------------------------------------------------------------------
// Mock resource handles
// ---------------------------------------------------------------------------

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

function createMockSemRef(initial?: Partial<SemanticMemoryState>): ResourceHandle<SemanticMemoryState> {
  let state: SemanticMemoryState = {
    facts: [],
    totalExtracted: 0,
    totalConsolidations: 0,
    ...initial,
  }
  return {
    name: 'semanticMemory',
    scope: 'user',
    get state() { return state },
    patchState: async (u) => { state = { ...state, ...u } as SemanticMemoryState },
    setState: async (n) => { state = n },
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

function buildCtx(args: {
  wm?: ResourceHandle<WorkingMemoryState>
  ep?: ResourceHandle<EpisodicMemoryState>
  sem?: ResourceHandle<SemanticMemoryState>
}): any {
  const refs: Record<string, any> = {}
  if (args.wm) refs.workingMemory = args.wm
  if (args.ep) refs.episodicMemory = args.ep
  if (args.sem) refs.semanticMemory = args.sem
  return {
    resources: {
      ...refs,
      get: (name: string) => refs[name],
      list: () => Object.values(refs),
    },
    session: {
      items: { all: () => [] },
      instanceId: 'test',
    },
    response: { emit: async () => {} },
  }
}

// ---------------------------------------------------------------------------
// Stub strategy — surfaces every input it sees and returns a deterministic order
// ---------------------------------------------------------------------------

type StubCall = {
  query: string
  ctx: RetrievalStrategyContext
  opts: { limit: number; sinceTurn?: number }
}

function makeStubStrategy(handler: (call: StubCall) => MemoryItem[] | { error: string }): {
  strategy: RetrievalStrategy
  calls: StubCall[]
} {
  const calls: StubCall[] = []
  const strategy: RetrievalStrategy = {
    name: 'stub',
    rank(query, ctx, opts) {
      calls.push({ query, ctx, opts })
      const result = handler({ query, ctx, opts })
      if ('error' in result) throw new Error(result.error)
      return result.map((item, i) => ({ item, score: 1 - i / Math.max(1, result.length) }))
    },
  }
  return { strategy, calls }
}

// ---------------------------------------------------------------------------
// Tool surface tests
// ---------------------------------------------------------------------------

describe('tools/recall — tool surface', () => {
  it('factory returns a handler block exposing the documented description and schema', () => {
    const { strategy } = makeStubStrategy(() => [])
    const tool = createRecallTool({ strategy })
    expect(tool).toBeDefined()
    expect(tool.name).toBe('tf.memory/recall')
    expect((tool as any).description ?? recallToolDescription).toContain('stored memory')
    expect(recallToolInputSchema.safeParse({ query: 'hi' }).success).toBe(true)
    expect(recallToolInputSchema.safeParse({ query: '' }).success).toBe(false)
  })

  it('returns empty envelope without invoking the strategy when both stores are empty', async () => {
    const { strategy, calls } = makeStubStrategy(() => [])
    const tool = createRecallTool({ strategy })
    const ctx = buildCtx({
      wm: createMockWmRef({ currentTurn: 3 }),
      sem: createMockSemRef(),
      ep: createMockEpRef(),
    })
    const result = await runForTest(tool, { query: 'anything' } as any, ctx) as any
    expect(result).toEqual({
      results: [],
      query: 'anything',
      strategy: 'stub',
      totalMatched: 0,
      truncatedTo: 0,
    })
    expect(calls).toHaveLength(0)
  })

  it('passes semantic and episodic candidates to the strategy with currentTurn from working memory', async () => {
    const fact = makeFact({ id: 'f1', content: 'user lives in Paris' })
    const episode = makeEpisode({ id: 'e1', content: 'user mentioned a trip', occurredAtTurn: 4 })
    const { strategy, calls } = makeStubStrategy(() => [
      { id: 'f1', content: fact.content, source: 'semantic', confidence: 0.8 },
    ])
    const tool = createRecallTool({ strategy })
    const ctx = buildCtx({
      wm: createMockWmRef({ currentTurn: 9 }),
      sem: createMockSemRef({ facts: [fact] }),
      ep: createMockEpRef({ episodes: [episode] }),
    })
    const result = await runForTest(tool, { query: 'where' } as any, ctx) as any
    expect(calls).toHaveLength(1)
    expect(calls[0].ctx.semantic).toHaveLength(1)
    expect(calls[0].ctx.episodic).toHaveLength(1)
    expect(calls[0].ctx.currentTurn).toBe(9)
    expect(result.totalMatched).toBe(1)
    expect(result.results[0].source).toBe('semantic')
    expect(result.results[0].metadata).toMatchObject({ confidence: 0.8 })
  })

  it('clamps limit to [1, 20] and forwards sinceTurn to the strategy', async () => {
    const { strategy, calls } = makeStubStrategy(() => [])
    const tool = createRecallTool({ strategy })
    const ctx = buildCtx({
      wm: createMockWmRef({ currentTurn: 0 }),
      sem: createMockSemRef({ facts: [makeFact({ id: 'f' })] }),
    })

    // limit > 20 is rejected by zod (max 20)
    expect(recallToolInputSchema.safeParse({ query: 'q', limit: 100 }).success).toBe(false)

    await runForTest(tool, { query: 'q', limit: 12, sinceTurn: 5 } as any, ctx)
    expect(calls[0].opts).toEqual({ limit: 12, sinceTurn: 5 })
  })

  it('truncates content above the per-item char cap and sets truncated:true', async () => {
    const longContent = 'x'.repeat(800)
    const item: MemoryItem = {
      id: 'big',
      content: longContent,
      source: 'semantic',
      confidence: 0.9,
      reinforcementCount: 3,
    }
    const { strategy } = makeStubStrategy(() => [item])
    const tool = createRecallTool({ strategy })
    const ctx = buildCtx({
      wm: createMockWmRef(),
      sem: createMockSemRef({ facts: [makeFact({ id: 'big', content: longContent })] }),
    })
    const result = await runForTest(tool, { query: 'q' } as any, ctx) as any
    expect(result.results[0].truncated).toBe(true)
    expect(result.results[0].content.length).toBeLessThanOrEqual(DEFAULT_PER_ITEM_CHAR_CAP)
    expect(result.results[0].content.endsWith(TRUNCATION_MARKER)).toBe(true)
  })

  it('respects a custom perItemCharCap override', async () => {
    const longContent = 'a'.repeat(120)
    const item: MemoryItem = { id: 'x', content: longContent, source: 'episodic' }
    const { strategy } = makeStubStrategy(() => [item])
    const tool = createRecallTool({
      strategy,
      defaults: { perItemCharCap: 50 },
    })
    const ctx = buildCtx({
      wm: createMockWmRef(),
      ep: createMockEpRef({ episodes: [makeEpisode({ id: 'x', content: longContent })] }),
    })
    const result = await runForTest(tool, { query: 'q' } as any, ctx) as any
    expect(result.results[0].content.length).toBeLessThanOrEqual(50)
    expect(result.results[0].truncated).toBe(true)
  })

  it('reports totalMatched from the strategy and truncatesTo to the limit', async () => {
    const items: MemoryItem[] = Array.from({ length: 8 }, (_, i) => ({
      id: `i${i}`,
      content: `fact ${i}`,
      source: 'semantic',
    }))
    const { strategy } = makeStubStrategy(() => items)
    const tool = createRecallTool({ strategy, defaults: { limit: 5 } })
    const ctx = buildCtx({
      wm: createMockWmRef(),
      sem: createMockSemRef({ facts: items.map((i) => makeFact({ id: i.id })) }),
    })
    const result = await runForTest(tool, { query: 'q' } as any, ctx) as any
    expect(result.totalMatched).toBe(8)
    expect(result.truncatedTo).toBe(5)
    expect(result.results).toHaveLength(5)
  })

  it('returns an error envelope when the strategy throws', async () => {
    const { strategy } = makeStubStrategy(() => ({ error: 'rate limit' }))
    const tool = createRecallTool({ strategy })
    const ctx = buildCtx({
      wm: createMockWmRef(),
      sem: createMockSemRef({ facts: [makeFact({ id: 'a' })] }),
    })
    const result = await runForTest(tool, { query: 'q' } as any, ctx) as any
    expect(result.error).toBe('rate limit')
    expect(result.query).toBe('q')
    expect(result.strategy).toBe('stub')
  })

  it('stamps the strategy name onto every envelope', async () => {
    const { strategy } = makeStubStrategy(() => [
      { id: 'a', content: 'x', source: 'semantic' },
    ])
    const tool = createRecallTool({ strategy })
    const ctx = buildCtx({
      wm: createMockWmRef(),
      sem: createMockSemRef({ facts: [makeFact({ id: 'a' })] }),
    })
    const result = await runForTest(tool, { query: 'q' } as any, ctx) as any
    expect(result.strategy).toBe('stub')
  })

  it('does not surface working-memory entries even when the strategy is asked to return them', async () => {
    // Simulate an off-spec strategy that ignores the contract — the tool layer
    // should still only return what the strategy returns; working-memory items
    // are never passed in.
    const { strategy, calls } = makeStubStrategy(() => [])
    const tool = createRecallTool({ strategy })
    const ctx = buildCtx({
      wm: createMockWmRef({
        currentTurn: 1,
        entries: [
          {
            id: 'wm1',
            content: 'present in working memory',
            importance: 0.8,
            category: 'preference',
            durability: 'session',
            pinned: false,
            decayValue: 1,
            createdAtTurn: 0,
            lastAccessedTurn: 0,
            salience: 0.8,
          } as any,
        ],
      }),
      sem: createMockSemRef({ facts: [makeFact({ id: 's1' })] }),
    })
    await runForTest(tool, { query: 'q' } as any, ctx)
    expect(calls[0].ctx.semantic).toHaveLength(1)
    // RetrievalStrategyContext has no `working` field — working memory cannot
    // reach the strategy by construction.
    expect((calls[0].ctx as any).working).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// capContent helper
// ---------------------------------------------------------------------------

describe('tools/recall — capContent', () => {
  it('passes through content under the cap', () => {
    const r = capContent('hello', 10)
    expect(r).toEqual({ content: 'hello', truncated: false })
  })

  it('appends the marker when over the cap', () => {
    const long = 'a'.repeat(500)
    const r = capContent(long, 100)
    expect(r.truncated).toBe(true)
    expect(r.content.length).toBe(100)
    expect(r.content.endsWith(TRUNCATION_MARKER)).toBe(true)
  })

  it('hard-slices when cap is smaller than the marker length', () => {
    const r = capContent('a'.repeat(50), 10)
    expect(r.content.length).toBe(10)
    expect(r.truncated).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// llm-filter strategy — Stage 1 intrinsic scoring (no LLM call required)
// ---------------------------------------------------------------------------

describe('tools/recall — intrinsic scoring', () => {
  it('semantic score grows with confidence and reinforcement', () => {
    const low = makeFact({ id: 'a', confidence: 0.2, reinforcementCount: 1 })
    const high = makeFact({ id: 'b', confidence: 0.95, reinforcementCount: 9 })
    expect(intrinsicSemanticScore(high)).toBeGreaterThan(intrinsicSemanticScore(low))
  })

  it('episodic score decays with age via the documented half-life', () => {
    const fresh = makeEpisode({ id: 'a', significance: 0.8, occurredAtTurn: 100 })
    const old = makeEpisode({ id: 'b', significance: 0.8, occurredAtTurn: 0 })
    const currentTurn = 100
    const freshScore = intrinsicEpisodicScore(fresh, currentTurn)
    const oldScore = intrinsicEpisodicScore(old, currentTurn)
    expect(freshScore).toBeGreaterThan(oldScore)
    // sanity: score at age=half-life should be ~ significance × 1/e
    const halfLifeAgo = makeEpisode({ id: 'c', significance: 0.8, occurredAtTurn: currentTurn - RECENCY_HALF_LIFE })
    const expected = 0.8 * Math.exp(-1)
    expect(intrinsicEpisodicScore(halfLifeAgo, currentTurn)).toBeCloseTo(expected, 4)
  })

  it('PRE_RANK_CAP is the documented ceiling', () => {
    expect(PRE_RANK_CAP).toBe(50)
  })
})
