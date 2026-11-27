/**
 * A coding run that made changes waits for a person's review (FIX-2163), in
 * process: a real `createFlowState` with durable execution, a real board, real
 * fenced settlement, a real git checkout, and answers through the engine's
 * answer route as a screen sends them. Only the harness is a stub, and it
 * records what each step was handed.
 */
import type { HarnessFeeds } from "@flow-state-dev/core/harness";
import { localRepoWorkspaceHost } from "@flow-state-dev/workspace";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { heard } from "./heard";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { localWorkspaceHost } from "@flow-state-dev/workspace";
import { delimiter, join } from "node:path";
import { z } from "zod";
import { defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import {
  OBSERVED_PULL_REQUESTS,
  harnessRunHandleSchema,
  harnessRunInputSchema,
} from "@flow-state-dev/core/harness";
import type { BlockContext } from "@flow-state-dev/core/types";
import type { HarnessBlock } from "@flow-state-dev/core/harness";
import { createFlowState, inMemoryStores, runAction, type StoreAdapter } from "@flow-state-dev/engine";
import {
  defineTaskCollection,
  getOrCreateTaskCollection,
  openHolds,
  resolveResourceCollection,
  type SuspensionHold,
  type Task,
  type TaskCollectionRef,
} from "@flow-state-dev/orchestration/tasks";
import { cancelAndResume, openOwnHolds } from "@flow-state-dev/orchestration/internal";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import {
  harnessManager,
  harnessRunChangesView,
  RunFileNotChanged,
  HarnessRunChangesRefused,
  harnessTaskInputSchema,
  runOwnerClaimOrder,
  type HarnessJudgeVerdict,
} from "../src";
import { harnessTaskId } from "../src/workspace";
import { reviewDetail } from "../src/browser";
import { seedRepo } from "./fixtures";
import { CONVERSATIONS, claimHost, cleanUpHosts, mergeTeammateWork } from "./claim-host";

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
type Step = "commits" | "no-commit" | "commits-no-session" | "throws" | "commits-renames" | "merges-base";

interface SeenStep {
  prompt: string;
  resume: string | null;
  request: string;
  cwd: string;
}

/** The line a teammate puts first in `tracked.txt` on the upstream, while a `merges-base` run adds one last. */
const TEAMMATE_LINE = "a teammate's line";

function stubHarness(script: Step[], seen: SeenStep[], upstream: string) {
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
        if (step === "commits" || step === "commits-no-session" || step === "commits-renames") {
          writeFileSync(join(cwd, `change-${n}.txt`), `change ${n}\n`);
          execFileSync("git", ["add", "."], { cwd });
          execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", `Change ${n}`], { cwd });
        }
        // The run adds a line to a file, then merges the base a teammate moved on, with a line in the same file.
        if (step === "merges-base") {
          const git = (at: string, ...args: string[]) =>
            execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: at, encoding: "utf8" });
          writeFileSync(join(cwd, "tracked.txt"), `${readFileSync(join(cwd, "tracked.txt"), "utf8")}the run's line\n`);
          git(cwd, "commit", "-q", "-am", `Change ${n}`);
          const mate = mkdtempSync(join(tmpdir(), "harness-manager-mate-"));
          dirs.push(mate);
          git(mate, "clone", "-q", upstream, "work");
          const work = join(mate, "work");
          writeFileSync(join(work, "tracked.txt"), `${TEAMMATE_LINE}\n${readFileSync(join(work, "tracked.txt"), "utf8")}`);
          git(work, "commit", "-q", "-am", "a teammate's change");
          git(work, "push", "-q", "origin", "HEAD:main");
          git(cwd, "fetch", "-q", upstream, "main");
          git(cwd, "merge", "-q", "--no-edit", "-m", "merge main", "FETCH_HEAD");
        }
        // The run moves its work to a branch it names itself, as a coder did to get past a refused push.
        if (step === "commits-renames") execFileSync("git", ["branch", "-m", "teammates/tidy-task-list"], { cwd });
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

function host(options: {
  script: Step[];
  reviewChanges?: boolean;
  durable?: boolean;
  userDeadlineMs?: number;
  remote?: boolean;
  clone?: boolean;
  landAttempts?: number;
  awaitPullRequests?: boolean;
  /** `origin` is a bare repository on disk that `main` tracks, so a teammate can move the base on. */
  upstream?: boolean;
}) {
  const dir = mkdtempSync(join(tmpdir(), "harness-manager-review-"));
  dirs.push(dir);
  const sourceRepo = join(dir, "repo");
  mkdirSync(sourceRepo, { recursive: true });
  seedRepo(sourceRepo);
  // A bare repository on disk as `origin`, set before the host pins it, for an accept that pushes.
  const remote = join(dir, "origin.git");
  if (options.remote === true || options.clone === true || options.upstream === true) {
    execFileSync("git", ["clone", "-q", "--bare", sourceRepo, remote]);
    execFileSync("git", ["remote", "set-url", "origin", remote], { cwd: sourceRepo });
  }
  if (options.upstream === true) {
    execFileSync("git", ["fetch", "-q", "origin"], { cwd: sourceRepo });
    execFileSync("git", ["branch", "-q", "--set-upstream-to=origin/main", "main"], { cwd: sourceRepo });
  }

  const ledger = defineTaskCollection({ id: BOARD_ID, scope: "org" as const, stateSchema: harnessTaskInputSchema });
  const seen: SeenStep[] = [];
  const manager = harnessManager({
    boardCollectionId: BOARD_ID,
    boardCollection: ledger,
    tenant: undefined,
    mode: { name: PHASE, instructions: async (run) => `Work on ${run.issue}, attempt ${run.attempt}.`, doneWhen: { check: async () => true } },
    // The bare `origin` stands for a GitHub repository, as an operator's mirror would.
    workspace:
      options.clone === true
        ? // Each run a clone of the remote, not a worktree of a repository on this machine: nothing to land.
          localWorkspaceHost({
            root: join(dir, "checkouts"),
            remotes: { allow: ["file"] },
            source: () => ({ kind: "repo", repo: pathToFileURL(remote).href, baseRef: "main" }),
            provisionTimeoutMs: 10_000,
            pullRequestRepo: () => "github.com/acme/widgets",
          })
        : localRepoWorkspaceHost({ root: join(dir, "checkouts"), repo: sourceRepo, baseRef: "main", provisionTimeoutMs: 10_000, pullRequestRepo: () => "github.com/acme/widgets" }),
    runTimeoutMs: 20_000,
    ownership: { pollMs: 25 },
    harness: stubHarness(options.script, seen, remote),
    ...(options.reviewChanges === false ? {} : { reviewChanges: true }),
    ...(options.landAttempts === undefined ? {} : { landAttempts: options.landAttempts }),
    ...(options.awaitPullRequests === true ? { awaitPullRequests: true } : {}),
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
  const changes = harnessRunChangesView({
    name: "review-host",
    uses: [board.capability],
    board: async (ctx: BlockContext) => ({
      tasks: await getOrCreateTaskCollection({
        ctx,
        backing: "resource",
        collectionId: BOARD_ID,
        collection: resolveResourceCollection(ctx, BOARD_ID)!,
      }),
      runOf: () => ({ issue: ISSUE, mode: { name: PHASE } }),
    }),
  });
  const flow = defineFlow({
    kind: FLOW,
    actions: { seed: { block: seed }, drain: { block: board.drain }, cancel: { block: cancel } },
    views: { changes },
    internal: { actions: { ...heard } },
    task: { actions: { work: { block: manager } } },
  } as never)({ id: FLOW } as never);
  const state = createFlowState({
    flows: [flow],
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
  /** The `changes` view, on the run's own session, through the engine's view route. */
  const readChanges = async (input: Record<string, unknown>, sessionId?: string): Promise<{ status: number; body: any }> => {
    const router = await state.getRouter();
    const path = [FLOW, sessionId ?? (await row()).run!.sessionId, "views", "changes"];
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
  // The task's run record: user-scoped, keyed by the run's topic on this board.
  const recordAt = ["user", `${ALICE}:~org:${ORG_ID}`, `runs/${BOARD_ID}/${ISSUE}/${PHASE}`] as const;
  /** The task's run record, as the manager left it. */
  const runRecord = async () => (await (await runtime()).stores.resourceState.get(...recordAt))?.state as Record<string, unknown> | undefined;
  /** Write the task's run record before it runs, as an earlier turn of the task left it. */
  const seedRunRecord = async (record: Record<string, unknown>) =>
    (await runtime()).stores.resourceState.set(...recordAt, { taskId: TASK_ID, ...record } as never, "any");
  /** The message items of the run's session, oldest first, as a screen reads them. */
  const runMessages = async (): Promise<Array<{ role?: string; text: string }>> => {
    const sessionId = (await row()).run!.sessionId;
    const requests = await (await runtime()).stores.request.list({ sessionId, withItems: true });
    return (requests as Array<{ createdAt: number; items?: any[] }>)
      .sort((a, b) => a.createdAt - b.createdAt)
      .flatMap((request) => request.items ?? [])
      .filter((item) => item.type === "message")
      .map((item) => ({ role: item.role, text: (item.content ?? []).map((part: { text?: string }) => part.text ?? "").join("") }));
  };
  /** Every status line any request wrote, oldest first. */
  const statuses = async (): Promise<string[]> => {
    const requests = (await (await runtime()).stores.request.list({ withItems: true })) as Array<{ items?: Array<Record<string, any>> }>;
    return requests
      .flatMap((request) => request.items ?? [])
      .filter((item) => item.type === "status")
      .map((item) => String(item.message ?? item.content ?? ""));
  };
  return {
    act,
    row,
    until,
    statuses,
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
    runRecord,
    seedRunRecord,
    runMessages,
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
        landAttempts: [],
        checks: null,
        // What was asked, the run's own summary, and what it changed (FIX-2782): no pull request, and the round is the whole branch.
        goal: "the feature",
        answer: "done",
        pullRequests: [],
        // Nothing open from the branch, so a `pull-request` accept opens one.
        openPullRequest: null,
        round: null,
        files: [{ path: "change-1.txt", added: 1, removed: 0 }],
        fileCount: 1,
        added: 1,
        removed: 0,
      });
      expect(hold.ask.prompt).toContain(`1 commit on ${detail!.branch}`);
      expect(held.attempts).toBe(1);
      expect(h.seen).toHaveLength(1);
      expect(existsSync(`${h.seen[0]!.cwd}.lock`)).toBe(false);
    } finally {
      await h.dispose();
    }
  }, 60_000);

  it("opens a file the run and the merged-in base both changed with only the run's lines, as its pull request shows it", async () => {
    // The patch a person opens is the pull request's: the base's lines the run merged in are not the run's.
    const h = host({ script: ["merges-base"], upstream: true });
    try {
      await h.start();
      const held = await h.until(h.waiting, "the review");
      expect(await h.reviewData(held)).toMatchObject({ files: [{ path: "tracked.txt", added: 1, removed: 0 }], fileCount: 1 });
      const opened = await h.readChanges({ path: "tracked.txt" });
      expect(opened.status).toBe(200);
      expect(opened.body.output.patch.patch).toContain("+the run's line");
      // The teammate's line is context the run's hunk sits beside, never a line the run added.
      expect(opened.body.output.patch.patch).not.toContain(`+${TEAMMATE_LINE}`);
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
      // Only a file the run changed opens: any other path is refused, never read.
      expect(await h.readChanges({ path: "README.md" })).toMatchObject({ status: 422, body: { message: new RunFileNotChanged("README.md").message } });
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
      // The revision's round starts where the first review left off, so only its own commit is this round's.
      expect(reviewDetail(await h.reviewData(again))?.round).toEqual({ commits: 1, subjects: ["Change 2"] });
      expect(again.attempts).toBe(1);

      await h.answer({ verdict: "accepted" });
      const done = await h.until((t) => t.status === "completed", "the second accept");
      expect(done).toMatchObject({ attempts: 1, output: expect.objectContaining({ review: "accepted", commits: 2 }) });
      expect(h.seen).toHaveLength(2);
      expect(done.steers).toEqual([expect.objectContaining({ message: "Keep the old flag name.", from: "user", takenBy: 1 })]);
      // The words show in the run's session as the person's own line, as typed,
      // never as a line of the run's (FIX-2574).
      const lines = await h.runMessages();
      expect(lines.filter((line) => line.text.includes("Keep the old flag name."))).toEqual([
        { role: "user", text: "Keep the old flag name." },
      ]);
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

  // FIX-2782: a round on a branch that already had commits listed them all, so a person couldn't tell this round's work from the earlier.
  it("lists this round's commits apart from the branch's earlier ones, on the review's data and its prompt", async () => {
    const h = host({ script: ["commits-no-session", "commits"] });
    try {
      await h.start();
      const first = await h.until(h.waiting, "the first try's review");
      // The first round is the whole branch: nothing earlier to set it apart from.
      expect(reviewDetail(await h.reviewData(first))?.round).toBeNull();
      await h.answer({ verdict: "revise", words: "Rename the flag." });
      await h.retry();
      const again = await h.until((t) => t.attempts === 2 && h.waiting(t), "the second try's review");
      const detail = reviewDetail(await h.reviewData(again));
      expect(detail).toMatchObject({ commits: 2, subjects: ["Change 2", "Change 1"], round: { commits: 1, subjects: ["Change 2"] } });
      expect(h.review(again)!.ask.prompt).toContain("1 commit this round:\n- Change 2");
    } finally {
      await h.dispose();
    }
  }, 60_000);

  // A round that committed nothing has no work of its own to set apart: an empty round would hide the branch's commits.
  it("shows the branch's commits when a round on it added none", async () => {
    const h = host({ script: ["commits-no-session", "no-commit"] });
    try {
      await h.start();
      await h.until(h.waiting, "the first try's review");
      await h.answer({ verdict: "revise", words: "Rename the flag." });
      await h.retry();
      const again = await h.until((t) => t.attempts === 2 && h.waiting(t), "the second try's review");
      const detail = reviewDetail(await h.reviewData(again));
      expect(detail).toMatchObject({ commits: 1, subjects: ["Change 1"], round: null });
      expect(h.review(again)!.ask.prompt).not.toContain("this round");
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

  it("shows the reviewer only the run's own work after the run merged the moved-on base in", async () => {
    // What the person accepts is the pull request: the base's commits the run merged in are not in it.
    const lab = claimHost({
      mode: "claim",
      durable: true,
      upstream: true,
      script: [{ answer: "added the line", commits: 1, during: async () => mergeTeammateWork(lab.upstream, lab.seen.at(-1)!.cwd) }],
      manager: { reviewChanges: true },
    });
    await lab.seed({ ledgerId: CONVERSATIONS, partition: "conv-a", id: "t1", goal: "add a changelog line", input: {} });
    await lab.runAttempt(CONVERSATIONS, "t1", "conv-a");
    const task = await lab.row(CONVERSATIONS, "t1", "conv-a");
    const prompt = task.holds?.find((h) => h.source.kind === "suspension")?.ask.prompt;
    expect(prompt).toContain("2 commits on");
    expect(prompt).toContain("1 file changed (+1 −0).");
    expect(prompt).not.toContain("a teammate's change");
  }, 60_000);

  // FIX-2847.
  it("ends the run that reaches its review after its task was cancelled, so no stopped run is left counted", async () => {
    // The judge reads after the harness step, where no poll of the row stops the run: a cancel
    // pressed while it reads lands before the run stops for its review, which nothing mirrors.
    let cancel: () => Promise<unknown> = async () => {};
    const judge = {
      floor: 0.7,
      block: handler({
        name: "cancelling-judge",
        inputSchema: z.unknown(),
        outputSchema: z.unknown(),
        execute: async () => {
          await cancel();
          return verdict("done", 0.9, "the line is in");
        },
      }),
    };
    const lab = claimHost({ mode: "claim", durable: true, script: [{ answer: "added the line", commits: 1 }], manager: { judge, reviewChanges: true } });
    cancel = () => lab.act("cancel", { ledgerId: CONVERSATIONS, partition: "conv-a", id: "t1" });
    await lab.seed({ ledgerId: CONVERSATIONS, partition: "conv-a", id: "t1", goal: "add a changelog line", input: {} });
    await lab.runAttempt(CONVERSATIONS, "t1", "conv-a");
    expect((await lab.row(CONVERSATIONS, "t1", "conv-a")).status).toBe("cancelled");
    // The run's request, in the task's own session: a stop nobody can answer leaves it `suspended`
    // for good, and a session's runs count it as background work still running.
    const sessionId = "s_task_tasks_conv-a_t1";
    const store = (await (lab.stores as StoreAdapter).resolve(["primary"])).request!;
    const requests = () => store.list({ sessionId });
    await vi.waitFor(async () => {
      const statuses = (await requests()).map((r) => r.status);
      expect(statuses.length).toBeGreaterThan(0);
      expect(statuses.filter((s) => s === "suspended" || s === "in_progress")).toEqual([]);
    }, { timeout: 10_000, interval: 50 });
  }, 60_000);

  // FIX-2847. The cases below force what lands between the check's read of the row and its write
  // that mirrors the run's stop: the write is refused, and no mirror holds the stop.
  /** A host whose claim gate runs `meanwhile` once, just before its write that mirrors the review stop. */
  type SetKeptOpenBy = NonNullable<TaskCollectionRef["setKeptOpenBy"]>;
  const hostWithGap = (
    meanwhile: (ref: TaskCollectionRef, id: string, claim: Parameters<SetKeptOpenBy>[2]["claim"]) => Promise<void>,
    ran: { done: boolean },
    /** Stand in for another of the gate ledger's verbs, once the gap has run. */
    after?: (target: TaskCollectionRef, key: string | symbol) => unknown,
  ) =>
    claimHost({
      mode: "claim",
      durable: true,
      script: [{ answer: "added the line", commits: 1 }],
      manager: { reviewChanges: true },
      gateLedger: (ref) =>
        new Proxy(ref, {
          get(target, key, receiver) {
            const stand = ran.done ? after?.(target, key) : undefined;
            if (stand !== undefined) return stand;
            if (key !== "setKeptOpenBy") return Reflect.get(target, key, receiver);
            return async (...args: Parameters<SetKeptOpenBy>) => {
              const [id, , options] = args;
              if (options?.hold === undefined || ran.done) return target.setKeptOpenBy!(...args);
              ran.done = true;
              await meanwhile(target, id, options.claim);
              return target.setKeptOpenBy!(...args);
            };
          },
        }),
    });
  /** No request of the first attempt is left `suspended` (or running): the stop was ended. */
  const firstAttemptEnds = async (lab: ReturnType<typeof claimHost>) => {
    const store = (await (lab.stores as StoreAdapter).resolve(["primary"])).request!;
    await vi.waitFor(async () => {
      const statuses = (await store.list({ sessionId: "s_task_tasks_conv-a_t1" })).map((r) => r.status);
      expect(statuses.length).toBeGreaterThan(0);
      expect(statuses.filter((s) => s === "suspended" || s === "in_progress")).toEqual([]);
    }, { timeout: 10_000, interval: 50 });
  };
  const LATER = 10 * 60_000;

  it("ends the run's review stop when its task is cancelled after the check read the row and before it mirrored the stop", async () => {
    const ran = { done: false };
    const lab = hostWithGap(async (ref, id) => void (await ref.cancel(id, "cancelled by the test, between the read and the write")), ran);
    await lab.seed({ ledgerId: CONVERSATIONS, partition: "conv-a", id: "t1", goal: "add a changelog line", input: {} });
    await lab.runAttempt(CONVERSATIONS, "t1", "conv-a");
    expect(ran.done).toBe(true);
    const task = await lab.row(CONVERSATIONS, "t1", "conv-a");
    expect(task.status).toBe("cancelled");
    expect(task.holds?.some((h) => h.source.kind === "suspension") ?? false).toBe(false);
    await firstAttemptEnds(lab);
  }, 60_000);

  it("ends the old attempt's review stop when a later attempt takes the row in that gap, and leaves the later attempt's row alone", async () => {
    const ran = { done: false };
    let taken: Task | undefined;
    const lab = hostWithGap(async (ref, id) => {
      // The lease lapses, a sweep reclaims the row, and the next claim takes it: a second attempt.
      await ref.reclaim(Date.now() + LATER);
      taken = JSON.parse(JSON.stringify(await ref.claim("other-drain", { leaseDurationMs: LATER, eligibility: (t) => t.id === id }))) as Task;
    }, ran);
    await lab.seed({ ledgerId: CONVERSATIONS, partition: "conv-a", id: "t1", goal: "add a changelog line", input: {} });
    await lab.runAttempt(CONVERSATIONS, "t1", "conv-a");
    expect(taken).toMatchObject({ status: "in_progress", attempts: 2 });
    await firstAttemptEnds(lab);
    // The second attempt's row, as its claim left it: not cancelled, no mirror, its lease its own.
    const task = await lab.row(CONVERSATIONS, "t1", "conv-a");
    expect(task).toMatchObject({ status: "in_progress", attempts: 2, leaseUntil: taken!.leaseUntil });
    expect(task.holds?.some((h) => h.source.kind === "suspension") ?? false).toBe(false);
  }, 60_000);

  it("takes the row back and mirrors the review stop when only its claim's lease lapsed in that gap", async () => {
    // No reclaim moved the row: it is still this attempt's and turn's. Cancelling the stop here would
    // let the run's resume, admitted on the same attempt, complete the task on a review nobody gave.
    const ran = { done: false };
    const lab = hostWithGap(async (ref, id, claim) => {
      // The claim's lease ends in the past: the write that follows finds it lapsed.
      const renewed = await ref.renewLease(id, Date.now() - 1, { claim });
      expect(renewed.outcome).toBe("recorded");
    }, ran);
    await lab.seed({ ledgerId: CONVERSATIONS, partition: "conv-a", id: "t1", goal: "add a changelog line", input: {} });
    await lab.runAttempt(CONVERSATIONS, "t1", "conv-a");
    expect(ran.done).toBe(true);
    // The review waits for its person, on the row, as it does with no lapse: no lease, nothing settled.
    const task = await lab.row(CONVERSATIONS, "t1", "conv-a");
    expect(task).toMatchObject({ status: "in_progress", attempts: 1, keptOpenBy: "suspended" });
    expect(task.leaseUntil).toBeUndefined();
    expect(task.holds?.find((h) => h.source.kind === "suspension")?.ask).toMatchObject({ kind: "review" });
  }, 60_000);

  /** The claim's lease ends in the past: the hold write that follows finds it lapsed. */
  const lapse = async (ref: TaskCollectionRef, id: string, claim: Parameters<SetKeptOpenBy>[2]["claim"]) => {
    expect((await ref.renewLease(id, Date.now() - 1, { claim })).outcome).toBe("recorded");
  };

  it("ends the review stop as superseded when the lease lapsed and the takeover's renewal gives no verdict", async () => {
    const ran = { done: false };
    const lab = hostWithGap(lapse, ran, (_target, key) => (key === "renewLease" ? async () => undefined : undefined));
    await lab.seed({ ledgerId: CONVERSATIONS, partition: "conv-a", id: "t1", goal: "add a changelog line", input: {} });
    await lab.runAttempt(CONVERSATIONS, "t1", "conv-a");
    expect(ran.done).toBe(true);
    await firstAttemptEnds(lab);
    const task = await lab.row(CONVERSATIONS, "t1", "conv-a");
    expect(task.holds?.some((h) => h.source.kind === "suspension") ?? false).toBe(false);
    // Not cancelled, nothing settled: the row is left on its lapsed lease for the sweep to reclaim.
    expect(task).toMatchObject({ status: "in_progress", attempts: 1 });
    expect(task.leaseUntil).toBeLessThan(Date.now());
  }, 60_000);

  it("ends the review stop as superseded when the lease lapsed on a row with no lease span to take it back for", async () => {
    // A row claimed before the span was stored: no `leaseDurationMs`, and a deadline no later than its last write.
    const ran = { done: false };
    const legacy = (stored: Task | undefined): Task | undefined => {
      if (stored === undefined) return undefined;
      const { leaseDurationMs: _span, ...row } = JSON.parse(JSON.stringify(stored)) as Task;
      return { ...row, updatedAt: row.leaseUntil ?? row.updatedAt };
    };
    // Every read of the gate's ledger sees the legacy row from the gap on, as a stored one would read.
    const lab = hostWithGap(lapse, ran, (target, key) =>
      key === "getCommitted"
        ? async (id: string) => legacy(await target.getCommitted!(id))
        : key === "get"
          ? (id: string) => legacy(target.get(id) as Task | undefined)
          : undefined,
    );
    await lab.seed({ ledgerId: CONVERSATIONS, partition: "conv-a", id: "t1", goal: "add a changelog line", input: {} });
    await lab.runAttempt(CONVERSATIONS, "t1", "conv-a");
    expect(ran.done).toBe(true);
    await firstAttemptEnds(lab);
    const task = await lab.row(CONVERSATIONS, "t1", "conv-a");
    expect(task.holds?.some((h) => h.source.kind === "suspension") ?? false).toBe(false);
    // Not cancelled, nothing settled: the row is left on its lapsed lease for the sweep to reclaim.
    expect(task).toMatchObject({ status: "in_progress", attempts: 1 });
    expect(task.leaseUntil).toBeLessThan(Date.now());
  }, 60_000);

  it("keeps the review stop when the lease lapsed and the takeover's renewal fails, and says why", async () => {
    // Not a refusal: the store failed, and the attempt may still own the row. Ending the stop as
    // superseded here could let the task finish with no review, so the stop stays for the person.
    const ran = { done: false };
    const warned: string[] = [];
    const spy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => void warned.push(args.map(String).join(" ")));
    const errored = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void warned.push(args.map(String).join(" ")));
    try {
      const lab = hostWithGap(lapse, ran, (_target, key) =>
        key === "renewLease"
          ? async () => {
              throw new Error("the store is down");
            }
          : undefined,
      );
      await lab.seed({ ledgerId: CONVERSATIONS, partition: "conv-a", id: "t1", goal: "add a changelog line", input: {} });
      await lab.runAttempt(CONVERSATIONS, "t1", "conv-a");
      expect(ran.done).toBe(true);
      // Past every try the superseded cancel would make: the stop is still there to answer.
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      const store = (await (lab.stores as StoreAdapter).resolve(["primary"])).request!;
      const statuses = (await store.list({ sessionId: "s_task_tasks_conv-a_t1" })).map((r) => r.status);
      expect(statuses).toContain("suspended");
      expect((await lab.row(CONVERSATIONS, "t1", "conv-a")).status).toBe("in_progress");
      expect(warned.some((line) => line.includes("the store is down"))).toBe(true);
    } finally {
      spy.mockRestore();
      errored.mockRestore();
    }
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
    const task = await lab.row(CONVERSATIONS, "t1", "conv-a");
    expect(task.status).toBe("in_progress");
    expect(openOwnHolds(task).map((h) => h.ask.prompt)).toEqual(["which repository did you mean?"]);
    expect(task.holds?.some((h) => h.source.kind === "suspension")).toBe(false);
  }, 60_000);
});

describe("an accepted run's work lands where the person chose (FIX-2543)", () => {
  const PR_URL = "https://github.com/acme/widgets/pull/42";
  const PATH = process.env.PATH;
  let ghLog: string;
  /** While this file exists, `gh pr create` fails the way GitHub refuses a pull request into a deleted base. */
  let failCreate: string;
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
    failCreate = join(bin, "fail-create");
    writeFileSync(
      join(bin, "gh"),
      `#!/usr/bin/env node
const args = process.argv.slice(2);
require("node:fs").appendFileSync(${JSON.stringify(ghLog)}, args.join(" ") + "\\n");
if (args[1] === "create" && require("node:fs").existsSync(${JSON.stringify(failCreate)})) {
  process.stderr.write("pull request create failed: GraphQL: Base sha can't be blank, Base ref must be a branch (createPullRequest)\\n");
  process.exit(1);
}
process.stdout.write(args[0] === "pr" && args[1] === "create" ? ${JSON.stringify(PR_URL)} + "\\n" : "[]");
`,
    );
    chmodSync(join(bin, "gh"), 0o755);
    process.env.PATH = `${bin}${delimiter}${PATH ?? ""}`;
  });
  afterAll(() => {
    process.env.PATH = PATH;
  });

  it("offers no way to land a run cloned from a remote, so the review keeps its plain Accept, which completes it", async () => {
    const h = host({ script: ["commits"], clone: true });
    const calls = ghCalls().length;
    try {
      await h.start();
      const held = await h.until(h.waiting, "the review");
      expect(reviewDetail((await h.stop(h.review(held)!))?.data)).toMatchObject({ lands: [], landFailed: null });
      expect((await h.answer({ verdict: "accepted" })).status).toBe(202);
      const done = await h.until((t) => t.status === "completed", "the plain accept to complete it");
      expect(done.output).toMatchObject({ landed: null });
      // Nothing was pushed or opened (the run's own pull-request lookup may still ask GitHub).
      expect(ghCalls().slice(calls).filter((call) => call.startsWith("pr "))).toEqual([]);
    } finally {
      await h.dispose();
    }
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
      expect(ghCalls().some((call) => call.startsWith("pr create") && call.includes(`--head acme:${branch}`) && call.includes("--repo github.com/acme/widgets") && call.includes("--base main"))).toBe(true);
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
    // One try: the failure goes straight back to the person.
    const h = host({ script: ["commits"], remote: true, landAttempts: 1 });
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
    const h = host({ script: ["commits"], remote: true, landAttempts: 1 });
    try {
      await h.start();
      const first = await h.until(h.waiting, "the review");
      rmSync(h.remote, { recursive: true, force: true });

      await h.answer({ verdict: "accepted", land: "pull-request" });
      const again = await h.until((t) => h.waiting(t) && h.review(t)!.id !== h.review(first)!.id, "the review asked again");
      expect(h.review(again)!.ask.prompt).toContain("Opening the pull request failed");
      expect(existsSync(h.seen[0]!.cwd)).toBe(true);

      // Back as it was: with its main, which the pull request goes into.
      execFileSync("git", ["init", "-q", "--bare", h.remote]);
      git(h.seen[0]!.cwd, "push", "-q", h.remote, "HEAD~1:refs/heads/main");
      await h.answer({ verdict: "accepted", land: "pull-request" });
      const done = await h.until((t) => t.status === "completed", "the retry to land");
      expect(done.output).toMatchObject({ landed: { kind: "pull-request", url: PR_URL } });
      expect(git(h.remote, "rev-parse", `refs/heads/${(done.output as { branch: string }).branch}`)).toBe(git(h.seen[0]!.cwd, "rev-parse", "HEAD"));
    } finally {
      await h.dispose();
    }
  }, 60_000);

  // FIX-2658: Open a PR failed once and gave up. The push was refused (GH005),
  // and on Retry the run's branch was gone: the coder had moved the work to a
  // branch of its own and opened the pull request from there.
  /** Refuse the remote's first `times` pushes the way GitHub refused the long branch. */
  const refusePushes = (remote: string, times: number) => {
    const count = join(remote, "refused");
    writeFileSync(
      join(remote, "hooks", "pre-receive"),
      `#!/bin/sh\nn=$(cat '${count}' 2>/dev/null || echo 0)\nif [ "$n" -lt ${times} ]; then echo $((n+1)) > '${count}'; echo "error: GH005: Sorry, refs longer than 255 bytes are not allowed." >&2; exit 1; fi\n`,
    );
    chmodSync(join(remote, "hooks", "pre-receive"), 0o755);
  };

  it("hands a refused push to the coding session with the person's note, and opens the pull request when it stops, without asking again", async () => {
    const h = host({ script: ["commits", "no-commit"], remote: true });
    try {
      await h.start();
      await h.until(h.waiting, "the review");
      refusePushes(h.remote, 1);
      await h.answer({ verdict: "accepted", land: "pull-request", words: "Keep trying until the PR is pushed." });
      const done = await h.until((t) => t.status === "completed", "the landing to recover on its own");

      // One more step of the same session, told the exact error and the person's words.
      expect(h.seen).toHaveLength(2);
      expect(h.seen[1]!.resume).toBe("sess_1");
      expect(h.seen[1]!.prompt).toContain("GH005");
      expect(h.seen[1]!.prompt).toContain("Keep trying until the PR is pushed.");
      expect(done.output).toMatchObject({ review: "accepted", landed: { kind: "pull-request", url: PR_URL } });
      expect(await h.pullRequests(done.run!.sessionId!)).toEqual([`${OBSERVED_PULL_REQUESTS}/github.com/acme/widgets/42`]);
    } finally {
      await h.dispose();
    }
  }, 60_000);

  it("lands the branch the run moved its work to, when its own branch is gone", async () => {
    const h = host({ script: ["commits-renames"], remote: true });
    try {
      await h.start();
      await h.until(h.waiting, "the review");
      await h.answer({ verdict: "accepted", land: "pull-request" });
      const done = await h.until((t) => t.status === "completed", "the landing from the moved branch");

      expect(done.output).toMatchObject({ landed: { kind: "pull-request", branch: "teammates/tidy-task-list", url: PR_URL } });
      expect(git(h.remote, "rev-parse", "refs/heads/teammates/tidy-task-list")).toBe(git(h.seen[0]!.cwd, "rev-parse", "HEAD"));
      expect(await h.pullRequests(done.run!.sessionId!)).toEqual([`${OBSERVED_PULL_REQUESTS}/github.com/acme/widgets/42`]);
      // Nothing for the coder to fix: one step.
      expect(h.seen).toHaveLength(1);
    } finally {
      await h.dispose();
    }
  }, 60_000);

  it("stops after its tries, and the review it asks again lists each one", async () => {
    const h = host({ script: ["commits"], remote: true });
    try {
      await h.start();
      const first = await h.until(h.waiting, "the review");
      refusePushes(h.remote, 99);
      await h.answer({ verdict: "accepted", land: "pull-request" });
      const again = await h.until((t) => h.waiting(t) && h.review(t)!.id !== h.review(first)!.id, "the review asked again", 45_000);

      // Three tries: the first, and two after a step of the coding session each.
      expect(h.seen).toHaveLength(3);
      const detail = reviewDetail((await h.stop(h.review(again)!))?.data);
      expect(detail?.landAttempts).toHaveLength(3);
      expect(detail?.landAttempts?.every((attempt) => attempt.land === "pull-request" && attempt.message.includes("GH005"))).toBe(true);
      expect(detail?.landFailed).toMatchObject({ land: "pull-request" });
      // Nothing forced, nothing lost.
      expect(() => git(h.remote, "rev-parse", `refs/heads/${detail!.branch}`)).toThrow();
      expect(existsSync(h.seen[0]!.cwd)).toBe(true);
    } finally {
      await h.dispose();
    }
  }, 90_000);

  // FIX-2858: GitHub refused the pull request, the failure was handed to the
  // coding session, and the coder opened one itself with gh, outside the landing.
  it("asks the person again when GitHub refuses the pull request, and hands the coding session nothing", async () => {
    const h = host({ script: ["commits", "no-commit"], remote: true });
    try {
      await h.start();
      const first = await h.until(h.waiting, "the review");
      writeFileSync(failCreate, "");
      await h.answer({ verdict: "accepted", land: "pull-request" });
      const again = await h.until((t) => h.waiting(t) && h.review(t)!.id !== h.review(first)!.id, "the review asked again");

      // No step of the coding session: only landing opens the pull request.
      expect(h.seen).toHaveLength(1);
      const detail = reviewDetail((await h.stop(h.review(again)!))?.data);
      expect(detail?.landAttempts).toHaveLength(1);
      expect(detail?.landFailed).toMatchObject({ land: "pull-request" });
      expect(h.review(again)!.ask.prompt).toContain("Opening the pull request failed");
    } finally {
      rmSync(failCreate, { force: true });
      await h.dispose();
    }
  }, 60_000);
});

// FIX-2781.
describe("a run on a branch with a pull request already open from it puts its work there, unasked", () => {
  const PR_URL = "https://github.com/acme/widgets/pull/42";
  const PATH = process.env.PATH;
  let ghLog: string;
  // When set, how many more times `pr list` finds #42 open; then it finds none (closed since).
  let listsLeft: string;
  const ghCalls = () => (existsSync(ghLog) ? readFileSync(ghLog, "utf8").trim().split("\n") : []);
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

  // `gh` is a stub on PATH: pull request #42 is open from whatever branch is asked about, and it is read back as open.
  beforeAll(() => {
    const bin = mkdtempSync(join(tmpdir(), "harness-manager-open-pr-gh-"));
    dirs.push(bin);
    ghLog = join(bin, "calls.log");
    listsLeft = join(bin, "lists-left");
    writeFileSync(
      join(bin, "gh"),
      `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(ghLog)}, args.join(" ") + "\\n");
const listed = () => {
  if (!fs.existsSync(${JSON.stringify(listsLeft)})) return true;
  const left = Number(fs.readFileSync(${JSON.stringify(listsLeft)}, "utf8"));
  fs.writeFileSync(${JSON.stringify(listsLeft)}, String(left - 1));
  return left > 0;
};
const out =
  args[0] === "pr" && args[1] === "list"
    ? JSON.stringify(listed() ? [{ number: 42, url: ${JSON.stringify(PR_URL)}, baseRefName: "main", isCrossRepository: false }] : [])
    : args[0] === "pr" && args[1] === "create"
      ? "https://github.com/acme/widgets/pull/43\\n"
      : args[0] === "api" && /pulls\\?/.test(args[args.length - 1])
        ? JSON.stringify([{
            number: 42, html_url: ${JSON.stringify(PR_URL)}, title: "The run's pull request", state: "open", draft: false, merged: false,
            created_at: new Date().toISOString(),
            head: { ref: decodeURIComponent(/head=[^&:]*:?([^&]+)/.exec(args[args.length - 1])?.[1] ?? ""), sha: "0", repo: { full_name: "acme/widgets" } },
            base: { repo: { full_name: "acme/widgets" } },
          }])
      : args[0] === "api" && /pulls\\/42$/.test(args[args.length - 1])
        ? JSON.stringify({ number: 42, html_url: ${JSON.stringify(PR_URL)}, state: "open", merged: false, head: { ref: "x", sha: "0" } })
        : "[]";
process.stdout.write(out);
`,
    );
    chmodSync(join(bin, "gh"), 0o755);
    process.env.PATH = `${bin}${delimiter}${PATH ?? ""}`;
  });
  afterAll(() => {
    process.env.PATH = PATH;
  });
  afterEach(() => {
    rmSync(listsLeft, { force: true });
  });
  /** Refuse the remote's first `times` pushes, as GitHub refuses one. */
  const refusePushes = (remote: string, times: number) => {
    const count = join(remote, "refused");
    writeFileSync(
      join(remote, "hooks", "pre-receive"),
      `#!/bin/sh\nn=$(cat '${count}' 2>/dev/null || echo 0)\nif [ "$n" -lt ${times} ]; then echo $((n+1)) > '${count}'; echo "error: GH006: Protected branch update failed." >&2; exit 1; fi\n`,
    );
    chmodSync(join(remote, "hooks", "pre-receive"), 0o755);
  };
  // #42 as the task's record keeps it once a person's accept on the task landed on it.
  const KEY = "github.com/acme/widgets/42";
  /** An earlier turn of this task, whose accept a person gave landed on #42. */
  const acceptedOnto42 = (h: ReturnType<typeof host>) => h.seedRunRecord({ landedPullRequests: [KEY] });

  // Jake's report: eng.coder pushed a fix for review feedback to the branch of the pull request it had opened, and
  // was then asked "Open a PR / Merge locally" about it. The work already had its pull request; a second one is never offered.
  it("pushes the run's commit to that pull request, asks no review offering Open a PR or Merge locally, and waits on it", async () => {
    const h = host({ script: ["commits"], remote: true, awaitPullRequests: true });
    const calls = ghCalls().length;
    try {
      await acceptedOnto42(h);
      await h.start();
      const settled = await h.until(
        (t) => h.waiting(t) || openHolds(t).some((hold) => hold.ask.kind === "external"),
        "the review or the wait on its pull request",
      );
      // No review was asked: the pull request is where the person reviews the work.
      expect(h.review(settled)).toBeUndefined();
      expect(openHolds(settled).filter((hold) => hold.ask.kind === "external").map((hold) => hold.ask.prompt).join(" ")).toContain("#42");

      // The commit is on the remote's copy of the branch, and no second pull request was opened.
      const cwd = h.seen[0]!.cwd;
      const branch = git(cwd, "rev-parse", "--abbrev-ref", "HEAD");
      expect(git(h.remote, "rev-parse", `refs/heads/${branch}`)).toBe(git(cwd, "rev-parse", "HEAD"));
      expect(ghCalls().slice(calls).filter((call) => call.startsWith("pr create"))).toEqual([]);

      // The stream says where the work went, and the session's record holds the pull request the task waits on.
      expect((await h.statuses()).some((line) => line.startsWith(`Pushed ${branch} to pull request #42`) && line.includes(PR_URL))).toBe(true);
      expect(await h.pullRequests(settled.run!.sessionId!)).toEqual([`${OBSERVED_PULL_REQUESTS}/github.com/acme/widgets/42`]);
      expect(h.seen).toHaveLength(1);
      // This turn's open of the record kept what the earlier accept landed on.
      expect((await h.runRecord())?.landedPullRequests).toEqual([KEY]);
    } finally {
      await h.dispose();
    }
  }, 60_000);

  // The person wasn't asked about this landing, so a failure of it is theirs to see, not the coding
  // session's to fix; and they are offered only that pull request, never a second one or a local merge.
  it("asks the person when that push is refused, offering that pull request alone, and records their accept", async () => {
    const h = host({ script: ["commits", "no-commit"], remote: true });
    try {
      await acceptedOnto42(h);
      refusePushes(h.remote, 2);
      await h.start();
      const asked = await h.until(h.waiting, "the review after the refused push");

      // Straight to the person: no step of the coding session was spent on it.
      expect(h.seen).toHaveLength(1);
      const hold = h.review(asked)!;
      expect(hold.ask.prompt).toContain("GH006");
      expect(hold.ask.prompt).toContain("pull request #42, already open");
      expect(hold.ask.prompt).not.toContain("choose the other way");
      expect(reviewDetail((await h.stop(hold))?.data)?.lands).toEqual(["pull-request"]);

      // The person accepts; that push is refused too, so it is handed to the coding session as any
      // accept's is, and when the session stops it lands on #42: the person's accept is the review.
      await h.answer({ verdict: "accepted", land: "pull-request" });
      const done = await h.until((t) => t.status === "completed", "the landing after the person's accept", 45_000);
      expect(h.seen).toHaveLength(2);
      expect(done.output).toMatchObject({ review: "accepted", landed: { kind: "pull-request", number: 42, existing: true } });
      expect(ghCalls().filter((call) => call.startsWith("pr create"))).toEqual([]);
    } finally {
      await h.dispose();
    }
  }, 90_000);

  // A pull request seen on the branch during the task, or one the coding session opened itself, can be someone
  // else's: a run's branch can be renamed to match any branch with one open, and the session's record stamps every
  // pull request on its branch. Only a person's accept makes it the task's; until then the host's credentials push
  // nothing to it. The person is asked, and their accept still puts the work on it, not on a second one.
  it("asks the person, and pushes nothing, about an open pull request no accept on this task landed on; their accept reuses it", async () => {
    const h = host({ script: ["commits"], remote: true, awaitPullRequests: true });
    const calls = ghCalls().length;
    try {
      await h.start();
      const asked = await h.until(h.waiting, "the review");

      const detail = reviewDetail((await h.stop(h.review(asked)!))?.data);
      expect(detail?.lands).toEqual(["pull-request", "merge"]);
      // FIX-2920: the review names that pull request as where a `pull-request` accept puts the work, so no card
      // invites the user to open a second one. Without it, the card's button read "Open pull request" beside a #42 link.
      expect(detail?.openPullRequest).toEqual({ number: 42, url: PR_URL });
      expect(detail?.pullRequests).toEqual([{ number: 42, url: PR_URL }]);
      expect(h.review(asked)!.ask.prompt).toContain(`Pull request #42 is already open from`);
      expect(h.review(asked)!.ask.prompt).toContain("no second pull request is opened");
      expect((await h.statuses()).some((line) => line.includes("#42") && line.includes("didn't open it"))).toBe(true);
      const cwd = h.seen[0]!.cwd;
      const branch = git(cwd, "rev-parse", "--abbrev-ref", "HEAD");
      expect(() => git(h.remote, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`)).toThrow();
      expect((await h.runRecord())?.landedPullRequests).toEqual([]);

      // The person accepts: the work goes onto #42, no second pull request, and #42 is now the task's.
      await h.answer({ verdict: "accepted", land: "pull-request" });
      await h.until((t) => openHolds(t).some((hold) => hold.ask.kind === "external"), "the wait on #42");
      expect(git(h.remote, "rev-parse", `refs/heads/${branch}`)).toBe(git(cwd, "rev-parse", "HEAD"));
      expect(ghCalls().slice(calls).filter((call) => call.startsWith("pr create"))).toEqual([]);
      expect((await h.runRecord())?.landedPullRequests).toEqual([KEY]);
    } finally {
      await h.dispose();
    }
  }, 60_000);

  // FIX-2920 (review): the review named #42 and its accept read "Push to PR #42". Closed before the user accepted,
  // the accept would have opened #43 instead, which the button never said. It pushes only to #42, and asks again.
  it("a user's accept onto the pull request the review named opens none when it closed since, and asks again with every way", async () => {
    const h = host({ script: ["commits"], remote: true });
    const calls = ghCalls().length;
    try {
      await h.start();
      const asked = await h.until(h.waiting, "the review");
      expect(reviewDetail((await h.stop(h.review(asked)!))?.data)?.openPullRequest).toEqual({ number: 42, url: PR_URL });

      // Closed before the accept's landing looks.
      writeFileSync(listsLeft, "0");
      await h.answer({ verdict: "accepted", land: "pull-request" });
      const again = await h.until((t) => h.waiting(t) && h.review(t)!.id !== h.review(asked)!.id, "the review asked again");

      const detail = reviewDetail((await h.stop(h.review(again)!))?.data);
      expect(detail?.landFailed?.land).toBe("pull-request");
      expect(detail?.openPullRequest).toBeNull();
      expect(detail?.lands).toEqual(["pull-request", "merge"]);
      expect(ghCalls().slice(calls).filter((call) => call.startsWith("pr create"))).toEqual([]);
      // Not handed to the coding session: there is nothing for it to fix.
      expect(h.seen).toHaveLength(1);
    } finally {
      await h.dispose();
    }
  }, 60_000);

  it("opens nothing when that pull request closed before the push, and asks the person with every way to land", async () => {
    const h = host({ script: ["commits"], remote: true });
    const calls = ghCalls().length;
    try {
      await acceptedOnto42(h);
      // Open when the review looks, closed when the landing does.
      writeFileSync(listsLeft, "1");
      await h.start();
      const asked = await h.until(h.waiting, "the review after the pull request closed");

      const hold = h.review(asked)!;
      expect(hold.ask.prompt).not.toContain("already open");
      expect(reviewDetail((await h.stop(hold))?.data)?.lands).toEqual(["pull-request", "merge"]);
      // Nothing pushed, and no pull request opened in its place without the person.
      const branch = git(h.seen[0]!.cwd, "rev-parse", "--abbrev-ref", "HEAD");
      expect(() => git(h.remote, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`)).toThrow();
      expect(ghCalls().slice(calls).filter((call) => call.startsWith("pr create"))).toEqual([]);
      expect(h.seen).toHaveLength(1);
    } finally {
      await h.dispose();
    }
  }, 60_000);
});

// FIX-2782: the review card gave a person nothing to decide on. Its data carries what was asked, the run's own
// summary and the task's pull requests, so the card can show them without leaving it.
describe("a coding run's review carries what was asked, the run's summary and its pull requests", () => {
  const PR_URL = "https://github.com/acme/widgets/pull/41";
  const PATH = process.env.PATH;

  // `gh` is a stub on PATH: the branch has pull request #41, closed, so it is recorded but nothing is open to push to.
  beforeAll(() => {
    const bin = mkdtempSync(join(tmpdir(), "harness-manager-recorded-pr-gh-"));
    dirs.push(bin);
    writeFileSync(
      join(bin, "gh"),
      `#!/usr/bin/env node
const args = process.argv.slice(2);
const listed = [{ number: 41, html_url: ${JSON.stringify(PR_URL)}, state: "closed", title: "Tidy the task list", created_at: new Date().toISOString(), head: { ref: "x" } }];
process.stdout.write(args[0] === "api" && /pulls\\?head=/.test(args[1] ?? "") ? JSON.stringify(listed) : "[]");
`,
    );
    chmodSync(join(bin, "gh"), 0o755);
    process.env.PATH = `${bin}${delimiter}${PATH ?? ""}`;
  });
  afterAll(() => {
    process.env.PATH = PATH;
  });

  it("puts the task's goal, the run's final message and the recorded pull request on the review's data and prompt", async () => {
    const h = host({ script: ["commits"], remote: true });
    try {
      await h.start();
      const held = await h.until(h.waiting, "the review");
      const detail = reviewDetail(await h.reviewData(held));
      expect(detail).toMatchObject({
        goal: "the feature",
        answer: "done",
        pullRequests: [{ number: 41, url: PR_URL }],
        files: [{ path: "change-1.txt", added: 1, removed: 0 }],
      });
      const prompt = h.review(held)!.ask.prompt;
      expect(prompt).toContain("Asked: the feature");
      expect(prompt).toContain("The run's summary: done");
      expect(prompt).toContain(`Pull request #41: ${PR_URL}`);
    } finally {
      await h.dispose();
    }
  }, 60_000);
});
