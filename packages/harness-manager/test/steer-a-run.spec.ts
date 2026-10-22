/**
 * Steering a coding run (FIX-2086), in process: a real `createFlowState`, a
 * real board, real fenced settlement and a real git checkout. Only the
 * harness is a stub, and it records what each step was handed.
 */
import { afterAll, describe, expect, it } from "vitest";
import { heard } from "./heard";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import { harnessRunHandleSchema, harnessRunInputSchema } from "@flow-state-dev/core";
import type { HarnessBlock } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import {
  defineTaskCollection,
  getOrCreateTaskCollection,
  resolveResourceCollection,
  type Task,
} from "@flow-state-dev/orchestration/tasks";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import {
  harnessManager,
  harnessSessionDoor,
  harnessTaskInputSchema,
  runOwnerDispatcher,
  STEER_POLL_MS,
  type HarnessFeeds,
} from "../src";
import { harnessTaskId } from "../src/workspace";
import { seedRepo } from "./fixtures";

const BOARD_ID = "eng.feature.work";
const ORG_ID = "org_steer";
const ALICE = "alice";
const ISSUE = "FIX-1";
const PHASE = "implement";
const TASK_ID = harnessTaskId(ISSUE, PHASE);
const FOLLOW_UP_ID = `${TASK_ID}-f1`;

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/**
 * What one harness step does: work until stopped, work 400 ms and finish,
 * finish at once, or work 1.5 s and finish without ever confirming a session.
 */
type Step = "until-stopped" | "finish-later" | "finished" | "no-session-later";

interface SeenStep {
  prompt: string;
  resume: string | null;
  session: string;
  request: string;
}

function stubHarness(script: Step[], seen: SeenStep[], started: () => void, whenStopped: Array<() => Promise<void>> = []) {
  return (feeds: HarnessFeeds): HarnessBlock =>
    handler({
      name: "stub-harness",
      inputSchema: harnessRunInputSchema,
      outputSchema: harnessRunHandleSchema,
      execute: async (input, ctx) => {
        const resume = await feeds.resume(ctx as never);
        const step = script[seen.length] ?? "finished";
        const session = resume ?? `sess_${seen.length + 1}`;
        seen.push({ prompt: input.prompt, resume, session, request: (ctx as { request: { identity: { id: string } } }).request.identity.id });
        if (step !== "no-session-later") await feeds.onSession(session, ctx as never);
        started();
        const handle = {
          source: "stub/test",
          status: "completed" as const,
          sessionId: session,
          url: null,
          dispatchedAt: Date.now(),
          outcome: "finished" as const,
          finalMessage: "done",
          usage: null,
          cost: null,
        };
        if (step === "until-stopped") {
          // Works until its signal fires; its rejection is its process having exited.
          const signal = (ctx as { signal: AbortSignal }).signal;
          await new Promise<void>((resolve) => {
            if (signal.aborted) return resolve();
            signal.addEventListener("abort", () => resolve(), { once: true });
          });
          // What happens to the task while the stopped process exits.
          await whenStopped.shift()?.();
          throw new DOMException("Aborted", "AbortError");
        }
        if (step === "finish-later") await new Promise((resolve) => setTimeout(resolve, 400));
        if (step === "no-session-later") {
          // Its process exits when its signal fires, like any harness that stops on abort.
          const signal = (ctx as { signal: AbortSignal }).signal;
          const aborted = await new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => resolve(false), 1_500);
            signal.addEventListener("abort", () => (clearTimeout(timer), resolve(true)), { once: true });
          });
          if (aborted) throw new DOMException("Aborted", "AbortError");
        }
        return handle;
      },
    }) as unknown as HarnessBlock;
}

function host(options: { script: Step[]; stopsOnAbort: boolean }) {
  const dir = mkdtempSync(join(tmpdir(), "harness-manager-steer-"));
  dirs.push(dir);
  const sourceRepo = join(dir, "repo");
  mkdirSync(sourceRepo, { recursive: true });
  seedRepo(sourceRepo);

  const ledger = defineTaskCollection({ id: BOARD_ID, scope: "org" as const, stateSchema: harnessTaskInputSchema });
  const seen: SeenStep[] = [];
  const starts: Array<() => void> = [];
  const started = () => starts.shift()?.();
  const stepStarted = () => new Promise<void>((resolve) => starts.push(resolve));
  // Run inside the phase's done-condition, one per call: what lands while the verdict is read.
  const duringVerdict: Array<() => Promise<void>> = [];
  const whenStopped: Array<() => Promise<void>> = [];
  const manager = harnessManager({
    boardCollectionId: BOARD_ID,
    boardCollection: ledger,
    tenant: undefined,
    phase: {
      phase: PHASE,
      buildPrompt: async (run) => `Work on ${run.issue}, attempt ${run.attempt}.`,
      isDone: async () => {
        await duringVerdict.shift()?.();
        return true;
      },
    },
    workspace: { root: join(dir, "checkouts"), sourceRepo, baseRef: "main", provisionTimeoutMs: 10_000 },
    runTimeoutMs: 20_000,
    ownership: { pollMs: 25 },
    stopsOnAbort: options.stopsOnAbort,
    harness: stubHarness(options.script, seen, started, whenStopped),
  });
  const board = taskBoard({
    name: "steer-board",
    boardId: "steer-board",
    mode: "delegation",
    collection: ledger,
    concurrency: 1,
    onReview: "exit",
    dispatcher: runOwnerDispatcher(),
    workers: { coder: dispatcher({ name: "steer-board-dispatch", action: "work", session: "per-task" }) },
  });
  const seed = handler({
    name: "steer-seed",
    inputSchema: z.object({}),
    outputSchema: z.object({ id: z.string() }),
    uses: [board.capability],
    execute: async (_input, ctx) => {
      const tasks = (ctx as { cap: Record<string, any> }).cap["steer-board"];
      if ((await tasks.getTask(TASK_ID)) === undefined) {
        await tasks.addTask({ id: TASK_ID, goal: "the feature", input: { issue: ISSUE, phase: PHASE }, assignee: "coder", maxAttempts: 3 });
      }
      return { id: TASK_ID };
    },
  });
  // A steer from the person, as `updateTask({ message })` writes one.
  const steer = handler({
    name: "steer-write",
    inputSchema: z.object({ message: z.string() }),
    outputSchema: z.unknown(),
    uses: [board.capability],
    execute: async (input, ctx) => {
      const tasks = await getOrCreateTaskCollection({
        ctx: ctx as never,
        backing: "resource",
        collectionId: BOARD_ID,
        collection: resolveResourceCollection(ctx as never, BOARD_ID)!,
      });
      return tasks.steer!(TASK_ID, { message: input.message, from: "user", by: ALICE });
    },
  });
  const cancel = handler({
    name: "steer-cancel",
    inputSchema: z.object({}),
    outputSchema: z.unknown(),
    uses: [board.capability],
    execute: async (_input, ctx) => {
      const tasks = await getOrCreateTaskCollection({
        ctx: ctx as never,
        backing: "resource",
        collectionId: BOARD_ID,
        collection: resolveResourceCollection(ctx as never, BOARD_ID)!,
      });
      return tasks.cancel(TASK_ID);
    },
  });
  // A follow-up of the task, held so no drain starts it: it waits, unclaimed, with no run link.
  const followUp = handler({
    name: "steer-follow-up",
    inputSchema: z.object({}),
    outputSchema: z.unknown(),
    uses: [board.capability],
    execute: async (_input, ctx) => {
      const tasks = (ctx as { cap: Record<string, any> }).cap["steer-board"];
      await tasks.addTask({ id: FOLLOW_UP_ID, goal: "the follow-up", input: { issue: ISSUE, phase: PHASE }, assignee: "coder", followUpOf: TASK_ID, held: true });
      return { id: FOLLOW_UP_ID };
    },
  });
  // The coding flow's own door: a line in the run's session.
  const message = harnessSessionDoor({
    name: "steer-host",
    uses: [board.capability],
    harness: stubHarness(options.script, seen, started),
    board: async (ctx) => ({
      tasks: await getOrCreateTaskCollection({
        ctx,
        backing: "resource",
        collectionId: BOARD_ID,
        collection: resolveResourceCollection(ctx, BOARD_ID)!,
      }),
      runOf: () => ({ issue: ISSUE, phase: PHASE }),
    }),
  });
  const flow = defineFlow({
    kind: "steer-host",
    actions: { seed: { block: seed }, drain: { block: board.drain }, steer: { block: steer }, cancel: { block: cancel }, followUp: { block: followUp }, message },
    internal: { actions: { ...heard } },
    task: { actions: { work: { block: manager } } },
  } as never)({ id: "steer-host" } as never);
  const state = createFlowState({
    flows: { "steer-host": flow },
    stores: { test: { primary: inMemoryStores() } },
    defaultProfile: "test",
    dispatchDrainTimeoutMs: 60_000,
  } as never);
  const runtime = async () => (state as unknown as { getRuntime(): Promise<{ stores: any; runtimeConfig: object }> }).getRuntime();

  const act = async (action: string, input: unknown = {}, sessionId = `s_${ALICE}`) => {
    const rt = await runtime();
    return (await runAction({
      flow,
      actionName: action,
      input,
      userId: ALICE,
      orgId: ORG_ID,
      sessionId,
      stores: rt.stores,
      runtimeConfig: { ...rt.runtimeConfig },
    } as never)) as { output?: any; error?: any };
  };
  const row = async (): Promise<Task> =>
    (await (await runtime()).stores.resourceState.get("org", ORG_ID, `${BOARD_ID}/${TASK_ID}`))?.state as Task;
  const until = async (predicate: (task: Task) => boolean, what: string, timeoutMs = 30_000): Promise<Task> => {
    const deadline = Date.now() + timeoutMs;
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
  return { act, row, until, seen, stepStarted, duringVerdict, whenStopped, claimedAgain, dispose: () => state.dispose() };
}

describe("a steer reaches a coding run", () => {
  it("stops a step on a harness that stops on abort, and the same request resumes the coding session with the steer", async () => {
    const h = host({ script: ["until-stopped", "finished"], stopsOnAbort: true });
    try {
      await h.act("seed");
      const first = h.stepStarted();
      await h.act("drain");
      await first;

      const steered = await h.act("steer", { message: "Use the v2 API instead." });
      expect(steered.output).toEqual({ outcome: "recorded" });
      const done = await h.until((t) => t.status === "completed", "the run to complete", 10_000 + STEER_POLL_MS);

      expect(h.seen).toHaveLength(2);
      // The next step resumes the session the stopped step confirmed, with the steer.
      expect(h.seen[1]).toMatchObject({ resume: "sess_1" });
      expect(h.seen[1]!.prompt).toContain("Use the v2 API instead.");
      expect(h.seen[1]!.prompt).toContain("stopped");
      expect(h.seen[0]!.prompt).not.toContain("Use the v2 API instead.");
      // The same request, on attempt 1: the stop used no attempt and settled nothing.
      expect(h.seen[1]!.request).toBe(h.seen[0]!.request);
      expect(done).toMatchObject({ attempts: 1 });
      expect(done.steers).toEqual([expect.objectContaining({ takenBy: 1 })]);
    } finally {
      await h.dispose();
    }
  }, 60_000);

  it("waits for a step's own end on a harness that doesn't stop on abort, then runs the next step with the steer", async () => {
    const h = host({ script: ["finish-later", "finished"], stopsOnAbort: false });
    try {
      await h.act("seed");
      const first = h.stepStarted();
      await h.act("drain");
      await first;

      await h.act("steer", { message: "Add a changelog line." });
      const done = await h.until((t) => t.status === "completed", "the run to complete");

      expect(h.seen).toHaveLength(2);
      expect(h.seen[1]).toMatchObject({ resume: "sess_1" });
      expect(h.seen[1]!.prompt).toContain("Add a changelog line.");
      expect(h.seen[1]!.prompt).not.toContain("stopped");
      expect(h.seen[1]!.request).toBe(h.seen[0]!.request);
      expect(done).toMatchObject({ attempts: 1 });
    } finally {
      await h.dispose();
    }
  }, 60_000);

  it("runs one more step for a steer that lands while the verdict is read, on a board with no late-steer turn of its own", async () => {
    // This board names no turn for a late steer, so a steer the run never
    // took would be settled over: the manager takes it before it settles.
    const h = host({ script: ["finished", "finished"], stopsOnAbort: false });
    try {
      h.duringVerdict.push(async () => {
        await h.act("steer", { message: "Also bump the version." });
      });
      await h.act("seed");
      await h.act("drain");
      const done = await h.until((t) => t.status === "completed", "the run to complete");

      expect(h.seen).toHaveLength(2);
      expect(h.seen[0]!.prompt).not.toContain("Also bump the version.");
      expect(h.seen[1]!.prompt).toContain("Also bump the version.");
      expect(h.seen[1]).toMatchObject({ resume: "sess_1", request: h.seen[0]!.request });
      expect(done).toMatchObject({ attempts: 1 });
      expect(done.steers).toEqual([expect.objectContaining({ takenBy: 1 })]);
    } finally {
      await h.dispose();
    }
  }, 60_000);

  it.each([
    ["cancelled", "the task is cancelled"],
    ["claimed again", "another attempt claims the task"],
  ] as const)("runs no more steps for a stopped step once its task is %s", async (what) => {
    const h = host({ script: ["until-stopped", "finished", "finished"], stopsOnAbort: true });
    try {
      h.whenStopped.push(async () => {
        if (what === "cancelled") await h.act("cancel");
        else await h.claimedAgain();
      });
      await h.act("seed");
      const first = h.stepStarted();
      await h.act("drain");
      await first;

      await h.act("steer", { message: "Use the v2 API instead." });
      await h.until((t) => (what === "cancelled" ? t.status === "cancelled" : t.attempts === 2), `the task ${what}`, 10_000 + STEER_POLL_MS);
      // Past a poll, a step and its follow-up: no step ran on a task this attempt no longer holds.
      await new Promise((resolve) => setTimeout(resolve, 2 * STEER_POLL_MS));

      expect(h.seen).toHaveLength(1);
    } finally {
      await h.dispose();
    }
  }, 60_000);

  it("doesn't stop a step whose harness hasn't confirmed a session: the steer costs no attempt", async () => {
    const h = host({ script: ["no-session-later"], stopsOnAbort: true });
    try {
      await h.act("seed");
      const first = h.stepStarted();
      await h.act("drain");
      await first;

      await h.act("steer", { message: "Use the v2 API instead." });
      const done = await h.until((t) => t.status === "completed" || t.status === "errored", "the run to end", 10_000 + STEER_POLL_MS);

      expect(done).toMatchObject({ status: "completed", attempts: 1 });
      expect(h.seen).toHaveLength(1);
    } finally {
      await h.dispose();
    }
  }, 60_000);

  it("carries a steer sent before the attempt started in its first prompt, and runs one step", async () => {
    const h = host({ script: ["finished"], stopsOnAbort: true });
    try {
      await h.act("seed");
      await h.act("steer", { message: "Keep the old flag." });
      await h.act("drain");
      const done = await h.until((t) => t.status === "completed", "the run to complete");

      expect(h.seen).toHaveLength(1);
      expect(h.seen[0]!.prompt).toContain("Keep the old flag.");
      expect(done).toMatchObject({ attempts: 1 });
    } finally {
      await h.dispose();
    }
  }, 60_000);
});

describe("a line typed in a coding run's session", () => {
  it("steers the run while its task is open", async () => {
    const h = host({ script: ["finish-later", "finished"], stopsOnAbort: false });
    try {
      await h.act("seed");
      const first = h.stepStarted();
      await h.act("drain");
      await first;
      const running = await h.until((t) => t.run !== undefined, "the run to link");

      const line = await h.act("message", { message: "Rename the flag too." }, running.run!.sessionId);

      expect(line.error).toBeUndefined();
      expect(line.output).toEqual({ steered: TASK_ID });
      const done = await h.until((t) => t.status === "completed", "the run to complete");
      expect(h.seen[1]!.prompt).toContain("Rename the flag too.");
      expect(done.steers).toEqual([expect.objectContaining({ from: "user", by: ALICE, takenBy: 1 })]);
    } finally {
      await h.dispose();
    }
  }, 60_000);

  it("steers a follow-up still waiting to start, as the worker door does, rather than talk", async () => {
    const h = host({ script: ["finished", "finished"], stopsOnAbort: false });
    try {
      await h.act("seed");
      await h.act("drain");
      const done = await h.until((t) => t.status === "completed", "the run to complete");
      const filed = await h.act("followUp");
      expect(filed.error).toBeUndefined();

      const line = await h.act("message", { message: "And update the docs." }, done.run!.sessionId);

      expect(line.error).toBeUndefined();
      expect(line.output).toEqual({ steered: FOLLOW_UP_ID });
      // No talk ran: the line waits on the follow-up for its first prompt.
      expect(h.seen).toHaveLength(1);
    } finally {
      await h.dispose();
    }
  }, 60_000);

  it("is talk once the task has finished: one harness run resumes its coding session, and the task doesn't change", async () => {
    const h = host({ script: ["finished", "finished"], stopsOnAbort: false });
    try {
      await h.act("seed");
      await h.act("drain");
      const done = await h.until((t) => t.status === "completed", "the run to complete");
      const before = JSON.stringify(await h.row());

      const line = await h.act("message", { message: "What did you change?" }, done.run!.sessionId);

      expect(line.error).toBeUndefined();
      expect(line.output).toEqual({ reply: "done", taskId: TASK_ID });
      expect(h.seen).toHaveLength(2);
      expect(h.seen[1]).toMatchObject({ prompt: "What did you change?", resume: "sess_1" });
      expect(JSON.stringify(await h.row())).toBe(before);
    } finally {
      await h.dispose();
    }
  }, 60_000);

  it("is refused in a session no run of the task worked in", async () => {
    const h = host({ script: ["finished"], stopsOnAbort: false });
    try {
      await h.act("seed");
      const line = await h.act("message", { message: "Hello?" }, "s_elsewhere");
      expect(String(line.error?.message ?? line.error)).toContain("hasn't started here");
      expect(h.seen).toHaveLength(0);
    } finally {
      await h.dispose();
    }
  }, 60_000);
});
