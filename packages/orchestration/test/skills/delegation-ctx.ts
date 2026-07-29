/**
 * Shared execution-context fixture for the delegation tests.
 *
 * Every delegation test drives the same object graph: an executive generator
 * that owns a delegation board on its own state, with `self` and `parent`
 * aliased to that same ref by default (pass `self: false` to opt out). For why
 * the alias matters, see delegation-caps.test.ts.
 */
import { createMockSkillsCollection } from "./mocks";
import { DELEGATION_BOARD_FIELD } from "../../src/skills/task-tools-capability";

/**
 * Build a mock generator execution ctx whose own state carries a delegation
 * board, plus a handle on that state so a test can assert what the board became.
 *
 * @param opts.preTasks Tasks to seed the board with, keyed by id. Defaults to an
 *   empty board.
 * @param opts.collection The skills collection exposed on `ctx.resources`.
 *   Defaults to a fresh mock; pass one to seed skills or share it across ctxs.
 * @param opts.resolveModel A model resolver to expose on the context. Only the
 *   tests that compile a real `generator` and drive it through the tool executor
 *   need this; the rest invoke tools directly and leave it off.
 * @param opts.self Pass `false` to omit `ctx.self`, leaving only `ctx.parent`
 *   set. Tests that call a task tool directly (no generator/tool-executor in
 *   between) need this: with the default alias, a resolver that read
 *   `ctx.self` instead of `ctx.parent` would still find the right board and
 *   the test would never notice.
 */
export function buildDelegationCtx(
  opts: {
    preTasks?: Record<string, unknown>;
    collection?: ReturnType<typeof createMockSkillsCollection>;
    resolveModel?: unknown;
    self?: false;
  } = {},
) {
  const collection = opts.collection ?? createMockSkillsCollection();
  const selfState: Record<string, unknown> = {
    [DELEGATION_BOARD_FIELD]: opts.preTasks ?? {},
  };
  const stateRef = {
    name: "executive",
    instanceId: "executive#0",
    get state() {
      return selfState;
    },
    // Mirrors the real StateRef contract: the mutator returns a partial patch
    // that is merged into the state (not an in-place mutation).
    atomicState: async (
      fn: (
        state: Record<string, unknown>,
      ) => Promise<Record<string, unknown>> | Record<string, unknown>,
    ): Promise<void> => {
      Object.assign(selfState, await fn(selfState));
    },
    patchState: async (updates: Record<string, unknown>) => {
      Object.assign(selfState, updates);
    },
  };
  const ctx = {
    ...(opts.self === false ? {} : { self: stateRef }),
    parent: stateRef,
    request: { identity: { id: "r1", userId: "u1" }, state: {} },
    session: {
      identity: { id: "s1", userId: "u1" },
      state: {} as Record<string, unknown>,
      patchState: async () => {},
    },
    org: { identity: { type: "org" as const, id: "p1" } },
    user: {},
    resources: {
      skills: collection,
      get: (k: string) => (k === "skills" ? collection : undefined),
      list: () => [collection],
    },
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
  };
  return { ctx: ctx as never, selfState };
}
