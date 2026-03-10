import { describe, it, expect } from 'vitest'
import { filterRelevance } from './filter-relevance.js'

describe('attention/filterRelevance', () => {
  it('exists as a callable function', () => {
    expect(typeof filterRelevance).toBe('function')
  })

  it('throws not-implemented for now', () => {
    expect(() => filterRelevance({ items: [], query: 'test' })).toThrow('Not implemented')
  })
})
