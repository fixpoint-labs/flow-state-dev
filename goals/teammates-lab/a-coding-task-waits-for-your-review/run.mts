/**
 * Goal check: a coding task in the Teammates lab waits for your review, and
 * your answer decides what happens next (FIX-2380). Against
 * `fsdev dev --app @flow-state-dev/teammates`, over HTTP, on a real Cursor run
 * and the real goal judge. See goal.md for the contract.
 *
 * - *review*: a run that committed holds its task on a review, open (not
 *   completed), whose stop names its branch, its commits and the judge's verdict.
 * - *revise*: Ask for changes, with words, runs once more in the same run
 *   session on attempt 1, which commits again and is reviewed again.
 * - *accept*: Accept completes the task with `review: "accepted"`.
 *
 * Control (same command): `GOAL_CONTROL=no-review` builds the coding flow
 * without `reviewChanges`; *review* must FAIL, the task completing on its commit.
 *
 * Run: pnpm tsx goals/teammates-lab/a-coding-task-waits-for-your-review/run.mts
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@flow-state-dev/client";
import { reviewDetail, type ReviewDetail } from "@flow-state-dev/harness-manager/browser";
import { createInboxClient, inboxItems, type InboxHold, type InboxRow } from "@flow-state-dev/orchestration/inbox";
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";
import {
  assertPatched,
  describePatches,
  goalTmpDir,
  loadFixture,
  modulePatchEnv,
  REPO_ROOT,
  runGoal,
  stopProcessGroup,
  type ModulePatch,
} from "../../lib/index.mts";
import { itemsOf, sleep, startTeammates, type Fsd } from "../lab.mts";

const fixture = loadFixture<{ filer: string; coder: string; task: { title: string; goal: string }; revise: string }>(import.meta.url);
const CONTROL = process.env.GOAL_CONTROL ?? "";
const RUNS = Number(process.env.GOAL_RUNS ?? 1);
const USER = "u_goal";
/** The board's actions, on the conversation that files the task. */
const CREATE_TASK = "createTask_tasks";
const LIST_TASKS = "listTasks_tasks";
const GET_TASK = "getTask_tasks";
const UPDATE_TASK = "updateTask_tasks";

const CONTROLS: Record<string, ModulePatch[]> = {
  "": [],
  // The coding flow as it was before: a run that committed completes its task unreviewed.
  "no-review": [{ module: "labs/teammates/src/flows/coder.ts", from: String.raw`reviewChanges: true,`, to: "reviewChanges: false," }],
};
if (!(CONTROL in CONTROLS)) throw new Error(`unknown GOAL_CONTROL "${CONTROL}"`);
const PATCHES = CONTROLS[CONTROL]!;

type Row = InboxRow & { attempts?: number; output?: { review?: string } | null; error?: string | null };

/** The filing conversation's board rows. */
async function rows(fsd: Fsd, flow: string, sessionId: string): Promise<Row[]> {
  const listed = await fsd.flow(flow).read<{ ok: boolean; error?: string; tasks: Row[] }>(LIST_TASKS, {}, { sessionId });
  if (!listed.ok) throw new Error(`setup: listTasks refused: ${listed.error}`);
  return listed.tasks;
}

/** Run one of the board's actions on the filing conversation, and return its output. */
async function act(fsd: Fsd, flow: string, sessionId: string, action: string, input: unknown): Promise<unknown> {
  const sent = await fsd.flow(flow).send(action, input, { sessionId });
  const ended = (await sent.wait()) as { id?: string };
  const requests = (await fsd.sessions.requests(sessionId, { limit: 50, includeResultOutput: true })) as Array<{ id: string; result?: { output?: unknown } }>;
  return requests.find((request) => request.id === ended.id)?.result?.output;
}

/** Poll the task's row until `done` says so, or `ms` pass; returns the last row read. */
async function until(fsd: Fsd, flow: string, sessionId: string, taskId: string, done: (row: Row) => boolean, ms: number): Promise<Row | undefined> {
  let row: Row | undefined;
  for (const end = Date.now() + ms; Date.now() < end; await sleep(3_000)) {
    row = (await rows(fsd, flow, sessionId)).find((r) => r.id === taskId);
    if (row !== undefined && done(row)) return row;
  }
  return row;
}

const reviewHoldOf = (row: Row | undefined) => row?.holds?.find((hold) => hold.source.kind === "suspension" && hold.ask.kind === "review");
const TERMINAL = new Set(["completed", "errored", "cancelled"]);

/** The row's open review, as the Inbox reads it: where its answer goes. */
async function inboxHold(fsd: Fsd, flow: string, sessionId: string, row: Row): Promise<InboxHold> {
  const runFlow = row.run == null ? null : await fsd.sessions.get(row.run.sessionId).then((d) => d.flowId ?? d.flowKind ?? null);
  const [item] = inboxItems({
    rows: [{ ...row, board: sessionId, holder: { sessionId, action: UPDATE_TASK } }],
    suspensions: [],
    flowOf: (id) => (id === sessionId ? flow : runFlow),
  });
  const hold = item?.holds.find((h) => h.ask.kind === "review");
  if (hold === undefined) throw new Error(`setup: the Inbox reads no review on ${row.id}`);
  return hold;
}

/** The run's latest review stop's data, read as the popup reads it. */
async function latestReview(fsd: Fsd, runSession: string): Promise<ReviewDetail | null> {
  const stops = (await itemsOf(fsd, runSession)).filter((item) => item.type === "suspension" && (item as { kind?: string }).kind === "review");
  return reviewDetail((stops.at(-1) as { data?: unknown } | undefined)?.data);
}

await runGoal(async (failures, tell) => {
  if (PATCHES.length > 0) console.error(describePatches(PATCHES, REPO_ROOT));
  if (process.env.CURSOR_API_KEY === undefined || process.env.AI_GATEWAY_API_KEY === undefined) {
    throw new Error("setup: needs CURSOR_API_KEY (the run) and AI_GATEWAY_API_KEY (the judge)");
  }
  const notes: string[] = [];
  const graded: number[] = [];
  for (let n = 1; n <= RUNS; n += 1) {
    const fail = (what: string) => failures.push(`run ${n} · ${what}`);
    const dir = goalTmpDir(`a-coding-task-waits-for-your-review-${n}`);
    const mark = join(dir, "patched.txt");
    // A checkout with one commit, so a run has a HEAD to cut its branch from, that ignores `.fsdev/`.
    const workdir = join(dir, "workdir");
    mkdirSync(workdir, { recursive: true });
    writeFileSync(join(workdir, "README.md"), "# Team\n");
    // A run writes the question it needs answered under `.fsdev/ask`, which a checkout must ignore.
    writeFileSync(join(workdir, ".gitignore"), ".fsdev/\n");
    const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=goal", "-c", "user.email=goal@example.com", ...args], { cwd: workdir });
    git("init", "-q", "-b", "main");
    git("add", ".");
    git("commit", "-q", "-m", "Start the README");
    const lab = await startTeammates(dir, USER, {
      TEAMMATES_HARNESS: "cursor",
      ...(PATCHES.length > 0 ? modulePatchEnv(PATCHES, REPO_ROOT, mark) : {}),
    }, workdir);
    try {
      const me = createClient({ userId: USER, baseUrl: lab.origin });
      const session = await createWorkforceClient(me).ensureWorkerSession({ worker: fixture.filer });
      const flow = session.flowId ?? session.flowKind;
      const out = (await act(me, flow, session.id, CREATE_TASK, { assignee: fixture.coder, ...fixture.task })) as { ok?: boolean; taskId?: string; error?: string } | undefined;
      if (out?.ok !== true || out.taskId === undefined) throw new Error(`setup: createTask refused: ${JSON.stringify(out)}`);
      const taskId = out.taskId;

      // *review*: held open on a review whose stop names the commits and the judge.
      const held = await until(me, flow, session.id, taskId, (r) => reviewHoldOf(r) !== undefined || TERMINAL.has(r.status), 15 * 60_000);
      if (held === undefined || reviewHoldOf(held) === undefined) {
        fail(`review: the task never waited for a review; row ${JSON.stringify({ status: held?.status, output: held?.output, error: held?.error })}`);
        notes.push(`run ${n}: no review, status ${held?.status}`);
        graded.push(n);
        continue;
      }
      const runSession = held.run!.sessionId;
      const first = await latestReview(me, runSession);
      if (TERMINAL.has(held.status)) fail(`review: the task is ${held.status} while its review is open`);
      if (first === null || first.branch === null || (first.commits ?? 0) < 1) fail(`review: the stop doesn't name a branch and its commits: ${JSON.stringify(first)}`);
      if (first?.judge === null) fail("review: no judge's verdict on the stop");

      // *revise*: one more run, same session and attempt, reviewed again over more commits.
      const inbox = createInboxClient(me);
      await inbox.answerOne(await inboxHold(me, flow, session.id, held), { value: { verdict: "revise", words: fixture.revise } });
      const firstHold = reviewHoldOf(held)!.id;
      const again = await until(me, flow, session.id, taskId, (r) => (reviewHoldOf(r) !== undefined && reviewHoldOf(r)!.id !== firstHold) || TERMINAL.has(r.status), 15 * 60_000);
      const second = await latestReview(me, runSession);
      if (again === undefined || reviewHoldOf(again) === undefined || reviewHoldOf(again)!.id === firstHold) {
        fail(`revise: no second review after Ask for changes; row ${JSON.stringify({ status: again?.status, output: again?.output, error: again?.error })}`);
      } else {
        if (again.attempts !== 1) fail(`revise: the revision ran on attempt ${again.attempts}, not 1`);
        if (again.run?.sessionId !== runSession) fail(`revise: the revision ran in session ${again.run?.sessionId}, not ${runSession}`);
        if ((second?.commits ?? 0) <= (first?.commits ?? 0)) fail(`revise: the second review counts ${second?.commits} commits, the first ${first?.commits}`);

        // *accept*: completes, saying a person accepted it.
        await inbox.answerOne(await inboxHold(me, flow, session.id, again), { value: { verdict: "accepted" } });
        const done = await until(me, flow, session.id, taskId, (r) => TERMINAL.has(r.status), 2 * 60_000);
        // `listTasks` publishes no output; the board's `getTask` reads the row whole.
        const read = (await act(me, flow, session.id, GET_TASK, { id: taskId })) as { task?: Row } | undefined;
        const output = read?.task?.output;
        if (done?.status !== "completed" || output?.review !== "accepted") {
          fail(`accept: the task should complete with review "accepted", read ${JSON.stringify({ status: done?.status, output })}`);
        }
      }
      notes.push(`run ${n}: first ${JSON.stringify(first)}; second ${JSON.stringify(second)}`);
      if (PATCHES.length > 0) assertPatched(PATCHES, REPO_ROOT, mark);
    } finally {
      stopProcessGroup(lab.child);
    }
    graded.push(n);
  }
  tell.over("runs graded", graded);
  return { failures, evidence: `${RUNS} of ${RUNS} runs: ${notes.join("; ")}` };
});
