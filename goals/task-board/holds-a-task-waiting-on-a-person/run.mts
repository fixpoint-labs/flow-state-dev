/**
 * Goal check — a task whose run suspends for a user shows what it waits for,
 * is answered from the Inbox on the same try by that user only, and ends
 * exactly once, whether it is answered, runs out of time, is cancelled or is
 * stopped (FIX-2129).
 *
 * **Model-free.** A real `createFlowState` host on a durable SQLite store with
 * trace observability off (production's default, so a resume that runs a
 * completed step again shows), the Workforce session board on two flows
 * (`desk`, the conversation that files, and `doer`, whose task sessions work
 * and file pieces for `eng.helper`), deterministic workers, driven over the
 * host's HTTP router as a verified caller. The task is read through the
 * board's public actions, the pending list through Shift Manager's own Inbox
 * read, and every answer goes through the client call a screen makes. The
 * work counter is a proof file each worker appends to from inside its run.
 *
 * Legs (each failure is tagged `<leg>:<assertion>`):
 *   a  answered: shown waiting on a user, kept past three lease periods, not
 *      answerable from another tenant or org, answered once on try 1
 *   b  deadlines: an unhandled input fails try 1, a caught one completes, an
 *      approval reads as a no and runs no completed step again
 *   c  cancelled: the block runs on once, its writes and filing refused, the
 *      row stays cancelled; an answer after the cancel is told it's resolved
 *   c' a cancelled block's filing on its task session's board, with a claimer
 *      in another process latched into the moment after a child's add: never
 *      claimable
 *   d  stopped: the task is cancelled on try 1
 *   e  a crash after the cancel's row write: a board touch after a restart
 *      resumes the block cancelled
 *   f  the host's setting for a user's stop: read by waitForUser, never by a
 *      raw ctx.suspend
 *   g  no deadline: still waiting past the sweep's interval and a board touch
 *
 * Controls (scratch patches as the code under test loads, printed by the run):
 *   stop-fails-attempt, public-resume, stored-user-only, cancel-after-add,
 *   default-deadline. Each must FAIL the leg goal.md names.
 *
 * Run: pnpm tsx goals/task-board/holds-a-task-waiting-on-a-person/run.mts
 * Legs: GOAL_LEGS=a,b,c,cprime,d,e,f,g (default: all; e waits out a 60 s resume lease)
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { defineFlow, handler, sequencer, SuspensionTimeoutError } from "@flow-state-dev/core";
import { dispatchThroughSeam, isUserSuspension, markDispatcher, type BlockContext } from "@flow-state-dev/core/types";
import { createFlowState } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { currentWorkerClaim } from "@flow-state-dev/orchestration/task-board";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import { TASK_ID_STATE_KEY } from "../../../packages/workforce/src/workers/keys.ts";
import { messageLogOf } from "../../../packages/workforce/src/messages/message-log.ts";
import type { WorkerMessageRow } from "../../../packages/workforce/src/messages/log-row.ts";
import { MESSAGE_RECEIVED_ENTRY } from "../../../packages/workforce/src/messages/keys.ts";
import {
  createWorkerInstallation,
  defineSessionBoard,
  filingConversationBoard,
  hireWorkforce,
  workerConfigSchema,
  workerTaskEntry,
  type WorkerManifest
} from "@flow-state-dev/workforce";
import { connect } from "../../../packages/shift-manager/src/lib/connection.ts";
import { readPendingSuspensions } from "../../../packages/shift-manager/src/lib/reads.ts";
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

const USER = "u_holds_waiting";
const ORG = "org_holds_waiting";
const ROLE = process.env.GOAL_ROLE ?? "main";
const CONTROL = process.env.GOAL_CONTROL ?? "";
const SCRATCH = process.env.GOAL_SCRATCH ?? goalTmpDir("holds-waiting-on-a-person");
const PROOFS = join(SCRATCH, "proofs.ndjson");
/** The lease a claim commits to, shortened so "past three lease periods" is seconds, not minutes. */
const LEASE_MS = 3_000;
/** The durability sweep's interval on this host: leg g waits past it. */
const SWEEP_MS = 2_000;
/** The engine's resume lease, which a host killed mid-cancel leaves held: leg e waits it out. */
const RESUME_LEASE_MS = 60_000;
/** The host's deadline for a user's stop in leg f: distinctive, and far enough off never to fire here. */
const HOST_DEADLINE_MS = 7_777_000;
/** A raw `ctx.suspend`'s own `timeoutMs` in leg f. */
const RAW_TIMEOUT_MS = 5_555_000;
const ALL_LEGS = ["a", "b", "c", "cprime", "d", "e", "f", "g"] as const;

// ---- patches ------------------------------------------------------------------

/**
 * Applied on every run: the lease shortened (faking time, so leg a's three
 * lease periods are seconds), and two latches leg c' and leg e hold the code
 * at, each a no-op unless the run sets its hook.
 */
const TIMING: ModulePatch[] = [
  {
    module: "packages/orchestration/src/tasks/collection/internal.ts",
    from: String.raw`DEFAULT_LEASE_DURATION_MS = (?:120_000|12e4|120000)`,
    to: `DEFAULT_LEASE_DURATION_MS = ${LEASE_MS}`
  },
  {
    // Right after a piece's add commits, before anything else runs.
    module: "packages/workforce/src/conversation-board/board.ts",
    from: String.raw`await markAdded\(\);`,
    to: "await globalThis.__goalAfterAdd?.(added); await markAdded();"
  },
  {
    // Right after a cancel's row write, before its resume.
    module: "packages/orchestration/src/tasks/helpers/user-stop.ts",
    from: String.raw`if \(outcome\.outcome !== "recorded"\) throw new CancelDeclined\(\);`,
    to: `if (outcome.outcome !== "recorded") throw new CancelDeclined(); await globalThis.__goalAfterCancelWrite?.();`
  }
];

const CONTROLS: Record<string, { patches: ModulePatch[]; legs: string[] }> = {
  // A stop of a task waiting on a user fails the try, as a stopped request did.
  "stop-fails-attempt": {
    patches: [
      {
        module: "packages/orchestration/src/task-board/task-entry.ts",
        from: String.raw`await board\.cancel\(row\.id, STOPPED_WHILE_WAITING,`,
        to: "await board.fail(row.id, STOPPED_WHILE_WAITING,"
      }
    ],
    legs: ["d"]
  },
  // The screen's answer goes through the public resume route instead.
  "public-resume": {
    patches: [
      {
        module: "packages/client/src/client.ts",
        from: String.raw`\$\{base\}/answer`,
        to: "${base}/resume"
      }
    ],
    legs: ["a"]
  },
  // The answer route checks only the stored stop's user.
  "stored-user-only": {
    patches: [
      {
        module: "packages/engine/src/routes/answer-routes.ts",
        from: String.raw`!callerReachesRequest\(owner, ctx\.tenantId, ctx\.principal\)`,
        to: "owner.userId !== (ctx.principal?.userId ?? owner.userId)"
      }
    ],
    legs: ["a"]
  },
  // Today's order: the piece is added, and only then cancelled for its cancelled task.
  "cancel-after-add": {
    patches: [{ module: "packages/workforce/src/conversation-board/board.ts", from: String.raw`await refuseUnderCancelledTask\(\);`, to: "" }],
    legs: ["cprime"]
  },
  // A stop with no deadline gets one anyway.
  "default-deadline": {
    patches: [
      {
        module: "packages/core/src/types/wait-for-user.ts",
        from: String.raw`options\.deadline \?\? ctx\.requestHost\?\.userDeadlineMs`,
        to: "options.deadline ?? ctx.requestHost?.userDeadlineMs ?? 1500"
      }
    ],
    legs: ["g"]
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
      FSDEV_TRACE_OBSERVABILITY: "0",
      GOAL_LEGS: process.env.GOAL_LEGS ?? (CONTROL === "" ? ALL_LEGS.join(",") : CONTROLS[CONTROL]!.legs.join(",")),
      ...modulePatchEnv(PATCHES, REPO_ROOT, mark)
    }
  });
  if (ROLE === "main" && child.status !== 2) assertPatched(PATCHES, REPO_ROOT, mark);
  process.exit(child.status ?? 1);
}
const legs = new Set((process.env.GOAL_LEGS ?? ALL_LEGS.join(",")).split(",").map((s) => s.trim()).filter(Boolean));

// ---- proofs -------------------------------------------------------------------

type Proof = {
  kind: "work" | "asked" | "report" | "file" | "piece" | "woken" | "message";
  /** On a message: whether its turn held the task's claim. */
  claimed?: boolean;
  requestId: string;
  sessionId: string;
  taskId?: string;
  /** What the wait came back with, or the error it threw. */
  result?: unknown;
  error?: string;
  /** A write's outcome: a report's, or a filing's. */
  outcome?: string;
  pid: number;
  at: number;
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const prove = (proof: Omit<Proof, "pid" | "at">) => appendFileSync(PROOFS, `${JSON.stringify({ ...proof, pid: process.pid, at: Date.now() })}\n`, "utf8");
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
const WORKERS: WorkerManifest[] = [
  worker("lead", { flow: "desk", delegates: ["eng.doer"] }),
  worker("eng.doer", { flow: "doer", delegates: ["eng.helper"] }),
  worker("eng.helper", { flow: "doer" })
];
const PROMPTS = { approval: "Ship the release?", review: "Review the draft.", input: "Which region?" } as const;

/** The router a fetch to `http://goal` reaches, and who it calls as. */
let goalRouter: { POST: Function; GET: Function } | undefined;
let caller: { user: string; org?: string; tenant?: string } = { user: USER };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(input as RequestInfo, init);
  const url = new URL(request.url);
  if (url.host !== "goal" || goalRouter === undefined) return realFetch(input as RequestInfo, init);
  const headers = new Headers(request.headers);
  headers.set("x-user", caller.user);
  if (caller.org !== undefined) headers.set("x-org", caller.org);
  if (caller.tenant !== undefined) headers.set("x-tenant-id", caller.tenant);
  const routed = new Request(request, { headers });
  const path = url.pathname.replace(/^\/api\/flows\/?/, "").split("/").filter(Boolean);
  return (goalRouter as unknown as Record<string, (r: Request, c: unknown) => Promise<Response>>)[request.method]!(routed, { params: { path } });
}) as typeof fetch;

function buildHost(filename: string, settings: { userDeadlineMs?: number } = {}) {
  let workerFlows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({ standardWorkers: WORKERS, workerFlows: () => workerFlows as never });
  const doorInput = z.object({ message: z.string() });
  const deskBoard = defineSessionBoard({ installation, flowKind: "desk" });
  const doerBoard = defineSessionBoard({ installation, flowKind: "doer" });
  const deskTurn = handler({ name: "holds-desk-turn", inputSchema: doorInput, outputSchema: z.unknown(), execute: (input) => `noted: ${input.message}` });

  type Base = { requestId: string; sessionId: string; taskId?: string };
  const baseOf = (ctx: BlockContext): Base => {
    const taskId = (ctx.session.state as Record<string, unknown> | undefined)?.[TASK_ID_STATE_KEY];
    return { requestId: ctx.request.identity.id, sessionId: ctx.session.identity.id, ...(typeof taskId === "string" ? { taskId } : {}) };
  };
  /** File a piece for eng.helper on this task session's own board: what came of it. */
  const filePiece = async (ctx: BlockContext, label: string): Promise<string> => {
    const ref = await doerBoard.board.resolver(ctx as never);
    try {
      const added = await ref!.addTask({ goal: `piece ${label} ${RUN_STAMP} [slow:50]`, assignee: "eng.helper" });
      return `added:${added.id}:${added.status}`;
    } catch (error) {
      return `refused:${(error as Error).message.split(":")[0]}`;
    }
  };
  /** Report a checkpoint on the task as its worker: what came of it. */
  const reportOn = async (ctx: BlockContext, taskId: string | undefined): Promise<string> => {
    const above = await filingConversationBoard(ctx);
    const claim = currentWorkerClaim(ctx);
    if (above === undefined || taskId === undefined || claim === undefined || above.tasks.reportProgress === undefined) return "no-claim";
    const outcome = await above.tasks.reportProgress(taskId, { output: "checkpoint after the wait", statusNote: "after" }, { claim });
    return outcome.outcome === "declined" ? `declined:${outcome.reason}` : outcome.outcome;
  };

  // The doer's work, two steps: the work itself (the counter), then the ask.
  // Marks: [file-first] files a piece before asking; [ask:KIND] waits for the
  // user; [deadline:MS] gives it a deadline; [catch] goes ahead at an input's
  // deadline; [raw:REASON] or [raw:REASON:MS] stops with ctx.suspend instead;
  // [then-report] and [then-file] write to the task after the wait comes back.
  const work = handler({
    name: "holds-doer-work",
    inputSchema: doorInput,
    outputSchema: doorInput,
    execute: async (input, rawCtx) => {
      const ctx = rawCtx as unknown as BlockContext;
      const base = baseOf(ctx);
      if (input.message.startsWith('Task "')) {
        prove({ kind: "woken", ...base });
        return input;
      }
      if (input.message.startsWith("Message ")) {
        prove({ kind: "message", ...base, claimed: currentWorkerClaim(ctx) !== undefined });
        return input;
      }
      if (/\[slow:\d+\]/.test(input.message)) return input;
      if (input.message.includes("[file-first]")) prove({ kind: "file", ...base, outcome: await filePiece(ctx, "first") });
      prove({ kind: "work", ...base });
      return input;
    }
  });
  const ask = handler({
    name: "holds-doer-ask",
    inputSchema: doorInput,
    outputSchema: z.unknown(),
    execute: async (input, rawCtx) => {
      const ctx = rawCtx as unknown as BlockContext;
      const base = baseOf(ctx);
      const message = input.message;
      if (message.startsWith('Task "') || message.startsWith("Message ")) return `turn ${base.requestId}`;
      const slow = /\[slow:(\d+)\]/.exec(message);
      if (slow !== null) {
        await sleep(Number(slow[1]));
        prove({ kind: "piece", ...base });
        return "piece done";
      }
      const kind = /\[ask:(approval|review|input)\]/.exec(message)?.[1] as keyof typeof PROMPTS | undefined;
      const raw = /\[raw:([a-z_]+)(?::(\d+))?\]/.exec(message);
      const deadline = /\[deadline:(\d+)\]/.exec(message);
      let result: unknown;
      try {
        if (raw !== null) {
          result = { raw: await ctx.suspend!({ reason: raw[1]!, message: "A raw stop.", ...(raw[2] !== undefined ? { timeoutMs: Number(raw[2]) } : {}) }) };
        } else if (kind !== undefined) {
          result = await ctx.waitForUser({ kind, prompt: PROMPTS[kind], ...(deadline !== null ? { deadline: Number(deadline[1]) } : {}) } as never);
        } else {
          result = "nothing asked";
        }
      } catch (error) {
        // Parking, or a stop ending the run at the stop: nothing the wait came back with.
        if ((error as Error).name === "SuspensionError" || (error as Error).name === "AbortError") throw error;
        if (error instanceof SuspensionTimeoutError && message.includes("[catch]")) {
          result = { wentAhead: true };
        } else {
          prove({ kind: "asked", ...base, error: (error as Error).name });
          throw error;
        }
      }
      prove({ kind: "asked", ...base, result });
      if (message.includes("[then-report]")) prove({ kind: "report", ...base, outcome: await reportOn(ctx, base.taskId) });
      if (message.includes("[then-file]")) prove({ kind: "file", ...base, outcome: await filePiece(ctx, "after") });
      return `resumed ${JSON.stringify(result)}`;
    }
  });
  const doerWork = sequencer({ name: "holds-doer-turn", inputSchema: doorInput }).step(work).step(ask);
  // A peer's message to this session, as a send delivers one: an unconfirmed
  // row in the user's message log, and its delivery dispatched here.
  const sendMessage = markDispatcher(
    handler({
      name: "holds-send-message",
      inputSchema: z.object({}),
      outputSchema: z.unknown(),
      execute: async (_input, rawCtx) => {
        const ctx = rawCtx as unknown as BlockContext;
        const id = `msg_${RUN_STAMP}_${Math.random().toString(16).slice(2, 10)}`;
        const sessionId = ctx.session.identity.id;
        await messageLogOf(ctx).getOrCreate(id, {
          id,
          from: "eng.helper",
          to: "eng.doer",
          text: "A note while you wait.",
          exchange: id,
          fromSession: sessionId,
          fromFlow: "doer",
          toSession: sessionId,
          toFlow: "doer",
          hop: 1,
          status: "unconfirmed",
          at: Date.now()
        } as never);
        await dispatchThroughSeam(ctx, {
          type: "internal",
          action: MESSAGE_RECEIVED_ENTRY,
          flowKind: "doer",
          session: { id: sessionId },
          payload: { messageId: id },
          from: "holds-send-message"
        });
        return id;
      }
    }),
    { type: "internal", action: MESSAGE_RECEIVED_ENTRY }
  );

  const deskFlow = defineFlow({
    kind: "desk",
    configSchema: workerConfigSchema(),
    session: { ...installation.session(deskBoard.sessionStateShape), serverOwned: [...deskBoard.serverOwned] },
    resources: { ...installation.resources, ...deskBoard.resources },
    actions: { respond: { inputSchema: doorInput.strict(), block: deskTurn, userMessage: (i: { message: string }) => i.message }, ...deskBoard.actions },
    internal: { actions: deskBoard.entries(deskTurn, () => "fixed") },
    task: { actions: { work: workerTaskEntry({ name: "holds-desk-task", turn: deskTurn }) } }
  } as never);
  const doerFlow = defineFlow({
    kind: "doer",
    configSchema: workerConfigSchema(),
    session: { ...installation.session(doerBoard.sessionStateShape), serverOwned: [...doerBoard.serverOwned] },
    resources: { ...installation.resources, ...doerBoard.resources },
    actions: {
      respond: { inputSchema: doorInput.strict(), block: doerWork, userMessage: (i: { message: string }) => i.message },
      sendMessage: { inputSchema: z.object({}).strict(), block: sendMessage },
      ...doerBoard.actions
    },
    // A piece's notice wakes the doer's turn while the task waits (judgment): leg a reads it ran.
    internal: { actions: doerBoard.entries(doerWork, () => "judgment") },
    task: { actions: { work: { ...workerTaskEntry({ name: "holds-doer-task", turn: doerWork }), durable: true } } }
  } as never);
  workerFlows = { desk: { flow: deskFlow, roles: ["contributor", "manager"] }, doer: { flow: doerFlow, roles: ["contributor", "manager"] } };

  const state = createFlowState({
    flows: Object.fromEntries(hireWorkforce(installation).map((copy) => [copy.id, copy])),
    stores: { default: { primary: sqliteStores({ filename }) } },
    logger: silentLogger,
    durabilityRetention: { sweepIntervalMs: SWEEP_MS },
    ...(settings.userDeadlineMs !== undefined ? { userDeadlineMs: settings.userDeadlineMs } : {}),
    resolvePrincipal: (context: any) => {
      const user = context.request?.headers.get("x-user");
      const org = context.request?.headers.get("x-org") ?? ORG;
      return typeof user === "string" ? { userId: user, orgId: org } : null;
    }
  } as never);

  const connect = async () => {
    const runtime = await state.getRuntime();
    const router = (await state.getRouter()) as never as { POST: Function; GET: Function };
    goalRouter = router;
    const http = actingAs(router as never, USER);
    const rows = async (): Promise<Task[]> =>
      Object.values(await runtime.stores.resourceState.getByPrefix("user", `${USER}:~org:${ORG}`, "tasks/")).map((value) => value.state as Task);
    const byId = async (id: string) => (await rows()).find((r) => r.id === id);
    const act = (session: string, action: string, input: unknown) => http.act("desk", session, action, input);
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
    return { runtime, http, rows, byId, act, until, idle };
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
}
const show = (value: unknown) => JSON.stringify(value);
const word = (text: string) => `${text} ${RUN_STAMP}`;

// ---- what a screen does ---------------------------------------------------------

/** File `goal` for eng.doer from the desk. Its task id. */
async function file(run: Run, goal: string): Promise<string> {
  const filed = await run.h.act(run.conversation, "createTask_tasks", { goal, assignee: "eng.doer" });
  if (filed?.ok !== true) throw new Error(`filing "${goal}" was refused: ${show(filed)}`);
  return filed.taskId as string;
}
/** The task as its public read shows it. */
async function getTask(run: Run, id: string): Promise<Record<string, any> | undefined> {
  const read = await run.h.act(run.conversation, "getTask_tasks", { id });
  return read?.ok === true ? read.task : undefined;
}
/** The task session a row runs in, and its flow copy. */
async function runOf(run: Run, id: string) {
  const row = await run.h.byId(id);
  const sessionId = row?.run?.sessionId;
  const session = sessionId === undefined ? undefined : ((await run.h.runtime.stores.session.get(sessionId)) as { flowId?: string; flowKind?: string } | null);
  return { row, sessionId, requestId: row?.run?.requestId, flowId: session?.flowId ?? session?.flowKind ?? "doer" };
}
const clients = () => connect({ baseUrl: "http://goal", userId: USER });
/** The Inbox's pending read of a task session: Shift Manager's own, filtered as its Inbox filters it. */
async function pendingIn(sessionId: string | undefined) {
  if (sessionId === undefined) return [];
  return (await readPendingSuspensions(clients(), sessionId)).filter((view) => isUserSuspension(view.item));
}
/** Answer a task's pending stop as a screen does, as `as` (the user by default). What the route said. */
/** The stop each task was last answered at, so a second answer names the same one. */
const answeredAt = new Map<string, { requestId: string; suspensionId: string }>();
async function answer(run: Run, id: string, body: { action: "approve" | "reject" | "submit"; data?: unknown }, as?: Partial<typeof caller>) {
  const { sessionId, flowId } = await runOf(run, id);
  const [item] = await pendingIn(sessionId);
  const target = item?.item ?? (await lastStopOf(run, id)) ?? answeredAt.get(id);
  if (target !== undefined) answeredAt.set(id, { requestId: target.requestId, suspensionId: target.suspensionId });
  if (target === undefined) return { status: 0, error: "no stop to answer" };
  caller = { user: USER, ...(as ?? {}) };
  try {
    await clients().flow(flowId).request(target.requestId).answer({ suspensionId: target.suspensionId, ...body });
    return { status: 202 };
  } catch (error) {
    return { status: (error as { status?: number }).status ?? -1, error: (error as Error).message };
  } finally {
    caller = { user: USER };
  }
}
/** The last stop a task's run asked, pending or not, read off the row's run. */
async function lastStopOf(run: Run, id: string): Promise<{ requestId: string; suspensionId: string } | undefined> {
  const { requestId } = await runOf(run, id);
  if (requestId === undefined) return undefined;
  const stops = await run.h.runtime.runtimeConfig.durabilityProvider!.listSuspended({ userId: USER });
  return stops.filter((s) => s.requestId === requestId).sort((a, b) => b.createdAt - a.createdAt)[0];
}
/** The row's open mirror of its run's stop for a person (FIX-2133 moved FIX-2129's `waitingFor` onto it). */
const stopHoldOf = (row: { status?: string; holds?: Task["holds"] } | undefined) =>
  row?.status === "in_progress" ? row.holds?.find((hold) => hold.source.kind === "suspension") : undefined;
const waitingOnUser = async (run: Run, id: string) => stopHoldOf(await run.h.byId(id)) !== undefined;
async function untilWaiting(run: Run, id: string, leg: string): Promise<boolean> {
  if (await run.h.until(() => waitingOnUser(run, id), 15_000)) return true;
  run.failures.push(`${leg}:waiting — the task never waited on a user; it is ${show(await run.h.byId(id))}`);
  return false;
}
/** A message's row in the user's message log, as the server stored it. */
async function messageRowOf(run: Run, id: string): Promise<WorkerMessageRow | undefined> {
  const stored = await run.h.runtime.stores.resourceState.getByPrefix("user", `${USER}:~org:${ORG}`, `workforce/messages/${id}`);
  return Object.values(stored).map((value) => value.state as WorkerMessageRow).find((row) => row.id === id);
}
/** The item a task's stop is listed as, and whether it has left the list. */
async function itemGone(run: Run, id: string): Promise<boolean> {
  return (await pendingIn((await runOf(run, id)).sessionId)).length === 0;
}

// ---- the legs ---------------------------------------------------------------------

/** a. Shown, kept past three leases, refused across a tenant and an org, answered once on try 1. */
async function legA(run: Run): Promise<void> {
  const id = await file(run, word("[file-first][ask:input] where should it run?"));
  if (!(await untilWaiting(run, id, "a"))) return;
  const claimedAt = (await run.h.byId(id))?.startedAt ?? Date.now();
  // Past three lease periods, then a pass of the board that filed it.
  await sleep(Math.max(0, claimedAt + 3 * LEASE_MS + 1_000 - Date.now()));
  await run.h.act(run.conversation, "listTasks_tasks", {});
  await run.h.idle();
  const read = await getTask(run, id);
  const row = await run.h.byId(id);
  const shownStop = stopHoldOf(read);
  if (shownStop?.ask.prompt !== PROMPTS.input || shownStop.ask.kind !== "input" || read?.status !== "in_progress") {
    run.failures.push(`a:shown — wanted getTask to show it in progress, held on a user's stop for "${PROMPTS.input}"; it shows ${show(read && { status: read.status, waitingOn: read.waitingOn, holds: read.holds })}`);
  }
  const listed = (await run.h.act(run.conversation, "listTasks_tasks", {}))?.tasks?.find((t: { id: string }) => t.id === id);
  if (stopHoldOf(listed)?.ask.prompt !== PROMPTS.input) {
    run.failures.push(`a:listed — wanted listTasks to show it waiting on a user; it lists ${show(listed)}`);
  }
  if (row?.attempts !== 1 || row.leaseUntil != null || proofsOf(id, "work").length !== 1) {
    run.failures.push(`a:kept — wanted try 1, no lease and the work run once past three leases; attempts ${row?.attempts}, lease ${row?.leaseUntil}, work ${proofsOf(id, "work").length}`);
  }
  // The piece the request filed before it stopped ended during the stop, and its notice's turn ran then.
  const piece = (await run.h.rows()).find((r) => r.filedByTask === id);
  const woken = proofsOf(id, "woken");
  if (piece?.status !== "completed" || woken.length === 0) {
    run.failures.push(`a:notice-during-stop — wanted the filed piece to end and its notice's turn to run while the task waited; piece ${piece?.status}, woken turns ${woken.length}`);
  }
  const { sessionId } = await runOf(run, id);
  const pending = run.tell.over("a · the stop in the Inbox's pending read", await pendingIn(sessionId));
  // A message to the session meanwhile (epic FIX-2070 D3): it queues behind the user's stop, and the task keeps waiting.
  const messageId = (await run.h.http.act("doer", sessionId!, "sendMessage", {})) as string;
  await run.h.idle();
  const heardWhileWaiting = readProofs().filter((p) => p.kind === "message" && p.sessionId === sessionId);
  const queued = await messageRowOf(run, messageId);
  const still = await run.h.byId(id);
  if (heardWhileWaiting.length !== 0 || queued?.status !== "unconfirmed" || queued.queuedBehind !== "user" || stopHoldOf(still) === undefined || proofsOf(id, "work").length !== 1) {
    run.failures.push(`a:message-while-waiting — wanted a message to the waiting session to queue behind the user's stop (no turn yet, its row unconfirmed and queued behind "user") while the task keeps waiting; turns ${heardWhileWaiting.length}, row ${show(queued && { status: queued.status, queuedBehind: queued.queuedBehind })}, task ${still?.status}/${show(still?.holds)}`);
  }
  // Another tenant and another org, with the stop's user id: told the stop doesn't exist.
  const tenant = await answer(run, id, { action: "submit", data: "us-east" }, { tenant: "t_other" });
  const org = await answer(run, id, { action: "submit", data: "us-east" }, { org: "org_other" });
  // Another org is turned away by the host's org guard (403) before the answer route reads anything.
  if (tenant.status !== 404 || (org.status !== 404 && org.status !== 403)) {
    run.failures.push(`a:another-tenant — wanted another tenant told the stop doesn't exist (404), and another org refused; they got ${tenant.status} and ${org.status}`);
  }
  const answered = await answer(run, id, { action: "submit", data: "eu-west" });
  if (answered.status !== 202) run.failures.push(`a:answered — wanted the answer through the route a screen uses accepted; it got ${answered.status}: ${answered.error}`);
  await run.h.idle();
  const done = await run.h.byId(id);
  const asked = proofsOf(id, "asked");
  if (done?.status !== "completed" || done.attempts !== 1 || proofsOf(id, "work").length !== 1 || asked.length !== 1 || show((asked[0]?.result as any)?.answer) !== show("eu-west")) {
    run.failures.push(`a:once — wanted it completed on try 1 with the answer, its work run once; it is ${done?.status} on try ${done?.attempts}, work ${proofsOf(id, "work").length}, asked ${show(asked.map((p) => p.result))}`);
  }
  // The stopped request ended, so the queued message lands: one turn, after the task completed, outside it.
  await run.h.until(async () => (await messageRowOf(run, messageId))?.status === "delivered", 15_000);
  await run.h.idle();
  const landed = await messageRowOf(run, messageId);
  // (Its reply comes back to this same session, so a second turn is the reply's.)
  const heard = readProofs().filter((p) => p.kind === "message" && p.sessionId === sessionId);
  if (landed?.status !== "delivered" || landed.queuedBehind !== undefined || heard.length === 0 || heard.some((p) => p.claimed !== false) || heard.some((p) => p.at < (done?.completedAt ?? Infinity))) {
    run.failures.push(`a:message-after-stop — wanted the queued message to land once the stopped request ended: its row delivered, no longer queued, its turn after the task completed and outside it; row ${show(landed && { status: landed.status, queuedBehind: landed.queuedBehind })}, turns ${show(heard.map((p) => ({ claimed: p.claimed, at: p.at })))}, task completed at ${done?.completedAt}`);
  }
  const again = await answer(run, id, { action: "submit", data: "us-east" });
  if (!(await itemGone(run, id)) || again.status !== 409) {
    run.failures.push(`a:item-closed — wanted the item off the pending list and a second answer told it's resolved; listed ${(await pendingIn(sessionId)).length}, second answer ${again.status}`);
  }
  run.notes.push(`a: waited past ${3 * LEASE_MS} ms on try 1, listed (${pending.length}), refused across tenant and org (${tenant.status}/${org.status}), answered once, the piece's notice ran during the stop; a message meanwhile queued behind the stop and landed after the task completed, outside it`);
}

/** b. Deadlines: input unhandled fails try 1, caught completes, approval is a no that runs no step again. */
async function legB(run: Run): Promise<void> {
  const unhandled = await file(run, word("[ask:input][deadline:1500] unhandled"));
  const caught = await file(run, word("[ask:input][deadline:1500][catch] caught"));
  const approval = await file(run, word("[ask:approval][deadline:1500] approval"));
  for (const id of [unhandled, caught, approval]) if (!(await untilWaiting(run, id, "b"))) return;
  await run.h.until(async () => (await run.h.byId(caught))?.status === "completed" && (await run.h.byId(approval))?.status === "completed", 20_000);
  await run.h.until(async () => ((await run.h.byId(unhandled))?.attempts ?? 0) >= 2 || (await run.h.byId(unhandled))?.status === "errored", 20_000);
  await run.h.idle();
  const failedTry = proofsOf(unhandled, "asked").find((p) => p.error === "SuspensionTimeoutError");
  const u = await run.h.byId(unhandled);
  if (failedTry === undefined || ((u?.attempts ?? 0) < 2 && u?.status !== "errored")) {
    run.failures.push(`b:input-fails-try — wanted an unhandled input's deadline to throw and fail try 1; threw ${show(proofsOf(unhandled, "asked").map((p) => p.error))}, row ${u?.status} on try ${u?.attempts}`);
  }
  const c = await run.h.byId(caught);
  if (c?.status !== "completed" || c.attempts !== 1 || !String(c.output).includes("wentAhead")) {
    run.failures.push(`b:input-caught — wanted a caught deadline to complete try 1; it is ${c?.status} on try ${c?.attempts}, output ${show(c?.output)}`);
  }
  const a = await run.h.byId(approval);
  const said = proofsOf(approval, "asked")[0]?.result as { approved?: boolean; deadline?: boolean } | undefined;
  if (a?.status !== "completed" || a.attempts !== 1 || said?.approved !== false || said?.deadline !== true || proofsOf(approval, "work").length !== 1) {
    run.failures.push(`b:approval-no — wanted an approval at its deadline to read as a no on try 1, its work run once; it is ${a?.status} on try ${a?.attempts}, read ${show(said)}, work ${proofsOf(approval, "work").length}`);
  }
  for (const id of [caught, approval]) {
    if (!(await itemGone(run, id))) run.failures.push(`b:item-closed — ${id}'s item is still listed after its deadline`);
  }
  // The unhandled input asks again on its next try: cancel it, so it doesn't stay.
  await run.h.act(run.conversation, "updateTask_tasks", { id: unhandled, status: "cancelled" }).catch(() => undefined);
  await run.h.idle();
  run.notes.push(`b: the unhandled input failed try 1 (${failedTry?.error}), the caught one completed, the approval read as a no at its deadline with its work run once`);
}

/** c. Cancelled: the block runs on once with nothing kept; a later answer is told it's resolved. */
async function legC(run: Run): Promise<void> {
  const id = await file(run, word("[ask:approval][then-report][then-file] cancel me"));
  if (!(await untilWaiting(run, id, "c"))) return;
  const cancelled = await run.h.act(run.conversation, "updateTask_tasks", { id, status: "cancelled" });
  const after = await answer(run, id, { action: "approve" });
  await run.h.idle();
  const asked = proofsOf(id, "asked");
  if (asked.length !== 1 || (asked[0]?.result as { cancelled?: boolean } | undefined)?.cancelled !== true) {
    run.failures.push(`c:runs-on-once — wanted the block to resume cancelled once; it read ${show(asked.map((p) => p.result ?? p.error))} (cancel answered ${show(cancelled)})`);
  }
  if (after.status !== 409 && after.status !== 404) {
    run.failures.push(`c:answer-after-cancel — wanted an answer after the cancel told the stop is resolved; it got ${after.status}`);
  }
  const report = proofsOf(id, "report")[0]?.outcome;
  const filed = proofsOf(id, "file")[0]?.outcome;
  if (report === undefined || report === "recorded" || filed === undefined || !filed.startsWith("refused")) {
    run.failures.push(`c:writes-refused — wanted its progress write and its filing refused; report ${report}, filing ${filed}`);
  }
  const row = await run.h.byId(id);
  const open = (await run.h.rows()).filter((r) => r.filedByTask === id && r.status !== "cancelled" && r.status !== "completed" && r.status !== "errored");
  if (row?.status !== "cancelled" || row.output !== undefined || row.checkpointed === true || open.length !== 0) {
    run.failures.push(`c:stays-cancelled — wanted it cancelled with no output and no open child; it is ${row?.status}, output ${show(row?.output)}, open children ${open.length}`);
  }
  if (!(await itemGone(run, id))) run.failures.push("c:item-closed — its item is still listed after the cancel");
  // An answer and a cancel at once: one wins, the stop resumes once.
  const raced = await file(run, word("[ask:approval] race me"));
  if (!(await untilWaiting(run, raced, "c"))) return;
  const [answeredRace] = await Promise.all([
    answer(run, raced, { action: "approve" }),
    run.h.act(run.conversation, "updateTask_tasks", { id: raced, status: "cancelled" }).catch(() => undefined)
  ]);
  await run.h.idle();
  const racedAsks = proofsOf(raced, "asked");
  const racedRow = await run.h.byId(raced);
  if (racedAsks.length !== 1 || racedRow?.status !== "cancelled") {
    run.failures.push(`c:race-once — wanted an answer and a cancel together to resume the stop once, and the task cancelled; resumes ${racedAsks.length}, row ${racedRow?.status}`);
  }
  run.notes.push(`c: resumed cancelled once, report ${report}, filing ${filed}, later answer ${after.status}; race: answer ${answeredRace.status}, ${racedAsks.length} resume`);
}

/**
 * c'. A cancelled block files on its task session's board while a claimer in
 * another process is latched into the moment right after a child's add commits:
 * the child must never be claimable there.
 */
async function legCPrime(run: Run, dbFile: string): Promise<void> {
  const added = join(SCRATCH, `cprime-added-${RUN_STAMP}`);
  const released = join(SCRATCH, `cprime-released-${RUN_STAMP}`);
  const claimerDone = join(SCRATCH, `cprime-claimer-${RUN_STAMP}.json`);
  const id = await file(run, word("[ask:input][then-file] file after the cancel"));
  if (!(await untilWaiting(run, id, "cprime"))) return;
  const { sessionId } = await runOf(run, id);
  // The latch: right after a piece of this task is added, hold the filing until the claimer has tried.
  (globalThis as { __goalAfterAdd?: (row: Task) => Promise<void> }).__goalAfterAdd = async (row) => {
    if (row.metadata?.["fsd.pieceOf"] === undefined && !row.goal.includes("piece after")) return;
    writeFileSync(added, row.id);
    for (let i = 0; i < 400 && !existsSync(released); i += 1) await sleep(50);
  };
  const claimer = spawn(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, GOAL_ROLE: "claimer", GOAL_DB: dbFile, GOAL_TASK_SESSION: sessionId ?? "", GOAL_ADDED: added, GOAL_RELEASED: released, GOAL_CLAIMER_DONE: claimerDone }
  });
  await run.h.act(run.conversation, "updateTask_tasks", { id, status: "cancelled" });
  await run.h.idle();
  await new Promise<void>((resolve) => claimer.once("exit", () => resolve()));
  delete (globalThis as { __goalAfterAdd?: unknown }).__goalAfterAdd;
  await run.h.idle();
  const claimed = existsSync(claimerDone) ? (JSON.parse(readFileSync(claimerDone, "utf8")) as { claimed: string[]; latched: boolean }) : undefined;
  const pieces = (await run.h.rows()).filter((r) => r.filedByTask === id);
  const ran = readProofs().filter((p) => p.kind === "piece" && pieces.some((r) => r.id === p.taskId));
  if (claimed === undefined) run.failures.push("cprime:claimer — the claimer process reported nothing");
  if ((claimed?.claimed.length ?? 0) > 0 || ran.length > 0 || pieces.some((r) => (r.attempts ?? 0) > 0)) {
    run.failures.push(`cprime:never-claimable — wanted no claimable child of the cancelled task; the claimer took ${show(claimed?.claimed)}, pieces ${show(pieces.map((r) => [r.status, r.attempts]))}, ran ${ran.length}`);
  }
  run.notes.push(`c': the filing ${proofsOf(id, "file")[0]?.outcome}; the claimer ${claimed?.latched ? "was latched into the add and" : "never saw an add and"} claimed ${claimed?.claimed.length ?? "?"}`);
}

/** d. Stopped: the run ends, its item closes, and the task is cancelled on try 1. */
async function legD(run: Run): Promise<void> {
  const id = await file(run, word("[ask:input] stop me"));
  if (!(await untilWaiting(run, id, "d"))) return;
  const { requestId, flowId, sessionId } = await runOf(run, id);
  const stopped = await run.h.http.call("POST", [flowId, "requests", requestId!, "abort"], {});
  await run.h.idle();
  await run.h.act(run.conversation, "listTasks_tasks", {});
  await run.h.idle();
  const row = await run.h.byId(id);
  const request = await run.h.runtime.stores.request.get(requestId!);
  if (row?.status !== "cancelled" || row.attempts !== 1) {
    run.failures.push(`d:cancelled-on-try-1 — wanted a stop to cancel the task on try 1; it is ${row?.status} on try ${row?.attempts} (stop answered ${stopped.status})`);
  }
  if (request?.status !== "aborted" || proofsOf(id, "asked").length !== 0 || proofsOf(id, "work").length !== 1) {
    run.failures.push(`d:run-ends — wanted the run ended aborted with no block run past the stop; request ${request?.status}, asked ${proofsOf(id, "asked").length}, work ${proofsOf(id, "work").length}`);
  }
  if ((await pendingIn(sessionId)).length !== 0) run.failures.push("d:item-closed — its item is still listed after the stop");
  run.notes.push(`d: the stop (${stopped.status}) ended the run ${request?.status} and cancelled the task on try ${row?.attempts}`);
}

/** e. A crash after the cancel's row write: after a restart, a board touch resumes the block cancelled. */
async function legE(run: Run, dbFile: string, restart: () => Promise<Run>): Promise<Run> {
  const latched = join(SCRATCH, `e-latched-${RUN_STAMP}`);
  const ids = join(SCRATCH, `e-ids-${RUN_STAMP}.json`);
  const host = spawn(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    detached: true,
    env: { ...process.env, GOAL_ROLE: "crash-host", GOAL_DB: dbFile, GOAL_CONVERSATION: run.conversation, GOAL_LATCHED: latched, GOAL_IDS: ids }
  });
  const sawLatch = await waitFile(latched, 60_000);
  killGroup(host);
  if (!sawLatch || !existsSync(ids)) {
    run.failures.push("e:latched — the crash host never reached the moment after the cancel's row write");
    return run;
  }
  const { taskId } = JSON.parse(readFileSync(ids, "utf8")) as { taskId: string };
  const next = await restart();
  const row = await next.h.byId(taskId);
  if (row?.status !== "cancelled" || proofsOf(taskId, "asked").length !== 0) {
    next.failures.push(`e:killed-between — wanted the row cancelled and the block not yet resumed when the host died; row ${row?.status}, resumes ${proofsOf(taskId, "asked").length}`);
  }
  // The dead host's resume lease runs out; then a board touch pays the cancel's debt.
  await sleep(RESUME_LEASE_MS + 2_000);
  await next.h.act(next.conversation, "listTasks_tasks", {});
  await next.h.until(async () => proofsOf(taskId, "asked").length > 0, 20_000);
  await next.h.idle();
  const asked = proofsOf(taskId, "asked");
  const { sessionId } = await runOf(next, taskId);
  if (asked.length !== 1 || (asked[0]?.result as { cancelled?: boolean } | undefined)?.cancelled !== true || (await pendingIn(sessionId)).length !== 0) {
    next.failures.push(`e:resumed-cancelled — wanted a board touch after the restart to resume the block cancelled and close its item; resumes ${show(asked.map((p) => p.result ?? p.error))}, listed ${(await pendingIn(sessionId)).length}`);
  }
  next.notes.push(`e: killed after the cancel's row write; after the restart and a board touch the block resumed ${show(asked[0]?.result)}`);
  return next;
}

/** f. The host's setting: waitForUser with none reads it; a raw ctx.suspend keeps its own. */
async function legF(run: Run): Promise<void> {
  const own = await file(run, word("[ask:input] the host's deadline"));
  const rawTimed = await file(run, word(`[raw:human_input:${RAW_TIMEOUT_MS}] a raw stop with its own`));
  const rawNone = await file(run, word("[raw:human_input] a raw stop with none"));
  for (const id of [own, rawTimed, rawNone]) if (!(await untilWaiting(run, id, "f"))) return;
  const deadlineOf = async (id: string) => {
    const row = await run.h.byId(id);
    const stop = await lastStopOf(run, id);
    const record = stop === undefined ? undefined : await run.h.runtime.runtimeConfig.durabilityProvider!.loadSuspension(stop.requestId, stop.suspensionId);
    return { row: stopHoldOf(row)?.due, record: record?.expiresAt, created: record?.createdAt ?? 0 };
  };
  const near = (at: number | undefined, created: number, span: number) => at !== undefined && Math.abs(at - created - span) < 5_000;
  const a = await deadlineOf(own);
  const b = await deadlineOf(rawTimed);
  const c = await deadlineOf(rawNone);
  if (!near(a.record, a.created, HOST_DEADLINE_MS) || a.row !== a.record) {
    run.failures.push(`f:host-setting — wanted a waitForUser with no deadline to persist the host's ${HOST_DEADLINE_MS} ms; it persisted ${show(a)}`);
  }
  if (!near(b.record, b.created, RAW_TIMEOUT_MS) || c.record !== undefined) {
    run.failures.push(`f:raw-keeps-its-own — wanted a raw ctx.suspend to keep its own timeoutMs, none meaning none; with ${RAW_TIMEOUT_MS} it persisted ${show(b)}, with none ${show(c)}`);
  }
  for (const id of [own, rawTimed, rawNone]) await run.h.act(run.conversation, "updateTask_tasks", { id, status: "cancelled" }).catch(() => undefined);
  await run.h.idle();
  run.notes.push(`f: waitForUser took the host's ${HOST_DEADLINE_MS} ms; a raw stop kept ${RAW_TIMEOUT_MS} ms and none. A held question's half is goals/task-board/holds-a-task-on-questions, leg f`);
}

/** g. No deadline: still waiting past the sweep's interval and a board touch. */
async function legG(run: Run): Promise<void> {
  const id = await file(run, word("[ask:input] no deadline"));
  if (!(await untilWaiting(run, id, "g"))) return;
  await sleep(SWEEP_MS * 2 + 2_000);
  await run.h.act(run.conversation, "listTasks_tasks", {});
  await run.h.idle();
  const row = await run.h.byId(id);
  const stop = await lastStopOf(run, id);
  const record = stop === undefined ? undefined : await run.h.runtime.runtimeConfig.durabilityProvider!.loadSuspension(stop.requestId, stop.suspensionId);
  const request = stop === undefined ? undefined : await run.h.runtime.stores.request.get(stop.requestId);
  const listed = await pendingIn((await runOf(run, id)).sessionId);
  const rowStop = stopHoldOf(row);
  if (request?.status !== "suspended" || record?.status !== "pending" || record.expiresAt !== undefined || rowStop === undefined || rowStop.due !== undefined || listed.length !== 1) {
    run.failures.push(`g:still-suspended — wanted a stop with no deadline still suspended and listed past the sweep's interval; request ${request?.status}, stop ${record?.status} expiring ${record?.expiresAt}, row ${row?.status}/${show(row?.holds)}, listed ${listed.length}`);
  }
  await run.h.act(run.conversation, "updateTask_tasks", { id, status: "cancelled" }).catch(() => undefined);
  await run.h.idle();
  run.notes.push(`g: no deadline set, still suspended and listed ${SWEEP_MS * 2 + 2_000} ms on`);
}

// ---- helpers for the other processes -----------------------------------------------

async function waitFile(path: string, ms: number): Promise<boolean> {
  for (const deadline = Date.now() + ms; Date.now() < deadline; await sleep(50)) if (existsSync(path)) return true;
  return existsSync(path);
}
function killGroup(child: ChildProcess): void {
  try {
    if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

/** The crash host (leg e): files a task, cancels it, and is killed right after the cancel's row write. */
async function crashHost(): Promise<void> {
  const host = buildHost(process.env.GOAL_DB!);
  const h = await host.connect();
  const run: Run = { h, conversation: process.env.GOAL_CONVERSATION!, failures: [], notes: [], tell: { over: (_n, v) => [...v] } as Tell };
  const id = await file(run, word("[ask:input] crash after the cancel"));
  await h.until(() => waitingOnUser(run, id), 15_000);
  writeFileSync(process.env.GOAL_IDS!, JSON.stringify({ taskId: id }));
  (globalThis as { __goalAfterCancelWrite?: () => Promise<void> }).__goalAfterCancelWrite = async () => {
    writeFileSync(process.env.GOAL_LATCHED!, "cancel written");
    await new Promise(() => undefined);
  };
  await h.act(run.conversation, "updateTask_tasks", { id, status: "cancelled" });
}

/** The claimer (leg c'): once a piece is added, touch the task session's board in this process, then release. */
async function claimer(): Promise<void> {
  const host = buildHost(process.env.GOAL_DB!);
  const h = await host.connect();
  const latched = await waitFile(process.env.GOAL_ADDED!, 15_000);
  const session = process.env.GOAL_TASK_SESSION!;
  const before = new Set((await h.rows()).filter((r) => (r.attempts ?? 0) > 0).map((r) => r.id));
  // The touch claims whatever on the board is startable.
  await h.http.act("doer", session, "listTasks_tasks", {}).catch(() => undefined);
  await h.idle();
  const claimed = (await h.rows()).filter((r) => (r.attempts ?? 0) > 0 && !before.has(r.id)).map((r) => r.id);
  writeFileSync(process.env.GOAL_CLAIMER_DONE!, JSON.stringify({ claimed, latched }));
  writeFileSync(process.env.GOAL_RELEASED!, "released");
  await host.state.dispose();
}

if (ROLE === "crash-host") {
  await crashHost();
  await new Promise(() => undefined);
} else if (ROLE === "claimer") {
  await claimer();
  process.exit(0);
} else {
  const LEGS: Record<string, (run: Run) => Promise<void>> = { a: legA, b: legB, c: legC, d: legD, g: legG };
  await runGoal(async (failures, tell) => {
    writeFileSync(PROOFS, "", "utf8");
    const dbFile = join(SCRATCH, `main-${RUN_STAMP}.sqlite`);
    let host = buildHost(dbFile);
    const notes: string[] = [];
    let run: Run = { h: await host.connect(), conversation: "", failures, notes, tell };
    run.conversation = await run.h.http.open("desk", { workerId: "lead" });
    try {
      for (const name of ALL_LEGS) {
        if (!legs.has(name) || name === "f") continue;
        const go =
          name === "cprime"
            ? () => legCPrime(run, dbFile)
            : name === "e"
              ? async () => {
                  await host.state.dispose();
                  run = await legE(run, dbFile, async () => {
                    host = buildHost(dbFile);
                    return { ...run, h: await host.connect() };
                  });
                }
              : () => LEGS[name]!(run);
        await go().catch((error: unknown) => failures.push(`${name}:threw — ${error instanceof Error ? error.stack ?? error.message : String(error)}`));
      }
    } finally {
      await host.state.dispose();
    }
    if (legs.has("f")) {
      // Its own host: the setting is set there.
      const fHost = buildHost(join(SCRATCH, `f-${RUN_STAMP}.sqlite`), { userDeadlineMs: HOST_DEADLINE_MS });
      try {
        const fRun: Run = { h: await fHost.connect(), conversation: "", failures, notes, tell };
        fRun.conversation = await fRun.h.http.open("desk", { workerId: "lead" });
        await legF(fRun).catch((error: unknown) => failures.push(`f:threw — ${error instanceof Error ? error.message : String(error)}`));
      } finally {
        await fHost.state.dispose();
      }
    }
    return { failures, evidence: notes.join("\n") };
  });
}
