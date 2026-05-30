import { describe, it, expect } from 'vitest'
import type { ResourceHandle } from '@flow-state-dev/core'
import {
  episodeSchema,
  episodicMemoryStateSchema,
  createEpisodicMemoryResource,
} from '../src/episodic-memory.js'
import type { Episode, EpisodicMemoryState } from '../src/episodic-memory.js'
import {
  encode,
  recent,
  markConsolidated,
} from '../src/episodic-memory-helpers.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

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
    patchState: async (updates) => {
      state = { ...state, ...updates } as EpisodicMemoryState
    },
    setState: async (next) => { state = next },
    updateState: async (fn) => { state = await fn(state) },
    readContent: async () => JSON.stringify(state),
    writeContent: async () => {},
    config: { stateSchema: episodicMemoryStateSchema, writable: true },
  } as ResourceHandle<EpisodicMemoryState>
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

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

describe('memory/episodicMemory', () => {
  describe('schemas', () => {
    it('episodeSchema validates a complete episode', () => {
      const episode = {
        id: 'ep1',
        content: 'User prefers dark mode',
        occurredAtTurn: 3,
        encodedAt: '2026-01-01T00:00:00.000Z',
        significance: 0.8,
        category: 'preference',
        context: { sessionId: 'sess-1' },
        consolidated: false,
      }
      expect(episodeSchema.safeParse(episode).success).toBe(true)
    })

    it('episodeSchema defaults consolidated to false', () => {
      const episode = {
        id: 'ep1',
        content: 'test',
        occurredAtTurn: 0,
        encodedAt: '2026-01-01T00:00:00.000Z',
        significance: 0.5,
        category: 'identity',
        context: { sessionId: 'sess-1' },
      }
      const result = episodeSchema.safeParse(episode)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.consolidated).toBe(false)
      }
    })

    it('episodeSchema defaults subject to user for pre-FIX-703 episodes', () => {
      // A pre-change persisted episode has no `subject` field. It must
      // deserialize to 'user' rather than failing validation.
      const legacyEpisode = {
        id: 'ep1',
        content: 'test',
        occurredAtTurn: 0,
        encodedAt: '2026-01-01T00:00:00.000Z',
        significance: 0.5,
        category: 'identity',
        context: { sessionId: 'sess-1' },
        consolidated: false,
      }
      const result = episodeSchema.safeParse(legacyEpisode)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.subject).toBe('user')
      }
    })

    it('episodeSchema preserves an explicit subject', () => {
      const episode = {
        id: 'ep1',
        content: "Is the user's wife",
        occurredAtTurn: 0,
        encodedAt: '2026-01-01T00:00:00.000Z',
        significance: 0.7,
        category: 'relationship',
        context: { sessionId: 'sess-1' },
        consolidated: false,
        subject: 'moni',
      }
      const result = episodeSchema.safeParse(episode)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.subject).toBe('moni')
      }
    })

    it('episodeSchema accepts optional precedingTopic', () => {
      const episode = {
        id: 'ep1',
        content: 'test',
        occurredAtTurn: 0,
        encodedAt: '2026-01-01T00:00:00.000Z',
        significance: 0.5,
        category: 'identity',
        context: { sessionId: 'sess-1', precedingTopic: 'onboarding' },
        consolidated: false,
      }
      expect(episodeSchema.safeParse(episode).success).toBe(true)
    })

    it('episodeSchema rejects invalid category', () => {
      const episode = {
        id: 'ep1',
        content: 'test',
        occurredAtTurn: 0,
        encodedAt: '2026-01-01T00:00:00.000Z',
        significance: 0.5,
        category: 'invalid',
        context: { sessionId: 'sess-1' },
        consolidated: false,
      }
      expect(episodeSchema.safeParse(episode).success).toBe(false)
    })

    it('episodeSchema rejects out-of-range significance', () => {
      const episode = {
        id: 'ep1',
        content: 'test',
        occurredAtTurn: 0,
        encodedAt: '2026-01-01T00:00:00.000Z',
        significance: 1.5,
        category: 'identity',
        context: { sessionId: 'sess-1' },
        consolidated: false,
      }
      expect(episodeSchema.safeParse(episode).success).toBe(false)
    })

    it('episodicMemoryStateSchema validates default empty state', () => {
      expect(episodicMemoryStateSchema.safeParse({ episodes: [], totalEncoded: 0 }).success).toBe(true)
    })

    it('createEpisodicMemoryResource returns a valid resource definition', () => {
      const resource = createEpisodicMemoryResource('user')
      expect(resource.stateSchema).toBeDefined()
      expect(resource.writable).toBe(true)
      expect(resource.default).toEqual({ episodes: [], totalEncoded: 0 })
    })
  })

  // ---------------------------------------------------------------------------
  // encode
  // ---------------------------------------------------------------------------

  describe('encode()', () => {
    it('adds episode and returns it with generated ID', async () => {
      const ref = createMockEpRef()
      const result = await encode(ref, {
        content: 'User prefers TypeScript',
        occurredAtTurn: 5,
        significance: 0.8,
        category: 'preference',
        context: { sessionId: 'sess-1' },
      }, 200)

      expect(result.id).toMatch(/^ep_[A-Za-z0-9]{6}$/)
      expect(result.content).toBe('User prefers TypeScript')
      expect(result.significance).toBe(0.8)
      expect(result.consolidated).toBe(false)
      expect(result.encodedAt).toBeDefined()
      expect(ref.state.episodes).toHaveLength(1)
      expect(ref.state.totalEncoded).toBe(1)
    })

    it('round-trips the subject onto the encoded episode', async () => {
      const ref = createMockEpRef()
      const result = await encode(ref, {
        content: "Is the user's wife",
        subject: 'moni',
        occurredAtTurn: 5,
        significance: 0.8,
        category: 'relationship',
        durability: 'persistent',
        context: { sessionId: 'sess-1' },
      }, 200)

      expect(result.subject).toBe('moni')
      expect(ref.state.episodes[0].subject).toBe('moni')
    })

    it('increments totalEncoded on each encode', async () => {
      const ref = createMockEpRef()

      await encode(ref, {
        content: 'First',
        occurredAtTurn: 1,
        significance: 0.7,
        category: 'identity',
        context: { sessionId: 'sess-1' },
      }, 200)

      await encode(ref, {
        content: 'Second',
        occurredAtTurn: 2,
        significance: 0.6,
        category: 'event',
        context: { sessionId: 'sess-1' },
      }, 200)

      expect(ref.state.totalEncoded).toBe(2)
      expect(ref.state.episodes).toHaveLength(2)
    })

    it('evicts oldest consolidated episode when at maxEpisodes', async () => {
      const ref = createMockEpRef({
        episodes: [
          makeEpisode({ id: 'old-consolidated', occurredAtTurn: 1, consolidated: true }),
          makeEpisode({ id: 'recent-unconsolidated', occurredAtTurn: 5, consolidated: false }),
        ],
        totalEncoded: 2,
      })

      await encode(ref, {
        content: 'New episode',
        occurredAtTurn: 10,
        significance: 0.8,
        category: 'identity',
        context: { sessionId: 'sess-1' },
      }, 2)

      expect(ref.state.episodes).toHaveLength(2)
      const ids = ref.state.episodes.map((e) => e.id)
      expect(ids).not.toContain('old-consolidated')
      expect(ids).toContain('recent-unconsolidated')
    })

    it('evicts oldest unconsolidated episode when no consolidated exist', async () => {
      const ref = createMockEpRef({
        episodes: [
          makeEpisode({ id: 'oldest', occurredAtTurn: 1, consolidated: false }),
          makeEpisode({ id: 'newer', occurredAtTurn: 5, consolidated: false }),
        ],
        totalEncoded: 2,
      })

      await encode(ref, {
        content: 'New episode',
        occurredAtTurn: 10,
        significance: 0.8,
        category: 'identity',
        context: { sessionId: 'sess-1' },
      }, 2)

      expect(ref.state.episodes).toHaveLength(2)
      const ids = ref.state.episodes.map((e) => e.id)
      expect(ids).not.toContain('oldest')
      expect(ids).toContain('newer')
    })

    it('respects maxEpisodes of 1', async () => {
      const ref = createMockEpRef({
        episodes: [makeEpisode({ id: 'existing', occurredAtTurn: 1 })],
        totalEncoded: 1,
      })

      await encode(ref, {
        content: 'Replacement',
        occurredAtTurn: 5,
        significance: 0.9,
        category: 'identity',
        context: { sessionId: 'sess-1' },
      }, 1)

      expect(ref.state.episodes).toHaveLength(1)
      expect(ref.state.episodes[0].content).toBe('Replacement')
    })
  })

  // ---------------------------------------------------------------------------
  // recent
  // ---------------------------------------------------------------------------

  describe('recent()', () => {
    it('returns episodes sorted by occurredAtTurn descending', () => {
      const ref = createMockEpRef({
        episodes: [
          makeEpisode({ id: 'ep1', occurredAtTurn: 1 }),
          makeEpisode({ id: 'ep3', occurredAtTurn: 10 }),
          makeEpisode({ id: 'ep2', occurredAtTurn: 5 }),
        ],
      })

      const result = recent(ref)
      expect(result.map((e) => e.id)).toEqual(['ep3', 'ep2', 'ep1'])
    })

    it('respects limit parameter', () => {
      const ref = createMockEpRef({
        episodes: [
          makeEpisode({ id: 'ep1', occurredAtTurn: 1 }),
          makeEpisode({ id: 'ep2', occurredAtTurn: 5 }),
          makeEpisode({ id: 'ep3', occurredAtTurn: 10 }),
        ],
      })

      const result = recent(ref, 2)
      expect(result).toHaveLength(2)
      expect(result.map((e) => e.id)).toEqual(['ep3', 'ep2'])
    })

    it('returns empty array for empty state', () => {
      const ref = createMockEpRef()
      expect(recent(ref)).toEqual([])
    })

    it('returns all episodes when limit exceeds count', () => {
      const ref = createMockEpRef({
        episodes: [makeEpisode({ id: 'ep1', occurredAtTurn: 1 })],
      })

      const result = recent(ref, 100)
      expect(result).toHaveLength(1)
    })
  })

  // ---------------------------------------------------------------------------
  // markConsolidated
  // ---------------------------------------------------------------------------

  describe('markConsolidated()', () => {
    it('marks matching episodes as consolidated', async () => {
      const ref = createMockEpRef({
        episodes: [
          makeEpisode({ id: 'ep1', consolidated: false }),
          makeEpisode({ id: 'ep2', consolidated: false }),
          makeEpisode({ id: 'ep3', consolidated: false }),
        ],
      })

      await markConsolidated(ref, ['ep1', 'ep3'])

      expect(ref.state.episodes[0].consolidated).toBe(true)
      expect(ref.state.episodes[1].consolidated).toBe(false)
      expect(ref.state.episodes[2].consolidated).toBe(true)
    })

    it('is a no-op for non-existent IDs', async () => {
      const ref = createMockEpRef({
        episodes: [makeEpisode({ id: 'ep1', consolidated: false })],
      })

      await markConsolidated(ref, ['nonexistent'])

      expect(ref.state.episodes[0].consolidated).toBe(false)
    })

    it('is a no-op for already-consolidated episodes', async () => {
      const ref = createMockEpRef({
        episodes: [makeEpisode({ id: 'ep1', consolidated: true })],
      })

      await markConsolidated(ref, ['ep1'])

      expect(ref.state.episodes[0].consolidated).toBe(true)
    })

    it('is a no-op for empty ID list', async () => {
      const ref = createMockEpRef({
        episodes: [makeEpisode({ id: 'ep1', consolidated: false })],
      })

      await markConsolidated(ref, [])

      expect(ref.state.episodes[0].consolidated).toBe(false)
    })
  })
})
