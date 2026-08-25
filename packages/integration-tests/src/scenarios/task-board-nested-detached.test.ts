/**
 * A detached worker that runs its own detached board — "jobs can nest"
 * (FIX-982).
 *
 * The outer board substitutes a spawn block for its detached worker, so the
 * real worker is no longer a child of any action root. If that worker composes
 * a SECOND detached board, the inner board's binding is reachable from exactly
 * one place: the outer board's runner, which is the block the outer Workstream
 * enters. Nothing else in the flow can see it.
 *
 * Collecting bindings from the action roots alone therefore yields the outer
 * board and not the inner one, and `flow.workstream` is built without a route
 * for the inner `boardId`. The inner spawn is accepted by the parent — the flow
 * does have *a* workstream core — and only the inner child's dispatch discovers
 * there is nowhere to go. The row it was addressed to then sits `in_progress`
 * until lease recovery, which is the stall this whole change keeps closing.
 *
 * ## Why a scenario and not a collector unit test
 *
 * A unit test would hand the collector both boards and pass against the bug.
 * The defect is that the inner binding has to be **discovered** — through a
 * runner the flow only learns about after collecting the outer board — so it
 * only appears when the claim-to-spawn path is actually walked twice.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
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

/** Terminal transport provenance for a detached dispatch. Internal to `engine`; a wire value. */
const WORKSTREAM_SOURCE = "workstream";
const USER_ID = "u_nested";

const baseRuntimeConfig = () => ({ modelResolver: createMockModelResolver({}) });

/** What a detached start was asked to do. Recorded, never executed. */
type RecordedDispatch = { sessionId: string; actionName: string; input: unknown };

/**
 * Outer board whose detached worker drains an inner detached board.
 *
 * Both ledgers are user-scoped: a detached board's rows must be addressable from
 * the Workstream that settles them, and a session-scoped one is refused at
 * construction.
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
    workers: { deep: { worker: innerWorker, dispatch: { mode: "detached" } } },
    initialTasks: [
      { id: "i1", goal: "the nested unit of work", assignee: "deep", input: { note: "inner" } },
    ],
  });

  // The OUTER board's detached worker. It is substituted out of the outer
  // drain's routing table, so this composition — and the inner board inside it —
  // is reachable only through the outer board's runner.
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
    workers: { top: { worker: outerWorker, dispatch: { mode: "detached" } } },
    initialTasks: [
      { id: "o1", goal: "the outer unit of work", assignee: "top", input: { note: "outer" } },
    ],
  });

  const flow = defineFlow({
    kind: "nested-detached",
    actions: { start: { block: outerBoard.drain } },
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

describe("a detached worker can run its own detached board", () => {
  it("routes the inner board's dispatch, which is reachable only through the outer runner", async () => {
    const stores = createInMemoryStores();
    const { flow, ran } = buildNestedFlow();

    // THE STRUCTURAL HALF. The inner board has to reach the flow at all, and it
    // can only do so via the outer board's runner. Asserted before any run,
    // because a flow missing the route cannot be rescued at dispatch time.
    const boardIds = [
      ...new Set(
        [...(flow.workstreamBindings?.values() ?? [])].map((binding) => binding.boardId)
      ),
    ].sort();
    expect(boardIds).toEqual(["inner-board", "outer-board"]);

    const dispatched: RecordedDispatch[] = [];
    const record = {
      startOperation: async (spec: { sessionId: string; actionName: string; input: unknown }) => {
        dispatched.push({
          sessionId: spec.sessionId,
          actionName: spec.actionName,
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

    // 2. The outer Workstream runs the real worker, which drains the INNER
    //    board and hands ITS row over. This is the dispatch that has nowhere to
    //    go when the inner binding never reached the flow.
    const outerChild = await runAction({
      flow,
      actionName: dispatched[0]!.actionName as "start",
      input: dispatched[0]!.input,
      userId: USER_ID,
      sessionId: dispatched[0]!.sessionId,
      source: WORKSTREAM_SOURCE,
      stores,
      runtimeConfig: { ...baseRuntimeConfig(), requestHost: record },
    });
    expect(outerChild.error).toBeUndefined();
    expect(ran).toContain("outer:o1");
    expect(dispatched).toHaveLength(2);

    // 3. The inner Workstream. Its envelope names `inner-board`, and the flow's
    //    workstream core has to have a route for it — which is the whole point.
    const innerChild = await runAction({
      flow,
      actionName: dispatched[1]!.actionName as "start",
      input: dispatched[1]!.input,
      userId: USER_ID,
      sessionId: dispatched[1]!.sessionId,
      source: WORKSTREAM_SOURCE,
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
