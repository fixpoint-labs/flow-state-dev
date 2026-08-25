/**
 * LAB-139 spec POC — the ask-and-answer round trip, on the board LAB-139 inherits.
 *
 * THROWAWAY. Lives on the never-merged `spec/LAB-139` branch. Not reviewed as code.
 *
 * ## The premise being checked
 *
 * The epic-spec's theme 5 carries a measured table whose first row reads:
 * "`awaitReview` + normal return → row stomped to `completed` in the same request —
 * the question is lost." Every design decision downstream of that row was made to
 * route around it. FIX-1234 (park-exit) merged into `main` on 2026-08-25 and its
 * `record-result.ts` now reads the row's status before it settles, so that row may
 * no longer be true. Nobody has run it on the shape LAB-139 actually inherits from
 * LAB-138: a DETACHED worker on a USER-scoped durable ledger.
 *
 * So this script runs exactly that shape and prints what it observes. It does not
 * assert a hoped-for answer — the output is the finding.
 *
 * Six measurements, in one run:
 *   M1  does a detached worker's own `awaitReview` survive the runner's fenced
 *       write-back, or is the row settled `completed` on the normal return?
 *   M2  what does a later drain do while the row sits parked, with `onReview: "exit"`?
 *   M3  can a coordinator request — holding no claim ticket — answer it?
 *   M4  does the answered row reach the worker again, in a NEW detached dispatch?
 *   M5  does answering a question spend a claim, i.e. an attempt of the retry budget?
 *   M6  does `resumeFromReview(id)` with no feedback CLEAR a previous failure's
 *       feedback, or leave it to leak into the resumed attempt's prompt?
 *   M7  control: the same round trip on a board that left `onReview` at its default.
 *
 * ## Shape
 *
 * Modelled on `packages/integration-tests/src/scenarios/task-board-detached-handoff.test.ts`,
 * which is the only committed thing that drives a detached board end to end. The
 * host's `startOperation` RECORDS the dispatch envelope and starts nothing, so the
 * child cannot finish early and every "the parent returned first" reading is
 * structural rather than a race. Each recorded envelope is then replayed through
 * `source: "workstream"`, which is what the real host would have done.
 *
 * Run:  pnpm tsx spec-poc/LAB-139-ask-and-answer/round-trip.mts
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import type { BlockContext, ResourceCollectionRef } from "@flow-state-dev/core/types";
import type { JsonObject } from "@flow-state-dev/core";
import { createInMemoryStores, runAction } from "@flow-state-dev/engine";
import type { StoreRegistry } from "@flow-state-dev/engine";
import {
  defineTaskCollection,
  getOrCreateTaskCollection,
  type Task,
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

const USER_ID = "u_lab139";
const COORDINATOR_SESSION = "s_conductor";
/** `resolveActionCore` treats this as terminal and resolves the flow's workstream core. */
const WORKSTREAM_SOURCE = "workstream";

const baseRuntimeConfig = () => ({ modelResolver: createMockModelResolver({}) });

/** One line per measurement, so the framework's own logging cannot bury it. */
function say(label: string, data: unknown): void {
  console.log(`\n>>> ${label}: ${JSON.stringify(data)}\n`);
}

type RecordedDispatch = { sessionId: string; actionName: string; input: unknown };

/** What the worker did on each visit — the only evidence it ran at all. */
type Visit = { attempts: number; feedback: string | undefined; parked: boolean };

/**
 * Build a conductor-shaped board: detached worker, durable user-scoped ledger,
 * explicit boardId. `onReview` is the only axis that varies between subject and
 * control, so anything that differs is attributable to it and to nothing else.
 */
function buildFlow(options: { kind: string; onReview: "hold" | "exit" }) {
  const LEDGER_ID = `${options.kind}-ledger`;
  const visits: Visit[] = [];

  /**
   * How a worker reaches the rows of the board it runs under. NOT through
   * `board.capability` — the board does not exist when the worker is declared.
   * The drain declares the ledger as a resource on its own subtree, so any block
   * beneath it can build a ref over it. (Both symbols are public.)
   */
  function boardTasks(ctx: BlockContext): Promise<TaskCollectionRef> {
    return getOrCreateTaskCollection({
      ctx,
      backing: "resource",
      collectionId: LEDGER_ID,
      collection: ctx.resources[LEDGER_ID] as ResourceCollectionRef<JsonObject>,
    });
  }

  /**
   * Stands in for LAB-138's manager. First visit: it "needs a decision", so it
   * parks its own row and returns normally — the exact combination the epic's
   * table says loses the question. Second visit: it sees the answer and finishes.
   */
  const manager = handler({
    name: `${options.kind}-manager`,
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.object({ done: z.string() }),
    execute: async (input: TaskWorkerInput, ctx) => {
      const tasks = await boardTasks(ctx);
      const answered = input.feedback !== undefined && input.feedback.startsWith("ANSWER:");
      visits.push({ attempts: input.attempts, feedback: input.feedback, parked: !answered });
      if (!answered) {
        await tasks.awaitReview(input.taskId, "which option should I take?");
        return { done: "parked" };
      }
      return { done: `finished-on:${input.feedback}` };
    },
  });

  const board = taskBoard({
    name: `${options.kind}-board`,
    boardId: `${options.kind}-board`,
    // The LAB-138 shape: durable, user-scoped, no `sharedToWorkstream`.
    collection: defineTaskCollection({ id: LEDGER_ID, scope: "user" }),
    workers: { manager: { worker: manager, dispatch: { mode: "detached" } } },
    onReview: options.onReview,
    // Small, so the control arm's hold is visibly a hold rather than a hang.
    maxIterations: 6,
    idlePollMs: 5,
    initialTasks: [
      {
        // Explicit id: park-exit refuses an id-less initialTask at construction.
        id: "issue-1",
        goal: "drive FIX-1166 to a PR",
        assignee: "manager",
        // A detached board requires `input` — `packWorkerInput` copies it
        // unconditionally and the spawn's JSON-safety gate rejects `undefined`.
        input: { issue: "FIX-1166" },
        maxAttempts: 3,
      },
    ],
  });

  /** The operator's answer. No claim ticket — a coordinator never claimed the row. */
  const answer = handler({
    name: `${options.kind}-answer`,
    inputSchema: z.object({ feedback: z.string().optional() }),
    outputSchema: z.object({ outcome: z.string(), reason: z.string().nullable() }),
    uses: [board.capability],
    execute: async (input: { feedback?: string }, ctx) => {
      const tasks: TaskCollectionRef = await ctx.cap[`${options.kind}-board`].tasks();
      const verdict = await tasks.resumeFromReview("issue-1", input.feedback);
      return {
        outcome: verdict.outcome,
        reason: verdict.outcome === "declined" ? verdict.reason : null,
      };
    },
  });

  /** Put a failure's feedback on the row without running the worker (M6 setup). */
  const stampFeedback = handler({
    name: `${options.kind}-stamp-feedback`,
    inputSchema: z.object({ text: z.string() }),
    outputSchema: z.null(),
    uses: [board.capability],
    execute: async (input: { text: string }, ctx) => {
      const tasks: TaskCollectionRef = await ctx.cap[`${options.kind}-board`].tasks();
      await tasks.awaitReview("issue-1", input.text);
      return null;
    },
  });

  const flow = defineFlow({
    kind: options.kind,
    actions: {
      drain: { block: board.drain },
      answer: { block: answer },
      stampFeedback: { block: stampFeedback },
    },
  })({ id: options.kind });

  return { flow, visits, LEDGER_ID };
}

/** The durable row, read from the store rather than through any live ref. */
async function row(
  stores: StoreRegistry,
  ledgerId: string,
  taskId = "issue-1"
): Promise<Task | undefined> {
  const found = await stores.resourceState.get("user", USER_ID, `${ledgerId}/${taskId}`);
  return found?.state as Task | undefined;
}

/** The board's own completion item, off a run's emitted items. */
function boardMeta(items: readonly unknown[]): { terminationReason: string } | undefined {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i] as { type?: string; component?: string; data?: unknown };
    if (item.type !== "component" || item.component !== TASK_BOARD_META_COMPONENT_TYPE) continue;
    const data = item.data as { status?: string; terminationReason?: string };
    if (data.status !== "completed") continue;
    return { terminationReason: data.terminationReason ?? "" };
  }
  return undefined;
}

async function runOne(
  flow: ReturnType<typeof buildFlow>["flow"],
  stores: StoreRegistry,
  actionName: string,
  input: unknown,
  extra: { sessionId: string; source?: string; dispatched?: RecordedDispatch[] }
) {
  const requestHost =
    extra.dispatched === undefined
      ? undefined
      : {
          // Records and returns. Nothing is started, so a child cannot finish early.
          startOperation: async (spec: { sessionId: string; actionName: string; input: unknown }) => {
            extra.dispatched!.push({
              sessionId: spec.sessionId,
              actionName: spec.actionName,
              input: spec.input,
            });
            return { requestId: `child_req_${extra.dispatched!.length}` };
          },
        };
  return runAction({
    flow,
    actionName: actionName as never,
    input: input as never,
    userId: USER_ID,
    sessionId: extra.sessionId,
    ...(extra.source === undefined ? {} : { source: extra.source as never }),
    stores,
    runtimeConfig: { ...baseRuntimeConfig(), ...(requestHost ? { requestHost } : {}) } as never,
  });
}

/** Replay a recorded dispatch envelope the way the real host would. */
async function replay(
  flow: ReturnType<typeof buildFlow>["flow"],
  stores: StoreRegistry,
  d: RecordedDispatch
) {
  return runOne(flow, stores, d.actionName, d.input, {
    sessionId: d.sessionId,
    source: WORKSTREAM_SOURCE,
  });
}

async function subject() {
  console.log("\n================ SUBJECT — onReview: \"exit\" ================\n");
  const stores = createInMemoryStores();
  const { flow, visits, LEDGER_ID } = buildFlow({ kind: "lab139exit", onReview: "exit" });
  const dispatched: RecordedDispatch[] = [];

  // 1. The launching drain. Claims, hands off, returns.
  const launch = await runOne(flow, stores, "drain", {}, {
    sessionId: COORDINATOR_SESSION,
    dispatched,
  });
  say("launch drain", {
    error: launch.error === undefined ? "none" : String(launch.error),
    terminationReason: boardMeta(launch.items)?.terminationReason,
    dispatches: dispatched.length,
    row: (await row(stores, LEDGER_ID))?.status,
  });

  // 2. THE MEASUREMENT (M1). The worker parks its own row and returns normally.
  const child1 = await replay(flow, stores, dispatched[0]!);
  const afterPark = await row(stores, LEDGER_ID);
  say("M1 after park", {
    childError: child1.error === undefined ? "none" : String(child1.error),
    rowStatus: afterPark?.status,
    attempts: afterPark?.attempts,
    feedback: afterPark?.feedback,
    visits,
  });
  console.log(
    afterPark?.status === "awaiting_review"
      ? "   -> the park SURVIVED the fenced write-back."
      : "   -> the park was LOST (epic theme 5, table row 1 still holds)."
  );

  // 3. M2. A wake drain while the row is parked.
  const parkedDrain = await runOne(flow, stores, "drain", {}, {
    sessionId: COORDINATOR_SESSION,
    dispatched,
  });
  say("M2 wake drain", {
    error: parkedDrain.error === undefined ? "none" : String(parkedDrain.error),
    terminationReason: boardMeta(parkedDrain.items)?.terminationReason,
    newDispatches: dispatched.length - 1,
    rowStatus: (await row(stores, LEDGER_ID))?.status,
  });

  // 4. M6. A previous failure's feedback is sitting on the row; does an answer
  //    that supplies none clear it, or does it leak into the resumed attempt?
  await runOne(flow, stores, "stampFeedback", { text: "STALE: attempt 1 hit the turn cap" }, {
    sessionId: COORDINATOR_SESSION,
  });
  const stamped = await row(stores, LEDGER_ID);
  const clearing = await runOne(flow, stores, "answer", {}, { sessionId: COORDINATOR_SESSION });
  const afterClear = await row(stores, LEDGER_ID);
  say("M6 clearing", {
    feedbackBefore: stamped?.feedback,
    resumeVerdict: clearing.output,
    feedbackAfter: afterClear?.feedback ?? "(absent)",
    rowStatus: afterClear?.status,
  });

  // Put it back in the parked state the operator actually answers from.
  await runOne(flow, stores, "stampFeedback", { text: "which option should I take?" }, {
    sessionId: COORDINATOR_SESSION,
  });

  // 5. M3. The operator answers, from a request holding no claim ticket.
  const answered = await runOne(
    flow,
    stores,
    "answer",
    { feedback: "ANSWER: take the second option" },
    { sessionId: COORDINATOR_SESSION }
  );
  const afterAnswer = await row(stores, LEDGER_ID);
  say("M3 answer", {
    verdict: answered.output,
    rowStatus: afterAnswer?.status,
    feedback: afterAnswer?.feedback,
    attempts: afterAnswer?.attempts,
  });

  // 6. M4 + M5. The answered row is claimed again and reaches the worker.
  const wake = await runOne(flow, stores, "drain", {}, {
    sessionId: COORDINATOR_SESSION,
    dispatched,
  });
  const newEnvelope = dispatched[dispatched.length - 1]!;
  const child2 = await replay(flow, stores, newEnvelope);
  const final = await row(stores, LEDGER_ID);
  say("M4 resumed run", {
    wakeError: wake.error === undefined ? "none" : String(wake.error),
    totalDispatches: dispatched.length,
    childError: child2.error === undefined ? "none" : String(child2.error),
    rowStatus: final?.status,
    output: final?.output,
    visits,
  });
  say("M5 budget", {
    attempts: final?.attempts,
    maxAttempts: final?.maxAttempts,
    abandonments: (final as { abandonments?: unknown } | undefined)?.abandonments ?? "(none)",
    note:
      "attempts is incremented at claim time; a resume goes through claim, and " +
      "abandonments are the only discount shouldRetryOnFail applies",
  });
}

async function control() {
  console.log("\n================ CONTROL — onReview default (\"hold\") ================\n");
  const stores = createInMemoryStores();
  const { flow, LEDGER_ID } = buildFlow({ kind: "lab139hold", onReview: "hold" });
  const dispatched: RecordedDispatch[] = [];

  await runOne(flow, stores, "drain", {}, { sessionId: COORDINATOR_SESSION, dispatched });
  await replay(flow, stores, dispatched[0]!);
  const parked = await row(stores, LEDGER_ID);
  say("after park", { rowStatus: parked?.status });

  const started = Date.now();
  const held = await runOne(flow, stores, "drain", {}, {
    sessionId: COORDINATOR_SESSION,
    dispatched,
  });
  say("M7 wake drain", {
    error: held.error === undefined ? "none" : String(held.error),
    terminationReason: boardMeta(held.items)?.terminationReason,
    wallClockMs: Date.now() - started,
    note: "maxIterations is 6 and idlePollMs is 5, so a hold shows as spent iterations",
  });
}

await subject();
await control();
console.log("\ndone.\n");
