/**
 * The manager on a board a channel holds — an organization-scoped ledger whose
 * id carries dots.
 *
 * Driven end to end, in process: a real `createFlowState`, a real task board
 * and its same-flow hand-off, the real fenced settlement and a real git
 * checkout. Only the harness is a fake, and it records what the manager fed it
 * so the checkout, the branch and the resumed session can be compared across
 * attempts.
 *
 * Two claims, one per `describe`:
 *
 * 1. **The tracer.** A row on `eng.feature.work` runs through the manager to
 *    `completed`. Before the board-id grammar widened, the manager refused the
 *    id on the first attempt.
 * 2. **Whose run it is.** The ledger is kept per organization, so a second
 *    member can drain it. A row whose run the first member started is refused
 *    to the second, naming the first, with no attempt charged and the row's
 *    status untouched; the first member's own retry lands in the same checkout,
 *    branch, run record and agent session.
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import { harnessRunHandleSchema, harnessRunInputSchema } from "@flow-state-dev/core";
import type { HarnessBlock } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { defineTaskCollection, type Task } from "@flow-state-dev/orchestration/tasks";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import {
  HARNESS_RUN_OWNER_KEY,
  harnessManager,
  harnessTaskInputSchema,
  runOwnerDispatcher,
  runTopic,
  type HarnessFeeds,
} from "../src";
import { harnessTaskId } from "../src/workspace";
import { seedRepo } from "./fixtures";

/** A board a channel holds: `<channel id>.<board name>`, as the workforce mints it. */
const CHANNEL_BOARD_ID = "eng.feature.work";
const ORG_ID = "org_channel_board";
const ALICE = "alice";
const BOB = "bob";
const ISSUE = "FIX-1";
const PHASE = "implement";
const TASK_ID = harnessTaskId(ISSUE, PHASE);

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** What the fake harness saw on one run, read off the feeds the manager handed it. */
interface SeenRun {
  cwd: string;
  resume: string | null;
  user: string;
}

/**
 * A harness that reports `finished` or a failure, per call, from a script.
 *
 * The session id it reports is stable per checkout, which is what a resumed
 * vendor session looks like from the manager's side.
 */
function scriptedHarness(script: Array<"finished" | "failed">, seen: SeenRun[]) {
  let calls = 0;
  return (feeds: HarnessFeeds): HarnessBlock =>
    handler({
      name: "fake-harness",
      inputSchema: harnessRunInputSchema,
      outputSchema: harnessRunHandleSchema,
      execute: async (_input, ctx) => {
        const cwd = await feeds.cwd(ctx as never);
        const resume = await feeds.resume(ctx as never);
        seen.push({
          cwd,
          resume,
          user: String((ctx as { user?: { identity?: { id?: unknown } } }).user?.identity?.id),
        });
        const outcome = script[calls++] ?? "finished";
        const sessionId = resume ?? `sess_${seen.length}`;
        await feeds.onSession(sessionId, ctx as never);
        return {
          source: "fake/test",
          status: outcome === "finished" ? ("completed" as const) : ("failed" as const),
          sessionId,
          url: null,
          dispatchedAt: Date.now(),
          outcome: outcome === "finished" ? ("finished" as const) : ("errored" as const),
          finalMessage: null,
          usage: null,
          cost: null,
        };
      },
    }) as unknown as HarnessBlock;
}

/**
 * One flow: a `seed` action, a `drain` action, and the manager behind the
 * board's same-flow hand-off — the conductor lab's shape, on an org ledger.
 */
function host(options: { script: Array<"finished" | "failed">; gate: boolean }) {
  const dir = mkdtempSync(join(tmpdir(), "harness-manager-channel-board-"));
  dirs.push(dir);
  const sourceRepo = join(dir, "repo");
  mkdirSync(sourceRepo, { recursive: true });
  seedRepo(sourceRepo);

  const ledger = defineTaskCollection({
    id: CHANNEL_BOARD_ID,
    scope: "org" as const,
    stateSchema: harnessTaskInputSchema,
  });
  const seen: SeenRun[] = [];
  const branches: string[] = [];
  const manager = harnessManager({
    boardCollectionId: CHANNEL_BOARD_ID,
    boardCollection: ledger,
    tenant: undefined,
    phase: {
      phase: PHASE,
      buildPrompt: (run: { branch: string }) => {
        branches.push(run.branch);
        return "go";
      },
      isDone: () => true,
    },
    workspace: { root: join(dir, "checkouts"), sourceRepo, baseRef: "main", provisionTimeoutMs: 10_000 },
    runTimeoutMs: 20_000,
    ownership: { pollMs: 25 },
    harness: scriptedHarness(options.script, seen),
  });
  const board = taskBoard({
    name: "channel-board",
    boardId: "channel-board",
    collection: ledger,
    concurrency: 1,
    ...(options.gate ? { dispatcher: runOwnerDispatcher() } : {}),
    workers: {
      coder: dispatcher({ name: "channel-board-hand-off", action: "work", session: "per-task" }),
    },
  });
  const seed = handler({
    name: "channel-board-seed",
    inputSchema: z.object({}),
    outputSchema: z.object({ id: z.string() }),
    uses: [board.capability],
    execute: async (_input, ctx) => {
      const tasks = (ctx as { cap: Record<string, any> }).cap["channel-board"];
      if ((await tasks.getTask(TASK_ID)) === undefined) {
        await tasks.addTask({
          id: TASK_ID,
          goal: "the feature",
          input: { issue: ISSUE, phase: PHASE },
          assignee: "coder",
          maxAttempts: 3,
        });
      }
      return { id: TASK_ID };
    },
  });
  const flow = defineFlow({
    kind: "channel-board-host",
    actions: { seed: { block: seed }, drain: { block: board.drain } },
    task: { actions: { work: { block: manager } } },
  } as never)({ id: "channel-board-host" } as never);
  const state = createFlowState({
    flows: { "channel-board-host": flow },
    stores: { test: { primary: inMemoryStores() } },
    defaultProfile: "test",
    dispatchDrainTimeoutMs: 60_000,
  } as never);

  const act = async (userId: string, action: string) => {
    const runtime = await (state as unknown as {
      getRuntime(): Promise<{ stores: any; runtimeConfig: object }>;
    }).getRuntime();
    const result = (await runAction({
      flow,
      actionName: action,
      input: {},
      userId,
      orgId: ORG_ID,
      sessionId: `s_${userId}`,
      stores: runtime.stores,
      runtimeConfig: { ...runtime.runtimeConfig },
    } as never)) as { output?: unknown; error?: unknown };
    return result;
  };

  const row = async (): Promise<Task> => {
    const runtime = await (state as unknown as {
      getRuntime(): Promise<{ stores: any }>;
    }).getRuntime();
    const record = await runtime.stores.resourceState.get(
      "org",
      ORG_ID,
      `${CHANNEL_BOARD_ID}/${TASK_ID}`,
    );
    return record?.state as Task;
  };

  /**
   * The row once nothing is working it. The hand-off is fire-and-forget, so a
   * drain returns while the child run is still going; `pending` counts as
   * settled, since a re-pended row is a result in its own right.
   */
  const settled = async (timeoutMs = 30_000): Promise<Task> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const current = await row();
      if (current !== undefined && current.status !== "in_progress") return current;
      if (Date.now() > deadline) throw new Error(`the row never settled (${current?.status})`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };

  /** One member's run record for this row — user-scoped, keyed by the run topic. */
  const runRecord = async (userId: string) => {
    const runtime = await (state as unknown as {
      getRuntime(): Promise<{ stores: any }>;
    }).getRuntime();
    const record = await runtime.stores.resourceState.get(
      "user",
      userId,
      `runs/${runTopic(CHANNEL_BOARD_ID, ISSUE, PHASE)}`,
    );
    return record?.state as { attempt?: number; outcome?: string; sessionId?: string | null } | undefined;
  };

  return { act, row, settled, seen, branches, runRecord };
}

/** The message a refused action carries, however the engine wrapped it. */
function messageOf(error: unknown): string {
  const e = error as { message?: unknown; cause?: { message?: unknown } } | undefined;
  return `${String(e?.message ?? "")} ${String(e?.cause?.message ?? "")} ${JSON.stringify(error)}`;
}

describe("a row on a channel's board", () => {
  it("runs through the manager to completed, on an organization-scoped ledger", async () => {
    const lab = host({ script: ["finished"], gate: true });
    expect((await lab.act(ALICE, "seed")).error).toBeUndefined();

    const drained = await lab.act(ALICE, "drain");
    expect(drained.error, messageOf(drained.error)).toBeUndefined();

    const settled = await lab.settled();
    expect(settled.status, String(settled.error ?? settled.feedback)).toBe("completed");
    expect(settled.attempts).toBe(1);
    // The checkout the harness ran in carries the board's id as is — no
    // translation of the dots.
    expect(lab.seen).toHaveLength(1);
    expect(lab.seen[0]!.cwd).toContain(`/${CHANNEL_BOARD_ID}/`);
  }, 60_000);
});

describe("a run on a shared board belongs to the member who started it", () => {
  it("refuses another member's drain without charging it, and resumes for the starter", async () => {
    const lab = host({ script: ["failed", "finished"], gate: true });
    expect((await lab.act(ALICE, "seed")).error).toBeUndefined();

    // Alice's first attempt fails: back to pending, one attempt spent.
    await lab.act(ALICE, "drain");
    const afterAlice = await lab.settled();
    expect(afterAlice.status).toBe("pending");
    expect(afterAlice.attempts).toBe(1);
    expect((afterAlice.metadata as Record<string, unknown>)[HARNESS_RUN_OWNER_KEY]).toEqual({
      userId: ALICE,
    });

    // Bob, same organization, drains the same board.
    const bobs = await lab.act(BOB, "drain");
    expect(bobs.error, "Bob's drain was not refused").toBeDefined();
    expect(messageOf(bobs.error)).toContain(`"${ALICE}"`);
    const afterBob = await lab.settled();
    expect(afterBob.status).toBe("pending");
    expect(afterBob.attempts).toBe(1);
    expect(lab.seen.map((run) => run.user)).toEqual([ALICE]);

    // Alice's retry: same checkout, and the session her first attempt opened.
    const retried = await lab.act(ALICE, "drain");
    expect(retried.error, messageOf(retried.error)).toBeUndefined();
    const done = await lab.settled();
    expect(done.status).toBe("completed");
    expect(done.attempts).toBe(2);
    expect(lab.seen).toHaveLength(2);
    expect(lab.seen[1]!.cwd).toBe(lab.seen[0]!.cwd);
    expect(lab.branches).toHaveLength(2);
    expect(lab.branches[1]).toBe(lab.branches[0]);
    expect(lab.seen[1]!.resume).toBe("sess_1");
    // One run record, Alice's, carried both attempts; Bob never opened one.
    const record = await lab.runRecord(ALICE);
    expect(record?.attempt).toBe(2);
    expect(record?.outcome).toBe("succeeded");
    expect(await lab.runRecord(BOB)).toBeUndefined();
  }, 90_000);

  it("without the dispatcher, the manager still refuses to fork the run, at the cost of the attempt", async () => {
    // The backstop, for a board whose drain was not wired with
    // `runOwnerDispatcher`: Bob's drain claims the row (the claim spends the
    // attempt), and the manager refuses it before deriving anything, so no
    // second checkout, branch or run record exists.
    const lab = host({ script: ["failed", "finished"], gate: false });
    await lab.act(ALICE, "seed");
    await lab.act(ALICE, "drain");
    expect((await lab.settled()).attempts).toBe(1);

    await lab.act(BOB, "drain");
    const afterBob = await lab.settled();
    expect(afterBob.status).toBe("pending");
    expect(afterBob.attempts).toBe(2);
    expect(String(afterBob.feedback)).toContain(`"${ALICE}"`);
    expect(lab.seen.map((run) => run.user)).toEqual([ALICE]);
    expect(await lab.runRecord(BOB)).toBeUndefined();
  }, 90_000);
});
