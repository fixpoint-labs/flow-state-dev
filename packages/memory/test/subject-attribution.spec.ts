/**
 * Subject-attribution regression suite ([FIX-703]).
 *
 * Locks the behavior that keeps distinct people distinct across the capture
 * pipeline: the user vs. other-people boundary that the digest, the episode
 * boundary, and the consolidation/prune mutations must all respect.
 *
 * Driven by the Jake/Moni scenario from the bug report:
 *   - "my name is Jake"               → subject=user
 *   - "my wife's name is Moni"        → subject=moni
 *   - "her favorite color is teal"    → ambiguous 'her' → must resolve to moni
 *   - "look up my website ..."        → about the user, never moni
 *
 * Following the spec's guidance, this exercises one acceptance assertion per
 * focused block-level test (reflect, consolidationPersist, prunePersist, and
 * the digest context guard) rather than one heavy end-to-end mock — the more
 * maintainable seam, matching `memory-system.test.ts` conventions.
 */

import { describe, it, expect, vi } from 'vitest'
import { runForTest } from '@flow-state-dev/testing'
import type { ResourceHandle } from '@flow-state-dev/core'

import { workingMemoryStateSchema } from '../src/working-memory.js'
import type { WorkingMemoryState } from '../src/working-memory.js'
import { episodicMemoryStateSchema } from '../src/episodic-memory.js'
import type { EpisodicMemoryState } from '../src/episodic-memory.js'
import { semanticMemoryStateSchema } from '../src/semantic-memory.js'
import type { SemanticFact, SemanticMemoryState } from '../src/semantic-memory.js'
import { allFacts } from '../src/semantic-memory-helpers.js'
import {
  memorySystemReflect,
  consolidationPersist,
  prunePersist,
  type ConsolidationOutput,
  type PruneOutput,
} from '../src/memory-system-blocks.js'
import { memorySystemStateSchema } from '../src/memory-system.js'
import type { MemorySystemState } from '../src/memory-system.js'
import { buildDigestContext } from '../src/digest-blocks.js'

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
  let state: SemanticMemoryState = { facts: [], totalExtracted: 0, totalConsolidations: 0, ...initial }
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

function makeEpisode(overrides: { id: string } & Partial<EpisodicMemoryState['episodes'][number]>) {
  return {
    content: `episode ${overrides.id}`,
    subject: 'user',
    occurredAtTurn: 0,
    encodedAt: new Date().toISOString(),
    significance: 0.7,
    category: 'identity' as const,
    context: { sessionId: 'test-session' },
    consolidated: false,
    durability: 'persistent' as const,
    stale: false,
    ...overrides,
  }
}

const config = {
  model: 'gpt-5-mini',
  working: { capacity: 7, maxPinnedSlots: 2, decay: { strategy: 'power-law' as const, rate: 0.5 } },
  episodic: { scope: 'user' as const, significanceThreshold: 0.6, maxEpisodes: 200 },
  semantic: {
    scope: 'user' as const,
    consolidation: { episodicThreshold: 5, onEviction: true, minInterval: 10 },
    pruneThreshold: 20,
  },
}

// The Jake/Moni transcript, already observer-classified (the observer LLM is
// out of scope for a deterministic block-level test — we feed its output).
const jakeMoniItems = [
  { subject: 'user', content: 'Name is Jake', importance: 0.95, durability: 'permanent', category: 'identity' },
  { subject: 'moni', content: "Is the user's wife", importance: 0.8, durability: 'persistent', category: 'relationship' },
  { subject: 'moni', content: 'Favorite color is teal', importance: 0.7, durability: 'persistent', category: 'preference' },
  { subject: 'user', content: 'Website is jakehoffner.com', importance: 0.7, durability: 'persistent', category: 'identity' },
]

async function runReflect(
  items: typeof jakeMoniItems,
  refs: { wmRef: ResourceHandle<WorkingMemoryState>; sysRef: ResourceHandle<MemorySystemState>; semRef: ResourceHandle<SemanticMemoryState>; epRef: ResourceHandle<EpisodicMemoryState> },
) {
  const block = memorySystemReflect(config)
  const ctx = {
    resources: createMockResources({
      workingMemory: refs.wmRef,
      memorySystem: refs.sysRef,
      semanticMemory: refs.semRef,
      episodicMemory: refs.epRef,
    }),
    session: { items: { all: () => [] }, instanceId: 'jake-moni-session' },
    response: { emit: async () => {} },
  } as any
  return runForTest(block, { items } as any, ctx)
}

describe('memory/subject-attribution (FIX-703)', () => {
  // Acceptance #1: semantic facts route to the right owner; user-about info
  // never lands on moni.
  it('routes each observed item to a semantic fact tagged with its subject', async () => {
    const wmRef = createMockWmRef()
    const sysRef = createMockSysRef()
    const semRef = createMockSemRef()
    const epRef = createMockEpRef()

    await runReflect(jakeMoniItems, { wmRef, sysRef, semRef, epRef })

    const userFacts = allFacts(semRef, 'user')
    const moniFacts = allFacts(semRef, 'moni')

    expect(userFacts.map((f) => f.content)).toContain('Name is Jake')
    expect(userFacts.map((f) => f.content)).toContain('Website is jakehoffner.com')
    expect(moniFacts.map((f) => f.content)).toEqual(
      expect.arrayContaining(["Is the user's wife", 'Favorite color is teal']),
    )

    // The user's website must never be attributed to moni.
    expect(moniFacts.map((f) => f.content)).not.toContain('Website is jakehoffner.com')
    const website = semRef.state.facts.find((f) => f.content === 'Website is jakehoffner.com')
    expect(website?.subject).toBe('user')
  })

  // Acceptance #5: episodes carry the observer's subject so consolidation
  // inherits ownership rather than re-deriving it.
  it('encodes the subject onto the episode at the episode boundary', async () => {
    const wmRef = createMockWmRef()
    const sysRef = createMockSysRef()
    const semRef = createMockSemRef()
    const epRef = createMockEpRef()

    await runReflect(jakeMoniItems, { wmRef, sysRef, semRef, epRef })

    const wifeEpisode = epRef.state.episodes.find((e) => e.content === "Is the user's wife")
    expect(wifeEpisode?.subject).toBe('moni')
    const nameEpisode = epRef.state.episodes.find((e) => e.content === 'Name is Jake')
    expect(nameEpisode?.subject).toBe('user')
  })

  // Acceptance #2: the digest guard hands the generator an explicit
  // user-vs-others split, so the model cannot melt the two people into one.
  it('digest context separates the primary user from other people', () => {
    const out = buildDigestContext({
      triggered: true,
      facts: [
        { subject: 'user', content: 'Name is Jake', category: 'identity', confidence: 0.9, reinforcementCount: 3 },
        { subject: 'user', content: 'Website is jakehoffner.com', category: 'identity', confidence: 0.7, reinforcementCount: 1 },
        { subject: 'moni', content: "Is the user's wife", category: 'relationship', confidence: 0.8, reinforcementCount: 2 },
        { subject: 'moni', content: 'Favorite color is teal', category: 'preference', confidence: 0.7, reinforcementCount: 1 },
      ],
      episodes: [],
    })

    expect(out).toContain('Primary user (subject=user)')
    expect(out).toContain('Other people / entities')

    // Jake's facts sit under the user heading; Moni's sit under others, labeled.
    const userSection = out.slice(out.indexOf('Primary user'), out.indexOf('Other people'))
    expect(userSection).toContain('Name is Jake')
    expect(userSection).toContain('Website is jakehoffner.com')
    expect(userSection).not.toContain('teal')

    const otherSection = out.slice(out.indexOf('Other people'))
    expect(otherSection).toContain('moni')
    expect(otherSection).toContain('teal')
    // The user's website must not be re-listed under moni.
    expect(otherSection).not.toContain('jakehoffner.com')
  })

  // Acceptance #3: consolidation reinforce/update cannot rewrite a fact whose
  // stored subject differs from the proposed subject.
  describe('consolidation subject guard', () => {
    async function runPersist(
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

    it('skips a reinforce whose target subject differs and warns', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const semRef = createMockSemRef({
        facts: [makeFact({ id: 'sf_user', subject: 'user', content: 'Name is Jake', reinforcementCount: 2 })],
      })

      const result = await runPersist(semRef, {
        facts: [{
          subject: 'moni',
          content: 'Favorite color is teal',
          confidence: 0.8,
          category: 'preference',
          sourceEpisodeIds: ['ep1'],
          action: 'reinforce',
          targetFactId: 'sf_user',
        }],
      }) as any

      expect(result.reinforced).toBe(0)
      // The user's fact is untouched — content and reinforcement count preserved.
      expect(semRef.state.facts[0].content).toBe('Name is Jake')
      expect(semRef.state.facts[0].reinforcementCount).toBe(2)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('subject mismatch'))
      warn.mockRestore()
    })

    it('does not mark source episodes consolidated when a fact is guard-skipped', async () => {
      // Regression: a skipped cross-subject mutation must leave its source
      // episodes eligible for a later pass, or the content is lost forever.
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const semRef = createMockSemRef({
        facts: [makeFact({ id: 'sf_user', subject: 'user', content: 'Name is Jake' })],
      })
      const epRef = createMockEpRef({ episodes: [makeEpisode({ id: 'ep_moni', subject: 'moni' })] })

      await runPersist(semRef, {
        facts: [{
          subject: 'moni',
          content: 'Favorite color is teal',
          confidence: 0.8,
          category: 'preference',
          sourceEpisodeIds: ['ep_moni'],
          action: 'reinforce',
          targetFactId: 'sf_user',
        }],
      }, epRef) as any

      expect(epRef.state.episodes[0].consolidated).toBe(false)
      warn.mockRestore()
    })

    it('skips an update whose target subject differs and warns', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const semRef = createMockSemRef({
        facts: [makeFact({ id: 'sf_user', subject: 'user', content: 'Name is Jake' })],
      })

      const result = await runPersist(semRef, {
        facts: [{
          subject: 'moni',
          content: 'Name is Moni',
          confidence: 0.9,
          category: 'identity',
          sourceEpisodeIds: ['ep1'],
          action: 'update',
          targetFactId: 'sf_user',
        }],
      }) as any

      expect(result.updated).toBe(0)
      expect(semRef.state.facts[0].content).toBe('Name is Jake')
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('subject mismatch'))
      warn.mockRestore()
    })

    it('still invalidates a mismatched-subject target but warns', async () => {
      // Deletion isn't cross-contamination, so a mismatched invalidate proceeds —
      // but it warns for observability. This locks that intentional asymmetry
      // with reinforce/update.
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const semRef = createMockSemRef({
        facts: [makeFact({ id: 'sf_user', subject: 'user', content: 'Name is Jake' })],
      })

      const result = await runPersist(semRef, {
        facts: [{
          subject: 'moni',
          content: '',
          confidence: 0,
          category: 'identity',
          sourceEpisodeIds: ['ep1'],
          action: 'invalidate',
          targetFactId: 'sf_user',
        }],
      }) as any

      expect(result.invalidated).toBe(1)
      expect(semRef.state.facts).toHaveLength(0)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('subject mismatch'))
      warn.mockRestore()
    })

    it('allows a reinforce when the target subject matches', async () => {
      const semRef = createMockSemRef({
        facts: [makeFact({ id: 'sf_user', subject: 'user', content: 'Name is Jake', reinforcementCount: 2 })],
      })

      const result = await runPersist(semRef, {
        facts: [{
          subject: 'user',
          content: '',
          confidence: 0.8,
          category: 'identity',
          sourceEpisodeIds: ['ep1'],
          action: 'reinforce',
          targetFactId: 'sf_user',
        }],
      }) as any

      expect(result.reinforced).toBe(1)
      expect(semRef.state.facts[0].reinforcementCount).toBe(3)
    })
  })

  // Acceptance #4: prune never merges facts across subjects.
  describe('prune subject guard', () => {
    async function runPrune(semRef: ResourceHandle<SemanticMemoryState>, input: PruneOutput) {
      const block = prunePersist(config)
      const ctx = {
        resources: createMockResources({ semanticMemory: semRef }),
        response: { emit: async () => {} },
      } as any
      return runForTest(block, input as any, ctx)
    }

    it('skips a merge that spans subjects and leaves both facts intact', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const semRef = createMockSemRef({
        facts: [
          makeFact({ id: 'sf_user', subject: 'user', content: 'Name is Jake' }),
          makeFact({ id: 'sf_moni', subject: 'moni', content: 'Name is Moni' }),
        ],
      })

      const result = await runPrune(semRef, {
        removals: [],
        merges: [{ sourceFactIds: ['sf_user', 'sf_moni'], mergedContent: 'Jake and Moni', reason: 'both are names' }],
      }) as any

      expect(result.merged).toBe(0)
      expect(semRef.state.facts).toHaveLength(2)
      expect(semRef.state.facts.map((f) => f.content)).toEqual(
        expect.arrayContaining(['Name is Jake', 'Name is Moni']),
      )
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('prune merge refused'))
      warn.mockRestore()
    })

    it('refuses a merge that references a missing source fact', async () => {
      // A missing id means we can't verify its subject, so the merge is refused
      // rather than risk writing cross-subject content onto the survivor.
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const semRef = createMockSemRef({
        facts: [makeFact({ id: 'sf_user', subject: 'user', content: 'Name is Jake' })],
      })

      const result = await runPrune(semRef, {
        removals: [],
        merges: [{ sourceFactIds: ['sf_user', 'sf_missing'], mergedContent: 'merged', reason: 'hallucinated id' }],
      }) as any

      expect(result.merged).toBe(0)
      expect(semRef.state.facts).toHaveLength(1)
      expect(semRef.state.facts[0].content).toBe('Name is Jake')
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('prune merge refused'))
      warn.mockRestore()
    })

    it('still merges facts that share a subject', async () => {
      const semRef = createMockSemRef({
        facts: [
          makeFact({ id: 'sf_a', subject: 'moni', content: 'Born in Maryland' }),
          makeFact({ id: 'sf_b', subject: 'moni', content: 'Born in May' }),
        ],
      })

      const result = await runPrune(semRef, {
        removals: [],
        merges: [{ sourceFactIds: ['sf_a', 'sf_b'], mergedContent: 'Born in May in Maryland', reason: 'same birth fact' }],
      }) as any

      expect(result.merged).toBe(1)
      expect(semRef.state.facts).toHaveLength(1)
      expect(semRef.state.facts[0].content).toBe('Born in May in Maryland')
    })
  })
})
