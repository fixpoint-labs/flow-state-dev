/**
 * A board whose dispatcher chooses each row's entry and session from the row.
 *
 * One board, two kinds of row: some go to one entry in a child session of
 * their own, others to another entry in a session that is already running,
 * named by id on the row. Driven through the real engine, because the guard on
 * an id is the engine's: an existing session is delivered into only when it is
 * this principal's on this flow, and is never created. What must hold at the
 * board is that every refusal (an entry the dispatcher does not declare, a
 * session the engine will not deliver into) is decided before anything runs,
 * with the claim handed back, so the row fails by name rather than sitting
 * claimed until its lease lapses.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import type { TaskTargetQuery } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import type { FlowStateRuntime, StoreRegistry } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { z } from "zod";
import { defineTaskCollection, type Task, type TaskWorkerInput } from "../../src/tasks";
import { taskBoard, taskWorkerInputSchema } from "../../src/task-board";
import { heard } from "../fixtures/heard";

const USER_ID = "u_per_row";
const FLOW = "per-row-board";
const LEDGER_ID = "per-row-tasks";

type Ran = { entry: string; taskId: string; session: string };

/** What a row carries: which entry, and optionally which existing session. */
type RowInput = { entry?: string; sessionId?: string };
const rowOf = (task: TaskTargetQuery) => ((task.input as TaskWorkerInput).input ?? {}) as RowInput;

function entry(name: string, ran: Ran[]) {
  return handler({
    name: `${name}-entry`,
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.object({ ok: z.boolean() }),
    execute: (input: TaskWorkerInput, ctx) => {
      ran.push({ entry: name, taskId: input.taskId, session: ctx.session.identity.id });
      return { ok: true };
    },
  });
}

function boardFlow(ran: Ran[], rows: Array<{ id: string; input: RowInput }>, among = ["work", "post"]) {
  const board = taskBoard({
    name: "per-row",
    boardId: LEDGER_ID,
    mode: "delegation",
    collection: defineTaskCollection({ id: LEDGER_ID, scope: "user" }),
    workers: {
      em: dispatcher({
        name: "per-row-dispatch",
        type: "task",
        action: { among, by: (task) => rowOf(task).entry ?? "" },
        session: {
          by: (task) => {
            const sessionId = rowOf(task).sessionId;
            return sessionId !== undefined ? { id: sessionId } : { key: `own|${task.taskId}` };
          },
        },
      }),
    },
    initialTasks: rows.map((row) => ({ id: row.id, goal: `do ${row.id}`, assignee: "em", input: row.input })),
  });
  return defineFlow({ internal: { actions: { ...heard } },
    kind: FLOW,
    actions: { start: { block: board.drain } },
    task: { actions: { work: { block: entry("work", ran) }, post: { block: entry("post", ran) } } },
  })({ id: FLOW });
}

async function seedSession(stores: StoreRegistry, id: string, flowKind: string, userId: string): Promise<void> {
  const ts = Date.now();
  await stores.session.set(
    id,
    { id, state: {}, version: 0, createdAt: ts, updatedAt: ts, flowKind, userId, orgId: DEFAULT_ORG_ID, journal: [] },
    "any"
  );
}

async function row(stores: StoreRegistry, taskId: string): Promise<Task | undefined> {
  return (await stores.resourceState.get("user", `${USER_ID}:~org:${DEFAULT_ORG_ID}`, `${LEDGER_ID}/${taskId}`))
    ?.state as Task | undefined;
}

async function until(predicate: () => Promise<boolean>, label: string): Promise<void> {
  for (let i = 0; i < 300; i += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function boot(ran: Ran[], rows: Array<{ id: string; input: RowInput }>) {
  const flow = boardFlow(ran, rows);
  const state = createFlowState({
    flows: { [flow.id]: flow },
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({}),
  });
  const runtime = await state.getRuntime();
  return { flow, state, runtime };
}

function drain(runtime: FlowStateRuntime, flow: ReturnType<typeof boardFlow>) {
  return runAction({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: "start",
    input: {},
    userId: USER_ID,
    sessionId: "s_board",
    stores: runtime.stores,
    runtimeConfig: { ...runtime.runtimeConfig },
  });
}

describe("a board that chooses each row's entry", () => {
  it("refuses at definition an entry it chooses among that the flow does not declare", () => {
    expect(() => boardFlow([], [], ["work", "post", "review"])).toThrow(
      /dispatches to task:"review", but the flow declares no such task entry/
    );
  });

  it("sends each row to the entry the row names, and fails one outside the declared entries", async () => {
    const ran: Ran[] = [];
    const { flow, state, runtime } = await boot(ran, [
      { id: "t-work", input: { entry: "work" } },
      { id: "t-post", input: { entry: "post" } },
      { id: "t-admin", input: { entry: "admin" } },
    ]);
    try {
      expect((await drain(runtime, flow)).error).toBeUndefined();
      for (const id of ["t-work", "t-post"]) {
        await until(async () => (await row(runtime.stores, id))?.status === "completed", id);
      }
      expect(Object.fromEntries(ran.map((r) => [r.taskId, r.entry]))).toEqual({ "t-work": "work", "t-post": "post" });

      // Refused before dispatch with the claim handed back: the row fails by
      // name instead of sitting claimed until its lease lapses.
      const admin = await row(runtime.stores, "t-admin");
      expect(admin?.status).toBe("errored");
      expect(admin?.error).toMatch(/no-entry.*"admin"/);
    } finally {
      await state.dispose();
    }
  });
});

describe("a board that chooses each row's session", () => {
  it("delivers a row into the existing session it names, and keys the others a child of their own", async () => {
    const ran: Ran[] = [];
    const { flow, state, runtime } = await boot(ran, [
      { id: "t-into", input: { entry: "post", sessionId: "s_running" } },
      { id: "t-own", input: { entry: "work" } },
    ]);
    try {
      await seedSession(runtime.stores, "s_running", FLOW, USER_ID);
      expect((await drain(runtime, flow)).error).toBeUndefined();
      for (const id of ["t-into", "t-own"]) {
        await until(async () => (await row(runtime.stores, id))?.status === "completed", id);
      }
      const byTask = Object.fromEntries(ran.map((r) => [r.taskId, r.session]));
      expect(byTask["t-into"]).toBe("s_running");
      expect(byTask["t-own"]).not.toBe("s_running");
      expect(byTask["t-own"]).not.toBe("s_board");
    } finally {
      await state.dispose();
    }
  });

  it("refuses a missing session, another person's, and another flow's — never creating one, failing the row", async () => {
    const ran: Ran[] = [];
    const { flow, state, runtime } = await boot(ran, [
      { id: "t-missing", input: { entry: "post", sessionId: "s_missing" } },
      { id: "t-bob", input: { entry: "post", sessionId: "s_bob" } },
      { id: "t-elsewhere", input: { entry: "post", sessionId: "s_elsewhere" } },
    ]);
    try {
      await seedSession(runtime.stores, "s_bob", FLOW, "u_bob");
      await seedSession(runtime.stores, "s_elsewhere", "another-flow", USER_ID);
      expect((await drain(runtime, flow)).error).toBeUndefined();

      // Another person's session answers as an absent one does: the engine
      // does not confirm a session exists across a boundary the sender cannot see.
      expect((await row(runtime.stores, "t-missing"))?.error).toMatch(/session-not-found/);
      expect((await row(runtime.stores, "t-bob"))?.error).toMatch(/session-not-found/);
      expect((await row(runtime.stores, "t-elsewhere"))?.error).toMatch(/session-not-addressable/);
      for (const id of ["t-missing", "t-bob", "t-elsewhere"]) {
        expect((await row(runtime.stores, id))?.status).toBe("errored");
      }

      expect(ran).toEqual([]);
      expect(await runtime.stores.session.get("s_missing")).toBeUndefined();
      expect((await runtime.stores.session.get("s_bob"))?.userId).toBe("u_bob");
    } finally {
      await state.dispose();
    }
  });
});
