/** What this run proves is `goal.md` beside this file. */
// The run's clock, moved between beats: imported first, so every module reads it.
import { moveTo } from "../../webhook-routing/polls-each-event-once-without-a-webhook/clock.mts";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { createClient, type Client, type ClientFetch } from "@flow-state-dev/client";
import { serve, type ServeHandle } from "@flow-state-dev/node";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { LIST_ROUTINES_ACTION, ROSTER_FLOW } from "@flow-state-dev/workforce/browser";
import { REPO_ROOT, goalTmpDir, loadFixture, runGoal, silentLogger, sleep } from "../../lib/index.mts";
import { assertPatched, describePatches, modulePatchEnv, type ModulePatch } from "../../lib/module-patch.mts";
import * as contract from "../../../labs/test-support/contract.ts";
import type { ScriptedCall, ScriptedStep } from "../../../labs/test-support/contract.ts";
import type { Routine } from "../../../packages/shift-manager/src/lib/routines.ts";
import { build } from "esbuild";
import { openTeammates } from "../../../labs/teammates/host.mts";
import { openLab as openClaudeCodeStyle } from "../../../labs/claude-code-style/host.mts";
import { LAB_USERS, openLab as openDevTeam } from "../../../packages/shift-manager/teams/devteam/host.mts";
import { selectHarness } from "../../../packages/shift-manager/teams/devteam/harness.mts";
import { startStubGitHub, type StubPull } from "./stub-github.mts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
/** `GOAL_LEG=scripted` runs legs a–f alone, `GOAL_LEG=real` leg g alone; unset, both. A control runs a–f. */
const LEG = CONTROL !== "" ? "scripted" : (process.env.GOAL_LEG ?? "");
const SCRATCH = process.env.GOAL_SCRATCH ?? goalTmpDir("routines-in-the-labs");
const HOSTS = ["labs/teammates/host.mts", "labs/claude-code-style/host.mts", "packages/shift-manager/teams/devteam/host.mts"];

/** The controls: each degrades one behaviour in the hosts under test, as they load. */
const PATCHES: Record<string, ModulePatch[]> = {
  // The hosts don't poll: GitHub's service flow is built without its poll.
  "no-poll": HOSTS.map((module) => ({ module, from: String.raw`githubServiceFlow\(\{ provider: github, installation, poll: true \}\)`, to: "githubServiceFlow({ provider: github, installation })" })),
  // The hosts give the roster no clock index: nothing ticks a clock routine.
  "no-clock-index": HOSTS.map((module) => ({ module, from: String.raw`index: scheduleIndexAt\(clockDb\),`, to: "" })),
  // The operator's token reads GitHub for every user of the host.
  "shared-token": HOSTS.map((module) => ({ module, from: String.raw`const reads = \(ctx[^)]*\) => [^;]+;`, to: "const reads = () => true;" }))
};

if (CONTROL !== "" && PATCHES[CONTROL] === undefined) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(PATCHES).join(", ")}`);
  process.exit(2);
}
// A control runs this same file again with its patch applied as it loads.
if (PATCHES[CONTROL] !== undefined && process.env.GOAL_MODULE_PATCH === undefined) {
  mkdirSync(SCRATCH, { recursive: true });
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

type HostName = "teammates" | "claude-code-style" | "devteam";
interface HostEntry {
  worker: string;
  flow: string;
  assignee: string;
  operator?: string;
  second?: string;
  pr: StubPull;
}
interface Fixture {
  reviewer: { login: string; association: string };
  operatorLogin: string;
  clock: { name: string; cron: string; timezone: string; goal: string };
  reviews: { first: string; whilePaused: string; afterResume: string; afterDelete: string };
  hosts: Record<HostName, HostEntry>;
  realModel: { follow: string; list: string; stop: string };
}
const F = loadFixture<Fixture>(import.meta.url, "hosts.json");
/** `GOAL_HOSTS=devteam` (comma-separated) runs those hosts alone; unset, all three. */
const NAMES = (process.env.GOAL_HOSTS?.split(",") ?? Object.keys(F.hosts)) as HostName[];
const threadOf = (pr: StubPull) => `github:${pr.owner}/${pr.repo}#${pr.number}`;
const tokenOf = (name: HostName) => `tok-${name}`;

/**
 * The next time a weekly UTC cron (`m h * * dow`) is due after `from`, worked
 * out here by stepping days, not by the cron library the code under test uses.
 */
function nextWeekly(cron: string, from: number): number {
  const [minute, hour, , , dow] = cron.split(" ").map(Number) as [number, number, number, number, number];
  const day = new Date(from);
  for (let i = 0; i <= 7; i += 1) {
    const at = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + i, hour, minute);
    if (at > from && new Date(at).getUTCDay() === dow) return at;
  }
  throw new Error(`setup: ${cron} names no time in the next week`);
}

/**
 * Shift Manager's own `toRoutines`, what its Routines view draws from the
 * roster's answer. Its module sits beside the view's React hooks, which
 * import through the app's `@/` alias: bundled here with that alias, not copied.
 */
async function shiftManagerToRoutines(): Promise<(output: unknown) => Routine[]> {
  const outfile = join(SCRATCH, "shift-manager-routines.mjs");
  await build({
    entryPoints: [join(REPO_ROOT, "packages/shift-manager/src/lib/routines.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile,
    alias: { "@": join(REPO_ROOT, "packages/shift-manager/src") },
    jsx: "automatic",
    loader: { ".css": "empty" },
    logLevel: "error"
  });
  return ((await import(outfile)) as { toRoutines: (output: unknown) => Routine[] }).toRoutines;
}

// ---- the scripted model -----------------------------------------------------

type Call = { name: string; args: unknown };
/** The tool calls the model makes on a turn whose line carries `marker`, one per step, then a closing line. */
type Plan = { marker: string; calls: Call[] };

/** The last user line of a step's messages: what this turn answers. */
const lastUserLine = (said: string) => said.slice(said.lastIndexOf('"role":"user"'));

/**
 * A model for one host: a conversation turn whose line carries a plan's marker
 * makes that plan's calls, as a model asked in words would; every other turn
 * (a delivered event, a task) answers a line. Only the model is scripted;
 * every tool runs for real.
 */
function scriptedHost(evaluateTo?: string) {
  const plans: Plan[] = [];
  const turn = ({ said, step }: ScriptedCall): ScriptedStep => {
    const asked = lastUserLine(said);
    const plan = plans.find((p) => asked.includes(p.marker));
    if (process.env.GOAL_DEBUG) console.error("TURN", step, plan?.marker, asked.slice(0, 160));
    if (plan === undefined) return { text: "Noted." };
    // The calls this turn already made: the tool calls after its line (a step count spans earlier turns on some flows).
    const made = (asked.match(/"type":"tool-call"/g) ?? []).length;
    return made < plan.calls.length ? { call: plan.calls[made]! } : { text: "Done." };
  };
  // The labs' own scripted model (`labs/test-support`), loaded as CommonJS: it sits under no `type: module` package.
  const { scriptedModels } = ((contract as { default?: typeof contract }).default ?? contract) as typeof contract;
  const models = scriptedModels({}, (call) => {
    if (call.blockName === "agent-answer" || (call.blockName ?? "").startsWith("coordinator-judgment")) return turn(call);
    if (call.blockName === "memory/observe") return { output: { items: [] } };
    return { text: "ok" };
  }) as (...args: unknown[]) => unknown;
  // Best fit's one evaluation, on a coordinator: the worker itself takes the line.
  const route = {
    specificationVersion: "v4",
    provider: "test",
    modelId: "test/route",
    supportedQuestionTypes: ["choice", "score", "boolean"],
    async doEvaluate() {
      return { answers: { worker: { type: "choice", choice: evaluateTo } }, usage: { inputTokens: 1, outputTokens: 1 }, warnings: [], providerMetadata: { typesafe: { confidence: { worker: 0.95 } } } };
    }
  };
  const resolver = evaluateTo === undefined ? models : Object.assign((...args: unknown[]) => models(...args), { resolveId: (id: string) => id, resolveEvaluationModel: () => route });
  return { resolver: resolver as never, plan: (marker: string, calls: Call[]) => plans.push({ marker, calls }) };
}

// ---- one host ---------------------------------------------------------------

interface Host {
  name: HostName;
  entry: HostEntry;
  thread: string;
  operator: string;
  second: string;
  /** The SQLite file the host's stores keep everything in. */
  store: string;
  /** The SQLite file the host's clock routines are indexed in, which `serve()`'s tick claims from. */
  clockIndex: string;
  runtime: () => Promise<{ stores: { request: { list(q: object): Promise<Array<{ status: string; finalizedAtMs?: number | null }>> } } }>;
  served: ServeHandle;
  as(user: string): Client;
  /** Run `action` on `sessionId` of `flow` as `user` and wait for its request to end: its answer. */
  act(user: string, flow: string, sessionId: string, action: string, input: unknown): Promise<any>;
  plan: (marker: string, calls: Call[]) => void;
}

/** Open `name` with its own open function, on `serve()`, over a fresh store under `dir`. */
async function openHost(name: HostName, dir: string, stub: { apiUrl: string }, scripted: boolean): Promise<Host> {
  mkdirSync(dir, { recursive: true });
  const entry = F.hosts[name];
  const github = { githubToken: tokenOf(name), githubApiUrl: stub.apiUrl };
  const script = scriptedHost(name === "devteam" ? entry.worker : undefined);
  const model = scripted ? { modelResolver: script.resolver } : {};
  let state: any;
  let store: string;
  let clockIndex: string;
  let operator = entry.operator ?? "";
  let second = entry.second ?? "";
  let bearer: Record<string, string> = {};
  if (name === "teammates") {
    const workdir = join(dir, "workdir");
    execFileSync("git", ["init", "-q", workdir]);
    writeFileSync(join(workdir, ".gitignore"), "**/.fsdev/\n");
    store = join(dir, "teammates.sqlite");
    clockIndex = join(dir, "teammates-clock.sqlite");
    state = await openTeammates({ store, model: "openai/gpt-6-luna", userId: operator, workdir, runsRoot: join(dir, "runs"), scriptedHarnessStepMs: 50, ...model, ...github } as never);
  } else if (name === "claude-code-style") {
    store = join(dir, "lab.db");
    clockIndex = join(dir, "clock.db");
    state = (await openClaudeCodeStyle({ data: dir, userId: operator, model: "openai/gpt-6-luna", utilityModel: "openai/gpt-6-luna", repositories: [], scriptedStepMs: 50, ...model, ...github } as never)).flowState;
  } else {
    store = join(dir, "devteam.sqlite");
    clockIndex = join(dir, "devteam-clock.sqlite");
    const harness = selectHarness("stub");
    operator = LAB_USERS.owner.userId;
    second = LAB_USERS.member.userId;
    bearer = { [LAB_USERS.owner.userId]: LAB_USERS.owner.bearer, [LAB_USERS.member.userId]: LAB_USERS.member.bearer };
    const lab = await openDevTeam({
      stores: sqliteStores({ filename: store }),
      harness: harness.slot,
      runTimeoutMs: harness.runTimeoutMs,
      workspace: { root: join(dir, "runs"), remotes: { allow: ["file"] } },
      coderWorkerId: "eng.coder",
      logger: silentLogger,
      scheduleIndexes: { clock: join(dir, "devteam-clock.sqlite"), poll: join(dir, "devteam-poll.sqlite") },
      ...model,
      ...github
    } as never);
    state = lab.state;
  }
  const served = await serve(state, { port: 0, host: "127.0.0.1", handleSignals: false, push: false });
  const origin = `http://127.0.0.1:${served.port}`;
  const as = (user: string): Client => {
    const fetcher: ClientFetch = (input, init) => {
      const headers = new Headers(init?.headers);
      if (bearer[user] !== undefined) headers.set("authorization", `Bearer ${bearer[user]}`);
      return fetch(input, { ...init, headers });
    };
    return createClient({ userId: user, baseUrl: origin, fetcher });
  };
  const act = async (user: string, flow: string, sessionId: string, action: string, input: unknown) => {
    const client = as(user);
    const sent = await client.flow(flow).send(action, input, { sessionId });
    await sent.wait({ pollMs: 50, timeoutMs: 120_000 });
    const found = (await client.sessions.requests(sessionId, { includeResultOutput: true, limit: 100 })).find((r) => r.id === sent.id);
    return (found?.result as { output?: unknown } | undefined)?.output;
  };
  return { name, entry, thread: threadOf(entry.pr), operator, second, store: store!, clockIndex: clockIndex!, runtime: () => state.getRuntime(), served, as, act, plan: script.plan };
}

/** Until nothing the host started is still running, read twice. */
async function settled(host: Host): Promise<void> {
  const runtime = await host.runtime();
  const running = (r: { status: string; finalizedAtMs?: number | null }) =>
    r.status === "in_progress" || (r.status !== "suspended" && r.status !== "pending" && r.finalizedAtMs == null);
  for (const deadline = Date.now() + 120_000; ; await sleep(50)) {
    const all = await runtime.stores.request.list({});
    if (!all.some(running)) {
      await sleep(200);
      const again = await runtime.stores.request.list({});
      if (!again.some(running) && again.length === all.length) return;
    }
    if (Date.now() > deadline) throw new Error(`setup: ${host.name}: a request never finished`);
  }
}

// ---- what the store holds ---------------------------------------------------

type Row = { cell: string; key: string; state: Record<string, any> };

/** Every user-scope row under `prefix` in `host`'s store, read from the SQLite file itself. */
function rows(host: Host, prefix: string): Row[] {
  const db = new Database(host.store, { readonly: true, fileMustExist: true });
  try {
    return (db.prepare("SELECT scope_id, resource_key, state FROM resource_state WHERE scope_type = 'user' AND resource_key LIKE ?").all(`${prefix}%`) as Array<{ scope_id: string; resource_key: string; state: string }>).map((r) => ({
      cell: r.scope_id,
      key: r.resource_key,
      state: JSON.parse(r.state)
    }));
  } finally {
    db.close();
  }
}
const ownedBy = (user: string) => (row: Row) => row.cell === user || row.cell.startsWith(`${encodeURIComponent(user)}:`);
const subscriptions = (host: Host, user: string) => rows(host, "workforce/subscriptions/").filter(ownedBy(user)).map((r) => r.state);
const schedules = (host: Host, user: string) => rows(host, "workforce/schedules/").filter(ownedBy(user));
/** The service's messages that landed in `sessionId`, from the message log. */
const serviceMessages = (host: Host, sessionId: string) =>
  rows(host, "workforce/messages/")
    .map((r) => r.state)
    .filter((m) => typeof m.from === "string" && m.from.startsWith("service:") && m.toSession === sessionId);
/** How many of `sessionId`'s service messages carry `text`. */
const heard = (host: Host, sessionId: string, text: string) => serviceMessages(host, sessionId).filter((m) => String(m.text).includes(text)).length;
/** Every stored task row whose goal is `goal`, any user, any board. */
const tasksFor = (host: Host, goal: string) =>
  rows(host, "").filter((r) => /(^|\/)tasks?\//.test(r.key) && r.state?.goal === goal);

// ---- why a tick did nothing -------------------------------------------------

/**
 * Whether `serve()`'s tick gets past `host`'s principal resolver for `flow`:
 * the schedule listing, which runs the same resolver a dispatch does, asked
 * with the tick's own headers (`CRON_SECRET` as the bearer when set, no user).
 * A read: nothing is dispatched. Only said in a failure, so a reader sees why.
 */
async function tickRefusal(host: Host, flow: string): Promise<string | undefined> {
  const secret = process.env.CRON_SECRET;
  const res = await fetch(`http://127.0.0.1:${host.served.port}/api/flows/${flow}/schedules`, {
    headers: secret === undefined || secret === "" ? {} : { authorization: `Bearer ${secret}` }
  });
  if (res.ok) return undefined;
  return `serve()'s tick is refused by this host: its schedule route answers the tick's headers ${res.status} ${(await res.text()).slice(0, 160)}`;
}

/** The clock routine's row in `host`'s clock index: when it is due next, or that there is none. */
function clockIndexRow(host: Host, key: string): string {
  const db = new Database(host.clockIndex, { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare("SELECT next_fire_at FROM schedule_index WHERE key = ?").get(key) as { next_fire_at: number } | undefined;
    if (row === undefined) return `the clock index holds no "${key}"`;
    return `the clock index holds "${key}" due ${new Date(row.next_fire_at).toISOString()}${row.next_fire_at <= Date.now() ? ", never claimed" : ""}`;
  } finally {
    db.close();
  }
}

/** What a failure of a tick-driven signal adds: the tick's refusal, when the host refuses it. */
const whyNot = async (host: Host, flow: string) => (await tickRefusal(host, flow)) ?? "the tick is admitted";

// ---- (g) a real model, asked in words ---------------------------------------

/** Every tool call `sessionId`'s items record, by tool name, read as `user`. */
async function toolCalls(host: Host, user: string, sessionId: string): Promise<string[]> {
  const state = (await host.as(user).sessions.state(sessionId, { includeItems: true, limit: 500 })) as { items?: Array<Record<string, any>> } | undefined;
  // A tool that ran leaves its result as a `tool_output` item named for its block.
  return (state?.items ?? []).filter((item) => item.type === "tool_output" && typeof item.blockName === "string").map((item) => item.blockName as string);
}

/**
 * Each host on the real model: the operator asks its worker, in words, to
 * follow the PR, to say what it follows, and to stop. Graded on what the store
 * holds after each line, and on the worker's own recorded calls for the list,
 * never on what the model answered.
 */
async function realModelLeg(stub: { apiUrl: string }, failures: string[], evidence: string[]) {
  const said: string[] = [];
  for (const name of NAMES) {
    const h = await openHost(name, join(SCRATCH, "real", name), stub, false);
    try {
      const session = (await h.as(h.operator).flow(h.entry.flow).createSession({ state: { workerId: h.entry.worker } })).id;
      const line = (template: string) => template.replace("{thread}", h.thread);
      await h.act(h.operator, h.entry.flow, session, "respond", { message: line(F.realModel.follow) });
      await settled(h);
      const followed = subscriptions(h, h.operator).filter((s) => s.thread === h.thread && s.enabled === true && s.madeBy?.by === "worker");
      if (followed.length !== 1) {
        failures.push(`${h.name} g:saved — asked in words, the worker saved ${followed.length} live routines on ${h.thread} (stored: ${JSON.stringify(subscriptions(h, h.operator).map((s) => [s.thread, s.enabled]))})`);
        continue;
      }
      const listsBefore = (await toolCalls(h, h.operator, session)).filter((t) => t === "listRoutines").length;
      await h.act(h.operator, h.entry.flow, session, "respond", { message: line(F.realModel.list) });
      await settled(h);
      const listsAfter = (await toolCalls(h, h.operator, session)).filter((t) => t === "listRoutines").length;
      if (listsAfter <= listsBefore) failures.push(`${h.name} g:listed — asked what it follows, the worker never called listRoutines`);
      await h.act(h.operator, h.entry.flow, session, "respond", { message: line(F.realModel.stop) });
      await settled(h);
      const left = subscriptions(h, h.operator).filter((s) => s.thread === h.thread && s.enabled !== false);
      if (left.length !== 0) failures.push(`${h.name} g:deleted — asked to stop, ${left.length} routines on ${h.thread} are still live`);
      else said.push(h.name);
    } finally {
      await h.served.close();
    }
  }
  evidence.push(`g: on the real model, ${said.join(", ") || "no host"} saved, listed and deleted a routine when asked in words`);
}

// ---- the run ----------------------------------------------------------------

const marker = (what: string) => `[${what}]`;

/** One tick of `serve()` after the clock moved to `to`: the clock stands there, a minute and more of real time passes, the hosts settle. */
async function beat(hosts: Host[], to: number) {
  await Promise.all(hosts.map(settled));
  moveTo(to);
  await sleep(63_000);
  await Promise.all(hosts.map(settled));
}

await runGoal(async (failures, tell) => {
  for (const entry of ["teammates", "claude-code-style", "devteam", "real"]) rmSync(join(SCRATCH, entry), { recursive: true, force: true });
  mkdirSync(SCRATCH, { recursive: true });
  const toRoutines = await shiftManagerToRoutines();
  const stub = await startStubGitHub({
    tokens: Object.fromEntries(NAMES.map((name) => [tokenOf(name), F.operatorLogin])),
    pulls: NAMES.map((name) => F.hosts[name].pr)
  });
  const evidence: string[] = [];
  if (LEG !== "scripted") {
    try {
      await realModelLeg(stub, failures, evidence);
    } finally {
      if (LEG === "real") await stub.close();
    }
    if (LEG === "real") return { failures, evidence: evidence.join("; ") };
  }
  const hosts: Host[] = [];
  try {
    for (const name of NAMES) hosts.push(await openHost(name, join(SCRATCH, name), stub, true));

    // ---- (a) the operator asks the worker's session to follow the PR and to run something on a clock ----
    const conversations = new Map<HostName, string>();
    const madeEvent = new Map<HostName, string>();
    await Promise.all(
      hosts.map(async (h) => {
        const session = (await h.as(h.operator).flow(h.entry.flow).createSession({ state: { workerId: h.entry.worker } })).id;
        conversations.set(h.name, session);
        h.plan(marker(`save-${h.name}`), [
          { name: "saveRoutine", args: { trigger: { event: { provider: "github", thread: h.thread, kinds: ["review"], interest: "Every review on this pull request." } } } },
          { name: "saveRoutine", args: { name: F.clock.name, trigger: { clock: { cron: F.clock.cron, timezone: F.clock.timezone } }, task: { goal: F.clock.goal, assignee: h.entry.assignee } } }
        ]);
        await h.act(h.operator, h.entry.flow, session, "respond", { message: `Follow ${h.thread} and tell me about reviews, and every Monday at 9 check the open PRs. ${marker(`save-${h.name}`)}` });
        await settled(h);
        const events = subscriptions(h, h.operator).filter((s) => s.thread === h.thread);
        const clocks = schedules(h, h.operator).filter((r) => r.key === `workforce/schedules/${F.clock.name}`);
        const event = events.find((s) => s.enabled === true && s.madeBy?.by === "worker" && s.madeBy.worker === h.entry.worker && s.sessionId === session);
        if (event === undefined) failures.push(`${h.name} a:event-saved — no live event routine on ${h.thread} made by ${h.entry.worker} for this session (stored: ${JSON.stringify(events)})`);
        else madeEvent.set(h.name, `event:${event.id}`);
        const clock = clocks.find((r) => r.state.cron === F.clock.cron && r.state.enabled === true && r.state.metadata?.madeBy?.worker === h.entry.worker);
        if (clock === undefined) failures.push(`${h.name} a:clock-saved — no live clock routine "${F.clock.name}" made by ${h.entry.worker} (stored: ${JSON.stringify(clocks.map((r) => r.state))})`);
      })
    );
    tell.over("a · event routines saved", [...madeEvent.values()]);
    evidence.push(`a: ${madeEvent.size} hosts saved an event routine and a clock routine through the worker's tools`);
    if (madeEvent.size === 0) return { failures, evidence: evidence.join("; ") };

    // ---- (b) the roster's listRoutines, read through Shift Manager's toRoutines ----
    const listed = async (h: Host): Promise<Routine[]> => {
      const roster = (await h.as(h.operator).flow(ROSTER_FLOW).createSession({})).id;
      return toRoutines(await h.act(h.operator, ROSTER_FLOW, roster, LIST_ROUTINES_ACTION, {}));
    };
    for (const h of hosts) {
      const routines = tell.over(`b · ${h.name} listed routines`, await listed(h));
      for (const id of [madeEvent.get(h.name), `clock:${F.clock.name}`]) {
        const found = routines.find((r) => r.id === id);
        if (found === undefined || found.madeBy?.by !== "worker" || (found.madeBy as { worker?: string }).worker !== h.entry.worker) {
          failures.push(`${h.name} b:made-by-the-worker — ${id} listed as ${JSON.stringify(found)} (listed ${routines.map((r) => r.id).join(", ")})`);
        }
      }
    }

    // ---- (f) a second user's GitHub routine is refused, naming GITHUB_TOKEN ----
    await Promise.all(
      hosts.map(async (h) => {
        const session = (await h.as(h.second).flow(h.entry.flow).createSession({ state: { workerId: h.entry.worker } })).id;
        h.plan(marker(`second-${h.name}`), [{ name: "saveRoutine", args: { trigger: { event: { provider: "github", thread: h.thread, kinds: ["review"], interest: "Reviews." } } } }]);
        await h.act(h.second, h.entry.flow, session, "respond", { message: `Follow ${h.thread} for me. ${marker(`second-${h.name}`)}` });
        await settled(h);
        const saved = subscriptions(h, h.second);
        if (saved.length > 0) failures.push(`${h.name} f:second-refused — ${h.second} saved ${JSON.stringify(saved.map((s) => s.thread))}`);
        const said = JSON.stringify((await h.as(h.second).sessions.state(session, { includeItems: true, limit: 100 })) ?? {});
        if (!said.includes("GITHUB_TOKEN")) failures.push(`${h.name} f:names-the-token — ${h.second}'s refusal doesn't name GITHUB_TOKEN`);
      })
    );
    const asSecond = stub.calls.filter((c) => c.status !== 401 && hosts.some((h) => c.token === tokenOf(h.name)));
    evidence.push(`f: second users saved nothing; GitHub was asked ${asSecond.length} times, all on the operators' tokens`);

    // ---- (c) a review on the PR reaches that session once, within one poll of serve()'s tick ----
    const start = Date.now();
    for (const h of hosts) stub.review(h.entry.pr, F.reviewer.login, F.reviewer.association, `${F.reviews.first} (${h.name})`);
    await beat(hosts, start + 5 * 60_000 + 5_000);
    for (const h of hosts) {
      const n = heard(h, conversations.get(h.name)!, F.reviews.first);
      if (n !== 1) failures.push(`${h.name} c:heard-once — the first review reached the session ${n} times within one poll; ${await whyNot(h, "github-service")}`);
    }
    const polled = tell.over("c · GitHub calls as the operators", stub.calls.filter((c) => c.path.includes("/reviews")));
    evidence.push(`c: ${polled.length} review reads on the operators' tokens`);

    // ---- (d) paused, nothing; resumed, delivered; deleted, gone ----
    const toolTurn = async (h: Host, what: string, call: Call) => {
      h.plan(marker(`${what}-${h.name}`), [call]);
      await h.act(h.operator, h.entry.flow, conversations.get(h.name)!, "respond", { message: `${what} the ${h.thread} routine. ${marker(`${what}-${h.name}`)}` });
    };
    await Promise.all(hosts.map((h) => toolTurn(h, "pause", { name: "pauseRoutine", args: { id: madeEvent.get(h.name), paused: true } })));
    if (process.env.GOAL_DEBUG) for (const h of hosts) console.error("PAUSED?", h.name, JSON.stringify(subscriptions(h, h.operator)));
    for (const h of hosts) stub.review(h.entry.pr, F.reviewer.login, F.reviewer.association, `${F.reviews.whilePaused} (${h.name})`);
    await beat(hosts, Date.now() + 5 * 60_000 + 5_000);
    for (const h of hosts) {
      const n = heard(h, conversations.get(h.name)!, F.reviews.whilePaused);
      if (n !== 0) failures.push(`${h.name} d:paused-hears-nothing — a review posted while paused reached the session ${n} times`);
    }
    await Promise.all(hosts.map((h) => toolTurn(h, "resume", { name: "pauseRoutine", args: { id: madeEvent.get(h.name), paused: false } })));
    for (const h of hosts) stub.review(h.entry.pr, F.reviewer.login, F.reviewer.association, `${F.reviews.afterResume} (${h.name})`);
    await beat(hosts, Date.now() + 5 * 60_000 + 5_000);
    for (const h of hosts) {
      const n = heard(h, conversations.get(h.name)!, F.reviews.afterResume);
      if (n !== 1) failures.push(`${h.name} d:resumed-hears — a review after the resume reached the session ${n} times; ${await whyNot(h, "github-service")}`);
    }
    const tasksBefore = hosts.map((h) => tasksFor(h, F.clock.goal).length);
    await Promise.all(hosts.map((h) => toolTurn(h, "delete", { name: "deleteRoutine", args: { id: madeEvent.get(h.name) } })));
    for (const h of hosts) stub.review(h.entry.pr, F.reviewer.login, F.reviewer.association, `${F.reviews.afterDelete} (${h.name})`);

    // ---- (e) the clock files one task: the clock stands at its next due time ----
    await beat(hosts, nextWeekly(F.clock.cron, Date.now()) + 30_000);
    for (const [i, h] of hosts.entries()) {
      const session = conversations.get(h.name)!;
      if (heard(h, session, F.reviews.afterDelete) !== 0) failures.push(`${h.name} d:deleted-hears-nothing — a review after the delete reached the session`);
      const routines = await listed(h);
      if (routines.some((r) => r.id === madeEvent.get(h.name))) failures.push(`${h.name} d:deleted-not-listed — ${madeEvent.get(h.name)} still listed`);
      if (heard(h, session, F.reviews.first) !== 1) failures.push(`${h.name} c:heard-once — the first review reached the session ${heard(h, session, F.reviews.first)} times by the end; ${await whyNot(h, "github-service")}`);
      const filed = tasksFor(h, F.clock.goal);
      if (tasksBefore[i] !== 0 || filed.length !== 1) failures.push(`${h.name} e:files-one-task — ${tasksBefore[i]} tasks before the clock was due, ${filed.length} after; ${clockIndexRow(h, F.clock.name)}; ${await whyNot(h, ROSTER_FLOW)}`);
    }
    evidence.push("c–e: each session heard the first review once, nothing while paused, the review after the resume once, nothing after the delete; the clock routine filed one task at its time");
  } finally {
    await Promise.all(hosts.map((h) => h.served.close()));
    await stub.close();
  }
  return { failures, evidence: evidence.join("; ") };
});
