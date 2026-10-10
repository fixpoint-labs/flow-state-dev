/**
 * Goal check: every task a user's coordinator files for one of its delegates
 * runs in a new session that belongs to that user and acts as them; only the
 * conversation that filed a task claims, lists, waits on or settles it, even
 * when its worker runs on another flow; and the conversation hears how it
 * ended, once, and can file it again (FIX-1794). See goal.md.
 *
 * - Legs a, c and d (`scripted.mts`): a goal-local Lab (`lab/`) on the real
 *   engine and a SQLite store, served by Shift Manager's own command, two
 *   people signed in over HTTP with their own verified bearers, scripted
 *   models.
 * - Leg e (`devteam.mts`): Shift Manager's DevTeam install, served by its own
 *   command over a fresh store, its chief of staff on the real model its
 *   `WORKER.md` names.
 *
 * Every grade reads the store file the run wrote (`store.mts`), except what an
 * action answered, which is what the person saw. Leg c's lists are each
 * conversation's own `listTasks`.
 *
 * Run:      pnpm tsx goals/coordinators/files-tasks-down-the-owners-chain/run.mts
 * Controls: GOAL_CONTROL=unpartitioned | no-follow-up (each runs the legs it must fail)
 * Before:   GOAL_COMMIT=<sha> serves that commit, from its own tree and install
 * Legs:     GOAL_LEGS=a,c,d,e (default: all)
 * Attempts: GOAL_ATTEMPTS=<n> fresh Labs for leg e, until it first passes (default 3; 1 under a control)
 */
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { REPO_ROOT, RUN_STAMP, goalTmpDir, keysServing, runGoal } from "../../lib/index.mts";
import { assertPatched, describePatches, modulePatchEnv, type ModulePatch } from "../../lib/module-patch.mts";
import { buildShiftManagerPages, devteamCosModel, startShiftManager } from "../../lib/shift-manager.mts";
import { COS, legE, loadShipped, type LegE, type Person } from "./devteam.mts";
import { loadScriptedClients, scriptedLegs } from "./scripted.mts";
import { allTaskRows, items, requests, sessions, taskRows, textOf, toolOutput, type StoredItem, type StoredTask } from "./store.mts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const SCRATCH = goalTmpDir("coordinators-tasks");
const ALL_LEGS = ["a", "c", "d", "e"] as const;
const HOST_LEGS = new Set(["a", "c", "d"]);
const say = (s: string) => console.error(`[tasks ${new Date().toISOString().slice(11, 19)}] ${s}`);
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
  unpartitioned: {
    name: "unpartitioned",
    legs: ["c"],
    assertions: ["c:runs-its-own"],
    patches: [
      {
        module: "packages/workforce/src/conversation-board/ledger.ts",
        from: String.raw`return filingSessionIdOf\(\{`,
        to: 'return Promise.resolve("one-ledger"); return filingSessionIdOf({',
      },
      {
        module: "packages/workforce/src/conversation-board/ledger.ts",
        from: String.raw`conversationLedgerAt\(ctx, await filingSessionIdOf\(ctx\.session\)\)`,
        to: 'conversationLedgerAt(ctx, "one-ledger")',
      },
      {
        module: "packages/workforce/src/conversation-board/task-entry.ts",
        from: String.raw`partition === (?:undefined|void 0) \|\| filingPartitionOf\(ctx\) !== partition`,
        to: "partition === undefined",
      },
    ],
    does: "one ledger for all of a user's conversations: every conversation's board reads and writes one partition, and a task session takes its task from it whichever conversation opened it",
  },
  "no-follow-up": {
    name: "no-follow-up",
    legs: ["a", "e"],
    assertions: ["a:one-notice", "e:one-notice"],
    patches: [
      {
        module: "packages/orchestration/src/tasks/notice/task-notice.ts",
        from: String.raw`return policy === "judgment" \? \{ act: "wake-turn" \} : \{ act: "line" \};`,
        to: 'return { act: "none" };',
      },
    ],
    does: "a task's ending reaches the conversation that filed it, and nothing follows: no line and no coordinator turn (a retried attempt still runs again)",
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

const asks = JSON.parse(readFileSync(join(HERE, "fixtures", "asks.json"), "utf8")) as { e: string };

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

const okTaskId = (acted: { output?: any } | null | undefined): string | null => (acted?.output?.ok === true ? (acted.output.taskId as string) : null);
const refusedHttp = (acted: { status: string } | null | undefined) => acted != null && /^http 4\d\d$/.test(acted.status);
/** What an action said when it turned the person away, or `undefined` when it didn't. */
const refusalOf = (acted: { status: string; output?: any; error?: string } | null | undefined): string | undefined => {
  if (acted == null) return undefined;
  if (acted.output?.ok === false) return String(acted.output.error);
  if (acted.status === "failed" || acted.status.startsWith("http")) return String(acted.error ?? acted.status);
  return undefined;
};

/** Leg a: Alice's coordinator files a task for her `agent` delegate; the interim rule on a task session's filing. */
function gradeA(o: any, store: string): LegResult {
  const r: LegResult = { failures: [], notes: [] };
  const A = o.a;
  const alice = o.people.alice.userId as string;
  const rows = taskRows(store, alice, o.org);
  const all = sessions(store);
  const reqs = requests(store);
  const row = rows.find((t) => t.id === A.taskId);

  if (A.taskId === null || row === undefined || row.assignee !== "desk.alpha" || !row.partition.startsWith(`${A.conv}~`) || row.partition !== A.filingSessionId) {
    r.failures.push(
      `a:filed — wanted the coordinator's own addTask to store a task for desk.alpha on this conversation's board (partition ${show(A.filingSessionId)}); its turn ${A.filing.status}, tools ${show(A.filed)}, row ${show(row)}`,
    );
  }
  if (row === undefined || row.status !== "completed" || row.completedAt === undefined || row.completedAt - A.filing.startedAt > 60_000) {
    r.failures.push(`a:completed-60s — wanted the task completed within 60 s of the filing; it is ${row?.status ?? "missing"}${row?.completedAt === undefined ? "" : `, ${row.completedAt - A.filing.startedAt} ms after`}`);
  }
  const ts = all.filter((s) => s.state.taskId === A.taskId);
  const t = ts[0];
  if (
    A.taskId === null ||
    ts.length !== 1 ||
    t!.userId !== alice ||
    t!.parentSessionId !== A.conv ||
    t!.flowKind !== "agent" ||
    t!.state.workerId !== "desk.alpha" ||
    t!.state.filingSessionId !== row?.partition
  ) {
    r.failures.push(`a:task-session — wanted one new session for the task: Alice's, a child of the conversation, on agent, born naming desk.alpha and the conversation; found ${show(ts)}`);
  }
  if (t === undefined || A.found?.id !== t.id) {
    r.failures.push(`a:found — findWorkerSession({ worker, taskId, filingSessionId }) answered ${show(A.found)}, not the task's session ${t?.id ?? "(none)"}`);
  }
  const lines = items(store, A.conv, "message").filter((m) => m.agentName === "desk.alpha" && textOf(m).includes(`(${A.taskId}) completed`));
  const conv = all.find((s) => s.id === A.conv);
  const keys = ((conv?.state.taskNotices as string[] | undefined) ?? []).filter((k) => k.startsWith(`${A.taskId}:`) && k.endsWith(":completed"));
  if (lines.length !== 1 || keys.length !== 1) {
    r.failures.push(`a:one-notice — wanted one completed notice, read after a ${o.graceMs} ms grace; the conversation holds ${lines.length} line(s) ${show(lines.map(textOf))} and acted on ${show(keys)}`);
  }
  const filingReq = reqs.find((q) => q.id === A.filing.requestId);
  const work = reqs.filter((q) => q.sessionId === t?.id && q.actionName === "work");
  const firstWork = work[0];
  if (filingReq === undefined || firstWork === undefined || !(filingReq.updatedAt < firstWork.updatedAt) || firstWork.updatedAt - firstWork.createdAt < o.holdMs * 0.9) {
    r.failures.push(
      `a:returned-first — wanted the filing turn to end before the task's run did, the delegate holding its answer ${o.holdMs} ms; filing ended ${filingReq?.updatedAt ?? "?"}, the run ${firstWork === undefined ? "never ran" : `ran ${firstWork.createdAt}..${firstWork.updatedAt}`}`,
    );
  }
  r.notes.push(`filed ${A.taskId} → ${row?.status} in ${t?.id ?? "no session"}; notice lines ${lines.length}; filing took ${A.filing.endedAt - A.filing.startedAt} ms`);

  // The interim rule (FIX-1802 P2 replaces it with the split): a delegate's
  // task session can't file yet. Since FIX-1802 P1 its turn carries no task
  // tool at all, so "by its tool" is that no `addTask` it ran was accepted.
  const S = A.split;
  const subRow = rows.find((x) => x.id === S.taskId);
  const subSessions = all.filter((s) => s.state.taskId === S.taskId && S.taskId !== null);
  const subTool = subSessions.length === 0 ? [] : items(store, subSessions[0]!.id, "tool_output").filter((i) => i.toolCall?.name === "addTask").map(toolOutput);
  const pieces = allTaskRows(store).filter((x) => subSessions.some((s) => x.partition.startsWith(`${s.id}~`)));
  if (subRow?.status !== "completed" || subSessions.length !== 1 || subTool.some((x) => x?.ok !== false) || refusalOf(S.app) === undefined || pieces.length > 0) {
    r.failures.push(
      `a:split-refused — wanted desk.sub's task session to file nothing, by its turn and by the app, with nothing stored; its task ${subRow?.status ?? "missing"}, sessions ${subSessions.length}, its addTask answered ${show(subTool)}, the app's ${show(S.app)}, pieces stored ${pieces.length}`,
    );
  } else {
    r.notes.push(`desk.sub's task session filed nothing: its turn's addTask ${subTool.length === 0 ? "wasn't a tool" : `answered ${show(subTool[0])}`}; the app's ${show(S.app)}`);
  }
  return r;
}

/** Leg c: two of Alice's conversations with one coordinator. */
function gradeC(o: any, store: string): LegResult {
  const r: LegResult = { failures: [], notes: [] };
  const C = o.c;
  const alice = o.people.alice.userId as string;
  const rows = taskRows(store, alice, o.org);
  const all = sessions(store);
  const reqs = requests(store);
  const sessionsOf = (id: string | null) => all.filter((s) => id !== null && s.state.taskId === id);
  const ran = (id: string | null) => sessionsOf(id).map((s) => s.parentSessionId);
  const { t1, t2, t3 } = C.ids as Record<string, string | null>;

  const wanted = { t1: [C.c1], t2: [C.c2], t3: [C.c1] };
  const where = { t1: ran(t1), t2: ran(t2), t3: ran(t3) };
  const reached = refusalOf(C.reach) === undefined;
  if (t1 === null || t2 === null || t3 === null || reached || Object.entries(wanted).some(([k, v]) => show(where[k as keyof typeof where]) !== show(v))) {
    r.failures.push(
      `c:runs-its-own — wanted each task run once, in a session of the conversation that filed it, and the first conversation's assign naming the second's task refused; ` +
        `ran under ${show({ t1: where.t1.map((p) => (p === C.c1 ? "c1" : p === C.c2 ? "c2" : p)), t2: where.t2.map((p) => (p === C.c1 ? "c1" : p === C.c2 ? "c2" : p)), t3: where.t3.map((p) => (p === C.c1 ? "c1" : p === C.c2 ? "c2" : p)) })}, the reach answered ${show(C.reach.output ?? C.reach.error ?? C.reach.status)}`,
    );
  }
  const idsIn = (list: any) => ((list?.output?.tasks ?? []) as Array<{ id: string }>).map((x) => x.id).sort();
  const list1 = idsIn(C.list1);
  const list2 = idsIn(C.list2);
  if (show(list1) !== show([t1, t3].sort()) || show(list2) !== show([t2])) {
    r.failures.push(`c:lists-its-own — wanted c1 to list [t1, t3] and c2 [t2]; c1 lists ${show(list1)}, c2 ${show(list2)} (t1 ${t1}, t2 ${t2}, t3 ${t3})`);
  }
  const t2Row = rows.find((x) => x.id === t2);
  const t2Run = reqs.filter((q) => q.actionName === "work" && sessionsOf(t2).some((s) => s.id === q.sessionId))[0];
  const t3FiledAt = C.filed.t3.startedAt as number;
  const runs1 = reqs.filter((q) => q.sessionId === C.c1 && q.actionName === "runTaskBoard" && q.createdAt >= t3FiledAt);
  const t2Running = t2Run !== undefined && t2Run.createdAt <= t3FiledAt && t2Row?.completedAt !== undefined && t2Row.completedAt > t3FiledAt;
  if (!t2Running || runs1.length === 0 || runs1.some((q) => q.updatedAt >= t2Row!.completedAt!)) {
    r.failures.push(
      `c:drain-returns — wanted c1's board run, started while c2's task ran, to end before that task did; c2's task ${t2Running ? `ran ${t2Run!.createdAt}..${t2Row!.completedAt}` : "wasn't running when t3 was filed"}, c1's runs ${show(runs1.map((q) => [q.createdAt, q.updatedAt]))}`,
    );
  }
  const sid = (id: string | null) => sessionsOf(id)[0]?.id ?? null;
  const finds = C.finds as Record<string, { id: string | null }>;
  const expected: Record<string, string | null> = { "t1@c1": sid(t1), "t1@c2": null, "t2@c1": null, "t2@c2": sid(t2), "t3@c1": sid(t3), "t3@c2": null };
  const wrong = Object.entries(expected).filter(([k, v]) => (finds[k]?.id ?? null) !== v);
  if (wrong.length > 0 || sid(t1) === null || sid(t2) === null) {
    r.failures.push(`c:found-its-own — wanted findWorkerSession to find each task's session only in its own conversation; wrong: ${show(wrong.map(([k, v]) => `${k}: wanted ${v}, got ${finds[k]?.id ?? null}`))}`);
  }
  r.notes.push(`c1 ran ${show(where.t1)}/${show(where.t3)}, c2 ran ${show(where.t2)}; c1's reach answered ${show(C.reach.output ?? C.reach.status)}; lists ${show(list1)} | ${show(list2)}`);
  return r;
}

/** Leg d: Bob reaches into Alice's conversation, and names her worker on his own. */
function gradeD(o: any, store: string): LegResult {
  const r: LegResult = { failures: [], notes: [] };
  const D = o.d;
  const alice = o.people.alice.userId as string;
  const bob = o.people.bob.userId as string;
  const aliceRows = taskRows(store, alice, o.org);
  const bobRows = taskRows(store, bob, o.org);
  const all = sessions(store);

  if (!(D.open.status >= 400 && D.open.status < 500) || !refusedHttp(D.post) || !refusedHttp(D.file)) {
    r.failures.push(`d:refused — wanted Bob's open, post and filing on Alice's conversation each refused; open ${D.open.status}, post ${D.post.status}, filing ${D.file.status}`);
  }
  const hers = refusalOf(D.nameHers);
  const missing = refusalOf(D.nameMissing);
  const addHers = refusalOf(D.addHers);
  const shape = (text: string | undefined, id: string) => text?.split(id).join("<id>");
  if (hers === undefined || !hers.includes(D.hers) || missing === undefined || !missing.includes(D.missingWorker) || shape(hers, D.hers) !== shape(missing, D.missingWorker) || addHers === undefined || !addHers.includes(D.hers)) {
    r.failures.push(
      `d:same-answer — wanted Bob's filing naming Alice's worker refused with the answer a missing worker gets, naming it, and his addDelegate refused; hers ${show(hers ?? D.nameHers)}, missing ${show(missing ?? D.nameMissing)}, addDelegate ${show(addHers ?? D.addHers)}`,
    );
  }
  const herTask = aliceRows.find((x) => x.id === okTaskId(D.herTask));
  const touched = aliceRows.filter((x) => (x.updatedAt ?? 0) >= D.bobStartedAt);
  const bobNamesHers = bobRows.filter((x) => x.assignee === D.hers);
  const bobSessionsOfHers = all.filter((s) => s.userId === bob && s.state.workerId === D.hers);
  if (herTask?.status !== "completed" || touched.length > 0 || bobNamesHers.length > 0 || bobSessionsOfHers.length > 0) {
    r.failures.push(
      `d:her-rows-untouched — wanted none of Bob's runs to touch Alice's rows or her worker; her own task ${herTask?.status ?? "missing"}, her rows written after Bob began ${show(touched.map((x) => x.id))}, Bob's rows naming her worker ${bobNamesHers.length}, Bob's sessions with it ${bobSessionsOfHers.length}`,
    );
  }
  const bobsTaskId = okTaskId(D.bobsOwn);
  const bobsTask = bobRows.find((x) => x.id === bobsTaskId);
  const bobsSessions = all.filter((s) => bobsTaskId !== null && s.state.taskId === bobsTaskId);
  if (bobsTask?.status !== "completed" || !bobsTask.partition.startsWith(`${D.dB}~`) || bobsSessions.length !== 1 || bobsSessions[0]!.userId !== bob || bobsSessions[0]!.parentSessionId !== D.dB) {
    r.failures.push(`d:bobs-own-runs — wanted Bob's own filing to run in a session of his, a child of his conversation; filed ${show(D.bobsOwn.output ?? D.bobsOwn.status)}, row ${show(bobsTask)}, sessions ${show(bobsSessions)}`);
  }
  const aliceConvs = new Set([o.a?.conv, o.c?.c1, o.c?.c2, D.dA].filter((x): x is string => typeof x === "string"));
  const chain = all.filter((s) => s.parentSessionId !== null && aliceConvs.has(s.parentSessionId));
  const notHers = chain.filter((s) => s.userId !== alice);
  if (chain.length === 0 || notHers.length > 0) {
    r.failures.push(`d:chain-is-hers — wanted every session under Alice's conversations to be hers; ${chain.length} found, not hers: ${show(notHers)}`);
  }
  r.notes.push(`Bob: open ${D.open.status}, post ${D.post.status}, file ${D.file.status}; naming her worker → ${show(hers)}; his own task ${bobsTask?.status ?? "missing"}`);
  return r;
}

/** Leg e: a task fails both attempts; the conversation hears it once; the coordinator files it again and says so. */
function gradeE(E: LegE, store: string, alice: string, org: string): LegResult {
  const r: LegResult = { failures: [], notes: [] };
  const rows = taskRows(store, alice, org);
  const tools = items(store, E.conv, "tool_output");
  const messages = items(store, E.conv, "message");
  const firstCalls = tools.filter((i) => i.requestId === E.turn.requestId && i.toolCall?.name === "addTask");
  // The leg proves a task that ends after its filing turn is heard (FIX-1794 BR-24). A filing that
  // waits for its answer hears the ending as the tool's result instead, and never reaches a notice.
  const waited = firstCalls.filter((i) => {
    try {
      return (JSON.parse(i.toolCall?.arguments ?? "{}") as { waitForResponse?: unknown }).waitForResponse === true;
    } catch {
      return false;
    }
  });
  if (waited.length > 0) {
    r.failures.push(`e:filed-without-waiting — wanted the first turn to file with a plain addTask, so the ending arrives as a notice after the turn; ${waited.length} of its ${firstCalls.length} addTask calls set waitForResponse: ${show(waited.map((i) => i.toolCall?.arguments))}`);
    return r;
  }
  const firstFiled = firstCalls.map(toolOutput);
  const filedIds = firstFiled.filter((x) => x?.ok === true).map((x) => x.taskId as string);
  const task = rows.find((x) => filedIds.includes(x.id) && x.assignee === E.broken);
  const T = task?.id ?? "(none)";
  if (task === undefined || !task.partition.startsWith(`${E.conv}~`)) {
    r.failures.push(`e:filed — wanted the chief of staff's first turn to file a task for ${E.broken} with addTask; the turn ${E.turn.status}, its addTask calls answered ${show(firstFiled)}; tools it called: ${show(tools.filter((i) => i.requestId === E.turn.requestId).map((i) => i.toolCall?.name))}`);
    return r;
  }
  const maxAttempts = (task as StoredTask & { maxAttempts?: number }).maxAttempts ?? 2;
  if (task.status !== "errored" || task.attempts !== maxAttempts) {
    r.failures.push(`e:errored — wanted the task to fail both its attempts; it is ${task.status} after ${task.attempts} of ${maxAttempts}: ${task.error ?? ""}`);
  }
  // The notice is a line under the delegate's name; the coordinator's reply may quote it, and isn't one.
  const heard = messages.filter((m) => m.agentName === E.broken && textOf(m).includes(`(${T}) failed for good`));
  if (heard.length !== 1) {
    r.failures.push(`e:one-notice — wanted one errored notice, read after a ${E.graceMs} ms grace; the conversation holds ${heard.length}: ${show(heard.map(textOf))}`);
  }
  const retried = messages.filter((m) => textOf(m).includes(`(${T}) failed with`) && textOf(m).includes("runs again"));
  const settledRequests = requests(store).filter((q) => q.sessionId === E.conv && q.actionName === "onTaskSettled");
  const turnsWithoutEnding = settledRequests.filter((q) => {
    const said = messages.filter((m) => m.requestId === q.id);
    const replied = said.some((m) => m.role === "assistant" && !m.agentName?.startsWith(E.broken) && !m.agentName?.startsWith(E.helper));
    const ending = said.some((m) => /\) (completed by|failed for good|is waiting on a question)/.test(textOf(m)));
    return replied && !ending;
  });
  if (retried.length > 0 || turnsWithoutEnding.length > 0) {
    r.failures.push(`e:no-turn-on-retry — wanted the first failure to run the task again with no line and no turn; retry lines ${retried.length}, notice requests that woke a turn with no ending ${turnsWithoutEnding.length}`);
  }
  const woke = heard[0]?.requestId;
  const refiled = tools.filter((i) => i.requestId === woke && i.toolCall?.name === "addTask").map(toolOutput);
  const again = rows.filter((x) => refiled.some((y) => y?.ok === true && y.taskId === x.id) && x.partition === task.partition && x.goal.includes(E.goalWord));
  if (woke === undefined || again.length === 0) {
    r.failures.push(`e:refiled — wanted the turn the notice woke to file the task again with addTask; its addTask calls answered ${show(refiled)}; tools it called ${show(tools.filter((i) => i.requestId === woke).map((i) => i.toolCall?.name))}`);
  }
  const reply = messages
    .filter((m) => m.requestId === woke && m.role === "assistant" && m.agentName !== E.broken && m.agentName !== E.helper)
    .map(textOf)
    .join("\n");
  // The error as the task recorded it, which is what its notice carried.
  const recorded = (task.error ?? "").trim().replace(/[.\s]+$/, "");
  const namesTask = reply.includes(T) || reply.includes(E.goalWord);
  const namesError = recorded.length > 0 && reply.toLowerCase().includes(recorded.toLowerCase().slice(0, 40));
  if (!namesTask || !namesError) {
    r.failures.push(`e:reply-names — wanted the reply to name the task (its id or "${E.goalWord}") and the error it recorded ("${recorded}"); it said: ${show(reply)}`);
  }
  r.notes.push(`filed ${T} for ${E.broken} → ${task.status} after ${task.attempts}; heard ${heard.length}; refiled ${show(again.map((x) => `${x.id} for ${x.assignee} → ${x.status}`))}; reply: ${reply.slice(0, 300).replace(/\n/g, " ")}`);
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
  const serve = (label: string, config: string, labEnv: Record<string, string>) =>
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

  const hostLegs = [...legs].filter((l) => HOST_LEGS.has(l));
  if (hostLegs.length > 0) {
    const store = join(SCRATCH, "stores", `${RUN_STAMP}-scripted.sqlite`);
    let o: Record<string, any>;
    try {
      const served = await serve(`scripted-${control?.name ?? "plain"}`, labConfigIn(checkout.root), { GOAL_STORE: store });
      try {
        say(`legs ${hostLegs.join(", ")}: the goal-local Lab at ${served.origin}, store ${store}`);
        o = await scriptedLegs({ origin: served.origin, store, shipped: await loadScriptedClients(checkout.root), legs: new Set(hostLegs) });
      } finally {
        await served.stop();
      }
    } catch (error) {
      o = { setup: error instanceof Error ? (error.stack ?? error.message).slice(0, 1500) : String(error) };
    }
    if (o.setup !== undefined) {
      for (const l of hostLegs) results[l] = { failures: [`${l}:setup — ${o.setup}`], notes: [] };
    } else {
      const graders: Record<string, (o: any, store: string) => LegResult> = { a: gradeA, c: gradeC, d: gradeD };
      for (const l of hostLegs) {
        try {
          results[l] = graders[l]!(o, store);
        } catch (error) {
          results[l] = { failures: [`${l}:grade — grading threw: ${error instanceof Error ? error.message : String(error)}`], notes: [] };
        }
      }
      evidence.push(`the goal-local Lab on Shift Manager as ${o.people.alice.userId} and ${o.people.bob.userId}`);
    }
  }

  if (legs.has("e")) {
    const cosModel = devteamCosModel(checkout.root);
    const modelKeys = keysServing(cosModel);
    if (!modelKeys.some((k) => (process.env[k] ?? "") !== "")) {
      results.e = { failures: [`blocked: no key here serves the chief of staff's model, ${cosModel}; none of ${modelKeys.join(", ")} is set`], notes: [] };
    } else {
      const profile = join(checkout.root, "packages", "shift-manager", "teams", "devteam");
      const host = (await import(pathToFileURL(join(profile, "host.mts")).href)) as { LAB_USERS?: Record<string, { userId: string; bearer: string }>; LAB_ORG_ID?: string };
      const owner = host.LAB_USERS?.owner;
      if (owner === undefined || host.LAB_ORG_ID === undefined) throw new Error("setup: the DevTeam host exports no LAB_USERS owner or LAB_ORG_ID");
      const alice: Person = { label: "Alice", ...owner };
      const shipped = await loadShipped(checkout.root);
      // Retry until it first passes, over the model's flakiness: each attempt is a fresh store and a fresh Lab.
      const attempts = Number(process.env.GOAL_ATTEMPTS ?? (control === undefined ? 3 : 1));
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const label = `${control?.name ?? "plain"}-${attempt}`;
        const storeDir = join(SCRATCH, "stores", `${RUN_STAMP}-${label}`);
        const store = join(storeDir, "devteam.sqlite");
        mkdirSync(storeDir, { recursive: true });
        const served = await serve(`devteam-${label}`, join(profile, "fsdev.config.mts"), { DEVTEAM_STORE: store });
        let graded: LegResult;
        try {
          say(`leg e attempt ${attempt} of ${attempts}: DevTeam at ${served.origin}, the chief of staff on ${cosModel}`);
          const observed = await legE({ origin: served.origin, store, shipped, alice, ask: asks.e, helperModel: cosModel, say });
          say(`leg e attempt ${attempt}: hired ${show(observed.hired.map((h) => h.output ?? h.error ?? h.status))}; added ${show(observed.added.map((h) => h.status))}; the turn ${observed.turn.status}`);
          graded = gradeE(observed, store, alice.userId, host.LAB_ORG_ID);
        } catch (error) {
          graded = { failures: [`e:setup — ${error instanceof Error ? error.message : String(error)}`], notes: [] };
        } finally {
          await served.stop();
        }
        say(`leg e attempt ${attempt}: ${graded.failures.length === 0 ? "PASS" : `FAIL (${[...new Set(graded.failures.map((f) => f.split(" — ")[0]))].join(", ")})`}`);
        for (const note of graded.notes) say(`e attempt ${attempt}: ${note}`);
        for (const failure of graded.failures) say(`e attempt ${attempt}: ${failure}`);
        results.e = { ...graded, notes: [`attempt ${attempt} of ${attempts}`, ...graded.notes] };
        if (graded.failures.length === 0) break;
      }
      evidence.push(`DevTeam's chief of staff (${COS}) on ${cosModel}`);
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
