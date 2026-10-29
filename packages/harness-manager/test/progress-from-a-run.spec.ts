/**
 * A running coding task says how it's doing (FIX-2290), in process: a real
 * `createFlowState`, a real board, the real fenced `reportProgress` and a real
 * git checkout. Only the harness is a stub, and it reports activity through
 * the manager's `onActivity` feed as a real harness does.
 *
 * The throttle's window (`PROGRESS_NOTE_MS`) is graded with a fake clock in
 * `progress-note.spec.ts`; here a burst lands inside the first window.
 */
import { afterAll, describe, expect, it } from "vitest";
import { heard } from "./heard";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import { harnessRunHandleSchema, harnessRunInputSchema } from "@flow-state-dev/core";
import type { HarnessActivity, HarnessBlock } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { defineTaskCollection, type Task } from "@flow-state-dev/orchestration/tasks";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import { harnessManager, harnessTaskInputSchema, runOwnerClaimOrder, type HarnessFeeds } from "../src";
import { harnessTaskId } from "../src/workspace";
import { seedRepo } from "./fixtures";

const BOARD_ID = "eng.feature.work";
const ORG_ID = "org_progress";
const ALICE = "alice";
const ISSUE = "FIX-1";
const PHASE = "implement";
const TASK_ID = harnessTaskId(ISSUE, PHASE);

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const tool = (name: string, args: Record<string, unknown>): HarnessActivity => ({ kind: "tool", name, arguments: JSON.stringify(args) });

/** What the stub's one step does, between its start and its finish. */
interface Script {
  /** Awaited before it reports anything, so the test can change the row first. */
  before?: Promise<void>;
  activity: HarnessActivity[];
  /** Awaited after it reports, before it finishes, so the test can read the row while it runs. */
  after?: Promise<void>;
}

function stubHarness(script: Script, started: () => void, reported: () => void) {
  return (feeds: HarnessFeeds): HarnessBlock =>
    handler({
      name: "stub-harness",
      inputSchema: harnessRunInputSchema,
      outputSchema: harnessRunHandleSchema,
      execute: async (_input, ctx) => {
        await feeds.onSession("sess_1", ctx as never);
        started();
        await script.before;
        for (const activity of script.activity) feeds.onActivity?.(activity, ctx as never);
        reported();
        await script.after;
        return {
          source: "stub/test",
          status: "completed" as const,
          sessionId: "sess_1",
          url: null,
          dispatchedAt: Date.now(),
          outcome: "finished" as const,
          finalMessage: "done",
          usage: null,
          cost: null,
        };
      },
    }) as unknown as HarnessBlock;
}

function host(script: Script) {
  const dir = mkdtempSync(join(tmpdir(), "harness-manager-progress-"));
  dirs.push(dir);
  const sourceRepo = join(dir, "repo");
  mkdirSync(sourceRepo, { recursive: true });
  seedRepo(sourceRepo);

  const ledger = defineTaskCollection({ id: BOARD_ID, scope: "org" as const, stateSchema: harnessTaskInputSchema });
  let started = () => {};
  const stepStarted = new Promise<void>((resolve) => (started = resolve));
  let reported = () => {};
  const activityReported = new Promise<void>((resolve) => (reported = resolve));
  const manager = harnessManager({
    boardCollectionId: BOARD_ID,
    boardCollection: ledger,
    tenant: undefined,
    phase: { phase: PHASE, buildPrompt: async (run) => `Work on ${run.issue}.`, isDone: async () => true },
    workspace: { root: join(dir, "checkouts"), sourceRepo, baseRef: "main", provisionTimeoutMs: 10_000 },
    runTimeoutMs: 20_000,
    ownership: { pollMs: 25 },
    harness: stubHarness(script, started, reported),
  });
  const board = taskBoard({
    name: "progress-board",
    boardId: "progress-board",
    mode: "delegation",
    collection: ledger,
    concurrency: 1,
    claimOrder: runOwnerClaimOrder(),
    workers: { coder: dispatcher({ name: "progress-board-dispatch", action: "work", session: "per-task" }) },
  });
  const seed = handler({
    name: "progress-seed",
    inputSchema: z.object({}),
    outputSchema: z.object({ id: z.string() }),
    uses: [board.capability],
    execute: async (_input, ctx) => {
      const tasks = (ctx as { cap: Record<string, any> }).cap["progress-board"];
      await tasks.createTask({ id: TASK_ID, goal: "the feature", input: { issue: ISSUE, phase: PHASE }, assignee: "coder", maxAttempts: 1 });
      return { id: TASK_ID };
    },
  });
  const flow = defineFlow({
    kind: "progress-host",
    actions: { seed: { block: seed }, drain: { block: board.drain } },
    internal: { actions: { ...heard } },
    task: { actions: { work: { block: manager } } },
  } as never)({ id: "progress-host" } as never);
  const state = createFlowState({
    flows: { "progress-host": flow },
    stores: { test: { primary: inMemoryStores() } },
    defaultProfile: "test",
    dispatchDrainTimeoutMs: 60_000,
  } as never);
  const runtime = async () => (state as unknown as { getRuntime(): Promise<{ stores: any; runtimeConfig: object }> }).getRuntime();
  const act = async (action: string) => {
    const rt = await runtime();
    return runAction({
      flow,
      actionName: action,
      input: {},
      userId: ALICE,
      orgId: ORG_ID,
      sessionId: `s_${ALICE}`,
      stores: rt.stores,
      runtimeConfig: { ...rt.runtimeConfig },
    } as never);
  };
  const row = async (): Promise<Task> =>
    (await (await runtime()).stores.resourceState.get("org", ORG_ID, `${BOARD_ID}/${TASK_ID}`))?.state as Task;
  const until = async (predicate: (task: Task) => boolean, what: string): Promise<Task> => {
    const deadline = Date.now() + 15_000;
    for (;;) {
      const current = await row();
      if (current !== undefined && predicate(current)) return current;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}; row is ${JSON.stringify(current)}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };
  /** Another claim of the row, as a reclaim after a lapsed lease leaves it: the next attempt holds it. */
  const claimedAgain = async () => {
    const stores = (await runtime()).stores;
    const stored = await stores.resourceState.get("org", ORG_ID, `${BOARD_ID}/${TASK_ID}`);
    await stores.resourceState.set("org", ORG_ID, `${BOARD_ID}/${TASK_ID}`, { ...stored.state, attempts: stored.state.attempts + 1 }, stored.version);
  };
  return { act, row, until, claimedAgain, stepStarted, activityReported, dispose: () => state.dispose() };
}

/** A gate the test opens. */
function gate(): { promise: Promise<void>; open: () => void } {
  let open = () => {};
  const promise = new Promise<void>((resolve) => (open = resolve));
  return { promise, open };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

describe("a running coding task says how it's doing", () => {
  it("shows the run's first activity at once, and a burst after it writes nothing more inside the window", async () => {
    const finish = gate();
    const burst = Array.from({ length: 50 }, (_, i) => tool("Bash", { command: `pnpm test --shard ${i}` }));
    const h = host({ activity: [tool("Edit", { file_path: "src/a.ts" }), ...burst], after: finish.promise });
    try {
      await h.act("seed");
      void h.act("drain");
      await h.activityReported;
      // `moves`: the note is on the row while the run is still working.
      const running = await h.until((t) => t.statusNote !== undefined, "the first note");
      expect(running).toMatchObject({ status: "in_progress", statusNote: "Edit: src/a.ts" });
      // `bounded`: none of the 50 calls after it was written in this window.
      await settle();
      expect((await h.row()).statusNote).toBe("Edit: src/a.ts");

      finish.open();
      // The run's ending speaks now: the note stays as the last thing it did, beside its status.
      await h.until((t) => t.status === "completed", "the run to complete");
    } finally {
      // A failed check must not leave the run waiting, or the flow state never closes.
      finish.open();
      await h.dispose();
    }
  }, 60_000);

  it("writes nothing onto a row a later attempt holds", async () => {
    const claimed = gate();
    const h = host({ before: claimed.promise, activity: [tool("Edit", { file_path: "src/a.ts" })] });
    try {
      await h.act("seed");
      void h.act("drain");
      await h.stepStarted;
      // `stale`: the row is claimed again while this attempt's step still runs.
      await h.claimedAgain();
      claimed.open();
      await h.activityReported;
      await settle();
      expect((await h.row()).statusNote).toBeUndefined();
    } finally {
      claimed.open();
      await h.dispose();
    }
  }, 60_000);

  it("leaves no note when the harness reports no activity", async () => {
    const h = host({ activity: [] });
    try {
      await h.act("seed");
      await h.act("drain");
      const done = await h.until((t) => t.status === "completed", "the run to complete");
      // `quiet`: nothing made up in its place.
      expect(done.statusNote).toBeUndefined();
    } finally {
      await h.dispose();
    }
  }, 60_000);
});
