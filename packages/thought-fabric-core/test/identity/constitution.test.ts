import { describe, it, expect } from 'vitest'
import { constitution } from '../../src/identity/constitution.js'

describe('identity/constitution', () => {
  it('exists as a callable function', () => {
    expect(typeof constitution).toBe('function')
  })

  it('throws not-implemented for now', () => {
    expect(() => constitution({ values: ['honesty'] })).toThrow('Not implemented')
  })
})
