/**
 * realtime › app views read on a notice (FIX-2466).
 *
 * One `serve()` host on a bound port, on the default in-memory bus (which
 * covers an app that runs as one process, so no view keeps its fallback timer
 * while its socket is open: FIX-2545), and the apps' views that this change moved,
 * driven directly with real clients (Node's `fetch` and `WebSocket`): the
 * claude-code-style lab's thread (its running turn) and pins, the Teammates
 * lab's conversation (whether it is answering) and its divider, and Shift
 * Manager's worker conversation (`followSessionItems`, the hook's follow).
 * Each view has its own client, whose fetcher counts the reads it makes.
 *
 *   a  — another session writes: a slow turn in the watched session, a pin.
 *        Each view shows it within 1 s of the write. Then a 10 s idle window:
 *        every view makes 0 reads.
 *   b  — a reply of 200 items, then one of 2, in the watched session: each
 *        request view makes as many reads during the long reply as during
 *        the short one, and the item view reads nothing (the stream brings
 *        the items).
 *   c  — the same views on a host whose bus doesn't cross (the crossing
 *        double turned off): a pin and a turn show within the view's old pace + 1 s.
 *
 * Controls (each runs this file again with a patch applied as it loads):
 *   GOAL_CONTROL=timer       each lab view keeps a fixed timer with the socket up: a's 0-reads must FAIL.
 *   GOAL_CONTROL=every-kind  the lab views read on every notice on their topic: b must FAIL.
 */
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createClient, type Client } from "@flow-state-dev/client";
import { createFlowApiRouter, createFlowRegistry, type StoreRegistry } from "@flow-state-dev/engine";
import { createInMemoryStores } from "@flow-state-dev/engine/host";
import { serve, type ServeHandle } from "@flow-state-dev/node";
import { crossingBus } from "../../lib/crossing-bus.mts";
import { REPO_ROOT, RUN_STAMP, assertPatched, describePatches, goalTmpDir, modulePatchEnv, runGoal, type ModulePatch } from "../../lib/index.mts";
import { definePinsFlow } from "../../../labs/claude-code-style/workforce/flows/pins.mts";
import { createWiredLab, type ThreadView } from "../../../labs/claude-code-style/src/adapter.ts";
import { createLabAdapter, type ConversationView } from "../../../labs/teammates/src/adapter.ts";
import { followSessionItems, type SessionItems } from "../../../packages/shift-manager/src/lib/run.ts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
const SCRATCH = process.env.GOAL_SCRATCH ?? goalTmpDir("realtime-app-views");
const BOUND_MS = 1_000;
const IDLE_MS = 10_000;
const ORG = "acme";
const LABS = ["labs/claude-code-style/src/adapter.ts", "labs/teammates/src/adapter.ts"];

const PATCHES: Record<string, ModulePatch[]> = {
  // A fixed timer beside the subscription, as a view that kept its poll would.
  timer: LABS.map((module) => ({
    module,
    from: String.raw`const subscription = (fsd|client)\.subscribe\(topics, \{`,
    to: "setInterval(() => void (typeof tick === 'function' ? tick() : run()), everyMs); const subscription = $1.subscribe(topics, {",
  })),
  // Every notice on the topic reads, `items` included.
  "every-kind": LABS.map((module) => ({
    module,
    from: String.raw`if \(notice === null \|\| notice\.kind === "resync" \|\| hears\(notice\)\)`,
    to: "if (true)",
  })),
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

// ---------------------------------------------------------------------------
// The app: a turn that writes `count` messages, holding `holdMs` first; pins
// ---------------------------------------------------------------------------

function deskFlow(): FlowInstance {
  return defineFlow({
    kind: "desk",
    actions: {
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
  registry.register(deskFlow());
  registry.register(definePinsFlow()() as unknown as FlowInstance);
  const memory = createInMemoryStores();
  const notCrossing = crossingBus();
  notCrossing.setCrossing(false);
  const stores: StoreRegistry = bus === "default" ? memory : { ...memory, bus: notCrossing };
  const router = createFlowApiRouter({
    registry,
    stores,
    staleSweepIntervalMs: 0,
    resolvePrincipal: (context) =>
      (context.request?.headers.get("authorization") ?? "") === "Bearer tok-alice" ? { userId: "alice", orgId: ORG } : null,
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
  const stops = [
    ccLab.watchThread(sessionId, (value) => ccThread.push({ at: Date.now(), value })),
    createWiredLab(pinsClient.client).watchPins((value) => ccPins.push({ at: Date.now(), value })),
    createLabAdapter(tm.client).watchConversation(sessionId, (value) => tmConversation.push({ at: Date.now(), value })),
    createLabAdapter(tmWindowReads.client).watchWindow(sessionId, () => {}),
    followSessionItems(sm.client, sessionId, { onRead: (value) => smItems.push({ at: Date.now(), value }), onFailure: () => {} }),
  ];
  const requestReads = (reads: Read[]) => reads.filter((r) => r.url.includes("/requests"));
  return {
    shown: { ccThread, ccPins, tmConversation, smItems },
    reads: {
      "claude-code-style thread (running turn)": () => requestReads(cc.reads),
      "claude-code-style pins": () => pinsClient.reads,
      "Teammates conversation (answering)": () => requestReads(tm.reads),
      "Teammates divider": () => tmWindowReads.reads,
      "Shift Manager conversation": () => sm.reads,
    } as Record<string, () => Read[]>,
    all: [cc.reads, pinsClient.reads, tm.reads, tmWindowReads.reads, sm.reads],
    close: () => stops.forEach((stop) => stop()),
  };
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
    const pinsSession = (await writer.flow("pins").createSession()).id;
    const views = mountViews(on, sessionId);
    closers.push(views.close);
    await delay(1_500);
    await quiet(views.all);

    // a · another session writes a slow turn and a pin.
    {
      const before = new Map(Object.entries(views.reads).map(([name, reads]) => [name, reads().length]));
      const sent = await writer.flow("desk").send("respond", { message: "slow", holdMs: 1_500 }, { sessionId });
      const startedAt = Date.now();
      const thread = await firstAt(views.shown.ccThread, (v) => v.running, startedAt - 50, 3_000);
      const answering = await firstAt(views.shown.tmConversation, (v) => v.running, startedAt - 50, 3_000);
      const doneAt = await requestDone(on, sent.id);
      const reply = await firstAt(views.shown.smItems, (v) => v.items.some((i) => JSON.stringify(i).includes("slow 0")), doneAt - 50, 3_000);
      await writer.flow("pins").send("pin", { taskId: "t1" }, { sessionId: pinsSession }).then((s) => s.wait());
      const pinnedAt = Date.now();
      const pin = await firstAt(views.shown.ccPins, (v) => v.includes("t1"), pinnedAt - 200, 3_000);
      const lat: Record<string, number | undefined> = {
        "claude-code-style running turn": thread === undefined ? undefined : thread - startedAt,
        "Teammates answering": answering === undefined ? undefined : answering - startedAt,
        "Shift Manager reply": reply === undefined ? undefined : reply - doneAt,
        "claude-code-style pin": pin === undefined ? undefined : pin - pinnedAt,
      };
      const graded = tell.over("a:within-1s · each view showing the other session's change", Object.values(lat).filter((v): v is number => v !== undefined));
      for (const [what, ms] of Object.entries(lat)) {
        if (ms === undefined) failures.push(`a:within-1s: ${what} never shown within 3 s`);
        else if (ms >= BOUND_MS) failures.push(`a:within-1s: ${what} shown ${ms} ms after the write (bound ${BOUND_MS})`);
      }
      if (graded.length === 4 && graded.every((ms) => ms < BOUND_MS)) {
        evidence.push(`a: ${Object.entries(lat).map(([what, ms]) => `${what} ${Math.max(0, ms!)} ms`).join(", ")}`);
      }
      const moved = Object.entries(views.reads).filter(([name, reads]) => reads().length > before.get(name)!);
      tell.over("a:within-1s · views that read on the changes", moved);

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
      const ps = (await w.flow("pins").createSession()).id;
      const fallback = mountViews(plain, s);
      closers.push(fallback.close);
      await delay(1_500);
      await w.flow("pins").send("pin", { taskId: "t9" }, { sessionId: ps }).then((x) => x.wait());
      const pinnedAt = Date.now();
      const pin = await firstAt(fallback.shown.ccPins, (v) => v.includes("t9"), 0, 3_000 + BOUND_MS + 500);
      const sent = await w.flow("desk").send("respond", { message: "slow", holdMs: 3_000 }, { sessionId: s });
      const startedAt = Date.now();
      const answering = await firstAt(fallback.shown.tmConversation, (v) => v.running, startedAt - 50, 1_500 + BOUND_MS + 500);
      await requestDone(plain, sent.id);
      const lat = [pin === undefined ? undefined : pin - pinnedAt, answering === undefined ? undefined : answering - startedAt];
      tell.over("c:within-poll · fallback views showing the change", lat.filter((v): v is number => v !== undefined));
      if (lat[0] === undefined || lat[0] >= 3_000 + BOUND_MS) failures.push(`c:within-poll: pins on a host with no crossing bus: ${lat[0] ?? "never"} ms (bound ${3_000 + BOUND_MS})`);
      if (lat[1] === undefined || lat[1] >= 1_500 + BOUND_MS) failures.push(`c:within-poll: Teammates answering on a host with no crossing bus: ${lat[1] ?? "never"} ms (bound ${1_500 + BOUND_MS})`);
      if (lat.every((v) => v !== undefined)) evidence.push(`c: with no crossing bus, pins ${lat[0]} ms, answering ${lat[1]} ms`);
    }
  } finally {
    for (const close of closers) close();
    for (const h of hosts) await h.handle.close();
  }
  return { failures, evidence: evidence.join(" · ") };
});
