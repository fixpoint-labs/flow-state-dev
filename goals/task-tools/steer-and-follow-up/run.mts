/** Goal check. Contract, controls, and the verdict log: `goal.md`. */

import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineFlow, handler, harnessRunHandleSchema, harnessRunInputSchema } from "@flow-state-dev/core";
import type { GeneratorModel, HarnessBlock } from "@flow-state-dev/core/types";
import { createFlowState } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { createMockModelResolver, mockGenerator } from "@flow-state-dev/testing";
import { harnessManager, harnessSessionDoor, taskIssueSegment, type HarnessFeeds } from "@flow-state-dev/harness-manager";
import type { Task, TaskWorker } from "@flow-state-dev/orchestration/tasks";
import {
  STEER_TURN_ENTRY,
  WORKER_TASK_ENTRY,
  conversationLedgers,
  createWorkerInstallation,
  defineAgentWorkerFlow,
  defineCoordinatorFlow,
  filingConversationBoard,
  hireWorkforce,
  startOwedSteerTurn,
  steerTurnEntry,
  workerTaskEntry,
  workerConfigSchema,
  workerMessagesResources,
  type WorkerInstallation,
  type WorkerManifest
} from "@flow-state-dev/workforce";
import { seedRepo } from "../../../packages/harness-manager/test/fixtures.ts";
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

const ALICE = "u_steer_alice";
const ORG = "org_steer";
const CONTROL = process.env.GOAL_CONTROL ?? "";
const SCRATCH = process.env.GOAL_SCRATCH ?? goalTmpDir("steer-and-follow-up");

const PATCHES: Record<string, ModulePatch[]> = {
  // Rule 6 no longer reads the row's untaken steers: the gate settles over one.
  "drop-late-steer": [
    {
      module: "packages/orchestration/src/task-board/task-request.ts",
      from: String.raw`  if \(untakenSteers\(stored\)\.length > 0\) \{`,
      to: "  if (false) {"
    },
    {
      module: "packages/orchestration/src/task-board/task-request.ts",
      from: String.raw`  const fenceSteers = !noProgress && !rechecked && record\.rules\.steerTurn !== undefined && ref\.setKeptOpenBy !== undefined;`,
      to: "  const fenceSteers = false; void rechecked;"
    }
  ],
  // As before FIX-2086: a message on a finished task is taken, and the task
  // goes back in the queue, where its next attempt replaces its output.
  reopen: [
    {
      module: "packages/orchestration/src/skills/task-tools-capability.ts",
      from: String.raw`if \(isTerminalStatus\(current\.status\)\) return lockedError\(current, \["message"\]\);`,
      to: "void 0;"
    },
    {
      module: "packages/orchestration/src/skills/task-tools-capability.ts",
      from: String.raw`\.\.\.\(message !== undefined \? \(\["message"\] as const\) : \[\]\),`,
      to: ""
    },
    {
      module: "packages/orchestration/src/tasks/steers.ts",
      from: String.raw`(\.\.\.\(task\.status === "in_progress" && task\.keptOpenBy === "filed" \?)`,
      to: '...(task.status === "completed" ? { status: "pending", attempts: 0 } : {}), $1'
    },
    {
      module: "packages/orchestration/src/tasks/collection/resource-backed.ts",
      from: String.raw`(const decided = steerWrite\(task(?: as Task)?, input, steerId, at\);[\s\S]{0,600}?)\{ declineOnTerminal: true \}`,
      to: "$1{ declineOnTerminal: false }"
    }
  ]
};

if (CONTROL !== "" && PATCHES[CONTROL] === undefined) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(PATCHES).join(", ")}`);
  process.exit(2);
}
// A patched control runs this same file again with the patch applied as it loads.
if (PATCHES[CONTROL] !== undefined && process.env.GOAL_MODULE_PATCH === undefined) {
  mkdirSync(SCRATCH, { recursive: true });
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const show = (value: unknown) => JSON.stringify(value);

/** Wait for `promise`, failing loudly instead of hanging. */
async function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`timed out waiting for ${what}`)), ms)));
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// ---- the scripted step model ---------------------------------------------------------

/** One model call, as the model received it. */
type Call = { at: number; tag: string | undefined; step: number; sent: string };
const calls: Call[] = [];

/** One step of a turn: hold on a gate first, then make a tool call or answer. */
type Step = { hold?: string; call?: { toolName: string; args: unknown }; text?: string };

/** What a turn does, by the tag its own message carries. Only the first turn carrying a tag acts on it. */
const SCRIPT: Record<string, Step[]> = {
  a2: [{ hold: "a2", call: { toolName: "reportProgress", args: { statusNote: "halfway" } } }, { text: "a2 answer" }],
  a4: [{ call: { toolName: "createTask", args: { goal: "#a4p# check the dates", assignee: "helper" } } }, { text: "a4 filed the piece" }],
  a4p: [{ hold: "a4p", text: "a4p piece done" }],
  b1: [{ hold: "b1", text: "b1 answer" }],
  b2: [{ call: { toolName: "reportProgress", args: { statusNote: "draft", output: "b2-first" } } }, { hold: "b2", text: "b2 answer" }],
  b2s: [{ call: { toolName: "reportProgress", args: { statusNote: "redone", output: "b2-second" } } }, { text: "b2 steer answer" }],
  b3: [{ call: { toolName: "reportProgress", args: { statusNote: "draft", output: "b3-first" } } }, { hold: "b3", text: "b3 answer" }],
  d1: [{ text: "d1 original answer" }],
  d2: [{ text: "d2 corrected answer" }],
  d3: [{ text: "d3 the launch post" }],
  d4: [{ text: "d4 the shorter post" }],
  e2: [{ text: "e2 found licence KESTREL-41" }]
};

/** Gates a scripted step holds on: reached when the step holds, released by the leg. */
const gates = new Map<string, { reached: Promise<void>; reach: () => void; released: Promise<void>; release: () => void }>();
function gate(name: string) {
  let found = gates.get(name);
  if (found === undefined) {
    let reach!: () => void;
    let release!: () => void;
    const reached = new Promise<void>((resolve) => (reach = resolve));
    const released = new Promise<void>((resolve) => (release = resolve));
    found = { reached, reach, released, release };
    gates.set(name, found);
  }
  return found;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => (typeof part === "string" ? part : String((part as { text?: unknown }).text ?? ""))).join("");
  return "";
}

/** The step model: what each call does is read off the call's own messages. */
const stepModel: GeneratorModel = {
  modelId: "steer-goal-step-model",
  async generate() {
    throw new Error("driven step by step");
  },
  async generateStep(options) {
    const messages = (options.messages ?? []) as Array<{ role: string; content?: unknown }>;
    let lastUser = -1;
    for (let i = messages.length - 1; i >= 0; i -= 1) if (messages[i]!.role === "user") { lastUser = i; break; }
    const own = lastUser === -1 ? "" : textOf(messages[lastUser]!.content);
    const step = messages.slice(lastUser + 1).filter((m) => m.role === "tool").length;
    const tag = /#([a-z0-9]+)#/i.exec(own)?.[1]?.toLowerCase();
    calls.push({ at: Date.now(), tag, step, sent: JSON.stringify(options) });
    // A talk turn answers from the session's history: what the worker last said.
    if (tag === "e2t") {
      const said = messages.slice(0, lastUser).filter((m) => m.role === "assistant").map((m) => textOf(m.content)).filter((t) => t.length > 0);
      return { text: `Earlier I said: ${said.at(-1) ?? "nothing"}`, finishReason: "stop" };
    }
    const first = calls.filter((c) => c.tag === tag && c.step === 0).length === 1;
    const scripted = tag !== undefined && first ? SCRIPT[tag]?.[step] : undefined;
    if (scripted === undefined) return { text: `done ${tag ?? ""}`.trim(), finishReason: "stop" };
    if (scripted.hold !== undefined) {
      const g = gate(scripted.hold);
      g.reach();
      await g.released;
    }
    if (scripted.call !== undefined) {
      return { toolCalls: [{ toolCallId: `call-${calls.length}`, ...scripted.call }], finishReason: "tool-calls" };
    }
    return { text: scripted.text ?? "", finishReason: "stop" };
  }
} as GeneratorModel;

function modelResolver() {
  const base = createMockModelResolver({
    generators: { "coordinator-judgment": mockGenerator({ name: "steer-goal-judgment", script: [{ when: () => true, then: { text: "Noted." } }] }) },
    policy: "default",
    unmockedDefault: { text: "ok" }
  });
  const resolver = ((modelId: string, blockName?: string) =>
    blockName?.startsWith("agent-answer") === true ? stepModel : (base as any)(modelId, blockName)) as ReturnType<typeof createMockModelResolver>;
  return Object.assign(resolver, base);
}

// ---- the fake coding harness ---------------------------------------------------------

/** One harness step, as the harness was handed it. */
type HarnessStep = { prompt: string; resume: string | null; session: string; request: string; stopped: boolean };
const harnessSteps: HarnessStep[] = [];
const coderStarted = gate("coder-started");

/** Names a session, resumes by id; its first step works until its signal fires. */
function fakeHarness(feeds: HarnessFeeds): HarnessBlock {
  return handler({
    name: "steer-goal-fake-harness",
    inputSchema: harnessRunInputSchema,
    outputSchema: harnessRunHandleSchema,
    execute: async (input, ctx) => {
      const resume = await feeds.resume(ctx as never);
      const session = resume ?? `sess_fake_${harnessSteps.length + 1}`;
      const seen: HarnessStep = {
        prompt: input.prompt,
        resume,
        session,
        request: (ctx as { request: { identity: { id: string } } }).request.identity.id,
        stopped: false
      };
      harnessSteps.push(seen);
      await feeds.onSession(session, ctx as never);
      if (harnessSteps.length === 1) {
        coderStarted.reach();
        const signal = (ctx as { signal: AbortSignal }).signal;
        await new Promise<void>((resolve) => {
          if (signal.aborted) return resolve();
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
        seen.stopped = true;
        throw new DOMException("Aborted", "AbortError");
      }
      return {
        source: "fake/goal",
        status: "completed" as const,
        sessionId: session,
        url: null,
        dispatchedAt: Date.now(),
        outcome: "finished" as const,
        finalMessage: `coded, with ${input.prompt.includes("steer-c") ? "the steer" : "no steer"}`,
        usage: null,
        cost: null
      };
    }
  }) as unknown as HarnessBlock;
}

/** The goal-local coding worker flow, composed as a host composes one. */
function defineCoderFlow(installation: WorkerInstallation, repo: string, checkouts: string) {
  const manager = harnessManager({
    ledgers: conversationLedgers,
    tenant: undefined,
    phase: { phase: "answer", buildPrompt: async (run: { issue: string }) => `Work on task ${run.issue}.`, isDone: () => true },
    workspace: { root: checkouts, sourceRepo: repo, baseRef: "main", provisionTimeoutMs: 20_000 },
    runTimeoutMs: 60_000,
    stopsOnAbort: true,
    harness: fakeHarness
  } as never) as TaskWorker;
  const runOf = (row: Task) => ({ issue: taskIssueSegment(row.id), phase: "answer" });
  const message = harnessSessionDoor({
    name: "steer-goal-coder",
    harness: fakeHarness,
    board: async (ctx) => {
      const filed = await filingConversationBoard(ctx);
      return filed === undefined ? undefined : { tasks: filed.tasks, runOf };
    },
    onSteered: (ctx, row) => startOwedSteerTurn(ctx, row)
  });
  return defineFlow({
    kind: "coder",
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { ...installation.resources, ...workerMessagesResources },
    actions: { respond: message },
    internal: {
      actions: {
        [STEER_TURN_ENTRY]: steerTurnEntry({ name: "steer-goal-coder-steer-turn", block: manager as never }),
        ...hearsMessages(installation, "coder")
      }
    },
    task: { actions: { [WORKER_TASK_ENTRY]: workerTaskEntry({ name: "steer-goal-coder-work", block: manager as never }) } }
  } as never);
}

// ---- the host ------------------------------------------------------------------------

const worker = (id: string, declared: Record<string, unknown>): WorkerManifest => ({ id, declared, body: "", skills: [] });
const WORKERS: WorkerManifest[] = [
  worker("desk", { flow: "coordinator", delegates: ["writer", "helper", "coder"], description: "Alice's desk." }),
  worker("writer", { flow: "agent", delegates: ["helper"], description: "Writes, and hands pieces on." }),
  worker("helper", { flow: "agent", description: "Does pieces." }),
  worker("coder", { flow: "coder", description: "Codes." })
];

function buildHost(filename: string, repo: string, checkouts: string) {
  let flows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({ standardWorkers: WORKERS, workerFlows: () => flows as never });
  const agent = defineAgentWorkerFlow({ installation });
  const coder = defineCoderFlow(installation, repo, checkouts);
  const coordinator = defineCoordinatorFlow({ installation, routeModel: "typesafe-ai/jev" });
  flows = { agent, coordinator, coder: { flow: coder, roles: ["contributor"] } };
  const instances = Object.fromEntries(hireWorkforce(installation).map((copy) => [copy.id, copy]));
  const state = createFlowState({
    flows: instances,
    stores: { default: { primary: sqliteStores({ filename }) } },
    logger: silentLogger,
    modelResolver: modelResolver(),
    resolvePrincipal: (context: any) => {
      const user = context.request?.headers.get("x-user");
      return typeof user === "string" ? { userId: user, orgId: ORG } : null;
    }
  } as never);
  return { state };
}

// ---- the legs ------------------------------------------------------------------------

await runGoal(async (failures) => {
  mkdirSync(SCRATCH, { recursive: true });
  const repo = join(SCRATCH, `repo-${RUN_STAMP}`);
  mkdirSync(repo, { recursive: true });
  seedRepo(repo);
  const dbFile = join(SCRATCH, `steer-${RUN_STAMP}.sqlite`);
  const { state } = buildHost(dbFile, repo, join(SCRATCH, `checkouts-${RUN_STAMP}`));
  const notes: string[] = [];
  const leg = async (name: string, body: () => Promise<void>) => {
    try {
      await body();
    } catch (error) {
      failures.push(`${name}:threw — ${error instanceof Error ? error.message : String(error)}`);
      // A leg that threw leaves no worker holding, so the next leg starts on a quiet host.
      for (const g of gates.values()) g.release();
    }
  };
  try {
    const runtime = await state.getRuntime();
    const alice = actingAs((await state.getRouter()) as never, ALICE);
    const idle = () => untilIdle(runtime.stores as never);
    const until = async (check: () => Promise<boolean>, ms: number, what: string) => {
      for (const deadline = Date.now() + ms; Date.now() < deadline; await sleep(50)) if (await check()) return;
      if (!(await check())) throw new Error(`timed out waiting for ${what}`);
    };

    const desk = await alice.open("coordinator", { workerId: "desk" });
    const deskAct = (action: string, input: unknown) => alice.act("coordinator", desk, action, input);
    /** A row on the desk's board, through the public read action. */
    const get = async (id: string) => ((await deskAct("getTask_tasks", { id })) as { task?: Record<string, any> }).task;
    const dispatch = async (input: Record<string, unknown>) => {
      const out = await deskAct("createTask_tasks", input);
      if (out?.ok !== true) throw new Error(`dispatching ${show(input)} was refused: ${show(out)}`);
      return out.taskId as string;
    };
    const steer = async (id: string, message: string) => {
      const out = await deskAct("updateTask_tasks", { id, message });
      if (out?.ok !== true) throw new Error(`steering ${id} was refused: ${show(out)}`);
    };
    const finished = (id: string) => until(async () => ["completed", "errored", "cancelled"].includes((await get(id))?.status), 60_000, `${id} to finish`);
    /** The desk's settle notices for a task: one per ending heard. */
    const settles = async (id: string) =>
      (await runtime.stores.request.list({ sessionId: desk } as never)).filter(
        (r: any) => r.actionName === "onTaskSettled" && JSON.stringify(r).includes(id)
      ) as Array<{ createdAt?: number; startedAt?: number }>;
    /** Status, attempts and ending: what a steer must leave as it was. */
    const standing = (row: Record<string, any> | undefined) => show({ status: row?.status, attempts: row?.attempts, completedAt: row?.completedAt });
    const callsWith = (words: string) => calls.filter((c) => c.sent.includes(words));
    /** A steer must change nothing about where the task stands, and it completes on attempt 1. */
    const checkSteer = async (legName: string, what: string, id: string, before: Record<string, any> | undefined) => {
      const after = await get(id);
      if (standing(after) !== standing(before)) failures.push(`${legName}:${what} — the steer changed where the task stands: ${standing(before)} → ${standing(after)}`);
    };
    const completesOnce = async (legName: string, what: string, id: string) => {
      await finished(id);
      await idle();
      const row = await get(id);
      const heard = (await settles(id)).length;
      if (row?.status !== "completed" || row?.attempts !== 1 || heard !== 1) {
        failures.push(`${legName}:${what} completes once, on attempt 1 — ${show({ status: row?.status, attempts: row?.attempts, settles: heard, error: row?.error })}`);
      }
      return row;
    };

    // ---- leg a: a steer to an open task -------------------------------------------------
    await leg("a", async () => {
      // Before start: filed held, steered, released.
      const a1Words = `a1 steer: use British spelling ${RUN_STAMP}`;
      const held = await deskAct("createTask_tasks", { goal: `#a1# write the intro`, assignee: "writer", held: true });
      if (held?.ok !== true) throw new Error(`filing a1 held was refused: ${show(held)}`);
      const a1 = held.taskId as string;
      const a1Before = await get(a1);
      await steer(a1, a1Words);
      await checkSteer("a", "before start", a1, a1Before);
      const released = await deskAct("updateTask_tasks", { id: a1, status: "pending" });
      if (released?.ok !== true) throw new Error(`releasing a1 was refused: ${show(released)}`);
      await completesOnce("a", "before start", a1);
      const a1First = calls.find((c) => c.tag === "a1");
      if (a1First?.sent.includes(a1Words) !== true) failures.push(`a:a steer before start is in the first model call's brief — first a1 call ${a1First === undefined ? "never ran" : "lacks it"}`);

      // To a running request: its first model call holds while the steer lands.
      const a2Words = `a2 steer: cite the changelog ${RUN_STAMP}`;
      const a2 = await dispatch({ goal: "#a2# write the summary", assignee: "writer" });
      await within(gate("a2").reached, 30_000, "a2's first model call");
      const a2Before = await get(a2);
      await steer(a2, a2Words);
      await checkSteer("a", "running", a2, a2Before);
      gate("a2").release();
      await completesOnce("a", "running", a2);
      const a2Calls = calls.filter((c) => c.tag === "a2");
      if (a2Calls.length < 2 || a2Calls[0]!.sent.includes(a2Words) || !a2Calls[1]!.sent.includes(a2Words)) {
        failures.push(`a:a steer to a running request is in its next model call, not the one before — ${show(a2Calls.map((c) => c.sent.includes(a2Words)))}`);
      }

      // To a task waiting on the task it filed: a turn starts with the steer while the piece is open.
      const a4Words = `a4 steer: the dates are in UTC ${RUN_STAMP}`;
      const a4 = await dispatch({ goal: "#a4# check the release", assignee: "writer" });
      await within(gate("a4p").reached, 30_000, "the filed piece to start");
      // Its filing turn has ended: the task is open, and no request runs in its session.
      const a4Session = (await get(a4))?.run?.sessionId as string;
      await until(
        async () =>
          calls.some((c) => c.tag === "a4" && c.step === 1) &&
          (await runtime.stores.request.list({ sessionId: a4Session, status: "in_progress" } as never)).length === 0,
        30_000,
        "a4's filing turn to end"
      );
      const a4Before = await get(a4);
      await steer(a4, a4Words);
      await checkSteer("a", "waiting on its filed task", a4, a4Before);
      try {
        await until(async () => callsWith(a4Words).length > 0, 15_000, "a turn with a4's steer");
      } catch {
        failures.push(`a:a steer to a task waiting on its filed task starts a turn while the piece is open — no model call carried it`);
      }
      // The piece is still open: its worker holds until released below.
      const pieces = ((await alice.act("agent", a4Session, "listTasks_tasks", {})) as { tasks?: Array<Record<string, any>> }).tasks ?? [];
      const pieceOpen = pieces.length > 0 && pieces.every((p) => p.status === "in_progress");
      if (!pieceOpen) failures.push(`a:the steer turn runs while the filed piece is open — the pieces read ${show(pieces.map((p) => p.status))}`);
      gate("a4p").release();
      await completesOnce("a", "waiting on its filed task", a4);
      notes.push(`a: a1 brief carried the steer; a2 calls ${calls.filter((c) => c.tag === "a2").length}; a4 steer turn ran with the piece open ${pieceOpen}`);
    });

    // ---- leg b, and e (open): a steer after the last model call -----------------------
    await leg("b", async () => {
      // b1: the steer is a line Alice types in the task's session.
      const b1Words = `b1 steer: mention the new flag ${RUN_STAMP}`;
      const b1 = await dispatch({ goal: "#b1# write the release note", assignee: "writer" });
      await within(gate("b1").reached, 30_000, "b1's last model call");
      const b1Before = await get(b1);
      const before = calls.length;
      const line = await alice.act("agent", b1Before!.run.sessionId, "respond", { message: b1Words });
      if (line?.steered !== b1 || calls.length !== before) {
        failures.push(`e:a line in an open task's session is a steer, and no reply runs beside it — answered ${show(line)}, ${calls.length - before} model call(s) beside it`);
      }
      await checkSteer("b", "a line in its session", b1, b1Before);
      gate("b1").release();
      const row = await completesOnce("b", "a steer after the last model call", b1);
      const turn = callsWith(b1Words).find((c) => c.tag !== "b1" || c.step > 0) ?? callsWith(b1Words)[0];
      const settled = (await settles(b1))[0];
      const settledAt = settled?.createdAt ?? settled?.startedAt ?? 0;
      if (turn === undefined || settledAt === 0 || turn.at > settledAt) {
        failures.push(`b:one more turn before the settle — a model call with the steer ${turn === undefined ? "never ran" : `ran at ${turn.at}`}, the settle at ${settledAt}; output ${show(row?.output)}`);
      }

      // b2: checkpointed before the steer; the steer turn checkpoints again, and that is the output.
      const b2 = await dispatch({ goal: "#b2# draft the FAQ", assignee: "writer" });
      await within(gate("b2").reached, 30_000, "b2's last model call");
      await steer(b2, `#b2s# redo it with the new pricing ${RUN_STAMP}`);
      gate("b2").release();
      const b2Row = await completesOnce("b", "checkpointed, and the steer turn checkpoints", b2);
      if (b2Row?.output !== "b2-second") failures.push(`b:where the steer turn checkpoints, its checkpoint is the output — read ${show(b2Row?.output)}`);

      // b3: checkpointed before the steer; the steer turn reports none, so the earlier one stands.
      const b3 = await dispatch({ goal: "#b3# draft the guide", assignee: "writer" });
      await within(gate("b3").reached, 30_000, "b3's last model call");
      await steer(b3, `#b3s# also note the limits ${RUN_STAMP}`);
      gate("b3").release();
      const b3Row = await completesOnce("b", "checkpointed, and the steer turn doesn't", b3);
      if (b3Row?.output !== "b3-first") failures.push(`b:where the steer turn doesn't checkpoint, the earlier one stands — read ${show(b3Row?.output)}`);
      notes.push(`b: b1 steer turn before its settle; outputs ${show({ b1: row?.output, b2: b2Row?.output, b3: b3Row?.output })}`);
    });

    // ---- leg c: a steer to a coding run ----------------------------------------------------
    await leg("c", async () => {
      const cWords = `steer-c: also run the linter ${RUN_STAMP}`;
      const c = await dispatch({ goal: "#c# fix the failing test", assignee: "coder" });
      await within(coderStarted.reached, 60_000, "the coding run's first step");
      const cBefore = await get(c);
      await steer(c, cWords);
      await checkSteer("c", "a steer to a coding run", c, cBefore);
      const row = await completesOnce("c", "a steered coding run", c);
      const [first, next] = harnessSteps;
      if (first?.stopped !== true) failures.push(`c:the running harness step ends — it ${first === undefined ? "never ran" : "was not stopped"}`);
      if (next === undefined || !next.prompt.includes(cWords) || next.resume !== first?.session || next.request !== first?.request || first?.prompt.includes(cWords)) {
        failures.push(`c:the next run resumes the same coding session with the message, in the same request — ${show(harnessSteps.map((s) => ({ resume: s.resume, session: s.session, request: s.request, carries: s.prompt.includes(cWords) })))}`);
      }
      notes.push(`c: ${harnessSteps.length} harness steps, first stopped ${first?.stopped}, next resumed ${next?.resume}; output ${show(row?.output)}`);
    });

    // ---- leg d: a finished task, corrected by a follow-up ---------------------------------
    await leg("d", async () => {
      const d1 = await dispatch({ goal: "#d1# summarise the incident", assignee: "writer" });
      await completesOnce("d", "the original", d1);
      const original = await get(d1);
      const refused = await deskAct("updateTask_tasks", { id: d1, message: "also add the timeline" });
      if (refused?.ok !== false || !String(refused?.error).includes("a finished task takes no message")) {
        failures.push(`d:a message on a finished task is refused naming the rule — answered ${show(refused)}`);
      }
      // Under the reopen control the message re-queued the task: give a re-run its time.
      await sleep(1500);
      await idle();
      const afterMessage = await get(d1);
      if (show(afterMessage?.output) !== show(original?.output) || afterMessage?.status !== "completed") {
        failures.push(`d:the original's output reads byte-identical — after the message, ${show(original?.output)} → ${show(afterMessage?.output)} (${afterMessage?.status})`);
      }
      const followUp = await dispatch({ goal: "#d2# correct the summary: the outage was 14 minutes", followUpOf: d1 });
      await finished(followUp);
      await idle();
      const f = await get(followUp);
      const after = await get(d1);
      if (f?.status !== "completed" || f?.run?.sessionId !== original?.run?.sessionId) {
        failures.push(`d:a follow-up runs in its session — ${show({ status: f?.status, session: f?.run?.sessionId, original: original?.run?.sessionId })}`);
      }
      if (show(after?.output) !== show(original?.output) || after?.status !== "completed") {
        failures.push(`d:the original's output reads byte-identical — ${show(original?.output)} → ${show(after?.output)} (${after?.status})`);
      }
      const view = await get(d1);
      if (view?.current?.id !== followUp || show(view?.current?.output) !== show(f?.output)) {
        failures.push(`d:getTask shows the follow-up's output as current — read ${show(view?.current)}`);
      }
      // A routed task ran in the delegate's ongoing session, not one of its own:
      // its follow-up runs there too (FIX-2111).
      const d3 = await dispatch({ goal: "#d3# draft the launch post", assignee: "writer", session: "ongoing", resultTo: "conversation" });
      await finished(d3);
      await idle();
      const routed = await get(d3);
      const d4 = await dispatch({ goal: "#d4# a version half as long", followUpOf: d3 });
      await finished(d4);
      await idle();
      const g = await get(d4);
      if (g?.status !== "completed" || routed?.run?.sessionId === undefined || g?.run?.sessionId !== routed.run.sessionId) {
        failures.push(`d:a follow-up of a routed task runs in the session it ran in — ${show({ status: g?.status, session: g?.run?.sessionId, routed: routed?.run?.sessionId })}`);
      }
      notes.push(`d: refused "${String(refused?.error).slice(0, 60)}…"; current ${show(view?.current)}; routed follow-up in ${g?.run?.sessionId === routed?.run?.sessionId ? "its" : "another"} session`);
    });

    // ---- leg e (finished): talk in a finished task's session --------------------------------
    await leg("e", async () => {
      const e2 = await dispatch({ goal: "#e2# audit the licences", assignee: "writer" });
      await completesOnce("e", "the audited task", e2);
      const before = show(await get(e2));
      const session = (await get(e2))!.run.sessionId as string;
      const reply = await alice.act("agent", session, "respond", { message: "#e2t# which licence was it?" });
      await idle();
      if (!show(reply).includes("KESTREL-41") || show(reply).includes("steered")) {
        failures.push(`e:in a finished task's session, a reply that names what the task did — answered ${show(reply)}`);
      }
      if (show(await get(e2)) !== before) failures.push(`e:the row is unchanged by talk — ${before} → ${show(await get(e2))}`);
      notes.push(`e: talk answered ${show(reply).slice(0, 80)}`);
    });

    return { failures, evidence: notes.join(" | ") };
  } finally {
    for (const g of gates.values()) g.release();
    // Every model call as it was sent, for a reader chasing a failure.
    writeFileSync(join(SCRATCH, `calls-${RUN_STAMP}.ndjson`), calls.map((c) => JSON.stringify(c)).join("\n"));
    await state.dispose();
  }
});
