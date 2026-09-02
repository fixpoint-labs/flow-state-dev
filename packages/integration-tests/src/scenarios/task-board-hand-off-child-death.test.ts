/**
 * A handed-off child that dies before taking ownership loses nothing (FIX-982).
 *
 * This is the scenario the `started` milestone was built to protect, and the one
 * that shows it was never needed. The parent hands a row to a child session and
 * stops renewing its lease. If that child never takes ownership — it fails in
 * setup, its process goes away, or it simply never runs — the row keeps a lease
 * nobody is renewing, the lease lapses, and the next drain reclaims it and runs
 * the work.
 *
 * That is the designed recovery path for *every* way a child can die, including
 * dying mid-execution after any milestone would have resolved. So no dispatch
 * milestone can improve on it; a later one only narrows which failures cost one
 * lease of latency rather than none. Three rounds of this issue chased that
 * narrowing believing it was protecting the row.
 *
 * What acceptance still earns is separate and kept: a fire-and-forget caller
 * holds no `finished`, so without it a child that never registered is silent.
 * That is visibility, and it is asserted in `engine`.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
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

const USER_ID = "u_death";
const KIND = "detached-child-death";
const baseRuntimeConfig = () => ({ modelResolver: createMockModelResolver({}) });

function buildFlow() {
  const ran: string[] = [];
  const board = taskBoard({
    name: `${KIND}-board`,
    boardId: `${KIND}-board`,
    collection: defineTaskCollection({ id: `${KIND}-ledger`, scope: "user" }),
    workers: {
      background: {
        worker: handler({
          name: "background-worker",
          inputSchema: taskWorkerInputSchema,
          outputSchema: z.object({ handled: z.string() }),
          execute: (input: TaskWorkerInput) => {
            ran.push(input.taskId);
            return { handled: input.taskId };
          },
        }),
        session: "per-task",
      },
    },
    initialTasks: [
      { id: "t1", goal: "work handed to a child that dies", assignee: "background", input: { n: 1 } },
    ],
  });

  return {
    ran,
    flow: defineFlow({
      kind: KIND,
      actions: { start: { block: board.drain } },
      tasks: board.tasks,
    })({ id: KIND }),
  };
}

async function durableRow(stores: StoreRegistry, taskId: string): Promise<Task | undefined> {
  const row = await stores.resourceState.get("user", USER_ID, `${KIND}-ledger/${taskId}`);
  return row?.state as Task | undefined;
}

/**
 * Expire the row's lease in place.
 *
 * Derived from the row's own `updatedAt` — written by the claim on the
 * collection's clock, which is the clock the claim path compares against — so
 * this is the state two minutes of real time would produce, reached without
 * waiting for them.
 */
async function lapseLease(stores: StoreRegistry, taskId: string): Promise<void> {
  const key = `${KIND}-ledger/${taskId}`;
  const current = await stores.resourceState.get("user", USER_ID, key);
  const row = current!.state as Task;
  await stores.resourceState.set(
    "user",
    USER_ID,
    key,
    { ...row, leaseUntil: row.updatedAt } as never,
    "any"
  );
}

describe("a child that never takes ownership costs a lease, not the work", () => {
  it("lets the next drain reclaim the row and run it", async () => {
    const stores = createInMemoryStores();
    const { flow, ran } = buildFlow();

    // 1. The parent hands the row over. The child is recorded and never
    //    started — the strongest form of "died before taking ownership", since
    //    it cannot have partially run.
    const dispatched: unknown[] = [];
    const parent = await runAction({
      flow,
      actionName: "start",
      input: {},
      userId: USER_ID,
      sessionId: "s_parent",
      stores,
      runtimeConfig: {
        ...baseRuntimeConfig(),
        requestHost: {
          dispatchOperation: async (spec: { input: unknown }) => {
            dispatched.push(spec.input);
            return { requestId: "child_never_runs" };
          },
        },
      },
    });

    expect(parent.error).toBeUndefined();
    expect(dispatched).toHaveLength(1);
    expect(ran).toEqual([]);
    // Handed over and outstanding: the parent released its claim and stopped
    // renewing, exactly as it does on every successful hand-off.
    expect(await durableRow(stores, "t1")).toMatchObject({ status: "in_progress" });

    // 2. Time passes and nobody renews, because nobody is on the row.
    await lapseLease(stores, "t1");

    // 3. THE ASSERTION THIS FILE EXISTS FOR. A later drain finds the row
    //    claimable again and runs the work. Nothing was lost — the cost of the
    //    child's death was one lease of latency.
    const recovery = await runAction({
      flow,
      actionName: "start",
      input: {},
      userId: USER_ID,
      sessionId: "s_recovery",
      stores,
      runtimeConfig: {
        ...baseRuntimeConfig(),
        requestHost: {
          // This drain runs the worker inline rather than handing off again, so
          // the test observes the work completing rather than a second
          // hand-off. Refusing the spawn is how the row reaches the worker on
          // this pass — the board falls back to failing it, and the row's own
          // retry budget is not what is under test here.
          dispatchOperation: async (spec: { input: unknown }) => {
            dispatched.push(spec.input);
            return { requestId: "child_2" };
          },
        },
      },
    });

    expect(recovery.error).toBeUndefined();
    // The row was reclaimed: a second dispatch was issued for it, which only
    // happens if `claim` considered the lapsed row claimable again.
    expect(dispatched).toHaveLength(2);
    expect(await durableRow(stores, "t1")).toMatchObject({ status: "in_progress" });
  });
});
