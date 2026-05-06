/**
 * Tests for the agent-invocable memory recall tool.
 *
 * The tool is a sequencer composing strategy-supplied blocks. Tests stub the
 * strategy with simple handler blocks so they're deterministic and don't make
 * LLM calls. Pure-function helpers (intrinsic scoring, exact-phrase matching)
 * are exercised in isolation alongside.
 */

import { describe, it, expect } from 'vitest'
import { handler } from '@flow-state-dev/core'
import { runForTest } from '@flow-state-dev/testing'
import type { ResourceHandle } from '@flow-state-dev/core'
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
  semanticToMemoryItem,
  episodeToMemoryItem,
  recallToolDescription,
  recallToolInputSchema,
  type MemoryItem,
  type PrepareEnvelope,
  type PrepareInput,
  type RetrievalStrategy,
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
  const ctx: any = {
    request: {
      identity: { type: 'request', id: 'req_1' },
      state: {},
      tokenUsage: { totalConsumed: 0, byModel: {}, remaining: Number.POSITIVE_INFINITY },
      costEstimate: { totalUSD: 0, byModel: {} },
    },
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
    signal: new AbortController().signal,
  }
  // Minimal _withExecutionScope shim that mirrors the server runtime's
  // parent-chain semantics. Server impl (createExecutionContext.ts ~3150):
  // `ctx.parent` resolves to the IMMEDIATE PARENT block in the chain — not
  // the block that's currently executing. So when the merge handler runs
  // inside the filter sub-sequencer, ctx.parent.input = sub-sequencer's
  // input = prepare envelope.
  //
  // Implementation: each scope tracks the current block's metadata; when it
  // opens a child scope, the child sees the current block as its parent.
  function makeScope(immediateParent: any) {
    return async (current: any, execute: (c: any) => Promise<unknown>) => {
      const scopedCtx: any = {
        ...ctx,
        parent: immediateParent
          ? {
              name: immediateParent.name,
              kind: immediateParent.kind,
              input: immediateParent.input,
            }
          : undefined,
        _blockIdentity: { blockInstanceId: current.instanceId, blockPath: current.path },
      }
      // When `current` executes a child, that child's parent will be `current`.
      scopedCtx._withExecutionScope = makeScope(current)
      return execute(scopedCtx)
    }
  }
  // Root call has no parent.
  ctx._withExecutionScope = makeScope(undefined)
  return ctx
}

/**
 * Runs the recall tool the way the framework does in production: opens an
 * outer execution scope around it so child blocks see the recall sequencer
 * as their parent (and the rescue handler can read `ctx.parent.input` to
 * recover the tool's original input). `runForTest` alone doesn't do this —
 * the server's executeBlock does it automatically, but unit tests don't go
 * through that path.
 */
async function runRecallTool(tool: any, input: any, ctx: any): Promise<any> {
  return ctx._withExecutionScope(
    { name: tool.name, kind: tool.kind, input, instanceId: 'test-instance', path: 'test' },
    (scopedCtx: any) => runForTest(tool, input, scopedCtx),
  )
}

// ---------------------------------------------------------------------------
// Stub strategy — deterministic prepare + filter handlers for tests
// ---------------------------------------------------------------------------

type StubFilterInput = { query: string; limit: number; candidates: MemoryItem[] }

type StubOptions = {
  /** Build candidates from the runtime ctx. Defaults to walking semantic + episodic stores. */
  candidatesFromCtx?: (input: PrepareInput, ctx: any) => MemoryItem[]
  /** Stub the filter step. Defaults to selecting every candidate ID in order. */
  filter?: (input: StubFilterInput) => { selectedIds: string[] }
  /** Make the filter throw — exercises the rescue branch / error envelope. */
  filterError?: string
  /** Omit the filterBlock entirely — strategy is filter-less (vector-style). */
  noFilter?: boolean
  /** Strategy name surfaced on the result envelope. */
  name?: string
}

function makeStubStrategy(opts: StubOptions = {}): {
  strategy: RetrievalStrategy
  prepareCalls: PrepareInput[]
  filterCalls: StubFilterInput[]
} {
  const prepareCalls: PrepareInput[] = []
  const filterCalls: StubFilterInput[] = []
  const name = opts.name ?? 'stub'

  const candidatesFromCtx = opts.candidatesFromCtx ?? ((_input, ctx) => {
    const items: MemoryItem[] = []
    const sem = ctx.resources?.semanticMemory
    const ep = ctx.resources?.episodicMemory
    if (sem?.state?.facts) {
      for (const f of sem.state.facts as SemanticFact[]) items.push(semanticToMemoryItem(f))
    }
    if (ep?.state?.episodes) {
      for (const e of ep.state.episodes as Episode[]) items.push(episodeToMemoryItem(e))
    }
    return items
  })

  const prepareBlock = handler({
    name: 'stub.prepare',
    execute: async (input: PrepareInput, ctx): Promise<PrepareEnvelope> => {
      prepareCalls.push(input)
      const candidates = candidatesFromCtx(input, ctx)
      return {
        query: input.query,
        limit: input.limit,
        sinceTurn: input.sinceTurn,
        candidates,
        shouldFilter: candidates.length > 0,
        strategyName: input.strategyName,
        perItemCharCap: input.perItemCharCap,
      }
    },
  })

  const filterBlock = handler({
    name: 'stub.filter',
    execute: async (input: StubFilterInput): Promise<{ selectedIds: string[] }> => {
      filterCalls.push(input)
      if (opts.filterError) throw new Error(opts.filterError)
      if (opts.filter) return opts.filter(input)
      return { selectedIds: input.candidates.map((c) => c.id) }
    },
  })

  const strategy: RetrievalStrategy = {
    name,
    prepareBlock,
    ...(opts.noFilter ? {} : { filterBlock }),
  }

  return { strategy, prepareCalls, filterCalls }
}

// ---------------------------------------------------------------------------
// Tool surface tests
// ---------------------------------------------------------------------------

describe('tools/recall — tool surface', () => {
  it('factory returns a sequencer block exposing the documented description and schema', () => {
    const { strategy } = makeStubStrategy()
    const tool = createRecallTool({ strategy })
    expect(tool).toBeDefined()
    expect(tool.name).toBe('tf.memory/recall')
    expect(tool.kind).toBe('sequencer')
    const description = (tool as any).description ?? recallToolDescription
    expect(typeof description).toBe('string')
    expect(description.length).toBeGreaterThan(0)
    expect(description.toLowerCase()).toContain('memory')
    expect(recallToolInputSchema.safeParse({ query: 'hi' }).success).toBe(true)
    expect(recallToolInputSchema.safeParse({ query: '' }).success).toBe(false)
  })

  it('returns empty envelope without invoking the filter when both stores are empty', async () => {
    const { strategy, filterCalls } = makeStubStrategy()
    const tool = createRecallTool({ strategy })
    const ctx = buildCtx({
      wm: createMockWmRef({ currentTurn: 3 }),
      sem: createMockSemRef(),
      ep: createMockEpRef(),
    })
    const result = await runRecallTool(tool,{ query: 'anything' } as any, ctx) as any
    expect(result).toEqual({
      results: [],
      query: 'anything',
      strategy: 'stub',
      totalMatched: 0,
      truncatedTo: 0,
    })
    expect(filterCalls).toHaveLength(0)
  })

  it('passes semantic and episodic candidates to the filter step', async () => {
    const fact = makeFact({ id: 'f1', content: 'user lives in Paris' })
    const episode = makeEpisode({ id: 'e1', content: 'user mentioned a trip', occurredAtTurn: 4 })
    const { strategy, filterCalls } = makeStubStrategy({
      filter: (input) => ({ selectedIds: [input.candidates[0].id] }),
    })
    const tool = createRecallTool({ strategy })
    const ctx = buildCtx({
      wm: createMockWmRef({ currentTurn: 9 }),
      sem: createMockSemRef({ facts: [fact] }),
      ep: createMockEpRef({ episodes: [episode] }),
    })
    const result = await runRecallTool(tool,{ query: 'where' } as any, ctx) as any
    expect(filterCalls).toHaveLength(1)
    expect(filterCalls[0].candidates.map((c) => c.source).sort()).toEqual(['episodic', 'semantic'])
    expect(result.totalMatched).toBe(1)
    expect(result.results[0].source).toBe('semantic')
    expect(result.results[0].metadata).toMatchObject({ confidence: 0.7 })
  })

  it('clamps limit to [1, 20] and forwards sinceTurn into the prepare envelope', async () => {
    const { strategy, prepareCalls, filterCalls } = makeStubStrategy()
    const tool = createRecallTool({ strategy })
    const ctx = buildCtx({
      wm: createMockWmRef({ currentTurn: 0 }),
      sem: createMockSemRef({ facts: [makeFact({ id: 'f' })] }),
    })

    // limit > 20 is rejected by zod (max 20)
    expect(recallToolInputSchema.safeParse({ query: 'q', limit: 100 }).success).toBe(false)

    await runRecallTool(tool,{ query: 'q', limit: 12, sinceTurn: 5 } as any, ctx)
    expect(prepareCalls[0].limit).toBe(12)
    expect(prepareCalls[0].sinceTurn).toBe(5)
    expect(filterCalls[0].limit).toBe(12)
  })

  it('truncates content above the per-item char cap and sets truncated:true', async () => {
    const longContent = 'x'.repeat(800)
    const { strategy } = makeStubStrategy({
      candidatesFromCtx: () => [{
        id: 'big',
        content: longContent,
        source: 'semantic',
        confidence: 0.9,
        reinforcementCount: 3,
      }],
    })
    const tool = createRecallTool({ strategy })
    const ctx = buildCtx({
      wm: createMockWmRef(),
      sem: createMockSemRef({ facts: [makeFact({ id: 'big', content: longContent })] }),
    })
    const result = await runRecallTool(tool,{ query: 'q' } as any, ctx) as any
    expect(result.results[0].truncated).toBe(true)
    expect(result.results[0].content.length).toBeLessThanOrEqual(DEFAULT_PER_ITEM_CHAR_CAP)
    expect(result.results[0].content.endsWith(TRUNCATION_MARKER)).toBe(true)
  })

  it('respects a custom perItemCharCap override', async () => {
    const longContent = 'a'.repeat(120)
    const { strategy } = makeStubStrategy({
      candidatesFromCtx: () => [{ id: 'x', content: longContent, source: 'episodic' }],
    })
    const tool = createRecallTool({
      strategy,
      defaults: { perItemCharCap: 50 },
    })
    const ctx = buildCtx({
      wm: createMockWmRef(),
      ep: createMockEpRef({ episodes: [makeEpisode({ id: 'x', content: longContent })] }),
    })
    const result = await runRecallTool(tool,{ query: 'q' } as any, ctx) as any
    expect(result.results[0].content.length).toBeLessThanOrEqual(50)
    expect(result.results[0].truncated).toBe(true)
  })

  it('reports totalMatched from selectedIds and truncatesTo to the limit', async () => {
    const items: MemoryItem[] = Array.from({ length: 8 }, (_, i) => ({
      id: `i${i}`,
      content: `fact ${i}`,
      source: 'semantic',
    }))
    const { strategy } = makeStubStrategy({
      candidatesFromCtx: () => items,
      filter: () => ({ selectedIds: items.map((i) => i.id) }),
    })
    const tool = createRecallTool({ strategy, defaults: { limit: 5 } })
    const ctx = buildCtx({
      wm: createMockWmRef(),
      sem: createMockSemRef({ facts: items.map((i) => makeFact({ id: i.id })) }),
    })
    const result = await runRecallTool(tool,{ query: 'q' } as any, ctx) as any
    expect(result.totalMatched).toBe(8)
    expect(result.truncatedTo).toBe(5)
    expect(result.results).toHaveLength(5)
  })

  it('returns an error envelope when the filter throws', async () => {
    const { strategy } = makeStubStrategy({ filterError: 'rate limit' })
    const tool = createRecallTool({ strategy })
    const ctx = buildCtx({
      wm: createMockWmRef(),
      sem: createMockSemRef({ facts: [makeFact({ id: 'a' })] }),
    })
    const result = await runRecallTool(tool,{ query: 'q' } as any, ctx) as any
    expect(result.error).toBe('rate limit')
    expect(result.query).toBe('q')
    expect(result.strategy).toBe('stub')
  })

  it('stamps the strategy name onto every envelope', async () => {
    const { strategy } = makeStubStrategy({ name: 'my-strategy' })
    const tool = createRecallTool({ strategy })
    const ctx = buildCtx({
      wm: createMockWmRef(),
      sem: createMockSemRef({ facts: [makeFact({ id: 'a' })] }),
    })
    const result = await runRecallTool(tool,{ query: 'q' } as any, ctx) as any
    expect(result.strategy).toBe('my-strategy')
  })

  it('drops hallucinated IDs returned by the filter', async () => {
    const items: MemoryItem[] = [
      { id: 'real-1', content: 'a', source: 'semantic' },
      { id: 'real-2', content: 'b', source: 'semantic' },
    ]
    const { strategy } = makeStubStrategy({
      candidatesFromCtx: () => items,
      // Mix in an ID that wasn't in the candidates — recall must drop it.
      filter: () => ({ selectedIds: ['real-1', 'hallucinated', 'real-2'] }),
    })
    const tool = createRecallTool({ strategy })
    const ctx = buildCtx({
      wm: createMockWmRef(),
      sem: createMockSemRef({ facts: items.map((i) => makeFact({ id: i.id })) }),
    })
    const result = await runRecallTool(tool,{ query: 'q' } as any, ctx) as any
    expect(result.results.map((r: any) => r.id)).toEqual(['real-1', 'real-2'])
  })

  it('skips the filter step when the strategy has no filterBlock', async () => {
    const items: MemoryItem[] = [
      { id: 'a', content: 'aaa', source: 'semantic' },
      { id: 'b', content: 'bbb', source: 'semantic' },
    ]
    const { strategy, filterCalls } = makeStubStrategy({
      noFilter: true,
      candidatesFromCtx: () => items,
    })
    const tool = createRecallTool({ strategy })
    const ctx = buildCtx({
      wm: createMockWmRef(),
      sem: createMockSemRef({ facts: items.map((i) => makeFact({ id: i.id })) }),
    })
    const result = await runRecallTool(tool,{ query: 'q' } as any, ctx) as any
    expect(filterCalls).toHaveLength(0)
    // Without a filter, format surfaces the intrinsic-ranked candidates.
    expect(result.results.map((r: any) => r.id)).toEqual(['a', 'b'])
    expect(result.totalMatched).toBe(2)
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
