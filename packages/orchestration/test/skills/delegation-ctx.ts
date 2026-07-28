/**
 * Shared execution-context fixture for the delegation `taskTools` tests.
 *
 * The task tools run as child blocks and read their board off `ctx.parent`, so
 * every test that drives one needs the same two parent surfaces:
 * a live `state` getter and a CAS-shaped `atomicState` that merges the returned
 * patch. Kept in one place rather than per-file — the shape mirrors the real
 * `StateRef` contract, and a copy that drifts from it would pass while testing
 * the wrong thing.
 */
import { DELEGATION_BOARD_FIELD } from "../../src/skills/task-tools-capability";

/**
 * Build a context whose parent carries an own-state delegation board.
 *
 * @param opts.preTasks Tasks to seed the board with, keyed by id. Defaults to an
 *   empty board.
 * @param opts.resolveModel A model resolver to expose on the context. Only the
 *   tests that compile a real `generator` and drive it through the tool executor
 *   need this; the rest invoke tools directly and leave it off.
 */
export function buildDelegationCtx(
  opts: {
    preTasks?: Record<string, unknown>;
    resolveModel?: unknown;
  } = {},
) {
  const parentState: Record<string, unknown> = {
    [DELEGATION_BOARD_FIELD]: opts.preTasks ?? {},
  };
  const parent = {
    name: "executive",
    instanceId: "executive#0",
    get state() {
      return parentState;
    },
    // Mirrors the real StateRef contract: the mutator returns a partial patch
    // that is merged into the state (not an in-place mutation).
    atomicState: async (
      fn: (
        state: Record<string, unknown>,
      ) => Promise<Record<string, unknown>> | Record<string, unknown>,
    ): Promise<void> => {
      const patch = await fn(parentState);
      Object.assign(parentState, patch);
    },
    patchState: async (updates: Record<string, unknown>) => {
      Object.assign(parentState, updates);
    },
  };
  return {
    parent,
    request: { identity: { id: "r1", userId: "u1" }, state: {} },
    session: {
      identity: { id: "s1", userId: "u1" },
      state: {},
      patchState: async () => {},
    },
    org: { identity: { type: "org" as const, id: "p1" } },
    user: {},
    resources: { get: () => undefined, list: () => [] },
    signal: new AbortController().signal,
    response: { emit: async () => {}, getItems: () => [] },
    cap: {},
    ...(opts.resolveModel !== undefined
      ? { resolveModel: opts.resolveModel, _peekStatus: () => "" }
      : {}),
    getTarget: () => undefined,
    getBlockOutput: () => undefined,
    getBlockResult: () => ({ status: "not_started" as const }),
    targets: {},
    emit: { message: () => {}, component: () => {}, status: () => {} },
  } as never;
}
