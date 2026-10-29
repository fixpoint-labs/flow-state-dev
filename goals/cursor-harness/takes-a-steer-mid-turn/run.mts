/**
 * Goal check — cursor-harness › it takes a steer mid-turn. Contract, controls
 * and the verdict log: `goal.md`.
 *
 * Real Cursor, three legs, each in a throwaway git repository:
 * - **k** Kitchen Sink's `/cursor` session flow, driven as the page drives it:
 *   `turn`, then a line mid-turn through `sendLine` (the page's own code).
 * - **h** a harness manager over Cursor: `steer` on the task mid-step.
 * - **w** a turn waiting on a background subagent, steered during the wait.
 * Graded on files in the worktree, rows and session state, and counts of runs
 * and sends, never on what the model says.
 *
 * Run:      CURSOR_API_KEY=… pnpm tsx goals/cursor-harness/takes-a-steer-mid-turn/run.mts
 * Control:  GOAL_CONTROL=no-live-steer (no run offers a steer; k, h and w must FAIL)
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { z } from "zod";
import { defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import type { HarnessBlock } from "@flow-state-dev/core/types";
import { createFlowState, createInMemoryStores, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { cursorAgent } from "@flow-state-dev/cursor";
import { harnessManager, harnessTaskInputSchema, runOwnerClaimOrder } from "@flow-state-dev/harness-manager";
import { taskSettledEntry } from "@flow-state-dev/orchestration";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import {
  defineTaskCollection,
  getOrCreateTaskCollection,
  resolveResourceCollection,
  type Task,
} from "@flow-state-dev/orchestration/tasks";
import { testFlow } from "@flow-state-dev/testing";
import { loadFixture, runGoal } from "../../lib/index.mts";
import { seedRepo } from "../../../packages/harness-manager/test/fixtures.ts";
import { CURSOR_SESSION, cursorSessionFlow } from "../../../apps/kitchen-sink/lib/cursor-mode.ts";
import { sendLine, type LineOutcome } from "../../../apps/kitchen-sink/lib/harness-line.ts";
import { locateSessionWorktree } from "../../../apps/kitchen-sink/lib/harness-worktree.ts";
import { harnessTaskId } from "../../../packages/harness-manager/src/workspace.ts";

interface Fixture {
  model: string;
  steps: number;
  pauseSeconds: number;
}

const fixture = loadFixture<Fixture>(import.meta.url);
const CONTROL = process.env.GOAL_CONTROL ?? "";
if (CONTROL !== "" && CONTROL !== "no-live-steer") {
  throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; this goal understands no-live-steer`);
}
if (!process.env.CURSOR_API_KEY) throw new Error("CURSOR_API_KEY is required: this goal runs real Cursor.");
/** How long one real turn may take. */
const TURN_MS = 600_000;

/** A fresh git repository with one commit. */
function scratchRepo(name: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `steer-goal-${name}-`)));
  execFileSync("git", ["init", "-q", "-b", "main", dir]);
  writeFileSync(join(dir, "README.md"), "steer goal\n");
  execFileSync("git", ["-C", dir, "add", "."]);
  execFileSync("git", ["-C", dir, "-c", "user.email=g@g", "-c", "user.name=g", "commit", "-qm", "init"]);
  return dir;
}

/** The slow task: numbered files with a pause between them, so a line can land mid-turn. */
const slowTask = (): string =>
  `Create the files step-1.txt to step-${fixture.steps}.txt in this directory, one at a time, each holding its ` +
  `own number. After each file, run the shell command \`sleep ${fixture.pauseSeconds}\` before the next one. ` +
  "Do nothing else.";

/** The line: a file holding a fresh token, which nothing but the line names. */
const steerLine = (token: string): string =>
  `Also create a file named steer-token.txt in this directory containing exactly: ${token}`;

/** Wait until `predicate` holds, or fail after `ms`. */
async function until(predicate: () => boolean | Promise<boolean>, what: string, ms = TURN_MS): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

const holds = (file: string, token: string) => existsSync(file) && readFileSync(file, "utf8").includes(token);

/**
 * Kitchen Sink's Cursor session flow on a real Cursor, and a send that drives
 * it as the page does. `KITCHEN_SINK_TEST_MODE=1` lets `GOAL_CONTROL` reach
 * the flow's own feed; `KITCHEN_SINK_REAL_HARNESS=1` keeps the real SDK.
 */
function kitchenSinkSession(name: string) {
  const repo = scratchRepo(name);
  process.env.KITCHEN_SINK_HARNESS_WORKSPACE = repo;
  process.env.XDG_STATE_HOME = realpathSync(mkdtempSync(join(tmpdir(), `steer-goal-${name}-state-`)));
  process.env.KITCHEN_SINK_TEST_MODE = "1";
  process.env.KITCHEN_SINK_REAL_HARNESS = "1";
  const flow = cursorSessionFlow();
  const stores = createInMemoryStores();
  const sessionId = `s-steer-goal-${name}`;
  let turns = 0;
  const run = (action: string, input: unknown) => {
    if (action === "turn") turns += 1;
    return testFlow({ flow, action, userId: "goal", sessionId, input, stores, seed: { session: { state: { model: fixture.model } } } });
  };
  const worktree = () => locateSessionWorktree(repo, { flowKind: CURSOR_SESSION, sessionId });
  const steered = async (): Promise<string[]> => {
    const stored = (await stores.session.get(sessionId)) as { state?: { turns?: Record<string, { steered?: string[] | null }> } } | undefined;
    return Object.values(stored?.state?.turns ?? {}).flatMap((turn) => turn.steered ?? []);
  };
  /** Send a line mid-turn through the page's own code; the turns it started run on. */
  const line = async (text: string): Promise<{ outcome: LineOutcome; pending: Promise<unknown>[] }> => {
    const pending: Promise<unknown>[] = [];
    const outcome = await sendLine(text, true, {
      steer: async (prompt) => (await run("steer", { prompt })).output as { taken: boolean; live: boolean },
      turn: async (prompt) => {
        pending.push(run("turn", { prompt }));
      },
    });
    return { outcome, pending };
  };
  return { run, worktree, steered, line, turns: () => turns };
}

await runGoal(async (failures) => {
  // ── Leg k: Kitchen Sink's /cursor, a line typed mid-turn ──────────────────
  {
    const token = `k-${randomUUID()}`;
    const ks = kitchenSinkSession("k");
    const first = ks.run("turn", { prompt: slowTask() });
    await until(() => existsSync(join(ks.worktree(), "step-1.txt")), "k: the turn's first file");
    const { outcome, pending } = await ks.line(steerLine(token));
    const results = (await Promise.all([first, ...pending])) as Array<{ status: string; output?: { sessionId?: string } }>;
    const dir = ks.worktree();
    if (ks.turns() !== 1) failures.push(`k: ${ks.turns()} turn requests, not one: the line did not join the running turn`);
    if (outcome !== "taken") failures.push(`k: the line was ${outcome}, not taken into the running turn`);
    if (results[0]?.status !== "completed") failures.push(`k: the turn ended ${results[0]?.status}, not completed (a cancel?)`);
    if (!(await ks.steered()).some((l) => l.includes(token))) failures.push("k: the turn record doesn't say it took the line");
    if (!holds(join(dir, "steer-token.txt"), token)) failures.push("k: steer-token.txt with the token is missing");
    if (!existsSync(join(dir, `step-${fixture.steps}.txt`))) failures.push(`k: step-${fixture.steps}.txt is missing: the turn didn't carry on`);
  }

  // ── Leg w: a turn waiting on its background work ──────────────────────────
  {
    const token = `w-${randomUUID()}`;
    const ks = kitchenSinkSession("w");
    const first = ks.run("turn", {
      prompt:
        "Start one background subagent whose only job is to run the shell command `sleep 60` and then create a file " +
        "named bg-done.txt in this directory containing the word done. Before you start it, create started.txt. " +
        "Then wait for the background subagent to finish before you end your turn. Do nothing else.",
    });
    await until(() => existsSync(join(ks.worktree(), "started.txt")), "w: the turn starting its background work");
    // Well inside the subagent's minute: the turn is waiting on it.
    await new Promise((resolve) => setTimeout(resolve, 15_000));
    const sentWhileWaiting = !existsSync(join(ks.worktree(), "bg-done.txt"));
    const { outcome, pending } = await ks.line(steerLine(token));
    await Promise.all([first, ...pending]);
    const dir = ks.worktree();
    if (!sentWhileWaiting) failures.push("w: the background work had already finished, so the line didn't land during the wait");
    if (outcome !== "taken") failures.push(`w: the line was ${outcome}, not taken live during the wait`);
    if (!holds(join(dir, "steer-token.txt"), token)) failures.push("w: steer-token.txt with the token is missing");
    if (!existsSync(join(dir, "bg-done.txt"))) failures.push("w: bg-done.txt is missing: the background result never arrived");
  }

  // ── Leg h: a harness manager over Cursor, a steer mid-step ────────────────
  {
    const token = `h-${randomUUID()}`;
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "steer-goal-h-")));
    const sourceRepo = join(dir, "repo");
    mkdirSync(sourceRepo, { recursive: true });
    seedRepo(sourceRepo);
    const BOARD = "goal.steer.work";
    const TASK = harnessTaskId("GOAL-1", "implement");
    const ledger = defineTaskCollection({ id: BOARD, scope: "org" as const, stateSchema: harnessTaskInputSchema });
    let runs = 0;
    let checkout = "";
    const manager = harnessManager({
      boardCollectionId: BOARD,
      boardCollection: ledger,
      tenant: undefined,
      phase: { phase: "implement", buildPrompt: async () => slowTask(), isDone: async () => true },
      workspace: { root: join(dir, "checkouts"), sourceRepo, baseRef: "main", provisionTimeoutMs: 60_000 },
      runTimeoutMs: TURN_MS,
      stopsOnAbort: false,
      harness: (feeds) =>
        cursorAgent({
          cwd: async (ctx) => (checkout = await feeds.cwd(ctx)),
          resume: feeds.resume,
          onSession: async (id, ctx) => {
            runs += 1;
            await feeds.onSession(id, ctx);
          },
          ...(CONTROL === "no-live-steer" ? {} : { onSteerable: feeds.onSteerable }),
          agent: { model: { id: fixture.model }, mode: "agent" },
        }) as unknown as HarnessBlock,
    });
    const board = taskBoard({
      name: "goal-board",
      boardId: "goal-board",
      mode: "delegation",
      collection: ledger,
      concurrency: 1,
      claimOrder: runOwnerClaimOrder(),
      workers: { coder: dispatcher({ name: "goal-board-dispatch", action: "work", session: "per-task" }) },
    });
    const tasks = (ctx: never) =>
      getOrCreateTaskCollection({ ctx, backing: "resource", collectionId: BOARD, collection: resolveResourceCollection(ctx, BOARD)! });
    const seed = handler({
      name: "goal-seed",
      inputSchema: z.object({}),
      outputSchema: z.unknown(),
      uses: [board.capability],
      execute: async (_input, ctx) =>
        (ctx as { cap: Record<string, any> }).cap["goal-board"].createTask({
          id: TASK,
          goal: "the files",
          input: { issue: "GOAL-1", phase: "implement" },
          assignee: "coder",
          maxAttempts: 1,
        }),
    });
    const steer = handler({
      name: "goal-steer",
      inputSchema: z.object({ message: z.string() }),
      outputSchema: z.unknown(),
      uses: [board.capability],
      execute: async (input, ctx) => (await tasks(ctx as never)).steer!(TASK, { message: input.message, from: "user", by: "goal" }),
    });
    const flow = defineFlow({
      kind: "steer-goal",
      actions: { seed: { block: seed }, drain: { block: board.drain }, steer: { block: steer } },
      task: { actions: { work: { block: manager } } },
      internal: {
        actions: {
          // A board that hands rows out sends each ending here; the leg reads the
          // settled row from the board, so the notice carries nothing it needs.
          onTaskSettled: taskSettledEntry({
            block: handler({ name: "goal-task-settled", inputSchema: z.unknown(), outputSchema: z.object({}), execute: () => ({}) }),
          }),
        },
      },
    } as never)({ id: "steer-goal" } as never);
    const state = createFlowState({
      flows: { "steer-goal": flow },
      stores: { goal: { primary: inMemoryStores() } },
      defaultProfile: "goal",
      dispatchDrainTimeoutMs: TURN_MS,
    } as never);
    const rt = await (state as unknown as { getRuntime(): Promise<{ stores: any; runtimeConfig: object }> }).getRuntime();
    const act = (actionName: string, input: unknown = {}) =>
      runAction({ flow, actionName, input, userId: "goal", orgId: "org_goal", sessionId: "s_goal", stores: rt.stores, runtimeConfig: { ...rt.runtimeConfig } } as never);
    const row = async (): Promise<Task | undefined> =>
      (await rt.stores.resourceState.get("org", "org_goal", `${BOARD}/${TASK}`))?.state as Task | undefined;
    try {
      await act("seed");
      void act("drain");
      await until(() => checkout !== "" && existsSync(join(checkout, "step-1.txt")), "h: the step's first file");
      await act("steer", { message: steerLine(token) });
      await until(async () => ["completed", "failed", "cancelled"].includes((await row())?.status ?? ""), "h: the task to end");
      const done = await row();
      if (runs !== 1) failures.push(`h: ${runs} Cursor runs, not one: the steer took a step of its own`);
      if (done?.status !== "completed") failures.push(`h: the task ended ${done?.status}`);
      if (done?.attempts !== 1) failures.push(`h: attempt ${done?.attempts}, not 1`);
      const steers = done?.steers ?? [];
      if (steers.length !== 1 || steers[0]?.takenBy !== 1 || !steers[0]?.takenIn?.startsWith("live:")) {
        failures.push(`h: the steer wasn't taken once, live: ${JSON.stringify(steers)}`);
      }
      if (!holds(join(checkout, "steer-token.txt"), token)) failures.push("h: steer-token.txt with the token is missing");
    } finally {
      await (state as { dispose(): Promise<void> }).dispose();
    }
  }

  return { failures, evidence: "k, w and h: the line joined the running Cursor turn, once, with no second run" };
});
