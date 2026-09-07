/**
 * A task-board seat that names another flow must hand the row to that
 * flow's worker, not look the entry up on the sender.
 *
 * The drain's hand-off is the path a real board takes. Omitting `flowKind`
 * from the seam spec makes the host resolve `task:"work"` on the sender —
 * `flow "task-sender" declares no task entry "work"` — and no child is
 * created. The originating row then errors on the wrong destination.
 *
 * The recipient cannot declare *only* the remotely addressed task entry:
 * `defineFlow` still requires a reachable board that hands off to it (the
 * orphan-task-entry / claim-gate guard). The legitimate setup is the same
 * logical board on both flows — same `boardId`, same user-scoped ledger —
 * so the recipient can gate the entry the way a same-flow board already
 * does, while the sender's seat names `flowKind: "task-recipient"`.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import type { FlowStateRuntime, StoreRegistry } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { z } from "zod";
import { defineTaskCollection, type Task, type TaskWorkerInput } from "../../src/tasks";
import { taskBoard, taskWorkerInputSchema } from "../../src/task-board";

const USER_ID = "u_cross_hand_off";
const SENDER = "task-sender";
const RECIPIENT = "task-recipient";
const BOARD_ID = "work-board";
const LEDGER_ID = "cross-flow-work";

function workWorker(ran: string[]) {
  return handler({
    name: "recipient-work",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.object({ handled: z.string() }),
    execute: (input: TaskWorkerInput) => {
      ran.push(input.taskId);
      return { handled: input.taskId };
    },
  });
}

function sharedLedger() {
  return defineTaskCollection({ id: LEDGER_ID, scope: "user" });
}

/**
 * The recipient's own board/gate story — same boardId and ledger as the
 * sender, so the claim gate that `defineFlow` wraps around `work` can
 * verify the row the sender claimed. No initial tasks: this board exists
 * to bind the gate, not to drain.
 */
function recipientFlow(ran: string[]) {
  const worker = workWorker(ran);
  const board = taskBoard({
    name: `${RECIPIENT}-board`,
    boardId: BOARD_ID,
    collection: sharedLedger(),
    workers: {
      work: dispatcher<TaskWorkerInput>({
        name: `${RECIPIENT}-hand-off`,
        action: "work",
        session: "per-task",
      }),
    },
  });

  return defineFlow({
    kind: RECIPIENT,
    actions: { drain: { block: board.drain } },
    task: { actions: { work: { block: worker } } },
  })({ id: RECIPIENT });
}

function senderFlow() {
  const board = taskBoard({
    name: `${SENDER}-board`,
    boardId: BOARD_ID,
    collection: sharedLedger(),
    workers: {
      work: dispatcher<TaskWorkerInput>({
        name: `${SENDER}-hand-off`,
        flowKind: RECIPIENT,
        action: "work",
        session: "per-task",
      }),
    },
    initialTasks: [
      {
        id: "t1",
        goal: "do the background thing",
        assignee: "work",
        input: { note: "background" },
      },
    ],
  });

  return defineFlow({
    kind: SENDER,
    actions: { start: { block: board.drain } },
  })({ id: SENDER });
}

async function durableRow(stores: StoreRegistry, taskId: string): Promise<Task | undefined> {
  const row = await stores.resourceState.get("user", USER_ID, `${LEDGER_ID}/${taskId}`);
  return row?.state as Task | undefined;
}

async function until(predicate: () => boolean | Promise<boolean>, label: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

describe("a cross-flow task-board hand-off", () => {
  it("still refuses a recipient that only declares the remotely addressed task entry", () => {
    expect(() =>
      defineFlow({
        kind: RECIPIENT,
        actions: {},
        task: { actions: { work: { block: workWorker([]) } } },
      })
    ).toThrow(/declares task entry "work", but no task board reachable from the flow hands off to it/);
  });

  it("reaches the recipient worker and settles the originating row", async () => {
    const ran: string[] = [];
    const sender = senderFlow();
    const recipient = recipientFlow(ran);
    const state = createFlowState({
      flows: { [SENDER]: sender, [RECIPIENT]: recipient },
      stores: { default: { primary: inMemoryStores() } },
      modelResolver: createMockModelResolver({}),
    });

    try {
      const runtime: FlowStateRuntime = await state.getRuntime();
      const parent = await runAction({
        flow: sender,
        actionName: "start",
        input: {},
        userId: USER_ID,
        sessionId: "s_sender",
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig },
      });

      expect(parent.error).toBeUndefined();

      const afterParent = await durableRow(runtime.stores, "t1");
      // A refused hand-off restores the claim and recordError fails the row.
      // The wrong-destination miss looks like: flow "task-sender" declares
      // no task entry "work". In-process dispatch may finish the child
      // before this assertion, so "already completed" is success; errored
      // is the hole this test exists to close.
      if (afterParent?.status === "errored") {
        throw new Error(
          `hand-off failed the originating row before a child ran: ${afterParent.error ?? "(no error)"}`
        );
      }

      await until(async () => {
        const row = await durableRow(runtime.stores, "t1");
        return row?.status === "completed";
      }, "the recipient worker to settle the originating row");

      expect(ran).toEqual(["t1"]);
      const afterChild = await durableRow(runtime.stores, "t1");
      expect(afterChild?.status).toBe("completed");

      const children = await runtime.stores.session.list({
        userId: USER_ID,
        parentage: { parentOf: "s_sender" },
      });
      expect(children).toHaveLength(1);
      expect(children[0]?.flowKind).toBe(RECIPIENT);
    } finally {
      await state.dispose();
    }
  });
});
