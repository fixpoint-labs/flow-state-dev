/**
 * The hand-off declaration surface and its construction-time refusals
 * (FIX-982 P1).
 *
 * P1 ships **no execution** — nothing here dispatches out of the request. What
 * is asserted is the contract a board must satisfy *before* the hand-off
 * exists, because the refusals are what stop the first handed-off board being
 * built on a backing that could never settle it.
 *
 * Two properties carry most of the weight:
 *
 * - **The off state.** A bare worker value and a board that hands nothing off
 *   behave exactly as they do today. This is the flag's second state (BP-035)
 *   and the BP-030 promise that no existing board needs editing — asserted,
 *   not assumed, because every refusal below is one bad predicate away from
 *   firing on an ordinary board.
 * - **Refusals are loud and by name.** A silent degrade fails the criterion
 *   this issue inherited from the epic. Each assertion pins the *reason* in the
 *   message, so a refusal that starts firing for a different cause is a test
 *   failure rather than a passing test about the wrong thing.
 */
import { describe, expect, it } from "vitest";
import { handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import {
  defineTaskCollection,
  type TaskCollectionRef,
  type TaskWorker,
} from "../../src/tasks";
import {
  isTaskWorkerEntry,
  taskBoard,
  taskWorkerInputSchema,
} from "../../src/task-board";

function worker(name: string, extra?: Record<string, unknown>): TaskWorker {
  return handler({
    name,
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.null(),
    execute: () => null,
    ...extra,
  }) as TaskWorker;
}

const durable = defineTaskCollection({ id: "hand-off-config-tasks", scope: "user" });

describe("hand-off dispatch — the off state (BP-030 / BP-035)", () => {
  it("leaves a bare-worker board untouched: no boardId, nothing handed off", () => {
    const board = taskBoard({
      name: "inline-board",
      workers: { summarize: worker("summarize") },
    });

    expect(board.handedOff).toEqual([]);
    expect(board.boardId).toBeUndefined();
    expect(board.backing).toBe("request");
  });

  it("refuses an entry that declares no session, by name", () => {
    // An entry with no `session` is not a spelling of "inline" — a bare block
    // in the same position already means that. `resolveWorkerSlot` refuses it
    // rather than silently reading it as inline, because that reading would
    // change what a typo produces from "board never built" to "worker quietly
    // never hands off".
    expect(() =>
      taskBoard({
        name: "no-session",
        workers: { summarize: { worker: worker("summarize-2") } as never },
      })
    ).toThrow(/must declare `session`/);
  });

  it("refuses the removed `dispatch: { mode }` key, by name", () => {
    expect(() =>
      taskBoard({
        name: "removed-dispatch",
        workers: {
          summarize: { worker: worker("summarize-2b"), dispatch: { mode: "inline" } } as never,
        },
      })
    ).toThrow(/removed `dispatch: \{ mode \}` option/);
  });

  it("unwraps entries into the worker blocks the drain composes", () => {
    // The drain must see the same shape it always did. If an entry leaked
    // through as a router route, the router would try to run `{worker,
    // session}` as a block.
    const board = taskBoard({
      name: "unwrap-board",
      boardId: "unwrap-board",
      collection: durable,
      workers: {
        summarize: worker("summarize-3"),
        implement: { worker: worker("implement-3"), session: "per-task" },
      },
    });

    expect(board.handedOff.map((slot) => slot.label)).toEqual(["assignee:implement"]);
    expect(board.handedOff[0]?.worker.name).toBe("implement-3");
  });
});

describe("isTaskWorkerEntry", () => {
  it("tells an entry from a bare block and from a registry", () => {
    const block = worker("discriminate");

    expect(isTaskWorkerEntry({ worker: block })).toBe(true);
    expect(isTaskWorkerEntry({ worker: block, session: "per-task" })).toBe(true);
    expect(isTaskWorkerEntry(block)).toBe(false);
    expect(isTaskWorkerEntry({ summarize: block })).toBe(false);
    expect(isTaskWorkerEntry(undefined)).toBe(false);
    // `worker` present but not a block — a registry whose assignee is literally
    // "worker". Falls through to the registry reading, which is what keeps an
    // existing board routing the way it always did.
    expect(isTaskWorkerEntry({ worker: { name: "not-a-block" } })).toBe(false);
  });
});

describe("hand-off dispatch — construction-time refusals (decision 11)", () => {
  it("refuses a handed-off board with no boardId, naming the worker", () => {
    expect(() =>
      taskBoard({
        name: "no-id",
        collection: durable,
        workers: { implement: { worker: worker("impl-no-id"), session: "per-task" } },
      })
    ).toThrow(/no boardId.*assignee:implement|assignee:implement.*no boardId/s);
  });

  it("refuses a handed-off board on the default request backing", () => {
    // The default backing's lifetime IS the request, so handed-off work on it
    // would run with nothing able to settle or observe it — and the failure
    // would appear only after the first restart.
    expect(() =>
      taskBoard({
        name: "request-backed",
        boardId: "request-backed",
        workers: { implement: { worker: worker("impl-req"), session: "per-task" } },
      })
    ).toThrow(/request-backed collection|must be durable/);
  });

  it("refuses a handed-off board on a sequencer backing", () => {
    expect(() =>
      taskBoard({
        name: "seq-backed",
        boardId: "seq-backed",
        collection: { backing: "sequencer", collectionId: "seq-backed" },
        workers: { implement: { worker: worker("impl-seq"), session: "per-task" } },
      })
    ).toThrow(/sequencer-backed collection|must be durable/);
  });

  it("refuses a handed-off board on a caller-supplied factory backing", () => {
    // A factory is caller-opaque: the board cannot establish that what comes
    // back is durable, so it cannot honestly accept the declaration.
    expect(() =>
      taskBoard({
        name: "factory-backed",
        boardId: "factory-backed",
        collection: () => ({}) as unknown as TaskCollectionRef,
        workers: { implement: { worker: worker("impl-fac"), session: "per-task" } },
      })
    ).toThrow(/factory-backed collection|must be durable/);
  });

  it("refuses a handed-off worker that declares sessionStateSchema, by name", () => {
    // Every handed-off worker in a flow may share its child session with
    // other rows, so two workers picking the same key with different shapes
    // corrupt each other with no error anywhere. The refusal is the whole fix.
    expect(() =>
      taskBoard({
        name: "session-state",
        boardId: "session-state",
        collection: durable,
        workers: {
          implement: {
            worker: worker("impl-session", { sessionStateSchema: z.object({ topic: z.string() }) }),
            session: "per-task",
          },
        },
      })
    ).toThrow(/sessionStateSchema/);
  });

  it("does NOT refuse sessionStateSchema on an INLINE worker of a hand-off board", () => {
    // The collision is a property of running in the child session a handed-off
    // seat may share with other rows, which an inline worker never joins.
    // Refusing it would be a guard firing on a condition it does not actually
    // test.
    expect(() =>
      taskBoard({
        name: "mixed-board",
        boardId: "mixed-board",
        collection: durable,
        workers: {
          summarize: worker("sum-session", { sessionStateSchema: z.object({ topic: z.string() }) }),
          implement: { worker: worker("impl-mixed"), session: "per-task" },
        },
      })
    ).not.toThrow();
  });

  it("accepts a durable handed-off board with a boardId", () => {
    const board = taskBoard({
      name: "good-board",
      boardId: "good-board",
      collection: durable,
      workers: {
        summarize: worker("sum-good"),
        implement: { worker: worker("impl-good"), session: "per-task" },
      },
    });

    expect(board.boardId).toBe("good-board");
    expect(board.backing).toBe("resource");
    expect(board.handedOff).toHaveLength(1);
  });
});

describe("hand-off dispatch — the uniform and floor coordinates", () => {
  it("refuses the removed board-level `dispatch` option", () => {
    // The board-level `dispatch` field is gone entirely — a worker hands off
    // by naming itself under `workers: { <name>: { worker, session } }`, so a
    // uniform worker (which has no seat name) has no way to hand off at all.
    expect(() =>
      taskBoard({
        name: "uniform-detached",
        boardId: "uniform-detached",
        collection: durable,
        workers: worker("uniform-impl"),
        dispatch: { mode: "detached" },
      } as never)
    ).toThrow(/removed board-level `dispatch` option/);
  });

  it("refuses the removed board-level `dispatch` option alongside a registry too", () => {
    expect(() =>
      taskBoard({
        name: "ambiguous",
        boardId: "ambiguous",
        collection: durable,
        workers: { implement: worker("impl-amb") },
        dispatch: { mode: "detached" },
      } as never)
    ).toThrow(/removed board-level `dispatch` option/);
  });

  it("refuses a hand-off through the delegation floor — only a named worker can hand off", () => {
    // The floor has no seat name — `flow.tasks` is keyed by name — so it has
    // no task entry to hand off to.
    expect(() =>
      taskBoard({
        name: "floor-detached",
        boardId: "floor-detached",
        collection: durable,
        workers: { summarize: worker("sum-floor") },
        defaultWorker: { worker: worker("floor-impl"), session: "per-task" },
      })
    ).toThrow(/only a named worker can hand off/);
  });
});

describe("hand-off dispatch — a session-scoped ledger is refused at construction", () => {
  /**
   * A handed-off worker runs in its own child session, and a session-scoped
   * collection resolves against the running session — so the child addresses
   * an empty ledger and never finds the row it was dispatched for.
   *
   * Nothing about that announces itself at runtime. The start gate reads the
   * missing row as a stale claim and returns cleanly, the row stays
   * `in_progress`, the next drain reclaims and redispatches it, and the board
   * loops — burning dispatches, making no progress, and terminating only when
   * the abandonment cap finally errors the row out. A refusal at construction is
   * the only version of this a person can diagnose from the symptom, which is
   * why it is asserted here and not against a running board.
   */
  const sessionScoped = defineTaskCollection({ id: "session-tasks", scope: "session" });

  it("refuses, naming the board and pointing at the scopes that work", () => {
    expect(() =>
      taskBoard({
        name: "session-detached",
        boardId: "session-detached",
        collection: sessionScoped,
        workers: {
          implement: { worker: worker("impl-session"), session: "per-task" },
        },
      })
    ).toThrow(/session-scoped collection/);
  });

  it("names the declared worker, so the message points at what would not run", () => {
    expect(() =>
      taskBoard({
        name: "session-detached-named",
        boardId: "session-detached-named",
        collection: sessionScoped,
        workers: {
          implement: { worker: worker("impl-session-2"), session: "per-task" },
        },
      })
    ).toThrow(/assignee:implement/);
  });

  it("points at sharedToLineage as the fix", () => {
    expect(() =>
      taskBoard({
        name: "session-detached-fix",
        boardId: "session-detached-fix",
        collection: sessionScoped,
        workers: {
          implement: { worker: worker("impl-session-3"), session: "per-task" },
        },
      })
    ).toThrow(/sharedToLineage/);
  });

  it("leaves a session-scoped board with nothing handed off alone", () => {
    // The refusal is about the hand-off, not about the scope. An inline board
    // never leaves its request, so a session-scoped ledger is exactly right for
    // it — and refusing one would outlaw a shape that works today.
    expect(() =>
      taskBoard({
        name: "session-inline",
        collection: defineTaskCollection({ id: "session-inline-tasks", scope: "session" }),
        workers: { implement: worker("impl-session-inline") },
      })
    ).not.toThrow();
  });

  it("accepts a handed-off board on a user-scoped ledger", () => {
    // The control: same declaration, reachable scope. Without this the refusal
    // above would pass just as well against a guard that refused every
    // handed-off board.
    expect(() =>
      taskBoard({
        name: "user-detached",
        boardId: "user-detached",
        collection: defineTaskCollection({ id: "user-tasks", scope: "user" }),
        workers: {
          implement: { worker: worker("impl-user"), session: "per-task" },
        },
      })
    ).not.toThrow();
  });
});

describe("the session-schema refusal sees composed children", () => {
  it("refuses a schema declared by a step inside the worker", () => {
    // A handed-off worker is routinely a sequencer, and the block declaring the
    // schema is usually a step inside it. It runs in the child session exactly
    // as the root would, and collides with a sibling route's key exactly as
    // the root would — so inspecting only the root accepted the board and left
    // the declaration to surface as a missing typed key inside the child.
    const nested = sequencer({ name: "outer" }).tap(
      handler({
        name: "inner-with-state",
        sessionStateSchema: z.object({ needed: z.string() }),
        execute: () => null,
      })
    );

    expect(() =>
      taskBoard({
        name: "nested-session-state",
        boardId: "nested-session-state",
        collection: durable,
        workers: { implement: { worker: nested as never, session: "per-task" } },
      })
    ).toThrow(/sessionStateSchema/);
  });

  it("names the composed block, not just the worker", () => {
    const nested = sequencer({ name: "outer-2" }).tap(
      handler({
        name: "inner-named",
        sessionStateSchema: z.object({ needed: z.string() }),
        execute: () => null,
      })
    );

    expect(() =>
      taskBoard({
        name: "nested-session-named",
        boardId: "nested-session-named",
        collection: durable,
        workers: { implement: { worker: nested as never, session: "per-task" } },
      })
    ).toThrow(/inner-named/);
  });

  it("leaves a composed worker that declares none alone", () => {
    // The control. A walk that flagged any sequencer would refuse most
    // handed-off boards in the codebase.
    const plain = sequencer({ name: "outer-plain" }).tap(
      handler({ name: "inner-plain", execute: () => null })
    );

    expect(() =>
      taskBoard({
        name: "nested-session-clean",
        boardId: "nested-session-clean",
        collection: durable,
        workers: { implement: { worker: plain as never, session: "per-task" } },
      })
    ).not.toThrow();
  });
});
