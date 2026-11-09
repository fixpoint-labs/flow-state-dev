/** What this run proves is `goal.md` beside this file. */
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { SubscriptionEvent } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { routeServiceEvent } from "@flow-state-dev/engine/internal";
import { inboxItems } from "@flow-state-dev/orchestration/inbox";
import { reconcileInbox, taskTruthOf } from "@flow-state-dev/orchestration/inbox/check";
import { createMockModelResolver, mockEvaluationModel, mockGenerator } from "@flow-state-dev/testing";
import {
  COORDINATOR_ROUTE,
  WORKER_MESSAGES_PATTERN,
  createWorkerInstallation,
  defineCoordinatorFlow,
  defineSubscriptionServiceFlow,
  hireWorkforce,
  messageReceivedEntry,
  subscriptionResources,
  subscriptionTools,
  workerConfigSchema,
  workerMessagesResources,
  workerTaskEntry,
  type SubscriptionProvider,
  type WorkerManifest
} from "@flow-state-dev/workforce";
import { z } from "zod";
import { REPO_ROOT, goalTmpDir, runGoal } from "../../lib/index.mts";
import { assertPatched, describePatches, modulePatchEnv, type ModulePatch } from "../../lib/module-patch.mts";

const ORG = "acme";
const CONTROL = process.env.GOAL_CONTROL ?? "";
const SCRATCH = process.env.GOAL_SCRATCH ?? goalTmpDir("webhook-routing-inferred-work");

/** The controls, each degrading production code as it loads. */
const PATCHES: Record<string, ModulePatch[]> = {
  // The board's write adds no confirm: an inferred turn files as asked.
  "no-gate": [
    {
      module: "packages/workforce/src/conversation-board/board.ts",
      from: String.raw`const prompt = holdsFiling\?\.\(ctx, init\);`,
      to: "const prompt = undefined as string | undefined; void holdsFiling;"
    }
  ]
};
if (CONTROL !== "" && PATCHES[CONTROL] === undefined) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(PATCHES).join(", ")}`);
  process.exit(2);
}
if (PATCHES[CONTROL] !== undefined && process.env.GOAL_MODULE_PATCH === undefined) {
  const mark = join(SCRATCH, `patch-mark-${CONTROL}`);
  rmSync(mark, { force: true });
  console.error(`control ${CONTROL}:\n${describePatches(PATCHES[CONTROL]!, REPO_ROOT)}`);
  const child = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, GOAL_SCRATCH: SCRATCH, ...modulePatchEnv(PATCHES[CONTROL]!, REPO_ROOT, mark) }
  });
  assertPatched(PATCHES[CONTROL]!, REPO_ROOT, mark);
  process.exit(child.status ?? 1);
}

// ---- the fixture ------------------------------------------------------------

/** Each event's role in the fixture, which the oracle grades. */
type Role = "inferred" | "addressed" | "heard" | "unlisted" | "outsider" | "multi";
type FixtureEvent = { role: Role; event: SubscriptionEvent };

const REPO = "github:acme/api";
const PR = "github:acme/api#412";
let n = 0;
function issue(role: Role, fields: Partial<SubscriptionEvent> = {}): FixtureEvent {
  n += 1;
  const mark = role === "addressed" ? `[evt-addr-${n}]` : role === "multi" ? `[evt-multi-${n}]` : `[evt-inf-${n}]`;
  return {
    role,
    event: {
      provider: "github",
      threads: [REPO, `${REPO}#${900 + n}`],
      kind: "issue",
      object: { id: `issue-${n}`, version: 1 },
      sender: { id: "octocat", name: "The Octocat", role: "member" },
      audience: "public",
      title: `Issue ${mark}`,
      text: "The export button does nothing.",
      labels: [],
      url: `https://github.com/acme/api/issues/${900 + n}`,
      received: Date.now(),
      at: Date.now(),
      ...fields
    }
  };
}

const FIXTURE: FixtureEvent[] = [
  issue("inferred"),
  issue("addressed", { addressed: true }),
  // A comment on #412 that alice's follower hears: no coordinator hears it.
  issue("heard", { kind: "comment", threads: [REPO, PR], object: { id: "comment-1", version: 1 } }),
  // A review: a kind the app doesn't forward.
  issue("unlisted", { kind: "review", threads: [REPO, PR], object: { id: "review-1", version: 1 } }),
  issue("outsider", { sender: { id: "stranger", name: "Stranger", role: "outsider" } }),
  // One inferred event its turn files three ways: plainly, with its own hold, and as a step for itself.
  issue("multi"),
  issue("addressed", { addressed: true })
];

/** The oracle: what the spec says of each role, with no routing or screen code. */
const ORACLE = {
  forwarded: FIXTURE.filter((f) => f.role === "inferred" || f.role === "addressed" || f.role === "multi").map((f) => f.event.object.id),
  dropped: FIXTURE.filter((f) => f.role === "unlisted" || f.role === "outsider").length,
  asks: FIXTURE.filter((f) => f.role === "addressed").map((f) => f.event.title.match(/\[evt-[^\]]+\]/)![0])
};

// ---- the app ----------------------------------------------------------------

const github: SubscriptionProvider = {
  provider: "github",
  canRead: (thread) => thread.startsWith("github:acme/api"),
  self: (ctx) => `${(ctx.session.identity as { userId: string }).userId}-gh`
};

const desk = (mode: "observe" | "auto" | "off"): WorkerManifest => ({
  id: `desk.${mode}`,
  declared: { flow: "coordinator", delegates: ["eng.doer"], inferredWork: mode, description: `The ${mode} desk.` },
  body: `[desk:${mode}] Triage what reaches you.`,
  skills: []
});
let flows: Record<string, unknown> = {};
const installation = createWorkerInstallation({
  standardWorkers: [
    desk("observe"),
    desk("auto"),
    desk("off"),
    { id: "eng.doer", declared: { flow: "doer", description: "Does the work." }, body: "", skills: [] },
    { id: "eng.follower", declared: { flow: "follower", description: "Follows a PR." }, body: "", skills: [] }
  ],
  workerFlows: () => flows as never
});

/** Every attempt the delegate ran, by task id. */
const attempts: string[] = [];
const doorInput = z.object({ message: z.string() });
const doer = handler({
  name: "doer-turn",
  inputSchema: doorInput,
  execute: async (input, ctx) => {
    attempts.push(String((ctx.session.state as Record<string, unknown>).taskId));
    return `did: ${input.message}`;
  }
});
const doerFlow = defineFlow({
  kind: "doer",
  configSchema: workerConfigSchema(),
  session: installation.session(),
  resources: { ...installation.resources, ...workerMessagesResources },
  actions: { respond: { inputSchema: doorInput, block: doer, userMessage: (i: { message: string }) => i.message } },
  internal: { actions: { onMessageReceived: messageReceivedEntry({ installation, flowKind: "doer", hears: "task-sessions" }) } },
  task: { actions: { work: workerTaskEntry({ name: "doer-task", turn: doer }) } }
});
const tools = subscriptionTools({ providers: [github] });
const followerFlow = defineFlow({
  kind: "follower",
  configSchema: workerConfigSchema(),
  session: installation.session(),
  resources: { ...installation.resources, ...workerMessagesResources, ...subscriptionResources },
  actions: {
    respond: { inputSchema: doorInput, block: doer, userMessage: (i: { message: string }) => i.message },
    subscribe: { inputSchema: tools.subscribe.inputSchema, block: tools.subscribe }
  },
  internal: { actions: { onMessageReceived: messageReceivedEntry({ installation, flowKind: "follower" }) } },
  task: { actions: { work: workerTaskEntry({ name: "follower-task", turn: doer }) } }
});
const coordinator = defineCoordinatorFlow({ installation, routeModel: "scripted/fit", subscriptions: { providers: [github] } });
flows = { doer: { flow: doerFlow, roles: ["contributor"] }, follower: { flow: followerFlow, roles: ["contributor"] }, coordinator };

/**
 * The judgment turn: on the latest forwarded event it reads, it files one
 * task for the delegate with `questions: []` (the anti-game: the model asks
 * nothing itself); on a `multi` event, three filings. Every call is kept with
 * its desk and the event it answered.
 */
const calls: Array<{ desk: string; mark: string | undefined }> = [];
const handled = new Set<string>();
const step: { toolCalls?: Array<{ toolCallId: string; toolName: string; args: unknown }> } = {};
const judgment = mockGenerator({
  name: "coordinator-judgment",
  script: [
    {
      when: (input: unknown) => {
        const text = JSON.stringify(input);
        const deskOf = /\[desk:(\w+)\]/.exec(text)?.[1] ?? "?";
        // The latest forward this conversation read, by its message id (`sub_<object>@<version>:<session>`):
        // its object names the event, and its session the conversation (two users' desks of one mode are two).
        const latest = [...text.matchAll(/sub_([^@"\\]+)@\d+:(sess_[A-Za-z0-9_]+)/g)].at(-1);
        const mark = FIXTURE.find((f) => f.event.object.id === latest?.[1])?.event.title.match(/\[evt-[^\]]+\]/)?.[0];
        calls.push({ desk: deskOf, mark });
        const key = `${latest?.[2]}:${mark}`;
        if (mark === undefined || handled.has(key)) return false;
        handled.add(key);
        const filing = (id: string, extra: Record<string, unknown> = {}) => ({
          toolCallId: `${key}:${id}`,
          toolName: "createTask",
          args: { goal: `Triage ${mark} (${id})`, assignee: "eng.doer", questions: [], ...extra }
        });
        step.toolCalls = mark.startsWith("[evt-multi")
          ? [filing("plain"), filing("held", { held: true }), { ...filing("step"), args: { goal: `Triage ${mark} (step)`, assignee: `desk.${deskOf}` } }]
          : [filing("plain")];
        return true;
      },
      then: step
    },
    { when: () => true, then: { text: "Done." } }
  ]
});
const models = createMockModelResolver({
  evaluators: { [COORDINATOR_ROUTE]: mockEvaluationModel({ answers: { worker: { type: "choice", choice: "eng.doer" } } }) },
  generators: { "coordinator-judgment": judgment }
});

const service = defineSubscriptionServiceFlow({ kind: "github-service", provider: github, installation, forwards: { kinds: ["issue", "comment"] } });
const instances = Object.fromEntries(hireWorkforce(installation).map((copy) => [copy.id, copy]));
const stores = inMemoryStores();
const state = createFlowState({
  flows: { ...instances, "github-service": service },
  stores: { default: { primary: stores } },
  modelResolver: models,
  resolvePrincipal: (context: any) => {
    const user = context.request?.headers.get("x-user");
    return typeof user === "string" ? { userId: user, orgId: ORG } : null;
  },
  // The router's inbound host, as a transport adapter is handed it: what an ingestion routes through.
  adapters: [{ source: "goal-ingestion", createBindings: (host: unknown) => ((inbound = host), {}) }]
} as never) as any;
let inbound: unknown;

const act = async (userId: string, sessionId: string, flow: string, actionName: string, input: unknown) => {
  const runtime = await state.getRuntime();
  return (await runAction({ flow: instances[flow]! as never, actionName, input, userId, orgId: ORG, sessionId, stores: runtime.stores, runtimeConfig: { ...runtime.runtimeConfig } })) as { output?: any };
};
const create = async (userId: string, flow: string, workerId: string): Promise<string> => {
  const router = await state.getRouter();
  const res = await router.POST(
    new Request(`http://goal.local/api/flows/${flow}/sessions`, { method: "POST", headers: { "content-type": "application/json", "x-user": userId }, body: JSON.stringify({ userId, state: { workerId } }) }),
    { params: { path: [flow, "sessions"] } }
  );
  const body = (await res.json()) as { session?: { id: string } };
  if (body.session === undefined) throw new Error(`creating ${workerId}'s session failed: ${JSON.stringify(body)}`);
  return body.session.id;
};
/** Nothing running, three reads in a row. */
const quiet = async () => {
  const runtime = await state.getRuntime();
  for (let calm = 0, until = Date.now() + 30_000; calm < 3; ) {
    if (Date.now() > until) throw new Error("the host never went quiet");
    const running = (await runtime.stores.request.list({})).some((r: { status: string; finalizedAtMs?: number | null }) => r.status === "in_progress" || (r.status !== "suspended" && r.status !== "pending" && r.finalizedAtMs == null));
    calm = running ? 0 : calm + 1;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
};
const boardRows = async (userId: string) => {
  const runtime = await state.getRuntime();
  return Object.entries(await runtime.stores.resourceState.getByPrefix("user", `${userId}:~org:${ORG}`, "tasks/")).map(([key, value]) => ({ ...(value as any).state, board: key.split("/")[1] }));
};

// ---- the run ----------------------------------------------------------------

const MODES = ["observe", "auto", "off"] as const;
const USERS = ["alice", "bob"] as const;
const sessions: Record<string, string> = {};
for (const user of USERS) {
  for (const mode of user === "alice" ? MODES : (["observe"] as const)) {
    const id = await create(user, "coordinator", `desk.${mode}`);
    sessions[`${user}:${mode}`] = id;
    const out = (await act(user, id, "coordinator", "subscribe", { provider: "github", thread: REPO, unmatched: true, interest: "new issues nobody picked up" })).output;
    if (out?.id === undefined) throw new Error(`desk.${mode} couldn't subscribe: ${JSON.stringify(out)}`);
  }
}
const follower = await create("alice", "follower", "eng.follower");
await act("alice", follower, "follower", "subscribe", { provider: "github", thread: PR, kinds: ["comment"], interest: "comments on my PR" });

const routed: any[] = [];
for (const { event } of FIXTURE) {
  await state.getRouter();
  const out = await routeServiceEvent(inbound as never, {
    flowKind: "github-service",
    entry: "routeSubscriptionEvent",
    input: event,
    principal: { userId: "service:github", orgId: ORG }
  });
  if (out.error !== undefined) throw new Error(`routing failed: ${JSON.stringify(out.error)}`);
  await Promise.all(out.ownerRuns.map((run: { finished?: Promise<unknown> }) => run.finished));
  await quiet();
  routed.push(out.output);
}

await runGoal(async (failures, tell) => {
  const rowsOf = async (user: string) => tell.over(`${user}'s board rows`, await boardRows(user), { emptyIs: "nothing was ever filed" });
  const all = [...(await rowsOf("alice")), ...(await rowsOf("bob"))];
  /** The desk whose conversation a row is on: its board names that conversation. */
  const deskOfRow = (row: any) => Object.entries(sessions).find(([, id]) => decodeURIComponent(String(row.board)).includes(id))?.[0];
  const rowsFor = (key: string) => all.filter((row) => deskOfRow(row) === key);
  const isAsk = (row: any) => ORACLE.asks.some((mark) => String(row.goal).includes(mark));
  const confirms = (row: any) => (row.holds ?? []).filter((h: any) => h.ask?.kind === "confirm");

  // (a) The service flow files no task.
  const runtime = await state.getRuntime();
  const serviceRows = Object.keys(await runtime.stores.resourceState.getByPrefix("user", `service:github:~org:${ORG}`, "tasks/"));
  if (serviceRows.length > 0) failures.push(`a: ${serviceRows.length} board row(s) in the service principal's cell`);

  // (b) observe: every inferred task holds a confirm and ran no attempt; the Inbox reconciles.
  for (const key of ["alice:observe", "bob:observe"]) {
    const inferred = tell.over(`b · ${key}'s inferred tasks`, rowsFor(key).filter((row) => !isAsk(row)));
    for (const row of inferred) {
      if (confirms(row).length !== 1) failures.push(`b: ${key}'s "${row.goal}" holds ${confirms(row).length} confirm(s)`);
      if (attempts.includes(row.id) || (row.attempts ?? 0) > 0) failures.push(`b: ${key}'s "${row.goal}" started an attempt`);
    }
    const inputs = rowsFor(key).map((row) => ({ board: `${sessions[key]}.tasks`, holder: { sessionId: sessions[key]!, action: "updateTask_tasks" }, id: row.id, goal: row.goal, status: row.status, holds: row.holds ?? [], steers: row.steers ?? [] }));
    const reconciled = reconcileInbox(inboxItems({ rows: inputs, suspensions: [], flowOf: () => "coordinator" }), { rows: taskTruthOf(inputs), suspensions: [], closed: [] } as never);
    if (!reconciled.green) failures.push(`b: ${key}'s Inbox doesn't reconcile: ${JSON.stringify(reconciled)}`);
  }

  // (c) auto: the same inferred tasks ran.
  // A filing the model held itself waits in every mode: (c) reads the rest.
  // And a step for itself runs in auto, and is refused in observe ((g) reads that).
  const ownHeld = (row: any) => String(row.goal).endsWith("(held)") || String(row.goal).endsWith("(step)");
  const autoInferred = tell.over("c · auto's inferred tasks", rowsFor("alice:auto").filter((row) => !isAsk(row) && !ownHeld(row)));
  for (const row of autoInferred) if (!attempts.includes(row.id)) failures.push(`c: auto's "${row.goal}" never ran`);
  const observeInferred = rowsFor("alice:observe").filter((row) => !isAsk(row) && !ownHeld(row)).length;
  if (autoInferred.length !== observeInferred) failures.push(`c: auto filed ${autoInferred.length} inferred task(s), observe ${observeInferred}`);

  // (d) off: no model call on an inferred forward; asks ran in every mode.
  const offInferred = calls.filter((c) => c.desk === "off" && c.mark !== undefined && !ORACLE.asks.includes(c.mark));
  if (offInferred.length > 0) failures.push(`d: ${offInferred.length} model call(s) on inferred forwards at the off desk (${offInferred[0]!.mark})`);
  for (const key of ["alice:observe", "alice:auto", "alice:off", "bob:observe"]) {
    const asks = tell.over(`d · ${key}'s asks`, rowsFor(key).filter(isAsk));
    if (asks.length !== ORACLE.asks.length) failures.push(`d: ${key} filed ${asks.length} ask task(s) of ${ORACLE.asks.length}`);
    for (const row of asks) if (!attempts.includes(row.id)) failures.push(`d: ${key}'s ask "${row.goal}" never ran`);
  }

  // (e) A failed screen forwards nothing: pending FIX-2537's evaluator, which is the only source of one.
  console.log("(e) not run end to end: no screen on this branch can fail or hold; `blocksForward` is unit-tested in packages/workforce.");

  // (f) Unlisted kinds and outsiders reach no coordinator; the drops equal the fixture's.
  const dropped = routed.filter((r) => r.unmatched?.dropped !== undefined).length;
  if (dropped !== ORACLE.dropped) failures.push(`f: routing counted ${dropped} dropped, the fixture holds ${ORACLE.dropped}`);
  const forwardsIn = async (user: string) =>
    Object.values(await runtime.stores.resourceState.getByPrefix("user", `${user}:~org:${ORG}`, WORKER_MESSAGES_PATTERN.replace("*", "")))
      .map((v: any) => v.state)
      .filter((row: any) => row.forward !== undefined);
  const aliceForwards = tell.over("f · alice's forwarded messages", await forwardsIn("alice"));
  const objects = new Set(aliceForwards.map((row: any) => /sub_([^@]+)@/.exec(row.id)?.[1]));
  for (const id of objects) if (!ORACLE.forwarded.includes(String(id))) failures.push(`f: ${id} reached a coordinator, and the oracle forwards it to none`);
  if (aliceForwards.length !== ORACLE.forwarded.length * MODES.length) failures.push(`f: alice's desks hold ${aliceForwards.length} forward(s) of ${ORACLE.forwarded.length * MODES.length}`);

  // (g) Every row an inferred observe turn filed holds the confirm, whichever way it was filed.
  const multi = tell.over("g · observe's rows of the multi event", rowsFor("alice:observe").filter((row) => String(row.goal).includes("[evt-multi")));
  if (multi.length !== 2) failures.push(`g: observe holds ${multi.length} row(s) of the multi event, not 2 (plain and held; the step is refused)`);
  if (multi.some((row) => String(row.goal).endsWith("(step)"))) failures.push("g: observe filed a step for itself on an inferred turn");
  for (const row of multi) if (confirms(row).length !== 1) failures.push(`g: "${row.goal}" holds ${confirms(row).length} confirm(s)`);

  return {
    failures,
    evidence: `${all.length} rows across 2 users and 4 desks; observe's inferred tasks each held one confirm and ran none, auto's ran, the off desk called no model on an inferred forward, ${ORACLE.asks.length} asks ran in every mode; ${dropped} drops counted`
  };
});
