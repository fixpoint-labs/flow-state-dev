/**
 * Goal check, FIX-2407: Kitchen Sink, crashed mid-turn and served again on the
 * same store, shows the conversation and the cut coding turn, with no action
 * from the person. See goal.md.
 *
 * The built app in test mode (`next start`), on SQLite at a scratch file
 * (`KITCHEN_SINK_STORE_FILE`), its Claude Code mode on the scripted Claude
 * Code. A Claude Code session's coding turn is held open by the script's
 * `[slow]` directive, and the host is killed while it runs. Its worktrees go
 * under a scratch `XDG_STATE_HOME`, cut from a scratch checkout.
 *
 * Run:      pnpm tsx goals/kitchen-sink-harness/survives-a-crash-mid-turn/run.mts
 *           (GOAL_SKIP_BUILD=1 serves the build already in apps/kitchen-sink/.next)
 * Controls: GOAL_CONTROL=fresh-store (the second serve gets a new store; `conversation` must FAIL)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient, type Client } from "@flow-state-dev/client";
import { crashAndRestart, goalTmpDir, runGoal, sleep } from "../../lib/index.mts";
import { readConversation, readCutTurn } from "../../lib/crash-reads.mts";
import { buildKitchenSink, startKitchenSink, type KitchenSinkServer } from "../../lib/kitchen-sink.mts";
import { KITCHEN_SINK_USER_ID } from "../../../apps/kitchen-sink/lib/kitchen-sink-principal.ts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
if (!["", "fresh-store"].includes(CONTROL)) throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; known: fresh-store`);

const PORT = 3071;
const FLOW = "claude-code-session";
/** The model the scripted Claude Code offers. It runs none. */
const MODEL = "scripted-claude-code";
/** The engine's stale threshold plus a sweep, and then some: when the cut turn must be listed. */
const CUT_TURN_MS = 150_000;
/** What the app logs at start on the dev profile's SQLite with no database URL; anything else is not the scratch file. */
const SCRATCH_STORE_LINE = "[flowstate] profile=dev store=sqlite durable=true interruptedScan=true";
const say = (s: string) => console.error(`[ks-crash ${new Date().toISOString().slice(11, 19)}] ${s}`);

await runGoal(async (failures) => {
  const dir = goalTmpDir("ks-survives-a-crash");
  // The checkout a session's worktree is cut from: one commit, so it has a HEAD.
  const repo = join(dir, "repo");
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, "README.md"), "# Repo\n");
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=goal", "-c", "user.email=goal@example.com", ...args], { cwd: repo });
  git("init", "-q", "-b", "main");
  git("add", ".");
  git("commit", "-q", "-m", "Start");
  if (process.env.GOAL_SKIP_BUILD !== "1") buildKitchenSink();
  const store = join(dir, "flowstate.db");
  // The dev profile, whatever the shell holds: a database URL or `FSD_ENV=prod` would put the
  // app on Postgres, and this goal (and its control's restart) would write into that database.
  const serve = async (file: string): Promise<KitchenSinkServer> => {
    const server = await startKitchenSink(PORT, {
      FSD_ENV: "dev",
      FSD_DB_URL: "",
      DATABASE_URL: "",
      STORE_TYPE: "sqlite",
      KITCHEN_SINK_STORE_FILE: file,
      KITCHEN_SINK_HARNESS_WORKSPACE: repo,
      XDG_STATE_HOME: join(dir, "state"),
    });
    if (!server.log().includes(SCRATCH_STORE_LINE)) {
      server.stop();
      throw new Error(`setup: the app is not on the scratch SQLite store (want "${SCRATCH_STORE_LINE}"):\n${server.log().slice(-2000)}`);
    }
    return server;
  };

  let served = await serve(store);
  try {
    let me: Client = createClient({ userId: KITCHEN_SINK_USER_ID, baseUrl: served.origin });
    const session = await me.flow(FLOW).createSession({ state: { model: MODEL } });
    const said = `Say hello. The code word is heron-${Date.now() % 100_000}.`;

    // An earlier turn, ended.
    const first = await me.flow(FLOW).send("turn", { prompt: said }, { sessionId: session.id });
    const firstEnd = await first.wait({ timeoutMs: 120_000 });
    if (firstEnd.status !== "completed") throw new Error(`setup: the first turn ended ${firstEnd.status}`);

    // The coding turn the crash cuts, held open by the script.
    const held = await me.flow(FLOW).send("turn", { prompt: "[slow] Add a line to README.md." }, { sessionId: session.id });
    // Kill only once the turn is read as running: never on a timer.
    let running = false;
    for (const until = Date.now() + 15_000; !running && Date.now() < until; await sleep(250)) {
      running = (await held.status()).status === "in_progress";
    }
    if (!running) throw new Error(`setup: the held turn never read as running: ${(await held.status()).status}`);
    say(`before the kill: ${JSON.stringify({ session: session.id, ended: first.id, cut: held.id })}`);

    const next = CONTROL === "fresh-store" ? join(dir, "fresh.db") : store;
    served = await crashAndRestart(served.child, () => serve(next));
    me = createClient({ userId: KITCHEN_SINK_USER_ID, baseUrl: served.origin });
    say(`served again on ${next === store ? "the same store" : "a fresh store"}`);

    const lost = await readConversation(me, session.id, said, [first.id]);
    if (lost !== undefined) failures.push(`conversation — ${lost}`);
    const cutTurn = await readCutTurn(me, session.id, held.id, CUT_TURN_MS);
    if (cutTurn !== undefined) failures.push(`cut-turn — ${cutTurn}`);
    return { failures, evidence: `crashed mid-turn, served again; session ${session.id} kept turn ${first.id}, ${held.id} listed interrupted and not running` };
  } finally {
    served.stop();
  }
});
