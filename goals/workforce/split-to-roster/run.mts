/**
 * Goal check: a worker on a task gets a result from any task-taking worker on
 * the roster by filing a piece, ending its turn, and finishing its task from
 * its own reading of that result, with nothing held open while it waits
 * (FIX-1997). See goal.md.
 *
 * One in-process host on the real engine and a SQLite store, acted on over its
 * HTTP router as one verified person (`httpActions`). The tree
 * (`fixtures/workforce/`):
 *
 * - `crew.desk`, on the goal-local `desk` flow: the person's conversation. Its
 *   turn runs no model; it records every message it is handed, so leg 4 reads
 *   what the desk heard. Its one delegate is `crew.reporter`.
 * - `crew.reporter` (worker A), on the built-in `agent` flow and a real model.
 *   Its one delegate is `crew.helper`.
 * - `crew.keeper` (worker B), `crew.broken` and `crew.helper`, on the
 *   goal-local `taker` flow, none of them A's delegate but `crew.helper`.
 *   `crew.keeper` answers with this round's codename, made fresh per leg and
 *   held nowhere else, after a short hold; `crew.broken` fails every attempt;
 *   `crew.helper` holds no codename.
 *
 * Legs:
 *   1  A, on a task, reports a codename only B holds: A files a piece to B and
 *      its turn ends; A's task is parked with no request running while B
 *      works; B completes; A's woken turn writes a report; A's task completes
 *      with that report as its answer, holding the codename.
 *   2  B fails for good: A's woken turn reads the failure, and A's task fails
 *      or files again.
 *   3  The host stops between B's ending and A's woken turn, and starts again
 *      over the same store: A's task settles once.
 *   4  Across legs 1 to 3, the desk is never handed a piece's ending: every
 *      ending it hears is a task the person filed.
 *
 * Controls (GOAL_CONTROL=...), each a scratch patch to Workforce applied as
 * this process loads it (`goals/lib/module-patch.mts`):
 *   delegates-only    a task session files for its delegates only. FAILS 1.
 *   pieces-output     the settle ignores the woken turn's answer. FAILS 1.
 *   wake-coordinator  a task session files its pieces on the board above, the
 *                     desk's, so each piece's ending is the desk's. FAILS 4.
 *
 * Run: pnpm tsx goals/workforce/split-to-roster/run.mts
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
  httpActions,
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
/** How long B holds its answer: the window leg 1 reads A's parked task in. */
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
  "delegates-only": {
    legs: ["1"],
    assertions: ["1:piece-to-roster"],
    patches: [
      {
        module: "packages/workforce/src/conversation-board/board.ts",
        from: String.raw`if \(typeof state\[TASK_ID_STATE_KEY\] !== "string"\) return delegates;`,
        to: "return delegates;"
      }
    ]
  },
  "pieces-output": {
    legs: ["1"],
    assertions: ["1:report-is-output"],
    patches: [
      {
        module: "packages/workforce/src/conversation-board/split.ts",
        from: String.raw`const answer = wokenAnswerOf\(ctx\);`,
        to: "const answer = undefined;"
      }
    ]
  },
  "wake-coordinator": {
    legs: ["1", "4"],
    assertions: ["4:desk-hears-tasks-only"],
    patches: [
      {
        module: "packages/workforce/src/conversation-board/board.ts",
        // The resolver's line: the only one at this depth.
        from: String.raw`(?<! ) {4}const partition = await filingSessionIdOf\(ctx\.session\);`,
        to: "    const partition = (ctx.session.state ?? {}).filingSessionId ?? (await filingSessionIdOf(ctx.session));"
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
      run: { inputSchema: doorInput.strict(), block: deskTurn, userMessage: (input: { message: string }) => input.message },
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
    actions: { run: { inputSchema: doorInput, block: takerTurn, userMessage: (input: { message: string }) => input.message } },
    task: { actions: { work: workerTaskEntry({ name: "split-to-roster-taker-task", turn: takerTurn }) } }
  } as never);

  flows = { agent: defineAgentWorkerFlow({ installation }), desk, taker };

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
const answerText = (output: unknown): string | undefined => {
  const answer = (output as { answer?: unknown } | undefined)?.answer;
  if (answer === undefined) return undefined;
  return typeof answer === "string" ? answer : JSON.stringify(answer);
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
    let http = httpActions((await host.getRouter()) as any, USER_ID);
    const conv = await http.open("desk", { workerId: DESK });

    /** File `goal` for A from the desk, as the person does. Its task id. */
    const fileForA = async (goal: string): Promise<string> => {
      const out = await http.act("desk", conv, "dispatchTask_tasks", { goal, assignee: A });
      if (out?.ok !== true) throw new Error(`filing for ${A} was refused: ${show(out)}`);
      filed.push(out.taskId);
      return out.taskId as string;
    };
    /** A's task session for `taskId`: the session its row's run names. */
    const sessionOf = (row: Row | undefined): string | undefined => (row as { run?: { sessionId?: string } } | undefined)?.run?.sessionId;

    // ---- leg 1 --------------------------------------------------------------------
    if (legs.has("1")) {
      seen.codename = codename();
      say(`leg 1: the codename is ${seen.codename}`);
      const taskId = await fileForA(
        `Find out this release's codename and write me a one-sentence report that states it. ${B}, a worker on the team, keeps it; it isn't one of your delegates.`
      );
      // While B works: A's task parked, and nothing running in A's task session.
      const store = await storeOf(host);
      let during: { status?: string; running?: number; at?: number } = {};
      for (const deadline = Date.now() + 240_000; Date.now() < deadline; await sleep(100)) {
        const rows = await store.rows();
        const piece = rows.find((r) => r.assignee === B && pieceOf(r) === taskId);
        if (piece !== undefined && seen.takerRuns.some((r) => r.taskId === piece.id)) {
          await sleep(KEEPER_HOLD_MS / 2);
          const top = (await store.rows()).find((r) => r.id === taskId);
          const own = sessionOf(top);
          const running = own === undefined ? -1 : (await store.requests(own)).filter((r) => r.status === "in_progress").length;
          during = { status: top?.status, running, at: Date.now() };
          break;
        }
        const top = rows.find((r) => r.id === taskId);
        if (top !== undefined && ["completed", "errored", "cancelled"].includes(top.status)) break;
      }
      await quiet(host);
      const rows = await store.rows();
      const top = rows.find((r) => r.id === taskId);
      const pieces = rows.filter((r) => pieceOf(r) === taskId);
      const toB = pieces.filter((r) => r.assignee === B);
      const own = sessionOf(top);
      const tried = own === undefined ? [] : (await store.requests(own)).flatMap((r) => (r.items ?? []) as any[]).filter((i) => i.type === "tool_output" && i.toolCall?.name === "dispatchTask");
      if (toB.length === 0) {
        failures.push(
          `1:piece-to-roster — wanted A's task session to file a piece for ${B}, not one of its delegates; its pieces ${show(pieces.map((p) => [p.assignee, p.status]))}, its dispatchTask calls answered ${show(tried.map((i) => i.output ?? i.result ?? i))}`
        );
      }
      if (during.status !== "parked" || during.running !== 0) {
        failures.push(`1:parked-while-b-works — wanted A's task parked with no request running in its session while ${B} worked; read ${show(during)}`);
      }
      const answer = answerText(top?.output);
      const listed = ((top?.output as { pieces?: Array<{ taskId?: string; assignee?: string; status?: string }> } | undefined)?.pieces ?? []).filter((p) => p.assignee === B);
      if (top?.status !== "completed" || answer === undefined || !answer.includes(seen.codename) || listed.length === 0 || listed.some((p) => p.status !== "completed")) {
        failures.push(`1:report-is-output — wanted A's task completed with its woken turn's report as its answer, holding ${seen.codename}, ${B}'s piece listed under it; it is ${top?.status ?? "missing"}, output ${show(top?.output)}`);
      }
      notes.push(`leg 1: ${taskId} ${top?.status}; pieces ${show(pieces.map((p) => `${p.assignee}:${p.status}`))}; during B ${show(during)}; answer ${show(answer)}`);
    }

    // ---- leg 2 --------------------------------------------------------------------
    if (legs.has("2")) {
      const taskId = await fileForA(
        `Find out this launch's codename and write me a one-sentence report that states it. ${BROKEN}, a worker on the team, keeps it; it isn't one of your delegates.`
      );
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
      const refiled = pieces.some((r) => typeof (r.metadata as Record<string, unknown> | undefined)?.retryOf === "string");
      const ended = top !== undefined && (top.status === "errored" || (top.status === "completed" && refiled));
      if (failed.length === 0 || woken.length === 0 || !ended) {
        failures.push(
          `2:reads-the-failure — wanted ${BROKEN}'s piece to fail for good, A's woken turn to read it, and A's task to fail or to have filed again; pieces ${show(pieces.map((p) => [p.assignee, p.status]))}, woken turns ${woken.length}, A's task ${top?.status ?? "missing"} ${show(top?.error ?? top?.output)}`
        );
      }
      notes.push(`leg 2: ${taskId} ${top?.status}; pieces ${show(pieces.map((p) => `${p.assignee}:${p.status}`))}; woken ${woken.length}; refiled ${refiled}`);
    }

    // ---- leg 3 --------------------------------------------------------------------
    if (legs.has("3")) {
      seen.codename = codename();
      const taskId = await fileForA(
        `Find out this patch's codename and write me a one-sentence report that states it. ${B}, a worker on the team, keeps it; it isn't one of your delegates.`
      );
      let store = await storeOf(host);
      let atStop: { top?: string; piece?: string } = {};
      for (const deadline = Date.now() + 240_000; Date.now() < deadline; await sleep(5)) {
        const rows = await store.rows();
        const piece = rows.find((r) => r.assignee === B && pieceOf(r) === taskId);
        const top = rows.find((r) => r.id === taskId);
        if (piece?.status === "completed" || (top !== undefined && ["completed", "errored", "cancelled"].includes(top.status))) {
          atStop = { top: top?.status, piece: piece?.status };
          break;
        }
      }
      say(`leg 3: stopping the host with A's task ${atStop.top} and ${B}'s piece ${atStop.piece}`);
      await host.dispose();
      host = startHost(db);
      http = httpActions((await host.getRouter()) as any, USER_ID);
      store = await storeOf(host);
      // The person looks at the board again; then everything it starts ends.
      await http.act("desk", conv, "listTasks_tasks", {});
      await quiet(host);
      await http.act("desk", conv, "listTasks_tasks", {});
      await quiet(host);
      const top = (await store.rows()).find((r) => r.id === taskId);
      const deskState = (await store.session(conv))?.state as { taskNotices?: string[] } | undefined;
      const heard = (deskState?.taskNotices ?? []).filter((k) => k.startsWith(`${taskId}:`) && k.endsWith(":completed"));
      const told = seen.deskTurns.filter((t) => t.message.includes(`(${taskId}) completed`));
      if (atStop.top !== "parked" || top?.status !== "completed" || heard.length !== 1 || told.length !== 1) {
        failures.push(
          `3:settles-once — wanted the host stopped while A's task was parked on a finished piece, and after the start the task completed and the desk heard it once; at the stop ${show(atStop)}, now ${top?.status ?? "missing"}, heard ${show(heard)}, desk turns on it ${told.length}`
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
