/** What this run proves is `goal.md` beside this file. */
import { AsyncLocalStorage } from "node:async_hooks";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { FlowInstance, SubscriptionEvent } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { routeServiceEvent } from "@flow-state-dev/engine/internal";
import { type InboundTransportHost } from "@flow-state-dev/engine/host";
import { createMockModelResolver } from "@flow-state-dev/testing";
import {
  MESSAGE_RECEIVED_ENTRY,
  ROSTER_FLOW,
  SUBSCRIPTION_ROUTE_ENTRY,
  WORKER_MESSAGES_PATTERN,
  createWorkerInstallation,
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
import { REPO_ROOT, goalTmpDir, runGoal, silentLogger } from "../../lib/index.mts";
import { assertPatched, describePatches, modulePatchEnv, type ModulePatch } from "../../lib/module-patch.mts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORG = "acme";
const CONTROL = process.env.GOAL_CONTROL ?? "";
const SCRATCH = process.env.GOAL_SCRATCH ?? goalTmpDir("webhook-routing");

/** The controls: each degrades one behaviour in the code under test, as it loads. */
const PATCHES: Record<string, ModulePatch[]> = {
  // A delivery's id without its session: one key per object version, as one dedupe key would have it.
  "one-key": [
    {
      module: "packages/workforce/src/subscriptions/service-flow.ts",
      from: String.raw`@\$\{object\.version\}\$\{tenant\}:\$\{sessionId\}`,
      to: "@${object.version}"
    }
  ],
  // A thread's closing ends only the subscriptions the closing event reached: the end-only runs are dropped.
  "close-gated": [
    {
      module: "packages/workforce/src/subscriptions/service-flow.ts",
      from: String.raw`for \(const candidate of closing\) if \(!delivered\.has\(candidate\.subscription\)\) ownerRuns\.push\(runFor\(candidate, true\)\);`,
      to: ""
    }
  ],
  // A closing event ends every subscription it reaches, the whole repo's too.
  "close-whole": [
    {
      module: "packages/workforce/src/subscriptions/service-flow.ts",
      from: String.raw`const closes = closedThreadOf\(event\) === row\.thread;`,
      to: "const closes = event.closes === true;"
    }
  ],
  // The sender screen fails open: an outsider passes every subscription.
  "fail-open": [
    {
      module: "packages/workforce/src/subscriptions/screens.ts",
      from: String.raw`const outsidersPass = entry\.outsiders === true;`,
      to: "const outsidersPass = true;"
    }
  ]
};

if (CONTROL !== "" && PATCHES[CONTROL] === undefined) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(PATCHES).join(", ")}`);
  process.exit(2);
}
// A control runs this same file again with its patch applied as it loads.
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

type FixtureSubscription = {
  label: string;
  user: string;
  input: { thread: string; kinds?: string[]; screens?: Array<{ screen: string; any?: string[]; ids?: string[] }>; outsiders?: true; interest: string };
  unsubscribeAt?: number;
};
const SUBSCRIPTIONS = JSON.parse(readFileSync(join(HERE, "fixtures/subscriptions.json"), "utf8")) as FixtureSubscription[];
const { events: EVENTS, redeliveries: REDELIVERIES } = JSON.parse(readFileSync(join(HERE, "fixtures/events.json"), "utf8")) as {
  events: SubscriptionEvent[];
  redeliveries: SubscriptionEvent[];
};

/** Who may read what, the way a provider would answer: public repos anyone, the private one only alice. */
const readable = (user: string, thread: string) => !thread.startsWith("github:acme/private-api") || user === "alice";
const BOTS = ["codex"];

// ---- the host ---------------------------------------------------------------

/** Which principal's request a store read happened in: the dispatch that started it, as AsyncLocalStorage carries it. */
const runningAs = new AsyncLocalStorage<string>();
const userReads: Array<{ as: string; cellUser: string }> = [];
/** Every store read in a request, any scope, by whose request it was. */
const allReads: Array<{ as: string; scope: unknown }> = [];
const modelCalls: string[] = [];

const github: SubscriptionProvider = {
  provider: "github",
  canRead: (thread, ctx) => readable((ctx.session.identity as { userId: string }).userId, thread),
  self: (ctx) => `${(ctx.session.identity as { userId: string }).userId}-gh`
};

const installationFlows: Record<string, unknown> = {};
const installation = createWorkerInstallation({
  standardWorkers: [{ id: "eng.follower", declared: { flow: "follower", description: "Follows threads." }, body: "", skills: [] } as WorkerManifest],
  workerFlows: () => installationFlows as never
});
const tools = subscriptionTools({ providers: [github] });
const doorInput = z.object({ message: z.string() });
const door = handler({ name: "follower-run", inputSchema: doorInput, execute: async () => "ok" });
installationFlows.follower = {
  roles: ["contributor"],
  flow: defineFlow({
    kind: "follower",
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { ...installation.resources, ...workerMessagesResources, ...subscriptionResources },
    actions: {
      respond: { inputSchema: doorInput, block: door, userMessage: (i: { message: string }) => i.message },
      subscribe: { inputSchema: tools.subscribe.inputSchema, block: tools.subscribe },
      unsubscribe: { inputSchema: tools.unsubscribe.inputSchema, block: tools.unsubscribe }
    },
    // No turn: a message lands as its items and nothing runs.
    internal: { actions: { [MESSAGE_RECEIVED_ENTRY]: messageReceivedEntry({ installation, flowKind: "follower" }) } },
    task: { actions: { work: workerTaskEntry({ name: "follower-task", turn: door }) } }
  })
};
const instances: Record<string, FlowInstance> = Object.fromEntries(
  hireWorkforce(installation).map((copy) => [copy.id === ROSTER_FLOW ? "roster" : copy.id, copy])
);
instances["github-service"] = defineSubscriptionServiceFlow({
  kind: "github-service",
  provider: github,
  installation,
  trustedBots: BOTS,
  // High enough that no subscription in the fixture reaches it: the cap is the unit tests'.
  capPerHour: 10_000
});

const mocks = createMockModelResolver({});
const modelResolver = Object.assign((modelId: string, blockName?: string) => {
  modelCalls.push(`${modelId} for ${blockName ?? "?"}`);
  return (mocks as any)(modelId, blockName);
}, mocks);

let captured: InboundTransportHost | undefined;
const stores = inMemoryStores();
const state = createFlowState({
  flows: instances,
  stores: { default: { primary: stores } },
  modelResolver,
  logger: silentLogger,
  resolvePrincipal: (context: any) => {
    const user = context.request?.headers.get("x-user");
    return typeof user === "string" ? { userId: user, orgId: ORG } : null;
  },
  adapters: [{ source: "webhook-routing-goal", createBindings: (h: InboundTransportHost) => ((captured = h), {}) }]
} as never);
const router = (await state.getRouter()) as any;
const runtime = await state.getRuntime();

// Every read of a user's cell, tagged with whose request made it.
const resourceState = runtime.stores.resourceState as unknown as Record<string, (...args: unknown[]) => unknown>;
for (const method of ["get", "getByPrefix", "getMany", "list"]) {
  const original = resourceState[method];
  if (typeof original !== "function") continue;
  resourceState[method] = function (this: unknown, ...args: unknown[]) {
    allReads.push({ as: runningAs.getStore() ?? "host", scope: args[0] });
    if (args[0] === "user" && typeof args[1] === "string") {
      userReads.push({ as: runningAs.getStore() ?? "host", cellUser: (args[1] as string).split(":~org:")[0]! });
    }
    return original.apply(this, args);
  };
}
// The host routeServiceEvent dispatches through: each request it starts runs tagged with its principal.
const host: InboundTransportHost = {
  ...captured!,
  stores: captured!.stores,
  dispatch: (envelope) => runningAs.run(envelope.principal.userId, () => captured!.dispatch(envelope))
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait until no request is running or unfinalized. */
async function settled(): Promise<void> {
  const running = (r: { status: string; finalizedAtMs?: number | null }) =>
    r.status === "in_progress" || (r.status !== "suspended" && r.status !== "pending" && r.finalizedAtMs == null);
  for (const deadline = Date.now() + 20_000; ; await sleep(5)) {
    const all = await runtime.stores.request.list({});
    if (!all.some(running)) {
      await sleep(5);
      const again = await runtime.stores.request.list({});
      if (!again.some(running) && again.length === all.length) return;
    }
    if (Date.now() > deadline) throw new Error("setup: a request never finished");
  }
}

async function createFollower(user: string): Promise<string> {
  const request = new Request("http://localhost/api/flows/follower/sessions", {
    method: "POST",
    headers: { "content-type": "application/json", "x-user": user },
    body: JSON.stringify({ userId: user, state: { workerId: "eng.follower" } })
  });
  const res = await router.POST(request, { params: { path: ["follower", "sessions"] } });
  const body = (await res.json()) as { session?: { id: string } };
  if (body.session === undefined) throw new Error(`setup: creating ${user}'s follower failed (${res.status}): ${JSON.stringify(body)}`);
  return body.session.id;
}

async function act(user: string, sessionId: string, action: string, input: unknown) {
  return (await runAction({
    flow: instances.follower!,
    actionName: action,
    input,
    userId: user,
    orgId: ORG,
    sessionId,
    stores: runtime.stores,
    runtimeConfig: { ...runtime.runtimeConfig }
  })) as { output?: any; error?: unknown };
}

// ---- the run ----------------------------------------------------------------

const sessions = new Map<string, string>();
const subscriptionIds = new Map<string, string>();
const refusedAtSubscribe = new Map<string, string>();
for (const sub of SUBSCRIPTIONS) {
  const sessionId = await createFollower(sub.user);
  sessions.set(sub.label, sessionId);
  const outcome = await act(sub.user, sessionId, "subscribe", { provider: "github", ...sub.input });
  if (outcome.output?.id !== undefined) subscriptionIds.set(sub.label, outcome.output.id);
  else refusedAtSubscribe.set(sub.label, String(outcome.output?.refused ?? JSON.stringify(outcome.error)));
}

// The share, derived here from the verdicts routing returns: production output carries no share.
const labelOf = new Map<string, string>();
const screensOf = (subscription: string) => SUBSCRIPTIONS.find((s) => s.label === labelOf.get(subscription))?.input.screens?.length ?? 0;
let selected = 0;
let decided = 0;
let verdictsCut = 0;
let unlabelled = 0;
const route = async (event: SubscriptionEvent) => {
  const routed = await routeServiceEvent(host, {
    flowKind: "github-service",
    entry: SUBSCRIPTION_ROUTE_ENTRY,
    input: event,
    principal: { userId: "service:github", orgId: ORG }
  });
  if (routed.error !== undefined) throw new Error(`routing failed: ${JSON.stringify(routed.error)}`);
  await Promise.all(routed.ownerRuns.map((run) => run.finished));
  await settled();
  return routed.output as { verdicts: Array<{ subscription: string; pass: boolean; reason: string }>; verdictsCut: number };
};
for (const [label, id] of subscriptionIds) labelOf.set(id, label);
for (const [i, event] of EVENTS.entries()) {
  for (const sub of SUBSCRIPTIONS) {
    if (sub.unsubscribeAt === i) await act(sub.user, sessions.get(sub.label)!, "unsubscribe", { id: subscriptionIds.get(sub.label) });
  }
  const output = await route(event);
  verdictsCut += output.verdictsCut;
  for (const verdict of output.verdicts) {
    if (!labelOf.has(verdict.subscription)) unlabelled += 1;
    selected += 1;
    // Decided by config: a screen's refusal, or a pass on a subscription that listed a screen of its own.
    // A refusal for having no verdict decided nothing; a pass on one that listed none is open.
    if (verdict.pass ? screensOf(verdict.subscription) > 0 : verdict.reason !== "no verdict") decided += 1;
  }
}
for (const event of REDELIVERIES) await route(event);

// What landed: each user's message log rows from the service, delivered, by session.
type Landed = { session: string; key: string; status: string };
const landed: Landed[] = [];
for (const user of ["alice", "bob"]) {
  const rows = await runtime.stores.resourceState.getByPrefix("user", `${user}:~org:${ORG}`, WORKER_MESSAGES_PATTERN.replace("*", ""));
  for (const value of Object.values(rows)) {
    const row = value.state as { id: string; from: string; toSession: string; status: string };
    if (!row.from.startsWith("service:")) continue;
    // `sub_<object>@<version>[@<tenant>]:<session>`: the object and version, read without assuming the session suffix is there.
    const base = row.id.endsWith(`:${row.toSession}`) ? row.id.slice(0, -(row.toSession.length + 1)) : row.id;
    const [object, version] = base.slice("sub_".length).split("@");
    const key = `${decodeURIComponent(object!)}@${version}`;
    landed.push({ session: row.toSession, key, status: row.status });
  }
}
/** A stored message item's text: a string, or its content parts. */
function textOf(item: any): string {
  if (typeof item.text === "string") return item.text;
  return ((item.content ?? []) as Array<{ text?: string }>).map((part) => part.text ?? "").join("");
}
// What each session's model reads: the message items stored in it.
const itemsIn = async (sessionId: string) =>
  (await runtime.stores.request.list({ sessionId, withItems: true }))
    .flatMap((r) => ((r as unknown as { items?: any[] }).items ?? []))
    .filter((item) => item.type === "message" && textOf(item).startsWith("From service:")).length;

// ---- the oracle: the spec's rules, written again here, not imported ----------

function expectedFor(sub: FixtureSubscription): string[] {
  if (!readable(sub.user, sub.input.thread)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const [i, e] of EVENTS.entries()) {
    if (sub.unsubscribeAt !== undefined && i >= sub.unsubscribeAt) break;
    if (!e.threads.includes(sub.input.thread)) continue;
    const role = e.sender.role;
    const senderOk = role === "member" || role === "collaborator" || (role === "bot" ? BOTS.includes(e.sender.id) : sub.input.outsiders === true);
    const listed = sub.input.screens ?? [];
    const body = `${e.title}\n${e.text}`.toLowerCase();
    const reaches =
      (sub.input.kinds === undefined || sub.input.kinds.includes(e.kind)) &&
      senderOk &&
      e.sender.id !== `${sub.user}-gh` &&
      listed.every((s) =>
        s.screen === "labels" ? s.any!.some((l) => e.labels.includes(l)) : s.screen === "words" ? s.any!.some((w) => body.includes(w.toLowerCase())) : s.ids!.includes(e.sender.id)
      );
    const key = `${e.object.id}@${e.object.version}`;
    if (reaches && !seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
    // The thread it follows closed (the event's narrowest thread): it ends, whether or not the closing event reached it.
    if (e.closes === true && e.threads.at(-1) === sub.input.thread) break;
  }
  return out;
}

const sorted = (xs: string[]) => [...xs].sort();
await runGoal(async (failures, tell) => {
  // (a) Each session's rows equal the expected set, delivered, and its model reads that many messages.
  const expectedAll = SUBSCRIPTIONS.flatMap((sub) => expectedFor(sub).map((key) => ({ label: sub.label, key })));
  tell.over("a · expected deliveries in the fixture", expectedAll);
  tell.over("a · service rows landed", landed);
  for (const sub of SUBSCRIPTIONS) {
    const sessionId = sessions.get(sub.label)!;
    const got = landed.filter((l) => l.session === sessionId);
    const want = expectedFor(sub);
    if (JSON.stringify(sorted(got.map((g) => g.key))) !== JSON.stringify(sorted(want))) {
      const missing = want.filter((k) => !got.some((g) => g.key === k));
      const extra = got.map((g) => g.key).filter((k) => !want.includes(k));
      failures.push(`a: ${sub.label} got ${got.length}, expected ${want.length} (missing ${missing.slice(0, 3).join(", ") || "none"}; extra ${extra.slice(0, 3).join(", ") || "none"})`);
    }
    const undelivered = got.filter((g) => g.status !== "delivered");
    if (undelivered.length > 0) failures.push(`a: ${sub.label} has ${undelivered.length} row(s) not delivered (${undelivered[0]!.status})`);
    const items = await itemsIn(sessionId);
    if (items !== got.length) failures.push(`a: ${sub.label}'s session holds ${items} service message item(s) for ${got.length} row(s)`);
  }
  // The second session on #412 is the case one dedupe key fails.
  if (expectedFor(SUBSCRIPTIONS.find((s) => s.label === "a2")!).length === 0) failures.push("setup: a2 expects nothing, so the two-session case is untested");

  // (b) 0 reads of another user's cell from a request that ran as someone: the service reads none; each owner run its own.
  // The tag reaches the service's own request: it reads the org's thread index, and no user's cell.
  tell.over("b · reads inside the service's requests", allReads.filter((r) => r.as === "service:github"));
  const tagged = tell.over("b · user-cell reads inside a request", userReads.filter((r) => r.as !== "host"));
  const crossing = tell.over(
    "b · cross-user reads",
    tagged.filter((r) => r.as !== r.cellUser),
    { emptyIs: "the claim: no request read another user's cell" }
  );
  for (const r of crossing.slice(0, 5)) failures.push(`b: a request as ${r.as} read ${r.cellUser}'s cell`);
  tell.over("b · owner-run reads of the subscriber's own cell", tagged.filter((r) => r.as === r.cellUser && r.as !== "service:github"));
  // B can't follow A's private PR: refused at subscribe, nothing of it lands for bob.
  if (!/^not_readable/.test(refusedAtSubscribe.get("b8") ?? "")) failures.push(`b: bob's subscribe to the private PR was not refused (${refusedAtSubscribe.get("b8") ?? "saved"})`);
  const privateToBob = landed.filter((l) => SUBSCRIPTIONS.some((s) => s.user === "bob" && sessions.get(s.label) === l.session) && l.key.startsWith("private#7"));
  if (privateToBob.length > 0) failures.push(`b: ${privateToBob.length} private event(s) reached bob`);

  // (c) 0 model calls.
  tell.over("c · model resolutions", modelCalls, { emptyIs: "the claim: nothing on this path asks a model" });
  if (modelCalls.length > 0) failures.push(`c: ${modelCalls.length} model call(s): ${modelCalls[0]}`);

  // (d) 0 deliveries after a subscription ended: b7 unsubscribed at event 150; a11's thread closed at event 200;
  // #415 closed at 230 with an event a13's kinds and b10's words screen out; alice merged #416 herself at 260.
  const indexOf = (key: string) => EVENTS.findIndex((e) => `${e.object.id}@${e.object.version}` === key);
  for (const [label, end] of [["b7", 150], ["a11", 201], ["a13", 231], ["b10", 231], ["a14", 261]] as const) {
    const after = landed.filter((l) => l.session === sessions.get(label) && indexOf(l.key) >= end);
    tell.over(`d · ${label}'s deliveries before its end`, landed.filter((l) => l.session === sessions.get(label) && indexOf(l.key) < end));
    if (after.length > 0) failures.push(`d: ${label} got ${after.length} delivery(ies) after it ended`);
  }
  // A subscription to the whole repo outlives every PR that closes on it.
  const repoAfter = tell.over("d · a12's deliveries after #414 closed", landed.filter((l) => l.session === sessions.get("a12") && indexOf(l.key) > 200));
  const wantAfter = expectedFor(SUBSCRIPTIONS.find((s) => s.label === "a12")!).filter((key) => indexOf(key) > 200).length;
  if (repoAfter.length !== wantAfter) failures.push(`d: a12 (the whole repo) got ${repoAfter.length} delivery(ies) after #414 closed, expected ${wantAfter}`);

  // (e) Outsiders refused unless the subscription opted in.
  // An object version only outsiders sent: the fixture's edits can give one version two senders, so a key any member also sent is no outsider's.
  const keyOf = (e: SubscriptionEvent) => `${e.object.id}@${e.object.version}`;
  const isOutsider = (e: SubscriptionEvent) => e.sender.role === "outsider" || e.sender.role === "unknown";
  const outsiderKeys = new Set(EVENTS.filter(isOutsider).map(keyOf).filter((key) => EVENTS.every((e) => keyOf(e) !== key || isOutsider(e))));
  tell.over("e · outsider events in the fixture", [...outsiderKeys]);
  const optedIn = new Set(SUBSCRIPTIONS.filter((s) => s.input.outsiders === true).map((s) => sessions.get(s.label)));
  tell.over("e · outsider events delivered to opted-in subscriptions", landed.filter((l) => optedIn.has(l.session) && outsiderKeys.has(l.key)));
  const leaked = landed.filter((l) => !optedIn.has(l.session) && outsiderKeys.has(l.key));
  for (const l of leaked.slice(0, 3)) failures.push(`e: outsider event ${l.key} reached a subscription that takes no outsiders`);
  if (leaked.length > 3) failures.push(`e: … ${leaked.length} outsider deliveries in all`);

  // The share the config screens decided, reported on every run, from every verdict.
  if (verdictsCut > 0) failures.push(`share: routing cut ${verdictsCut} verdict(s), so the share can't be read whole`);
  if (unlabelled > 0) failures.push(`share: ${unlabelled} verdict(s) named a subscription the fixture didn't make`);
  const share = selected === 0 ? 0 : decided / selected;
  tell.over("share · nominated subscriptions", Array.from({ length: selected }));
  const line = `SHARE ${share.toFixed(3)} (${decided}/${selected} config-decided of selected)${share < 0.5 ? " · KILL LINE" : ""}`;
  console.log(line);
  return {
    failures,
    evidence: `${landed.length} deliveries matched the oracle over ${SUBSCRIPTIONS.length} subscriptions, ${EVENTS.length} events and ${REDELIVERIES.length} redeliveries; 0 cross-user reads; 0 model calls; ${line}`
  };
});
await state.dispose();
