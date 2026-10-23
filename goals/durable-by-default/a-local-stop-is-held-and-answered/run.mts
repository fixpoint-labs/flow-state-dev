/**
 * Goal check for FIX-2063. Legs, signal, and the control are in goal.md.
 * Real `fsdev` processes over a scratch SQLite file, graded from the CLI
 * output and the dev server's routes.
 *
 * Run: pnpm tsx goals/durable-by-default/a-local-stop-is-held-and-answered/run.mts
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { REPO_ROOT, intentFreeEnv, refuseIfAnswering, runGoal, stopProcessGroup, type Tell } from "../../lib/index.mts";

const FLOWS = fileURLToPath(new URL("./fixtures/flows", import.meta.url));
const CONFIG_DEFAULT = fileURLToPath(new URL("./fixtures/config-default/fsdev.config.mts", import.meta.url));
const CONFIG_OFF = fileURLToPath(new URL("./fixtures/config-off/fsdev.config.mts", import.meta.url));
const TSX = join(REPO_ROOT, "node_modules", ".bin", "tsx");
const FSDEV = join(REPO_ROOT, "packages", "cli", "bin", "fsdev.ts");
const KIND = "durable-goal";
/** The DevTool's default user, which a no-config `fsdev run` must share. */
const LOCAL_USER = "devuser";

type Env = Record<string, string>;
interface RunOutcome {
  code: number;
  stdout: string;
  stderr: string;
  capture: any;
}

/** A scratch working directory: where `.fsdev/data` lands for both commands. */
function workDir(name: string): string {
  return mkdtempSync(join(tmpdir(), `fsd-goal-durable-${name}-`));
}

/** One `fsdev run`, as a person types it, from `cwd`. */
function fsdevRun(cwd: string, args: { action: string; input: unknown; session: string; config?: string }, env: Env): RunOutcome {
  const inputFile = join(cwd, `${args.session}.input.json`);
  const capture = join(cwd, `${args.session}.capture.json`);
  writeFileSync(inputFile, JSON.stringify(args.input));
  const where = args.config === undefined ? ["--flow-dir", FLOWS] : ["--config", args.config];
  const result = spawnSync(
    TSX,
    [FSDEV, "run", KIND, args.action, ...where, "--input-file", inputFile, "--session", args.session, "--capture", capture],
    { cwd, env: intentFreeEnv(process.env, env), encoding: "utf8", timeout: 120_000 },
  );
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    capture: existsSync(capture) ? JSON.parse(readFileSync(capture, "utf8")) : undefined,
  };
}

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

interface Dev {
  origin: string;
  readyAt: number;
  stop(): Promise<void>;
}

/** Start `fsdev dev` in `cwd` and wait until it answers its health route. */
async function startDev(cwd: string, env: Env, config?: string): Promise<Dev> {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  await refuseIfAnswering(origin);
  const where = config === undefined ? ["--flow-dir", FLOWS] : ["--config", config];
  let log = "";
  const child: ChildProcess = spawn(TSX, [FSDEV, "dev", ...where, "--no-open", "--port", String(port)], {
    cwd,
    env: intentFreeEnv(process.env, env),
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  child.stdout?.on("data", (chunk) => (log += String(chunk)));
  child.stderr?.on("data", (chunk) => (log += String(chunk)));
  let exited = false;
  const gone = new Promise<void>((resolve) => child.on("exit", () => ((exited = true), resolve())));
  for (let i = 0; i < 240 && !exited; i += 1) {
    try {
      if ((await fetch(`${origin}/healthz`)).status === 200) {
        return {
          origin,
          readyAt: Date.now(),
          stop: async () => {
            stopProcessGroup(child);
            await Promise.race([gone, new Promise((r) => setTimeout(r, 10_000))]);
          },
        };
      }
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  stopProcessGroup(child);
  throw new Error(`fsdev dev never became ready on ${origin}. Log tail:\n${log.slice(-2000)}`);
}

async function api(origin: string, path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const response = await fetch(`${origin}/api/flows${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await response.text();
  try {
    return { status: response.status, body: text.length === 0 ? null : JSON.parse(text) };
  } catch {
    return { status: response.status, body: text };
  }
}

async function requests(origin: string, session: string): Promise<Array<{ id: string; status: string }>> {
  const { body } = await api(origin, `/sessions/${session}/requests?userId=${LOCAL_USER}`);
  return Array.isArray(body?.requests) ? body.requests : [];
}

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, ms: number): Promise<T> {
  const deadline = Date.now() + ms;
  let value = await read();
  while (!done(value) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
    value = await read();
  }
  return value;
}

function ndjson(stdout: string): Array<Record<string, any>> {
  return stdout
    .split("\n")
    .filter((line) => line.trim().startsWith("{"))
    .map((line) => JSON.parse(line) as Record<string, any>);
}

function lines(file: string): string[] {
  return existsSync(file) ? readFileSync(file, "utf8").split("\n").filter((l) => l.length > 0) : [];
}

/** The stop a run printed, read from every surface it printed it on. */
function heldStop(leg: string, run: RunOutcome, failures: string[]): { requestId: string; suspensionId: string } | undefined {
  if (run.code !== 0) failures.push(`[${leg}] fsdev run exited ${run.code}, not 0. stderr tail: ${run.stderr.slice(-400)}`);
  const last = ndjson(run.stdout).at(-1);
  const captured = run.capture?.result?.suspended;
  if (last?.type !== "suspended") failures.push(`[${leg}] stdout's last event is ${JSON.stringify(last?.type)}, not "suspended"`);
  if (captured?.suspensionId === undefined) failures.push(`[${leg}] --capture carries no suspended stop`);
  if (last?.suspensionId !== undefined && captured?.suspensionId !== last.suspensionId) {
    failures.push(`[${leg}] stdout and --capture name different stops`);
  }
  const id = captured?.suspensionId ?? last?.suspensionId;
  if (id !== undefined && !run.stderr.includes(id)) failures.push(`[${leg}] stderr does not print the stop's id`);
  if (!/fsdev dev/.test(run.stderr)) failures.push(`[${leg}] stderr does not say to answer it in fsdev dev`);
  if (!/deadline fires only while a server runs on this store/.test(run.stderr)) {
    failures.push(`[${leg}] stderr does not say the deadline fires only while a server runs`);
  }
  const requestId = captured?.requestId ?? last?.requestId;
  return requestId !== undefined && id !== undefined ? { requestId, suspensionId: id } : undefined;
}

/** Legs a and b, under one trace setting. */
async function heldAndAnswered(pass: string, env: Env, failures: string[], tell: Tell, evidence: string[]): Promise<void> {
  const cwd = workDir(`ab-${pass}`);
  const count = join(cwd, "count.log");
  const runEnv = { ...env, GOAL_COUNT_FILE: count };
  const legA = `a·${pass}`;
  const legB = `b·${pass}`;

  // a. Two runs, an approval and an input stop.
  const approvalSession = `goal_approval_${pass}_${Date.now()}`;
  const inputSession = `goal_input_${pass}_${Date.now()}`;
  const approval = heldStop(legA, fsdevRun(cwd, { action: "submit", input: { title: "release notes" }, session: approvalSession }, runEnv), failures);
  const input = heldStop(`${legA}·input`, fsdevRun(cwd, { action: "ask", input: { title: "changelog" }, session: inputSession }, runEnv), failures);
  if (approval === undefined || input === undefined) return;

  // b. Start fsdev dev on the same folder, then restart it.
  let dev = await startDev(cwd, runEnv);
  try {
    const before = tell.over(`${legA} · the approval run's requests, first start`, await requests(dev.origin, approvalSession));
    const held = before.find((r) => r.id === approval.requestId);
    if (held?.status !== "suspended") failures.push(`[${legA}] the request is ${JSON.stringify(held?.status)}, not "suspended"`);
    await dev.stop();
    dev = await startDev(cwd, runEnv);

    const listed = tell.over(
      `${legB} · sessions in the DevTool's default listing`,
      ((await api(dev.origin, `/sessions?userId=${LOCAL_USER}`)).body?.sessions ?? []) as Array<{ id: string }>,
    );
    for (const session of [approvalSession, inputSession]) {
      if (!listed.some((s) => s.id === session)) failures.push(`[${legB}] session ${session} is not listed under ${LOCAL_USER} after the restart`);
    }

    const answers: Array<[string, typeof approval, Record<string, unknown>]> = [
      [approvalSession, approval, { action: "approve" }],
      [inputSession, input, { action: "submit", data: "two fixes" }],
    ];
    for (const [session, stop, answer] of answers) {
      const resumed = await api(dev.origin, `/${KIND}/requests/${stop.requestId}/resume`, {
        method: "POST",
        body: JSON.stringify({ suspensionId: stop.suspensionId, userId: LOCAL_USER, ...answer }),
      });
      if (resumed.status >= 300) failures.push(`[${legB}] the answer to ${session} got ${resumed.status}: ${JSON.stringify(resumed.body)}`);
      const after = await until(() => requests(dev.origin, session), (rs) => rs.some((r) => r.id === stop.requestId && r.status === "completed"), 20_000);
      const ended = tell.over(`${legB} · ${session}'s requests after the answer`, after);
      if (!ended.some((r) => r.id === stop.requestId && r.status === "completed")) {
        failures.push(`[${legB}] request ${stop.requestId} did not complete: ${JSON.stringify(ended)}`);
      }
      if (ended.length !== 1) failures.push(`[${legB}] ${session} holds ${ended.length} requests, not the one the run started`);
    }
  } finally {
    await dev.stop();
  }

  const counted = tell.over(`${legB} · step runs counted in the side-effect file`, lines(count));
  const tally = (line: string) => counted.filter((l) => l === line).length;
  for (const [line, want] of [["before:release notes", 1], ["after:release notes", 1], ["before:changelog", 1], ["after:changelog:two fixes", 1]] as const) {
    if (tally(line) !== want) failures.push(`[${legB}] "${line}" ran ${tally(line)} times, not ${want}`);
  }
  evidence.push(`${pass}: both stops held by fsdev run, answered once by a restarted fsdev dev`);
}

/** Leg c: a deadline that passes while the server runs. */
async function deadlineFires(failures: string[], evidence: string[]): Promise<void> {
  const cwd = workDir("c");
  const session = `goal_deadline_${Date.now()}`;
  const DEADLINE_MS = 15_000;
  const run = fsdevRun(cwd, { action: "submit", input: { title: "expiring", deadlineMs: DEADLINE_MS }, session }, {});
  const stop = heldStop("c", run, failures);
  if (stop === undefined) return;
  const dev = await startDev(cwd, {});
  try {
    const read = async () =>
      ((await api(dev.origin, `/sessions/${session}/debug/suspensions?userId=${LOCAL_USER}`)).body?.suspensions ?? []) as Array<{
        suspensionId: string;
        status: string;
        expiresAt?: number;
      }>;
    const first = (await read()).find((s) => s.suspensionId === stop.suspensionId);
    if (first?.expiresAt === undefined) {
      failures.push(`[c] the stop has no deadline on record: ${JSON.stringify(first)}`);
      return;
    }
    if (first.expiresAt <= dev.readyAt) {
      failures.push(`[c] the deadline passed before fsdev dev was up (boot too slow); raise DEADLINE_MS`);
      return;
    }
    // One sweep: the sweeper arms for the stop's deadline; allow 5 s past it.
    const wait = first.expiresAt - Date.now() + 5_000;
    const last = await until(read, (all) => all.some((s) => s.suspensionId === stop.suspensionId && s.status === "expired"), wait);
    const status = last.find((s) => s.suspensionId === stop.suspensionId)?.status;
    if (status !== "expired") failures.push(`[c] 5 s past its deadline the stop is ${JSON.stringify(status)}, not "expired"`);
    else evidence.push(`c: expired by ${new Date().toISOString()} for a deadline at ${new Date(first.expiresAt).toISOString()}`);
  } finally {
    await dev.stop();
  }
}

/** Leg d: durable execution off refuses at the stop. */
async function refusedWhenOff(failures: string[], tell: Tell, evidence: string[]): Promise<void> {
  const cwd = workDir("d");
  const count = join(cwd, "count.log");
  const session = `goal_off_${Date.now()}`;
  const run = fsdevRun(cwd, { action: "submit", input: { title: "off" }, session, config: CONFIG_OFF }, { GOAL_COUNT_FILE: count });
  if (run.code === 0) failures.push(`[d] fsdev run exited 0 under durable: false`);
  const message = String(run.capture?.result?.error?.message ?? "");
  if (!/durable execution/.test(message) || !/wherever stores persist/.test(message)) failures.push(`[d] the error does not name the rule: ${message}`);
  if (!/durable: false/.test(message)) failures.push(`[d] the error does not name the setting: ${message}`);
  if (run.capture?.result?.suspended !== undefined) failures.push(`[d] the run reported a held stop`);
  if (lines(count).filter((l) => l === "before:off").length !== 1) failures.push(`[d] the step before the stop did not run once`);
  const dev = await startDev(cwd, {}, CONFIG_OFF);
  try {
    const recorded = tell.over("d · the run's requests", await requests(dev.origin, session));
    if (!recorded.every((r) => r.status === "failed")) failures.push(`[d] the request is not recorded failed: ${JSON.stringify(recorded)}`);
    const held = (await api(dev.origin, `/sessions/${session}/debug/suspensions?userId=${LOCAL_USER}`)).body?.suspensions ?? [];
    tell.over("d · stops held under durable: false", held, { emptyIs: "the claim: nothing is held when durability is off" });
    if (held.length !== 0) failures.push(`[d] ${held.length} stop(s) held under durable: false`);
  } finally {
    await dev.stop();
  }
  evidence.push("d: refused at the stop, naming the rule and durable: false");
}

/** Leg e: an app config that never mentions durable. */
async function heldUnderConfig(failures: string[], tell: Tell, evidence: string[]): Promise<void> {
  const cwd = workDir("e");
  const session = `goal_config_${Date.now()}`;
  const run = fsdevRun(cwd, { action: "submit", input: { title: "config" }, session, config: CONFIG_DEFAULT }, {});
  const stop = heldStop("e", run, failures);
  if (stop === undefined) return;
  const dev = await startDev(cwd, {}, CONFIG_DEFAULT);
  try {
    const resumed = await api(dev.origin, `/${KIND}/requests/${stop.requestId}/resume`, {
      method: "POST",
      body: JSON.stringify({ suspensionId: stop.suspensionId, action: "approve", userId: LOCAL_USER }),
    });
    if (resumed.status >= 300) failures.push(`[e] the approve got ${resumed.status}: ${JSON.stringify(resumed.body)}`);
    const after = tell.over(
      "e · the config run's requests after the answer",
      await until(() => requests(dev.origin, session), (rs) => rs.some((r) => r.status === "completed"), 20_000),
    );
    if (!after.some((r) => r.id === stop.requestId && r.status === "completed")) failures.push(`[e] the request did not complete: ${JSON.stringify(after)}`);
  } finally {
    await dev.stop();
  }
  evidence.push("e: an app config without durable held and answered the stop");
}

await runGoal(async (failures, tell) => {
  const evidence: string[] = [];
  await heldAndAnswered("traces-default", {}, failures, tell, evidence);
  await heldAndAnswered("traces-off", { FSDEV_TRACE_OBSERVABILITY: "0" }, failures, tell, evidence);
  await deadlineFires(failures, evidence);
  await refusedWhenOff(failures, tell, evidence);
  await heldUnderConfig(failures, tell, evidence);
  return { failures, evidence: evidence.join("; ") };
});
