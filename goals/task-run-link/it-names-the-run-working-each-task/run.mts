/**
 * Goal check — someone looking at a task on a board can open exactly the run
 * working it, or the run that last worked it, and never another task's run or
 * a guess.
 *
 * **Model-free on purpose.** A task is handed over, a run starts, or it doesn't.
 *
 * The comparison is always between what a READER gets from the board and what
 * each WORKER saw from inside its own run, written to a file outside the board.
 * Never against what the board or the hand-over said it did: those are
 * neighbours of the claim, generated on the path being tested.
 *
 * What the tree contributes: the worker that files (its `delegates:` give it
 * the task tools), and the workers it files for, one on a flow of its own.
 * Rename the team or a worker, or move another delegate onto its own flow,
 * and a correct build still passes.
 *
 * Legs:
 *   a        the tree alone produces the filer, its delegates and their flows
 *   ran      every task's run really ran, and left its proof on disk
 *   browser  the conversation's task list, read over HTTP as an app reads it,
 *            names each task's own run
 *   stream   the last task-change on each run's own stream names that run
 *   own      no two tasks name one session; a task run again names its own
 *            session again, under a new request
 *   retry    a task that failed once names its second run, not its first;
 *            a task that failed every attempt names the run that last failed
 *   marker   the cross-flow run opens through its session's owner, and
 *            returns the marker its worker emitted
 *
 * Controls (GOAL_CONTROL=...), each perturbing the code under test as this
 * process loads it (`goals/lib/module-patch.mts`), never the tree:
 *   stamp-at-claim  the link is written with the claiming conversation's
 *                   coordinate. Must FAIL at "session equals the worker's".
 *   no-list-link    the task list leaves the link out. Must FAIL at "link
 *                   present on the browser read", and nothing else.
 *   board-flow      each run is opened through the filer's flow instead of
 *                   its session's owner (this file). Must FAIL at "marker
 *                   read on the cross-flow worker" and at the stream leg.
 *
 * Run: pnpm tsx goals/task-run-link/it-names-the-run-working-each-task/run.mts
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import type { Task, TaskRunLink } from "@flow-state-dev/orchestration/tasks";
import {
  TASK_ID_STATE_KEY,
  createWorkerInstallation,
  defineSessionBoard,
  hireWorkforce,
  workerConfigSchema,
  workerTaskEntry,
  type WorkerManifest
} from "@flow-state-dev/workforce";
import { readWorkforce } from "@flow-state-dev/workforce/loader";
import {
  REPO_ROOT,
  RUN_STAMP,
  assertPatched,
  describePatches,
  goalTmpDir,
  actingAs,
  hearsMessages,
  modulePatchEnv,
  runGoal,
  silentLogger,
  untilIdle,
  type ModulePatch
} from "../../lib/index.mts";

const TREE = fileURLToPath(new URL("./fixtures/workforce", import.meta.url));
const USER_ID = "u_task_run_link";
const ORG_ID = "org_task_run_link";
const MARKER_COMPONENT = "run-link-goal-marker";
/** A goal word the worker fails on, on its first attempt only. */
const FAILS_ONCE = "[fails once]";
/** A goal word the worker fails on, every attempt. */
const FAILS_ALWAYS = "[fails always]";

const CONTROL = process.env.GOAL_CONTROL ?? "";
const SCRATCH = goalTmpDir("task-run-link");
/** Where each worker writes what it saw from inside its own run. */
const OUTBOX = join(SCRATCH, "proof.ndjson");

/** The controls that change the code under test, as scratch patches applied at load. */
const PATCHES: Record<string, ModulePatch[]> = {
  "stamp-at-claim": [
    {
      module: "packages/orchestration/src/task-board/task-entry.ts",
      from: String.raw`sessionId: ctx\.session\.identity\.id,`,
      to: "sessionId: held.claimedBy.sessionId,"
    },
    {
      module: "packages/orchestration/src/task-board/task-entry.ts",
      from: String.raw`requestId: ctx\.request\.identity\.id,`,
      to: "requestId: held.claimedBy.requestId,"
    }
  ],
  "no-list-link": [
    {
      module: "packages/orchestration/src/skills/task-tools-capability.ts",
      from: String.raw`\.\.\.\(t\.run != null \? \{ run: t\.run \} : \{\}\),`,
      to: ""
    }
  ]
};

// A patched control runs this same file again with the patch applied as it
// loads, and checks the patch reached the code it names.
if (PATCHES[CONTROL] !== undefined && process.env.GOAL_MODULE_PATCH === undefined) {
  const mark = join(SCRATCH, `patch-mark-${RUN_STAMP}`);
  rmSync(mark, { force: true });
  console.error(`control ${CONTROL}:\n${describePatches(PATCHES[CONTROL]!, REPO_ROOT)}`);
  const child = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, ...modulePatchEnv(PATCHES[CONTROL]!, REPO_ROOT, mark) }
  });
  assertPatched(PATCHES[CONTROL]!, REPO_ROOT, mark);
  process.exit(child.status ?? 1);
}

type Proof = { taskId: string; attempt: number; sessionId: string; requestId: string; marker: string };

/** Parse an SSE body into its JSON `data:` frames. */
function sseFrames(body: string): Array<Record<string, any>> {
  return body
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => {
      try {
        return JSON.parse(line.slice("data: ".length)) as Record<string, any>;
      } catch {
        return {};
      }
    });
}

/** Every proof on disk, in the order the workers wrote them. */
function readProofs(): Proof[] {
  return readFileSync(OUTBOX, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Proof);
}

await runGoal(async (failures) => {
  writeFileSync(OUTBOX, "", "utf8");

  // ---- a. the tree alone ----------------------------------------------------
  const roster = await readWorkforce(TREE);
  if (roster.errors.length > 0) {
    return { failures: [`a: the tree did not load cleanly: ${JSON.stringify(roster.errors)}`], evidence: "" };
  }
  const workers: WorkerManifest[] = roster.workers;
  const byId = new Map(workers.map((w) => [w.id, w]));
  // The filer: the worker whose file names delegates. Its delegates are the
  // workers it files for, each on the flow its own file names.
  const filer = workers.find((w) => Array.isArray(w.declared.delegates) && (w.declared.delegates as unknown[]).length > 0);
  if (filer === undefined) return { failures: ["a: no worker file in the tree names delegates"], evidence: "" };
  const filerKind = String(filer.declared.flow);
  const delegates = (filer.declared.delegates as string[]).map((id) => byId.get(id));
  if (delegates.some((d) => d === undefined)) {
    return { failures: [`a: the filer names a delegate no file declares: ${filer.declared.delegates}`], evidence: "" };
  }
  const takers = delegates.map((w) => ({ id: w!.id, kind: String(w!.declared.flow) }));
  const kinds = [...new Set(takers.map((t) => t.kind))];
  if (kinds.length < 2 || kinds.includes(filerKind)) {
    return { failures: ["a: the tree must put the filer's delegates on at least two flows, none of them the filer's"], evidence: "" };
  }
  // The delegate on a flow no other delegate shares: the cross-flow run.
  const lone = takers.find((t) => takers.filter((o) => o.kind === t.kind).length === 1)!;
  const shared = takers.filter((t) => t.kind !== lone.kind);
  if (shared.length < 2) return { failures: ["a: the tree must put two delegates on one flow"], evidence: "" };

  // ---- the worker: what it saw, from inside its own run --------------------
  // The attempt is counted from this worker's own proofs, never read off the
  // board: the thing under test does not grade itself.
  const turnFor = (kind: string) =>
    handler({
      name: `run-link-goal-${kind}-turn`,
      inputSchema: z.object({ message: z.string() }),
      execute: async (input, ctx) => {
        const taskId = String((ctx.session.state as Record<string, unknown>)[TASK_ID_STATE_KEY]);
        const attempt = readProofs().filter((p) => p.taskId === taskId).length + 1;
        const marker = `marker-${taskId}-${attempt}-${randomUUID()}`;
        ctx.emit.component(MARKER_COMPONENT, { marker });
        const proof: Proof = {
          taskId,
          attempt,
          sessionId: ctx.session.identity.id,
          requestId: ctx.request.identity.id,
          marker
        };
        appendFileSync(OUTBOX, `${JSON.stringify(proof)}\n`, "utf8");
        if (input.message.includes(FAILS_ALWAYS)) throw new Error(`attempt ${attempt} fails on purpose, every time`);
        if (input.message.includes(FAILS_ONCE) && attempt === 1) throw new Error("the first attempt fails on purpose");
        return `done: ${marker}`;
      }
    });

  // The installation every worker flow below runs its workers on. It reads the
  // flows when it first needs them, so they are built on it below.
  let workerFlows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({ standardWorkers: workers, workerFlows: () => workerFlows as never });
  const doorInput = z.object({ message: z.string() });

  // The filer's flow carries the session board: its delegates give it the
  // task tools and actions, and its board hands each task to the delegate's
  // own flow.
  const board = defineSessionBoard({ installation, flowKind: filerKind });
  const filerTurn = handler({ name: "run-link-goal-filer-turn", inputSchema: doorInput, execute: async () => "Noted." });
  const filerFlow = defineFlow({
    kind: filerKind,
    configSchema: workerConfigSchema(),
    session: { ...installation.session(board.sessionStateShape), serverOwned: [...board.serverOwned] },
    resources: { ...installation.resources, ...board.resources },
    actions: {
      respond: { inputSchema: doorInput.strict(), block: filerTurn, userMessage: (input: { message: string }) => input.message },
      ...board.actions
    },
    internal: { actions: board.entries(filerTurn, () => "fixed") }
  } as never);

  // Each delegate's flow takes tasks through Workforce's task entry.
  const takerFlow = (kind: string) => {
    const turn = turnFor(kind);
    return defineFlow({
      kind,
      configSchema: workerConfigSchema(),
      session: installation.session(),
      ...hearsMessages(installation, kind),
      actions: { respond: { inputSchema: doorInput, block: turn, userMessage: (input: { message: string }) => input.message } },
      task: { actions: { work: workerTaskEntry({ name: `run-link-goal-${kind}-task`, turn }) } }
    } as never);
  };
  workerFlows = {
    [filerKind]: { flow: filerFlow, roles: ["manager"] },
    ...Object.fromEntries(kinds.map((kind) => [kind, { flow: takerFlow(kind), roles: ["contributor"] }]))
  };

  const hired = hireWorkforce(installation);
  const state = createFlowState({
    flows: Object.fromEntries(hired.map((copy) => [copy.id, copy])),
    stores: { default: { primary: inMemoryStores() } },
    logger: silentLogger,
    resolvePrincipal: (context: any) => {
      const user = context.request?.headers.get("x-user");
      return typeof user === "string" ? { userId: user, orgId: ORG_ID } : null;
    }
  } as never);

  try {
    const runtime = await state.getRuntime();
    const router = (await state.getRouter()) as any;
    const { call, act, open } = actingAs(router, USER_ID);
    /** Every stored row of the user's conversation ledger, read from the store, not through the board. */
    const storedRows = async (): Promise<Task[]> =>
      Object.values(await runtime.stores.resourceState.getByPrefix("user", `${USER_ID}:~org:${ORG_ID}`, "tasks/")).map(
        (value) => value.state as Task
      );

    // ---- the conversation with the filer -----------------------------------
    let conversation: string;
    try {
      conversation = await open(filerKind, { workerId: filer.id });
    } catch (error) {
      return { failures: [`a: ${(error as Error).message}`], evidence: "" };
    }

    // ---- file the tasks, through the conversation's own task actions ------
    type Filed = { taskId: string; worker: (typeof takers)[number]; goal: string };
    const filed: Filed[] = [];
    const file = async (worker: (typeof takers)[number], goal: string) => {
      const out = await act(filerKind, conversation, "createTask_tasks", { goal, assignee: worker.id });
      if (out?.ok !== true) throw new Error(`filing for ${worker.id} was refused: ${JSON.stringify(out)}`);
      filed.push({ taskId: out.taskId, worker, goal });
    };
    for (const worker of takers) await file(worker, `${worker.id} task 1`);
    await file(shared[1]!, `${shared[1]!.id} task 2`);
    await file(shared[0]!, `${shared[0]!.id} task 2 ${FAILS_ONCE}`);
    await file(shared[0]!, `${shared[0]!.id} task 3 ${FAILS_ALWAYS}`);
    await untilIdle(runtime.stores);
    const retried = filed.find((f) => f.goal.includes(FAILS_ONCE))!;
    const failing = filed.find((f) => f.goal.includes(FAILS_ALWAYS))!;

    // ---- ran: the proof, outside the board -------------------------------
    const proofs = readProofs();
    const proofOf = (taskId: string, attempt: number | undefined) =>
      proofs.find((p) => p.taskId === taskId && p.attempt === attempt);
    const rows = new Map((await storedRows()).map((r) => [r.id, r]));
    for (const f of filed) {
      const r = rows.get(f.taskId);
      if (r === undefined) failures.push(`ran: ${f.taskId} is not in the store`);
      else if (proofOf(f.taskId, r.attempts) === undefined) failures.push(`ran: no proof on disk for ${f.taskId} attempt ${r.attempts}`);
    }

    /** Compare one reader's link against what the task's own worker recorded. */
    const judge = (leg: string, taskId: string, link: TaskRunLink | undefined, attempts: number | undefined) => {
      const proof = proofOf(taskId, attempts);
      if (link == null) {
        failures.push(`${leg}: link present on the ${leg} read — ${taskId} carries no run`);
        return;
      }
      if (proof === undefined) return;
      if (link.sessionId !== proof.sessionId) {
        failures.push(`${leg}: session equals the worker's — ${taskId} names ${link.sessionId}, its worker ran in ${proof.sessionId}`);
      }
      if (link.requestId !== proof.requestId) {
        failures.push(`${leg}: request equals the worker's — ${taskId} names ${link.requestId}, its worker ran as ${proof.requestId}`);
      }
      if (link.attempt !== attempts) {
        failures.push(`${leg}: attempt equals the task's — ${taskId} names attempt ${link.attempt}, the task is on ${attempts}`);
      }
    };

    // ---- browser: the conversation's task list, over HTTP -----------------
    const listed = await act(filerKind, conversation, "listTasks_tasks", {});
    const cards = new Map<string, Record<string, any>>(((listed?.tasks ?? []) as Array<Record<string, any>>).map((t) => [String(t.id), t]));
    if (cards.size !== filed.length) failures.push(`browser: the list holds ${cards.size} tasks, ${filed.length} were filed`);
    for (const f of filed) {
      const card = cards.get(f.taskId);
      judge("browser", f.taskId, card?.run, card?.attempts);
      if (card !== undefined && "claimedBy" in card) failures.push(`browser: ${f.taskId} carries claimedBy`);
    }

    // ---- stream + marker: open each run from its link ---------------------
    // Its owner is read off the session the link names, never assumed to be
    // the filer's flow.
    let markersRead = 0;
    for (const f of filed) {
      const r = rows.get(f.taskId);
      const link = r?.run;
      if (link == null) {
        failures.push(`stream: link present on the stored row — ${f.taskId} carries no run to open`);
        continue;
      }
      const session = await call("GET", ["sessions", link.sessionId]);
      const owner = session.status === 200 ? (JSON.parse(session.text).session?.flowId as string | undefined) : undefined;
      if (owner === undefined) {
        failures.push(`stream: the session ${link.sessionId} could not be read (${session.status})`);
        continue;
      }
      const via = CONTROL === "board-flow" ? filerKind : owner;
      const stream = await call("GET", [via, "requests", link.requestId, "stream"]);
      const frames = stream.status === 200 ? sseFrames(stream.text) : [];
      const items = frames.map((frame) => frame.item).filter((item) => item?.type === "component");
      const changes = items.filter((item) => item.component === "task-change" && item.data?.taskId === f.taskId);
      const marker = items.find((item) => item.component === MARKER_COMPONENT)?.data?.marker as string | undefined;
      const proof = proofOf(f.taskId, r!.attempts);

      if (f.worker.id === lone.id) {
        if (marker === undefined || marker !== proof?.marker) {
          failures.push(
            `marker: marker read on the cross-flow worker — opening ${f.taskId}'s run through "${via}" answered ` +
              `${stream.status} and returned ${marker === undefined ? "no marker" : `"${marker}"`}, its worker emitted "${proof?.marker}"`
          );
        } else {
          markersRead += 1;
        }
      }
      if (stream.status !== 200) {
        failures.push(`stream: ${f.taskId}'s run stream answered ${stream.status} through "${via}"`);
        continue;
      }
      const last = changes.at(-1)?.data?.task as (Task & Record<string, unknown>) | undefined;
      judge("stream", f.taskId, last?.run, last?.attempts);
      if (last !== undefined && "claimedBy" in last) failures.push(`stream: ${f.taskId}'s change item carries claimedBy`);
    }

    // ---- own: no two tasks share a run's session --------------------------
    const sessionsByTask = new Map(filed.map((f) => [f.taskId, rows.get(f.taskId)?.run?.sessionId]));
    for (const [taskId, sessionId] of sessionsByTask) {
      const others = [...sessionsByTask].filter(([other, s]) => other !== taskId && s !== undefined && s === sessionId);
      if (others.length > 0) failures.push(`own: ${taskId} and ${others.map(([o]) => o).join(", ")} name one session ${sessionId}`);
    }

    // ---- retry: the second run, not the first -----------------------------
    const retriedRow = rows.get(retried.taskId);
    const first = proofOf(retried.taskId, 1);
    const second = proofOf(retried.taskId, 2);
    if (retriedRow?.status !== "completed" || retriedRow.attempts !== 2 || first === undefined || second === undefined) {
      failures.push(`retry: ${retried.taskId} did not complete on its second run (status ${retriedRow?.status}, attempts ${retriedRow?.attempts})`);
    } else {
      if (retriedRow.run?.requestId === first.requestId) failures.push(`retry: ${retried.taskId} still names its failed first run ${first.requestId}`);
      if (first.sessionId !== second.sessionId) failures.push(`own: ${retried.taskId}'s two runs name two sessions`);
      if (first.requestId === second.requestId) failures.push(`own: ${retried.taskId}'s two runs name one request`);
    }
    const failingRow = rows.get(failing.taskId);
    const lastFailed = proofOf(failing.taskId, failingRow?.attempts);
    if (failingRow?.status !== "errored" || lastFailed === undefined) {
      failures.push(`retry: ${failing.taskId} did not end errored after its runs (status ${failingRow?.status})`);
    } else if (failingRow.run?.requestId !== lastFailed.requestId) {
      failures.push(`retry: ${failing.taskId} ended errored naming ${failingRow.run?.requestId}, not the run that last failed ${lastFailed.requestId}`);
    }

    return {
      failures,
      evidence:
        `${filer.id} (flow ${filerKind}) filed ${filed.length} tasks in conversation ${conversation} for ` +
        `${takers.map((t) => `${t.id}@${t.kind}`).join(", ")}; every task's link on the conversation's task list ` +
        `and on the last task-change of its run's own stream equals the session and request its worker recorded ` +
        `from inside the run (${proofs.length} proofs on disk), no two tasks share a session. ${retried.taskId} ` +
        `ran twice in ${second?.sessionId} (${first?.requestId}, then ${second?.requestId}) and names the second; ` +
        `${failing.taskId} ended errored naming its last run ${lastFailed?.requestId}; ${markersRead} cross-flow ` +
        `run(s) opened through their session's owner and returned the worker's marker.`
    };
  } finally {
    await state.dispose();
  }
});
