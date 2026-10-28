/**
 * Goal check — a delegated task runs where, when and how often its filer chose
 * at filing, and nothing waits on work that will never finish (FIX-2080).
 *
 * **Model-free.** A real `createFlowState` host on a SQLite store, the
 * Workforce session board on two flows (`desk`, whose conversation files, and
 * `doer`, whose task sessions work and file pieces), deterministic workers,
 * driven over the host's HTTP router as a verified caller. Every grade reads
 * the stored rows, or the proof each worker wrote from inside its own run
 * (session, request, attempt), never the board's own say-so.
 *
 * Legs (each failure is tagged `<leg>:<assertion>`):
 *   a  start: a dependent starts after its dependency ends; a held task starts
 *      only on release; a dependency on another board, or one closing a loop,
 *      is refused and files nothing; after a retry, attempts and dependencies
 *      refuse an edit
 *   b  session and result: a follow-up filed while its task runs waits, then
 *      runs in that task's session; an ongoing task runs in the delegate's
 *      session for the conversation; from a task's session both conversation
 *      settings are refused, and so is a wait on a conversation-result task
 *   c  attempts 3 fails after the third failure, each retry in one session
 *   d  cascades: a cancel, a retry and a final failure each cancel the open
 *      filed task; a failed and a cancelled dependency each cancel a two-deep
 *      chain; killed between an ending and its cascade (a second process, on
 *      the same store), the filed child and the dependent are cancelled on the
 *      next touch
 *   e  retired rows stored at upgrade: a blocked row and a recorded row read
 *      as held and start on release; the entries still off read as stored
 *
 * Control: GOAL_CONTROL=no-cascade switches both cascades off (a scratch
 * patch to the code under test as it loads; `goals/lib/module-patch.mts`).
 * Must FAIL leg d on "the open filed task is cancelled" and "the dependent
 * chain is cancelled".
 *
 * Run: pnpm tsx goals/task-board/runs-by-its-filing-settings/run.mts
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import { encodeUserSegment, type BlockContext } from "@flow-state-dev/core/types";
import { createFlowState } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import type { Task, TaskInit } from "@flow-state-dev/orchestration/tasks";
import {
  createWorkerInstallation,
  defineSessionBoard,
  filingConversationBoard,
  hireWorkforce,
  workerConfigSchema,
  workerTaskEntry,
  type WorkerManifest
} from "@flow-state-dev/workforce";
// The wait `getTask({ id, wait: true })` makes (FIX-2082), called as the task tools call it.
import { waitOnTask } from "../../../packages/orchestration/src/tasks/helpers/wait-on-task.ts";
import {
  REPO_ROOT,
  RUN_STAMP,
  assertPatched,
  describePatches,
  goalTmpDir,
  actingAs,
  modulePatchEnv,
  runGoal,
  silentLogger,
  untilIdle,
  type ModulePatch
} from "../../lib/index.mts";
import { PATCHES } from "./controls.mts";

const USER = "u_filing_settings";
const ORG = "org_filing_settings";
const CONTROL = process.env.GOAL_CONTROL ?? "";
const PHASE = process.env.GOAL_PHASE ?? "main";
const SCRATCH = process.env.GOAL_SCRATCH ?? goalTmpDir("filing-settings");
/** Where each worker writes what it saw from inside its own run. */
const PROOFS = join(SCRATCH, "proofs.ndjson");
/** The second process's store and what it filed there, for the kill leg. */
const KILL_DB = join(SCRATCH, "kill.sqlite");
const KILL_PLAN = join(SCRATCH, "kill-plan.json");
/** How long a filed piece's worker runs: long enough to still be open when its parent ends. */
const PIECE_MS = 6000;

/** The kill leg's second process dies the moment an ending's own pass would pay its cascade. */
const KILL_PATCH: ModulePatch = {
  module: "packages/orchestration/src/tasks/collection/cascade.ts",
  from: String.raw`export async function payCascadeAfterWrite\(writes: CascadeWrites, row: Task \| undefined\): Promise<void> \{`,
  to: 'export async function payCascadeAfterWrite(writes: CascadeWrites, row: Task | undefined): Promise<void> { if (row?.cascadeOwed != null && process.env.GOAL_KILL === "at-cascade") process.exit(0);'
};

if (CONTROL !== "" && PATCHES[CONTROL] === undefined) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(PATCHES).join(", ")}`);
  process.exit(2);
}
// A patched control runs this same file again with the patch applied as it loads.
if (PHASE === "main" && PATCHES[CONTROL] !== undefined && process.env.GOAL_MODULE_PATCH === undefined) {
  const mark = join(SCRATCH, `patch-mark-${RUN_STAMP}`);
  rmSync(mark, { force: true });
  console.error(`control ${CONTROL}:\n${describePatches(PATCHES[CONTROL]!, REPO_ROOT)}`);
  const child = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, GOAL_SCRATCH: SCRATCH, ...modulePatchEnv(PATCHES[CONTROL]!, REPO_ROOT, mark) }
  });
  assertPatched(PATCHES[CONTROL]!, REPO_ROOT, mark);
  process.exit(child.status ?? 1);
}

type Proof = {
  taskId?: string;
  attempt: number;
  sessionId: string;
  requestId: string;
  message: string;
  at: number;
  refused?: string[];
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function readProofs(): Proof[] {
  if (!existsSync(PROOFS)) return [];
  return readFileSync(PROOFS, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Proof);
}

// ---- the host ---------------------------------------------------------------

const worker = (id: string, declared: Record<string, unknown>): WorkerManifest => ({ id, declared, body: "", skills: [] });
const WORKERS: WorkerManifest[] = [
  worker("lead", { flow: "desk", delegates: ["eng.doer"] }),
  // A worker files its pieces for someone else: its own steps are a plan's (FIX-2076).
  worker("eng.doer", { flow: "doer", delegates: ["eng.helper"] }),
  worker("eng.helper", { flow: "doer" })
];

/** A filer turn's script: what the desk's deterministic turn does with the board it holds. */
type Script =
  | { op: "file"; tasks: TaskInit[] }
  | { op: "settings"; id: string; patch: { held?: boolean; deps?: string[]; maxAttempts?: number } }
  | { op: "wait"; taskId: string };

function buildHost(filename: string) {
  let workerFlows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({ standardWorkers: WORKERS, workerFlows: () => workerFlows as never });
  const doorInput = z.object({ message: z.string() });
  const deskBoard = defineSessionBoard({ installation, flowKind: "desk" });
  const doerBoard = defineSessionBoard({ installation, flowKind: "doer" });

  // The desk's turn runs a script against the board its conversation holds:
  // the same guarded ref the task tools and actions write through.
  const deskTurn = handler({
    name: "filing-settings-desk-turn",
    inputSchema: doorInput,
    outputSchema: z.unknown(),
    execute: async (input, ctx) => {
      const script = JSON.parse(input.message) as Script;
      const ref = await deskBoard.board.resolver(ctx as never);
      if (ref === undefined) return { ok: false, error: "no_delegation_board" };
      try {
        if (script.op === "file") return { ok: true, ids: (await ref.addTasks(script.tasks)).map((t) => t.id) };
        if (script.op === "settings") return { ok: true, outcome: await ref.patchSettings(script.id, script.patch) };
        return await waitOnTask(ctx as never, ref, script.taskId, { key: `goal.wait:${script.taskId}` });
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  });

  // The doer's turn: it writes what it saw, then does what the goal says.
  //   [file:NAME]        file a piece for itself, open for PIECE_MS
  //   [file-ongoing]     try to file a piece in the ongoing session
  //   [file-conversation] try to file a piece whose result goes to the conversation
  //   [slow:N]           take N ms
  //   [fail]             throw; [fail-until:N] throw on every attempt below N
  const doerTurn = handler({
    name: "filing-settings-doer-turn",
    inputSchema: doorInput,
    outputSchema: z.unknown(),
    execute: async (input, rawCtx) => {
      const ctx = rawCtx as unknown as BlockContext;
      const above = await filingConversationBoard(ctx);
      const row = above?.tasks.list().find((r) => r.run?.requestId === ctx.request.identity.id && r.status === "in_progress");
      const attempt = row?.attempts ?? 0;
      const message = input.message;
      const refused: string[] = [];
      const own = /\[file(-ongoing|-conversation)?(?::([^\]]+))?\]/g;
      let match: RegExpExecArray | null;
      while ((match = own.exec(message)) !== null) {
        const ref = await doerBoard.board.resolver(ctx as never);
        const goal =
          match[1] === undefined ? `${match[2]}#${attempt} [slow:${PIECE_MS}]` : `refused piece${match[1]} ${RUN_STAMP}`;
        try {
          await ref!.addTask({
            goal,
            assignee: "eng.helper",
            ...(match[1] === "-ongoing" ? { session: "ongoing" as const } : {}),
            ...(match[1] === "-conversation" ? { resultTo: "conversation" as const } : {})
          });
        } catch (error) {
          refused.push(error instanceof Error ? error.message : String(error));
        }
      }
      const proof: Proof = {
        ...(row !== undefined ? { taskId: row.id } : {}),
        attempt,
        sessionId: ctx.session.identity.id,
        requestId: ctx.request.identity.id,
        message,
        at: Date.now(),
        ...(refused.length > 0 ? { refused } : {})
      };
      appendFileSync(PROOFS, `${JSON.stringify(proof)}\n`, "utf8");
      const slow = /\[slow:(\d+)\]/.exec(message);
      if (slow !== null) await sleep(Number(slow[1]));
      if (message.includes("[fail]")) throw new Error(`attempt ${attempt} fails on purpose`);
      const until = /\[fail-until:(\d+)\]/.exec(message);
      if (until !== null && attempt < Number(until[1])) throw new Error(`attempt ${attempt} fails on purpose`);
      return `done: ${message}`;
    }
  });

  const flowOf = (kind: string, board: ReturnType<typeof defineSessionBoard>, turn: typeof deskTurn | typeof doerTurn) =>
    defineFlow({
      kind,
      configSchema: workerConfigSchema(),
      session: { ...installation.session(board.sessionStateShape), serverOwned: [...board.serverOwned] },
      resources: { ...installation.resources, ...board.resources },
      actions: { respond: { inputSchema: doorInput.strict(), block: turn, userMessage: (i: { message: string }) => i.message }, ...board.actions },
      internal: { actions: board.entries(turn, () => "fixed") },
      task: { actions: { work: workerTaskEntry({ name: `filing-settings-${kind}-task`, turn }) } }
    } as never);
  workerFlows = {
    desk: { flow: flowOf("desk", deskBoard, deskTurn), roles: ["contributor", "manager"] },
    doer: { flow: flowOf("doer", doerBoard, doerTurn), roles: ["contributor", "manager"] }
  };

  const state = createFlowState({
    flows: Object.fromEntries(hireWorkforce(installation).map((copy) => [copy.id, copy])),
    stores: { default: { primary: sqliteStores({ filename }) } },
    logger: silentLogger,
    resolvePrincipal: (context: any) => {
      const user = context.request?.headers.get("x-user");
      return typeof user === "string" ? { userId: user, orgId: ORG } : null;
    }
  } as never);

  const connect = async () => {
    const runtime = await state.getRuntime();
    const http = actingAs((await state.getRouter()) as never, USER);
    /** Every stored row of the user's conversation ledgers, read from the store, with its partition. */
    const rows = async (): Promise<Array<Task & { partition: string }>> =>
      Object.entries(await runtime.stores.resourceState.getByPrefix("user", `${USER}:~org:${ORG}`, "tasks/")).map(([key, value]) => ({
        ...(value.state as Task),
        partition: key.split("/")[1]!
      }));
    const named = async (goal: string) => (await rows()).filter((r) => r.goal === goal);
    const byId = async (id: string) => (await rows()).find((r) => r.id === id);
    const act = (session: string, action: string, input: unknown) => http.act("desk", session, action, input);
    const script = async (session: string, s: Script) => act(session, "respond", { message: JSON.stringify(s) });
    const until = async (check: () => Promise<boolean>, ms: number) => {
      for (const deadline = Date.now() + ms; Date.now() < deadline; await sleep(25)) if (await check()) return true;
      return check();
    };
    const writeRow = async (partition: string, row: Record<string, unknown>) => {
      await runtime.stores.resourceState.set("user", `${USER}:~org:${ORG}`, `tasks/${encodeUserSegment(partition)}/${String(row.id)}`, row as never, "any" as never);
    };
    return { runtime, http, rows, named, byId, act, script, until, writeRow, idle: () => untilIdle(runtime.stores) };
  };
  return { state, connect };
}

/** A goal word unique to this run. */
const word = (name: string) => `${name} ${RUN_STAMP}`;

// ---- the kill leg's second process --------------------------------------------

if (PHASE === "kill") {
  // File X, which files a piece and then fails for good, and Y, which depends
  // on X; this process dies the moment X's ending's own pass would cancel them.
  const host = buildHost(KILL_DB);
  const h = await host.connect();
  const conversation = await h.http.open("desk", { workerId: "lead" });
  const x = `kill-x-${RUN_STAMP}`;
  const y = `kill-y-${RUN_STAMP}`;
  writeFileSync(KILL_PLAN, JSON.stringify({ conversation, x, y }), "utf8");
  const filed = await h.script(conversation, {
    op: "file",
    tasks: [
      { id: x, goal: `[file:kill-child][slow:800][fail] ${RUN_STAMP}`, maxAttempts: 1 },
      { id: y, goal: word("depends on the killed task"), deps: [x] }
    ]
  });
  if (filed?.ok !== true) {
    console.error(`kill: the filing was refused: ${JSON.stringify(filed)}`);
    process.exit(4);
  }
  // Under a control nothing owes a cascade, so nothing kills this process:
  // it leaves once X has ended.
  await h.until(async () => (await h.byId(x))?.status === "errored", 20_000);
  await sleep(1500);
  process.exit(0);
}

// ---- the legs ----------------------------------------------------------------

await runGoal(async (failures, tell) => {
  writeFileSync(PROOFS, "", "utf8");
  rmSync(KILL_DB, { force: true });
  const host = buildHost(join(SCRATCH, "main.sqlite"));
  const notes: string[] = [];
  /** Run a leg; a throw is that leg's failure, and the next leg still runs. */
  const leg = async (name: string, body: () => Promise<void>) => {
    try {
      await body();
    } catch (error) {
      failures.push(`${name}:threw — ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  try {
    const h = await host.connect();
    const conversation = await h.http.open("desk", { workerId: "lead" });
    const other = await h.http.open("desk", { workerId: "lead" });
    const proofsOf = (taskId: string | undefined) => readProofs().filter((p) => p.taskId === taskId);

    // ---- a. start ----------------------------------------------------------
    await leg("a", async () => {
      const dep = await h.act(conversation, "createTask_tasks", { goal: word("[slow:300] the dependency") });
      const after = await h.act(conversation, "createTask_tasks", { goal: word("the dependent"), deps: [dep.taskId] });
      const held = await h.script(conversation, { op: "file", tasks: [{ goal: word("held until released"), held: true }] });
      const heldId = held.ids?.[0] as string;
      for (let i = 0; i < 5; i += 1) await h.act(conversation, "listTasks_tasks", {});
      await h.idle();
      const heldRow = await h.byId(heldId);
      if (heldRow?.status !== "held" || proofsOf(heldId).length !== 0) {
        failures.push(`a:held starts only on release — before the release it is ${heldRow?.status} with ${proofsOf(heldId).length} run(s)`);
      }
      const released = await h.act(conversation, "updateTask_tasks", { id: heldId, status: "pending" });
      await h.idle();
      const ran = proofsOf(heldId);
      if (released?.ok !== true || (await h.byId(heldId))?.status !== "completed" || ran.length !== 1) {
        failures.push(`a:held starts only on release — the release answered ${JSON.stringify(released)}, then ${(await h.byId(heldId))?.status} with ${ran.length} run(s)`);
      }
      const depRow = await h.byId(dep.taskId);
      const afterRow = await h.byId(after.taskId);
      tell.over("a · the dependent's runs", proofsOf(after.taskId));
      if (depRow?.completedAt === undefined || afterRow?.startedAt === undefined || afterRow.startedAt < depRow.completedAt) {
        failures.push(`a:dependent starts after its dependency ends — dependency ended ${depRow?.completedAt}, dependent started ${afterRow?.startedAt}`);
      }

      // Another board's task (the other conversation's), and a loop.
      const foreign = await h.act(other, "createTask_tasks", { goal: word("on another board"), deps: [dep.taskId] });
      const loop = await h.script(conversation, {
        op: "file",
        tasks: [
          { id: `loop-a-${RUN_STAMP}`, goal: word("loop a"), deps: [`loop-b-${RUN_STAMP}`] },
          { id: `loop-b-${RUN_STAMP}`, goal: word("loop b"), deps: [`loop-a-${RUN_STAMP}`] }
        ]
      });
      const stored = [...(await h.named(word("on another board"))), ...(await h.named(word("loop a"))), ...(await h.named(word("loop b")))];
      if (foreign?.ok !== false || !String(foreign.error).startsWith("dependency_not_on_board")) {
        failures.push(`a:refused and files nothing — a dependency on another board answered ${JSON.stringify(foreign)}`);
      }
      if (loop?.ok !== false || !String(loop.error).startsWith("dependency_loop")) {
        failures.push(`a:refused and files nothing — a loop answered ${JSON.stringify(loop)}`);
      }
      tell.over("a · rows the refused filings stored", stored, { emptyIs: "the claim: a refused filing stores nothing" });
      if (stored.length > 0) failures.push(`a:refused and files nothing — ${stored.length} row(s) stored: ${stored.map((r) => r.goal).join(", ")}`);

      // After a retry, its settings are fixed.
      const retried = await h.act(conversation, "createTask_tasks", { goal: word("[fail-until:2][slow:1500] retried") });
      await h.until(async () => ((await h.byId(retried.taskId))?.attempts ?? 0) >= 2, 10_000);
      const editAttempts = await h.script(conversation, { op: "settings", id: retried.taskId, patch: { maxAttempts: 5 } });
      const editDeps = await h.script(conversation, { op: "settings", id: retried.taskId, patch: { deps: [dep.taskId] } });
      const retriedRow = await h.byId(retried.taskId);
      for (const [what, answer] of [["attempts", editAttempts], ["dependencies", editDeps]] as const) {
        if (answer?.outcome?.outcome !== "declined" || answer.outcome.reason !== "started") {
          failures.push(`a:after a retry the ${what} refuse an edit — answered ${JSON.stringify(answer)}`);
        }
      }
      if (retriedRow?.maxAttempts !== 2 || (retriedRow.deps ?? []).length !== 0) {
        failures.push(`a:after a retry the attempts refuse an edit — the row holds maxAttempts ${retriedRow?.maxAttempts}, deps ${JSON.stringify(retriedRow?.deps)}`);
      }
      await h.idle();
      notes.push(`a: dependent started ${(afterRow?.startedAt ?? 0) - (depRow?.completedAt ?? 0)} ms after its dependency ended; refusals ${String(foreign.error).split(":")[0]}, ${String(loop.error).split(":")[0]}`);
    });

    // ---- b. session and result --------------------------------------------------
    await leg("b", async () => {
      const root = await h.act(conversation, "createTask_tasks", { goal: word("[slow:1500] the root") });
      await h.until(async () => proofsOf(root.taskId).length > 0, 5000);
      const followUp = await h.act(conversation, "createTask_tasks", { goal: word("the follow-up"), followUpOf: root.taskId });
      const early = followUp?.taskId === undefined ? undefined : await h.byId(followUp.taskId);
      const rootEarly = await h.byId(root.taskId);
      if (followUp?.ok !== true || early?.status !== "pending" || early.attempts !== 0 || rootEarly?.status !== "in_progress") {
        failures.push(`b:the follow-up stays unstarted — while its task is ${rootEarly?.status}, the follow-up answered ${JSON.stringify(followUp)} and is ${early?.status}`);
      }
      await h.idle();
      const rootRun = proofsOf(root.taskId)[0];
      const followRun = tell.over("b · the follow-up's runs", proofsOf(followUp?.taskId));
      const rootRow = await h.byId(root.taskId);
      const followRow = followUp?.taskId === undefined ? undefined : await h.byId(followUp.taskId);
      if (followRun.length !== 1 || followRun[0]!.sessionId !== rootRun?.sessionId || (followRow?.startedAt ?? 0) < (rootRow?.completedAt ?? Infinity)) {
        failures.push(`b:then runs in that task's session — ran in ${followRun.map((p) => p.sessionId)}, its task in ${rootRun?.sessionId}`);
      }

      const ongoing = await h.script(conversation, {
        op: "file",
        tasks: [
          { goal: word("[slow:300] ongoing one"), session: "ongoing" },
          { goal: word("ongoing two"), session: "ongoing" }
        ]
      });
      await h.idle();
      const runs = tell.over("b · the ongoing tasks' runs", ((ongoing.ids ?? []) as string[]).flatMap((id) => proofsOf(id)));
      const sessions = new Set(runs.map((p) => p.sessionId));
      const ongoingSession = runs[0] === undefined ? undefined : await h.runtime.stores.session.get(runs[0].sessionId);
      const ongoingState = (ongoingSession?.state ?? {}) as Record<string, unknown>;
      if (runs.length !== 2 || sessions.size !== 1 || "taskId" in ongoingState || ongoingState.workerId !== "eng.doer" || sessions.has(rootRun?.sessionId ?? "")) {
        failures.push(
          `b:an ongoing task runs in the delegate's session for the conversation — ${runs.length} run(s) in ${[...sessions].join(", ")}, ` +
            `that session's state ${JSON.stringify({ workerId: ongoingState.workerId, taskId: ongoingState.taskId })}`
        );
      }

      const fromTask = await h.act(conversation, "createTask_tasks", { goal: word("[file-ongoing][file-conversation] from a task") });
      await h.idle();
      const refused = tell.over("b · the task's refused filings", proofsOf(fromTask.taskId).flatMap((p) => p.refused ?? []));
      const strays = await h.named(`refused piece-ongoing ${RUN_STAMP}`);
      if (refused.length !== 2 || !refused.every((r) => r.startsWith("setting_not_from_task_session")) || strays.length > 0) {
        failures.push(`b:from a task's session both settings are refused — refusals ${JSON.stringify(refused)}, ${strays.length} stored`);
      }

      const told = await h.script(conversation, { op: "file", tasks: [{ goal: word("for the conversation"), held: true, resultTo: "conversation" }] });
      const waited = await h.script(conversation, { op: "wait", taskId: told.ids?.[0] });
      const toldRow = await h.byId(told.ids?.[0]);
      if (waited?.ok !== false || waited.error !== "wait_on_conversation_result" || toldRow?.status !== "held" || toldRow.wait !== undefined || toldRow.maxAttempts !== 1) {
        failures.push(`b:a wait on a conversation-result task is refused — answered ${JSON.stringify(waited)}, the row ${toldRow?.status}, attempts ${toldRow?.maxAttempts}`);
      }
      notes.push(`b: the follow-up ran in its root's session ${rootRun?.sessionId}; two ongoing tasks in ${[...sessions][0]}`);
    });

    // ---- c. attempts ---------------------------------------------------------------
    await leg("c", async () => {
      const three = await h.script(conversation, { op: "file", tasks: [{ goal: word("[fail] three attempts"), maxAttempts: 3 }] });
      await h.idle();
      const id = three.ids?.[0] as string;
      const runs = tell.over("c · the runs", proofsOf(id));
      const row = await h.byId(id);
      if (row?.status !== "errored" || row.attempts !== 3 || runs.length !== 3 || new Set(runs.map((p) => p.sessionId)).size !== 1) {
        failures.push(`c:attempts 3 fails after the third failure, in one session — ${row?.status} after ${row?.attempts}, ${runs.length} run(s) in ${new Set(runs.map((p) => p.sessionId)).size} session(s)`);
      }
    });

    // ---- d. cascades -------------------------------------------------------------------
    await leg("d", async () => {
      const piece = (name: string, attempt: number) => h.named(`${name}#${attempt} [slow:${PIECE_MS}]`);
      // A cancel, while the task's own turn is still running.
      const name1 = `cancelled-${RUN_STAMP}`;
      const cancelled = await h.act(conversation, "createTask_tasks", { goal: word(`[file:${name1}][slow:5000] cancelled`) });
      await h.until(async () => (await piece(name1, 1)).length === 1, 5000);
      await h.act(conversation, "updateTask_tasks", { id: cancelled.taskId, status: "cancelled" });
      const paid = await h.until(async () => (await piece(name1, 1))[0]?.status === "cancelled", 2500);
      if (!paid) failures.push(`d:the open filed task is cancelled — by a cancel: the piece is ${(await piece(name1, 1))[0]?.status ?? "missing"} 2.5 s on, its task's turn still running`);

      // A retry: the first attempt files and fails, the second succeeds.
      const name2 = `retried-${RUN_STAMP}`;
      const retried = await h.script(conversation, { op: "file", tasks: [{ goal: word(`[file:${name2}][fail-until:2] retried`), maxAttempts: 2 }] });
      await h.until(async () => (await piece(name2, 1))[0]?.status === "cancelled", 8000);
      const firstPiece = (await piece(name2, 1))[0];
      if (firstPiece?.status !== "cancelled") failures.push(`d:the open filed task is cancelled — by a retry: the first attempt's piece is ${firstPiece?.status ?? "missing"}`);

      // A final failure.
      const name3 = `failed-${RUN_STAMP}`;
      await h.act(conversation, "createTask_tasks", { goal: word(`[file:${name3}][fail] failed`) });
      await h.until(async () => (await piece(name3, 1))[0]?.status === "cancelled", 8000);
      const lastPiece = (await piece(name3, 1))[0];
      if (lastPiece?.status !== "cancelled") failures.push(`d:the open filed task is cancelled — by a final failure: the piece is ${lastPiece?.status ?? "missing"}`);

      // A failed and a cancelled dependency, each under a two-deep chain.
      const chains = await h.script(conversation, {
        op: "file",
        tasks: [
          { id: `f0-${RUN_STAMP}`, goal: word("[fail] fails") },
          { id: `f1-${RUN_STAMP}`, goal: word("after the failure"), deps: [`f0-${RUN_STAMP}`] },
          { id: `f2-${RUN_STAMP}`, goal: word("two after the failure"), deps: [`f1-${RUN_STAMP}`] },
          { id: `c0-${RUN_STAMP}`, goal: word("cancelled before it starts"), held: true },
          { id: `c1-${RUN_STAMP}`, goal: word("after the cancel"), deps: [`c0-${RUN_STAMP}`] },
          { id: `c2-${RUN_STAMP}`, goal: word("two after the cancel"), deps: [`c1-${RUN_STAMP}`] }
        ]
      });
      if (chains?.ok !== true) failures.push(`d:the dependent chain is cancelled — the chains weren't filed: ${JSON.stringify(chains)}`);
      await h.act(conversation, "updateTask_tasks", { id: `c0-${RUN_STAMP}`, status: "cancelled" });
      await h.idle();
      await h.until(async () => (await h.byId(`f2-${RUN_STAMP}`))?.status === "cancelled", 4000);
      for (const [cause, ids] of [["failed", ["f1", "f2"]], ["cancelled", ["c1", "c2"]]] as const) {
        const chain = await Promise.all(ids.map((id) => h.byId(`${id}-${RUN_STAMP}`)));
        if (!chain.every((r) => r?.status === "cancelled" && (r.labels ?? []).includes("skipped") && r.causedBy !== undefined)) {
          failures.push(`d:the dependent chain is cancelled — under a ${cause} dependency: ${chain.map((r) => `${r?.id} ${r?.status} caused by ${r?.causedBy}`).join(", ")}`);
        }
      }
      await h.idle();
      notes.push(`d: pieces cancelled by a cancel, a retry (${retried.ids?.[0]}) and a final failure; both chains cancelled, labelled skipped`);
    });

    // ---- e. retired rows in the store at upgrade -----------------------------------------
    await leg("e", async () => {
      const partition = (await h.act(conversation, "listDelegates", {})).filingSessionId as string;
      const now = Date.now();
      const base = { attempts: 0, maxAttempts: 2, assignee: "eng.doer", createdAt: now, updatedAt: now, revision: 1 };
      const blocked = `blocked-${RUN_STAMP}`;
      const recorded = `recorded-${RUN_STAMP}`;
      await h.writeRow(partition, { ...base, id: blocked, goal: word("stored blocked"), status: "blocked", error: "waiting on legal" });
      await h.writeRow(partition, { ...base, id: recorded, goal: word("stored recorded"), status: "pending", undispatched: true });
      // On since FIX-2083: a post row reads as a routed task, its status as stored.
      await h.writeRow(partition, { ...base, id: `post-${RUN_STAMP}`, goal: word("stored post"), status: "completed", sealed: { kind: "post" } });
      // A stored `parked` row (a split, or a row parked for a person's turn) is
      // not written here: FIX-2131 retired the status with stores reset, so no
      // store holds one to read.
      for (let i = 0; i < 3; i += 1) await h.act(conversation, "listTasks_tasks", {});
      await h.idle();
      const listed = new Map(((await h.act(conversation, "listTasks_tasks", {})).tasks as Array<{ id: string; status: string }>).map((t) => [t.id, t.status]));
      for (const id of [blocked, recorded]) {
        if (listed.get(id) !== "held" || proofsOf(id).length !== 0) failures.push(`e:a retired not-started row reads as held — ${id} reads ${listed.get(id)}, ran ${proofsOf(id).length} time(s)`);
      }
      // A stored post keeps its status.
      if (listed.get(`post-${RUN_STAMP}`) !== "completed") failures.push(`e:a stored post keeps its status — post-${RUN_STAMP} reads ${listed.get(`post-${RUN_STAMP}`)}`);
      for (const id of [blocked, recorded]) await h.act(conversation, "updateTask_tasks", { id, status: "pending" });
      await h.idle();
      for (const id of [blocked, recorded]) {
        const row = await h.byId(id);
        if (row?.status !== "completed" || proofsOf(id).length !== 1) failures.push(`e:it starts on release — ${id} is ${row?.status} after ${proofsOf(id).length} run(s)`);
      }
    });
  } finally {
    await host.state.dispose();
  }

  // ---- d. killed between an ending and its cascade ---------------------------------------
  await leg("d", async () => {
    rmSync(KILL_PLAN, { force: true });
    const patches = [KILL_PATCH, ...(PATCHES[CONTROL] ?? [])];
    const mark = join(SCRATCH, `kill-mark-${RUN_STAMP}`);
    const child = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
      stdio: "inherit",
      env: { ...process.env, GOAL_PHASE: "kill", GOAL_KILL: "at-cascade", GOAL_SCRATCH: SCRATCH, ...modulePatchEnv(patches, REPO_ROOT, mark) }
    });
    assertPatched(patches, REPO_ROOT, mark);
    if (child.status !== 0 || !existsSync(KILL_PLAN)) throw new Error(`the second process ended ${child.status} with no plan`);
    const plan = JSON.parse(readFileSync(KILL_PLAN, "utf8")) as { conversation: string; x: string; y: string };
    const restarted = buildHost(KILL_DB);
    try {
      const h = await restarted.connect();
      const kid = async () => (await h.rows()).find((r) => r.goal.startsWith("kill-child#"));
      const before = { x: await h.byId(plan.x), y: await h.byId(plan.y), kid: await kid() };
      // Where the kill left it: X ended, and neither its dependent nor its piece paid.
      if (before.x?.status !== "errored" || before.y?.status !== "pending" || before.kid === undefined || before.kid.status === "cancelled") {
        notes.push(`kill: before the touch X ${before.x?.status}, Y ${before.y?.status}, its piece ${before.kid?.status}`);
      }
      await sleep(2500); // past the debt's due time
      await h.act(plan.conversation, "listTasks_tasks", {});
      await h.until(async () => (await h.byId(plan.y))?.status === "cancelled" && (await kid())?.status === "cancelled", 5000);
      const after = { y: await h.byId(plan.y), kid: await kid() };
      if (after.kid?.status !== "cancelled") failures.push(`d:the open filed task is cancelled — after the kill, on the next touch: the piece is ${after.kid?.status ?? "missing"}`);
      if (after.y?.status !== "cancelled") failures.push(`d:the dependent chain is cancelled — after the kill, on the next touch: the dependent is ${after.y?.status ?? "missing"}`);
      notes.push(`kill: X ${before.x?.status} with its debt ${before.x?.cascadeOwed === undefined ? "absent" : "owed"}; the touch cancelled Y and the piece`);
    } finally {
      await restarted.state.dispose();
    }
  });

  return { failures, evidence: notes.join("; ") };
});
