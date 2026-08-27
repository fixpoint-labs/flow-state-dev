/**
 * Park-exit's return trip, across real requests (FIX-1234).
 *
 * The whole point of `onReview: "exit"` is that the answer arrives *after* the
 * request that asked for it has ended. Every unit-level test of it drains twice
 * inside one request, which exercises the exclusion and the re-entry but not the
 * thing a reader actually has to get right: **which session the later drain runs
 * in.**
 *
 * That is not visible from the call. `createExecutionContext` defaults an absent
 * `sessionId` to a fresh `ephemeral_…` value, and that value is the `scopeId`
 * for session-scoped resource state — so a later drain that omits it resolves a
 * *different* ledger and never sees the parked row. It typechecks, it runs
 * without error, and it silently does nothing.
 *
 * Both tests run the same three requests and differ only in whether the final
 * drain names the session. The negative one is what makes the documented example
 * checkable rather than merely plausible.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { JsonObject } from "@flow-state-dev/core";
import type { BlockContext, ResourceCollectionRef } from "@flow-state-dev/core/types";
import { createInMemoryStores, runAction } from "@flow-state-dev/engine";
import type { StoreRegistry } from "@flow-state-dev/engine";
import {
  defineTaskCollection,
  getOrCreateTaskCollection,
  type TaskCollectionRef,
  type TaskWorkerInput,
} from "@flow-state-dev/orchestration/tasks";
import {
  taskBoard,
  taskWorkerInputSchema,
  TASK_BOARD_META_COMPONENT_TYPE,
} from "@flow-state-dev/orchestration/task-board";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { z } from "zod";

const USER_ID = "u_park_exit";
const SESSION_ID = "s_reviews";
const BOARD = "park-exit-across-requests";
const LEDGER_ID = `${BOARD}-ledger`;

/** No block here calls a model, but the context still builds a resolver. */
const baseRuntimeConfig = () => ({ modelResolver: createMockModelResolver({}) });

/**
 * How a worker reaches the rows of the board it is running under.
 *
 * Not through `board.capability`: the board does not exist until `taskBoard()`
 * returns, and the worker is an argument to that call, so the capability cannot
 * be in the worker's static `uses`. A dynamic `uses` does not help either —
 * dynamic entries contribute context and tools, not the `ctx.cap` accessor, so
 * `ctx.cap[BOARD]` reads `undefined` and the worker throws. (Measured: the task
 * settled `errored` with "Cannot read properties of undefined (reading
 * 'tasks')".)
 *
 * The drain declares the durable ledger as a resource on its own subtree, so any
 * block underneath it — the worker included — can resolve that resource and
 * build a ref over it. Both symbols below are public.
 */
function boardTasks(ctx: BlockContext): Promise<TaskCollectionRef> {
  return getOrCreateTaskCollection({
    ctx,
    backing: "resource",
    collectionId: LEDGER_ID,
    collection: ctx.resources[LEDGER_ID] as ResourceCollectionRef<JsonObject>,
  });
}

function buildFlow() {
  const ran: string[] = [];

  // SESSION-scoped deliberately: this is the scope where the later drain's
  // `sessionId` is load-bearing. A `user`- or `org`-scoped ledger spans every
  // session the principal touches, so it would hide the defect this file is
  // about.
  const ledger = defineTaskCollection({
    id: LEDGER_ID,
    scope: "session",
    stateSchema: z.object({ topic: z.string() }),
  });

  const worker = handler({
    name: `${BOARD}-worker`,
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.object({ ok: z.string() }),
    execute: async (input: TaskWorkerInput, ctx) => {
      const tasks = await boardTasks(ctx);
      // The human's answer arrives as `feedback` on the next attempt, so its
      // absence means nobody has looked at this yet.
      if (input.feedback === undefined) {
        await tasks.awaitReview(input.taskId, "does this look right?");
        return { ok: `${input.taskId}:parked` };
      }
      ran.push(`${input.taskId}:${input.feedback}`);
      return { ok: input.taskId };
    },
  });

  const board = taskBoard({
    name: BOARD,
    collection: ledger,
    concurrency: 1,
    dispatcher: "fifo",
    workers: worker,
    onReview: "exit",
    idlePollMs: 2,
    maxIterations: 20,
  });

  const seed = handler({
    name: `${BOARD}-seed`,
    inputSchema: z.unknown(),
    outputSchema: z.null(),
    uses: [board.capability],
    execute: async (_input, ctx) => {
      const tasks: TaskCollectionRef = await ctx.cap[BOARD].tasks();
      await tasks.addTask({ id: "ask", goal: "ask", input: { topic: "a" } });
      return null;
    },
  });

  const resume = handler({
    name: `${BOARD}-resume`,
    inputSchema: z.unknown(),
    outputSchema: z.null(),
    uses: [board.capability],
    execute: async (_input, ctx) => {
      const tasks: TaskCollectionRef = await ctx.cap[BOARD].tasks();
      await tasks.resumeFromReview("ask", "approved, carry on");
      return null;
    },
  });

  const inspect = handler({
    name: `${BOARD}-inspect`,
    inputSchema: z.unknown(),
    outputSchema: z.object({ status: z.string().nullable() }),
    uses: [board.capability],
    execute: async (_input, ctx) => {
      const tasks: TaskCollectionRef = await ctx.cap[BOARD].tasks();
      return { status: tasks.get("ask")?.status ?? null };
    },
  });

  const flow = defineFlow({
    kind: BOARD,
    actions: {
      seed: { block: seed },
      drain: { block: board.drain },
      resume: { block: resume },
      inspect: { block: inspect },
    },
  })({ id: BOARD });

  return { flow, ran };
}

/** The `terminationReason` on a run's board-meta item. */
function reasonOf(result: { items?: readonly unknown[] }): string | undefined {
  type MetaItem = { type?: string; component?: string; data?: unknown };
  const meta = ((result.items ?? []) as MetaItem[]).find(
    (i) => i.type === "component" && i.component === TASK_BOARD_META_COMPONENT_TYPE
  );
  return (meta?.data as { terminationReason?: string } | undefined)?.terminationReason;
}

/** The flow's action names, so a typo is a compile error rather than a 404. */
type ActionName = "seed" | "drain" | "resume" | "inspect";

async function run(
  flow: ReturnType<typeof buildFlow>["flow"],
  stores: StoreRegistry,
  actionName: ActionName,
  sessionId: string | undefined
) {
  return runAction({
    flow,
    actionName,
    input: {},
    userId: USER_ID,
    ...(sessionId === undefined ? {} : { sessionId }),
    stores,
    runtimeConfig: baseRuntimeConfig(),
  });
}

/** Requests 1-3: seed, drain (parks and returns), answer the review. */
async function parkAndAnswer(): Promise<{
  flow: ReturnType<typeof buildFlow>["flow"];
  ran: string[];
  stores: StoreRegistry;
}> {
  const { flow, ran } = buildFlow();
  const stores = createInMemoryStores();

  const seeded = await run(flow, stores, "seed", SESSION_ID);
  expect(seeded.error).toBeUndefined();

  const first = await run(flow, stores, "drain", SESSION_ID);
  expect(first.error).toBeUndefined();
  // The launching request ended with the row still parked — the feature.
  expect(reasonOf(first)).toBe("parked-for-review");
  expect(ran).toEqual([]);

  const answered = await run(flow, stores, "resume", SESSION_ID);
  expect(answered.error).toBeUndefined();

  return { flow, ran, stores };
}

describe("park-exit: the later drain has to run in the same session", () => {
  it("reaches the resumed task when the drain names the session", async () => {
    const { flow, ran, stores } = await parkAndAnswer();

    const second = await run(flow, stores, "drain", SESSION_ID);

    expect(second.error).toBeUndefined();
    // The row was claimed, the worker saw the human's answer, and the board
    // drained. The documented round trip, across four real requests.
    expect(ran).toEqual(["ask:approved, carry on"]);
    expect(reasonOf(second)).toBe("all-completed");

    const after = await run(flow, stores, "inspect", SESSION_ID);
    expect((after.output as { status: string | null }).status).toBe("completed");
  });

  it("silently drains a different, empty ledger when the drain omits the session", async () => {
    // The negative arm, and the reason the documented example passes
    // `sessionId`. Omitting it is not a type error and not a runtime error: the
    // context mints a fresh `ephemeral_…` session, the session-scoped ledger
    // resolves against THAT scope, and the drain finds an empty board.
    const { flow, ran, stores } = await parkAndAnswer();

    const stray = await run(flow, stores, "drain", undefined);

    expect(stray.error).toBeUndefined();
    // It "succeeded" — on a board with nothing on it.
    expect(reasonOf(stray)).toBe("all-completed");
    // The work was never reached.
    expect(ran).toEqual([]);

    // And the real row is still sitting where the answer left it.
    const after = await run(flow, stores, "inspect", SESSION_ID);
    expect((after.output as { status: string | null }).status).toBe("pending");
  });
});
