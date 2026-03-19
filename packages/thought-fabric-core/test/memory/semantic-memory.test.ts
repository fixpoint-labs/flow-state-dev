import { describe, it, expect } from 'vitest'
import type { ResourceHandle } from '@flow-state-dev/core'
import {
  semanticFactSchema,
  semanticMemoryStateSchema,
  createSemanticMemoryResource,
} from '../../src/memory/semantic-memory.js'
import type { SemanticFact, SemanticMemoryState } from '../../src/memory/semantic-memory.js'
import {
  addFact,
  updateFact,
  reinforce,
  removeFact,
  allFacts,
  query,
} from '../../src/memory/semantic-memory-helpers.js'

// ---------------------------------------------------------------------------
// Test helpers
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
    get state() { return state },
    patchState: async (updates) => { state = { ...state, ...updates } as SemanticMemoryState },
    setState: async (next) => { state = next },
    updateState: async (fn) => { state = await fn(state) },
    readContent: async () => JSON.stringify(state),
    writeContent: async () => {},
    config: { stateSchema: semanticMemoryStateSchema, writable: true },
  } as ResourceHandle<SemanticMemoryState>
}

function makeFact(overrides: Partial<SemanticFact> & { id: string }): SemanticFact {
  return {
    content: `fact ${overrides.id}`,
    confidence: 0.7,
    category: 'fact',
    sourceEpisodeIds: [],
    extractedAt: new Date().toISOString(),
    reinforcementCount: 1,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

describe('memory/semanticMemory', () => {
  describe('schemas', () => {
    it('semanticFactSchema validates a complete fact', () => {
      const fact = {
        id: 'sf1',
        content: 'User works at Stripe',
        confidence: 0.8,
        category: 'fact',
        sourceEpisodeIds: ['ep1', 'ep2'],
        extractedAt: '2026-01-01T00:00:00.000Z',
        reinforcementCount: 2,
      }
      expect(semanticFactSchema.safeParse(fact).success).toBe(true)
    })

    it('semanticFactSchema defaults reinforcementCount to 1', () => {
      const fact = {
        id: 'sf1',
        content: 'test',
        confidence: 0.5,
        category: 'fact',
        sourceEpisodeIds: [],
        extractedAt: '2026-01-01T00:00:00.000Z',
      }
      const result = semanticFactSchema.safeParse(fact)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.reinforcementCount).toBe(1)
      }
    })

    it('semanticFactSchema accepts optional lastReinforced', () => {
      const fact = {
        id: 'sf1',
        content: 'test',
        confidence: 0.5,
        category: 'fact',
        sourceEpisodeIds: [],
        extractedAt: '2026-01-01T00:00:00.000Z',
        lastReinforced: '2026-01-02T00:00:00.000Z',
        reinforcementCount: 2,
      }
      expect(semanticFactSchema.safeParse(fact).success).toBe(true)
    })

    it('semanticFactSchema rejects invalid category', () => {
      const fact = {
        id: 'sf1',
        content: 'test',
        confidence: 0.5,
        category: 'invalid',
        sourceEpisodeIds: [],
        extractedAt: '2026-01-01T00:00:00.000Z',
        reinforcementCount: 1,
      }
      expect(semanticFactSchema.safeParse(fact).success).toBe(false)
    })

    it('semanticFactSchema accepts all valid categories', () => {
      for (const cat of ['fact', 'preference', 'relationship', 'pattern']) {
        const fact = {
          id: 'sf1',
          content: 'test',
          confidence: 0.5,
          category: cat,
          sourceEpisodeIds: [],
          extractedAt: '2026-01-01T00:00:00.000Z',
          reinforcementCount: 1,
        }
        expect(semanticFactSchema.safeParse(fact).success).toBe(true)
      }
    })

    it('semanticFactSchema rejects out-of-range confidence', () => {
      const fact = {
        id: 'sf1',
        content: 'test',
        confidence: 1.5,
        category: 'fact',
        sourceEpisodeIds: [],
        extractedAt: '2026-01-01T00:00:00.000Z',
        reinforcementCount: 1,
      }
      expect(semanticFactSchema.safeParse(fact).success).toBe(false)
    })

    it('semanticMemoryStateSchema validates default empty state', () => {
      expect(semanticMemoryStateSchema.safeParse({
        facts: [],
        totalExtracted: 0,
        totalConsolidations: 0,
      }).success).toBe(true)
    })

    it('createSemanticMemoryResource returns a valid resource definition', () => {
      const resource = createSemanticMemoryResource('user')
      expect(resource.stateSchema).toBeDefined()
      expect(resource.writable).toBe(true)
      expect(resource.default).toEqual({ facts: [], totalExtracted: 0, totalConsolidations: 0 })
    })
  })

  // ---------------------------------------------------------------------------
  // addFact
  // ---------------------------------------------------------------------------

  describe('addFact()', () => {
    it('adds fact and returns it with generated ID', async () => {
      const ref = createMockSemRef()
      const result = await addFact(ref, {
        content: 'User works at Stripe',
        confidence: 0.8,
        category: 'fact',
        sourceEpisodeIds: ['ep1'],
      })

      expect(result.id).toMatch(/^sf_[A-Za-z0-9]{6}$/)
      expect(result.content).toBe('User works at Stripe')
      expect(result.confidence).toBe(0.8)
      expect(result.category).toBe('fact')
      expect(result.reinforcementCount).toBe(1)
      expect(result.extractedAt).toBeDefined()
      expect(ref.state.facts).toHaveLength(1)
      expect(ref.state.totalExtracted).toBe(1)
    })

    it('increments totalExtracted on each add', async () => {
      const ref = createMockSemRef()

      await addFact(ref, {
        content: 'First',
        confidence: 0.7,
        category: 'fact',
        sourceEpisodeIds: [],
      })

      await addFact(ref, {
        content: 'Second',
        confidence: 0.6,
        category: 'preference',
        sourceEpisodeIds: [],
      })

      expect(ref.state.totalExtracted).toBe(2)
      expect(ref.state.facts).toHaveLength(2)
    })
  })

  // ---------------------------------------------------------------------------
  // updateFact
  // ---------------------------------------------------------------------------

  describe('updateFact()', () => {
    it('changes content while preserving ID', async () => {
      const ref = createMockSemRef({
        facts: [makeFact({ id: 'sf_abc123', content: 'User works at Google', sourceEpisodeIds: ['ep1'] })],
        totalExtracted: 1,
      })

      const result = await updateFact(ref, 'sf_abc123', 'User works at Stripe', ['ep5'])
      expect(result).toBeDefined()
      expect(result!.id).toBe('sf_abc123')
      expect(result!.content).toBe('User works at Stripe')
    })

    it('merges sourceEpisodeIds (deduped)', async () => {
      const ref = createMockSemRef({
        facts: [makeFact({ id: 'sf_abc123', sourceEpisodeIds: ['ep1', 'ep2'] })],
      })

      const result = await updateFact(ref, 'sf_abc123', 'updated', ['ep2', 'ep3'])
      expect(result!.sourceEpisodeIds).toEqual(['ep1', 'ep2', 'ep3'])
    })

    it('increments reinforcementCount', async () => {
      const ref = createMockSemRef({
        facts: [makeFact({ id: 'sf_abc123', reinforcementCount: 3 })],
      })

      const result = await updateFact(ref, 'sf_abc123', 'updated', [])
      expect(result!.reinforcementCount).toBe(4)
    })

    it('sets lastReinforced timestamp', async () => {
      const ref = createMockSemRef({
        facts: [makeFact({ id: 'sf_abc123' })],
      })

      const result = await updateFact(ref, 'sf_abc123', 'updated', [])
      expect(result!.lastReinforced).toBeDefined()
    })

    it('optionally updates confidence', async () => {
      const ref = createMockSemRef({
        facts: [makeFact({ id: 'sf_abc123', confidence: 0.5 })],
      })

      const result = await updateFact(ref, 'sf_abc123', 'updated', [], 0.9)
      expect(result!.confidence).toBe(0.9)
    })

    it('preserves confidence when newConfidence not provided', async () => {
      const ref = createMockSemRef({
        facts: [makeFact({ id: 'sf_abc123', confidence: 0.5 })],
      })

      const result = await updateFact(ref, 'sf_abc123', 'updated', [])
      expect(result!.confidence).toBe(0.5)
    })

    it('returns undefined for non-existent factId', async () => {
      const ref = createMockSemRef({
        facts: [makeFact({ id: 'sf_abc123' })],
      })

      const result = await updateFact(ref, 'sf_nonexistent', 'updated', [])
      expect(result).toBeUndefined()
    })
  })

  // ---------------------------------------------------------------------------
  // reinforce
  // ---------------------------------------------------------------------------

  describe('reinforce()', () => {
    it('bumps confidence (capped at 1.0)', async () => {
      const ref = createMockSemRef({
        facts: [makeFact({ id: 'sf_abc123', confidence: 0.9 })],
      })

      const result = await reinforce(ref, 'sf_abc123', ['ep5'])
      expect(result!.confidence).toBeCloseTo(0.95, 10)

      const result2 = await reinforce(ref, 'sf_abc123', ['ep6'])
      expect(result2!.confidence).toBe(1.0) // capped at 1.0
    })

    it('increments reinforcementCount', async () => {
      const ref = createMockSemRef({
        facts: [makeFact({ id: 'sf_abc123', reinforcementCount: 1 })],
      })

      await reinforce(ref, 'sf_abc123', [])
      expect(ref.state.facts[0].reinforcementCount).toBe(2)
    })

    it('merges sourceEpisodeIds', async () => {
      const ref = createMockSemRef({
        facts: [makeFact({ id: 'sf_abc123', sourceEpisodeIds: ['ep1'] })],
      })

      const result = await reinforce(ref, 'sf_abc123', ['ep1', 'ep5'])
      expect(result!.sourceEpisodeIds).toEqual(['ep1', 'ep5'])
    })

    it('sets lastReinforced', async () => {
      const ref = createMockSemRef({
        facts: [makeFact({ id: 'sf_abc123' })],
      })

      const result = await reinforce(ref, 'sf_abc123', [])
      expect(result!.lastReinforced).toBeDefined()
    })

    it('accepts custom confidenceBoost', async () => {
      const ref = createMockSemRef({
        facts: [makeFact({ id: 'sf_abc123', confidence: 0.5 })],
      })

      const result = await reinforce(ref, 'sf_abc123', [], 0.2)
      expect(result!.confidence).toBe(0.7)
    })

    it('returns undefined for non-existent factId', async () => {
      const ref = createMockSemRef()
      const result = await reinforce(ref, 'sf_nonexistent', [])
      expect(result).toBeUndefined()
    })
  })

  // ---------------------------------------------------------------------------
  // removeFact
  // ---------------------------------------------------------------------------

  describe('removeFact()', () => {
    it('removes fact by ID', async () => {
      const ref = createMockSemRef({
        facts: [
          makeFact({ id: 'sf_keep' }),
          makeFact({ id: 'sf_remove' }),
        ],
      })

      await removeFact(ref, 'sf_remove')
      expect(ref.state.facts).toHaveLength(1)
      expect(ref.state.facts[0].id).toBe('sf_keep')
    })

    it('is a no-op for non-existent ID', async () => {
      const ref = createMockSemRef({
        facts: [makeFact({ id: 'sf_keep' })],
      })

      await removeFact(ref, 'sf_nonexistent')
      expect(ref.state.facts).toHaveLength(1)
    })
  })

  // ---------------------------------------------------------------------------
  // allFacts
  // ---------------------------------------------------------------------------

  describe('allFacts()', () => {
    it('returns facts sorted by reinforcementCount descending', () => {
      const ref = createMockSemRef({
        facts: [
          makeFact({ id: 'sf_low', reinforcementCount: 1 }),
          makeFact({ id: 'sf_high', reinforcementCount: 5 }),
          makeFact({ id: 'sf_mid', reinforcementCount: 3 }),
        ],
      })

      const result = allFacts(ref)
      expect(result.map((f) => f.id)).toEqual(['sf_high', 'sf_mid', 'sf_low'])
    })

    it('returns empty array for empty state', () => {
      const ref = createMockSemRef()
      expect(allFacts(ref)).toEqual([])
    })
  })

  // ---------------------------------------------------------------------------
  // query
  // ---------------------------------------------------------------------------

  describe('query()', () => {
    it('returns all facts when store has ≤50 facts', () => {
      const ref = createMockSemRef({
        facts: [
          makeFact({ id: 'sf_1', content: 'User likes React' }),
          makeFact({ id: 'sf_2', content: 'User works at Stripe' }),
        ],
      })

      const result = query(ref, 'something unrelated')
      expect(result).toHaveLength(2)
    })

    it('respects limit parameter for small stores', () => {
      const ref = createMockSemRef({
        facts: [
          makeFact({ id: 'sf_1', content: 'First' }),
          makeFact({ id: 'sf_2', content: 'Second' }),
          makeFact({ id: 'sf_3', content: 'Third' }),
        ],
      })

      const result = query(ref, 'anything', 2)
      expect(result).toHaveLength(2)
    })

    it('filters by token overlap for stores with >50 facts', () => {
      const facts = Array.from({ length: 55 }, (_, i) =>
        makeFact({ id: `sf_${i}`, content: i < 3 ? `User likes React framework ${i}` : `Unrelated fact number ${i}` }),
      )
      const ref = createMockSemRef({ facts })

      const result = query(ref, 'React framework')
      // Should return the React-related facts (they have token overlap)
      expect(result.length).toBeGreaterThan(0)
      expect(result.length).toBeLessThan(55)
      expect(result.every((f) => f.content.includes('React') || f.content.includes('framework'))).toBe(true)
    })
  })
})
