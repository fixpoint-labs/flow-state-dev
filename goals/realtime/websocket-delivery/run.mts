/**
 * realtime › it delivers over a WebSocket (FIX-2428).
 *
 * Real `serve()` hosts on bound ports, real WebSocket clients (Node's own),
 * and `client.subscribe` with a bearer token its fetcher adds. Every
 * assertion reads what a client's own read returned after it heard a change.
 *
 *   a  — on a bus that crosses processes, tab 2 watches session S and tab 1
 *        replies in S: tab 2's read shows each reply within 1 s, and tab 2
 *        makes no read over a 10 s window from its first `crosses: true`
 *        frame, through a reply in another session T it doesn't watch.
 *   b  — user C subscribes to B's session: refused, and C's handler never
 *        runs. Then B's token is revoked and B's socket drops: B's
 *        reconnect is refused, and B hears nothing more.
 *   c  — the same tab 2 code with no push, and with tab 2's socket on a
 *        second process on the in-memory bus: tab 2's read shows the reply
 *        within one poll interval plus 1 s.
 *
 * Controls (each runs this file again with a patch applied as it loads):
 *   GOAL_CONTROL=no-socket        the host never serves the upgrade: a must FAIL.
 *   GOAL_CONTROL=skip-check       the mint grants every topic: b's "C never hears" must FAIL.
 *   GOAL_CONTROL=ignore-crossing  the client treats every open socket as covering: c's second process must FAIL.
 */
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import type { Duplex } from "node:stream";
import { join } from "node:path";
import { z } from "zod";
import { PGlite } from "@electric-sql/pglite";
import { defineFlow, handler } from "@flow-state-dev/core";
import { createClient, topic, type WireNotice } from "@flow-state-dev/client";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores,
  type ChangeBus,
  type StoreRegistry
} from "@flow-state-dev/engine";
import { serve, type ServeHandle } from "@flow-state-dev/node";
import { createPostgresStores, type QueryExecutor } from "@flow-state-dev/store-postgres";
import { crossingBus } from "../../lib/crossing-bus.mts";
import {
  REPO_ROOT,
  RUN_STAMP,
  assertPatched,
  describePatches,
  goalTmpDir,
  modulePatchEnv,
  runGoal,
  type ModulePatch
} from "../../lib/index.mts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
const SCRATCH = process.env.GOAL_SCRATCH ?? goalTmpDir("realtime-websocket");
const POLL_MS = 2_000;
const IDLE_WINDOW_MS = 10_000;

const PATCHES: Record<string, ModulePatch[]> = {
  // Capabilities still says push, but the upgrade is never served.
  "no-socket": [
    {
      module: "packages/node/src/serve.ts",
      from: String.raw`push\.upgrade\(server, req, socket, head\)`,
      to: "socket.destroy()"
    }
  ],
  // The mint grants every session topic, checked or not.
  "skip-check": [
    {
      module: "packages/engine/src/push/push-delivery.ts",
      from: String.raw`if \(checked\.denied !== undefined \|\| checked\.session === null\) continue;`,
      to: "void checked;"
    }
  ],
  // The client treats an open socket as covering, crossing or not.
  "ignore-crossing": [
    {
      module: "packages/client/src/subscribe/push-hub.ts",
      from: String.raw`state === "open" && crosses && `,
      to: 'state === "open" && '
    }
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
    env: { ...process.env, GOAL_SCRATCH: SCRATCH, ...modulePatchEnv(PATCHES[CONTROL]!, REPO_ROOT, mark) }
  });
  assertPatched(PATCHES[CONTROL]!, REPO_ROOT, mark);
  process.exit(child.status ?? 1);
}

// ---------------------------------------------------------------------------
// Observing the sockets (taps only: nothing here changes what a client does)
// ---------------------------------------------------------------------------

type Tap = { url: string; frames: Array<{ type: string; crosses?: boolean }> };
const taps: Tap[] = [];
const NativeWebSocket = globalThis.WebSocket;
globalThis.WebSocket = class TappedWebSocket extends NativeWebSocket {
  constructor(url: string | URL, protocols?: string | string[]) {
    super(url, protocols);
    const tap: Tap = { url: String(url), frames: [] };
    taps.push(tap);
    this.addEventListener("message", (event) => tap.frames.push(JSON.parse(String(event.data)) as Tap["frames"][number]));
  }
} as typeof WebSocket;

// ---------------------------------------------------------------------------
// The app: a two-action handler flow, behind a bearer-token sign-in
// ---------------------------------------------------------------------------

/** Bearer token → user. Revoking a token deletes it. */
const tokens = new Map<string, string>();

function chatFlow() {
  const reply = (name: string) =>
    handler({
      name,
      inputSchema: z.object({ text: z.string() }),
      outputSchema: z.object({ text: z.string() }),
      execute: (input) => ({ text: input.text })
    });
  return defineFlow({
    kind: "chat",
    actions: {
      say: { inputSchema: z.object({ text: z.string() }), block: reply("chat-say") },
      note: { inputSchema: z.object({ text: z.string() }), block: reply("chat-note") }
    }
  })();
}

type Host = { handle: ServeHandle; base: string; stores: StoreRegistry; raw: Array<{ url: string; socket: Duplex }> };

async function host(stores: StoreRegistry, options: { push?: boolean } = {}): Promise<Host> {
  const registry = createFlowRegistry();
  registry.register(chatFlow());
  const router = createFlowApiRouter({
    registry,
    stores,
    staleSweepIntervalMs: 0,
    resolvePrincipal: (context) => {
      const header = context.request?.headers.get("authorization") ?? "";
      const user = tokens.get(header.replace(/^Bearer /, ""));
      return user === undefined ? null : { userId: user, orgId: "acme" };
    }
  });
  const handle = await serve(router, {
    port: 0,
    host: "127.0.0.1",
    handleSignals: false,
    shutdownGraceMs: 200,
    ...(options.push !== undefined ? { push: options.push } : {})
  });
  const raw: Host["raw"] = [];
  // A second listener, to drop a socket the way a network does. It records only.
  handle.server.on("upgrade", (req, socket) => raw.push({ url: req.url ?? "", socket }));
  return { handle, base: `http://127.0.0.1:${handle.port}`, stores, raw };
}

/** A tab: a client for `userId` whose fetcher adds the bearer token. */
function tab(on: Host, userId: string, token: string) {
  return createClient({
    userId,
    baseUrl: on.base,
    fetcher: (input, init) =>
      fetch(input, { ...init, headers: { ...(init?.headers as Record<string, string>), authorization: `Bearer ${token}` } })
  });
}

type Tab = ReturnType<typeof tab>;

async function newSession(fsd: Tab): Promise<string> {
  return (await fsd.flow("chat").createSession()).id;
}

/** Reply in `sessionId`, and return when the reply is saved, read off the host's store. */
async function replyIn(fsd: Tab, on: Host, sessionId: string, text: string): Promise<number> {
  const sent = await fsd.flow("chat").send("say", { text }, { sessionId });
  const deadline = Date.now() + 5_000;
  for (;;) {
    const record = await on.stores.request.get(sent.id);
    if (record !== undefined && record.status !== "in_progress") return Date.now();
    if (Date.now() > deadline) throw new Error(`setup: request ${sent.id} never finished`);
    await delay(5);
  }
}

type Watch = {
  reads: Array<{ at: number; texts: string[] }>;
  notices: Array<WireNotice | null>;
  close(): void;
};

/**
 * Tab 2's code: subscribe the session and, on each change, read the
 * session's replies, one read at a time (as `useSubscription` does).
 */
function watch(fsd: Tab, sessionId: string, pollIntervalMs: number | undefined): Watch {
  const reads: Watch["reads"] = [];
  const notices: Watch["notices"] = [];
  let running = false;
  let queued = false;
  const read = async (): Promise<void> => {
    if (running) {
      queued = true;
      return;
    }
    running = true;
    try {
      const requests = await fsd.sessions.requests(sessionId, { includeResultOutput: true });
      const texts = requests.map((r) => (r.result?.output as { text?: string } | undefined)?.text).filter((t): t is string => t !== undefined);
      reads.push({ at: Date.now(), texts });
    } catch {
      reads.push({ at: Date.now(), texts: [] });
    } finally {
      running = false;
      if (queued) {
        queued = false;
        void read();
      }
    }
  };
  const sub = fsd.subscribe([topic.session(sessionId)], {
    onChange: (notice) => {
      notices.push(notice);
      void read();
    },
    ...(pollIntervalMs !== undefined ? { pollIntervalMs } : {})
  });
  return { reads, notices, close: () => sub.close() };
}

/** When `w`'s reads first showed `text`, waiting up to `withinMs`. */
async function shownAt(w: Watch, text: string, withinMs: number): Promise<number | undefined> {
  const deadline = Date.now() + withinMs;
  for (;;) {
    const hit = w.reads.find((r) => r.texts.includes(text));
    if (hit !== undefined) return hit.at;
    if (Date.now() > deadline) return undefined;
    await delay(10);
  }
}

async function until(check: () => boolean, withinMs: number): Promise<boolean> {
  const deadline = Date.now() + withinMs;
  while (!check()) {
    if (Date.now() > deadline) return false;
    await delay(10);
  }
  return true;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function executorOver(pglite: PGlite): QueryExecutor {
  return {
    async query(text: string, values?: unknown[]) {
      const result = await pglite.query(text, values);
      return { rows: result.rows as Record<string, unknown>[], rowCount: result.affectedRows ?? 0 };
    }
  };
}

function memory(bus?: ChangeBus): StoreRegistry {
  return { ...createInMemoryStores(), ...(bus !== undefined ? { bus } : {}) };
}

// ---------------------------------------------------------------------------
// The legs
// ---------------------------------------------------------------------------

await runGoal(async (failures, tell) => {
  const evidence: string[] = [];
  const hosts: Host[] = [];
  const watches: Watch[] = [];
  try {
    // a · a bus that crosses: push covers tab 2, and only push.
    {
      tokens.set("tok-alice", "alice");
      const on = await host(memory(crossingBus()));
      hosts.push(on);
      const tab1 = tab(on, "alice", "tok-alice");
      const tab2 = tab(on, "alice", "tok-alice");
      const s = await newSession(tab1);
      const t = await newSession(tab1);
      const before = taps.length;
      const view = watch(tab2, s, POLL_MS);
      watches.push(view);
      const crossed = await until(() => taps.slice(before).some((tp) => tp.frames.some((f) => f.type === "crossing" && f.crosses === true)), 3_000);
      if (!crossed) failures.push("a:crossing: tab 2's socket never said crosses: true within 3 s");
      await delay(300);

      const readsBefore = view.reads.length;
      await delay(IDLE_WINDOW_MS / 2);
      await replyIn(tab1, on, t, "a reply in T, which tab 2 doesn't watch");
      await delay(IDLE_WINDOW_MS / 2);
      const idleReads = view.reads.length - readsBefore;
      tell.over("a:no-read-between · tab 2's reads before the window", view.reads.slice(0, readsBefore));
      if (idleReads !== 0) failures.push(`a:no-read-between: tab 2 made ${idleReads} reads in ${IDLE_WINDOW_MS / 1000} s with no change in S`);
      else evidence.push(`a: 0 reads in ${IDLE_WINDOW_MS / 1000} s idle, a reply in T included`);

      const latencies: number[] = [];
      for (const n of [1, 2, 3]) {
        const text = `reply ${n} in S`;
        const saved = await replyIn(tab1, on, s, text);
        const shown = await shownAt(view, text, 3_000);
        if (shown === undefined) failures.push(`a:within-1s: tab 2's read never showed "${text}" within 3 s`);
        else latencies.push(shown - saved);
        await delay(700);
      }
      const graded = tell.over("a:within-1s · tab 2's reads showing a reply", latencies);
      const slow = graded.filter((ms) => ms >= 1_000);
      if (slow.length > 0) failures.push(`a:within-1s: tab 2 showed replies ${graded.join(", ")} ms after saved (bound 1000)`);
      else if (graded.length > 0) evidence.push(`a: replies shown ${graded.join(", ")} ms after saved`);
      view.close();
    }

    // b · a refused topic is never heard, first connect or reconnect.
    {
      tokens.set("tok-b", "bob");
      tokens.set("tok-b-other-device", "bob");
      tokens.set("tok-c", "carol");
      const on = await host(memory(crossingBus()));
      hosts.push(on);
      const bob = tab(on, "bob", "tok-b");
      const bobElsewhere = tab(on, "bob", "tok-b-other-device");
      const carol = tab(on, "carol", "tok-c");
      const s = await newSession(bobElsewhere);
      const bView = watch(bob, s, undefined);
      const cView = watch(carol, s, undefined);
      watches.push(bView, cView);
      await until(() => bView.reads.length > 0, 3_000);
      await until(() => taps.some((tp) => tp.url.includes("/users/carol/stream") && tp.frames.length > 0), 3_000);

      const saved = await replyIn(bobElsewhere, on, s, "B's first reply");
      const bShown = await shownAt(bView, "B's first reply", 3_000);
      const bHeard = tell.over("b:control · B's reads showing its own reply", bShown === undefined ? [] : [bShown - saved]);
      if (bHeard.length === 0) failures.push("b:control: B never read its own reply, so this leg can't tell C's silence from no delivery");
      await delay(500);
      const cCalls = tell.over("b:c-never-hears · C's handler calls", cView.notices, { emptyIs: "the claim: C's handler never runs" });
      if (cCalls.length !== 0) failures.push(`b:c-never-hears: C's handler ran ${cCalls.length} times for B's session`);
      else evidence.push(`b: C's handler never ran; B read its reply ${bHeard[0] ?? "?"} ms after saved`);

      // Revoke B's token, and drop B's socket the way a network does.
      tokens.delete("tok-b");
      const bSockets = on.raw.filter((r) => r.url.includes("/users/bob/stream"));
      tell.over("b:revoked · B's sockets dropped", bSockets);
      for (const r of bSockets) r.socket.destroy();
      await delay(4_000);
      const heardBefore = bView.notices.length;
      const readsBefore = bView.reads.length;
      await replyIn(bobElsewhere, on, s, "B's reply after revoking");
      await delay(3_000);
      const after = bView.notices.slice(heardBefore);
      tell.over("b:revoked · B's handler calls after the reconnect", after, { emptyIs: "the claim: B hears nothing more" });
      if (after.length !== 0 || bView.reads.slice(readsBefore).some((r) => r.texts.includes("B's reply after revoking"))) {
        failures.push(`b:revoked: B heard ${after.length} more after its token was revoked`);
      } else evidence.push("b: B heard nothing after revocation");
      bView.close();
      cView.close();
    }

    // c · where push can miss a change, the timer keeps tab 2 current.
    {
      tokens.set("tok-alice", "alice");
      // c1 · no push.
      const noPush = await host(memory(), { push: false });
      hosts.push(noPush);
      const writer = tab(noPush, "alice", "tok-alice");
      const s1 = await newSession(writer);
      const view1 = watch(tab(noPush, "alice", "tok-alice"), s1, POLL_MS);
      watches.push(view1);
      await delay(500);
      const saved1 = await replyIn(writer, noPush, s1, "a reply with no push");
      const shown1 = await shownAt(view1, "a reply with no push", POLL_MS + 3_000);
      const c1 = tell.over("c:no-push · tab 2's reads showing the reply", shown1 === undefined ? [] : [shown1 - saved1]);
      if (c1.length === 0) failures.push("c:no-push: tab 2 never showed the reply");
      else if (c1[0]! >= POLL_MS + 1_000) failures.push(`c:no-push: shown ${c1[0]} ms after saved (bound ${POLL_MS + 1_000})`);
      else evidence.push(`c: no push, shown ${c1[0]} ms after saved`);
      view1.close();

      // c2 · tab 2's socket on a second process, each on its own in-memory bus.
      const pglite = new PGlite();
      const first = await host(await createPostgresStores({ executor: executorOver(pglite) }));
      const second = await host(await createPostgresStores({ executor: executorOver(pglite) }));
      hosts.push(first, second);
      const tab1 = tab(first, "alice", "tok-alice");
      const s2 = await newSession(tab1);
      const before = taps.length;
      const view2 = watch(tab(second, "alice", "tok-alice"), s2, POLL_MS);
      watches.push(view2);
      await until(() => taps.slice(before).some((tp) => tp.frames.some((f) => f.type === "crossing")), 3_000);
      const crossing = taps.slice(before).flatMap((tp) => tp.frames.filter((f) => f.type === "crossing"));
      tell.over("c:second-process · tab 2's crossing frames", crossing);
      await delay(500);
      const saved2 = await replyIn(tab1, first, s2, "a reply from the first process");
      const shown2 = await shownAt(view2, "a reply from the first process", POLL_MS + 3_000);
      const c2 = tell.over("c:second-process · tab 2's reads showing the reply", shown2 === undefined ? [] : [shown2 - saved2]);
      if (c2.length === 0) failures.push("c:second-process: tab 2 never showed the reply from the first process");
      else if (c2[0]! >= POLL_MS + 1_000) failures.push(`c:second-process: shown ${c2[0]} ms after saved (bound ${POLL_MS + 1_000})`);
      else evidence.push(`c: second process (crosses: ${crossing[0]?.crosses}), shown ${c2[0]} ms after saved`);
      view2.close();
    }
  } finally {
    for (const w of watches) w.close();
    await Promise.all(hosts.map((h) => h.handle.close()));
  }
  return { failures, evidence: evidence.join(" · ") };
});
