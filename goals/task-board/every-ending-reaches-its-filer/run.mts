/**
 * Goal check — every ending of a delegated task reaches its filer exactly once,
 * on any flow that files tasks, and nothing a board owes waits on a later
 * touch: each debt is paid within seconds of its due time, after a crash too,
 * by one pass at a time per session (FIX-2078).
 *
 * **Model-free.** A real durable `createFlowState` host on a SQLite store, its
 * router running the durability sweeper at its default interval. Two filers:
 * a plain orchestration flow (`planner`, no Workforce), and the Workforce
 * session board on two flows (`desk` files, `doer` works and files pieces).
 * Deterministic workers. A stand-in Error Reporter intake flow records the
 * occurrences it is sent. Every grade reads the engine's request store (what
 * each filer's session ran, with its input), the rows through the store, or
 * the proof each worker wrote from inside its own run.
 *
 * Legs (each failure is tagged `<leg>:<assertion>`):
 *   a  every ending, two flows: a done, a failed and a user-cancelled task are
 *      each heard once, on the plain flow and in a Workforce conversation; a
 *      waited task resumes its waiter and starts no `onTaskSettled`
 *   b  a second process is killed after a piece's ending is written and before
 *      its notice is sent; after restart, with no touch, the filer hears it and
 *      the parent whose last piece ended settles, each within its due time plus 2 s
 *   c  a dependent starts within 5 s of its dependency ending, with no read of
 *      the board; no two passes ran at once in one session, and two triggers
 *      sent at once are both answered
 *   d  a final failure: one failure notice, with its error, naming the
 *      dependent it cancelled, and none for the dependent; one task occurrence
 *      at the intake; no report marker on any row
 *   e  a second process is killed while a worker holds a claim; after restart,
 *      with no touch, within the lease's end plus 2 s the row is reclaimed or
 *      settled
 *
 * Control: GOAL_CONTROL=no-sweeper-payment stops the sweeper firing any due wake
 * (a scratch patch to the engine as it loads; `goals/lib/module-patch.mts`).
 * Must FAIL leg b on "the filer hears within due time" and leg e.
 *
 * Run: pnpm tsx goals/task-board/every-ending-reaches-its-filer/run.mts
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { defineFlow, dispatcher, handler, sequencer } from "@flow-state-dev/core";
import { dispatchThroughSeam, type BlockContext } from "@flow-state-dev/core/types";
import { createFlowState } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { taskSettledEntry, taskSettledInputSchema } from "@flow-state-dev/orchestration";
import { taskBoard, taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import {
  defineTaskCollection,
  getOrCreateTaskCollection,
  NOTICE_DUE_MS,
  resolveResourceCollection,
  type Task,
  type TaskInit,
  type TaskWorker,
  type TaskWorkerInput
} from "@flow-state-dev/orchestration/tasks";
import {
  createWorkerInstallation,
  defineSessionBoard,
  filingConversationBoard,
  hireWorkforce,
  workerConfigSchema,
  workerTaskEntry,
  type WorkerManifest
} from "@flow-state-dev/workforce";
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
  type ModulePatch
} from "../../lib/index.mts";
import { KILL_AFTER_ENDING, PATCHES } from "./controls.mts";

const USER = "u_every_ending";
const ORG = "org_every_ending";
const CONTROL = process.env.GOAL_CONTROL ?? "";
const PHASE = process.env.GOAL_PHASE ?? "main";
const SCRATCH = process.env.GOAL_SCRATCH ?? goalTmpDir("every-ending");
/** What each worker saw from inside its own run, and what the intake was sent. */
const PROOFS = join(SCRATCH, "proofs.ndjson");
const INTAKE = join(SCRATCH, "intake.ndjson");
const KILL_DB = join(SCRATCH, "kill.sqlite");
const KILL_PLAN = join(SCRATCH, "kill-plan.json");

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

type Proof = { taskId?: string; attempt: number; sessionId: string; goal: string; at: number };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const lines = <T,>(file: string): T[] =>
  existsSync(file)
    ? readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as T)
    : [];

// ---- the host ---------------------------------------------------------------

const worker = (id: string, declared: Record<string, unknown>): WorkerManifest => ({ id, declared, body: "", skills: [] });
const WORKERS: WorkerManifest[] = [
  worker("lead", { flow: "desk", delegates: ["eng.doer"] }),
  // A worker files its pieces for another: one naming itself is a step it works inline.
  worker("eng.doer", { flow: "doer", delegates: ["eng.helper"] }),
  worker("eng.helper", { flow: "doer", delegates: [] })
];

type Script = { op: "file"; tasks: TaskInit[] } | { op: "wait"; taskId: string } | { op: "two-passes" };

/**
 * What a worker does with its goal, deterministically:
 *   [slow:N]      take N ms        [slow-first:N]  take N ms on attempt 1 only
 *   [fail]        throw            [file:NAME]     file a piece NAME for its helper, then end
 */
async function work(goal: string, attempt: number): Promise<string> {
  const slow = /\[slow:(\d+)\]/.exec(goal);
  if (slow !== null) await sleep(Number(slow[1]));
  const first = /\[slow-first:(\d+)\]/.exec(goal);
  if (first !== null && attempt <= 1) await sleep(Number(first[1]));
  if (goal.includes("[fail]")) throw new Error(`attempt ${attempt} fails on purpose`);
  return `done: ${goal}`;
}

function buildHost(filename: string) {
  let workerFlows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({ standardWorkers: WORKERS, workerFlows: () => workerFlows as never });
  const doorInput = z.object({ message: z.string() });
  const deskBoard = defineSessionBoard({ installation, flowKind: "desk" });
  const doerBoard = defineSessionBoard({ installation, flowKind: "doer" });

  const deskTurn = handler({
    name: "every-ending-desk-turn",
    inputSchema: doorInput,
    outputSchema: z.unknown(),
    execute: async (input, rawCtx) => {
      const ctx = rawCtx as unknown as BlockContext;
      const script = JSON.parse(input.message) as Script;
      const ref = await deskBoard.board.resolver(ctx as never);
      if (ref === undefined) return { ok: false, error: "no_delegation_board" };
      // The wait parks the turn by throwing its park; nothing here may catch it.
      // Release the held task, then wait on it, as `updateTask({ status:
      // "pending" })` then `getTask({ id, wait: true })` do (FIX-2082).
      if (script.op === "wait") {
        await ref.release(script.taskId);
        const waited = await waitOnTask(ctx as never, ref, script.taskId, { key: `goal.wait:${script.taskId}` });
        return waited.ok ? { ok: true, status: waited.task.status, answer: waited.task.output } : waited;
      }
      try {
        if (script.op === "file") return { ok: true, ids: (await ref.addTasks(script.tasks)).map((t) => t.id) };
        if (script.op === "two-passes") {
          const send = () =>
            dispatchThroughSeam(ctx, { type: "internal", action: "dispatch", session: { id: ctx.session.identity.id }, payload: {}, from: "goal-two-passes" });
          return { ok: true, outcomes: await Promise.all([send(), send()]) };
        }
        return { ok: false, error: "unknown op" };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  });

  const doerTurn = handler({
    name: "every-ending-doer-turn",
    inputSchema: doorInput,
    outputSchema: z.unknown(),
    execute: async (input, rawCtx) => {
      const ctx = rawCtx as unknown as BlockContext;
      const above = await filingConversationBoard(ctx);
      const row = above?.tasks.list().find((r) => r.run?.requestId === ctx.request.identity.id && r.status === "in_progress");
      const attempt = row?.attempts ?? 0;
      const proof: Proof = { ...(row !== undefined ? { taskId: row.id } : {}), attempt, sessionId: ctx.session.identity.id, goal: input.message, at: Date.now() };
      appendFileSync(PROOFS, `${JSON.stringify(proof)}\n`, "utf8");
      const piece = /\[file:([^\]]+)\]/.exec(input.message);
      if (piece !== null) {
        const ref = await doerBoard.board.resolver(ctx as never);
        await ref!.addTask({ goal: `${piece[1]} [slow:400]`, assignee: "eng.helper" });
        return "filed a piece";
      }
      return work(input.message, attempt);
    }
  });

  const flowOf = (kind: string, board: ReturnType<typeof defineSessionBoard>, turn: typeof deskTurn) =>
    defineFlow({
      kind,
      configSchema: workerConfigSchema(),
      session: { ...installation.session(board.sessionStateShape), serverOwned: [...board.serverOwned] },
      resources: { ...installation.resources, ...board.resources },
      actions: { respond: { inputSchema: doorInput.strict(), block: turn, userMessage: (i: { message: string }) => i.message }, ...board.actions },
      internal: { actions: board.entries(turn, () => "fixed") },
      task: { actions: { work: workerTaskEntry({ name: `every-ending-${kind}-task`, turn: turn as never }) } }
    } as never);
  workerFlows = {
    desk: { flow: flowOf("desk", deskBoard, deskTurn), roles: ["contributor", "manager"] },
    doer: { flow: flowOf("doer", doerBoard, doerTurn as never), roles: ["contributor", "manager"] }
  };

  // The plain flow: orchestration's board, with no Workforce, handing rows to
  // its own task entry in sessions of their own.
  const plans = defineTaskCollection({ id: "plans", scope: "user" });
  const planBoard = taskBoard({
    name: "plain-plans",
    boardId: "plans",
    mode: "delegation",
    collection: plans,
    workers: { doer: dispatcher({ name: "plain-hand-off", type: "task", action: "work", session: "per-task" }) as unknown as TaskWorker },
    onIdle: "complete",
    maxIterations: 50
  });
  const plansRef = async (ctx: BlockContext) =>
    getOrCreateTaskCollection({ ctx, backing: "resource", collectionId: "plans", collection: resolveResourceCollection(ctx, "plans")! });
  const plainWork = handler({
    name: "plain-work",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.unknown(),
    execute: async (task: TaskWorkerInput) => work(task.goal, 1)
  });
  const fileTasks = handler({
    name: "plain-file",
    inputSchema: z.object({ tasks: z.array(z.object({ id: z.string(), goal: z.string(), held: z.boolean().optional() })) }),
    outputSchema: z.unknown(),
    execute: async (input, ctx) => {
      const ref = await plansRef(ctx as never);
      await ref.addTasks(input.tasks.map((t) => ({ ...t, assignee: "doer", maxAttempts: 1 })));
      return {};
    }
  });
  const cancelTask = handler({
    name: "plain-cancel",
    inputSchema: z.object({ taskId: z.string() }),
    outputSchema: z.unknown(),
    execute: async (input, ctx) => (await plansRef(ctx as never)).cancel(input.taskId, "a person cancelled it")
  });
  // The plain flow's own handling: it writes nothing; the store keeps the request.
  const onEnding = handler({ name: "plain-on-ending", inputSchema: taskSettledInputSchema, outputSchema: z.unknown(), execute: () => ({}) });
  const planner = defineFlow({
    kind: "planner",
    resources: { plans },
    actions: {
      plan: { inputSchema: z.object({ tasks: z.array(z.object({ id: z.string(), goal: z.string(), held: z.boolean().optional() })) }), block: sequencer({ name: "plain-plan", inputSchema: z.unknown() }).tap(fileTasks).step(planBoard.drain) },
      cancel: { inputSchema: z.object({ taskId: z.string() }), block: cancelTask }
    },
    internal: { actions: { onTaskSettled: taskSettledEntry({ block: onEnding }) } },
    task: { actions: { work: { block: plainWork } } }
  } as never)({ id: "planner" });

  // A stand-in for the Error Reporter's intake: what it is sent, recorded.
  const intake = defineFlow({
    kind: "error-reporter-intake",
    actions: {},
    internal: {
      actions: {
        intake: {
          inputSchema: z.object({ occurrence: z.record(z.string(), z.unknown()) }),
          block: handler({
            name: "stand-in-intake",
            inputSchema: z.object({ occurrence: z.record(z.string(), z.unknown()) }),
            outputSchema: z.unknown(),
            execute: (input) => {
              appendFileSync(INTAKE, `${JSON.stringify(input.occurrence)}\n`, "utf8");
              return { decision: "taken" };
            }
          })
        }
      }
    }
  } as never)({ id: "error-reporter-intake" });

  const state = createFlowState({
    flows: { ...Object.fromEntries(hireWorkforce(installation).map((copy) => [copy.id, copy])), planner, "error-reporter-intake": intake },
    stores: { default: { primary: sqliteStores({ filename }) } },
    logger: silentLogger,
    resolvePrincipal: (context: any) => {
      const user = context.request?.headers.get("x-user");
      return typeof user === "string" ? { userId: user, orgId: ORG } : null;
    }
  } as never);

  const connect = async () => {
    // The router is what runs the durability sweeper.
    const http = actingAs((await state.getRouter()) as never, USER);
    const runtime = await state.getRuntime();
    /** Every task row in the user's cell, from every ledger: anything else there (chain records) is left out. */
    const rows = async (): Promise<Array<Task & { key: string }>> =>
      Object.entries(await runtime.stores.resourceState.getByPrefix("user", `${USER}:~org:${ORG}`, ""))
        .map(([key, value]) => ({ ...(value.state as Task), key }))
        .filter((row) => typeof row.goal === "string" && typeof row.status === "string");
    const byId = async (id: string) => (await rows()).find((r) => r.id === id);
    /** The `onTaskSettled` requests a session ran, by the task each was about. */
    const heard = async (sessionId: string) =>
      (await runtime.stores.request.list({ sessionId }))
        .filter((r) => r.actionName === "onTaskSettled" && (r.input as { taskId?: string } | undefined)?.taskId !== undefined)
        .map((r) => ({ ...(r.input as { taskId: string; ending: string; error?: string; cancelled?: string[] }), at: r.startedAtMs }));
    const passes = async (sessionId: string) =>
      (await runtime.stores.request.list({ sessionId, withItems: true })).filter((r) => r.actionName === "dispatch");
    const act = (flow: string, session: string, action: string, input: unknown) => http.act(flow, session, action, input);
    const script = (session: string, s: Script) => act("desk", session, "respond", { message: JSON.stringify(s) });
    const until = async (check: () => Promise<boolean>, ms: number) => {
      for (const deadline = Date.now() + ms; Date.now() < deadline; await sleep(50)) if (await check()) return true;
      return check();
    };
    return { runtime, http, rows, byId, heard, passes, act, script, until };
  };
  return { state, connect };
}

const word = (name: string) => `${name} ${RUN_STAMP}`;

// ---- the second process: killed after an ending (b), or mid-claim (e) -------

if (PHASE === "kill-after-ending" || PHASE === "kill-mid-claim") {
  const host = buildHost(KILL_DB);
  const h = await host.connect();
  const conversation = await h.http.open("desk", { workerId: "lead" });
  if (PHASE === "kill-after-ending") {
    // X files a piece and ends its turn, parked on it; the piece's ending is
    // written, and this process dies before its notice is sent.
    const x = `kill-x-${RUN_STAMP}`;
    writeFileSync(KILL_PLAN, JSON.stringify({ conversation, x, piece: `kill-piece-${RUN_STAMP}` }), "utf8");
    await h.script(conversation, { op: "file", tasks: [{ id: x, goal: `[file:kill-piece-${RUN_STAMP}] parent` }] });
    // Under a control nothing kills this process: it leaves once the piece ended.
    await h.until(async () => (await h.rows()).some((r) => r.goal.startsWith(`kill-piece-${RUN_STAMP}`) && r.status === "completed"), 20_000);
    await sleep(500);
    process.exit(0);
  }
  // A worker holds a claim on Z, slow on its first attempt; this process dies.
  const z = `kill-z-${RUN_STAMP}`;
  await h.script(conversation, { op: "file", tasks: [{ id: z, goal: "[slow-first:600000] held through a crash" }] });
  await h.until(async () => lines<Proof>(PROOFS).some((p) => p.taskId === z), 15_000);
  await sleep(300);
  const row = await h.byId(z);
  writeFileSync(KILL_PLAN, JSON.stringify({ conversation, z, leaseUntil: row?.leaseUntil, killedAt: Date.now() }), "utf8");
  process.exit(0);
}

// ---- the legs ----------------------------------------------------------------

await runGoal(async (failures, tell) => {
  writeFileSync(PROOFS, "", "utf8");
  writeFileSync(INTAKE, "", "utf8");
  const notes: string[] = [];
  const leg = async (name: string, body: () => Promise<void>) => {
    try {
      await body();
    } catch (error) {
      failures.push(`${name}:threw — ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const once = (heard: Array<{ taskId: string }>, id: string) => heard.filter((n) => n.taskId === id).length;

  const host = buildHost(join(SCRATCH, `main-${RUN_STAMP}.sqlite`));
  try {
    const h = await host.connect();
    const conversation = await h.http.open("desk", { workerId: "lead" });
    const planner = await h.http.open("planner", {});

    // ---- a. every ending, two flows -------------------------------------------------
    await leg("a", async () => {
      const done = `a-done-${RUN_STAMP}`;
      const failed = `a-failed-${RUN_STAMP}`;
      const cancelled = `a-cancelled-${RUN_STAMP}`;
      const waited = `a-waited-${RUN_STAMP}`;
      await h.script(conversation, {
        op: "file",
        tasks: [
          { id: done, goal: word("done") },
          { id: failed, goal: word("[fail] failed"), maxAttempts: 1 },
          { id: cancelled, goal: word("cancelled by a person"), held: true },
          { id: waited, goal: word("[slow:300] waited on"), held: true }
        ]
      });
      await h.act("desk", conversation, "updateTask_tasks", { id: cancelled, status: "cancelled" });
      // Over HTTP the waiting turn suspends (the helper says so by throwing); its
      // answer is its finished request's result.
      await h.script(conversation, { op: "wait", taskId: waited }).catch(() => undefined);
      const waitedTurn = async () =>
        (await h.runtime.stores.request.list({ sessionId: conversation })).find(
          (r) => r.actionName === "respond" && JSON.stringify(r.input ?? "").includes(waited)
        );
      await h.until(async () => (await waitedTurn())?.status === "completed", 10_000);
      const answer = ((await waitedTurn())?.result as { output?: { ok?: boolean; answer?: unknown } } | undefined)?.output;
      await h.act("planner", planner, "plan", {
        tasks: [
          { id: `p-${done}`, goal: word("done") },
          { id: `p-${failed}`, goal: word("[fail] failed") },
          { id: `p-${cancelled}`, goal: word("cancelled by a person"), held: true }
        ]
      });
      await h.act("planner", planner, "cancel", { taskId: `p-${cancelled}` });
      await h.until(async () => (await h.heard(conversation)).length >= 3 && (await h.heard(planner)).length >= 3, 10_000);
      await sleep(2_500); // a duplicate would arrive by now
      const desk = tell.over("a · the conversation's notices", await h.heard(conversation));
      const plain = tell.over("a · the plain flow's notices", await h.heard(planner));
      for (const [id, ending] of [[done, "completed"], [failed, "errored"], [cancelled, "cancelled"]] as const) {
        if (once(desk, id) !== 1 || desk.find((n) => n.taskId === id)?.ending !== ending) {
          failures.push(`a:each ending heard once — Workforce ${id}: heard ${once(desk, id)} time(s), ${desk.find((n) => n.taskId === id)?.ending}`);
        }
        if (once(plain, `p-${id}`) !== 1 || plain.find((n) => n.taskId === `p-${id}`)?.ending !== ending) {
          failures.push(`a:each ending heard once — plain flow p-${id}: heard ${once(plain, `p-${id}`)} time(s), ${plain.find((n) => n.taskId === `p-${id}`)?.ending}`);
        }
      }
      if (answer?.ok !== true || once(desk, waited) !== 0) {
        failures.push(`a:a waited task resumes its waiter and starts no onTaskSettled — the wait answered ${JSON.stringify(answer)}, onTaskSettled ran ${once(desk, waited)} time(s)`);
      }
      notes.push(`a: Workforce heard ${desk.length} ending(s), the plain flow ${plain.length}; the waiter got ${JSON.stringify(answer?.answer ?? null).slice(0, 60)}`);
    });

    // ---- c. a dependent starts on its own; one pass at a time ---------------------------
    await leg("c", async () => {
      const first = `c-first-${RUN_STAMP}`;
      const then = `c-then-${RUN_STAMP}`;
      await h.script(conversation, { op: "file", tasks: [{ id: first, goal: word("[slow:500] first") }, { id: then, goal: word("then"), deps: [first] }] });
      // No action on the board from here: only the ending's own delivery, or a wake.
      await h.until(async () => (await h.byId(then))?.startedAt !== undefined, 8_000);
      const a = await h.byId(first);
      const b = await h.byId(then);
      const gap = (b?.startedAt ?? Infinity) - (a?.completedAt ?? 0);
      if (!(gap <= 5_000)) failures.push(`c:a dependent starts within 5 s, with no read of the board — it started ${gap} ms after its dependency ended (${b?.status})`);
      const two = await h.script(conversation, { op: "two-passes" });
      await sleep(1_500);
      const runs = (await h.passes(conversation))
        .filter((r) => r.completedAtMs !== undefined && r.status === "completed")
        .map((r) => ({ id: r.id, ran: Math.min(...(r.items ?? []).map((item) => (item as { ts?: number }).ts ?? Infinity)), ended: r.completedAtMs! }))
        .filter((r) => Number.isFinite(r.ran))
        .sort((x, y) => x.ran - y.ran);
      tell.over("c · the conversation's passes", runs);
      const overlaps = runs.filter((r, i) => i > 0 && r.ran < runs[i - 1]!.ended);
      if (overlaps.length > 0) failures.push(`c:one pass at a time — ${overlaps.length} pass(es) started while another ran`);
      notes.push(`c: the dependent started ${gap} ms after its dependency ended; ${runs.length} pass(es), none overlapping; two at once answered ${JSON.stringify((two?.outcomes ?? []).map((o: { ok: boolean; refused?: string }) => (o.ok ? "ok" : o.refused)))}`);
    });

    // ---- d. a final failure ------------------------------------------------------------------
    await leg("d", async () => {
      const failing = `d-fails-${RUN_STAMP}`;
      const dependent = `d-dependent-${RUN_STAMP}`;
      await h.script(conversation, {
        op: "file",
        tasks: [
          { id: failing, goal: word("[slow:300][fail] fails for good"), maxAttempts: 1 },
          { id: dependent, goal: word("depends on it"), deps: [failing] }
        ]
      });
      await h.until(async () => (await h.heard(conversation)).some((n) => n.taskId === failing), 10_000);
      await sleep(2_500);
      const heard = await h.heard(conversation);
      const notice = heard.filter((n) => n.taskId === failing);
      if (notice.length !== 1 || notice[0]!.ending !== "errored" || !(notice[0]!.error ?? "").includes("fails on purpose") || !(notice[0]!.cancelled ?? []).includes(dependent)) {
        failures.push(`d:one failure notice, with its error, naming the dependent it cancelled — ${JSON.stringify(notice)}`);
      }
      if (once(heard, dependent) !== 0) failures.push(`d:no notice of its own for the cancelled dependent — heard ${once(heard, dependent)}`);
      const occurrences = lines<{ taskId?: string }>(INTAKE).filter((o) => o.taskId === failing);
      if (occurrences.length !== 1) failures.push(`d:one task occurrence at the intake — ${occurrences.length}`);
      const marked = tell.over("d · stored rows", await h.rows()).filter((r) => Object.keys(r.metadata ?? {}).some((k) => k.startsWith("reportOwed:")));
      if (marked.length > 0) failures.push(`d:no report marker on any row — ${marked.map((r) => r.id).join(", ")}`);
      notes.push(`d: one errored notice naming ${notice[0]?.cancelled?.join(", ")}; ${occurrences.length} occurrence at the intake`);
    });
  } finally {
    await host.state.dispose();
  }

  // ---- b. killed after an ending, before its send ----------------------------------------------
  const killed = (phase: string, extra: ModulePatch[]) => {
    rmSync(KILL_PLAN, { force: true });
    rmSync(KILL_DB, { force: true });
    const patches = [...extra, ...(PATCHES[CONTROL] ?? [])];
    const mark = join(SCRATCH, `kill-mark-${phase}-${RUN_STAMP}`);
    const child = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
      stdio: "inherit",
      env: {
        ...process.env,
        GOAL_PHASE: phase,
        GOAL_KILL: phase === "kill-after-ending" ? "after-ending" : "",
        GOAL_SCRATCH: SCRATCH,
        ...(patches.length > 0 ? modulePatchEnv(patches, REPO_ROOT, mark) : {})
      }
    });
    if (patches.length > 0) assertPatched(patches, REPO_ROOT, mark);
    if (child.status !== 0 || !existsSync(KILL_PLAN)) throw new Error(`the second process ended ${child.status} with no plan`);
    return JSON.parse(readFileSync(KILL_PLAN, "utf8")) as unknown;
  };

  await leg("b", async () => {
    const plan = killed("kill-after-ending", [KILL_AFTER_ENDING]) as unknown as { conversation: string; x: string; piece: string };
    const restarted = buildHost(KILL_DB);
    try {
      const h = await restarted.connect();
      const back = Date.now();
      const piece = (await h.rows()).find((r) => r.goal.startsWith(plan.piece));
      const taskSession = lines<Proof>(PROOFS).find((p) => p.taskId === plan.x)?.sessionId;
      if (piece === undefined || taskSession === undefined) {
        throw new Error(
          `the second process left ${piece === undefined ? "no piece" : "a piece"} and ${taskSession === undefined ? "no task session" : "a task session"}: ` +
            `rows ${JSON.stringify((await h.rows()).map((r) => [r.goal.slice(0, 40), r.status]))}, proofs ${JSON.stringify(lines<Proof>(PROOFS).map((p) => [p.taskId, p.goal.slice(0, 30)]))}`
        );
      }
      // No action on any board: only a wake can pay it.
      await h.until(async () => (await h.heard(taskSession)).some((n) => n.taskId === piece.id), 6_000);
      await h.until(async () => (await h.byId(plan.x))?.status === "completed", 6_000);
      const told = (await h.heard(taskSession)).filter((n) => n.taskId === piece.id);
      const parent = await h.byId(plan.x);
      // The notice falls due NOTICE_DUE_MS after the piece's ending; a restart
      // before that may wait for it. Both are measured from the later of the two.
      const due = Math.max(back, (piece.completedAt ?? back) + NOTICE_DUE_MS);
      const toldIn = told.length === 0 ? Infinity : told[0]!.at - due;
      const settledIn = parent?.completedAt === undefined || parent.status !== "completed" ? Infinity : parent.completedAt - due;
      if (!(toldIn <= 2_000) || told.length !== 1) failures.push(`b:the filer hears within due time — ${told.length} notice(s), the first ${toldIn} ms after its due time`);
      if (!(settledIn <= 2_000)) failures.push(`b:the parent whose last filed task ended settles within due time — ${parent?.status}, ${settledIn} ms after its due time`);
      notes.push(`b: the notice fell due ${due - back} ms after the restart; the filer heard ${toldIn} ms and the parent settled ${settledIn} ms after that`);
    } finally {
      await restarted.state.dispose();
    }
  });

  // ---- e. a claimant killed mid-lease ----------------------------------------------------------
  await leg("e", async () => {
    const plan = killed("kill-mid-claim", []) as unknown as { conversation: string; z: string; leaseUntil?: number };
    if (plan.leaseUntil === undefined) throw new Error("the row held no lease when the process died");
    const restarted = buildHost(KILL_DB);
    try {
      const h = await restarted.connect();
      const deadline = plan.leaseUntil + 2_000;
      // No action on the board: only the wake at the lease's end can reclaim it.
      await h.until(async () => {
        const row = await h.byId(plan.z);
        return row !== undefined && (row.attempts >= 2 || row.status === "completed" || row.status === "errored");
      }, Math.max(0, deadline - Date.now()) + 500);
      const row = await h.byId(plan.z);
      const at = Date.now();
      if (row === undefined || !(row.attempts >= 2 || ["completed", "errored"].includes(row.status)) ) {
        failures.push(`e:within its lease's end plus 2 s the row is reclaimed or settled — at ${at - plan.leaseUntil} ms past the lease it is ${row?.status}, attempt ${row?.attempts}`);
      }
      notes.push(`e: the lease ended ${plan.leaseUntil - Date.now()} ms from now; the row is ${row?.status}, attempt ${row?.attempts}`);
    } finally {
      await restarted.state.dispose();
    }
  });

  return { failures, evidence: notes.join("; ") };
});
