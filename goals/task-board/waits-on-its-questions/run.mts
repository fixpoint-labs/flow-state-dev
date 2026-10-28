/**
 * Goal check: a task can be held on questions, before it starts or midway
 * (FIX-2133). The user sees them as one Inbox item; each answer joins the
 * brief; the last answer, or a deadline the host set passing without one,
 * lets the work go on: a task not yet started starts its first attempt, a
 * midway one takes one more turn on the same attempt. Nothing else releases
 * it, no two turns run at once, and a cancel closes it.
 *
 * **Model-free.** A real `createFlowState` host on a durable SQLite store, the
 * Workforce session board on two flows (`desk`, the conversation that files,
 * and `doer`, whose task sessions work), deterministic scripted turns that
 * call the real verbs (`askMidway`, `reportProgress`, `waitForUser`), driven
 * as a verified caller. The Inbox is Shift Manager's own snapshot
 * (`createLabReader().read()`), every answer goes through orchestration's
 * Inbox client (`createInboxClient`), the way the Inbox answers, and the task
 * is read through the board's `getTask` and `listTasks` actions. Each leg ends
 * with `reconcileInbox` against reads made apart from the list (the board's
 * `listTasks`, the task sessions' suspended requests). The turn counter is a
 * proof each scripted turn appends from inside its own run.
 *
 * Legs (each failure is tagged `<leg>:<assertion>`):
 *   a      filed on two questions (t1, with t2 depending on it): one item, nothing starts it
 *   b      one answered: one question left, still not started
 *   c      the second answered: t1 runs once, attempt 1, its brief holding both answers; t2 after it
 *   d      asked midway (t4): no lease, not renewed or reclaimed; the answer owes one more turn on
 *          attempt 1, and the asking turn's late write after that turn's claim is refused
 *   dnowake leg d with the turn's own start in its session skipped: the board's claim takes it
 *   e      the rules: retries and competing answers, a cancel, no deadline (t6), another user,
 *          tenant or org, a task run's stop as a hold (t9), a confirm's yes (t10) and No (t12), one wait per turn
 *          (t11), and a line typed in a held session (t8)
 *   edue   a deadline the host set (t5): past due and a touch later, "no answer came", and t5 starts
 *   f      the host's setting for a person's stop: a held question reads it (FIX-2129 leg f's half)
 *
 * Controls (scratch patches applied as the code under test loads, printed by the run):
 *   release-on-first, answer-off-brief, wake-only, no-turn-fence, default-deadline,
 *   duplicate-item, drop-row-holds, mirror-skips-close. Each must FAIL what goal.md names.
 *
 * Run: pnpm tsx goals/task-board/waits-on-its-questions/run.mts
 * Legs: GOAL_LEGS=a,b,c,d,dnowake,e,edue,f (default: all; a, b, c run in order)
 */
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { z } from "zod";
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { createClient, type Client, type ClientFetch } from "@flow-state-dev/client";
import { createFlowState, createInProcessFetch, runAction } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { askMidway, currentWorkerClaim } from "@flow-state-dev/orchestration/task-board";
import { openQuestions, type Task } from "@flow-state-dev/orchestration/tasks";
import { createInboxClient, type InboxItem } from "@flow-state-dev/orchestration/inbox";
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

const USER = "u_holds_questions";
const ORG = "org_holds_questions";
const CONTROL = process.env.GOAL_CONTROL ?? "";
const SCRATCH = process.env.GOAL_SCRATCH ?? goalTmpDir("waits-on-its-questions");
const PROOFS = join(SCRATCH, "proofs.ndjson");
/** The lease a claim commits to, shortened so "past the lease" is seconds, not minutes. */
const LEASE_MS = 3_000;
/** The host's deadline for a person's stop on leg edue's host: short, so it falls due here. */
const DUE_MS = 1_500;
/** The host's deadline on leg f's host: distinctive, and far enough off never to fire. */
const HOST_DEADLINE_MS = 7_777_000;
const INVENTORY_WRITER_FLOW = "inventory-writer";
const ALL_LEGS = ["a", "b", "c", "d", "dnowake", "e", "edue", "f"] as const;

/** The two questions t1 is filed on. Any two prompts pass the same way. */
const CSV = "Which CSV export should the script read?";
const COLUMN = "Which date column?";

// ---- patches ------------------------------------------------------------------

/**
 * Applied on every run: the lease shortened (faking time), and two hooks the
 * run sets only where a leg needs them, each a no-op otherwise.
 */
const TIMING: ModulePatch[] = [
  {
    module: "packages/orchestration/src/tasks/collection/internal.ts",
    from: String.raw`DEFAULT_LEASE_DURATION_MS = (?:120_000|12e4|120000)`,
    to: `DEFAULT_LEASE_DURATION_MS = ${LEASE_MS}`
  },
  {
    // Leg dnowake: the owed turn's own start in its session (the wake, and its fast path) skipped.
    module: "packages/workforce/src/conversation-board/board.ts",
    from: String.raw`if \(after\?\.turnOwed === true && after\.assignee !== undefined\) \{`,
    to: "if (after?.turnOwed === true && after.assignee !== undefined && (globalThis as any).__goalNoTurnStart !== true) {"
  }
];

const CONTROLS: Record<string, { patches: ModulePatch[]; legs: string[] }> = {
  // The first answer lets the work go on.
  "release-on-first": {
    patches: [
      {
        module: "packages/orchestration/src/tasks/collection/internal.ts",
        from: String.raw`  if \(hasOpenQuestion\(task\)\) return false;\n  if \(task\.status !== "pending"`,
        to: '  if (openRowQuestions(task).length > 1) return false;\n  if (task.status !== "pending"'
      }
    ],
    legs: ["a", "b"]
  },
  // The answers reach the worker as row fields only, never in its brief.
  "answer-off-brief": {
    patches: [
      {
        module: "packages/orchestration/src/task-board/blocks/worker-step.ts",
        from: String.raw`\? \{ steers: task\.steers\.map\(\(steer\) => shownSteer\(task, steer\)\) \}`,
        to: "? { steers: task.steers.filter((steer) => steer.answers === undefined).map((steer) => shownSteer(task, steer)) }"
      }
    ],
    legs: ["a", "b", "c"]
  },
  // The claim ignores the owed mark: only the turn's own start in its session takes it.
  "wake-only": {
    patches: [
      {
        module: "packages/orchestration/src/tasks/collection/internal.ts",
        from: String.raw`!leaseLapsed\(task, now\) && !owesTurn\(task\)\) return false;`,
        to: "!leaseLapsed(task, now)) return false;"
      }
    ],
    legs: ["d", "dnowake"]
  },
  // Claim tickets fenced by row, status and attempt only.
  "no-turn-fence": {
    patches: [
      {
        module: "packages/orchestration/src/tasks/collection/internal.ts",
        from: String.raw`  if \(claim !== undefined && claim\.turn !== \(task\.turn \?\? 0\)\) return "lost-claim";`,
        to: ""
      }
    ],
    legs: ["d"]
  },
  // A question with no deadline gets one anyway.
  "default-deadline": {
    patches: [
      {
        module: "packages/orchestration/src/tasks/collection/get-or-create.ts",
        from: String.raw`const questionDueMs = ctx\.requestHost\?\.userDeadlineMs;`,
        to: "const questionDueMs = ctx.requestHost?.userDeadlineMs ?? 1500;"
      }
    ],
    legs: ["e"]
  },
  // The Inbox read lists a task's item twice.
  "duplicate-item": {
    patches: [
      {
        module: "packages/orchestration/src/inbox/list.ts",
        from: String.raw`return \[\.\.\.items, \.\.\.lone\]\.sort`,
        to: "return [...items, ...items.slice(0, 1), ...lone].sort"
      }
    ],
    legs: ["a"]
  },
  // The Inbox read drops the row holds.
  "drop-row-holds": {
    patches: [
      {
        module: "packages/orchestration/src/inbox/questions.ts",
        from: String.raw`    if \(hold\.source\.kind === "row"\) \{\n      const holder`,
        to: '    if (hold.source.kind === "row") {\n      continue;\n      const holder'
      }
    ],
    legs: ["a"]
  },
  // The resume of a task run's stop leaves its mirror open.
  "mirror-skips-close": {
    patches: [
      {
        module: "packages/orchestration/src/tasks/collection/internal.ts",
        from: String.raw`const resumed = options\.resume === true \? questionWrite\(task, \{ op: "resume" \}\) : "unchanged";`,
        to: 'const resumed = "unchanged" as const;'
      }
    ],
    legs: ["e"]
  }
};

if (CONTROL !== "" && CONTROLS[CONTROL] === undefined) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(CONTROLS).join(", ")}`);
  process.exit(2);
}
const PATCHES = [...TIMING, ...(CONTROLS[CONTROL]?.patches ?? [])];

// Every run re-runs this file with its patches applied as it loads.
if (process.env.GOAL_MODULE_PATCH === undefined) {
  const mark = join(SCRATCH, `patch-mark-${RUN_STAMP}`);
  rmSync(mark, { force: true });
  console.error(`${CONTROL === "" ? "timing patches" : `control ${CONTROL}`}:\n${describePatches(PATCHES, REPO_ROOT)}`);
  const child = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: {
      ...process.env,
      GOAL_SCRATCH: SCRATCH,
      GOAL_LEGS: process.env.GOAL_LEGS ?? (CONTROL === "" ? ALL_LEGS.join(",") : CONTROLS[CONTROL]!.legs.join(",")),
      ...modulePatchEnv(PATCHES, REPO_ROOT, mark)
    }
  });
  if (child.status !== 2) assertPatched(PATCHES, REPO_ROOT, mark);
  process.exit(child.status ?? 1);
}
const legs = new Set((process.env.GOAL_LEGS ?? ALL_LEGS.join(",")).split(",").map((s) => s.trim()).filter(Boolean));

// ---- proofs -------------------------------------------------------------------

type Proof = {
  kind: "turn" | "asked" | "late" | "resumed";
  taskId?: string;
  requestId: string;
  sessionId: string;
  /** The row's attempt and turn generation as the turn read them. */
  attempt?: number;
  turn?: number;
  /** What the turn was handed (its message). */
  message?: string;
  /** What a write or a wait came back with. */
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

// ---- the host -----------------------------------------------------------------

const worker = (id: string, declared: Record<string, unknown>): WorkerManifest => ({ id, declared, body: "", skills: [] });
const WORKERS: WorkerManifest[] = [worker("lead", { flow: "desk", delegates: ["eng.doer"] }), worker("eng.doer", { flow: "doer" })];

/**
 * Latches leg d sets: the asking turn waits on `__goalAfterAsk` before its late
 * write, and the turn after it on `__goalBeforeNext`, so the late write lands
 * between the next turn's claim and its end.
 */
const latch = globalThis as { __goalAfterAsk?: () => Promise<void>; __goalBeforeNext?: () => Promise<void> };

function buildHost(filename: string, settings: { userDeadlineMs?: number } = {}) {
  let workerFlows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({ standardWorkers: WORKERS, workerFlows: () => workerFlows as never });
  const doorInput = z.object({ message: z.string() });
  const deskBoard = defineSessionBoard({ installation, flowKind: "desk" });
  const doerBoard = defineSessionBoard({ installation, flowKind: "doer" });
  const deskTurn = handler({ name: "questions-desk-turn", inputSchema: doorInput, outputSchema: z.unknown(), execute: (input) => `noted: ${input.message}` });

  /**
   * The doer's scripted turn. Marks in the task's goal: `[ask:N]` asks N
   * questions midway, the first turn only (a turn handed an answer works);
   * `[late]` then waits on the run's latch and reports a checkpoint late;
   * `[approve]` waits for the user's approval (a task run's stop);
   * `[ask-then-approve]` asks, then waits for an approval in the same turn.
   */
  const doerTurn = handler({
    name: "questions-doer-turn",
    inputSchema: doorInput,
    outputSchema: z.unknown(),
    execute: async (input, rawCtx) => {
      const ctx = rawCtx as unknown as BlockContext;
      const message = input.message;
      const taskId = (ctx.session.state as Record<string, unknown> | undefined)?.[TASK_ID_STATE_KEY] as string | undefined;
      const base = { requestId: ctx.request.identity.id, sessionId: ctx.session.identity.id, ...(taskId !== undefined ? { taskId } : {}) };
      if (message.startsWith('Task "') || message.startsWith("Message ")) return "noted";
      const board = await filingConversationBoard(ctx);
      const row = taskId === undefined ? undefined : (board?.tasks.get(taskId) as Task | undefined);
      prove({ kind: "turn", ...base, attempt: row?.attempts, turn: row?.turn, message });
      const answered = /answering "/.test(message);
      if (answered && message.includes("[late]")) await latch.__goalBeforeNext?.();
      const asks = /\[ask:(\d)\]/.exec(message);
      if (asks !== null && !answered && board !== undefined) {
        const questions = Array.from({ length: Number(asks[1]) }, (_, i) => ({ prompt: i === 0 ? COLUMN : `Question ${i + 1} for ${taskId}?` }));
        prove({ kind: "asked", ...base, outcome: await askMidway(ctx, board.tasks, questions) });
        if (message.includes("[late]")) {
          await latch.__goalAfterAsk?.();
          const claim = currentWorkerClaim(ctx);
          const outcome = claim === undefined || taskId === undefined ? "no-claim" : await board.tasks.reportProgress!(taskId, { statusNote: "a late write from the asking turn" }, { claim });
          prove({ kind: "late", ...base, outcome });
        }
        return "asked";
      }
      if (message.includes("[ask-then-approve]") && !answered && board !== undefined) {
        prove({ kind: "asked", ...base, outcome: await askMidway(ctx, board.tasks, [{ prompt: COLUMN }]) });
        const outcome = await ctx.waitForUser({ kind: "approval", prompt: "Ship it now?" } as never);
        prove({ kind: "resumed", ...base, outcome });
        return "went on";
      }
      if (message.includes("[approve]")) {
        const outcome = await ctx.waitForUser({ kind: "approval", prompt: "Ship the release?" } as never);
        prove({ kind: "resumed", ...base, outcome });
        return `approved: ${JSON.stringify(outcome)}`;
      }
      return `done ${taskId}`;
    }
  });
  const doerWork = sequencer({ name: "questions-doer-work", inputSchema: doorInput }).step(doerTurn);

  const deskFlow = defineFlow({
    kind: "desk",
    configSchema: workerConfigSchema(),
    session: { ...installation.session(deskBoard.sessionStateShape), serverOwned: [...deskBoard.serverOwned] },
    // The org's worker inventory, for Shift Manager's read to find (as a Lab's worker flows declare it).
    resources: { ...installation.resources, ...deskBoard.resources, inventoryWorkers: defineWorkerInventoryCollection() },
    actions: { respond: { inputSchema: doorInput.strict(), block: deskTurn, userMessage: (i: { message: string }) => i.message }, ...deskBoard.actions },
    internal: { actions: deskBoard.entries(deskTurn, () => "fixed") },
    task: { actions: { work: workerTaskEntry({ name: "questions-desk-task", turn: deskTurn }) } }
  } as never);
  const doerFlow = defineFlow({
    kind: "doer",
    configSchema: workerConfigSchema(),
    session: { ...installation.session(doerBoard.sessionStateShape), serverOwned: [...doerBoard.serverOwned] },
    resources: { ...installation.resources, ...doerBoard.resources },
    // A line typed in a task's session steers it, through the one home for what a line answers.
    actions: { respond: { inputSchema: doorInput.strict(), block: steerOrTalk(doerWork), userMessage: (i: { message: string }) => i.message }, ...doerBoard.actions },
    internal: { actions: doerBoard.entries(doerWork, () => "judgment") },
    task: { actions: { work: { ...workerTaskEntry({ name: "questions-doer-task", turn: doerWork }), durable: true } } }
  } as never);
  workerFlows = { desk: { flow: deskFlow, roles: ["contributor", "manager"] }, doer: { flow: doerFlow, roles: ["contributor", "manager"] } };

  const flows: Record<string, any> = {
    ...Object.fromEntries(hireWorkforce(installation).map((copy) => [copy.id, copy])),
    // The worker write takes caller-supplied rows, so it is internal only.
    [INVENTORY_WRITER_FLOW]: defineFlow({ kind: INVENTORY_WRITER_FLOW, internal: { actions: { ...inventoryWriterActions() } } } as never)()
  };
  const state = createFlowState({
    flows,
    stores: { default: { primary: sqliteStores({ filename }) } },
    logger: silentLogger,
    durabilityRetention: { sweepIntervalMs: 2_000 },
    ...(settings.userDeadlineMs !== undefined ? { userDeadlineMs: settings.userDeadlineMs } : {}),
    resolvePrincipal: (context: any) => {
      const user = context.request?.headers.get("x-user");
      const org = context.request?.headers.get("x-org") ?? ORG;
      return typeof user === "string" ? { userId: user, orgId: org } : null;
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
    /** A client as another caller: another user, or the same user in another tenant or org. */
    const as = (who: { user?: string; tenant?: string; org?: string }): Client => {
      const inProcess = createInProcessFetch(router);
      const fetcher: ClientFetch = (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set("x-user", who.user ?? USER);
        if (who.org !== undefined) headers.set("x-org", who.org);
        if (who.tenant !== undefined) headers.set("x-tenant-id", who.tenant);
        return inProcess(input, { ...init, headers });
      };
      return createClient({ userId: who.user ?? USER, fetcher });
    };
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
    return { runtime, http, as, rows, byId, until, idle };
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
  /** The holds answered or cancelled so far: none may come back. */
  closed: string[];
}
const show = (value: unknown) => JSON.stringify(value);
const word = (text: string) => `${text} ${RUN_STAMP}`;

// ---- what a screen does ---------------------------------------------------------

/** File `goal` for eng.doer from the desk, with `extra` (its questions, deps). Its task id. */
async function file(run: Run, goal: string, extra: Record<string, unknown> = {}): Promise<string> {
  const filed = await run.h.http.act("desk", run.conversation, "createTask_tasks", { goal, assignee: "eng.doer", ...extra });
  if (filed?.ok !== true) throw new Error(`filing "${goal}" was refused: ${show(filed)}`);
  return filed.taskId as string;
}
/** The task as its public read shows it. */
async function getTask(run: Run, id: string): Promise<Record<string, any> | undefined> {
  const read = await run.h.http.act("desk", run.conversation, "getTask_tasks", { id });
  return read?.ok === true ? read.task : undefined;
}
/** A touch of the desk's board: an action on it, which runs the pass when anything is owed. */
const touch = async (run: Run) => {
  await run.h.http.act("desk", run.conversation, "listTasks_tasks", {});
  await run.h.idle();
};
/** The Inbox as Shift Manager reads it: its own snapshot's `inbox` section. */
async function inbox(run: Run): Promise<InboxItem<unknown>[]> {
  const snapshot = await createLabReader(run.h.http.client).read();
  if (!("inbox" in snapshot) || snapshot.inbox === undefined) throw new Error(`Shift Manager's read came back ${show(snapshot)}`);
  if (!snapshot.inbox.ok) throw new Error(`Shift Manager's Inbox didn't load: ${snapshot.inbox.failure.message}`);
  return snapshot.inbox.value;
}
const itemOf = async (run: Run, id: string) => (await inbox(run)).find((item) => item.task?.taskId === id);
/** Answer `hold` on `id`'s item as the Inbox does. What it said: `ok`, or the refusal's words. */
async function answer(run: Run, id: string, questionId: string, value: Parameters<ReturnType<typeof createInboxClient>["answer"]>[1]): Promise<string> {
  const item = await itemOf(run, id);
  if (item === undefined) return "no item";
  try {
    await createInboxClient(run.h.http.client).answer(item, value, questionId);
    return "ok";
  } catch (error) {
    return (error as Error).message;
  }
}
/** The answer as a screen sends it for a hold no longer listed (a retry, or one past a cancel). */
async function answerDirect(run: Run, id: string, questionId: string, message: string, client?: Client): Promise<{ status: string; output?: any }> {
  try {
    if (client === undefined) return { status: "ok", output: await run.h.http.act("desk", run.conversation, "updateTask_tasks", { id, answers: questionId, message }) };
    const sent = await client.flow("desk").send("updateTask_tasks", { id, answers: questionId, message }, { sessionId: run.conversation });
    await sent.wait({ pollMs: 10, timeoutMs: 10_000 });
    return { status: "sent" };
  } catch (error) {
    return { status: `refused: ${(error as Error).message.slice(0, 120)}` };
  }
}
const openIds = (row: Task | undefined) => (row === undefined ? [] : openQuestions(row).map((hold) => hold.id));

/** The Inbox's truth, read apart from the list: the board's `listTasks` rows, and every task session's suspended requests. */
async function truthOf(run: Run): Promise<InboxTruth> {
  const listed = (await run.h.http.act("desk", run.conversation, "listTasks_tasks", {}))?.tasks ?? [];
  const board = `${run.conversation}.tasks`;
  const rows = listed.map((t: any) => ({ board, id: t.id, status: t.status, questions: t.questions ?? [], steers: [] }));
  const sessions = new Set<string>(listed.flatMap((t: any) => (t.run?.sessionId === undefined ? [] : [t.run.sessionId])));
  const suspensions = [];
  for (const sessionId of sessions) {
    suspensions.push(...suspensionTruthOf(sessionId, await run.h.http.client.sessions.requests(sessionId, { status: "suspended", includeItems: true })));
  }
  return { rows: rowTruthOf(rows), suspensions, closed: run.closed };
}
/** Every leg ends here: the Inbox is the list it should be. */
async function reconciled(run: Run, leg: string): Promise<void> {
  const items = run.tell.over(`${leg} · the Inbox's items or the truth's rows`, [...(await inbox(run)), ...(await truthOf(run)).rows], { emptyIs: "a leg that holds nothing at its end" });
  const result = reconcileInbox(await inbox(run), await truthOf(run));
  if (!result.green) run.failures.push(`${leg}:reconciler — ${show({ ...result, green: undefined })}`);
  void items;
}

// ---- the legs ---------------------------------------------------------------------

/** a, b, c: filed on two questions, answered one at a time; the dependent after. */
async function legsABC(run: Run): Promise<void> {
  const t1 = await file(run, word("t1 Write the adoption script"), { questions: [CSV, COLUMN] });
  const t2 = await file(run, word("t2 Publish the adoption numbers"), { deps: [t1] });
  await touch(run);
  const filed = await run.h.byId(t1);
  const [csv, column] = openIds(filed);
  // a. One item for t1 with both prompts; nothing starts it.
  const item = await itemOf(run, t1);
  const read = await getTask(run, t1);
  if (item?.questions.length !== 2 || item.questions.map((hold) => hold.ask.prompt).join("|") !== `${CSV}|${COLUMN}`) {
    run.failures.push(`a:one-item — wanted one item for t1 with both prompts, oldest first; the Inbox shows ${show(item?.questions.map((h) => h.ask.prompt))}`);
  }
  const t1Items = (await inbox(run)).filter((i) => i.task?.taskId === t1).length;
  if (t1Items !== 1) run.failures.push(`a:one-item — wanted t1 listed once; it is listed ${t1Items} times`);
  if (read?.status !== "pending" || read.attempts !== 0 || (read.questions ?? []).length !== 2) {
    run.failures.push(`a:not-started — wanted getTask to show t1 pending on attempt 0 with two open holds; it shows ${show(read && { status: read.status, attempts: read.attempts, questions: read.questions?.length })}`);
  }
  // A drain, a claim on a dispatching board: touched twice more, past a lease.
  await sleep(LEASE_MS + 200);
  await touch(run);
  if (proofsOf(t1, "turn").length !== 0 || (await run.h.byId(t1))?.attempts !== 0) run.failures.push(`a:nothing-starts-it — t1 ran ${proofsOf(t1, "turn").length} turns`);
  await reconciled(run, "a");

  // b. One answered: one open question, the start counter still 0.
  const first = await answer(run, t1, csv!, { text: "The March export, exports/2026-03.csv" });
  if (first !== "ok") run.failures.push(`b:answered — the Inbox's answer to the first question was refused: ${first}`);
  run.closed.push(csv!);
  await touch(run);
  const afterOne = await itemOf(run, t1);
  if (afterOne?.questions.map((h) => h.id).join() !== column) run.failures.push(`b:one-left — wanted t1's item to show only "${COLUMN}"; it shows ${show(afterOne?.questions.map((h) => h.ask.prompt))}`);
  if (proofsOf(t1, "turn").length !== 0) run.failures.push(`b:still-held — t1 started on its first answer (${proofsOf(t1, "turn").length} turns)`);
  await reconciled(run, "b");

  // c. The second answered: t1 runs once, attempt 1, both answers in its brief; its item gone; t2 after it.
  const second = await answer(run, t1, column!, { text: "signup_date" });
  if (second !== "ok") run.failures.push(`c:answered — the Inbox's answer to the second question was refused: ${second}`);
  run.closed.push(column!);
  await run.h.until(async () => (await run.h.byId(t1))?.status === "completed", 15_000);
  await run.h.idle();
  const turns = proofsOf(t1, "turn");
  if (turns.length !== 1 || turns[0]?.attempt !== 1) run.failures.push(`c:runs-once — wanted t1 to run once, on attempt 1; it ran ${show(turns.map((t) => t.attempt))}`);
  const brief = turns[0]?.message ?? "";
  if (!brief.includes("exports/2026-03.csv") || !brief.includes("signup_date") || !brief.includes(CSV)) {
    run.failures.push(`c:brief — wanted t1's turn to be handed both answers with their questions; it was handed ${show(brief.slice(0, 600))}`);
  }
  if ((await itemOf(run, t1)) !== undefined) run.failures.push("c:item-gone — t1's item is still listed");
  await run.h.until(async () => (await run.h.byId(t2))?.status === "completed", 15_000);
  const t2Turns = proofsOf(t2, "turn");
  const t1Done = (await run.h.byId(t1))?.completedAt ?? Number.POSITIVE_INFINITY;
  if (t2Turns.length !== 1 || t2Turns[0]!.at < t1Done) run.failures.push(`c:dependent-after — wanted t2 to run once, after t1 completed; it ran ${t2Turns.length} times`);
  // Retried after t1 completed: the same answer is a success; other words are refused.
  const retried = await answerDirect(run, t1, column!, "signup_date");
  const competing = await answerDirect(run, t1, column!, "created_at");
  if (retried.output?.ok !== true || competing.output?.ok !== false) run.failures.push(`c:retry-after-done — wanted the retry ok and a new answer refused; got ${show([retried, competing])}`);
  await reconciled(run, "c");
  run.notes.push(`a-c: t1 held on 2 questions, started once on attempt 1 with both answers in its brief, t2 after it`);
}

/** d: asked midway. `wake` says whether the turn's own start in its session runs. */
async function legD(run: Run, leg: "d" | "dnowake"): Promise<void> {
  (globalThis as any).__goalNoTurnStart = leg === "dnowake";
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  latch.__goalAfterAsk = () => released;
  let goOn!: () => void;
  const next = new Promise<void>((resolve) => (goOn = resolve));
  latch.__goalBeforeNext = () => next;
  try {
    const t4 = await file(run, word(`t4 Clean the export [ask:1]${leg === "d" ? " [late]" : ""}`));
    if (!(await run.h.until(async () => openIds(await run.h.byId(t4)).length === 1, 15_000))) {
      run.failures.push(`${leg}:asked — t4 never asked; it is ${show(await run.h.byId(t4))}`);
      return;
    }
    const held = (await run.h.byId(t4))!;
    if (held.status !== "in_progress" || held.leaseUntil != null || held.attempts !== 1) {
      run.failures.push(`${leg}:held — wanted t4 in progress on attempt 1 with no lease; it is ${show({ status: held.status, lease: held.leaseUntil, attempts: held.attempts })}`);
    }
    // Past the lease, and a touch: no renewal kept it, no reclaim takes it back.
    if (leg === "dnowake") release();
    await sleep(LEASE_MS + 500);
    await touch(run).catch(() => undefined);
    const still = (await run.h.byId(t4))!;
    if (still.leaseUntil != null || still.attempts !== 1 || proofsOf(t4, "turn").length !== 1) {
      run.failures.push(`${leg}:not-reclaimed — wanted t4 untouched past its lease; it is attempt ${still.attempts}, lease ${still.leaseUntil}, ${proofsOf(t4, "turn").length} turns`);
    }
    const item = await itemOf(run, t4);
    const hold = item?.questions[0];
    if (hold?.ask.prompt !== COLUMN) run.failures.push(`${leg}:listed — wanted t4's midway question in the Inbox; it shows ${show(item?.questions)}`);
    const said = hold === undefined ? "no hold" : await answer(run, t4, hold.id, { text: "signup_date" });
    if (said !== "ok") run.failures.push(`${leg}:answered — the Inbox's answer was refused: ${said}`);
    if (hold !== undefined) run.closed.push(hold.id);
    if (leg === "d") {
      // The next turn's claim lands while the asking turn still runs; then its late write.
      const claimed = await run.h.until(async () => ((await run.h.byId(t4))?.turn ?? 0) >= 2, 10_000);
      if (!claimed) run.notes.push(`${leg}: no claim of t4's next turn while the asking turn ran`);
      release();
      // The next turn holds until the asking turn's late write has landed or been refused.
      await run.h.until(async () => proofsOf(t4, "late").length > 0, 10_000);
      goOn();
    }
    const done = await run.h.until(async () => (await run.h.byId(t4))?.status === "completed", 20_000);
    await run.h.idle();
    const turns = proofsOf(t4, "turn");
    if (!done || turns.length !== 2 || turns.some((t) => t.attempt !== 1)) {
      run.failures.push(`${leg}:one-more-turn — wanted exactly one more turn of t4 on attempt 1, and t4 completed; turns on attempts ${show(turns.map((t) => t.attempt))}, t4 ${(await run.h.byId(t4))?.status}`);
    }
    if (!(turns[1]?.message ?? "").includes("signup_date")) run.failures.push(`${leg}:answer-in-message — wanted the answer in t4's next turn's message; it was ${show(turns[1]?.message?.slice(0, 400))}`);
    if (leg === "d") {
      const late = proofsOf(t4, "late")[0]?.outcome as { outcome?: string; reason?: string } | undefined;
      const row = await run.h.byId(t4);
      if (late?.outcome !== "declined" || late.reason !== "lost-claim" || row?.statusNote === "a late write from the asking turn") {
        run.failures.push(`${leg}:late-write-refused — wanted the asking turn's late write refused after its successor's claim; it was ${show(late)}, the row's note ${show(row?.statusNote)}`);
      }
    }
    await reconciled(run, leg);
    run.notes.push(`${leg}: t4 asked midway, held past its lease with no lease, answered, one more turn on attempt 1${leg === "d" ? ", the late write refused" : " (the board's claim took it)"}`);
  } finally {
    release();
    goOn();
    latch.__goalAfterAsk = undefined;
    latch.__goalBeforeNext = undefined;
    (globalThis as any).__goalNoTurnStart = false;
  }
}

/** e: the rules of an answer, a cancel, no deadline, the caller, a task run's stop, a confirm, one wait per turn, a line. */
async function legE(run: Run): Promise<void> {
  // Retries and competing answers.
  const t7 = await file(run, word("t7 Count the rows"), { questions: [CSV, COLUMN] });
  const [q7] = openIds(await run.h.byId(t7));
  const a1 = await answer(run, t7, q7!, { text: "the March one" });
  const again = await answerDirect(run, t7, q7!, "the March one");
  const other = await answerDirect(run, t7, q7!, "the April one");
  if (a1 !== "ok" || again.output?.ok !== true || other.output?.ok !== false || !String(other.output?.error).startsWith("question_answered")) {
    run.failures.push(`e:retry-and-competing — wanted the same answer twice a success and another refused as answered; got ${show([a1, again, other])}`);
  }
  if (((await run.h.byId(t7))?.steers ?? []).length !== 1) run.failures.push("e:retry-and-competing — the retry or the competing answer was kept");
  run.closed.push(q7!);
  // Another user, tenant or org: not found, nothing written.
  const [q7b] = openIds(await run.h.byId(t7));
  for (const who of [{ user: "u_someone_else" }, { tenant: "t_other" }, { org: "org_other" }]) {
    await answerDirect(run, t7, q7b!, "from elsewhere", run.h.as(who));
  }
  if (((await run.h.byId(t7))?.steers ?? []).length !== 1 || openIds(await run.h.byId(t7)).join() !== q7b) {
    run.failures.push(`e:caller-scoped — an answer from another user, tenant or org was written: ${show((await run.h.byId(t7))?.steers)}`);
  }
  // A cancel closes t3's item; a later answer is refused as finished.
  const t3 = await file(run, word("t3 Draft the memo"), { questions: [CSV] });
  const [q3] = openIds(await run.h.byId(t3));
  await run.h.http.act("desk", run.conversation, "updateTask_tasks", { id: t3, status: "cancelled" });
  run.closed.push(q3!);
  const late = await answerDirect(run, t3, q3!, "too late");
  if ((await itemOf(run, t3)) !== undefined || late.output?.ok !== false || !String(late.output?.error).startsWith("task_finished")) {
    run.failures.push(`e:cancel-closes — wanted t3's item gone and a later answer refused as finished; got ${show(late.output)}`);
  }
  // No deadline set: open well past a short one, after a touch.
  const t6 = await file(run, word("t6 Wait for the user"), { questions: [COLUMN] });
  await sleep(DUE_MS + 1_500);
  await touch(run);
  const t6Row = await run.h.byId(t6);
  if (openIds(t6Row).length !== 1 || openQuestions(t6Row!)[0]?.due !== undefined || (await itemOf(run, t6)) === undefined || proofsOf(t6, "turn").length !== 0) {
    run.failures.push(`e:no-deadline — wanted t6's question still open with no due time, listed, unstarted; it is ${show({ open: openIds(t6Row), due: t6Row && openQuestions(t6Row)[0]?.due, steers: t6Row?.steers, turns: proofsOf(t6, "turn").length })}`);
  }
  // t9: a task run's waitForUser approval: one open suspension hold, listed once, answered through FIX-2129's route, closed by the resume.
  const t9 = await file(run, word("t9 Ship the release [approve]"));
  const mirrored = await run.h.until(async () => openQuestions((await run.h.byId(t9)) ?? ({ status: "pending" } as Task)).some((h) => h.source.kind === "suspension"), 15_000);
  const t9Row = await run.h.byId(t9);
  const t9Item = await itemOf(run, t9);
  if (!mirrored || t9Item?.questions.length !== 1 || t9Item.questions[0]!.source.kind !== "suspension" || "waitingFor" in (t9Row ?? {})) {
    run.failures.push(`e:t9-mirror — wanted one open suspension hold on t9 and one item for it; row ${show(t9Row?.questions)}, item ${show(t9Item?.questions)}`);
  }
  await reconciled(run, "e:t9-held");
  const t9Said = t9Item === undefined ? "no item" : await answer(run, t9, t9Item.questions[0]!.id, { approved: true });
  if (t9Said !== "ok") run.failures.push(`e:t9-answered — the Inbox's answer through the engine's route was refused: ${t9Said}`);
  if (t9Item !== undefined) run.closed.push(t9Item.questions[0]!.id);
  await run.h.until(async () => (await run.h.byId(t9))?.status === "completed", 15_000);
  await run.h.idle();
  if ((await run.h.byId(t9))?.questions !== undefined || (await run.h.byId(t9))?.status !== "completed") {
    run.failures.push(`e:t9-resume-closes — wanted the resume to close t9's hold and t9 to complete; it is ${show({ status: (await run.h.byId(t9))?.status, holds: (await run.h.byId(t9))?.questions })}`);
  }
  // t10: a confirm, filed: one item with a yes and a no; the yes starts it.
  const t10 = await file(run, word("t10 Run the migration"), { questions: [{ kind: "confirm", prompt: "Run it against production?" }] });
  const t10Item = await itemOf(run, t10);
  if (t10Item?.questions[0]?.ask.kind !== "confirm" || proofsOf(t10, "turn").length !== 0) run.failures.push(`e:t10-confirm — wanted one confirm item, unstarted; it shows ${show(t10Item?.questions)}`);
  const yes = t10Item === undefined ? "no item" : await answer(run, t10, t10Item.questions[0]!.id, { done: true });
  if (t10Item !== undefined) run.closed.push(t10Item.questions[0]!.id);
  await run.h.until(async () => (await run.h.byId(t10))?.status === "completed", 15_000);
  if (yes !== "ok" || proofsOf(t10, "turn").length !== 1 || !(proofsOf(t10, "turn")[0]?.message ?? "").includes("Yes, go ahead.")) {
    run.failures.push(`e:t10-yes-starts — wanted the yes to start t10 once with it in its brief; ${yes}, ${proofsOf(t10, "turn").length} turns`);
  }
  // t12: a confirm's No, the default (owner, 2026-10-25): the task is cancelled, never started, its item gone.
  const t12 = await file(run, word("t12 Drop the old table"), { questions: [{ kind: "confirm", prompt: "Drop it now?" }] });
  const t12Item = await itemOf(run, t12);
  const no = t12Item === undefined ? "no item" : await answer(run, t12, t12Item.questions[0]!.id, { done: false, note: "keep it a week" });
  if (t12Item !== undefined) run.closed.push(t12Item.questions[0]!.id);
  await touch(run);
  const t12Read = await getTask(run, t12);
  if (no !== "ok" || t12Read?.status !== "cancelled" || proofsOf(t12, "turn").length !== 0 || (await itemOf(run, t12)) !== undefined) {
    run.failures.push(`e:t12-no-cancels — wanted the No to cancel t12 unstarted and close its item; ${no}, ${show({ status: t12Read?.status, error: t12Read?.error })}, ${proofsOf(t12, "turn").length} turns`);
  }
  // t11: one wait per turn: asked, then a stop for a person in the same turn, which is refused and cancelled.
  const t11 = await file(run, word("t11 Ask then approve [ask-then-approve]"));
  await run.h.until(async () => proofsOf(t11, "resumed").length === 1, 15_000);
  await run.h.idle();
  const t11Row = await run.h.byId(t11);
  const resumed = proofsOf(t11, "resumed")[0]?.outcome as { cancelled?: boolean } | undefined;
  const t11Item = await itemOf(run, t11);
  if (resumed?.cancelled !== true || openQuestions(t11Row!).map((h) => h.source.kind).join() !== "row" || t11Item?.questions.map((h) => h.source.kind).join() !== "row") {
    run.failures.push(`e:one-wait-per-turn — wanted the stop refused and cancelled (resumed cancelled), t11 held on its question alone; resumed ${show(resumed)}, holds ${show(t11Row?.questions)}, item ${show(t11Item?.questions)}`);
  }
  // t8: a line typed in a held session answers the oldest open question, and leaves the other.
  const t8 = await file(run, word("t8 Reconcile the two exports [ask:2]"));
  await run.h.until(async () => openIds(await run.h.byId(t8)).length === 2, 15_000);
  const t8Row = (await run.h.byId(t8))!;
  const [oldest, newer] = openIds(t8Row);
  await run.h.http.act("doer", t8Row.run!.sessionId, "respond", { message: "Use the March one" }).catch((error: Error) => run.notes.push(`e: the line was refused: ${error.message}`));
  await run.h.idle();
  const t8After = await run.h.byId(t8);
  if (openIds(t8After).join() !== newer || !(t8After?.steers ?? []).some((s) => s.answers === oldest && s.message === "Use the March one")) {
    run.failures.push(`e:line-answers-oldest — wanted the line to answer t8's oldest question and leave the other open; open ${show(openIds(t8After))}, steers ${show(t8After?.steers)}`);
  }
  run.closed.push(oldest!);
  await reconciled(run, "e");
  // Clean up what is still held, so a later leg's reads are its own.
  for (const id of [t6, t7, t8, t11]) await run.h.http.act("desk", run.conversation, "updateTask_tasks", { id, status: "cancelled" }).catch(() => undefined);
  for (const id of [t6, t7, t8, t11]) run.closed.push(...openIds(await run.h.byId(id)).filter(() => false));
  await run.h.idle();
  run.notes.push("e: retries, a competing answer, the caller check, a cancel, no deadline, t9's mirror, t10's confirm, t12's No cancelling it, t11's refused stop, t8's line");
}

/** edue: a deadline the host set (t5): past due and a touch later, it closes "no answer came", and t5 starts. */
async function legEDue(run: Run): Promise<void> {
  const t5 = await file(run, word("t5 Go on without an answer"), { questions: [COLUMN] });
  const due = openQuestions((await run.h.byId(t5))!)[0]?.due;
  const openedAt = openQuestions((await run.h.byId(t5))!)[0]?.openedAt ?? 0;
  if (due !== openedAt + DUE_MS) run.failures.push(`edue:due — wanted t5's question due ${DUE_MS} ms after it opened; it is due ${due}, opened ${openedAt}`);
  await sleep(DUE_MS + 500);
  await touch(run);
  await run.h.until(async () => (await run.h.byId(t5))?.status === "completed", 15_000);
  const row = await run.h.byId(t5);
  const closed = (row?.steers ?? []).find((s) => s.from === "board");
  if (openIds(row).length !== 0 || closed === undefined || proofsOf(t5, "turn").length !== 1 || !(proofsOf(t5, "turn")[0]?.message ?? "").includes("No answer came")) {
    run.failures.push(`edue:deadline-closes — wanted t5's question closed by the board ("no answer came") and t5 started once; open ${show(openIds(row))}, steers ${show(row?.steers)}, ${proofsOf(t5, "turn").length} turns`);
  }
  await reconciled(run, "edue");
  run.notes.push(`edue: t5's question due ${DUE_MS} ms on, closed "no answer came" on a touch past it, and t5 started`);
}

/** f: the host's setting for a person's stop: a held question reads it (FIX-2129 leg f's held-question half). */
async function legF(run: Run): Promise<void> {
  const tf = await file(run, word("tf The host's setting"), { questions: [COLUMN] });
  const hold = openQuestions((await run.h.byId(tf))!)[0];
  if (hold?.due === undefined || hold.due - hold.openedAt !== HOST_DEADLINE_MS) {
    run.failures.push(`f:host-setting — wanted the question due ${HOST_DEADLINE_MS} ms after it opened; it is ${show(hold)}`);
  }
  await run.h.http.act("desk", run.conversation, "updateTask_tasks", { id: tf, status: "cancelled" });
  run.notes.push(`f: a held question took the host's ${HOST_DEADLINE_MS} ms`);
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
    if (legs.has("a") || legs.has("b") || legs.has("c")) await guard("a", () => legsABC(run));
    if (legs.has("d")) await guard("d", () => legD(run, "d"));
    if (legs.has("dnowake")) await guard("dnowake", () => legD(run, "dnowake"));
    if (legs.has("e")) await guard("e", () => legE(run));
  });
  if (legs.has("edue")) await onHost("due", { userDeadlineMs: DUE_MS }, failures, notes, tell, (run) => guard("edue", () => legEDue(run)));
  if (legs.has("f")) await onHost("f", { userDeadlineMs: HOST_DEADLINE_MS }, failures, notes, tell, (run) => guard("f", () => legF(run)));
  return { failures, evidence: notes.join("\n") };
});
