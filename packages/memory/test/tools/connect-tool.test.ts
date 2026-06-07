/**
 * Tests for the relation-graph read-side (FIX-745):
 *  - `edgeToMemoryItem` content + metadata rendering
 *  - the `memory/connect` tool (shortest-path, ego-graph, disabled, unreachable)
 *  - the typed capability helpers (`connections` / `relate` / `egoGraph`)
 *
 * Edge reads flow through the real `ResourceEdgeApi` wired over a mock ref the
 * same way the relations write-side spec and the server resource-registry do,
 * so the tool exercises the production API surface.
 */

import { describe, it, expect } from 'vitest'
import { runForTest } from '@flow-state-dev/testing'
import type { ResourceHandle } from '@flow-state-dev/core'
import { createResourceEdgeApi } from '@flow-state-dev/core/graph'
import type { Edge, EdgeSlotConfig } from '@flow-state-dev/core/graph'

import {
  semanticMemoryStateSchema,
  type SemanticMemoryState,
} from '../../src/semantic-memory.js'
import { createConnectTool, edgeToMemoryItem } from '../../src/tools/index.js'
import type { RecallToolResult } from '../../src/tools/index.js'
import { createMemoryCapability } from '../../src/memory-capability.js'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

/** Semantic mock ref; attaches the real edge API when `relations` is given. */
function createMockSemRef(
  edges?: Edge[],
  relations?: EdgeSlotConfig,
): ResourceHandle<SemanticMemoryState> {
  let state: SemanticMemoryState = {
    facts: [],
    totalExtracted: 0,
    totalConsolidations: 0,
    ...(relations ? { edges: edges ?? [] } : {}),
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

function makeEdge(overrides: Partial<Edge> & { from: string; to: string; type: string }): Edge {
  return {
    id: `e_${overrides.from}_${overrides.to}_${overrides.type}`,
    confidence: 0.9,
    validFrom: null,
    validUntil: null,
    source: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

function buildCtx(sem?: ResourceHandle<SemanticMemoryState>): any {
  const refs: Record<string, any> = {}
  if (sem) refs.semanticMemory = sem
  return {
    resources: {
      ...refs,
      get: (name: string) => refs[name],
      list: () => Object.values(refs),
    },
    response: { emit: async () => {} },
  }
}

// ---------------------------------------------------------------------------
// edgeToMemoryItem
// ---------------------------------------------------------------------------

describe('edgeToMemoryItem', () => {
  it('renders content as "<from> <type> <to>" and populates relation metadata', () => {
    const edge = makeEdge({ id: 'e1', from: 'user', to: 'moni', type: 'married to', confidence: 0.85 })
    const item = edgeToMemoryItem(edge)
    expect(item.id).toBe('e1')
    expect(item.content).toBe('user married to moni')
    expect(item.source).toBe('relation')
    expect(item.from).toBe('user')
    expect(item.to).toBe('moni')
    expect(item.relationType).toBe('married to')
    expect(item.confidence).toBe(0.85)
  })
})

// ---------------------------------------------------------------------------
// memory/connect tool
// ---------------------------------------------------------------------------

describe('memory/connect tool', () => {
  it('with from+to returns the shortest-path edges as relation items', async () => {
    const edges = [
      makeEdge({ from: 'user', to: 'moni', type: 'married to' }),
      makeEdge({ from: 'moni', to: 'acme', type: 'works at' }),
    ]
    const sem = createMockSemRef(edges, {})
    const tool = createConnectTool()
    const result = (await runForTest(
      tool,
      { from: 'User', to: 'Acme' } as any,
      buildCtx(sem),
    )) as RecallToolResult

    if ('error' in result) throw new Error('expected success envelope')
    expect(result.strategy).toBe('graph')
    expect(result.query).toBe('User -> Acme')
    // Path is user -> moni -> acme: two edges.
    expect(result.results.map((r) => r.content)).toEqual([
      'user married to moni',
      'moni works at acme',
    ])
    expect(result.results[0].source).toBe('relation')
    expect(result.results[0].metadata).toMatchObject({ relationType: 'married to' })
  })

  it('with from only returns the ego-graph edges', async () => {
    const edges = [
      makeEdge({ from: 'user', to: 'moni', type: 'married to' }),
      makeEdge({ from: 'user', to: 'paris', type: 'lives in' }),
      // An unrelated edge not connected to user — excluded from the ego graph.
      makeEdge({ from: 'bob', to: 'carol', type: 'knows' }),
    ]
    const sem = createMockSemRef(edges, {})
    const tool = createConnectTool()
    const result = (await runForTest(
      tool,
      { from: 'user', depth: 1 } as any,
      buildCtx(sem),
    )) as RecallToolResult

    if ('error' in result) throw new Error('expected success envelope')
    const contents = result.results.map((r) => r.content).sort()
    expect(contents).toEqual(['user lives in paris', 'user married to moni'])
    expect(result.query).toBe('user')
  })

  it('returns an error envelope when relations are disabled (no edge API)', async () => {
    const sem = createMockSemRef() // no relations → no edge API
    const tool = createConnectTool()
    const result = (await runForTest(
      tool,
      { from: 'user', to: 'moni' } as any,
      buildCtx(sem),
    )) as RecallToolResult

    expect('error' in result).toBe(true)
    if (!('error' in result)) throw new Error('expected error envelope')
    expect(result.strategy).toBe('graph')
    expect(result.query).toBe('user -> moni')
    expect(result.error).toContain('relations')
  })

  it('returns empty results (not an error) when `to` is unreachable', async () => {
    const edges = [makeEdge({ from: 'user', to: 'moni', type: 'married to' })]
    const sem = createMockSemRef(edges, {})
    const tool = createConnectTool()
    const result = (await runForTest(
      tool,
      { from: 'user', to: 'ghost' } as any,
      buildCtx(sem),
    )) as RecallToolResult

    expect('error' in result).toBe(false)
    if ('error' in result) throw new Error('expected success envelope')
    expect(result.results).toEqual([])
    expect(result.totalMatched).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Capability helpers — ctx.cap.memory.connections / relate / egoGraph
// ---------------------------------------------------------------------------

describe('memory capability relation helpers', () => {
  function buildCapCtx(sem?: ResourceHandle<SemanticMemoryState>): any {
    const refs: Record<string, any> = {}
    if (sem) refs.semanticMemory = sem
    return {
      resources: {
        ...refs,
        get: (name: string) => refs[name],
        list: () => Object.values(refs),
      },
    }
  }

  /** Invoke the composed capability's fns against a ctx. */
  function fnsFor(sem?: ResourceHandle<SemanticMemoryState>) {
    const cap = createMemoryCapability({
      model: 'gpt-5-mini',
      working: true,
      episodic: true,
      semantic: { relations: true },
    })
    return (cap.fns as (ctx: any) => any)(buildCapCtx(sem))
  }

  it('connections returns the neighbour edges around an entity', () => {
    const edges = [
      makeEdge({ from: 'user', to: 'moni', type: 'married to' }),
      makeEdge({ from: 'moni', to: 'acme', type: 'works at' }),
    ]
    const fns = fnsFor(createMockSemRef(edges, {}))
    const out = fns.connections('User')
    expect(out.map((e: Edge) => e.to)).toEqual(['moni'])
  })

  it('relate returns the shortest-path edges between two entities', () => {
    const edges = [
      makeEdge({ from: 'user', to: 'moni', type: 'married to' }),
      makeEdge({ from: 'moni', to: 'acme', type: 'works at' }),
    ]
    const fns = fnsFor(createMockSemRef(edges, {}))
    const path = fns.relate('user', 'acme')
    expect(path).not.toBeNull()
    expect(path.map((e: Edge) => e.type)).toEqual(['married to', 'works at'])
  })

  it('egoGraph returns nodes + edges around an entity', () => {
    const edges = [makeEdge({ from: 'user', to: 'moni', type: 'married to' })]
    const fns = fnsFor(createMockSemRef(edges, {}))
    const g = fns.egoGraph('user', { depth: 1 })
    expect(g.nodes).toContain('user')
    expect(g.nodes).toContain('moni')
    expect(g.edges).toHaveLength(1)
  })

  it('helpers no-op when relations are disabled', () => {
    const cap = createMemoryCapability({
      model: 'gpt-5-mini',
      working: true,
      episodic: true,
      semantic: true, // no relations
    })
    const sem = createMockSemRef() // no edge API
    const fns = (cap.fns as (ctx: any) => any)({
      resources: { semanticMemory: sem, get: () => sem, list: () => [sem] },
    })
    expect(fns.connections('user')).toEqual([])
    expect(fns.relate('user', 'moni')).toBeNull()
    expect(fns.egoGraph('user')).toEqual({ nodes: [], edges: [] })
  })
})
