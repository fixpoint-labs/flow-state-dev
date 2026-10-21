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
 *   c  a message queued mid-task: its request ends before the settle; the
 *      output is the work's answer, or the checkpoint the message's request
 *      reported, never the message's answer
 *   d  a wait and a person's stop: each still running on attempt 1, no lease,
 *      after a pass past the lease the claim committed to; done after the
 *      resume, still attempt 1
 *
 * Control: GOAL_CONTROL=settle-at-return checks the task where its entry
 * returns instead of after the request's last drain (a scratch patch to
 * orchestration as it loads; `goals/lib/module-patch.mts`). Must FAIL leg a on
 * `a:after-the-side-chains` and leg c on `c:message-ends-first`.
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
import { WORKER_MESSAGE_ENTRY } from "../../../packages/workforce/src/messages/keys.ts";
import {
  REPO_ROOT,
  RUN_STAMP,
  assertPatched,
  describePatches,
  goalTmpDir,
  httpActions,
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
      from: String.raw`const registered = onRequestEnded\(ctx, \(ending\) => endRequest\(key, ending\)\);`,
      to: "const registered = false;"
    }
  ]
};
const CONTROL_LEGS: Record<string, string[]> = { "settle-at-return": ["a", "c"] };

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
          answerTo: { sessionId, flow: "doer" },
          hop: 1,
          status: "delivered",
          at: Date.now()
        } as never);
        await dispatchThroughSeam(ctx, {
          type: "internal",
          action: WORKER_MESSAGE_ENTRY,
          flowKind: "doer",
          session: { id: sessionId },
          payload: { messageId: id },
          from: "settles-queue-message"
        });
        return id;
      }
    }),
    { type: "internal", action: WORKER_MESSAGE_ENTRY }
  );

  // The doer's turn. On its task it reads marks in the task:
  //   [background]   the request's own side chain, and its onFinished's, write after it returns
  //   [split:N:MS]   file N pieces for eng.helper, each taking MS
  //   [after:MS]     take MS after filing
  //   [message] / [message-checkpoint]  a message arrives for this session mid-task
  //   [stop:REASON]  stop and wait (ctx.suspend)
  // On a notice ("Task ...") it answers; on a message it answers, and may report a checkpoint.
  const doerTurn = handler({
    name: "settles-doer-turn",
    inputSchema: doorInput,
    outputSchema: z.unknown(),
    execute: async (input, rawCtx) => {
      const ctx = rawCtx as unknown as BlockContext;
      const requestId = ctx.request.identity.id;
      const sessionId = ctx.session.identity.id;
      const message = input.message;
      const row = await heldRow(ctx);
      const base = { requestId, sessionId, ...(row !== undefined ? { taskId: row.id } : {}) };
      if (message.startsWith('Task "')) {
        const answer = `woken answer ${requestId}`;
        prove({ kind: "woken", ...base, answer, at: Date.now() });
        return answer;
      }
      if (message.startsWith("Message ")) {
        if (message.includes("[checkpoint]") && row !== undefined) {
          const above = await filingConversationBoard(ctx);
          await above!.tasks.reportProgress!(row.id, { output: `checkpoint ${requestId}` }, { claim: currentWorkerClaim(ctx)! });
        }
        const answer = `the message's answer ${requestId}`;
        prove({ kind: "message", ...base, answer, at: Date.now() });
        return answer;
      }
      // A piece, on eng.helper.
      const slow = /\[slow:(\d+)\]/.exec(message);
      if (slow !== null) {
        await sleep(Number(slow[1]));
        prove({ kind: "piece", ...base, at: Date.now() });
        return "piece done";
      }
      if (message.includes("[background]")) finishWrites.add(requestId);
      const split = /\[split:(\d+):(\d+)\]/.exec(message);
      if (split !== null) {
        const ref = await doerBoard.board.resolver(ctx as never);
        for (let i = 0; i < Number(split[1]); i += 1) {
          await ref!.addTask({ goal: `piece ${i} of ${row?.id} ${RUN_STAMP} [slow:${split[2]}]`, assignee: "eng.helper" });
        }
      }
      const after = /\[after:(\d+)\]/.exec(message);
      if (after !== null) await sleep(Number(after[1]));
      const stop = /\[stop:([a-z_]+)\]/.exec(message);
      if (stop !== null) {
        const resolution = await ctx.suspend!({ reason: stop[1]!, message: `waiting (${stop[1]})` });
        const answer = `resumed ${JSON.stringify(resolution)}`;
        prove({ kind: "turn", ...base, answer, at: Date.now() });
        return answer;
      }
      const answer = `work answer ${requestId}`;
      prove({ kind: "turn", ...base, answer, at: Date.now() });
      return answer;
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
    actions: { run: { inputSchema: doorInput.strict(), block: deskTurn, userMessage: (i: { message: string }) => i.message }, ...deskBoard.actions },
    internal: { actions: deskBoard.entries(deskTurn, () => "fixed") },
    task: { actions: { work: workerTaskEntry({ name: "settles-desk-task", turn: deskTurn }) } }
  } as never);
  const doerFlow = defineFlow({
    kind: "doer",
    configSchema: workerConfigSchema(),
    session: { ...installation.session(doerBoard.sessionStateShape), serverOwned: [...doerBoard.serverOwned] },
    resources: { ...installation.resources, ...doerBoard.resources },
    actions: { run: { inputSchema: doorInput.strict(), block: doerWork, userMessage: (i: { message: string }) => i.message }, ...doerBoard.actions },
    // A piece's notice wakes the doer's turn (judgment), so its answer can be the task's result.
    internal: { actions: doerBoard.entries(doerWork, () => "judgment") },
    task: { actions: { work: { ...workerTaskEntry({ name: "settles-doer-task", turn: doerWork }), durable: true } } },
    request: { onFinished }
  } as never);
  workerFlows = { desk: deskFlow, doer: doerFlow };

  const state = createFlowState({
    flows: Object.fromEntries(hireWorkforce(installation).map((copy) => [copy.id, copy])),
    stores: { default: { primary: sqliteStores({ filename }) } },
    durable: true,
    logger: silentLogger,
    resolvePrincipal: (context: any) => {
      const user = context.request?.headers.get("x-user");
      return typeof user === "string" ? { userId: user, orgId: ORG } : null;
    }
  } as never);

  const connect = async () => {
    const runtime = await state.getRuntime();
    const http = httpActions((await state.getRouter()) as never, USER);
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

await runGoal(async (failures, tell) => {
  writeFileSync(PROOFS, "", "utf8");
  const host = buildHost(join(SCRATCH, `main-${RUN_STAMP}.sqlite`));
  const notes: string[] = [];
  const leg = async (name: string, body: () => Promise<void>) => {
    if (!legs.has(name)) return;
    try {
      await body();
    } catch (error) {
      failures.push(`${name}:threw — ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  try {
    const h = await host.connect();
    const conversation = await h.http.open("desk", { workerId: "lead" });
    const file = async (goal: string): Promise<string> => {
      const filed = await h.act(conversation, "dispatchTask_tasks", { goal, assignee: "eng.doer" });
      if (filed?.ok !== true) throw new Error(`filing "${goal}" was refused: ${JSON.stringify(filed)}`);
      return filed.taskId as string;
    };
    const proofsOf = (taskId: string, kind?: Proof["kind"]) => readProofs().filter((p) => p.taskId === taskId && (kind === undefined || p.kind === kind));
    /** The notices the desk acted on for a task's completion. */
    const heard = async (taskId: string) => {
      const session = (await h.runtime.stores.session.get(conversation)) as { state?: { taskNotices?: string[] } } | null;
      return (session?.state?.taskNotices ?? []).filter((key) => key.startsWith(`${taskId}:`));
    };
    /** The task session a row ran in. */
    const sessionOf = async (taskId: string) => (await h.byId(taskId))?.run?.sessionId;

    // ---- a. background work ------------------------------------------------------
    await leg("a", async () => {
      const taskId = await file(word("[background] write after you return"));
      await h.idle();
      const row = await h.byId(taskId);
      const turn = proofsOf(taskId, "turn")[0];
      const writes = readProofs().filter((p) => p.requestId === turn?.requestId && (p.kind === "background" || p.kind === "on-finished"));
      tell.over("a · the background writes of the task's request", writes);
      const last = Math.max(...writes.map((p) => p.at));
      if (row?.status !== "completed" || writes.length !== 2 || row.completedAt === undefined || row.completedAt < last) {
        failures.push(
          `a:after-the-side-chains — wanted the task completed after the last write of its request's side chain and of the one onFinished starts; it is ${row?.status} at ${row?.completedAt}, the writes ${JSON.stringify(writes.map((p) => [p.kind, p.at]))}`
        );
      }
      if (row?.output !== turn?.answer || (await heard(taskId)).length !== 1) {
        failures.push(`a:once — wanted one ending, heard once, with the work's answer; output ${JSON.stringify(row?.output)}, heard ${JSON.stringify(await heard(taskId))}`);
      }
      notes.push(`a: completed ${(row?.completedAt ?? 0) - last} ms after the last background write`);
    });

    // ---- b. pieces ---------------------------------------------------------------
    await leg("b", async () => {
      // The pieces end after the task's own request ended.
      const taskId = await file(word("[split:2:600] split it"));
      const waiting = await h.until(async () => {
        const row = await h.byId(taskId);
        const open = (await h.rows()).filter((r) => r.filedByTask === taskId && r.status !== "completed");
        return row?.status === "in_progress" && row.waitingOn === "filed" && row.leaseUntil === undefined && open.length > 0;
      }, 10_000);
      if (!waiting) failures.push(`b:waiting-while-open — wanted the task running, waiting on its pieces with no lease, while one is open; read ${JSON.stringify(await h.byId(taskId))}`);
      await h.idle();
      const row = await h.byId(taskId);
      const pieces = (await h.rows()).filter((r) => r.filedByTask === taskId);
      const woken = proofsOf(taskId, "woken");
      tell.over("b · the turns the pieces' endings woke", woken);
      const lastWoken = woken.at(-1);
      const running = (await h.rows()).filter((r) => r.status === "in_progress");
      if (row?.status !== "completed" || pieces.length !== 2 || pieces.some((p) => p.status !== "completed") || row.output !== lastWoken?.answer || row.attempts !== 1) {
        failures.push(`b:last-turns-answer — wanted it completed once with the last woken turn's answer, both pieces completed; it is ${row?.status}, output ${JSON.stringify(row?.output)}, last woken ${JSON.stringify(lastWoken?.answer)}, pieces ${JSON.stringify(pieces.map((p) => p.status))}`);
      }
      if ((await heard(taskId)).length !== 1 || running.length !== 0) {
        failures.push(`b:once — wanted one ending heard and no running row left; heard ${JSON.stringify(await heard(taskId))}, running ${JSON.stringify(running.map((r) => r.id))}`);
      }

      // Variant: the last piece ends while the task's own request still runs.
      const during = await file(word("[split:1:50][after:1500] split it and keep working"));
      await h.idle();
      const own = proofsOf(during, "turn")[0];
      const vRow = await h.byId(during);
      const vPiece = (await h.rows()).find((r) => r.filedByTask === during);
      const vWoken = proofsOf(during, "woken").at(-1);
      const workRequest = (await h.requests((await sessionOf(during)) ?? "")).find((r) => r.id === own?.requestId);
      if (vPiece?.completedAt === undefined || own === undefined || vPiece.completedAt > own.at) {
        failures.push(`b:piece-ends-during-request — wanted the piece to end while the task's own turn ran; the piece ended ${vPiece?.completedAt}, the turn answered ${own?.at}`);
      }
      if (vRow?.status !== "completed" || vRow.output !== vWoken?.answer || vRow.output === own?.answer || workRequest?.status !== "completed") {
        failures.push(`b:settles-after-woken-turn — wanted the task's own check to leave it running and the woken turn's answer to be the output; it is ${vRow?.status}, output ${JSON.stringify(vRow?.output)}, woken ${JSON.stringify(vWoken?.answer)}, own ${JSON.stringify(own?.answer)}`);
      }
      notes.push(`b: ${woken.length} woken turns, output from the last; variant output ${JSON.stringify(vRow?.output)}`);
    });

    // ---- c. a message queued mid-task ---------------------------------------------
    await leg("c", async () => {
      for (const [mark, wantCheckpoint] of [["[message]", false], ["[message-checkpoint]", true]] as const) {
        const taskId = await file(word(`${mark} a message arrives while you work`));
        await h.idle();
        const row = await h.byId(taskId);
        const own = proofsOf(taskId, "turn")[0];
        const said = proofsOf(taskId, "message")[0];
        const session = await sessionOf(taskId);
        const messageRequest = (await h.requests(session ?? "")).find((r) => r.id === said?.requestId);
        const messageEnded = messageRequest?.updatedAt ?? messageRequest?.completedAtMs;
        if (said === undefined || messageRequest?.status !== "completed" || row?.completedAt === undefined || messageEnded === undefined || messageEnded > row.completedAt) {
          failures.push(`c:message-ends-first — wanted the message's request (${mark}) to end before the task settled; it ${messageRequest?.status} at ${messageEnded}, the task ${row?.status} at ${row?.completedAt}`);
        }
        const want = wantCheckpoint ? `checkpoint ${said?.requestId}` : own?.answer;
        if (row?.status !== "completed" || row.output !== want || row.output === said?.answer) {
          failures.push(`c:output — wanted ${mark}'s task completed with ${wantCheckpoint ? "the message's checkpoint" : "the work's answer"}, never the message's answer; it is ${row?.status}, output ${JSON.stringify(row?.output)}`);
        }
        if ((await heard(taskId)).length !== 1) failures.push(`c:once — ${mark}'s task heard ${JSON.stringify(await heard(taskId))}`);
      }
      notes.push(`c: both settled after their messages' requests`);
    });

    // ---- d. a wait and a person's stop --------------------------------------------
    await leg("d", async () => {
      const stops = [
        ["human_input", "person"],
        ["external_event", "wait"]
      ] as const;
      const ids = await Promise.all(stops.map(([reason]) => file(word(`[stop:${reason}] wait for it`))));
      await h.idle();
      const claimedAt = Math.max(...(await Promise.all(ids.map(async (id) => (await h.byId(id))?.startedAt ?? Date.now()))));
      for (const [i, [reason, waitingOn]] of stops.entries()) {
        const row = await h.byId(ids[i]!);
        if (row?.status !== "in_progress" || row.waitingOn !== waitingOn || row.leaseUntil !== undefined) {
          failures.push(`d:keeps-its-claim — wanted the ${reason} stop running, waiting on "${waitingOn}", with no lease; read ${JSON.stringify(row && { status: row.status, waitingOn: row.waitingOn, leaseUntil: row.leaseUntil })}`);
        }
      }
      // Past the lease the claim committed to, then a pass of the board that filed them.
      const wait = claimedAt + LEASE_MS + 2000 - Date.now();
      if (wait > 0) await sleep(wait);
      await h.act(conversation, "listTasks_tasks", {});
      await h.idle();
      for (const [i, [reason]] of stops.entries()) {
        const row = await h.byId(ids[i]!);
        if (row?.status !== "in_progress" || row.attempts !== 1 || proofsOf(ids[i]!, "turn").length !== 0) {
          failures.push(`d:not-run-twice — wanted the ${reason} stop still running on attempt 1 after the lease, its work not run again; it is ${row?.status} on attempt ${row?.attempts}`);
        }
      }
      // Resume both.
      for (const [i, [reason]] of stops.entries()) {
        const session = (await sessionOf(ids[i]!))!;
        // The pending suspension, read from the store; the resume goes over the HTTP route, as an app's does.
        const pending = (await h.runtime.stores.suspensions.list({ sessionId: session, status: "pending" } as never)) as Array<{ suspensionId: string; requestId: string }>;
        const suspension = pending[0];
        if (suspension === undefined) {
          failures.push(`d:resumes — the ${reason} stop had no pending suspension to resume`);
          continue;
        }
        // A task's request arrived on the `task` source, which no public route
        // re-enters, so the stop is resolved and resumed through the engine,
        // as a host's own answer surface would (FIX-2058's Inbox).
        const action = reason === "human_input" ? "submit" : "approve";
        const provider = h.runtime.runtimeConfig.durabilityProvider!;
        const record = await provider.loadSuspension(suspension.requestId, suspension.suspensionId);
        await provider.suspend({ ...record!, status: action === "submit" ? "submitted" : "approved", resolvedAt: Date.now(), resumeData: { reason } } as never);
        try {
          const { finished } = await continueRequest({
            requestId: suspension.requestId,
            stores: h.runtime.stores,
            flowRegistry: h.runtime.registry,
            resumeContext: { suspensionId: suspension.suspensionId, action, data: { reason }, resumedBy: USER },
            runtimeConfig: h.runtime.runtimeConfig
          } as never);
          const ended = await finished;
          if (ended.error !== undefined) failures.push(`d:resumes — the ${reason} resume ended with ${ended.error.message}`);
        } catch (error) {
          failures.push(`d:resumes — the ${reason} resume threw: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      await h.idle();
      for (const [i, [reason]] of stops.entries()) {
        const row = await h.byId(ids[i]!);
        if (row?.status !== "completed" || row.attempts !== 1 || !String(row.output).startsWith("resumed")) {
          failures.push(`d:done-after-resume — wanted the ${reason} stop completed on attempt 1 with the resumed answer; it is ${row?.status} on attempt ${row?.attempts}, output ${JSON.stringify(row?.output)}`);
        }
      }
      notes.push(`d: both stops held their claim past the lease and completed on attempt 1 after the resume`);
    });

    return { failures, evidence: notes.join("\n") };
  } finally {
    await host.state.dispose();
  }
});
