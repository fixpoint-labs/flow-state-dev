/**
 * What the closure's four app scripts share, so each `<app>/run.mts` holds
 * only how its app is served and who in it is asked:
 *
 * - {@link closurePass}: which pass this is (`GOAL_PASS`), and the tree it
 *   serves: this checkout, or `GOAL_COMMIT`'s own tree and install (the
 *   control defaults to `0df5c85`, main when the epic merged).
 * - {@link serveFsdev}: an app's `fsdev serve` (its flow API, no pages to build) on a free port, its whole
 *   process group stopped after; on the pass's models (`model.mts`: each app's own, or Haiku on
 *   `GOAL_HAIKU=1`).
 * - {@link planted}: files written into the served tree for one run and put
 *   back after, including a worker's skill and its `skills.activateTool`
 *   switch, which is set only on the control and the cut run.
 * - {@link askWorker}: one line to a worker's conversation over the public
 *   client, waited until every conversation of the person's goes quiet, and
 *   recorded as a {@link Turn}: the reply, the tool calls, the clock.
 * - {@link runChecks}, {@link turnChecks}: the checks record a coder grader reads
 *   beside a reply (a run record's, or a harness session turn's); the fold
 *   is read by `goals/lib/history.mts`'s `foldOf`, as `history-window` reads it.
 * - {@link runClosure}: the loop every app runs: 3 runs, each ask its app
 *   counts in, graded, written to the pass's sheet, and reported through
 *   `runGoal`.
 */
import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createClient, type SessionStateSnapshotResponse } from "@flow-state-dev/client";
import type { MessageItem, OutputItem, SuspensionItem, ToolOutputItem } from "@flow-state-dev/core/items";
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";
import { harnessSessionStateSchema, runRecordStateSchema } from "@flow-state-dev/harness-manager";
import { foldOf, goalTmpDir, sessionWindow, intentFreeEnv, onClosed, readTree, REPO_ROOT, refuseIfAnswering, runGoal, sleep, stopProcessGroup, type SessionReads } from "../lib/index.mts";
import {
  ASKS,
  cellsFor,
  checksFrom,
  gradeCoder,
  gradeDate,
  gradeFold,
  gradeKnowledge,
  gradeMultiFile,
  gradePagesRead,
  gradeSizing,
  gradeSkill,
  RUNS,
  type App,
  type Ask,
  type Graded,
  type Pass,
  type Sheet,
  type Turn,
} from "./asks.mts";
import { draw, type Draw } from "./fixtures.mts";
import { closureModel, servedModel, type ClosureModel } from "./model.mts";

export type Fsd = ReturnType<typeof createClient>;

/** The commit the control runs on: main when the epic merged, before any bug fix (FIX-2541 DECISIONS). */
const CONTROL_COMMIT = "0df5c85";

// ---------------------------------------------------------------------------
// The pass and the tree
// ---------------------------------------------------------------------------

/** This run's pass and the tree it serves. */
export interface ClosurePass {
  pass: Pass;
  /** The repository root the app is served from. */
  root: string;
  /** One line for the verdict: which tree, at which commit. */
  describe: string;
  /** The commit the tree is, resolved to its full SHA: what each result is stamped with. */
  commit: string;
  /** Whether the run sets the switches `main` leaves off (the control and the cut run), or nothing (the wrap). */
  switches: boolean;
  /** The models the apps answer on (`GOAL_HAIKU`): what each result is stamped with beside its commit. */
  model: ClosureModel;
}

/** `GOAL_PASS` (`control`, `cut` or `wrap`, required) and the tree it serves. */
export function closurePass(): ClosurePass {
  const pass = process.env.GOAL_PASS as Pass | undefined;
  if (pass !== "control" && pass !== "cut" && pass !== "wrap") {
    console.error(`GOAL_PASS must be control, cut or wrap (got ${JSON.stringify(pass ?? "")})`);
    process.exit(2);
  }
  let model: ClosureModel;
  try {
    model = closureModel();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
  const commit = process.env.GOAL_COMMIT ?? (pass === "control" ? CONTROL_COMMIT : "");
  return { pass, switches: pass !== "wrap", model, ...treeFor(commit) };
}

/** This checkout, or a commit's own tree and install, kept across runs (a commit's tree doesn't change). */
function treeFor(commit: string): { root: string; describe: string; commit: string } {
  const git = (...args: string[]) => execFileSync("git", ["-C", REPO_ROOT, ...args], { encoding: "utf8" }).trim();
  if (commit === "") {
    const head = git("rev-parse", "HEAD");
    return { root: REPO_ROOT, describe: `this checkout, \`${head.slice(0, 9)}\``, commit: head };
  }
  const sha = git("rev-parse", `${commit}^{commit}`);
  const root = join(tmpdir(), "fsd-goal-closure-trees", sha.slice(0, 12));
  if (!existsSync(join(root, "package.json"))) {
    mkdirSync(root, { recursive: true });
    execFileSync("sh", ["-c", `git -C "${REPO_ROOT}" archive --format=tar ${sha} | tar -x -C "${root}"`]);
  }
  if (!existsSync(join(root, "node_modules"))) {
    console.error(`installing ${sha.slice(0, 9)} in ${root}`);
    const installed = spawnSync("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], { cwd: root, encoding: "utf8", timeout: 900_000 });
    if (installed.status !== 0) throw new Error(`setup: ${sha} did not install: ${(installed.stdout + installed.stderr).slice(-1500)}`);
  }
  return { root, describe: `\`${sha.slice(0, 9)}\` (GOAL_COMMIT=${commit}), its own tree and install`, commit: sha };
}

// ---------------------------------------------------------------------------
// Serving an app
// ---------------------------------------------------------------------------

/** A served app. */
export interface Served {
  origin: string;
  child: ChildProcess;
  log: () => string;
  stop: () => void;
}

/**
 * `fsdev serve` from `cwd` in the tree at `root`, on loopback and a free port, with `args`
 * (`--config`, `--app`) and `env`, on `model` (`servedModel`: on Haiku, the app's `--config`
 * through `haiku.config.mts`). Ready once its flow API answers at all
 * (a host with a bearer door answers 401, which is still an answer).
 */
export async function serveFsdev(options: { root: string; cwd: string; args?: string[]; env: Record<string, string>; logTo: string; model: ClosureModel }): Promise<Served> {
  const port = 47_000 + Math.floor(Math.random() * 9_000);
  const origin = `http://127.0.0.1:${port}`;
  await refuseIfAnswering(origin);
  let log = "";
  // The model's env carries the key on Haiku: it goes to the child's environment only, never a log line.
  const model = servedModel(options.model, options.args ?? []);
  const child = spawn(
    join(options.root, "node_modules", ".bin", "tsx"),
    [join(options.root, "packages", "fsdev", "src", "bin.ts"), "serve", ...model.args, "--host", "127.0.0.1", "--port", String(port)],
    {
      cwd: options.cwd,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: intentFreeEnv(process.env, { GOAL_CONTROL: "", ...options.env, ...model.env }),
    },
  );
  const keep = (chunk: Buffer) => {
    log += chunk.toString();
    appendFileSync(options.logTo, chunk);
  };
  child.stdout!.on("data", keep);
  child.stderr!.on("data", keep);
  const stop = servedUntilStopped(child);
  let gone = false;
  onClosed(child, () => (gone = true));
  for (const until = Date.now() + 180_000; Date.now() < until && !gone; await sleep(500)) {
    const status = await fetch(`${origin}/api/flows`, { signal: AbortSignal.timeout(2_000) }).then((r) => r.status, () => 0);
    if (status > 0 && status < 500) return { origin, child, log: () => log, stop };
  }
  stop();
  throw new Error(`setup: the app never served on ${origin}. Log tail:\n${log.slice(-2000)}`);
}

/** The stops of every app this process is serving now: a signal stops them all before the run exits. */
const serving = new Set<() => void>();

/**
 * Hold `child` (a detached process group, as an app is served) as served
 * until the returned stop is called. {@link planted} stops every one still
 * held when its run ends, however it ends (the asks done, a driver's start or
 * an ask throwing, a SIGINT or SIGTERM), so no driver needs its own cleanup
 * and no server outlives its run.
 */
export function servedUntilStopped(child: ChildProcess): () => void {
  const stop = () => {
    serving.delete(stop);
    stopProcessGroup(child);
  };
  serving.add(stop);
  return stop;
}

/** Stop every app still served. */
function stopServing(): void {
  for (const stop of [...serving]) stop();
}

/** A client for `userId` against `origin`, carrying `bearer` when the host has a door. */
export function clientFor(origin: string, userId: string, bearer?: string): Fsd {
  return createClient({
    userId,
    baseUrl: origin,
    ...(bearer === undefined
      ? {}
      : {
          fetcher: (input: RequestInfo | URL, init?: RequestInit) =>
            fetch(input, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers).entries()), authorization: `Bearer ${bearer}` } }),
        }),
  } as Parameters<typeof createClient>[0]);
}

// ---------------------------------------------------------------------------
// Files planted for one run
// ---------------------------------------------------------------------------

/**
 * Where {@link planted} keeps what it must put back, until it has: a run the
 * machine killed mid-way (no `finally`, no signal) leaves the app's tree
 * planted, and the next run puts it back from here before it plants anything.
 * One journal per app, so the four scripts can run side by side.
 */
const journalFile = (key: string) => join(tmpdir(), `fsd-goal-closure-planted-${key}.json`);

type Journal = { before: Record<string, string | null>; made: string[] };

/** Put back what a journal says was there, and drop the journal. */
function restoreFrom(file: string, journal: Journal): void {
  for (const [path, text] of Object.entries(journal.before)) {
    if (text === null) rmSync(path, { force: true });
    else writeFileSync(path, text);
  }
  for (const dir of journal.made) rmSync(dir, { recursive: true, force: true });
  rmSync(file, { force: true });
}

/**
 * Write the files `plant` returns (absolute path → text) for the duration of
 * `fn`, journaled under `key`, then put each back as it was (removed when it
 * did not exist, with any folder made for it: an empty skill folder is a load
 * error). The served tree is this checkout or a scratch tree; either way it
 * leaves as it came. What is to be put back is journaled first, so a run
 * killed before its `finally` is undone by the next one, before `plant`
 * reads the tree.
 */
export async function planted<T>(key: string, plant: () => Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const file = journalFile(key);
  // Put back what a killed run left first: `plant` reads the tree it planted into.
  if (existsSync(file)) {
    console.error(`putting back what a killed run left planted (${file})`);
    restoreFrom(file, JSON.parse(readFileSync(file, "utf8")) as Journal);
  }
  const files = plant();
  const journal: Journal = { before: {}, made: [] };
  for (const path of Object.keys(files)) {
    journal.before[path] = existsSync(path) ? readFileSync(path, "utf8") : null;
    // The topmost folder that does not exist yet is the one to remove after.
    let dir = dirname(path);
    let top: string | undefined;
    while (!existsSync(dir)) {
      top = dir;
      dir = dirname(dir);
    }
    if (top !== undefined && !journal.made.includes(top)) journal.made.push(top);
  }
  writeFileSync(file, JSON.stringify(journal));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  // A signal never reaches `finally`: stop every served app's process group, put the tree back, then exit.
  const onSignal = () => {
    stopServing();
    restoreFrom(file, journal);
    process.exit(130);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    return await fn();
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    stopServing();
    restoreFrom(file, journal);
  }
}

/**
 * The files that give the worker at `workerDir` the draw's skill, in its own
 * `skills/` folder, and on the control and the cut run, `skills.activateTool`
 * in its `WORKER.md`. At the wrap the switch is left as the tree has it.
 */
export function skillFiles(workerDir: string, skill: Draw["skill"], switchOn: boolean): Record<string, string> {
  const files: Record<string, string> = { [join(workerDir, "skills", skill.name, "SKILL.md")]: skill.body };
  if (!switchOn) return files;
  const file = join(workerDir, "WORKER.md");
  const text = readFileSync(file, "utf8");
  const head = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (head === null) throw new Error(`setup: ${file} has no frontmatter`);
  if (/^skills:/m.test(head[1]!)) throw new Error(`setup: ${file} already names skills; set activateTool by hand`);
  files[file] = text.replace(head[0], `---\n${head[1]}\nskills:\n  activateTool: true\n---\n`);
  return files;
}

/** The skill names the worker `workerId` holds, as the workforce kit reads them from the served tree. */
export async function heldSkills(tree: string, workerId: string): Promise<string[]> {
  const { workers } = await readTree(tree);
  return (workers.find((w) => w.id === workerId)?.skills ?? []).map((s) => s.name);
}

// ---------------------------------------------------------------------------
// Asking a worker
// ---------------------------------------------------------------------------

/** A request in one of these has ended; any other (running, queued, parked on a reply) is still owed. */
const ENDED = new Set(["completed", "failed", "incomplete", "aborted", "interrupted", "cancelled"]);

/** Every message and tool item of a session, oldest first. */
export async function itemsOf(fsd: Fsd, sessionId: string): Promise<OutputItem[]> {
  const items: OutputItem[] = [];
  for (let offset = 0; ; ) {
    const page = await fsd.sessions.state(sessionId, { includeItems: true, itemTypes: ["message", "tool_output"], offset, limit: 100 });
    items.push(...(page.items ?? []));
    if (page.pagination?.hasMore !== true) return items;
    offset = page.pagination.nextOffset;
  }
}

/**
 * Answer what the app stops to ask the person, as the person at the page
 * would to let the work they asked for go on: a tool approval or any other
 * yes/no, "yes" (for the whole run, where the stop takes that); a review of a
 * coding run's changes, "accepted". Anything else (a question a run asks) is
 * left waiting, and named once.
 */
async function answerWaiting(fsd: Fsd, user: string, named: Set<string>, own: Set<string>): Promise<void> {
  for (const session of (await fsd.sessions.list({ userId: user, include: "dispatch-runs" }))) {
    const page = await fsd.sessions.state(session.id, { includeItems: true, itemTypes: ["suspension"], limit: 500 });
    for (const item of (page.items ?? []).filter((i): i is SuspensionItem => i.type === "suspension")) {
      if (item.suspensionStatus !== "pending" || !own.has(item.requestId) || named.has(item.suspensionId)) continue;
      const request = fsd.flow(String(session.flowId ?? session.flowKind)).request(item.requestId);
      const allow = item.allow ?? ["approve", "reject"];
      const answer =
        allow.includes("approve")
          ? { action: "approve" as const, ...((item.resumeSchema?.properties as Record<string, unknown> | undefined)?.scope === undefined ? {} : { data: { scope: "run" } }) }
          : allow.includes("submit") && item.resumeSchema !== undefined && JSON.stringify(item.resumeSchema).includes("accepted")
            ? { action: "submit" as const, data: { verdict: "accepted" } }
            : undefined;
      named.add(item.suspensionId);
      if (answer === undefined) {
        console.error(`  left waiting: ${item.reason ?? "a stop"} in ${session.id} (${item.suspensionId})`);
        continue;
      }
      await request.answer({ suspensionId: item.suspensionId, ...answer }).catch((error: unknown) => console.error(`  could not answer ${item.suspensionId}: ${String(error)}`));
    }
  }
}

/**
 * Wait until no request started at or after `since` in any of `user`'s
 * sessions has been open for `quietMs`, at most `budgetMs`, answering what
 * those requests stop to ask the person along the way ({@link answerWaiting}).
 * A request from before the ask (an app's seeded stop, an earlier ask's
 * leftover) is neither waited on nor answered.
 */
export async function untilQuiet(fsd: Fsd, user: string, budgetMs: number, quietMs = 20_000, since = 0): Promise<void> {
  const named = new Set<string>();
  for (let waited = 0, quiet = 0; waited < budgetMs && quiet < quietMs; waited += 2_000) {
    const all = await fsd.sessions.list({ userId: user, include: "dispatch-runs" });
    const open = new Set<string>();
    let waiting = 0;
    for (const { id } of all) {
      for (const request of await fsd.sessions.requests(id, { limit: 50 })) {
        // A request not started yet (queued) has no start time: it is this ask's.
        if ((request.startedAtMs ?? since) < since || ENDED.has(String(request.status))) continue;
        open.add(request.id);
        if (request.status === "suspended") waiting += 1;
      }
    }
    if (waiting > 0) await answerWaiting(fsd, user, named, open);
    quiet = open.size === 0 ? quiet + 2_000 : 0;
    await sleep(2_000);
  }
}

/** How many items each of the person's sessions holds, dispatch runs included. */
async function itemCounts(fsd: Fsd, user: string): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const { id } of (await fsd.sessions.list({ userId: user, include: "dispatch-runs" }))) {
    counts.set(id, (await itemsOf(fsd, id)).length);
  }
  return counts;
}

/**
 * Say `line` in the person's conversation with `worker` and wait for it to go
 * quiet. The turn is what came after this line: the reply is every assistant
 * message in that conversation joined; the tool calls are every one made
 * after the line in any of the person's sessions, since a worker that asks a
 * teammate, or a coordinator that routes the post, looks things up in
 * another session. An earlier ask's reply or calls never count for this one.
 */
export async function askWorker(
  fsd: Fsd,
  options: { user: string; worker: string; line: string; budgetMs?: number; quietMs?: number; sessionId?: string },
): Promise<Turn & { sessionId: string }> {
  const sessionId = options.sessionId ?? (await createWorkforceClient(fsd).ensureWorkerSession({ worker: options.worker })).id;
  const session = await fsd.sessions.get(sessionId);
  const before = await itemCounts(fsd, options.user);
  const askedAt = new Date();
  const sent = await fsd.flow(String(session.flowId ?? session.flowKind)).send("respond", { message: options.line }, { sessionId });
  await sent.wait();
  await untilQuiet(fsd, options.user, options.budgetMs ?? 8 * 60_000, options.quietMs, askedAt.getTime());
  const answeredAt = new Date();
  const own = turnOf((await itemsOf(fsd, sessionId)).slice(before.get(sessionId) ?? 0), askedAt, answeredAt);
  const elsewhere: OutputItem[] = [];
  for (const id of (await itemCounts(fsd, options.user)).keys()) {
    if (id !== sessionId) elsewhere.push(...(await itemsOf(fsd, id)).slice(before.get(id) ?? 0));
  }
  return { sessionId, ...own, tools: [...own.tools, ...turnOf(elsewhere, askedAt, answeredAt).tools] };
}

/**
 * The fold ask, on one conversation: the decision, then short turns until
 * the session's own record shows its earliest turns out of the history
 * window the server applies (`historyWindowOf`), and {@link FOLD_MARGIN}
 * more; then the question. The window is read, never assumed. At most
 * `GOAL_FOLD_TURNS_MAX` fillers (default 200); a window never seen leaves
 * the fold precondition failing. Whether a fold is in the session is read
 * before the question is asked.
 */
export async function askAfterFold(fsd: Fsd, options: { user: string; worker: string; d: Draw }): Promise<Turn> {
  const cap = Number(process.env.GOAL_FOLD_TURNS_MAX ?? 200);
  const reads: SessionReads = fsd;
  const opening = await askWorker(fsd, { user: options.user, worker: options.worker, line: options.d.fold.opening, quietMs: 4_000 });
  let sent = 0;
  let window: number | undefined;
  while (sent < cap && !foldFillersPassed(sent, window)) {
    sent += 1;
    await askWorker(fsd, { user: options.user, worker: options.worker, sessionId: opening.sessionId, line: options.d.fold.filler(sent), quietMs: 4_000 });
    window = await sessionWindow(reads, opening.sessionId);
  }
  console.error(`  fold: ${sent} fillers against a served window of ${window ?? "(none seen)"} turns`);
  const { folded } = await foldOf(reads, opening.sessionId);
  const last = await askWorker(fsd, { user: options.user, worker: options.worker, sessionId: opening.sessionId, line: options.d.lines.fold });
  return { ...last, folded };
}

/** Filler turns sent past the served window before the fold question, so the decision is well out of it and a fold has run. */
export const FOLD_MARGIN = 3;

/** Whether `sent` filler turns have gone past the served `window` (read off the record) by the margin. No window seen yet: not past. */
export function foldFillersPassed(sent: number, window: number | undefined): boolean {
  return window !== undefined && sent > window && sent >= window + FOLD_MARGIN;
}

/** A turn's items as a {@link Turn}: one request, the reply, and each tool call. */
export function turnOf(items: readonly OutputItem[], askedAt: Date, answeredAt: Date): Turn {
  const reply = items
    .filter((item): item is MessageItem => item.type === "message" && item.role === "assistant")
    .map((item) => item.content.map((part) => (part.type === "output_text" ? part.text : "")).join(""))
    .join("\n");
  const tools = items
    .filter((item): item is ToolOutputItem => item.type === "tool_output")
    .map((item) => ({
      name: item.blockName ?? item.toolCall.name,
      input: item.toolCall.arguments,
      output: typeof item.output === "string" ? item.output : JSON.stringify(item.output ?? null),
      ok: item.status !== "failed" && item.error == null,
    }));
  return { reply, tools, requests: 1, askedAt, answeredAt };
}

/**
 * The checks the latest coding run recorded, read off the app's SQLite store
 * after the run: harness-manager's run record (`runs/**`, which no client
 * route reads by design), normalized by {@link checksFrom}. `null` when no
 * run recorded any.
 */
export function runChecks(dbFile: string): Turn["checks"] {
  if (!existsSync(dbFile)) return null;
  const db = new DatabaseSync(dbFile, { readOnly: true });
  try {
    const rows = db.prepare("SELECT state FROM resource_state WHERE resource_key LIKE 'runs/%'").all() as { state: string }[];
    // Each row through harness-manager's own run-record schema: a row that is not one fails loudly.
    const records = rows
      .map((row) => runRecordStateSchema.parse(JSON.parse(row.state)))
      .filter((record) => record.checks !== null)
      .sort((a, b) => (a.updatedAt ?? 0) - (b.updatedAt ?? 0));
    return records.length === 0 ? null : checksFrom(records.at(-1)!.checks);
  } finally {
    db.close();
  }
}

/**
 * The checks a harness session's turn recorded (harness-manager's
 * `harnessSessionFlow` with `verify`, which Kitchen Sink's coding modes run),
 * normalized by {@link checksFrom}. Kitchen Sink keeps checks on the turn, not
 * on a run. The state route serves the session's exposed state (`turns`
 * among it) under `clientData.session`, read through harness-manager's own
 * schema, so a change to either shape fails here, not as a silent `null`.
 */
export async function turnChecks(fsd: Fsd, sessionId: string, requestId: string): Promise<Turn["checks"]> {
  return turnChecksOf(await fsd.sessions.state(sessionId), requestId);
}

/** {@link turnChecks} over a snapshot already read. */
export function turnChecksOf(snapshot: SessionStateSnapshotResponse, requestId: string): Turn["checks"] {
  const state = harnessSessionStateSchema.pick({ turns: true }).safeParse(snapshot.clientData.session ?? {});
  if (!state.success) throw new Error(`setup: the session's state is not a harness session's: ${state.error.message}`);
  return checksFrom(state.data.turns?.[requestId]?.checks);
}

/** A git repository at `dir` holding `files`, committed once on `main`: a project's repository or a working folder. */
export function gitRepository(dir: string, files: Record<string, string>): string {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  const git = (...args: string[]) => execFileSync("git", ["-C", dir, "-c", "user.name=goal", "-c", "user.email=goal@example.com", ...args]);
  execFileSync("git", ["init", "-q", "-b", "main", dir]);
  git("add", "-A");
  git("commit", "-q", "-m", "start");
  return dir;
}

/** Run one action and hand back its output, or throw why it failed. */
export async function act(fsd: Fsd, flow: string, sessionId: string, action: string, input: unknown): Promise<unknown> {
  const sent = await fsd.flow(flow).send(action, input, { sessionId });
  const { status } = await sent.wait();
  const found = (await fsd.sessions.requests(sessionId, { includeResultOutput: true, limit: 50 })).find((r) => r.id === sent.id);
  if (status !== "completed") throw new Error(`setup: ${action} ended ${status}: ${found?.result?.error?.message ?? ""}`);
  return found?.result?.output;
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

/** How one app records each ask's turn for one run. A missing ask is one the app does not run on this pass. */
export type AppAsks = Partial<Record<Ask, (d: Draw) => Promise<Turn>>>;

/**
 * One app, served for one run: its asks. Its server is stopped by the run's
 * own cleanup ({@link planted}), whatever ends the run, so a driver holds no stop.
 */
export interface AppRun {
  asks: AppAsks;
}

/** An app's script: what it plants for a run, and how it serves the app and records each ask. */
export interface AppDriver {
  app: App;
  /** Files (absolute path → text) to plant for one run, before the app starts. */
  plant: (d: Draw, p: ClosurePass, scratch: string) => Record<string, string>;
  /** Serve the app for one run (fresh store under `scratch`) and hand back its asks. */
  start: (d: Draw, p: ClosurePass, scratch: string) => Promise<AppRun>;
  /**
   * The tool the asked worker fetches a published page with, by its recorded
   * name. Set, the multi-file ask is the published-docs one, and a page counts
   * as read only through a call of this tool (`gradePagesRead`).
   */
  pageFetchTool?: string;
}

const GRADE: Record<Ask, (turn: Turn, d: Draw, driver: AppDriver) => Graded> = {
  date: (turn) => gradeDate(turn),
  multiFile: (turn, d, driver) =>
    driver.pageFetchTool === undefined ? gradeMultiFile(turn, d.fixtures.multiFile) : gradePagesRead(turn, d.fixtures.pages, driver.pageFetchTool),
  coder: (turn) => gradeCoder(turn),
  knowledge: (turn, d) => gradeKnowledge(turn, d.fixtures.knowledge),
  sizing: (turn, d) => gradeSizing(turn, d.fixtures.sizing),
  skill: (turn, d) => gradeSkill(turn, d.fixtures.skill),
  fold: (turn, d) => gradeFold(turn, d.fixtures.fold),
};

/** The asks this run grades: the ones `driver.app` counts in on this pass, narrowed by `GOAL_ASKS` (comma-separated). */
function asksFor(app: App, pass: Pass): Ask[] {
  const only = (process.env.GOAL_ASKS ?? "").split(",").filter(Boolean);
  return ASKS.filter(
    (ask) => cellsFor(pass, ask).includes(app) && (only.length === 0 || only.includes(ask)),
  );
}

/** Where each pass's sheets are kept between the four scripts and `verdict/run.mts`: `GOAL_SHEETS`, or one folder under the system's temp. */
const SHEETS = process.env.GOAL_SHEETS ?? join(tmpdir(), "fsd-goal-closure-sheets");

/** One app's sheet for a pass, as written: each ask's results, and the commit and models they ran on. */
export interface SheetFile {
  app: App;
  pass: Pass;
  tree: string;
  at: string;
  commits?: Partial<Record<Ask, string>>;
  models?: Partial<Record<Ask, ClosureModel>>;
  sheet?: Sheet;
}

/** The pass's sheet file for one app: the verdict script reads the four together. */
export function sheetFile(pass: Pass, app: App): string {
  mkdirSync(join(SHEETS, pass), { recursive: true });
  return join(SHEETS, pass, `${app}.json`);
}

/**
 * Run `driver` for `GOAL_RUNS` runs (default 3): each run a fresh draw, its
 * files planted, the app served on a fresh store, every ask it counts in
 * recorded and graded. Each failure is tagged `<ask> · run <n>`. The sheet is
 * written for `verdict/run.mts`; the verdict line is this app's alone.
 */
export async function runClosure(driver: AppDriver): Promise<void> {
  const p = closurePass();
  const runs = Number(process.env.GOAL_RUNS ?? RUNS);
  const asks = asksFor(driver.app, p.pass);
  console.error(`closure · ${driver.app} · ${p.pass} pass · ${p.describe} · models ${p.model} · asks ${asks.join(", ")} · ${runs} run(s)`);
  await runGoal(async (failures, tell) => {
    const sheet: Sheet = {};
    const notes: string[] = [];
    for (let n = 1; n <= runs; n += 1) {
      const d = draw();
      const scratch = goalTmpDir(`closure-${driver.app}-${p.pass}-${n}`);
      await planted(driver.app, () => driver.plant(d, p, scratch), async () => {
        // Its server is stopped by `planted`, however this ends.
        const run = await driver.start(d, p, scratch);
        for (const ask of asks) {
          const record = run.asks[ask];
          if (record === undefined) throw new Error(`setup: ${driver.app} has no driver for the ${ask} ask`);
          const turn = await record(d);
          const graded = GRADE[ask](turn, d, driver);
          ((sheet[ask] ??= {})[driver.app] ??= []).push(graded);
          for (const line of graded) failures.push(`${ask} · run ${n} · ${line}`);
          notes.push(`${ask} run ${n}: ${graded.length === 0 ? "pass" : "FAIL"}`);
          console.error(`[${driver.app} ${ask} run ${n}] ${graded.length === 0 ? "pass" : graded.join("; ")}\n  reply: ${JSON.stringify(turn.reply.slice(0, 400))}\n  tools: ${turn.tools.map((t) => t.name).join(", ")}`);
        }
      });
    }
    tell.over("asks graded", asks.flatMap((ask) => sheet[ask]?.[driver.app] ?? []));
    // A run of a subset (`GOAL_ASKS`) replaces only the asks it graded in the pass's sheet.
    // Each ask's results are stamped with the commit and models they ran on;
    // an earlier result is kept only when it ran on this run's commit and
    // models, so a sheet never carries another tree's or model's results
    // under this run's name.
    const file = sheetFile(p.pass, driver.app);
    const before = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as SheetFile) : undefined;
    const kept: Sheet = {};
    const commits: Partial<Record<Ask, string>> = {};
    const models: Partial<Record<Ask, ClosureModel>> = {};
    for (const ask of ASKS) {
      if (before?.sheet?.[ask] !== undefined && before.commits?.[ask] === p.commit && before.models?.[ask] === p.model) {
        kept[ask] = before.sheet[ask];
        commits[ask] = p.commit;
        models[ask] = p.model;
      }
    }
    for (const ask of asks) {
      commits[ask] = p.commit;
      models[ask] = p.model;
    }
    const written: SheetFile = { app: driver.app, pass: p.pass, tree: p.describe, at: new Date().toISOString(), commits, models, sheet: { ...kept, ...sheet } };
    writeFileSync(file, JSON.stringify(written, null, 2));
    const cells = asks.map((ask) => `${ask} ${(sheet[ask]?.[driver.app] ?? []).filter((r) => r.length === 0).length}/${runs}`);
    return { failures, evidence: `${driver.app}, ${p.pass} pass on ${p.describe}, models ${p.model}: ${cells.join(", ")} (sheet ${sheetFile(p.pass, driver.app)})` };
  });
}
