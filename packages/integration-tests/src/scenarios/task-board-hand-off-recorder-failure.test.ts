/**
 * FIX-963, third settlement site — a task handed off to a child run.
 *
 * The same two recorders settle a task in three places: the inline drain's
 * success tap, its rescue, and the gate a handed-off task runs behind in the
 * child session. The gate is the one with nowhere to defer to — there is no
 * batch around the task and no drain tail to report at — so a recorder that
 * cannot announce a committed write raises where it stands and fails the child
 * run. Nothing is abandoned by that: there is no sibling here to protect.
 *
 * Fixing only the drain would have closed the issue with the defect live here,
 * where it is arguably worse: a child run is how background work reports, and
 * every consumer that reads run status would see success for a result the
 * board never managed to record.
 *
 * The case exercised here is the upgrade one, because it is the case a test can
 * reach through the store and it is the sharper of the two: a row that was
 * already in the ledger before write provenance shipped carries no identity
 * nonce, nothing backfills one, and the board therefore **cannot tell** whether
 * its write landed when the store refuses it. That answer is reported rather
 * than assumed away — and on the gate it fails the child run.
 *
 * The drain-side scenario in `task-board-recorder-failure.test.ts` covers the
 * committed-then-unannounced verdict; what is specific to the gate, and all
 * this file is pinning, is that the failure raises here instead of waiting for
 * a tail that does not exist.
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
import {
  taskBoard,
  taskWorkerInputSchema,
} from "@flow-state-dev/orchestration/task-board";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { z } from "zod";

const TASK_SOURCE = "task";
const USER_ID = "u_recorder_failure";
const ANNOUNCE_ERROR = "change announcement blew up";
const RECORDER_FAILURE_COMPONENT = "task-board-recorder-failure";

const baseRuntimeConfig = () => ({ modelResolver: createMockModelResolver({}) });

type RecordedDispatch = { sessionId: string; actionName: string; input: unknown };

/**
 * Strip the identity nonce from a stored row, making it look like one written
 * before write provenance shipped. Nothing backfills it, so this is permanent
 * for that row's life — which is exactly the point.
 */
async function ageRowToPreProvenance(
  stores: StoreRegistry,
  kind: string,
  taskId: string
): Promise<void> {
  const key = `${kind}-ledger/${taskId}`;
  const stored = await stores.resourceState.get("user", USER_ID, key);
  const row = stored?.state as Record<string, unknown>;
  const { incarnationId: _dropped, ...aged } = row;
  await stores.resourceState.set(
    "user",
    USER_ID,
    key,
    aged as never,
    "any" as never
  );
}

/**
 * Refuse the settlement write. Scoped to a terminal status so the claim and the
 * lease renewals that precede it are untouched and the failure lands on the
 * write the recorder owns.
 */
function poisonSettlementWrites(stores: StoreRegistry): StoreRegistry {
  const inner = stores.resourceState;
  // A Proxy rather than a spread: the store is a class instance, so spreading
  // it drops every method that lives on the prototype.
  const poisoned = new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop !== "set") return Reflect.get(target, prop, receiver);
      return async (...args: unknown[]) => {
        const result = await (
          target.set as unknown as (...a: unknown[]) => Promise<unknown>
        ).apply(target, args);
        const status = (args[3] as { status?: string } | undefined)?.status;
        if (status === "completed" || status === "errored") {
          throw new Error(ANNOUNCE_ERROR);
        }
        return result;
      };
    },
  });
  return { ...stores, resourceState: poisoned } as StoreRegistry;
}

function buildFlow(kind: string, onError: "skip" | "fail") {
  const worker = handler({
    name: "hand-off-worker",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.object({ handled: z.string() }),
    execute: (input: TaskWorkerInput) => ({ handled: input.goal }),
  });
  const board = taskBoard({
    name: `${kind}-board`,
    boardId: `${kind}-board`,
    collection: defineTaskCollection({ id: `${kind}-ledger`, scope: "user" }),
    onError,
    workers: {
      background: dispatcher({
        name: `${kind}-hand-off`,
        type: "task",
        action: "background",
        session: "per-task",
      }),
    },
    initialTasks: [
      {
        id: "t1",
        goal: "work that succeeds",
        assignee: "background",
        input: { note: "x" },
      },
    ],
  });

  return defineFlow({
    kind,
    actions: { start: { block: board.drain } },
    task: { actions: { background: { block: worker } } },
  })({ id: kind });
}

async function durableRow(
  stores: StoreRegistry,
  kind: string,
  taskId: string
): Promise<Task | undefined> {
  const row = await stores.resourceState.get(
    "user",
    USER_ID,
    `${kind}-ledger/${taskId}`
  );
  return row?.state as Task | undefined;
}

/** Drain the parent cleanly, then run the child with the poisoned store. */
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
          action: string;
          input: unknown;
        }) => {
          dispatched.push({
            sessionId: spec.sessionId,
            actionName: spec.action,
            input: spec.input,
          });
          return { requestId: "child_req_1" };
        },
      },
    },
  });
  expect(parent.error).toBeUndefined();
  expect(dispatched).toHaveLength(1);

  await ageRowToPreProvenance(stores, kind, "t1");

  const child = await runAction({
    flow,
    actionName: dispatched[0]!.actionName as never,
    input: dispatched[0]!.input,
    userId: USER_ID,
    sessionId: dispatched[0]!.sessionId,
    source: TASK_SOURCE,
    stores: poisonSettlementWrites(stores),
    runtimeConfig: baseRuntimeConfig(),
  });

  return { child, stores };
}

function recorderFailureEntries(items: readonly unknown[]): Array<{
  data: Record<string, unknown>;
}> {
  return items
    .filter(
      (i) =>
        (i as { type?: string }).type === "component" &&
        (i as { component?: string }).component === RECORDER_FAILURE_COMPONENT
    )
    .map((i) => i as { data: Record<string, unknown> });
}

describe("FIX-963: a recorder failure on a handed-off task fails the child run", () => {
  it.each([
    ["skip" as const],
    ["fail" as const],
  ])(
    "fails the child run under onError: %s, and reports on a saved entry",
    async (onError) => {
      const kind = `hand-off-recorder-${onError}`;
      const { child } = await handOffAndRunChild(kind, onError);

      // BR-14. The child run carries the work, so the child run is what has to
      // report the failure — a consumer reading run status would otherwise see
      // success for a result the board never managed to record.
      expect(child.error).toBeDefined();
      expect(child.error?.message).toContain("t1");

      // BR-9 applied here: `onError` is a policy about a task going wrong, and
      // the board's own bookkeeping falling over is not a task outcome. Both
      // settings fail, which is why this is parameterised rather than asserted
      // once on the stricter one.
      const entries = recorderFailureEntries(child.items);
      expect(entries).toHaveLength(1);
      expect(entries[0]?.data).toMatchObject({
        taskId: "t1",
        recorder: "complete",
        verdict: "undetermined",
      });
      // Never the confident wrong answer. On a row with no nonce the board
      // genuinely does not know, and says so.
      expect(entries[0]?.data.verdict).not.toBe("committed");

      // And the entry survives the run rather than living on a trace.
      expect(entries[0]?.data).toMatchObject({ collectionId: `${kind}-ledger` });
    }
  );

  it("leaves a healthy hand-off exactly as it was", async () => {
    // BR-15 / BR-11, the control. Nothing about a settlement that works
    // changes: no entry, no new failure mode.
    const stores = createInMemoryStores();
    const kind = "hand-off-recorder-healthy";
    const flow = buildFlow(kind, "skip");
    const dispatched: RecordedDispatch[] = [];

    await runAction({
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
            action: string;
            input: unknown;
          }) => {
            dispatched.push({
              sessionId: spec.sessionId,
              actionName: spec.action,
              input: spec.input,
            });
            return { requestId: "child_req_1" };
          },
        },
      },
    });

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

    expect(child.error).toBeUndefined();
    expect(recorderFailureEntries(child.items)).toHaveLength(0);
    expect(await durableRow(stores, kind, "t1")).toMatchObject({
      status: "completed",
    });
  });
});
