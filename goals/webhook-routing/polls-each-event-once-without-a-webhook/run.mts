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
import type { ScheduleTicker } from "@flow-state-dev/engine/host";
import { routeServiceEvent } from "@flow-state-dev/engine/internal";
import { type InboundTransportHost } from "@flow-state-dev/engine/host";
import { defaultParseScheduleId } from "@flow-state-dev/scheduled/collection";
import { createSQLiteScheduleIndex, sqliteStores } from "@flow-state-dev/store-sqlite";
import { createMockModelResolver } from "@flow-state-dev/testing";
import {
  ROSTER_FLOW,
  WORKER_MESSAGES_PATTERN,
  defineSubscriptionServiceFlow,
  deliveryMessageId,
  messageReceivedEntry,
  subscriptionResources,
  workerConfigSchema,
  workerFlow,
  workerMessagesResources,
  workerTaskEntry,
  type DeclaredRoutine,
  type SubscriptionProvider,
  type WorkerInstallation
} from "@flow-state-dev/workforce";
import { workforce } from "@flow-state-dev/workforce/kit";
import { SUBSCRIPTION_POLLS_PATTERN, workerRoutineVerbs } from "@flow-state-dev/workforce/internal";
import { z } from "zod";
import { REPO_ROOT, goalTmpDir, runGoal, silentLogger, workforceTree } from "../../lib/index.mts";
import { assertPatched, describePatches, modulePatchEnv, type ModulePatch } from "../../lib/module-patch.mts";
import { sleep } from "../../lib/time.mts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "../delivers-each-event-once-to-its-subscribers/fixtures");
const ORG = "acme";
const CONTROL = process.env.GOAL_CONTROL ?? "";
const SCRATCH = process.env.GOAL_SCRATCH ?? goalTmpDir("webhook-routing-poll");
const MINUTE = 60_000;
// The bearer the app's schedule tick dispatches with, which the run's principal resolver admits as the scheduler.
process.env.CRON_SECRET ??= "poll-goal-scheduler";
const SF = "packages/workforce/src/service-flows/service-flow.ts";
/** A schedule session id's prefix: (m) and (n) recognise one by it, and never derive the id. */
const SCHEDULE_SESSION = "fsd-schedule.";

/** The controls: each degrades one behaviour in the code under test, as it loads. */
const PATCHES: Record<string, ModulePatch[]> = {
  // A poll per subscription: one user's two sessions on a PR are two polls, two fetches a cadence.
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
  // The tick fires every poll, due or not.
  "walk-all": [{ module: "packages/engine/src/execution/schedule-tick.ts", from: String.raw`index\.claimDue\(now,`, to: "index.claimDue(8.64e15," }],
  // A poll fires every minute: under the floor.
  "under-floor": [{ module: "packages/workforce/src/subscriptions/poll.ts", from: String.raw`return minutes === 60 \?`, to: 'return minutes !== 60 ? "* * * * *" : minutes === 60 ?' }],
  // A delivery never taken is owed forever: the poll refetches it every time.
  "hold-forever": [{ module: SF, from: String.raw`if \(polls < POLL_GIVE_UP_AFTER\) \{`, to: "if (true) {" }],
  // Validators sent while a delivery is owed: an unchanged answer hides the retry.
  "etag-while-held": [
    { module: SF, from: String.raw`\.\.\.\(owed\.length === 0 && input\.etags !== undefined \?`, to: "...(input.etags !== undefined ?" },
    { module: SF, from: String.raw`const etags = owed\.length === 0 \? \(fetched\?\.etags \?\? input\.etags\) : undefined;`, to: "const etags = fetched?.etags ?? input.etags;" }
  ],
  // A fire ignores the app's declared list: a declared routine that left config keeps polling.
  "keep-removed": [
    {
      module: SF,
      from: String.raw`for \(const sub of subs\.filter\(\(s\) => s\.id\.startsWith\(DECLARED_ROUTINE_KEY_PREFIX\) && !kept\.has\(s\.id\)\)\)`,
      to: "for (const sub of [] as typeof subs)"
    },
    { module: SF, from: String.raw`subs = subs\.filter\(\(s\) => !s\.id\.startsWith\(DECLARED_ROUTINE_KEY_PREFIX\) \|\| kept\.has\(s\.id\)\);`, to: "" }
  ],
  // A subscription's own cadence is ignored: every poll runs at the default.
  "ignore-cadence": [
    { module: "packages/workforce/src/subscriptions/subscribe.ts", from: String.raw`moved\.now\.everyMinutes \?\? write\.polling\.everyMinutes`, to: "write.polling.everyMinutes" },
    { module: SF, from: String.raw`s\.everyMinutes \?\? polling!\.everyMinutes`, to: "polling!.everyMinutes" }
  ],
  // The poll resolver names no session: every fire runs alone, in a one-off session.
  "session-per-fire": [{ module: SF, from: String.raw`session: "per-schedule"`, to: "" }],
  // The create route takes a schedule session id from a client.
  "no-reserve": [{ module: "packages/engine/src/routes/session-routes.ts", from: String.raw`if \(isScheduleSessionId\(sessionId\)\) \{`, to: "if (false) {" }],
  // The schedule session id joins its parts with colons, so the tenant header can carry its head.
  "colon-id": [
    {
      module: "packages/engine/src/transports/scheduled/schedule-session-id.ts",
      from: String.raw`return \`\$\{SCHEDULE_SESSION_PREFIX\}\$\{encoded\}\`;`,
      to: "return `${SCHEDULE_SESSION_PREFIX}${[parts.orgId, parts.userId, parts.flowId, parts.scheduleId].join(\":\")}`;"
    }
  ],
  // Retry, continue and resume re-enter a request in a schedule's session.
  "reentry-open": [{ module: "packages/engine/src/routes/public-reentry.ts", from: String.raw`if \(request\.sessionId != null && isScheduleSessionId\(request\.sessionId\)\) return false;`, to: "" }],
  // A poll's fire runs whether or not its last is still running.
  "overlap-allow": [{ module: "packages/workforce/src/subscriptions/poll.ts", from: String.raw`onOverlap: "skip",`, to: 'onOverlap: "allow",' }]
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
for (const leg of ["probe", "leg1", "leg2", "leg3", "leg4"]) for (const suffix of ["", "-wal", "-shm"]) rmSync(join(SCRATCH, `${leg}.sqlite${suffix}`), { force: true });

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

/** One fetch: who asked, for what, at which beat of the tick (the clock runs on a few seconds past each beat), and from when; `failed` when the provider refused it. */
type Call = { user: string; thread: string; now: number; beat: number; since?: number; unchanged: boolean; failed?: true };
/** One user's poll of one thread, from the beat on: the provider's trouble with it. */
type Trouble = { user: string; thread: string; from: number };
/** A fetch the provider failed: when, and the events it would have answered that no earlier fetch had. */
type Failed = { beat: number; missed: SubscriptionEvent[] };
/** A fetch whose answer the provider held: when, the time its answer stands at, and its release. */
type Held = { beat: number; now: number; release: () => void; released: boolean };
/** The beat the tick is running: the minute the run last moved to. */
let beat = 0;

interface BootOptions {
  readonly db: string;
  readonly push?: boolean;
  /** The app's declared routines, as its config lists them at this boot. */
  readonly declared?: readonly DeclaredRoutine[];
  /** Delivery ids whose first dispatch is lost; whose take first fails; whose dispatch is always lost. */
  readonly losses?: { lost: Set<string>; untaken: Set<string>; never: Set<string> };
  /** The provider fails this poll's first fetch from `from` that has something new, once. */
  readonly failOnce?: Trouble;
  /** The provider holds this poll's first answer from `from` that an event follows within a cadence, until the run releases it. */
  readonly holdOnce?: Trouble;
}

async function boot(options: BootOptions) {
  const indexDb = new Database(options.db);
  const calls: Call[] = [];
  const looked = new Map<string, number>();
  let failed: Failed | undefined;
  let held: Held | undefined;
  /** Fetches waiting on a held answer: requests that may stay running while the run moves on. */
  let holding = 0;
  const is = (t: Trouble | undefined, user: string, thread: string) => t !== undefined && t.user === user && t.thread === thread && beat >= t.from;
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
      const since = cursor.since === undefined ? {} : { since: cursor.since };
      const missed = visible.filter((e) => e.at > (looked.get(`${user} ${thread}`) ?? -Infinity));
      if (failed === undefined && is(options.failOnce, user, thread) && missed.length > 0) {
        failed = { beat, missed };
        calls.push({ user, thread, now, beat, ...since, unchanged: false, failed: true });
        throw new Error("the provider is down: the poll was not answered");
      }
      looked.set(`${user} ${thread}`, now);
      calls.push({ user, thread, now, beat, ...since, unchanged });
      if (unchanged) return { unchanged: true };
      const answer = { events: visible.filter((e) => cursor.since === undefined || e.at >= cursor.since), through: now, etags: { thread: etag } };
      // Held as it stood when asked: what happens on the thread meanwhile is the next fire's.
      if (held === undefined && is(options.holdOnce, user, thread) && EVENTS.some((e) => e.threads.includes(thread) && e.at > now && e.at <= now + 5 * MINUTE)) {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => (release = resolve));
        held = { beat, now, release: () => ((held!.released = true), release()), released: false };
        holding += 1;
        await gate;
        holding -= 1;
      }
      return answer;
    }
  };
  // The stores open the SQLite file and lay out its tables first; the index shares the file.
  const stores = sqliteStores({ filename: options.db });
  const directory = workforceTree([{ id: "eng.follower", declared: { flow: "follower", description: "Follows threads." }, body: "" }]);
  // The SQLite stores lay out the index's table as they open, after the flows are built: open the index on first use.
  let opened: ReturnType<typeof createSQLiteScheduleIndex> | undefined;
  const real = () => (opened ??= createSQLiteScheduleIndex(indexDb));
  const index: ReturnType<typeof createSQLiteScheduleIndex> = {
    upsert: (entry) => real().upsert(entry),
    ensure: (entry) => real().ensure(entry),
    remove: (entry) => real().remove(entry),
    claimDue: (now, limit) => real().claimDue(now, limit)
  };
  const doorInput = z.object({ message: z.string() });
  const door = handler({ name: "follower-run", inputSchema: doorInput, execute: async () => "ok" });
  const follower = workerFlow(
    (installation) => {
      // The worker verbs as actions, called as a model would; their providers and polling come from the kit's routines.
      const tools = workerRoutineVerbs(installation);
      return defineFlow({
        kind: "follower",
        configSchema: workerConfigSchema(),
        session: installation.session(),
        resources: { ...installation.resources, ...workerMessagesResources, ...subscriptionResources },
        actions: {
          respond: { inputSchema: doorInput, block: door, userMessage: (i: { message: string }) => i.message },
          ...Object.fromEntries([tools.listRoutines, tools.saveRoutine, tools.pauseRoutine, tools.deleteRoutine].map((block) => [block.name, { inputSchema: block.inputSchema, block }]))
        },
        internal: { actions: { onMessageReceived: messageReceivedEntry({ installation, flowKind: "follower" }) } },
        task: { actions: { work: workerTaskEntry({ name: "follower-task", turn: door }) } }
      });
    },
    { roles: ["contributor"] }
  );
  // Polling, configured once: its own index, beside the routines' providers and the app's declared routines.
  const routines = { providers: [github], poll: { index }, ...(options.declared === undefined ? {} : { declared: options.declared }) };
  /** The service flow, built on the installation the kit hires. */
  const service = (installation: WorkerInstallation): FlowInstance[] => [
    defineSubscriptionServiceFlow({
      kind: "github-service",
      provider: github,
      installation,
      trustedBots: BOTS,
      capPerHour: 10_000,
      poll: true
    }) as FlowInstance
  ];
  // The index's table exists once the stores initialized; the kit builds the flows at start.
  let captured: InboundTransportHost | undefined;
  // The app's own schedule tick, beaten by the run each minute.
  let ticker: ScheduleTicker | undefined;
  const state = createFlowState({
    scheduler: { start: (t: ScheduleTicker) => ((ticker = t), { stop: async () => undefined }) },
    kits: [workforce({ directory, routines })],
    fill: { [workforce.slots.workerFlows]: { follower }, [workforce.slots.flows]: { service } },
    stores: { default: { primary: stores } },
    modelResolver: createMockModelResolver({}),
    logger: silentLogger,
    staleSweepIntervalMs: 0,
    adapters: [{ source: "poll-goal", createBindings: (h: InboundTransportHost) => ((captured = h), {}) }],
    resolvePrincipal: (context: any) => {
      // The tick's dispatch carries `CRON_SECRET` as its bearer.
      if (context.request?.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`) return { userId: "scheduler", orgId: ORG };
      const user = context.request?.headers.get("x-user");
      return typeof user === "string" ? { userId: user, orgId: ORG } : null;
    }
  } as never);
  const router = (await state.getRouter()) as any;
  const runtime = await state.getRuntime();
  // The dispatch endpoint's own answer to each fire the tick sends through this router: the tick reports only its status.
  const answers: Array<{ scheduleId: string; at: number; status: number; body: { status?: string; requestId?: string } }> = [];
  const post = router.POST.bind(router);
  router.POST = async (request: Request, context: { params: { path: string[] } }) => {
    const path = context?.params?.path ?? [];
    if (path[0] !== "github-service" || path[1] !== "schedules" || path[3] !== "dispatch") return post(request, context);
    const at = Date.parse((JSON.parse(await request.clone().text()) as { nominalFireTime: string }).nominalFireTime);
    const response: Response = await post(request, context);
    answers.push({ scheduleId: path[2]!, at, status: response.status, body: await response.clone().json().catch(() => ({})) });
    return response;
  };
  /** Send `method` to the router at `path` (under `/api/flows/`) as `user`: its status and body. */
  const http = async (method: "GET" | "POST", path: string[], user: string, body?: unknown, headers: Record<string, string> = {}) => {
    const response: Response = await router[method](
      new Request(`http://localhost/api/flows/${path.map(encodeURIComponent).join("/")}`, {
        method,
        headers: { "content-type": "application/json", "x-user": user, ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      }),
      { params: { path } }
    );
    return { status: response.status, body: (await response.json().catch(() => ({}))) as any };
  };
  /** A flow the kit serves, by id. */
  const served = (id: string): FlowInstance =>
    runtime.registry.get(id) ??
    (() => {
      throw new Error(`setup: the workforce kit serves no "${id}" flow`);
    })();

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
    const resources = runtime.stores.resourceState as any;
    const setResource = resources.set.bind(resources);
    const failedTake = new Set<string>();
    resources.set = async (scopeType: string, scopeId: string, key: string, value: any, expected: unknown) => {
      if (key.startsWith(WORKER_MESSAGES_PATTERN.replace("*", "")) && value?.takenBy !== undefined && untaken.has(value.id) && !failedTake.has(value.id)) {
        failedTake.add(value.id);
        injected.untaken += 1;
        throw new Error("the store is down: the take was not written");
      }
      return setResource(scopeType, scopeId, key, value, expected);
    };
  }

  const settled = async () => {
    const running = (r: { status: string; finalizedAtMs?: number | null }) =>
      r.status === "in_progress" || (r.status !== "suspended" && r.status !== "pending" && r.finalizedAtMs == null);
    for (const deadline = Date.now() + 30_000; ; await sleep(5)) {
      // A fetch the provider holds keeps its request running: the run moves on past it.
      const all = await runtime.stores.request.list({});
      if (all.filter(running).length <= holding) {
        await sleep(5);
        const again = await runtime.stores.request.list({});
        if (again.filter(running).length <= holding && again.length === all.length) return;
      }
      if (Date.now() > deadline) throw new Error("setup: a request never finished");
    }
  };

  const fires: Array<{ user: string; key: string; at: number; status: number }> = [];
  // The tick claims from the same index the polls mirror into.
  const tick = async () => {
    const report = await ticker!.tick();
    for (const fire of report.dispatched) {
      if (fire.flowKind !== "github-service") continue;
      const id = defaultParseScheduleId(fire.scheduleId)!;
      fires.push({ user: id.userId, key: id.collectionKey, at: fire.nominalFireTime, status: fire.status });
    }
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
  /** Save an event routine in `sessionId` as a model would: its subscription's id, or why it was refused. */
  const subscribe = async (user: string, sessionId: string, event: Record<string, unknown>): Promise<{ id?: string; refused?: string }> => {
    const answer = (await run(served("follower"), user, sessionId, "saveRoutine", { trigger: { event: { provider: "github", ...event } } })).output;
    return answer?.ok === true ? { id: String(answer.routine.id).replace(/^event:/, "") } : { refused: answer?.error ?? "no answer" };
  };
  /** Delete the event routine on subscription `id`, as a model would. */
  const unsubscribe = (user: string, sessionId: string, id: string) => run(served("follower"), user, sessionId, "deleteRoutine", { id: `event:${id}` });
  /** One roster run for `user`: its request seeds the app's declared routines. */
  const seed = (user: string) => run(served(ROSTER_FLOW), user, `roster-${user}`, "listRoutines", {});
  const route = async (event: SubscriptionEvent) => {
    const routed = await routeServiceEvent(captured!, { flowKind: "github-service", entry: "routeSubscriptionEvent", input: event, principal: { userId: "service:github", orgId: ORG } });
    if (routed.error !== undefined) throw new Error(`routing failed: ${JSON.stringify(routed.error)}`);
    await Promise.all(routed.ownerRuns.map((r) => r.finished));
    await settled();
  };

  /** Each user's message log from the service, by session and object version. */
  const landed = async () => {
    const out: Array<{ user: string; session: string; key: string; id: string; status: string }> = [];
    for (const user of ["alice", "bob"]) {
      const log = await runtime.stores.resourceState.getByPrefix("user", `${user}:~org:${ORG}`, WORKER_MESSAGES_PATTERN.replace("*", ""));
      for (const value of Object.values(log)) {
        const message = value.state as { id: string; from: string; toSession: string; status: string };
        if (!message.from.startsWith("service:") || message.id.endsWith(":gave-up")) continue;
        const base = message.id.slice(0, -(message.toSession.length + 1));
        const [object, version] = base.slice("sub_".length).split("@");
        out.push({ user, session: message.toSession, key: `${decodeURIComponent(object!)}@${version}`, id: message.id, status: message.status });
      }
    }
    return out;
  };
  const storedAt = async (user: string, pattern: string) =>
    Object.values(await runtime.stores.resourceState.getByPrefix("user", `${user}:~org:${ORG}`, pattern.replace("*", ""))).map((v) => v.state as Record<string, any>);

  /** Release the held answer, and wait for its fire to finish. */
  const release = async () => {
    held!.release();
    await settled();
  };

  return {
    calls,
    fires,
    answers,
    http,
    stores: runtime.stores,
    trouble: () => ({ failed, held }),
    release,
    settled,
    tick,
    createFollower,
    subscribe,
    unsubscribe,
    seed,
    route,
    landed,
    storedAt,
    injected,
    dispose: async () => (await state.dispose(), indexDb.close())
  };
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
    const out = await app.subscribe(sub.user, sessionId, sub.input);
    if (out.id !== undefined) ids.set(sub.label, out.id);
  }
  return { sessions, ids };
}

/** Run the clock a minute at a time over the timeline and its tail: unsubscribes at their event, pushes when on, a tick each minute. */
async function runTimeline(app: App, made: Awaited<ReturnType<typeof subscribeAll>>, push: boolean, afterBeat?: (t: number) => Promise<void>) {
  const unsubscribedAt = new Map<string, number>();
  let next = 0;
  // Every minute from the subscriptions on, as a host's tick runs: a first beat late would fire a poll late, and its next fire would come early.
  for (let t = T0 - MINUTE; t <= END + TAIL; t += MINUTE) {
    for (; next < EVENTS.length && EVENTS[next]!.at <= t; next += 1) {
      moveTo(EVENTS[next]!.at);
      for (const sub of SUBSCRIPTIONS) {
        if (sub.unsubscribeAt === next && made.ids.has(sub.label)) {
          await app.unsubscribe(sub.user, made.sessions.get(sub.label)!, made.ids.get(sub.label)!);
          unsubscribedAt.set(sub.label, Date.now());
        }
      }
      if (push) await app.route(EVENTS[next]!);
    }
    moveTo(t);
    beat = t;
    await app.tick();
    await afterBeat?.(t);
  }
  return unsubscribedAt;
}

/** What a polled subscription hears: push's set, less what its poll hadn't fetched when it unsubscribed. */
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
  // A rejection nothing handled (a re-entered fire whose run throws, say) fails the run with a verdict, not a crash before one.
  const stray: string[] = [];
  process.on("unhandledRejection", (error) => void stray.push(error instanceof Error ? error.message : String(error)));
  /** (a): each session's delivered messages equal its oracle exactly, once each. */
  const gradeMessages = (leg: string, landed: Awaited<ReturnType<App["landed"]>>, sessions: Map<string, string>, oracle: (sub: FixtureSubscription) => string[]) => {
    tell.over(`${leg} · a · messages landed`, landed);
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
  /** (b), (c): every poll's fires are exactly its cadence apart, so none under the floor and none when not due. */
  const gradeFires = (leg: string, fires: App["fires"], cadence: (key: string) => number, skipped?: { key: string; at: number }) => {
    const byPoll = new Map<string, number[]>();
    for (const f of fires) byPoll.set(`${f.user} ${f.key}`, [...(byPoll.get(`${f.user} ${f.key}`) ?? []), f.at]);
    tell.over(`${leg} · b · fires`, fires);
    for (const [poll, times] of byPoll) {
      const minutes = cadence(poll.split(" ")[1]!);
      for (let i = 1; i < times.length; i += 1) {
        const gap = (times[i]! - times[i - 1]!) / MINUTE;
        if (gap < 5) failures.push(`${leg} · b: ${poll} fired ${gap} minute(s) after its last fire`);
        else if (gap !== minutes) failures.push(`${leg} · c: ${poll} fired ${gap} minutes after its last, not at its ${minutes}-minute cadence`);
        if (gap < 5 || gap !== minutes) break;
      }
    }
    // The one fire (o) has skipped is answered 200: every other is accepted.
    const refused = fires.filter((f) => f.status !== 202 && !(f.key === skipped?.key && f.at === skipped.at));
    if (refused.length > 0) failures.push(`${leg} · c: ${refused.length} fire(s) not accepted (first ${refused[0]!.status})`);
  };
  /** (f), (l): each fetch ran as the poll's own user, and a user fetched a thread at most once a cadence. */
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
  /**
   * (m): each poll's accepted fires name one session, read from their request
   * records; it is a schedule session (by prefix), its row is the poll user's
   * on the service flow, and its listing, read as the DevTool reads it, holds
   * every fire. No two polls share one, and the service flow holds no one-off
   * session, pushed deliveries included. Returns each poll's session.
   */
  const gradeSessions = async (leg: string, app: App, answers: App["answers"]) => {
    const accepted = tell.over(`${leg} · m · accepted fires`, answers.filter((a) => a.status === 202));
    const byPoll = new Map<string, typeof accepted>();
    for (const a of accepted) byPoll.set(a.scheduleId, [...(byPoll.get(a.scheduleId) ?? []), a]);
    const sessionOf = new Map<string, string>();
    for (const [scheduleId, fires] of byPoll) {
      const poll = defaultParseScheduleId(scheduleId)!;
      const label = `${poll.userId} ${decodeURIComponent(poll.collectionKey)}`;
      const named = new Set<string>();
      for (const f of fires) named.add(String((f.body.requestId === undefined ? undefined : await app.stores.request.get(f.body.requestId))?.sessionId));
      if (named.size !== 1) {
        failures.push(`${leg} · m: ${label}'s ${fires.length} fires ran in ${named.size} sessions (${[...named].slice(0, 3).join(", ")})`);
        continue;
      }
      const sessionId = [...named][0]!;
      if (!sessionId.startsWith(SCHEDULE_SESSION)) {
        failures.push(`${leg} · m: ${label}'s fires ran in ${sessionId}, not a schedule session`);
        continue;
      }
      sessionOf.set(scheduleId, sessionId);
      const row = await app.stores.session.get(sessionId);
      if (row === undefined) failures.push(`${leg} · m: ${label}'s session ${sessionId} has no row`);
      else if (row.userId !== poll.userId || row.flowKind !== "github-service") failures.push(`${leg} · m: ${label}'s session belongs to ${row.userId} on ${row.flowKind}`);
      const listed = await app.http("GET", ["sessions", sessionId, "requests"], poll.userId);
      const ids = new Set(((listed.body.requests ?? []) as Array<{ id: string }>).map((r) => r.id));
      const missing = fires.filter((f) => !ids.has(f.body.requestId!));
      if (listed.status !== 200 || missing.length > 0) failures.push(`${leg} · m: ${label}'s session listing (${listed.status}) misses ${missing.length} of its ${fires.length} fires`);
    }
    const shared = [...sessionOf.values()].filter((s, i, all) => all.indexOf(s) !== i);
    if (shared.length > 0) failures.push(`${leg} · m: ${shared.length} poll(s) share a session with another`);
    const sessions = tell.over(`${leg} · m · the service flow's sessions`, await app.stores.session.list({ flowKind: "github-service", parentage: "all" }));
    const oneOff = sessions.filter((s) => s.id.startsWith("ephemeral_"));
    if (oneOff.length > 0) failures.push(`${leg} · m: ${oneOff.length} one-off session(s) on the service flow (first ${oneOff[0]!.id})`);
    return sessionOf;
  };

  // ---- leg 1: polled only, webhook off ------------------------------------------
  {
    // Two of alice's polls the provider troubles, each on a thread only one of her subscriptions follows, with no screen:
    // (n) on the first, and (o) on the busiest of the rest.
    const eventsOn = (thread: string) => EVENTS.filter((e) => e.threads.includes(thread));
    const single = SUBSCRIPTIONS.filter(
      (s) =>
        s.user === "alice" &&
        s.input.kinds === undefined &&
        s.input.screens === undefined &&
        s.unsubscribeAt === undefined &&
        SUBSCRIPTIONS.filter((o) => o.user === "alice" && o.input.thread === s.input.thread).length === 1
    );
    const nSub = single[0]!;
    const oSub = single.slice(1).sort((a, b) => eventsOn(b.input.thread).length - eventsOn(a.input.thread).length)[0]!;
    const isPoll = (scheduleId: string, sub: FixtureSubscription) => {
      const id = defaultParseScheduleId(scheduleId);
      return id?.userId === sub.user && id.collectionKey === encodeURIComponent(sub.input.thread);
    };
    const keyOf = (e: SubscriptionEvent) => `${e.object.id}@${e.object.version}`;

    // (n) needs alice's poll session id before her first fire. The run doesn't derive it: a probe over its own file
    // reads it from her first fire's request record, and (m) below checks it is the session her poll runs in here.
    let probed: string | undefined;
    {
      const probe = await boot({ db: join(SCRATCH, "probe.sqlite") });
      moveTo(T0 - 2 * MINUTE);
      await probe.subscribe("alice", await probe.createFollower("alice"), nSub.input);
      const firstFire = () => probe.answers.find((a) => a.status === 202 && isPoll(a.scheduleId, nSub));
      for (let t = T0 - MINUTE; t <= T0 + 10 * MINUTE && firstFire() === undefined; t += MINUTE) {
        moveTo(t);
        beat = t;
        await probe.tick();
      }
      const requestId = firstFire()?.body.requestId;
      probed = requestId === undefined ? undefined : (await probe.stores.request.get(requestId))?.sessionId;
      await probe.dispose();
    }

    const app = await boot({
      db: join(SCRATCH, "leg1.sqlite"),
      failOnce: { user: "alice", thread: nSub.input.thread, from: T0 + 10 * MINUTE },
      holdOnce: { user: "alice", thread: oSub.input.thread, from: T0 + 20 * MINUTE }
    });
    const made = await subscribeAll(app);

    // (n), before alice's first fire: bob creates a session at her poll's id on the service flow, and on a flow of his
    // own with the id split across the tenant header and joined into the id. None may leave a session at that id.
    const target = tell.over("leg 1 · n · alice's poll session, read by the probe", probed?.startsWith(SCHEDULE_SESSION) === true ? [probed] : []);
    const refusals: Array<{ what: string; status: number }> = [];
    for (const id of target) {
      const cut = id.includes(":") ? id.indexOf(":") : SCHEDULE_SESSION.length;
      const head = id.slice(0, cut);
      const rest = id.slice(id.includes(":") ? cut + 1 : cut);
      const follower = { userId: "bob", state: { workerId: "eng.follower" } };
      const create = await app.http("POST", ["github-service", "sessions"], "bob", { userId: "bob", sessionId: id });
      refusals.push({ what: "bob's create at her poll's id on the service flow", status: create.status });
      await app.http("POST", ["follower", "sessions"], "bob", { ...follower, sessionId: rest }, { "x-tenant-id": head });
      await app.http("POST", ["follower", "sessions"], "bob", { ...follower, sessionId: `${head}:${rest}` });
      const taken = await app.stores.session.get(id);
      if (taken !== undefined) failures.push(`leg 1 · n: before alice's first fire, a session at her poll's id is ${taken.userId}'s, on ${taken.flowKind}`);
    }

    // (n): the beat her fetch failed, alice reads her session's listing and asks to retry that fire. (o): the beat after
    // the held fire's next due one, the provider answers it.
    let retry: { status: number; requestStatus: string; retryable: unknown } | undefined;
    const ended = await runTimeline(app, made, false, async (t) => {
      const { failed, held } = app.trouble();
      if (failed?.beat === t && retry === undefined) {
        const requestId = app.answers.find((a) => a.at === t && isPoll(a.scheduleId, nSub))?.body.requestId;
        const record = requestId === undefined ? undefined : await app.stores.request.get(requestId);
        if (record?.sessionId !== undefined) {
          const listed = await app.http("GET", ["sessions", record.sessionId, "requests"], "alice");
          const entry = ((listed.body.requests ?? []) as Array<{ id: string; retryable?: unknown }>).find((r) => r.id === record.id);
          const res = await app.http("POST", ["github-service", "sessions", record.sessionId, "requests", record.id, "retry"], "alice", {});
          retry = { status: res.status, requestStatus: record.status, retryable: entry?.retryable };
          await app.settled();
        }
      }
      if (held !== undefined && !held.released && t >= held.beat + 5 * MINUTE) await app.release();
    });
    const { failed, held } = app.trouble();
    const landed = await app.landed();
    const oracle = (sub: FixtureSubscription) => pollOracle(sub, app.calls, ended);
    const deliveredTo = (sub: FixtureSubscription, key: string) => landed.filter((l) => l.session === made.sessions.get(sub.label) && l.key === key && l.status === "delivered").length;
    gradeMessages("leg 1", landed, made.sessions, oracle);
    const skippedAt = held === undefined ? undefined : { key: encodeURIComponent(oSub.input.thread), at: held.beat + 5 * MINUTE };
    gradeFires("leg 1", app.fires, defaultCadence, skippedAt);
    gradeFetches("leg 1", app.calls);
    const unchanged = tell.over("leg 1 · d · unchanged polls", app.calls.filter((c) => c.unchanged));
    const sessionOf = await gradeSessions("leg 1", app, app.answers);

    // (n), after: the probed id is the session alice's poll ran in; bob's action to it and read of it are refused, and it is hers.
    for (const id of target) {
      const ran = [...sessionOf].find(([scheduleId]) => isPoll(scheduleId, nSub))?.[1];
      if (ran !== id) failures.push(`leg 1 · n: alice's poll ran in ${ran}, not the probed ${id}, so bob's creates aimed elsewhere`);
      const action = await app.http("POST", ["follower", id, "actions", "respond"], "bob", { userId: "bob", input: { message: "mine now" } });
      refusals.push({ what: "bob's action to her poll's session", status: action.status });
      const read = await app.http("GET", ["sessions", id, "state"], "bob");
      refusals.push({ what: "bob's read of her poll's session state", status: read.status });
      const row = await app.stores.session.get(id);
      if (row?.userId !== "alice") failures.push(`leg 1 · n: the session at alice's poll's id is ${row?.userId ?? "nobody"}'s`);
    }
    for (const r of refusals) if (r.status < 300) failures.push(`leg 1 · n: ${r.what} was answered ${r.status}`);
    const nGot = landed.filter((l) => l.session === made.sessions.get(nSub.label) && l.status === "delivered").map((l) => l.key);
    if (JSON.stringify(sorted(nGot)) !== JSON.stringify(sorted(oracle(nSub)))) failures.push(`leg 1 · n: alice's poll delivered ${nGot.length}, the oracle ${oracle(nSub).length}`);
    // (n): her retry of the failed fire is refused, her listing marks it not retryable, and the next fire delivers what it missed.
    for (const r of tell.over("leg 1 · n · alice's retry of her failed fire", retry === undefined ? [] : [retry])) {
      if (r.requestStatus !== "failed") failures.push(`leg 1 · n: the fire whose fetch failed ended ${r.requestStatus}`);
      if (r.status < 300) failures.push(`leg 1 · n: alice's retry of her failed fire was answered ${r.status}`);
      if (r.retryable !== false) failures.push(`leg 1 · n: her session's listing marks the failed fire retryable: ${String(r.retryable)}`);
    }
    const missed = tell.over("leg 1 · n · what the failed fetch missed, that alice's poll owes", (failed?.missed ?? []).map(keyOf).filter((k) => oracle(nSub).includes(k)));
    for (const k of missed) if (deliveredTo(nSub, k) !== 1) failures.push(`leg 1 · n: ${k}, missed by the failed fetch, was delivered ${deliveredTo(nSub, k)} time(s)`);

    // (o): the fire due while the held one ran was skipped; no poll's session ever held two running requests; the
    // events after the held answer's time landed once each, fetched by a fire after the skipped one.
    for (const h of tell.over("leg 1 · o · held answers", held === undefined ? [] : [held])) {
      const due = app.answers.find((a) => isPoll(a.scheduleId, oSub) && a.at === h.beat + 5 * MINUTE);
      if (due?.body.status !== "skipped") failures.push(`leg 1 · o: the fire due while the held one ran was answered ${due?.status} ${due?.body.status ?? "(none)"}`);
      const after = tell.over("leg 1 · o · the held event and the next", eventsOn(oSub.input.thread).filter((e) => e.at > h.now && oracle(oSub).includes(keyOf(e))).slice(0, 2));
      for (const e of after) {
        if (deliveredTo(oSub, keyOf(e)) !== 1) failures.push(`leg 1 · o: ${keyOf(e)}, after the held answer, was delivered ${deliveredTo(oSub, keyOf(e))} time(s)`);
        const fetchedBy = app.calls.find((c) => c.user === oSub.user && c.thread === oSub.input.thread && c.beat > h.beat + 5 * MINUTE && !c.unchanged && c.failed !== true && (c.since ?? -Infinity) <= e.at && c.now >= e.at);
        if (fetchedBy === undefined) failures.push(`leg 1 · o: no fire after the skipped one fetched ${keyOf(e)}`);
      }
    }
    const heldSession = [...sessionOf].find(([scheduleId]) => isPoll(scheduleId, oSub))?.[1];
    tell.over("leg 1 · o · requests in the held poll's session", heldSession === undefined ? [] : await app.stores.request.list({ sessionId: heldSession }));
    for (const [scheduleId, sessionId] of sessionOf) {
      const runs = (await app.stores.request.list({ sessionId })).sort((a, b) => a.startedAtMs - b.startedAtMs);
      const overlaps = runs.filter((r, i) => i > 0 && r.startedAtMs < (runs[i - 1]!.finalizedAtMs ?? Infinity)).length;
      if (overlaps > 0) failures.push(`leg 1 · o: ${decodeURIComponent(defaultParseScheduleId(scheduleId)!.collectionKey)}'s session held two running requests ${overlaps} time(s)`);
    }
    evidence.push(
      `leg 1: ${landed.length} messages over ${made.ids.size} subscriptions, ${app.fires.length} fires, ${app.calls.length} fetches (${unchanged.length} unchanged); ` +
        `${sessionOf.size} poll sessions; bob refused ${refusals.length} times; a failed fetch's ${missed.length} missed event(s) caught up, its retry answered ${retry?.status}; ` +
        `a held answer's next fire ${app.answers.find((a) => held !== undefined && isPoll(a.scheduleId, oSub) && a.at === held.beat + 5 * MINUTE)?.body.status}`
    );
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
    gradeMessages("leg 2", landed, made.sessions, (sub) => pollOracle(sub, lossy.calls, ended).filter((key) => !neverKey.includes(`${sub.label} ${key}`)));
    // (e): each lost or untaken delivery landed exactly once, after its loss.
    tell.over("leg 2 · e · injected losses", Array.from({ length: lossy.injected.lost + lossy.injected.untaken }));
    if (lossy.injected.lost < lost.length) failures.push(`leg 2 · e: only ${lossy.injected.lost} of ${lost.length} planned losses happened`);
    for (const p of [...lost, ...untaken]) {
      const delivered = landed.filter((l) => l.id === idOf(p) && l.status === "delivered");
      if (delivered.length !== 1) failures.push(`leg 2 · e: ${p.sub.label}'s lost ${p.key} landed ${delivered.length} time(s)`);
    }
    // (i): the never-taken one was given up after three polls: nothing owed at the end, and the mark moved past it.
    tell.over("leg 2 · i · never-taken deliveries", never);
    for (const p of never) {
      const neverAt = EVENTS.find((e) => `${e.object.id}@${e.object.version}` === p.key)!.at;
      const poll = (await lossy.storedAt(p.sub.user, SUBSCRIPTION_POLLS_PATTERN)).find((r) => r.input.thread === p.sub.input.thread);
      if (poll === undefined || (poll.input.owed ?? []).length > 0 || !(poll.input.polledThrough > neverAt)) {
        failures.push(`leg 2 · i: ${p.sub.label}'s never-taken ${p.key} is still owed (mark ${poll?.input.polledThrough}, its time ${neverAt})`);
      }
    }
    gradeFires("leg 2", lossy.fires, defaultCadence);
    await gradeSessions("leg 2", lossy, lossy.answers);
    evidence.push(`leg 2: ${lossy.injected.lost} lost, ${lossy.injected.untaken} untaken, ${lossy.injected.never} never-taken dispatches; ${landed.length} messages`);
    await lossy.dispose();
  }

  // ---- leg 3: pushed and polled -------------------------------------------------
  {
    const app = await boot({ db: join(SCRATCH, "leg3.sqlite") });
    const made = await subscribeAll(app);
    await runTimeline(app, made, true);
    const landed = await app.landed();
    gradeMessages("leg 3", landed, made.sessions, pushOracle);
    const twice = landed.filter((l, i) => landed.findIndex((m) => m.id === l.id) !== i);
    if (twice.length > 0) failures.push(`leg 3 · a: ${twice.length} delivery(ies) landed twice`);
    // Pushed deliveries make no one-off session either: routing runs in the service's routing session, each owner's run in its owner-run session.
    await gradeSessions("leg 3", app, app.answers);
    evidence.push(`leg 3: ${landed.length} messages, pushed and polled`);
    await app.dispose();
  }

  // ---- leg 4: cadence, a restart, and a declared routine leaving config ---------
  // The routines' own seed writes the declared routine; what polling owns is ending it once config drops it.
  {
    const declared: DeclaredRoutine[] = [{ id: "web-pr", trigger: { event: { provider: "github", thread: "github:acme/web#9", interest: "the web PR" } }, worker: "eng.follower" }];
    const db = join(SCRATCH, "leg4.sqlite");
    moveTo(T0 - 2 * MINUTE);
    const cold = await boot({ db, declared });
    const repoSession = await cold.createFollower("alice");
    const webSession = await cold.createFollower("alice");
    await cold.subscribe("alice", repoSession, { thread: "github:acme/api", interest: "the repo", everyMinutes: 15 });
    const web = (await cold.subscribe("alice", webSession, { thread: "github:acme/web#9", interest: "the web PR" })).id!;
    const seeded = await cold.seed("alice");
    if (seeded.error !== undefined) failures.push(`leg 4 · j: the roster's seed failed: ${JSON.stringify(seeded.error)}`);
    // The declared routines' key for entry web-pr, written again here, not imported: cfg_ and a hash of the roster flow and the entry id.
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode("workforce-roster\nweb-pr")));
    const declaredKey = `cfg_${[...digest.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
    if ((await cold.storedAt("alice", "workforce/subscriptions/*")).find((r) => r.id === declaredKey)?.enabled !== true) failures.push("leg 4 · j: the seed wrote no declared subscription");
    const three = await cold.subscribe("alice", repoSession, { thread: "github:acme/web", interest: "too often", everyMinutes: 3 });
    for (let t = T0 - MINUTE; t <= T0 + 30 * MINUTE; t += MINUTE) {
      moveTo(t);
      beat = t;
      await cold.tick();
    }
    const coldMessages = (await cold.landed()).length;
    const coldFires = [...cold.fires];
    const pollsBefore = (await cold.storedAt("alice", SUBSCRIPTION_POLLS_PATTERN)).length;
    await cold.dispose();
    // A restart over config without the entry: a new process over the same file adds no poll, and the polls keep firing.
    const warm = await boot({ db, declared: [] });
    const pollsAfter = (await warm.storedAt("alice", SUBSCRIPTION_POLLS_PATTERN)).length;
    tell.over("leg 4 · j · polls before the restart", Array.from({ length: pollsBefore }));
    if (pollsAfter !== pollsBefore || pollsBefore !== 2) failures.push(`leg 4 · j: ${pollsBefore} poll(s) before the restart, ${pollsAfter} after, for two threads`);
    if (coldMessages === 0) failures.push("leg 4 · j: the polled subscriptions heard nothing");
    // The declared entry left config: its subscription ends at its next fire, with no roster run; the session's own subscription stays.
    for (let t = T0 + 31 * MINUTE; t <= T0 + 50 * MINUTE; t += MINUTE) {
      moveTo(t);
      beat = t;
      await warm.tick();
    }
    const after = await warm.storedAt("alice", "workforce/subscriptions/*");
    const removed = after.find((r) => r.id === declaredKey);
    if (removed?.enabled !== false || removed.endedReason !== "config_removed") failures.push(`leg 4 · j: the removed entry's subscription is ${JSON.stringify({ enabled: removed?.enabled, endedReason: removed?.endedReason })}`);
    if (after.find((r) => r.id === web)?.enabled !== true) failures.push("leg 4 · j: the session's own subscription ended with the declared one");
    if (warm.fires.length === 0) failures.push("leg 4 · j: nothing fired after the restart");
    // (k): the 15-minute poll fires 15 minutes apart; a cadence of 3 is refused.
    const all = [...coldFires, ...warm.fires];
    const repoKey = encodeURIComponent("github:acme/api");
    const repoFires = tell.over("leg 4 · k · the 15-minute poll's fires", all.filter((f) => f.key === repoKey));
    gradeFires("leg 4", all, (key) => (key === repoKey ? 15 : 5));
    if (repoFires.length < 3) failures.push(`leg 4 · k: the 15-minute poll fired ${repoFires.length} time(s) in 50 minutes`);
    if (three.id !== undefined) failures.push("leg 4 · k: a cadence of 3 was accepted");
    // (m) across the restart: each poll's fires before and after it ran in the one session.
    await gradeSessions("leg 4", warm, [...cold.answers, ...warm.answers]);
    evidence.push(`leg 4: ${pollsBefore} polls before a restart and ${pollsAfter} after; the repo poll fired ${repoFires.length} times; the removed declared subscription ${removed?.endedReason}`);
    await warm.dispose();
  }

  for (const message of stray.slice(0, 3)) failures.push(`a rejection nothing handled: ${message}`);
  return { failures, evidence: evidence.join("; ") };
});
void at;
