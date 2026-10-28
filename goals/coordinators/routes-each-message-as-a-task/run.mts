/**
 * Goal check: a coordinator hands each message to each delegate by filing a
 * routed task, an ordinary task in Alice's list whose result goes to the
 * conversation, and nothing writes or works a post (FIX-2083). See goal.md.
 *
 * `host.mts` runs the scenario as its own process, on the real engine over a
 * SQLite file with durable execution, with scripted delegates and scripted
 * model turns; this grades what it reports and the file it leaves. Leg b's
 * restart runs the host twice on one store: once until a round is waiting on
 * a delegate past its deadline, killed there, and once more.
 *
 * Run:      pnpm tsx goals/coordinators/routes-each-message-as-a-task/run.mts
 * Controls: GOAL_CONTROL=round-timer   (must FAIL b:restart)
 *           GOAL_CONTROL=post-map-off  (must FAIL e:legacy)
 * Before:   GOAL_COMMIT=<sha> serves that commit, from its own tree and install
 *           (`main` before FIX-2083 must FAIL c:after and the sweep; `main`
 *           before its one fit check must FAIL d:lead-refused and d:one-check)
 */
import { onClosed } from "../../lib/server.mts";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { REPO_ROOT, RUN_STAMP, goalTmpDir, intentFreeEnv, runGoal } from "../../lib/index.mts";
import { assertPatched, describePatches, modulePatchEnv, type ModulePatch } from "../../lib/module-patch.mts";
import { routedDeliveries, type RoutedDelivery } from "../../lib/routed-tasks.mts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const SCRATCH = goalTmpDir("coordinators-routes-each-message");
const say = (s: string) => console.error(`[routed-tasks ${new Date().toISOString().slice(11, 19)}] ${s}`);
const COORDINATOR = "packages/workforce/src/coordinator/coordinator-flow.ts";
const RETIRED = "packages/orchestration/src/tasks/schema/retired-shapes.ts";
/** How far past the later of its deadline and the restart a round may close. */
const CLOSE_WITHIN_MS = 2_000;

/** The controls: each a scratch patch, and the assertion it must redden. */
const CONTROLS: Record<string, { does: string; assertion: string; patches: ModulePatch[] }> = {
  "round-timer": {
    does: "a round's deadline is kept on an in-process timer, as before FIX-2083, never a wake: the coordinator reads the host as keeping no wakes",
    assertion: "b:restart",
    patches: [{ module: COORDINATOR, from: "const wakes = ctx\\.requestHost\\?\\.wakes;", to: "const wakes = undefined;" }],
  },
  "post-map-off": {
    does: "FIX-2080's map entry `post` reads nothing: a post row stored before the upgrade is read as the row it is",
    assertion: "e:legacy",
    patches: [{ module: RETIRED, from: 'if \\(!isObject\\(row\\.sealed\\) \\|\\| row\\.sealed\\.kind !== "post"\\) return undefined;', to: "return undefined;" }],
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

/**
 * Run the host in `root`'s goals with `env`, and read its one `__GOAL__` line.
 * With `kill`, the host is killed (SIGKILL) as soon as it reports, as a host
 * that dies does: nothing it holds in memory survives. The signal goes to the
 * host's whole process group, since `tsx` runs the script in a child process
 * of its own.
 */
async function runHost(root: string, env: Record<string, string>, kill = false): Promise<any> {
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
    // Its own process group, so a kill reaches the process `tsx` starts too.
    detached: kill,
  });
  let out = "";
  let err = "";
  let reported: string | undefined;
  child.stdout.on("data", (d) => {
    out += String(d);
    if (reported === undefined) {
      reported = out.split("\n").find((l) => l.startsWith("__GOAL__") && out.includes(`${l}\n`));
      if (reported !== undefined && kill) process.kill(-child.pid!, "SIGKILL");
    }
  });
  child.stderr.on("data", (d) => (err += String(d)));
  const code = await new Promise<number | null>((resolve) => onClosed(child, resolve));
  reported ??= out.split("\n").find((l) => l.startsWith("__GOAL__"));
  if (reported === undefined) return { setup: `the host printed no result (exit ${code}): ${(err || out).slice(-1500)}` };
  return JSON.parse(reported.slice("__GOAL__".length));
}

/** Every task row `userId` owns in the file, across every board. */
function allRows(file: string, userId: string): Array<Record<string, any>> {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    return (
      db.prepare("SELECT state FROM resource_state WHERE scope_type = 'user' AND scope_id LIKE ? AND resource_key LIKE 'tasks/%' AND lifecycle = 'live'").all(`${userId}:%`) as Array<{ state: string }>
    ).map((row) => JSON.parse(row.state) as Record<string, any>);
  } finally {
    db.close();
  }
}

type Line = { role: string | null; agentName: string | null; text: string };
type Route = { by?: string; round?: number; messageRequestId?: string; delegates?: Array<{ worker: string; outcome: string; reason?: string }> };
type Heard = { worker: string; message: string; sessionId: string; at: number };

/** Grade what the host reported and the file it left. */
function grade(o: any, restart: { kill: any; restart: any }): { failures: string[]; notes: string[] } {
  const failures: string[] = [];
  const notes: string[] = [];
  const fail = (assertion: string, why: string) => failures.push(`${assertion} — ${why}`);
  if (o.setup !== undefined) {
    fail("setup", o.setup);
    return { failures, notes };
  }
  const show = (v: unknown) => JSON.stringify(v)?.slice(0, 400);
  const { first, second, third, fourth } = o.roles as Record<string, string>;
  const w = o.words as Record<string, string>;
  const heard = o.heard as Heard[];
  const rows = (sessionId: string): RoutedDelivery[] => routedDeliveries(o.store, o.userId, sessionId);
  const stored = allRows(o.store, o.userId);
  const linesBy = (lines: Line[], worker: string, word: string) => lines.filter((l) => l.agentName === worker && l.text.includes(word));
  const routesFor = (records: Route[], messageRequestId: string) => records.filter((r) => r.messageRequestId === messageRequestId);

  // ---- a: one task per delegate, ordinary, in Alice's list ----------------
  const all = o.a.all;
  const listed = (all.listed as Array<{ id: string; assignee?: string; status: string }>).filter((t) => all.reads.some((r: any) => r.id === t.id));
  const reads = all.reads as Array<Record<string, any>>;
  const forPost = reads.filter((t) => typeof t.id === "string" && t.id.includes(all.post.requestId));
  const assignees = forPost.map((t) => t.assignee).sort();
  const settingsOff = forPost.filter((t) => t.session !== "ongoing" || t.resultTo !== "conversation" || t.maxAttempts !== 1);
  if (assignees.join(",") !== [...o.delegates].sort().join(",") || settingsOff.length > 0 || listed.length !== o.delegates.length) {
    fail("a:tasks", `wanted Alice's list to hold one task per delegate (${o.delegates.join(", ")}), each read with session "ongoing", result to the conversation and one attempt; listed ${listed.length}, read ${show(forPost.map((t) => [t.assignee, t.session, t.resultTo, t.maxAttempts]))}`);
  } else notes.push(`one message to everyone: ${forPost.length} tasks in Alice's list, one per delegate, each session ongoing, result to the conversation, one attempt`);
  const allRowsHere = rows(all.sessionId).filter((r) => r.messageRequestId === all.post.requestId);
  if (!allRowsHere.every((r) => r.status === "delivered" && r.answered) || allRowsHere.length !== o.delegates.length) {
    fail("a:tasks", `wanted each task worked in its delegate's session and answered; the board holds ${show(allRowsHere.map((r) => [r.delegate.worker, r.rowStatus, r.status]))}`);
  }

  // ---- a: touched while the endings were owed, one line per answer --------
  if (all.firstEnded !== true) fail("a:once", "the host never saw a task end, so the board was never touched while endings were owed");
  const refused = (all.touches as Array<{ status: string }>).filter((t) => t.status !== "completed");
  if (refused.length > 0) fail("a:once", `${refused.length} of ${all.touches.length} board touches did not complete: ${show(refused)}`);
  const perDelegate = Object.fromEntries((o.delegates as string[]).map((d) => [d, linesBy(o.read.all.lines, d, w.rows).length]));
  if (!Object.values(perDelegate).every((n) => n === 1)) {
    fail("a:once", `wanted one line per delegate's answer, under its name, after ${all.touches.length} touches; lines per delegate ${show(perDelegate)}`);
  } else if (!failures.some((f) => f.startsWith("a:once"))) notes.push(`${all.touches.length} touches as the endings came in: one line per delegate, under its name`);

  // ---- a: the judgment turn's filing ---------------------------------------
  const judge = o.a.judge;
  const judged = (judge.reads as Array<Record<string, any>>)[0];
  if (judged === undefined || judged.session !== "ongoing" || judged.resultTo !== "conversation" || judged.maxAttempts !== 1) {
    fail("a:judgment-attempts", `the judgment turn filed with createTask and left maxAttempts out; wanted its task read with session "ongoing", result to the conversation and one attempt; read ${show(judged)}`);
  } else notes.push(`the judgment turn's createTask with no maxAttempts: read with one attempt, session ongoing, result to the conversation`);
  const threeRefusal = (o.read.judge.tools as Array<{ name: string; output: any }>).find((t) => JSON.stringify(t.output ?? "").includes("conversation_result_one_attempt"));
  const threeRows = rows(judge.sessionId).filter((r) => r.messageRequestId === judge.three.requestId);
  if (threeRefusal === undefined || threeRows.length !== 0) {
    fail("a:three-refused", `wanted the judgment turn's maxAttempts: 3 refused at filing, naming FIX-2080's rule (conversation_result_one_attempt), and nothing filed; tool outputs ${show(o.read.judge.tools)}, tasks for it ${threeRows.length}`);
  } else notes.push(`maxAttempts: 3 refused at filing: ${show(threeRefusal.output).slice(0, 160)}`);
  const twiceRows = rows(judge.sessionId).filter((r) => r.messageRequestId === judge.twice.requestId);
  const outcomes = routesFor(o.read.judge.records, judge.twice.requestId).flatMap((r) => (r.delegates ?? []).filter((d) => d.worker === first).map((d) => d.outcome));
  const twiceLines = linesBy(o.read.judge.lines, first, w.twice).length;
  if (twiceRows.length !== 1 || outcomes.join(",") !== "delivered,skipped" || twiceLines !== 1) {
    fail("a:twice", `the judgment turn filed one message for ${first} twice; wanted one task, a record of delivered then skipped, and one line; tasks ${twiceRows.length}, outcomes ${show(outcomes)}, lines ${twiceLines}`);
  } else notes.push(`one message filed for one delegate twice: one task, delivered then skipped, one line`);

  // ---- a: a busy delegate --------------------------------------------------
  const one = o.a.one;
  const busy = heard.filter((h) => h.worker === third && h.message.includes(w.busy));
  const [ha, hb] = [busy.find((h) => h.message.endsWith(`${w.busy} first`)), busy.find((h) => h.message.endsWith(`${w.busy} second`))];
  const listedB = (one.listedWaiting as Array<{ id: string; status: string }>).find((t) => t.id.includes(one.b.requestId));
  if (one.waiting?.b !== "pending" || listedB?.status !== "pending" || ha === undefined || hb === undefined || hb.at < ha.at + o.slowMs * 0.9 || hb.sessionId !== ha.sessionId) {
    fail("a:waits", `a second message to ${third}, busy on the first for ${o.slowMs} ms, should wait pending in Alice's list and start after the first ends, in the same session; waiting ${show(one.waiting)}, listed ${show(listedB)}, heard ${show(busy.map((h) => [h.message.slice(-14), h.sessionId.slice(-6), h.at - (ha?.at ?? 0)]))}`);
  } else notes.push(`a busy delegate: the second message waited pending in Alice's list and started ${hb.at - ha.at} ms after the first, in the same session`);
  const cRow = rows(one.sessionId).find((r) => r.messageRequestId === one.c.requestId);
  const cHeard = busy.some((h) => h.message.endsWith(`${w.busy} third`));
  if (one.cancelWaiting?.status !== "completed" || cRow?.rowStatus !== "cancelled" || cHeard) {
    fail("a:cancel-waiting", `Alice cancelled the waiting third message's task; wanted it cancelled and never started; cancel ${show(one.cancelWaiting)}, task ${show(cRow?.rowStatus)}, heard ${cHeard}`);
  } else notes.push(`the waiting task, cancelled: ended cancelled, never started`);

  // ---- a: a cancel while working --------------------------------------------
  const rnd = o.a.rounds;
  const hungRow = rows(rnd.sessionId).find((r) => r.taskId === rnd.hung);
  // Its answer to the person's message: in round 1 it is handed the other delegate's answer, which carries the word too.
  const hungLines = linesBy(o.read.rounds.lines, first, w.cancel).filter((l) => l.text.startsWith(`${first} answers: ${o.userId}, through desk.rounds:`)).length;
  if (rnd.hung === null || rnd.cancelled?.status !== "completed" || hungRow?.rowStatus !== "cancelled" || hungLines !== 0) {
    fail("a:cancel", `Alice cancelled ${first}'s task while it worked; wanted it cancelled and no line by it; cancel ${show(rnd.cancelled)}, task ${show(hungRow?.rowStatus)}, lines ${hungLines}`);
  } else if (rnd.closedAt === null || rnd.deadlineAt === null || rnd.closedAt >= rnd.deadlineAt) {
    fail("a:cancel", `wanted the round closed at the cancel, not waiting for its deadline; closed ${show(rnd.closedAt)}, deadline ${show(rnd.deadlineAt)}`);
  } else notes.push(`Alice's cancel: the task ended cancelled, and the round closed ${rnd.deadlineAt - rnd.closedAt} ms before its deadline`);

  // ---- b: the restart --------------------------------------------------------
  if (restart.kill.setup !== undefined || restart.restart.setup !== undefined) fail("b:restart", `setup: ${restart.kill.setup ?? restart.restart.setup}`);
  else {
    const k = restart.kill;
    const r = restart.restart;
    const from = Math.max(k.deadlineAt ?? 0, r.restartAt);
    if (k.ready !== true || k.deadlineAt === null) {
      fail("b:restart", `the host was never killed with a round waiting on a working delegate before its deadline: ${show(k)}`);
    } else if (r.closedAt === null || r.closedAt - from > CLOSE_WITHIN_MS) {
      fail("b:restart", `killed ${k.deadlineAt - k.readyAt} ms before the round's deadline and restarted; wanted the round closed within ${CLOSE_WITHIN_MS} ms of the later of its deadline and the restart; closed ${r.closedAt === null ? "never in the watch" : `${r.closedAt - from} ms past it`} (open at restart ${show(r.openAtRestart)}, at the end ${show(r.openAtEnd)})`);
    } else notes.push(`killed ${k.deadlineAt - k.readyAt} ms before the round's deadline; restarted ${r.restartAt - k.deadlineAt} ms from it; the round closed ${r.closedAt - from} ms past the later of the two; tasks then ${show(r.rows)}`);
  }

  // ---- b: a failed delegate ---------------------------------------------------
  const fails = o.b.fails;
  const failedRow = rows(fails.sessionId).find((r) => r.messageRequestId === fails.post.requestId && r.round === 0 && r.delegate.worker === third);
  // Each failed task says, once, that it couldn't answer and why (FIX-1872 BR-9 as amended), never an
  // answer carrying the word. Round 1 hands it the other's answer, which carries its fail mark, so it fails twice.
  const failedLines = (o.read.fails.lines as Line[]).filter((l) => l.agentName === third).map((l) => l.text);
  const failedTasks = rows(fails.sessionId).filter((r) => r.messageRequestId === fails.post.requestId && r.delegate.worker === third && r.rowStatus === "errored").length;
  const failedSays = `${third} couldn't answer: ${third} fails on this message`;
  if (failedRow?.rowStatus !== "errored" || failedLines.length !== failedTasks || failedLines.some((text: string) => text !== failedSays)) {
    fail("b:failed", `${third} fails the message; wanted its task errored and one line by it per failed task (${failedTasks}), "${failedSays}"; task ${show(failedRow?.rowStatus)}, lines ${show(failedLines)}`);
  }
  if (fails.closedAt === null || fails.deadlineAt === null || fails.closedAt >= fails.deadlineAt) {
    fail("b:failed", `wanted round 0 closed as soon as both delegates had ended, before its deadline; closed at ${show(fails.closedAt)}, deadline ${show(fails.deadlineAt)}`);
  } else notes.push(`a failed delegate: one line saying it couldn't answer, and round 0 closed ${fails.deadlineAt - fails.closedAt} ms before its deadline`);

  // ---- b: a late delegate -------------------------------------------------------
  const late = o.b.late;
  const atClose = late.atDeadline as { closedAt: number | null; lateRowStatus: string | null };
  if (late.deadlineAt === null || atClose.closedAt === null || atClose.closedAt - late.deadlineAt > CLOSE_WITHIN_MS || atClose.closedAt < late.deadlineAt || !["in_progress", "pending"].includes(atClose.lateRowStatus ?? "")) {
    fail("b:late", `wanted round 0 closed at its deadline (within ${CLOSE_WITHIN_MS} ms) while ${second} still worked; deadline ${show(late.deadlineAt)}, closed ${show(atClose.closedAt)}, ${second}'s task then ${show(atClose.lateRowStatus)}`);
  }
  // Its answer to the person's message, not to the other delegate's answer in round 1.
  const answeredPost = `${second} answers: ${o.userId}, through desk.late:`;
  const lateLines = linesBy(o.read.late.lines, second, w.late).filter((l) => l.text.startsWith(answeredPost)).length;
  const round1 = rows(late.sessionId).filter((r) => r.messageRequestId === late.post.requestId && r.round === 1).map((r) => r.delegate.worker);
  if (lateLines !== 1 || round1.join(",") !== second) {
    fail("b:late", `wanted ${second}'s late answer landed once and handed to nobody in round 1; its lines ${lateLines}, round 1's tasks to ${show(round1)} (want only ${second}, with ${first}'s answer)`);
  } else if (!failures.some((f) => f.startsWith("b:late"))) notes.push(`a late delegate: round 0 closed ${atClose.closedAt! - late.deadlineAt} ms past its deadline, its answer landed once and went no further`);

  // ---- c: the writer's answer waits for the work it filed --------------------
  const writerLines = (o.read.write.lines as Line[]).filter((l) => l.agentName === o.writer);
  const routedToWriter = stored.find((r) => r.assignee === o.writer && typeof r.sealed?.messageRequestId === "string" && r.sealed.messageRequestId === o.c.post.requestId);
  const piece = stored.find((r) => r.assignee === first && typeof r.goal === "string" && r.goal.includes(w.write));
  if (writerLines.length !== 1 || !writerLines[0]!.text.includes(`${first} answers:`) || !writerLines[0]!.text.includes(w.write)) {
    fail("c:after", `wanted one line under ${o.writer}'s name, carrying the result of the task it filed; its lines ${show(writerLines.map((l) => l.text))}`);
  } else if (piece === undefined || routedToWriter === undefined || piece.status !== "completed" || routedToWriter.completedAt < piece.completedAt || (piece.filedByTask !== undefined && piece.filedByTask !== routedToWriter.id)) {
    fail("c:after", `wanted ${o.writer}'s task to end after the task it filed; its task ${show(routedToWriter && [routedToWriter.status, routedToWriter.completedAt])}, the filed one ${show(piece && [piece.status, piece.completedAt, piece.filedByTask])}`);
  } else notes.push(`${o.writer} filed a piece and ended its turn; its one line, "${writerLines[0]!.text.slice(0, 80)}", landed after the piece ended, ${routedToWriter.completedAt - piece.completedAt} ms later`);

  // ---- d: the judgment delegate reads the message as written ------------------
  const judgedHeard = heard.filter((h) => h.worker === first && h.message.includes(w.twice));
  if (judgedHeard.length !== 1 || !judgedHeard[0]!.message.includes(`[judge] ${w.twice} hand this on.`)) {
    fail("d:word", `wanted ${first} handed Alice's message as she wrote it, held-out word and all, beside the judgment turn's own goal; it heard ${show(judgedHeard.map((h) => h.message))}`);
  } else notes.push(`the judgment delegate heard "${judgedHeard[0]!.message.replace(/\n/g, " ").slice(0, 120)}"`);

  // ---- d: one fit check, for best fit and the lead vet -----------------------------
  const d = o.d;
  type FitCall = { about: unknown; questions: string[]; choices: string[] };
  const fitCalls = d.fitCalls as FitCall[];
  /** The one fit check's calls about `word`: one `worker` choice each, on the one evaluation. */
  const checked = (word: string) => fitCalls.filter((c) => JSON.stringify(c.about).includes(word) && c.questions.join(",") === "worker");
  const fitRoute = (messageRequestId: string) => routesFor(o.read.fit.records, messageRequestId)[0] as (Route & { fit?: { reason?: string } }) | undefined;
  const pickRoute = fitRoute(d.fit.pick.requestId);
  const pickHeard = heard.filter((h) => h.message.includes(w.pick)).map((h) => h.worker);
  const pickCalls = checked(w.pick);
  if (pickCalls.length !== 1 || !pickCalls[0]!.choices.includes(second) || !pickCalls[0]!.choices.includes(third) || pickRoute?.by !== "evaluated" || pickHeard.join(",") !== second) {
    fail("d:fit-pick", `wanted best fit's message marked for ${second} judged by one fit check call offering ${second} and ${third}, placed by its pick, and heard by ${second} alone; calls ${show(pickCalls)}, record ${show(pickRoute)}, heard by ${show(pickHeard)}`);
  } else notes.push(`best fit's pick: one fit check call over ${pickCalls[0]!.choices.length} choices, placed by its pick, heard by ${second} alone`);
  const fallbackRoute = fitRoute(d.fit.fallback.requestId);
  const fallbackHeard = heard.filter((h) => h.message.includes(w.fallback)).map((h) => h.worker);
  if (checked(w.fallback).length !== 1 || fallbackRoute?.by !== "fallback" || fallbackRoute.fit?.reason !== "failed" || fallbackHeard.join(",") !== third) {
    fail("d:fit-fallback", `wanted best fit's unmarked message judged by one fit check call, which fails, and taken by the fallback ${third}; calls ${show(checked(w.fallback))}, record ${show(fallbackRoute)}, heard by ${show(fallbackHeard)}`);
  } else notes.push(`best fit's fallback: the fit check's call failed, and the fallback ${third} took the message`);
  const vetTools = o.read.vet.tools as Array<{ name: string | null; output: any; error?: unknown }>;
  // What each open answered: its output, or the refusal it threw.
  const opens = vetTools.filter((t) => t.name === "openWorkstream").map((t) => JSON.stringify({ output: t.output ?? null, error: t.error ?? null }));
  const misfitCalls = checked(w.misfit);
  const misfitOpen = opens.find((out) => out.includes(`misfit-${w.misfit}`) || out.includes("lead-doesnt-fit"));
  if (d.vet.created?.status !== "completed") fail("d:lead-refused", `setup: Alice's project was not created: ${show(d.vet.created)}`);
  else if (misfitCalls.length !== 1 || misfitCalls[0]!.choices.length !== 3 || !misfitCalls[0]!.choices.includes(d.lead) || misfitOpen === undefined || !misfitOpen.includes("lead-doesnt-fit") || d.vet.opened.includes(`misfit-${w.misfit}`)) {
    fail("d:lead-refused", `wanted the open of research under ${d.lead} judged by one fit check call, asked about the lead with two more choices, refused lead-doesnt-fit on its none fits, and nothing opened; calls ${show(misfitCalls)}, the open answered ${show(misfitOpen)}, opened ${show(d.vet.opened)}`);
  } else notes.push(`a misfit lead: one fit check call over ${show(misfitCalls[0]!.choices)}, and the open refused lead-doesnt-fit`);
  const bareOpen = opens.find((out) => out.includes(`bare-${w.bare}`));
  if (checked(w.bare).length !== 1 || bareOpen === undefined || !bareOpen.includes('"leadFit":{"checked":true}') || !d.vet.opened.includes(`bare-${w.bare}`)) {
    fail("d:lead-bare", `wanted the open of a bare name under ${d.lead} judged by one fit check call and opened, checked; calls ${show(checked(w.bare))}, the open answered ${show(bareOpen)}, opened ${show(d.vet.opened)}`);
  } else notes.push(`a bare-name workstream: one fit check call, and it opened, checked`);
  // No second fit call: the only language model asked on the fit model is the check's own ask again, after a failed evaluation.
  const secondCalls = (d.askedModels as Array<{ block: string | null; id: string }>).filter((m) => m.id === "scripted/fit" && !(m.block ?? "").endsWith("-ask"));
  if (secondCalls.length > 0) fail("d:one-check", `a language model was asked to judge fit outside the one check: ${show(secondCalls)}`);

  // ---- e: a post row stored before the upgrade -----------------------------------
  const e = o.e;
  const legacyHeard = heard.filter((h) => h.worker === fourth && h.message.includes(w.legacy));
  const warm = heard.find((h) => h.worker === fourth && h.message.endsWith("desk.legacy: warm up"));
  const legacyLines = linesBy(o.read.legacy.lines, fourth, w.legacy).length;
  if (e.seeded?.ok !== true) fail("e:legacy", `setup: the post row was not seeded: ${show(e.seeded)}`);
  else if (legacyHeard.length !== 1 || warm === undefined || legacyHeard[0]!.sessionId !== warm.sessionId || legacyLines !== 1) {
    fail("e:legacy", `wanted the stored post row worked once, as a routed task, in ${fourth}'s session for this conversation, and its answer landed once under its name; heard ${show(legacyHeard.map((h) => [h.message.slice(0, 60), h.sessionId.slice(-6)]))}, ${fourth}'s session here ${show(warm?.sessionId.slice(-6))}, lines ${legacyLines}`);
  } else notes.push(`a post row stored before the upgrade: worked once in ${fourth}'s session for the conversation, and its answer landed once`);

  // ---- the sweep ----------------------------------------------------------------
  const declaring = (o.sweep.declared as Array<{ id: string; task: string[]; internal: string[] }>).filter((f) => [...f.task, ...f.internal].includes("onDelegatedPost"));
  if (declaring.length > 0) fail("sweep:entry", `flows still declare a post entry: ${show(declaring.map((f) => f.id))}`);
  const postRows = stored.filter((r) => r.sealed?.kind === "post" && r.id !== e.seeded?.id);
  if (postRows.length > 0) fail("sweep:rows", `${postRows.length} post row(s) written: ${show(postRows.map((r) => r.id))}`);
  const withPost = Object.entries(o.sweep.toolFields as Record<string, string[]>).filter(([, fields]) => fields.includes("post"));
  if (withPost.length > 0) fail("sweep:field", `tools still offer a \`post\` field: ${show(withPost.map(([name]) => name))}`);
  if (!failures.some((f) => f.startsWith("sweep:"))) notes.push(`sweep: no flow declares a post entry, no post row was written, no tool offers \`post\``);

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

  const main = join(SCRATCH, `run-${RUN_STAMP}`);
  const restartDir = join(SCRATCH, `restart-${RUN_STAMP}`);
  const reported = await runHost(checkout.root, { ...env, GOAL_SCRATCH: main, GOAL_PHASE: "all" });
  say("leg b's restart: the host runs until a round waits on a working delegate, and is killed there");
  const kill = await runHost(checkout.root, { ...env, GOAL_SCRATCH: restartDir, GOAL_PHASE: "kill" }, true);
  const restarted =
    kill.setup !== undefined ? { setup: "not run: the first host failed" } : await runHost(checkout.root, { ...env, GOAL_SCRATCH: restartDir, GOAL_PHASE: "restart", GOAL_KILLED: JSON.stringify(kill) });
  if (control !== undefined) {
    assertPatched(control.patches, checkout.root, mark);
    say(`control ${control.name}: the patch reached ${control.patches[0]!.module}`);
  }
  const { failures, notes } = grade(reported, { kill, restart: restarted });
  for (const note of notes) say(note);
  rmSync(main, { recursive: true, force: true });
  rmSync(restartDir, { recursive: true, force: true });
  for (const leg of ["a", "b", "c", "d", "e", "sweep"]) {
    const red = [...new Set(failures.filter((f) => f.startsWith(`${leg}:`)).map((f) => f.split(" — ")[0]))];
    say(`${leg === "sweep" ? "the sweep" : `leg ${leg}`}: ${red.length === 0 ? "PASS" : `FAIL (${red.join(", ")})`}`);
  }
  if (control !== undefined) {
    const named = failures.some((f) => f.startsWith(`${control.assertion} `));
    failures.unshift(
      named
        ? `control ${control.name}: failed on ${control.assertion}, as it must`
        : `control ${control.name}: did NOT fail on ${control.assertion}, so the check can't see what the control removes`,
    );
  }
  return { failures, evidence: `legs a to e and the sweep PASS on ${checkout.describe}; ${notes.join("; ")}` };
});
