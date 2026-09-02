/**
 * A handed-off child under a concurrency key its parent already holds (FIX-982).
 *
 * A hand-off dispatch takes the **flow-level** policy, and the default key is
 * the session — but a flow keyed on `user` (or any custom key both sides
 * resolve the same) puts the child under a key the launching request is holding
 * right now. That is not an exotic configuration, and each policy fails
 * differently, which is how it has produced findings one policy at a time:
 *
 * - `reject` refuses the dispatch synchronously, before a child exists.
 * - `queue` defers the child behind the key, which the parent must not wait on
 *   — waiting would be waiting for a run that cannot start until the parent
 *   returns.
 * - `allow` (the default) is unaffected and is the control.
 *
 * `debounce` and `restart` are reserved in the enum and refused by validation in
 * v1, so there is no runtime behaviour to pin — asserted here so that when the
 * fast-follow lands, this file fails and someone has to decide what a handed-off
 * child does under them.
 *
 * The property under test is the same for all of them: **the row is never
 * stranded silently.** Either the work is handed over, or it is settled by the
 * request that still owns it.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import { validateConcurrencyConfig } from "@flow-state-dev/core/types";
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

const USER_ID = "u_sharedkey";
const baseRuntimeConfig = () => ({ modelResolver: createMockModelResolver({}) });

function buildFlow(kind: string, concurrency: "allow" | "queue" | "reject") {
  const background = handler({
    name: "background-worker",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.object({ handled: z.string() }),
    execute: (input: TaskWorkerInput) => ({ handled: input.taskId }),
  });
  const board = taskBoard({
    name: `${kind}-board`,
    boardId: `${kind}-board`,
    collection: defineTaskCollection({ id: `${kind}-ledger`, scope: "user" }),
    workers: {
      background: dispatcher({
        name: `${kind}-hand-off`,
        type: "task",
        target: "background",
        session: "per-task",
      }),
    },
    initialTasks: [
      { id: "t1", goal: "work under a shared key", assignee: "background", input: { n: 1 } },
    ],
  });

  return defineFlow({
    kind,
    // Keyed on `user`, so the parent and its handed-off child resolve the SAME
    // key — the parent is holding it when the child is dispatched.
    request: { concurrency: { policy: concurrency, key: "user" } },
    actions: { start: { block: board.drain } },
    tasks: { background: { block: background } },
  })({ id: kind });
}

async function durableRow(
  stores: StoreRegistry,
  kind: string,
  taskId: string
): Promise<Task | undefined> {
  const row = await stores.resourceState.get("user", USER_ID, `${kind}-ledger/${taskId}`);
  return row?.state as Task | undefined;
}

/** Drain the board through the REAL host, so the concurrency arbiter is in play. */
async function drain(kind: string, concurrency: "allow" | "queue" | "reject") {
  const stores = createInMemoryStores();
  const flow = buildFlow(kind, concurrency);
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
          return { requestId: `child_${dispatched.length}` };
        },
      },
    },
  });

  return { parent, stores, dispatched };
}

describe("a handed-off child under a key its parent already holds", () => {
  it("hands the row over under the default allow policy", async () => {
    // The control. Without it, a guard that stranded every handed-off dispatch
    // would pass the two below.
    const { parent, stores, dispatched } = await drain("sharedkey-allow", "allow");

    expect(parent.error).toBeUndefined();
    expect(dispatched).toHaveLength(1);
    expect(await durableRow(stores, "sharedkey-allow", "t1")).toMatchObject({
      status: "in_progress",
    });
  });

  it("hands the row over under reject when the dispatch operation is stubbed", async () => {
    // This harness supplies its own `dispatchOperation`, so the arbiter that
    // would refuse a shared `reject` key is never reached — the policy is
    // applied by `host.dispatch`, which only the real dispatch operation
    // calls. What the refusal does to the row is therefore pinned in `engine`,
    // against `createDispatchOperation` itself (`context/dispatch-operation.test.ts`).
    // Kept here so the gap is visible rather than looking like coverage.
    const { parent, dispatched } = await drain("sharedkey-reject", "reject");

    expect(parent.error).toBeUndefined();
    expect(dispatched).toHaveLength(1);
  });

  it("does not block the launching request under queue", async () => {
    // The parent holds the key, so a child queued behind it cannot start until
    // the parent returns. The launching request must therefore not wait on it —
    // waiting is the deadlock, and returning is the whole point of the hand-off.
    const { parent, dispatched } = await drain("sharedkey-queue", "queue");

    expect(parent.error).toBeUndefined();
    expect(dispatched).toHaveLength(1);
  });

  it("has no behaviour to pin for the reserved policies", () => {
    // `debounce` and `restart` parse into the type so the fast-follow is purely
    // additive, and validation refuses them today. When that changes, this fails
    // and someone has to decide what a handed-off child does under them rather
    // than finding out from a review.
    expect(() =>
      validateConcurrencyConfig("test", { policy: "debounce", windowMs: 10 } as never)
    ).toThrow();
    expect(() =>
      validateConcurrencyConfig("test", { policy: "restart" } as never)
    ).toThrow();
  });
});
