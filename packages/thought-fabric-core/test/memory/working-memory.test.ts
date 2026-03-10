import { describe, it, expect } from 'vitest'
import { workingMemory } from '../../src/memory/working-memory.js'

describe('memory/workingMemory', () => {
  it('exists as a callable function', () => {
    expect(typeof workingMemory).toBe('function')
  })

  it('throws not-implemented for now', () => {
    expect(() => workingMemory()).toThrow('Not implemented')
  })
})
