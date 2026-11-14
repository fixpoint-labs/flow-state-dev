/**
 * notices › one change re-reads one row (FIX-2625).
 *
 * One `serve()` host on a bound port with push, on the default in-memory bus
 * (it crosses, so no screen keeps a timer), run twice: with ids on, then with
 * org ids off (`noticeIds: { org: false }`). On it, a flow with a session
 * board of 200 tasks (orchestration's task board and its task-list view, which
 * opts in to answering for the tasks a notice names), a second keyed view of
 * the board that does not opt in and orders by status, and an org collection
 * of 200 entries written through the default write flow.
 *
 * A screen (react-dom over happy-dom, under `FlowProvider`, with a fetcher that
 * records every answer) watches the board view and the second view
 * (`useView`, poll off) and the collection (`useResource`). A second client
 * writes. After each step every request has settled and the screen is quiet;
 * then the screen is compared with a fresh whole read.
 *
 *   a  — one task's edit makes the board view answer exactly 1 row; one
 *        entry's edit makes the collection read fetch exactly 1 entry and no
 *        list.
 *   b  — after a single edit, a follow-up's ending (which changes its root's
 *        row too: a row that shows another task's data), a burst of 300
 *        writes, a cancelled task and a deleted entry, each screen equals a
 *        fresh whole read; the second view, which a status change reorders,
 *        too.
 *   c  — with org ids off, no org frame on the screen's socket carries `ids`
 *        and no scope-wide org frame names an entry key, while the screens
 *        stay equal to the store.
 *   d  — a client built from main before this change (`OLD_CLIENT_REF`)
 *        against this host passes b.
 *
 * Controls (each runs this file again with a patch applied as it loads):
 *   GOAL_CONTROL=identity-only  the board's partial answer re-runs only the rows whose keys equal the ids: b must FAIL.
 *   GOAL_CONTROL=drop-ids       the publish queue drops every notice's ids: a must FAIL.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Window } from "happy-dom";
import * as React from "react";
import { createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { z } from "zod";
import { defineFlow, defineResourceCollection, defineView, handler } from "@flow-state-dev/core";
import type { BlockContext, FlowInstance } from "@flow-state-dev/core/types";
import { createClient, viewRef, type Client } from "@flow-state-dev/client";
import { createFlowApiRouter, createFlowRegistry, type StoreRegistry } from "@flow-state-dev/engine";
import { createInMemoryStores } from "@flow-state-dev/engine/host";
import { serve, type ServeHandle } from "@flow-state-dev/node";
import { defineTaskCollection, getOrCreateTaskCollection, resolveResourceCollection, ticketForClaim } from "@flow-state-dev/orchestration/tasks";
import { taskToolViews } from "@flow-state-dev/orchestration/internal";
import { taskListViewRef } from "@flow-state-dev/orchestration/inbox";
import { FlowProvider, useResource, useView } from "@flow-state-dev/react";
import { REPO_ROOT, RUN_STAMP, assertPatched, describePatches, goalTmpDir, modulePatchEnv, runGoal, type ModulePatch } from "../../lib/index.mts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
const SCRATCH = process.env.GOAL_SCRATCH ?? goalTmpDir("notices-one-row");
/** Main before this change: the client every open tab ran. */
const OLD_CLIENT_REF = process.env.GOAL_OLD_CLIENT_REF ?? "f246e64ca79732313463b725ca27f2013d5fc926";
const ORG = "acme";
const FLOW = "notice-desk";
const BOARD = "desk";
const CONV = "conv";
const TASKS = 200;
const ENTRIES = 200;

const PATCHES: Record<string, ModulePatch[]> = {
  // The board's partial answer re-runs only the rows whose keys are the ids: a follow-up's root goes stale.
  "identity-only": [
    {
      module: "packages/orchestration/src/skills/task-tools-capability.ts",
      from: String.raw`return board\.filter\(\(t\) => chains\.has\(t\.followUpOf \?\? t\.id\)\);`,
      to: "return board.filter((t) => ids.includes(t.id));",
    },
  ],
  // Publishers send no ids: every notice reads everything.
  "drop-ids": [
    {
      module: "packages/engine/src/bus/publish-writes.ts",
      from: String.raw`queued\.set\(key, fold\(queued\.get\(key\), notice\)\);`,
      to: "queued.set(key, { ...notice, ids: undefined });",
    },
  ],
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
    env: { ...process.env, GOAL_SCRATCH: SCRATCH, ...modulePatchEnv(PATCHES[CONTROL]!, REPO_ROOT, mark) },
  });
  assertPatched(PATCHES[CONTROL]!, REPO_ROOT, mark);
  process.exit(child.status ?? 1);
}

// The client checks each partial answer against a whole run in development
// and tests, and shows the whole one: that would hide the identity-only
// control's stale row. This goal grades what production shows.
if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") delete process.env.NODE_ENV;

const happy = new Window();
Object.assign(globalThis, { window: happy, document: happy.document, IS_REACT_ACT_ENVIRONMENT: false, React });

// ---------------------------------------------------------------------------
// Every frame a socket in this process hears, by the client that opened it.
// ---------------------------------------------------------------------------

type Frame = { owner: string; at: number; frame: { type?: string; topic?: { scope?: string; resource?: string }; ids?: unknown } };
const frames: Frame[] = [];
let socketOwner = "";
const RealWebSocket = globalThis.WebSocket;
class TappedWebSocket extends RealWebSocket {
  constructor(url: string | URL, protocols?: string | string[]) {
    super(url, protocols);
    const owner = socketOwner;
    this.addEventListener("message", (event: MessageEvent) => {
      try {
        frames.push({ owner, at: Date.now(), frame: JSON.parse(String(event.data)) });
      } catch {
        // Not a frame this check reads.
      }
    });
  }
}
globalThis.WebSocket = TappedWebSocket as typeof WebSocket;

// ---------------------------------------------------------------------------
// The app: a session board, a view that doesn't opt in, an org collection.
// ---------------------------------------------------------------------------

const projects = defineResourceCollection({
  pattern: "projects/*",
  scope: "org",
  stateSchema: z.object({ name: z.string().default("") }),
  client: { state: { read: true } },
  runBy: "default",
  canWrite: () => true,
});

async function board(ctx: BlockContext) {
  const collection = resolveResourceCollection(ctx, BOARD);
  if (collection === undefined) throw new Error("the board is not declared");
  return getOrCreateTaskCollection({ ctx, backing: "resource", collectionId: BOARD, collection });
}

const taskId = (i: number) => `t${String(i).padStart(3, "0")}`;
const entryKey = (i: number) => `projects/p${String(i).padStart(3, "0")}`;

/** A second view of the board that never opts in: id and status, ordered by status, so a status change reorders it. */
const byStatus = handler({
  name: "by-status",
  inputSchema: z.object({}),
  outputSchema: z.array(z.object({ id: z.string(), status: z.string() })),
  execute: async (_input, ctx) =>
    (await board(ctx))
      .list()
      .map((t) => ({ id: t.id, status: t.status }))
      .sort((x, y) => x.status.localeCompare(y.status) || x.id.localeCompare(y.id)),
});

const act = (name: string, input: z.ZodTypeAny, execute: (input: any, ctx: any) => Promise<void>) =>
  handler({ name, inputSchema: input, outputSchema: z.object({}), resources: { projects }, execute: async (i, ctx) => (await execute(i, ctx), {}) });

function deskFlow(): FlowInstance {
  return defineFlow({
    kind: FLOW,
    resources: { [BOARD]: defineTaskCollection({ id: BOARD, scope: "user", delivery: {} }), projects },
    actions: {
      // 200 tasks, the first one completed with a follow-up filed under it; 200 org entries.
      seed: act("seed", z.object({}), async (_i, ctx) => {
        const desk = await board(ctx);
        for (let i = 0; i < TASKS - 1; i += 1) await desk.createTask({ id: taskId(i), goal: `task ${i}` });
        const root = (await desk.claim("w", { eligibility: (t) => t.id === taskId(0) }))!;
        await desk.complete(root.id, { done: true }, { claim: ticketForClaim(BOARD, root, desk.partition) });
        await desk.createTask({ id: "f000", goal: "follow up task 0", followUpOf: taskId(0) });
        for (let i = 0; i < ENTRIES; i += 1) await ctx.resources.projects.create(entryKey(i).slice("projects/".length), { name: `project ${i}` });
      }),
      file: act("file", z.object({ ids: z.array(z.string()) }), async ({ ids }, ctx) => {
        const desk = await board(ctx);
        for (const id of ids) await desk.createTask({ id, goal: `filed ${id}` });
      }),
      hold: act("hold", z.object({ ids: z.array(z.string()) }), async ({ ids }, ctx) => {
        const desk = await board(ctx);
        for (const id of ids) await desk.patchSettings(id, { held: true });
      }),
      finish: act("finish", z.object({ id: z.string() }), async ({ id }, ctx) => {
        const desk = await board(ctx);
        const claimed = (await desk.claim("w", { eligibility: (t) => t.id === id }))!;
        await desk.complete(id, { done: id }, { claim: ticketForClaim(BOARD, claimed, desk.partition) });
      }),
      cancel: act("cancel", z.object({ id: z.string() }), async ({ id }, ctx) => {
        await (await board(ctx)).cancel(id);
      }),
      rename: act("rename", z.object({ keys: z.array(z.string()), name: z.string() }), async ({ keys, name }, ctx) => {
        for (const key of keys) await ctx.resources.projects.create(key.slice("projects/".length), { name }, { replace: true });
      }),
    },
    views: {
      ...taskToolViews(BOARD, (ctx) => board(ctx)),
      byStatus: defineView({ scope: "session", block: byStatus, key: (row: { id: string }) => row.id }),
    },
  })() as unknown as FlowInstance;
}

// ---------------------------------------------------------------------------
// Host, clients and the screen.
// ---------------------------------------------------------------------------

type Host = { handle: ServeHandle; base: string; stores: StoreRegistry };

async function host(noticeIds?: { org: false }): Promise<Host> {
  const registry = createFlowRegistry();
  registry.register(deskFlow());
  const stores = createInMemoryStores();
  const router = createFlowApiRouter({
    registry,
    stores,
    staleSweepIntervalMs: 0,
    ...(noticeIds !== undefined ? { noticeIds } : {}),
    resolvePrincipal: (context) => {
      const token = (context.request?.headers.get("authorization") ?? "").replace(/^Bearer /, "");
      return token.startsWith("tok-") ? { userId: "alice", orgId: ORG } : null;
    },
  });
  const handle = await serve(router, { port: 0, host: "127.0.0.1", handleSignals: false, shutdownGraceMs: 200 });
  return { handle, base: `http://127.0.0.1:${handle.port}`, stores };
}

/** One answer a screen's client got: the URL, and the parsed body of a view's or an entry's read. */
type Answer = { at: number; url: string; body: any };

/** A fetcher as alice that records every answer it got, and how many calls are out. */
function recordingFetch(token: string) {
  const answers: Answer[] = [];
  let out = 0;
  let lastAt = Date.now();
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = decodeURIComponent(String(input instanceof Request ? input.url : input));
    out += 1;
    lastAt = Date.now();
    try {
      const response = await fetch(input, { ...init, headers: { ...(init?.headers as Record<string, string>), authorization: `Bearer ${token}` } });
      if (url.includes("/views/") || url.includes("/resources/org/")) {
        answers.push({ at: Date.now(), url, body: await response.clone().json().catch(() => undefined) });
      }
      return response;
    } finally {
      out -= 1;
      lastAt = Date.now();
    }
  };
  return { fetcher, answers, idle: () => out === 0, lastAt: () => lastAt };
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const BOARD_REF = taskListViewRef(FLOW, BOARD);
const STATUS_REF = viewRef(FLOW, "byStatus");

type Shown = { board?: unknown[]; byStatus?: unknown[]; projects?: unknown[] };

/** The screen: the board view, the second view and the collection, under one provider, on its own client. */
function mountScreen(on: Host, token: string) {
  const recorded = recordingFetch(token);
  const shown: Shown = {};
  function Probe() {
    const boardView = useView(BOARD_REF, {}, { sessionId: CONV, pollIntervalMs: null });
    const statusView = useView(STATUS_REF, {}, { sessionId: CONV, pollIntervalMs: null });
    const entries = useResource(projects);
    useEffect(() => {
      shown.board = boardView.value as unknown[] | undefined;
      shown.byStatus = statusView.value as unknown[] | undefined;
      shown.projects = entries.value ?? undefined;
    });
    return null;
  }
  const container = happy.document.createElement("div");
  socketOwner = token;
  const root: Root = createRoot(container as never);
  root.render(createElement(FlowProvider as never, { userId: "alice", baseUrl: on.base, fetcher: recorded.fetcher } as never, createElement(Probe)));
  return { shown, recorded, close: () => root.unmount() };
}

/** Wait until the screen's client has nothing out and has made no call for `quietMs`. */
async function quiet(recorded: { idle: () => boolean; lastAt: () => number }, quietMs = 800): Promise<void> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (recorded.idle() && Date.now() - recorded.lastAt() >= quietMs) return;
    if (Date.now() > deadline) throw new Error("setup: the screen never went quiet");
    await delay(50);
  }
}

/** A client of alice's that writes and reads whole. */
function plainClient(on: Host, token: string): Client {
  return createClient({
    userId: "alice",
    baseUrl: on.base,
    fetcher: (input, init) => fetch(input, { ...init, headers: { ...(init?.headers as Record<string, string>), authorization: `Bearer ${token}` } }),
  });
}

async function send(writer: Client, action: string, input: unknown, sessionId = CONV): Promise<void> {
  await (await writer.flow(FLOW).send(action, input, { sessionId })).wait();
}

/** The store as a whole read answers it now. */
async function wholeRead(reader: Client) {
  return {
    board: (await reader.view(BOARD_REF, {}, { sessionId: CONV })).value as unknown[],
    byStatus: (await reader.view(STATUS_REF, {}, { sessionId: CONV })).value as unknown[],
    projects: (await reader.resource(projects).list({ limit: ENTRIES })).items as unknown[],
  };
}

/** Where `shown` differs from a fresh whole read: a list of `what: why`. */
async function diffFromStore(shown: Shown, reader: Client, step: string, failures: string[], graded: string[]): Promise<void> {
  const store = await wholeRead(reader);
  for (const what of ["board", "byStatus", "projects"] as const) {
    const screen = shown[what];
    graded.push(`${step}/${what}`);
    if (!Array.isArray(screen) || screen.length === 0) {
      failures.push(`b:equals-store: after ${step}, the ${what} screen shows nothing`);
      continue;
    }
    if (JSON.stringify(screen) !== JSON.stringify(store[what])) {
      const held = new Map((screen as Array<{ id?: string; storageKey?: string }>).map((e) => [e.id ?? e.storageKey, JSON.stringify(e)]));
      const stale = (store[what] as Array<{ id?: string; storageKey?: string }>).filter((e) => held.get(e.id ?? e.storageKey) !== JSON.stringify(e)).map((e) => e.id ?? e.storageKey);
      failures.push(`b:equals-store: after ${step}, the ${what} screen differs from a whole read (${screen.length} shown, ${store[what].length} stored; differs at ${stale.slice(0, 5).join(", ") || "order"})`);
    }
  }
}

// ---------------------------------------------------------------------------
// Main before this change, extracted and loaded beside this checkout's packages.
// ---------------------------------------------------------------------------

async function oldClientModule(): Promise<{ createClient: typeof createClient; watchView: any }> {
  const dir = join(SCRATCH, `old-client-${RUN_STAMP}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "packages/client"), { recursive: true });
  const tar = execFileSync("git", ["-C", REPO_ROOT, "archive", OLD_CLIENT_REF, "packages/client/src"]);
  execFileSync("tar", ["-x", "-C", dir], { input: tar });
  // Its imports resolve to this checkout's packages (contracts only adds a field).
  symlinkSync(join(REPO_ROOT, "packages/client/node_modules"), join(dir, "packages/client/node_modules"));
  const index = await import(pathToFileURL(join(dir, "packages/client/src/index.ts")).href);
  const view = await import(pathToFileURL(join(dir, "packages/client/src/view/view.ts")).href);
  return { createClient: index.createClient, watchView: view.watchView };
}

// ---------------------------------------------------------------------------
// The run.
// ---------------------------------------------------------------------------

/** One task edit and one entry edit, with the answers each made the screen read. */
async function singleEdits(on: Host, writer: Client, screen: ReturnType<typeof mountScreen>) {
  const before = screen.recorded.answers.length;
  // From another session, as another client's edit is: the watched session's own request notices stay quiet.
  await send(writer, "hold", { ids: [taskId(42)] }, "writer-0");
  await quiet(screen.recorded);
  const boardAnswers = screen.recorded.answers.slice(before).filter((a) => a.url.includes(`/views/${BOARD_REF.view}`));
  const entryBefore = screen.recorded.answers.length;
  await writer.resource(projects).entry(entryKey(42)).set({ name: "renamed 42" });
  await quiet(screen.recorded);
  const entryAnswers = screen.recorded.answers.slice(entryBefore).filter((a) => a.url.includes("/resources/org/"));
  return { boardAnswers, entryAnswers };
}

await runGoal(async (failures, tell) => {
  const evidence: string[] = [];
  const closers: Array<() => Promise<void> | void> = [];
  try {
    // ------------------------------------------------------------ a, b (ids on)
    const on = await host();
    closers.push(() => on.handle.close());
    const writer = plainClient(on, "tok-writer");
    const reader = plainClient(on, "tok-reader");
    await writer.flow(FLOW).createSession({ sessionId: CONV } as never).catch(() => undefined);
    await send(writer, "seed", {});
    const screen = mountScreen(on, "tok-screen");
    closers.push(screen.close);
    await quiet(screen.recorded, 1_500);
    const equalsGraded: string[] = [];

    // a · one task's edit, one entry's edit.
    const single = await singleEdits(on, writer, screen);
    const boardRows = tell.over("a:one-row · board view answers after one task's edit", single.boardAnswers);
    const nonOne = boardRows.filter((a) => a.body?.partial === undefined || (a.body?.output as unknown[]).length !== 1);
    if (boardRows.length !== 1 || nonOne.length > 0) {
      failures.push(
        `a:one-row: one task's edit made the board view answer ${boardRows.map((a) => `${(a.body?.output as unknown[] | undefined)?.length} rows${a.body?.partial === undefined ? " (whole)" : ""}`).join(", ") || "nothing"}; expected one partial answer of 1 row`,
      );
    } else {
      evidence.push(`a: one task's edit → 1 board answer of ${(boardRows[0]!.body.output as unknown[]).length} row (partial)`);
    }
    const entryReads = tell.over("a:one-row · collection reads after one entry's edit", single.entryAnswers);
    const lists = entryReads.filter((a) => /\/entries(\?|$)/.test(a.url) || !/\/entries\//.test(a.url));
    const singles = entryReads.filter((a) => /\/entries\/[^?]/.test(a.url));
    if (lists.length !== 0 || singles.length !== 1) {
      failures.push(`a:one-row: one entry's edit made the collection read ${lists.length} list(s) and ${singles.length} entr(ies); expected 0 and 1`);
    } else {
      evidence.push(`one entry's edit → ${singles.length} entry fetched, ${lists.length} lists`);
    }
    await diffFromStore(screen.shown, reader, "a single edit", failures, equalsGraded);

    // b · a follow-up's ending: the root's row shows its chain's latest completed follow-up.
    await send(writer, "finish", { id: "f000" }, "writer-1");
    await quiet(screen.recorded);
    await diffFromStore(screen.shown, reader, "a follow-up's ending", failures, equalsGraded);

    // b · a burst of 300 writes: 150 holds from five other sessions at once, 150 new tasks, 100 entry renames.
    const holds = Array.from({ length: 150 }, (_, i) => taskId(43 + i));
    const filed = Array.from({ length: 150 }, (_, i) => `n${String(i).padStart(3, "0")}`);
    await Promise.all([
      ...Array.from({ length: 5 }, (_, s) => send(writer, "hold", { ids: holds.slice(s * 30, s * 30 + 30) }, `writer-${s + 2}`)),
      send(writer, "file", { ids: filed }),
    ]);
    await quiet(screen.recorded);
    await diffFromStore(screen.shown, reader, "a burst of 300 task writes", failures, equalsGraded);
    await send(writer, "rename", { keys: Array.from({ length: 100 }, (_, i) => entryKey(i * 2)), name: "burst" }, "writer-9");
    await quiet(screen.recorded);
    await diffFromStore(screen.shown, reader, "a burst of 100 entry writes", failures, equalsGraded);

    // b · a task cancelled (the board keeps no delete) and an entry deleted.
    await send(writer, "cancel", { id: taskId(7) }, "writer-10");
    await writer.resource(projects).entry(entryKey(7)).delete();
    await quiet(screen.recorded);
    await diffFromStore(screen.shown, reader, "a cancelled task and a deleted entry", failures, equalsGraded);
    const stepsGraded = tell.over("b:equals-store · screens compared with a whole read", equalsGraded);

    // The socket heard ids with them on, so c's absence below means something.
    const idsHeard = frames.filter((f) => f.owner === "tok-screen" && f.frame.type === "notice" && Array.isArray(f.frame.ids));
    tell.over("c · frames with ids, ids on", idsHeard);
    const orgIdsOn = idsHeard.filter((f) => f.frame.topic?.scope === "org");
    if (orgIdsOn.length === 0) failures.push("setup: with ids on, no org frame carried ids, so the off run proves nothing");

    // d · a client from main before this change, against this host: b.
    const old = await oldClientModule();
    const oldClient = old.createClient({
      userId: "alice",
      baseUrl: on.base,
      fetcher: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, headers: { ...(init?.headers as Record<string, string>), authorization: "Bearer tok-old" } }),
    });
    const oldShown: Shown = {};
    socketOwner = "tok-old";
    const stopOld = old.watchView(oldClient, BOARD_REF, {}, { onValue: (v: unknown[]) => (oldShown.board = v) }, { sessionId: CONV, pollIntervalMs: null });
    const stopOldStatus = old.watchView(oldClient, STATUS_REF, {}, { onValue: (v: unknown[]) => (oldShown.byStatus = v) }, { sessionId: CONV, pollIntervalMs: null });
    const oldLive = oldClient.live([{ scope: "org" }], {
      read: async () => (await oldClient.resource(projects).list({ limit: ENTRIES })).items,
      onValue: (v: unknown[]) => (oldShown.projects = v),
      pollIntervalMs: null,
    });
    closers.push(() => {
      stopOld();
      stopOldStatus();
      oldLive.close();
    });
    await delay(1_500);
    const oldGraded: string[] = [];
    const oldFailures: string[] = [];
    await send(writer, "hold", { ids: [taskId(1)] }, "writer-11");
    await writer.resource(projects).entry(entryKey(1)).set({ name: "old client sees this" });
    await send(writer, "finish", { id: taskId(2) }, "writer-12");
    await delay(1_500);
    await quiet(screen.recorded);
    await diffFromStore(oldShown, reader, "edits watched by main's client", oldFailures, oldGraded);
    tell.over("d:old-client · main's screens compared with a whole read", oldGraded);
    failures.push(...oldFailures.map((f) => f.replace("b:equals-store", "d:old-client")));
    if (stepsGraded.length > 0 && failures.every((f) => !f.startsWith("b:"))) evidence.push(`b: ${stepsGraded.length} screens equal a whole read across 5 steps`);
    if (oldFailures.length === 0 && oldGraded.length > 0) evidence.push(`d: main's client equals the store on ${oldGraded.length} screens`);
    evidence.push(`ids on: ${orgIdsOn.length} org frames named ids`);

    // ------------------------------------------------------------ c (org ids off)
    const off = await host({ org: false });
    closers.push(() => off.handle.close());
    const offWriter = plainClient(off, "tok-writer");
    const offReader = plainClient(off, "tok-reader");
    await send(offWriter, "seed", {});
    const offScreen = mountScreen(off, "tok-off-screen");
    closers.push(offScreen.close);
    await quiet(offScreen.recorded, 1_500);
    const offGraded: string[] = [];
    await singleEdits(off, offWriter, offScreen);
    await diffFromStore(offScreen.shown, offReader, "a single edit, org ids off", failures, offGraded);
    await send(offWriter, "rename", { keys: Array.from({ length: 50 }, (_, i) => entryKey(i)), name: "off" }, "writer-9");
    await offWriter.resource(projects).entry(entryKey(9)).delete();
    await quiet(offScreen.recorded);
    await diffFromStore(offScreen.shown, offReader, "entry writes, org ids off", failures, offGraded);
    tell.over("c:ids-off · screens compared with a whole read", offGraded);
    const offOrg = tell.over(
      "c:ids-off · org frames the screen heard",
      frames.filter((f) => f.owner === "tok-off-screen" && f.frame.type === "notice" && f.frame.topic?.scope === "org"),
    );
    const named = offOrg.filter((f) => f.frame.ids !== undefined);
    const keyed = offOrg.filter((f) => (f.frame.topic?.resource ?? "").startsWith("projects/"));
    if (named.length > 0) failures.push(`c:ids-off: ${named.length} org frames carried ids, e.g. ${JSON.stringify(named[0]!.frame)}`);
    if (keyed.length > 0) failures.push(`c:ids-off: ${keyed.length} scope-wide org frames named an entry key, e.g. ${JSON.stringify(keyed[0]!.frame)}`);
    if (named.length === 0 && keyed.length === 0 && offOrg.length > 0) {
      evidence.push(`c: org ids off, ${offOrg.length} org frames heard, none with ids or an entry key`);
    }
    return { failures, evidence: evidence.join(" · ") };
  } finally {
    for (const close of closers.reverse()) await close();
  }
});
