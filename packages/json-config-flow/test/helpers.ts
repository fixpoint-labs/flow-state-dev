import type { BlockContext } from "@flow-state-dev/core/types";

/**
 * Minimal BlockContext for unit-driving compiled catalog blocks.
 * Intentionally loose — production contexts come from the engine.
 */
export function createMockContext(overrides?: Partial<BlockContext>): BlockContext {
  const stateOps = {
    patchState: async () => true,
    setState: async () => true,
    incState: async () => true,
    pushState: async () => true,
    setStateRecord: async () => true,
    deleteStateRecord: async () => true,
    atomicState: async () => true,
  };

  const resolveModel = Object.assign(
    () => {
      throw new Error("No model resolver configured in createMockContext");
    },
    { resolveId: (modelId: string) => modelId },
  );

  const baseContext = {
    request: {
      identity: { type: "request", id: "req_1" },
      state: {},
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      costEstimate: { amount: 0, currency: "USD" },
      ...stateOps,
    },
    user: {
      identity: { type: "user", id: "user_1", userId: "user_1" },
      state: {},
      ...stateOps,
    },
    resources: {
      get: () => {
        throw new Error("mock resource registry has no resources");
      },
      list: () => [],
    },
    response: {
      emit: () => undefined,
      getItems: () => [],
      getItemCount: () => 0,
      subscribeToItems: () => () => undefined,
    },
    emit: {
      message: () => undefined,
      component: () => undefined,
      status: () => undefined,
      trace: {},
    },
    _peekStatus: () => "",
    signal: new AbortController().signal,
    resolveModel,
    getTarget: () => undefined,
    getBlockOutput: () => undefined,
    getBlockResult: () => ({ status: "not_started" as const }),
    wasRescued: () => false,
    targetStateSchemas: {},
    cap: {},
    flow: {
      kind: "test",
      config: Object.freeze({}),
    },
  };

  return { ...baseContext, ...overrides } as unknown as BlockContext;
}
