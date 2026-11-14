/**
 * Goal check: in the Teammates lab, a coding task you accept with **Open a PR**
 * stays open until that pull request merges (FIX-2578). The accept pushes the
 * run's branch and opens the pull request; the task then waits on it. A steer
 * from its popup's box is one more run on the same attempt and session, whose
 * commit comes back for your review; Open a PR again pushes it to the same pull
 * request and the task waits again. Once GitHub says merged, a steer completes
 * it with no run.
 * What this run proves is `goal.md` beside it.
 *
 * Model-free: `fsdev dev --app @flow-state-dev/teammates`, every coding run on
 * harness-manager's scripted coder (`GOAL_HARNESS=stub`), the run's judge with
 * no model (it gives no verdict and never fails a run), and the GitHub stand-in
 * (`goals/lib/github-stub`): the working folder's `origin` is GitHub-shaped, a
 * stub `ssh` takes the push to a local bare repository, and a stub `gh` opens
 * and reads the pull request.
 *
 * Control (`GOAL_CONTROL=no-wait`, same command): the coder flow built without
 * `awaitPullRequests`, a scratch patch applied as the server loads. Must FAIL
 * a:open (the accept completes the task).
 *
 * Run: pnpm tsx goals/teammates-lab/a-pr-task-waits-for-its-merge/run.mts
 */
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createClient } from "@flow-state-dev/client";
import { reviewDetail } from "@flow-state-dev/harness-manager/browser";
import { createInboxClient, inboxItems, taskActionName, taskListViewRef, type InboxHold, type InboxTaskInput } from "@flow-state-dev/orchestration/inbox";
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";
import { assertPatched, describePatches, goalTmpDir, loadFixture, modulePatchEnv, REPO_ROOT, runGoal, stopProcessGroup, type ModulePatch } from "../../lib/index.mts";
import { githubStub, stubPullRequestUrl } from "../../lib/github-stub.mts";
import { itemsOf, sleep, startTeammates } from "../lab.mts";

const fixture = loadFixture<{ filer: string; coder: string; task: { title: string; goal: string }; steer: string; merged: string }>(import.meta.url);
const CONTROL = process.env.GOAL_CONTROL ?? "";
const USER = "u_goal";
const BOARD = "tasks";
const CREATE_TASK = taskActionName("createTask", BOARD);
const GET_TASK = taskActionName("getTask", BOARD);
const UPDATE_TASK = taskActionName("updateTask", BOARD);
/** The scripted coder's pause before each of its five steps. */
const STEP_MS = 300;
/** How long a run, its judge and its settle have to land a row where a leg looks. */
const SETTLE_MS = 120_000;
/** The scripted coder's first step: one per harness run, in the run session's items. */
const FIRST_STEP = "Reading the worker's instructions, brief and conventions.";

const CONTROLS: Record<string, ModulePatch[]> = {
  "": [],
  "no-wait": [{ module: "packages/harness-manager/src/kit/coder-flow.ts", from: "awaitPullRequests: options.pullRequests !== false,", to: "awaitPullRequests: false," }],
};
if (!(CONTROL in CONTROLS)) throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(CONTROLS).filter(Boolean).join(", ")}`);
const PATCHES = CONTROLS[CONTROL]!;

type Row = InboxTaskInput & { attempts?: number; output?: Record<string, any> | null; error?: string | null; run?: { sessionId: string } | null };

await runGoal(async (failures, tell) => {
  if (PATCHES.length > 0) console.error(describePatches(PATCHES, REPO_ROOT));
  const scratch = goalTmpDir("teammates-pr-wait");
  const mark = join(scratch, "patched.txt");
  const github = githubStub(scratch);
  const workdir = github.checkout(join(scratch, "workdir"), { "NOTES.md": "# Notes\n" });
  const notes: string[] = [];
  const lab = await startTeammates(
    scratch,
    USER,
    {
      GOAL_HARNESS: "stub",
      GOAL_HARNESS_STEP_MS: String(STEP_MS),
      ...github.env,
      AI_GATEWAY_API_KEY: "",
      OPENAI_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      OPENROUTER_API_KEY: "",
      ...(PATCHES.length > 0 ? modulePatchEnv(PATCHES, REPO_ROOT, mark) : {}),
    },
    workdir,
  );
  try {
    const fsd = createClient({ userId: USER, baseUrl: lab.origin });
    const session = await createWorkforceClient(fsd).ensureWorkerSession({ worker: fixture.filer });
    const flow = session.flowId ?? session.flowKind;
    const act = async (action: string, input: unknown): Promise<any> => {
      const sent = await fsd.flow(flow).send(action, input, { sessionId: session.id });
      const ended = (await sent.wait()) as { id?: string };
      const requests = (await fsd.sessions.requests(session.id, { limit: 50, includeResultOutput: true })) as Array<{ id: string; result?: { output?: unknown } }>;
      return requests.find((request) => request.id === ended.id)?.result?.output;
    };
    const rowOf = async (id: string): Promise<Row | undefined> => {
      const listed = (await fsd.view(taskListViewRef(flow, BOARD), {}, { sessionId: session.id })).value as Row[];
      return listed.find((row) => row.id === id);
    };
    const until = async (id: string, done: (row: Row) => boolean, ms = SETTLE_MS) => {
      let row: Row | undefined;
      for (const end = Date.now() + ms; Date.now() < end; await sleep(1_000)) {
        row = await rowOf(id);
        if (row !== undefined && done(row)) return row;
      }
      return row;
    };
    const externalOf = (row: Row | undefined) => (row?.holds ?? []).find((h: any) => h.actor === "system" && h.ask?.kind === "external") as any;
    const reviewOf = (row: Row | undefined) => (row?.holds ?? []).find((h) => h.source.kind === "suspension" && h.ask.kind === "review");
    const runsIn = async (runSession: string) => (await itemsOf(fsd, runSession)).filter((item) => JSON.stringify(item).includes(FIRST_STEP)).length;
    const inbox = createInboxClient(fsd);
    const board = inbox.board({ flowId: flow, sessionId: session.id, board: BOARD });

    // ── setup: file the task; its scripted run commits and waits for your review.
    const filed = await act(CREATE_TASK, { assignee: fixture.coder, ...fixture.task });
    if (filed?.ok !== true || typeof filed.taskId !== "string") throw new Error(`setup: createTask refused: ${JSON.stringify(filed)}`);
    const id: string = filed.taskId;
    const held = await until(id, (r) => reviewOf(r) !== undefined || !["pending", "in_progress"].includes(r.status));
    if (held === undefined || reviewOf(held) === undefined) throw new Error(`setup: the task never waited for its review: ${JSON.stringify({ status: held?.status, error: held?.error })}`);
    const runSession = held.run!.sessionId;
    const stops = (await itemsOf(fsd, runSession)).filter((item) => item.type === "suspension" && (item as { kind?: string }).kind === "review");
    const review = reviewDetail((stops.at(-1) as { data?: unknown } | undefined)?.data);
    const offered: string[] = review?.lands ?? [];
    // A precondition, not a leg: without it the accept below can't open a pull request.
    if (!offered.includes("pull-request")) throw new Error(`setup: the review offers ${JSON.stringify(offered)}, not Open a PR; the GitHub-shaped origin wasn't pinned`);

    /** Accept the row's open review with Open a PR, as the popup's button answers it, and read the row once it moved on. */
    const openAPr = async (row: Row) => {
      const [item] = inboxItems({ rows: [{ ...row, board: session.id, holder: { sessionId: session.id, action: UPDATE_TASK } }], suspensions: [], flowOf: (s) => (s === session.id ? flow : runFlow) });
      const hold = item?.holds.find((h) => h.ask.kind === "review") as InboxHold | undefined;
      if (hold === undefined) throw new Error(`the Inbox reads no review on ${row.id}`);
      await inbox.answerOne(hold, { value: { verdict: "accepted", land: "pull-request" } });
      return await until(id, (r) => externalOf(r) !== undefined || !["pending", "in_progress"].includes(r.status) || (reviewOf(r) !== undefined && reviewOf(r)!.id !== hold.id));
    };
    const runFlow = (await fsd.sessions.get(runSession)).flowId ?? (await fsd.sessions.get(runSession)).flowKind ?? null;

    // ── a: Accept with Open a PR: the branch is pushed, PR 7 opened, and the task waits on it.
    const accepted = await openAPr(held);
    const pr = github.pullRequest(7);
    const pushed = execFileSync("git", ["branch", "--list"], { cwd: github.bare }).toString();
    tell.over("a:ssh · the stub ssh's calls", github.sshCalls());
    if (pr === undefined || !pushed.includes(pr.branch ?? "\0")) failures.push(`a:pushed: no pull request 7 opened from a branch pushed to the remote (stub: ${JSON.stringify(github.pullRequests())}; remote branches: ${pushed.trim()})`);
    const wait = externalOf(accepted);
    let waiting = false;
    if (accepted?.status !== "in_progress" || wait === undefined) {
      failures.push(`a:open: after Open a PR the row reads ${accepted?.status}${wait === undefined ? ", with no external hold" : ""}, not in_progress waiting on its pull request`);
    } else if (!(wait.source?.closedBy ?? []).some((r: any) => r.by === "event" && r.event === "pull-request" && String(r.key).endsWith("/7"))) {
      failures.push(`a:open: the wait names no pull request 7: ${JSON.stringify(wait.source)}`);
    } else {
      waiting = true;
      notes.push(`a: Open a PR pushed ${pr?.branch} and opened #7; in_progress on attempt ${accepted.attempts}, hold ${wait.id}`);
    }
    const landed = (await act(GET_TASK, { id }))?.task?.output?.landed;
    if (waiting && landed !== undefined && landed !== null) notes.push(`a: output.landed ${JSON.stringify(landed)}`);

    // ── b: a steer, as the popup's Steer box sends it: one run on the same attempt and session, whose
    //    commit goes back to your review; Open a PR again pushes it to PR 7, and the task waits on it again.
    if (waiting) {
      const runsBefore = await runsIn(runSession);
      await board.steer(id, fixture.steer);
      const reviewed = await until(id, (r) => r.status !== "in_progress" || reviewOf(r) !== undefined || (externalOf(r) !== undefined && externalOf(r).id !== wait.id));
      const runs = (await runsIn(runSession)) - runsBefore;
      if (reviewed?.status !== "in_progress" || reviewOf(reviewed) === undefined) {
        failures.push(`b:steer: after the steer the row reads ${reviewed?.status}${externalOf(reviewed) === undefined ? " with no open hold" : ""}, not back on your review of the steered run`);
        waiting = false;
      } else {
        if (runs !== 1) failures.push(`b:one-run: ${runs} harness runs in the run session, not 1`);
        if (reviewed.attempts !== accepted?.attempts) failures.push(`b:same-attempt: attempt ${reviewed.attempts}, was ${accepted?.attempts}`);
        if (reviewed.run?.sessionId !== runSession) failures.push(`b:same-session: the run moved to session ${reviewed.run?.sessionId}`);
        const again = await openAPr(reviewed);
        const hold = externalOf(again);
        const opened = Object.keys(github.pullRequests());
        if (again?.status !== "in_progress" || hold === undefined || !(hold.source?.closedBy ?? []).some((r: any) => String(r.key).endsWith("/7"))) {
          failures.push(`b:waits-again: after Open a PR again the row reads ${again?.status}${hold === undefined ? " with no external hold" : ""}, not waiting on PR 7`);
          waiting = false;
        } else {
          if (opened.length !== 1) failures.push(`b:one-pr: the stub holds pull requests ${opened.join(", ")}, not PR 7 alone`);
          notes.push(`b: ${runs} run, attempt ${again.attempts}, session kept, back to review; Open a PR again: waiting on #7 (${hold.id}), ${opened.length} PR`);
        }
      }
    } else failures.push("b: not reached, the task never waited");

    // ── c: GitHub says merged; a steer completes the task with PR 7 on its output, and runs nothing.
    if (waiting) {
      github.set(7, "merged");
      const runsBefore = await runsIn(runSession);
      await board.steer(id, fixture.merged);
      await until(id, (r) => r.status !== "in_progress");
      await sleep(2_000);
      const task = (await act(GET_TASK, { id }))?.task as Row | undefined;
      const runs = (await runsIn(runSession)) - runsBefore;
      if (task?.status !== "completed") failures.push(`c:completed: the row reads ${task?.status}, not completed`);
      else if (!((task.output?.pullRequests ?? []) as any[]).some((p) => p.number === 7 && p.state === "merged" && p.url === stubPullRequestUrl(7))) {
        failures.push(`c:completed: the output names no merged PR 7: ${JSON.stringify(task.output?.pullRequests)}`);
      }
      if (runs !== 0) failures.push(`c:no-run: ${runs} harness runs after the merge, not 0`);
      if (task?.status === "completed" && runs === 0) notes.push(`c: completed with ${JSON.stringify(task.output?.pullRequests)}, no run`);
    } else failures.push("c: not reached, the task was not waiting");

    notes.push(`gh: ${github.ghCalls().length} calls, ssh: ${github.sshCalls().length}`);
    if (PATCHES.length > 0) assertPatched(PATCHES, REPO_ROOT, mark);
    return { failures, evidence: notes.join("; ") };
  } finally {
    stopProcessGroup(lab.child);
  }
});
