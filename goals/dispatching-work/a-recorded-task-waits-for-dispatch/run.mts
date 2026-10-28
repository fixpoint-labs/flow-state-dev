/**
 * Goal check: recording a task on a conversation's board never starts it, and
 * `createTask` starts a recorded task, or a new one, now (FIX-1875). See
 * goal.md.
 *
 * One person on a goal-local Lab (`lab/`), the FIX-1817 Lab's shape with two
 * delegates, served by Shift Manager's own command over HTTP, on the real
 * engine and a SQLite store. The delegates run on a real model. Every grade
 * reads the store file the run wrote
 * (`../../coordinators/files-tasks-down-the-owners-chain/store.mts`), except
 * what an action answered.
 *
 * Run:      pnpm tsx goals/dispatching-work/a-recorded-task-waits-for-dispatch/run.mts
 * Controls: GOAL_CONTROL=add-starts
 * Attempts: GOAL_ATTEMPTS=<n> fresh Labs, until it first passes (default 2; 1 under a control)
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, RUN_STAMP, goalTmpDir, keysServing, runGoal } from "../../lib/index.mts";
import { assertPatched, describePatches, modulePatchEnv, type ModulePatch } from "../../lib/module-patch.mts";
import { buildShiftManagerPages, startShiftManager } from "../../lib/shift-manager.mts";
import { loadScriptedClients } from "../../coordinators/files-tasks-down-the-owners-chain/scripted.mts";
import { requests, sessions, taskRows, type StoredTask } from "../../coordinators/files-tasks-down-the-owners-chain/store.mts";
import { ALICE, ORG } from "./lab/people.mts";

const HERE = new URL(".", import.meta.url).pathname;
const SCRATCH = goalTmpDir("a-recorded-task-waits-for-dispatch");
const MODEL = "openai/gpt-5.4-mini";
const say = (s: string) => console.error(`[recorded-waits ${new Date().toISOString().slice(11, 19)}] ${s}`);
const show = (value: unknown) => JSON.stringify(value)?.slice(0, 600);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const pick = <T,>(list: readonly T[]): T => list[randomBytes(1)[0]! % list.length]!;

// ---- held out, picked at run time ---------------------------------------------------

const DELEGATES = ["desk.ops", "desk.dev"] as const;
const SUBJECTS = ["the backup schedule", "the release checklist", "the on-call rota", "the staging certificates", "the build cache", "the API rate limits"] as const;
/** How long the board is touched while the recorded row must not start (the spec's 30 s). */
const TOUCH_MS = 30_000;

// ---- controls -------------------------------------------------------------------------

interface Control {
  name: string;
  assertions: string[];
  patches: ModulePatch[];
  does: string;
}

const CONTROLS: Record<string, Control> = {
  "add-starts": {
    name: "add-starts",
    assertions: ["rec:not-started"],
    patches: [
      {
        module: "packages/orchestration/src/skills/task-tools-capability.ts",
        from: String.raw`\.\.\.\(input\.held === true \? \{ held: true \} : \{\}\),`,
        to: "",
      },
    ],
    does: "the task tools drop createTask's held setting and file the row ready, so writing a task down for a delegate starts it, as before FIX-1875",
  },
};

const controlName = process.env.GOAL_CONTROL ?? "";
if (controlName !== "" && CONTROLS[controlName] === undefined) {
  console.error(`unknown GOAL_CONTROL "${controlName}"; known: ${Object.keys(CONTROLS).join(", ")}`);
  process.exit(2);
}
const control = controlName === "" ? undefined : CONTROLS[controlName];

// ---- driving the Lab ----------------------------------------------------------------

type Acted = { status: string; requestId: string | null; output: any; error: string | undefined };
const TERMINAL = new Set(["completed", "failed", "incomplete", "aborted", "interrupted"]);
const RUNNING = new Set(["pending", "queued", "in_progress", "running"]);
const ENDED = ["completed", "errored", "cancelled"];

async function drive(origin: string, store: string) {
  const shipped = await loadScriptedClients(REPO_ROOT);
  const fetcher: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${ALICE.bearer}`);
    return fetch(input, { ...init, headers });
  };
  const transport = { baseUrl: origin, fetcher };
  // The app's one client, as Alice.
  const fsd = shipped.client.createClient({ userId: ALICE.userId, ...transport });
  const sessionsApi = fsd.sessions;
  const flow = (flowKind: string) => fsd.flow(flowKind);

  const act = async (sessionId: string, action: string, input: unknown, timeoutMs = 120_000): Promise<Acted> => {
    const client = flow("coordinator");
    let requestId: string;
    try {
      requestId = (await client.send(action, input, { sessionId })).id;
    } catch (error) {
      return { status: "http", requestId: null, output: undefined, error: error instanceof Error ? error.message : String(error) };
    }
    let status = "timed-out";
    for (const until = Date.now() + timeoutMs; Date.now() < until; await sleep(100)) {
      const now = (await client.request(requestId).status().catch(() => undefined))?.status as string | undefined;
      if (now !== undefined && TERMINAL.has(now)) {
        status = now;
        break;
      }
    }
    const listed = (await sessionsApi.requests(sessionId, { includeResultOutput: true, limit: 200 }).catch(() => [])) as any[];
    const found = listed.find((r) => r.id === requestId);
    return { status, requestId, output: found?.result?.output, error: found?.result?.error?.message };
  };
  const row = (taskId: string | undefined): StoredTask | undefined =>
    taskId === undefined ? undefined : taskRows(store, ALICE.userId, ORG).find((t) => t.id === taskId);
  const waitFor = async (check: () => boolean, ms: number) => {
    for (const until = Date.now() + ms; Date.now() < until; await sleep(500)) if (check()) return true;
    return check();
  };
  const quiet = async (ms = 120_000) => {
    let calm = 0;
    for (const until = Date.now() + ms; Date.now() < until; await sleep(300)) {
      calm = requests(store).some((r) => RUNNING.has(r.status)) ? 0 : calm + 1;
      if (calm >= 3) return;
    }
  };
  const conversation = async () =>
    (await fsd.flow("coordinator").createSession({ state: { workerId: "desk.lead" } })).id as string;

  // Held out: who each task is for, and its words. Both forms of a recorded
  // row run every time: one recorded for a delegate, and one recorded for
  // nobody and given its owner by the dispatch.
  const delegate = pick(DELEGATES);
  const other = DELEGATES.find((d) => d !== delegate)!;
  const word = randomBytes(3).toString("hex");
  // A drill a worker can finish in one reply, with nothing to ask about.
  const drill = (ref: string) => `Drill ${ref}: reply with exactly one line, "${pick(SUBJECTS)} checked, ref ${ref}". Ask nothing and do nothing else.`;

  const conv = await conversation();
  const elsewhere = await conversation();

  // rec: record both through the app's createTask_tasks, held, then touch the board for 30 s.
  const assigned = await act(conv, "createTask_tasks", { held: true, goal: drill(`${word}-a`), assignee: delegate });
  const unassigned = await act(conv, "createTask_tasks", { held: true, goal: drill(`${word}-u`) });
  const assignedId = assigned.output?.taskId as string | undefined;
  const unassignedId = unassigned.output?.taskId as string | undefined;
  let touches = 0;
  for (const until = Date.now() + TOUCH_MS; Date.now() < until; touches += 1) {
    await act(conv, "listTasks_tasks", {});
    await sleep(1_000);
  }
  await quiet();
  const snapshot = (id: string | undefined) => ({
    row: row(id),
    sessions: sessions(store).filter((s) => id !== undefined && s.state.taskId === id).length,
  });
  const afterTouches = { assigned: snapshot(assignedId), unassigned: snapshot(unassignedId) };

  // lineage: the same release from Alice's other conversation.
  const reached = assignedId === undefined ? null : await act(elsewhere, "updateTask_tasks", { id: assignedId, status: "pending" });
  await quiet();
  const afterReach = row(assignedId);

  // disp: release both recorded rows, and file a new one ready.
  const dispatchedAssigned = assignedId === undefined ? null : await act(conv, "updateTask_tasks", { id: assignedId, status: "pending" });
  const dispatchedUnassigned = unassignedId === undefined ? null : await act(conv, "updateTask_tasks", { id: unassignedId, assignee: other, status: "pending" });
  const freshFor = pick(DELEGATES);
  const fresh = await act(conv, "createTask_tasks", { goal: drill(`${word}-n`), assignee: freshFor });
  const freshId = fresh.output?.taskId as string | undefined;
  await waitFor(() => [assignedId, unassignedId, freshId].every((id) => ENDED.includes(row(id)?.status ?? "")), 180_000);
  await quiet();
  await sleep(5_000);
  await quiet();

  return {
    delegate, other, freshFor, word, conv, elsewhere, touches,
    assigned, assignedId, unassigned, unassignedId, afterTouches,
    reached, afterReach, dispatchedAssigned, dispatchedUnassigned, fresh, freshId,
  };
}

// ---- grading ----------------------------------------------------------------------------

function grade(o: Awaited<ReturnType<typeof drive>>, store: string): { failures: string[]; notes: string[] } {
  const failures: string[] = [];
  const notes: string[] = [];
  const rows = taskRows(store, ALICE.userId, ORG);
  const all = sessions(store);
  const conv = all.find((s) => s.id === o.conv);
  const keys = (conv?.state.taskNotices as string[] | undefined) ?? [];
  const noticesOf = (id: string | undefined, ending: string) => keys.filter((k) => id !== undefined && k.startsWith(`${id}:`) && k.endsWith(`:${ending}`));
  const taskSessions = (id: string | undefined) => all.filter((s) => id !== undefined && s.state.taskId === id);

  // rec: neither recorded row ran, however often the board was touched.
  for (const [form, filed, after] of [
    ["for a delegate", o.assigned, o.afterTouches.assigned],
    ["for nobody", o.unassigned, o.afterTouches.unassigned],
  ] as const) {
    const rec = after.row;
    // A recorded row is held (FIX-2080): filed, and not started until released.
    if (rec === undefined || rec.status !== "held" || rec.attempts !== 0 || rec.run !== undefined || after.sessions !== 0) {
      failures.push(
        `rec:not-started — wanted the row createTask_tasks filed held ${form} to be held with no run after ${o.touches} touches over ${TOUCH_MS / 1000} s; ` +
          `recording answered ${show(filed.output ?? filed.error)}, the row ${show(rec && { status: rec.status, attempts: rec.attempts, run: rec.run, assignee: rec.assignee })}, task sessions ${after.sessions}`,
      );
    }
  }

  // lineage: another conversation's dispatch can't reach it, and changes nothing.
  const reachError = String(o.reached?.output?.error ?? o.reached?.error ?? "");
  if (o.reached === null || o.reached.output?.ok !== false || !reachError.startsWith("task_not_found") || JSON.stringify(o.afterReach) !== JSON.stringify(o.afterTouches.assigned.row)) {
    failures.push(`lineage:refused — wanted Alice's other conversation's dispatch answered task_not_found and the row unchanged; it answered ${show(o.reached?.output ?? o.reached?.error)}, the row went from ${show(o.afterTouches.assigned.row)} to ${show(o.afterReach)}`);
  }

  // disp: each dispatched row ran once, for its delegate, started by the
  // dispatch (its task session opened after the dispatch request), with one
  // completed notice.
  const reqs = requests(store);
  const ranOnce = (label: string, id: string | undefined, assignee: string, dispatch: Acted | null) => {
    const r = rows.find((t) => t.id === id);
    const opened = taskSessions(id);
    const heard = noticesOf(id, "completed").length;
    const dispatchedAt = reqs.find((q) => q.id === dispatch?.requestId)?.createdAt;
    const afterDispatch = dispatchedAt !== undefined && opened.length === 1 && opened[0]!.createdAt >= dispatchedAt;
    if (r === undefined || r.status !== "completed" || r.attempts !== 1 || r.assignee !== assignee || opened.length !== 1 || !afterDispatch || heard !== 1) {
      failures.push(
        `${label} — wanted the dispatch to start it, once, for ${assignee}, and it to complete with one completed notice; dispatch answered ${show(dispatch?.output ?? dispatch?.error)} at ${dispatchedAt}, ` +
          `the row ${show(r && { status: r.status, attempts: r.attempts, assignee: r.assignee })}, task sessions ${show(opened.map((s) => s.createdAt))}, completed notices ${heard}`,
      );
    }
    notes.push(`${label}: ${id} ${r?.status} for ${r?.assignee}, output ${show(r?.output)}`);
  };
  ranOnce("disp:ref-runs", o.assignedId, o.delegate, o.dispatchedAssigned);
  ranOnce("disp:ref-runs", o.unassignedId, o.other, o.dispatchedUnassigned);
  ranOnce("disp:new-runs", o.freshId, o.freshFor, o.fresh);

  notes.unshift(`recorded ${o.assignedId} for ${o.delegate} and ${o.unassignedId} for nobody (dispatched for ${o.other}); ${o.touches} touches; recording answered ${show(o.assigned.output)}; new row for ${o.freshFor}`);
  return { failures, notes };
}

// ---- the run --------------------------------------------------------------------------

await runGoal(async () => {
  const keys = keysServing(MODEL);
  if (!keys.some((k) => (process.env[k] ?? "") !== "")) {
    return { failures: [`blocked: no key serves ${MODEL}; none of ${keys.join(", ")} is set`], evidence: "" };
  }
  if ((process.env.AI_GATEWAY_API_KEY ?? "") === "") {
    return { failures: [`blocked: the Lab reaches ${MODEL} through the AI Gateway, and AI_GATEWAY_API_KEY is not set`], evidence: "" };
  }
  mkdirSync(join(SCRATCH, "stores"), { recursive: true });
  const mark = join(SCRATCH, `patch-mark-${RUN_STAMP}`);
  rmSync(mark, { force: true });
  const env = control === undefined ? {} : modulePatchEnv(control.patches, REPO_ROOT, mark);
  if (control !== undefined) say(`control ${control.name}: ${control.does}\n${describePatches(control.patches, REPO_ROOT)}`);

  say("building Shift Manager's pages");
  const pages = await buildShiftManagerPages(join(SCRATCH, "pages"), join(REPO_ROOT, "packages", "shift-manager"));
  const attempts = Number(process.env.GOAL_ATTEMPTS ?? (control === undefined ? 2 : 1));
  let result = { failures: ["no attempt ran"], notes: [] as string[] };
  let passedOn = 0;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const store = join(SCRATCH, "stores", `${RUN_STAMP}-${control?.name ?? "plain"}-${attempt}.sqlite`);
    const served = await startShiftManager({
      scratch: SCRATCH,
      label: `${control?.name ?? "plain"}-${attempt}`,
      config: join(HERE, "lab", "fsdev.config.mts"),
      pages,
      env: { GOAL_STORE: store, ...env },
      root: join(REPO_ROOT, "packages", "shift-manager"),
      tsx: join(REPO_ROOT, "node_modules", ".bin", "tsx"),
      timeoutMs: 180_000,
    });
    try {
      say(`attempt ${attempt} of ${attempts}: the Lab at ${served.origin}, store ${store}, delegates on ${MODEL}`);
      result = grade(await drive(served.origin, store), store);
    } catch (error) {
      result = { failures: [`setup — ${error instanceof Error ? (error.stack ?? error.message).slice(0, 1500) : String(error)}`], notes: [] };
    } finally {
      await served.stop();
    }
    for (const note of result.notes) say(`attempt ${attempt}: ${note}`);
    say(`attempt ${attempt}: ${result.failures.length === 0 ? "PASS" : `FAIL (${[...new Set(result.failures.map((f) => f.split(" — ")[0]))].join(", ")})`}`);
    for (const failure of result.failures) say(`attempt ${attempt}: ${failure}`);
    if (result.failures.length === 0) {
      passedOn = attempt;
      break;
    }
  }
  if (control !== undefined) assertPatched(control.patches, REPO_ROOT, mark);

  const failures = [...result.failures];
  if (control !== undefined) {
    for (const assertion of control.assertions) {
      const named = failures.some((f) => f.startsWith(`${assertion} `));
      failures.unshift(
        named
          ? `control ${control.name}: ${assertion} failed, as it must`
          : `control ${control.name}: ${assertion} did NOT fail, so the check can't see what the control removes`,
      );
    }
  }
  return {
    failures,
    evidence: `rec, lineage and disp PASS on attempt ${passedOn} of ${attempts}, delegates on ${MODEL} through Shift Manager's command`,
  };
});
