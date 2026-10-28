/**
 * Goal check — when background work errors in any request working a task, the
 * task's attempt fails exactly as if the request had thrown: it retries while
 * attempts are left, otherwise it fails, and its filer never hears "done" for
 * it (FIX-2088).
 *
 * **Model-free.** A real `createFlowState` host on a durable SQLite store, the
 * Workforce session board on its flows (`desk`, the conversation that files;
 * `doer`, whose task sessions work and file pieces for `eng.helper`; and the
 * built-in `agent` flow for `eng.memo`, whose after-answer step stands in for
 * a memory capture), deterministic workers driven by marks in the task, over
 * the host's HTTP router as a verified caller. Every grade reads the stored
 * rows, the requests the engine stored, the notices the desk acted on, or the
 * proof each worker wrote from inside its own run: never the gate's input.
 *
 * Legs (each failure is tagged `<leg>:<assertion>`):
 *   a  work's background step throws on attempt 1: done on attempt 2 with that
 *      attempt's output, attempt 1's answer nowhere on the row, one ending
 *      heard. Variants: the step is a `.forEachSideChain` one; both attempts
 *      checkpoint, and attempt 1's checkpoint carries over until attempt 2's
 *   b  it always throws, one attempt: failed, the step named, one notice
 *   c  a step the flow's `onFinished` starts throws, one attempt: as b.
 *      Variant: a step `onCompleted` starts
 *   d  the same flow as a plain request: the request completes, no task row
 *   e  a cancel while background work runs, one step stopping on it and one
 *      throwing anyway: cancelled, not failed, not re-pended
 *   f  a dropped connection (the resume's caller goes away), then the step
 *      throws: as a
 *   g  a queued message's request, its step throws: the message runs after
 *      the task settles, outside it, and the task is done on attempt 1
 *   h  an `onTaskSettled` turn, its step always throws, one attempt: as b
 *   i  the step fails, the request suspends, the resume reruns it: a rerun
 *      that throws fails as b; one that succeeds is done on attempt 1
 *   j  a default `.waitForSideChain()` drains the failure, the pipeline goes
 *      on past it, one attempt: as b
 *   k  an agent worker whose capture fails once: filed with its result to the
 *      conversation, done on attempt 1 with its answer and no failure; filed
 *      with its result to the filer, as a
 *
 * Controls (a scratch patch as the code loads; `goals/lib/module-patch.mts`):
 *   GOAL_CONTROL=drop-background-failures  the gate is told of no background
 *     failures. Must FAIL a, f on `done-on-attempt-2`, b, c, h, j and i's
 *     throwing rerun on `failed-after-1-attempt`, and k's filer half; d, g and
 *     i's clean rerun must pass.
 *   GOAL_CONTROL=no-conversation-carve-out  the after-answer step's failure is
 *     never kept from a conversation-result task. Must FAIL k's conversation half.
 *
 * Run: pnpm tsx goals/task-board/background-error-fails-the-attempt/run.mts
 * Legs: GOAL_LEGS=a,b,...,k (default: all)
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { dispatchThroughSeam, markDispatcher, type BlockContext } from "@flow-state-dev/core/types";
import { abortRequest, continueRequest, createFlowState } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { currentWorkerClaim } from "@flow-state-dev/orchestration/task-board";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import { TASK_ID_STATE_KEY } from "../../../packages/workforce/src/workers/keys.ts";
import { createMockModelResolver, mockGenerator } from "@flow-state-dev/testing";
import {
  createWorkerInstallation,
  defineAgentWorkerFlow,
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

const USER = "u_background_error";
const ORG = "org_background_error";
const CONTROL = process.env.GOAL_CONTROL ?? "";
const SCRATCH = process.env.GOAL_SCRATCH ?? goalTmpDir("background-error");
/** Where each worker writes what it saw and did, from inside its own run. */
const PROOFS = join(SCRATCH, "proofs.ndjson");
const ALL_LEGS = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"] as const;
/** The memo worker's one answer. */
const MEMO_ANSWER = "The memo is written.";

const PATCHES: Record<string, ModulePatch[]> = {
  // The gate is told of no background failures: today's behaviour.
  "drop-background-failures": [
    {
      module: "packages/orchestration/src/task-board/task-request.ts",
      from: String.raw`const background = ending.backgroundFailures\?\.\[0\];`,
      to: "const background = undefined;"
    }
  ],
  // The after-answer step fails a conversation-result task's attempt too.
  "no-conversation-carve-out": [
    {
      module: "packages/workforce/src/agent-worker-flow.ts",
      from: String.raw`if \(!\(await worksConversationResultTask\(ctx as never\)\)\) throw error;`,
      to: "throw error;"
    }
  ]
};
const CONTROL_LEGS: Record<string, string[]> = {
  "drop-background-failures": ["a", "b", "c", "d", "f", "g", "h", "i", "j", "k"],
  "no-conversation-carve-out": ["k"]
};

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
  kind: "turn" | "woken" | "message" | "plain" | "step" | "capture";
  requestId: string;
  sessionId: string;
  taskId?: string;
  attempt?: number;
  answer?: unknown;
  /** On a turn: the row's output when the turn began. */
  priorOutput?: unknown;
  /** On a message: whether its turn held a task's claim, and the task's status as it began. */
  claimed?: boolean;
  taskStatus?: string;
  /** On a step: its name, and what it did. */
  step?: string;
  did?: "threw" | "stopped" | "ran";
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

/** What the capture logged when it was kept from failing a task: evidence only, never graded. */
const captureLog: string[] = [];
const consoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const line = args.map((a) => (typeof a === "string" ? a : a instanceof Error ? a.message : JSON.stringify(a))).join(" ");
  if (line.includes("memory-capture") && line.includes("keeps its answer")) captureLog.push(line);
  // Background failures are logged by design; keep the run's output readable.
  if (/^\[(runAction|sequencer|agent)\] Background work/.test(line)) return;
  consoleError(...args);
};

// ---- the host ---------------------------------------------------------------

const worker = (id: string, declared: Record<string, unknown>, body = ""): WorkerManifest => ({ id, declared, body, skills: [] });
const WORKERS: WorkerManifest[] = [
  worker("lead", { flow: "desk", delegates: ["eng.doer", "eng.memo"] }),
  worker("eng.doer", { flow: "doer", delegates: ["eng.helper"] }),
  worker("eng.helper", { flow: "doer" }),
  // The built-in agent flow, its after-answer step a capture that fails once per task.
  worker("eng.memo", {}, "You write memos.")
];

/** What a request's background steps do, by request id: set by its turn, read by its steps. */
type Plan = { after?: boolean; each?: boolean; finish?: boolean; completed?: boolean };
const plans = new Map<string, Plan>();
const planOf = (ctx: BlockContext) => plans.get(ctx.request.identity.id) ?? {};
/** How often the before-step ran, by the message it ran on: leg i's rerun. */
const beforeRuns = new Map<string, number>();
/** The transport a leg-f resume runs under, by task id: its turn drops it. */
const transports = new Map<string, AbortController>();
/** The task sessions whose capture already failed once: leg k. */
const capturedOnce = new Set<string>();

function buildHost(filename: string) {
  let workerFlows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({ standardWorkers: WORKERS, workerFlows: () => workerFlows as never });
  const doorInput = z.object({ message: z.string() });
  const deskBoard = defineSessionBoard({ installation, flowKind: "desk" });
  const doerBoard = defineSessionBoard({ installation, flowKind: "doer" });

  // The desk: a person's conversation. Its turn is never woken (fixed policy).
  const deskTurn = handler({ name: "bg-desk-turn", inputSchema: doorInput, outputSchema: z.unknown(), execute: (input) => `noted: ${input.message}` });

  /** The running row this request holds, read the way the gate wrote it. */
  const heldRow = async (ctx: BlockContext): Promise<Task | undefined> => {
    const above = await filingConversationBoard(ctx);
    const claim = currentWorkerClaim(ctx);
    return above?.tasks
      .list({ status: "in_progress" })
      .find((r) => r.run?.requestId === ctx.request.identity.id || r.id === claim?.taskId);
  };

  // A peer's message arriving mid-task, addressed to this task session: on attempt 1 only.
  const queueMessage = markDispatcher(
    handler({
      name: "bg-queue-message",
      inputSchema: z.object({}).passthrough(),
      outputSchema: z.unknown(),
      execute: async (_input, rawCtx) => {
        const ctx = rawCtx as unknown as BlockContext;
        if ((await heldRow(ctx))?.attempts !== 1) return null;
        const id = `msg_${RUN_STAMP}_${Math.random().toString(16).slice(2, 10)}`;
        const sessionId = ctx.session.identity.id;
        await messageLogOf(ctx).getOrCreate(id, {
          id,
          from: "eng.helper",
          to: "eng.doer",
          text: "A note while you work. [msg-bg]",
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
          from: "bg-queue-message"
        });
        return id;
      }
    }),
    { type: "internal", action: MESSAGE_RECEIVED_ENTRY }
  );

  type Base = { requestId: string; sessionId: string; taskId?: string; attempt?: number };
  const answered = (kind: Proof["kind"], base: Base, answer: string, extra: Partial<Proof> = {}) => {
    prove({ kind, ...base, answer, ...extra, at: Date.now() });
    return answer;
  };

  /**
   * The task's own turn, by its marks. Marks that start background work set
   * this request's plan; "first" marks act on attempt 1 only.
   *   [bg:first] [bg:always]   the after-answer step throws
   *   [each:first]             a `.forEachSideChain` step throws
   *   [finish:always]          the step `onFinished` starts throws
   *   [completed:always]       the step `onCompleted` starts throws
   *   [checkpoint]             report a checkpoint first
   *   [hold:MS]                take MS
   *   [stop:R] [stop-first:R]  stop and wait (ctx.suspend); on a [drop] resume, drop the caller
   *   [message-first]          a message arrives for this session on attempt 1
   *   [split:N:MS]             file N pieces for eng.helper, each taking MS
   */
  const onTask = async (ctx: BlockContext, base: Base, message: string, row: Task | undefined) => {
    const first = row?.attempts === 1;
    plans.set(base.requestId, {
      after: message.includes("[bg:always]") || (first && message.includes("[bg:first]")),
      each: first && message.includes("[each:first]"),
      finish: message.includes("[finish:always]"),
      completed: message.includes("[completed:always]")
    });
    const priorOutput = row?.output;
    if (message.includes("[checkpoint]") && row !== undefined) {
      const above = await filingConversationBoard(ctx);
      await above!.tasks.reportProgress!(row.id, { output: `checkpoint ${base.requestId}` }, { claim: currentWorkerClaim(ctx)! });
    }
    const split = /\[split:(\d+):(\d+)\]/.exec(message);
    if (split !== null) {
      const ref = await doerBoard.board.resolver(ctx as never);
      for (let i = 0; i < Number(split[1]); i += 1) {
        await ref!.addTask({ goal: `piece ${i} of ${row?.id} ${RUN_STAMP} [slow:${split[2]}]`, assignee: "eng.helper" });
      }
    }
    const hold = /\[hold:(\d+)\]/.exec(message);
    if (hold !== null) await sleep(Number(hold[1]));
    const stop = /\[stop:([a-z_]+)\]/.exec(message) ?? (first ? /\[stop-first:([a-z_]+)\]/.exec(message) : null);
    if (stop !== null) {
      const resolution = await ctx.suspend!({ reason: stop[1]!, message: `waiting (${stop[1]})` });
      if (message.includes("[drop]") && row !== undefined) transports.get(row.id)?.abort(new Error("the caller went away"));
      return answered("turn", base, `resumed ${base.requestId} ${JSON.stringify(resolution)}`, { priorOutput });
    }
    return answered("turn", base, `work answer ${base.requestId}`, { priorOutput });
  };

  const doerTurn = handler({
    name: "bg-doer-turn",
    inputSchema: doorInput,
    outputSchema: z.unknown(),
    execute: async (input, rawCtx) => {
      const ctx = rawCtx as unknown as BlockContext;
      const row = await heldRow(ctx);
      const base: Base = {
        requestId: ctx.request.identity.id,
        sessionId: ctx.session.identity.id,
        ...(row !== undefined ? { taskId: row.id, attempt: row.attempts } : {})
      };
      const message = input.message;
      if (message.startsWith("Message ")) {
        // A message is conversation in the task's session: it may run after the task settled.
        const taskId = (ctx.session.state as Record<string, unknown> | undefined)?.[TASK_ID_STATE_KEY];
        const task = typeof taskId === "string" ? (await filingConversationBoard(ctx))?.tasks.get(taskId) : undefined;
        plans.set(base.requestId, { after: message.includes("[msg-bg]") });
        return answered("message", { ...base, ...(task !== undefined ? { taskId: task.id, attempt: task.attempts } : {}) }, `the message's answer ${base.requestId}`, {
          claimed: currentWorkerClaim(ctx) !== undefined,
          ...(task !== undefined ? { taskStatus: task.status } : {})
        });
      }
      if (row === undefined) {
        // A plain request: no task. Its background step throws all the same.
        plans.set(base.requestId, { after: message.includes("[bg:always]") });
        return answered("plain", base, `plain answer ${base.requestId}`);
      }
      if (message.startsWith('Task "')) {
        plans.set(base.requestId, { after: row.goal.includes("[woken-bg]") });
        return answered("woken", base, `woken answer ${base.requestId}`);
      }
      const slow = /\[slow:(\d+)\]/.exec(message);
      if (slow !== null) {
        await sleep(Number(slow[1]));
        return "piece done";
      }
      return onTask(ctx, base, message, row);
    }
  });

  /** A background step that throws when `throws(ctx)` says so, and proves what it did. */
  const step = (name: string, throws: (ctx: BlockContext, input: unknown) => boolean, ms = 60) =>
    handler({
      name,
      inputSchema: z.unknown(),
      execute: async (input, rawCtx) => {
        const ctx = rawCtx as unknown as BlockContext;
        await sleep(ms);
        const threw = throws(ctx, input);
        prove({ kind: "step", step: name, did: threw ? "threw" : "ran", requestId: ctx.request.identity.id, sessionId: ctx.session.identity.id, at: Date.now() });
        if (threw) throw new Error(`${name} failed in ${ctx.request.identity.id}`);
      }
    });

  /** Legs i and j: a step before the turn, drained by a default wait. [before:always] or [before:first-run]. */
  const beforeStep = handler({
    name: "bg-before",
    inputSchema: doorInput,
    execute: async (input, rawCtx) => {
      const ctx = rawCtx as unknown as BlockContext;
      const runs = (beforeRuns.get(input.message) ?? 0) + 1;
      beforeRuns.set(input.message, runs);
      const threw = input.message.includes("[before:always]") || (input.message.includes("[before:first-run]") && runs === 1);
      prove({ kind: "step", step: "bg-before", did: threw ? "threw" : "ran", requestId: ctx.request.identity.id, sessionId: ctx.session.identity.id, answer: runs, at: Date.now() });
      if (threw) throw new Error(`bg-before failed on run ${runs}`);
    }
  });

  /** Leg e: one step that stops on the cancel (or gives up after 4s), one that throws after it anyway. */
  const stopsOnCancel = handler({
    name: "bg-stops-on-cancel",
    inputSchema: z.unknown(),
    execute: async (_input, rawCtx) => {
      const ctx = rawCtx as unknown as BlockContext;
      const stopped = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 4000);
        ctx.signal.addEventListener("abort", () => {
          clearTimeout(timer);
          resolve(true);
        }, { once: true });
      });
      prove({ kind: "step", step: "bg-stops-on-cancel", did: stopped ? "stopped" : "ran", requestId: ctx.request.identity.id, sessionId: ctx.session.identity.id, at: Date.now() });
      if (stopped) throw new Error("stopped on the cancel");
    }
  });
  const throwsAnyway = step("bg-throws-anyway", () => true, 2500);

  const doerWork = sequencer({ name: "bg-doer-work", inputSchema: doorInput })
    .sideChainIf((input: { message: string }) => input.message.includes("[before:"), beforeStep)
    .waitForSideChain()
    .sideChainIf((input: { message: string }) => input.message.includes("[cancel-steps]"), stopsOnCancel)
    .sideChainIf((input: { message: string }) => input.message.includes("[cancel-steps]"), throwsAnyway)
    .tapIf(
      (input: { message: string }) => input.message.includes("[message-first]") && !input.message.startsWith("Message "),
      (input: { message: string }) => input,
      queueMessage
    )
    .step(doerTurn)
    .sideChain(step("bg-after-answer", (ctx) => planOf(ctx).after === true))
    .forEachSideChain(
      (_answer: unknown, ctx: BlockContext) => (planOf(ctx).each === true ? ["one", "two"] : []),
      step("bg-each", (_ctx, item) => item === "two")
    );

  const throwingHook = (name: string, key: "finish" | "completed") =>
    sequencer({ name: `${name}-hook`, inputSchema: z.object({ requestId: z.string() }).passthrough() }).sideChainIf(
      (input: { requestId: string }) => plans.get(input.requestId)?.[key] === true,
      step(name, () => true)
    );

  const deskFlow = defineFlow({
    kind: "desk",
    configSchema: workerConfigSchema(),
    session: { ...installation.session(deskBoard.sessionStateShape), serverOwned: [...deskBoard.serverOwned] },
    resources: { ...installation.resources, ...deskBoard.resources },
    actions: { respond: { inputSchema: doorInput.strict(), block: deskTurn, userMessage: (i: { message: string }) => i.message }, ...deskBoard.actions },
    internal: { actions: deskBoard.entries(deskTurn, () => "fixed") },
    task: { actions: { work: workerTaskEntry({ name: "bg-desk-task", turn: deskTurn }) } }
  } as never);
  const doerFlow = defineFlow({
    kind: "doer",
    configSchema: workerConfigSchema(),
    session: { ...installation.session(doerBoard.sessionStateShape), serverOwned: [...doerBoard.serverOwned] },
    resources: { ...installation.resources, ...doerBoard.resources },
    actions: { respond: { inputSchema: doorInput.strict(), block: doerWork, userMessage: (i: { message: string }) => i.message }, ...doerBoard.actions },
    // A piece's notice wakes the doer's turn (judgment).
    internal: { actions: doerBoard.entries(doerWork, () => "judgment") },
    task: {
      actions: {
        work: { ...workerTaskEntry({ name: "bg-doer-task", turn: doerWork }), durable: true, onCompleted: throwingHook("bg-on-completed", "completed") }
      }
    },
    request: { onFinished: throwingHook("bg-on-finished", "finish") }
  } as never);
  // The memo worker's capture: fails its first run in each task session, as a capture that times out once does.
  const memoryCapture = handler({
    name: "memory-capture",
    inputSchema: z.unknown(),
    execute: (_input, rawCtx) => {
      const ctx = rawCtx as unknown as BlockContext;
      const taskId = (ctx.session.state as Record<string, unknown> | undefined)?.taskId;
      if (typeof taskId !== "string") return;
      const first = !capturedOnce.has(taskId);
      capturedOnce.add(taskId);
      prove({ kind: "capture", taskId, did: first ? "threw" : "ran", requestId: ctx.request.identity.id, sessionId: ctx.session.identity.id, at: Date.now() });
      if (first) throw new Error("memory-capture timed out");
    }
  });
  workerFlows = { desk: { flow: deskFlow, roles: ["contributor", "manager"] }, doer: { flow: doerFlow, roles: ["contributor", "manager"] }, agent: defineAgentWorkerFlow({ installation, afterAnswer: memoryCapture }) };

  const state = createFlowState({
    flows: Object.fromEntries(hireWorkforce(installation).map((copy) => [copy.id, copy])),
    stores: { default: { primary: sqliteStores({ filename }) } },
    logger: silentLogger,
    modelResolver: createMockModelResolver({
      generators: { "agent-answer": mockGenerator({ name: "agent-answer", script: [{ when: () => true, then: { text: MEMO_ANSWER } }] }) }
    }),
    resolvePrincipal: (context: any) => {
      const user = context.request?.headers.get("x-user");
      return typeof user === "string" ? { userId: user, orgId: ORG } : null;
    }
  } as never);

  const connect = async () => {
    const runtime = await state.getRuntime();
    const http = actingAs((await state.getRouter()) as never, USER);
    /** Every stored row of the user's conversation ledgers, from the store. */
    const rows = async (): Promise<Task[]> =>
      Object.values(await runtime.stores.resourceState.getByPrefix("user", `${USER}:~org:${ORG}`, "tasks/")).map((value) => value.state as Task);
    const byId = async (id: string) => (await rows()).find((r) => r.id === id);
    const until = async (check: () => Promise<boolean>, ms: number) => {
      for (const deadline = Date.now() + ms; Date.now() < deadline; await sleep(25)) if (await check()) return true;
      return check();
    };
    const requests = async (sessionId: string) =>
      (await runtime.stores.request.list({ sessionId, orderBy: "none", limit: 500 } as never)) as Array<{ id: string; actionName: string; status: string }>;
    /** Until nothing runs and every ended request has finished its tail. */
    const idle = async () => {
      for (let i = 0; i < 600; i += 1) {
        await untilIdle(runtime.stores);
        const ended = (await runtime.stores.request.list({ orderBy: "none", limit: 2000 } as never)) as Array<{ status: string; finalizedAtMs?: number | null }>;
        if (ended.every((r) => r.status === "suspended" || r.finalizedAtMs != null)) return;
        await sleep(50);
      }
    };
    return { runtime, http, rows, byId, until, requests, idle };
  };
  return { state, connect };
}

/** A goal word unique to this run. */
const word = (name: string) => `${name} ${RUN_STAMP}`;

// ---- the legs ----------------------------------------------------------------

type Host = Awaited<ReturnType<ReturnType<typeof buildHost>["connect"]>>;
type Tell = Parameters<Parameters<typeof runGoal>[0]>[1];

interface Run {
  h: Host;
  conversation: string;
  failures: string[];
  notes: string[];
  tell: Tell;
}

const show = (value: unknown) => JSON.stringify(value);

/** File `goal` from the desk, as the person does. Its task id. */
async function file(run: Run, goal: string, extra: Record<string, unknown> = {}): Promise<string> {
  const filed = await run.h.http.act("desk", run.conversation, "createTask_tasks", { goal, assignee: "eng.doer", ...extra });
  if (filed?.ok !== true) throw new Error(`filing "${goal}" was refused: ${show(filed)}`);
  return filed.taskId as string;
}

/** Poke the desk's board, so a re-pended row starts, then wait until all is quiet. */
async function settle(run: Run): Promise<void> {
  await run.h.idle();
  await run.h.http.act("desk", run.conversation, "listTasks_tasks", {});
  await run.h.idle();
}

const proofsOf = (taskId: string, kind?: Proof["kind"]) =>
  readProofs().filter((p) => p.taskId === taskId && (kind === undefined || p.kind === kind));

/** The notices the desk acted on for a task. */
async function heard(run: Run, taskId: string): Promise<string[]> {
  const session = (await run.h.runtime.stores.session.get(run.conversation)) as { state?: { taskNotices?: string[] } } | null;
  return (session?.state?.taskNotices ?? []).filter((key) => key.startsWith(`${taskId}:`));
}

/** The error a failed row carries: its terminal error, or a retried attempt's feedback. */
const errorOf = (row: Task | undefined) => String(row?.error ?? row?.feedback ?? "");

/**
 * "As a": done on attempt 2 with attempt 2's output, attempt 1's answer nowhere
 * on the row, one ending heard.
 */
async function gradeRetried(run: Run, leg: string, taskId: string): Promise<void> {
  const row = await run.h.byId(taskId);
  const turns = run.tell.over(`${leg} · the task's own turns`, proofsOf(taskId, "turn"));
  const second = turns.find((t) => t.attempt === 2);
  const firstAnswers = turns.filter((t) => t.attempt === 1).map((t) => t.answer);
  if (row?.status !== "completed" || row.attempts !== 2 || second === undefined || row.output !== second.answer) {
    run.failures.push(
      `${leg}:done-on-attempt-2 — wanted it completed on attempt 2 with that attempt's answer; it is ${row?.status} on attempt ${row?.attempts}, output ${show(row?.output)}, attempt 2 answered ${show(second?.answer)}`
    );
  }
  if (firstAnswers.some((answer) => JSON.stringify(row).includes(String(answer)))) {
    run.failures.push(`${leg}:no-attempt-1-result — attempt 1's answer ${show(firstAnswers)} is on the row: ${show(row)}`);
  }
  const told = await heard(run, taskId);
  if (told.length !== 1) run.failures.push(`${leg}:heard-once — wanted one ending heard; heard ${show(told)}`);
}

/** "As b": failed after 1 attempt, its error naming `stepName`, one ending heard. */
async function gradeFailed(run: Run, leg: string, taskId: string, stepName: string): Promise<void> {
  const row = await run.h.byId(taskId);
  if (row?.status !== "errored" || row.attempts !== 1) {
    run.failures.push(`${leg}:failed-after-1-attempt — wanted it failed after 1 attempt; it is ${row?.status} on attempt ${row?.attempts}, output ${show(row?.output)}`);
  }
  if (!errorOf(row).includes(`"${stepName}"`)) {
    run.failures.push(`${leg}:names-the-step — wanted its error to name "${stepName}"; it reads ${show(errorOf(row))}`);
  }
  const told = await heard(run, taskId);
  if (told.length !== 1) run.failures.push(`${leg}:heard-once — wanted one failure notice; heard ${show(told)}`);
}

/** Resolve a task's pending stop and continue its request through the engine, under `signal` when given. */
async function resumeStop(run: Run, taskId: string, signal?: AbortSignal): Promise<void> {
  const session = (await run.h.byId(taskId))?.run?.sessionId ?? "";
  const pending = (await run.h.runtime.stores.suspensions.list({ sessionId: session, status: "pending" } as never)) as Array<{
    suspensionId: string;
    requestId: string;
  }>;
  const suspension = pending[0];
  if (suspension === undefined) throw new Error(`task ${taskId} had no pending stop to resume`);
  const provider = run.h.runtime.runtimeConfig.durabilityProvider!;
  const record = await provider.loadSuspension(suspension.requestId, suspension.suspensionId);
  await provider.suspend({ ...record!, status: "approved", resolvedAt: Date.now(), resumeData: { ok: true } } as never);
  const { finished } = await continueRequest({
    requestId: suspension.requestId,
    stores: run.h.runtime.stores,
    flowRegistry: run.h.runtime.registry,
    resumeContext: { suspensionId: suspension.suspensionId, action: "approve", data: { ok: true }, resumedBy: USER },
    runtimeConfig: run.h.runtime.runtimeConfig,
    ...(signal !== undefined ? { signal } : {})
  } as never);
  await finished;
}

/** a. Work's background step throws on attempt 1; variants: a `.forEachSideChain` step, and checkpoints. */
async function legA(run: Run): Promise<void> {
  const plain = await file(run, word("[bg:first] write after you answer"));
  const each = await file(run, word("[each:first] fan out after you answer"));
  const checkpointed = await file(run, word("[bg:first][checkpoint] report as you go"));
  await settle(run);
  await gradeRetried(run, "a", plain);
  await gradeRetried(run, "a", each);
  // Both attempts checkpoint: the output is attempt 2's checkpoint, and attempt 1's carried over until then.
  const row = await run.h.byId(checkpointed);
  const turns = proofsOf(checkpointed, "turn");
  const [first, second] = [turns.find((t) => t.attempt === 1), turns.find((t) => t.attempt === 2)];
  if (row?.status !== "completed" || row.attempts !== 2 || row.output !== `checkpoint ${second?.requestId}`) {
    run.failures.push(`a:done-on-attempt-2 — wanted the checkpointed task completed on attempt 2 with that attempt's checkpoint; it is ${row?.status} on ${row?.attempts}, output ${show(row?.output)}`);
  }
  if (second?.priorOutput !== `checkpoint ${first?.requestId}`) {
    run.failures.push(`a:checkpoint-carries-over — wanted attempt 1's checkpoint on the row when attempt 2 began; it read ${show(second?.priorOutput)}`);
  }
  run.notes.push(`a: plain, forEachSideChain and checkpointed tasks each completed on attempt 2; the checkpoint carried over`);
}

/** b. It always throws, one attempt. */
async function legB(run: Run): Promise<void> {
  const taskId = await file(run, word("[bg:always] write after you answer, always failing"), { maxAttempts: 1 });
  await settle(run);
  await gradeFailed(run, "b", taskId, "bg-after-answer");
  run.notes.push(`b: failed after 1 attempt: ${errorOf(await run.h.byId(taskId)).slice(0, 80)}`);
}

/** c. A step the flow's onFinished starts, and one onCompleted starts, throws; one attempt each. */
async function legC(run: Run): Promise<void> {
  const finish = await file(run, word("[finish:always] your end hook fails"), { maxAttempts: 1 });
  const completed = await file(run, word("[completed:always] your success hook fails"), { maxAttempts: 1 });
  await settle(run);
  await gradeFailed(run, "c", finish, "bg-on-finished");
  await gradeFailed(run, "c", completed, "bg-on-completed");
  run.notes.push(`c: onFinished's and onCompleted's steps each failed their task after 1 attempt`);
}

/** d. The same flow as a plain request: it completes, and no task row exists. */
async function legD(run: Run): Promise<void> {
  const before = (await run.h.rows()).length;
  const session = await run.h.http.open("doer", { workerId: "eng.doer" });
  await run.h.http.act("doer", session, "respond", { message: word("[bg:always] a plain request") });
  await run.h.idle();
  const requests = run.tell.over("d · the plain session's requests", (await run.h.requests(session)).filter((r) => r.actionName === "respond"));
  const threw = readProofs().filter((p) => p.kind === "step" && p.step === "bg-after-answer" && p.did === "threw" && p.sessionId === session);
  if (requests.some((r) => r.status !== "completed") || threw.length !== 1) {
    run.failures.push(`d:completed — wanted the plain request completed with its background step having thrown; requests ${show(requests.map((r) => r.status))}, threw ${threw.length}`);
  }
  const after = (await run.h.rows()).length;
  if (after !== before) run.failures.push(`d:no-task-row — wanted no row filed; ${before} rows before, ${after} after`);
  run.notes.push(`d: the plain request completed; its step threw and was logged; no row`);
}

/** e. A cancel while background work runs. */
async function legE(run: Run): Promise<void> {
  const taskId = await file(run, word("[cancel-steps][hold:1500] cancel me while I work"));
  if (!(await run.h.until(async () => (await run.h.byId(taskId))?.status === "in_progress", 10_000))) {
    run.failures.push(`e:cancelled — the task never started: ${show(await run.h.byId(taskId))}`);
    return;
  }
  await sleep(200);
  // The person cancels the task, and its running request is stopped, as the abort route stops it:
  // the durable intent, then the request's controller.
  const cancelled = await run.h.http.act("desk", run.conversation, "updateTask_tasks", { id: taskId, status: "cancelled" });
  const requestId = (await run.h.byId(taskId))?.run?.requestId;
  if (requestId !== undefined) {
    await run.h.runtime.stores.request.setFieldsIfStatus(requestId, { abortRequested: true }, ["in_progress"], Date.now());
    abortRequest(requestId);
  }
  await settle(run);
  const row = await run.h.byId(taskId);
  const steps = run.tell.over(
    "e · the cancel leg's steps",
    readProofs().filter((p) => p.kind === "step" && (p.step === "bg-stops-on-cancel" || p.step === "bg-throws-anyway") && p.sessionId === row?.run?.sessionId)
  );
  if (row?.status !== "cancelled" || row.attempts !== 1 || row.error !== undefined || proofsOf(taskId, "turn").length > 1) {
    run.failures.push(`e:cancelled — wanted it cancelled, not failed, not re-pended; it is ${row?.status} on attempt ${row?.attempts}, error ${show(row?.error)}; the cancel said ${show(cancelled)}`);
  }
  if (!steps.some((p) => p.step === "bg-throws-anyway" && p.did === "threw") || !steps.some((p) => p.step === "bg-stops-on-cancel" && p.did === "stopped")) {
    run.failures.push(`e:both-steps — wanted one step to stop on the cancel and one to throw after it anyway; they did ${show(steps.map((p) => [p.step, p.did]))}`);
  }
  const request = (await run.h.requests(row?.run?.sessionId ?? "")).find((r) => r.id === requestId);
  if (request?.status !== "aborted") run.failures.push(`e:request-stopped — wanted the task's request aborted; it is ${request?.status}`);
  run.notes.push(`e: cancelled on attempt 1; steps ${show(steps.map((p) => [p.step, p.did]))}`);
}

/** f. A dropped connection (the resume's caller goes away), then the step throws. */
async function legF(run: Run): Promise<void> {
  const taskId = await file(run, word("[stop-first:external_event][drop][bg:first] wait, then lose your caller"));
  await run.h.idle();
  const transport = new AbortController();
  transports.set(taskId, transport);
  await resumeStop(run, taskId, transport.signal);
  await settle(run);
  if (!transport.signal.aborted) run.failures.push(`f:dropped — the resumed turn never dropped its caller`);
  await gradeRetried(run, "f", taskId);
  run.notes.push(`f: the caller dropped mid-resume; the step's failure still failed attempt 1`);
}

/**
 * g. A queued message's request, whose step throws: the message is
 * conversation, not part of the task, so its failure is its own.
 */
async function legG(run: Run): Promise<void> {
  const taskId = await file(run, word("[message-first] a message arrives while you work"));
  await settle(run);
  const messages = run.tell.over("g · the message turns", proofsOf(taskId, "message"));
  const threw = readProofs().filter((p) => p.kind === "step" && p.did === "threw" && messages.some((m) => m.requestId === p.requestId));
  if (messages.length === 0 || threw.length === 0) {
    run.failures.push(`g:message-ran — wanted a message's turn on the task's session whose step threw; turns ${show(messages)}, threw ${show(threw)}`);
  }
  const inside = messages.filter((m) => m.claimed !== false || m.taskStatus !== "completed");
  if (inside.length > 0) {
    run.failures.push(`g:outside-the-task — wanted every message turn to run after the task completed, holding no claim; ${show(inside)}`);
  }
  const row = await run.h.byId(taskId);
  const turn = proofsOf(taskId, "turn").find((t) => t.attempt === 1);
  if (row?.status !== "completed" || row.attempts !== 1 || row.output !== turn?.answer || row.error != null || row.feedback != null) {
    run.failures.push(
      `g:done-on-attempt-1 — wanted it completed on attempt 1 with that attempt's answer, no error, no feedback; it is ${row?.status} on attempt ${row?.attempts}, output ${show(row?.output)}, error ${show(row?.error)}, feedback ${show(row?.feedback)}`
    );
  }
  const told = await heard(run, taskId);
  if (told.length !== 1) run.failures.push(`g:heard-once — wanted one ending heard; heard ${show(told)}`);
  run.notes.push(`g: the message ran after the task completed on attempt 1, outside it; its step's failure was its own`);
}

/** h. An onTaskSettled turn whose step always throws, one attempt. */
async function legH(run: Run): Promise<void> {
  const taskId = await file(run, word("[split:1:50][woken-bg] split it"), { maxAttempts: 1 });
  await settle(run);
  run.tell.over("h · the woken turns", proofsOf(taskId, "woken"));
  await gradeFailed(run, "h", taskId, "bg-after-answer");
  run.notes.push(`h: the woken turn's step failed the task after 1 attempt`);
}

/** i. The step fails, the request suspends, the resume reruns it. */
async function legI(run: Run): Promise<void> {
  const throws = word("[before:always][stop:external_event] fail, stop, fail again");
  const clean = word("[before:first-run][stop:external_event] fail, stop, then succeed");
  const ids = [await file(run, throws, { maxAttempts: 1 }), await file(run, clean, { maxAttempts: 1 })];
  await run.h.idle();
  for (const id of ids) {
    const row = await run.h.byId(id);
    if (row?.status !== "in_progress" || row.waitingOn !== "wait") {
      run.failures.push(`i:stopped — wanted it stopped and waiting; it is ${row?.status}, waiting on ${show(row?.waitingOn)}`);
    }
  }
  for (const id of ids) await resumeStop(run, id);
  await settle(run);
  const reruns = run.tell.over(
    "i · the before-step's runs",
    readProofs().filter((p) => p.step === "bg-before" && (p.answer === 2))
  );
  if (reruns.length < 2) run.failures.push(`i:reran — wanted the resume to rerun the failed step in both; it reran ${reruns.length}`);
  await gradeFailed(run, "i", ids[0]!, "bg-before");
  const row = await run.h.byId(ids[1]!);
  if (row?.status !== "completed" || row.attempts !== 1 || row.error !== undefined || row.feedback != null) {
    run.failures.push(`i:clean-rerun-done — wanted the clean rerun done on attempt 1 with no failure; it is ${row?.status} on ${row?.attempts}, error ${show(row?.error)}, feedback ${show(row?.feedback)}`);
  }
  run.notes.push(`i: the throwing rerun failed the task; the clean rerun completed on attempt 1`);
}

/** j. A default .waitForSideChain() drains the failure; the pipeline goes on; one attempt. */
async function legJ(run: Run): Promise<void> {
  const taskId = await file(run, word("[before:always] wait on a step that fails"), { maxAttempts: 1 });
  await settle(run);
  const turns = run.tell.over("j · the turn past the wait", proofsOf(taskId, "turn"));
  if (turns.length !== 1) run.failures.push(`j:went-on — wanted the turn past the wait to run once; it ran ${turns.length}`);
  await gradeFailed(run, "j", taskId, "bg-before");
  run.notes.push(`j: the pipeline went on past the wait, and the drained failure failed the task`);
}

/** k. An agent worker whose capture fails once: conversation result, then filer result. */
async function legK(run: Run): Promise<void> {
  const toConversation = await file(run, word("Write the memo, back to the conversation"), { assignee: "eng.memo", resultTo: "conversation" });
  const toFiler = await file(run, word("Write the memo, back to me"), { assignee: "eng.memo" });
  await settle(run);
  const captures = run.tell.over("k · the captures that threw", readProofs().filter((p) => p.kind === "capture" && p.did === "threw"));
  if (captures.length < 2) run.failures.push(`k:capture-failed — wanted the capture to fail once in each task; it failed ${captures.length} times`);
  const conv = await run.h.byId(toConversation);
  if (conv?.status !== "completed" || conv.attempts !== 1 || conv.output !== MEMO_ANSWER || conv.feedback != null || conv.error !== undefined) {
    run.failures.push(
      `k:conversation-done-on-attempt-1 — wanted the conversation-result task done on attempt 1 with its answer and no failure; it is ${conv?.status} on ${conv?.attempts}, output ${show(conv?.output)}, error ${show(conv?.error ?? conv?.feedback)}`
    );
  }
  const filer = await run.h.byId(toFiler);
  if (filer?.status !== "completed" || filer.attempts !== 2 || filer.output !== MEMO_ANSWER) {
    run.failures.push(`k:done-on-attempt-2 — wanted the filer-result task retried and done on attempt 2; it is ${filer?.status} on ${filer?.attempts}, output ${show(filer?.output)}`);
  }
  for (const id of [toConversation, toFiler]) {
    const told = await heard(run, id);
    if (told.length !== 1) run.failures.push(`k:heard-once — task ${id} heard ${show(told)}`);
  }
  run.notes.push(`k: conversation result done on attempt 1, filer result on attempt 2; the kept capture failure logged ${captureLog.length} time(s)`);
}

const LEGS: Record<string, (run: Run) => Promise<void>> = { a: legA, b: legB, c: legC, d: legD, e: legE, f: legF, g: legG, h: legH, i: legI, j: legJ, k: legK };

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
