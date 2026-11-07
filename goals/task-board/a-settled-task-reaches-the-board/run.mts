/**
 * task-board › a settled task reaches the board (FIX-2429).
 *
 * Real `serve()` hosts on bound ports, real WebSocket clients, and the board
 * views as the apps run them: the Teammates lab adapter's `watchTasks`, the
 * claude-code-style lab adapter's `watchTasks` (a view of the merged
 * `listTasks_tasks` read and nothing else), and a live `BoardList`'s read
 * (`client.subscribe` on the board's narrowed topic, `listCollectionItems` on
 * each wake). Every assertion reads what a view showed, timed against when the
 * row's change could be read from the store, and counts the board reads each
 * view made.
 *
 *   a  — on a bus that crosses (FIX-2426's crossing double): a conversation
 *        files a task its delegate runs in a task session, and a plan step for
 *        itself; each settles. Each view shows the task completed (and, for
 *        Teammates, its run's link) within 1 s of the store; the merged view
 *        shows the step completed within 1 s. Over a 10 s window with a task
 *        open, a reply streaming in the conversation, and a task filed and
 *        settled in a second conversation of the same user, each view makes
 *        0 board reads.
 *   b  — the same views on process 1, the task released and settled on a
 *        second registry over one real Postgres (the Postgres bus): within
 *        1 s, and 0 reads over 10 s from each view's first `crosses: true`.
 *   c  — the same views on a host with no push: each shows the task
 *        completed within its own poll interval plus 1 s.
 *
 * Controls (each runs this file again with a patch applied as it loads):
 *   GOAL_CONTROL=running-session  publish on the session that wrote: a's 1 s signal must FAIL.
 *   GOAL_CONTROL=whole-topic      the lab views subscribe the whole session topic: a's 0-reads must FAIL.
 *   GOAL_CONTROL=tasks-only       the merged read's views subscribe `tasks` alone: a's plan-step signal must FAIL.
 */
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { createClient, topic, type Client, type ClientFetch } from "@flow-state-dev/client";
import { createFlowState, type FlowState, type StoreAdapter } from "@flow-state-dev/engine";
import { createInMemoryStores } from "@flow-state-dev/engine/host";
import { serve, type ServeHandle } from "@flow-state-dev/node";
import { postgresStores } from "@flow-state-dev/store-postgres";
import type { Task, TaskInit } from "@flow-state-dev/orchestration/tasks";
import {
  createWorkerInstallation,
  defineSessionBoard,
  hireWorkforce,
  workerConfigSchema,
  workerTaskEntry,
  type WorkerManifest
} from "@flow-state-dev/workforce";
import { crossingBus } from "../../lib/crossing-bus.mts";
import { startPostgres } from "../../lib/postgres.mts";
import {
  REPO_ROOT,
  RUN_STAMP,
  actingAs,
  assertPatched,
  describePatches,
  goalTmpDir,
  modulePatchEnv,
  runGoal,
  silentLogger,
  sleep,
  type ModulePatch
} from "../../lib/index.mts";
import { createLabAdapter as teammatesLab } from "../../../labs/teammates/src/adapter.ts";
import { createWiredLab as claudeCodeStyleLab } from "../../../labs/claude-code-style/src/adapter.ts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
const SCRATCH = process.env.GOAL_SCRATCH ?? goalTmpDir("a-settled-task-reaches-the-board");
const USER = "alice";
const TOKEN = "tok-alice";
const ORG = "acme";
const IDLE_WINDOW_MS = 10_000;
/** How long a delegate's run takes, so its link and its ending are two writes apart. */
const DOER_MS = 1_500;
/** How long a plan step's turn takes. */
const STEP_MS = 1_500;
/** Each view's pace where push can miss a change: today's. */
const PACE = { teammates: 1_500, "claude-code-style": 2_000, "board-list": 3_000 } as const;
type ViewName = keyof typeof PACE;

const TEAMMATES = "labs/teammates/src/adapter.ts";
const CLAUDE_CODE_STYLE = "labs/claude-code-style/src/adapter.ts";
const PATCHES: Record<string, ModulePatch[]> = {
  // Publish on the session that wrote, not the one that filed.
  "running-session": [
    {
      module: "packages/orchestration/src/tasks/collection/get-or-create.ts",
      from: String.raw`event\.task\.filer\?\.sessionId \?\? legacyFiler\?\.\(event\.task\) \?\? runningSession`,
      to: "runningSession"
    }
  ],
  // The lab views subscribe the conversation's whole topic.
  "whole-topic": [
    { module: TEAMMATES, from: String.raw`BOARD_LEDGERS\.map\(\(resource\) => topic\.session\(sessionId, \{ resource \}\)\)`, to: "[topic.session(sessionId)]" },
    { module: CLAUDE_CODE_STYLE, from: String.raw`BOARD_LEDGERS\.map\(\(resource\) => topic\.session\(sessionId, \{ resource \}\)\)`, to: "[topic.session(sessionId)]" }
  ],
  // The merged read's views subscribe `tasks` alone.
  "tasks-only": [
    { module: TEAMMATES, from: String.raw`const BOARD_LEDGERS = \["tasks", "plan"\] as const;`, to: 'const BOARD_LEDGERS = ["tasks"] as const;' },
    { module: CLAUDE_CODE_STYLE, from: String.raw`const BOARD_LEDGERS = \["tasks", "plan"\] as const;`, to: 'const BOARD_LEDGERS = ["tasks"] as const;' }
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
    env: { ...process.env, GOAL_SCRATCH: SCRATCH, GOAL_LEGS: process.env.GOAL_LEGS ?? "a", ...modulePatchEnv(PATCHES[CONTROL]!, REPO_ROOT, mark) }
  });
  assertPatched(PATCHES[CONTROL]!, REPO_ROOT, mark);
  process.exit(child.status ?? 1);
}
const legs = new Set((process.env.GOAL_LEGS ?? "a,b,c").split(",").map((s) => s.trim()).filter(Boolean));


// ---------------------------------------------------------------------------
// Observing the sockets (taps only: nothing here changes what a client does)
// ---------------------------------------------------------------------------

type Tap = { frames: Array<{ type: string; crosses?: boolean }>; crossedAt?: number };
const taps: Tap[] = [];
const NativeWebSocket = globalThis.WebSocket;
globalThis.WebSocket = class TappedWebSocket extends NativeWebSocket {
  constructor(url: string | URL, protocols?: string | string[]) {
    super(url, protocols);
    const tap: Tap = { frames: [] };
    taps.push(tap);
    this.addEventListener("message", (event) => {
      const frame = JSON.parse(String(event.data)) as Tap["frames"][number];
      tap.frames.push(frame);
      if (frame.type === "crossing" && frame.crosses === true) tap.crossedAt ??= Date.now();
    });
  }
} as typeof WebSocket;

// ---------------------------------------------------------------------------
// The app: a conversation whose worker files a task for a handler delegate and
// a step for itself
// ---------------------------------------------------------------------------

const worker = (id: string, declared: Record<string, unknown>): WorkerManifest => ({ id, declared, body: "", skills: [] });
const WORKERS: WorkerManifest[] = [worker("lead", { flow: "desk", delegates: ["eng.doer"] }), worker("eng.doer", { flow: "doer", delegates: [] })];
const STEP = "You are working a step you filed for yourself";
const ANSWER = "The steps you filed for yourself have ended";

type Script = { op: "file"; tasks: TaskInit[] } | { op: "step"; id: string; goal: string } | { op: "chat"; ms: number };

/** The doer's runs, by the host that ran them. */
const ranOn: Array<{ host: string; goal: string }> = [];

function buildHost(name: string, stores: StoreAdapter): FlowState {
  let workerFlows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({ standardWorkers: WORKERS, workerFlows: () => workerFlows as never });
  const doorInput = z.object({ message: z.string() });
  const deskBoard = defineSessionBoard({ installation, flowKind: "desk" });
  const doerBoard = defineSessionBoard({ installation, flowKind: "doer" });

  const deskTurn = handler({
    name: "board-notices-desk-turn",
    inputSchema: doorInput,
    outputSchema: z.unknown(),
    resources: { ...installation.resources, ...deskBoard.resources },
    execute: async (input, rawCtx) => {
      const ctx = rawCtx as unknown as BlockContext;
      if (input.message.startsWith(STEP)) {
        await sleep(STEP_MS);
        return "step done";
      }
      if (input.message.startsWith(ANSWER)) return "answered";
      if (input.message.startsWith('Task "')) return "heard";
      const script = JSON.parse(input.message) as Script;
      if (script.op === "chat") {
        // A reply streaming in the conversation: items kept, no task touched.
        for (let n = 0; n * 200 < script.ms; n += 1) {
          ctx.emit.message(`part ${n} of a long reply`);
          await sleep(200);
        }
        return "chatted";
      }
      if (script.op === "step") {
        const ref = await deskBoard.board.turnResolver(ctx as never);
        await ref!.createTask({ id: script.id, goal: script.goal, assignee: "lead" });
        return "planned";
      }
      const ref = await deskBoard.board.resolver(ctx as never);
      return { ids: (await ref!.createTasks(script.tasks)).map((t) => t.id) };
    }
  });
  const planned = deskBoard.planned(deskTurn);

  const doerTurn = handler({
    name: "board-notices-doer-turn",
    inputSchema: doorInput,
    outputSchema: z.unknown(),
    execute: async (input) => {
      ranOn.push({ host: name, goal: input.message });
      await sleep(DOER_MS);
      return `done: ${input.message}`;
    }
  });

  const resolveWorker = (kind: string) =>
    handler({
      name: `board-notices-${kind}-resolve-worker`,
      inputSchema: z.unknown(),
      outputSchema: z.object({ worker: z.string() }),
      resources: { ...installation.resources },
      execute: async (_input, ctx) => ({ worker: (await installation.resolveWorker(ctx, kind)).id })
    });
  const flowOf = (kind: string, board: ReturnType<typeof defineSessionBoard>, turn: unknown) =>
    defineFlow({
      kind,
      configSchema: workerConfigSchema(),
      session: { ...installation.session(board.sessionStateShape), serverOwned: [...board.serverOwned] },
      resources: { ...installation.resources, ...board.resources },
      request: { onStarted: resolveWorker(kind) },
      actions: { respond: { inputSchema: doorInput.strict(), block: turn, userMessage: (i: { message: string }) => i.message }, ...board.actions },
      reads: { ...board.reads },
      internal: { actions: board.entries(turn as never) },
      task: { actions: { work: workerTaskEntry({ name: `board-notices-${kind}-task`, turn: turn as never }) } }
    } as never);
  workerFlows = {
    desk: { flow: flowOf("desk", deskBoard, planned), roles: ["contributor", "manager"] },
    doer: { flow: flowOf("doer", doerBoard, doerTurn), roles: ["contributor", "manager"] }
  };
  return createFlowState({
    flows: Object.fromEntries(hireWorkforce(installation).map((copy) => [copy.id, copy])),
    stores: { default: { primary: stores } },
    logger: silentLogger,
    resolvePrincipal: (context: any) => {
      // A tab's bearer token, or `actingAs`'s in-process caller (process 2's person, leg b).
      const header = context.request?.headers.get("authorization") ?? "";
      const inProcess = context.request?.headers.get("x-user");
      return header.replace(/^Bearer /, "") === TOKEN || inProcess === USER ? { userId: USER, orgId: ORG } : null;
    }
  } as never);
}

/** A memory adapter for `createFlowState`, with `bus` when given. */
function memory(bus?: ReturnType<typeof crossingBus>): StoreAdapter {
  const registry = { ...createInMemoryStores(), ...(bus !== undefined ? { bus } : {}) };
  return { capabilities: ["primary", ...(bus !== undefined ? (["bus"] as const) : [])], resolve: async () => registry as never } as never;
}

type Host = { name: string; state: FlowState; handle?: ServeHandle; base: string; rows(): Promise<Map<string, Task>> };

async function host(name: string, stores: StoreAdapter, options: { serve: boolean; push?: boolean }): Promise<Host> {
  const state = buildHost(name, stores);
  const runtime = await state.getRuntime();
  const rows = async () =>
    new Map(
      Object.values(await runtime.stores.resourceState.getByPrefix("user", `${USER}:~org:${ORG}`, ""))
        .map((value) => value.state as Task)
        .filter((row) => typeof row?.goal === "string" && typeof row?.status === "string")
        .map((row) => [row.id, row])
    );
  if (!options.serve) return { name, state, base: "", rows };
  const handle = await serve(await state.getRouter(), {
    port: 0,
    host: "127.0.0.1",
    handleSignals: false,
    shutdownGraceMs: 200,
    ...(options.push !== undefined ? { push: options.push } : {})
  });
  return { name, state, handle, base: `http://127.0.0.1:${handle.port}`, rows };
}

/** A tab on `on`: the one client, with the bearer token, counting the board reads it makes. */
function tab(on: Host) {
  const counted = { reads: 0 };
  const fetcher: ClientFetch = (input, init) => {
    const url = String(input);
    if (url.includes("/reads/listTasks_tasks") || /\/resources\/tasks(\?|$)/.test(url)) counted.reads += 1;
    return fetch(input, { ...init, headers: { ...(init?.headers as Record<string, string>), authorization: `Bearer ${TOKEN}` } });
  };
  return { client: createClient({ userId: USER, baseUrl: on.base, fetcher }), counted };
}

/** A person acting on a host in this process (`b`'s second registry), as the same verified user. */
function personOn(state: FlowState) {
  const inProcess = actingAs(state as never, USER);
  return inProcess;
}

// ---------------------------------------------------------------------------
// The views
// ---------------------------------------------------------------------------

type Shown = { at: number; rows: Map<string, { status: string; run?: string }> };
type View = { name: ViewName; shown: Shown[]; reads(): number; close(): void };

function viewsOn(on: Host, conversation: string): View[] {
  const teammates = tab(on);
  const tShown: Shown[] = [];
  const stopTeammates = teammatesLab(teammates.client).watchTasks(conversation, (tasks) =>
    tShown.push({
      at: Date.now(),
      rows: new Map(tasks.map((t) => [t.id, { status: t.status === "done" ? "completed" : t.status, ...(t.runSessionId !== undefined ? { run: t.runSessionId } : {}) }]))
    })
  );

  const ccs = tab(on);
  const cShown: Shown[] = [];
  const stopCcs = claudeCodeStyleLab(ccs.client).watchTasks(conversation, (rows) =>
    cShown.push({ at: Date.now(), rows: new Map(rows.map((r) => [r.id, { status: r.status }])) })
  );

  // A live `BoardList`'s read: its board's narrowed topic, its pace, and the
  // collection read on mount and on each wake, one read at a time.
  const list = tab(on);
  const lShown: Shown[] = [];
  let running = false;
  let queued = false;
  const read = async (): Promise<void> => {
    if (running) {
      queued = true;
      return;
    }
    running = true;
    try {
      const page = await list.client.resources.listCollectionItems(conversation, "tasks", {});
      lShown.push({ at: Date.now(), rows: new Map(page.items.map((item) => [(item.clientData as Task).id, { status: (item.clientData as Task).status }])) });
    } catch {
      // A failed read shows nothing new.
    } finally {
      running = false;
      if (queued) {
        queued = false;
        void read();
      }
    }
  };
  const subscription = list.client.subscribe([topic.session(conversation, { resource: "tasks" })], { onChange: () => void read(), pollIntervalMs: PACE["board-list"] });
  void read();

  return [
    { name: "teammates", shown: tShown, reads: () => teammates.counted.reads, close: stopTeammates },
    { name: "claude-code-style", shown: cShown, reads: () => ccs.counted.reads, close: stopCcs },
    { name: "board-list", shown: lShown, reads: () => list.counted.reads, close: () => subscription.close() }
  ];
}

/** When `view` first showed a row matching `match`, waiting up to `withinMs`. */
async function shownAt(view: View, id: string, match: (row: { status: string; run?: string }) => boolean, withinMs: number): Promise<number | undefined> {
  const deadline = Date.now() + withinMs;
  for (;;) {
    const hit = view.shown.find((s) => {
      const row = s.rows.get(id);
      return row !== undefined && match(row);
    });
    if (hit !== undefined) return hit.at;
    if (Date.now() > deadline) return undefined;
    await sleep(10);
  }
}

/**
 * Watch the store every 5 ms for when `id` first reads as `match`: the moment
 * the change can be read, which every view's latency is measured from.
 */
function storeWatch(on: Host) {
  const seen = new Map<string, number>();
  let live = true;
  const checks: Array<{ key: string; id: string; match: (row: Task) => boolean }> = [];
  void (async () => {
    while (live) {
      const rows = await on.rows().catch(() => new Map<string, Task>());
      for (const check of checks) {
        if (seen.has(check.key)) continue;
        const row = rows.get(check.id);
        if (row !== undefined && check.match(row)) seen.set(check.key, Date.now());
      }
      await sleep(5);
    }
  })();
  return {
    watch: (key: string, id: string, match: (row: Task) => boolean) => checks.push({ key, id, match }),
    at: async (key: string, withinMs: number) => {
      const deadline = Date.now() + withinMs;
      while (!seen.has(key) && Date.now() < deadline) await sleep(5);
      return seen.get(key);
    },
    stop: () => void (live = false)
  };
}

async function until(check: () => boolean | Promise<boolean>, withinMs: number): Promise<boolean> {
  const deadline = Date.now() + withinMs;
  while (!(await check())) {
    if (Date.now() > deadline) return false;
    await sleep(20);
  }
  return true;
}

/** Wait until no view has sent a board read for 1 s (at most 10 s): the reads its opening owed are done. */
async function quiet(views: View[]): Promise<void> {
  const total = () => views.reduce((sum, v) => sum + v.reads(), 0);
  const deadline = Date.now() + 10_000;
  let last = total();
  let since = Date.now();
  while (Date.now() - since < 1_000 && Date.now() < deadline) {
    await sleep(50);
    if (total() !== last) {
      last = total();
      since = Date.now();
    }
  }
}

const script = (fsd: Client, session: string, s: Script) => fsd.flow("desk").send("respond", { message: JSON.stringify(s) }, { sessionId: session });

// ---------------------------------------------------------------------------
// The legs
// ---------------------------------------------------------------------------

await runGoal(async (failures, tell) => {
  const evidence: string[] = [];
  const closers: Array<() => unknown> = [];
  try {
    if (legs.has("a")) {
      const on = await host("a", memory(crossingBus()), { serve: true });
      closers.push(() => on.handle!.close());
      const person = tab(on).client;
      const conversation = (await person.flow("desk").createSession({ state: { workerId: "lead" } })).id;
      const other = (await person.flow("desk").createSession({ state: { workerId: "lead" } })).id;
      const store = storeWatch(on);
      closers.push(store.stop);

      const before = taps.length;
      const views = viewsOn(on, conversation);
      closers.push(() => views.forEach((v) => v.close()));
      const crossed = await until(() => taps.slice(before).length >= 3 && taps.slice(before).every((t) => t.crossedAt !== undefined), 5_000);
      if (!crossed) failures.push("a:crossing: the views' sockets never all said crosses: true within 5 s");

      // A task held open: the window below has a task open.
      const held = `held-${RUN_STAMP}`;
      await script(person, conversation, { op: "file", tasks: [{ id: held, goal: "stays open", assignee: "eng.doer", held: true }] });
      for (const view of views) {
        if ((await shownAt(view, held, () => true, 5_000)) === undefined) failures.push(`a:setup: ${view.name} never showed the held task`);
      }
      await quiet(views);

      // The window: a reply streams in the conversation, and the user's other
      // conversation files a task its delegate settles.
      const readsBefore = views.map((v) => v.reads());
      const otherTask = `other-${RUN_STAMP}`;
      store.watch("other:completed", otherTask, (row) => row.status === "completed");
      await sleep(1_000);
      await script(person, conversation, { op: "chat", ms: 3_000 });
      await script(person, other, { op: "file", tasks: [{ id: otherTask, goal: "in the other conversation", assignee: "eng.doer" }] });
      await sleep(IDLE_WINDOW_MS - 1_000);
      const otherSettled = await store.at("other:completed", 5_000);
      tell.over("a:0-reads · the other conversation's task settled during the window", otherSettled === undefined ? [] : [otherSettled]);
      const idle = views.map((v, i) => ({ name: v.name, reads: v.reads() - readsBefore[i]! }));
      tell.over("a:0-reads · the views' reads before the window", readsBefore.filter((n) => n > 0));
      const busy = idle.filter((v) => v.reads !== 0);
      if (busy.length > 0) failures.push(`a:0-reads: ${busy.map((v) => `${v.name} made ${v.reads} board reads`).join(", ")} in ${IDLE_WINDOW_MS / 1000} s with no change to this board`);
      else evidence.push(`a: 0 board reads in ${IDLE_WINDOW_MS / 1000} s on each of ${views.length} views (a reply streaming, another conversation's task settled)`);

      // A task settled in its own task session, with its run's link.
      const task = `task-${RUN_STAMP}`;
      store.watch("task:linked", task, (row) => row.run?.sessionId !== undefined);
      store.watch("task:completed", task, (row) => row.status === "completed");
      await script(person, conversation, { op: "file", tasks: [{ id: task, goal: "settles in its own session", assignee: "eng.doer" }] });
      const linkedAt = await store.at("task:linked", 10_000);
      const completedAt = await store.at("task:completed", 10_000);
      tell.over("a:within-1s · the task's link and ending in the store", [linkedAt, completedAt].filter((t) => t !== undefined));
      const latencies: string[] = [];
      for (const view of views) {
        if (completedAt !== undefined) {
          const shown = await shownAt(view, task, (row) => row.status === "completed", 4_000);
          if (shown === undefined || shown - completedAt >= 1_000) failures.push(`a:within-1s: ${view.name} showed the task completed ${shown === undefined ? "never (4 s)" : `${shown - completedAt} ms`} after the store (bound 1000)`);
          else latencies.push(`${view.name} ${shown - completedAt} ms`);
        }
      }
      const teammates = views.find((v) => v.name === "teammates")!;
      if (linkedAt !== undefined) {
        const shown = await shownAt(teammates, task, (row) => row.run !== undefined, 4_000);
        if (shown === undefined || shown - linkedAt >= 1_000) failures.push(`a:within-1s: teammates showed the run's link ${shown === undefined ? "never (4 s)" : `${shown - linkedAt} ms`} after the store (bound 1000)`);
        else latencies.push(`teammates link ${shown - linkedAt} ms`);
      }
      if (latencies.length > 0) evidence.push(`a: task shown ${latencies.join(", ")}`);

      // A plan step the conversation's worker files for itself.
      const step = `step-${RUN_STAMP}`;
      store.watch("step:completed", step, (row) => row.status === "completed");
      await sleep(1_000);
      await script(person, conversation, { op: "step", id: step, goal: "a step for itself" });
      const stepAt = await store.at("step:completed", 15_000);
      tell.over("a:plan-step · the step's ending in the store", stepAt === undefined ? [] : [stepAt]);
      const merged = views.find((v) => v.name === "claude-code-style")!;
      if (stepAt !== undefined) {
        const shown = await shownAt(merged, step, (row) => row.status === "completed", 4_000);
        if (shown === undefined || shown - stepAt >= 1_000) failures.push(`a:plan-step: ${merged.name} showed the step completed ${shown === undefined ? "never (4 s)" : `${shown - stepAt} ms`} after the store (bound 1000)`);
        else evidence.push(`a: plan step shown ${shown - stepAt} ms after the store`);
      }
      views.forEach((v) => v.close());
    }

    if (legs.has("b")) {
      const db = await startPostgres({ slug: "board-notices" });
      closers.push(() => db.stop());
      const p1 = await host("p1", postgresStores({ connectionString: db.url }), { serve: true });
      closers.push(() => p1.handle!.close());
      const p2 = await host("p2", postgresStores({ connectionString: db.url }), { serve: false });
      closers.push(() => p2.state.dispose?.());
      const person = tab(p1).client;
      const conversation = (await person.flow("desk").createSession({ state: { workerId: "lead" } })).id;
      const store = storeWatch(p1);
      closers.push(store.stop);
      const task = `b-task-${RUN_STAMP}`;
      await script(person, conversation, { op: "file", tasks: [{ id: task, goal: "settled on process 2", assignee: "eng.doer", held: true }] });

      const before = taps.length;
      const views = viewsOn(p1, conversation);
      closers.push(() => views.forEach((v) => v.close()));
      const crossed = await until(() => taps.slice(before).length >= 3 && taps.slice(before).every((t) => t.crossedAt !== undefined), 15_000);
      if (!crossed) failures.push("b:crossing: the views' sockets never all said crosses: true within 15 s");
      for (const view of views) await shownAt(view, task, () => true, 5_000);
      // The window starts once the views have gone quiet: the opening burst (each connect's read, the
      // filing's notice and the bus's resync) can still be finishing a read when the last socket crosses.
      await quiet(views);
      const readsBefore = views.map((v) => v.reads());
      await sleep(IDLE_WINDOW_MS);
      const busy = views.map((v, i) => ({ name: v.name, reads: v.reads() - readsBefore[i]! })).filter((v) => v.reads !== 0);
      tell.over("b:0-reads · the views' reads before the window", readsBefore.filter((n) => n > 0));
      if (busy.length > 0) failures.push(`b:0-reads: ${busy.map((v) => `${v.name} made ${v.reads} board reads`).join(", ")} in ${IDLE_WINDOW_MS / 1000} s idle`);
      else evidence.push(`b: 0 board reads in ${IDLE_WINDOW_MS / 1000} s once quiet after each view's first crosses: true`);

      // Released on process 2: its pass hands the row out, its doer runs it.
      store.watch("b:linked", task, (row) => row.run?.sessionId !== undefined);
      store.watch("b:completed", task, (row) => row.status === "completed");
      const ran = ranOn.length;
      await personOn(p2.state).act("desk", conversation, "updateTask_tasks", { id: task, status: "pending" });
      const linkedAt = await store.at("b:linked", 15_000);
      const completedAt = await store.at("b:completed", 15_000);
      const where = tell.over("b:within-1s · the hosts the doer ran on", ranOn.slice(ran));
      if (where.some((r) => r.host !== "p2")) failures.push(`b:setup: the task ran on ${where.map((r) => r.host).join(", ")}, not process 2 alone`);
      tell.over("b:within-1s · the task's link and ending in the store", [linkedAt, completedAt].filter((t) => t !== undefined));
      const latencies: string[] = [];
      for (const view of views) {
        if (completedAt === undefined) continue;
        const shown = await shownAt(view, task, (row) => row.status === "completed", 4_000);
        if (shown === undefined || shown - completedAt >= 1_000) failures.push(`b:within-1s: ${view.name} showed the task completed ${shown === undefined ? "never (4 s)" : `${shown - completedAt} ms`} after the store (bound 1000)`);
        else latencies.push(`${view.name} ${shown - completedAt} ms`);
      }
      if (linkedAt !== undefined) {
        const shown = await shownAt(views[0]!, task, (row) => row.run !== undefined, 4_000);
        if (shown === undefined || shown - linkedAt >= 1_000) failures.push(`b:within-1s: teammates showed the run's link ${shown === undefined ? "never (4 s)" : `${shown - linkedAt} ms`} after the store (bound 1000)`);
        else latencies.push(`teammates link ${shown - linkedAt} ms`);
      }
      if (latencies.length > 0) evidence.push(`b: settled on p2 (${db.source}), shown ${latencies.join(", ")}`);
      views.forEach((v) => v.close());
    }

    if (legs.has("c")) {
      const on = await host("c", memory(), { serve: true, push: false });
      closers.push(() => on.handle!.close());
      const person = tab(on).client;
      const conversation = (await person.flow("desk").createSession({ state: { workerId: "lead" } })).id;
      const store = storeWatch(on);
      closers.push(store.stop);
      const views = viewsOn(on, conversation);
      closers.push(() => views.forEach((v) => v.close()));
      await sleep(500);
      const task = `c-task-${RUN_STAMP}`;
      store.watch("c:completed", task, (row) => row.status === "completed");
      await script(person, conversation, { op: "file", tasks: [{ id: task, goal: "settles with no push", assignee: "eng.doer" }] });
      const completedAt = await store.at("c:completed", 15_000);
      tell.over("c:within-a-poll · the task's ending in the store", completedAt === undefined ? [] : [completedAt]);
      const latencies: string[] = [];
      for (const view of views) {
        if (completedAt === undefined) continue;
        const bound = PACE[view.name] + 1_000;
        const shown = await shownAt(view, task, (row) => row.status === "completed", bound + 3_000);
        if (shown === undefined || shown - completedAt >= bound) failures.push(`c:within-a-poll: ${view.name} showed the task completed ${shown === undefined ? "never" : `${shown - completedAt} ms`} after the store (bound ${bound})`);
        else latencies.push(`${view.name} ${shown - completedAt} ms (bound ${bound})`);
      }
      if (latencies.length > 0) evidence.push(`c: no push, shown ${latencies.join(", ")}`);
      views.forEach((v) => v.close());
    }
  } finally {
    for (const close of closers.reverse()) await Promise.resolve(close()).catch(() => undefined);
  }
  return { failures, evidence: evidence.join(" · ") };
});
