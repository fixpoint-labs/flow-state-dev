/**
 * realtime › app views read on a notice (FIX-2466).
 *
 * One `serve()` host on a bound port, on the default in-memory bus (which
 * covers an app that runs as one process, so no view keeps its fallback timer
 * while its socket is open: FIX-2545), and the apps' views that this change moved,
 * driven directly with real clients (Node's `fetch` and `WebSocket`): the
 * claude-code-style lab's thread (its running turn) and pins, the Teammates
 * lab's conversation (whether it is answering), its divider and its Talk
 * panel (`watchTalk`, the user's message log), and Shift Manager's worker
 * conversation (`followSessionItems`, the hook's follow), its message log
 * (`useMessages`), a project's entries (`useProjectRead`) and a task screen
 * waiting on its run's link (`TaskProvider`), the last three under the real
 * `LabProvider`, rendered by react-dom over happy-dom. Each view has its own
 * client, whose fetcher counts the reads it makes.
 *
 *   a  — another session writes: a slow turn in the watched session, a pin,
 *        a message in the log, a project's entry. Each view shows it within
 *        1 s of the write; a Lab read reads the log and the entries again. Then
 *        a 10 s idle window: every view makes 0 reads. A task screen waits on
 *        a task the board hasn't dispatched: 0 board reads over 10 s, then it
 *        shows the run the board links within 1 s of the link's write.
 *   b  — a reply of 200 items, then one of 2, in the watched session: each
 *        request view makes as many reads during the long reply as during
 *        the short one, and the item view reads nothing (the stream brings
 *        the items).
 *   c  — the same views on a host whose bus doesn't cross (the crossing
 *        double turned off): a pin, a turn, a message, a project's entry and a
 *        task's run link show within the view's old pace + 1 s.
 *
 * Controls (each runs this file again with a patch applied as it loads):
 *   GOAL_CONTROL=timer       each live read keeps a fixed timer with the socket up: a's 0-reads must FAIL.
 *   GOAL_CONTROL=every-kind  the live reads read on every notice on their topic: b must FAIL.
 */
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { Window } from "happy-dom";
import * as React from "react";
import { createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createClient, type Client } from "@flow-state-dev/client";
import { createFlowApiRouter, createFlowRegistry, type StoreRegistry } from "@flow-state-dev/engine";
import { createInMemoryStores } from "@flow-state-dev/engine/host";
import { serve, type ServeHandle } from "@flow-state-dev/node";
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";
import {
  defineProjectsCollection,
  workerMessagesResources,
  WORKER_MESSAGES_RESOURCE,
  WORKSTREAM_RESOURCES,
  workstreamEntryKey,
} from "@flow-state-dev/workforce";
import { crossingBus } from "../../lib/crossing-bus.mts";
import { REPO_ROOT, RUN_STAMP, assertPatched, describePatches, goalTmpDir, modulePatchEnv, runGoal, type ModulePatch } from "../../lib/index.mts";
import { labPins } from "../../../labs/claude-code-style/workforce/flows/user-marks.mts";
import { createWiredLab, type ThreadView } from "../../../labs/claude-code-style/src/adapter.ts";
import { createLabAdapter, type ConversationView, type LabTalk } from "../../../labs/teammates/src/adapter.ts";
import { buildKitchenSinkWorkforce } from "../../../apps/kitchen-sink/workforce/hire.ts";
import { followSessionItems, type SessionItems } from "../../../packages/shift-manager/src/lib/run.ts";
import { LabProvider, useLab } from "../../../packages/shift-manager/src/lib/lab-data.tsx";
import { projectReaderOf, useProjectRead } from "../../../packages/shift-manager/src/lib/projects.ts";
import { useMessages } from "../../../packages/shift-manager/src/lib/messages.ts";
import { conversationBoardRef } from "../../../packages/shift-manager/src/lib/reads.ts";
import { TaskProvider, useTask } from "../../../packages/shift-manager/src/lib/task.tsx";

const CONTROL = process.env.GOAL_CONTROL ?? "";
const SCRATCH = process.env.GOAL_SCRATCH ?? goalTmpDir("realtime-app-views");
const BOUND_MS = 1_000;
const IDLE_MS = 10_000;
const ORG = "acme";
// The views that read on a notice are the client's live read (`client.live`):
// the labs' watches and Shift Manager's message log, project entries and task run
// link (and its snapshot, whose Lab reads read the log and the entries again). Shift Manager's conversation follows the
// session stream instead. A patch to the live read reaches every one of them.
const LIVE_READ = "packages/client/src/live/live-read.ts";
/** The Talk panel's worker, and the shared project whose entries the Shift Manager view reads. */
const TALK_WORKER = "researcher";
const PROJECT = "apollo";

const PATCHES: Record<string, ModulePatch[]> = {
  // A fixed timer beside the subscription, as a view that kept its poll would.
  timer: [
    {
      module: LIVE_READ,
      from: String.raw`let subscription = subscribeTo\(topics\);`,
      to: "let subscription = subscribeTo(topics); setInterval(() => reads.request(null), pollIntervalMs ?? 1_500);",
    },
  ],
  // Every notice on the topic reads, `items` included.
  "every-kind": [
    {
      module: LIVE_READ,
      from: String.raw`if \(notice === null \|\| heard\(notice\)\) reads\.request\(notice\);`,
      to: "reads.request(notice);",
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

const happy = new Window();
// tsx compiles the apps' `.tsx` files with the classic JSX transform, which calls the global `React`.
Object.assign(globalThis, { window: happy, document: happy.document, IS_REACT_ACT_ENVIRONMENT: false, React });

// ---------------------------------------------------------------------------
// The app: a turn that writes `count` messages, holding `holdMs` first; pins;
// a row in the user's message log; a project and an entry of it. Kitchen
// Sink's workforce, whose roster flow and worker flows declare the log, the
// projects and their entries, is what the views read them through.
// ---------------------------------------------------------------------------

/** The log, the shared projects and their entries, as the roster flow declares them. */
const WRITES = { ...workerMessagesResources, projects: defineProjectsCollection(), ...WORKSTREAM_RESOURCES };
const collection = (ctx: any, name: string) => ctx.resources[name] as { create(key: string | Record<string, string>, state: unknown): Promise<unknown> };

function deskFlow(): FlowInstance {
  return defineFlow({
    kind: "desk",
    resources: WRITES,
    actions: {
      // A message from the Talk panel's worker, as `sendMessage` logs it.
      logMessage: {
        inputSchema: z.object({ id: z.string() }),
        block: handler({
          name: "log-message",
          inputSchema: z.object({ id: z.string() }),
          outputSchema: z.object({}).passthrough(),
          resources: WRITES,
          execute: async ({ id }, ctx: any) => {
            const at = Date.now();
            await collection(ctx, WORKER_MESSAGES_RESOURCE).create(id, {
              id, exchange: id, from: TALK_WORKER, to: "writer", text: `line ${id}`, at,
              fromSession: ctx.session.identity.id, fromFlow: "desk", toSession: ctx.session.identity.id, toFlow: "desk", hop: 1, status: "delivered",
            });
            return {};
          },
        }),
      },
      openProject: {
        inputSchema: z.object({}),
        block: handler({
          name: "open-project",
          inputSchema: z.object({}),
          outputSchema: z.object({}).passthrough(),
          resources: WRITES,
          execute: async (_input, ctx: any) => {
            await collection(ctx, "projects").create(PROJECT, { id: PROJECT, title: "Apollo", ownerUserId: "alice", members: ["alice"] });
            return {};
          },
        }),
      },
      // A workstream entry, as the project coordinator's open writes it.
      openEntry: {
        inputSchema: z.object({ id: z.string() }),
        block: handler({
          name: "open-entry",
          inputSchema: z.object({ id: z.string() }),
          outputSchema: z.object({}).passthrough(),
          resources: WRITES,
          execute: async ({ id }, ctx: any) => {
            const now = new Date().toISOString();
            await collection(ctx, "workstreams").create(workstreamEntryKey(PROJECT, "alice", id), {
              title: `The ${id}`, lead: "researcher", sessionId: null, status: "on-track", due: null, objectives: [], openedAt: now, updatedAt: now, writtenBy: { userId: "alice" },
            });
            return {};
          },
        }),
      },
      respond: {
        inputSchema: z.object({ message: z.string(), count: z.number().default(1), holdMs: z.number().default(0) }),
        block: handler({
          name: "respond",
          inputSchema: z.object({ message: z.string(), count: z.number().default(1), holdMs: z.number().default(0) }),
          outputSchema: z.object({}).passthrough(),
          execute: async ({ message, count, holdMs }, ctx: any) => {
            if (holdMs > 0) await new Promise((r) => setTimeout(r, holdMs));
            // One item at a time, as a streamed reply stores them: each is its own `items` notice.
            for (let i = 0; i < count; i++) {
              ctx.emit.message(`${message} ${i}`);
              await new Promise((r) => setTimeout(r, 5));
            }
            return {};
          },
        }),
      },
    },
  })() as unknown as FlowInstance;
}

type Host = { handle: ServeHandle; base: string; stores: StoreRegistry };

/**
 * A host on `bus`: `"default"` leaves the stores without one, so the router
 * fills the in-memory bus an app on one process runs on; `"not-crossing"` is
 * the crossing double turned off, a bus that doesn't reach every writer.
 */
async function host(bus: "default" | "not-crossing"): Promise<Host> {
  const registry = createFlowRegistry();
  for (const copy of (await buildKitchenSinkWorkforce()).copies) registry.register(copy);
  registry.register(deskFlow());
  // The lab's pins: a user resource the host declares, written through the default write flow.
  registry.register(defineFlow({ kind: "projects", resources: { labPins }, actions: {} } as never)() as unknown as FlowInstance);
  const memory = createInMemoryStores();
  const notCrossing = crossingBus();
  notCrossing.setCrossing(false);
  const stores: StoreRegistry = bus === "default" ? memory : { ...memory, bus: notCrossing };
  const router = createFlowApiRouter({
    registry,
    stores,
    staleSweepIntervalMs: 0,
    // Every view's own credential is alice's, so each one's reads are counted apart.
    resolvePrincipal: (context) =>
      (context.request?.headers.get("authorization") ?? "").startsWith("Bearer tok-") ? { userId: "alice", orgId: ORG } : null,
  });
  const handle = await serve(router, { port: 0, host: "127.0.0.1", handleSignals: false, shutdownGraceMs: 200 });
  return { handle, base: `http://127.0.0.1:${handle.port}`, stores };
}

type Read = { at: number; url: string };

/** A client of alice's, counting the reads it makes. */
function clientOf(on: Host): { client: Client; reads: Read[] } {
  const reads: Read[] = [];
  const client = createClient({
    userId: "alice",
    baseUrl: on.base,
    fetcher: (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      const isRead = (init?.method ?? "GET") === "GET" || url.includes("/reads/");
      if (isRead && !url.includes("/stream") && !url.includes("/capabilities")) reads.push({ at: Date.now(), url });
      return fetch(input, { ...init, headers: { ...(init?.headers as Record<string, string>), authorization: "Bearer tok-alice" } });
    },
  });
  return { client, reads };
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Reads made under each Shift Manager credential: its provider builds its own
 * client from a connection, so they are counted at the page's `fetch`.
 */
const pageReads = new Map<string, Read[]>();
const realFetch = globalThis.fetch;
globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  const auth = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).get("authorization") ?? "";
  const reads = pageReads.get(auth.replace(/^Bearer /, ""));
  if (reads !== undefined && ((init?.method ?? "GET") === "GET" || url.includes("/reads/")) && !url.includes("/stream")) reads.push({ at: Date.now(), url: decodeURIComponent(url) });
  return realFetch(input, init);
};
let mounts = 0;

/** What the Shift Manager project view drew. */
type ProjectShown = { entries: string[] };

async function firstAt<T>(seen: Array<{ at: number; value: T }>, match: (value: T) => boolean, from: number, withinMs: number): Promise<number | undefined> {
  const deadline = Date.now() + withinMs;
  for (;;) {
    const hit = seen.find((entry) => entry.at >= from && match(entry.value));
    if (hit !== undefined) return hit.at;
    if (Date.now() > deadline) return undefined;
    await delay(10);
  }
}

/** Wait until none of `lists` has grown for `quietMs`. */
async function quiet(lists: Array<{ at: number }[]>, quietMs = 800): Promise<void> {
  for (;;) {
    const last = Math.max(0, ...lists.map((list) => list[list.length - 1]?.at ?? 0));
    const wait = last + quietMs - Date.now();
    if (wait <= 0) return;
    await delay(wait);
  }
}

async function requestDone(on: Host, requestId: string): Promise<number> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const record = await on.stores.request.get(requestId);
    if (record !== undefined && record.status !== "in_progress") return Date.now();
    if (Date.now() > deadline) throw new Error(`setup: request ${requestId} never finished`);
    await delay(5);
  }
}

/** The views under test, each on its own client. */
function mountViews(on: Host, sessionId: string) {
  const record = <T,>() => [] as Array<{ at: number; value: T }>;
  const cc = clientOf(on);
  const ccThread = record<ThreadView>();
  const ccPins = record<string[]>();
  const ccLab = createWiredLab(cc.client);
  const pinsClient = clientOf(on);
  const tm = clientOf(on);
  const tmConversation = record<ConversationView>();
  const tmWindowReads = clientOf(on);
  const sm = clientOf(on);
  const smItems = record<SessionItems>();
  const talk = clientOf(on);
  const tmTalk = record<LabTalk[]>();
  // Shift Manager under its real provider: a project's entries, as its view reads them.
  const smToken = `tok-sm-${(mounts += 1)}`;
  const smReads: Read[] = [];
  pageReads.set(smToken, smReads);
  const smProject = record<ProjectShown>();
  const smMessages = record<string[]>();
  let labRead: () => Promise<void> = async () => {};
  function ProjectProbe() {
    const { snapshot, refresh } = useLab();
    labRead = refresh;
    const loaded = snapshot !== undefined && snapshot.refused === undefined && snapshot.unreachable === undefined ? snapshot : undefined;
    const { read } = useProjectRead({ visibility: "shared", id: PROJECT }, loaded === undefined ? null : projectReaderOf(loaded.sessions), loaded?.readAt ?? 0);
    const entries = read !== undefined && "value" in read && read.value !== null ? read.value.entries.map((e) => e.id) : undefined;
    const key = entries === undefined ? null : entries.join(",");
    useEffect(() => {
      if (entries !== undefined) smProject.push({ at: Date.now(), value: { entries } });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);
    // The Messages view reads the log once the snapshot has landed, on its `readAt`.
    return loaded === undefined ? null : createElement(MessagesProbe, { readAt: loaded.readAt });
  }
  function MessagesProbe({ readAt }: { readAt: number }) {
    const { rows } = useMessages(readAt);
    const ids = rows == null ? undefined : rows.map((m) => m.id);
    const key = ids === undefined ? null : ids.join(",");
    useEffect(() => {
      if (ids !== undefined) smMessages.push({ at: Date.now(), value: ids });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);
    return null;
  }
  const smRoot: Root = createRoot(happy.document.createElement("div") as unknown as Element);
  smRoot.render(createElement(LabProvider, { connection: { userId: "alice", bearerToken: smToken, baseUrl: on.base }, children: createElement(ProjectProbe) }));
  const stops = [
    ccLab.watchThread(sessionId, (value) => ccThread.push({ at: Date.now(), value })),
    createWiredLab(pinsClient.client).watchPins((value) => ccPins.push({ at: Date.now(), value })),
    createLabAdapter(tm.client).watchConversation(sessionId, (value) => tmConversation.push({ at: Date.now(), value })),
    createLabAdapter(tmWindowReads.client).watchWindow(sessionId, () => {}),
    followSessionItems(sm.client, sessionId, { onRead: (value) => smItems.push({ at: Date.now(), value }), onFailure: () => {} }),
    createLabAdapter(talk.client).watchTalk(TALK_WORKER, (value) => tmTalk.push({ at: Date.now(), value })),
    () => smRoot.unmount(),
  ];
  const requestReads = (reads: Read[]) => reads.filter((r) => r.url.includes("/requests"));
  // One project read lists its entries by the project's one prefix.
  const entryReads = () => smReads.filter((r) => r.url.includes(`topicPrefix=workstreams/${PROJECT}/`));
  // One log read lists the user's `workforce/messages/*`.
  const logReads = () => smReads.filter((r) => r.url.includes("workforce/messages"));
  return {
    shown: { ccThread, ccPins, tmConversation, smItems, tmTalk, smProject, smMessages },
    labRead: () => labRead(),
    reads: {
      "claude-code-style thread (running turn)": () => requestReads(cc.reads),
      "claude-code-style pins": () => pinsClient.reads,
      "Teammates conversation (answering)": () => requestReads(tm.reads),
      "Teammates divider": () => tmWindowReads.reads,
      "Shift Manager conversation": () => sm.reads,
      "Teammates Talk": () => talk.reads.filter((r) => r.url.includes(WORKER_MESSAGES_RESOURCE)),
      "Shift Manager project entries": entryReads,
      "Shift Manager message log": logReads,
    } as Record<string, () => Read[]>,
    all: [cc.reads, pinsClient.reads, tm.reads, tmWindowReads.reads, sm.reads, talk.reads, smReads],
    close: () => stops.forEach((stop) => stop()),
  };
}

/** Before the views mount: alice's roster session (Shift Manager's project reader) and the shared project. */
async function opened(writer: Client, sessionId: string): Promise<void> {
  await createWorkforceClient(writer).roster();
  await (await writer.flow("desk").send("openProject", {}, { sessionId })).wait();
}

/** Until every view has shown its first read (15 s at most). */
async function mounted(views: ReturnType<typeof mountViews>): Promise<void> {
  const deadline = Date.now() + 15_000;
  const { ccThread, ccPins, tmConversation, smItems, tmTalk, smProject, smMessages } = views.shown;
  while (![ccThread, ccPins, tmConversation, smItems, tmTalk, smProject, smMessages].every((seen) => seen.length > 0)) {
    if (Date.now() > deadline) throw new Error(`setup: not every view read on open (${Object.entries(views.shown).map(([name, seen]) => `${name}:${seen.length}`).join(" ")})`);
    await delay(20);
  }
  await delay(500);
}

/** A task screen's run link pace wherever push can miss a change (`REREAD_EVERY_MS`). */
const RUN_LINK_POLL_MS = 2_000;

/**
 * A task screen waiting on its run's link, under its own provider and
 * credential so its board reads are counted apart. Its task, filed on a
 * coordinator conversation, waits on a held task, so nothing dispatches it;
 * the screen follows it (as after a board action), so it waits for the board
 * to hand it a run. `dispatch` drops the dependency: the board then claims it
 * and writes the run's link to the row, and says when the link landed.
 */
async function taskScreen(on: Host, writer: Client) {
  const conversation = await createWorkforceClient(writer).ensureWorkerSession({ worker: "support.help" });
  const act = async (name: string, input: unknown) =>
    ((await (await writer.flow(conversation.flowKind).send(name, input, { sessionId: conversation.id })).result()) as { output?: { taskId?: string } }).output;
  const gate = (await act("createTask_tasks", { goal: "gate", assignee: "support.devices", held: true }))!.taskId!;
  const taskId = (await act("createTask_tasks", { goal: "waits on the gate", assignee: "support.devices", deps: [gate], maxAttempts: 1 }))!.taskId!;
  const token = `tok-task-${(mounts += 1)}`;
  const reads: Read[] = [];
  pageReads.set(token, reads);
  const shown: Array<{ at: number; value: { waiting: boolean; linked: boolean } }> = [];
  let follow: () => void = () => {};
  function Shown() {
    const task = useTask();
    follow = task.retryRow;
    const linked = task.row?.run != null;
    useEffect(() => {
      shown.push({ at: Date.now(), value: { waiting: task.waiting, linked } });
    }, [task.waiting, linked]);
    return null;
  }
  function Screen() {
    const { snapshot } = useLab();
    const loaded = snapshot !== undefined && snapshot.refused === undefined && snapshot.unreachable === undefined ? snapshot : undefined;
    if (loaded === undefined || !loaded.sessions.some((session) => session.id === conversation.id)) return null;
    return createElement(TaskProvider, { snapshot: loaded, boardRef: conversationBoardRef(conversation.id), taskId, children: createElement(Shown) });
  }
  const root: Root = createRoot(happy.document.createElement("div") as unknown as Element);
  root.render(createElement(LabProvider, { connection: { userId: "alice", bearerToken: token, baseUrl: on.base }, children: createElement(Screen) }));
  const giveUpAt = Date.now() + 15_000;
  while (shown.length === 0) {
    if (Date.now() > giveUpAt) throw new Error("setup: the task screen never opened");
    await delay(20);
  }
  follow();
  while (!shown.at(-1)!.value.waiting) {
    if (Date.now() > giveUpAt) throw new Error("setup: the task screen never waited on its run");
    await delay(20);
  }
  return {
    shown,
    // One read of the conversation's board, the task screen's own (its snapshot reads only on a notice).
    boardReads: () => reads.filter((r) => r.url.includes(`/resources/tasks`)),
    all: reads,
    async dispatch(): Promise<number> {
      await act("updateTask_tasks", { id: taskId, deps: [] });
      for (const until = Date.now() + 5_000; Date.now() < until; await delay(5)) {
        const rows = Object.values(await on.stores.resourceState.getByPrefix("user", `alice:~org:${ORG}`, "tasks/")) as Array<{ state: { id?: string; run?: unknown } }>;
        if (rows.some((row) => row.state.id === taskId && row.state.run != null)) return Date.now();
      }
      throw new Error("setup: the board never linked the task's run");
    },
    close: () => root.unmount(),
  };
}

/** Run `action` in the writer's session; when it landed. */
async function writeIn(writer: Client, sessionId: string, action: string, input: unknown): Promise<number> {
  await (await writer.flow("desk").send(action, input, { sessionId })).wait();
  return Date.now();
}

/** How long after `writtenAt` a view first showed `match` (within `withinMs`); one shown before the write landed reads 0. */
async function shownAfter<T>(seen: Array<{ at: number; value: T }>, match: (value: T) => boolean, writtenAt: number, withinMs = 3_000): Promise<number | undefined> {
  const at = await firstAt(seen, match, 0, withinMs);
  return at === undefined ? undefined : Math.max(0, at - writtenAt);
}

/** Run `action` in the writer's session; how long after it landed the view showed `match` (within `withinMs`). */
async function written<T>(writer: Client, sessionId: string, action: string, input: unknown, seen: Array<{ at: number; value: T }>, match: (value: T) => boolean, withinMs = 3_000): Promise<number | undefined> {
  return shownAfter(seen, match, await writeIn(writer, sessionId, action, input), withinMs);
}

await runGoal(async (failures, tell) => {
  const evidence: string[] = [];
  const hosts: Host[] = [];
  const closers: Array<() => void> = [];
  try {
    // ---------------------------------------------------------------- a, b
    const on = await host("default");
    hosts.push(on);
    const writer = clientOf(on).client;
    const sessionId = (await writer.flow("desk").createSession()).id;
    await (await writer.flow("desk").send("respond", { message: "hello" }, { sessionId })).wait();
    await opened(writer, sessionId);
    const views = mountViews(on, sessionId);
    closers.push(views.close);
    await mounted(views);
    await quiet(views.all);

    // a · another session writes a slow turn, a pin, a message and a project's entry.
    {
      const before = new Map(Object.entries(views.reads).map(([name, reads]) => [name, reads().length]));
      const sent = await writer.flow("desk").send("respond", { message: "slow", holdMs: 1_500 }, { sessionId });
      const startedAt = Date.now();
      const thread = await firstAt(views.shown.ccThread, (v) => v.running, startedAt - 50, 3_000);
      const answering = await firstAt(views.shown.tmConversation, (v) => v.running, startedAt - 50, 3_000);
      const doneAt = await requestDone(on, sent.id);
      const reply = await firstAt(views.shown.smItems, (v) => v.items.some((i) => JSON.stringify(i).includes("slow 0")), doneAt - 50, 3_000);
      await writer.resource(labPins).update((s) => ({ pinned: [...s.pinned, "t1"] }));
      const pinnedAt = Date.now();
      const pin = await firstAt(views.shown.ccPins, (v) => v.includes("t1"), pinnedAt - 200, 3_000);
      const loggedAt = await writeIn(writer, sessionId, "logMessage", { id: "msg_a" });
      const message = await shownAfter(views.shown.tmTalk, (v) => v.some((m) => m.id === "msg_a"), loggedAt);
      const logged = await shownAfter(views.shown.smMessages, (v) => v.includes("msg_a"), loggedAt);
      const entry = await written(writer, sessionId, "openEntry", { id: "research" }, views.shown.smProject, (v) => v.entries.includes("research"));
      const lat: Record<string, number | undefined> = {
        "claude-code-style running turn": thread === undefined ? undefined : thread - startedAt,
        "Teammates answering": answering === undefined ? undefined : answering - startedAt,
        "Shift Manager reply": reply === undefined ? undefined : reply - doneAt,
        "claude-code-style pin": pin === undefined ? undefined : pin - pinnedAt,
        "Teammates Talk message": message,
        "Shift Manager message log": logged,
        "Shift Manager project entry": entry,
      };
      const graded = tell.over("a:within-1s · each view showing the other session's change", Object.values(lat).filter((v): v is number => v !== undefined));
      for (const [what, ms] of Object.entries(lat)) {
        if (ms === undefined) failures.push(`a:within-1s: ${what} never shown within 3 s`);
        else if (ms >= BOUND_MS) failures.push(`a:within-1s: ${what} shown ${ms} ms after the write (bound ${BOUND_MS})`);
      }
      if (graded.length === Object.keys(lat).length && graded.every((ms) => ms < BOUND_MS)) {
        evidence.push(`a: ${Object.entries(lat).map(([what, ms]) => `${what} ${Math.max(0, ms!)} ms`).join(", ")}`);
      }
      const moved = Object.entries(views.reads).filter(([name, reads]) => reads().length > before.get(name)!);
      tell.over("a:within-1s · views that read on the changes", moved);

      // A task screen waiting on its run's link: nothing read while it waits, then the link within 1 s.
      const task = await taskScreen(on, writer);
      closers.push(task.close);
      await quiet([task.all]);
      const waitFrom = task.boardReads().length;
      await delay(IDLE_MS);
      const waitReads = task.boardReads().length - waitFrom;
      tell.over("a:idle-0-reads · task screen board reads over 10 s waiting on its link", [waitReads]);
      if (waitReads > 0) failures.push(`a:idle-0-reads: Shift Manager task run link ${waitReads} board reads over ${IDLE_MS / 1000} s waiting`);
      const linkedAt = await task.dispatch();
      const linkShown = await shownAfter(task.shown, (v) => v.linked, linkedAt);
      tell.over("a:within-1s · task run link shown", linkShown === undefined ? [] : [linkShown]);
      if (linkShown === undefined || linkShown >= BOUND_MS) failures.push(`a:within-1s: Shift Manager task run link shown ${linkShown ?? "never"} ms after its write (bound ${BOUND_MS})`);
      else if (waitReads === 0) evidence.push(`a: task screen read its board 0 times over ${IDLE_MS / 1000} s waiting, and showed the run link ${linkShown} ms after its write`);
      task.close();

      // A Lab read (the snapshot read again, here as the user's Refresh) reads the log and the entries again, as it did before.
      await quiet(views.all);
      const onLabRead = ["Shift Manager message log", "Shift Manager project entries"];
      const readsBefore = new Map(onLabRead.map((name) => [name, views.reads[name]!().length]));
      const refreshedAt = Date.now();
      await views.labRead();
      const reread = new Map<string, number | undefined>();
      for (const name of onLabRead) {
        let at: number | undefined;
        for (const giveUpAt = Date.now() + 3_000; at === undefined && Date.now() < giveUpAt; await delay(10)) {
          at = views.reads[name]!().find((r) => r.at >= refreshedAt)?.at;
        }
        reread.set(name, at === undefined ? undefined : at - refreshedAt);
      }
      for (const [name, ms] of reread) {
        if (ms === undefined || ms >= BOUND_MS) failures.push(`a:lab-read: ${name} read ${ms === undefined ? "never" : `${ms} ms`} after a Lab read (bound ${BOUND_MS})`);
      }
      if ([...reread.values()].every((ms) => ms !== undefined && ms < BOUND_MS)) {
        evidence.push(`a: read again after a Lab read: ${[...reread].map(([name, ms]) => `${name} ${ms} ms`).join(", ")}`);
      }
      tell.over("a:lab-read · reads after a Lab read", onLabRead.flatMap((name) => views.reads[name]!().slice(readsBefore.get(name)!)));

      await quiet(views.all);
      const idleFrom = new Map(Object.entries(views.reads).map(([name, reads]) => [name, reads().length]));
      await delay(IDLE_MS);
      const idle = Object.entries(views.reads).map(([name, reads]) => [name, reads().length - idleFrom.get(name)!] as const);
      tell.over("a:idle-0-reads · reads per view over 10 s idle", idle);
      const busy = idle.filter(([, n]) => n > 0);
      if (busy.length > 0) failures.push(`a:idle-0-reads: ${busy.map(([name, n]) => `${name} ${n}`).join(", ")} reads over ${IDLE_MS / 1000} s idle`);
      else evidence.push(`a: 0 reads over ${IDLE_MS / 1000} s idle in each of ${idle.length} views`);
    }

    // b · a 200-item reply, then a 2-item one that takes as long, so the two differ only in items:
    // how a request's own notices (created, settled) coalesce depends on how far apart they land.
    {
      let longTook = 0;
      const during = async (count: number, holdMs = 0): Promise<Map<string, number>> => {
        await quiet(views.all);
        const from = new Map(Object.entries(views.reads).map(([name, reads]) => [name, reads().length]));
        const startedAt = Date.now();
        const sent = await writer.flow("desk").send("respond", { message: `reply-${count}`, count, holdMs }, { sessionId });
        await requestDone(on, sent.id);
        if (holdMs === 0) longTook = Date.now() - startedAt;
        await firstAt(views.shown.smItems, (v) => v.items.some((i) => JSON.stringify(i).includes(`reply-${count} ${count - 1}`)), 0, 5_000);
        await quiet(views.all);
        return new Map(Object.entries(views.reads).map(([name, reads]) => [name, reads().length - from.get(name)!]));
      };
      const long = await during(200);
      const short = await during(2, longTook);
      const requestViews = ["claude-code-style thread (running turn)", "Teammates conversation (answering)", "Teammates divider"];
      tell.over("b:as-short · request views' reads, long reply", requestViews.map((name) => long.get(name)!));
      const off = requestViews.filter((name) => long.get(name) !== short.get(name));
      if (off.length > 0) failures.push(`b:as-short: ${off.map((name) => `${name} read ${long.get(name)} times for 200 items, ${short.get(name)} for 2`).join("; ")}`);
      const smReads = long.get("Shift Manager conversation")! + short.get("Shift Manager conversation")!;
      if (smReads !== 0) failures.push(`b:as-short: Shift Manager's conversation read ${smReads} times; the stream brings the items`);
      if (off.length === 0 && smReads === 0) {
        evidence.push(`b: request views read ${requestViews.map((name) => long.get(name)).join("/")} times for 200 items, as for 2; Shift Manager's conversation read 0`);
      }
    }
    views.close();

    // ------------------------------------------------------------------- c
    {
      const plain = await host("not-crossing");
      hosts.push(plain);
      const w = clientOf(plain).client;
      const s = (await w.flow("desk").createSession()).id;
      await (await w.flow("desk").send("respond", { message: "hello" }, { sessionId: s })).wait();
      await opened(w, s);
      const fallback = mountViews(plain, s);
      closers.push(fallback.close);
      await mounted(fallback);
      await w.resource(labPins).update((s) => ({ pinned: [...s.pinned, "t9"] }));
      const pinnedAt = Date.now();
      const pin = await firstAt(fallback.shown.ccPins, (v) => v.includes("t9"), 0, 3_000 + BOUND_MS + 500);
      const sent = await w.flow("desk").send("respond", { message: "slow", holdMs: 3_000 }, { sessionId: s });
      const startedAt = Date.now();
      const answering = await firstAt(fallback.shown.tmConversation, (v) => v.running, startedAt - 50, 1_500 + BOUND_MS + 500);
      await requestDone(plain, sent.id);
      const loggedAt = await writeIn(w, s, "logMessage", { id: "msg_c" });
      const message = await shownAfter(fallback.shown.tmTalk, (v) => v.some((m) => m.id === "msg_c"), loggedAt, 1_500 + BOUND_MS + 500);
      const logged = await shownAfter(fallback.shown.smMessages, (v) => v.includes("msg_c"), loggedAt, 5_000 + BOUND_MS + 500);
      const entry = await written(w, s, "openEntry", { id: "fallback" }, fallback.shown.smProject, (v) => v.entries.includes("fallback"), 5_000 + BOUND_MS + 500);
      // The task screen: on its old pace while it waits, and the link within that pace + 1 s.
      const task = await taskScreen(plain, w);
      closers.push(task.close);
      await quiet([task.all], 300);
      const waitFrom = task.boardReads().length;
      await delay(6_000);
      const waitReads = task.boardReads().length - waitFrom;
      const linkedAt = await task.dispatch();
      const linkShown = await shownAfter(task.shown, (v) => v.linked, linkedAt, RUN_LINK_POLL_MS + BOUND_MS + 500);
      task.close();
      const paced: Array<[string, number | undefined, number]> = [
        ["pins", pin === undefined ? undefined : pin - pinnedAt, 3_000],
        ["Teammates answering", answering === undefined ? undefined : answering - startedAt, 1_500],
        ["Teammates Talk", message, 1_500],
        ["Shift Manager message log", logged, 5_000],
        ["Shift Manager project entries", entry, 5_000],
        ["Shift Manager task run link", linkShown, RUN_LINK_POLL_MS],
      ];
      tell.over("c:within-poll · fallback views showing the change", paced.flatMap(([, ms]) => (ms === undefined ? [] : [ms])));
      for (const [what, ms, pace] of paced) {
        if (ms === undefined || ms >= pace + BOUND_MS) failures.push(`c:within-poll: ${what} on a host with no crossing bus: ${ms ?? "never"} ms (bound ${pace + BOUND_MS})`);
      }
      if (paced.every(([, ms]) => ms !== undefined)) evidence.push(`c: with no crossing bus, ${paced.map(([what, ms]) => `${what} ${ms} ms`).join(", ")}`);
      // The in-process double still delivers what it hears, so a fast show alone doesn't prove the old
      // pace runs: with nothing written, each moved view still reads on its fallback timer.
      const kept = ["Teammates Talk", "Shift Manager message log", "Shift Manager project entries"];
      await quiet(fallback.all, 300);
      const from = new Map(kept.map((name) => [name, fallback.reads[name]!().length]));
      await delay(6_000);
      const timed = [...kept.map((name) => [name, fallback.reads[name]!().length - from.get(name)!] as const), ["Shift Manager task run link (6 s waiting)", waitReads] as const];
      tell.over("c:fallback-reads · reads per moved view over 6 s idle, no crossing bus", timed);
      const still = timed.filter(([, n]) => n === 0);
      if (still.length > 0) failures.push(`c:fallback-reads: ${still.map(([name]) => name).join(", ")} made no read over 6 s idle with no crossing bus`);
      else evidence.push(`c: over 6 s idle, ${timed.map(([name, n]) => `${name} ${n}`).join(", ")} reads on the fallback pace`);
    }
  } finally {
    for (const close of closers) close();
    for (const h of hosts) await h.handle.close();
  }
  return { failures, evidence: evidence.join(" · ") };
});
