/**
 * A hand-off board honours its configured `onError` (FIX-982).
 *
 * `onError: "fail"` is a board-level contract: a worker failure fails the run
 * that was executing it. Inline, that is the drain's own request. Handed off,
 * the run executing the worker is the child session's — so `"fail"` has to
 * fail that.
 *
 * It did not. The runner hard-coded `"skip"` for its error recorder, so a
 * handed-off worker that threw recorded the row `errored` and its child
 * session's request completed **successfully**. Everything that reads
 * background work by request status — the child-session listing route, the
 * DevTool panel, any consumer polling a run — saw a success for work that
 * failed, and the board's configured policy decided nothing.
 *
 * Both settings are asserted here. A fix that simply flipped the constant would
 * pass the `"fail"` case and break the default, which is the more common one.
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

const TASK_SOURCE = "task";
const USER_ID = "u_onerror";
const baseRuntimeConfig = () => ({ modelResolver: createMockModelResolver({}) });

type RecordedDispatch = { sessionId: string; actionName: string; input: unknown };

/** A board whose handed-off worker always throws, under the given failure policy. */
function buildFlow(kind: string, onError: "skip" | "fail") {
  const board = taskBoard({
    name: `${kind}-board`,
    boardId: `${kind}-board`,
    collection: defineTaskCollection({ id: `${kind}-ledger`, scope: "user" }),
    onError,
    workers: {
      background: {
        block: handler({
          name: "always-throws",
          inputSchema: taskWorkerInputSchema,
          outputSchema: z.object({ handled: z.string() }),
          execute: (_input: TaskWorkerInput) => {
            throw new Error("the worker blew up");
          },
        }),
        session: "per-task",
      },
    },
    initialTasks: [
      { id: "t1", goal: "work that fails", assignee: "background", input: { note: "x" } },
    ],
  });

  return defineFlow({
    kind,
    actions: { start: { block: board.drain } },
    tasks: board.tasks,
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

/** Drain the parent, then run the child session the hand-off produced. */
async function handOffAndRunChild(kind: string, onError: "skip" | "fail") {
  const stores = createInMemoryStores();
  const flow = buildFlow(kind, onError);
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
        dispatchOperation: async (spec: {
          sessionId: string;
          target: string;
          input: unknown;
        }) => {
          dispatched.push({
            sessionId: spec.sessionId,
            actionName: spec.target,
            input: spec.input,
          });
          return { requestId: "child_req_1" };
        },
      },
    },
  });
  expect(parent.error).toBeUndefined();
  expect(dispatched).toHaveLength(1);

  const child = await runAction({
    flow,
    actionName: dispatched[0]!.actionName as never,
    input: dispatched[0]!.input,
    userId: USER_ID,
    sessionId: dispatched[0]!.sessionId,
    source: TASK_SOURCE,
    stores,
    runtimeConfig: baseRuntimeConfig(),
  });

  return { child, stores };
}

describe("a hand-off board's configured onError decides the child session's outcome", () => {
  it("fails the child session's request when the board declares onError: fail", async () => {
    const { child, stores } = await handOffAndRunChild("detached-onerror-fail", "fail");

    // THE ASSERTION THIS FILE EXISTS FOR. The worker threw and the board asked
    // for that to fail the run, so the run has to report failure — otherwise a
    // consumer reading run status sees success for work that failed.
    expect(child.error).toBeDefined();
    expect(child.error?.message).toMatch(/blew up/);

    // The row is still settled either way: the recorder writes the failure
    // before the policy decides whether to rethrow.
    expect(await durableRow(stores, "detached-onerror-fail", "t1")).toMatchObject({
      status: "errored",
    });
  });

  it("completes the child session's request under the default onError: skip", async () => {
    // The control, and the reason this cannot be fixed by flipping a constant.
    // `skip` is the default and the common case: the task failed, the row says
    // so, and the run that carried it did its job.
    const { child, stores } = await handOffAndRunChild("detached-onerror-skip", "skip");

    expect(child.error).toBeUndefined();
    expect(await durableRow(stores, "detached-onerror-skip", "t1")).toMatchObject({
      status: "errored",
    });
  });
});
