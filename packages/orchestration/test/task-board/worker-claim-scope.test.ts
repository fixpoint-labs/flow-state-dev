/**
 * A claimed worker can read its own claim ticket, on both routes a worker is
 * run by: inline in a board's drain, and behind the claim gate of a hand-off.
 *
 * `currentWorkerClaim()` is what lets the model-facing task tools present
 * ownership without the model ever seeing a token, so a worker that cannot
 * read its ticket writes as if it were a coordinator — a write to a task it
 * does not hold lands instead of being refused. Nothing fails loudly when
 * that happens, which is why these tests read the seam from inside the
 * worker rather than inferring it from a settled row.
 *
 * The seam's failure mode is an `AsyncLocalStorage.enterWith` made after an
 * `await` in the setup tap: it then publishes to a continuation scope that
 * dies with the tap, and every later step reads `undefined`.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { createMockModelResolver, runForTest, testBlock } from "@flow-state-dev/testing";
import type { GeneratorTool } from "@flow-state-dev/core";
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
import { buildTaskToolsList } from "../../src/skills/task-tools-capability";
import { createFakeSequencerState } from "../helpers";

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

  it("is refused when a task tool writes to a task it does not hold", async () => {
    // The point of the seam: the tool presents the worker's ticket, so the
    // substrate refuses a write aimed at any other task. Without the ticket the
    // tool writes as a coordinator and the sibling task is cancelled.
    const collection = boardCollection("tool-claim");
    const cancelTask = buildTaskToolsList(async () => collection).find(
      (tool) => tool.config?.name === "cancelTask"
    ) as GeneratorTool;
    let toolResult: unknown;

    const worker = handler({
      name: "overreaching-worker",
      inputSchema: taskWorkerInputSchema,
      outputSchema: z.object({ done: z.boolean() }),
      execute: async (input, ctx) => {
        if (input.taskId === "mine") {
          toolResult = await runForTest(cancelTask, { taskId: "theirs" }, ctx);
        }
        return { done: true };
      },
    }) as TaskWorker;

    const board = taskBoard({
      name: "tool-claim-board",
      collection: () => collection,
      concurrency: 1,
      initialTasks: [
        { id: "mine", goal: "do my task", priority: 10 },
        { id: "theirs", goal: "someone else's task", priority: 0 },
      ],
      workers: worker,
    });

    const result = await testBlock(board.drain, { input: undefined });

    expect(result.error).toBeNull();
    expect(toolResult).toMatchObject({ ok: false, taskId: "theirs" });
    expect((toolResult as { error: string }).error).toContain('you hold task "mine"');
    // Refused, so the other task was left for its own worker to run.
    expect(collection.get("theirs")?.status).toBe("completed");
  });
});

describe("a handed-off worker behind the claim gate", () => {
  it("reads the claim ticket the gate minted for the handed-off row", async () => {
    const USER_ID = "u_claim_scope";
    const BOARD_ID = "claim-scope-board";
    const ledger = () => defineTaskCollection({ id: "claim-scope-ledger", scope: "user" });
    const seen: Array<TaskClaimTicket | undefined> = [];

    const recipientWorker = handler({
      name: "gated-claim-reader",
      inputSchema: taskWorkerInputSchema,
      outputSchema: z.object({ done: z.boolean() }),
      execute: async (_input, ctx) => {
        seen.push(currentWorkerClaim(ctx));
        return { done: true };
      },
    });
    const seat = (name: string, flowKind?: string) =>
      dispatcher<TaskWorkerInput>({
        name,
        ...(flowKind !== undefined ? { flowKind } : {}),
        action: "work",
        session: "per-task",
      });

    const recipient = defineFlow({
      kind: "claim-recipient",
      actions: {
        drain: {
          block: taskBoard({
            name: "claim-recipient-board",
            boardId: BOARD_ID,
            collection: ledger(),
            workers: { work: seat("claim-recipient-hand-off") },
          }).drain,
        },
      },
      task: { actions: { work: { block: recipientWorker } } },
    })({ id: "claim-recipient" });

    const sender = defineFlow({
      kind: "claim-sender",
      actions: {
        start: {
          block: taskBoard({
            name: "claim-sender-board",
            boardId: BOARD_ID,
            collection: ledger(),
            workers: { work: seat("claim-sender-hand-off", "claim-recipient") },
            initialTasks: [{ id: "t1", goal: "handed off", assignee: "work" }],
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

      for (let attempt = 0; attempt < 200 && seen.length === 0; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

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

    flowRef = defineFlow({
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
