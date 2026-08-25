/**
 * LAB-139 spec POC — the inbox row, and whether its write is replay-safe.
 *
 * THROWAWAY. Lives on the never-merged `spec/LAB-139` branch. Not reviewed as code.
 *
 * ## The premise being checked
 *
 * LAB-139 owns "the inbox row and its replay-safe write". Two things about that
 * were asserted from a code read and never run:
 *
 *   N1  Is a `user`-scoped resource collection declared on a DETACHED worker
 *       actually the same set the coordinator session reads? The inbox's whole
 *       premise is that it is — a question asked inside a workstream has to be
 *       answerable from the session a person talks to. `sharedToWorkstream` is
 *       session-scope-only, so nothing declares this sharing; it is supposed to
 *       fall out of user scope. Nobody has watched it.
 *   N2  Is `upsert(key, {}, createOnly)` genuinely create-only on the second
 *       call — including on a row a person has since ANSWERED? This is the
 *       replay-safety mechanism the spec proposes. A step with no committed
 *       output re-executes on recovery, so the ask step will run twice on the
 *       same attempt, and the failure it must not have is resetting an answered
 *       row back to open — the operator's answer silently discarded.
 *
 * The worker below writes the row THREE times in one visit — the same shape a
 * replayed step produces — and the coordinator answers in between.
 *
 * Run:  pnpm tsx spec-poc/LAB-139-ask-and-answer/inbox-write.mts
 */
import { defineFlow, defineResourceCollection, handler } from "@flow-state-dev/core";
import { createInMemoryStores, runAction } from "@flow-state-dev/engine";
import type { StoreRegistry } from "@flow-state-dev/engine";
import {
  defineTaskCollection,
  type TaskCollectionRef,
  type TaskWorkerInput,
} from "@flow-state-dev/orchestration/tasks";
import { taskBoard, taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { z } from "zod";

const USER_ID = "u_lab139_inbox";
const COORDINATOR_SESSION = "s_conductor";
const WORKSTREAM_SOURCE = "workstream";
const KIND = "lab139inbox";

function say(label: string, data: unknown): void {
  console.log(`\n>>> ${label}: ${JSON.stringify(data)}\n`);
}

/**
 * The inbox, shaped after `labs/knowledge-hub/src/inbox.ts` — a plain user-scoped
 * collection, not a new framework capability (LAB-68's standing rule).
 *
 * `status` is monotonic by intent: open → answered → withdrawn. Nothing here
 * enforces that; the write discipline does, which is exactly what N2 tests.
 */
const inboxCollection = defineResourceCollection({
  pattern: "inbox/**",
  scope: "user",
  flowIsolation: false,
  prefetchMode: "lazy",
  stateSchema: z.object({
    question: z.string(),
    askedBy: z.string(),
    askedAt: z.string(),
    status: z.enum(["open", "answered", "withdrawn"]).default("open"),
    answer: z.string().nullable().default(null),
  }),
});

const LEDGER_ID = `${KIND}-ledger`;
const observed: Array<Record<string, unknown>> = [];

/**
 * The ask step, deliberately run three times in one visit — what a replayed
 * step with no committed output does. The proposed write is create-only:
 * `update` is empty, so the patch branch has nothing to apply.
 */
async function ask(
  inbox: {
    upsert: (
      k: string,
      u: Record<string, unknown>,
      c?: Record<string, unknown>
    ) => Promise<{ state: Record<string, unknown>; path: string }>;
  },
  key: string,
  question: string
) {
  const ref = await inbox.upsert(
    key,
    {},
    { question, askedBy: "manager", askedAt: new Date().toISOString(), status: "open", answer: null }
  );
  return { path: ref.path, state: ref.state };
}

const manager = handler({
  name: `${KIND}-manager`,
  inputSchema: taskWorkerInputSchema,
  outputSchema: z.object({ done: z.string() }),
  resources: { inbox: inboxCollection },
  execute: async (input: TaskWorkerInput, ctx) => {
    // Bare topic — the collection prepends `inbox/` for you. Deterministic in
    // the attempt, so a replay produces the same key rather than a second row.
    const key = `FIX-1166/implement/${input.attempts}/q1`;
    const inbox = ctx.resources.inbox as never as Parameters<typeof ask>[0];

    const first = await ask(inbox, key, "which option should I take?");
    const replay = await ask(inbox, key, "which option should I take?");
    observed.push({
      visit: input.attempts,
      storageKey: first.path,
      firstStatus: first.state.status,
      replayStatus: replay.state.status,
      replayAnswer: replay.state.answer,
      identical: JSON.stringify(first.state) === JSON.stringify(replay.state),
    });
    return { done: `asked:${key}` };
  },
});

const board = taskBoard({
  name: `${KIND}-board`,
  boardId: `${KIND}-board`,
  collection: defineTaskCollection({ id: LEDGER_ID, scope: "user" }),
  workers: { manager: { worker: manager, dispatch: { mode: "detached" } } },
  onReview: "exit",
  maxIterations: 4,
  idlePollMs: 5,
  initialTasks: [
    { id: "issue-1", goal: "drive FIX-1166", assignee: "manager", input: { issue: "FIX-1166" } },
  ],
});

/** What the COORDINATOR session sees in the inbox — N1's whole question. */
const readInbox = handler({
  name: `${KIND}-read-inbox`,
  inputSchema: z.unknown(),
  outputSchema: z.object({ rows: z.array(z.record(z.unknown())) }),
  resources: { inbox: inboxCollection },
  execute: async (_input, ctx) => {
    const rows = await (ctx.resources.inbox as never as {
      list: (p?: string) => Promise<Array<{ path: string; state: Record<string, unknown> }>>;
    }).list("FIX-1166/");
    return { rows: rows.map((r) => ({ path: r.path, ...r.state })) };
  },
});

/** The operator answers, from the coordinator session. */
const answerInbox = handler({
  name: `${KIND}-answer-inbox`,
  inputSchema: z.object({ key: z.string(), answer: z.string() }),
  outputSchema: z.object({ status: z.string() }),
  resources: { inbox: inboxCollection },
  execute: async (input: { key: string; answer: string }, ctx) => {
    const ref = await (ctx.resources.inbox as never as {
      upsert: (k: string, u: Record<string, unknown>) => Promise<{ state: Record<string, unknown> }>;
    }).upsert(input.key, { status: "answered", answer: input.answer });
    return { status: String(ref.state.status) };
  },
});

/** Re-run the ask step against a row the operator has already answered. */
const replayAsk = handler({
  name: `${KIND}-replay-ask`,
  inputSchema: z.object({ key: z.string() }),
  outputSchema: z.object({ status: z.string(), answer: z.string().nullable() }),
  resources: { inbox: inboxCollection },
  execute: async (input: { key: string }, ctx) => {
    const after = await ask(
      ctx.resources.inbox as never as Parameters<typeof ask>[0],
      input.key,
      "which option should I take?"
    );
    return {
      status: String(after.state.status),
      answer: after.state.answer as string | null,
    };
  },
});

const flow = defineFlow({
  kind: KIND,
  actions: {
    drain: { block: board.drain },
    readInbox: { block: readInbox },
    answerInbox: { block: answerInbox },
    replayAsk: { block: replayAsk },
  },
})({ id: KIND });

type Dispatch = { sessionId: string; actionName: string; input: unknown };

async function run(
  stores: StoreRegistry,
  actionName: string,
  input: unknown,
  extra: { sessionId: string; source?: string; dispatched?: Dispatch[] }
) {
  const requestHost =
    extra.dispatched === undefined
      ? undefined
      : {
          startOperation: async (spec: { sessionId: string; actionName: string; input: unknown }) => {
            extra.dispatched!.push({
              sessionId: spec.sessionId,
              actionName: spec.actionName,
              input: spec.input,
            });
            return { requestId: `child_${extra.dispatched!.length}` };
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
    runtimeConfig: {
      modelResolver: createMockModelResolver({}),
      ...(requestHost ? { requestHost } : {}),
    } as never,
  });
}

const stores = createInMemoryStores();
const dispatched: Dispatch[] = [];

// The launching drain hands the row to a workstream and returns.
await run(stores, "drain", {}, { sessionId: COORDINATOR_SESSION, dispatched });

// The workstream runs the manager, which asks — twice, as a replay would.
const child = await run(stores, dispatched[0]!.actionName, dispatched[0]!.input, {
  sessionId: dispatched[0]!.sessionId,
  source: WORKSTREAM_SOURCE,
});
say("N2 write + immediate replay", {
  childError: child.error === undefined ? "none" : String(child.error),
  observed,
});

// N1: does the COORDINATOR session see what the workstream wrote?
const seen = await run(stores, "readInbox", {}, { sessionId: COORDINATOR_SESSION });
say("N1 coordinator read", {
  sessionOfWriter: dispatched[0]!.sessionId,
  sessionOfReader: COORDINATOR_SESSION,
  rows: (seen.output as { rows: unknown[] }).rows,
});

// The operator answers.
const key = "FIX-1166/implement/1/q1";
const answered = await run(stores, "answerInbox", { key, answer: "take the second option" }, {
  sessionId: COORDINATOR_SESSION,
});
say("operator answered", answered.output);

// N2's real case: the ask step re-executes AFTER the answer landed.
const afterAnswer = await run(stores, "replayAsk", { key }, { sessionId: COORDINATOR_SESSION });
say("N2 replay over an ANSWERED row", {
  ...(afterAnswer.output as object),
  verdict:
    (afterAnswer.output as { status: string }).status === "answered"
      ? "create-only write left the answer intact"
      : "THE ANSWER WAS RESET — create-only is not enough",
});

console.log("\ndone.\n");
