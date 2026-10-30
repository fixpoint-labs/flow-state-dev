/**
 * A line typed into a running Claude Code task stops the run (FIX-2312).
 *
 * `claudeCodeAgent` declares `stopsOnAbort` on its block, and the harness
 * manager reads it when the host sets nothing. So a host that wires Claude
 * Code into the slot, and says nothing about stopping, still gets a steer that
 * stops the running step, and the same request resumes the coding session
 * with the line. Without the declaration the line waits for the run's own
 * end, which this fake run never reaches.
 *
 * Asserted here rather than in either package: harness-manager names no
 * coding agent (its import sweep in `slot.spec.ts`), and claude-code takes no
 * orchestration dependency. Only the Agent SDK's `query` is fake.
 */
import { afterAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { claudeCodeAgent, type ResolveClaudeAgent, type SdkMessageLike } from "@flow-state-dev/claude-code/sdk";
import {
  harnessManager,
  harnessTaskInputSchema,
  runOwnerClaimOrder,
  STEER_POLL_MS,
} from "@flow-state-dev/harness-manager";
import {
  defineTaskCollection,
  getOrCreateTaskCollection,
  resolveResourceCollection,
  type Task,
} from "@flow-state-dev/orchestration/tasks";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import { heard } from "../helpers/heard";

const BOARD_ID = "cc.steer.work";
const ORG_ID = "org_cc_steer";
const USER = "alice";
/** The id the manager derives from the row's payload (its `harnessTaskId`). */
const TASK_ID = "fix-1--implement";
const SESSION = "sess_cc";

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** A git repository with one commit and an origin, as the manager's checkout needs. */
function seedRepo(dir: string): void {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  git("init", "--initial-branch=main", ".");
  git("config", "user.email", "steer@example.test");
  git("config", "user.name", "Steer Test");
  writeFileSync(join(dir, "tracked.txt"), "content\n");
  // The manager refuses a checkout whose repository doesn't ignore its `.fsdev/` files.
  writeFileSync(join(dir, ".gitignore"), "**/.fsdev/\n");
  git("add", "tracked.txt", ".gitignore");
  git("commit", "-m", "root");
  git("remote", "add", "origin", "https://github.com/fixpoint-labs/steer-fixture.git");
}

/**
 * The Agent SDK's `query`, faked. The first run names its session and works
 * until its abort controller fires, then ends, as the SDK's stream does once
 * its process exits. Every later run names the same session and finishes.
 */
function fakeClaude(calls: Array<{ prompt: string; resume: string | undefined }>, firstRunning: () => void): ResolveClaudeAgent {
  return () => ({
    query: async function* (args) {
      calls.push({ prompt: String(args.prompt), resume: args.options?.resume });
      yield { type: "system", subtype: "init", session_id: SESSION } as SdkMessageLike;
      if (calls.length === 1) {
        firstRunning();
        const signal = args.options?.abortController?.signal;
        await new Promise<void>((resolve) => {
          if (signal === undefined || signal.aborted) return resolve();
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
        return;
      }
      yield { type: "result", subtype: "success", result: "done", session_id: SESSION } as SdkMessageLike;
    },
  });
}

function host() {
  const dir = mkdtempSync(join(tmpdir(), "cc-steer-"));
  dirs.push(dir);
  const sourceRepo = join(dir, "repo");
  mkdirSync(sourceRepo, { recursive: true });
  seedRepo(sourceRepo);

  const calls: Array<{ prompt: string; resume: string | undefined }> = [];
  let firstRunning = () => {};
  const running = new Promise<void>((resolve) => (firstRunning = resolve));
  const ledger = defineTaskCollection({ id: BOARD_ID, scope: "org" as const, stateSchema: harnessTaskInputSchema });
  const manager = harnessManager({
    boardCollectionId: BOARD_ID,
    boardCollection: ledger,
    tenant: undefined,
    phase: { phase: "implement", buildPrompt: async (run) => `Work on ${run.issue}.`, isDone: async () => true },
    workspace: { root: join(dir, "checkouts"), sourceRepo, baseRef: "main", provisionTimeoutMs: 10_000 },
    // Long past the test's wait: the run ends early only if the steer stops it.
    runTimeoutMs: 15_000,
    ownership: { pollMs: 25 },
    // No `stopsOnAbort`: the harness's own declaration decides.
    harness: ({ cwd, resume, onSession }) =>
      claudeCodeAgent({ cwd, resume, onSession, detached: true, resolveClaudeAgent: fakeClaude(calls, firstRunning) }),
  });
  const board = taskBoard({
    name: "cc-steer-board",
    boardId: "cc-steer-board",
    mode: "delegation",
    collection: ledger,
    concurrency: 1,
    claimOrder: runOwnerClaimOrder(),
    workers: { coder: dispatcher({ name: "cc-steer-dispatch", action: "work", session: "per-task" }) },
  });
  const seed = handler({
    name: "cc-steer-seed",
    inputSchema: z.object({}),
    outputSchema: z.unknown(),
    uses: [board.capability],
    execute: async (_input, ctx) => {
      const tasks = (ctx as { cap: Record<string, any> }).cap["cc-steer-board"];
      await tasks.createTask({ id: TASK_ID, goal: "the feature", input: { issue: "FIX-1", phase: "implement" }, assignee: "coder", maxAttempts: 3 });
      return {};
    },
  });
  // A line typed into the running task, as `updateTask({ message })` writes one.
  const steer = handler({
    name: "cc-steer-write",
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
      return tasks.steer!(TASK_ID, { message: input.message, from: "user", by: USER });
    },
  });
  const flow = defineFlow({
    kind: "cc-steer-host",
    actions: { seed: { block: seed }, drain: { block: board.drain }, steer: { block: steer } },
    internal: { actions: { ...heard } },
    task: { actions: { work: { block: manager } } },
  } as never)({ id: "cc-steer-host" } as never);
  const state = createFlowState({
    flows: { "cc-steer-host": flow },
    stores: { test: { primary: inMemoryStores() } },
    defaultProfile: "test",
    dispatchDrainTimeoutMs: 60_000,
  } as never);
  const runtime = async () => (state as unknown as { getRuntime(): Promise<{ stores: any; runtimeConfig: object }> }).getRuntime();
  const act = async (action: string, input: unknown = {}) => {
    const rt = await runtime();
    return (await runAction({
      flow,
      actionName: action,
      input,
      userId: USER,
      orgId: ORG_ID,
      sessionId: `s_${USER}`,
      stores: rt.stores,
      runtimeConfig: { ...rt.runtimeConfig },
    } as never)) as { output?: any; error?: any };
  };
  const until = async (predicate: (task: Task) => boolean, what: string, timeoutMs: number): Promise<Task> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const row = (await (await runtime()).stores.resourceState.get("org", ORG_ID, `${BOARD_ID}/${TASK_ID}`))?.state as Task | undefined;
      if (row !== undefined && predicate(row)) return row;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}; row is ${JSON.stringify(row)}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };
  return { act, until, calls, running, dispose: () => state.dispose() };
}

describe("a line typed into a running Claude Code task", () => {
  it("declares stopsOnAbort on the block it returns", () => {
    expect(claudeCodeAgent({ detached: true }).stopsOnAbort).toBe(true);
  });

  it("stops the run, and the same request resumes its session with the line", async () => {
    const h = host();
    try {
      await h.act("seed");
      await h.act("drain");
      await h.running;

      expect((await h.act("steer", { message: "Use the v2 API instead." })).output).toEqual({ outcome: "recorded" });
      const done = await h.until((t) => t.status === "completed", "the stopped run's next step to complete", 5_000 + STEER_POLL_MS);

      expect(h.calls).toHaveLength(2);
      expect(h.calls[0]!.prompt).not.toContain("Use the v2 API instead.");
      // The next step continues the session the stopped run named, with the line.
      expect(h.calls[1]!.resume).toBe(SESSION);
      expect(h.calls[1]!.prompt).toContain("Use the v2 API instead.");
      // A stop for a steer uses no attempt.
      expect(done).toMatchObject({ attempts: 1 });
      expect(done.steers).toEqual([expect.objectContaining({ takenBy: 1 })]);
    } finally {
      await h.dispose();
    }
  }, 30_000);
});
