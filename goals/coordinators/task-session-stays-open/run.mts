/**
 * Goal check: a task that stops on a question carries on in its own session
 * once answered, and finishes from there; once finished, that session still
 * answers a question about what it did, and takes a follow-up task that runs
 * in it (FIX-1817). See goal.md.
 *
 * One person on a goal-local Lab (`lab/`), served by Shift Manager's own
 * command over HTTP, on the real engine and a SQLite store. The worker runs on
 * a real model; its task draws a ticket with a goal-local tool, once, so only
 * the session that drew it can name it. Every grade reads the store file the
 * run wrote (`../files-tasks-down-the-owners-chain/store.mts`), except what an
 * action answered, which is what the person saw.
 *
 * Run:      pnpm tsx goals/coordinators/task-session-stays-open/run.mts
 * Controls: GOAL_CONTROL=new-session | drop-answer
 * Attempts: GOAL_ATTEMPTS=<n> fresh Labs, until it first passes (default 3; 1 under a control)
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, RUN_STAMP, goalTmpDir, keysServing, runGoal } from "../../lib/index.mts";
import { assertPatched, describePatches, modulePatchEnv, type ModulePatch } from "../../lib/module-patch.mts";
import { buildShiftManagerPages, startShiftManager } from "../../lib/shift-manager.mts";
import { loadScriptedClients } from "../files-tasks-down-the-owners-chain/scripted.mts";
import { items, requests, sessions, taskRows, textOf, toolOutput, type StoredTask } from "../files-tasks-down-the-owners-chain/store.mts";
import { ALICE, ORG } from "./lab/people.mts";

const HERE = new URL(".", import.meta.url).pathname;
const SCRATCH = goalTmpDir("task-session-stays-open");
const MODEL = "openai/gpt-5.4-mini";
const say = (s: string) => console.error(`[stays-open ${new Date().toISOString().slice(11, 19)}] ${s}`);
const show = (value: unknown) => JSON.stringify(value)?.slice(0, 600);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const pick = <T,>(list: readonly T[]): T => list[randomBytes(1)[0]! % list.length]!;

// ---- held out, picked at run time ---------------------------------------------------

const REGIONS = ["eu-west", "ap-south", "us-east", "sa-east", "eu-north", "ca-central"] as const;
const FOLLOW_UPS = [
  "Now write the deployment up for the change log in one line, and name its ticket.",
  "Next, draft a one-line rollback note for that deployment, and include its ticket.",
  "Now post a one-line status update about the deployment you did, naming its ticket.",
] as const;
const BRIEF =
  "Deploy the billing service. First draw a deployment ticket with drawTicket. Then, before deploying, " +
  "ask the person who assigned this which region to deploy to, with parkOnQuestion, and stop there. " +
  "Once you have the answer, finish with one line that names the ticket you drew and the region.";
const LEG_B = "Which ticket did you draw?";

// ---- controls -------------------------------------------------------------------------

interface Control {
  name: string;
  assertions: string[];
  patches: ModulePatch[];
  does: string;
}

const CONTROLS: Record<string, Control> = {
  "new-session": {
    name: "new-session",
    assertions: ["a:names-ticket", "c:names-ticket"],
    patches: [
      {
        module: "packages/workforce/src/conversation-board/board.ts",
        from: String.raw`return taskSessionKey\(claim\?\.followUpOf \?\? payload\.taskId, worker\);`,
        to: "return taskSessionKey(`${payload.taskId}#${payload.attempts}`, worker);",
      },
    ],
    does: "every attempt, and every follow-up, is handed to a fresh session: the answer's re-entry and the follow-up run where nothing was done",
  },
  "drop-answer": {
    name: "drop-answer",
    assertions: ["a:names-region"],
    patches: [
      {
        module: "packages/workforce/src/conversation-board/task-entry.ts",
        from: String.raw`if \(task\.answer !== (?:undefined|void 0)\) return`,
        to: "if (false) return",
      },
    ],
    does: "the answer re-queues the task in its session, but the re-entered turn is handed the task again, not the answer",
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

async function drive(origin: string, store: string) {
  const shipped = await loadScriptedClients(REPO_ROOT);
  const fetcher: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${ALICE.bearer}`);
    return fetch(input, { ...init, headers });
  };
  const transport = { baseUrl: origin, fetcher };
  const sessionsApi = shipped.client.createSessionClient(transport);
  const app = shipped.workforce.createWorkforceClient({ userId: ALICE.userId, ...transport });
  const flow = (flowKind: string) => shipped.client.createClient({ flowKind, userId: ALICE.userId, ...transport });

  const act = async (flowKind: string, sessionId: string, action: string, input: unknown, timeoutMs = 120_000): Promise<Acted> => {
    const client = flow(flowKind);
    let requestId: string;
    try {
      requestId = (await client.sendAction(action, input, { sessionId })).request.id;
    } catch (error) {
      return { status: "http", requestId: null, output: undefined, error: error instanceof Error ? error.message : String(error) };
    }
    let status = "timed-out";
    for (const until = Date.now() + timeoutMs; Date.now() < until; await sleep(100)) {
      const now = (await client.getRequestStatus(requestId).catch(() => undefined))?.status as string | undefined;
      if (now !== undefined && TERMINAL.has(now)) {
        status = now;
        break;
      }
    }
    const listed = (await sessionsApi.listSessionRequests(sessionId, { includeResultOutput: true, limit: 200 }).catch(() => [])) as any[];
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

  const region = pick(REGIONS);
  const followUp = pick(FOLLOW_UPS);
  const conv = (await sessionsApi.createSession({ flowKind: "coordinator", userId: ALICE.userId, state: { workerId: "desk.lead" } })).id as string;
  const filingSessionId = (await act("coordinator", conv, "listDelegates", {})).output?.filingSessionId as string | undefined;

  // Leg a: file, wait for the park, answer, wait for the ending.
  const filed = await act("coordinator", conv, "addTask_tasks", { goal: BRIEF, assignee: "desk.ops" });
  const taskId = filed.output?.taskId as string | undefined;
  const parked = await waitFor(() => row(taskId)?.status === "parked", 120_000);
  const parkedRow = row(taskId);
  await quiet();
  const answered = parked ? await act("coordinator", conv, "answerTask_tasks", { taskId, answer: `Use ${region}.` }) : null;
  const answeredAt = Date.now();
  const ended = parked && (await waitFor(() => ["completed", "errored", "cancelled"].includes(row(taskId)?.status ?? ""), 90_000));
  const endedIn = Date.now() - answeredAt;
  await quiet();

  // Leg b: the door into the finished task's session, found as an app finds it.
  const found = taskId === undefined || filingSessionId === undefined ? undefined : await app.findWorkerSession({ worker: "desk.ops", taskId, filingSessionId });
  const asked = found?.id === undefined ? null : await act("agent", found.id, "run", { message: LEG_B });
  await quiet();

  // Leg c: a follow-up task naming the finished one.
  const follow = taskId === undefined ? null : await act("coordinator", conv, "addTask_tasks", { goal: followUp, followUpOf: taskId });
  const followId = follow?.output?.taskId as string | undefined;
  await waitFor(() => ["completed", "errored", "cancelled"].includes(row(followId)?.status ?? ""), 120_000);
  await quiet();
  await sleep(5_000);
  await quiet();

  return { region, followUp, conv, filingSessionId, filed, taskId, parked, parkedRow, answered, ended, endedIn, found, asked, follow, followId };
}

// ---- grading ----------------------------------------------------------------------------

function grade(o: Awaited<ReturnType<typeof drive>>, store: string): { failures: string[]; notes: string[] } {
  const failures: string[] = [];
  const notes: string[] = [];
  const rows = taskRows(store, ALICE.userId, ORG);
  const task = rows.find((t) => t.id === o.taskId) as (StoredTask & { turnReentries?: number; abandonments?: number }) | undefined;
  const follow = rows.find((t) => t.id === o.followId) as (StoredTask & { followUpOf?: string }) | undefined;
  const all = sessions(store);
  const parkedSession = o.parkedRow?.run?.sessionId;

  // The ticket, as the tool drew it: every drawTicket output in every session.
  const draws = all.flatMap((s) => items(store, s.id, "tool_output").filter((i) => i.toolCall?.name === "drawTicket").map((i) => ({ session: s.id, out: toolOutput(i) })));
  const ticket = draws[0]?.out?.ticket as string | undefined;
  const names = (text: unknown, value: string | undefined) => value !== undefined && typeof text === "string" && text.toUpperCase().includes(value.toUpperCase());
  const outputText = (t: StoredTask | undefined) => (typeof t?.output === "string" ? t.output : JSON.stringify(t?.output ?? ""));

  // Notices the conversation acted on, by task and ending.
  const conv = all.find((s) => s.id === o.conv);
  const keys = (conv?.state.taskNotices as string[] | undefined) ?? [];
  const noticesOf = (id: string | undefined, ending: string) => keys.filter((k) => id !== undefined && k.startsWith(`${id}:`) && k.endsWith(`:${ending}`));

  // Leg a.
  if (!o.parked || noticesOf(o.taskId, "parked").length !== 1) {
    failures.push(`a:parked — wanted the task to park on its question with one parked notice; filing ${show(o.filed.output ?? o.filed.error)}, row ${show(o.parkedRow?.status)}, notices ${show(noticesOf(o.taskId, "parked"))}`);
  }
  if (o.answered?.output?.ok !== true) failures.push(`a:answered — answerTask_tasks answered ${show(o.answered?.output ?? o.answered?.error)}`);
  if (task?.status !== "completed" || o.endedIn > 90_000) failures.push(`a:completed-90s — wanted completed within 90 s of the answer; it is ${task?.status} after ${o.endedIn} ms`);
  if (parkedSession === undefined || task?.run?.sessionId !== parkedSession) {
    failures.push(`a:same-session — wanted the answer's re-entry in the session that parked (${parkedSession}); it ran in ${task?.run?.sessionId}`);
  }
  if (!names(outputText(task), ticket)) failures.push(`a:names-ticket — wanted the output to name the ticket drawn before the question (${ticket}); it said ${show(task?.output)}`);
  if (!names(outputText(task), o.region)) failures.push(`a:names-region — wanted the output to name the answered region (${o.region}); it said ${show(task?.output)}`);
  if (noticesOf(o.taskId, "completed").length !== 1) failures.push(`a:one-completed — wanted one completed notice; ${show(noticesOf(o.taskId, "completed"))}`);
  const charged = (task?.attempts ?? 0) - (task?.turnReentries ?? 0) - (task?.abandonments ?? 0);
  if (charged !== 1) failures.push(`a:unspent — wanted the answer's re-entry not charged: one attempt charged; attempts ${task?.attempts}, re-entries ${task?.turnReentries}`);

  // Leg b.
  const reply = o.asked === null ? "" : items(store, o.found!.id, "message").filter((m) => m.requestId === o.asked!.requestId && m.role === "assistant").map(textOf).join("\n");
  if (o.found?.id !== parkedSession || !names(reply, ticket)) {
    failures.push(`b:names-ticket — wanted the task's own session (${parkedSession}, found ${o.found?.id}) to answer "${LEG_B}" with the ticket ${ticket}; it said ${show(reply)} (${o.asked?.status})`);
  }

  // Leg c.
  if (follow === undefined || follow.status !== "completed" || follow.followUpOf !== o.taskId) {
    failures.push(`c:completed — wanted a follow-up of ${o.taskId} to complete; filing ${show(o.follow?.output ?? o.follow?.error)}, row ${show(follow && { status: follow.status, followUpOf: follow.followUpOf })}`);
  }
  if (follow?.run?.sessionId === undefined || follow.run.sessionId !== parkedSession) {
    failures.push(`c:same-session — wanted the follow-up in the task's session (${parkedSession}); it ran in ${follow?.run?.sessionId}`);
  }
  if (!names(outputText(follow), ticket)) failures.push(`c:names-ticket — wanted the follow-up's output to name the ticket (${ticket}); it said ${show(follow?.output)}`);
  if (draws.length !== 1) failures.push(`c:one-draw — wanted drawTicket to run once in total; it ran ${draws.length} time(s): ${show(draws)}`);
  if (noticesOf(o.followId, "completed").length !== 1) failures.push(`c:one-completed — wanted one completed notice for the follow-up; ${show(noticesOf(o.followId, "completed"))}`);

  notes.push(
    `region ${o.region}; ticket ${ticket}; task ${o.taskId} ${task?.status} in ${task?.run?.sessionId} (parked in ${parkedSession}), attempts ${task?.attempts}, re-entries ${task?.turnReentries}, ended ${o.endedIn} ms after the answer; output ${show(task?.output)}`,
    `b: ${show(reply)}`,
    `c: "${o.followUp}" → ${follow?.status} in ${follow?.run?.sessionId}; output ${show(follow?.output)}; draws ${draws.length}`,
  );
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
  const attempts = Number(process.env.GOAL_ATTEMPTS ?? (control === undefined ? 3 : 1));
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
      say(`attempt ${attempt} of ${attempts}: the Lab at ${served.origin}, store ${store}, desk.ops on ${MODEL}`);
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
    evidence: `legs a, b, c PASS on attempt ${passedOn} of ${attempts}, desk.ops on ${MODEL} through Shift Manager's command`,
  };
});
