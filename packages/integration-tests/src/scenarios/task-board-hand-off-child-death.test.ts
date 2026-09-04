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
import { defineFlow, dispatcher, handler } from "@flow-state-dev/core";
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
const KIND = "hand-off-child-death";
/** The provenance a hand-off dispatch carries; spelled literally because the constant is internal to `engine`. */
const TASK_SOURCE = "task";

/** What a hand-off dispatch was asked to do. Recorded, replayed by hand. */
type RecordedDispatch = { sessionId: string; target: string; input: unknown };
const baseRuntimeConfig = () => ({ modelResolver: createMockModelResolver({}) });

function buildFlow() {
  const ran: string[] = [];
  const background = handler({
    name: "background-worker",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.object({ handled: z.string() }),
    execute: (input: TaskWorkerInput) => {
      ran.push(input.taskId);
      return { handled: input.taskId };
    },
  });
  const board = taskBoard({
    name: `${KIND}-board`,
    boardId: `${KIND}-board`,
    collection: defineTaskCollection({ id: `${KIND}-ledger`, scope: "user" }),
    workers: {
      background: dispatcher({
        name: `${KIND}-hand-off`,
        type: "task",
        target: "background",
        session: "per-task",
      }),
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
      task: { actions: { background: { block: background } } },
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
    const dispatched: RecordedDispatch[] = [];
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
          dispatchOperation: async (spec: RecordedDispatch) => {
            dispatched.push({ sessionId: spec.sessionId, target: spec.target, input: spec.input });
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
    //    claimable again and hands it off a second time, and THAT child runs
    //    the work to completion. Nothing was lost — the cost of the first
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
          // Recorded like the first, so the second child can be replayed by
          // hand below: a recovery that only re-dispatched forever would look
          // identical up to this point.
          dispatchOperation: async (spec: RecordedDispatch) => {
            dispatched.push({ sessionId: spec.sessionId, target: spec.target, input: spec.input });
            return { requestId: "child_2" };
          },
        },
      },
    });

    expect(recovery.error).toBeUndefined();
    // The row was reclaimed: a second dispatch was issued for it, which only
    // happens if `claim` considered the lapsed row claimable again.
    expect(dispatched).toHaveLength(2);
    expect(ran).toEqual([]);
    expect(await durableRow(stores, "t1")).toMatchObject({ status: "in_progress" });

    // 4. The second child runs — replaying the captured envelope through the
    //    `task` source, as the real host would — and its gate accepts it: the
    //    envelope carries the RECLAIM's attempt, so the row it re-reads is the
    //    one it was dispatched for. The worker runs once and settles the row.
    const second = dispatched[1]!;
    const child = await runAction({
      flow,
      actionName: second.target as never,
      input: second.input,
      userId: USER_ID,
      sessionId: second.sessionId,
      source: TASK_SOURCE,
      stores,
      runtimeConfig: baseRuntimeConfig(),
    });

    expect(child.error).toBeUndefined();
    expect(ran).toEqual(["t1"]);
    expect(await durableRow(stores, "t1")).toMatchObject({ status: "completed" });

    // The dead first child's envelope is stale by construction: it carries the
    // superseded attempt, so replaying it now is refused by the gate (which
    // writes nothing and lets the request complete, as `onError: "skip"`
    // reads it) rather than run a second time over a row another attempt
    // already settled.
    const first = dispatched[0]!;
    const stale = await runAction({
      flow,
      actionName: first.target as never,
      input: first.input,
      userId: USER_ID,
      sessionId: first.sessionId,
      source: TASK_SOURCE,
      stores,
      runtimeConfig: baseRuntimeConfig(),
    });
    expect(stale.error).toBeUndefined();
    expect(ran).toEqual(["t1"]);
    expect(await durableRow(stores, "t1")).toMatchObject({ status: "completed", attempts: 2 });
  });
});
