/**
 * Verifies the deprecated TF memory shim re-exports the patterns memory
 * module verbatim. Both the namespace export from the TF root and the
 * `./memory` subpath should resolve to the same factory and capabilities
 * exposed by `@flow-state-dev/patterns/memory`.
 */
import { describe, it, expect } from 'vitest'
import { memory as memoryNamespace } from '../src/index.js'
import * as memorySubpath from '../src/memory/index.js'
import * as patternsMemory from '@flow-state-dev/patterns/memory'

describe('thought-fabric-core/memory — deprecated re-export shim', () => {
  it('TF root namespace exposes the patterns memory factory', () => {
    expect(typeof memoryNamespace.system).toBe('function')
    expect(memoryNamespace.system).toBe(patternsMemory.system)
  })

  it('TF /memory subpath re-exports patterns memory exports', () => {
    expect(memorySubpath.system).toBe(patternsMemory.system)
    expect(memorySubpath.workingMemoryCapability).toBe(
      patternsMemory.workingMemoryCapability,
    )
  })
})
