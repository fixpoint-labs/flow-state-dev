import { describe, it, expect } from 'vitest'
import { scoreSalience } from './score-salience.js'

describe('attention/scoreSalience', () => {
  it('exists as a callable function', () => {
    expect(typeof scoreSalience).toBe('function')
  })

  it('throws not-implemented for now', () => {
    expect(() => scoreSalience({ content: 'test' })).toThrow('Not implemented')
  })
})
