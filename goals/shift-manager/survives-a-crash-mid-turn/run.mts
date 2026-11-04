/**
 * Goal check, FIX-2407: Shift Manager, crashed mid-turn and served again on the
 * same store, shows the conversation, the cut turn and the coding task's next
 * state, with no action from the person. See goal.md.
 *
 * DevTeam's own profile (`teams/devteam/fsdev.config.mts`), served by Shift
 * Manager's own command on a scratch store (`DEVTEAM_STORE`), on its scripted
 * coder (`DEVFORCE_LAB_HARNESS=stub`) paced slow enough that its run is still
 * going when the host is killed. The person's turn before it is on the Shift
 * Coordinator's own model.
 *
 * Run:      pnpm tsx goals/shift-manager/survives-a-crash-mid-turn/run.mts
 * Controls: GOAL_CONTROL=fresh-store (the second serve gets a new store; `conversation` must FAIL)
 */
import { join } from "node:path";
import type { Client } from "@flow-state-dev/client";
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";
import { crashAndRestart, goalTmpDir, runGoal, sleep, stopProcessGroup } from "../../lib/index.mts";
import { readConversation, readCutTurn, readTaskAfterCrash, type CrashedRow } from "../../lib/crash-reads.mts";
import { buildShiftManagerPages, startShiftManager, SHIFT_MANAGER, type ServedShiftManager } from "../../lib/shift-manager.mts";
import { connect } from "../../../packages/shift-manager/src/lib/connection.ts";
import { LAB_USERS } from "../../../packages/shift-manager/teams/devteam/host.mts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
if (!["", "fresh-store"].includes(CONTROL)) throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; known: fresh-store`);

const SCRATCH = goalTmpDir("sm-survives-a-crash");
const CONFIG = join(SHIFT_MANAGER, "teams", "devteam", "fsdev.config.mts");
const COORDINATOR = "shift-coordinator";
const CODER = "eng.coder";
/** Each of the scripted coder's five steps: long enough that the run is mid-way at the kill. */
const STEP_MS = 30_000;
/** The engine's stale threshold plus a sweep, and then some: when the cut turn must be listed. */
const CUT_TURN_MS = 150_000;
/** The task's lease (the board's two minutes) plus one sweep, and then some. */
const TASK_MS = 240_000;
const say = (s: string) => console.error(`[sm-crash ${new Date().toISOString().slice(11, 19)}] ${s}`);

/** Alice, the Lab's owner, on her verified bearer. */
function alice(origin: string): Client {
  return connect({ userId: LAB_USERS.owner.userId, baseUrl: origin, bearerToken: LAB_USERS.owner.bearer });
}

await runGoal(async (failures) => {
  const pages = await buildShiftManagerPages(join(SCRATCH, "pages"));
  const serve = (store: string, label: string): Promise<ServedShiftManager> =>
    startShiftManager({
      scratch: SCRATCH,
      label,
      config: CONFIG,
      pages,
      env: { DEVTEAM_STORE: store, DEVFORCE_LAB_HARNESS: "stub", DEVFORCE_LAB_STEP_MS: String(STEP_MS) },
      timeoutMs: 240_000,
    });
  const store = join(SCRATCH, "devteam.sqlite");
  let served = await serve(store, "before");
  try {
    let me = alice(served.origin);
    const conversation = await createWorkforceClient(me).ensureWorkerSession({ worker: COORDINATOR });
    const flow = conversation.flowId ?? conversation.flowKind;
    const board = me.flow(flow);
    const said = `Reply with one short line. The code word is heron-${Date.now() % 100_000}.`;

    // An earlier turn, ended, on the Shift Coordinator's own model.
    const first = await board.send("respond", { message: said }, { sessionId: conversation.id });
    const firstEnd = await first.wait({ timeoutMs: 300_000 });
    if (firstEnd.status !== "completed") throw new Error(`setup: the person's turn ended ${firstEnd.status}`);

    // The coding task, filed as a screen files one; its run is the turn the crash cuts.
    const filed = await board.send("createTask_tasks", { assignee: CODER, goal: "Add a line to README.md saying the storefront opens at nine.", input: { project: { visibility: "shared", id: "storefront" } } }, { sessionId: conversation.id });
    await filed.wait({ timeoutMs: 60_000 });
    const filedRow = (await me.sessions.requests(conversation.id, { limit: 50, includeResultOutput: true })) as Array<{ id: string; result?: { output?: { taskId?: string; ok?: boolean; error?: string } } }>;
    const taskId = filedRow.find((r) => r.id === filed.id)?.result?.output?.taskId;
    if (taskId === undefined) throw new Error(`setup: createTask_tasks filed nothing: ${JSON.stringify(filedRow.find((r) => r.id === filed.id)?.result)}`);
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

    const next = CONTROL === "fresh-store" ? join(SCRATCH, "fresh.sqlite") : store;
    served = await crashAndRestart(served.child, () => serve(next, "after"));
    me = alice(served.origin);
    say(`served again on ${next === store ? "the same store" : "a fresh store"}`);

    const lost = await readConversation(me, conversation.id, said, [first.id, filed.id]);
    if (lost !== undefined) failures.push(`conversation — ${lost}`);
    const cutTurn = await readCutTurn(me, cutSession!, cut, CUT_TURN_MS);
    if (cutTurn !== undefined) failures.push(`cut-turn — ${cutTurn}`);
    const task = await readTaskAfterCrash(readRow, attempts, TASK_MS);
    if (task.failure !== undefined) failures.push(`task — ${task.failure}`);
    say(`after the restart: ${JSON.stringify({ task: { status: task.row?.status, attempts: task.row?.attempts, error: task.row?.error } })}`);
    return { failures, evidence: `crashed mid-run, served again; conversation ${conversation.id} kept, ${cut} listed interrupted, task ${taskId} read ${task.row?.status} on attempt ${task.row?.attempts}` };
  } finally {
    // Graded: nothing is left to keep. A graceful stop would wait out the re-claimed run's drain.
    stopProcessGroup(served.child, "SIGKILL");
    await served.exited;
  }
});
