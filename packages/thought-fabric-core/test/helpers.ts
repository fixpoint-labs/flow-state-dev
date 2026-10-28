import type { BlockContext, ScopeStateOps } from '@flow-state-dev/core/types'

function createStateOps<TState extends object>(): ScopeStateOps<TState> {
  return {
    patchState: async () => true,
    setState: async () => true,
    incState: async () => true,
    pushState: async () => true,
    setStateRecord: async () => true,
    deleteStateRecord: async () => true,
    atomicState: async () => true
  }
}

export function createMockContext(overrides?: Partial<BlockContext>): BlockContext {
  const stateOps = createStateOps<Record<string, unknown>>()

  const baseContext = {
    request: {
      identity: { type: 'request', id: 'req_1' },
      state: {},
      tokenUsage: { totalConsumed: 0, byModel: {}, remaining: Number.POSITIVE_INFINITY },
      costEstimate: { totalUSD: 0, byModel: {} },
      ...stateOps
    },
    user: {
      identity: { type: 'user', id: 'user_1', userId: 'user_1' },
      state: {},
      resources: {
        get: () => {
          throw new Error('mock resource registry has no resources')
        },
        list: () => []
      },
      ...stateOps
    },
    response: {
      emit: () => undefined
    },
    signal: new AbortController().signal,
    resolveModel: () => {
      throw new Error('No model resolver configured in createMockContext')
    },
    getTarget: () => undefined
  } as unknown as BlockContext

  return {
    ...baseContext,
    ...overrides
  }
}
