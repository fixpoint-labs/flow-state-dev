import { describe, it, expect } from 'vitest'
import { perspective } from '../../src/identity/perspective.js'

describe('identity/perspective', () => {
  it('exists as a callable function', () => {
    expect(typeof perspective).toBe('function')
  })

  it('throws not-implemented for now', () => {
    expect(() => perspective({ role: 'analyst' })).toThrow('Not implemented')
  })
})
