/**
 * A board's fallback that hands rows off to a flow looked up per task.
 *
 * The fallback (`defaultWorker`) holds a task dispatcher whose `flowKind` is a
 * function of the task: each row the board's own seats do not name goes to
 * the flow that function answers, under the assignee it was claimed with, in a
 * session of its own. A row the function answers nothing for, or that names
 * no assignee, fails by name before anything is dispatched. A seat the board
 * names keeps its own route and never asks the function.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import type { FlowStateRuntime, StoreRegistry } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { z } from "zod";
import {
  defineTaskCollection,
  getOrCreateTaskCollection,
  resolveResourceCollection,
  type Task,
  type TaskWorkerInput,
} from "../../src/tasks";
import { taskBoard, taskLedgers, taskWorkerInputSchema } from "../../src/task-board";

const USER_ID = "u_per_task_target";
const LEDGER_ID = "per-task-list";
const LEDGER = Object.assign(defineTaskCollection({ id: LEDGER_ID, scope: "user" }), { id: LEDGER_ID });

/** A flow that takes tasks off the shared ledger and records which flow ran each. */
function takerFlow(id: string, ran: Array<{ flow: string; taskId: string; session: string }>) {
  return defineFlow({
    kind: id,
    actions: {},
    resources: { [LEDGER_ID]: LEDGER },
    task: {
      actions: {
        work: {
          block: handler({
            name: `${id}-work`,
            inputSchema: taskWorkerInputSchema,
            outputSchema: z.object({ by: z.string() }),
            execute: (input: TaskWorkerInput, ctx) => {
              ran.push({ flow: id, taskId: input.taskId, session: ctx.session.identity.id });
              return { by: id };
            },
          }),
          from: taskLedgers({
            name: `${id}-door`,
            resolve: async (ledgerId: string, ctx: BlockContext) => {
              const collection = resolveResourceCollection(ctx, ledgerId);
              return collection === undefined
                ? undefined
                : getOrCreateTaskCollection({ ctx, backing: "resource", collectionId: ledgerId, collection });
            },
          }),
        },
      },
    },
  })({ id });
}

function senderFlow(options: {
  target: (task: { assignee: string; taskId: string }) => string | undefined | Promise<string | undefined>;
  asked: string[];
  inlineRan: string[];
  tasks: Array<{ id: string; assignee?: string }>;
}) {
  const board = taskBoard({
    name: "per-task-board",
    boardId: LEDGER_ID,
    collection: LEDGER,
    workers: {
      local: handler({
        name: "local-worker",
        inputSchema: taskWorkerInputSchema,
        outputSchema: z.object({ by: z.string() }),
        execute: (input: TaskWorkerInput) => {
          options.inlineRan.push(input.taskId);
          return { by: "local" };
        },
      }),
    },
    defaultWorker: dispatcher<TaskWorkerInput>({
      name: "per-task-fallback",
      action: "work",
      session: "per-task",
      flowKind: (task) => {
        options.asked.push(task.assignee);
        return options.target(task);
      },
    }),
    initialTasks: options.tasks.map((t) => ({ id: t.id, goal: `do ${t.id}`, input: {}, ...(t.assignee ? { assignee: t.assignee } : {}) })),
  });
  return defineFlow({ kind: "per-task-sender", actions: { start: { block: board.drain } } })({
    id: "per-task-sender",
  });
}

async function row(stores: StoreRegistry, taskId: string): Promise<Task | undefined> {
  return (await stores.resourceState.get("user", USER_ID, `${LEDGER_ID}/${taskId}`))?.state as Task | undefined;
}

async function until(predicate: () => Promise<boolean>, label: string): Promise<void> {
  for (let i = 0; i < 300; i += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function drain(runtime: FlowStateRuntime, flow: ReturnType<typeof senderFlow>) {
  return runAction({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: "start",
    input: {},
    userId: USER_ID,
    sessionId: "s_sender",
    stores: runtime.stores,
    runtimeConfig: { ...runtime.runtimeConfig },
  });
}

describe("a fallback that hands rows to a flow looked up per task", () => {
  it("sends each named row to the flow its name looks up, in a session of its own", async () => {
    const ran: Array<{ flow: string; taskId: string; session: string }> = [];
    const asked: string[] = [];
    const inlineRan: string[] = [];
    const flows = { alice: "taker-alice", bob: "taker-bob" } as Record<string, string>;
    const sender = senderFlow({
      // Async on purpose: a lookup may read a store.
      target: async (task) => flows[task.assignee],
      asked,
      inlineRan,
      tasks: [
        { id: "t-alice-1", assignee: "alice" },
        { id: "t-alice-2", assignee: "alice" },
        { id: "t-bob", assignee: "bob" },
        { id: "t-local", assignee: "local" },
      ],
    });
    const state = createFlowState({
      flows: {
        [sender.id]: sender,
        "taker-alice": takerFlow("taker-alice", ran),
        "taker-bob": takerFlow("taker-bob", ran),
      },
      stores: { default: { primary: inMemoryStores() } },
      modelResolver: createMockModelResolver({}),
    });
    try {
      const runtime = await state.getRuntime();
      expect((await drain(runtime, sender)).error).toBeUndefined();
      for (const id of ["t-alice-1", "t-alice-2", "t-bob", "t-local"]) {
        await until(async () => (await row(runtime.stores, id))?.status === "completed", id);
      }
      const byTask = Object.fromEntries(ran.map((r) => [r.taskId, r]));
      expect(byTask["t-alice-1"]?.flow).toBe("taker-alice");
      expect(byTask["t-alice-2"]?.flow).toBe("taker-alice");
      expect(byTask["t-bob"]?.flow).toBe("taker-bob");
      // Two tasks for one name run in two sessions.
      expect(byTask["t-alice-1"]?.session).not.toBe(byTask["t-alice-2"]?.session);
      // The board's own seat ran inline and the lookup was never asked about it.
      expect(inlineRan).toEqual(["t-local"]);
      expect(asked).not.toContain("local");
      expect(asked.sort()).toEqual(["alice", "alice", "bob"]);

      // A second drain hands nothing over twice.
      expect((await drain(runtime, sender)).error).toBeUndefined();
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(ran).toHaveLength(3);
    } finally {
      await state.dispose();
    }
  });

  it("fails a row its lookup answers nothing for, naming the assignee, and one with no assignee", async () => {
    const ran: Array<{ flow: string; taskId: string; session: string }> = [];
    const sender = senderFlow({
      target: () => undefined,
      asked: [],
      inlineRan: [],
      tasks: [{ id: "t-nobody", assignee: "nobody" }, { id: "t-unnamed" }],
    });
    const state = createFlowState({
      flows: { [sender.id]: sender, "taker-alice": takerFlow("taker-alice", ran) },
      stores: { default: { primary: inMemoryStores() } },
      modelResolver: createMockModelResolver({}),
    });
    try {
      const runtime = await state.getRuntime();
      await drain(runtime, sender);
      const nobody = await row(runtime.stores, "t-nobody");
      expect(nobody?.status).toBe("errored");
      expect(nobody?.error).toMatch(/flow-not-found.*assignee "nobody"/);
      const unnamed = await row(runtime.stores, "t-unnamed");
      expect(unnamed?.status).toBe("errored");
      expect(unnamed?.error).toMatch(/names no assignee/);
      expect(ran).toEqual([]);
      const children = await runtime.stores.session.list({ userId: USER_ID, parentage: { parentOf: "s_sender" } });
      expect(children).toHaveLength(0);
    } finally {
      await state.dispose();
    }
  });
});
