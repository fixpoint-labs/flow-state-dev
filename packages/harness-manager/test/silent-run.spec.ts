// FIX-2794.
/**
 * A coding run is stopped only once its harness has gone silent, never for
 * how long it has worked: in process, with a real `createFlowState`, a real
 * board and a real git checkout. Only the harness is the package's scripted
 * stub, which sends an event per step through the manager's `onEvent` feed as
 * a real harness does.
 *
 * Small real windows here; the 20-minute default is graded with a fake clock
 * in `session-turn-deadline.spec.ts`, through the same stop.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import { harnessRunHandleSchema, harnessRunInputSchema, type HarnessBlock } from "@flow-state-dev/core/harness";
import { isAbortLike } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { defineTaskCollection, type Task } from "@flow-state-dev/orchestration/tasks";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import { worktreeLockPath } from "@flow-state-dev/workspace";
import { harnessManager, harnessStub, harnessTaskInputSchema, runOwnerClaimOrder, type HarnessFeeds } from "../src";
import { harnessTaskId } from "../src/workspace";
import { heard } from "./heard";
import { seedRepo } from "./fixtures";

const BOARD_ID = "eng.feature.work";
const ORG_ID = "org_silent";
const ALICE = "alice";
const ISSUE = "FIX-1";
const PHASE = "implement";
const TASK_ID = harnessTaskId(ISSUE, PHASE);

/** The longest timer there is: only an abort ends the step. */
const FOREVER = 2 ** 31 - 1;

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function host(options: { harness: (feeds: HarnessFeeds) => HarnessBlock; idleTimeoutMs?: number; runTimeoutMs?: number }) {
  const dir = mkdtempSync(join(tmpdir(), "harness-manager-silent-"));
  dirs.push(dir);
  const sourceRepo = join(dir, "repo");
  mkdirSync(sourceRepo, { recursive: true });
  seedRepo(sourceRepo);

  const ledger = defineTaskCollection({ id: BOARD_ID, scope: "org" as const, stateSchema: harnessTaskInputSchema });
  const manager = harnessManager({
    boardCollectionId: BOARD_ID,
    boardCollection: ledger,
    tenant: undefined,
    mode: { name: PHASE, instructions: async (run) => `Work on ${run.issue}.`, doneWhen: { check: async () => true } },
    workspace: { root: join(dir, "checkouts"), sourceRepo, baseRef: "main", provisionTimeoutMs: 10_000 },
    ...(options.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: options.idleTimeoutMs }),
    ...(options.runTimeoutMs === undefined ? {} : { runTimeoutMs: options.runTimeoutMs }),
    harnessLabel: "the stub harness",
    ownership: { pollMs: 25 },
    harness: options.harness,
  });
  const board = taskBoard({
    name: "silent-board",
    boardId: "silent-board",
    mode: "delegation",
    collection: ledger,
    concurrency: 1,
    claimOrder: runOwnerClaimOrder(),
    workers: { coder: dispatcher({ name: "silent-board-dispatch", action: "work", session: "per-task" }) },
  });
  const seed = handler({
    name: "silent-seed",
    inputSchema: z.object({}),
    outputSchema: z.object({ id: z.string() }),
    uses: [board.capability],
    execute: async (_input, ctx) => {
      const tasks = (ctx as { cap: Record<string, any> }).cap["silent-board"];
      await tasks.createTask({ id: TASK_ID, goal: "the feature", input: { issue: ISSUE, phase: PHASE }, assignee: "coder", maxAttempts: 1 });
      return { id: TASK_ID };
    },
  });
  const flow = defineFlow({
    kind: "silent-host",
    actions: { seed: { block: seed }, drain: { block: board.drain } },
    internal: { actions: { ...heard } },
    task: { actions: { work: { block: manager } } },
  } as never)({ id: "silent-host" } as never);
  const state = createFlowState({
    flows: [flow],
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
  const taskNow = async (): Promise<Task> =>
    (await (await runtime()).stores.resourceState.get("org", ORG_ID, `${BOARD_ID}/${TASK_ID}`))?.state as Task;
  const until = async (predicate: (task: Task) => boolean, what: string): Promise<Task> => {
    const deadline = Date.now() + 15_000;
    for (;;) {
      const current = await taskNow();
      if (current !== undefined && predicate(current)) return current;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}; the task is ${JSON.stringify(current)}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };
  return { act, until, taskNow, dispose: () => state.dispose() };
}

const settled = (task: Task) => task.status === "completed" || task.status === "errored" || task.status === "cancelled";

describe("a coding run that keeps working is never stopped for how long it has run", () => {
  it("runs a harness still sending events, well past its silence window, to its end", async () => {
    // Twelve events 100 ms apart: 1.2 s of work, three times the 400 ms window, never 400 ms silent.
    const stub = harnessStub({ steps: Array.from({ length: 12 }, (_, i) => `step ${i + 1}`), stepEveryMs: 100 });
    const h = host({ harness: stub.slot, idleTimeoutMs: 400 });
    try {
      await h.act("seed");
      void h.act("drain");
      const ended = await h.until(settled, "the run to end");
      expect(ended.error).toBeUndefined();
      expect(ended).toMatchObject({ status: "completed" });
    } finally {
      await h.dispose();
    }
  }, 30_000);

  it("still stops at a cap on run time the host set, however busy the harness is", async () => {
    const stub = harnessStub({ steps: Array.from({ length: 40 }, (_, i) => `step ${i + 1}`), stepEveryMs: 100 });
    const h = host({ harness: stub.slot, idleTimeoutMs: 400, runTimeoutMs: 1_000 });
    try {
      await h.act("seed");
      void h.act("drain");
      const ended = await h.until(settled, "the run to end");
      // In the cap's own words, not the harness's aborted error, which reads as a person's stop.
      expect(ended).toMatchObject({ status: "errored", error: "The stub harness ran for 1 second, its cap on run time; stopped." });
      expect(isAbortLike(new Error(ended.error))).toBe(false);
    } finally {
      await h.dispose();
    }
  }, 30_000);
});

// FIX-2794.
describe("a coding run's default cap on run time", () => {
  /**
   * Run a harness that sends an event a minute for five hours, on a fake
   * clock advanced a minute at a time, until its task settles.
   */
  async function fiveHourRun(runTimeoutMs?: number) {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], shouldAdvanceTime: true });
    const stub = harnessStub({ steps: Array.from({ length: 300 }, (_, i) => `step ${i + 1}`), stepEveryMs: 60_000 });
    // When the run last sent an event: how long it ran, whatever the loop below takes to see it settle.
    let lastEventAt = 0;
    const harness: typeof stub.slot = (feeds) =>
      stub.slot({
        ...feeds,
        onEvent: (ctx) => {
          lastEventAt = Date.now();
          feeds.onEvent?.(ctx);
        },
      });
    const h = host({ harness, ...(runTimeoutMs === undefined ? {} : { runTimeoutMs }) });
    try {
      await h.act("seed");
      void h.act("drain");
      await vi.waitFor(() => expect(stub.runs).toHaveLength(1), { timeout: 15_000 });
      const startedAt = Date.now();
      for (let minute = 0; minute < 310; minute += 1) {
        const now = await h.taskNow();
        if (now !== undefined && settled(now)) break;
        await vi.advanceTimersByTimeAsync(60_000);
      }
      const ended = await h.until(settled, "the run to end");
      return { ended, ranFor: lastEventAt - startedAt };
    } finally {
      vi.useRealTimers();
      await h.dispose();
    }
  }

  it("stops a run still working at 4 hours when the host sets no cap, so a looping run can't spend forever", async () => {
    const { ended, ranFor } = await fiveHourRun();
    expect(ended).toMatchObject({ status: "errored", error: "The stub harness ran for 4 hrs, its cap on run time; stopped." });
    expect(ranFor).toBeGreaterThanOrEqual(4 * 60 * 60_000 - 2 * 60_000);
    expect(ranFor).toBeLessThanOrEqual(4 * 60 * 60_000);
  }, 60_000);

  it("lets a run go past 4 hours to its end when the host turns the cap off with runTimeoutMs: 0", async () => {
    const { ended, ranFor } = await fiveHourRun(0);
    expect(ended.error).toBeUndefined();
    expect(ended).toMatchObject({ status: "completed" });
    expect(ranFor).toBeGreaterThanOrEqual(5 * 60 * 60_000 - 60_000);
  }, 60_000);
});

describe("a coding run whose harness goes silent", () => {
  it("is stopped after the window with words that say so, and fails rather than reading as a stop", async () => {
    const stub = harnessStub({ steps: ["working"], stepEveryMs: FOREVER });
    const h = host({ harness: stub.slot, idleTimeoutMs: 1_000 });
    try {
      await h.act("seed");
      const startedAt = Date.now();
      void h.act("drain");
      const ended = await h.until(settled, "the run to end");
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1_000);
      expect(ended).toMatchObject({ status: "errored", error: "No output from the stub harness for 1 second; stopped." });
      // The ending a report reads: an error, not the abort a person's stop is.
      expect(isAbortLike(new Error(ended.error))).toBe(false);
    } finally {
      await h.dispose();
    }
  }, 30_000);
});

describe("a coding run's checkout lock while its harness works", () => {
  it("is marked live by each event, so a waiter never finds a working run's lock stale", async () => {
    let lockAgeAfterEvent: number | undefined;
    const harness = (feeds: HarnessFeeds): HarnessBlock =>
      handler({
        name: "aging-harness",
        inputSchema: harnessRunInputSchema,
        outputSchema: harnessRunHandleSchema,
        execute: async (_input, ctx) => {
          const lock = worktreeLockPath(await feeds.cwd(ctx as never));
          // As a lock looks after a long stretch: an hour since anything touched it.
          const anHourAgo = new Date(Date.now() - 60 * 60_000);
          utimesSync(lock, anHourAgo, anHourAgo);
          feeds.onEvent?.(ctx as never);
          lockAgeAfterEvent = Date.now() - statSync(lock).mtimeMs;
          return {
            source: "stub/test",
            status: "completed" as const,
            sessionId: null,
            url: null,
            dispatchedAt: Date.now(),
            outcome: "finished" as const,
            finalMessage: "done",
            usage: null,
            cost: null,
          };
        },
      }) as unknown as HarnessBlock;
    const h = host({ harness, idleTimeoutMs: 5_000 });
    try {
      await h.act("seed");
      void h.act("drain");
      expect(await h.until(settled, "the run to end")).toMatchObject({ status: "completed" });
      expect(lockAgeAfterEvent).toBeDefined();
      expect(lockAgeAfterEvent!).toBeLessThan(5_000);
    } finally {
      await h.dispose();
    }
  }, 30_000);
});
