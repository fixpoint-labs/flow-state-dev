/** What this run proves is `goal.md` beside this file. */
import { at, moveTo } from "./clock.mts";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { FlowInstance, SubscriptionEvent } from "@flow-state-dev/core/types";
import { createFlowState, runAction } from "@flow-state-dev/engine";
import { routeServiceEvent } from "@flow-state-dev/engine/internal";
import { type InboundTransportHost } from "@flow-state-dev/engine/host";
import { createScheduledTransportAdapter } from "@flow-state-dev/scheduled";
import { runScheduleTick, scheduleDispatchRequest } from "@flow-state-dev/scheduled/collection";
import { createSQLiteScheduleIndex, sqliteStores } from "@flow-state-dev/store-sqlite";
import { createMockModelResolver } from "@flow-state-dev/testing";
import {
  ROSTER_FLOW,
  WORKER_MESSAGES_PATTERN,
  createWorkerInstallation,
  defineSubscriptionServiceFlow,
  deliveryMessageId,
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
import {
  SUBSCRIPTION_POLLS_PATTERN,
  subscriptionPolling
} from "@flow-state-dev/workforce/internal";
import { z } from "zod";
import { REPO_ROOT, goalTmpDir, runGoal, silentLogger } from "../../lib/index.mts";
import { assertPatched, describePatches, modulePatchEnv, type ModulePatch } from "../../lib/module-patch.mts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "../delivers-each-event-once-to-its-subscribers/fixtures");
const ORG = "acme";
const CONTROL = process.env.GOAL_CONTROL ?? "";
const SCRATCH = process.env.GOAL_SCRATCH ?? goalTmpDir("webhook-routing-poll");
const MINUTE = 60_000;
const SF = "packages/workforce/src/subscriptions/service-flow.ts";

/** The controls: each degrades one behaviour in the code under test, as it loads. */
const PATCHES: Record<string, ModulePatch[]> = {
  // A poll row per subscription: one user's two sessions on a PR are two rows, two fetches a cadence.
  "poll-per-subscription": [
    {
      module: "packages/workforce/src/subscriptions/poll.ts",
      from: String.raw`  const key = pollKeyOf\(thread\);`,
      to: "  const key = `${pollKeyOf(thread)}~${Math.random().toString(36).slice(2)}`;"
    }
  ],
  // The mark moves every poll, whatever is still owed.
  "mark-moves": [
    {
      module: SF,
      from: String.raw`const polledThrough = owed\.length > 0 \? Math\.min\(\.\.\.owed\.map\(\(\[, , , , at\]\) => at\)\) : `,
      to: "const polledThrough = "
    }
  ],
  // The tick fires every row, due or not.
  "walk-all": [{ module: "packages/scheduled/src/tick.ts", from: String.raw`options\.index\.claimDue\(options\.now \?\? Date\.now\(\)`, to: "options.index.claimDue(8.64e15" }],
  // A row fires every minute: under the floor.
  "under-floor": [{ module: "packages/workforce/src/subscriptions/poll.ts", from: String.raw`return minutes === 60 \?`, to: 'return minutes !== 60 ? "* * * * *" : minutes === 60 ?' }],
  // A delivery never taken is owed forever: the row refetches it every poll.
  "hold-forever": [{ module: SF, from: String.raw`if \(polls < POLL_GIVE_UP_AFTER\) \{`, to: "if (true) {" }],
  // Validators sent while a delivery is owed: an unchanged answer hides the retry.
  "etag-while-held": [
    { module: SF, from: String.raw`\.\.\.\(owed\.length === 0 && input\.etags !== undefined \?`, to: "...(input.etags !== undefined ?" },
    { module: SF, from: String.raw`const etags = owed\.length === 0 \? \(fetched\?\.etags \?\? input\.etags\) : undefined;`, to: "const etags = fetched?.etags ?? input.etags;" }
  ],
  // A fire ignores the app's declared list: a declared routine that left config keeps polling.
  "keep-removed": [{ module: SF, from: String.raw`      if \(declared !== undefined\) \{`, to: "      if (false) {" }],
  // A subscription's own cadence is ignored: every row polls at the default.
  "ignore-cadence": [
    { module: "packages/workforce/src/subscriptions/subscribe.ts", from: String.raw`row\.everyMinutes \?\? polling\.everyMinutes`, to: "polling.everyMinutes" },
    { module: SF, from: String.raw`s\.everyMinutes \?\? polling!\.everyMinutes`, to: "polling!.everyMinutes" }
  ]
};

if (CONTROL !== "" && PATCHES[CONTROL] === undefined) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(PATCHES).join(", ")}`);
  process.exit(2);
}
if (PATCHES[CONTROL] !== undefined && process.env.GOAL_MODULE_PATCH === undefined) {
  const mark = join(SCRATCH, `patch-mark-${CONTROL}`);
  mkdirSync(SCRATCH, { recursive: true });
  rmSync(mark, { force: true });
  console.error(`control ${CONTROL}:\n${describePatches(PATCHES[CONTROL]!, REPO_ROOT)}`);
  const child = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, GOAL_SCRATCH: SCRATCH, ...modulePatchEnv(PATCHES[CONTROL]!, REPO_ROOT, mark) }
  });
  assertPatched(PATCHES[CONTROL]!, REPO_ROOT, mark);
  process.exit(child.status ?? 1);
}
mkdirSync(SCRATCH, { recursive: true });
// Each run starts from empty files.
for (const leg of ["leg1", "leg2", "leg3", "leg4"]) for (const suffix of ["", "-wal", "-shm"]) rmSync(join(SCRATCH, `${leg}.sqlite${suffix}`), { force: true });

// ---- the fixture, as a provider's timeline ------------------------------------

type FixtureSubscription = {
  label: string;
  user: string;
  input: { thread: string; kinds?: string[]; screens?: Array<{ screen: string; any?: string[]; ids?: string[] }>; outsiders?: true; interest: string };
  unsubscribeAt?: number;
};
const SUBSCRIPTIONS = JSON.parse(readFileSync(join(FIXTURES, "subscriptions.json"), "utf8")) as FixtureSubscription[];
const RAW = (JSON.parse(readFileSync(join(FIXTURES, "events.json"), "utf8")) as { events: SubscriptionEvent[] }).events;
/** The run's start: subscriptions are made two minutes before it. */
const T0 = Date.parse("2026-11-09T10:00:00Z");
/** FIX-2534's 300 events, one every 10 seconds from T0: a provider's timeline, oldest first. */
const EVENTS: SubscriptionEvent[] = RAW.map((e, i) => ({ ...e, at: T0 + i * 10_000 + 5_000, received: T0 + i * 10_000 + 5_000 }));
const END = EVENTS.at(-1)!.at;
/** After the timeline: long enough for any retry and any give-up (three polls). */
const TAIL = 30 * MINUTE;

const readable = (user: string, thread: string) => !thread.startsWith("github:acme/private-api") || user === "alice";
const BOTS = ["codex"];

// ---- the oracle: the spec's rules, written again here, not imported ----------

function pushOracle(sub: FixtureSubscription): string[] {
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
    if (e.closes === true && e.threads.at(-1) === sub.input.thread) break;
  }
  return out;
}

// ---- one boot of the app ------------------------------------------------------

/** One fetch: who asked, for what, at which beat of the tick (the clock runs on a few seconds past each beat), and from when. */
type Call = { user: string; thread: string; now: number; beat: number; since?: number; unchanged: boolean };
/** The beat the tick is running: the minute the run last moved to. */
let beat = 0;

interface BootOptions {
  readonly db: string;
  readonly push?: boolean;
  readonly declared?: () => readonly { readonly id: string }[];
  /** Delivery ids whose first dispatch is lost; whose take first fails; whose dispatch is always lost. */
  readonly losses?: { lost: Set<string>; untaken: Set<string>; never: Set<string> };
}

async function boot(options: BootOptions) {
  const indexDb = new Database(options.db);
  const calls: Call[] = [];
  const github: SubscriptionProvider = {
    provider: "github",
    canRead: (thread, ctx) => readable((ctx.session.identity as { userId: string }).userId, thread),
    self: (ctx) => `${(ctx.session.identity as { userId: string }).userId}-gh`,
    async poll(thread, cursor, ctx) {
      const user = (ctx.session.identity as { userId: string }).userId;
      const now = Date.now();
      const visible = EVENTS.filter((e) => e.threads.includes(thread) && e.at <= now);
      const etag = `"${visible.length}"`;
      const unchanged = cursor.etags?.thread === etag;
      calls.push({ user, thread, now, beat, ...(cursor.since === undefined ? {} : { since: cursor.since }), unchanged });
      if (unchanged) return { unchanged: true };
      return { events: visible.filter((e) => cursor.since === undefined || e.at >= cursor.since), through: now, etags: { thread: etag } };
    }
  };
  // The stores open the SQLite file and lay out its tables first; the index shares the file.
  const stores = sqliteStores({ filename: options.db });
  const flowsRef: Record<string, unknown> = {};
  const installation = createWorkerInstallation({
    standardWorkers: [{ id: "eng.follower", declared: { flow: "follower", description: "Follows threads." }, body: "", skills: [] } as WorkerManifest],
    workerFlows: () => flowsRef as never
  });
  let polling: ReturnType<typeof subscriptionPolling> | undefined;
  // The SQLite stores lay out the index's table as they open, after the flows are built: open the index on first use.
  let opened: ReturnType<typeof createSQLiteScheduleIndex> | undefined;
  const real = () => (opened ??= createSQLiteScheduleIndex(indexDb));
  const index: ReturnType<typeof createSQLiteScheduleIndex> = {
    upsert: (row) => real().upsert(row),
    remove: (row) => real().remove(row),
    claimDue: (now, limit) => real().claimDue(now, limit)
  };
  const pollingOf = () => (polling ??= subscriptionPolling({ index }));
  const doorInput = z.object({ message: z.string() });
  const door = handler({ name: "follower-run", inputSchema: doorInput, execute: async () => "ok" });
  let instances: Record<string, FlowInstance> = {};
  const build = () => {
    const tools = subscriptionTools({ providers: [github], poll: pollingOf() });
    flowsRef.follower = {
      roles: ["contributor"],
      flow: defineFlow({
        kind: "follower",
        configSchema: workerConfigSchema(),
        session: installation.session(),
        resources: { ...installation.resources, ...workerMessagesResources, ...subscriptionResources, ...pollingOf().resources },
        actions: {
          respond: { inputSchema: doorInput, block: door, userMessage: (i: { message: string }) => i.message },
          subscribe: { inputSchema: tools.subscribe.inputSchema, block: tools.subscribe },
          unsubscribe: { inputSchema: tools.unsubscribe.inputSchema, block: tools.unsubscribe }
        },
        internal: { actions: { onMessageReceived: messageReceivedEntry({ installation, flowKind: "follower" }) } },
        task: { actions: { work: workerTaskEntry({ name: "follower-task", turn: door }) } }
      })
    };
    instances = Object.fromEntries(hireWorkforce(installation).map((copy) => [copy.id === ROSTER_FLOW ? "roster" : copy.id, copy]));
    instances["github-service"] = defineSubscriptionServiceFlow({
      kind: "github-service",
      provider: github,
      installation,
      trustedBots: BOTS,
      capPerHour: 10_000,
      poll: { ...pollingOf(), ...(options.declared === undefined ? {} : { declared: options.declared }) }
    });
  };
  // The index's table exists once the stores initialized; the flows are built after.
  let captured: InboundTransportHost | undefined;
  build();
  const state = createFlowState({
    flows: instances,
    stores: { default: { primary: stores } },
    modelResolver: createMockModelResolver({}),
    logger: silentLogger,
    staleSweepIntervalMs: 0,
    adapters: [createScheduledTransportAdapter(), { source: "poll-goal", createBindings: (h: InboundTransportHost) => ((captured = h), {}) }],
    resolvePrincipal: (context: any) => {
      const user = context.request?.headers.get("x-user");
      return typeof user === "string" ? { userId: user, orgId: ORG } : null;
    }
  } as never);
  const router = (await state.getRouter()) as any;
  const runtime = await state.getRuntime();

  // Losses: a dispatch the store never recorded, a take that failed, as the FIX-2534 tests make them.
  const injected = { lost: 0, untaken: 0, never: 0 };
  if (options.losses !== undefined) {
    const { lost, untaken, never } = options.losses;
    const requests = runtime.stores.request as any;
    const set = requests.set.bind(requests);
    const lostOnce = new Set<string>();
    requests.set = async (id: string, record: any, ...rest: unknown[]) => {
      const messageId = record?.actionName === "onMessageReceived" ? (record.input as { messageId?: string })?.messageId : undefined;
      if (messageId !== undefined && (await requests.get(id)) === undefined) {
        if (never.has(messageId) || (lost.has(messageId) && !lostOnce.has(messageId))) {
          lostOnce.add(messageId);
          if (never.has(messageId)) injected.never += 1;
          else injected.lost += 1;
          throw new Error(`the store is down: request ${id} was not recorded`);
        }
      }
      return set(id, record, ...rest);
    };
    const rows = runtime.stores.resourceState as any;
    const setRow = rows.set.bind(rows);
    const failedTake = new Set<string>();
    rows.set = async (scopeType: string, scopeId: string, key: string, value: any, expected: unknown) => {
      if (key.startsWith(WORKER_MESSAGES_PATTERN.replace("*", "")) && value?.takenBy !== undefined && untaken.has(value.id) && !failedTake.has(value.id)) {
        failedTake.add(value.id);
        injected.untaken += 1;
        throw new Error("the store is down: the take was not written");
      }
      return setRow(scopeType, scopeId, key, value, expected);
    };
  }

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const settled = async () => {
    const running = (r: { status: string; finalizedAtMs?: number | null }) =>
      r.status === "in_progress" || (r.status !== "suspended" && r.status !== "pending" && r.finalizedAtMs == null);
    for (const deadline = Date.now() + 30_000; ; await sleep(5)) {
      const all = await runtime.stores.request.list({});
      if (!all.some(running)) {
        await sleep(5);
        const again = await runtime.stores.request.list({});
        if (!again.some(running) && again.length === all.length) return;
      }
      if (Date.now() > deadline) throw new Error("setup: a request never finished");
    }
  };

  const fires: Array<{ user: string; key: string; at: number; status: number }> = [];
  // The tick claims from the same index the rows mirror into.
  const tick = async () => {
    await runScheduleTick({
      index,
      dispatch: async (row, scheduleId) => {
        const { url, init } = scheduleDispatchRequest({ baseUrl: "http://localhost", flowKind: "github-service", row, scheduleId });
        const res = await router.POST(new Request(url, { ...init, headers: { ...init.headers, "x-user": "scheduler" } }), {
          params: { path: ["github-service", "schedules", scheduleId, "dispatch"] }
        });
        fires.push({ user: row.userId, key: row.key, at: row.nextFireAt, status: res.status });
        return res.status;
      }
    });
    await settled();
  };

  const createFollower = async (user: string): Promise<string> => {
    const res = await router.POST(
      new Request("http://localhost/api/flows/follower/sessions", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user": user },
        body: JSON.stringify({ userId: user, state: { workerId: "eng.follower" } })
      }),
      { params: { path: ["follower", "sessions"] } }
    );
    const body = (await res.json()) as { session?: { id: string } };
    if (body.session === undefined) throw new Error(`setup: creating ${user}'s follower failed (${res.status})`);
    return body.session.id;
  };
  const run = async (flow: FlowInstance, user: string, sessionId: string, action: string, input: unknown, source?: string) =>
    (await runAction({
      flow,
      actionName: action,
      input,
      userId: user,
      orgId: ORG,
      sessionId,
      ...(source === undefined ? {} : { source }),
      stores: runtime.stores,
      runtimeConfig: { ...runtime.runtimeConfig }
    })) as { output?: any; error?: unknown };
  const act = (user: string, sessionId: string, action: string, input: unknown) => run(instances.follower!, user, sessionId, action, input);
  /** Store a copy of `user`'s subscription `from` under `key`, as the declared routines' seed writes one. */
  const storeAs = async (user: string, from: string, key: string) => {
    const cell = `${user}:~org:${ORG}`;
    const row = await runtime.stores.resourceState.get("user", cell, `workforce/subscriptions/${from}`);
    await runtime.stores.resourceState.set("user", cell, `workforce/subscriptions/${key}`, { ...(row!.state as object), id: key } as never, "any" as never);
  };
  const route = async (event: SubscriptionEvent) => {
    const routed = await routeServiceEvent(captured!, { flowKind: "github-service", entry: "routeSubscriptionEvent", input: event, principal: { userId: "service:github", orgId: ORG } });
    if (routed.error !== undefined) throw new Error(`routing failed: ${JSON.stringify(routed.error)}`);
    await Promise.all(routed.ownerRuns.map((r) => r.finished));
    await settled();
  };

  /** Each user's message log rows from the service, by session and object version. */
  const landed = async () => {
    const out: Array<{ user: string; session: string; key: string; id: string; status: string }> = [];
    for (const user of ["alice", "bob"]) {
      const rows = await runtime.stores.resourceState.getByPrefix("user", `${user}:~org:${ORG}`, WORKER_MESSAGES_PATTERN.replace("*", ""));
      for (const value of Object.values(rows)) {
        const row = value.state as { id: string; from: string; toSession: string; status: string };
        if (!row.from.startsWith("service:") || row.id.endsWith(":gave-up")) continue;
        const base = row.id.slice(0, -(row.toSession.length + 1));
        const [object, version] = base.slice("sub_".length).split("@");
        out.push({ user, session: row.toSession, key: `${decodeURIComponent(object!)}@${version}`, id: row.id, status: row.status });
      }
    }
    return out;
  };
  const rowsAt = async (user: string, pattern: string) =>
    Object.values(await runtime.stores.resourceState.getByPrefix("user", `${user}:~org:${ORG}`, pattern.replace("*", ""))).map((v) => v.state as Record<string, any>);

  return { calls, fires, tick, createFollower, act, storeAs, route, landed, rowsAt, injected, dispose: async () => (await state.dispose(), indexDb.close()) };
}

// ---- the legs ----------------------------------------------------------------

type App = Awaited<ReturnType<typeof boot>>;

/** Subscribe the fixture's 24, two minutes before the timeline starts. */
async function subscribeAll(app: App) {
  moveTo(T0 - 2 * MINUTE);
  const sessions = new Map<string, string>();
  const ids = new Map<string, string>();
  for (const sub of SUBSCRIPTIONS) {
    const sessionId = await app.createFollower(sub.user);
    sessions.set(sub.label, sessionId);
    const out = await app.act(sub.user, sessionId, "subscribe", { provider: "github", ...sub.input });
    if (out.output?.id !== undefined) ids.set(sub.label, out.output.id);
  }
  return { sessions, ids };
}

/** Run the clock a minute at a time over the timeline and its tail: unsubscribes at their event, pushes when on, a tick each minute. */
async function runTimeline(app: App, made: Awaited<ReturnType<typeof subscribeAll>>, push: boolean) {
  const unsubscribedAt = new Map<string, number>();
  let next = 0;
  for (let t = T0; t <= END + TAIL; t += MINUTE) {
    for (; next < EVENTS.length && EVENTS[next]!.at <= t; next += 1) {
      moveTo(EVENTS[next]!.at);
      for (const sub of SUBSCRIPTIONS) {
        if (sub.unsubscribeAt === next && made.ids.has(sub.label)) {
          await app.act(sub.user, made.sessions.get(sub.label)!, "unsubscribe", { id: made.ids.get(sub.label) });
          unsubscribedAt.set(sub.label, Date.now());
        }
      }
      if (push) await app.route(EVENTS[next]!);
    }
    moveTo(t);
    beat = t;
    await app.tick();
  }
  return unsubscribedAt;
}

/** What a polled subscription hears: push's set, less what its row hadn't fetched when it unsubscribed. */
function pollOracle(sub: FixtureSubscription, calls: Call[], unsubscribedAt: Map<string, number>): string[] {
  const want = pushOracle(sub);
  const ended = unsubscribedAt.get(sub.label);
  if (ended === undefined) return want;
  const lastPoll = Math.max(-1, ...calls.filter((c) => c.user === sub.user && c.thread === sub.input.thread && c.now <= ended).map((c) => c.now));
  return want.filter((key) => EVENTS.find((e) => `${e.object.id}@${e.object.version}` === key)!.at <= lastPoll);
}

const sorted = (xs: string[]) => [...xs].sort();

await runGoal(async (failures, tell) => {
  const evidence: string[] = [];
  /** (a): each session's delivered rows equal its oracle exactly, once each. */
  const gradeRows = (leg: string, landed: Awaited<ReturnType<App["landed"]>>, sessions: Map<string, string>, oracle: (sub: FixtureSubscription) => string[]) => {
    tell.over(`${leg} · a · rows landed`, landed);
    tell.over(`${leg} · a · expected deliveries`, SUBSCRIPTIONS.flatMap((s) => oracle(s)));
    for (const sub of SUBSCRIPTIONS) {
      const got = landed.filter((l) => l.session === sessions.get(sub.label) && l.status === "delivered").map((l) => l.key);
      const want = oracle(sub);
      if (JSON.stringify(sorted(got)) !== JSON.stringify(sorted(want))) {
        const missing = want.filter((k) => !got.includes(k));
        const extra = got.filter((k) => !want.includes(k));
        failures.push(`${leg} · a: ${sub.label} got ${got.length}, expected ${want.length} (missing ${missing.slice(0, 3).join(", ") || "none"}; extra ${extra.slice(0, 3).join(", ") || "none"})`);
      }
    }
  };
  /** (b), (c): every row's fires are exactly its cadence apart, so none under the floor and none when not due. */
  const gradeFires = (leg: string, fires: App["fires"], cadence: (key: string) => number) => {
    const byRow = new Map<string, number[]>();
    for (const f of fires) byRow.set(`${f.user} ${f.key}`, [...(byRow.get(`${f.user} ${f.key}`) ?? []), f.at]);
    tell.over(`${leg} · b · fires`, fires);
    for (const [row, times] of byRow) {
      const minutes = cadence(row.split(" ")[1]!);
      for (let i = 1; i < times.length; i += 1) {
        const gap = (times[i]! - times[i - 1]!) / MINUTE;
        if (gap < 5) failures.push(`${leg} · b: ${row} fired ${gap} minute(s) after its last fire`);
        else if (gap !== minutes) failures.push(`${leg} · c: ${row} fired ${gap} minutes after its last, not at its ${minutes}-minute cadence`);
        if (gap < 5 || gap !== minutes) break;
      }
    }
    const refused = fires.filter((f) => f.status !== 202);
    if (refused.length > 0) failures.push(`${leg} · c: ${refused.length} fire(s) not accepted (first ${refused[0]!.status})`);
  };
  /** (f), (l): each fetch ran as the row's own user, and a user fetched a thread at most once a cadence. */
  const gradeFetches = (leg: string, calls: Call[]) => {
    tell.over(`${leg} · l · fetches`, calls);
    const byPair = new Map<string, number[]>();
    for (const c of calls) byPair.set(`${c.user} ${c.thread}`, [...(byPair.get(`${c.user} ${c.thread}`) ?? []), c.beat]);
    for (const [pair, times] of byPair) {
      // By beat: two fetches a cadence apart are exactly a cadence of beats apart.
      const close = times.slice(1).filter((t, i) => t - times[i]! < 5 * MINUTE).length;
      if (close > 0) failures.push(`${leg} · l: ${pair} was fetched ${close} time(s) within five minutes of its last fetch`);
    }
    const twoSessions = tell.over(`${leg} · l · alice's fetches of #412 (two sessions)`, calls.filter((c) => c.user === "alice" && c.thread === "github:acme/api#412"));
    if (twoSessions.length === 0) failures.push(`${leg} · l: alice's two sessions on #412 were never fetched`);
    // (f): bob never polls a thread only alice can read.
    const crossing = calls.filter((c) => !readable(c.user, c.thread));
    tell.over(`${leg} · f · fetches of a thread their user can't read`, crossing, { emptyIs: "the claim: no poll ran on another user's access" });
    for (const c of crossing.slice(0, 3)) failures.push(`${leg} · f: ${c.user} polled ${c.thread}`);
  };
  const defaultCadence = () => 5;

  // ---- leg 1: polled only, webhook off ------------------------------------------
  {
    const app = await boot({ db: join(SCRATCH, "leg1.sqlite") });
    const made = await subscribeAll(app);
    const ended = await runTimeline(app, made, false);
    const landed = await app.landed();
    gradeRows("leg 1", landed, made.sessions, (sub) => pollOracle(sub, app.calls, ended));
    gradeFires("leg 1", app.fires, defaultCadence);
    gradeFetches("leg 1", app.calls);
    const unchanged = tell.over("leg 1 · d · unchanged polls", app.calls.filter((c) => c.unchanged));
    evidence.push(`leg 1: ${landed.length} rows over ${made.ids.size} subscriptions, ${app.fires.length} fires, ${app.calls.length} fetches (${unchanged.length} unchanged)`);
    await app.dispose();
  }

  // ---- leg 2: polled, with lost and never-taken deliveries ----------------------
  {
    // Losses on each session's last expected delivery, so no later event on its thread can carry the retry.
    const lastOf = SUBSCRIPTIONS.filter((s) => s.unsubscribeAt === undefined && pushOracle(s).length > 0).map((s) => ({ sub: s, key: pushOracle(s).at(-1)! }));
    const pick = (from: number, n: number) => lastOf.slice(from, from + n);
    const app = await boot({ db: join(SCRATCH, "leg2.sqlite") });
    const made = await subscribeAll(app);
    const idOf = (p: { sub: FixtureSubscription; key: string }) => {
      const [object, version] = p.key.split("@");
      return deliveryMessageId({ id: object!, version: Number(version) }, made.sessions.get(p.sub.label)!);
    };
    const lost = pick(0, 10);
    const untaken = pick(10, 4);
    const never = pick(14, 1);
    const losses = { lost: new Set(lost.map(idOf)), untaken: new Set(untaken.map(idOf)), never: new Set(never.map(idOf)) };
    await app.dispose();
    const lossy = await boot({ db: join(SCRATCH, "leg2.sqlite"), losses });
    const ended = await runTimeline(lossy, made, false);
    const landed = await lossy.landed();
    const neverKey = never.map((p) => `${p.sub.label} ${p.key}`);
    gradeRows("leg 2", landed, made.sessions, (sub) => pollOracle(sub, lossy.calls, ended).filter((key) => !neverKey.includes(`${sub.label} ${key}`)));
    // (e): each lost or untaken delivery landed exactly once, after its loss.
    tell.over("leg 2 · e · injected losses", Array.from({ length: lossy.injected.lost + lossy.injected.untaken }));
    if (lossy.injected.lost < lost.length) failures.push(`leg 2 · e: only ${lossy.injected.lost} of ${lost.length} planned losses happened`);
    for (const p of [...lost, ...untaken]) {
      const rows = landed.filter((l) => l.id === idOf(p) && l.status === "delivered");
      if (rows.length !== 1) failures.push(`leg 2 · e: ${p.sub.label}'s lost ${p.key} landed ${rows.length} time(s)`);
    }
    // (i): the never-taken one was given up after three polls: nothing owed at the end, and the mark moved past it.
    tell.over("leg 2 · i · never-taken deliveries", never);
    for (const p of never) {
      const neverAt = EVENTS.find((e) => `${e.object.id}@${e.object.version}` === p.key)!.at;
      const row = (await lossy.rowsAt(p.sub.user, SUBSCRIPTION_POLLS_PATTERN)).find((r) => r.input.thread === p.sub.input.thread);
      if (row === undefined || (row.input.owed ?? []).length > 0 || !(row.input.polledThrough > neverAt)) {
        failures.push(`leg 2 · i: ${p.sub.label}'s never-taken ${p.key} is still owed (mark ${row?.input.polledThrough}, its time ${neverAt})`);
      }
    }
    gradeFires("leg 2", lossy.fires, defaultCadence);
    evidence.push(`leg 2: ${lossy.injected.lost} lost, ${lossy.injected.untaken} untaken, ${lossy.injected.never} never-taken dispatches; ${landed.length} rows`);
    await lossy.dispose();
  }

  // ---- leg 3: pushed and polled -------------------------------------------------
  {
    const app = await boot({ db: join(SCRATCH, "leg3.sqlite") });
    const made = await subscribeAll(app);
    await runTimeline(app, made, true);
    const landed = await app.landed();
    gradeRows("leg 3", landed, made.sessions, pushOracle);
    const twice = landed.filter((l, i) => landed.findIndex((m) => m.id === l.id) !== i);
    if (twice.length > 0) failures.push(`leg 3 · a: ${twice.length} delivery(ies) landed twice`);
    evidence.push(`leg 3: ${landed.length} rows, pushed and polled`);
    await app.dispose();
  }

  // ---- leg 4: cadence, a restart, and a declared routine leaving config ---------
  // The declared routines' seed is FIX-2614's; this leg stands in for its row (a cfg_ copy) and grades what polling owns.
  {
    let declared: Array<{ id: string }> = [{ id: "web-pr" }];
    const db = join(SCRATCH, "leg4.sqlite");
    moveTo(T0 - 2 * MINUTE);
    const cold = await boot({ db, declared: () => declared });
    const repoSession = await cold.createFollower("alice");
    const webSession = await cold.createFollower("alice");
    await cold.act("alice", repoSession, "subscribe", { provider: "github", thread: "github:acme/api", interest: "the repo", everyMinutes: 15 });
    const web = (await cold.act("alice", webSession, "subscribe", { provider: "github", thread: "github:acme/web#9", interest: "the web PR" })).output?.id as string;
    // The declared routines' key for entry web-pr, written again here, not imported: cfg_ and a hash of the roster flow and the entry id.
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode("workforce-roster\nweb-pr")));
    const declaredKey = `cfg_${[...digest.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
    await cold.storeAs("alice", web, declaredKey);
    const three = await cold.act("alice", repoSession, "subscribe", { provider: "github", thread: "github:acme/web", interest: "too often", everyMinutes: 3 });
    for (let t = T0; t <= T0 + 30 * MINUTE; t += MINUTE) {
      moveTo(t);
      beat = t;
      await cold.tick();
    }
    const coldRows = (await cold.landed()).length;
    const coldFires = [...cold.fires];
    const pollsBefore = (await cold.rowsAt("alice", SUBSCRIPTION_POLLS_PATTERN)).length;
    await cold.dispose();
    // A restart: a new process over the same file adds no poll row, and the rows keep firing.
    const warm = await boot({ db, declared: () => declared });
    const pollsAfter = (await warm.rowsAt("alice", SUBSCRIPTION_POLLS_PATTERN)).length;
    tell.over("leg 4 · j · poll rows before the restart", Array.from({ length: pollsBefore }));
    if (pollsAfter !== pollsBefore || pollsBefore !== 2) failures.push(`leg 4 · j: ${pollsBefore} poll row(s) before the restart, ${pollsAfter} after, for two threads`);
    if (coldRows === 0) failures.push("leg 4 · j: the polled subscriptions heard nothing");
    // The declared entry leaves config: its row ends at its next fire; the session's own subscription stays.
    declared = [];
    for (let t = T0 + 31 * MINUTE; t <= T0 + 50 * MINUTE; t += MINUTE) {
      moveTo(t);
      beat = t;
      await warm.tick();
    }
    const after = await warm.rowsAt("alice", "workforce/subscriptions/*");
    const removed = after.find((r) => r.id === declaredKey);
    if (removed?.enabled !== false || removed.endedReason !== "config_removed") failures.push(`leg 4 · j: the removed entry's row is ${JSON.stringify({ enabled: removed?.enabled, endedReason: removed?.endedReason })}`);
    if (after.find((r) => r.id === web)?.enabled !== true) failures.push("leg 4 · j: the session's own subscription ended with the declared one");
    if (warm.fires.length === 0) failures.push("leg 4 · j: nothing fired after the restart");
    // (k): the 15-minute row fires 15 minutes apart; a cadence of 3 is refused.
    const all = [...coldFires, ...warm.fires];
    const repoKey = encodeURIComponent("github:acme/api");
    const repoFires = tell.over("leg 4 · k · the 15-minute row's fires", all.filter((f) => f.key === repoKey));
    gradeFires("leg 4", all, (key) => (key === repoKey ? 15 : 5));
    if (repoFires.length < 3) failures.push(`leg 4 · k: the 15-minute row fired ${repoFires.length} time(s) in 50 minutes`);
    if (three.output?.id !== undefined) failures.push("leg 4 · k: a cadence of 3 was accepted");
    evidence.push(`leg 4: ${pollsBefore} poll rows before a restart and ${pollsAfter} after; the repo row fired ${repoFires.length} times; the removed declared row ${removed?.endedReason}`);
    await warm.dispose();
  }

  return { failures, evidence: evidence.join("; ") };
});
void at;
