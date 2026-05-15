/**
 * Verifies the read-side `MemoryProvider` contract: the object returned by
 * `system()` exposes `recall` and `formatContext` callable properties, and
 * its declared return type satisfies `MemoryProvider`.
 */
import { describe, it, expect, expectTypeOf } from 'vitest'
import { system } from '../src/index.js'
import type {
  MemoryProvider,
  MemorySystem,
} from '../src/index.js'

describe('memory/provider — MemoryProvider contract', () => {
  it('system() return type structurally satisfies MemoryProvider', () => {
    expectTypeOf<MemorySystem>().toMatchTypeOf<MemoryProvider>()
  })

  it('system() return value exposes recall and formatContext as callable properties', () => {
    const mem = system({ model: 'gpt-4o-mini', working: { capacity: 5 } })
    expect(typeof mem.recall).toBe('function')
    expect(typeof mem.formatContext).toBe('function')
    expect(typeof mem.contextFormatter).toBe('function')
  })

  it('formatContext aliases contextFormatter (same function reference)', () => {
    const mem = system({ model: 'gpt-4o-mini', working: { capacity: 5 } })
    expect(mem.formatContext).toBe(mem.contextFormatter)
  })
})
