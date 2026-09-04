/**
 * A handed-off worker that runs its own handed-off board — "jobs can nest"
 * (FIX-982).
 *
 * The outer board substitutes a hand-off block for its handed-off worker, so
 * the real worker (and, inside it, the inner board's drain) is no longer a
 * child of any action root — it lives inside the outer drain's per-worker
 * pool, which `defineFlow`'s static walk cannot see (see `board-tasks.test.ts`
 * in `orchestration` for why: `.forEach`'s per-item block is a runtime
 * factory, never a statically-registered child).
 *
 * That is exactly why the flow declares each board's task entry itself:
 * nesting one board's drain inside another board's worker is ordinary
 * composition here, not a discovery problem. Both boards' seats reach the
 * flow the same way any board's does — each hand-off names its entry, and the
 * flow declares both under `tasks` — regardless of how deep the inner board's
 * drain sits inside the outer worker. What this
 * scenario actually proves is that the composition RUNS correctly end to
 * end: the outer hand-off's child runs the real outer worker, which claims
 * and hands off the inner board's row from inside that same request, and the
 * inner child settles it.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, dispatcher, handler, sequencer } from "@flow-state-dev/core";
import { createInMemoryStores, runAction } from "@flow-state-dev/engine";
import type { StoreRegistry } from "@flow-state-dev/engine";
import {
  defineTaskCollection,
  type Task,
  type TaskWorkerInput,
} from "@flow-state-dev/orchestration/tasks";
import { taskBoard, taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { z } from "zod";

/** Terminal transport provenance for a hand-off dispatch. Internal to `engine`; a wire value. */
const TASK_SOURCE = "task";
const USER_ID = "u_nested";

const baseRuntimeConfig = () => ({ modelResolver: createMockModelResolver({}) });

/** What a hand-off dispatch was asked to do. Recorded, never executed. */
type RecordedDispatch = { sessionId: string; actionName: string; input: unknown };

/**
 * Outer board whose handed-off worker drains an inner handed-off board.
 *
 * Both ledgers are user-scoped: a handed-off board's rows must be addressable
 * from the child session that settles them, and a session-scoped one is
 * refused at construction.
 */
function buildNestedFlow() {
  const ran: string[] = [];

  const innerWorker = handler({
    name: "inner-worker",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.object({ handled: z.string() }),
    execute: (input: TaskWorkerInput) => {
      ran.push(`inner:${input.taskId}`);
      return { handled: input.taskId };
    },
  });

  const innerBoard = taskBoard({
    name: "inner-board",
    boardId: "inner-board",
    collection: defineTaskCollection({ id: "inner-ledger", scope: "user" }),
    workers: {
      deep: dispatcher({ name: "inner-hand-off", type: "task", target: "deep", session: "per-task" }),
    },
    initialTasks: [
      { id: "i1", goal: "the nested unit of work", assignee: "deep", input: { note: "inner" } },
    ],
  });

  // The OUTER board's handed-off worker. The outer seat holds a dispatcher, so
  // this composition — and the inner board inside it — is reachable only
  // through the flow's `top` task entry, never through `outerBoard.drain`
  // itself.
  const outerWorker = sequencer({
    name: "outer-worker",
    inputSchema: taskWorkerInputSchema,
  })
    .tap(
      handler({
        name: "outer-worker-mark",
        inputSchema: z.unknown(),
        execute: (input: { taskId?: string }) => {
          ran.push(`outer:${input?.taskId ?? "?"}`);
        },
      })
    )
    .step(innerBoard.drain);

  const outerBoard = taskBoard({
    name: "outer-board",
    boardId: "outer-board",
    collection: defineTaskCollection({ id: "outer-ledger", scope: "user" }),
    workers: {
      top: dispatcher({ name: "outer-hand-off", type: "task", target: "top", session: "per-task" }),
    },
    initialTasks: [
      { id: "o1", goal: "the outer unit of work", assignee: "top", input: { note: "outer" } },
    ],
  });

  const flow = defineFlow({
    kind: "nested-detached",
    actions: { start: { block: outerBoard.drain } },
    // Both boards' entries — neither is discovered through the other's
    // structure, so both must be declared explicitly. `defineFlow` gates each
    // behind its own board: the outer worker is reached through the outer
    // seat's hand-off, the inner worker through the inner seat's, which sits
    // inside the outer worker's drain.
    task: { actions: { top: { block: outerWorker }, deep: { block: innerWorker } } },
  })({ id: "nested-detached" });

  return { flow, ran };
}

/** The durable row, read straight from the store rather than any live collection ref. */
async function durableRow(
  stores: StoreRegistry,
  ledger: string,
  taskId: string
): Promise<Task | undefined> {
  const row = await stores.resourceState.get("user", USER_ID, `${ledger}/${taskId}`);
  return row?.state as Task | undefined;
}

describe("a handed-off worker can run its own handed-off board", () => {
  it("hands off the outer row, runs the real worker inside the child, and hands off the inner row from there", async () => {
    const stores = createInMemoryStores();
    const { flow, ran } = buildNestedFlow();

    // THE DECLARATION HALF. Both entries resolve on this flow, each behind
    // its own board's gate. Asserted before any run, because a flow missing an
    // entry cannot be rescued at dispatch time (the hand-off would throw
    // `no-entry`).
    expect(Object.keys(flow.task?.actions ?? {}).sort()).toEqual(["deep", "top"]);

    const dispatched: RecordedDispatch[] = [];
    const record = {
      dispatchOperation: async (spec: { sessionId: string; target: string; input: unknown }) => {
        dispatched.push({
          sessionId: spec.sessionId,
          actionName: spec.target,
          input: spec.input,
        });
        return { requestId: `child_${dispatched.length}` };
      },
    };

    // 1. The parent drains the OUTER board and hands its row over.
    const parent = await runAction({
      flow,
      actionName: "start",
      input: {},
      userId: USER_ID,
      sessionId: "s_parent",
      stores,
      runtimeConfig: { ...baseRuntimeConfig(), requestHost: record },
    });
    expect(parent.error).toBeUndefined();
    expect(dispatched).toHaveLength(1);
    expect(await durableRow(stores, "outer-ledger", "o1")).toMatchObject({
      status: "in_progress",
    });

    // 2. The outer child session runs the real worker, which drains the INNER
    //    board and hands ITS row over — from inside the SAME request, through
    //    the SAME dispatch seam. This is the dispatch that would have nowhere
    //    to go if the flow's `tasks` map were missing the inner entry.
    const outerChild = await runAction({
      flow,
      actionName: dispatched[0]!.actionName as never,
      input: dispatched[0]!.input,
      userId: USER_ID,
      sessionId: dispatched[0]!.sessionId,
      source: TASK_SOURCE,
      stores,
      runtimeConfig: { ...baseRuntimeConfig(), requestHost: record },
    });
    expect(outerChild.error).toBeUndefined();
    expect(ran).toContain("outer:o1");
    expect(dispatched).toHaveLength(2);

    // 3. The inner child session. Its envelope names `inner-board`, and the
    //    flow's `tasks` map has to have a route for it — which is the whole
    //    point.
    const innerChild = await runAction({
      flow,
      actionName: dispatched[1]!.actionName as never,
      input: dispatched[1]!.input,
      userId: USER_ID,
      sessionId: dispatched[1]!.sessionId,
      source: TASK_SOURCE,
      stores,
      runtimeConfig: baseRuntimeConfig(),
    });

    expect(innerChild.error).toBeUndefined();
    expect(ran).toContain("inner:i1");
    expect(await durableRow(stores, "inner-ledger", "i1")).toMatchObject({
      status: "completed",
    });
  });
});
