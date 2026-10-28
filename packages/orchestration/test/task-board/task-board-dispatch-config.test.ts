/**
 * The dispatch declaration surface and its construction-time refusals
 * (FIX-982 P1).
 *
 * P1 ships **no execution** — nothing here dispatches out of the request. What
 * is asserted is the contract a board must satisfy *before* the dispatch
 * exists, because the refusals are what stop the first dispatched board being
 * built on a backing that could never settle it.
 *
 * Two properties carry most of the weight:
 *
 * - **The off state.** A bare worker value and a board that dispatches nothing
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
import { defineCapability, defineFlow, dispatcher, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import {
  defineTaskCollection,
  type TaskCollectionRef,
  type TaskWorker,
} from "../../src/tasks";
import {
  isTaskDispatcher,
  taskBoard,
  taskWorkerInputSchema,
} from "../../src/task-board";
import { heard } from "../fixtures/heard";

function worker(name: string, extra?: Record<string, unknown>): TaskWorker {
  return handler({
    name,
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.null(),
    execute: () => null,
    ...extra,
  }) as TaskWorker;
}

let assigneeCount = 0;
/** An assignee that dispatches: the dispatcher a board reads its address from. */
function assignee(action = "implement"): TaskWorker {
  assigneeCount += 1;
  return dispatcher({
    name: `assignee-${action}-${assigneeCount}`,
    type: "task",
    action,
    session: "per-task",
  }) as unknown as TaskWorker;
}

const durable = defineTaskCollection({ id: "dispatch-config-tasks", scope: "user" });

describe("task dispatch — the off state (BP-030 / BP-035)", () => {
  it("leaves a bare-worker board untouched: no boardId, nothing dispatched", () => {
    const board = taskBoard({
      name: "inline-board",
      workers: { summarize: worker("summarize") },
    });

    expect(board.dispatchers).toEqual([]);
    expect(board.boardId).toBeUndefined();
    expect(board.backing).toBe("request");
  });

  it("refuses the removed `{ worker, dispatch }` assignee shape by name", () => {
    // An assignee is a block. The old entry shape would otherwise be read as an
    // object with no `run`, and the board must say which shape it saw rather
    // than fail later on a row nobody routes.
    expect(() =>
      taskBoard({
        name: "old-entry-shape",
        boardId: "old-entry-shape",
        collection: durable,
        workers: {
          summarize: { worker: worker("summarize-2b"), dispatch: { mode: "detached" } } as never,
        },
      })
    ).toThrow(/removed `dispatch: \{ mode \}` option/);
  });

  it("refuses the removed `{ block, session }` assignee shape by name", () => {
    expect(() =>
      taskBoard({
        name: "old-block-shape",
        boardId: "old-block-shape",
        mode: "delegation",
        collection: durable,
        workers: { summarize: { block: worker("summarize-2c"), session: "per-task" } as never },
      })
    ).toThrow(/removed `\{ block, session \}` assignee shape/);
  });

  it("refuses an assignee that is not a block, naming the assignee", () => {
    expect(() =>
      taskBoard({
        name: "not-a-block",
        workers: { summarize: "summarize" as never },
      })
    ).toThrow(/assignee "summarize" is not a block/);
  });

  it("reads a dispatcher assignee as dispatched, with the address it carries", () => {
    // The drain must see blocks in every assignee. A dispatcher is one, so the
    // routing table is built from the same shape it always was; what the
    // board adds is knowing which assignees dispatch, and where to.
    const board = taskBoard({
      name: "unwrap-board",
      boardId: "unwrap-board",
      mode: "delegation",
      collection: durable,
      workers: {
        implement: assignee("implement"),
      },
    });

    expect(board.dispatchers.map((slot) => slot.label)).toEqual(["assignee:implement"]);
    expect(board.dispatchers[0]?.dispatch).toEqual({
      type: "task",
      action: "implement",
      session: "per-task",
    });
  });
});

describe("isTaskDispatcher", () => {
  it("tells a task dispatcher from an inline block and from a registry", () => {
    const block = worker("discriminate");

    expect(isTaskDispatcher(assignee("implement"))).toBe(true);
    expect(isTaskDispatcher(block)).toBe(false);
    expect(isTaskDispatcher({ summarize: block })).toBe(false);
    expect(isTaskDispatcher(undefined)).toBe(false);
    expect(
      isTaskDispatcher(
        dispatcher({ name: "internal", type: "internal", action: "x", session: { key: () => "k" } })
      )
    ).toBe(false);
  });
});

describe("task dispatch — construction-time refusals (decision 11)", () => {
  it("refuses a dispatched board with no boardId, naming the worker", () => {
    expect(() =>
      taskBoard({
        name: "no-id",
        collection: durable,
        workers: { implement: assignee("implement") },
      })
    ).toThrow(/no boardId.*assignee:implement|assignee:implement.*no boardId/s);
  });

  it("refuses a dispatched board on the default request backing", () => {
    // The default backing's lifetime IS the request, so dispatched work on it
    // would run with nothing able to settle or observe it — and the failure
    // would appear only after the first restart.
    expect(() =>
      taskBoard({
        name: "request-backed",
        boardId: "request-backed",
        mode: "delegation",
        workers: { implement: assignee("implement") },
      })
    ).toThrow(/request-backed collection|must be durable/);
  });

  it("refuses a dispatched board on a sequencer backing", () => {
    expect(() =>
      taskBoard({
        name: "seq-backed",
        boardId: "seq-backed",
        mode: "delegation",
        collection: { backing: "sequencer", collectionId: "seq-backed" },
        workers: { implement: assignee("implement") },
      })
    ).toThrow(/sequencer-backed collection|must be durable/);
  });

  it("refuses a dispatched board on a caller-supplied factory backing", () => {
    // A factory is caller-opaque: the board cannot establish that what comes
    // back is durable, so it cannot honestly accept the declaration.
    expect(() =>
      taskBoard({
        name: "factory-backed",
        boardId: "factory-backed",
        mode: "delegation",
        collection: () => ({}) as unknown as TaskCollectionRef,
        workers: { implement: assignee("implement") },
      })
    ).toThrow(/factory-backed collection|must be durable/);
  });

  it("refuses a dispatched entry block that declares sessionStateSchema, at defineFlow", () => {
    // Every dispatched block in a flow may share its child session with other
    // rows, so two blocks picking the same key with different shapes corrupt
    // each other with no error anywhere. The refusal is the whole fix. It
    // fires when the flow is defined — the block lives on the flow, so the
    // board cannot see it any earlier.
    const board = taskBoard({
      name: "session-state",
      boardId: "session-state",
      mode: "delegation",
      collection: durable,
      workers: { implement: assignee("implement") },
    });
    expect(() =>
      defineFlow({ internal: { actions: { ...heard } },
        kind: "session-state",
        actions: { run: { block: board.drain } },
        task: { actions: {
          implement: {
            block: worker("impl-session", { sessionStateSchema: z.object({ topic: z.string() }) }),
          },
        } },
      })
    ).toThrow(/sessionStateSchema/);
  });

  it("refuses a dispatched entry block whose capability declares sessionStateSchema", () => {
    // The schema arrives through `uses`, not the block's own config, and lands
    // in the same shared child session; the refusal reads the block's resolved
    // capabilities so the channel does not matter.
    const memo = defineCapability({
      name: "memo",
      sessionStateSchema: z.object({ topic: z.string() }),
    });
    const board = taskBoard({
      name: "cap-session",
      boardId: "cap-session",
      mode: "delegation",
      collection: durable,
      workers: { implement: assignee("implement") },
    });
    expect(() =>
      defineFlow({ internal: { actions: { ...heard } },
        kind: "cap-session",
        actions: { run: { block: board.drain } },
        task: { actions: { implement: { block: worker("impl-cap", { uses: [memo] }) } } },
      })
    ).toThrow(/via capability "memo"/);
  });

  it("accepts a durable dispatched board with a boardId", () => {
    const board = taskBoard({
      name: "good-board",
      boardId: "good-board",
      mode: "delegation",
      collection: durable,
      workers: {
        implement: assignee("implement"),
      },
    });

    expect(board.boardId).toBe("good-board");
    expect(board.backing).toBe("resource");
    expect(board.dispatchers).toHaveLength(1);
  });
});

describe("task dispatch — the uniform and floor assignees", () => {
  it("refuses a task dispatcher as the uniform worker — a dispatch is addressed by the row's assignee", () => {
    // A uniform worker stands in for every row whatever it names, so there is
    // no assignee to address the dispatch by.
    expect(() =>
      taskBoard({
        name: "uniform-dispatch",
        boardId: "uniform-dispatch",
        mode: "delegation",
        collection: durable,
        workers: assignee("uniform-impl"),
      })
    ).toThrow(/a uniform worker cannot dispatch/);
  });

  it("lets the fallback dispatch, listing it as the floor", () => {
    // The fallback hands each row over under the assignee the row names, so
    // the child's gate still has an assignee to check the row against.
    const board = taskBoard({
      name: "floor-dispatch",
      boardId: "floor-dispatch",
      mode: "delegation",
      collection: durable,
      workers: {},
      defaultWorker: assignee("floor-impl"),
    });
    expect(board.dispatchers.map((s) => [s.kind, s.label])).toEqual([["floor", "floor"]]);
  });
});

describe("task dispatch — a session-scoped ledger is refused at construction", () => {
  /**
   * A dispatched worker runs in its own child session, and a session-scoped
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
        name: "session-dispatch",
        boardId: "session-dispatch",
        mode: "delegation",
        collection: sessionScoped,
        workers: { implement: assignee("implement") },
      })
    ).toThrow(/session-scoped collection/);
  });

  it("names the declared worker, so the message points at what would not run", () => {
    expect(() =>
      taskBoard({
        name: "session-dispatch-named",
        boardId: "session-dispatch-named",
        mode: "delegation",
        collection: sessionScoped,
        workers: { implement: assignee("implement") },
      })
    ).toThrow(/assignee:implement/);
  });

  it("points at sharedToLineage as the fix", () => {
    expect(() =>
      taskBoard({
        name: "session-dispatch-fix",
        boardId: "session-dispatch-fix",
        mode: "delegation",
        collection: sessionScoped,
        workers: { implement: assignee("implement") },
      })
    ).toThrow(/sharedToLineage/);
  });

  it("leaves a session-scoped board with nothing dispatched alone", () => {
    // The refusal is about the dispatch, not about the scope. An inline board
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

  it("accepts a dispatched board on a user-scoped ledger", () => {
    // The control: same declaration, reachable scope. Without this the refusal
    // above would pass just as well against a guard that refused every
    // dispatched board.
    expect(() =>
      taskBoard({
        name: "user-dispatch",
        boardId: "user-dispatch",
        mode: "delegation",
        collection: defineTaskCollection({ id: "user-tasks", scope: "user" }),
        workers: { implement: assignee("implement") },
      })
    ).not.toThrow();
  });
});

describe("the session-schema refusal sees composed children", () => {
  /** A flow whose one board hands `implement` off to `block`. */
  function flowHandingOffTo(kind: string, block: TaskWorker) {
    const board = taskBoard({
      name: kind,
      boardId: kind,
      mode: "delegation",
      collection: durable,
      workers: { implement: assignee("implement") },
    });
    return defineFlow({ internal: { actions: { ...heard } },
      kind,
      actions: { run: { block: board.drain } },
      task: { actions: { implement: { block } } },
    });
  }

  it("refuses a schema declared by a step inside the entry block", () => {
    // A dispatched block is routinely a sequencer, and the block declaring the
    // schema is usually a step inside it. It runs in the child session exactly
    // as the root would, and collides with a sibling route's key exactly as
    // the root would — so inspecting only the root accepted the flow and left
    // the declaration to surface as a missing typed key inside the child.
    const nested = sequencer({ name: "outer" }).tap(
      handler({
        name: "inner-with-state",
        sessionStateSchema: z.object({ needed: z.string() }),
        execute: () => null,
      })
    );

    expect(() => flowHandingOffTo("nested-session-state", nested as never)).toThrow(
      /sessionStateSchema/
    );
  });

  it("names the composed block, not just the entry block", () => {
    const nested = sequencer({ name: "outer-2" }).tap(
      handler({
        name: "inner-named",
        sessionStateSchema: z.object({ needed: z.string() }),
        execute: () => null,
      })
    );

    expect(() => flowHandingOffTo("nested-session-named", nested as never)).toThrow(/inner-named/);
  });

  it("leaves a composed block that declares none alone", () => {
    // The control. A walk that flagged any sequencer would refuse most
    // dispatched boards in the codebase.
    const plain = sequencer({ name: "outer-plain" }).tap(
      handler({ name: "inner-plain", execute: () => null })
    );

    expect(() => flowHandingOffTo("nested-session-clean", plain as never)).not.toThrow();
  });
});
