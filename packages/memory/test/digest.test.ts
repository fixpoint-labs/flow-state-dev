/**
 * Tests for the digest memory tier ([FIX-408]).
 *
 * The generator block is exercised structurally only — the LLM call itself
 * is not run (matches the consolidation generator test pattern). We verify
 * the surrounding contract: schemas, helpers, the guard handler, the
 * persist handler, prompt-context construction, and factory wiring.
 */

import { describe, it, expect } from 'vitest'
import { runForTest } from '@flow-state-dev/testing'
import type { ResourceHandle } from '@flow-state-dev/core'

import { workingMemoryStateSchema } from '../src/working-memory.js'
import type { WorkingMemoryState } from '../src/working-memory.js'
import {
  episodicMemoryStateSchema,
} from '../src/episodic-memory.js'
import type { EpisodicMemoryState, Episode } from '../src/episodic-memory.js'
import {
  semanticMemoryStateSchema,
} from '../src/semantic-memory.js'
import type { SemanticFact, SemanticMemoryState } from '../src/semantic-memory.js'
import { topFacts } from '../src/semantic-memory-helpers.js'
import {
  digestSchema,
  digestSourceSignatureSchema,
  digestMemoryStateSchema,
  createDigestMemoryResource,
} from '../src/digest-memory.js'
import type { Digest, DigestMemoryState } from '../src/digest-memory.js'
import {
  computeSourceSignature,
  isStale,
} from '../src/digest-helpers.js'
import {
  digestRegenerateGuard,
  digestRegeneratePersist,
  buildDigestContext,
  rankEpisodesForDigest,
} from '../src/digest-blocks.js'
import {
  memorySystemStateSchema,
  system,
} from '../src/memory-system.js'
import type { MemorySystemState } from '../src/memory-system.js'

// ---------------------------------------------------------------------------
// Mock resource refs
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

function createMockDigestRef(initial?: Partial<DigestMemoryState>): ResourceHandle<DigestMemoryState> {
  let state: DigestMemoryState = { totalGenerated: 0, ...initial }
  return {
    name: 'digestMemory',
    scope: 'user',
    get state() { return state },
    patchState: async (u) => { state = { ...state, ...u } as DigestMemoryState },
    setState: async (n) => { state = n },
    updateState: async (fn) => { state = await fn(state) },
    readContent: async () => JSON.stringify(state),
    writeContent: async () => {},
    config: { stateSchema: digestMemoryStateSchema, writable: true },
  } as ResourceHandle<DigestMemoryState>
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

function makeEpisode(overrides: Partial<Episode> & { id: string }): Episode {
  return {
    content: `episode ${overrides.id}`,
    subject: 'user',
    occurredAtTurn: 0,
    encodedAt: new Date().toISOString(),
    significance: 0.7,
    category: 'identity',
    context: { sessionId: 'test-session' },
    consolidated: false,
    ...overrides,
  }
}

function makeDigest(overrides?: Partial<Digest>): Digest {
  return {
    content: 'A user we know little about.',
    generatedAt: new Date().toISOString(),
    generatedAtTurn: 0,
    sourceSignature: { semanticFactCount: 0, semanticReinforcementSum: 0, episodeCount: 0 },
    ...overrides,
  }
}

const baseConfig = {
  model: 'gpt-5-mini',
  working: { capacity: 7, maxPinnedSlots: 2, decay: { strategy: 'power-law' as const, rate: 0.5 } },
  episodic: { scope: 'user' as const, significanceThreshold: 0.6, maxEpisodes: 200 },
  semantic: {
    scope: 'user' as const,
    consolidation: { episodicThreshold: 5, onEviction: true, minInterval: 4 },
    pruneThreshold: 20,
  },
  digest: { scope: 'user' as const, maxTokens: 400, topN: { facts: 30, episodes: 10 } },
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

describe('memory/digest', () => {
  describe('schemas', () => {
    it('digestSourceSignatureSchema validates', () => {
      const sig = { semanticFactCount: 3, semanticReinforcementSum: 5, episodeCount: 2 }
      expect(digestSourceSignatureSchema.safeParse(sig).success).toBe(true)
    })

    it('digestSchema validates a complete digest', () => {
      const d = {
        content: 'narrative',
        generatedAt: '2026-01-01T00:00:00.000Z',
        generatedAtTurn: 5,
        sourceSignature: { semanticFactCount: 1, semanticReinforcementSum: 1, episodeCount: 0 },
      }
      expect(digestSchema.safeParse(d).success).toBe(true)
    })

    it('digestMemoryStateSchema accepts unset digest', () => {
      const s = { totalGenerated: 0 }
      const parsed = digestMemoryStateSchema.safeParse(s)
      expect(parsed.success).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // Resource factory
  // ---------------------------------------------------------------------------

  describe('createDigestMemoryResource', () => {
    it('creates resource with given scope', () => {
      const r = createDigestMemoryResource('user')
      expect(r.scope).toBe('user')
      expect(r.writable).toBe(true)
    })

    it('honours org scope', () => {
      const r = createDigestMemoryResource('org')
      expect(r.scope).toBe('org')
    })
  })

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  describe('helpers', () => {
    describe('computeSourceSignature', () => {
      it('sums reinforcement counts and counts items', () => {
        const semRef = createMockSemRef({
          facts: [
            makeFact({ id: 'a', reinforcementCount: 3 }),
            makeFact({ id: 'b', reinforcementCount: 5 }),
          ],
        })
        const epRef = createMockEpRef({ episodes: [makeEpisode({ id: 'e1' }), makeEpisode({ id: 'e2' })] })
        const sig = computeSourceSignature(semRef, epRef)
        expect(sig).toEqual({ semanticFactCount: 2, semanticReinforcementSum: 8, episodeCount: 2 })
      })

      it('treats missing episodic as zero episodes', () => {
        const semRef = createMockSemRef({ facts: [makeFact({ id: 'a' })] })
        const sig = computeSourceSignature(semRef)
        expect(sig.episodeCount).toBe(0)
      })
    })

    describe('isStale', () => {
      it('is stale when no digest exists', () => {
        const digestRef = createMockDigestRef()
        const semRef = createMockSemRef({ facts: [makeFact({ id: 'a' })] })
        expect(isStale(digestRef, semRef)).toBe(true)
      })

      it('is fresh when signature matches', () => {
        const semRef = createMockSemRef({ facts: [makeFact({ id: 'a', reinforcementCount: 2 })] })
        const epRef = createMockEpRef()
        const sig = computeSourceSignature(semRef, epRef)
        const digestRef = createMockDigestRef({ digest: makeDigest({ sourceSignature: sig }) })
        expect(isStale(digestRef, semRef, epRef)).toBe(false)
      })

      it('is stale when fact count differs', () => {
        const semRef = createMockSemRef({ facts: [makeFact({ id: 'a' }), makeFact({ id: 'b' })] })
        const digestRef = createMockDigestRef({
          digest: makeDigest({ sourceSignature: { semanticFactCount: 1, semanticReinforcementSum: 1, episodeCount: 0 } }),
        })
        expect(isStale(digestRef, semRef)).toBe(true)
      })

      it('is stale when reinforcement sum differs', () => {
        const semRef = createMockSemRef({ facts: [makeFact({ id: 'a', reinforcementCount: 4 })] })
        const digestRef = createMockDigestRef({
          digest: makeDigest({ sourceSignature: { semanticFactCount: 1, semanticReinforcementSum: 1, episodeCount: 0 } }),
        })
        expect(isStale(digestRef, semRef)).toBe(true)
      })

      it('is stale when episode count differs', () => {
        const semRef = createMockSemRef({ facts: [makeFact({ id: 'a' })] })
        const epRef = createMockEpRef({ episodes: [makeEpisode({ id: 'e1' })] })
        const digestRef = createMockDigestRef({
          digest: makeDigest({ sourceSignature: { semanticFactCount: 1, semanticReinforcementSum: 1, episodeCount: 0 } }),
        })
        expect(isStale(digestRef, semRef, epRef)).toBe(true)
      })
    })

  })

  // ---------------------------------------------------------------------------
  // topFacts (semantic helper added for digest)
  // ---------------------------------------------------------------------------

  describe('topFacts', () => {
    it('returns top-N by reinforcement count', () => {
      const semRef = createMockSemRef({
        facts: [
          makeFact({ id: 'a', reinforcementCount: 1 }),
          makeFact({ id: 'b', reinforcementCount: 5 }),
          makeFact({ id: 'c', reinforcementCount: 3 }),
        ],
      })
      const top = topFacts(semRef, 2)
      expect(top.map((f) => f.id)).toEqual(['b', 'c'])
    })
  })

  // ---------------------------------------------------------------------------
  // rankEpisodesForDigest
  // ---------------------------------------------------------------------------

  describe('rankEpisodesForDigest', () => {
    it('ranks by significance × recency and slices', () => {
      const eps = [
        makeEpisode({ id: 'old-low', occurredAtTurn: 1, significance: 0.3 }),
        makeEpisode({ id: 'recent-high', occurredAtTurn: 10, significance: 0.9 }),
        makeEpisode({ id: 'recent-low', occurredAtTurn: 10, significance: 0.4 }),
      ]
      const ranked = rankEpisodesForDigest(eps, 2)
      expect(ranked.map((e) => e.id)).toEqual(['recent-high', 'recent-low'])
    })

    it('handles empty input', () => {
      expect(rankEpisodesForDigest([], 5)).toEqual([])
    })
  })

  // ---------------------------------------------------------------------------
  // Prompt context (iterative regeneration)
  // ---------------------------------------------------------------------------

  describe('buildDigestContext', () => {
    it('returns no-op text when not triggered', () => {
      const out = buildDigestContext({
        triggered: false,
        facts: [],
        episodes: [],
      })
      expect(out).toContain('No digest regeneration needed')
    })

    it('includes the previous digest verbatim for iterative regeneration', () => {
      const out = buildDigestContext({
        triggered: true,
        previous: 'PRIOR DIGEST CONTENT',
        facts: [{ subject: 'user', content: 'works at X', category: 'profession', confidence: 0.9, reinforcementCount: 5 }],
        episodes: [],
      })
      expect(out).toContain('PRIOR DIGEST CONTENT')
      expect(out).toContain('Previous digest')
      expect(out).toContain('works at X')
    })

    it('notes absence of prior digest on first generation', () => {
      const out = buildDigestContext({
        triggered: true,
        facts: [{ subject: 'user', content: 'works at X', category: 'profession', confidence: 0.9, reinforcementCount: 1 }],
        episodes: [],
      })
      expect(out).toContain('No previous digest')
    })

    it('includes ranked episodes when provided', () => {
      const out = buildDigestContext({
        triggered: true,
        facts: [],
        episodes: [{ content: 'switched jobs', category: 'event', significance: 0.8, occurredAtTurn: 7 }],
      })
      expect(out).toContain('switched jobs')
    })
  })

  // ---------------------------------------------------------------------------
  // Guard handler
  // ---------------------------------------------------------------------------

  describe('digestRegenerateGuard', () => {
    async function runGuard(opts: {
      input?: { force?: boolean }
      digest?: DigestMemoryState
      facts?: SemanticFact[]
      episodes?: Episode[]
      currentTurn?: number
    } = {}) {
      const wmRef = createMockWmRef({ currentTurn: opts.currentTurn ?? 5 })
      const sysRef = createMockSysRef()
      const semRef = createMockSemRef({ facts: opts.facts ?? [] })
      const epRef = createMockEpRef({ episodes: opts.episodes ?? [] })
      const digestRef = createMockDigestRef(opts.digest)
      const block = digestRegenerateGuard(baseConfig)
      const ctx = {
        resources: createMockResources({
          workingMemory: wmRef,
          memorySystem: sysRef,
          semanticMemory: semRef,
          episodicMemory: epRef,
          digestMemory: digestRef,
        }),
        response: { emit: async () => {} },
      } as any
      return runForTest(block, opts.input as any, ctx)
    }

    it('triggers when no digest exists', async () => {
      const result = await runGuard({ facts: [makeFact({ id: 'a' })] }) as any
      expect(result.triggered).toBe(true)
      expect(result.previous).toBeUndefined()
    })

    it('short-circuits when signature matches (sourceSignature guard)', async () => {
      const facts = [makeFact({ id: 'a', reinforcementCount: 2 })]
      const sig = { semanticFactCount: 1, semanticReinforcementSum: 2, episodeCount: 0 }
      const result = await runGuard({
        facts,
        digest: { totalGenerated: 1, digest: makeDigest({ sourceSignature: sig }) },
      }) as any
      expect(result.triggered).toBe(false)
    })

    it('triggers again when source signature changes', async () => {
      const sig = { semanticFactCount: 1, semanticReinforcementSum: 1, episodeCount: 0 }
      const result = await runGuard({
        facts: [makeFact({ id: 'a', reinforcementCount: 1 }), makeFact({ id: 'b', reinforcementCount: 1 })],
        digest: { totalGenerated: 1, digest: makeDigest({ sourceSignature: sig }) },
      }) as any
      expect(result.triggered).toBe(true)
      expect(result.facts.length).toBe(2)
    })

    it('force=true bypasses the staleness guard', async () => {
      const facts = [makeFact({ id: 'a' })]
      const sig = { semanticFactCount: 1, semanticReinforcementSum: 1, episodeCount: 0 }
      const result = await runGuard({
        input: { force: true },
        facts,
        digest: { totalGenerated: 1, digest: makeDigest({ content: 'PRIOR', sourceSignature: sig }) },
      }) as any
      expect(result.triggered).toBe(true)
      expect(result.previous).toBe('PRIOR')
    })

    it('forwards previous content for iterative regeneration', async () => {
      const sig = { semanticFactCount: 0, semanticReinforcementSum: 0, episodeCount: 0 }
      const result = await runGuard({
        facts: [makeFact({ id: 'a' })],
        digest: { totalGenerated: 1, digest: makeDigest({ content: 'PRIOR', sourceSignature: sig }) },
      }) as any
      expect(result.triggered).toBe(true)
      expect(result.previous).toBe('PRIOR')
    })

    it('does not trigger without a semantic store', async () => {
      const wmRef = createMockWmRef({ currentTurn: 1 })
      const sysRef = createMockSysRef()
      const digestRef = createMockDigestRef()
      const block = digestRegenerateGuard(baseConfig)
      const ctx = {
        resources: createMockResources({
          workingMemory: wmRef,
          memorySystem: sysRef,
          digestMemory: digestRef,
        }),
        response: { emit: async () => {} },
      } as any
      const result = await runForTest(block, undefined as any, ctx) as any
      expect(result.triggered).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // Persist handler
  // ---------------------------------------------------------------------------

  describe('digestRegeneratePersist', () => {
    it('writes content with a fresh signature computed from sources', async () => {
      const wmRef = createMockWmRef({ currentTurn: 9 })
      const semRef = createMockSemRef({
        facts: [makeFact({ id: 'a', reinforcementCount: 2 }), makeFact({ id: 'b', reinforcementCount: 1 })],
      })
      const epRef = createMockEpRef({ episodes: [makeEpisode({ id: 'e1' })] })
      const digestRef = createMockDigestRef()
      const block = digestRegeneratePersist(baseConfig)
      const ctx = {
        resources: createMockResources({
          workingMemory: wmRef,
          semanticMemory: semRef,
          episodicMemory: epRef,
          digestMemory: digestRef,
        }),
        response: { emit: async () => {} },
      } as any
      const out = await runForTest(block, 'NEW DIGEST' as any, ctx) as any

      expect(out.persisted).toBe(true)
      expect(digestRef.state.digest?.content).toBe('NEW DIGEST')
      expect(digestRef.state.digest?.generatedAtTurn).toBe(9)
      expect(digestRef.state.digest?.sourceSignature).toEqual({
        semanticFactCount: 2,
        semanticReinforcementSum: 3,
        episodeCount: 1,
      })
      expect(digestRef.state.totalGenerated).toBe(1)
    })

    it('does not increment totalGenerated on empty content', async () => {
      const wmRef = createMockWmRef()
      const semRef = createMockSemRef()
      const digestRef = createMockDigestRef()
      const block = digestRegeneratePersist(baseConfig)
      const ctx = {
        resources: createMockResources({
          workingMemory: wmRef,
          semanticMemory: semRef,
          digestMemory: digestRef,
        }),
        response: { emit: async () => {} },
      } as any
      const out = await runForTest(block, '' as any, ctx) as any
      expect(out.persisted).toBe(false)
      expect(digestRef.state.totalGenerated).toBe(0)
    })
  })

  // ---------------------------------------------------------------------------
  // memory.system() factory wiring
  // ---------------------------------------------------------------------------

  describe('memory.system() with digest', () => {
    it('digest: true uses defaults and exposes digest + regenerateDigest', () => {
      const mem = system({
        model: 'gpt-5-mini',
        working: true,
        episodic: true,
        semantic: true,
        digest: true,
      })
      expect(mem.digest).toBeDefined()
      expect(mem.digest!.resource).toBeDefined()
      expect(mem.regenerateDigest).toBeDefined()
      expect(mem.digestMemoryCapability).toBeDefined()
      expect(mem.userResources.digestMemory).toBeDefined()
    })

    it('omitted digest disables the tier', () => {
      const mem = system({
        model: 'gpt-5-mini',
        working: true,
        episodic: true,
        semantic: true,
      })
      expect(mem.digest).toBeUndefined()
      expect(mem.regenerateDigest).toBeUndefined()
      expect(mem.digestMemoryCapability).toBeUndefined()
      expect(mem.userResources.digestMemory).toBeUndefined()
    })

    it('digest without semantic throws', () => {
      expect(() => system({
        model: 'gpt-5-mini',
        working: true,
        episodic: true,
        digest: true,
      } as any)).toThrow(/Digest requires semantic/)
    })

    it('digest scope is inherited from semantic (no separate knob)', () => {
      const mem = system({
        model: 'gpt-5-mini',
        working: true,
        episodic: { scope: 'org' },
        semantic: { scope: 'org' },
        digest: true,
      })
      expect(mem.digest!.resource.scope).toBe('org')
    })

    it('custom topN and maxTokens are honoured', () => {
      const mem = system({
        model: 'gpt-5-mini',
        working: true,
        episodic: true,
        semantic: true,
        digest: { maxTokens: 200, topN: { facts: 10, episodes: 3 } },
      })
      expect(mem.digest).toBeDefined()
      // Block creation succeeds — config flows through to block factories.
      expect(mem.regenerateDigest!.kind).toBeDefined()
    })
  })
})
