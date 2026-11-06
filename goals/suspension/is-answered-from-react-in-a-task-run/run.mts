/**
 * suspension › it is answered from React in a task run (FIX-2450).
 *
 * **Model-free.** A real `createFlowState` host on a SQLite store in this
 * process, reached by React's hooks through `createInProcessFetch`, rendered
 * by react-dom over a happy-dom document. Each run is started by its real
 * source: a task board's dispatch (`source: "task"`), a webhook binding
 * (`"webhook"`), or the user (`"http"`). Each stop is answered by a hook,
 * the way a screen does:
 *
 *   a  — a task's `ctx.suspendForUser({ kind: "approval" })`, approved through
 *        `useApproval` alone (no resolver provider).
 *   b  — the same kind of stop, approved through `useApproval` under
 *        `SuspensionResolverProvider` with `session.answerSuspension`; the
 *        continuation shows in the session's own items.
 *   c  — a task's `ctx.suspendForUser({ kind: "input" })`, submitted through
 *        `useSuspensionForm`.
 *   d  — a raw `ctx.suspend({ reason: "user_approval" })`, in a task's run and
 *        in a webhook's run, approved through `useApproval` alone.
 *   e  — a developer's own `ctx.suspend` with a custom reason, in the user's
 *        own run, approved from the same card: it must still complete.
 *
 * Every leg reads what the engine recorded (the stop's `suspension_resume`
 * item and the request's status), never the path a hook posted to.
 *
 * Control (runs this file again with a patch applied as it loads):
 *   GOAL_CONTROL=resume-only  React answers every stop through `resume`, as
 *   `main` did before this change: a, b, c, d-task and d-webhook must FAIL on
 *   `stop-resolved`; e must pass.
 */
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { Window } from "happy-dom";
import * as React from "react";
import { createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { z } from "zod";
import { DEFAULT_ORG_ID, defineFlow, defineWebhookBinding, dispatcher, handler } from "@flow-state-dev/core";
import { taskSettledEntry } from "@flow-state-dev/orchestration";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import { defineTaskCollection, type TaskWorker, type TaskWorkerInput } from "@flow-state-dev/orchestration/tasks";
import type { SuspensionItem } from "@flow-state-dev/core/items";
import { createClient } from "@flow-state-dev/client";
import { createFlowState, createInProcessFetch, runAction } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import {
  FlowProvider,
  SuspensionResolverProvider,
  useApproval,
  useSession,
  useSuspensionForm,
  type SessionView,
  type UseApprovalResult,
  type UseSuspensionFormResult
} from "@flow-state-dev/react";
import { REPO_ROOT, RUN_STAMP, assertPatched, describePatches, goalTmpDir, modulePatchEnv, runGoal, silentLogger, type ModulePatch } from "../../lib/index.mts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
const SCRATCH = process.env.GOAL_SCRATCH ?? goalTmpDir("suspension-answered-from-react");
const USER = "u-approver";
const BASE = "http://in-process.invalid";
const WAIT_MS = 10_000;

const PATCHES: Record<string, ModulePatch[]> = {
  // `main` before this change: every React caller resumed, whatever the stop.
  "resume-only": [
    {
      module: "packages/react/src/internal/answerStop.ts",
      from: String.raw`const userStop = reason === undefined \|\| isUserSuspension\(\{ reason \}\);`,
      to: "const userStop = false; void isUserSuspension;"
    }
  ]
};

if (CONTROL !== "" && PATCHES[CONTROL] === undefined) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(PATCHES).join(", ")}`);
  process.exit(2);
}
if (PATCHES[CONTROL] !== undefined && process.env.GOAL_MODULE_PATCH === undefined) {
  const mark = join(SCRATCH, `patch-mark-${RUN_STAMP}`);
  rmSync(mark, { force: true });
  console.error(`control ${CONTROL}:\n${describePatches(PATCHES[CONTROL]!, REPO_ROOT)}`);
  const child = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, GOAL_SCRATCH: SCRATCH, ...modulePatchEnv(PATCHES[CONTROL]!, REPO_ROOT, mark) }
  });
  assertPatched(PATCHES[CONTROL]!, REPO_ROOT, mark);
  process.exit(child.status ?? 1);
}

// A DOM for react-dom; fetch stays the in-process one.
const happy = new Window();
Object.assign(globalThis, { window: happy, document: happy.document, IS_REACT_ACT_ENVIRONMENT: false, React });

// ── the flow: one action per kind of stop ────────────────────────────────────

const step = (name: string, execute: (ctx: any) => Promise<unknown>) =>
  handler({ name, inputSchema: z.any(), outputSchema: z.any(), execute: async (_input: unknown, ctx: any) => execute(ctx) });

const rawApproval = step("raw-approval", (ctx) => ctx.suspend({ reason: "user_approval", message: "Raw approve?" }));

/** A task's worker: it stops for the user, asking the task's goal. */
const taskStop = (name: string, stop: (ctx: any, goal: string) => Promise<unknown>) =>
  handler({
    name,
    inputSchema: z.any(),
    outputSchema: z.any(),
    // The gate hands the worker its task: the payload, or the whole input.
    execute: async (input: TaskWorkerInput, ctx: any) =>
      stop(ctx, String(((input as { payload?: { goal?: unknown } }).payload ?? (input as { goal?: unknown })).goal))
  }) as unknown as TaskWorker;

const toEntry = (action: string) => dispatcher({ name: `to-${action}`, type: "task", action, session: "per-task" }) as unknown as TaskWorker;

/** Legs a, b and c: three tasks on one board, each run dispatched to its own session as a task. */
const TASKS = [
  { id: "t-a", goal: "Ship refund a?", assignee: "approve" },
  { id: "t-b", goal: "Ship refund b?", assignee: "approve" },
  { id: "t-c", goal: "Which region?", assignee: "input" },
  { id: "t-d", goal: "Raw approve on a task?", assignee: "raw" }
];
const board = taskBoard({
  name: "approvals-board",
  boardId: "approvals-board",
  mode: "delegation",
  collection: defineTaskCollection({ id: "approval-tasks", scope: "user" }),
  workers: { approve: toEntry("approve"), input: toEntry("input"), raw: toEntry("raw") },
  initialTasks: TASKS
});

// Each stop lives where its source dispatches it: a task's work under
// `task.actions`, a webhook's under its binding, the user's own under `actions`.
const flow = defineFlow({
  kind: "approvals",
  actions: {
    run: { block: board.drain },
    own: { block: step("own-stop", (ctx) => ctx.suspend({ reason: "budget_check", message: "Over budget, go on?" })) }
  },
  internal: {
    actions: {
      onTaskSettled: taskSettledEntry({ block: handler({ name: "heard", inputSchema: z.unknown(), outputSchema: z.unknown(), execute: () => ({}) }) })
    }
  },
  task: {
    actions: {
      approve: { block: taskStop("ask-approval", (ctx, goal) => ctx.suspendForUser({ kind: "approval", prompt: goal })) },
      input: { block: taskStop("ask-input", (ctx, goal) => ctx.suspendForUser({ kind: "input", prompt: goal })) },
      raw: { block: taskStop("raw-on-task", (ctx, goal) => ctx.suspend({ reason: "user_approval", message: goal })) }
    }
  },
  webhooks: {
    ops: { on: { "raw.approve": defineWebhookBinding({ block: rawApproval, input: () => ({}), sessionId: () => "s-d" }) } }
  }
} as never)({ id: "approvals" });

// A persisting store, so execution is durable as it is in an app.
const state = createFlowState({
  flows: { approvals: flow } as never,
  stores: { default: { primary: sqliteStores({ filename: join(SCRATCH, `host-${RUN_STAMP}.db`) }) } },
  logger: silentLogger
} as never);
const fetcher = createInProcessFetch(state);
const client = createClient({ userId: USER, baseUrl: BASE, fetcher });

type Parked = { stop: SuspensionItem; sessionId: string };

async function suspensionItemOf(requestId: string, sessionId: string, what: string): Promise<SuspensionItem> {
  const snapshot = await client.sessions.state(sessionId, { includeItems: true, itemTypes: ["suspension"] });
  const stop = (snapshot.items ?? []).find((item) => (item as SuspensionItem).requestId === requestId) as SuspensionItem | undefined;
  if (stop === undefined) throw new Error(`${what}: no suspension item in its session`);
  return stop;
}

/** Start `action` from `source` and return the stop it parked on, read through the public client. */
async function park(action: string, source: string, sessionId: string, metadata?: Record<string, unknown>): Promise<Parked> {
  const runtime = await state.getRuntime();
  const result = (await runAction({
    flow: runtime.registry.get("approvals") ?? flow,
    actionName: action,
    input: {},
    userId: USER,
    orgId: DEFAULT_ORG_ID,
    sessionId,
    source,
    ...(metadata !== undefined ? { metadata } : {}),
    stores: runtime.stores,
    runtimeConfig: { ...runtime.runtimeConfig, logger: silentLogger }
  } as never)) as { requestId?: string };
  const record = await runtime.stores.request.get(result.requestId!);
  if (record?.status !== "suspended") throw new Error(`${action}: the run did not park (${record?.status})`);
  if (record.source !== source) throw new Error(`${action}: the run's source is ${record.source}, not ${source}`);
  return { stop: await suspensionItemOf(result.requestId!, sessionId, action), sessionId };
}

/** Drain the board once: each task's run parks on its stop. Returns them by goal. */
async function parkTasks(): Promise<Map<string, Parked>> {
  const runtime = await state.getRuntime();
  await runAction({
    flow: runtime.registry.get("approvals") ?? flow,
    actionName: "run",
    input: {},
    userId: USER,
    orgId: DEFAULT_ORG_ID,
    sessionId: "s-board",
    stores: runtime.stores,
    runtimeConfig: { ...runtime.runtimeConfig, logger: silentLogger }
  } as never);
  const byGoal = new Map<string, Parked>();
  const deadline = Date.now() + WAIT_MS;
  while (byGoal.size < TASKS.length && Date.now() < deadline) {
    const pending = (await runtime.stores.suspensions.list({ status: "pending" })) as Array<{ requestId: string; message?: string }>;
    for (const gate of pending) {
      const record = await runtime.stores.request.get(gate.requestId);
      if (record?.source !== "task" || record.sessionId === undefined || byGoal.has(gate.message ?? "")) continue;
      byGoal.set(gate.message ?? "", { stop: await suspensionItemOf(gate.requestId, record.sessionId, gate.message ?? ""), sessionId: record.sessionId });
    }
    if (byGoal.size < TASKS.length) await new Promise((r) => setTimeout(r, 50));
  }
  return byGoal;
}

/** What the engine recorded for the stop and its request, after the answer. */
async function outcome(stop: SuspensionItem, sessionId: string): Promise<{ resolution: string | undefined; status: string }> {
  const deadline = Date.now() + WAIT_MS;
  let resolution: string | undefined;
  for (;;) {
    const snapshot = await client.sessions.state(sessionId, { includeItems: true, itemTypes: ["suspension_resume"] });
    const resumed = (snapshot.items ?? []).find((item) => (item as { suspensionId?: string }).suspensionId === stop.suspensionId) as
      | { resolution?: string }
      | undefined;
    resolution = resumed?.resolution;
    if (resolution !== undefined || Date.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  const settled = await client
    .flow("approvals")
    .request(stop.requestId)
    .wait({ timeoutMs: WAIT_MS, pollMs: 50 })
    .catch(() => ({ status: "never settled" }));
  return { resolution, status: settled.status };
}

// ── rendering a hook the way a screen does ───────────────────────────────────

function render(tree: ReactNode): () => void {
  const host = happy.document.createElement("div");
  happy.document.body.appendChild(host);
  const root = createRoot(host as unknown as Element);
  root.render(createElement(FlowProvider, { flowKind: "approvals", userId: USER, baseUrl: BASE, fetcher, children: tree }));
  return () => root.unmount();
}

async function until<T>(read: () => T | undefined, what: string): Promise<T> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** `useApproval` alone, with no resolver provider: the card's own client. */
async function approveAlone(stop: SuspensionItem): Promise<string | null> {
  let seen: UseApprovalResult | undefined;
  const Probe = () => ((seen = useApproval(stop)), null);
  const unmount = render(createElement(Probe));
  (await until(() => seen, "useApproval")).approve();
  const settled = await until(() => (seen!.resolved || seen!.error !== null ? seen : undefined), "the approve to settle");
  unmount();
  return settled.error;
}

/** `useApproval` under the session's provider, as an approval inbox wires it. */
async function approveUnderSession(stop: SuspensionItem, sessionId: string): Promise<{ error: string | null; items: SessionView["items"] }> {
  let session: SessionView | undefined;
  let seen: UseApprovalResult | undefined;
  const Card = () => ((seen = useApproval(stop)), null);
  const Screen = () => {
    session = useSession(sessionId, { flowKind: "approvals" });
    return createElement(SuspensionResolverProvider, { resolve: session.answerSuspension, children: createElement(Card) });
  };
  const unmount = render(createElement(Screen));
  await until(() => (session !== undefined && !session.isLoading && session.items.some((i) => i.type === "suspension") ? true : undefined), "the session to load the stop");
  seen!.approve();
  const settled = await until(() => (seen!.resolved || seen!.error !== null ? seen : undefined), "the approve to settle");
  // The continuation streams into the session's own items: its resume item arrives there.
  await until(
    () => (session!.items.some((i) => i.type === "suspension_resume" && (i as { suspensionId?: string }).suspensionId === stop.suspensionId) ? true : undefined),
    "the continuation in the session's items"
  ).catch(() => undefined);
  const items = session!.items;
  unmount();
  return { error: settled.error, items };
}

/** `useSuspensionForm`'s submit on an input stop. */
async function submitForm(stop: SuspensionItem, value: string): Promise<string | null> {
  let seen: UseSuspensionFormResult | undefined;
  const Probe = () => ((seen = useSuspensionForm(stop)), null);
  const unmount = render(createElement(Probe));
  (await until(() => seen, "useSuspensionForm")).setValue(value);
  await until(() => (seen!.canSubmit ? true : undefined), "the form to accept the value");
  await seen!.submit();
  const settled = await until(() => (seen!.resolved || seen!.error !== null ? seen : undefined), "the submit to settle");
  unmount();
  return settled.error;
}

// ── the run ──────────────────────────────────────────────────────────────────

await runGoal(async (failures, tell) => {
  const evidence: string[] = [];
  const grade = async (leg: string, { stop, sessionId }: Parked, error: string | null, want: string) => {
    const seen = await outcome(stop, sessionId);
    if (seen.resolution !== want) failures.push(`${leg}:stop-resolved: the stop reads ${seen.resolution ?? "unresolved"}, not ${want}${error === null ? "" : ` (the hook said: ${error})`}`);
    if (seen.status !== "completed") failures.push(`${leg}:run-completes: the request is ${seen.status}, not completed`);
    evidence.push(`${leg} ${seen.resolution ?? "unresolved"}/${seen.status}`);
  };

  const tasks = await parkTasks();
  const parked = (goal: string): Parked => {
    const found = tasks.get(goal);
    if (found === undefined) throw new Error(`no task run parked on "${goal}" (parked: ${[...tasks.keys()].join(", ")})`);
    return found;
  };

  // a — a task's run, useApproval alone.
  const a = parked("Ship refund a?");
  await grade("a", a, await approveAlone(a.stop), "approved");

  // b — a task's run, useApproval under the session's provider.
  const b = parked("Ship refund b?");
  const underSession = await approveUnderSession(b.stop, b.sessionId);
  await grade("b", b, underSession.error, "approved");
  const continuation = tell.over(
    "b · the session's items after the stop",
    underSession.items.filter((i) => i.type === "suspension_resume" && (i as { suspensionId?: string }).suspensionId === b.stop.suspensionId)
  );
  if (continuation.length !== 1) failures.push(`b:items-show-continuation: ${continuation.length} resume items for the stop in the session's view`);

  // c — a task's run, an input submitted through useSuspensionForm.
  const c = parked("Which region?");
  await grade("c", c, await submitForm(c.stop, "eu-west"), "submitted");

  // d — a raw user_approval stop: in a task's run, and in a webhook's run.
  const dTask = parked("Raw approve on a task?");
  await grade("d-task", dTask, await approveAlone(dTask.stop), "approved");
  const dHook = await park("raw.approve", "webhook", "s-d", { webhook: { provider: "ops", eventType: "raw.approve" } });
  await grade("d-webhook", dHook, await approveAlone(dHook.stop), "approved");

  // e — the user's own run, a developer's custom-reason stop, approved from the card.
  const e = await park("own", "http", "s-e");
  await grade("e", e, await approveAlone(e.stop), "approved");

  tell.over("legs graded", evidence);
  return { failures, evidence: evidence.join(" · ") };
});
