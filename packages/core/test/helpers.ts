import type { BlockContext, BlockDefinition } from "../src/types/block";
import { asRuntime } from "../src/types/block";
import type { GeneratorModel, ModelResolver } from "../src/types/model";
import type { ScopeStateOps } from "../src/types/state";

/**
 * Drive a block from test code (FIX-503). Recovers the substrate runtime
 * view via `asRuntime` and dispatches through `run`. The BP-011 nesting
 * guard does not fire because tests are the top-level caller.
 *
 * Mirrors the `runForTest` helper in `@flow-state-dev/testing`; defined
 * here because `@flow-state-dev/core` cannot depend on `@flow-state-dev/testing`
 * (the latter depends on core).
 */
export function runForTest<TInput, TOutput>(
  block: BlockDefinition<any, any, TInput, TOutput>,
  input: TInput,
  ctx: BlockContext
): Promise<TOutput> {
  return asRuntime(block).run(input, ctx);
}

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
  const resolveModel = ((): GeneratorModel => {
    throw new Error("No model resolver configured in createMockContext");
  }) as ModelResolver;
  resolveModel.resolveId = (modelId: string) => modelId;

  const baseContext: BlockContext = {
    request: {
      identity: { type: "request", id: "req_1" },
      state: {},
      ...stateOps
    },
    user: {
      identity: { type: "user", id: "user_1", userId: "user_1" },
      state: {},
      ...stateOps
    } as any,
    resources: {
      get: () => {
        throw new Error("mock resource registry has no resources");
      },
      list: () => []
    } as any,
    response: {
      emit: () => undefined
    },
    emitStatus: () => undefined,
    signal: new AbortController().signal,
    resolveModel,
    getTarget: () => undefined,
    targetStateSchemas: {},
    cap: {} as any,
  };

  return {
    ...baseContext,
    ...overrides
  };
}
