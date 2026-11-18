import { describe, expect, it } from 'vitest'
import { defineFlow, handler } from '@flow-state-dev/core'
import { memory, type MemoryFlowBuilder } from '../src/kit/index'

describe('memory kit', () => {
  it('validates its public config at the factory', () => {
    expect(() => memory({ model: '', working: true })).toThrow(/model/)
    expect(() => memory({ model: 'stub', working: true, semantic: true })).toThrow(/semantic.*episodic/i)
    expect(() => memory({ model: 'stub', working: true, extra: true } as never)).toThrow(/extra/)
  })

  it('builds each slot flow on the one installed memory system', async () => {
    let received: Parameters<MemoryFlowBuilder>[0] | undefined
    const builder: MemoryFlowBuilder = (mem) => {
      received = mem
      const read = handler({
        name: 'read-memory-kit',
        uses: [mem.capability.with({ digest: false, working: false, recall: false })],
        execute: () => 'ok',
      })
      return defineFlow({
          kind: 'memory-kit-probe',
          resources: { ...mem.sessionResources, ...mem.userResources },
          actions: { read: { block: read } },
        })()
    }
    const instance = memory({ model: 'stub', working: true, episodic: true })
    const installed = await instance.definition.install({
      config: instance.config,
      folder: undefined,
      slots: { flows: { probe: builder } },
    } as never)

    expect(received?.capability).toBeDefined()
    expect(installed.flows).toHaveLength(1)
    expect(Object.keys((installed.flows[0] as any).resources ?? {})).toEqual(
      expect.arrayContaining(['workingMemory', 'memorySystem', 'episodicMemory']),
    )
  })
})
