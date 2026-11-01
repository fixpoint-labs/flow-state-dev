/**
 * A run is done only when the project's checks pass (`commandCheck`), in
 * process: a real board, real fenced settlement, a real git checkout and real
 * check commands. Only the harness is a stub. The check, `node check.mjs`, is
 * red until a run writes "ok" into `state.txt`.
 */
import { afterAll, describe, expect, it } from "vitest";
import { heard } from "./heard";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import { harnessRunHandleSchema, harnessRunInputSchema } from "@flow-state-dev/core";
import type { HarnessBlock } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import {
  cancelAndResume,
  defineTaskCollection,
  getOrCreateTaskCollection,
  resolveResourceCollection,
  type SuspensionHold,
  type Task,
} from "@flow-state-dev/orchestration/tasks";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import { commandCheck, harnessDrainBudgetMs, harnessManager, harnessTaskInputSchema, resolveOwnership, runOwnerClaimOrder, runTopic, type HarnessFeeds, type PhaseSpec } from "../src";
import { harnessTaskId } from "../src/workspace";
import { seedRepo } from "./fixtures";
import { cleanUpHosts } from "./claim-host";
import { releaseLock, tryAcquireLock } from "@flow-state-dev/workspace";

const BOARD_ID = "eng.feature.work";
const FLOW = "checks-host";
const ORG_ID = "org_review";
const ALICE = "alice";
const ISSUE = "FIX-1";
const PHASE = "implement";
const TASK_ID = harnessTaskId(ISSUE, PHASE);

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  cleanUpHosts();
});

/** What one harness step does: commit a file, commit nothing, commit without confirming a session, or fail. */
type Step = "commits" | "no-commit" | "commits-no-session" | "throws" | "breaks" | "fixes" | "stops-at-limit";

interface SeenStep {
  prompt: string;
  resume: string | null;
  request: string;
  cwd: string;
}

function stubHarness(script: Step[], seen: SeenStep[], afterStep?: (cwd: string) => void) {
  return (feeds: HarnessFeeds): HarnessBlock =>
    handler({
      name: "stub-harness",
      inputSchema: harnessRunInputSchema,
      outputSchema: harnessRunHandleSchema,
      execute: async (input, ctx) => {
        const resume = await feeds.resume(ctx as never);
        const n = seen.length + 1;
        const step = script[seen.length] ?? "no-commit";
        const cwd = await feeds.cwd(ctx as never);
        seen.push({ prompt: input.prompt, resume, request: (ctx as { request: { identity: { id: string } } }).request.identity.id, cwd });
        if (step === "throws") throw new Error("the harness failed");
        const session = resume ?? `sess_${n}`;
        if (step !== "commits-no-session") await feeds.onSession(session, ctx as never);
        if (step === "breaks" || step === "fixes" || step === "stops-at-limit") {
          writeFileSync(join(cwd, "state.txt"), step === "fixes" ? "ok\n" : "broken\n");
          execFileSync("git", ["add", "."], { cwd });
          execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", `Step ${n}`], { cwd });
        }
        if (step === "commits" || step === "commits-no-session") {
          writeFileSync(join(cwd, `change-${n}.txt`), `change ${n}\n`);
          execFileSync("git", ["add", "."], { cwd });
          execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", `Change ${n}`], { cwd });
        }
        afterStep?.(cwd);
        return {
          source: "stub/test",
          status: "completed" as const,
          sessionId: session,
          url: null,
          dispatchedAt: Date.now(),
          outcome: step === "stops-at-limit" ? ("stopped-at-limit" as const) : ("finished" as const),
          finalMessage: "done",
          usage: null,
          cost: null,
        };
      },
    }) as unknown as HarnessBlock;
}

function host(options: { script: Step[]; reviewChanges?: boolean; durable?: boolean; userDeadlineMs?: number; checks?: string[]; timeoutMs?: number; slowBase?: { delayMs: number; doneTimeoutMs: number }; afterStep?: (cwd: string) => void }) {
  const dir = mkdtempSync(join(tmpdir(), "harness-manager-review-"));
  dirs.push(dir);
  const sourceRepo = join(dir, "repo");
  mkdirSync(sourceRepo, { recursive: true });
  seedRepo(sourceRepo);
  // The project's check: red until a run writes "ok" into state.txt.
  writeFileSync(
    join(sourceRepo, "check.mjs"),
    `import { readFileSync } from "node:fs";\n` +
      `let s = ""; try { s = readFileSync("state.txt", "utf8"); } catch {}\n` +
      `if (s.trim() !== "ok") { console.error("CHECK-MARKER: state is " + JSON.stringify(s.trim())); process.exit(3); }\n` +
      `console.log("all good");\n`,
  );
  writeFileSync(join(sourceRepo, "hang.mjs"), "setInterval(() => {}, 1000);\n");
  // Leaves a mark beside the checkout, so a command that ran at all is seen
  // after the checkout is gone.
  writeFileSync(join(sourceRepo, "mark.mjs"), `import { writeFileSync } from "node:fs";\nwriteFileSync(process.cwd() + ".marked", "ran");\n`);
  // Green only while the run holds its checkout: the lock sits beside it.
  writeFileSync(
    join(sourceRepo, "lock.mjs"),
    `import { existsSync } from "node:fs";\n` +
      `if (!existsSync(process.cwd() + ".lock")) { console.error("the checkout is not held"); process.exit(4); }\n`,
  );
  execFileSync("git", ["add", "."], { cwd: sourceRepo });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "checks"], { cwd: sourceRepo });
  const basePhase: PhaseSpec = {
    phase: PHASE,
    buildPrompt: async (run) => `Work on ${run.issue}, attempt ${run.attempt}.${run.feedback === undefined ? "" : `\nWhy the last attempt stopped: ${run.feedback}`}`,
    isDone: async (run) => {
      if (options.slowBase !== undefined) await new Promise((resolve) => setTimeout(resolve, options.slowBase!.delayMs));
      return run.stopReport === "finished";
    },
    ...(options.slowBase !== undefined ? { doneTimeoutMs: options.slowBase.doneTimeoutMs } : {}),
  };

  const ledger = defineTaskCollection({ id: BOARD_ID, scope: "org" as const, stateSchema: harnessTaskInputSchema });
  const seen: SeenStep[] = [];
  const manager = harnessManager({
    boardCollectionId: BOARD_ID,
    boardCollection: ledger,
    tenant: undefined,
    phase: commandCheck(basePhase, { commands: options.checks ?? ["node check.mjs"], timeoutMs: options.timeoutMs ?? 20_000 }),
    workspace: { root: join(dir, "checkouts"), sourceRepo, baseRef: "main", provisionTimeoutMs: 10_000 },
    runTimeoutMs: 20_000,
    ownership: { pollMs: 25 },
    harness: stubHarness(options.script, seen, (cwd) => options.afterStep?.(cwd)),
    ...(options.reviewChanges === true ? { reviewChanges: true } : {}),
  });
  const board = taskBoard({
    name: "review-board",
    boardId: "review-board",
    mode: "delegation",
    collection: ledger,
    concurrency: 1,
    claimOrder: runOwnerClaimOrder(),
    workers: { coder: dispatcher({ name: "review-board-dispatch", action: "work", session: "per-task" }) },
  });
  const seed = handler({
    name: "review-seed",
    inputSchema: z.object({}),
    outputSchema: z.object({ id: z.string() }),
    uses: [board.capability],
    execute: async (_input, ctx) => {
      const tasks = (ctx as { cap: Record<string, any> }).cap["review-board"];
      if ((await tasks.getTask(TASK_ID)) === undefined) {
        await tasks.createTask({ id: TASK_ID, goal: "the feature", input: { issue: ISSUE, phase: PHASE }, assignee: "coder", maxAttempts: 2 });
      }
      return { id: TASK_ID };
    },
  });
  const cancel = handler({
    name: "review-cancel",
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
      return cancelAndResume(ctx as never, tasks, TASK_ID);
    },
  });
  const flow = defineFlow({
    kind: FLOW,
    actions: { seed: { block: seed }, drain: { block: board.drain }, cancel: { block: cancel } },
    internal: { actions: { ...heard } },
    task: { actions: { work: { block: manager } } },
  } as never)({ id: FLOW } as never);
  const state = createFlowState({
    flows: { [FLOW]: flow },
    stores: { test: { primary: inMemoryStores() } },
    defaultProfile: "test",
    dispatchDrainTimeoutMs: 60_000,
    durable: options.durable ?? true,
    ...(options.userDeadlineMs === undefined ? {} : { userDeadlineMs: options.userDeadlineMs, durabilityRetention: { sweepIntervalMs: 200 } }),
  } as never);
  const runtime = async () => (state as unknown as { getRuntime(): Promise<{ stores: any; runtimeConfig: object }> }).getRuntime();

  const act = async (action: string, input: unknown = {}) => {
    const rt = await runtime();
    return (await runAction({
      flow,
      actionName: action,
      input,
      userId: ALICE,
      orgId: ORG_ID,
      sessionId: `s_${ALICE}`,
      stores: rt.stores,
      runtimeConfig: { ...rt.runtimeConfig },
    } as never)) as { output?: any; error?: any };
  };
  const row = async (): Promise<Task> =>
    (await (await runtime()).stores.resourceState.get("org", ORG_ID, `${BOARD_ID}/${TASK_ID}`))?.state as Task;
  /** Overwrite the stored row, as a delete and a same-id refile would leave it. */
  const replaceRow = async (change: (task: Task) => Task): Promise<void> => {
    const stores = (await runtime()).stores;
    const current = (await stores.resourceState.get("org", ORG_ID, `${BOARD_ID}/${TASK_ID}`))!;
    await stores.resourceState.set("org", ORG_ID, `${BOARD_ID}/${TASK_ID}`, change(current.state as Task) as never, "any");
  };
  const until = async (predicate: (task: Task) => boolean, what: string, timeoutMs = 30_000): Promise<Task> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const current = await row();
      if (current !== undefined && predicate(current)) return current;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}; row is ${JSON.stringify(current)}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };
  /** The row's open review, as a screen reads it off `questions`. */
  const review = (task: Task): SuspensionHold | undefined =>
    task.holds?.find((hold): hold is SuspensionHold => hold.source.kind === "suspension" && hold.ask.kind === "review");
  const waiting = (task: Task) => task.status === "in_progress" && review(task) !== undefined;
  /** Answer the open review through the engine's answer route, as a screen does. */
  const answer = async (data: unknown): Promise<Response> => {
    const hold = review(await row())!;
    const router = await state.getRouter();
    const path = [FLOW, "requests", hold.source.requestId, "answer"];
    return router.POST(
      new Request(`http://localhost/api/flows/${path.join("/")}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-org-id": ORG_ID },
        body: JSON.stringify({ suspensionId: hold.source.suspensionId, action: "submit", data, userId: ALICE }),
      }),
      { params: { path } } as never,
    );
  };
  const start = async () => {
    // The router builds the durability sweeper, which ends a stop at its deadline.
    await state.getRouter();
    await act("seed");
    await act("drain");
  };
  /** Wait for a failed try to go back on the board, and hand out the next one. */
  const retry = async () => {
    await until((t) => t.status === "pending", "the failed try back on the board");
    await act("drain");
  };
  /** The run record of this task's run, as the manager wrote it. */
  const runRow = async () => {
    const rt = await runtime();
    return (await rt.stores.resourceState.get("user", `${ALICE}:~org:${ORG_ID}`, `runs/${runTopic(BOARD_ID, ISSUE, PHASE)}`))?.state as any;
  };
  /** The engine's record of a review hold's stop, with the `data` a screen reads. */
  const suspension = async (hold: SuspensionHold) =>
    (await (await runtime()).stores.suspensions.get(hold.source.requestId, hold.source.suspensionId)) as { data?: any } | null;
  return { act, row, replaceRow, until, review, waiting, answer, start, retry, seen, runRow, suspension, checkouts: join(dir, "checkouts"), dispose: () => state.dispose() };
}

/** Every file under `root` whose name ends with `suffix`. */
function filesUnder(root: string, suffix: string): string[] {
  if (!existsSync(root)) return [];
  return (readdirSync(root, { recursive: true }) as string[]).filter((path) => path.endsWith(suffix));
}

/** Every checkout lock left under `root`. */
function lockFilesUnder(root: string): string[] {
  return filesUnder(root, ".lock");
}

describe("a run is done only when its checks pass", () => {
  it("refuses a run whose code fails a check, records why, and hands the output to the next attempt", async () => {
    const h = host({ script: ["breaks", "fixes"], reviewChanges: true });
    try {
      await h.start();
      await h.retry();
      const held = await h.until(h.waiting, "the second try's review");
      expect(held.attempts).toBe(2);
      expect(h.seen).toHaveLength(2);
      // The next attempt's brief names the command and carries the end of its output.
      expect(h.seen[1]!.prompt).toContain("`node check.mjs` exited 3");
      expect(h.seen[1]!.prompt).toContain("CHECK-MARKER");
      // The review shows the checks that passed.
      const hold = h.review(held)!;
      expect(hold.ask.prompt).toContain("Checks 1/1 passed.");
      expect((await h.suspension(hold))?.data?.checks).toEqual([
        expect.objectContaining({ command: "node check.mjs", exitCode: 0, timedOut: false, skipped: false }),
      ]);
      const record = await h.runRow();
      expect(record.checks).toEqual([expect.objectContaining({ exitCode: 0 })]);
    } finally {
      await h.dispose();
    }
  }, 90_000);

  it("keeps a red attempt's checks on the run record", async () => {
    const h = host({ script: ["breaks", "breaks"] });
    try {
      await h.start();
      await h.until((t) => t.status === "pending" && t.attempts === 1, "the first try back on the board");
      const record = await h.runRow();
      expect(record.checks).toEqual([expect.objectContaining({ command: "node check.mjs", exitCode: 3 })]);
      expect(record.checks[0].tail).toContain("CHECK-MARKER");
    } finally {
      await h.dispose();
    }
  }, 90_000);

  it("runs no command for a run its own check refused", async () => {
    const h = host({ script: ["stops-at-limit", "stops-at-limit"] });
    try {
      await h.start();
      await h.until((t) => t.status === "pending" && t.attempts === 1, "the first try back on the board");
      expect((await h.runRow()).checks).toBeNull();
    } finally {
      await h.dispose();
    }
  }, 90_000);

  it("stops a check past its budget, and the run is not done", async () => {
    const h = host({ script: ["fixes", "fixes"], checks: ["node hang.mjs", "node check.mjs"], timeoutMs: 1_000 });
    try {
      await h.start();
      await h.until((t) => t.status === "pending" && t.attempts === 1, "the first try back on the board");
      const record = await h.runRow();
      expect(record.checks).toEqual([
        expect.objectContaining({ command: "node hang.mjs", timedOut: true }),
        expect.objectContaining({ command: "node check.mjs", skipped: true }),
      ]);
    } finally {
      await h.dispose();
    }
  }, 90_000);

  it("holds the checkout while the commands run, and lets it go after", async () => {
    // A replacement attempt takes the checkout's lock before it provisions,
    // so commands that write to the tree must run under that lock.
    const h = host({ script: ["fixes"], checks: ["node lock.mjs"] });
    try {
      await h.start();
      const done = await h.until((t) => t.status === "completed", "the run to complete");
      expect(done.attempts).toBe(1);
      expect((await h.runRow()).checks).toEqual([expect.objectContaining({ command: "node lock.mjs", exitCode: 0 })]);
      expect(lockFilesUnder(h.checkouts)).toEqual([]);
    } finally {
      await h.dispose();
    }
  }, 90_000);

  it("starts no command once the check's time is up", async () => {
    // The phase's own check answers after the whole bound has passed. The
    // manager has failed the attempt and is about to let the checkout go, so
    // a command started now would write under a replacement attempt.
    const h = host({ script: ["fixes", "fixes"], checks: ["node mark.mjs"], timeoutMs: 300, slowBase: { delayMs: 1_500, doneTimeoutMs: 300 } });
    try {
      await h.start();
      const after = await h.until((t) => t.status === "pending" && typeof t.feedback === "string", "the first attempt to fail on time");
      expect(after.feedback).toMatch(/did not answer within/);
      // Long enough for the late check to have started its command, had it.
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      expect(filesUnder(h.checkouts, ".marked")).toEqual([]);
    } finally {
      await h.dispose();
    }
  }, 90_000);

  it("runs no command for an attempt cancelled while it waited for the checkout", async () => {
    // Something else holds the checkout when the agent stops, and the task is
    // cancelled during the wait. The lock alone can't tell the attempt is
    // gone, so the commands would run in a checkout no longer its own.
    let intruder: ReturnType<typeof tryAcquireLock>;
    let cancelled = false;
    const h = host({
      script: ["fixes"],
      checks: ["node mark.mjs"],
      afterStep: (cwd) => {
        const grab = (): void => {
          intruder = tryAcquireLock(`${cwd}.lock`, { waitMs: 0, pollMs: 5, staleAfterMs: 600_000 }, { owner: "someone-else" });
          if (intruder === undefined) {
            setTimeout(grab, 2);
            return;
          }
          setTimeout(async () => {
            await h.act("cancel");
            cancelled = true;
            setTimeout(() => releaseLock(intruder!), 500);
          }, 300);
        };
        setTimeout(grab, 0);
      },
    });
    try {
      await h.start();
      await h.until(() => cancelled, "the task to be cancelled");
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      expect(filesUnder(h.checkouts, ".marked")).toEqual([]);
    } finally {
      await h.dispose();
    }
  }, 90_000);

  it("runs no command for an attempt whose task was filed again while it waited", async () => {
    // The task is deleted and filed again under the same id during the wait.
    // The replacement is in progress on attempt 1, turn 1 as well; only its
    // incarnation tells it from the task this attempt was working.
    let intruder: ReturnType<typeof tryAcquireLock>;
    let replaced = false;
    const h = host({
      script: ["fixes"],
      checks: ["node mark.mjs"],
      afterStep: (cwd) => {
        const grab = (): void => {
          intruder = tryAcquireLock(`${cwd}.lock`, { waitMs: 0, pollMs: 5, staleAfterMs: 600_000 }, { owner: "someone-else" });
          if (intruder === undefined) {
            setTimeout(grab, 2);
            return;
          }
          setTimeout(async () => {
            await h.replaceRow((task) => ({ ...task, incarnationId: "the-replacement" }));
            replaced = true;
            setTimeout(() => releaseLock(intruder!), 500);
          }, 300);
        };
        setTimeout(grab, 0);
      },
    });
    try {
      await h.start();
      await h.until(() => replaced, "the task to be filed again");
      expect((await h.row()).incarnationId).toBe("the-replacement");
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      expect(filesUnder(h.checkouts, ".marked")).toEqual([]);
    } finally {
      await h.dispose();
    }
  }, 90_000);

  it("completes a run whose checks pass", async () => {
    const h = host({ script: ["fixes"] });
    try {
      await h.start();
      const done = await h.until((t) => t.status === "completed", "the run to complete");
      expect(done.attempts).toBe(1);
      expect((await h.runRow()).checks).toEqual([expect.objectContaining({ exitCode: 0 })]);
    } finally {
      await h.dispose();
    }
  }, 90_000);
});

describe("the time a check gets", () => {
  it("covers the phase's own check and the commands, and the shutdown budget reserves it", () => {
    const phase = commandCheck({ phase: "p", buildPrompt: () => "", isDone: () => true }, { commands: [], timeoutMs: 600_000 });
    expect(phase.doneTimeoutMs).toBe(60_000 + 600_000);
    const base = { runTimeoutMs: 60_000, ownershipWaitMs: 1_000 };
    expect(harnessDrainBudgetMs({ ...base, doneTimeoutMs: phase.doneTimeoutMs }) - harnessDrainBudgetMs(base)).toBe(Math.ceil((600_000 * 4) / 3));
  });

  it("keeps the checkout's lock from going stale while a long check holds it", () => {
    // The check holds the lock fresh for up to its bound, so a stale window
    // sized on the run alone would let a waiter take it mid-check.
    const { maxLockHeldMs, ownership } = resolveOwnership({ runTimeoutMs: 60_000, provisionTimeoutMs: 10_000, doneTimeoutMs: 1_800_000 });
    expect(maxLockHeldMs).toBeGreaterThanOrEqual(1_800_000);
    expect(ownership.staleAfterMs).toBeGreaterThan(1_800_000);
    expect(() =>
      resolveOwnership({ runTimeoutMs: 60_000, provisionTimeoutMs: 10_000, doneTimeoutMs: 1_800_000, ownership: { staleAfterMs: 600_000, waitMs: 700_000 } }),
    ).toThrow(/staleAfterMs/);
  });

  it("refuses a budget that isn't a positive whole number at construction", () => {
    expect(() => commandCheck({ phase: "p", buildPrompt: () => "", isDone: () => true }, { commands: [], timeoutMs: -1 })).toThrow(/timeoutMs/);
  });
});
