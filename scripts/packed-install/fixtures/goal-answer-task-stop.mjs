/**
 * Runs inside the consumer project for `onepath.answer-task-stop`: installed
 * React's `useApproval`, rendered under jsdom, approves a `user_approval` stop
 * that a task-board run raised, and the stop is answered.
 *
 * The host is a real engine in this process (`createFlowState` over in-memory
 * stores, durable), reached through the installed engine's
 * `createInProcessFetch` as `<FlowProvider fetcher>`, the wiring the React
 * README gives for an engine in the same process. Its flow's board hands its
 * one row to the flow's `task` entry through a `dispatcher({ type: "task" })`,
 * so the stop sits in a request whose source is `task`, not one a user
 * started. That entry's handler calls `ctx.suspendForUser({ kind: "approval" })`.
 *
 * The hook gets the stop as a screen does, as the `suspension` item of the
 * task's run, and is rendered alone (no `SuspensionResolverProvider`), so it
 * answers through its own client call. Its `approve` is clicked once.
 *
 * The verdict reads what the engine recorded, never which route the hook
 * posted to: the stop's record (resolved `approved`, through the task run's
 * `suspension_resume` item, or its suspension record while that is kept), the
 * task run's status (`completed`), and the handler's own report that
 * `suspendForUser` came back approved. The hook's `error` is reported beside a
 * failure, as what the screen would show.
 *
 * Prints `answer-task-stop: ok`, or `answer-task-stop: FAIL at <step>: …`.
 * A leg that could not ask (the board's start refused, no stop raised, the
 * hook never rendered, a record it cannot read) prints no verdict and exits 1,
 * so the runner reports `error` and a broken fixture never reads as the
 * expected fail.
 */
import { JSDOM } from "jsdom";

// The DOM goes up before React loads: react-dom reads `window` as it evaluates.
const dom = new JSDOM("<!doctype html><html><body><div id=root></div></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;

const { createElement, useEffect } = await import("react");
const { createRoot } = await import("react-dom/client");
const { FlowProvider, useApproval } = await import("@flow-state-dev/react");
const { defineFlow, dispatcher, handler } = await import("@flow-state-dev/core");
const { createFlowState, createInProcessFetch, inMemoryStores } = await import("@flow-state-dev/engine");
const { taskBoard, taskWorkerInputSchema } = await import("@flow-state-dev/orchestration/task-board");
const { defineTaskCollection } = await import("@flow-state-dev/orchestration/tasks");
const { taskSettledEntry } = await import("@flow-state-dev/orchestration");
const { z } = await import("zod");

const KIND = "goal-answer-task-stop";
const USER = "goal-user";
const SESSION = "goal-answer-task-stop-session";
const PROMPT = "Ship the draft?";

const verdict = (line, detail = []) => {
  console.log(line);
  for (const l of detail) console.log(`  ${l}`);
  process.exit(0);
};
/** The leg could not ask: no verdict, so the runner reports `error`. */
const broken = (why) => {
  console.error(why);
  process.exit(1);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, ms) {
  for (const deadline = Date.now() + ms; Date.now() < deadline; await sleep(50)) {
    const v = await check();
    if (v) return v;
  }
  return check();
}

/** What `suspendForUser` came back with, each time the task's handler got past it. */
const answers = [];

const work = handler({
  name: "goal-answer-task-stop-work",
  inputSchema: taskWorkerInputSchema,
  outputSchema: z.object({ approved: z.boolean() }),
  execute: async (_task, ctx) => {
    const asked = await ctx.suspendForUser({ kind: "approval", prompt: PROMPT });
    answers.push(asked);
    return { approved: asked?.approved === true };
  },
});

const board = taskBoard({
  name: "goal-answer-task-stop-board",
  boardId: "goal-answer-task-stop-board",
  mode: "delegation",
  // User-scoped, so the task's own session reaches the row its board filed.
  collection: defineTaskCollection({ id: "goal-answer-task-stop-ledger", scope: "user" }),
  workers: {
    approver: dispatcher({ name: "goal-answer-task-stop-dispatch", type: "task", action: "work", session: "per-task" }),
  },
  initialTasks: [{ id: "t-approve", goal: "ask a person to approve", assignee: "approver", input: { note: "approve" } }],
});

const flow = defineFlow({
  kind: KIND,
  actions: { start: { block: board.drain } },
  task: { actions: { work: { block: work } } },
  // A board that hands rows out must hear how each ended; this one ignores it.
  internal: {
    actions: {
      onTaskSettled: taskSettledEntry({
        block: handler({ name: "goal-answer-task-stop-heard", inputSchema: z.unknown(), outputSchema: z.unknown(), execute: () => ({}) }),
      }),
    },
  },
})({ id: KIND });

// `durable: true` keeps stops over in-memory stores; without it `suspendForUser`
// throws for want of durable execution, on any version.
const flowState = createFlowState({
  flows: [flow],
  stores: { default: { primary: inMemoryStores() } },
  durable: true,
});
const fetcher = createInProcessFetch(flowState);
const runtime = await flowState.getRuntime();

// The board's run: a user starts it, and it hands the row to a task run.
const started = await fetcher(`http://localhost/api/flows/${KIND}/actions/start`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ userId: USER, sessionId: SESSION, input: {} }),
});
if (!started.ok) broken(`the board's start was refused: ${started.status} ${(await started.text()).slice(0, 300)}`);

const taskRuns = async () =>
  (await runtime.stores.request.list({ flowKind: KIND, withItems: true })).filter((r) => r.source === "task");
const suspended = await until(async () => (await taskRuns()).find((r) => r.status === "suspended"), 20_000);
if (!suspended) {
  // No stop to answer is a broken fixture, not a fail: the leg could not ask.
  const seen = (await taskRuns()).map((r) => `${r.id} ${r.status}`).join(", ") || "none";
  broken(`the task run never stopped for the user; task runs: ${seen}`);
}
const item = (suspended.items ?? []).find((i) => i.type === "suspension");
if (!item) broken(`the suspended task run ${suspended.id} carries no suspension item`);

// The screen: useApproval alone, under the provider an app wraps its tree in.
let latest = null;
function Approver() {
  const approval = useApproval(item);
  useEffect(() => {
    latest = approval;
  });
  return null;
}
const root = createRoot(document.getElementById("root"));
root.render(createElement(FlowProvider, { flowKind: KIND, userId: USER, sessionId: suspended.sessionId, fetcher }, createElement(Approver)));
await until(() => latest !== null, 5_000);
// Never rendered (the provider or the hook threw, or React never committed) is
// a broken fixture: only a hook that rendered and offers no approve is a fail.
if (latest === null) broken("the Approver never rendered within 5s, so useApproval was never read");
if (!latest.canApprove) verdict("answer-task-stop: FAIL at render: useApproval offers no approve for the stop");
latest.approve();
// Settled: the click's call came back, answered or refused.
await until(() => latest.isResolving === false && (latest.resolved || latest.error !== null), 10_000);
const hookError = latest.error;

// What the engine recorded: the run's status, the stop's resolution, and what
// the handler got back.
const run = await until(async () => {
  const r = await runtime.stores.request.get(suspended.id);
  return r && r.status !== "suspended" && r.status !== "running" ? r : null;
}, 10_000) ?? (await runtime.stores.request.get(suspended.id));
if (!run) broken(`the task run ${suspended.id} is gone from the request store`);
const runItems = (await taskRuns()).find((r) => r.id === suspended.id)?.items ?? [];
const resume = runItems.find((i) => i.type === "suspension_resume" && i.suspensionId === item.suspensionId);
// The suspension store the durability provider reads. A store that throws is
// a record the leg cannot read: it crashes to `error` rather than defaulting
// the stop to "pending".
const kept = resume ? null : await runtime.stores.suspensions.get(suspended.id, item.suspensionId);
// `resolution` is the stop's own status vocabulary; the item's `status` is the item's.
if (!resume && !kept) broken(`the stop ${item.suspensionId} has neither a resume item nor a suspension record`);
const stopStatus = resume ? resume.resolution : kept.status;

root.unmount();
const failures = [];
if (stopStatus !== "approved") failures.push(`the stop reads ${JSON.stringify(stopStatus)}, not "approved"`);
if (run.status !== "completed") failures.push(`the task run is ${JSON.stringify(run.status)}, not "completed"`);
if (!answers.some((a) => a?.approved === true)) failures.push("the task's handler never got an approved answer back from suspendForUser");
if (failures.length > 0)
  verdict(`answer-task-stop: FAIL at answer: ${failures[0]}`, [...failures.slice(1), `the hook shows: ${hookError ?? "no error"}`]);
verdict("answer-task-stop: ok");
