/**
 * Goal check, FIX-2407: the Teammates lab, crashed mid-turn and served again
 * on the same store, shows the conversation, the cut turn and the coding
 * task's next state, with no action from the person. See goal.md.
 *
 * `fsdev dev --app @flow-state-dev/teammates` on a scratch store
 * (`TEAMMATES_STORE`), its coding workers on the lab's scripted harness
 * (`GOAL_HARNESS=stub`) paced slow enough that the run is still going when
 * the host is killed. The person's turn before it is on the lab's own model.
 *
 * Run:      pnpm tsx goals/teammates-lab/survives-a-crash-mid-turn/run.mts
 * Controls: GOAL_CONTROL=fresh-store (the second serve gets a new store; `conversation` must FAIL)
 */
import { execFileSync, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@flow-state-dev/client";
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";
import { crashAndRestart, goalTmpDir, runGoal, sleep, stopProcessGroup } from "../../lib/index.mts";
import { readConversation, readCutTurn, readTaskAfterCrash, type CrashedRow } from "../../lib/crash-reads.mts";
import { startTeammates, type Fsd } from "../lab.mts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
if (!["", "fresh-store"].includes(CONTROL)) throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; known: fresh-store`);

const USER = "u_goal";
const FILER = "teammates.chief-of-staff";
const CODER = "teammates.claude-code";
/** Each of the scripted run's five steps: long enough that the run is mid-way at the kill. */
const STEP_MS = 30_000;
/** The engine's stale threshold plus a sweep, and then some: when the cut turn must be listed. */
const CUT_TURN_MS = 150_000;
/** The task's lease (the board's two minutes) plus one sweep, and then some. */
const TASK_MS = 240_000;
const say = (s: string) => console.error(`[tm-crash ${new Date().toISOString().slice(11, 19)}] ${s}`);

await runGoal(async (failures) => {
  if (process.env.AI_GATEWAY_API_KEY === undefined) throw new Error("setup: needs AI_GATEWAY_API_KEY (the person's turn)");
  const dir = goalTmpDir("tm-survives-a-crash");
  // A checkout with one commit, so a run has a HEAD to cut its worktree from.
  const workdir = join(dir, "workdir");
  mkdirSync(workdir, { recursive: true });
  writeFileSync(join(workdir, "README.md"), "# Team\n");
  writeFileSync(join(workdir, ".gitignore"), ".fsdev/\n");
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=goal", "-c", "user.email=goal@example.com", ...args], { cwd: workdir });
  git("init", "-q", "-b", "main");
  git("add", ".");
  git("commit", "-q", "-m", "Start the README");
  const env = { GOAL_HARNESS: "stub", GOAL_HARNESS_STEP_MS: String(STEP_MS) };
  const serve = (store?: string): Promise<{ child: ChildProcess; origin: string }> =>
    startTeammates(dir, USER, store === undefined ? env : { ...env, TEAMMATES_STORE: store }, workdir);

  let lab = await serve();
  try {
    let me: Fsd = createClient({ userId: USER, baseUrl: lab.origin });
    const conversation = await createWorkforceClient(me).ensureWorkerSession({ worker: FILER });
    const flow = conversation.flowId ?? conversation.flowKind;
    const said = `Reply with one short line. The code word is heron-${Date.now() % 100_000}.`;

    // An earlier turn, ended, on the lab's own model.
    const first = await me.flow(flow).send("respond", { message: said }, { sessionId: conversation.id });
    const firstEnd = await first.wait({ timeoutMs: 300_000 });
    if (firstEnd.status !== "completed") throw new Error(`setup: the person's turn ended ${firstEnd.status}`);

    // The coding task, filed as a screen files one; its run is the turn the crash cuts.
    const filed = await me.flow(flow).send("createTask_tasks", { assignee: CODER, title: "Opening hours", goal: "Add a line to README.md saying the office opens at nine, and commit it." }, { sessionId: conversation.id });
    await filed.wait({ timeoutMs: 60_000 });
    const sent = ((await me.sessions.requests(conversation.id, { limit: 50, includeResultOutput: true })) as Array<{ id: string; result?: { output?: { taskId?: string } } }>).find((r) => r.id === filed.id);
    const taskId = sent?.result?.output?.taskId;
    if (taskId === undefined) throw new Error(`setup: createTask_tasks filed nothing: ${JSON.stringify(sent?.result)}`);
    // Read, never sent: a read stores nothing and touches no board, so the row moves on its own.
    const readRow = async (): Promise<CrashedRow & { run?: { sessionId?: string } | null }> => {
      const listed = await me.flow(flow).read<{ ok: boolean; error?: string; tasks: Array<Record<string, any>> }>("listTasks_tasks", {}, { sessionId: conversation.id });
      if (!listed.ok) throw new Error(`listTasks_tasks refused: ${listed.error}`);
      return listed.tasks.find((t) => t.id === taskId) as never;
    };

    // Kill only once the run is read as running: never on a timer.
    let cut: string | undefined;
    let cutSession: string | undefined;
    let before: Awaited<ReturnType<typeof readRow>>;
    for (const until = Date.now() + 120_000; cut === undefined && Date.now() < until; await sleep(1_000)) {
      before = await readRow();
      const runSession = before?.run?.sessionId;
      if (before?.status !== "in_progress" || runSession == null) continue;
      const running = ((await me.sessions.requests(runSession, { limit: 20 })) as Array<{ id: string; status: string }>).find((r) => r.status === "in_progress");
      cut = running?.id;
      cutSession = runSession;
    }
    if (cut === undefined) throw new Error(`setup: the coding run never read as running: ${JSON.stringify(before!)}`);
    const attempts = before!.attempts ?? 1;
    say(`before the kill: ${JSON.stringify({ conversation: conversation.id, ended: first.id, cut, taskId, attempts })}`);

    const fresh = CONTROL === "fresh-store" ? join(dir, "fresh.sqlite") : undefined;
    lab = await crashAndRestart(lab.child, () => serve(fresh));
    me = createClient({ userId: USER, baseUrl: lab.origin });
    say(`served again on ${fresh === undefined ? "the same store" : "a fresh store"}`);

    const lost = await readConversation(me, conversation.id, said, [first.id, filed.id]);
    if (lost !== undefined) failures.push(`conversation — ${lost}`);
    const cutTurn = await readCutTurn(me, cutSession!, cut, CUT_TURN_MS);
    if (cutTurn !== undefined) failures.push(`cut-turn — ${cutTurn}`);
    const task = await readTaskAfterCrash(readRow, attempts, TASK_MS);
    if (task.failure !== undefined) failures.push(`task — ${task.failure}`);
    say(`after the restart: ${JSON.stringify({ status: task.row?.status, attempts: task.row?.attempts, error: task.row?.error })}`);
    return { failures, evidence: `crashed mid-run, served again; conversation ${conversation.id} kept, ${cut} listed interrupted, task ${taskId} read ${task.row?.status} on attempt ${task.row?.attempts}` };
  } finally {
    // Graded: nothing is left to keep. A graceful stop would wait out the re-claimed run's drain.
    stopProcessGroup(lab.child, "SIGKILL");
  }
});
