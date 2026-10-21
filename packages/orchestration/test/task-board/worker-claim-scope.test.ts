/**
 * A claimed worker reads its ticket on both routes: an inline drain, and a
 * dispatch gate. The seam is read from inside the worker, because a missing
 * ticket does not fail on its own.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { createMockModelResolver, testBlock } from "@flow-state-dev/testing";
import { z } from "zod";
import {
  createStateBackedTaskCollection,
  defineTaskCollection,
  type TaskClaimTicket,
  type TaskCollectionRef,
  type TaskWorker,
  type TaskWorkerInput,
} from "../../src/tasks";
import { currentWorkerClaim, isTaskTurn, taskBoard, taskWorkerInputSchema } from "../../src/task-board";
import { createFakeSequencerState } from "../helpers";
import { heard } from "../fixtures/heard";

function boardCollection(collectionId: string): TaskCollectionRef {
  return createStateBackedTaskCollection({
    collectionId,
    state: createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} }),
  });
}

describe("an inline board worker", () => {
  it("reads the claim ticket for the task it is working on", async () => {
    const collection = boardCollection("inline-claim");
    const seen: Array<TaskClaimTicket | undefined> = [];
    const worker = handler({
      name: "claim-reader",
      inputSchema: taskWorkerInputSchema,
      outputSchema: z.object({ done: z.boolean() }),
      execute: async (_input, ctx) => {
        seen.push(currentWorkerClaim(ctx));
        return { done: true };
      },
    }) as TaskWorker;

    const board = taskBoard({
      name: "inline-claim-board",
      collection: () => collection,
      concurrency: 1,
      initialTasks: [{ id: "t", goal: "read my claim" }],
      workers: worker,
    });

    const result = await testBlock(board.drain, { input: undefined });

    expect(result.error).toBeNull();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ collectionId: "inline-claim", taskId: "t", attempt: 1 });
  });

  it("gives each concurrent worker its own ticket, not a sibling's", async () => {
    const seen: Record<string, string | undefined> = {};
    const worker = handler({
      name: "concurrent-claim-reader",
      inputSchema: taskWorkerInputSchema,
      outputSchema: z.object({ done: z.boolean() }),
      execute: async (input, ctx) => {
        // Yield so the two workers interleave before either reads its claim.
        await new Promise((resolve) => setTimeout(resolve, 10));
        seen[input.taskId] = currentWorkerClaim(ctx)?.taskId;
        return { done: true };
      },
    }) as TaskWorker;

    const board = taskBoard({
      name: "concurrent-claim-board",
      collection: { collectionId: "concurrent-claim" },
      concurrency: 2,
      initialTasks: [
        { id: "a", goal: "first" },
        { id: "b", goal: "second" },
      ],
      workers: worker,
    });

    const result = await testBlock(board.drain, { input: undefined });

    expect(result.error).toBeNull();
    expect(Object.keys(seen).sort()).toEqual(["a", "b"]);
    expect(seen).toEqual({ a: "a", b: "b" });
  });
});

describe("a dispatched worker behind the claim gate", () => {
  it("reads the claim ticket the gate minted for the dispatched row", async () => {
    const USER_ID = "u_claim_scope";
    const BOARD_ID = "claim-scope-board";
    const ledger = () => defineTaskCollection({ id: "claim-scope-ledger", scope: "user" });
    const seen: Array<TaskClaimTicket | undefined> = [];
    // Resolved by the gated worker itself, so the test waits on the read it
    // checks rather than polling for it.
    let read!: () => void;
    const workerRan = new Promise<void>((resolve) => {
      read = resolve;
    });

    const recipientWorker = handler({
      name: "gated-claim-reader",
      inputSchema: taskWorkerInputSchema,
      outputSchema: z.object({ done: z.boolean() }),
      execute: async (_input, ctx) => {
        seen.push(currentWorkerClaim(ctx));
        read();
        return { done: true };
      },
    });
    const dispatchTo = (name: string, flowKind?: string) =>
      dispatcher<TaskWorkerInput>({
        name,
        ...(flowKind !== undefined ? { flowKind } : {}),
        action: "work",
        session: "per-task",
      });

    const recipient = defineFlow({ internal: { actions: { ...heard } },
      kind: "claim-recipient",
      actions: {
        drain: {
          block: taskBoard({
            name: "claim-recipient-board",
            boardId: BOARD_ID,
            mode: "delegation",
            collection: ledger(),
            workers: { work: dispatchTo("claim-recipient-dispatch") },
          }).drain,
        },
      },
      task: { actions: { work: { block: recipientWorker } } },
    })({ id: "claim-recipient" });

    const sender = defineFlow({ internal: { actions: { ...heard } },
      kind: "claim-sender",
      actions: {
        start: {
          block: taskBoard({
            name: "claim-sender-board",
            boardId: BOARD_ID,
            mode: "delegation",
            collection: ledger(),
            workers: { work: dispatchTo("claim-sender-dispatch", "claim-recipient") },
            initialTasks: [{ id: "t1", goal: "dispatched", assignee: "work" }],
          }).drain,
        },
      },
    })({ id: "claim-sender" });

    const state = createFlowState({
      flows: { "claim-sender": sender, "claim-recipient": recipient },
      stores: { default: { primary: inMemoryStores() } },
      modelResolver: createMockModelResolver({}),
    });

    try {
      const runtime = await state.getRuntime();
      const parent = await runAction({
        orgId: DEFAULT_ORG_ID,
        flow: sender,
        actionName: "start",
        input: {},
        userId: USER_ID,
        sessionId: "s_claim_sender",
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig },
      });
      expect(parent.error).toBeUndefined();

      await workerRan;

      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ taskId: "t1", attempt: 1 });
    } finally {
      await state.dispose();
    }
  });
});

describe("a request a claimed worker starts in-process", () => {
  it("does not read the worker's claim, though it runs in the worker's async chain", async () => {
    // A message, a notice and a resumed wait each start a new request from
    // inside the worker's turn, in-process. Async context follows them there;
    // the claim must not, or that request's turn would count as a task turn
    // (refusing to wait) and present a ticket for a row it doesn't hold.
    const USER_ID = "u_claim_started";
    const seen: { inWorker?: string; inStarted?: string | null; taskTurn?: boolean } = {};
    let started: Promise<unknown> | undefined;

    const probe = handler({
      name: "started-probe",
      inputSchema: z.object({}).passthrough(),
      outputSchema: z.object({}),
      execute: async (_input, ctx) => {
        seen.inStarted = currentWorkerClaim(ctx)?.taskId ?? null;
        seen.taskTurn = isTaskTurn(ctx);
        return {};
      },
    });
    let flowRef: ReturnType<ReturnType<typeof defineFlow>> | undefined;
    let runtimeRef: Awaited<ReturnType<ReturnType<typeof createFlowState>["getRuntime"]>> | undefined;
    const worker = handler({
      name: "starting-worker",
      inputSchema: taskWorkerInputSchema,
      outputSchema: z.object({ done: z.boolean() }),
      execute: async (_input, ctx) => {
        seen.inWorker = currentWorkerClaim(ctx)?.taskId;
        started = runAction({
          orgId: DEFAULT_ORG_ID,
          flow: flowRef!,
          actionName: "probe",
          input: {},
          userId: USER_ID,
          sessionId: "s_started",
          stores: runtimeRef!.stores,
          runtimeConfig: { ...runtimeRef!.runtimeConfig },
        });
        await started;
        return { done: true };
      },
    }) as TaskWorker;

    flowRef = defineFlow({ internal: { actions: { ...heard } },
      kind: "claim-starter",
      actions: {
        drain: {
          block: taskBoard({
            name: "claim-starter-board",
            collection: { collectionId: "claim-starter" },
            concurrency: 1,
            initialTasks: [{ id: "t1", goal: "start another request" }],
            workers: worker,
          }).drain,
        },
        probe: { block: probe },
      },
    })({ id: "claim-starter" });

    const state = createFlowState({
      flows: { "claim-starter": flowRef },
      stores: { default: { primary: inMemoryStores() } },
      modelResolver: createMockModelResolver({}),
    });
    try {
      runtimeRef = await state.getRuntime();
      const drained = await runAction({
        orgId: DEFAULT_ORG_ID,
        flow: flowRef,
        actionName: "drain",
        input: {},
        userId: USER_ID,
        sessionId: "s_worker",
        stores: runtimeRef.stores,
        runtimeConfig: { ...runtimeRef.runtimeConfig },
      });
      expect(drained.error).toBeUndefined();
      await started;

      expect(seen.inWorker).toBe("t1");
      expect(seen.inStarted).toBeNull();
      expect(seen.taskTurn).toBe(false);
    } finally {
      await state.dispose();
    }
  });
});
