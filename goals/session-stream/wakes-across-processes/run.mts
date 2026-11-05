/**
 * session-stream › it wakes across processes (FIX-2427).
 *
 * Two real processes (`child_process.fork`), each `createFlowState` over
 * `postgresStores`, over one real Postgres (`initdb` + `pg_ctl`, or
 * `FSD_DB_URL`). Process 1 answers in a session; process 2 holds two open
 * views of it. What is graded is what process 2's views receive and what
 * process 2 asks the database, never whether `pg_notify` ran.
 *
 *   1  process 1's plain reply (items and a status), and a run it starts,
 *      reach process 2's view within a second of being saved;
 *   2  over a 10 s idle window process 2 makes no statement for its views;
 *      the bus's pings are counted apart, at most one per 2 s for the process;
 *   3  with process 2's listening backend terminated (`pg_terminate_backend`)
 *      and its view waiting, one reply with no write after it still reaches
 *      the view within 10 s; once the listener is back, the next within 1 s;
 *   4  with `liveTailPool: null` on both, the reply still arrives within 2 s,
 *      on the timed read.
 *
 * Controls (each runs this file again with a patch applied as the peers load):
 *   GOAL_CONTROL=no-listen     the bus never LISTENs but says it crosses: 1 must FAIL.
 *   GOAL_CONTROL=trust-listen  the bus trusts LISTEN, no ping: 3 must FAIL.
 *   GOAL_CONTROL=no-bus        today's `main`: the adapter declares no bus: 2 must FAIL.
 */
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SessionStreamEvent } from "@flow-state-dev/core/items";
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
import { startPostgres, type RunningPostgres } from "../../lib/postgres.mts";
import { forkPeer, type Peer } from "../../lib/peers.mts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
const SCRATCH = process.env.GOAL_SCRATCH ?? goalTmpDir("session-stream-across");
const PEER = fileURLToPath(new URL("./peer.mts", import.meta.url));
const IDLE_WINDOW_MS = 10_000;
const PING_INTERVAL_MS = 2_000;
const BUS = "packages/store-postgres/src/bus.ts";

const PATCHES: Record<string, ModulePatch[]> = {
  // The listener never opens, and the bus says it crosses anyway.
  "no-listen": [
    { module: BUS, from: String.raw`#start\(\)(?:: void)? \{`, to: "#start() { return;" },
    { module: BUS, from: String.raw`get crossesProcesses\(\)(?:: boolean)? \{`, to: "get crossesProcesses() { return true;" }
  ],
  // A LISTEN that succeeds is trusted: no ping, and a lost connection changes nothing.
  "trust-listen": [
    { module: BUS, from: String.raw`this\.#startPinging\(\);`, to: "this.#setCrossing(true);" },
    { module: BUS, from: String.raw`#lost\(connection(?:: ListenConnection \| undefined)?\)(?:: void)? \{`, to: "#lost(connection) { return;" }
  ],
  // Today's main: the Postgres adapter backs no bus, so each process gets an in-memory one.
  "no-bus": [
    {
      module: "packages/store-postgres/src/index.ts",
      from: String.raw`capabilities: \["primary", "bus"\]`,
      to: 'capabilities: ["primary"]'
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
// The two processes
// ---------------------------------------------------------------------------

type Frame = { view: number; at: number; event: SessionStreamEvent };
type Counted = { statements: number; pings: number; bus: number; texts: string[] };
type Pair = { p1: Peer; p2: Peer; frames: Frame[]; stop(): Promise<void> };

async function pair(db: RunningPostgres, tail: boolean): Promise<Pair> {
  // NODE_ENV=test only quiets the engine's per-block console trace.
  const env = { GOAL_DB_URL: db.url, GOAL_TAIL: tail ? "on" : "off", NODE_ENV: "test" };
  const p1 = await forkPeer(PEER, "p1", env);
  const p2 = await forkPeer(PEER, "p2", env);
  const frames: Frame[] = [];
  p2.on("frame", (data) => frames.push(data as Frame));
  return { p1, p2, frames, stop: async () => void (await Promise.all([p1.stop(), p2.stop()])) };
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function textOf(event: SessionStreamEvent): string | undefined {
  if (event.type !== "session.item" || event.item.type !== "message") return undefined;
  return (event.item.content as Array<{ text?: string }>)[0]?.text;
}

/** When process 2's `view` first received an event `match` accepts, waiting up to `withinMs`. */
async function receivedAt(frames: Frame[], view: number, match: (e: SessionStreamEvent) => boolean, withinMs: number): Promise<number | undefined> {
  const deadline = Date.now() + withinMs;
  for (;;) {
    const hit = frames.find((frame) => frame.view === view && match(frame.event));
    if (hit !== undefined) return hit.at;
    if (Date.now() > deadline) return undefined;
    await delay(5);
  }
}

/** Process 1 says `text` in `session`; the moment it is saved. */
async function reply(p1: Peer, session: string, text: string): Promise<number> {
  const requestId = await p1.call<string>("act", { session, action: "say", input: { text } });
  return p1.call<number>("savedAt", { requestId });
}

async function until(check: () => Promise<boolean>, withinMs: number): Promise<boolean> {
  const deadline = Date.now() + withinMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await delay(50);
  }
  return false;
}

// ---------------------------------------------------------------------------
// The signals
// ---------------------------------------------------------------------------

await runGoal(async (failures, tell) => {
  const evidence: string[] = [];
  const db = await startPostgres({ slug: "wakes-across" });
  evidence.push(`postgres: ${db.source}`);
  const session = `s-${RUN_STAMP}`;

  try {
    // 1, 2 and 3: the Postgres bus, as an app gets it.
    {
      const { p1, p2, frames, stop } = await pair(db, true);
      try {
        await reply(p1, session, "opening");
        const view = await p2.call<number>("openView", { session });
        await p2.call<number>("openView", { session });
        const crossed = await until(() => p2.call<boolean>("crosses"), 5_000);
        evidence.push(`p2 ${crossed ? "crosses" : "never said it crosses"}`);
        await delay(1_500);

        // 2 · an idle view costs the database nothing.
        await p2.call("count", { on: true });
        await delay(IDLE_WINDOW_MS);
        const idle = await p2.call<Counted>("count", { on: false });
        // Floored on everything p2 sent in the window, pings included: a count
        // that saw none of p2's connections reads nothing, not a pass.
        const seen = idle.statements + idle.pings + idle.bus;
        tell.over("2:idle · statements p2 sent in the window, its bus's included", seen > 0 ? [seen] : []);
        if (idle.statements !== 0) failures.push(`2:idle: p2 made ${idle.statements} statements for its views in ${IDLE_WINDOW_MS / 1_000} s (${idle.texts.slice(0, 4).join(" | ")})`);
        const pingBound = Math.ceil(IDLE_WINDOW_MS / PING_INTERVAL_MS) + 1;
        if (idle.pings > pingBound) failures.push(`2:idle: p2 pinged ${idle.pings} times in ${IDLE_WINDOW_MS / 1_000} s with two views open (bound ${pingBound})`);
        evidence.push(`2: ${idle.statements} view statements, ${idle.pings} pings in ${IDLE_WINDOW_MS / 1_000} s idle, two views`);

        // 1 · a plain reply from process 1 reaches process 2's view.
        const saved = await reply(p1, session, "the reply, from p1");
        const got = await receivedAt(frames, view, (e) => textOf(e) === "the reply, from p1", 3_000);
        const replies = tell.over("1:reply · p2's copies of p1's reply", got === undefined ? [] : [got]);
        if (replies.length === 0) failures.push("1:reply: p2's view never received p1's reply within 3 s");
        else if (replies[0]! - saved >= 1_000) failures.push(`1:reply: p2's view received p1's reply ${replies[0]! - saved} ms after it was saved (bound 1000)`);
        else evidence.push(`1: reply ${replies[0]! - saved} ms after saved`);

        // 1 · a run process 1 starts reaches process 2's view. After a quiet
        // interval, since a view reads at most once an interval.
        await delay(1_500);
        await p1.call("act", { session, action: "spawn", input: { key: `bg-${RUN_STAMP}` } });
        const started = await p1.call<number>("runStartedAt", { session });
        const runAt = await receivedAt(frames, view, (e) => e.type === "session.runs" && e.runs.length > 0, 3_000);
        const runs = tell.over("1:run · p2's notices naming p1's run", runAt === undefined ? [] : [runAt]);
        if (runs.length === 0) failures.push("1:run: p2's view never named p1's run within 3 s");
        else if (runs[0]! - started >= 1_000) failures.push(`1:run: p2's view named p1's run ${runs[0]! - started} ms after it started (bound 1000)`);
        else evidence.push(`1: run ${runs[0]! - started} ms after it started`);
        await p1.call("releaseRun");

        // 3 · the listener is killed while the view waits: one reply, nothing after it.
        await delay(1_500);
        const killed = await db.query<{ pid: number }>(
          "SELECT pid FROM pg_stat_activity WHERE application_name = 'goal-p2' AND query ILIKE 'LISTEN fsd_bus%'"
        );
        await db.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'goal-p2' AND query ILIKE 'LISTEN fsd_bus%'");
        const dropSaved = await reply(p1, session, "the reply, during the drop");
        const dropGot = await receivedAt(frames, view, (e) => textOf(e) === "the reply, during the drop", 10_000);
        tell.over("3:drop · p2's listening backends terminated", killed);
        tell.over("3:drop · p2's copies of the reply", dropGot === undefined ? [] : [dropGot]);
        if (killed.length === 0) failures.push("3:drop: p2 held no listening backend to terminate");
        else if (dropGot === undefined) failures.push("3:drop: with p2's listener terminated, p1's reply never reached p2's view within 10 s");
        else evidence.push(`3: ${killed.length} listener terminated, reply ${dropGot - dropSaved} ms after saved`);

        const back = await until(() => p2.call<boolean>("crosses"), 10_000);
        if (!back) failures.push("3:back: p2's bus never said it crosses again within 10 s of the drop");
        else {
          await delay(1_500);
          const afterSaved = await reply(p1, session, "the reply, after the listener is back");
          const afterGot = await receivedAt(frames, view, (e) => textOf(e) === "the reply, after the listener is back", 3_000);
          if (afterGot === undefined) failures.push("3:back: once the listener was back, p1's next reply never reached p2's view within 3 s");
          else if (afterGot - afterSaved >= 1_000) failures.push(`3:back: the next reply arrived ${afterGot - afterSaved} ms after saved (bound 1000)`);
          else evidence.push(`3: back, next reply ${afterGot - afterSaved} ms after saved`);
        }
      } finally {
        await stop();
      }
    }

    // 4 · no tail pool: the timed read still reaches process 2.
    {
      const { p1, p2, frames, stop } = await pair(db, false);
      try {
        const quiet = `${session}-no-tail`;
        await reply(p1, quiet, "opening");
        const view = await p2.call<number>("openView", { session: quiet });
        await delay(1_500);
        const crosses = await p2.call<boolean>("crosses");
        if (crosses) failures.push("4:no-tail: with liveTailPool: null, p2's bus says it crosses processes");
        const saved = await reply(p1, quiet, "the reply, with no tail pool");
        const got = await receivedAt(frames, view, (e) => textOf(e) === "the reply, with no tail pool", 4_000);
        const replies = tell.over("4:no-tail · p2's copies of p1's reply", got === undefined ? [] : [got]);
        if (replies.length === 0) failures.push("4:no-tail: p2's view never received p1's reply within 4 s");
        else if (replies[0]! - saved >= 2_000) failures.push(`4:no-tail: reply arrived ${replies[0]! - saved} ms after it was saved (bound 2000)`);
        else evidence.push(`4: reply ${replies[0]! - saved} ms after saved, on the timed read`);
      } finally {
        await stop();
      }
    }
  } finally {
    await db.stop();
  }

  return { failures, evidence: evidence.join(" · ") };
});
