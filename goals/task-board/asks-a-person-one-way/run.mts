/**
 * Goal check: a worker that needs a person midway asks one way and its task
 * holds; a flow that needs a review suspends; the person sees each as one
 * Inbox item; and the first answer, from the Inbox, the task's session or the
 * filer's steer, carries the work on on the same attempt (FIX-2131).
 *
 * **Model-free.** A real `createFlowState` host on a durable SQLite store, the
 * Workforce session board on two flows (`desk`, the conversation that files,
 * and `doer`, whose task sessions work), and scripted model turns that call
 * the real tools: a model's `askQuestion` and `waitForUser` (the worker's
 * `questions` capability), and the filer's `updateTask` (its task tools). A
 * block's review is `ctx.waitForUser({ kind: "review" })`. The Inbox is Shift
 * Manager's own snapshot (`createLabReader().read()`), every Inbox answer goes
 * through orchestration's Inbox client, a line typed in a task's session goes
 * through Shift Manager's composer (`sendTurn`), and a task is read through
 * the board's `getTask` action. Nothing is read off the suspension store or
 * written by hand. The turn counter is a proof each turn appends from inside
 * its own run.
 *
 * Legs (each failure is tagged `<leg>:<assertion>`):
 *   a  a model's question holds its task (running, no lease, one row hold);
 *      a block's review suspends with its claim (one suspension hold); one
 *      Inbox item each, named; no row parked
 *   b  the filer's steer naming no question answers nothing; its `updateTask`
 *      naming the question answers it: one more turn on attempt 1, the answer
 *      in that turn's brief, the item gone; an Inbox answer after is told
 *      the question is answered
 *   c  the review listed as a review, reconciled from its suspension hold;
 *      the Inbox's verdict resumes the block on its attempt
 *   d  a line typed in the task's session (Shift Manager's composer) answers
 *      the oldest open question, and a second line the second
 *   e  a steer into a waiting review is kept and answers nothing; once the
 *      Inbox answers, the task takes one more turn holding it
 *   g  on a turn with no task row, the model's `waitForUser` input: the
 *      person's answer as its result; no deadline unset, still suspended past
 *      the sweeper; at the host's person-stop deadline, a no-answer result,
 *      not a throw (on its own host); on a task turn the tool refuses `input`
 *      naming `askQuestion`, while a block's own input still suspends; a
 *      step calling `askQuestion` and `waitForUser` together opens one wait
 *   h  a `complete-or-blocked` plan board whose only open row is held on a
 *      question reports `waiting-on-a-user` on its first idle pass, and the row stays
 *
 * Controls (scratch patches applied as the code under test loads):
 *   composer-sends-turn  the session line goes to the worker as a turn: fails d
 *   count-person-waits   the active-worker count excuses nothing: fails h
 *
 * Run: pnpm tsx goals/task-board/asks-a-person-one-way/run.mts
 * Legs: GOAL_LEGS=a,b,c,d,e,g,h (default: all; a runs first, b to e read its tasks)
 */
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { z } from "zod";
import { defineFlow, generator, handler, sequencer } from "@flow-state-dev/core";
import type { BlockContext, GeneratorModel } from "@flow-state-dev/core/types";
import { createFlowState, runAction } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { askMidway, taskBoard, taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import { getOrCreateTaskCollection, openQuestions, type Task } from "@flow-state-dev/orchestration/tasks";
import { createInboxClient, type InboxQuestion, type InboxItem } from "@flow-state-dev/orchestration/inbox";
import { reconcileInbox, rowTruthOf, suspensionTruthOf, type InboxTruth } from "@flow-state-dev/orchestration/inbox/check";
import { TASK_ID_STATE_KEY } from "../../../packages/workforce/src/workers/keys.ts";
import { steerOrTalk } from "../../../packages/workforce/src/conversation-board/steer.ts";
import {
  createWorkerInstallation,
  defineSessionBoard,
  defineWorkerInventoryCollection,
  inventoryWorkers,
  inventoryWriterActions,
  openInventory,
  filingConversationBoard,
  hireWorkforce,
  workerConfigSchema,
  workerTaskEntry,
  type WorkerManifest
} from "@flow-state-dev/workforce";
import { createLabReader } from "../../../packages/shift-manager/src/lib/reads.ts";
import { sendTurn } from "../../../packages/shift-manager/src/lib/send.ts";
import {
  REPO_ROOT,
  RUN_STAMP,
  actingAs,
  assertPatched,
  describePatches,
  goalTmpDir,
  modulePatchEnv,
  runGoal,
  silentLogger,
  untilIdle,
  type ModulePatch
} from "../../lib/index.mts";

const USER = "u_asks_one_way";
const ORG = "org_asks_one_way";
const CONTROL = process.env.GOAL_CONTROL ?? "";
const SCRATCH = process.env.GOAL_SCRATCH ?? goalTmpDir("asks-a-person-one-way");
const PROOFS = join(SCRATCH, "proofs.ndjson");
const INVENTORY_WRITER_FLOW = "inventory-writer";
const ALL_LEGS = ["a", "b", "c", "d", "e", "g", "h"] as const;
/** The host's deadline for a person's stop on leg g's deadline host: short, so it falls due here. */
const DUE_MS = 1_500;
/** The durability sweeper's interval: "past the sweeper" is a few of these. */
const SWEEP_MS = 1_000;

/** What the model asks, and what the block asks to review. Any prompt passes the same way. */
const REGION = "Which region?";
const REVIEW = "Does this draft read right?";
const INPUT = "Which account should the report go to?";

// ---- patches ------------------------------------------------------------------

const CONTROLS: Record<string, { patches: ModulePatch[]; legs: string[]; mustFail: string[] }> = {
  // A line typed in the task's session goes to the worker as an ordinary turn, never as a steer.
  "composer-sends-turn": {
    patches: [
      {
        module: "packages/workforce/src/conversation-board/steer.ts",
        from: String.raw`execute: async \(_input, ctx\) => \(\(await sessionOpenTask\(ctx\)\) === undefined \? turn : steer\)`,
        to: "execute: async () => turn"
      }
    ],
    legs: ["a", "d"],
    mustFail: ["d:answers-a-second-question"]
  },
  // The active-worker count excuses nothing: a row waiting on a person reads as a worker on it.
  "count-person-waits": {
    patches: [
      {
        module: "packages/orchestration/src/task-board/shared.ts",
        from: String.raw`return countWaitable\(collection, \["in_progress"\], runsElsewhere, true\);`,
        to: 'return countWaitable(collection, ["in_progress"], runsElsewhere, false);'
      }
    ],
    legs: ["h"],
    mustFail: ["h:reports-waiting"]
  }
};

if (CONTROL !== "" && CONTROLS[CONTROL] === undefined) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(CONTROLS).join(", ")}`);
  process.exit(2);
}
const PATCHES = CONTROLS[CONTROL]?.patches ?? [];

// A control re-runs this file with its patches applied as it loads.
if (PATCHES.length > 0 && process.env.GOAL_MODULE_PATCH === undefined) {
  const mark = join(SCRATCH, `patch-mark-${RUN_STAMP}`);
  rmSync(mark, { force: true });
  console.error(`control ${CONTROL}:\n${describePatches(PATCHES, REPO_ROOT)}`);
  const child = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, GOAL_SCRATCH: SCRATCH, GOAL_LEGS: process.env.GOAL_LEGS ?? CONTROLS[CONTROL]!.legs.join(","), ...modulePatchEnv(PATCHES, REPO_ROOT, mark) }
  });
  if (child.status !== 2) assertPatched(PATCHES, REPO_ROOT, mark);
  process.exit(child.status ?? 1);
}
const legs = new Set((process.env.GOAL_LEGS ?? ALL_LEGS.join(",")).split(",").map((s) => s.trim()).filter(Boolean));

// ---- proofs -------------------------------------------------------------------

type Proof = {
  kind: "turn" | "tool-result" | "resumed";
  taskId?: string;
  requestId?: string;
  sessionId?: string;
  attempt?: number;
  turn?: number;
  /** What the turn was handed, or what a tool or a wait came back with. */
  message?: string;
  outcome?: unknown;
  at: number;
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const prove = (proof: Omit<Proof, "at">) => appendFileSync(PROOFS, `${JSON.stringify({ ...proof, at: Date.now() })}\n`, "utf8");
function readProofs(): Proof[] {
  if (!existsSync(PROOFS)) return [];
  return readFileSync(PROOFS, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Proof);
}
const proofsOf = (taskId: string, kind?: Proof["kind"]) => readProofs().filter((p) => p.taskId === taskId && (kind === undefined || p.kind === kind));
const toolResultsWith = (marker: string) => readProofs().filter((p) => p.kind === "tool-result" && (p.message ?? "").includes(marker));

// ---- the scripted model -------------------------------------------------------

/** The text of a model message, whatever its content's shape. */
const textOf = (message: unknown): string => {
  const content = (message as { content?: unknown } | undefined)?.content;
  return typeof content === "string" ? content : JSON.stringify(content ?? "");
};

/**
 * The one scripted model every model turn here runs on, one step at a time.
 * It reads the turn's last user message for a mark and calls the real tool
 * it names; once a tool has answered, it ends the turn naming what came back.
 * A turn handed an answer (`answering "…"`) works and ends.
 *
 * - `[askq]` asks `REGION` with `askQuestion`
 * - `[both]` calls `askQuestion` and `waitForUser` review in one step
 * - `[input-on-task]` asks for input with `waitForUser` on a task turn
 * - `[input]` asks for input with `waitForUser` on a turn with no task row
 * - `[filer]{…}` calls the filer's `updateTask` with that JSON
 */
const scripted: GeneratorModel = {
  modelId: "goal/asks-one-way",
  generate: async () => {
    throw new Error("the goal's scripted model runs one step at a time (generateStep)");
  },
  generateStep: async ({ messages, tools }) => {
    const last = messages.at(-1) as { role?: string } | undefined;
    const user = [...messages].reverse().find((m) => (m as { role?: string }).role === "user");
    const said = textOf(user);
    if (last?.role === "tool") {
      prove({ kind: "tool-result", message: `${said.slice(0, 200)} ⇒ ${textOf(last)}` });
      return { text: `done: ${textOf(last).slice(0, 400)}`, finishReason: "stop" };
    }
    const offered = new Set((tools ?? []).map((tool) => tool.name));
    const call = (toolName: string, args: unknown, id = toolName) => ({ toolCallId: `${id}-${messages.length}`, toolName, args });
    if (said.includes('answering \\"') || said.includes('answering "')) return { text: "Worked it with the answer.", finishReason: "stop" };
    const filer = /\[filer\](\{.*?\})\[\/filer\]/.exec(said);
    if (filer !== null) return { toolCalls: [call("updateTask", JSON.parse(filer[1]!.replace(/\\"/g, '"')))], finishReason: "tool-calls" };
    if (said.includes("[both]")) {
      return { toolCalls: [call("askQuestion", { question: REGION }, "ask"), call("waitForUser", { kind: "review", prompt: REVIEW }, "wait")], finishReason: "tool-calls" };
    }
    if (said.includes("[input-on-task]") || said.includes("[input]")) return { toolCalls: [call("waitForUser", { kind: "input", prompt: INPUT })], finishReason: "tool-calls" };
    if (said.includes("[askq]")) {
      if (!offered.has("askQuestion")) return { text: `askQuestion was not offered: ${[...offered].join(", ")}`, finishReason: "stop" };
      return { toolCalls: [call("askQuestion", { question: REGION })], finishReason: "tool-calls" };
    }
    return { text: "Noted.", finishReason: "stop" };
  }
};
/** Whether a doer turn is the model's: a mark only the model acts on, on a turn not handed an answer. */
const forModel = (message: string) => /\[(askq|both|input-on-task)\]/.test(message) && !/answering "/.test(message);

// ---- the host -----------------------------------------------------------------

const worker = (id: string, declared: Record<string, unknown>): WorkerManifest => ({ id, declared, body: "", skills: [] });
const WORKERS: WorkerManifest[] = [worker("lead", { flow: "desk", delegates: ["eng.doer"] }), worker("eng.doer", { flow: "doer" })];

function buildHost(filename: string, settings: { userDeadlineMs?: number } = {}) {
  let workerFlows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({ standardWorkers: WORKERS, workerFlows: () => workerFlows as never });
  const doorInput = z.object({ message: z.string() });
  const deskBoard = defineSessionBoard({ installation, flowKind: "desk" });
  const doerBoard = defineSessionBoard({ installation, flowKind: "doer" });

  // The desk's turn: the filer's model (its task tools, and `waitForUser` off a task row), or a note.
  const deskModel = generator({
    name: "asks-desk-model",
    model: scripted as never,
    inputSchema: doorInput,
    uses: [deskBoard.tools, deskBoard.questions],
    prompt: "Do what the line says with your tools, then stop.",
    user: (input: { message: string }) => input.message
  });
  const deskNote = handler({ name: "asks-desk-note", inputSchema: doorInput, outputSchema: z.unknown(), execute: (input) => `noted: ${input.message}` });
  const deskTurn = sequencer({ name: "asks-desk-turn", inputSchema: doorInput }).branch({
    model: [(input: { message: string }) => input, (input: { message: string }) => /\[(filer|input)\]/.test(input.message), deskModel],
    note: [(input: { message: string }) => input, (input: { message: string }) => !/\[(filer|input)\]/.test(input.message), deskNote]
  });

  /** Every doer turn proves itself first: the row's attempt and turn as it read them, and its message. */
  const proveTurn = handler({
    name: "asks-doer-prove",
    inputSchema: doorInput,
    outputSchema: z.unknown(),
    execute: async (input, rawCtx) => {
      const ctx = rawCtx as unknown as BlockContext;
      const taskId = (ctx.session.state as Record<string, unknown> | undefined)?.[TASK_ID_STATE_KEY] as string | undefined;
      const board = await filingConversationBoard(ctx);
      const row = taskId === undefined ? undefined : (board?.tasks.get(taskId) as Task | undefined);
      prove({ kind: "turn", requestId: ctx.request.identity.id, sessionId: ctx.session.identity.id, ...(taskId !== undefined ? { taskId } : {}), attempt: row?.attempts, turn: row?.turn, message: input.message });
      return null;
    }
  });
  const doerModel = generator({
    name: "asks-doer-model",
    model: scripted as never,
    inputSchema: doorInput,
    uses: [doerBoard.questions],
    prompt: "Ask what the task says to ask, then stop.",
    user: (input: { message: string }) => input.message
  });
  /**
   * The doer's code turn. `[review]` asks the user to review a draft (a
   * block's stop); `[ask2]` asks two questions midway (`askMidway`);
   * `[block-input]` asks for input with the block's own `ctx.waitForUser`.
   */
  const doerCode = handler({
    name: "asks-doer-code",
    inputSchema: doorInput,
    outputSchema: z.unknown(),
    execute: async (input, rawCtx) => {
      const ctx = rawCtx as unknown as BlockContext;
      const message = input.message;
      const taskId = (ctx.session.state as Record<string, unknown> | undefined)?.[TASK_ID_STATE_KEY] as string | undefined;
      const base = { requestId: ctx.request.identity.id, sessionId: ctx.session.identity.id, ...(taskId !== undefined ? { taskId } : {}) };
      const answered = /answering "/.test(message);
      if (message.includes("[review]") && !answered) {
        const review = await ctx.waitForUser({ kind: "review", prompt: REVIEW } as never);
        const board = await filingConversationBoard(ctx);
        const row = taskId === undefined ? undefined : (board?.tasks.get(taskId) as Task | undefined);
        prove({ kind: "resumed", ...base, attempt: row?.attempts, outcome: review });
        return { reviewed: review };
      }
      if (message.includes("[block-input]") && !answered) {
        const asked = await ctx.waitForUser({ kind: "input", prompt: INPUT } as never);
        prove({ kind: "resumed", ...base, outcome: asked });
        return { asked };
      }
      if (message.includes("[ask2]") && !answered) {
        const board = await filingConversationBoard(ctx);
        if (board !== undefined) await askMidway(ctx, board.tasks, [{ prompt: "Which export?" }, { prompt: "Which date column?" }]);
        return "asked";
      }
      return `done ${taskId ?? "no task"}`;
    }
  });
  const doerWork = sequencer({ name: "asks-doer-work", inputSchema: doorInput })
    .tap(proveTurn)
    .branch({
      model: [(input: { message: string }) => input, (input: { message: string }) => forModel(input.message), doerModel],
      code: [(input: { message: string }) => input, (input: { message: string }) => !forModel(input.message), doerCode]
    });

  const deskFlow = defineFlow({
    kind: "desk",
    configSchema: workerConfigSchema(),
    session: { ...installation.session(deskBoard.sessionStateShape), serverOwned: [...deskBoard.serverOwned] },
    resources: { ...installation.resources, ...deskBoard.resources, inventoryWorkers: defineWorkerInventoryCollection() },
    actions: { respond: { inputSchema: doorInput.strict(), block: deskTurn, userMessage: (i: { message: string }) => i.message }, ...deskBoard.actions },
    internal: { actions: deskBoard.entries(deskNote, () => "fixed") },
    task: { actions: { work: workerTaskEntry({ name: "asks-desk-task", turn: deskNote }) } }
  } as never);
  const doerFlow = defineFlow({
    kind: "doer",
    configSchema: workerConfigSchema(),
    session: { ...installation.session(doerBoard.sessionStateShape), serverOwned: [...doerBoard.serverOwned] },
    resources: { ...installation.resources, ...doerBoard.resources },
    // A line typed in a task's session steers it, through the one home for what a line answers.
    actions: { respond: { inputSchema: doorInput.strict(), block: steerOrTalk(doerWork), userMessage: (i: { message: string }) => i.message }, ...doerBoard.actions },
    internal: { actions: doerBoard.entries(doerWork, () => "judgment") },
    task: { actions: { work: { ...workerTaskEntry({ name: "asks-doer-task", turn: doerWork }), durable: true } } }
  } as never);
  workerFlows = { desk: { flow: deskFlow, roles: ["contributor", "manager"] }, doer: { flow: doerFlow, roles: ["contributor", "manager"] } };

  // Leg h's plan board: one inline worker that asks midway, on a board kept on the drain's request.
  const PLAN = "plan-h";
  const planCollection = (ctx: BlockContext) => getOrCreateTaskCollection({ ctx, backing: "state", collectionId: PLAN });
  const planAsker = handler({
    name: "plan-asker",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.unknown(),
    execute: async (_input, rawCtx) => {
      const ctx = rawCtx as unknown as BlockContext;
      return askMidway(ctx, await planCollection(ctx), [{ prompt: REGION }]);
    }
  });
  const board = taskBoard({
    name: PLAN,
    collectionId: PLAN,
    concurrency: 1,
    onIdle: "complete-or-blocked",
    maxIterations: 200,
    initialTasks: [{ id: "h1", goal: "pick the region and deploy" }],
    workers: planAsker as never
  } as never);
  const readPlan = handler({
    name: "plan-read",
    inputSchema: z.unknown(),
    outputSchema: z.unknown(),
    execute: async (_input, rawCtx) => {
      const ctx = rawCtx as unknown as BlockContext;
      return (await planCollection(ctx)).list().map((row) => ({ id: row.id, status: row.status, attempts: row.attempts, turn: row.turn, lease: row.leaseUntil ?? null, open: openQuestions(row).map((h) => h.ask.prompt) }));
    }
  });
  const planFlow = defineFlow({
    kind: "plan",
    actions: { drain: { inputSchema: z.object({}).strict(), block: sequencer({ name: "plan-drain", inputSchema: z.object({}) }).step(board.drain as never).step(readPlan) } }
  } as never);

  const flows: Record<string, any> = {
    ...Object.fromEntries(hireWorkforce(installation).map((copy) => [copy.id, copy])),
    plan: planFlow(),
    [INVENTORY_WRITER_FLOW]: defineFlow({ kind: INVENTORY_WRITER_FLOW, internal: { actions: { ...inventoryWriterActions() } } } as never)()
  };
  const state = createFlowState({
    flows,
    stores: { default: { primary: sqliteStores({ filename }) } },
    logger: silentLogger,
    durabilityRetention: { sweepIntervalMs: SWEEP_MS },
    ...(settings.userDeadlineMs !== undefined ? { userDeadlineMs: settings.userDeadlineMs } : {}),
    resolvePrincipal: (context: any) => {
      const user = context.request?.headers.get("x-user");
      return typeof user === "string" ? { userId: user, orgId: ORG } : null;
    }
  } as never);

  const connect = async () => {
    const runtime = await state.getRuntime();
    // The inventory, written once as a Lab's boot does, so Shift Manager's read finds the workers.
    const binding = await openInventory(
      { workers: inventoryWorkers(installation) },
      {
        run: async (request) => {
          const result = (await runAction({ flow: flows[request.flowKind], actionName: request.action, input: request.input, userId: request.userId, orgId: request.orgId, sessionId: request.sessionId, source: request.source, stores: runtime.stores, runtimeConfig: runtime.runtimeConfig } as never)) as { error?: unknown };
          if (result?.error !== undefined) throw new Error(String((result.error as Error).message ?? result.error));
          return result;
        },
        workerWriter: { flowKind: INVENTORY_WRITER_FLOW },
        userId: USER,
        orgId: ORG
      }
    );
    if (binding.problems.length > 0) throw new Error(`the inventory didn't open: ${binding.problems.join("; ")}`);
    const router = (await state.getRouter()) as never;
    const http = actingAs(router, USER);
    const rows = async (): Promise<Task[]> =>
      Object.values(await runtime.stores.resourceState.getByPrefix("user", `${USER}:~org:${ORG}`, "tasks/")).map((value) => value.state as Task);
    const byId = async (id: string) => (await rows()).find((r) => r.id === id);
    const until = async (check: () => Promise<boolean>, ms: number) => {
      for (const deadline = Date.now() + ms; Date.now() < deadline; await sleep(50)) if (await check()) return true;
      return check();
    };
    const idle = async () => {
      for (let i = 0; i < 600; i += 1) {
        await untilIdle(runtime.stores);
        const all = (await runtime.stores.request.list({ orderBy: "none", limit: 4000 } as never)) as Array<{ status: string; finalizedAtMs?: number | null }>;
        if (all.every((r) => r.status === "suspended" || r.finalizedAtMs != null)) return;
        await sleep(50);
      }
    };
    return { runtime, http, rows, byId, until, idle };
  };
  return { state, connect };
}

type Host = Awaited<ReturnType<ReturnType<typeof buildHost>["connect"]>>;
type Tell = Parameters<Parameters<typeof runGoal>[0]>[1];
interface Run {
  h: Host;
  conversation: string;
  failures: string[];
  notes: string[];
  tell: Tell;
  /** The holds answered so far: none may come back. */
  closed: string[];
  /** Leg a's two tasks, which b, c and e work on. */
  asked?: string;
  reviewed?: string;
}
const show = (value: unknown) => JSON.stringify(value);
const word = (text: string) => `${text} ${RUN_STAMP}`;

// ---- what a screen does ---------------------------------------------------------

/** File `goal` for eng.doer from the desk. Its task id. */
async function file(run: Run, goal: string): Promise<string> {
  const filed = await run.h.http.act("desk", run.conversation, "createTask_tasks", { goal, assignee: "eng.doer" });
  if (filed?.ok !== true) throw new Error(`filing "${goal}" was refused: ${show(filed)}`);
  return filed.taskId as string;
}
/** The task as its public read shows it. */
async function getTask(run: Run, id: string): Promise<Record<string, any> | undefined> {
  const read = await run.h.http.act("desk", run.conversation, "getTask_tasks", { id });
  return read?.ok === true ? read.task : undefined;
}
/** The Inbox as Shift Manager reads it: its own snapshot's `inbox` section. */
async function inbox(run: Run): Promise<InboxItem<unknown>[]> {
  const snapshot = await createLabReader(run.h.http.client).read();
  if (!("inbox" in snapshot) || snapshot.inbox === undefined) throw new Error(`Shift Manager's read came back ${show(snapshot)}`);
  if (!snapshot.inbox.ok) throw new Error(`Shift Manager's Inbox didn't load: ${snapshot.inbox.failure.message}`);
  return snapshot.inbox.value;
}
const itemOf = async (run: Run, id: string) => (await inbox(run)).find((item) => item.task?.taskId === id);
/** Answer one hold as the Inbox does. What it said: `ok`, or the refusal's words. */
async function answerOne(run: Run, hold: InboxQuestion<unknown>, value: Parameters<ReturnType<typeof createInboxClient>["answerOne"]>[1]): Promise<string> {
  try {
    await createInboxClient(run.h.http.client).answerOne(hold, value);
    return "ok";
  } catch (error) {
    return (error as Error).message;
  }
}
/** The filer's model, told to call `updateTask` with `args` on its next turn in the conversation. */
async function filerSays(run: Run, args: Record<string, unknown>): Promise<void> {
  await run.h.http.act("desk", run.conversation, "respond", { message: `[filer]${JSON.stringify(args)}[/filer]` });
  await run.h.idle();
}
const openOf = (row: Task | undefined) => (row === undefined ? [] : openQuestions(row));

/** The Inbox's truth, read apart from the list: the board's `listTasks` rows, and every task session's suspended requests. */
async function truthOf(run: Run): Promise<InboxTruth> {
  const listed = (await run.h.http.act("desk", run.conversation, "listTasks_tasks", {}))?.tasks ?? [];
  const board = `${run.conversation}.tasks`;
  const rows = listed.map((t: any) => ({ board, id: t.id, status: t.status, questions: t.questions ?? [], steers: [] }));
  const sessions = new Set<string>(listed.flatMap((t: any) => (t.run?.sessionId === undefined ? [] : [t.run.sessionId])));
  sessions.add(run.conversation);
  const suspensions = [];
  for (const sessionId of sessions) {
    suspensions.push(...suspensionTruthOf(sessionId, await run.h.http.client.sessions.requests(sessionId, { status: "suspended", includeItems: true })));
  }
  return { rows: rowTruthOf(rows), suspensions, closed: run.closed };
}
async function reconciled(run: Run, leg: string): Promise<void> {
  const result = reconcileInbox(await inbox(run), await truthOf(run));
  if (!result.green) run.failures.push(`${leg}:reconciler — ${show({ ...result, green: undefined })}`);
}

// ---- the legs ---------------------------------------------------------------------

/** a: a model's question holds its task; a block's review suspends; one item each, named. */
async function legA(run: Run): Promise<void> {
  const asked = await file(run, word("Deploy the billing service [askq]"));
  const reviewed = await file(run, word("Draft the release note [review]"));
  run.asked = asked;
  run.reviewed = reviewed;
  const heldOk = await run.h.until(async () => openOf(await run.h.byId(asked)).length === 1, 20_000);
  const waitOk = await run.h.until(async () => openOf(await run.h.byId(reviewed)).some((h) => h.source.kind === "suspension"), 20_000);
  await run.h.idle();
  const askedRead = await getTask(run, asked);
  const reviewRead = await getTask(run, reviewed);
  const askedHolds = (askedRead?.questions ?? []) as Array<{ source: { kind: string }; ask: { kind: string; prompt: string } }>;
  if (!heldOk || askedRead?.status !== "in_progress" || askedRead.leaseUntil != null || askedHolds.length !== 1 || askedHolds[0]?.source.kind !== "row" || askedHolds[0]?.ask.kind !== "question" || askedHolds[0]?.ask.prompt !== REGION) {
    run.failures.push(`a:question-holds — wanted the asking task running with no lease and one open row hold, a question "${REGION}"; getTask shows ${show(askedRead && { status: askedRead.status, lease: askedRead.leaseUntil, questions: askedRead.questions })}`);
  }
  const reviewHolds = (reviewRead?.questions ?? []) as Array<{ source: { kind: string }; ask: { kind: string; prompt: string } }>;
  const reviewRow = await run.h.byId(reviewed);
  if (!waitOk || reviewRead?.status !== "in_progress" || reviewHolds.length !== 1 || reviewHolds[0]?.source.kind !== "suspension" || reviewHolds[0]?.ask.kind !== "review" || reviewRow?.claimedBy == null) {
    run.failures.push(`a:review-suspends — wanted the reviewed task running on its claim with one open suspension hold, a review; getTask shows ${show(reviewRead && { status: reviewRead.status, questions: reviewRead.questions })}, claim ${show(reviewRow?.claimedBy)}`);
  }
  const items = await inbox(run);
  const askedItems = items.filter((i) => i.task?.taskId === asked);
  const reviewItems = items.filter((i) => i.task?.taskId === reviewed);
  if (askedItems.length !== 1 || askedItems[0]!.questions.length !== 1 || askedItems[0]!.questions[0]!.ask.kind !== "question") {
    run.failures.push(`a:one-question-item — wanted one Inbox item for the asking task, a question; the Inbox lists ${show(askedItems.map((i) => i.questions.map((h) => h.ask)))}`);
  }
  if (reviewItems.length !== 1 || reviewItems[0]!.questions.length !== 1 || reviewItems[0]!.questions[0]!.ask.kind !== "review") {
    run.failures.push(`a:one-review-item — wanted one Inbox item for the reviewed task, named a review; the Inbox lists ${show(reviewItems.map((i) => i.questions.map((h) => h.ask)))}`);
  }
  const statuses = (await run.h.rows()).map((r) => r.status as string);
  if (statuses.includes("parked")) run.failures.push(`a:no-row-parked — a row reads parked: ${show(statuses)}`);
  run.tell.over("a · the rows on the board", await run.h.rows());
  await reconciled(run, "a");
  run.notes.push(`a: the model's question held its task (${asked}), the block's review suspended its run (${reviewed}); one Inbox item each, a question and a review`);
}

/** b: the filer's steer naming no question answers nothing; naming it, answers it; an Inbox answer after is told so. */
async function legB(run: Run): Promise<void> {
  const id = run.asked!;
  const before = openOf(await run.h.byId(id));
  const question = before[0];
  const staleItem = await itemOf(run, id);
  if (question === undefined || staleItem === undefined) {
    run.failures.push(`b:setup — the asking task holds no question to answer (${show(before)})`);
    return;
  }
  // A steer naming no question answers nothing.
  await filerSays(run, { id, message: "Any update on this?" });
  const stillOpen = openOf(await run.h.byId(id)).map((h) => h.id);
  if (stillOpen.join() !== question.id || (await itemOf(run, id)) === undefined) {
    run.failures.push(`b:steer-names-no-question — wanted the question still open and listed after the filer's steer naming none; open ${show(stillOpen)}`);
  }
  // Naming the question answers it.
  await filerSays(run, { id, answers: question.id, message: "Use eu-west." });
  run.closed.push(question.id);
  const done = await run.h.until(async () => (await run.h.byId(id))?.status === "completed", 20_000);
  await run.h.idle();
  const row = await run.h.byId(id);
  const turns = proofsOf(id, "turn");
  if (!done || turns.length !== 2 || row?.attempts !== 1 || turns.some((t) => t.attempt !== 1)) {
    run.failures.push(`b:one-more-turn — wanted exactly one more turn on attempt 1, and the task completed; ${turns.length} turns on attempts ${show(turns.map((t) => t.attempt))}, the row ${show(row && { status: row.status, attempts: row.attempts })}`);
  }
  if (!(turns[1]?.message ?? "").includes("Use eu-west.") || !(turns[1]?.message ?? "").includes(REGION)) {
    run.failures.push(`b:answer-in-brief — wanted the answer, with its question, in that turn's message; it was ${show(turns[1]?.message?.slice(0, 500))}`);
  }
  const answerSteer = (row?.steers ?? []).find((s) => s.answers === question.id);
  if (answerSteer?.from !== "filer") run.failures.push(`b:from-the-filer — wanted the answer kept from the filer; it is ${show(answerSteer)}`);
  if ((await itemOf(run, id)) !== undefined) run.failures.push("b:item-gone — the answered question is still listed");
  // An Inbox answer after it is told the question is answered.
  const late = await answerOne(run, staleItem.questions[0]!, { text: "Use us-east." });
  if (late === "ok" || !/answered/.test(late)) run.failures.push(`b:late-inbox-answer — wanted an Inbox answer after the filer's told the question is answered; it said ${late}`);
  await reconciled(run, "b");
  run.notes.push(`b: the filer's steer naming none left it open; naming it answered it, one more turn on attempt 1 with the answer in its brief; a later Inbox answer: ${late.slice(0, 120)}`);
}

/** c: the review listed as a review, reconciled; the Inbox's verdict resumes the block on its attempt. */
async function legC(run: Run): Promise<void> {
  const id = run.reviewed!;
  const item = await itemOf(run, id);
  const hold = item?.questions[0];
  if (hold?.ask.kind !== "review" || hold.source.kind !== "suspension" || hold.ask.prompt !== REVIEW) {
    run.failures.push(`c:listed-as-review — wanted the review listed as one suspension hold named a review; the Inbox shows ${show(item?.questions)}`);
    return;
  }
  await reconciled(run, "c:held");
  const said = await answerOne(run, hold, { value: "Reads right; ship it." });
  if (said !== "ok") run.failures.push(`c:answered — the Inbox's verdict was refused: ${said}`);
  run.closed.push(hold.id);
  const done = await run.h.until(async () => (await run.h.byId(id))?.status === "completed", 20_000);
  await run.h.idle();
  const resumed = proofsOf(id, "resumed");
  const outcome = resumed[0]?.outcome as { cancelled?: boolean; answer?: unknown } | undefined;
  const row = await run.h.byId(id);
  if (!done || resumed.length !== 1 || outcome?.answer !== "Reads right; ship it." || resumed[0]?.attempt !== 1 || row?.attempts !== 1) {
    run.failures.push(`c:verdict-resumes — wanted the verdict to resume the block once, on attempt 1, and the task to complete; resumed ${show(resumed.map((r) => [r.attempt, r.outcome]))}, the row ${show(row && { status: row.status, attempts: row.attempts })}`);
  }
  if ((await itemOf(run, id)) !== undefined) run.failures.push("c:item-gone — the answered review is still listed");
  if (openOf(row).length !== 0) run.failures.push(`c:hold-closed — the resume left a hold open: ${show(row?.questions)}`);
  await reconciled(run, "c");
  run.notes.push(`c: the review listed as a review and reconciled from its suspension hold; the Inbox's verdict resumed the block on attempt 1`);
}

/** d: a line typed in the task's session, through Shift Manager's composer, answers the oldest open question, then the second. */
async function legD(run: Run): Promise<void> {
  const id = await file(run, word("Reconcile the two exports [ask2]"));
  if (!(await run.h.until(async () => openOf(await run.h.byId(id)).length === 2, 20_000))) {
    run.failures.push(`d:setup — the task never held on its two questions: ${show((await run.h.byId(id))?.questions)}`);
    return;
  }
  await run.h.idle();
  const row = (await run.h.byId(id))!;
  const [oldest, newer] = openOf(row);
  const target = { sessionId: row.run!.sessionId, flowId: "doer", door: "respond" };
  const line = async (text: string) => {
    try {
      await sendTurn(run.h.http.client, target, text, { timeoutMs: 30_000, pollMs: 50 });
    } catch (error) {
      run.notes.push(`d: the composer's line "${text}" came back ${(error as Error).message.slice(0, 160)}`);
    }
    await run.h.idle();
  };
  await line("The March export.");
  const afterOne = await run.h.byId(id);
  if (openOf(afterOne).map((h) => h.id).join() !== newer!.id || !(afterOne?.steers ?? []).some((s) => s.answers === oldest!.id && s.from === "user" && s.message === "The March export.")) {
    run.failures.push(`d:first-line-answers — wanted the line written from the user as the answer to the oldest question, the other left open; open ${show(openOf(afterOne).map((h) => h.ask.prompt))}, steers ${show(afterOne?.steers)}`);
  }
  await line("signup_date");
  const afterTwo = await run.h.byId(id);
  if (!(afterTwo?.steers ?? []).some((s) => s.answers === newer!.id && s.from === "user" && s.message === "signup_date")) {
    run.failures.push(`d:answers-a-second-question — wanted a second line to answer the second question; open ${show(openOf(afterTwo).map((h) => h.ask.prompt))}, steers ${show(afterTwo?.steers)}`);
  } else {
    run.closed.push(oldest!.id, newer!.id);
    await run.h.until(async () => (await run.h.byId(id))?.status === "completed", 20_000);
    const turns = proofsOf(id, "turn");
    if ((await run.h.byId(id))?.status !== "completed" || turns.at(-1)?.attempt !== 1 || !(turns.at(-1)?.message ?? "").includes("signup_date")) {
      run.failures.push(`d:goes-on — wanted the task to take its owed turn on attempt 1 with both answers and complete; turns ${show(turns.map((t) => [t.attempt, t.message?.slice(0, 80)]))}`);
    }
  }
  await run.h.http.act("desk", run.conversation, "updateTask_tasks", { id, status: "cancelled" }).catch(() => undefined);
  await run.h.idle();
  run.notes.push(`d: two lines typed in the task's session through Shift Manager's composer answered its two questions, oldest first`);
}

/** e: a steer into a waiting review is kept and answers nothing; the task then takes one more turn holding it. */
async function legE(run: Run): Promise<void> {
  const id = await file(run, word("Draft the migration note [review]"));
  if (!(await run.h.until(async () => openOf(await run.h.byId(id)).some((h) => h.source.kind === "suspension"), 20_000))) {
    run.failures.push(`e:setup — the task never waited on its review: ${show((await run.h.byId(id))?.questions)}`);
    return;
  }
  await run.h.idle();
  const steer = "Mention the rollback window too.";
  await run.h.http.act("desk", run.conversation, "updateTask_tasks", { id, message: steer });
  await run.h.idle();
  const item = await itemOf(run, id);
  const kept = ((await run.h.byId(id))?.steers ?? []).find((s) => s.message === steer);
  if (item?.questions[0]?.ask.kind !== "review" || kept === undefined || kept.answers !== undefined) {
    run.failures.push(`e:steer-kept — wanted the review still listed and the steer kept, answering nothing; item ${show(item?.questions)}, steer ${show(kept)}`);
  }
  if (item?.questions[0] === undefined) return;
  const said = await answerOne(run, item.questions[0], { value: "Fine." });
  if (said !== "ok") run.failures.push(`e:answered — the Inbox's verdict was refused: ${said}`);
  run.closed.push(item.questions[0].id);
  await run.h.until(async () => (await run.h.byId(id))?.status === "completed", 20_000);
  await run.h.idle();
  const turns = proofsOf(id, "turn");
  const row = await run.h.byId(id);
  if (row?.status !== "completed" || turns.length !== 2 || !(turns[1]?.message ?? "").includes(steer) || row.attempts !== 1) {
    run.failures.push(`e:one-more-turn — wanted one more turn after the verdict, on attempt 1, holding the steer, then completed; ${turns.length} turns ${show(turns.map((t) => [t.attempt, t.message?.slice(0, 120)]))}, the row ${show(row && { status: row.status, attempts: row.attempts })}`);
  }
  await reconciled(run, "e");
  run.notes.push(`e: a steer into the waiting review was kept and answered nothing; after the verdict the task took one more turn holding it`);
}

/** g: the model's `waitForUser` input off a task row, the task-turn refusal, a block's input, and one wait per step. */
async function legG(run: Run): Promise<void> {
  // A turn with no task row: the desk's own model asks for input.
  const sent = await run.h.http.client.flow("desk").send("respond", { message: "[input] the report" }, { sessionId: run.conversation });
  const suspended = await run.h.until(async () => (await run.h.http.client.sessions.requests(run.conversation, { status: "suspended" })).some((r) => r.id === sent.id), 15_000);
  // No deadline set: past several sweeps, still suspended and still listed.
  await sleep(SWEEP_MS * 4);
  const lone = (await inbox(run)).find((i) => i.task === null && i.questions[0]?.ask.prompt === INPUT);
  const stillSuspended = (await run.h.http.client.sessions.requests(run.conversation, { status: "suspended" })).some((r) => r.id === sent.id);
  if (!suspended || !stillSuspended || lone === undefined || lone.questions[0]!.ask.kind !== "input") {
    run.failures.push(`g:input-waits — wanted the input listed in the Inbox with no task, and the request still suspended past the sweeper; suspended ${suspended}/${stillSuspended}, item ${show(lone?.questions)}`);
  } else {
    const said = await answerOne(run, lone.questions[0]!, { value: "acct-eu-42" });
    if (said !== "ok") run.failures.push(`g:input-answered — the Inbox's answer was refused: ${said}`);
    await sent.wait({ pollMs: 20, timeoutMs: 20_000 }).catch(() => undefined);
    const result = toolResultsWith("[input] the report").at(-1)?.message ?? "";
    if (!result.includes("acct-eu-42") || !/"answered":\s*true/.test(result)) {
      run.failures.push(`g:input-is-the-result — wanted the person's answer as the tool's result; the model read ${show(result.slice(0, 400))}`);
    }
  }
  // On a task turn the tool refuses input and names askQuestion.
  const refusedId = await file(run, word("Find the account [input-on-task]"));
  await run.h.until(async () => (await run.h.byId(refusedId))?.status === "completed", 20_000);
  await run.h.idle();
  const refusal = toolResultsWith("[input-on-task]").at(-1)?.message ?? "";
  if (!refusal.includes("askQuestion") || (await itemOf(run, refusedId)) !== undefined) {
    run.failures.push(`g:task-turn-refuses-input — wanted the tool to refuse input on a task turn naming askQuestion, and nothing listed; the model read ${show(refusal.slice(0, 400))}`);
  }
  // A block's own input on a task turn still suspends (FIX-2129).
  const blockId = await file(run, word("Ask the block's way [block-input]"));
  const blockWaits = await run.h.until(async () => openOf(await run.h.byId(blockId)).some((h) => h.source.kind === "suspension" && h.ask.kind === "input"), 20_000);
  if (!blockWaits || (await itemOf(run, blockId))?.questions[0]?.ask.kind !== "input") {
    run.failures.push(`g:block-input-suspends — wanted a block's own waitForUser input to suspend and list; holds ${show((await run.h.byId(blockId))?.questions)}`);
  }
  await run.h.http.act("desk", run.conversation, "updateTask_tasks", { id: blockId, status: "cancelled" }).catch(() => undefined);
  // One step, both tools: one wait opens, the sibling names the other.
  const bothId = await file(run, word("Ask and review together [both]"));
  await run.h.until(async () => openOf(await run.h.byId(bothId)).length > 0 || (await run.h.byId(bothId))?.status === "completed", 20_000);
  await run.h.idle();
  const both = await run.h.byId(bothId);
  const sources = openOf(both).map((h) => h.source.kind);
  const results = toolResultsWith("[both]").at(-1)?.message ?? "";
  const turnRequests = proofsOf(bothId, "turn").map((t) => t.requestId!);
  const sessionId = both?.run?.sessionId;
  const stillSuspendedBoth = sessionId === undefined ? [] : (await run.h.http.client.sessions.requests(sessionId, { status: "suspended" })).filter((r) => turnRequests.includes(r.id));
  if (sources.length !== 1 || sources[0] !== "row" || !/one_wait_per_turn/.test(results) || stillSuspendedBoth.length !== 0) {
    run.failures.push(`g:one-wait-per-step — wanted one wait opened (the question, first to commit), the sibling refused naming it, and no stop; holds ${show(sources)}, suspended ${stillSuspendedBoth.length}, the model read ${show(results.slice(0, 500))}`);
  }
  await run.h.http.act("desk", run.conversation, "updateTask_tasks", { id: bothId, status: "cancelled" }).catch(() => undefined);
  await run.h.idle();
  run.notes.push(`g: input off a task row came back as the tool's result and waited past the sweeper unanswered; on a task turn the tool refused input naming askQuestion; a block's input suspended; both tools in one step opened one wait`);
}

/** g, on a host with a person-stop deadline: the model's input comes back unanswered at it, not a throw. */
async function legGDeadline(run: Run): Promise<void> {
  const sent = await run.h.http.client.flow("desk").send("respond", { message: "[input] the deadline" }, { sessionId: run.conversation });
  // It stops for the person first, so wait past the stop for the request to end.
  let ended = { status: "never ended" };
  for (const until = Date.now() + DUE_MS + 20_000; Date.now() < until; await sleep(100)) {
    const now = (await run.h.http.client.flow("desk").request(sent.id).status()).status as string;
    if (now !== "suspended" && now !== "in_progress" && now !== "pending") {
      ended = { status: now };
      break;
    }
  }
  const result = toolResultsWith("[input] the deadline").at(-1)?.message ?? "";
  if ((ended as { status: string }).status !== "completed" || !/"answered":\s*false/.test(result) || !/"deadline":\s*true/.test(result)) {
    run.failures.push(`g:deadline-no-answer — wanted the request completed with an unanswered result at the host's deadline; it ended ${(ended as { status: string }).status}, the model read ${show(result.slice(0, 400))}`);
  }
  run.notes.push(`g: at the host's ${DUE_MS} ms person-stop deadline the model's input came back answered: false, deadline: true`);
}

/** h: a complete-or-blocked plan board whose only open row is held on a question reports waiting-on-a-user on its first idle pass. */
async function legH(run: Run): Promise<void> {
  const session = await run.h.http.client.flow("plan").createSession({});
  const started = Date.now();
  const sent = await run.h.http.client.flow("plan").send("drain", {}, { sessionId: session.id });
  const ended = await sent.wait({ pollMs: 20, timeoutMs: 15_000 }).catch(() => ({ status: "still running after 15 s" }));
  const tookMs = Date.now() - started;
  const listed = await run.h.http.client.sessions.requests(session.id, { includeResultOutput: true, includeItems: true });
  const request = listed.find((r) => r.id === sent.id) as { result?: { output?: unknown; error?: unknown }; items?: Array<Record<string, any>> } | undefined;
  const meta = (request?.items ?? []).filter((i) => i.component === "task-board-meta").at(-1)?.data as { status?: string; terminationReason?: string } | undefined;
  const rows = (request?.result?.output ?? []) as Array<{ id: string; status: string; attempts: number; lease: number | null; open: string[] }>;
  const h1 = rows.find((r) => r.id === "h1");
  if ((ended as { status: string }).status !== "completed" || meta?.status !== "completed" || meta.terminationReason !== "waiting-on-a-user" || tookMs > 10_000) {
    run.failures.push(`h:reports-waiting — wanted the drain to stop waiting-on-a-user on its first idle pass; it ended ${(ended as { status: string }).status} after ${tookMs} ms, its meta ${show(meta)}, error ${show(request?.result?.error)}`);
  }
  if (h1?.status !== "in_progress" || h1.attempts !== 1 || h1.lease !== null || h1.open.join() !== REGION) {
    run.failures.push(`h:row-stays — wanted the row running on attempt 1, no lease, held on "${REGION}"; it is ${show(h1)}`);
  }
  run.notes.push(`h: the plan board stopped ${meta?.terminationReason} ${tookMs} ms after it started, its one row held on its question`);
}

// ---- the run ------------------------------------------------------------------------

async function onHost(name: string, settings: { userDeadlineMs?: number }, failures: string[], notes: string[], tell: Tell, body: (run: Run) => Promise<void>) {
  const host = buildHost(join(SCRATCH, `${name}-${RUN_STAMP}.sqlite`), settings);
  try {
    const run: Run = { h: await host.connect(), conversation: "", failures, notes, tell, closed: [] };
    run.conversation = await run.h.http.open("desk", { workerId: "lead" });
    await body(run);
  } finally {
    await host.state.dispose();
  }
}

await runGoal(async (failures, tell) => {
  writeFileSync(PROOFS, "", "utf8");
  const notes: string[] = [];
  const guard = (leg: string, go: () => Promise<void>): Promise<void> =>
    go().catch((error: unknown) => void failures.push(`${leg}:threw — ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`));
  await onHost("main", {}, failures, notes, tell, async (run) => {
    if (legs.has("a") || legs.has("b") || legs.has("c")) await guard("a", () => legA(run));
    if (legs.has("b") && run.asked !== undefined) await guard("b", () => legB(run));
    if (legs.has("c") && run.reviewed !== undefined) await guard("c", () => legC(run));
    if (legs.has("d")) await guard("d", () => legD(run));
    if (legs.has("e")) await guard("e", () => legE(run));
    if (legs.has("g")) await guard("g", () => legG(run));
    if (legs.has("h")) await guard("h", () => legH(run));
  });
  if (legs.has("g")) await onHost("due", { userDeadlineMs: DUE_MS }, failures, notes, tell, (run) => guard("g", () => legGDeadline(run)));
  // A control must fail exactly where goal.md says, and the run says so itself.
  const control = CONTROLS[CONTROL];
  if (control !== undefined) {
    const missing = control.mustFail.filter((tag) => !failures.some((f) => f.startsWith(`${tag} `)));
    const legsAllowed = new Set(control.mustFail.map((tag) => tag.split(":")[0]!));
    const elsewhere = failures.filter((f) => !legsAllowed.has(f.split(":")[0]!));
    if (missing.length === 0 && elsewhere.length === 0) {
      return { failures: [`control ${CONTROL}: failed ${control.mustFail.join(", ")}, as it must`, ...failures], evidence: notes.join("\n") };
    }
    return { failures: [`control ${CONTROL}: must fail ${control.mustFail.join(", ")} and only its leg; missing ${show(missing)}, red elsewhere ${show(elsewhere)}`, ...failures], evidence: notes.join("\n") };
  }
  return { failures, evidence: notes.join("\n") };
});
