/**
 * Goal check: any worker whose file lists a delegate that takes a task, on any
 * worker flow, files work for those delegates onto its own session's board,
 * and a worker given a task can split it the same way. Every session in the
 * chain is the owner's, the chain is bounded, and each task's result comes
 * back up, board by board, to the session that filed the top task
 * (FIX-1802). See goal.md.
 *
 * Every leg runs on a goal-local Lab (`lab/`) on the real engine and a SQLite
 * store, served by Shift Manager's own command, two people signed in over
 * HTTP with their own verified bearers:
 *
 * - legs a to d (`scripted.mts`): scripted models, one Lab; leg d's app cap
 *   on a second Lab whose app sets it to 3;
 * - leg e (`real.mts`): `real.lead` on the real model DevTeam's Shift
 *   Coordinator names, a fresh Lab per attempt.
 *
 * Every grade reads the store file the run wrote (the coordinators goal's `store.mts`), except what an
 * action answered, which is what the person saw. Leg c's tool lists are what
 * each turn was handed, as the turn said it, never the prompt: noted, not graded.
 *
 * Run:      pnpm tsx goals/workers/files-and-splits-down-the-chain/run.mts
 * Controls: GOAL_CONTROL=hands-to-a-non-delegate | no-parent-settle (each runs the leg it must fail)
 * Before:   GOAL_COMMIT=<sha> serves that commit, from its own tree and install
 * Legs:     GOAL_LEGS=a,b,c,d,e (default: all)
 * Attempts: GOAL_ATTEMPTS=<n> fresh Labs for leg e, until it first passes (default 3; 1 under a control)
 */
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { REPO_ROOT, RUN_STAMP, goalTmpDir, keysServing, runGoal } from "../../lib/index.mts";
import { assertPatched, describePatches, modulePatchEnv, type ModulePatch } from "../../lib/module-patch.mts";
import { buildShiftManagerPages, devteamShiftCoordinatorModel, startShiftManager } from "../../lib/shift-manager.mts";
import { ORG, PEOPLE } from "./lab/people.mts";
import { legE, type LegE } from "./real.mts";
import { capLeg, loadShipped, scriptedLegs } from "./scripted.mts";
import { allTaskRows, items, sessions, taskRows, textOf, toolOutput, type StoredSession, type StoredTask } from "../../coordinators/files-tasks-down-the-owners-chain/store.mts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const SCRATCH = goalTmpDir("workers-split");
const ALL_LEGS = ["a", "b", "c", "d", "e"] as const;
const SCRIPTED_LEGS = new Set(["a", "b", "c", "d"]);
/** The app's own chain cap on leg d's second Lab. */
const APP_CAP = 3;
const say = (s: string) => console.error(`[split ${new Date().toISOString().slice(11, 19)}] ${s}`);
const show = (value: unknown) => JSON.stringify(value)?.slice(0, 500);

// ---- controls -------------------------------------------------------------------

interface Control {
  name: string;
  /** The legs it runs, unless GOAL_LEGS says otherwise. */
  legs: string[];
  /** Each assertion, by name, that must go red. */
  assertions: string[];
  patches: ModulePatch[];
  does: string;
}

const CONTROLS: Record<string, Control> = {
  "hands-to-a-non-delegate": {
    name: "hands-to-a-non-delegate",
    legs: ["c"],
    assertions: ["c:reaches-no-delegate"],
    patches: [
      {
        module: "packages/workforce/src/conversation-board/board.ts",
        from: String.raw`if \(delegates\.available\.size === 1\) assignee = \[\.\.\.delegates\.available\.keys\(\)\]\[0\]!;`,
        to: "if (delegates.available.size + delegates.unavailable.size === 1) assignee = [...delegates.available.keys(), ...delegates.unavailable.keys()][0]!;",
      },
    ],
    does: "an unassigned filing goes to the conversation's only delegate even when that delegate takes no task: desk.router's goes to desk.poster",
  },
  "no-parent-settle": {
    name: "no-parent-settle",
    legs: ["a"],
    assertions: ["a:completes-after-pieces"],
    patches: [
      {
        module: "packages/workforce/src/conversation-board/task-settled.ts",
        from: String.raw`\.tap\(admitOwnTask\("conversation-task-settled-admission", true\)\)`,
        to: "",
      },
    ],
    does: "a piece's notice never runs for the task that filed it, so the task is never checked after its first turn: it stays running on the board above after its pieces end",
  },
};

const controlName = process.env.GOAL_CONTROL ?? "";
if (controlName !== "" && CONTROLS[controlName] === undefined) {
  console.error(`unknown GOAL_CONTROL "${controlName}"; known: ${Object.keys(CONTROLS).join(", ")}`);
  process.exit(2);
}
const control = controlName === "" ? undefined : CONTROLS[controlName];
const legs = new Set(
  (process.env.GOAL_LEGS ?? (control === undefined ? ALL_LEGS.join(",") : control.legs.join(",")))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);
for (const l of legs) if (!(ALL_LEGS as readonly string[]).includes(l)) throw new Error(`unknown leg "${l}" in GOAL_LEGS`);

const asks = JSON.parse(readFileSync(join(HERE, "fixtures", "asks.json"), "utf8")) as { e: string[] };

// ---- the tree under test --------------------------------------------------------

/** The tree a run serves: this checkout, or another commit's own tree and install. */
function checkoutFor(commit: string | undefined): { root: string; commit: string; describe: string } {
  const git = (...args: string[]) => execFileSync("git", ["-C", REPO_ROOT, ...args], { encoding: "utf8" }).trim();
  if (commit === undefined || commit === "") {
    const head = git("rev-parse", "HEAD");
    const dirty = git("status", "--porcelain", "--", ".", ":(exclude)goals").length > 0;
    return { root: REPO_ROOT, commit: head, describe: `this checkout, \`${head.slice(0, 9)}\`${dirty ? " with uncommitted changes outside goals/" : ""}` };
  }
  const sha = git("rev-parse", `${commit}^{commit}`);
  // Kept across runs: a commit's tree and install don't change.
  const root = join(tmpdir(), "fsd-goal-workers-trees", sha.slice(0, 12));
  if (!existsSync(join(root, "package.json"))) {
    mkdirSync(root, { recursive: true });
    execFileSync("sh", ["-c", `git -C "${REPO_ROOT}" archive --format=tar ${sha} | tar -x -C "${root}"`]);
  }
  if (!existsSync(join(root, "node_modules"))) {
    say(`installing ${sha.slice(0, 9)} in ${root}`);
    const installed = spawnSync("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], { cwd: root, encoding: "utf8", timeout: 900_000 });
    if (installed.status !== 0) throw new Error(`setup: ${sha} did not install: ${(installed.stdout + installed.stderr).slice(-1500)}`);
  }
  return { root, commit: sha, describe: `\`${sha.slice(0, 9)}\` (GOAL_COMMIT=${commit}), its own tree and install` };
}

/**
 * The goal-local Lab's config in `root`'s goals: this checkout's own, or a
 * copy of `lab/` and `fixtures/` placed in another commit's tree, so its
 * imports resolve to that commit's packages.
 */
function labConfigIn(root: string): string {
  if (root === REPO_ROOT) return join(HERE, "lab", "fsdev.config.mts");
  const dir = join(root, "goals", relative(join(REPO_ROOT, "goals"), HERE));
  mkdirSync(dir, { recursive: true });
  cpSync(join(HERE, "lab"), join(dir, "lab"), { recursive: true });
  cpSync(join(HERE, "fixtures"), join(dir, "fixtures"), { recursive: true });
  return join(dir, "lab", "fsdev.config.mts");
}

// ---- grading ----------------------------------------------------------------------

/** One leg's result: each assertion that failed, by name, and what the run saw. */
interface LegResult {
  failures: string[];
  notes: string[];
}

/** What an action said when it turned the person away, or `undefined` when it didn't. */
const refusalOf = (acted: { status: string; output?: any; error?: string } | null | undefined): string | undefined => {
  if (acted == null) return undefined;
  if (acted.output?.ok === false) return String(acted.output.error);
  if (acted.status === "failed" || acted.status.startsWith("http")) return String(acted.error ?? acted.status);
  return undefined;
};

/** `root` and every session under it, by parent. */
function chainUnder(all: StoredSession[], root: string): StoredSession[] {
  const ids = new Set([root]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const s of all) if (s.parentSessionId !== null && ids.has(s.parentSessionId) && !ids.has(s.id)) (ids.add(s.id), (grew = true));
  }
  return all.filter((s) => ids.has(s.id));
}

/** The `tool` calls a session's turns made, each one's answer; only one request's when `requestId` is given. `createTask` starts work, and with `held` holds it. */
function toolOutputs(tool: "createTask", store: string, sessionId: string | null | undefined, requestId?: string | null): any[] {
  if (sessionId == null) return [];
  return items(store, sessionId, "tool_output")
    .filter((i) => i.toolCall?.name === tool && (requestId === undefined || i.requestId === requestId))
    .map(toolOutput);
}

/** Whether a tool's or an action's answer refuses with `code`. */
const refusedWith = (answer: unknown, code: string) => answer != null && (answer as { ok?: unknown }).ok !== true && JSON.stringify(answer).includes(code);

/** The rows on `sessionId`'s own board. */
const onBoardOf = (rows: StoredTask[], sessionId: string) => rows.filter((r) => r.partition.startsWith(`${sessionId}~`));

/** The completed notice lines a conversation holds for `taskId`, under its worker's name. */
const completedLines = (store: string, conv: string, taskId: string, worker: string) =>
  items(store, conv, "message").filter((m) => m.agentName === worker && textOf(m).includes(`(${taskId}) completed`));

/** Whether a split task's output is its worker's woken answer (`Noted.`), never a list of its pieces (FIX-2077 D3). */
function isWokenAnswer(output: unknown): boolean {
  if (output === undefined || (output as { pieces?: unknown } | null)?.pieces !== undefined) return false;
  return JSON.stringify(output).includes("Noted.");
}

/** Leg a: Alice's `agent` worker files for its delegate, which splits; Bob's worker of the same name stays his. */
function gradeA(o: any, store: string): LegResult {
  const r: LegResult = { failures: [], notes: [] };
  const A = o.a;
  const alice = o.people.alice.userId as string;
  const bob = o.people.bob.userId as string;
  const rows = taskRows(store, alice, o.org);
  const all = sessions(store);
  const filed = toolOutputs("createTask", store, A.conv, A.turn.requestId);
  const topId = (filed.find((x) => x?.ok === true)?.taskId as string | undefined) ?? null;
  const top = rows.find((x) => x.id === topId);

  if (refusalOf(A.hired.alice) !== undefined || top === undefined || top.assignee !== "crew.planner" || !top.partition.startsWith(`${A.conv}~`)) {
    r.failures.push(`a:filed — wanted Alice's worker's own createTask to store a task for crew.planner on her conversation's board; hired ${show(A.hired.alice.output ?? A.hired.alice.error)}, the turn ${A.turn.status}, its createTask answered ${show(filed)}, row ${show(top)}`);
  }
  const plannerSessions = all.filter((s) => topId !== null && s.state.taskId === topId);
  const planner = plannerSessions[0];
  const pieceCalls = toolOutputs("createTask", store, planner?.id);
  const pieces = planner === undefined ? [] : onBoardOf(rows, planner.id);
  if (plannerSessions.length !== 1 || pieceCalls.filter((x) => x?.ok === true).length !== 2 || pieces.length !== 2 || show(pieces.map((p) => p.assignee).sort()) !== show(["crew.one", "crew.two"])) {
    r.failures.push(`a:split — wanted crew.planner's task session to file two pieces, one for crew.one and one for crew.two, on its own board by its own createTask; sessions ${plannerSessions.length}, its createTask answered ${show(pieceCalls)}, pieces on its board ${show(pieces.map((p) => [p.assignee, p.status]))}`);
  }
  const chain = chainUnder(all, A.conv);
  /** Where a session in the chain sits: under the conversation, under the planner, or its parent's id. */
  const parentOf = (s: (typeof chain)[number]) => (s.parentSessionId === A.conv ? "conv" : s.parentSessionId === planner?.id ? "planner" : s.parentSessionId);
  const pieceSessions = pieces.map((p) => all.filter((s) => s.state.taskId === p.id));
  if (
    chain.length !== 4 ||
    chain.some((s) => s.userId !== alice) ||
    planner?.parentSessionId !== A.conv ||
    pieceSessions.some((found) => found.length !== 1 || found[0]!.parentSessionId !== planner?.id || found[0]!.userId !== alice) ||
    top === undefined ||
    !top.partition.startsWith(`${A.conv}~`)
  ) {
    r.failures.push(
      `a:four-sessions — wanted four sessions, all Alice's: her conversation, the task's session under it, and one per piece under that, each row on its own session's board; the chain ${show(chain.map((s) => [s.state.workerId, s.userId === alice ? "alice" : s.userId, parentOf(s)]))}`,
    );
  }
  const answered = isWokenAnswer(top?.output);
  const lastPiece = Math.max(...pieces.map((p) => p.completedAt ?? Infinity));
  if (
    top?.status !== "completed" ||
    top.completedAt === undefined ||
    top.completedAt - A.turn.startedAt > 120_000 ||
    pieces.length !== 2 ||
    pieces.some((p) => p.status !== "completed") ||
    !(lastPiece <= top.completedAt) ||
    !answered
  ) {
    r.failures.push(
      `a:completes-after-pieces — wanted the top task completed within 120 s of the filing, after both pieces, from them; it is ${top?.status ?? "missing"}${top?.completedAt === undefined ? "" : ` ${top.completedAt - A.turn.startedAt} ms after the filing`}, pieces ${show(pieces.map((p) => [p.status, p.completedAt]))}, its output ${show(top?.output)}`,
    );
  }
  const conv = all.find((s) => s.id === A.conv);
  const lines = topId === null ? [] : completedLines(store, A.conv, topId, "crew.planner");
  const keys = ((conv?.state.taskNotices as string[] | undefined) ?? []).filter((k) => topId !== null && k.startsWith(`${topId}:`) && k.endsWith(":completed"));
  if (lines.length !== 1 || keys.length !== 1) {
    r.failures.push(`a:one-notice — wanted one completed notice in Alice's conversation, read after a ${o.graceMs} ms grace; it holds ${lines.length} line(s) and acted on ${show(keys)}`);
  }
  // Bob's worker of the same name: his own row, so it lists only his delegate.
  const bobRows = taskRows(store, bob, o.org);
  const bobTried = toolOutputs("createTask", store, A.bobConv, A.bobTurn.requestId);
  const bobOwnId = toolOutputs("createTask", store, A.bobConv, A.bobOwn.requestId).find((x) => x?.ok === true)?.taskId as string | undefined;
  const bobOwn = bobRows.find((x) => x.id === bobOwnId);
  const bobOwnSessions = all.filter((s) => bobOwnId !== undefined && s.state.taskId === bobOwnId);
  const herRowsNamingIt = rows.filter((x) => x.assignee === A.lead);
  if (
    refusalOf(A.hired.bob) !== undefined ||
    bobTried.length !== 1 ||
    !refusedWith(bobTried[0], "unknown_assignee") ||
    bobRows.some((x) => x.assignee === "crew.planner") ||
    bobOwn?.status !== "completed" ||
    !bobOwn.partition.startsWith(`${A.bobConv}~`) ||
    bobOwnSessions.length !== 1 ||
    bobOwnSessions[0]!.userId !== bob ||
    herRowsNamingIt.length > 0 ||
    chain.some((s) => s.userId === bob)
  ) {
    r.failures.push(
      `a:bobs-worker-apart — wanted Bob's worker of the same name to file only for its own delegate, in his own sessions, and to be an assignee nowhere in Alice's chain; hired ${show(A.hired.bob.output ?? A.hired.bob.error)}, its filing for crew.planner answered ${show(bobTried)}, its own task ${show(bobOwn && [bobOwn.status, bobOwnSessions.map((s) => s.userId)])}, her rows naming it ${herRowsNamingIt.length}`,
    );
  }
  r.notes.push(`top ${topId} → ${top?.status} ${top?.completedAt === undefined ? "" : `${top.completedAt - A.turn.startedAt} ms`}; pieces ${show(pieces.map((p) => `${p.assignee}:${p.status}`))}; chain ${chain.length} sessions; notice lines ${lines.length}; Bob's filing for crew.planner ${show(bobTried[0])}`);
  return r;
}

/** Leg b: a worker on the goal-local app flow files for an `agent` delegate. */
function gradeB(o: any, store: string): LegResult {
  const r: LegResult = { failures: [], notes: [] };
  const B = o.b;
  const alice = o.people.alice.userId as string;
  const rows = taskRows(store, alice, o.org);
  const all = sessions(store);
  const conv = all.find((s) => s.id === B.conv);
  const filed = toolOutputs("createTask", store, B.conv, B.turn.requestId);
  const id = (filed.find((x) => x?.ok === true)?.taskId as string | undefined) ?? null;
  const row = rows.find((x) => x.id === id);
  if (conv?.flowKind !== "foreman" || conv.state.workerId !== "shop.foreman" || row === undefined || row.assignee !== "crew.one" || !row.partition.startsWith(`${B.conv}~`)) {
    r.failures.push(`b:filed — wanted shop.foreman, on its own flow, to store a task for crew.one on its session's board by its own createTask; session ${show(conv && [conv.flowKind, conv.state.workerId])}, the turn ${B.turn.status} ${B.turn.error ?? ""}, its createTask answered ${show(filed)}, row ${show(row)}`);
  }
  const ran = all.filter((s) => id !== null && s.state.taskId === id);
  const lines = id === null ? [] : completedLines(store, B.conv, id, "crew.one");
  if (row?.status !== "completed" || ran.length !== 1 || ran[0]!.parentSessionId !== B.conv || ran[0]!.userId !== alice || ran[0]!.flowKind !== "agent" || lines.length !== 1) {
    r.failures.push(`b:completed — wanted the task completed, in one session of Alice's under the foreman's, and heard there once; it is ${row?.status ?? "missing"}, sessions ${show(ran.map((s) => [s.flowKind, s.parentSessionId === B.conv]))}, lines ${lines.length}`);
  }
  r.notes.push(`foreman filed ${id} → ${row?.status ?? "nothing"}; heard ${lines.length}`);
  return r;
}

/**
 * Leg c: no task-taking delegate, so nothing reaches a delegate (FIX-2076's
 * rule: the turn has the task tools, and an unassigned filing stays on its own
 * board as a step).
 */
function gradeC(o: any, store: string): LegResult {
  const r: LegResult = { failures: [], notes: [] };
  const C = o.c;
  const alice = o.people.alice.userId as string;
  const rows = taskRows(store, alice, o.org);
  const all = sessions(store);
  for (const label of ["router", "solo"] as const) {
    const X = C[label];
    const said = items(store, X.conv, "message")
      .filter((m) => m.requestId === X.turn.requestId && m.role === "assistant")
      .map(textOf)
      .join("\n");
    const listed = /tools=(\[[^\]]*\])/.exec(said);
    const tools = listed === null ? null : (JSON.parse(listed[1]!) as string[]);
    const tried = toolOutputs("createTask", store, X.conv, X.turn.requestId);
    const stored = onBoardOf(rows, X.conv);
    const assigned = stored.filter((row) => row.assignee != null);
    const taskSessions = all.filter((s) => s.parentSessionId === X.conv && s.state.taskId !== undefined);
    if (!tried.some((x) => x?.ok === true) || stored.length === 0 || assigned.length > 0 || taskSessions.length > 0 || stored.some((row) => row.status !== "held")) {
      r.failures.push(
        `c:reaches-no-delegate — wanted ${X.worker}, with no task-taking delegate, to keep its filing on its own board as a held step: no row with an assignee and no task session; its turn's createTask answered ${show(tried)}, rows on its board ${show(stored.map((row) => [row.status, row.assignee ?? null]))}, task sessions under it ${taskSessions.length}`,
      );
    }
    r.notes.push(`${X.worker}: tools ${show(tools)}; its createTask ${show(tried)}; the app's ${show(X.app.output ?? X.app.status)}; rows ${show(stored.map((row) => [row.status, row.assignee ?? null]))}`);
  }
  return r;
}

/** Leg d: the limits. Depth and the default cap on the main Lab; the app's cap on its own. */
function gradeD(o: any, store: string, cap: any, capStore: string | undefined): LegResult {
  const r: LegResult = { failures: [], notes: [] };
  const D = o.d;
  const alice = o.people.alice.userId as string;
  const rows = taskRows(store, alice, o.org);
  const all = sessions(store);
  const chain = chainUnder(all, D.conv);
  const deepTried = toolOutputs("createTask", store, D.d5);
  const boards = chain.filter((s) => onBoardOf(rows, s.id).length > 0);
  const toD6 = allTaskRows(store).filter((x) => x.assignee === "deep.d6");
  if (
    D.d5 === null ||
    deepTried.length !== 1 ||
    !refusedWith(deepTried[0], "total_task_cap_exceeded") ||
    !refusedWith(D.deepApp?.output ?? D.deepApp?.error, "total_task_cap_exceeded") ||
    toD6.length > 0 ||
    boards.length !== 5 ||
    boards.some((s) => onBoardOf(rows, s.id).length !== 1)
  ) {
    r.failures.push(
      `d:depth — wanted the filing onto the sixth board refused, by deep.d5's own createTask and by the app, total_task_cap_exceeded, and five boards holding one row each; deep.d5's session ${D.d5 ?? "missing"}, its createTask answered ${show(deepTried)}, the app's ${show(D.deepApp?.output ?? D.deepApp?.error)}, rows for deep.d6 ${toD6.length}, boards ${show(boards.map((s) => [s.state.workerId, onBoardOf(rows, s.id).length]))}`,
    );
  }
  const fanCalls = toolOutputs("createTask", store, D.fan);
  const fanOk = fanCalls.filter((x) => x?.ok === true).length;
  const fanRefused = fanCalls.filter((x) => refusedWith(x, "total_task_cap_exceeded")).length;
  const fanRows = D.fan === null ? [] : onBoardOf(rows, D.fan);
  if (D.fan === null || fanOk !== 100 || fanRefused !== 1 || fanCalls.length !== 101 || fanRows.length !== 100 || !refusedWith(D.fanApp?.output ?? D.fanApp?.error, "total_task_cap_exceeded")) {
    r.failures.push(`d:fan-at-101 — wanted 100 pieces accepted and the 101st refused, total_task_cap_exceeded, by the fan's createTask and by the app; ${fanCalls.length} calls, ${fanOk} accepted, ${fanRefused} refused, ${fanRows.length} rows, the app's ${show(D.fanApp?.output ?? D.fanApp?.error)}`);
  }
  r.notes.push(`depth: boards ${boards.length}, deep.d5's createTask ${show(deepTried)}, app ${show(D.deepApp?.output)}; fan: ${fanOk} ok, ${fanRefused} refused, app ${show(D.fanApp?.output)}`);
  if (cap !== undefined && capStore !== undefined) {
    const capRows = cap.fan === null ? [] : onBoardOf(taskRows(capStore, alice, cap.org), cap.fan);
    const capCalls = toolOutputs("createTask", capStore, cap.fan);
    const capOk = capCalls.filter((x) => x?.ok === true).length;
    const capRefused = capCalls.filter((x) => refusedWith(x, "total_task_cap_exceeded")).length;
    if (cap.fan === null || capOk !== APP_CAP || capRefused !== 1 || capRows.length !== APP_CAP || !refusedWith(cap.fanApp?.output ?? cap.fanApp?.error, "total_task_cap_exceeded")) {
      r.failures.push(`d:app-cap — wanted, with the app's cap at ${APP_CAP}, ${APP_CAP} pieces accepted and the ${APP_CAP + 1}th refused, total_task_cap_exceeded, by the fan's createTask and by the app; ${capOk} accepted, ${capRefused} refused, ${capRows.length} rows, the app's ${show(cap.fanApp?.output ?? cap.fanApp?.error)}`);
    }
    r.notes.push(`app cap ${APP_CAP}: ${capOk} ok, ${capRefused} refused, app ${show(cap.fanApp?.output)}`);
  }
  return r;
}

/** Leg e: a real model files at least one piece for a delegate, and its conversation hears the ending. */
function gradeE(E: LegE, store: string, alice: string, org: string): LegResult {
  const r: LegResult = { failures: [], notes: [] };
  const rows = taskRows(store, alice, org);
  const tools = items(store, E.conv, "tool_output");
  const calls = tools.filter((i) => i.requestId === E.turn.requestId && i.toolCall?.name === "createTask");
  const ids = calls.map(toolOutput).filter((x) => x?.ok === true).map((x) => x.taskId as string);
  const filed = rows.filter((x) => ids.includes(x.id) && (x.assignee === "crew.one" || x.assignee === "crew.two") && x.partition.startsWith(`${E.conv}~`));
  if (filed.length === 0) {
    r.failures.push(`e:filed — wanted real.lead's turn to file at least one piece for crew.one or crew.two with createTask; the turn ${E.turn.status} ${E.turn.error ?? ""}, its createTask answered ${show(calls.map(toolOutput))}; tools it called ${show(tools.filter((i) => i.requestId === E.turn.requestId).map((i) => i.toolCall?.name))}`);
    return r;
  }
  // A filing that waited for its answer hears the ending as the tool's result; any other hears it as one notice.
  const waited = new Set(
    calls
      .filter((i) => {
        try {
          return (JSON.parse(i.toolCall?.arguments ?? "{}") as { wait?: unknown }).wait === true;
        } catch {
          return false;
        }
      })
      .map((i) => toolOutput(i)?.taskId as string),
  );
  const unheard = filed.filter((x) => x.status !== "completed" || (waited.has(x.id) ? false : completedLines(store, E.conv, x.id, x.assignee!).length !== 1));
  if (unheard.length > 0) {
    r.failures.push(`e:heard — wanted each piece it filed completed and heard once in its conversation, read after a ${E.graceMs} ms grace; not: ${show(unheard.map((x) => [x.id, x.assignee, x.status, completedLines(store, E.conv, x.id, x.assignee!).length]))}`);
  }
  r.notes.push(`filed ${show(filed.map((x) => `${x.id} for ${x.assignee} → ${x.status}${waited.has(x.id) ? " (waited)" : ""}`))}`);
  return r;
}

// ---- the run ------------------------------------------------------------------------

await runGoal(async () => {
  const checkout = checkoutFor(process.env.GOAL_COMMIT);
  mkdirSync(join(SCRATCH, "stores"), { recursive: true });
  const mark = join(SCRATCH, `patch-mark-${RUN_STAMP}`);
  rmSync(mark, { force: true });
  const env = control === undefined ? {} : modulePatchEnv(control.patches, checkout.root, mark);
  say(`serving ${checkout.describe}; legs ${[...legs].join(", ")}${control === undefined ? "" : `; control ${control.name}`}`);
  if (control !== undefined) say(`control ${control.name}: ${control.does}\n${describePatches(control.patches, checkout.root)}`);

  const results: Record<string, LegResult> = {};
  const evidence: string[] = [];

  say(`building Shift Manager's pages`);
  const pages = await buildShiftManagerPages(join(SCRATCH, `pages-${checkout.commit.slice(0, 9)}`), join(checkout.root, "packages", "shift-manager"));
  const config = labConfigIn(checkout.root);
  const shipped = await loadShipped(checkout.root);
  const serve = (label: string, labEnv: Record<string, string>) =>
    startShiftManager({
      scratch: SCRATCH,
      label,
      config,
      pages,
      env: { ...labEnv, ...env },
      root: join(checkout.root, "packages", "shift-manager"),
      tsx: join(checkout.root, "node_modules", ".bin", "tsx"),
      timeoutMs: 180_000,
    });
  /** Serve a fresh Lab, run `body` against it, and stop it; what it threw, as a setup failure. */
  const onLab = async <T,>(label: string, labEnv: Record<string, string>, body: (origin: string) => Promise<T>): Promise<T | { setup: string }> => {
    try {
      const served = await serve(label, labEnv);
      try {
        return await body(served.origin);
      } finally {
        await served.stop();
      }
    } catch (error) {
      return { setup: error instanceof Error ? (error.stack ?? error.message).slice(0, 1500) : String(error) };
    }
  };

  const scripted = [...legs].filter((l) => SCRIPTED_LEGS.has(l));
  if (scripted.length > 0) {
    const store = join(SCRATCH, "stores", `${RUN_STAMP}-scripted.sqlite`);
    say(`legs ${scripted.join(", ")}: the goal-local Lab, store ${store}`);
    const o: any = await onLab(`scripted-${control?.name ?? "plain"}`, { GOAL_STORE: store }, (origin) => scriptedLegs({ origin, store, shipped, legs: new Set(scripted) }));
    let cap: any;
    const capStore = join(SCRATCH, "stores", `${RUN_STAMP}-cap.sqlite`);
    if (legs.has("d") && o.setup === undefined) {
      say(`leg d: a second Lab, its app's chain cap at ${APP_CAP}, store ${capStore}`);
      cap = await onLab(`cap-${control?.name ?? "plain"}`, { GOAL_STORE: capStore, GOAL_CHAIN_LIMIT: String(APP_CAP) }, (origin) => capLeg({ origin, store: capStore, shipped, cap: APP_CAP }));
    }
    if (o.setup !== undefined) {
      for (const l of scripted) results[l] = { failures: [`${l}:setup — ${o.setup}`], notes: [] };
    } else {
      const graders: Record<string, () => LegResult> = {
        a: () => gradeA(o, store),
        b: () => gradeB(o, store),
        c: () => gradeC(o, store),
        d: () => (cap?.setup !== undefined ? { failures: [`d:setup — the cap Lab: ${cap.setup}`], notes: [] } : gradeD(o, store, cap, capStore)),
      };
      for (const l of scripted) {
        try {
          results[l] = o[l]?.setup !== undefined ? { failures: [`${l}:setup — ${o[l].setup}`], notes: [] } : graders[l]!();
        } catch (error) {
          results[l] = { failures: [`${l}:grade — grading threw: ${error instanceof Error ? error.message : String(error)}`], notes: [] };
        }
      }
      evidence.push(`the goal-local Lab on Shift Manager as ${o.people.alice.userId} and ${o.people.bob.userId}`);
    }
  }

  if (legs.has("e")) {
    const model = devteamShiftCoordinatorModel(checkout.root);
    const modelKeys = keysServing(model);
    if (!modelKeys.some((k) => (process.env[k] ?? "") !== "")) {
      results.e = { failures: [`blocked: no key here serves ${model}; none of ${modelKeys.join(", ")} is set`], notes: [] };
    } else {
      // Retry until it first passes, over the model's flakiness: each attempt is a fresh store and a fresh Lab.
      const attempts = Number(process.env.GOAL_ATTEMPTS ?? (control === undefined ? 3 : 1));
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const label = `${control?.name ?? "plain"}-${attempt}`;
        const store = join(SCRATCH, "stores", `${RUN_STAMP}-real-${label}.sqlite`);
        say(`leg e attempt ${attempt} of ${attempts}: real.lead on ${model}, store ${store}`);
        const observed: any = await onLab(`real-${label}`, { GOAL_STORE: store, GOAL_REAL_MODEL: model }, (origin) => legE({ origin, store, shipped, asks: asks.e, say }));
        let graded: LegResult;
        if (observed.setup !== undefined) {
          graded = { failures: [`e:setup — ${observed.setup}`], notes: [] };
        } else {
          try {
            graded = gradeE(observed as LegE, store, PEOPLE.alice.userId, ORG);
          } catch (error) {
            graded = { failures: [`e:grade — grading threw: ${error instanceof Error ? error.message : String(error)}`], notes: [] };
          }
        }
        say(`leg e attempt ${attempt}: ${graded.failures.length === 0 ? "PASS" : `FAIL (${[...new Set(graded.failures.map((f) => f.split(" — ")[0]))].join(", ")})`}`);
        for (const note of graded.notes) say(`e attempt ${attempt}: ${note}`);
        for (const failure of graded.failures) say(`e attempt ${attempt}: ${failure}`);
        results.e = { ...graded, notes: [`attempt ${attempt} of ${attempts}`, ...graded.notes] };
        if (graded.failures.length === 0) break;
      }
      evidence.push(`real.lead on ${model}`);
    }
  }

  if (control !== undefined) assertPatched(control.patches, checkout.root, mark);

  const failures: string[] = [];
  for (const l of [...legs].sort()) {
    const r = results[l];
    if (r === undefined) continue;
    for (const note of r.notes) say(`${l}: ${note}`);
    say(`leg ${l}: ${r.failures.length === 0 ? "PASS" : `FAIL (${[...new Set(r.failures.map((f) => f.split(" — ")[0]))].join(", ")})`}`);
    failures.push(...r.failures);
  }
  if (control !== undefined) {
    for (const assertion of control.assertions) {
      if (!legs.has(assertion.split(":")[0]!)) continue;
      const named = failures.some((f) => f.startsWith(`${assertion} `));
      failures.unshift(
        named
          ? `control ${control.name}: ${assertion} failed, as it must`
          : `control ${control.name}: ${assertion} did NOT fail, so the check can't see what the control removes`,
      );
    }
  }
  return { failures, evidence: `legs ${[...legs].sort().join(", ")} PASS on ${checkout.describe}; ${evidence.join("; ")}` };
});
