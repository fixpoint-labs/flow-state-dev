/**
 * Goal check — a dispatched task is settled once, by the claim gate, only
 * when its work is over, and a task that waits is never run twice (FIX-2077).
 *
 * **Model-free.** A real `createFlowState` host on a durable SQLite store, the
 * Workforce session board on two flows (`desk`, the conversation that files,
 * and `doer`, whose task sessions work and file pieces for `eng.helper`),
 * deterministic workers, driven over the host's HTTP router as a verified
 * caller. Every grade reads the stored rows, the requests the engine stored,
 * or the proof each worker wrote from inside its own run: never the gate's
 * calls.
 *
 * Legs (each failure is tagged `<leg>:<assertion>`):
 *   a  background work: settled after the last write of the side chain the
 *      task's work starts, and of the one the flow's `onFinished` starts; once
 *   b  pieces: running and waiting on them while one is open; settled once with
 *      the last woken turn's answer, no running row left. Variant: the last
 *      piece ends during the task's own request, whose check leaves it running;
 *      it settles after the turn the piece's notice wakes, with that answer
 *   c  a message queued mid-task: the task settles with its work's answer
 *      when the work ends, and the message runs after, outside the task (no
 *      claim, so no checkpoint), never delaying the settle
 *   d  a wait and a person's stop: each still running on attempt 1, no lease,
 *      after a pass past the lease the claim committed to; done after the
 *      resume, still attempt 1
 *
 * Control: GOAL_CONTROL=settle-at-return checks the task where its entry
 * returns instead of after the request's last drain (a scratch patch to
 * orchestration as it loads; `goals/lib/module-patch.mts`). Must FAIL leg a on
 * `a:after-the-side-chains`.
 *
 * Run: pnpm tsx goals/task-board/settles-when-its-work-is-over/run.mts
 * Legs: GOAL_LEGS=a,b,c,d (default: all; d waits out a two-minute lease)
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { dispatchThroughSeam, markDispatcher, type BlockContext } from "@flow-state-dev/core/types";
import { continueRequest, createFlowState } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { currentWorkerClaim } from "@flow-state-dev/orchestration/task-board";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import { TASK_ID_STATE_KEY } from "../../../packages/workforce/src/workers/keys.ts";
import {
  createWorkerInstallation,
  defineSessionBoard,
  filingConversationBoard,
  hireWorkforce,
  workerConfigSchema,
  workerTaskEntry,
  type WorkerManifest
} from "@flow-state-dev/workforce";
import { messageLogOf } from "../../../packages/workforce/src/messages/message-log.ts";
import { MESSAGE_RECEIVED_ENTRY } from "../../../packages/workforce/src/messages/keys.ts";
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

const USER = "u_settles_when_over";
const ORG = "org_settles_when_over";
const CONTROL = process.env.GOAL_CONTROL ?? "";
const SCRATCH = process.env.GOAL_SCRATCH ?? goalTmpDir("settles-when-over");
/** Where each worker writes what it saw and did, from inside its own run. */
const PROOFS = join(SCRATCH, "proofs.ndjson");
/** How long background work writes after the entry returns. */
const BACKGROUND_MS = 400;
/** The lease a claim commits to by default: leg d waits it out. */
const LEASE_MS = 120_000;
const ALL_LEGS = ["a", "b", "c", "d"] as const;

const PATCHES: Record<string, ModulePatch[]> = {
  // The check runs where the entry returns: no request-end hook, so the
  // admission is checked inline, at the answer (today's settle point).
  "settle-at-return": [
    {
      module: "packages/orchestration/src/task-board/task-request.ts",
      from: String.raw`const registered = onRequestEnded\(ctx, \(ending\) => endRequest\(key, record, ending\)\);`,
      to: "const registered = false;"
    }
  ]
};
const CONTROL_LEGS: Record<string, string[]> = { "settle-at-return": ["a"] };

if (CONTROL !== "" && PATCHES[CONTROL] === undefined) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(PATCHES).join(", ")}`);
  process.exit(2);
}
// A control runs this same file again with its patch applied as it loads.
if (PATCHES[CONTROL] !== undefined && process.env.GOAL_MODULE_PATCH === undefined) {
  const mark = join(SCRATCH, `patch-mark-${RUN_STAMP}`);
  rmSync(mark, { force: true });
  console.error(`control ${CONTROL}:\n${describePatches(PATCHES[CONTROL]!, REPO_ROOT)}`);
  const child = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: {
      ...process.env,
      GOAL_SCRATCH: SCRATCH,
      GOAL_LEGS: process.env.GOAL_LEGS ?? CONTROL_LEGS[CONTROL]!.join(","),
      ...modulePatchEnv(PATCHES[CONTROL]!, REPO_ROOT, mark)
    }
  });
  assertPatched(PATCHES[CONTROL]!, REPO_ROOT, mark);
  process.exit(child.status ?? 1);
}
const legs = new Set((process.env.GOAL_LEGS ?? ALL_LEGS.join(",")).split(",").map((s) => s.trim()).filter(Boolean));

type Proof = {
  kind: "turn" | "woken" | "message" | "background" | "on-finished" | "piece";
  requestId: string;
  sessionId: string;
  taskId?: string;
  answer?: unknown;
  /** On a message: whether its turn held a task's claim, the task's status as it began, and a checkpoint it reported. */
  claimed?: boolean;
  taskStatus?: string;
  reported?: string;
  at: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const prove = (proof: Proof) => appendFileSync(PROOFS, `${JSON.stringify(proof)}\n`, "utf8");
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
  worker("eng.doer", { flow: "doer", delegates: ["eng.helper"] }),
  worker("eng.helper", { flow: "doer" })
];

/** Requests whose flow `onFinished` starts background work of its own: leg a's. */
const finishWrites = new Set<string>();

function buildHost(filename: string) {
  let workerFlows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({ standardWorkers: WORKERS, workerFlows: () => workerFlows as never });
  const doorInput = z.object({ message: z.string() });
  const deskBoard = defineSessionBoard({ installation, flowKind: "desk" });
  const doerBoard = defineSessionBoard({ installation, flowKind: "doer" });

  // The desk: a person's conversation. Its turn is never woken (fixed policy).
  const deskTurn = handler({ name: "settles-desk-turn", inputSchema: doorInput, outputSchema: z.unknown(), execute: (input) => `noted: ${input.message}` });

  /** The running row this request holds, read the way the gate wrote it. */
  const heldRow = async (ctx: BlockContext): Promise<Task | undefined> => {
    const above = await filingConversationBoard(ctx);
    const claim = currentWorkerClaim(ctx);
    return above?.tasks
      .list({ status: "in_progress" })
      .find((r) => r.run?.requestId === ctx.request.identity.id || r.id === claim?.taskId);
  };

  // A peer's message arriving mid-task, addressed to this task session: one
  // delivered row in the user's message log, and its delivery dispatched.
  const queueMessage = markDispatcher(
    handler({
      name: "settles-queue-message",
      inputSchema: z.object({ checkpoint: z.boolean() }),
      outputSchema: z.unknown(),
      execute: async (input, rawCtx) => {
        const ctx = rawCtx as unknown as BlockContext;
        const id = `msg_${RUN_STAMP}_${Math.random().toString(16).slice(2, 10)}`;
        const sessionId = ctx.session.identity.id;
        await messageLogOf(ctx).getOrCreate(id, {
          id,
          from: "eng.helper",
          to: "eng.doer",
          text: input.checkpoint ? "Report a checkpoint. [checkpoint]" : "A note while you work.",
          exchange: id,
          fromSession: sessionId,
          fromFlow: "doer",
          toSession: sessionId,
          toFlow: "doer",
          hop: 1,
          status: "delivered",
          at: Date.now()
        } as never);
        await dispatchThroughSeam(ctx, {
          type: "internal",
          action: MESSAGE_RECEIVED_ENTRY,
          flowKind: "doer",
          session: { id: sessionId },
          payload: { messageId: id },
          from: "settles-queue-message"
        });
        return id;
      }
    }),
    { type: "internal", action: MESSAGE_RECEIVED_ENTRY }
  );

  // The doer's turn. On its task it reads marks in the task:
  //   [background]   the request's own side chain, and its onFinished's, write after it returns
  //   [split:N:MS]   file N pieces for eng.helper, each taking MS
  //   [after:MS]     take MS after filing
  //   [message] / [message-checkpoint]  a message arrives for this session mid-task
  //   [stop:REASON]  stop and wait (ctx.suspend)
  // On a notice ("Task ...") it answers; on a message it answers, and may report a checkpoint.
  type Base = { requestId: string; sessionId: string; taskId?: string };
  /** Answer, and prove what this request answered. */
  const answered = (kind: Proof["kind"], base: Base, answer: string, extra: Partial<Proof> = {}) => {
    prove({ kind, ...base, answer, ...extra, at: Date.now() });
    return answer;
  };
  /**
   * A message's turn, conversation in the task's session: it reads the task
   * the session works, and asks for a checkpoint when the message says so,
   * which only a request holding the task's claim can write.
   */
  const onMessage = async (ctx: BlockContext, base: Base, message: string) => {
    const taskId = (ctx.session.state as Record<string, unknown> | undefined)?.[TASK_ID_STATE_KEY];
    const above = await filingConversationBoard(ctx);
    const task = typeof taskId === "string" ? above?.tasks.get(taskId) : undefined;
    const claim = currentWorkerClaim(ctx);
    let reported: string | undefined;
    if (message.includes("[checkpoint]") && task !== undefined && claim !== undefined) {
      reported = (await above!.tasks.reportProgress!(task.id, { output: `checkpoint ${base.requestId}` }, { claim })).outcome;
    }
    const at = { ...base, ...(task !== undefined ? { taskId: task.id } : {}) };
    return answered("message", at, "", {
      claimed: claim !== undefined,
      ...(task !== undefined ? { taskStatus: task.status } : {}),
      ...(reported !== undefined ? { reported } : {})
    });
  };
  /** A piece's turn, on eng.helper. */
  const onPiece = async (base: Base, ms: number) => {
    await sleep(ms);
    prove({ kind: "piece", ...base, at: Date.now() });
    return "piece done";
  };
  /** File the pieces a `[split:N:MS]` mark asks for. */
  const fileSplit = async (ctx: BlockContext, row: Task | undefined, split: RegExpExecArray) => {
    const ref = await doerBoard.board.resolver(ctx as never);
    for (let i = 0; i < Number(split[1]); i += 1) {
      await ref!.createTask({ goal: `piece ${i} of ${row?.id} ${RUN_STAMP} [slow:${split[2]}]`, assignee: "eng.helper" });
    }
  };
  /** The task's own turn, by its marks. */
  const onTask = async (ctx: BlockContext, base: Base, message: string, row: Task | undefined) => {
    if (message.includes("[background]")) finishWrites.add(base.requestId);
    const split = /\[split:(\d+):(\d+)\]/.exec(message);
    if (split !== null) await fileSplit(ctx, row, split);
    const after = /\[after:(\d+)\]/.exec(message);
    if (after !== null) await sleep(Number(after[1]));
    const stop = /\[stop:([a-z_]+)\]/.exec(message);
    if (stop === null) return answered("turn", base, `work answer ${base.requestId}`);
    const resolution = await ctx.suspend!({ reason: stop[1]!, message: `waiting (${stop[1]})` });
    return answered("turn", base, `resumed ${JSON.stringify(resolution)}`);
  };

  // The doer's turn. On its task it reads marks in the task:
  //   [background]   the request's own side chain, and its onFinished's, write after it returns
  //   [split:N:MS]   file N pieces for eng.helper, each taking MS
  //   [after:MS]     take MS after filing
  //   [message] / [message-checkpoint]  a message arrives for this session mid-task
  //   [stop:REASON]  stop and wait (ctx.suspend)
  // On a notice ("Task ...") it answers; on a message it asks for a checkpoint
  // when told to, and ends with no text, so nothing is relayed back.
  const doerTurn = handler({
    name: "settles-doer-turn",
    inputSchema: doorInput,
    outputSchema: z.unknown(),
    execute: async (input, rawCtx) => {
      const ctx = rawCtx as unknown as BlockContext;
      const row = await heldRow(ctx);
      const base: Base = { requestId: ctx.request.identity.id, sessionId: ctx.session.identity.id, ...(row !== undefined ? { taskId: row.id } : {}) };
      const message = input.message;
      if (message.startsWith('Task "')) return answered("woken", base, `woken answer ${base.requestId}`);
      if (message.startsWith("Message ")) return onMessage(ctx, base, message);
      const slow = /\[slow:(\d+)\]/.exec(message);
      if (slow !== null) return onPiece(base, Number(slow[1]));
      return onTask(ctx, base, message, row);
    }
  });

  /** Background work that writes after the entry returns, in the request's own side chain. */
  const backgroundWrite = handler({
    name: "settles-background-write",
    inputSchema: z.object({ message: z.string() }),
    execute: async (_input, rawCtx) => {
      const ctx = rawCtx as unknown as BlockContext;
      await sleep(BACKGROUND_MS);
      prove({ kind: "background", requestId: ctx.request.identity.id, sessionId: ctx.session.identity.id, at: Date.now() });
    }
  });

  const doerWork = sequencer({ name: "settles-doer-work", inputSchema: doorInput })
    .sideChainIf((input: { message: string }) => input.message.includes("[background]"), backgroundWrite)
    .tapIf(
      (input: { message: string }) => input.message.includes("[message"),
      (input: { message: string }) => ({ checkpoint: input.message.includes("[message-checkpoint]") }),
      queueMessage
    )
    .step(doerTurn);

  /** The flow's own `onFinished`: on leg a's request, background work of its own that outlives the hook. */
  const onFinished = sequencer({ name: "settles-on-finished", inputSchema: z.object({ requestId: z.string() }).passthrough() }).sideChainIf(
    (input: { requestId: string }) => finishWrites.has(input.requestId),
    handler({
      name: "settles-on-finished-write",
      inputSchema: z.object({ requestId: z.string() }).passthrough(),
      execute: async (input, rawCtx) => {
        const ctx = rawCtx as unknown as BlockContext;
        await sleep(BACKGROUND_MS * 2);
        prove({ kind: "on-finished", requestId: input.requestId, sessionId: ctx.session.identity.id, at: Date.now() });
      }
    })
  );

  const deskFlow = defineFlow({
    kind: "desk",
    configSchema: workerConfigSchema(),
    session: { ...installation.session(deskBoard.sessionStateShape), serverOwned: [...deskBoard.serverOwned] },
    resources: { ...installation.resources, ...deskBoard.resources },
    actions: { respond: { inputSchema: doorInput.strict(), block: deskTurn, userMessage: (i: { message: string }) => i.message }, ...deskBoard.actions },
    internal: { actions: deskBoard.entries(deskTurn, () => "fixed") },
    task: { actions: { work: workerTaskEntry({ name: "settles-desk-task", turn: deskTurn }) } }
  } as never);
  const doerFlow = defineFlow({
    kind: "doer",
    configSchema: workerConfigSchema(),
    session: { ...installation.session(doerBoard.sessionStateShape), serverOwned: [...doerBoard.serverOwned] },
    resources: { ...installation.resources, ...doerBoard.resources },
    actions: { respond: { inputSchema: doorInput.strict(), block: doerWork, userMessage: (i: { message: string }) => i.message }, ...doerBoard.actions },
    // A piece's notice wakes the doer's turn (judgment), so its answer can be the task's result.
    internal: { actions: doerBoard.entries(doerWork, () => "judgment") },
    task: { actions: { work: { ...workerTaskEntry({ name: "settles-doer-task", turn: doerWork }), durable: true } } },
    request: { onFinished }
  } as never);
  workerFlows = { desk: { flow: deskFlow, roles: ["contributor", "manager"] }, doer: { flow: doerFlow, roles: ["contributor", "manager"] } };

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
    /** Every stored row of the user's conversation ledgers, from the store, with its partition. */
    const rows = async (): Promise<Array<Task & { partition: string }>> =>
      Object.entries(await runtime.stores.resourceState.getByPrefix("user", `${USER}:~org:${ORG}`, "tasks/")).map(([key, value]) => ({
        ...(value.state as Task),
        partition: key.split("/")[1]!
      }));
    const byId = async (id: string) => (await rows()).find((r) => r.id === id);
    const act = (session: string, action: string, input: unknown) => http.act("desk", session, action, input);
    const until = async (check: () => Promise<boolean>, ms: number) => {
      for (const deadline = Date.now() + ms; Date.now() < deadline; await sleep(25)) if (await check()) return true;
      return check();
    };
    /** The requests the engine stored in `sessionId`. */
    const requests = async (sessionId: string) =>
      (await runtime.stores.request.list({ sessionId, orderBy: "none", limit: 500 } as never)) as Array<{
        id: string;
        actionName: string;
        status: string;
        createdAt?: number;
        updatedAt?: number;
        completedAtMs?: number;
      }>;
    /**
     * Until nothing runs and every ended request has finished its tail: a
     * request reads `completed` before its end hooks and the background work
     * `onFinished` starts have ended, and the settle comes after both.
     */
    const idle = async () => {
      for (let i = 0; i < 600; i += 1) {
        await untilIdle(runtime.stores);
        const ended = (await runtime.stores.request.list({ orderBy: "none", limit: 2000 } as never)) as Array<{ status: string; finalizedAtMs?: number | null }>;
        if (ended.every((r) => r.status === "suspended" || r.finalizedAtMs != null)) return;
        await sleep(50);
      }
    };
    return { runtime, http, rows, byId, act, until, requests, idle };
  };
  return { state, connect };
}

/** A goal word unique to this run. */
const word = (name: string) => `${name} ${RUN_STAMP}`;

// ---- the legs ----------------------------------------------------------------

type Host = Awaited<ReturnType<ReturnType<typeof buildHost>["connect"]>>;
type Row = Task & { partition: string };
type Tell = Parameters<Parameters<typeof runGoal>[0]>[1];

/** What every leg reads and writes through. */
interface Run {
  h: Host;
  conversation: string;
  failures: string[];
  notes: string[];
  tell: Tell;
}

const show = (value: unknown) => JSON.stringify(value);

/** File `goal` for eng.doer from the desk, as the person does. Its task id. */
async function file(run: Run, goal: string): Promise<string> {
  const filed = await run.h.act(run.conversation, "createTask_tasks", { goal, assignee: "eng.doer" });
  if (filed?.ok !== true) throw new Error(`filing "${goal}" was refused: ${show(filed)}`);
  return filed.taskId as string;
}

const proofsOf = (taskId: string, kind?: Proof["kind"]) =>
  readProofs().filter((p) => p.taskId === taskId && (kind === undefined || p.kind === kind));

/** The notices the desk acted on for a task. */
async function heard(run: Run, taskId: string): Promise<string[]> {
  const session = (await run.h.runtime.stores.session.get(run.conversation)) as { state?: { taskNotices?: string[] } } | null;
  return (session?.state?.taskNotices ?? []).filter((key) => key.startsWith(`${taskId}:`));
}

/** The task session a row ran in. */
const sessionOf = async (run: Run, taskId: string) => (await run.h.byId(taskId))?.run?.sessionId;

/** A request in a task's session, by id. */
async function requestIn(run: Run, taskId: string, requestId: string | undefined) {
  return (await run.h.requests((await sessionOf(run, taskId)) ?? "")).find((r) => r.id === requestId);
}

/** Whether a row completed after every write in `writes`. */
const completedAfter = (row: Row | undefined, writes: Proof[]) =>
  row?.status === "completed" && row.completedAt !== undefined && writes.every((p) => p.at <= row.completedAt!);

/** a. Background work: settled after both background writes, once, with the work's answer. */
async function legA(run: Run): Promise<void> {
  const taskId = await file(run, word("[background] write after you return"));
  await run.h.idle();
  const row = await run.h.byId(taskId);
  const turn = proofsOf(taskId, "turn")[0];
  const writes = readProofs().filter((p) => p.requestId === turn?.requestId && (p.kind === "background" || p.kind === "on-finished"));
  run.tell.over("a · the background writes of the task's request", writes);
  if (writes.length !== 2 || !completedAfter(row, writes)) {
    run.failures.push(
      `a:after-the-side-chains — wanted the task completed after the last write of its request's side chain and of the one onFinished starts; it is ${row?.status} at ${row?.completedAt}, the writes ${show(writes.map((p) => [p.kind, p.at]))}`
    );
  }
  const told = await heard(run, taskId);
  if (row?.output !== turn?.answer || told.length !== 1) {
    run.failures.push(`a:once — wanted one ending, heard once, with the work's answer; output ${show(row?.output)}, heard ${show(told)}`);
  }
  run.notes.push(`a: completed ${(row?.completedAt ?? 0) - Math.max(...writes.map((p) => p.at))} ms after the last background write`);
}

/** Whether a task is running, waiting on pieces with no lease, while one of them is open. */
async function waitsOnOpenPieces(run: Run, taskId: string): Promise<boolean> {
  const row = await run.h.byId(taskId);
  const open = (await run.h.rows()).filter((r) => r.filedByTask === taskId && r.status !== "completed");
  return row?.status === "in_progress" && row.keptOpenBy === "filed" && row.leaseUntil === undefined && open.length > 0;
}

/** b, first half: the pieces end after the task's own request ended. */
async function legBAfter(run: Run): Promise<number> {
  const taskId = await file(run, word("[split:2:600] split it"));
  if (!(await run.h.until(() => waitsOnOpenPieces(run, taskId), 10_000))) {
    run.failures.push(`b:waiting-while-open — wanted the task running, waiting on its pieces with no lease, while one is open; read ${show(await run.h.byId(taskId))}`);
  }
  await run.h.idle();
  const row = await run.h.byId(taskId);
  const pieces = (await run.h.rows()).filter((r) => r.filedByTask === taskId);
  const woken = run.tell.over("b · the turns the pieces' endings woke", proofsOf(taskId, "woken"));
  const lastWoken = woken.at(-1);
  const piecesDone = pieces.length === 2 && pieces.every((p) => p.status === "completed");
  if (row?.status !== "completed" || !piecesDone || row.output !== lastWoken?.answer || row.attempts !== 1) {
    run.failures.push(`b:last-turns-answer — wanted it completed once with the last woken turn's answer, both pieces completed; it is ${row?.status}, output ${show(row?.output)}, last woken ${show(lastWoken?.answer)}, pieces ${show(pieces.map((p) => p.status))}`);
  }
  const running = (await run.h.rows()).filter((r) => r.status === "in_progress");
  const told = await heard(run, taskId);
  if (told.length !== 1 || running.length !== 0) {
    run.failures.push(`b:once — wanted one ending heard and no running row left; heard ${show(told)}, running ${show(running.map((r) => r.id))}`);
  }
  return woken.length;
}

/** b, variant: the last piece ends while the task's own request still runs. */
async function legBDuring(run: Run): Promise<unknown> {
  const taskId = await file(run, word("[split:1:50][after:1500] split it and keep working"));
  await run.h.idle();
  const own = proofsOf(taskId, "turn")[0];
  const row = await run.h.byId(taskId);
  const piece = (await run.h.rows()).find((r) => r.filedByTask === taskId);
  const woken = proofsOf(taskId, "woken").at(-1);
  const work = await requestIn(run, taskId, own?.requestId);
  if (piece?.completedAt === undefined || own === undefined || piece.completedAt > own.at) {
    run.failures.push(`b:piece-ends-during-request — wanted the piece to end while the task's own turn ran; the piece ended ${piece?.completedAt}, the turn answered ${own?.at}`);
  }
  const fromWoken = row?.output === woken?.answer && row?.output !== own?.answer;
  if (row?.status !== "completed" || !fromWoken || work?.status !== "completed") {
    run.failures.push(`b:settles-after-woken-turn — wanted the task's own check to leave it running and the woken turn's answer to be the output; it is ${row?.status}, output ${show(row?.output)}, woken ${show(woken?.answer)}, own ${show(own?.answer)}`);
  }
  return row?.output;
}

async function legB(run: Run): Promise<void> {
  const woken = await legBAfter(run);
  const variant = await legBDuring(run);
  run.notes.push(`b: ${woken} woken turns, output from the last; variant output ${show(variant)}`);
}

/**
 * c, one message: the task settles when its work ends, and the message runs
 * after, outside the task. The `[message-checkpoint]` message asks for a
 * checkpoint, which its turn can't write: it holds no claim.
 */
async function legCOne(run: Run, mark: string): Promise<number> {
  const taskId = await file(run, word(`${mark} a message arrives while you work`));
  await run.h.idle();
  const row = await run.h.byId(taskId);
  const own = proofsOf(taskId, "turn")[0];
  const said = run.tell.over(`c · ${mark}'s message turn`, proofsOf(taskId, "message"))[0];
  const settledFirst = said !== undefined && row?.completedAt !== undefined && row.completedAt <= said.at;
  if (!settledFirst) {
    run.failures.push(`c:settles-first — wanted ${mark}'s task completed when its work ended, before its message's turn began; the task ${row?.status} at ${row?.completedAt}, the message's turn at ${said?.at}`);
  }
  if (said === undefined || said.claimed !== false || said.taskStatus !== "completed" || said.reported !== undefined) {
    run.failures.push(`c:outside-the-task — wanted ${mark}'s message turn to hold no claim, see the task completed, and report nothing; it ${show(said)}`);
  }
  if (row?.status !== "completed" || row.output !== own?.answer || row.attempts !== 1 || row.checkpointed === true) {
    run.failures.push(`c:output — wanted ${mark}'s task completed on attempt 1 with the work's answer, no checkpoint; it is ${row?.status} on attempt ${row?.attempts}, output ${show(row?.output)}`);
  }
  const told = await heard(run, taskId);
  if (told.length !== 1) run.failures.push(`c:once — ${mark}'s task heard ${show(told)}`);
  return said === undefined || row?.completedAt === undefined ? Number.NaN : said.at - row.completedAt;
}

async function legC(run: Run): Promise<void> {
  const plain = await legCOne(run, "[message]");
  const checkpoint = await legCOne(run, "[message-checkpoint]");
  run.notes.push(`c: both settled with the work's answer; their messages' turns began ${plain} ms and ${checkpoint} ms after, holding no claim`);
}

const STOPS = [
  ["user_input", "user"],
  ["external_event", "wait"]
] as const;

/**
 * Resolve a task's pending stop and continue its request. A task's request
 * arrived on the `task` source, which no public route re-enters, so the stop
 * is resolved and resumed through the engine, as a host's own answer surface
 * would (FIX-2058's Inbox).
 */
async function resumeStop(run: Run, taskId: string, reason: string): Promise<void> {
  const session = (await sessionOf(run, taskId))!;
  const pending = (await run.h.runtime.stores.suspensions.list({ sessionId: session, status: "pending" } as never)) as Array<{ suspensionId: string; requestId: string }>;
  const suspension = pending[0];
  if (suspension === undefined) {
    run.failures.push(`d:resumes — the ${reason} stop had no pending suspension to resume`);
    return;
  }
  const action = reason === "user_input" ? "submit" : "approve";
  const provider = run.h.runtime.runtimeConfig.durabilityProvider!;
  const record = await provider.loadSuspension(suspension.requestId, suspension.suspensionId);
  await provider.suspend({ ...record!, status: action === "submit" ? "submitted" : "approved", resolvedAt: Date.now(), resumeData: { reason } } as never);
  try {
    const { finished } = await continueRequest({
      requestId: suspension.requestId,
      stores: run.h.runtime.stores,
      flowRegistry: run.h.runtime.registry,
      resumeContext: { suspensionId: suspension.suspensionId, action, data: { reason }, resumedBy: USER },
      runtimeConfig: run.h.runtime.runtimeConfig
    } as never);
    const ended = await finished;
    if (ended.error !== undefined) run.failures.push(`d:resumes — the ${reason} resume ended with ${ended.error.message}`);
  } catch (error) {
    run.failures.push(`d:resumes — the ${reason} resume threw: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** d. A wait and a person's stop keep their claim past the lease, and settle on attempt 1 after the resume. */
async function legD(run: Run): Promise<void> {
  const ids = await Promise.all(STOPS.map(([reason]) => file(run, word(`[stop:${reason}] wait for it`))));
  await run.h.idle();
  const claimedAt = Math.max(...(await Promise.all(ids.map(async (id) => (await run.h.byId(id))?.startedAt ?? Date.now()))));
  for (const [i, [reason, keptOpenBy]] of STOPS.entries()) {
    const row = await run.h.byId(ids[i]!);
    if (row?.status !== "in_progress" || row.keptOpenBy !== keptOpenBy || row.leaseUntil !== undefined) {
      run.failures.push(`d:keeps-its-claim — wanted the ${reason} stop running, waiting on "${keptOpenBy}", with no lease; read ${show(row && { status: row.status, keptOpenBy: row.keptOpenBy, leaseUntil: row.leaseUntil })}`);
    }
  }
  // Past the lease the claim committed to, then a pass of the board that filed them.
  await sleep(Math.max(0, claimedAt + LEASE_MS + 2000 - Date.now()));
  await run.h.act(run.conversation, "listTasks_tasks", {});
  await run.h.idle();
  for (const [i, [reason]] of STOPS.entries()) {
    const row = await run.h.byId(ids[i]!);
    if (row?.status !== "in_progress" || row.attempts !== 1 || proofsOf(ids[i]!, "turn").length !== 0) {
      run.failures.push(`d:not-run-twice — wanted the ${reason} stop still running on attempt 1 after the lease, its work not run again; it is ${row?.status} on attempt ${row?.attempts}`);
    }
  }
  for (const [i, [reason]] of STOPS.entries()) await resumeStop(run, ids[i]!, reason);
  await run.h.idle();
  for (const [i, [reason]] of STOPS.entries()) {
    const row = await run.h.byId(ids[i]!);
    if (row?.status !== "completed" || row.attempts !== 1 || !String(row.output).startsWith("resumed")) {
      run.failures.push(`d:done-after-resume — wanted the ${reason} stop completed on attempt 1 with the resumed answer; it is ${row?.status} on attempt ${row?.attempts}, output ${show(row?.output)}`);
    }
  }
  run.notes.push(`d: both stops held their claim past the lease and completed on attempt 1 after the resume`);
}

const LEGS: Record<string, (run: Run) => Promise<void>> = { a: legA, b: legB, c: legC, d: legD };

await runGoal(async (failures, tell) => {
  writeFileSync(PROOFS, "", "utf8");
  const host = buildHost(join(SCRATCH, `main-${RUN_STAMP}.sqlite`));
  try {
    const h = await host.connect();
    const run: Run = { h, conversation: await h.http.open("desk", { workerId: "lead" }), failures, notes: [], tell };
    for (const name of ALL_LEGS) {
      if (!legs.has(name)) continue;
      // A throw is that leg's failure, and the next leg still runs.
      await LEGS[name]!(run).catch((error: unknown) => failures.push(`${name}:threw — ${error instanceof Error ? error.message : String(error)}`));
    }
    return { failures, evidence: run.notes.join("\n") };
  } finally {
    await host.state.dispose();
  }
});
