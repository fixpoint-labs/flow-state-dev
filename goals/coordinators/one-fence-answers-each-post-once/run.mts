/**
 * Goal check: a coordinator's post to each delegate is one row on the
 * conversation's board, and the board alone decides that an answer counts.
 * However often its ending is replayed, an answer lands one line; a post handed
 * to the same delegate twice is one row; a cancelled post's late answer lands
 * nothing; a failed delegate's round closes at once and a late one's at its
 * deadline (FIX-1872). See goal.md.
 *
 * `host.mts` runs the scenario as its own process, on the real engine over a
 * SQLite file, with scripted delegates and a scripted judgment turn; this
 * grades what it reports and the file it leaves.
 *
 * Run:      pnpm tsx goals/coordinators/one-fence-answers-each-post-once/run.mts
 * Control:  GOAL_CONTROL=no-ending-dedupe (must FAIL b:one-line)
 * Before:   GOAL_COMMIT=<sha> serves that commit, from its own tree and install
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { REPO_ROOT, RUN_STAMP, goalTmpDir, intentFreeEnv, runGoal } from "../../lib/index.mts";
import { assertPatched, describePatches, modulePatchEnv, type ModulePatch } from "../../lib/module-patch.mts";
import { postDeliveries, type PostDelivery } from "../../lib/post-rows.mts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const SCRATCH = goalTmpDir("coordinators-one-fence");
const say = (s: string) => console.error(`[one-fence ${new Date().toISOString().slice(11, 19)}] ${s}`);
const SETTLED = "packages/workforce/src/conversation-board/task-settled.ts";

/** The controls: each a scratch patch, and the assertion it must redden. */
const CONTROLS: Record<string, { does: string; assertion: string; patches: ModulePatch[] }> = {
  "no-ending-dedupe": {
    does: "the conversation acts on every copy of a row's ending: neither the row's owed marker nor the conversation's record of endings it has acted on stops a second copy",
    assertion: "b:one-line",
    patches: [
      { module: SETTLED, from: "if \\(row === undefined \\|\\| !isNoticeOwed\\(row, notice\\)\\) \\{", to: "if (row === undefined) {" },
      { module: SETTLED, from: "if \\(seen\\.includes\\(key\\)\\) return", to: "if (false) return" },
    ],
  },
};
const controlName = process.env.GOAL_CONTROL ?? "";
if (controlName !== "" && CONTROLS[controlName] === undefined) {
  console.error(`unknown GOAL_CONTROL "${controlName}"; known: ${Object.keys(CONTROLS).join(", ")}`);
  process.exit(2);
}
const control = controlName === "" ? undefined : { name: controlName, ...CONTROLS[controlName]! };

/** The tree a run serves: this checkout, or another commit's own tree and install. */
function checkoutFor(commit: string | undefined): { root: string; describe: string } {
  const git = (...args: string[]) => execFileSync("git", ["-C", REPO_ROOT, ...args], { encoding: "utf8" }).trim();
  if (commit === undefined || commit === "") {
    const head = git("rev-parse", "HEAD");
    const dirty = git("status", "--porcelain", "--", ".", ":(exclude)goals").length > 0;
    return { root: REPO_ROOT, describe: `this checkout, \`${head.slice(0, 9)}\`${dirty ? " with uncommitted changes outside goals/" : ""}` };
  }
  const sha = git("rev-parse", `${commit}^{commit}`);
  // Kept across runs: a commit's tree and install don't change.
  const root = join(tmpdir(), "fsd-goal-coordinators-trees", sha.slice(0, 12));
  if (!existsSync(join(root, "package.json"))) {
    mkdirSync(root, { recursive: true });
    execFileSync("sh", ["-c", `git -C "${REPO_ROOT}" archive --format=tar ${sha} | tar -x -C "${root}"`]);
  }
  if (!existsSync(join(root, "node_modules"))) {
    say(`installing ${sha.slice(0, 9)} in ${root}`);
    const installed = spawnSync("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], { cwd: root, encoding: "utf8", timeout: 900_000 });
    if (installed.status !== 0) throw new Error(`setup: ${sha} did not install: ${(installed.stdout + installed.stderr).slice(-1500)}`);
  }
  return { root, describe: `\`${sha.slice(0, 9)}\` (GOAL_COMMIT=${commit}), its own tree and install` };
}

/** Run the host in `root`'s goals, with `env`, and read its one `__GOAL__` line. */
async function runHost(root: string, env: Record<string, string>): Promise<any> {
  let dir = HERE;
  if (root !== REPO_ROOT) {
    dir = join(root, "goals", relative(join(REPO_ROOT, "goals"), HERE));
    mkdirSync(dir, { recursive: true });
    cpSync(join(HERE, "host.mts"), join(dir, "host.mts"));
  }
  const child = spawn(join(root, "node_modules", ".bin", "tsx"), [join(dir, "host.mts")], {
    cwd: dir,
    env: intentFreeEnv(process.env, { GOAL_CONTROL: "", ...env }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => (out += String(d)));
  child.stderr.on("data", (d) => (err += String(d)));
  const code = await new Promise<number | null>((resolve) => child.on("exit", resolve));
  const line = out.split("\n").find((l) => l.startsWith("__GOAL__"));
  if (line === undefined) return { setup: `the host printed no result (exit ${code}): ${(err || out).slice(-1500)}` };
  return JSON.parse(line.slice("__GOAL__".length));
}

/** A conversation's stored session state, read from the file, as the user who owns it. */
function storedState(file: string, userId: string, sessionId: string): Record<string, unknown> | undefined {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const row = db.prepare("SELECT data FROM sessions WHERE id = ? AND user_id = ?").get(sessionId, userId) as { data: string } | undefined;
    return row === undefined ? undefined : ((JSON.parse(row.data) as { state?: Record<string, unknown> }).state ?? {});
  } finally {
    db.close();
  }
}

type Line = { role: string | null; agentName: string | null; text: string };
type Route = { by?: string; round?: number; postId?: string; delegates?: Array<{ worker: string; outcome: string; reason?: string }> };

/** Grade what the host reported and the file it left. */
function grade(o: any): { failures: string[]; notes: string[] } {
  const failures: string[] = [];
  const notes: string[] = [];
  const fail = (assertion: string, why: string) => failures.push(`${assertion} — ${why}`);
  if (o.setup !== undefined) {
    fail("setup", o.setup);
    return { failures, notes };
  }
  const show = (v: unknown) => JSON.stringify(v)?.slice(0, 400);
  const { first, second, third } = o.roles as { first: string; second: string; third: string };
  const rows = (sessionId: string): PostDelivery[] => postDeliveries(o.store, o.userId, sessionId);
  const linesBy = (lines: Line[], worker: string, word: string) => lines.filter((l) => l.agentName === worker && l.text.includes(word));
  const routesFor = (records: Route[], postId: string) => records.filter((r) => r.postId === postId);

  // ---- b: one row per delegate, and no ledger -----------------------------
  const all = o.b.all;
  const allRows = rows(all.sessionId).filter((r) => r.postId === all.post.requestId);
  const assignees = allRows.map((r) => r.delegate.worker).sort();
  if (assignees.join(",") !== [...o.delegates].sort().join(",") || !allRows.every((r) => r.status === "delivered" && r.answered)) {
    fail("b:rows", `wanted one answered post row per delegate (${o.delegates.join(", ")}) on the board; it holds ${show(allRows.map((r) => [r.delegate.worker, r.rowStatus, r.status]))}`);
  } else notes.push(`one post to everyone: ${allRows.length} rows, one per delegate, each worked in its session and answered`);
  for (const [name, c] of Object.entries({ all: o.b.all, judge: o.b.judge, fails: o.d.fails, late: o.d.late }) as Array<[string, { sessionId: string }]>) {
    const state = storedState(o.store, o.userId, c.sessionId);
    if (state === undefined) fail("b:no-ledger", `desk.${name}'s conversation has no stored record of Alice's`);
    else if (Object.hasOwn(state, "deliveries")) fail("b:no-ledger", `desk.${name}'s conversation holds a delivery ledger: ${show(state.deliveries)}`);
  }

  // ---- b: touched while the endings were owed, one line per answer --------
  if (all.firstEnded !== true) fail("b:one-line", "the host never saw a row end, so the board was never touched while endings were owed");
  const refused = (all.touches as Array<{ status: string }>).filter((t) => t.status !== "completed");
  if (refused.length > 0) fail("b:one-line", `${refused.length} of ${all.touches.length} board touches did not complete: ${show(refused)}`);
  const perDelegate = Object.fromEntries((o.delegates as string[]).map((w) => [w, linesBy(o.read.all.lines, w, o.words.rows).length]));
  if (!Object.values(perDelegate).every((n) => n === 1)) {
    fail("b:one-line", `wanted one line per delegate's answer after ${all.touches.length} touches; lines per delegate ${show(perDelegate)}`);
  } else if (!failures.some((f) => f.startsWith("b:one-line"))) notes.push(`${all.touches.length} touches as the endings came in: one line per delegate`);

  // ---- b: the same post handed to one delegate twice ----------------------
  const judge = o.b.judge;
  const twiceRows = rows(judge.sessionId).filter((r) => r.postId === judge.twice.requestId);
  const twiceRoutes = routesFor(o.read.judge.records, judge.twice.requestId);
  const outcomes = twiceRoutes.flatMap((r) => (r.delegates ?? []).filter((d) => d.worker === first).map((d) => d.outcome));
  const twiceLines = linesBy(o.read.judge.lines, first, o.words.twice).length;
  if (twiceRows.length !== 1 || outcomes.join(",") !== "delivered,skipped" || twiceLines !== 1) {
    fail("b:skipped", `handed ${first} the post twice; wanted one row, a record of delivered then skipped, and one line; rows ${twiceRows.length}, outcomes ${show(outcomes)}, lines ${twiceLines}`);
  } else notes.push(`handed one delegate the post twice: one row, delivered then skipped, one line`);

  // ---- b: a settle after a cancel is refused ------------------------------
  const cancel = judge.cancel;
  const cancelRow = rows(judge.sessionId).find((r) => r.taskId === cancel.working);
  const cancelLines = linesBy(o.read.judge.lines, first, o.words.cancel).length;
  if (cancel.working === null || cancel.cancelled?.status !== "completed") {
    fail("b:stale-settle", `the post's row was never cancelled while ${first} worked it: working ${show(cancel.working)}, cancel ${show(cancel.cancelled)}`);
  } else if (cancelRow?.rowStatus !== "cancelled" || cancelLines !== 0) {
    fail("b:stale-settle", `cancelled while ${first} held its answer ${o.slowMs} ms; wanted the row still cancelled and no line once it finished; row ${show(cancelRow?.rowStatus)}, lines ${cancelLines}`);
  } else notes.push(`cancelled mid-turn: the row stayed cancelled and ${first}'s late answer landed nothing`);

  // ---- d: a failed delegate -----------------------------------------------
  const fails = o.d.fails;
  const failsRows = rows(fails.sessionId).filter((r) => r.postId === fails.post.requestId && r.round === 0);
  const failedRow = failsRows.find((r) => r.delegate.worker === third);
  const failedLines = linesBy(o.read.fails.lines, third, o.words.fails).length;
  if (failedRow?.rowStatus !== "errored" || failedLines !== 0) {
    fail("d:failed", `${third} fails the post; wanted its row errored and no line by it; row ${show(failedRow?.rowStatus)}, lines ${failedLines}`);
  }
  if (fails.closedAt === null || fails.deadlineAt === null || fails.closedAt >= fails.deadlineAt) {
    fail("d:failed", `wanted round 0 closed as soon as both delegates had ended, before its deadline; closed at ${show(fails.closedAt)}, deadline ${show(fails.deadlineAt)}`);
  } else notes.push(`a failed delegate: no line, and round 0 closed ${fails.deadlineAt - fails.closedAt} ms before its deadline`);

  // ---- d: a late delegate -------------------------------------------------
  const late = o.d.late;
  const atDeadline = late.atDeadline as { openRounds: Array<{ postId: string; round: number }>; lateRowStatus: string | null };
  const stillOpen = atDeadline.openRounds.some((r) => r.postId === late.post.requestId && r.round === 0);
  if (late.deadlineAt === null || stillOpen || atDeadline.lateRowStatus !== "in_progress") {
    fail("d:late", `wanted round 0 closed at its deadline while ${second} still worked; deadline ${show(late.deadlineAt)}, open then ${show(atDeadline.openRounds)}, ${second}'s row then ${show(atDeadline.lateRowStatus)}`);
  }
  // Its answer to the person's post, not to the other delegate's answer in round 1.
  const answeredPost = `${second} answers: ${o.userId}, through desk.late:`;
  const lateLines = linesBy(o.read.late.lines, second, o.words.late).filter((l) => l.text.startsWith(answeredPost)).length;
  const round1 = rows(late.sessionId).filter((r) => r.postId === late.post.requestId && r.round === 1).map((r) => r.delegate.worker);
  if (lateLines !== 1 || round1.join(",") !== second) {
    fail("d:late", `wanted ${second}'s late answer landed once and handed to nobody in round 1; its lines ${lateLines}, round 1's rows to ${show(round1)} (want only ${second}, with ${first}'s answer)`);
  } else if (!failures.some((f) => f.startsWith("d:late"))) notes.push(`a late delegate: round 0 closed at its deadline, its answer landed once and went no further`);

  return { failures, notes };
}

await runGoal(async () => {
  const checkout = checkoutFor(process.env.GOAL_COMMIT);
  mkdirSync(SCRATCH, { recursive: true });
  const mark = join(SCRATCH, `patch-mark-${RUN_STAMP}`);
  rmSync(mark, { force: true });
  const env = control === undefined ? {} : modulePatchEnv(control.patches, checkout.root, mark);
  say(`serving ${checkout.describe}${control === undefined ? "" : `; control ${control.name}`}`);
  if (control !== undefined) say(`control ${control.name}: ${control.does}\n${describePatches(control.patches, checkout.root)}`);

  const reported = await runHost(checkout.root, env);
  if (control !== undefined) {
    assertPatched(control.patches, checkout.root, mark);
    say(`control ${control.name}: the patch reached ${control.patches[0]!.module}`);
  }
  const { failures, notes } = grade(reported);
  for (const note of notes) say(note);
  if (typeof reported.store === "string") rmSync(dirname(reported.store), { recursive: true, force: true });
  for (const leg of ["b", "d"]) {
    const red = [...new Set(failures.filter((f) => f.startsWith(`${leg}:`)).map((f) => f.split(" — ")[0]))];
    say(`leg ${leg}: ${red.length === 0 ? "PASS" : `FAIL (${red.join(", ")})`}`);
  }
  if (control !== undefined) {
    const named = failures.some((f) => f.startsWith(`${control.assertion} `));
    failures.unshift(
      named
        ? `control ${control.name}: failed on ${control.assertion}, as it must`
        : `control ${control.name}: did NOT fail on ${control.assertion}, so the check can't see what the control removes`,
    );
  }
  return { failures, evidence: `legs b, d PASS on ${checkout.describe}; ${notes.join("; ")}` };
});
