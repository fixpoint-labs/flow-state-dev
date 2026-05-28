/**
 * Tests for the simplified `mem.contextFormatter` ([FIX-407]).
 *
 * The formatter emits a `<memory>` block containing only the rolling digest
 * and working-memory entries. Semantic facts and episodic memories are
 * intentionally absent — they belong on the recall-tool path ([FIX-409]).
 */
import { describe, it, expect } from 'vitest'
import type { ResourceHandle } from '@flow-state-dev/core'
import {
  workingMemoryStateSchema,
} from '../src/working-memory.js'
import type {
  WorkingMemoryState,
  WorkingMemoryEntry,
} from '../src/working-memory.js'
import {
  digestMemoryStateSchema,
  type DigestMemoryState,
  type Digest,
} from '../src/digest-memory.js'
import {
  semanticMemoryStateSchema,
} from '../src/semantic-memory.js'
import type { SemanticFact, SemanticMemoryState } from '../src/semantic-memory.js'
import {
  episodicMemoryStateSchema,
} from '../src/episodic-memory.js'
import type { EpisodicMemoryState, Episode } from '../src/episodic-memory.js'
import { system } from '../src/memory-system.js'

// ---------------------------------------------------------------------------
// Mock resource helpers
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
    state: async () => state,
    patchState: async (u) => { state = { ...state, ...u } as WorkingMemoryState },
    setState: async (n) => { state = n },
    updateState: async (fn) => { state = await fn(state) },
    readContent: async () => JSON.stringify(state),
    writeContent: async () => {},
    config: { stateSchema: workingMemoryStateSchema, writable: true },
  } as ResourceHandle<WorkingMemoryState>
}

function createMockDigestRef(
  initial?: Partial<DigestMemoryState>,
): ResourceHandle<DigestMemoryState> {
  let state: DigestMemoryState = { totalGenerated: 0, ...initial }
  return {
    name: 'digestMemory',
    scope: 'user',
    state: async () => state,
    patchState: async (u) => { state = { ...state, ...u } as DigestMemoryState },
    setState: async (n) => { state = n },
    updateState: async (fn) => { state = await fn(state) },
    readContent: async () => JSON.stringify(state),
    writeContent: async () => {},
    config: { stateSchema: digestMemoryStateSchema, writable: true },
  } as ResourceHandle<DigestMemoryState>
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
    state: async () => state,
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
    state: async () => state,
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

function makeEntry(overrides: Partial<WorkingMemoryEntry> & { id: string; content: string }): WorkingMemoryEntry {
  return {
    salience: 0.7,
    pinned: false,
    addedAtTurn: 0,
    lastAccessedAtTurn: 0,
    importance: 0.7,
    category: 'identity',
    durability: 'session',
    ...overrides,
  } as WorkingMemoryEntry
}

function makeDigest(content: string): Digest {
  return {
    content,
    generatedAt: new Date().toISOString(),
    generatedAtTurn: 0,
    sourceSignature: { semanticFactCount: 0, semanticReinforcementSum: 0, episodeCount: 0 },
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
// Tests
// ---------------------------------------------------------------------------

describe('memory/contextFormatter (FIX-407 simplified)', () => {
  it('renders both digest and working memory', async () => {
    const wmRef = createMockWmRef({
      entries: [
        makeEntry({ id: 'e1', content: 'User name is Jake', salience: 0.9, pinned: true }),
        makeEntry({ id: 'e2', content: 'Debugging React crash', salience: 0.7 }),
      ],
    })
    const digestRef = createMockDigestRef({
      digest: makeDigest('The user is a TypeScript engineer working on a chat app.'),
    })

    const mem = system({
      model: 'gpt-5-mini',
      working: true,
      episodic: true,
      semantic: true,
      digest: true,
    })
    const ctx = {
      resources: createMockResources({
        workingMemory: wmRef,
        digestMemory: digestRef,
        semanticMemory: createMockSemRef(),
        episodicMemory: createMockEpRef(),
      }),
    }

    const result = await mem.contextFormatter(undefined, ctx)
    expect(result).toBeDefined()
    // Formatter returns an object so the framework's context aggregator can
    // nest the keys as XML tags under the parent <memory> tag without
    // escaping inner < and > as text.
    expect(result).toEqual({
      digest: 'The user is a TypeScript engineer working on a chat app.',
      working: '- (pinned) User name is Jake\n- Debugging React crash',
    })
    // Key order matters — framework renders in insertion order, so digest
    // must appear before working.
    expect(Object.keys(result!)).toEqual(['digest', 'working'])
  })

  it('renders working memory only when no digest configured', async () => {
    const wmRef = createMockWmRef({
      entries: [
        makeEntry({ id: 'e1', content: 'User name is Jake', salience: 0.9, pinned: true }),
      ],
    })

    const mem = system({ model: 'gpt-5-mini', working: true })
    const ctx = {
      resources: createMockResources({ workingMemory: wmRef }),
    }

    const result = await mem.contextFormatter(undefined, ctx)
    expect(result).toEqual({ working: '- (pinned) User name is Jake' })
  })

  it('renders working memory only when digest configured but content empty', async () => {
    const wmRef = createMockWmRef({
      entries: [makeEntry({ id: 'e1', content: 'Debugging hydration mismatch' })],
    })
    // Digest configured but no digest content yet (e.g., never regenerated)
    const digestRef = createMockDigestRef()

    const mem = system({
      model: 'gpt-5-mini',
      working: true,
      episodic: true,
      semantic: true,
      digest: true,
    })
    const ctx = {
      resources: createMockResources({
        workingMemory: wmRef,
        digestMemory: digestRef,
        semanticMemory: createMockSemRef(),
        episodicMemory: createMockEpRef(),
      }),
    }

    const result = await mem.contextFormatter(undefined, ctx)
    expect(result).toEqual({ working: '- Debugging hydration mismatch' })
  })

  it('renders digest only when working memory empty', async () => {
    const wmRef = createMockWmRef()
    const digestRef = createMockDigestRef({
      digest: makeDigest('Stable framing about the user.'),
    })

    const mem = system({
      model: 'gpt-5-mini',
      working: true,
      episodic: true,
      semantic: true,
      digest: true,
    })
    const ctx = {
      resources: createMockResources({
        workingMemory: wmRef,
        digestMemory: digestRef,
        semanticMemory: createMockSemRef(),
        episodicMemory: createMockEpRef(),
      }),
    }

    const result = await mem.contextFormatter(undefined, ctx)
    expect(result).toEqual({ digest: 'Stable framing about the user.' })
    expect(result).not.toHaveProperty('working')
  })

  it('returns undefined when both digest and working memory are empty', async () => {
    const wmRef = createMockWmRef()
    const digestRef = createMockDigestRef()

    const mem = system({
      model: 'gpt-5-mini',
      working: true,
      episodic: true,
      semantic: true,
      digest: true,
    })
    const ctx = {
      resources: createMockResources({
        workingMemory: wmRef,
        digestMemory: digestRef,
        semanticMemory: createMockSemRef(),
        episodicMemory: createMockEpRef(),
      }),
    }

    expect(await mem.contextFormatter(undefined, ctx)).toBeUndefined()
  })

  it('returns undefined for empty working memory when no digest configured', async () => {
    const wmRef = createMockWmRef()
    const mem = system({ model: 'gpt-5-mini', working: true })
    const ctx = {
      resources: createMockResources({ workingMemory: wmRef }),
    }

    expect(await mem.contextFormatter(undefined, ctx)).toBeUndefined()
  })

  it('treats whitespace-only digest content as absent', async () => {
    const wmRef = createMockWmRef({
      entries: [makeEntry({ id: 'e1', content: 'Active task' })],
    })
    const digestRef = createMockDigestRef({
      digest: makeDigest('   \n  '),
    })

    const mem = system({
      model: 'gpt-5-mini',
      working: true,
      episodic: true,
      semantic: true,
      digest: true,
    })
    const ctx = {
      resources: createMockResources({
        workingMemory: wmRef,
        digestMemory: digestRef,
        semanticMemory: createMockSemRef(),
        episodicMemory: createMockEpRef(),
      }),
    }

    const result = await mem.contextFormatter(undefined, ctx)
    // No digest content → just the working block
    expect(result).toEqual({ working: '- Active task' })
  })

  it('renders all entries when working memory is at capacity (7)', async () => {
    const wmRef = createMockWmRef({
      entries: [
        makeEntry({ id: 'e1', content: 'item one', salience: 0.95, pinned: true }),
        makeEntry({ id: 'e2', content: 'item two', salience: 0.9 }),
        makeEntry({ id: 'e3', content: 'item three', salience: 0.85 }),
        makeEntry({ id: 'e4', content: 'item four', salience: 0.8 }),
        makeEntry({ id: 'e5', content: 'item five', salience: 0.75 }),
        makeEntry({ id: 'e6', content: 'item six', salience: 0.7 }),
        makeEntry({ id: 'e7', content: 'item seven', salience: 0.65 }),
      ],
    })

    const mem = system({ model: 'gpt-5-mini', working: { capacity: 7 } })
    const ctx = {
      resources: createMockResources({ workingMemory: wmRef }),
    }

    const result = (await mem.contextFormatter(undefined, ctx))!
    const working = result.working ?? ''
    for (const content of ['item one', 'item two', 'item three', 'item four', 'item five', 'item six', 'item seven']) {
      expect(working).toContain(content)
    }
    // Pinned marker preserved
    expect(working).toContain('- (pinned) item one')
    // Salience-sorted ordering
    const idxOne = working.indexOf('item one')
    const idxSeven = working.indexOf('item seven')
    expect(idxOne).toBeLessThan(idxSeven)
  })

  it('does not inject semantic facts or episodes', async () => {
    // Regression guard: even when semantic and episodic stores are populated,
    // the formatter must not include their content. Lookup belongs on FIX-409's
    // recall tool, not on the load path.
    const wmRef = createMockWmRef({
      entries: [makeEntry({ id: 'e1', content: 'Active focus only' })],
    })
    const semRef = createMockSemRef({
      facts: [
        makeFact({ id: 'sf_1', content: 'Works at Stripe', category: 'profession' }),
        makeFact({ id: 'sf_2', content: 'Prefers TypeScript', category: 'preference' }),
      ],
    })
    const epRef = createMockEpRef({
      episodes: [
        makeEpisode({ id: 'ep1', content: 'Debugged a hydration bug last Tuesday' }),
      ],
    })

    const mem = system({
      model: 'gpt-5-mini',
      working: true,
      episodic: true,
      semantic: true,
    })
    const ctx = {
      resources: createMockResources({
        workingMemory: wmRef,
        semanticMemory: semRef,
        episodicMemory: epRef,
      }),
    }

    const result = (await mem.contextFormatter(undefined, ctx))!
    const combined = JSON.stringify(result)
    expect(combined).not.toContain('Works at Stripe')
    expect(combined).not.toContain('Prefers TypeScript')
    expect(combined).not.toContain('Debugged a hydration bug')
    expect(combined).not.toContain('Known facts')
    expect(combined).not.toContain('About user')
  })

})

// ---------------------------------------------------------------------------
// Configurable factory: createMemoryContextFormatter
// ---------------------------------------------------------------------------

describe('memory/createMemoryContextFormatter (configurable factory)', () => {
  it('with no options, defaults to { digest, working } — same as the legacy formatter', async () => {
    const { createMemoryContextFormatter } = await import('../src/formatter.js')
    const wmRef = createMockWmRef({
      entries: [makeEntry({ id: 'e1', content: 'Active focus', salience: 0.9 })],
    })
    const digestRef = createMockDigestRef({ digest: makeDigest('Stable framing.') })
    const formatter = createMemoryContextFormatter()
    const ctx = {
      resources: createMockResources({
        workingMemory: wmRef,
        digestMemory: digestRef,
        semanticMemory: createMockSemRef(),
        episodicMemory: createMockEpRef(),
      }),
    }

    const result = await formatter(undefined, ctx)
    expect(result).toEqual({
      digest: 'Stable framing.',
      working: '- Active focus',
    })
  })

  it('opts into the semantic section with `semantic: true` and renders top-N facts', async () => {
    const { createMemoryContextFormatter } = await import('../src/formatter.js')
    const semRef = createMockSemRef({
      facts: [
        makeFact({ id: 'sf_1', content: 'Works at Stripe', category: 'profession' }),
        makeFact({ id: 'sf_2', content: 'Prefers TypeScript', category: 'preference' }),
      ],
    })
    const formatter = createMemoryContextFormatter({
      digest: false,
      working: false,
      semantic: true,
    })
    const ctx = {
      resources: createMockResources({
        workingMemory: createMockWmRef(),
        semanticMemory: semRef,
      }),
    }

    const result = await formatter(undefined, ctx)
    expect(result).toBeDefined()
    expect(result!.semantic).toContain('Works at Stripe')
    expect(result!.semantic).toContain('Prefers TypeScript')
    expect(result).not.toHaveProperty('digest')
    expect(result).not.toHaveProperty('working')
  })

  it('honours the `topN` knob on the semantic section', async () => {
    const { createMemoryContextFormatter } = await import('../src/formatter.js')
    const semRef = createMockSemRef({
      facts: [
        makeFact({ id: 'sf_1', content: 'fact one', reinforcementCount: 5 }),
        makeFact({ id: 'sf_2', content: 'fact two', reinforcementCount: 4 }),
        makeFact({ id: 'sf_3', content: 'fact three', reinforcementCount: 3 }),
      ],
    })
    const formatter = createMemoryContextFormatter({
      digest: false,
      working: false,
      semantic: { topN: 2 },
    })
    const ctx = {
      resources: createMockResources({
        workingMemory: createMockWmRef(),
        semanticMemory: semRef,
      }),
    }

    const result = (await formatter(undefined, ctx))!
    expect(result.semantic).toContain('fact one')
    expect(result.semantic).toContain('fact two')
    expect(result.semantic).not.toContain('fact three')
  })

  it('opts into the episodic section with `episodic: true` and renders most-recent episodes', async () => {
    const { createMemoryContextFormatter } = await import('../src/formatter.js')
    const epRef = createMockEpRef({
      episodes: [
        makeEpisode({ id: 'ep1', content: 'first event', occurredAtTurn: 1 }),
        makeEpisode({ id: 'ep2', content: 'second event', occurredAtTurn: 2 }),
        makeEpisode({ id: 'ep3', content: 'third event', occurredAtTurn: 3 }),
      ],
    })
    const formatter = createMemoryContextFormatter({
      digest: false,
      working: false,
      episodic: true,
    })
    const ctx = {
      resources: createMockResources({
        workingMemory: createMockWmRef(),
        episodicMemory: epRef,
      }),
    }

    const result = (await formatter(undefined, ctx))!
    // Most-recent first; default limit is 5 so all three appear.
    expect(result.episodic).toMatch(/third event[\s\S]*second event[\s\S]*first event/)
  })

  it('honours the `limit` knob on the episodic section', async () => {
    const { createMemoryContextFormatter } = await import('../src/formatter.js')
    const epRef = createMockEpRef({
      episodes: [
        makeEpisode({ id: 'ep1', content: 'older event', occurredAtTurn: 1 }),
        makeEpisode({ id: 'ep2', content: 'middle event', occurredAtTurn: 2 }),
        makeEpisode({ id: 'ep3', content: 'newest event', occurredAtTurn: 3 }),
      ],
    })
    const formatter = createMemoryContextFormatter({
      digest: false,
      working: false,
      episodic: { limit: 2 },
    })
    const ctx = {
      resources: createMockResources({
        workingMemory: createMockWmRef(),
        episodicMemory: epRef,
      }),
    }

    const result = (await formatter(undefined, ctx))!
    expect(result.episodic).toContain('newest event')
    expect(result.episodic).toContain('middle event')
    expect(result.episodic).not.toContain('older event')
  })

  it('returns undefined when every enabled section is empty', async () => {
    const { createMemoryContextFormatter } = await import('../src/formatter.js')
    const formatter = createMemoryContextFormatter({
      digest: true,
      working: true,
      semantic: true,
      episodic: true,
    })
    const ctx = {
      resources: createMockResources({
        workingMemory: createMockWmRef(),
        digestMemory: createMockDigestRef(),
        semanticMemory: createMockSemRef(),
        episodicMemory: createMockEpRef(),
      }),
    }

    expect(await formatter(undefined, ctx)).toBeUndefined()
  })

  it('skips a section gracefully when its resource is absent from the registry', async () => {
    const { createMemoryContextFormatter } = await import('../src/formatter.js')
    const wmRef = createMockWmRef({
      entries: [makeEntry({ id: 'e1', content: 'present' })],
    })
    // semanticMemory intentionally omitted from the registry
    const formatter = createMemoryContextFormatter({
      digest: false,
      working: true,
      semantic: true,
    })
    const ctx = {
      resources: createMockResources({ workingMemory: wmRef }),
    }

    const result = (await formatter(undefined, ctx))!
    expect(result.working).toContain('present')
    expect(result).not.toHaveProperty('semantic')
  })

  it('combines all four sections when every option is enabled and populated', async () => {
    const { createMemoryContextFormatter } = await import('../src/formatter.js')
    const wmRef = createMockWmRef({
      entries: [makeEntry({ id: 'e1', content: 'wm-entry' })],
    })
    const digestRef = createMockDigestRef({ digest: makeDigest('digest text') })
    const semRef = createMockSemRef({
      facts: [makeFact({ id: 'sf_1', content: 'fact text' })],
    })
    const epRef = createMockEpRef({
      episodes: [makeEpisode({ id: 'ep1', content: 'episode text', occurredAtTurn: 1 })],
    })
    const formatter = createMemoryContextFormatter({
      digest: true,
      working: true,
      semantic: true,
      episodic: true,
    })
    const ctx = {
      resources: createMockResources({
        workingMemory: wmRef,
        digestMemory: digestRef,
        semanticMemory: semRef,
        episodicMemory: epRef,
      }),
    }

    const result = (await formatter(undefined, ctx))!
    expect(Object.keys(result).sort()).toEqual(['digest', 'episodic', 'semantic', 'working'])
    expect(result.digest).toBe('digest text')
    expect(result.working).toContain('wm-entry')
    expect(result.semantic).toContain('fact text')
    expect(result.episodic).toContain('episode text')
  })
})
