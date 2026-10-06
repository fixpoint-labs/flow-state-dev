/**
 * One task entry served by many ledgers (`taskLedgers`): the entry declares
 * where it takes tasks from instead of being reached by one board, and each
 * dispatch's row is read off the ledger the dispatch names.
 *
 * Two sender boards, over two ledgers the recipient never builds a board for,
 * hand off to the same recipient entry. Both rows run and settle on their own
 * ledger. A dispatch naming a ledger the resolver does not answer for is
 * refused before any row is read, and a claim that went stale between
 * hand-over and arrival writes nothing, exactly as on a board's own gate.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import type { ActionCore, BlockContext } from "@flow-state-dev/core/types";
import { createFlowState, createInMemoryStores, inMemoryStores, runAction } from "@flow-state-dev/engine";
import type { FlowStateRuntime, StoreRegistry } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { z } from "zod";
import {
  createResourceBackedTaskCollection,
  defineTaskCollection,
  getOrCreateTaskCollection,
  resolveResourceCollection,
  type Task,
  type TaskCollectionRef,
  type TaskWorkerInput,
} from "../../src/tasks";
import { createFakeResourceCollection } from "../helpers";
import { taskBoard, taskLedgers, taskWorkerInputSchema } from "../../src/task-board";

const USER_ID = "u_task_ledgers";
const RECIPIENT = "ledgers-recipient";

const ledger = (id: string) => Object.assign(defineTaskCollection({ id, scope: "user" }), { id });
const LEDGER_A = ledger("list-a");
const LEDGER_B = ledger("list-b");
/** A ledger the senders can write and the recipient does not declare. */
const LEDGER_X = ledger("list-x");

function workWorker(ran: string[]) {
  return handler({
    name: "ledgers-work",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.object({ handled: z.string() }),
    execute: (input: TaskWorkerInput) => {
      ran.push(input.taskId);
      return { handled: input.taskId };
    },
  });
}

/** Resolve a ledger id only when this flow declares it — the shape a real resolver has. */
async function declaredLedger(ledgerId: string, ctx: BlockContext) {
  const collection = resolveResourceCollection(ctx, ledgerId);
  if (collection === undefined) return undefined;
  return getOrCreateTaskCollection({ ctx, backing: "resource", collectionId: ledgerId, collection });
}

function recipientFlow(ran: string[], reads: string[]) {
  return defineFlow({
    kind: RECIPIENT,
    actions: {},
    resources: { [LEDGER_A.id]: LEDGER_A, [LEDGER_B.id]: LEDGER_B },
    task: {
      actions: {
        work: {
          block: workWorker(ran),
          from: taskLedgers({
            name: "ledgers-door",
            resolve: async (ledgerId, ctx) => {
              reads.push(ledgerId);
              return declaredLedger(ledgerId, ctx);
            },
          }),
        },
      },
    },
  })({ id: RECIPIENT });
}

function senderFlow(kind: string, list: ReturnType<typeof ledger>, taskId: string) {
  const board = taskBoard({
    name: `${kind}-board`,
    // Handed off under the ledger's id: what the recipient resolves.
    boardId: list.id,
    collection: list,
    workers: {
      work: dispatcher<TaskWorkerInput>({
        name: `${kind}-hand-off`,
        flowKind: RECIPIENT,
        action: "work",
        session: "per-task",
      }),
    },
    initialTasks: [{ id: taskId, goal: `do ${taskId}`, assignee: "work", input: {} }],
  });
  return defineFlow({ kind, actions: { start: { block: board.drain } } })({ id: kind });
}

async function durableRow(stores: StoreRegistry, ledgerId: string, taskId: string) {
  const row = await stores.resourceState.get("user", USER_ID, `${ledgerId}/${taskId}`);
  return row?.state as Task | undefined;
}

async function until(predicate: () => boolean | Promise<boolean>, label: string): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function drain(runtime: FlowStateRuntime, flow: ReturnType<typeof senderFlow>, sessionId: string) {
  return runAction({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: "start",
    input: {},
    userId: USER_ID,
    sessionId,
    stores: runtime.stores,
    runtimeConfig: { ...runtime.runtimeConfig },
  });
}

describe("a task entry served by many ledgers", () => {
  it("is accepted with no board in its flow", () => {
    expect(() => recipientFlow([], [])).not.toThrow();
  });

  it("queues its runs, since this flow cannot see its senders' session policy", () => {
    // A sender under a shared session policy would otherwise interleave two
    // tasks in one child session.
    const flow = recipientFlow([], []) as unknown as { task: { actions: Record<string, { concurrency?: string }> } };
    expect(flow.task.actions.work!.concurrency).toBe("queue");
  });

  it("refuses an entry that also has a same-flow board", () => {
    const board = taskBoard({
      name: "own-board",
      boardId: "own",
      collection: LEDGER_A,
      workers: { work: dispatcher<TaskWorkerInput>({ name: "own-hand-off", action: "work", session: "per-task" }) },
    });
    expect(() =>
      defineFlow({
        kind: "both",
        actions: { drain: { block: board.drain } },
        task: {
          actions: {
            work: {
              block: workWorker([]),
              from: taskLedgers({ name: "door", resolve: async () => undefined }),
            },
          },
        },
      })
    ).toThrow(/declares where it takes tasks from .*board "own".*One entry runs behind one gate/s);
  });

  it("takes tasks from two ledgers it never built a board for, each settled on its own ledger", async () => {
    const ran: string[] = [];
    const reads: string[] = [];
    const a = senderFlow("sender-a", LEDGER_A, "ta");
    const b = senderFlow("sender-b", LEDGER_B, "tb");
    const state = createFlowState({
      flows: { [a.id]: a, [b.id]: b, [RECIPIENT]: recipientFlow(ran, reads) },
      stores: { default: { primary: inMemoryStores() } },
      modelResolver: createMockModelResolver({}),
    });
    try {
      const runtime = await state.getRuntime();
      expect((await drain(runtime, a, "s_a")).error).toBeUndefined();
      expect((await drain(runtime, b, "s_b")).error).toBeUndefined();
      await until(async () => (await durableRow(runtime.stores, "list-a", "ta"))?.status === "completed", "ta");
      await until(async () => (await durableRow(runtime.stores, "list-b", "tb"))?.status === "completed", "tb");
      expect(ran.sort()).toEqual(["ta", "tb"]);
      expect(reads).toContain("list-a");
      expect(reads).toContain("list-b");
      // Each row settled with this run's link on its own ledger.
      expect((await durableRow(runtime.stores, "list-a", "ta"))?.output).toEqual({ handled: "ta" });
      expect((await durableRow(runtime.stores, "list-b", "tb"))?.output).toEqual({ handled: "tb" });
    } finally {
      await state.dispose();
    }
  });

  it("refuses a ledger it does not answer for before reading a row, and runs nothing", async () => {
    const ran: string[] = [];
    const x = senderFlow("sender-x", LEDGER_X, "tx");
    const state = createFlowState({
      flows: { [x.id]: x, [RECIPIENT]: recipientFlow(ran, []) },
      stores: { default: { primary: inMemoryStores() } },
      modelResolver: createMockModelResolver({}),
    });
    try {
      const runtime = await state.getRuntime();
      await drain(runtime, x, "s_x");
      // The child refuses in its gate; the row is never written by it, so it
      // stays as the hand-off left it (in progress, lease lapsing) and nothing ran.
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(ran).toEqual([]);
      const row = await durableRow(runtime.stores, "list-x", "tx");
      expect(row?.status).toBe("in_progress");
      expect(row?.run).toBeUndefined();
      // A child session was started and its gate refused: one session, no run on the row.
      const children = await runtime.stores.session.list({ userId: USER_ID, parentage: { parentOf: "s_x" } });
      expect(children).toHaveLength(1);
    } finally {
      await state.dispose();
    }
  });
});

/**
 * The gate itself, run as an action root over two in-memory ledgers, so the
 * claim can be moved between hand-over and arrival.
 */
describe("the gate of a task entry served by many ledgers", () => {
  async function harness() {
    const stores = { a: createFakeResourceCollection(), b: createFakeResourceCollection() };
    const ledgerOf = (id: "a" | "b") =>
      createResourceBackedTaskCollection({
        collectionId: id,
        collection: stores[id],
        claimIdentity: { sessionId: "s_parent", requestId: "req_parent" },
      });
    const ran: string[] = [];
    const resolved: string[] = [];
    for (const id of ["a", "b"] as const) {
      const parent = await ledgerOf(id);
      await parent.addTask({ id: "t1", goal: `do it on ${id}`, assignee: "work", input: {} });
      await parent.claim("drain", { leaseDurationMs: 60_000 });
    }
    const worker = handler({
      name: "gate-worker",
      inputSchema: taskWorkerInputSchema,
      outputSchema: z.object({ on: z.string() }),
      execute: (input: TaskWorkerInput) => {
        ran.push(input.goal);
        return { on: input.goal };
      },
    });
    const binding = taskLedgers({
      name: "door",
      resolve: async (id): Promise<TaskCollectionRef | undefined> => {
        resolved.push(id);
        return id === "a" || id === "b" ? ledgerOf(id) : undefined;
      },
    });
    const entry = binding.gate({ block: worker } as unknown as ActionCore, "work");
    const flow = defineFlow({ kind: "door-gate", actions: { work: entry } } as never)({ id: "door-gate" });
    const runStores = createInMemoryStores();
    const run = async (ledgerId: string, attemptOffset = 0, sessionId = `s_${ledgerId}_${attemptOffset}`) => {
      const row = (await ledgerOf(ledgerId === "b" ? "b" : "a")).get("t1") as Task;
      return runAction({
        orgId: DEFAULT_ORG_ID,
        flow,
        actionName: "work",
        input: {
          boardId: ledgerId,
          seat: "work",
          taskId: "t1",
          attempt: row.attempts + attemptOffset,
          createdAt: row.createdAt,
          incarnationId: row.incarnationId,
          payload: { taskId: "t1", goal: row.goal, attempts: row.attempts, input: {} },
        },
        userId: USER_ID,
        sessionId,
        stores: runStores,
        runtimeConfig: { modelResolver: createMockModelResolver({}) },
      });
    };
    return { run, ran, resolved, row: async (id: "a" | "b") => (await ledgerOf(id)).get("t1") as Task };
  }

  it("re-reads the row on the ledger the dispatch names and settles it there", async () => {
    const h = await harness();
    const result = await h.run("b");
    expect(result.error).toBeUndefined();
    expect(h.ran).toEqual(["do it on b"]);
    expect((await h.row("b")).status).toBe("completed");
    // The other ledger's row of the same id is untouched.
    expect((await h.row("a")).status).toBe("in_progress");
  });

  it("settles each of two rows in one session on its own ledger", async () => {
    // A shared child session (the case `allowSessionState` admits): the
    // ledger the first row settled on must not carry over to the second.
    const h = await harness();
    expect((await h.run("b", 0, "s_shared")).error).toBeUndefined();
    expect((await h.run("a", 0, "s_shared")).error).toBeUndefined();
    expect(h.ran).toEqual(["do it on b", "do it on a"]);
    expect((await h.row("b")).status).toBe("completed");
    expect((await h.row("a")).status).toBe("completed");
  });

  it("writes nothing when the claim on that ledger is stale", async () => {
    const h = await harness();
    await h.run("b", 1);
    expect(h.ran).toEqual([]);
    const row = await h.row("b");
    expect(row.status).toBe("in_progress");
    expect(row.run).toBeUndefined();
  });

  it("refuses an id it does not resolve before reading any row", async () => {
    const h = await harness();
    const result = await h.run("elsewhere");
    expect(h.resolved).toEqual(["elsewhere"]);
    expect(h.ran).toEqual([]);
    expect(JSON.stringify(result.output ?? result.error ?? "")).toMatch(
      /takes no tasks from ledger \\?"elsewhere\\?"/
    );
    expect((await h.row("a")).run).toBeUndefined();
    expect((await h.row("b")).run).toBeUndefined();
  });
});
