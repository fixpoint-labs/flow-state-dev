/**
 * Tests for graph-expanded recall (FIX-745 read-side).
 *
 * Two behaviours:
 *  - the pure `graphExpandCandidates` helper surfaces edges connected to a
 *    query-named entity, and is a strict no-op for an empty graph;
 *  - the llm-filter prepare block, run with edges present, appends those
 *    relation candidates — and with relations OFF produces a byte-identical
 *    candidate set (regression guard for the chat-personalization path).
 */

import { describe, it, expect } from 'vitest'
import { runForTest } from '@flow-state-dev/testing'
import type { ResourceHandle } from '@flow-state-dev/core'
import { createResourceEdgeApi } from '@flow-state-dev/core/graph'
import type { Edge, EdgeSlotConfig } from '@flow-state-dev/core/graph'

import {
  workingMemoryStateSchema,
  type WorkingMemoryState,
} from '../../src/working-memory.js'
import {
  episodicMemoryStateSchema,
  type EpisodicMemoryState,
} from '../../src/episodic-memory.js'
import {
  semanticMemoryStateSchema,
  type SemanticMemoryState,
  type SemanticFact,
} from '../../src/semantic-memory.js'
import {
  createLlmFilterStrategy,
  graphExpandCandidates,
  DEFAULT_PER_ITEM_CHAR_CAP,
  type PrepareEnvelope,
  type PrepareInput,
} from '../../src/tools/index.js'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function createMockWmRef(initial?: Partial<WorkingMemoryState>): ResourceHandle<WorkingMemoryState> {
  let state: WorkingMemoryState = { entries: [], currentTurn: 0, ...initial }
  return {
    name: 'workingMemory', scope: 'session',
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
    name: 'episodicMemory', scope: 'user',
    get state() { return state },
    patchState: async (u) => { state = { ...state, ...u } as EpisodicMemoryState },
    setState: async (n) => { state = n },
    updateState: async (fn) => { state = await fn(state) },
    readContent: async () => JSON.stringify(state),
    writeContent: async () => {},
    config: { stateSchema: episodicMemoryStateSchema, writable: true },
  } as ResourceHandle<EpisodicMemoryState>
}

function createMockSemRef(
  facts: SemanticFact[],
  edges?: Edge[],
  relations?: EdgeSlotConfig,
): ResourceHandle<SemanticMemoryState> {
  let state: SemanticMemoryState = {
    facts,
    totalExtracted: 0,
    totalConsolidations: 0,
    ...(relations ? { edges: edges ?? [] } : {}),
  } as SemanticMemoryState
  const ref = {
    name: 'semanticMemory', scope: 'user',
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

function makeEdge(overrides: Partial<Edge> & { from: string; to: string; type: string }): Edge {
  return {
    id: `e_${overrides.from}_${overrides.to}`,
    confidence: 0.9,
    validFrom: null,
    validUntil: null,
    source: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

function buildCtx(args: {
  wm: ResourceHandle<WorkingMemoryState>
  ep?: ResourceHandle<EpisodicMemoryState>
  sem: ResourceHandle<SemanticMemoryState>
}): any {
  const refs: Record<string, any> = { workingMemory: args.wm, semanticMemory: args.sem }
  if (args.ep) refs.episodicMemory = args.ep
  return {
    resources: { ...refs, get: (n: string) => refs[n], list: () => Object.values(refs) },
    response: { emit: async () => {} },
  }
}

async function runPrepare(
  sem: ResourceHandle<SemanticMemoryState>,
  query: string,
): Promise<PrepareEnvelope> {
  const strategy = createLlmFilterStrategy({ model: 'mock-model' })
  const ctx = buildCtx({ wm: createMockWmRef({ currentTurn: 10 }), ep: createMockEpRef(), sem })
  const input: PrepareInput = {
    query,
    limit: 5,
    strategyName: strategy.name,
    perItemCharCap: DEFAULT_PER_ITEM_CHAR_CAP,
  }
  return runForTest(strategy.prepareBlock, input, ctx) as Promise<PrepareEnvelope>
}

// ---------------------------------------------------------------------------
// Pure helper
// ---------------------------------------------------------------------------

describe('graphExpandCandidates', () => {
  it('surfaces edges connected to a query-named entity', () => {
    const edges = [
      makeEdge({ id: 'e1', from: 'user', to: 'moni', type: 'married to' }),
      makeEdge({ id: 'e2', from: 'moni', to: 'acme', type: 'works at' }),
    ]
    const out = graphExpandCandidates(edges, 'tell me about moni', new Set())
    const ids = out.map((i) => i.id).sort()
    expect(ids).toContain('e1')
    expect(ids).toContain('e2')
    expect(out.every((i) => i.source === 'relation')).toBe(true)
  })

  it('excludes edges already in the candidate set', () => {
    const edges = [makeEdge({ id: 'e1', from: 'user', to: 'moni', type: 'married to' })]
    const out = graphExpandCandidates(edges, 'moni', new Set(['e1']))
    expect(out).toEqual([])
  })

  it('is a no-op for an empty graph', () => {
    expect(graphExpandCandidates([], 'moni', new Set())).toEqual([])
  })

  it('returns nothing when the query names no known entity', () => {
    const edges = [makeEdge({ id: 'e1', from: 'user', to: 'moni', type: 'married to' })]
    expect(graphExpandCandidates(edges, 'unrelated topic', new Set())).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Prepare-path wiring
// ---------------------------------------------------------------------------

describe('llm-filter prepare — graph-expanded recall', () => {
  it('surfaces an edge connected to a named entity that keyword candidates miss', async () => {
    // A single fact about "user" — a keyword query "moni" would not surface
    // any fact (the fact content has no "moni"). The edge user→moni connects
    // them, so graph expansion should add it.
    const facts = [makeFact({ id: 'sf_user', subject: 'user', content: 'Name is Jake' })]
    const edges = [makeEdge({ id: 'e_um', from: 'user', to: 'moni', type: 'married to' })]
    const sem = createMockSemRef(facts, edges, {})

    const env = await runPrepare(sem, 'who is moni')

    const relationItems = env.candidates.filter((c) => c.source === 'relation')
    expect(relationItems.map((r) => r.id)).toContain('e_um')
    expect(relationItems[0].content).toBe('user married to moni')
  })

  it('produces an identical candidate set when relations are OFF (regression)', async () => {
    const facts = [
      makeFact({ id: 'sf_user', subject: 'user', content: 'Name is Jake' }),
      makeFact({ id: 'sf_moni', subject: 'moni', content: "Is the user's wife" }),
    ]
    // Relations OFF: no edge API, no edges field.
    const semOff = createMockSemRef(facts)
    const envOff = await runPrepare(semOff, 'who is moni')

    // Same facts, relations ON but with an EMPTY graph — must add no candidates.
    const semEmpty = createMockSemRef(facts, [], {})
    const envEmpty = await runPrepare(semEmpty, 'who is moni')

    const idsOff = envOff.candidates.map((c) => c.id).sort()
    const idsEmpty = envEmpty.candidates.map((c) => c.id).sort()
    expect(idsOff).toEqual(idsEmpty)
    // No relation items in either case.
    expect(envOff.candidates.some((c) => c.source === 'relation')).toBe(false)
    expect(envEmpty.candidates.some((c) => c.source === 'relation')).toBe(false)
  })
})
