/**
 * shift-manager › its summary changes on its own (FIX-2409).
 *
 * One `serve()` host on a bound port, on the default in-memory bus, a
 * conversation flow (`desk`) on the Workforce session board and a worker flow
 * (`doer`) whose task turn asks the user (`ctx.suspendForUser`, a review).
 * Shift Manager's own provider (`LabProvider`) runs headless, in this process
 * (react-dom over a happy-dom document; Node's own `fetch` and `WebSocket`).
 * Every grade is what the provider's snapshot holds, or the snapshot reads its
 * client made (one `sessions` listing with dispatch runs is one read), counted
 * at its fetcher. Nothing grades a publish or a frame. The task screen,
 * TasksPanel and the board card are not mounted.
 *
 *   a   another client opens a conversation the snapshot doesn't list and
 *       files a task whose run asks: the provider's Inbox count goes 0 → 1
 *       within 1 s of the run's request reading `suspended`.
 *   a2  the same, the task filed by a run on the server with no client (as a
 *       scheduled fire files one).
 *   b   10 s idle, with a Schedules-style list and a Usage query run on Shift
 *       Manager's own reading and usage sessions after each snapshot read, as
 *       those screens do: 0 snapshot reads.
 *   c   a 200-item reply, then a 2-item reply of the same length, in a listed
 *       conversation: the long one makes at most one read more (a read per item is ~200).
 *   d   a second host whose bus doesn't cross: the ask shows within 30 s + 1 s.
 *
 * Controls (each runs this file again with a scratch patch applied as it loads):
 *   GOAL_CONTROL=no-subscribe   the provider subscribes nothing: a must FAIL.
 *   GOAL_CONTROL=every-kind     the provider reads on every notice of a session, items too: c must FAIL.
 *   GOAL_CONTROL=own-sessions   the provider hears its own reading, roster and usage sessions: b must FAIL.
 *   GOAL_CONTROL=no-poll        the provider keeps no fallback timer: d must FAIL.
 */
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { Window } from "happy-dom";
import React, { createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { createClient, type Client, type ClientFetch } from "@flow-state-dev/client";
import { createFlowState, runAction as runOnServer, type FlowState, type StoreAdapter } from "@flow-state-dev/engine";
import { serve, type ServeHandle } from "@flow-state-dev/node";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import type { TaskInit } from "@flow-state-dev/orchestration/tasks";
import { LIST_ROUTINES_ACTION } from "@flow-state-dev/workforce/browser";
import {
  createWorkerInstallation,
  defineSessionBoard,
  defineWorkerInventoryCollection,
  hireWorkforce,
  inventoryWorkers,
  inventoryWriterActions,
  openInventory,
  workerConfigSchema,
  workerTaskEntry,
  type WorkerManifest,
} from "@flow-state-dev/workforce";
import { crossingBus } from "../../lib/crossing-bus.mts";
import { REPO_ROOT, RUN_STAMP, assertPatched, describePatches, goalTmpDir, modulePatchEnv, runGoal, silentLogger, sleep, type ModulePatch } from "../../lib/index.mts";
import { LabProvider, useLab } from "../../../packages/shift-manager/src/lib/lab-data.tsx";
import { runAction } from "../../../packages/shift-manager/src/lib/action.ts";
import { runUsageQuery } from "../../../packages/shift-manager/src/lib/usage.ts";
import { readerSessionId } from "../../../packages/shift-manager/src/lib/reads.ts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
const SCRATCH = process.env.GOAL_SCRATCH ?? goalTmpDir("its-summary-changes-on-its-own");
const USER = "alice";
const TOKEN = "tok-alice";
const ORG = "acme";
const BOUND_MS = 1_000;
const IDLE_MS = 10_000;
/** The provider's fallback pace where push can miss a change. */
const POLL_MS = 30_000;
/** A flow with the two actions Schedules and Usage run on Shift Manager's own sessions on every snapshot read. */
const PROBE_FLOW = "usage-probe";
const ASK = "[ask]";
const INVENTORY_WRITER_FLOW = "inventory-writer";
/** How many more snapshot reads leg c lets the long reply make than the short one: one coalescing more or less. */
const JITTER_READS = 1;

const LAB_DATA = "packages/shift-manager/src/lib/lab-data.tsx";
const SUBSCRIBE = "packages/shift-manager/src/lib/snapshot-subscribe.ts";
const CONTROLS: Record<string, { patches: ModulePatch[]; legs: string; mustFail: string }> = {
  // The provider opens no subscription: the snapshot reads only on boot and the person's own reads, as on `main`.
  "no-subscribe": {
    patches: [{ module: LAB_DATA, from: String.raw`enabled: listed !== undefined \}`, to: "enabled: false }" }],
    legs: "a",
    mustFail: "a:ask-within-1s",
  },
  // Every notice on a session's topic reads, `items` included.
  "every-kind": {
    patches: [{ module: SUBSCRIBE, from: String.raw`return notice\.kind === "request" \|\| notice\.kind === "run";`, to: "return true;" }],
    legs: "c",
    mustFail: "c:as-short",
  },
  // The subscription keeps no fallback timer: where push can miss a change, nothing reads.
  "no-poll": {
    patches: [{ module: LAB_DATA, from: String.raw`pollIntervalMs: SNAPSHOT_POLL_MS, `, to: "" }],
    legs: "d",
    mustFail: "d:ask-within-poll",
  },
  // Shift Manager's own reading, roster and usage sessions are heard like any other.
  "own-sessions": {
    patches: [{ module: SUBSCRIBE, from: String.raw`session\.id === readerSessionId\(userId, session\.flowKind\) \|\|[\s\S]*?\$\{USAGE_SESSION_PREFIX\}-\`\)`, to: "false" }],
    legs: "b",
    mustFail: "b:idle-0-reads",
  },
};

if (CONTROL !== "" && CONTROLS[CONTROL] === undefined) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(CONTROLS).join(", ")}`);
  process.exit(2);
}
if (CONTROLS[CONTROL] !== undefined && process.env.GOAL_MODULE_PATCH === undefined) {
  const control = CONTROLS[CONTROL]!;
  const mark = join(SCRATCH, `patch-mark-${RUN_STAMP}`);
  rmSync(mark, { force: true });
  console.error(`control ${CONTROL} (must fail ${control.mustFail}):\n${describePatches(control.patches, REPO_ROOT)}`);
  const child = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, GOAL_SCRATCH: SCRATCH, GOAL_LEGS: process.env.GOAL_LEGS ?? control.legs, ...modulePatchEnv(control.patches, REPO_ROOT, mark) },
  });
  assertPatched(control.patches, REPO_ROOT, mark);
  process.exit(child.status ?? 1);
}
const legs = new Set((process.env.GOAL_LEGS ?? "a,a2,b,c,d").split(",").map((s) => s.trim()).filter(Boolean));


// ---------------------------------------------------------------------------
// A DOM for react-dom, and nothing else. The provider's fetches are counted
// here: it builds its own client, whose fetcher calls the global `fetch`.
// ---------------------------------------------------------------------------

const happy = new Window();
// `React` too: tsx compiles Shift Manager's `.tsx` with the classic JSX runtime, which reads it off the global scope.
Object.assign(globalThis, { window: happy, document: happy.document, IS_REACT_ACT_ENVIRONMENT: false, React });

const nativeFetch = globalThis.fetch;
/** Each snapshot read the provider made, by the host it read. */
const snapshotReads: Array<{ at: number; origin: string }> = [];
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input instanceof Request ? input.url : input));
  if (url.pathname.endsWith("/api/flows/sessions") && url.searchParams.get("include") === "dispatch-runs") {
    snapshotReads.push({ at: Date.now(), origin: url.origin });
  }
  return nativeFetch(input, init);
}) as typeof fetch;

// ---------------------------------------------------------------------------
// The app
// ---------------------------------------------------------------------------

const worker = (id: string, declared: Record<string, unknown>): WorkerManifest => ({ id, declared, body: "", skills: [] });
const WORKERS: WorkerManifest[] = [worker("lead", { flow: "desk", delegates: ["eng.doer"] }), worker("eng.doer", { flow: "doer", delegates: [] })];

type Script = { op: "file"; tasks: TaskInit[] } | { op: "chat"; count: number; ms: number };

function buildHost(stores: StoreAdapter): { state: FlowState; flows: Record<string, unknown>; open: () => Promise<void> } {
  let workerFlows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({ standardWorkers: WORKERS, workerFlows: () => workerFlows as never });
  const doorInput = z.object({ message: z.string() });
  const deskBoard = defineSessionBoard({ installation, flowKind: "desk" });
  const doerBoard = defineSessionBoard({ installation, flowKind: "doer" });

  const deskTurn = handler({
    name: "summary-desk-turn",
    inputSchema: doorInput,
    outputSchema: z.unknown(),
    resources: { ...installation.resources, ...deskBoard.resources },
    execute: async (input, rawCtx) => {
      const ctx = rawCtx as unknown as BlockContext;
      if (!input.message.startsWith("{")) return "heard";
      const script = JSON.parse(input.message) as Script;
      if (script.op === "chat") {
        // A reply streamed one item at a time: each is its own `items` notice.
        for (let n = 0; n < script.count; n += 1) {
          ctx.emit.message(`part ${n} of a reply`);
          await sleep(script.ms / script.count);
        }
        return "chatted";
      }
      const ref = await deskBoard.board.resolver(ctx as never);
      return { ids: (await ref!.createTasks(script.tasks)).map((t) => t.id) };
    },
  });

  // The delegate's task turn: a task marked `[ask]` asks the user to review, once.
  const doerTurn = handler({
    name: "summary-doer-turn",
    inputSchema: doorInput,
    outputSchema: z.unknown(),
    execute: async (input, rawCtx) => {
      const ctx = rawCtx as unknown as BlockContext;
      if (input.message.includes(ASK) && !/answering "/.test(input.message)) {
        return { reviewed: await ctx.suspendForUser({ kind: "review", prompt: "Does this read right?" } as never) };
      }
      return "done";
    },
  });

  const resolveWorker = (kind: string) =>
    handler({
      name: `summary-${kind}-resolve-worker`,
      inputSchema: z.unknown(),
      outputSchema: z.object({ worker: z.string() }),
      resources: { ...installation.resources },
      execute: async (_input, ctx) => ({ worker: (await installation.resolveWorker(ctx, kind)).id }),
    });
  const flowOf = (kind: string, board: ReturnType<typeof defineSessionBoard>, turn: unknown) =>
    defineFlow({
      kind,
      configSchema: workerConfigSchema(),
      session: { ...installation.session(board.sessionStateShape), serverOwned: [...board.serverOwned] },
      // The org's worker inventory on the conversation's flow, where Shift Manager's read finds it.
      resources: { ...installation.resources, ...board.resources, ...(kind === "desk" ? { inventoryWorkers: defineWorkerInventoryCollection() } : {}) },
      request: { onStarted: resolveWorker(kind) },
      actions: { respond: { inputSchema: doorInput.strict(), block: turn, userMessage: (i: { message: string }) => i.message }, ...board.actions },
      reads: { ...board.reads },
      internal: { actions: board.entries(turn as never) },
      task: { actions: { work: workerTaskEntry({ name: `summary-${kind}-task`, turn: turn as never }) } },
    } as never);
  workerFlows = {
    desk: { flow: flowOf("desk", deskBoard, deskBoard.planned(deskTurn)), roles: ["contributor", "manager"] },
    doer: { flow: flowOf("doer", doerBoard, doerTurn), roles: ["contributor", "manager"] },
  };

  // What Schedules and Usage run on every snapshot read: an action on the user's reading session.
  const answer = (name: string, output: unknown) =>
    handler({ name, inputSchema: z.object({}).passthrough(), outputSchema: z.unknown(), execute: async () => output });
  const probe = defineFlow({
    kind: PROBE_FLOW,
    actions: {
      harnessUsage: { inputSchema: z.object({}).passthrough(), block: answer("probe-usage", { harnesses: [] }) },
      [LIST_ROUTINES_ACTION]: { inputSchema: z.object({}).passthrough(), block: answer("probe-routines", { routines: [] }) },
    },
  } as never);

  const flows: Record<string, unknown> = {
    ...Object.fromEntries(hireWorkforce(installation).map((copy) => [copy.id, copy])),
    [PROBE_FLOW]: probe(),
    [INVENTORY_WRITER_FLOW]: defineFlow({ kind: INVENTORY_WRITER_FLOW, internal: { actions: { ...inventoryWriterActions() } } } as never)(),
  };
  // The inventory, written once as a Lab's boot does, so Shift Manager's read finds the workers.
  const open = async () => {
    const runtime = await state.getRuntime();
    const binding = await openInventory(
      { workers: inventoryWorkers(installation) },
      {
        run: async (request: any) => {
          const result = (await runOnServer({ flow: flows[request.flowKind], actionName: request.action, input: request.input, userId: request.userId, orgId: request.orgId, sessionId: request.sessionId, source: request.source, stores: runtime.stores, runtimeConfig: runtime.runtimeConfig } as never)) as { error?: unknown };
          if (result?.error !== undefined) throw new Error(String((result.error as Error).message ?? result.error));
          return result;
        },
        workerWriter: { flowKind: INVENTORY_WRITER_FLOW },
        userId: USER,
        orgId: ORG,
      } as never,
    );
    if (binding.problems.length > 0) throw new Error(`setup: the inventory didn't open: ${binding.problems.join("; ")}`);
  };
  const state = createFlowState({
    flows,
    stores: { default: { primary: stores } },
    logger: silentLogger,
    resolvePrincipal: (context: any) => {
      const header = context.request?.headers.get("authorization") ?? "";
      return header.replace(/^Bearer /, "") === TOKEN ? { userId: USER, orgId: ORG } : null;
    },
  } as never);
  return { state, flows, open };
}

/**
 * A SQLite store in scratch (a run that asks a person needs durable execution,
 * which in-memory stores don't have), with `bus` when given. Without one the
 * router fills the default in-memory bus, as a Lab on one process runs.
 */
function stores(name: string, bus?: ReturnType<typeof crossingBus>, options: { fresh: boolean } = { fresh: true }): StoreAdapter {
  const filename = join(SCRATCH, `${name}-${RUN_STAMP}.db`);
  if (options.fresh) rmSync(filename, { force: true });
  const sqlite = sqliteStores({ filename });
  if (bus === undefined) return sqlite;
  return { ...sqlite, capabilities: ["primary", "bus"], resolve: async (...args: Parameters<StoreAdapter["resolve"]>) => ({ ...(await sqlite.resolve(...args)), bus }) as never } as never;
}

type Host = { state: FlowState; flows: Record<string, unknown>; handle: ServeHandle; base: string };

async function host(stores: StoreAdapter, options: { openInventory: boolean } = { openInventory: true }): Promise<Host> {
  const { state, flows, open } = buildHost(stores);
  if (options.openInventory) await open();
  const handle = await serve(await state.getRouter(), { port: 0, host: "127.0.0.1", handleSignals: false, shutdownGraceMs: 200 });
  return { state, flows, handle, base: `http://127.0.0.1:${handle.port}` };
}

/** Another client of the same user: another tab, another device. Its fetches are not the provider's. */
function writerOn(on: Host): Client {
  const fetcher: ClientFetch = (input, init) => nativeFetch(input, { ...init, headers: { ...(init?.headers as Record<string, string>), authorization: `Bearer ${TOKEN}` } });
  return createClient({ userId: USER, baseUrl: on.base, fetcher });
}

const say = (fsd: Client, sessionId: string, script: Script) => fsd.flow("desk").send("respond", { message: JSON.stringify(script) }, { sessionId });

// ---------------------------------------------------------------------------
// Shift Manager's provider, headless
// ---------------------------------------------------------------------------

type Shown = { at: number; readAt: number; needsYou: number | undefined; sessions: string[] };

/**
 * The provider with a probe under it that records each snapshot it holds and,
 * as Schedules and Usage do on each snapshot read, runs their action on the
 * user's own reading session.
 */
function mountProvider(on: Host) {
  const shown: Shown[] = [];
  function Probe() {
    const { snapshot, client } = useLab();
    const loaded = snapshot !== undefined && snapshot.refused === undefined && snapshot.unreachable === undefined ? snapshot : undefined;
    useEffect(() => {
      if (loaded === undefined) return;
      shown.push({ at: Date.now(), readAt: loaded.readAt, needsYou: loaded.inbox.ok ? loaded.inbox.value.length : undefined, sessions: loaded.sessions.map((s) => s.id) });
      void runAction(client, PROBE_FLOW, readerSessionId(client.userId, PROBE_FLOW), LIST_ROUTINES_ACTION, {}).catch(() => {});
      void runUsageQuery(client, PROBE_FLOW).catch(() => {});
    }, [loaded, client]);
    return null;
  }
  const container = happy.document.createElement("div");
  const root: Root = createRoot(container as unknown as Element);
  root.render(createElement(LabProvider, { connection: { userId: USER, bearerToken: TOKEN, baseUrl: on.base }, children: createElement(Probe) }));
  const origin = new URL(on.base).origin;
  return { shown, reads: () => snapshotReads.filter((r) => r.origin === origin), close: () => root.unmount() };
}
type Provider = ReturnType<typeof mountProvider>;

/** Wait until the provider has made no snapshot read for `quietMs` (at most 20 s). */
async function quiet(provider: Provider, quietMs = 1_500): Promise<void> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const last = provider.reads().at(-1)?.at ?? 0;
    const wait = last + quietMs - Date.now();
    if (wait <= 0 || Date.now() > deadline) return;
    await sleep(Math.min(wait, 200));
  }
}

/** When a doer request first reads `suspended` in the host's store (polled every 5 ms), within `withinMs`. */
async function suspendedAt(on: Host, after: Set<string>, withinMs: number): Promise<{ at: number; id: string } | undefined> {
  const runtime = await on.state.getRuntime();
  const deadline = Date.now() + withinMs;
  while (Date.now() < deadline) {
    const all = (await runtime.stores.request.list({ orderBy: "none", limit: 4000 } as never)) as Array<{ id: string; status: string }>;
    const hit = all.find((r) => r.status === "suspended" && !after.has(r.id));
    if (hit !== undefined) return { at: Date.now(), id: hit.id };
    await sleep(5);
  }
  return undefined;
}
const suspendedNow = async (on: Host) =>
  new Set((((await (await on.state.getRuntime()).stores.request.list({ orderBy: "none", limit: 4000 } as never)) as Array<{ id: string; status: string }>).filter((r) => r.status === "suspended").map((r) => r.id)));

/** When the provider first held a snapshot counting at least `count` things that need the user, after `from`. */
async function needsYouAt(provider: Provider, count: number, from: number, withinMs: number): Promise<number | undefined> {
  const deadline = Date.now() + withinMs;
  for (;;) {
    const hit = provider.shown.find((s) => s.at >= from && (s.needsYou ?? 0) >= count);
    if (hit !== undefined) return hit.at;
    if (Date.now() > deadline) return undefined;
    await sleep(10);
  }
}

/**
 * File one asking task as `file` does, and grade how soon the provider's Inbox
 * count shows it after its run's request reads `suspended`. `file` answers the
 * conversation it opened, which must be one the snapshot didn't list, or
 * `null` when it filed on one already listed.
 */
async function askLeg(
  name: string,
  on: Host,
  provider: Provider,
  file: () => Promise<string | null>,
  boundMs: number,
  failures: string[],
  tell: Parameters<Parameters<typeof runGoal>[0]>[1],
): Promise<string | undefined> {
  const tag = `${name}:ask-within-${boundMs === BOUND_MS ? "1s" : "poll"}`;
  const before = provider.shown.at(-1)?.needsYou ?? 0;
  const known = await suspendedNow(on);
  const listedAtStart = new Set(provider.shown.at(-1)?.sessions ?? []);
  const conversation = await file();
  if (conversation !== null && listedAtStart.has(conversation)) failures.push(`${tag}: setup: the conversation ${conversation} was listed before it filed`);
  const suspended = await suspendedAt(on, known, 15_000);
  if (suspended === undefined) {
    failures.push(`${tag}: setup: the delegate's run never read suspended`);
    return undefined;
  }
  const shownAt = await needsYouAt(provider, before + 1, suspended.at - 2_000, boundMs + 2_000);
  const ms = shownAt === undefined ? undefined : shownAt - suspended.at;
  tell.over(`${tag} · the provider's Inbox count after the ask`, ms === undefined ? [] : [ms]);
  if (ms === undefined) failures.push(`${tag}: the provider's Inbox count never went ${before} → ${before + 1} within ${boundMs + 2_000} ms of the run reading suspended`);
  else if (ms >= boundMs) failures.push(`${tag}: the Inbox count went ${before} → ${before + 1} ${ms} ms after the run read suspended (bound ${boundMs})`);
  else return `${name}: Inbox ${before} → ${before + 1} ${Math.max(0, ms)} ms after the run read suspended, ${conversation === null ? "filed by a server run" : "on a conversation not listed at start"}`;
  return undefined;
}

await runGoal(async (failures, tell) => {
  const evidence: string[] = [];
  const closers: Array<() => void> = [];
  const hosts: Host[] = [];
  try {
    if (legs.has("a") || legs.has("a2") || legs.has("b") || legs.has("c")) {
      const on = await host(stores("lab"));
      hosts.push(on);
      const writer = writerOn(on);
      // A conversation listed at start, for leg c's replies.
      const chat = (await writer.flow("desk").createSession({ state: { workerId: "lead" } })).id;
      await (await say(writer, chat, { op: "chat", count: 1, ms: 10 })).wait();
      const provider = mountProvider(on);
      closers.push(provider.close);
      await sleep(1_500);
      await quiet(provider);
      if (provider.shown.length === 0) throw new Error("setup: the provider never held a snapshot");
      if (!provider.shown.at(-1)!.sessions.includes(chat)) throw new Error("setup: the chat conversation is not listed");

      // a · another client opens a conversation and files a task whose run asks.
      if (legs.has("a")) {
        const line = await askLeg("a", on, provider, async () => {
          const conversation = (await writer.flow("desk").createSession({ state: { workerId: "lead" } })).id;
          await say(writer, conversation, { op: "file", tasks: [{ goal: `${ASK} review the draft ${RUN_STAMP}`, assignee: "eng.doer" }] });
          return conversation;
        }, BOUND_MS, failures, tell);
        if (line !== undefined) evidence.push(line);
        await quiet(provider);
      }

      // a2 · the same, filed on a conversation already listed by a run on the server that no client
      // sent, as a scheduled fire files on the board it names.
      if (legs.has("a2")) {
        const line = await askLeg("a2", on, provider, async () => {
          const runtime = await on.state.getRuntime();
          void (
            runOnServer({
              flow: on.flows.desk as never,
              actionName: "respond",
              input: { message: JSON.stringify({ op: "file", tasks: [{ goal: `${ASK} the scheduled report ${RUN_STAMP}`, assignee: "eng.doer" }] }) },
              userId: USER,
              orgId: ORG,
              sessionId: chat,
              source: "system",
              stores: runtime.stores,
              runtimeConfig: runtime.runtimeConfig,
            } as never) as Promise<{ error?: unknown }>
          ).then((result) => {
            if (result?.error !== undefined) failures.push(`a2:ask-within-1s: setup: the server's filing failed: ${String((result.error as Error).message ?? result.error)}`);
          });
          return null;
        }, BOUND_MS, failures, tell);
        if (line !== undefined) evidence.push(line);
        await quiet(provider);
      }

      // b · idle: Schedules' and Usage's actions run on Shift Manager's own sessions after each read.
      if (legs.has("b")) {
        // Let the reads the probe's own sessions bring settle (their first opens, and their listing).
        await sleep(3_000);
        await quiet(provider, 2_000);
        const from = provider.reads().length;
        const shownFrom = provider.shown.length;
        await sleep(IDLE_MS);
        const idle = provider.reads().length - from;
        tell.over("b:idle-0-reads · snapshots held before the window", provider.shown.slice(0, shownFrom));
        if (idle > 0) failures.push(`b:idle-0-reads: ${idle} snapshot reads over ${IDLE_MS / 1000} s idle`);
        else evidence.push(`b: 0 snapshot reads over ${IDLE_MS / 1000} s idle, Schedules' and Usage's actions run after each of ${shownFrom} reads`);
      }

      // c · a 200-item reply, then a 2-item reply that lasts as long.
      if (legs.has("c")) {
        const during = async (count: number): Promise<number> => {
          await quiet(provider);
          const from = provider.reads().length;
          const sent = await say(writer, chat, { op: "chat", count, ms: 3_000 });
          await sent.wait();
          await quiet(provider);
          return provider.reads().length - from;
        };
        const long = await during(200);
        const short = await during(2);
        tell.over("c:as-short · snapshot reads during the long reply", [long]);
        // A request's own notices (created, started, ended) coalesce into one read or two by how
        // far apart they land, so the two replies may differ by one read. A read per item is ~200.
        if (long > short + JITTER_READS) failures.push(`c:as-short: ${long} snapshot reads during a 200-item reply, ${short} during a 2-item reply of the same length (allowed ${JITTER_READS} more)`);
        else evidence.push(`c: ${long} snapshot reads during a 200-item reply, ${short} during a 2-item one`);
      }
    }

    // d · a bus that doesn't cross: two hosts over one SQLite file, each on its own bus that says
    // so. The provider is on the first; the task is filed, and its run asks, on the second, so no
    // notice reaches the provider's socket and only its fallback pace can find the ask.
    if (legs.has("d")) {
      const busOne = crossingBus();
      busOne.setCrossing(false);
      const busTwo = crossingBus();
      busTwo.setCrossing(false);
      const on = await host(stores("two-processes", busOne));
      hosts.push(on);
      const other = await host(stores("two-processes", busTwo, { fresh: false }), { openInventory: false });
      hosts.push(other);
      const writer = writerOn(other);
      const provider = mountProvider(on);
      closers.push(provider.close);
      await sleep(1_500);
      await quiet(provider);
      const line = await askLeg("d", on, provider, async () => {
        const conversation = (await writer.flow("desk").createSession({ state: { workerId: "lead" } })).id;
        await say(writer, conversation, { op: "file", tasks: [{ goal: `${ASK} review on another process ${RUN_STAMP}`, assignee: "eng.doer" }] });
        return conversation;
      }, POLL_MS + BOUND_MS, failures, tell);
      if (line !== undefined) evidence.push(line.replace("d:", "d (no crossing bus):"));
    }
  } finally {
    for (const close of closers) close();
    for (const h of hosts) await h.handle.close();
  }
  return { failures, evidence: evidence.join(" · ") };
});
