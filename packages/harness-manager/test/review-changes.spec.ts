/**
 * A coding run that made changes waits for a person's review (FIX-2163), in
 * process: a real `createFlowState` with durable execution, a real board, real
 * fenced settlement, a real git checkout, and answers through the engine's
 * answer route as a screen sends them. Only the harness is a stub, and it
 * records what each step was handed.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { heard } from "./heard";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { z } from "zod";
import { OBSERVED_PULL_REQUESTS, defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import { harnessRunHandleSchema, harnessRunInputSchema } from "@flow-state-dev/core";
import type { BlockContext, HarnessBlock } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import {
  cancelAndResume,
  defineTaskCollection,
  getOrCreateTaskCollection,
  openRowHolds,
  resolveResourceCollection,
  type SuspensionHold,
  type Task,
} from "@flow-state-dev/orchestration/tasks";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import {
  harnessManager,
  harnessRunChangesRead,
  HarnessRunChangesRefused,
  harnessTaskInputSchema,
  runOwnerClaimOrder,
  type HarnessFeeds,
  type HarnessJudgeVerdict,
} from "../src";
import { harnessTaskId } from "../src/workspace";
import { reviewDetail } from "../src/browser";
import { seedRepo } from "./fixtures";
import { CONVERSATIONS, claimHost, cleanUpHosts } from "./claim-host";

const BOARD_ID = "eng.feature.work";
const FLOW = "review-host";
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
type Step = "commits" | "no-commit" | "commits-no-session" | "throws";

interface SeenStep {
  prompt: string;
  resume: string | null;
  request: string;
  cwd: string;
}

function stubHarness(script: Step[], seen: SeenStep[]) {
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
        if (step === "commits" || step === "commits-no-session") {
          writeFileSync(join(cwd, `change-${n}.txt`), `change ${n}\n`);
          execFileSync("git", ["add", "."], { cwd });
          execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", `Change ${n}`], { cwd });
        }
        return {
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
      },
    }) as unknown as HarnessBlock;
}

/** A judge that answers `verdict`, read by the manager on a board read from the claim. */
function scriptedJudge(verdict: HarnessJudgeVerdict) {
  return {
    floor: 0.7,
    block: handler({ name: "scripted-judge", inputSchema: z.unknown(), outputSchema: z.unknown(), execute: () => verdict }),
  };
}

function host(options: { script: Step[]; reviewChanges?: boolean; durable?: boolean; userDeadlineMs?: number; remote?: boolean }) {
  const dir = mkdtempSync(join(tmpdir(), "harness-manager-review-"));
  dirs.push(dir);
  const sourceRepo = join(dir, "repo");
  mkdirSync(sourceRepo, { recursive: true });
  seedRepo(sourceRepo);
  // A bare repository on disk as `origin`, set before the host pins it, for an accept that pushes.
  const remote = join(dir, "origin.git");
  if (options.remote === true) {
    execFileSync("git", ["clone", "-q", "--bare", sourceRepo, remote]);
    execFileSync("git", ["remote", "set-url", "origin", remote], { cwd: sourceRepo });
  }

  const ledger = defineTaskCollection({ id: BOARD_ID, scope: "org" as const, stateSchema: harnessTaskInputSchema });
  const seen: SeenStep[] = [];
  const manager = harnessManager({
    boardCollectionId: BOARD_ID,
    boardCollection: ledger,
    tenant: undefined,
    phase: { phase: PHASE, buildPrompt: async (run) => `Work on ${run.issue}, attempt ${run.attempt}.`, isDone: async () => true },
    workspace: { root: join(dir, "checkouts"), sourceRepo, baseRef: "main", provisionTimeoutMs: 10_000 },
    runTimeoutMs: 20_000,
    ownership: { pollMs: 25 },
    harness: stubHarness(options.script, seen),
    ...(options.reviewChanges === false ? {} : { reviewChanges: true }),
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
  // What the run changed, read from its session as a review screen reads it (FIX-2384).
  const changes = harnessRunChangesRead({
    name: "review-host",
    uses: [board.capability],
    board: async (ctx: BlockContext) => ({
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
    kind: FLOW,
    actions: { seed: { block: seed }, drain: { block: board.drain }, cancel: { block: cancel } },
    reads: { changes },
    internal: { actions: { ...heard } },
    task: { actions: { work: { block: manager } } },
  } as never)({ id: FLOW } as never);
  const state = createFlowState({
    flows: { [FLOW]: flow },
    stores: { test: { primary: inMemoryStores() } },
    defaultProfile: "test",
    dispatchDrainTimeoutMs: 60_000,
    // Every route call is Alice's, in her organization, as the run's session is bound.
    resolvePrincipal: () => ({ userId: ALICE, orgId: ORG_ID }),
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
  /** The engine's record of the open review: the stop's data, as a screen reads it from the run's session. */
  const stop = async (hold: SuspensionHold) =>
    (await runtime()).stores.suspensions.get(hold.source.requestId, hold.source.suspensionId) as Promise<{ data?: unknown } | null>;
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
  /** The open review's stop, as the engine keeps it: its `data` is what a review screen draws. */
  const reviewData = async (task: Task): Promise<Record<string, unknown> | undefined> => {
    const hold = review(task)!;
    return (await (await runtime()).stores.suspensions.get(hold.source.requestId, hold.source.suspensionId))?.data;
  };
  /** The `changes` read, on the run's own session, through the engine's read route. */
  const readChanges = async (input: Record<string, unknown>, sessionId?: string): Promise<{ status: number; body: any }> => {
    const router = await state.getRouter();
    const path = [FLOW, sessionId ?? (await row()).run!.sessionId, "reads", "changes"];
    const res = await router.POST(
      new Request(`http://localhost/api/flows/${path.join("/")}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-org-id": ORG_ID },
        body: JSON.stringify({ userId: ALICE, input }),
      }),
      { params: { path } } as never,
    );
    return { status: res.status, body: await res.json() };
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
  /** The run session's pull request record (FIX-2268), as a reader of the session reads it. */
  const pullRequests = async (sessionId: string) =>
    Object.keys(await (await runtime()).stores.resourceState.getByPrefix("session", sessionId, `${OBSERVED_PULL_REQUESTS}/`));
  return {
    act,
    row,
    until,
    review,
    stop,
    reviewData,
    readChanges,
    waiting,
    answer,
    start,
    retry,
    seen,
    sourceRepo,
    remote,
    pullRequests,
    dispose: () => state.dispose(),
  };
}

describe("a coding run that made changes waits for a person's review", () => {
  it("holds the task on a review naming the commits and that no judge read it, with the checkout free", async () => {
    const h = host({ script: ["commits"] });
    try {
      await h.start();
      const held = await h.until(h.waiting, "the review");
      const hold = h.review(held)!;
      expect(hold.ask.prompt).toContain("1 commit on");
      expect(hold.ask.prompt).toContain("- Change 1");
      expect(hold.ask.prompt).toContain("No judge read this run.");
      expect(hold.ask.prompt).toContain("information, not approval");
      // The browser reader takes the stop's own data as the review card's props, so its field names can't drift apart.
      const detail = reviewDetail((await h.stop(hold))?.data);
      expect(detail).toEqual({
        branch: expect.any(String),
        commits: 1,
        subjects: ["Change 1"],
        judge: null,
        // This host can land an accept either way.
        lands: ["pull-request", "merge"],
        landFailed: null,
        checks: null,
      });
      expect(hold.ask.prompt).toContain(`1 commit on ${detail!.branch}`);
      expect(held.attempts).toBe(1);
      expect(h.seen).toHaveLength(1);
      expect(existsSync(`${h.seen[0]!.cwd}.lock`)).toBe(false);
    } finally {
      await h.dispose();
    }
  }, 60_000);

  it("shows the reviewer each file the run changed, and reads one file's patch from the run's session", async () => {
    // A person accepts what they saw: the files and lines are on the stop
    // itself, and a file's patch is one read away (FIX-2384).
    const h = host({ script: ["commits"] });
    try {
      await h.start();
      const held = await h.until(h.waiting, "the review");
      expect(h.review(held)!.ask.prompt).toContain("1 file changed (+1 −0).");
      expect(await h.reviewData(held)).toMatchObject({
        commits: 1,
        files: [{ path: "change-1.txt", added: 1, removed: 0 }],
        fileCount: 1,
        added: 1,
        removed: 0,
      });

      const listed = await h.readChanges({});
      expect(listed.status, JSON.stringify(listed.body)).toBe(200);
      expect(listed.body.output).toMatchObject({
        taskId: TASK_ID,
        diff: { files: [{ path: "change-1.txt", added: 1, removed: 0 }], verified: true },
        patch: null,
      });
      const opened = await h.readChanges({ path: "change-1.txt" });
      expect(opened.body.output).toMatchObject({ diff: null, patch: { path: "change-1.txt", truncated: false, verified: true } });
      expect(opened.body.output.patch.patch).toContain("+change 1");
    } finally {
      await h.dispose();
    }
  }, 60_000);

  it("reads no changes for a session that ran no task, or for a task another session ran", async () => {
    const h = host({ script: ["commits"] });
    try {
      await h.start();
      await h.until(h.waiting, "the review");
      // A session reads only the run it ran: naming a task can't reach another session's checkout.
      expect(await h.readChanges({}, `s_${ALICE}`)).toMatchObject({
        status: 422,
        body: { message: new HarnessRunChangesRefused("not-started").message },
      });
      expect(await h.readChanges({ taskId: "some-other-task" })).toMatchObject({
        status: 422,
        body: { message: new HarnessRunChangesRefused("not-this-session").message },
      });
    } finally {
      await h.dispose();
    }
  }, 60_000);

  it("completes on an accept with no further harness run, its output saying a person accepted", async () => {
    const h = host({ script: ["commits"] });
    try {
      await h.start();
      await h.until(h.waiting, "the review");
      expect((await h.answer({ verdict: "accepted" })).status).toBe(202);
      const done = await h.until((t) => t.status === "completed", "the accept to complete it");
      expect(done.output).toMatchObject({ commits: 1, review: "accepted" });
      expect(done.attempts).toBe(1);
      expect(h.seen).toHaveLength(1);
    } finally {
      await h.dispose();
    }
  }, 60_000);

  it("takes a revision's words into the same coding session on the same attempt, then reviews again", async () => {
    const h = host({ script: ["commits", "commits"] });
    try {
      await h.start();
      const first = await h.until(h.waiting, "the first review");
      expect((await h.answer({ verdict: "revise", words: "Keep the old flag name." })).status).toBe(202);
      const again = await h.until((t) => h.waiting(t) && h.review(t)!.id !== h.review(first)!.id, "the second review");
      expect(h.seen).toHaveLength(2);
      expect(h.seen[1]).toMatchObject({ resume: "sess_1", request: h.seen[0]!.request });
      expect(h.seen[1]!.prompt).toContain("Keep the old flag name.");
      expect(h.review(again)!.ask.prompt).toContain("2 commits on");
      expect(again.attempts).toBe(1);

      await h.answer({ verdict: "accepted" });
      const done = await h.until((t) => t.status === "completed", "the second accept");
      expect(done).toMatchObject({ attempts: 1, output: expect.objectContaining({ review: "accepted", commits: 2 }) });
      expect(h.seen).toHaveLength(2);
      expect(done.steers).toEqual([expect.objectContaining({ message: "Keep the old flag name.", from: "user", takenBy: 1 })]);
    } finally {
      await h.dispose();
    }
  }, 60_000);

  it("refuses a revision with no words, and the review stays open", async () => {
    const h = host({ script: ["commits"] });
    try {
      await h.start();
      await h.until(h.waiting, "the review");
      expect((await h.answer({ verdict: "revise", words: " " })).status).toBe(400);
      expect(h.waiting(await h.row())).toBe(true);
      expect(h.seen).toHaveLength(1);
    } finally {
      await h.dispose();
    }
  }, 60_000);

  it("fails the try on a revision when the harness confirmed no session, and the next try's brief has the words", async () => {
    const h = host({ script: ["commits-no-session", "no-commit"] });
    try {
      await h.start();
      await h.until(h.waiting, "the review");
      await h.answer({ verdict: "revise", words: "Rename the flag." });
      await h.retry();
      // The branch still has the first try's commit, so the second try is reviewed too.
      const again = await h.until((t) => t.attempts === 2 && h.waiting(t), "the second try's review");
      await h.answer({ verdict: "accepted" });
      const done = await h.until((t) => t.status === "completed", "the second try to complete");
      expect(again.steers).toEqual([expect.objectContaining({ message: "Rename the flag.", takenBy: 2 })]);
      expect(done.attempts).toBe(2);
      expect(h.seen).toHaveLength(2);
      expect(h.seen[1]!.resume).toBeNull();
      expect(h.seen[1]!.prompt).toContain("Rename the flag.");
    } finally {
      await h.dispose();
    }
  }, 60_000);

  it("completes a run with no commits with no review", async () => {
    const h = host({ script: ["no-commit"] });
    try {
      await h.start();
      const done = await h.until((t) => t.status === "completed", "the run to complete");
      expect(done.output).toMatchObject({ commits: 0, review: null });
      expect(h.review(done)).toBeUndefined();
    } finally {
      await h.dispose();
    }
  }, 60_000);

  it("fails the try of a failed run with no review", async () => {
    const h = host({ script: ["throws", "no-commit"] });
    try {
      await h.start();
      await h.retry();
      const done = await h.until((t) => t.status === "completed", "the retry to complete");
      expect(done.attempts).toBe(2);
      expect(done.holds ?? []).toEqual([]);
    } finally {
      await h.dispose();
    }
  }, 60_000);

  it("completes at the host's deadline for a user's stop, its output saying nobody reviewed it", async () => {
    const h = host({ script: ["commits"], userDeadlineMs: 1_000 });
    try {
      await h.start();
      await h.until(h.waiting, "the review");
      const done = await h.until((t) => t.status === "completed", "the deadline to complete it", 20_000);
      expect(done.output).toMatchObject({ commits: 1, review: "deadline" });
      expect(done.attempts).toBe(1);
      expect(h.seen).toHaveLength(1);
    } finally {
      await h.dispose();
    }
  }, 60_000);

  it("closes the review on a cancel, starts no run, and keeps the branch's commit", async () => {
    const h = host({ script: ["commits", "commits"] });
    try {
      await h.start();
      await h.until(h.waiting, "the review");
      await h.act("cancel");
      const done = await h.until((t) => t.status === "cancelled" && (t.holds ?? []).length === 0, "the cancel to close the review");
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(done.status).toBe("cancelled");
      expect(h.seen).toHaveLength(1);
      const cwd = h.seen[0]!.cwd;
      expect(execFileSync("git", ["log", "--format=%s", "-1"], { cwd, encoding: "utf8" }).trim()).toBe("Change 1");
    } finally {
      await h.dispose();
    }
  }, 60_000);

  it("completes on the verdict, as before, on a manager built without the option", async () => {
    const h = host({ script: ["commits"], reviewChanges: false });
    try {
      await h.start();
      const done = await h.until((t) => t.status === "completed", "the run to complete");
      expect(done.output).toMatchObject({ commits: 1, review: null });
    } finally {
      await h.dispose();
    }
  }, 60_000);

  it("refuses the run before any harness step on a host with no durable execution", async () => {
    const h = host({ script: ["commits"], durable: false });
    try {
      await h.start();
      const done = await h.until((t) => t.status !== "pending" && t.status !== "in_progress", "the refusal");
      expect(done.status).toBe("cancelled");
      expect(JSON.stringify(done.error ?? done.feedback ?? null)).toContain("durable execution");
      expect(h.seen).toHaveLength(0);
    } finally {
      await h.dispose();
    }
  }, 60_000);
});

describe("a judged run on a board read from the claim, with review on", () => {
  const verdict = (v: "done" | "not-done" | "ask", confidence: number, reason: string) => ({ verdict: v, confidence, reason });

  it("names the judge's verdict, confidence and reason in the review, as information", async () => {
    const lab = claimHost({
      mode: "claim",
      durable: true,
      script: [{ answer: "added the line", commits: 1 }],
      manager: { judge: scriptedJudge(verdict("done", 0.86, "the line is in")), reviewChanges: true },
    });
    await lab.seed({ ledgerId: CONVERSATIONS, partition: "conv-a", id: "t1", goal: "add a changelog line", input: {} });
    await lab.runAttempt(CONVERSATIONS, "t1", "conv-a");
    const row = await lab.row(CONVERSATIONS, "t1", "conv-a");
    const hold = row.holds?.find((h) => h.source.kind === "suspension");
    expect(row.status).toBe("in_progress");
    expect(hold?.ask).toMatchObject({ kind: "review" });
    expect(hold?.ask.prompt).toContain("The judge: done (0.86): the line is in");
    expect(hold?.ask.prompt).toContain("- call1 commit 0");
  }, 60_000);

  it("holds a judge's ask on a question, with no review", async () => {
    const lab = claimHost({
      mode: "claim",
      durable: true,
      script: [{ answer: "which one?", commits: 1 }],
      manager: { judge: scriptedJudge(verdict("ask", 0.9, "which repository did you mean?")), reviewChanges: true },
    });
    await lab.seed({ ledgerId: CONVERSATIONS, partition: "conv-a", id: "t1", goal: "look at our repo", input: {} });
    await lab.runAttempt(CONVERSATIONS, "t1", "conv-a");
    const row = await lab.row(CONVERSATIONS, "t1", "conv-a");
    expect(row.status).toBe("in_progress");
    expect(openRowHolds(row).map((h) => h.ask.prompt)).toEqual(["which repository did you mean?"]);
    expect(row.holds?.some((h) => h.source.kind === "suspension")).toBe(false);
  }, 60_000);
});

describe("an accepted run's work lands where the person chose (FIX-2543)", () => {
  const PR_URL = "https://github.com/acme/widgets/pull/42";
  const PATH = process.env.PATH;
  let ghLog: string;
  const ghCalls = () => (existsSync(ghLog) ? readFileSync(ghLog, "utf8").trim().split("\n") : []);
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const isAncestor = (cwd: string, commit: string, ref: string) => {
    try {
      git(cwd, "merge-base", "--is-ancestor", commit, ref);
      return true;
    } catch {
      return false;
    }
  };

  // `gh` is a stub on PATH: it logs each call, finds no pull request open, and prints a link for one it opens.
  beforeAll(() => {
    const bin = mkdtempSync(join(tmpdir(), "harness-manager-land-gh-"));
    dirs.push(bin);
    ghLog = join(bin, "calls.log");
    writeFileSync(
      join(bin, "gh"),
      `#!/usr/bin/env node
const args = process.argv.slice(2);
require("node:fs").appendFileSync(${JSON.stringify(ghLog)}, args.join(" ") + "\\n");
process.stdout.write(args[0] === "pr" && args[1] === "create" ? ${JSON.stringify(PR_URL)} + "\\n" : "[]");
`,
    );
    chmodSync(join(bin, "gh"), 0o755);
    process.env.PATH = `${bin}${delimiter}${PATH ?? ""}`;
  });
  afterAll(() => {
    process.env.PATH = PATH;
  });

  it("offers both ways on the review: open a pull request, or merge locally", async () => {
    const h = host({ script: ["commits"], remote: true });
    try {
      await h.start();
      const held = await h.until(h.waiting, "the review");
      expect(reviewDetail((await h.stop(h.review(held)!))?.data)).toMatchObject({ lands: ["pull-request", "merge"], landFailed: null });
    } finally {
      await h.dispose();
    }
  }, 60_000);

  it("on Open a PR, pushes the run's branch, opens its pull request, and puts the link on the task and the session's record", async () => {
    const h = host({ script: ["commits"], remote: true });
    try {
      await h.start();
      const held = await h.until(h.waiting, "the review");
      const branch = reviewDetail((await h.stop(h.review(held)!))?.data)!.branch!;
      expect((await h.answer({ verdict: "accepted", land: "pull-request" })).status).toBe(202);
      const done = await h.until((t) => t.status === "completed", "the accept to land and complete it");

      // pushed: the run's commit is on the remote's copy of its branch.
      expect(git(h.remote, "rev-parse", `refs/heads/${branch}`)).toBe(git(h.seen[0]!.cwd, "rev-parse", "HEAD"));
      // opened: gh was asked to open it from the run's branch into the base.
      expect(ghCalls().some((call) => call.startsWith("pr create") && call.includes(`--head ${branch}`) && call.includes("--base main"))).toBe(true);
      expect(done.output).toMatchObject({
        review: "accepted",
        landed: { kind: "pull-request", url: PR_URL, number: 42, branch, base: "main" },
      });
      expect(await h.pullRequests(done.run!.sessionId!)).toEqual([`${OBSERVED_PULL_REQUESTS}/github.com/acme/widgets/42`]);
      expect(h.seen).toHaveLength(1);
    } finally {
      await h.dispose();
    }
  }, 60_000);

  it("on Merge locally, lands the run's commit on the base branch of the person's checkout, and says the branch and commit", async () => {
    const h = host({ script: ["commits"] });
    try {
      await h.start();
      await h.until(h.waiting, "the review");
      const commit = git(h.seen[0]!.cwd, "rev-parse", "HEAD");
      expect((await h.answer({ verdict: "accepted", land: "merge" })).status).toBe(202);
      const done = await h.until((t) => t.status === "completed", "the accept to merge and complete it");

      expect(isAncestor(h.sourceRepo, commit, "refs/heads/main")).toBe(true);
      expect(done.output).toMatchObject({
        review: "accepted",
        landed: { kind: "merge", branch: "main", commit: git(h.sourceRepo, "rev-parse", "main"), checkout: h.sourceRepo },
      });
    } finally {
      await h.dispose();
    }
  }, 60_000);

  it("stops a merge that conflicts, asks again with the error and nothing changed, and a pull request after it lands", async () => {
    const h = host({ script: ["commits"], remote: true });
    try {
      await h.start();
      const first = await h.until(h.waiting, "the review");
      // The person's main changed the same file meanwhile.
      writeFileSync(join(h.sourceRepo, "change-1.txt"), "the person's own line\n");
      git(h.sourceRepo, "add", "change-1.txt");
      git(h.sourceRepo, "-c", "user.name=p", "-c", "user.email=p@p", "commit", "-q", "-m", "The person's change");
      const main = git(h.sourceRepo, "rev-parse", "main");
      const commit = git(h.seen[0]!.cwd, "rev-parse", "HEAD");

      await h.answer({ verdict: "accepted", land: "merge" });
      const again = await h.until((t) => h.waiting(t) && h.review(t)!.id !== h.review(first)!.id, "the review asked again");

      expect(again.status).toBe("in_progress");
      expect(h.review(again)!.ask.prompt).toContain("Merging locally failed");
      expect(h.review(again)!.ask.prompt).toContain("change-1.txt");
      expect(reviewDetail((await h.stop(h.review(again)!))?.data)?.landFailed).toMatchObject({ land: "merge" });
      // Nothing resolved and nothing lost: main is where it was, the run's commit still on its branch.
      expect(git(h.sourceRepo, "rev-parse", "main")).toBe(main);
      expect(git(h.sourceRepo, "status", "--porcelain", "--untracked-files=no")).toBe("");
      expect(git(h.seen[0]!.cwd, "rev-parse", "HEAD")).toBe(commit);

      await h.answer({ verdict: "accepted", land: "pull-request" });
      const done = await h.until((t) => t.status === "completed", "the pull request after the conflict");
      expect(done.output).toMatchObject({ landed: { kind: "pull-request", url: PR_URL } });
      expect(h.seen).toHaveLength(1);
    } finally {
      await h.dispose();
    }
  }, 60_000);

  it("asks again when the push fails, keeping the run's commit, and a retry once the remote is back lands", async () => {
    const h = host({ script: ["commits"], remote: true });
    try {
      await h.start();
      const first = await h.until(h.waiting, "the review");
      rmSync(h.remote, { recursive: true, force: true });

      await h.answer({ verdict: "accepted", land: "pull-request" });
      const again = await h.until((t) => h.waiting(t) && h.review(t)!.id !== h.review(first)!.id, "the review asked again");
      expect(h.review(again)!.ask.prompt).toContain("Opening the pull request failed");
      expect(existsSync(h.seen[0]!.cwd)).toBe(true);

      execFileSync("git", ["init", "-q", "--bare", h.remote]);
      await h.answer({ verdict: "accepted", land: "pull-request" });
      const done = await h.until((t) => t.status === "completed", "the retry to land");
      expect(done.output).toMatchObject({ landed: { kind: "pull-request", url: PR_URL } });
      expect(git(h.remote, "rev-parse", `refs/heads/${(done.output as { branch: string }).branch}`)).toBe(git(h.seen[0]!.cwd, "rev-parse", "HEAD"));
    } finally {
      await h.dispose();
    }
  }, 60_000);
});
