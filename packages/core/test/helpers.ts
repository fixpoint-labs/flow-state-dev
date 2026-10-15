import type { BlockContext, BlockDefinition, ResponseEmitterHandle } from "../src/types/block";
import { asRuntime } from "../src/types/block";
import type { GeneratorModel, ModelResolver } from "../src/types/model";
import type { ScopeStateOps } from "../src/types/state";

/**
 * Drive a block from test code (FIX-503). Recovers the substrate runtime
 * view via `asRuntime` and dispatches through `run`.
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
    patchState: async () => true,
    setState: async () => true,
    incState: async () => true,
    pushState: async () => true,
    setStateRecord: async () => true,
    deleteStateRecord: async () => true,
    atomicState: async () => true
  };
}

/**
 * What a test may override on the mock context. Tests stub only the parts a
 * block touches, so two fields are looser than `BlockContext`: `resolveModel`
 * may be a plain function without `resolveId`, and `response` may carry only
 * the methods the test reads. They are merged in as given.
 */
export type MockContextOverrides = Omit<Partial<BlockContext>, "resolveModel" | "response"> & {
  resolveModel?: (modelId: string, blockName?: string) => GeneratorModel;
  response?: Partial<ResponseEmitterHandle>;
};

export function createMockContext(overrides?: MockContextOverrides): BlockContext {
  const stateOps = createStateOps<Record<string, unknown>>();
  const resolveModel = ((): GeneratorModel => {
    throw new Error("No model resolver configured in createMockContext");
  }) as unknown as ModelResolver;
  resolveModel.resolveId = (modelId: string) => modelId;

  // A partial context: a test that needs a session, settings or targets passes them.
  const baseContext: Omit<BlockContext, "session" | "settings" | "targets"> = {
    request: {
      identity: { type: "request", id: "req_1" },
      incarnation: "inc_1",
      state: {},
      tokenUsage: { totalConsumed: 0, byModel: {}, remaining: Number.POSITIVE_INFINITY },
      costEstimate: { totalUSD: 0, byModel: {} },
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
      emit: () => undefined,
      getItems: () => [],
      getItemCount: () => 0,
      subscribeToItems: (_l) => () => undefined
    },
    emit: {
      message: () => undefined,
      component: () => undefined,
      status: () => undefined,
      trace: {} as any,
    } as any,
    _peekStatus: () => "",
    signal: new AbortController().signal,
    resolveModel,
    getTarget: () => undefined,
    getBlockOutput: () => undefined,
    getBlockResult: () => ({ status: "not_started" as const }),
    wasRescued: () => false,
    cap: {} as any,
    // The narrowed flow view every production context carries (FIX-1331). A
    // frozen empty bag, so a block that reads `ctx.flow.config` here sees what
    // an unconfigured flow gives it rather than `undefined`.
    flow: { config: Object.freeze({}) },
  };

  return {
    ...baseContext,
    ...overrides
  } as BlockContext;
}
