/**
 * shift-manager › its summary changes on its own (FIX-2409; re-pointed at the inbox view by FIX-2774).
 *
 * One `serve()` host on a bound port, on the default in-memory bus, a
 * conversation flow (`desk`) on the Workforce session board and a worker flow
 * (`doer`) whose task turn asks the user (`ctx.suspendForUser`, a review).
 * Shift Manager's own provider (`LabProvider`) runs headless, in this process
 * (react-dom over a happy-dom document; Node's own `fetch` and `WebSocket`),
 * with its Inbox screen drawn under it. What needs the user is the roster
 * flow's inbox view (`useInbox`), so every grade is the value that view pushed
 * to the provider, or the view runs its client made (one `POST …/views/inbox`
 * is one run), counted at its fetcher. Nothing grades a publish or a frame.
 *
 *   a     another client opens a conversation and files a task whose run asks:
 *         the Inbox count goes 0 → 1 within 1 s of the run's request reading `suspended`.
 *   a2    the same, the task filed by a run on the server with no client (as a
 *         scheduled fire files one).
 *   b     10 s idle, with the Routines view and Usage's Re-check and view run
 *         after each value, as those screens do: 0 view runs.
 *   c     a 200-item reply in a worker conversation with no task and no ask, and a
 *         turn started and finished in a worker session with no task and no ask: 0 view runs.
 *   d     a second host whose bus doesn't cross: the ask shows within 30 s + 1 s.
 *   retry the view's read refused once: the Inbox says the server's reason, and its
 *         Retry runs the view again, which lists the ask.
 *   live  directory live: from another client of the same user, a routine paused
 *         and a project added show on the drawn Routines screen and in the
 *         sidebar's PROJECTS within 2 s, each through the read of the screen that
 *         shows it and no other: no session list, manifest, identity or
 *         inventory read.
 *
 * Controls (each runs this file again with a scratch patch applied as it loads):
 *   GOAL_CONTROL=no-subscribe           a view's watch hears no topic: a and live:routine must FAIL.
 *   GOAL_CONTROL=hear-run               the view lists the caller's sessions: c must FAIL.
 *   GOAL_CONTROL=no-poll                the view keeps no fallback timer: d must FAIL.
 *   GOAL_CONTROL=resource-no-subscribe  a collection's live read hears no topic: live:project must FAIL.
 *   GOAL_CONTROL=whole-read             the directory reads all its parts again on any notice: live:own-reads must FAIL.
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
import { PROJECTS_FLOW, ROUTINE_VERBS, SCHEDULES_PATTERN, projectsResource, routinesView } from "@flow-state-dev/workforce/browser";
import {
  defineProjectBlocks,
  defineSessionBoard,
  defineWorkerInventoryCollection,
  inventoryWorkers,
  inventoryWriterActions,
  openInventory,
  workerConfigSchema,
  workerFlow,
  workerTaskEntry,
  type WorkerInstallation,
  type WorkerManifest,
} from "@flow-state-dev/workforce";
import { crossingBus } from "../../lib/crossing-bus.mts";
import { REPO_ROOT, RUN_STAMP, assertPatched, describePatches, goalTmpDir, installWorkers, modulePatchEnv, runGoal, silentLogger, sleep, workforceTree, type ModulePatch } from "../../lib/index.mts";
import { LabProvider, useLab } from "../../../packages/shift-manager/src/lib/lab-data.tsx";
import { useGate } from "../../../packages/shift-manager/src/lib/gate.ts";
import { useInbox } from "../../../packages/shift-manager/src/lib/inbox.ts";
import { recheckHarnessUsage } from "@flow-state-dev/harness-manager/browser";
import { Inbox } from "../../../packages/shift-manager/src/surfaces/Inbox.tsx";
import { Routines } from "../../../packages/shift-manager/src/surfaces/Routines.tsx";
import { Sidebar } from "../../../packages/shift-manager/src/surfaces/Sidebar.tsx";
import { DirectoryProvider } from "../../../packages/shift-manager/src/lib/directory.tsx";
import { PageReadsProvider } from "../../../packages/shift-manager/src/lib/page-reads.tsx";
import { GAPS } from "../../../packages/shift-manager/src/gaps.ts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
const SCRATCH = process.env.GOAL_SCRATCH ?? goalTmpDir("its-summary-changes-on-its-own");
const USER = "alice";
const TOKEN = "tok-alice";
const ORG = "acme";
const BOUND_MS = 1_000;
const IDLE_MS = 10_000;
/** The provider's fallback pace where push can miss a change. */
const POLL_MS = 30_000;
const ASK = "[ask]";
const INVENTORY_WRITER_FLOW = "inventory-writer";
/** What the server answers the view's refused read with, in leg retry. */
const REFUSAL = `The Inbox is down for a moment ${RUN_STAMP}`;

const INBOX = "packages/shift-manager/src/lib/inbox.ts";
const VIEW_WATCH = "packages/client/src/view/view.ts";
const INBOX_VIEW = "packages/workforce/src/workers/inbox-view.ts";
const RESOURCE_READ = "packages/react/src/hooks/useResource.ts";
const DIRECTORY_READS = "packages/shift-manager/src/lib/directory-reads.ts";
const CONTROLS: Record<string, { patches: ModulePatch[]; legs: string; mustFail: string }> = {
  // A view's watch subscribes to no topic its answer names: the Inbox and Routines read only on mount and the person's own reads.
  "no-subscribe": {
    patches: [{ module: VIEW_WATCH, from: String.raw`return \{ value: keepUnchangedEntries\(entry, result\), topics: result\.topics,`, to: "return { value: keepUnchangedEntries(entry, result), topics: []," }],
    legs: "a,live",
    mustFail: "a:ask-within-1s, live:routine-within-2s",
  },
  // A whole collection's live read subscribes to no topic: PROJECTS reads only on mount and the person's own reads.
  "resource-no-subscribe": {
    patches: [{ module: RESOURCE_READ, from: String.raw`\(topics, options\) => client\.subscribe\(topics, options\),`, to: "(_topics, options) => client.subscribe([], options)," }],
    legs: "live",
    mustFail: "live:project-within-2s",
  },
  // The directory reads every one of its parts again on any notice under the user or the org, as one whole-Lab read would.
  "whole-read": {
    patches: [
      {
        module: DIRECTORY_READS,
        from: String.raw`const listing = useSessionList\(\{ client, includeDispatchRuns: true, includeStatus: false \}\);`,
        to: "const listing = useSessionList({ client, includeDispatchRuns: true, includeStatus: false }); const again = [inventory.refresh, shared.refresh, own.refresh, listing.refresh]; React.useEffect(() => { const held = client.subscribe([{ scope: \"user\" }, { scope: \"org\" }], { onChange: (notice) => { if (notice !== null) for (const read of again) read(); } }); return () => held.close(); }, [client]);",
      },
    ],
    legs: "live",
    mustFail: "live:own-reads",
  },
  // The view finds an ask's worker through the session list, which is heard on every turn's
  // `run` on the user topic.
  "hear-run": {
    patches: [{ module: INBOX_VIEW, from: String.raw`const sessions = sessionsOf\(ctx\);`, to: "const sessions = sessionsOf(ctx); await sessions.list({ limit: 100 });" }],
    legs: "c",
    mustFail: "c:quiet",
  },
  // The view keeps no fallback timer: where push can miss a change, nothing reads.
  "no-poll": {
    patches: [{ module: INBOX, from: String.raw`pollIntervalMs: INBOX_POLL_MS,`, to: "pollIntervalMs: null," }],
    legs: "d",
    mustFail: "d:ask-within-poll",
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
const legs = new Set((process.env.GOAL_LEGS ?? "a,a2,b,c,d,retry,live").split(",").map((s) => s.trim()).filter(Boolean));


// ---------------------------------------------------------------------------
// A DOM for react-dom, and nothing else. The provider's fetches are counted
// here: it builds its own client, whose fetcher calls the global `fetch`.
// ---------------------------------------------------------------------------

const happy = new Window();
// `React` too: tsx compiles Shift Manager's `.tsx` with the classic JSX runtime, which reads it off the global scope.
Object.assign(globalThis, { window: happy, document: happy.document, IS_REACT_ACT_ENVIRONMENT: false, React });

const nativeFetch = globalThis.fetch;
/** Each run of the inbox view the providers made, by the host it read. */
const viewRuns: Array<{ at: number; origin: string }> = [];
/** Leg retry: the next inbox view read is refused with {@link REFUSAL}, once. */
let refuseNextView = false;
/** Every request the providers made, by the host it read: what leg live grades its reads on. */
const requests: Array<{ at: number; origin: string; method: string; path: string }> = [];
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input instanceof Request ? input.url : input));
  requests.push({ at: Date.now(), origin: url.origin, method: init?.method ?? (input instanceof Request ? input.method : "GET"), path: decodeURIComponent(url.pathname + url.search) });
  if (url.pathname.endsWith("/views/inbox")) {
    viewRuns.push({ at: Date.now(), origin: url.origin });
    if (refuseNextView) {
      refuseNextView = false;
      return Promise.resolve(new Response(JSON.stringify({ error: REFUSAL }), { status: 503, headers: { "content-type": "application/json" } }));
    }
  }
  return nativeFetch(input, init);
}) as typeof fetch;

// ---------------------------------------------------------------------------
// The app
// ---------------------------------------------------------------------------

const worker = (id: string, declared: Record<string, unknown>): WorkerManifest => ({ id, declared, body: "", skills: [] });
const WORKERS: WorkerManifest[] = [
  worker("lead", { flow: "desk", description: "Files the tasks.", delegates: ["eng.doer"] }),
  worker("eng.doer", { flow: "doer", description: "Works the tasks it is filed.", delegates: [] }),
];

type Script = { op: "file"; tasks: TaskInit[] } | { op: "chat"; count: number; ms: number };

/** The desk's and the doer's flows, built on the installation that runs their workers. */
function workerFlowsOn(installation: WorkerInstallation) {
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
      views: { ...board.views },
      internal: { actions: board.entries(turn as never) },
      task: { actions: { work: workerTaskEntry({ name: `summary-${kind}-task`, turn: turn as never }) } },
    } as never);
  return { desk: flowOf("desk", deskBoard, deskBoard.planned(deskTurn)), doer: flowOf("doer", doerBoard, doerTurn) };
}

async function buildHost(stores: StoreAdapter): Promise<{ state: FlowState; flows: Record<string, unknown>; open: () => Promise<void> }> {
  // The two flows share their boards, so both are built once, on the one installation the kit hires.
  let built: ReturnType<typeof workerFlowsOn> | undefined;
  const on = (installation: WorkerInstallation) => (built ??= workerFlowsOn(installation));
  const { installation, copies } = await installWorkers(workforceTree(WORKERS), {
    desk: workerFlow((installation) => on(installation).desk, { roles: ["contributor", "manager"] }),
    doer: workerFlow((installation) => on(installation).doer, { roles: ["contributor", "manager"] }),
  });

  const flows: Record<string, unknown> = {
    ...Object.fromEntries(copies.map((copy) => [copy.id, copy])),
    [INVENTORY_WRITER_FLOW]: defineFlow({ kind: INVENTORY_WRITER_FLOW, internal: { actions: { ...inventoryWriterActions() } } } as never)(),
    // Leg live: the projects a person adds, read by scope as PROJECTS reads them.
    [PROJECTS_FLOW]: defineFlow({ kind: PROJECTS_FLOW, actions: defineProjectBlocks().actions } as never)(),
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
    flows: Object.values(flows),
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
  const { state, flows, open } = await buildHost(stores);
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

type Shown = { at: number; needsYou: number | undefined; failure: string | undefined };

/**
 * The provider with its Inbox screen drawn under it, and a probe that records
 * each value the inbox view pushed (what needs the user) and, as Routines and
 * Usage do, reads the routines view and runs Usage's Re-check and view after
 * each one. None of them names a session (FIX-2624); this host serves no
 * usage, so the Re-check answers that it serves none.
 */
function mountProvider(on: Host) {
  const shown: Shown[] = [];
  function Probe() {
    const { client } = useLab();
    // The shell reads the Inbox once the gate lets Shift Manager in, as the page does (`App.tsx`).
    const inside = useGate().gate.state === "in";
    const inbox = useInbox(inside);
    useEffect(() => {
      if (inbox.section === undefined) return;
      shown.push({ at: Date.now(), needsYou: inbox.section.ok ? inbox.section.value.items.length : undefined, failure: inbox.section.ok ? undefined : inbox.section.failure.message });
      void client.view(routinesView, {}).catch(() => {});
      // Usage's Re-check, as the screen sends it when it opens (FIX-2775: the rows are then the view's).
      void recheckHarnessUsage(client).catch(() => {});
    }, [inbox.section, client]);
    return inside ? createElement(Inbox, { itemId: null, gaps: GAPS }) : null;
  }
  const container = happy.document.createElement("div");
  happy.document.body.appendChild(container);
  const root: Root = createRoot(container as unknown as Element);
  root.render(createElement(LabProvider, { connection: { userId: USER, bearerToken: TOKEN, baseUrl: on.base }, children: createElement(Probe) }));
  const origin = new URL(on.base).origin;
  return { shown, container, runs: () => viewRuns.filter((r) => r.origin === origin), close: () => root.unmount() };
}
type Provider = ReturnType<typeof mountProvider>;

/**
 * A provider with the Routines screen and the sidebar drawn under it, as the
 * page draws them once the gate lets Shift Manager in: the directory, the
 * page's reads, and each screen's own.
 */
function mountDirectory(on: Host) {
  function Screens() {
    const inside = useGate().gate.state === "in";
    if (!inside) return null;
    return createElement(
      DirectoryProvider,
      null,
      createElement(
        PageReadsProvider,
        null,
        createElement(Sidebar, { route: { level: "routines" }, gaps: GAPS, onJump: () => {}, collapsed: false, onToggle: () => {} }),
        createElement(Routines),
      ),
    );
  }
  const container = happy.document.createElement("div");
  happy.document.body.appendChild(container);
  const root: Root = createRoot(container as unknown as Element);
  root.render(createElement(LabProvider, { connection: { userId: USER, bearerToken: TOKEN, baseUrl: on.base }, children: createElement(Screens) }));
  const origin = new URL(on.base).origin;
  return { container, requests: () => requests.filter((r) => r.origin === origin), close: () => root.unmount() };
}

/** The reads only a whole-Lab read makes: none of the screens leg live draws reads them for a routine or a project. */
const WHOLE_LAB_READ = [/\/sessions\?/, /\/manifest\b/, /\/identity\b/, /inventory\/workers/];

/** Wait until the provider has run the inbox view no more for `quietMs` (at most 20 s). */
async function quiet(provider: Provider, quietMs = 1_500): Promise<void> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const last = provider.runs().at(-1)?.at ?? 0;
    const wait = last + quietMs - Date.now();
    if (wait <= 0 || Date.now() > deadline) return;
    await sleep(Math.min(wait, 200));
  }
}

/** Wait until `read` answers something `done` takes, polling every 50 ms, at most `ms`. */
async function until<T>(read: () => T, done: (value: T) => boolean, ms: number): Promise<T> {
  let last = read();
  for (const deadline = Date.now() + ms; !done(last) && Date.now() < deadline; last = read()) await sleep(50);
  return last;
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

/** When the inbox view first pushed a value counting at least `count` things that need the user, after `from`. */
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
  const conversation = await file();
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
  else return `${name}: Inbox ${before} → ${before + 1} ${Math.max(0, ms)} ms after the run read suspended, ${conversation === null ? "filed by a server run" : "on a conversation opened after the view first ran"}`;
  return undefined;
}

await runGoal(async (failures, tell) => {
  const evidence: string[] = [];
  const closers: Array<() => void> = [];
  const hosts: Host[] = [];
  try {
    if (legs.has("a") || legs.has("a2") || legs.has("b") || legs.has("c") || legs.has("retry")) {
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
      if (provider.shown.length === 0) throw new Error("setup: the inbox view never pushed a value");

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

      // b · idle: the Routines view and Usage's Re-check and view run after each value.
      if (legs.has("b")) {
        // Let the runs the setup brought settle.
        await sleep(3_000);
        await quiet(provider, 2_000);
        const from = provider.runs().length;
        const shownFrom = provider.shown.length;
        await sleep(IDLE_MS);
        const idle = provider.runs().length - from;
        tell.over("b:idle-0-reads · values the view pushed before the window", provider.shown.slice(0, shownFrom));
        if (idle > 0) failures.push(`b:idle-0-reads: ${idle} inbox view runs over ${IDLE_MS / 1000} s idle`);
        else evidence.push(`b: 0 inbox view runs over ${IDLE_MS / 1000} s idle, the Routines view and Usage's Re-check and view run after each of ${shownFrom} values`);
      }

      // c · a 200-item reply in a worker conversation with no task and no ask, and a turn in a
      // worker session with no task and no ask: neither is anything the view read.
      if (legs.has("c")) {
        const quietChat = (await writer.flow("desk").createSession({ state: { workerId: "lead" } })).id;
        const doerSession = (await writer.flow("doer").createSession({ state: { workerId: "eng.doer" } })).id;
        const during = async (go: () => Promise<{ wait: () => Promise<unknown> }>): Promise<number> => {
          await quiet(provider);
          const from = provider.runs().length;
          await (await go()).wait();
          await quiet(provider);
          return provider.runs().length - from;
        };
        const reply = await during(() => say(writer, quietChat, { op: "chat", count: 200, ms: 3_000 }));
        const turn = await during(() => writer.flow("doer").send("respond", { message: "Say hello." }, { sessionId: doerSession }));
        tell.over("c:quiet · inbox view runs during the reply and the turn", [reply, turn]);
        if (reply > 0 || turn > 0) failures.push(`c:quiet: ${reply} inbox view runs during a 200-item reply in a conversation with no task and no ask, ${turn} during a turn in a worker session with neither`);
        else evidence.push(`c: 0 inbox view runs during a 200-item reply and during a worker session's turn, neither holding a task or an ask`);
      }

      // retry · the view's read refused once: the Inbox says why, and its Retry runs it again.
      if (legs.has("retry")) {
        if ((provider.shown.at(-1)?.needsYou ?? 0) === 0) {
          // Something to list once the read lands.
          const known = await suspendedNow(on);
          const conversation = (await writer.flow("desk").createSession({ state: { workerId: "lead" } })).id;
          await say(writer, conversation, { op: "file", tasks: [{ goal: `${ASK} review it again ${RUN_STAMP}`, assignee: "eng.doer" }] });
          if ((await suspendedAt(on, known, 15_000)) === undefined) failures.push("retry:shows-reason: setup: the delegate's run never read suspended");
        }
        refuseNextView = true;
        const second = mountProvider(on);
        closers.push(second.close);
        const failure = await until(() => second.container.querySelector('[data-testid="section-failure"]')?.textContent ?? null, (text) => text !== null, 10_000);
        if (failure === null || !failure.includes(REFUSAL)) failures.push(`retry:shows-reason: the Inbox says ${JSON.stringify(failure)}, not the server's reason`);
        else evidence.push("retry: the Inbox showed the server's reason for the refused read");
        const retry = ([...second.container.querySelectorAll("button")] as unknown as HTMLButtonElement[]).find((button) => button.textContent === "Retry");
        if (retry === undefined) failures.push("retry:lists-ask: the failed Inbox offers no Retry");
        else {
          const runsBefore = second.runs().length;
          retry.click();
          const listed = await until(() => second.container.querySelectorAll('[data-testid="inbox-item"]').length, (n) => n > 0, 10_000);
          if (second.runs().length === runsBefore) failures.push("retry:lists-ask: Retry didn't run the inbox view");
          else if (listed === 0) failures.push("retry:lists-ask: after Retry the Inbox lists nothing");
          else evidence.push(`retry: Retry ran the view again, and the Inbox lists ${listed} item(s)`);
        }
      }
    }

    // live · from another client of the same user, a routine paused and a project added show on the
    // drawn page within 2 s, each through its own screen's read and no whole-Lab read.
    if (legs.has("live")) {
      const on = await host(stores("live"));
      hosts.push(on);
      const writer = writerOn(on);
      const routine = `standup-${RUN_STAMP}`;
      // A routine on a working schedule, saved as the user from another session: weekdays at 9, on the lead's board.
      const saved = await writer
        .resource({ scope: "user", pattern: SCHEDULES_PATTERN })
        .send<{ ok?: unknown; error?: unknown }>(ROUTINE_VERBS.save, { name: routine, trigger: { clock: { cron: "0 9 * * 1-5" } }, task: { filer: "lead", goal: `Write the stand-up notes ${RUN_STAMP}`, assignee: "eng.doer" } });
      if (saved?.ok !== true) throw new Error(`setup: saving the routine answered ${JSON.stringify(saved)}`);
      // A shared project the page must list once its opening projects read lands: the sign it has, so a later
      // project can only reach PROJECTS through a read the change itself starts.
      const seeded = `seeded-${RUN_STAMP}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
      await writer.resource(projectsResource).send("createProject", { id: seeded, title: `Seeded ${RUN_STAMP}` });
      const page = mountDirectory(on);
      closers.push(page.close);
      const drawn = () => page.container.querySelector(`[data-testid="routine"][data-id="clock:${routine}"]`);
      if ((await until(drawn, (el) => el !== null, 15_000)) === null) throw new Error("setup: the Routines screen never drew the routine");
      if ((await until(() => page.container.querySelector(`[data-testid="nav-project-${seeded}"]`), (el) => el !== null, 15_000)) === null) {
        throw new Error("setup: PROJECTS never listed the project saved before the page opened");
      }
      // Let the page's opening reads, and any its socket's connect makes, land.
      await sleep(3_000);

      /**
       * Write with `write`, then wait for `shown`: how long it took to show, timed from before the
       * write was sent (so the write's own round trip counts against the bound), and every request
       * the page made from then until it showed.
       */
      const change = async (write: () => Promise<unknown>, shown: () => boolean) => {
        const from = Date.now();
        const fromIndex = page.requests().length;
        await write();
        await until(() => shown(), (ok) => ok, 2_000 + 3_000);
        const ms = shown() ? Date.now() - from : undefined;
        return { ms, made: page.requests().slice(fromIndex) };
      };

      const paused = await change(
        () => writer.resource({ scope: "user", pattern: SCHEDULES_PATTERN }).send(ROUTINE_VERBS.pause, { id: `clock:${routine}`, paused: true }),
        () => drawn()?.getAttribute("data-paused") === "true",
      );
      tell.over("live:routine-within-2s · ms from the pause to the drawn Routines screen", paused.ms === undefined ? [] : [paused.ms]);
      if (paused.ms === undefined || paused.ms >= 2_000) failures.push(`live:routine-within-2s: the paused routine ${paused.ms === undefined ? "never showed paused within 5 s" : `showed paused ${paused.ms} ms after the pause`} (bound 2000)`);
      else evidence.push(`live: Routines drew the routine paused ${paused.ms} ms after another session paused it`);

      const project = `apollo-${RUN_STAMP}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
      const added = await change(
        // As an app adds one: through the projects collection, whose `runBy` is the projects flow.
        () => writer.resource(projectsResource).send("createProject", { id: project, title: `Apollo ${RUN_STAMP}` }),
        () => page.container.querySelector(`[data-testid="nav-project-${project}"]`) !== null,
      );
      tell.over("live:project-within-2s · ms from the add to PROJECTS", added.ms === undefined ? [] : [added.ms]);
      if (added.ms === undefined || added.ms >= 2_000) failures.push(`live:project-within-2s: the added project ${added.ms === undefined ? "never showed in PROJECTS within 5 s" : `showed in PROJECTS ${added.ms} ms after it was added`} (bound 2000)`);
      else evidence.push(`live: PROJECTS listed the project ${added.ms} ms after another session added it`);

      // Each change reads what shows it, and nothing a whole-Lab read reads.
      const made = [...paused.made, ...added.made];
      tell.over("live:own-reads · the page's requests while each change showed", made.map((r) => `${r.method} ${r.path}`));
      const whole = made.filter((r) => WHOLE_LAB_READ.some((pattern) => pattern.test(r.path)));
      const routinesRead = paused.made.some((r) => r.path.endsWith("/views/routines"));
      const projectsRead = added.made.some((r) => /\/resources\/(org|user)\/projects\//.test(r.path));
      const listings = whole.filter((r) => /\/sessions\?/.test(r.path));
      if (whole.length > 0) {
        failures.push(
          `live:own-reads: ${whole.length} whole-Lab read(s) while the changes showed: ${whole.map((r) => `${r.method} ${r.path}`).join(", ")}` +
            (listings.length === whole.length
              ? " (owed by FIX-2864: every one is the session list, read again on each write's run notice, which names no session; this signal stays red until it lands)"
              : ""),
        );
      }
      else if (!routinesRead || !projectsRead) failures.push(`live:own-reads: the changes showed without the screens' own reads (routines view ${routinesRead}, projects read ${projectsRead})`);
      else evidence.push(`live: ${made.length} request(s) while the changes showed, the routines view and the projects read among them, no session list, manifest, identity or inventory read`);
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
