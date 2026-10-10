/**
 * Each durable tier carries its own `flowIsolation`, so one flow can share a
 * tier across its instances while isolating another. An unset tier declares
 * nothing and takes the flow's `isolateUserState` default, which is what keeps
 * every existing config keyed where it was.
 *
 * The digest has no knob of its own: it summarizes facts and recent episodes,
 * so it is shared only when both of its sources are.
 */
import { describe, it, expect } from 'vitest'
import { system } from '../src/memory-system'
import {
  createEpisodicMemoryResource,
  createSemanticMemoryResource,
  createDigestMemoryResource,
} from '../src/index'

const MODEL = 'openai/gpt-5.4-mini'

function tiers(episodic: { flowIsolation?: boolean } | true, semantic: { flowIsolation?: boolean } | true) {
  const mem = system({ model: MODEL, working: true, episodic, semantic, digest: true })
  const { episodicMemory, semanticMemory, digestMemory } = mem.capability.userResources
  return {
    episodic: episodicMemory?.flowIsolation,
    semantic: semanticMemory?.flowIsolation,
    digest: digestMemory?.flowIsolation,
  }
}

describe('per-tier flowIsolation', () => {
  it('declares nothing on any tier when no tier asks, so the flow default applies', () => {
    const mem = system({ model: MODEL, working: true, episodic: true, semantic: true, digest: true })
    for (const resource of Object.values(mem.capability.userResources)) {
      expect(resource).toBeDefined()
      expect('flowIsolation' in resource!).toBe(false)
    }
  })

  it('shares the semantic tier while episodic keeps the flow default', () => {
    expect(tiers(true, { flowIsolation: false })).toEqual({
      episodic: undefined,
      semantic: false,
      // Episodic may be isolated by the flow, so the digest can't be shared.
      digest: undefined,
    })
  })

  it('isolates the digest when either source is isolated', () => {
    expect(tiers({ flowIsolation: true }, { flowIsolation: false }).digest).toBe(true)
    expect(tiers({ flowIsolation: false }, { flowIsolation: true }).digest).toBe(true)
  })

  it('shares the digest only when both sources are shared', () => {
    expect(tiers({ flowIsolation: false }, { flowIsolation: false })).toEqual({
      episodic: false,
      semantic: false,
      digest: false,
    })
  })

  it('does not carry episodic isolation over to semantic', () => {
    expect(tiers({ flowIsolation: true }, true).semantic).toBeUndefined()
  })

  it('hands the same resources to the capture pipeline, so the blocks key where the capability does', () => {
    const mem = system({ model: MODEL, working: true, episodic: true, semantic: { flowIsolation: false } })
    const declared = mem.capture.declaredResources ?? {}
    expect(declared.semanticMemory).toBe(mem.capability.userResources.semanticMemory)
    expect(declared.episodicMemory).toBe(mem.capability.userResources.episodicMemory)
  })
})

describe('resource factories', () => {
  it('forward flowIsolation in both directions and leave it off when unset', () => {
    expect(createEpisodicMemoryResource('user', { flowIsolation: true }).flowIsolation).toBe(true)
    expect(createSemanticMemoryResource('user', undefined, { flowIsolation: false }).flowIsolation).toBe(false)
    expect(createDigestMemoryResource('org', { flowIsolation: false }).flowIsolation).toBe(false)
    expect('flowIsolation' in createSemanticMemoryResource('user')).toBe(false)
  })
})
