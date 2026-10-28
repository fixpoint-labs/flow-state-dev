/**
 * Goal check: a worker on a task gets a result from one of its delegates by
 * filing a piece, ending its turn, and finishing its task from its own reading
 * of that result (FIX-1997; delegates only since FIX-2081). The tree, the
 * legs, the controls and what each must fail are in goal.md.
 *
 * Run: pnpm tsx goals/workforce/split-to-roster/run.mts
 * Controls: GOAL_CONTROL=first-answer | hold-session | wake-coordinator
 * Legs: GOAL_LEGS=1,2,3,4 (default: all; leg 4 grades what 1 to 3 left)
 */
import { spawnSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import { createFlowState, createModelResolver } from "@flow-state-dev/engine";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import {
  createWorkerInstallation,
  defineAgentWorkerFlow,
  defineSessionBoard,
  hireWorkforce,
  workerConfigSchema,
  workerTaskEntry
} from "@flow-state-dev/workforce";
import { readWorkforce } from "@flow-state-dev/workforce/loader";
import {
  REPO_ROOT,
  RUN_STAMP,
  assertPatched,
  describePatches,
  gatewayModel,
  goalModel,
  goalTmpDir,
  actingAs,
  keysServing,
  modulePatchEnv,
  runGoal,
  silentLogger,
  type ModulePatch
} from "../../lib/index.mts";

const TREE = fileURLToPath(new URL("./fixtures/workforce", import.meta.url));
const USER_ID = "u_split_to_roster";
const ORG_ID = "org_split_to_roster";
const SCRATCH = goalTmpDir("split-to-roster");
const CONTROL = process.env.GOAL_CONTROL ?? "";
const MODEL = gatewayModel(goalModel());
/** How long B holds its answer: the window leg 1 reads A's waiting task in. */
const KEEPER_HOLD_MS = 4_000;
/** How long the run waits for everything a leg started to end. */
const QUIET_BUDGET_MS = 300_000;
/** A pause after quiet, so a dispatch accepted just now is counted. */
const GRACE_MS = 3_000;

const A = "crew.reporter";
const B = "crew.keeper";
const BROKEN = "crew.broken";
const DESK = "crew.desk";

// ---- controls ---------------------------------------------------------------------

const CONTROLS: Record<string, { patches: ModulePatch[]; legs: string[]; assertions: string[] }> = {
  "first-answer": {
    legs: ["1"],
    assertions: ["1:report-is-output"],
    patches: [
      {
        // Only an answer given before the task first waited is noted: a turn
        // woken by B's ending (admitted while the task waits on `filed`) and a
        // `getTask` wait's resume (admitted while it waits on `wait`) give
        // answers that never count. So a task whose turn ended completes with
        // A's first answer, from before B answered (FIX-2077 D3), and one whose
        // turn parked on the piece keeps waiting with no answer.
        module: "packages/orchestration/src/task-board/task-request.ts",
        from: String.raw`if \(record\.answerCounts\) record\.answer = \{ output \};`,
        to: "if (record.answerCounts && record.prior === undefined) record.answer = { output };"
      }
    ]
  },
  "hold-session": {
    legs: ["1"],
    assertions: ["1:waiting-while-b-works"],
    patches: [
      {
        // A `getTask` wait holds its request open past B's hold before it takes
        // the piece's wait slot, so A's turn runs on in its session while B
        // works, and reads B's ending without parking.
        module: "packages/orchestration/src/tasks/helpers/wait-on-task.ts",
        from: String.raw`\n    const marked = await collection\.markWait!\(taskId, \{`,
        to: `\n    await new Promise((resolve) => setTimeout(resolve, ${KEEPER_HOLD_MS + 2_000}));\n    const marked = await collection.markWait!(taskId, {`
      }
    ]
  },
  "wake-coordinator": {
    legs: ["1", "4"],
    assertions: ["4:desk-hears-tasks-only"],
    patches: [
      {
        // A task session reaches the desk's board as its own, so A's pieces
        // are filed on the desk's board...
        module: "packages/workforce/src/conversation-board/board.ts",
        // The resolver's line: the only one at this depth.
        from: String.raw`(?<! ) {4}const partition = await filingSessionIdOf\(ctx\.session\);`,
        to: "    const partition = (ctx.session.state ?? {}).filingSessionId ?? (await filingSessionIdOf(ctx.session));"
      },
      {
        // ...and stamped with the desk as their filer, so their endings are
        // delivered to the desk. A notice goes to a row's filer, not to the
        // board's owner (FIX-2078), so the first patch alone leaves the desk
        // hearing nothing.
        module: "packages/orchestration/src/tasks/collection/get-or-create.ts",
        from: String.raw`ownSession: sessionId,`,
        to: 'ownSession: typeof (ctx.session?.state ?? {}).filingSessionId === "string" ? ctx.session.state.filingSessionId.slice(0, ctx.session.state.filingSessionId.lastIndexOf("~")) : sessionId,'
      }
    ]
  }
};

if (CONTROL !== "" && CONTROLS[CONTROL] === undefined) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(CONTROLS).join(", ")}`);
  process.exit(2);
}
const control = CONTROL === "" ? undefined : CONTROLS[CONTROL]!;

// A control runs this same file again with its patch applied as it loads, and
// checks the patch reached the code it names.
if (control !== undefined && process.env.GOAL_MODULE_PATCH === undefined) {
  const mark = join(SCRATCH, `patch-mark-${RUN_STAMP}`);
  rmSync(mark, { force: true });
  console.error(`control ${CONTROL}:\n${describePatches(control.patches, REPO_ROOT)}`);
  const child = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, GOAL_LEGS: process.env.GOAL_LEGS ?? control.legs.join(","), ...modulePatchEnv(control.patches, REPO_ROOT, mark) }
  });
  assertPatched(control.patches, REPO_ROOT, mark);
  process.exit(child.status ?? 1);
}

const legs = new Set((process.env.GOAL_LEGS ?? "1,2,3,4").split(",").map((s) => s.trim()).filter(Boolean));
const say = (s: string) => console.error(`[split-to-roster ${new Date().toISOString().slice(11, 19)}] ${s}`);
const show = (value: unknown) => JSON.stringify(value)?.slice(0, 600);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A fresh codename, held nowhere but in `crew.keeper`'s answer. */
function codename(): string {
  const parts = ["amber", "basalt", "cobalt", "delta", "ember", "fjord", "garnet", "harbor", "indigo", "juniper", "kestrel", "lumen"];
  return `${parts[randomInt(parts.length)]}-${parts[randomInt(parts.length)]}-${randomInt(100, 1000)}`;
}

// ---- the app ----------------------------------------------------------------------

/** What the goal-local flows saw, kept across a restart of the host. */
const seen = {
  /** The codename `crew.keeper` answers with this round. */
  codename: "",
  /** Every message the desk's turn was handed. */
  deskTurns: [] as Array<{ sessionId: string; message: string }>,
  /** Every run of a `taker` worker, when it started. */
  takerRuns: [] as Array<{ worker: string; taskId: string; at: number }>
};

const tree = await readWorkforce(TREE);
if (tree.errors.length > 0) throw new Error(`the tree did not load: ${JSON.stringify(tree.errors).slice(0, 600)}`);

/** Build the app over the SQLite file `db`: the same flows and store on every start. */
function startHost(db: string) {
  let flows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({ standardWorkers: tree.workers, workerFlows: () => flows as never });
  const doorInput = z.object({ message: z.string() });

  const deskBoard = defineSessionBoard({ installation, flowKind: "desk" });
  const deskTurn = handler({
    name: "split-to-roster-desk-turn",
    inputSchema: doorInput,
    execute: async (input, ctx) => {
      seen.deskTurns.push({ sessionId: ctx.session.identity.id, message: input.message });
      return "Noted.";
    }
  });
  const desk = defineFlow({
    kind: "desk",
    configSchema: workerConfigSchema(),
    session: { ...installation.session(deskBoard.sessionStateShape), serverOwned: [...deskBoard.serverOwned] },
    resources: { ...installation.resources, ...deskBoard.resources },
    actions: {
      respond: { inputSchema: doorInput.strict(), block: deskTurn, userMessage: (input: { message: string }) => input.message },
      ...deskBoard.actions
    },
    internal: { actions: deskBoard.entries(deskTurn) }
  } as never);

  const takerTurn = handler({
    name: "split-to-roster-taker-turn",
    inputSchema: doorInput,
    resources: { ...installation.resources },
    execute: async (_input, ctx) => {
      const worker = (await installation.resolveWorker(ctx, "taker")).id;
      const taskId = String((ctx.session.state as Record<string, unknown>).taskId);
      seen.takerRuns.push({ worker, taskId, at: Date.now() });
      if (worker === BROKEN) throw new Error(`${worker} can't reach its codename book`);
      if (worker === B) {
        await sleep(KEEPER_HOLD_MS);
        return `The codename is ${seen.codename}.`;
      }
      return "I don't hold any codename.";
    }
  });
  const taker = defineFlow({
    kind: "taker",
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { ...installation.resources },
    actions: { respond: { inputSchema: doorInput, block: takerTurn, userMessage: (input: { message: string }) => input.message } },
    task: { actions: { work: workerTaskEntry({ name: "split-to-roster-taker-task", turn: takerTurn }) } }
  } as never);

  flows = {
    agent: defineAgentWorkerFlow({ installation }),
    desk: { flow: desk, roles: ["manager"] },
    taker: { flow: taker, roles: ["contributor"] }
  };

  const real = createModelResolver() as unknown as (id: string, block?: string) => unknown;
  const modelResolver = Object.assign((id: string, block?: string) => real(id === "goal/real" ? MODEL : id, block), {
    resolveId: (id: string) => (id === "goal/real" ? MODEL : id)
  });

  return createFlowState({
    flows: Object.fromEntries(hireWorkforce(installation).map((copy) => [copy.id, copy])),
    stores: { default: { primary: sqliteStores({ filename: db }) } },
    logger: silentLogger,
    modelResolver,
    // A restart stops at once: leg 3's stop lands between B's ending and A's woken turn.
    dispatchDrainTimeoutMs: 0,
    // Durable by default on SQLite, so it keeps wakes: after leg 3's restart,
    // the notice the stop cut off is delivered again (FIX-2078).
    resolvePrincipal: (context: any) => {
      const user = context.request?.headers.get("x-user");
      return typeof user === "string" ? { userId: user, orgId: ORG_ID } : null;
    }
  } as never);
}

// ---- reading the store ------------------------------------------------------------

type Host = ReturnType<typeof startHost>;
type Row = Task & { partition: string };

async function storeOf(host: Host) {
  const runtime = await host.getRuntime();
  const stores = runtime.stores as any;
  return {
    /** Every row of the person's conversation ledger, read from the store. */
    rows: async (): Promise<Row[]> =>
      Object.entries(await stores.resourceState.getByPrefix("user", `${USER_ID}:~org:${ORG_ID}`, "tasks/")).map(([key, value]: [string, any]) => ({
        ...(value.state as Task),
        partition: key.split("/")[1]!
      })),
    session: async (id: string) => stores.session.get(id),
    requests: async (sessionId: string): Promise<any[]> =>
      ((await stores.request.list({ sessionId, withItems: true })) as any[]).sort((a, b) => a.createdAt - b.createdAt),
    running: async (): Promise<number> => (await stores.request.list({ status: "in_progress", orderBy: "none", limit: 1 })).length
  };
}

/** Wait until nothing runs, twice across a grace, or the budget runs out. */
async function quiet(host: Host, budgetMs = QUIET_BUDGET_MS): Promise<boolean> {
  const store = await storeOf(host);
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if ((await store.running()) === 0) {
      await sleep(GRACE_MS);
      if ((await store.running()) === 0) return true;
    }
    await sleep(200);
  }
  return false;
}

const pieceOf = (row: Row): string | undefined => {
  const value = (row.metadata as Record<string, unknown> | undefined)?.pieceOf;
  return typeof value === "string" ? value : undefined;
};
/** A task's output as text: its worker's answer (FIX-2077 D3). */
const answerText = (output: unknown): string | undefined => {
  if (output === undefined) return undefined;
  return typeof output === "string" ? output : JSON.stringify(output);
};

// ---- the run ----------------------------------------------------------------------

await runGoal(async (failures) => {
  const key = keysServing(MODEL).find((k) => (process.env[k] ?? "") !== "");
  if (key === undefined) return { failures: [`blocked: no key here serves ${MODEL}; none of ${keysServing(MODEL).join(", ")} is set`], evidence: "" };

  const db = join(SCRATCH, `${RUN_STAMP}-${CONTROL || "plain"}.sqlite`);
  say(`store ${db}; model ${MODEL}; legs ${[...legs].join(", ")}${control === undefined ? "" : `; control ${CONTROL}`}`);
  let host = startHost(db);
  const filed: string[] = [];
  const notes: string[] = [];

  try {
    let http = actingAs((await host.getRouter()) as any, USER_ID);
    const conv = await http.open("desk", { workerId: DESK });

    /** File `goal` for A from the desk, as the person does. Its task id. */
    const fileForA = async (goal: string): Promise<string> => {
      const out = await http.act("desk", conv, "createTask_tasks", { goal, assignee: A });
      if (out?.ok !== true) throw new Error(`filing for ${A} was refused: ${show(out)}`);
      filed.push(out.taskId);
      return out.taskId as string;
    };
    /** The ask: a codename `holder` keeps, one of A's delegates. */
    const ask = (what: string, holder: string) =>
      `Find out this ${what}'s codename and write me a one-sentence report that states it. ${holder}, one of your delegates, keeps it.`;
    /** A's task session for `taskId`: the session its row's run names. */
    const sessionOf = (row: Row | undefined): string | undefined => (row as { run?: { sessionId?: string } } | undefined)?.run?.sessionId;

    // ---- leg 1 --------------------------------------------------------------------
    if (legs.has("1")) {
      seen.codename = codename();
      say(`leg 1: the codename is ${seen.codename}`);
      const taskId = await fileForA(ask("release", B));
      // While B works: A's task running, waiting on its piece, and nothing
      // running in A's task session. Read the moment A's own turn has ended
      // while B's piece is still running: an event, not a fixed delay. A turn
      // ends one of two ways, each after its end-of-request check has run:
      // its request finalized (the task waits on `filed`), or its request
      // parked on the wait gate of B's piece, a `getTask` wait (`suspended`,
      // and the piece's wait slot names it; the task waits on `wait`). A
      // request still `in_progress` holds the session. Once the turn has
      // ended, the read waits for nothing to run in the session (the board's
      // own short pass may follow a park), still while B works. B finishing
      // first, or while something still runs there, is a failure of its own.
      const store = await storeOf(host);
      let during: {
        ended?: "finished" | "parked";
        status?: string;
        keptOpenBy?: unknown;
        lease?: unknown;
        running?: number;
        at?: number;
        bEndedFirst?: boolean;
        /** What still ran in A's task session when B ended, after A's turn had. */
        busy?: string[];
      } = {};
      let busy: string[] | undefined;
      for (const deadline = Date.now() + 240_000; Date.now() < deadline; await sleep(25)) {
        const rows = await store.rows();
        const piece = rows.find((r) => r.assignee === B && pieceOf(r) === taskId);
        const top = rows.find((r) => r.id === taskId);
        if (piece !== undefined && seen.takerRuns.some((r) => r.taskId === piece.id)) {
          const own = sessionOf(top);
          const runId = (top as { run?: { requestId?: string } } | undefined)?.run?.requestId;
          const turn = own === undefined || runId === undefined ? undefined : (await store.requests(own)).find((r) => r.id === runId);
          const slot = (piece as { wait?: { requestId?: string; lapsed?: true } }).wait;
          const ended =
            turn?.finalizedAtMs != null
              ? "finished"
              : turn?.status === "suspended" && slot?.requestId === runId && slot?.lapsed !== true
                ? "parked"
                : undefined;
          if (ended === undefined) {
            if (["completed", "errored", "cancelled"].includes(piece.status)) {
              during = { bEndedFirst: true, at: Date.now() };
              break;
            }
            continue;
          }
          const inSession = (await store.requests(own!)).filter((r) => r.status === "in_progress");
          const now = (await store.rows()).find((r) => r.id === taskId);
          const stillWorking = !["completed", "errored", "cancelled"].includes((await store.rows()).find((r) => r.id === piece.id)?.status ?? "");
          if (!stillWorking) {
            during = { bEndedFirst: true, busy, at: Date.now() };
            break;
          }
          if (inSession.length > 0) {
            busy = inSession.map((r) => `${r.actionName}:${r.id}`);
            continue;
          }
          during = { ended, status: now?.status, keptOpenBy: (now as { keptOpenBy?: unknown } | undefined)?.keptOpenBy, lease: now?.leaseUntil, running: 0, at: Date.now() };
          break;
        }
        if (top !== undefined && ["completed", "errored", "cancelled"].includes(top.status)) break;
      }
      await quiet(host);
      const rows = await store.rows();
      const top = rows.find((r) => r.id === taskId);
      const pieces = rows.filter((r) => pieceOf(r) === taskId);
      const toB = pieces.filter((r) => r.assignee === B);
      const own = sessionOf(top);
      const tried = own === undefined ? [] : (await store.requests(own)).flatMap((r) => (r.items ?? []) as any[]).filter((i) => i.type === "tool_output" && i.toolCall?.name === "createTask");
      if (toB.length === 0) {
        failures.push(
          `1:piece-to-delegate — wanted A's task session to file a piece for its delegate ${B}; its pieces ${show(pieces.map((p) => [p.assignee, p.status]))}, its createTask calls answered ${show(tried.map((i) => i.output ?? i.result ?? i))}`
        );
      }
      if (during.bEndedFirst === true) {
        failures.push(
          during.busy === undefined
            ? `1:waiting-while-b-works — wanted A's turn to end while ${B} still worked; ${B}'s piece ended before A's turn did, so the wait was never observed`
            : `1:waiting-while-b-works — wanted nothing running in A's task session while ${B} still worked; A's turn ended, but ${show(during.busy)} still ran there until ${B}'s piece ended`
        );
      } else if (
        during.status !== "in_progress" ||
        during.keptOpenBy !== (during.ended === "parked" ? "wait" : "filed") ||
        during.lease != null ||
        during.running !== 0
      ) {
        failures.push(
          `1:waiting-while-b-works — wanted A's task running, waiting on its piece (\`filed\` for a finished turn, \`wait\` for one parked on the piece) with no lease, and no request running in its session once A's turn ended while ${B} worked; read ${show(during)}`
        );
      }
      const answer = answerText(top?.output);
      if (top?.status !== "completed" || answer === undefined || !answer.includes(seen.codename) || toB.some((p) => p.status !== "completed")) {
        failures.push(`1:report-is-output — wanted A's task completed with its woken turn's report as its output, holding ${seen.codename}, after ${B}'s piece completed; it is ${top?.status ?? "missing"}, output ${show(top?.output)}`);
      }
      notes.push(`leg 1: ${taskId} ${top?.status}; pieces ${show(pieces.map((p) => `${p.assignee}:${p.status}`))}; during B ${show(during)}; answer ${show(answer)}`);
    }

    // ---- leg 2 --------------------------------------------------------------------
    if (legs.has("2")) {
      const taskId = await fileForA(ask("launch", BROKEN));
      await quiet(host);
      const store = await storeOf(host);
      const rows = await store.rows();
      const top = rows.find((r) => r.id === taskId);
      const pieces = rows.filter((r) => pieceOf(r) === taskId);
      const failed = pieces.filter((r) => r.assignee === BROKEN && r.status === "errored");
      const own = sessionOf(top);
      // The turns a piece's failure for good woke in A's task session.
      const woken =
        own === undefined
          ? []
          : (await store.requests(own)).filter((r) => r.actionName === "onTaskSettled" && r.status === "completed" && (r.input as { ending?: string } | undefined)?.ending === "errored");
      // Filed again in a turn after the failure: more pieces than the first.
      const refiled = pieces.length > 1;
      // The woken turn decides (D3): the task completes with its answer, or fails when that turn throws.
      const ended = top !== undefined && (top.status === "errored" || top.status === "completed");
      if (failed.length === 0 || woken.length === 0 || !ended) {
        failures.push(
          `2:reads-the-failure — wanted ${BROKEN}'s piece to fail for good, A's woken turn to read it, and A's task to end through that turn; pieces ${show(pieces.map((p) => [p.assignee, p.status]))}, woken turns ${woken.length}, A's task ${top?.status ?? "missing"} ${show(top?.error ?? top?.output)}`
        );
      }
      notes.push(`leg 2: ${taskId} ${top?.status}; pieces ${show(pieces.map((p) => `${p.assignee}:${p.status}`))}; woken ${woken.length}; refiled ${refiled}`);
    }

    // ---- leg 3 --------------------------------------------------------------------
    if (legs.has("3")) {
      // The stop must land after B's piece ended and before A's task session
      // acted on its notice: no notice request there has ended or started the
      // turn it wakes. The notice request itself is filed with the piece's
      // ending, so a poll never sees the piece ended without it. Polling can
      // miss that window, so an attempt that stopped late is set aside and the
      // leg is tried again.
      let taskId = "";
      let atStop: { top?: string; piece?: string; noticesEnded?: number; wokenTurns?: number } = {};
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        seen.codename = codename();
        taskId = await fileForA(ask("patch", B));
        const store = await storeOf(host);
        atStop = {};
        for (const deadline = Date.now() + 240_000; Date.now() < deadline; await sleep(5)) {
          const rows = await store.rows();
          const piece = rows.find((r) => r.assignee === B && pieceOf(r) === taskId);
          const top = rows.find((r) => r.id === taskId);
          if (piece?.status === "completed" || (top !== undefined && ["completed", "errored", "cancelled"].includes(top.status))) {
            const own = sessionOf(top);
            const notices = own === undefined ? undefined : (await store.requests(own)).filter((r) => r.actionName === "onTaskSettled");
            const noticesEnded = notices === undefined ? -1 : notices.filter((r) => r.status !== "pending" && r.status !== "in_progress").length;
            const wokenTurns = notices === undefined ? -1 : notices.flatMap((r) => (r.items ?? []) as any[]).filter((i) => i.type === "block_trace" && i.blockName === "conversation-woken-turn" && i.status !== "planned").length;
            atStop = { top: top?.status, piece: piece?.status, noticesEnded, wokenTurns };
            break;
          }
        }
        say(`leg 3 attempt ${attempt}: stopping the host at ${show(atStop)}`);
        await host.dispose();
        host = startHost(db);
        http = actingAs((await host.getRouter()) as any, USER_ID);
        if (atStop.top === "in_progress" && atStop.piece === "completed" && atStop.noticesEnded === 0 && atStop.wokenTurns === 0) break;
        // Stopped late: let that task finish before the next attempt.
        await http.act("desk", conv, "listTasks_tasks", {});
        await quiet(host);
      }
      const store = await storeOf(host);
      // The person looks at the board again; then everything it starts ends.
      await http.act("desk", conv, "listTasks_tasks", {});
      await quiet(host);
      await http.act("desk", conv, "listTasks_tasks", {});
      await quiet(host);
      const top = (await store.rows()).find((r) => r.id === taskId);
      const deskState = (await store.session(conv))?.state as { taskNotices?: string[] } | undefined;
      const heard = (deskState?.taskNotices ?? []).filter((k) => k.startsWith(`${taskId}:`) && k.endsWith(":completed"));
      const told = seen.deskTurns.filter((t) => t.message.includes(`(${taskId}) completed`));
      if (atStop.top !== "in_progress" || atStop.piece !== "completed" || atStop.noticesEnded !== 0 || atStop.wokenTurns !== 0 || top?.status !== "completed" || heard.length !== 1 || told.length !== 1) {
        failures.push(
          `3:settles-once — wanted the host stopped after B's piece ended and before A's task session acted on its notice, and after the start the task completed and the desk heard it once; at the stop ${show(atStop)}, now ${top?.status ?? "missing"}, heard ${show(heard)}, desk turns on it ${told.length}`
        );
      }
      notes.push(`leg 3: at the stop ${show(atStop)}; now ${top?.status}; output ${show(top?.output)}; heard ${heard.length}`);
    }

    // ---- leg 4 --------------------------------------------------------------------
    if (legs.has("4")) {
      // The person reads the board once more, so anything waiting on it runs.
      await http.act("desk", conv, "listTasks_tasks", {});
      await quiet(host);
      const store = await storeOf(host);
      const rows = await store.rows();
      const deskNotices = (await store.requests(conv)).filter((r) => r.actionName === "onTaskSettled");
      const named = deskNotices.map((r) => (r.input as { taskId?: string } | undefined)?.taskId).filter((id): id is string => id !== undefined);
      const strangers = [...new Set(named.filter((id) => !filed.includes(id)))];
      // A notice turn names its task first: `Task "<goal>" (<id>) ...`. A task's
      // own ending may go on to name its pieces; that is the task's, not theirs.
      const pieceTurns = seen.deskTurns.filter((t) => {
        const id = /^Task "[\s\S]*?" \((task_[A-Za-z0-9]+)\)/.exec(t.message)?.[1];
        return id !== undefined && rows.some((r) => r.id === id) && !filed.includes(id);
      });
      if (strangers.length > 0 || pieceTurns.length > 0) {
        failures.push(
          `4:desk-hears-tasks-only — wanted every ending the desk heard to be a task the person filed, never a piece's; notices for ${show(strangers)}, turns on a piece ${show(pieceTurns.map((t) => t.message.slice(0, 160)))}`
        );
      }
      notes.push(`leg 4: the desk acted on notices for ${show([...new Set(named)])}; it filed ${show(filed)}; ${seen.deskTurns.length} desk turns`);
    }
  } finally {
    await host.dispose();
  }

  for (const note of notes) say(note);
  if (control !== undefined) {
    for (const assertion of control.assertions) {
      if (!legs.has(assertion.split(":")[0]!)) continue;
      const named = failures.some((f) => f.startsWith(`${assertion} `));
      failures.unshift(
        named ? `control ${CONTROL}: ${assertion} failed, as it must` : `control ${CONTROL}: ${assertion} did NOT fail, so the check can't see what the control removes`
      );
    }
  }
  return { failures, evidence: `legs ${[...legs].join(", ")} on ${MODEL}; ${notes.join(" | ")}` };
});
