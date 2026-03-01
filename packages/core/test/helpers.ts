import type { BlockContext } from "../src/types/block";
import type { GeneratorModel } from "../src/types/model";
import type { ScopeStateOps } from "../src/types/state";

function createStateOps<TState extends object>(): ScopeStateOps<TState> {
  return {
    patchState: async () => undefined,
    setState: async () => undefined,
    incState: async () => undefined,
    pushState: async () => undefined,
    setStateRecord: async () => undefined,
    deleteStateRecord: async () => undefined,
    atomicState: async () => undefined
  };
}

export function createMockContext(overrides?: Partial<BlockContext>): BlockContext {
  const stateOps = createStateOps<Record<string, unknown>>();
  const resolveModel = (): GeneratorModel => {
    throw new Error("No model resolver configured in createMockContext");
  };

  const baseContext: BlockContext = {
    request: {
      identity: { type: "request", id: "req_1" },
      state: {},
      ...stateOps
    },
    user: {
      identity: { type: "user", id: "user_1", userId: "user_1" },
      state: {},
      resources: {
        get: () => {
          throw new Error("mock resource registry has no resources");
        },
        list: () => []
      } as any,
      ...stateOps
    },
    response: {
      emit: () => undefined
    },
    signal: new AbortController().signal,
    resolveModel,
    getTarget: () => undefined,
    targets: {}
  };

  return {
    ...baseContext,
    ...overrides
  };
}
