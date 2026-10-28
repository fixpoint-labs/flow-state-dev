/**
 * A claim owes its filer's wake at the lease's end (FIX-2078). A worker that
 * dies mid-claim lets its lease lapse, and only the filer's pass reclaims the
 * row: with nothing else owed, that pass needs a wake at the lease's end, or
 * the row waits for a touch.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { z } from "zod";
import {
  defineTaskCollection,
  getOrCreateTaskCollection,
  resolveResourceCollection,
  type Task,
  type TaskWorkerInput,
} from "../../src/tasks";
import { DEFAULT_LEASE_DURATION_MS } from "../../src/tasks/collection/internal";
import { taskBoard, taskWorkerInputSchema } from "../../src/task-board";
import { heard } from "../fixtures/heard";

const USER_ID = "u_lease_wake";
const LEDGER = Object.assign(defineTaskCollection({ id: "lease-wake", scope: "user" }), { id: "lease-wake" });

describe("a claim on a board that hands rows out", () => {
  it("owes the filer's pass a wake at the lease's end, before the claim lands", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const started: string[] = [];
    const worker = handler({
      name: "lease-wake-work",
      inputSchema: taskWorkerInputSchema,
      outputSchema: z.object({}),
      execute: async (input: TaskWorkerInput) => {
        started.push(input.taskId);
        await held;
        return {};
      },
    });
    const board = taskBoard({
      name: "lease-wake-board",
      boardId: LEDGER.id,
      mode: "delegation",
      collection: LEDGER,
      workers: { work: dispatcher<TaskWorkerInput>({ name: "lease-wake-dispatch", action: "work", session: "per-task" }) },
      initialTasks: [{ id: "t1", goal: "slow", assignee: "work", input: {} }],
    });
    const flow = defineFlow({
      kind: "lease-wake",
      actions: { start: { block: board.drain } },
      internal: { actions: { ...heard } },
      task: { actions: { work: { block: worker } } },
    })({ id: "lease-wake" });
    const state = createFlowState({
      flows: { [flow.id]: flow },
      stores: { default: { primary: inMemoryStores() } },
      modelResolver: createMockModelResolver({}),
      durable: true,
    });
    try {
      const runtime = await state.getRuntime();
      const before = Date.now();
      const drained = await runAction({
        orgId: DEFAULT_ORG_ID,
        flow,
        actionName: "start",
        input: {},
        userId: USER_ID,
        sessionId: "filer",
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig },
      });
      expect(drained.error).toBeUndefined();
      for (let i = 0; i < 200 && started.length === 0; i += 1) await new Promise((r) => setTimeout(r, 10));
      expect(started).toEqual(["t1"]);
      const row = (await runtime.stores.resourceState.get("user", `${USER_ID}:~org:${DEFAULT_ORG_ID}`, `${LEDGER.id}/t1`))
        ?.state as Task | undefined;
      expect(row?.status).toBe("in_progress");
      const wake = await runtime.stores.wakes!.get({ sessionId: "filer", entry: "onTaskSettled" });
      expect(wake).not.toBeNull();
      expect(wake!.dueAt).toBeGreaterThanOrEqual(before + DEFAULT_LEASE_DURATION_MS - 1_000);
      expect(wake!.dueAt).toBeLessThanOrEqual(Date.now() + DEFAULT_LEASE_DURATION_MS);
    } finally {
      release();
      await state.dispose();
    }
  });

  it("owes the lease's end in the filer's own session too, so a pass that read the wake before the claim can't drop it", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const worker = handler({
      name: "own-wake-work",
      inputSchema: taskWorkerInputSchema,
      outputSchema: z.object({}),
      execute: async () => {
        await held;
        return {};
      },
    });
    const board = taskBoard({
      name: "own-wake-board",
      boardId: LEDGER.id,
      mode: "delegation",
      collection: LEDGER,
      workers: { work: dispatcher<TaskWorkerInput>({ name: "own-wake-dispatch", action: "work", session: "per-task" }) },
      initialTasks: [{ id: "t1", goal: "slow", assignee: "work", input: {} }],
    });
    const flow = defineFlow({
      kind: "own-wake",
      actions: { start: { block: board.drain } },
      internal: { actions: { ...heard } },
      task: { actions: { work: { block: worker } } },
    })({ id: "own-wake" });
    const state = createFlowState({
      flows: { [flow.id]: flow },
      stores: { default: { primary: inMemoryStores() } },
      modelResolver: createMockModelResolver({}),
      durable: true,
    });
    try {
      const runtime = await state.getRuntime();
      const key = { sessionId: "filer", entry: "onTaskSettled" };
      // The session's pass already owes a wake, due before any lease's end.
      await runtime.stores.session.set("filer", { id: "filer", state: {}, version: 0, createdAt: 0, updatedAt: 0, flowKind: "own-wake", flowId: "own-wake", userId: USER_ID, orgId: DEFAULT_ORG_ID, journal: [] } as never, "any");
      const owed = await runtime.stores.wakes!.owe({ ...key, flowKind: "own-wake", userId: USER_ID, orgId: DEFAULT_ORG_ID, dueAt: Date.now() + 60_000, landBy: Date.now() + 60_000 });
      const drained = await runAction({
        orgId: DEFAULT_ORG_ID,
        flow,
        actionName: "start",
        input: {},
        userId: USER_ID,
        sessionId: "filer",
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig },
      });
      expect(drained.error).toBeUndefined();
      // A pass that read the wake before this claim now settles stale, and
      // the wake, coalesced, keeps the earlier due time.
      const after = await runtime.stores.wakes!.get(key);
      expect(after!.version).toBeGreaterThan(owed.version);
      expect(after!.dueAt).toBe(owed.dueAt);
    } finally {
      release();
      await state.dispose();
    }
  });
});
