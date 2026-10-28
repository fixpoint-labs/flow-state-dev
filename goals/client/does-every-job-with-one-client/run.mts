/**
 * Goal check for FIX-2162: one client does every job an app has, over HTTP
 * and in-process alike, across a real crash. Legs, signal and controls are in
 * goal.md.
 *
 * Four legs: each transport (`fsdev serve` in its own process over SQLite;
 * `createInProcessFetch` in the client's own process over the same kind of
 * file) with each input (the support desk; the notes copy by its instance id).
 * Each leg starts `client.mts` once, SIGKILLs the host while a request holds on
 * a latch, releases the latch, restarts the host on the same file, and starts
 * `client.mts` again. This file grades what the two processes saw and the
 * counter file the flow's steps append to. Leg c, the caller census, runs
 * last: `check.mjs --after`, then `check.mjs --control`.
 *
 * Run: pnpm tsx goals/client/does-every-job-with-one-client/run.mts
 * Controls: GOAL_CONTROL=retry-instead | two-clients | stream-off-fetcher
 */
import { onClosed } from "../../lib/server.mts";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  REPO_ROOT,
  assertPatched,
  intentFreeEnv,
  modulePatchEnv,
  refuseIfAnswering,
  runGoal,
  stopProcessGroup,
  type ModulePatch,
  type Tell,
} from "../../lib/index.mts";
import type { PhaseOne, PhaseTwo } from "./client.mts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const CLIENT = join(HERE, "client.mts");
const CONFIG = join(HERE, "fixtures", "fsdev.config.mts");
const CHECK = join(HERE, "check.mjs");
const TSX = join(REPO_ROOT, "node_modules", ".bin", "tsx");
const FSDEV = join(REPO_ROOT, "packages", "cli", "bin", "fsdev.ts");
const INPUTS = ["support", "notes"].map((name) => join(HERE, "fixtures", `${name}.json`));
const CONTROL = process.env.GOAL_CONTROL ?? "";
const CONTROLS = ["", "retry-instead", "two-clients", "stream-off-fetcher"];

/**
 * The instrument behind "one client per process": every `createClient` call
 * in a client process bumps a global the process reports. Applied at load, so
 * a client built any way at all is counted, and never written to the checkout.
 */
const COUNT_CLIENTS: ModulePatch[] = [
  {
    module: "packages/client/src/client.ts",
    from: "export function createClient\\(options[^)]*\\)[^{]*\\{",
    to: "$& globalThis.__goalCreateClient = (globalThis.__goalCreateClient ?? 0) + 1;",
  },
];

interface Fixture {
  flow: string;
  turns: string[];
  expectedAnswer: string;
  hold: string;
}

type Env = Record<string, string>;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/** A detached child, its output kept, and a promise for its exit. */
function start(args: string[], env: Env): { child: ChildProcess; log: () => string; exited: Promise<number> } {
  let log = "";
  const child = spawn(TSX, args, { cwd: REPO_ROOT, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
  child.stdout?.on("data", (chunk) => (log += String(chunk)));
  child.stderr?.on("data", (chunk) => (log += String(chunk)));
  const exited = new Promise<number>((resolve) => onClosed(child, (code, signal) => resolve(code ?? (signal === null ? 1 : 128))));
  return { child, log: () => log, exited };
}

/** `fsdev serve` on SQLite, ready when `/healthz` answers 200. */
async function startHost(env: Env): Promise<{ origin: string; kill(signal: NodeJS.Signals): Promise<void> }> {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  await refuseIfAnswering(origin);
  const host = start([FSDEV, "serve", "--config", CONFIG, "--port", String(port), "--host", "127.0.0.1"], env);
  let gone = false;
  void host.exited.then(() => (gone = true));
  for (let i = 0; i < 240 && !gone; i += 1) {
    try {
      if ((await fetch(`${origin}/healthz`)).status === 200) {
        return {
          origin,
          kill: async (signal) => {
            stopProcessGroup(host.child, signal);
            await Promise.race([host.exited, sleep(10_000)]);
          },
        };
      }
    } catch {
      /* not listening yet */
    }
    await sleep(250);
  }
  stopProcessGroup(host.child, "SIGKILL");
  throw new Error(`fsdev serve never became ready on ${origin}. Log tail:\n${host.log().slice(-2000)}`);
}

/** Run a client phase to its exit; its `__GOAL__` line, when it printed one. */
async function runPhase(env: Env): Promise<{ code: number; seen?: PhaseTwo; log: string }> {
  const phase = start([CLIENT], env);
  const code = await Promise.race([phase.exited, sleep(120_000).then(() => -1)]);
  if (code === -1) stopProcessGroup(phase.child, "SIGKILL");
  const line = phase.log().split("\n").find((l) => l.startsWith("__GOAL__"));
  return { code, log: phase.log(), ...(line === undefined ? {} : { seen: JSON.parse(line.slice("__GOAL__".length)) as PhaseTwo }) };
}

async function until(done: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (!done() && Date.now() < deadline) await sleep(100);
  return done();
}

const lines = (file: string) => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter((l) => l !== "") : []);

/** One leg: one transport, one input, one crash. */
async function leg(transport: "http" | "inproc", inputFile: string, notesId: string, failures: string[], tell: Tell): Promise<string> {
  const input = JSON.parse(readFileSync(inputFile, "utf8")) as Fixture;
  const name = `${transport}·${input.flow}`;
  const fail = (tag: string, detail: string) => failures.push(`${tag} — [${name}] ${detail}`);
  const dir = mkdtempSync(join(tmpdir(), `fsd-goal-one-client-${transport}-`));
  const counter = join(dir, "count.log");
  const latch = join(dir, "latch");
  const statePath = join(dir, "phase-one.json");
  const mark = join(dir, "patched.log");
  const hostEnv = intentFreeEnv(process.env, {
    GOAL_STORE: join(dir, "app.db"),
    GOAL_NOTES_ID: notesId,
    GOAL_LATCH_FILE: latch,
    GOAL_COUNTER_FILE: counter,
  });
  const clientEnv = (phase: string, origin?: string): Env => ({
    ...hostEnv,
    ...modulePatchEnv(COUNT_CLIENTS, REPO_ROOT, mark),
    GOAL_PHASE: phase,
    GOAL_TRANSPORT: transport,
    GOAL_INPUT: inputFile,
    GOAL_STATE: statePath,
    GOAL_USER: `u-${transport}-${input.flow}`,
    GOAL_CONTROL: phase === "2" ? CONTROL : "",
    ...(origin === undefined ? {} : { GOAL_ORIGIN: origin }),
  });

  // Phase 1, then a SIGKILL while the held request waits on the latch.
  let second: { code: number; seen?: PhaseTwo; log: string };
  if (transport === "http") {
    const host = await startHost(hostEnv);
    const first = await runPhase(clientEnv("1", host.origin));
    if (first.code !== 0 || !existsSync(statePath)) {
      await host.kill("SIGKILL");
      throw new Error(`[${name}] phase 1 exited ${first.code}:\n${first.log.slice(-2000)}`);
    }
    await host.kill("SIGKILL");
    writeFileSync(latch, "released");
    const again = await startHost(hostEnv);
    try {
      second = await runPhase(clientEnv("2", again.origin));
    } finally {
      await again.kill("SIGTERM");
    }
  } else {
    const first = start([CLIENT], clientEnv("1"));
    const wrote = await until(() => existsSync(statePath), 90_000);
    stopProcessGroup(first.child, "SIGKILL");
    await Promise.race([first.exited, sleep(10_000)]);
    if (!wrote) throw new Error(`[${name}] phase 1 never wrote what it saw:\n${first.log().slice(-2000)}`);
    writeFileSync(latch, "released");
    second = await runPhase(clientEnv("2"));
  }
  assertPatched(COUNT_CLIENTS, REPO_ROOT, mark);
  const one = JSON.parse(readFileSync(statePath, "utf8")) as PhaseOne;
  const two = second.seen;
  if (second.code !== 0 || two === undefined) throw new Error(`[${name}] phase 2 exited ${second.code}:\n${second.log.slice(-2000)}`);
  for (const error of two.errors) fail("p2:threw", error);

  // Phase 1: the turns, the resource they wrote, the stop.
  const expectedTranscript = input.turns.join("\n");
  for (const reply of tell.over(`${name} · phase 1 replies`, one.replies)) {
    if (reply.status !== "completed") fail("p1:turns", `reply ${reply.id} ended ${reply.status}`);
  }
  if (one.replies.length !== input.turns.length) fail("p1:turns", `${one.replies.length} replies sent for ${input.turns.length} turns`);
  if (one.approveStatus !== "suspended") fail("p1:stopped", `the approval request is ${one.approveStatus}, not suspended`);
  if (one.transcript !== expectedTranscript) fail("b:resource", `phase 1 read ${JSON.stringify(one.transcript)}`);

  // a. The held request: listed twice, carried on under its id, its first step run once.
  for (const [label, read] of [["first", two.firstRead], ["second", two.secondRead]] as const) {
    const listed = tell.over(`${name} · interrupted(), ${label} read`, read);
    if (!listed.some((r) => r.id === one.holdId)) fail("a:listed", `the ${label} read of interrupted() does not list ${one.holdId}: ${JSON.stringify(listed)}`);
  }
  if (two.heldId !== one.holdId) fail("a:listed", `interrupted() named ${two.heldId}, not the held ${one.holdId}`);
  if (two.carriedOnAs !== one.holdId) fail("a:same-id", `the held request carried on as ${two.carriedOnAs}, not ${one.holdId}`);
  if (two.carriedOnStatus !== "completed") fail("a:completed", `the request that carried on ended ${two.carriedOnStatus}`);
  const counted = tell.over(`${name} · counted step runs`, lines(counter));
  for (const step of [`before:${input.hold}`, `after:${input.hold}`]) {
    const runs = counted.filter((l) => l === step).length;
    if (runs !== 1) fail("a:ran-once", `"${step}" ran ${runs} times, not once`);
  }

  // b. The stop, answered by id; the resource; every turn; one client, one fetcher; the stream.
  if (two.resumedAs !== one.approveId) fail("b:resumed", `the answer carried on as ${two.resumedAs}, not ${one.approveId}`);
  if (two.approveStatus !== "completed") fail("b:resumed", `the answered request ended ${two.approveStatus}`);
  const requests = tell.over(`${name} · the session's requests`, two.requests);
  const answered = requests.find((r) => r.id === one.approveId)?.output as { answer?: string } | undefined;
  if (answered?.answer !== input.expectedAnswer) fail("b:resumed", `the approval answered ${JSON.stringify(answered)}, not ${JSON.stringify(input.expectedAnswer)}`);
  if (two.transcript !== expectedTranscript) fail("b:resource", `phase 2 read ${JSON.stringify(two.transcript)}`);
  for (const id of [...one.replies.map((r) => r.id), one.approveId, one.holdId]) {
    if (!requests.some((r) => r.id === id)) fail("b:turns", `the session does not list request ${id}`);
  }
  for (const [label, seen] of [["phase 1", one], ["phase 2", two]] as const) {
    if (seen.clients !== 1) fail("b:one-client", `${label} called createClient ${seen.clients} times`);
    if (seen.fetcherCalls === 0) fail("b:through-fetcher", `${label}'s fetcher was never called`);
    const around = tell.over(`${name} · ${label} calls around the fetcher`, seen.bypasses, { emptyIs: "the claim: every call goes through the client's fetcher" });
    if (around.length > 0) fail("b:through-fetcher", `${label} reached global fetch ${around.length} time(s): ${around.join(", ")}`);
  }
  if (!two.stream.statuses.includes("completed")) {
    fail("b:stream", `the stream of ${two.carriedOnAs} reported ${JSON.stringify(two.stream.statuses)}${two.stream.error ? ` (${two.stream.error})` : ""}`);
  }
  return `${name}: interrupted() listed ${one.holdId} twice, continued under it once-run; ${one.approveId} resumed to "${input.expectedAnswer}"; ${requests.length} requests; ${one.fetcherCalls}+${two.fetcherCalls} fetcher calls, 0 around it; stream ${two.stream.events} events`;
}

/** Leg c: the caller census, gate then control. */
function census(failures: string[]): string {
  const after = spawnSync("node", [CHECK, "--after"], { cwd: REPO_ROOT, encoding: "utf8" });
  if (after.status !== 0) failures.push(`c:census — check.mjs --after exited ${after.status}:\n${(after.stdout + after.stderr).trim().slice(-3000)}`);
  const control = spawnSync("node", [CHECK, "--control"], { cwd: REPO_ROOT, encoding: "utf8" });
  if (control.status !== 0) failures.push(`c:control — check.mjs --control exited ${control.status}:\n${(control.stdout + control.stderr).trim().slice(-3000)}`);
  return `census --after exit ${after.status}, --control exit ${control.status}: ${control.stdout.trim().split("\n").at(-1)}`;
}

await runGoal(async (failures, tell) => {
  if (!CONTROLS.includes(CONTROL)) throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${CONTROLS.filter((c) => c !== "").join(", ")}`);
  const notesId = (JSON.parse(readFileSync(INPUTS[1]!, "utf8")) as Fixture).flow;
  const evidence: string[] = [];
  for (const transport of ["http", "inproc"] as const) {
    for (const input of INPUTS) evidence.push(await leg(transport, input, notesId, failures, tell));
  }
  // The census grades the tree, which no control changes.
  if (CONTROL === "") evidence.push(census(failures));
  return { failures, evidence: evidence.join("; ") };
});
