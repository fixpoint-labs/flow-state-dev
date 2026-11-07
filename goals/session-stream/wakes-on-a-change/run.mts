/**
 * session-stream › it wakes on a change (FIX-2426).
 *
 * Two servers over one Postgres (PGlite), each a real router over its own
 * Postgres stores, as two processes would hold them. Server A answers in
 * session s1; server B holds an open view of s1.
 *
 *   a  — on one bus that crosses processes (the goal-check double), B's view
 *        receives A's plain reply (items and a status, nothing else) within a
 *        second of it being saved, and a background run A starts within a
 *        second of its being accepted.
 *   b  — on that bus, B's open view makes no database statement over a ten
 *        second idle window, counted at B's executor.
 *   c  — with each server on its own Postgres bus with no tail pool (which never crosses), B's
 *        view still receives A's reply, within two seconds, on its timed read.
 *
 * Controls (each runs this file again with a patch applied as it loads):
 *   GOAL_CONTROL=no-publish  the write wrapper publishes nothing: a must FAIL.
 */
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { PGlite } from "@electric-sql/pglite";
import { DEFAULT_ORG_ID, defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import type { SessionStreamEvent } from "@flow-state-dev/core/items";
import {
  createFlowApiRouter,
  createFlowRegistry,
  disposeFlowApiRouter,
  type StoreRegistry
} from "@flow-state-dev/engine";
import { type ChangeBus } from "@flow-state-dev/engine/host";
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
const SCRATCH = process.env.GOAL_SCRATCH ?? goalTmpDir("session-stream-wakes");
const IDLE_WINDOW_MS = 10_000;

const PATCHES: Record<string, ModulePatch[]> = {
  // The write wrapper sends no notice: every write is unheard.
  "no-publish": [
    {
      module: "packages/engine/src/bus/publish-writes.ts",
      from: String.raw`function publish\(buses(?:: readonly ChangeBus\[\])?, notices(?:: readonly ChangeNotice\[\])?\)(?:: void)? \{`,
      to: "function publish(buses, notices) { return;"
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
// The two servers
// ---------------------------------------------------------------------------

/** Released by the case that holds a background run open. */
let releaseRun: () => void = () => {};

function chatFlow() {
  const say = handler({
    name: "chat-say",
    execute: async (input, ctx) => {
      ctx.emit.message((input as { text: string }).text);
      return {};
    }
  });
  const work = handler({
    name: "chat-work",
    execute: async () => {
      await new Promise<void>((resolve) => (releaseRun = resolve));
      return {};
    }
  });
  return defineFlow({
    kind: "chat",
    actions: {
      say: { block: say },
      spawn: {
        block: dispatcher({
          name: "chat-spawn",
          action: "work",
          inputSchema: z.object({ key: z.string() }),
          session: { key: (input: { key: string }) => input.key },
          payload: () => ({})
        })
      }
    },
    internal: { actions: { work: { block: work } } }
  })();
}

type Counter = { statements: number; on: boolean };

/** An executor over the shared database that counts what it is asked while `on`. */
function executorOver(pglite: PGlite, counter?: Counter): QueryExecutor {
  return {
    async query(text: string, values?: unknown[]) {
      const result = await pglite.query(text, values);
      if (counter?.on === true) counter.statements += 1;
      return { rows: result.rows as Record<string, unknown>[], rowCount: result.affectedRows ?? 0 };
    }
  };
}

type Server = { router: ReturnType<typeof createFlowApiRouter>; stores: StoreRegistry };

function serve(stores: StoreRegistry): Server {
  const registry = createFlowRegistry();
  registry.register(chatFlow());
  return { router: createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0 }), stores };
}

/** Two servers over one fresh database; B's statements counted. `bus` shared when given. */
async function twoServers(bus: ChangeBus | undefined): Promise<{ a: Server; b: Server; counter: Counter }> {
  const pglite = new PGlite();
  const counter: Counter = { statements: 0, on: false };
  const storesA = await createPostgresStores({ executor: executorOver(pglite) });
  const storesB = await createPostgresStores({ executor: executorOver(pglite, counter) });
  return {
    a: serve(bus === undefined ? storesA : { ...storesA, bus }),
    b: serve(bus === undefined ? storesB : { ...storesB, bus }),
    counter
  };
}

async function act(on: Server, action: string, input: Record<string, unknown>): Promise<string> {
  const res = await on.router.POST(
    new Request(`http://localhost/api/flows/chat/s1/actions/${action}`, {
      method: "POST",
      body: JSON.stringify({ userId: "alice", orgId: DEFAULT_ORG_ID, input })
    }),
    { params: { path: ["chat", "s1", "actions", action] } }
  );
  if (res.status !== 202) throw new Error(`setup: POST ${action} answered ${res.status}: ${await res.text()}`);
  return ((await res.json()) as { request: { id: string } }).request.id;
}

/** The moment `requestId` is saved finished, read off A's store every 5 ms. */
async function savedAt(on: Server, requestId: string): Promise<number> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const record = await on.stores.request.get(requestId);
    if (record !== undefined && record.status !== "in_progress") return Date.now();
    if (Date.now() > deadline) throw new Error(`setup: request ${requestId} never finished`);
    await delay(5);
  }
}

/** The moment A's store first holds a running request in a run under s1, polled every 5 ms. */
async function runStartedAt(on: Server): Promise<number> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const children = await on.stores.session.list({ parentage: { parentOf: "s1" } });
    if (children.length > 0) {
      const running = await on.stores.request.list({
        sessionId: children.map((child) => child.id),
        status: ["in_progress", "suspended"],
        orderBy: "none"
      });
      if (running.length > 0) return Date.now();
    }
    if (Date.now() > deadline) throw new Error("setup: the background run never started");
    await delay(5);
  }
}

type View = { events: Array<{ at: number; event: SessionStreamEvent }>; close(): Promise<void> };

/** B's open view of s1: every event it receives, stamped with when. */
async function openView(on: Server): Promise<View> {
  const controller = new AbortController();
  const res = await on.router.GET(
    new Request("http://localhost/api/flows/sessions/s1/stream", { signal: controller.signal }),
    { params: { path: ["sessions", "s1", "stream"] } }
  );
  if (res.status !== 200 || res.body === null) throw new Error(`setup: the stream answered ${res.status}`);
  const events: View["events"] = [];
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const reading = (async () => {
    let buffer = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        for (let at = buffer.indexOf("\n\n"); at >= 0; at = buffer.indexOf("\n\n")) {
          const data = buffer
            .slice(0, at)
            .split("\n")
            .filter((line) => line.startsWith("data: "))
            .map((line) => line.slice(6))
            .join("\n");
          buffer = buffer.slice(at + 2);
          if (data !== "") events.push({ at: Date.now(), event: JSON.parse(data) as SessionStreamEvent });
        }
      }
    } catch {
      // Closed by the check.
    }
  })();
  return {
    events,
    async close() {
      controller.abort();
      await reading;
    }
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function textOf(event: SessionStreamEvent): string | undefined {
  if (event.type !== "session.item" || event.item.type !== "message") return undefined;
  return (event.item.content as Array<{ text?: string }>)[0]?.text;
}

/** When `view` first received an event `match` accepts, waiting up to `withinMs`. */
async function receivedAt(view: View, match: (event: SessionStreamEvent) => boolean, withinMs: number): Promise<number | undefined> {
  const deadline = Date.now() + withinMs;
  for (;;) {
    const hit = view.events.find(({ event }) => match(event));
    if (hit !== undefined) return hit.at;
    if (Date.now() > deadline) return undefined;
    await delay(5);
  }
}

// ---------------------------------------------------------------------------
// The legs
// ---------------------------------------------------------------------------

await runGoal(async (failures, tell) => {
  const evidence: string[] = [];

  // a and b: one bus that crosses processes.
  {
    const { a, b, counter } = await twoServers(crossingBus());
    let view: View | undefined;
    try {
      await savedAt(a, await act(a, "say", { text: "opening" }));
      view = await openView(b);
      await delay(1_500);

      // b · an idle view costs the database nothing.
      counter.on = true;
      const perSecond: number[] = [];
      for (let s = 0; s < IDLE_WINDOW_MS / 1_000; s += 1) {
        const before = counter.statements;
        await delay(1_000);
        perSecond.push(counter.statements - before);
      }
      counter.on = false;
      const idle = tell.over("b:no-read-between · B's statements per second, idle", perSecond);
      const total = idle.reduce((sum, n) => sum + n, 0);
      if (total !== 0) failures.push(`b:no-read-between: B's idle view made ${total} statements in ${IDLE_WINDOW_MS / 1_000} s (${idle.join(",")})`);
      evidence.push(`b: ${total} statements in ${IDLE_WINDOW_MS / 1_000} s idle`);

      // a · a plain reply, written by A, reaches B's view.
      const reply = await act(a, "say", { text: "the reply, from A" });
      const saved = await savedAt(a, reply);
      const got = await receivedAt(view, (e) => textOf(e) === "the reply, from A", 3_000);
      const replies = tell.over("a:reply · B's copies of A's reply", got === undefined ? [] : [got]);
      if (replies.length === 0) failures.push("a:reply: B's view never received A's reply within 3 s");
      else if (replies[0]! - saved >= 1_000) failures.push(`a:reply: B's view received A's reply ${replies[0]! - saved} ms after it was saved (bound 1000)`);
      else evidence.push(`a: reply ${replies[0]! - saved} ms after saved`);

      // a · a background run starting reaches B's view. Timed from when its
      // start is saved (a request of it running), as the reply is from its
      // save: the engine may take a while to start a run it accepted. After a
      // quiet interval, as the reply was: B just read the reply, and reads at
      // most once an interval, so a run started at once would be timed
      // against that cap, not against the wake.
      await delay(1_500);
      const accepted = Date.now();
      await act(a, "spawn", { key: "bg" });
      const started = await runStartedAt(a);
      const runAt = await receivedAt(view, (e) => e.type === "session.runs" && e.runs.length > 0, 3_000);
      const runs = tell.over("a:run · B's notices naming a run", runAt === undefined ? [] : [runAt]);
      if (runs.length === 0) failures.push("a:run: B's view never named A's background run within 3 s");
      else if (runs[0]! - started >= 1_000) failures.push(`a:run: B's view named A's run ${runs[0]! - started} ms after it started (bound 1000)`);
      else evidence.push(`a: run ${runs[0]! - started} ms after it started (${started - accepted} ms after accepted)`);
      releaseRun();
    } finally {
      releaseRun();
      await view?.close();
      await Promise.all([disposeFlowApiRouter(a.router), disposeFlowApiRouter(b.router)]);
    }
  }

  // c: each server on its own Postgres bus with no tail pool; the timed read reaches B.
  {
    const { a, b } = await twoServers(undefined);
    let view: View | undefined;
    try {
      await savedAt(a, await act(a, "say", { text: "opening" }));
      view = await openView(b);
      await delay(1_500);
      const reply = await act(a, "say", { text: "the reply, across two buses" });
      const saved = await savedAt(a, reply);
      const got = await receivedAt(view, (e) => textOf(e) === "the reply, across two buses", 4_000);
      const replies = tell.over("c:fallback · B's copies of A's reply", got === undefined ? [] : [got]);
      if (replies.length === 0) failures.push("c:fallback: B's view never received A's reply within 4 s");
      else if (replies[0]! - saved >= 2_000) failures.push(`c:fallback: reply arrived ${replies[0]! - saved} ms after it was saved (bound 2000)`);
      else evidence.push(`c: reply ${replies[0]! - saved} ms after saved`);
    } finally {
      await view?.close();
      await Promise.all([disposeFlowApiRouter(a.router), disposeFlowApiRouter(b.router)]);
    }
  }

  return { failures, evidence: evidence.join(" · ") };
});
