/**
 * A run provisioned through a workspace host (FIX-1762).
 *
 * Driven end to end, in process, like `message-door.spec.ts`: a real
 * `createFlowState`, a real board and dispatch, and a real
 * `localWorkspaceHost`. Only the harness is a stub, and each attempt does one
 * scripted thing in the directory the manager hands it.
 *
 * What is pinned here is what the host option adds over a fixed repository:
 * the run's kept files are saved at every point the run can stop, and a run
 * already provisioned keeps the repository its record names when its source
 * changes underneath it.
 */
import { afterAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import { harnessRunHandleSchema, harnessRunInputSchema } from "@flow-state-dev/core";
import type { HarnessBlock } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import {
  defineTaskCollection,
  getOrCreateTaskCollection,
  openRowQuestions,
  resolveResourceCollection,
  type Task,
} from "@flow-state-dev/orchestration/tasks";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import { localWorkspaceHost, type RunSourceAnswer } from "@flow-state-dev/workspace";
import { harnessManager, harnessTaskInputSchema, runOwnerClaimOrder, type HarnessFeeds } from "../src";
import { harnessTaskId } from "../src/workspace";
import { seedRepo } from "./fixtures";
import { createFakeCollection, type FakeCollection } from "../../workspace/test/fake-collection";
import { heard } from "./heard";

const BOARD_ID = "eng.feature.work";
const ORG_ID = "org_host";
const ALICE = "alice";
const ISSUE = "FIX-1";
const PHASE = "implement";
const TASK_ID = harnessTaskId(ISSUE, PHASE);

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/**
 * What one attempt does, in the directory the manager handed it.
 *
 * - `write` — writes `notes.md`, then finishes.
 * - `write-ask` — writes `notes.md` and a question to its ask marker, then finishes.
 * - `write-throw` — writes `notes.md`, then the harness itself throws.
 * - `switch-throw` — moves the run source to another repository, then throws.
 * - `dirty-side-throw` — commits, checks out a side branch that lacks the
 *   commit, leaves an uncommitted file there, then throws.
 * - `read` — reads `which.txt` from its checkout, then finishes.
 * - `where` — records the name of the directory it was handed, then finishes.
 * - `write-step` — confirms a coding session, writes `step-<n>.md` (n counts the
 *   steps), then finishes: what a steer's extra step leaves behind.
 */
type Step = "write" | "write-ask" | "write-throw" | "switch-throw" | "dirty-side-throw" | "read" | "where" | "write-step";

function stubHarness(script: Step[], seen: string[], switchSource: () => void) {
  return (feeds: HarnessFeeds): HarnessBlock =>
    handler({
      name: "stub-harness",
      inputSchema: harnessRunInputSchema,
      outputSchema: harnessRunHandleSchema,
      execute: async (input, ctx) => {
        const cwd = await feeds.cwd(ctx as never);
        const step = script[seen.length] ?? "write";
        seen.push(
          step === "read"
            ? readFileSync(join(cwd, "which.txt"), "utf8").trim()
            : step === "where"
              ? basename(cwd)
              : step,
        );
        if (step === "write-step") {
          await feeds.onSession("sess_steps", ctx as never);
          writeFileSync(join(cwd, `step-${seen.length}.md`), `step ${seen.length}`);
        } else if (step.startsWith("write")) writeFileSync(join(cwd, "notes.md"), "what the run wrote");
        if (step === "write-ask") {
          const marker = /write it as the entire contents of this file:\n {2}(\S+)/.exec(input.prompt)?.[1];
          if (marker === undefined) throw new Error("the prompt named no ask marker");
          mkdirSync(dirname(marker), { recursive: true });
          writeFileSync(marker, "Which option?");
        }
        if (step === "switch-throw") switchSource();
        if (step === "dirty-side-throw") {
          const g = (...args: string[]) =>
            execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { cwd, stdio: "pipe" });
          g("commit", "--allow-empty", "-m", "the run's own");
          g("checkout", "-b", "side", "HEAD~1");
          writeFileSync(join(cwd, "half-done.txt"), "not committed");
        }
        if (step === "write-throw" || step === "switch-throw" || step === "dirty-side-throw") throw new Error("the harness crashed");
        return {
          source: "stub/test",
          status: "completed" as const,
          sessionId: `sess_${seen.length}`,
          url: null,
          dispatchedAt: Date.now(),
          outcome: "finished" as const,
          finalMessage: null,
          usage: null,
          cost: null,
        };
      },
    }) as unknown as HarnessBlock;
}

/** A repository on disk a run can be cut from over `file://`, carrying `which.txt`. */
function repository(dir: string, which: string): string {
  const repo = join(dir, `repo-${which}`);
  mkdirSync(repo, { recursive: true });
  seedRepo(repo);
  writeFileSync(join(repo, "which.txt"), `${which}\n`);
  execFileSync("git", ["add", "which.txt"], { cwd: repo, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", which], { cwd: repo, stdio: "pipe" });
  return pathToFileURL(repo).href;
}

function lab(options: {
  script: Step[];
  source: "files" | "repo" | "mapped" | "files-then-repo" | "refused" | "remote-not-allowed";
  maxAttempts?: number;
}) {
  const dir = mkdtempSync(join(tmpdir(), "harness-manager-host-"));
  dirs.push(dir);
  const collection: FakeCollection = createFakeCollection("project-files/**");
  const remoteA =
    options.source === "mapped"
      ? fileURLToPath(repository(dir, "A"))
      : options.source !== "files" && options.source.includes("repo")
        ? repository(dir, "A")
        : "";
  const remoteB = options.source === "repo" || options.source === "mapped" ? repository(dir, "B") : "";
  let remote = remoteA;
  // `files-then-repo`: the project gains a repository when the source switches.
  let gainedRepository = false;
  let asked = 0;
  const answer = (): RunSourceAnswer => {
    switch (options.source) {
      case "files":
        return { kind: "files", projectId: "sandbox", files: { collection, collectionId: "project-files" } };
      case "files-then-repo":
        return gainedRepository
          ? {
              kind: "repo",
              repo: remoteA,
              baseRef: "main",
              projectId: "sandbox",
              files: { collection, collectionId: "project-files" },
            }
          : { kind: "files", projectId: "sandbox", files: { collection, collectionId: "project-files" } };
      case "refused":
        return { kind: "refused", reason: "not-a-member", message: "alice is not on this project" };
      case "remote-not-allowed":
        return { kind: "repo", repo: "https://example.com/acme/storefront.git" };
      case "mapped":
        // A checkout on this machine with the project's files beside it,
        // until the mapping moves the project to a remote.
        return { kind: "repo", repo: remote, baseRef: "main", projectId: "sandbox", files: { collection, collectionId: "project-files" } };
      default:
        return { kind: "repo", repo: remote, baseRef: "main" };
    }
  };
  const workspace = localWorkspaceHost({
    root: join(dir, "places"),
    remotes: { allow: ["file"] },
    ...(options.source === "mapped" ? { localRepositories: [remoteA] } : {}),
    source: (): RunSourceAnswer => {
      asked += 1;
      return answer();
    },
    provisionTimeoutMs: 20_000,
  });

  const ledger = defineTaskCollection({
    id: BOARD_ID,
    scope: "org" as const,
    stateSchema: harnessTaskInputSchema,
  });
  const seen: string[] = [];
  // Run inside the phase's done-condition, one per call: what lands while the verdict is read.
  const duringVerdict: Array<() => Promise<void>> = [];
  const manager = harnessManager({
    boardCollectionId: BOARD_ID,
    boardCollection: ledger,
    tenant: undefined,
    phase: {
      phase: PHASE,
      buildPrompt: (run) =>
        [
          `Work on ${run.issue}, attempt ${run.attempt}.`,
          "To ask, write it as the entire contents of this file:",
          `  ${run.askMarkerPath}`,
        ].join("\n"),
      isDone: async () => {
        await duringVerdict.shift()?.();
        return true;
      },
    },
    workspace,
    runTimeoutMs: 20_000,
    ownership: { pollMs: 25 },
    harness: stubHarness(options.script, seen, () => {
      remote = remoteB;
      gainedRepository = true;
    }),
  });
  const board = taskBoard({
    name: "host-board",
    boardId: "host-board",
    mode: "delegation",
    collection: ledger,
    concurrency: 1,
    claimOrder: runOwnerClaimOrder(),
    workers: {
      coder: dispatcher({ name: "host-board-dispatch", action: "work", session: "per-task" }),
    },
  });
  const seed = handler({
    name: "host-seed",
    inputSchema: z.object({}),
    outputSchema: z.object({ id: z.string() }),
    uses: [board.capability],
    execute: async (_input, ctx) => {
      const tasks = (ctx as { cap: Record<string, any> }).cap["host-board"];
      await tasks.createTask({
        id: TASK_ID,
        goal: "the feature",
        input: { issue: ISSUE, phase: PHASE },
        assignee: "coder",
        maxAttempts: options.maxAttempts ?? 1,
      });
      return { id: TASK_ID };
    },
  });
  // A steer from the person, as `updateTask({ message })` writes one.
  const steer = handler({
    name: "host-steer",
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
      return tasks.steer!(TASK_ID, { message: "Write one more step.", from: "user", by: ALICE });
    },
  });
  // The person cancels the task, as `updateTask({ cancel })` does.
  const cancel = handler({
    name: "host-cancel",
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
      return tasks.cancel(TASK_ID, "cancelled while it waited");
    },
  });
  const flow = defineFlow({ internal: { actions: { ...heard } },
    kind: "host-flow",
    actions: { seed: { block: seed }, drain: { block: board.drain }, steer: { block: steer }, cancel: { block: cancel } },
    task: { actions: { work: { block: manager } } },
  } as never)({ id: "host-flow" } as never);
  const state = createFlowState({
    flows: { "host-flow": flow },
    stores: { test: { primary: inMemoryStores() } },
    defaultProfile: "test",
    dispatchDrainTimeoutMs: 60_000,
  } as never);
  const runtime = async () =>
    (state as unknown as { getRuntime(): Promise<{ stores: any; runtimeConfig: object }> }).getRuntime();

  const act = async (action: string): Promise<void> => {
    const rt = await runtime();
    await runAction({
      flow,
      actionName: action,
      input: {},
      userId: ALICE,
      orgId: ORG_ID,
      sessionId: `s_${ALICE}`,
      requestId: `req_${action}_${Math.random().toString(36).slice(2)}`,
      stores: rt.stores,
      runtimeConfig: { ...rt.runtimeConfig },
    } as never);
  };

  /** Wait until the row reaches `status`. */
  const settled = async (status: Task["status"]): Promise<Task> => {
    const deadline = Date.now() + 30_000;
    for (;;) {
      const rt = await runtime();
      const row = (await rt.stores.resourceState.get("org", ORG_ID, `${BOARD_ID}/${TASK_ID}`))?.state as
        | Task
        | undefined;
      if (row?.status === status) return row;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${status}; row is ${JSON.stringify(row)}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };

  /** Wait until the task is held on a question: still running, with no lease. */
  const held = async (): Promise<Task> => {
    const deadline = Date.now() + 30_000;
    for (;;) {
      const rt = await runtime();
      const row = (await rt.stores.resourceState.get("org", ORG_ID, `${BOARD_ID}/${TASK_ID}`))?.state as
        | Task
        | undefined;
      if (row !== undefined && row.status === "in_progress" && row.leaseUntil == null && openRowQuestions(row).length > 0) return row;
      if (Date.now() > deadline) throw new Error(`timed out waiting for a held task; row is ${JSON.stringify(row)}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };

  /** The run record, as stored now. */
  const record = async (): Promise<Record<string, any>> => {
    const rt = await runtime();
    const rows = await rt.stores.resourceState.getByPrefix("user", `${ALICE}:~org:${ORG_ID}`, "runs/");
    return (Object.values(rows)[0] as { state: Record<string, any> }).state;
  };

  return { act, settled, held, record, seen, collection, remoteA, duringVerdict, asked: () => asked };
}

describe("a run's kept files are saved wherever the run stops", () => {
  it("at the end of a turn that completed", async () => {
    const run = lab({ script: ["write"], source: "files" });
    await run.act("seed");
    await run.act("drain");
    await run.settled("completed");

    expect(run.collection.contents()["sandbox/notes.md"]).toBe("what the run wrote");
    expect((await run.record()).lastSave).toMatchObject({ conflicts: [], error: null });
  }, 60_000);

  it("and a step a late steer adds saves what it wrote too", async () => {
    // The steer lands while the verdict is read: after the turn's save let
    // the place go. The extra step works in a place provisioned again, and
    // its own end saves it.
    const run = lab({ script: ["write-step", "write-step"], source: "files" });
    run.duringVerdict.push(() => run.act("steer"));
    await run.act("seed");
    await run.act("drain");
    const done = await run.settled("completed");

    expect(run.seen).toEqual(["write-step", "write-step"]);
    expect(done.steers).toEqual([expect.objectContaining({ takenBy: 1 })]);
    expect(Object.keys(run.collection.contents()).sort()).toEqual(["sandbox/step-1.md", "sandbox/step-2.md"]);
  }, 60_000);

  it("when the run's question holds its task, before anyone answers it", async () => {
    // A held task can wait for days. What its run wrote is in the collection
    // the moment the question holds it, not when the answer comes back.
    const run = lab({ script: ["write-ask"], source: "files" });
    await run.act("seed");
    await run.act("drain");
    await run.held();

    expect(run.collection.contents()["sandbox/notes.md"]).toBe("what the run wrote");
    // The question is the manager's own file, not the project's: it is never
    // saved with the run's work.
    expect(Object.keys(run.collection.contents())).toEqual(["sandbox/notes.md"]);

    // Cancelled while it waits: no further run starts, and the work it saved stays.
    await run.act("cancel");
    await run.settled("cancelled");
    await run.act("drain");
    expect(run.seen).toEqual(["write-ask"]);
    expect(run.collection.contents()).toEqual({ "sandbox/notes.md": "what the run wrote" });
  }, 60_000);

  it("and a run is not completed on files it could not save, so the retry saves them", async () => {
    // Completing is a run's last save point. Settling the row while the save
    // failed would leave the work only in this machine's workspace.
    const run = lab({ script: ["write", "write"], source: "files", maxAttempts: 2 });
    await run.act("seed");
    run.collection.breakWrites();
    await run.act("drain");
    await run.settled("pending");
    expect((await run.record()).lastSave?.error).toMatch(/unavailable/);
    expect(run.collection.contents()).toEqual({});

    run.collection.mendWrites();
    await run.act("drain");
    await run.settled("completed");
    expect(run.collection.contents()["sandbox/notes.md"]).toBe("what the run wrote");
  }, 60_000);

  it("when the harness itself fails, so a crash loses nothing the run wrote", async () => {
    const run = lab({ script: ["write-throw"], source: "files" });
    await run.act("seed");
    await run.act("drain");
    await run.settled("errored");

    expect(run.seen).toEqual(["write-throw"]);
    expect(run.collection.contents()["sandbox/notes.md"]).toBe("what the run wrote");
  }, 60_000);
});

describe("the repository a run started on (BR-19)", () => {
  it("is kept on its record, and a retry stays on it after the source moves", async () => {
    // Attempt 1 is provisioned from A, then the source starts answering B. The
    // retry continues A's branch: moving it would strand the first attempt's
    // work in a checkout nothing reads again.
    const run = lab({ script: ["switch-throw", "read"], source: "repo", maxAttempts: 2 });
    await run.act("seed");
    await run.act("drain");
    await run.settled("pending");
    await run.act("drain");
    await run.settled("completed");

    expect(run.seen).toEqual(["switch-throw", "A"]);
    expect(await run.record()).toMatchObject({ remote: run.remoteA, baseRef: "main" });
  }, 60_000);

  it("and a run in a mapped checkout stays in that checkout after the mapping moves (BR-16)", async () => {
    // Attempt 1 works in a worktree of a checkout on this machine; then the
    // source answers a remote instead. The retry is still the checkout's.
    const run = lab({ script: ["switch-throw", "read"], source: "mapped", maxAttempts: 2 });
    await run.act("seed");
    await run.act("drain");
    await run.settled("pending");
    await run.act("drain");
    await run.settled("completed");

    expect(run.seen).toEqual(["switch-throw", "A"]);
    const record = await run.record();
    expect(record).toMatchObject({ remote: run.remoteA, baseRef: "main" });
    // The run's branch is in the checkout itself, and the run worked in its checkout/ worktree.
    expect(execFileSync("git", ["branch", "--list", record.branch], { cwd: run.remoteA, encoding: "utf8" })).not.toBe("");
    expect(basename(record.workspacePath)).toBe("checkout");
  }, 60_000);
});

describe("a run with no repository stays one", () => {
  it("when its project gains a repository before a retry", async () => {
    // Attempt 1 works in workspace/ on the project's files, then the project
    // gains a repository. Moving the retry to a checkout would leave what
    // attempt 1 wrote behind in a directory nothing reads again.
    const run = lab({ script: ["switch-throw", "where"], source: "files-then-repo", maxAttempts: 2 });
    await run.act("seed");
    await run.act("drain");
    await run.settled("pending");
    await run.act("drain");
    await run.settled("completed");

    expect(run.seen).toEqual(["switch-throw", "workspace"]);
    expect(await run.record()).toMatchObject({ filesOnly: true, remote: null });
  }, 60_000);
});

describe("a run its workspace refuses", () => {
  // A refusal is an answer about the run, not a failed attempt: the source will
  // say the same thing next time, and the host's refusals never clear on a
  // retry. Retrying would spend every attempt on the same refusal.
  for (const [source, said] of [
    ["refused", "alice is not on this project"],
    ["remote-not-allowed", "remote-not-allowed"],
  ] as const) {
    it(`settles on its first attempt and is never retried (${source})`, async () => {
      const run = lab({ script: [], source, maxAttempts: 3 });
      await run.act("seed");
      await run.act("drain");
      const row = await run.settled("cancelled");
      await run.act("drain");

      expect(row.attempts).toBe(1);
      expect(row.retryLedger?.granted ?? 0).toBe(0);
      expect(JSON.stringify(row)).toContain(said);
      expect(run.seen).toEqual([]);
      expect(run.asked()).toBe(source === "refused" ? 1 : 2);
    }, 60_000);
  }
});

describe("a run that left its checkout on a side branch with uncommitted changes", () => {
  // Moving back would move the changes, and committing them for the run would
  // decide for it. The retry would commit to the side branch, not the one its
  // verdict reads, so the row is refused with what clears it, and the
  // checkout is left as the run left it.
  it("is refused on the retry, without running, saying what to do", async () => {
    const run = lab({ script: ["dirty-side-throw"], source: "repo", maxAttempts: 2 });
    await run.act("seed");
    await run.act("drain");
    await run.settled("pending");
    await run.act("drain");
    const row = await run.settled("cancelled");

    expect(run.seen).toEqual(["dirty-side-throw"]);
    expect(row.attempts).toBe(2);
    expect(JSON.stringify(row)).toContain("uncommitted changes, so it was left as it is");
  }, 60_000);
});
