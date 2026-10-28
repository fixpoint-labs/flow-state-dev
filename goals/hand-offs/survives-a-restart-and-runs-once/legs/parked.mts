/**
 * J4, the journey no other check walks: an assigned task held on its
 * question, with the server killed while it waits (FIX-1820; a hold, not a
 * park, since FIX-2131). See ../goal.md.
 *
 * Leg b's goal-local Lab (`goals/coordinators/task-session-stays-open/lab/`
 * over its `fixtures/`), served by Shift Manager's own command on a fresh
 * SQLite store. Alice files leg b's brief for `desk.ops`: draw a ticket, then
 * ask which region, and stop. The moment the store shows the row held on its
 * open question, the server and every process under it get SIGKILL.
 * A new process starts on the same store file. From there Alice only does what
 * a person does: she answers, lists the board's tasks every five seconds,
 * answers once more, and asks the finished session which ticket it drew.
 *
 * Every grade reads the store file the run wrote, read-only
 * (`../../../coordinators/files-tasks-down-the-owners-chain/store.mts`),
 * except what an action answered, which is what Alice saw.
 *
 * Leg b's brief and regions are read from its own `run.mts`, never copied, so
 * a change there is a change here; a rename there fails this check loudly.
 * The kill is leg a's kill-the-tree approach, copied: two users, so no
 * `goals/lib` helper yet.
 *
 * Run:      pnpm tsx goals/hand-offs/survives-a-restart-and-runs-once/legs/parked.mts
 * Control:  GOAL_CONTROL=fresh-store (the restart lands on a new empty store file)
 * Attempts: GOAL_ATTEMPTS=<n> fresh stores, until it first passes (default 3; 1 under a control)
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, RUN_STAMP, goalAttempts, goalTmpDir, keysServing, runGoal } from "../../../lib/index.mts";
import { buildShiftManagerPages, startShiftManager, type ServedShiftManager } from "../../../lib/shift-manager.mts";
import { loadScriptedClients } from "../../../coordinators/files-tasks-down-the-owners-chain/scripted.mts";
import { items, requests, sessions, taskRows, toolOutput, type StoredTask } from "../../../coordinators/files-tasks-down-the-owners-chain/store.mts";
import { ALICE, ORG } from "../../../coordinators/task-session-stays-open/lab/people.mts";

const LEG_B = join(REPO_ROOT, "goals", "coordinators", "task-session-stays-open");
const SCRATCH = goalTmpDir("survives-a-restart-and-runs-once");
const MODEL = "openai/gpt-5.4-mini";
const LEG_B_QUESTION = "Which ticket did you draw?";
const say = (s: string) => console.error(`[j4 ${new Date().toISOString().slice(11, 19)}] ${s}`);
const show = (value: unknown) => JSON.stringify(value)?.slice(0, 600);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const pick = <T,>(list: readonly T[]): T => list[randomBytes(1)[0]! % list.length]!;

// ---- leg b's brief and regions, read from its own runner -----------------------------

function fromLegB(): { brief: string; regions: string[] } {
  const source = readFileSync(join(LEG_B, "run.mts"), "utf8");
  const briefAt = /const BRIEF =([\s\S]*?);\n/.exec(source)?.[1];
  const regionsAt = /const REGIONS = \[([^\]]*)\]/.exec(source)?.[1];
  const strings = (text: string | undefined) => [...(text ?? "").matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`) as string);
  const brief = strings(briefAt).join("");
  const regions = strings(regionsAt);
  if (brief === "" || regions.length === 0) throw new Error(`setup — leg b's run.mts no longer declares BRIEF and REGIONS as J4 reads them (${LEG_B}/run.mts)`);
  return { brief, regions };
}

// ---- the control ----------------------------------------------------------------------

const controlName = process.env.GOAL_CONTROL ?? "";
if (controlName !== "" && controlName !== "fresh-store") {
  console.error(`unknown GOAL_CONTROL "${controlName}"; known: fresh-store`);
  process.exit(2);
}
const freshStore = controlName === "fresh-store";
const CONTROL_DOES =
  "the server restarts on a new, empty store file instead of the one the dead server left, as an in-memory store would; " +
  "nothing in product code changes. Must fail j:answered; kill:parked stays green";

// ---- the kill (leg a's approach, copied) ------------------------------------------------

/** SIGKILL a process and everything under it: the command's `tsx` wrapper and the server it runs. */
function killTree(pid: number): number[] {
  const table = execFileSync("ps", ["-eo", "pid=,ppid="], { encoding: "utf8" })
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/).map(Number) as [number, number]);
  const tree = [pid];
  for (let i = 0; i < tree.length; i += 1) for (const [child, parent] of table) if (parent === tree[i]) tree.push(child);
  for (const p of tree) {
    try {
      process.kill(p, "SIGKILL");
    } catch {
      // already gone
    }
  }
  return tree;
}

// ---- the ticket, as the store holds it ------------------------------------------------------

/** Every `drawTicket` output the store at `file` holds, in any session: the tool's own record, never the model's retelling. */
function drawsIn(file: string): Array<{ session: string; item: string | undefined; ticket: string | undefined }> {
  if (!existsSync(file)) return [];
  return sessions(file).flatMap((s) =>
    items(file, s.id, "tool_output")
      .filter((i) => i.toolCall?.name === "drawTicket")
      .map((i) => ({ session: s.id, item: i.id as string | undefined, ticket: toolOutput(i)?.ticket as string | undefined })),
  );
}

// ---- Alice's clients ----------------------------------------------------------------------

type Acted = { status: string; requestId: string | null; output: any; error: string | undefined };
const TERMINAL = new Set(["completed", "failed", "incomplete", "aborted", "interrupted"]);
const RUNNING = new Set(["pending", "queued", "in_progress", "running"]);
const ENDED = new Set(["completed", "errored", "cancelled"]);

async function connect(origin: string) {
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
  const app = shipped.workforce.createWorkforceClient(fsd);
  const flow = (flowKind: string) => fsd.flow(flowKind);
  const act = async (flowKind: string, sessionId: string, action: string, input: unknown, timeoutMs = 120_000): Promise<Acted> => {
    const client = flow(flowKind);
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
  return { act, app, sessionsApi, fsd };
}

// ---- one attempt --------------------------------------------------------------------------

async function attempt(o: { serve: (label: string, store: string) => Promise<ServedShiftManager>; store: string; fresh: string; label: string; brief: string; region: string }) {
  const calls: string[] = [];
  const row = (file: string, taskId: string | undefined): StoredTask | undefined =>
    taskId === undefined || !existsSync(file) ? undefined : taskRows(file, ALICE.userId, ORG).find((t) => t.id === taskId);
  /** The row's open question: a row hold on a running row no steer answers yet. */
  const questionOf = (t: StoredTask | undefined) => {
    const held = t as (StoredTask & { holds?: Array<{ id: string; source: { kind: string } }>; steers?: Array<{ answers?: string }> }) | undefined;
    if (held?.status !== "in_progress") return undefined;
    const answered = new Set((held.steers ?? []).flatMap((s) => (s.answers === undefined ? [] : [s.answers])));
    return held.holds?.find((h) => h.source.kind === "row" && !answered.has(h.id));
  };
  const waitFor = async (check: () => boolean, ms: number, every = 300) => {
    for (const until = Date.now() + ms; Date.now() < until; await sleep(every)) if (check()) return true;
    return check();
  };
  const quiet = async (file: string, ms = 120_000) => {
    let calm = 0;
    for (const until = Date.now() + ms; Date.now() < until; await sleep(300)) {
      calm = requests(file).some((r) => RUNNING.has(r.status)) ? 0 : calm + 1;
      if (calm >= 3) return;
    }
  };

  // Before the kill: file the brief and wait for the question.
  let served = await o.serve(`${o.label}-before`, o.store);
  let alice = await connect(served.origin);
  const conv = (await alice.fsd.flow("coordinator").createSession({ state: { workerId: "desk.lead" } })).id as string;
  calls.push("createSession(coordinator)");
  const filingSessionId = (await alice.act("coordinator", conv, "listDelegates", {})).output?.filingSessionId as string | undefined;
  calls.push("listDelegates");
  const filed = await alice.act("coordinator", conv, "createTask_tasks", { goal: o.brief, assignee: "desk.ops" });
  calls.push("createTask_tasks");
  const filedAt = Date.now();
  const taskId = filed.output?.taskId as string | undefined;
  say(`${o.label}: filed ${taskId} for desk.ops; waiting for it to hold on its question`);
  const parked = await waitFor(() => questionOf(row(o.store, taskId)) !== undefined, 120_000, 40);
  const killed = killTree(served.child.pid!);
  const killedAfterMs = Date.now() - filedAt;
  say(`${o.label}: ${parked ? "the row held on its question" : "the row never held on a question"}; SIGKILL to ${killed.join(", ")} ${killedAfterMs} ms after the filing`);
  await served.exited;
  // What the store says now is what the dead server left.
  const atKillRow = row(o.store, taskId);
  const atKill = { row: atKillRow, question: questionOf(atKillRow), draws: drawsIn(o.store) };
  // A task that never asked, or asked with no draw persisted, leaves nothing to restart: a setup failure, never a grade.
  if (!parked || atKill.question === undefined) {
    throw new Error(`the task never held on its question within 120 s (the dead server left ${show(atKill.row?.status)}; filing ${show(filed.output ?? filed.error)}), so there was no wait to kill`);
  }
  if (atKill.draws.length !== 1 || atKill.draws[0]!.ticket === undefined) {
    throw new Error(`the dead server's store held ${atKill.draws.length} drawTicket output(s) at the kill, not one: ${show(atKill.draws)}; the draw must be persisted before the server dies`);
  }

  // After the restart: only what a person does.
  const storeAfter = freshStore ? o.fresh : o.store;
  served = await o.serve(`${o.label}-after`, storeAfter);
  alice = await connect(served.origin);
  try {
    const answered = await alice.act("coordinator", conv, "updateTask_tasks", { id: taskId, question: atKill.question.id, message: `Use ${o.region}.` });
    calls.push("updateTask_tasks (the answer)");
    const answeredAt = Date.now();
    let ended = ENDED.has(row(storeAfter, taskId)?.status ?? "");
    for (const until = answeredAt + 90_000; !ended && Date.now() < until; ) {
      await sleep(5_000);
      await alice.act("coordinator", conv, "listTasks_tasks", {}, 30_000);
      calls.push("listTasks_tasks");
      ended = ENDED.has(row(storeAfter, taskId)?.status ?? "");
    }
    const endedIn = Date.now() - answeredAt;
    await quiet(storeAfter);
    const finished = row(storeAfter, taskId);

    // A second answer to the same question, on the finished task.
    const before = JSON.stringify(taskRows(storeAfter, ALICE.userId, ORG));
    const second = await alice.act("coordinator", conv, "updateTask_tasks", { id: taskId, question: atKill.question.id, message: `Use ${pick(["eu-west", "us-east"])} instead.` });
    calls.push("updateTask_tasks (a second answer)");
    await quiet(storeAfter);
    const secondWroteNothing = before === JSON.stringify(taskRows(storeAfter, ALICE.userId, ORG));

    // The finished session's door, found as an app finds it.
    const found = taskId === undefined || filingSessionId === undefined ? undefined : await alice.app.findWorkerSession({ worker: "desk.ops", taskId, filingSessionId }).catch(() => undefined);
    calls.push("findWorkerSession");
    const asked = found?.id === undefined ? null : await alice.act("agent", found.id, "respond", { message: LEG_B_QUESTION });
    if (asked !== null) calls.push(`run "${LEG_B_QUESTION}"`);
    // The question is talk in a finished task's session (FIX-2086): its reply is
    // the action's answer, and the task is left as it ended.
    await quiet(storeAfter);
    await sleep(5_000);
    await quiet(storeAfter);
    const afterAll = row(storeAfter, taskId);
    return { conv, taskId, filed, parked, atKill, killedAfterMs, storeAfter, answered, endedIn, finished, second, secondWroteNothing, found, asked, afterAll, calls };
  } finally {
    await served.stop();
  }
}

// ---- grading -----------------------------------------------------------------------------

function grade(o: Awaited<ReturnType<typeof attempt>>, region: string): { failures: string[]; notes: string[] } {
  const failures: string[] = [];
  const parkedRow = o.atKill.row;
  if (o.atKill.question === undefined) {
    failures.push(`kill:parked — wanted the row held on its question when SIGKILL went out; the dead server left ${show(parkedRow?.status)} (filing ${show(o.filed.output ?? o.filed.error)})`);
  }
  if (o.answered.output?.ok !== true) failures.push(`j:answered — after the restart updateTask_tasks answered ${show(o.answered.output ?? o.answered.error ?? o.answered.status)}`);

  const store = o.storeAfter;
  const task = o.finished;
  const parkedSession = parkedRow?.run?.sessionId;
  if (task?.status !== "completed" || o.endedIn > 90_000) failures.push(`j:completed — wanted completed within 90 s of the answer; it is ${task?.status} after ${o.endedIn} ms`);
  if (parkedSession === undefined || task?.run?.sessionId !== parkedSession) {
    failures.push(`j:same-session — wanted it to complete in the session that asked (${parkedSession}); it ran in ${task?.run?.sessionId}`);
  }

  const all = existsSync(store) ? sessions(store) : [];
  // The ticket is the one draw the dead server's store held at the kill; after the restart that same record must be the only one.
  const drawn = o.atKill.draws[0];
  const ticket = drawn?.ticket;
  const draws = drawsIn(store);
  const names = (text: unknown, value: string | undefined) => value !== undefined && typeof text === "string" && text.toUpperCase().includes(value.toUpperCase());
  const outputText = (t: StoredTask | undefined) => (typeof t?.output === "string" ? t.output : JSON.stringify(t?.output ?? ""));
  if (!names(outputText(task), ticket)) failures.push(`j:names-ticket — wanted the output to name the ticket drawn before the kill (${ticket}); it said ${show(task?.output)}`);
  if (!names(outputText(task), region)) failures.push(`j:names-region — wanted the output to name the answered region (${region}); it said ${show(task?.output)}`);
  const same = draws.length === 1 && draws[0]!.ticket === ticket && draws[0]!.item === drawn?.item && draws[0]!.session === drawn?.session;
  if (!same) failures.push(`j:one-draw — wanted the one draw persisted at the kill (${show(drawn)}) to be the only draw after the restart; the store holds ${show(draws)}`);

  const keys = (all.find((s) => s.id === o.conv)?.state.taskNotices as string[] | undefined) ?? [];
  // Keys are `taskId:attempt:ending`; count up to the answered attempt.
  const completedNotices = keys.filter((k) => o.taskId !== undefined && k.startsWith(`${o.taskId}:`) && k.endsWith(":completed") && Number(k.split(":").at(-2)) <= (task?.attempts ?? 0));
  if (completedNotices.length !== 1) failures.push(`j:one-completed — wanted one completed notice for the answered attempt; ${show(completedNotices)}`);

  if (o.second.output?.ok !== false || !o.secondWroteNothing) {
    failures.push(`j:second-answer — wanted a second answer declined with nothing written; it answered ${show(o.second.output ?? o.second.error)}, rows ${o.secondWroteNothing ? "unchanged" : "CHANGED"}`);
  }

  // The question is talk in the finished task's session (FIX-2086): the reply
  // names the ticket from the session's history, and the task is as it ended.
  if (o.found?.id !== parkedSession || o.asked?.status !== "completed" || !names(JSON.stringify(o.asked?.output ?? ""), ticket)) {
    failures.push(`j:still-answers — wanted "${LEG_B_QUESTION}" in the task's own session (${parkedSession}, found ${o.found?.id}) answered with ${ticket}; it answered ${show(o.asked?.output ?? o.asked?.error)}, ${o.asked?.status}`);
  }
  const standing = (t: StoredTask | undefined) => show(t && { status: t.status, attempts: t.attempts, output: t.output, session: t.run?.sessionId });
  if (task === undefined || standing(o.afterAll) !== standing(task)) {
    failures.push(`j:unchanged — wanted the task as it ended after the question, its output included; ${standing(task)} → ${standing(o.afterAll)}`);
  }

  const notes = [
    `killed ${o.killedAfterMs} ms after the filing, the dead server leaving the row ${parkedRow?.status} in ${parkedSession} ${o.atKill.question === undefined ? "with no open question" : `held on question ${o.atKill.question.id}`} and the draw ${show(drawn)}`,
    `restarted on ${o.storeAfter}; answer: ${show(o.answered.output ?? o.answered.error)}; region ${region}; ticket ${ticket}; draws ${draws.length}`,
    `task ${o.taskId} ${task?.status} in ${task?.run?.sessionId} ${o.endedIn} ms after the answer, attempts ${task?.attempts}; output ${show(task?.output)}`,
    `second answer: ${show(o.second.output ?? o.second.error)}, rows ${o.secondWroteNothing ? "unchanged" : "changed"}`,
    `still answers: ${show(o.asked?.output)}; row after: ${o.afterAll?.status}, attempts ${o.afterAll?.attempts}`,
    `Alice's calls: ${o.calls.join(", ")}`,
  ];
  return { failures, notes };
}

// ---- the run -----------------------------------------------------------------------------

await runGoal(async () => {
  const keys = keysServing(MODEL);
  if (!keys.some((k) => (process.env[k] ?? "") !== "")) {
    return { failures: [`blocked: no key serves ${MODEL}; none of ${keys.join(", ")} is set`], evidence: "" };
  }
  if ((process.env.AI_GATEWAY_API_KEY ?? "") === "") {
    return { failures: [`blocked: leg b's Lab reaches ${MODEL} through the AI Gateway, and AI_GATEWAY_API_KEY is not set`], evidence: "" };
  }
  const { brief, regions } = fromLegB();
  mkdirSync(join(SCRATCH, "stores"), { recursive: true });
  if (freshStore) say(`control fresh-store: ${CONTROL_DOES}`);

  say("building Shift Manager's pages");
  const pages = await buildShiftManagerPages(join(SCRATCH, "pages"), join(REPO_ROOT, "packages", "shift-manager"));
  const serve = (label: string, store: string) =>
    startShiftManager({
      scratch: SCRATCH,
      label,
      config: join(LEG_B, "lab", "fsdev.config.mts"),
      pages,
      env: { GOAL_STORE: store },
      root: join(REPO_ROOT, "packages", "shift-manager"),
      tsx: join(REPO_ROOT, "node_modules", ".bin", "tsx"),
      timeoutMs: 180_000,
    });

  const attempts = goalAttempts(freshStore ? 1 : 3);
  let result = { failures: ["no attempt ran"], notes: [] as string[] };
  let passedOn = 0;
  let reached = !freshStore;
  for (let n = 1; n <= attempts; n += 1) {
    const label = `j4-${controlName || "plain"}-${n}`;
    const store = join(SCRATCH, "stores", `${RUN_STAMP}-${label}.sqlite`);
    const fresh = join(SCRATCH, "stores", `${RUN_STAMP}-${label}-fresh.sqlite`);
    const region = pick(regions);
    say(`attempt ${n} of ${attempts}: store ${store}${freshStore ? `, restarting on ${fresh}` : ""}, desk.ops on ${MODEL}`);
    try {
      const observed = await attempt({ serve, store, fresh, label, brief, region });
      // The control reached the server only if the restart opened the new file.
      if (freshStore) reached = existsSync(fresh);
      result = grade(observed, region);
    } catch (error) {
      result = { failures: [`setup — ${error instanceof Error ? (error.stack ?? error.message).slice(0, 1500) : String(error)}`], notes: [] };
    }
    for (const note of result.notes) say(`attempt ${n}: ${note}`);
    say(`attempt ${n}: ${result.failures.length === 0 ? "PASS" : `FAIL (${[...new Set(result.failures.map((f) => f.split(" — ")[0]))].join(", ")})`}`);
    for (const failure of result.failures) say(`attempt ${n}: ${failure}`);
    if (result.failures.length === 0) {
      passedOn = n;
      break;
    }
  }

  const failures = [...result.failures];
  if (freshStore) {
    if (!reached) failures.unshift("control fresh-store: the restarted server never opened the fresh store file, so the control didn't reach it");
    const named = failures.some((f) => f.startsWith("j:answered "));
    const killGreen = !failures.some((f) => f.startsWith("kill:parked "));
    failures.unshift(
      named && killGreen
        ? "control fresh-store: j:answered failed, as it must"
        : `control fresh-store: j:answered did NOT fail with kill:parked green, so the check can't see what the control removes`,
    );
  }
  return { failures, evidence: `J4 PASS on attempt ${passedOn} of ${attempts}, desk.ops on ${MODEL}, SQLite, SIGKILL while held on its question; ${result.notes.join("; ")}` };
});
