/**
 * Park-exit's return trip, across real requests (FIX-1234, FIX-1244).
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
 * The first describe block keeps the hand-rolled two-step (re-queue, then a
 * separate drain) and its negative arm. The second is FIX-1244's goal check:
 * the answer arrives through `board.unparkAndDrain` in one later request and
 * the work finishes — asserted on the row's own trace and status, never on the
 * board's report, which the negative arm already shows an empty ledger can
 * pass. It also pins the two wrong-ledger shapes, the stale-basis refusal, and
 * containment after an unpark.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import type { JsonObject } from "@flow-state-dev/core";
import type { BlockContext, ResourceCollectionRef } from "@flow-state-dev/core/types";
import { createInMemoryStores, runAction } from "@flow-state-dev/engine";
import type { StoreRegistry } from "@flow-state-dev/engine";
import {
  defineTaskCollection,
  getOrCreateTaskCollection,
  type TaskCollectionRef,
  type TaskWorkerInput,
  type TaskWriteOutcome,
} from "@flow-state-dev/orchestration/tasks";
import {
  taskBoard,
  taskWorkerInputSchema,
  unparkAndDrainInputSchema,
  TASK_BOARD_META_COMPONENT_TYPE,
} from "@flow-state-dev/orchestration/task-board";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { z } from "zod";

const USER_ID = "u_park_exit";
const SESSION_ID = "s_reviews";
const OTHER_SESSION_ID = "s_reviews_other";
const BOARD = "park-exit-across-requests";
const LEDGER_ID = `${BOARD}-ledger`;

/** No block here calls a model, but the context still builds a resolver. */
const baseRuntimeConfig = () => ({ modelResolver: createMockModelResolver({}) });

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}
function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

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
  /** Handshake for the stale-basis request: it has resolved the ledger; the park has landed. */
  const gate = { resolved: deferred(), parked: deferred() };

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
      // absence means nobody has looked at this yet. Only `ask` asks; a sibling
      // just does its work.
      if (input.taskId === "ask" && input.feedback === undefined) {
        await tasks.awaitReview(input.taskId, "does this look right?");
        return { ok: `${input.taskId}:parked` };
      }
      ran.push(`${input.taskId}:${input.feedback ?? "-"}`);
      // The containment trigger: settle this row out from under the worker
      // holding it and return normally, the way a coordinator cancelling
      // mid-flight does.
      if (input.feedback === "poison") {
        await tasks.cancel(input.taskId, "settled mid-flight");
      }
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
      await tasks.unpark("ask", "approved, carry on");
      return null;
    },
  });

  const inspect = handler({
    name: `${BOARD}-inspect`,
    inputSchema: z.object({ taskId: z.string() }),
    outputSchema: z.object({ status: z.string().nullable() }),
    uses: [board.capability],
    execute: async (input, ctx) => {
      const tasks: TaskCollectionRef = await ctx.cap[BOARD].tasks();
      return { status: tasks.get(input.taskId)?.status ?? null };
    },
  });

  // A sibling the answering request adds ahead of the drain it runs, so that
  // drain has a second row to keep running after the resumed one is settled
  // out from under its worker.
  const addSibling = handler({
    name: `${BOARD}-add-sibling`,
    inputSchema: unparkAndDrainInputSchema,
    outputSchema: z.null(),
    uses: [board.capability],
    execute: async (_input, ctx) => {
      const tasks: TaskCollectionRef = await ctx.cap[BOARD].tasks();
      await tasks.addTask({ id: "other", goal: "other", input: { topic: "o" } });
      return null;
    },
  });

  // The stale-basis request: resolve the ledger, hold, and answer only once a
  // park has landed in a request that started after this one's basis was read.
  const staleAnswer = handler({
    name: `${BOARD}-stale-answer`,
    inputSchema: z.unknown(),
    outputSchema: z.object({ outcome: z.string(), status: z.string().optional() }),
    uses: [board.capability],
    execute: async (_input, ctx) => {
      const tasks: TaskCollectionRef = await ctx.cap[BOARD].tasks();
      gate.resolved.resolve();
      await gate.parked.promise;
      const outcome: TaskWriteOutcome = await tasks.unpark("ask", "late");
      return outcome.outcome === "declined"
        ? { outcome: outcome.outcome, status: outcome.status }
        : { outcome: outcome.outcome };
    },
  });

  const flow = defineFlow({
    kind: BOARD,
    actions: {
      seed: { block: seed },
      drain: { block: board.drain },
      resume: { block: resume },
      inspect: { block: inspect },
      answer: { block: board.unparkAndDrain },
      "answer-with-sibling": {
        block: sequencer({ name: `${BOARD}-answer-with-sibling`, inputSchema: unparkAndDrainInputSchema })
          .tap(addSibling)
          .step(board.unparkAndDrain),
      },
      "stale-answer": { block: staleAnswer },
    },
  })({ id: BOARD });

  return { flow, ran, gate };
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
type ActionName =
  | "seed"
  | "drain"
  | "resume"
  | "inspect"
  | "answer"
  | "answer-with-sibling"
  | "stale-answer";

async function run(
  flow: ReturnType<typeof buildFlow>["flow"],
  stores: StoreRegistry,
  actionName: ActionName,
  sessionId: string | undefined,
  input: JsonObject = {}
) {
  return runAction({
    flow,
    actionName,
    input,
    userId: USER_ID,
    ...(sessionId === undefined ? {} : { sessionId }),
    stores,
    runtimeConfig: baseRuntimeConfig(),
  });
}

async function statusOf(
  flow: ReturnType<typeof buildFlow>["flow"],
  stores: StoreRegistry,
  sessionId: string,
  taskId = "ask"
): Promise<string | null> {
  const after = await run(flow, stores, "inspect", sessionId, { taskId });
  expect(after.error).toBeUndefined();
  return (after.output as { status: string | null }).status;
}

/** Requests 1-2 in `sessionId`: seed, then drain — which parks `ask` and returns. */
async function park(
  flow: ReturnType<typeof buildFlow>["flow"],
  stores: StoreRegistry,
  ran: string[],
  sessionId: string
): Promise<void> {
  const seeded = await run(flow, stores, "seed", sessionId);
  expect(seeded.error).toBeUndefined();

  const first = await run(flow, stores, "drain", sessionId);
  expect(first.error).toBeUndefined();
  // The launching request ended with the row still parked — the feature.
  expect(reasonOf(first)).toBe("parked-for-review");
  expect(ran).toEqual([]);
  expect(await statusOf(flow, stores, sessionId)).toBe("parked");
}

/** Requests 1-3: seed, drain (parks and returns), answer the review by hand. */
async function parkAndAnswer(): Promise<{
  flow: ReturnType<typeof buildFlow>["flow"];
  ran: string[];
  stores: StoreRegistry;
}> {
  const { flow, ran } = buildFlow();
  const stores = createInMemoryStores();

  await park(flow, stores, ran, SESSION_ID);

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

    expect(await statusOf(flow, stores, SESSION_ID)).toBe("completed");
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
    expect(await statusOf(flow, stores, SESSION_ID)).toBe("pending");
  });
});

describe("unparkAndDrain: the answer arrives on a later request and the work finishes", () => {
  it("re-queues the parked task and runs it to completion in the answering request", async () => {
    // The goal check. The verdict is the row's own trace and status; the
    // board's `terminationReason` is deliberately not the evidence, because the
    // negative arm above shows an empty ledger reporting `all-completed`.
    const { flow, ran } = buildFlow();
    const stores = createInMemoryStores();
    await park(flow, stores, ran, SESSION_ID);

    const answered = await run(flow, stores, "answer", SESSION_ID, {
      taskId: "ask",
      feedback: "approved, carry on",
    });

    expect(answered.error).toBeUndefined();
    expect(answered.output).toEqual({ outcome: "recorded" });
    expect(ran).toEqual(["ask:approved, carry on"]);
    expect(await statusOf(flow, stores, SESSION_ID)).toBe("completed");
  });

  it("throws when the answering request resolves a ledger that lacks the task", async () => {
    // The first wrong-ledger shape: the request omits the session, resolves a
    // fresh empty ledger, and the id is not there. A throw, not a drained board.
    const { flow, ran } = buildFlow();
    const stores = createInMemoryStores();
    await park(flow, stores, ran, SESSION_ID);

    const stray = await run(flow, stores, "answer", undefined, {
      taskId: "ask",
      feedback: "approved, carry on",
    });

    expect(stray.error).toBeDefined();
    expect(stray.error?.message).toMatch(/task "ask" not found/);
    expect(ran).toEqual([]);
    expect(await statusOf(flow, stores, SESSION_ID)).toBe("parked");
  });

  it("KNOWN GAP: lands on another session's same-id parked row, with no error, when the request names that session", async () => {
    // The second wrong-ledger shape, pinned as it is rather than as it should
    // be. Park-exit boards carry hand-authored stable ids, so two sessions
    // parked at the same step is the normal shape. The lookup is by bare id
    // inside the resolved scope and the fence passes because that row really
    // is parked — nothing about the answer says which ledger it was meant for.
    const { flow, ran } = buildFlow();
    const stores = createInMemoryStores();
    await park(flow, stores, ran, SESSION_ID);
    await park(flow, stores, ran, OTHER_SESSION_ID);

    // Meant for SESSION_ID's `ask`; sent against the other session.
    const misdirected = await run(flow, stores, "answer", OTHER_SESSION_ID, {
      taskId: "ask",
      feedback: "approved, carry on",
    });

    expect(misdirected.error).toBeUndefined();
    expect(misdirected.output).toEqual({ outcome: "recorded" });
    // The other session's work ran with this answer ...
    expect(ran).toEqual(["ask:approved, carry on"]);
    expect(await statusOf(flow, stores, OTHER_SESSION_ID)).toBe("completed");
    // ... and the intended one is still waiting.
    expect(await statusOf(flow, stores, SESSION_ID)).toBe("parked");
  });

  it("refuses a second answer to the same question, and drains nothing", async () => {
    const { flow, ran } = buildFlow();
    const stores = createInMemoryStores();
    await park(flow, stores, ran, SESSION_ID);

    // The first answer lands but is not drained — the hand-rolled re-queue.
    const first = await run(flow, stores, "resume", SESSION_ID);
    expect(first.error).toBeUndefined();
    expect(await statusOf(flow, stores, SESSION_ID)).toBe("pending");

    const second = await run(flow, stores, "answer", SESSION_ID, {
      taskId: "ask",
      feedback: "on second thought, no",
    });

    expect(second.error).toBeUndefined();
    expect(second.output).toEqual({ outcome: "declined", reason: "disallowed", status: "pending" });
    // No drain ran on the decline: the queued work is still queued.
    expect(ran).toEqual([]);
    expect(await statusOf(flow, stores, SESSION_ID)).toBe("pending");
  });

  it("a request holding a basis from before the park refuses the parked task — a false refusal, never a false acceptance", async () => {
    // Two contexts over one durable board on the in-memory store, whose CAS
    // holds across them. The stale request resolved the ledger while `ask` was
    // still `pending`; the park then lands in a request that started later. The
    // stale request's answer is judged against its own basis, so it is refused
    // naming `pending` — the one error the design cannot rule out, and it is
    // safe: nothing is written, and a delivery on a later request is accepted.
    const { flow, ran, gate } = buildFlow();
    const stores = createInMemoryStores();
    const seeded = await run(flow, stores, "seed", SESSION_ID);
    expect(seeded.error).toBeUndefined();

    const stale = run(flow, stores, "stale-answer", SESSION_ID);
    await gate.resolved.promise;

    const first = await run(flow, stores, "drain", SESSION_ID);
    expect(first.error).toBeUndefined();
    expect(reasonOf(first)).toBe("parked-for-review");
    gate.parked.resolve();

    const refused = await stale;
    expect(refused.error).toBeUndefined();
    expect(refused.output).toEqual({ outcome: "declined", status: "pending" });
    // The genuinely parked row is untouched by the refusal.
    expect(await statusOf(flow, stores, SESSION_ID)).toBe("parked");

    // The prescribed recovery: deliver again on a later request, whose basis
    // includes the park.
    const answered = await run(flow, stores, "answer", SESSION_ID, {
      taskId: "ask",
      feedback: "approved, carry on",
    });
    expect(answered.error).toBeUndefined();
    expect(answered.output).toEqual({ outcome: "recorded" });
    expect(ran).toEqual(["ask:approved, carry on"]);
    expect(await statusOf(flow, stores, SESSION_ID)).toBe("completed");
  });

  it("keeps the board's siblings running when the resumed row is settled out from under its worker", async () => {
    // Containment (epic decision 5), after an unpark as before one: the resumed
    // worker's write-back lands on a row already cancelled, and that must not
    // abandon the sibling the answering request also queued.
    const { flow, ran } = buildFlow();
    const stores = createInMemoryStores();
    await park(flow, stores, ran, SESSION_ID);

    const answered = await run(flow, stores, "answer-with-sibling", SESSION_ID, {
      taskId: "ask",
      feedback: "poison",
    });

    expect(answered.error).toBeUndefined();
    expect(answered.output).toEqual({ outcome: "recorded" });
    expect(ran).toEqual(["ask:poison", "other:-"]);
    expect(await statusOf(flow, stores, SESSION_ID, "ask")).toBe("cancelled");
    expect(await statusOf(flow, stores, SESSION_ID, "other")).toBe("completed");
  });
});
