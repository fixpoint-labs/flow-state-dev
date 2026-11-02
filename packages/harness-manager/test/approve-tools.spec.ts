/**
 * A coding run's tool call waits for a person's approval (FIX-2389), in
 * process: a real `createFlowState` with durable execution, a real board,
 * real fenced settlement, a real git checkout, and answers through the
 * engine's answer route as a screen sends them. Only the harness is the
 * package's scripted stub, making scripted tool calls; what ran is its own
 * record and the marker files the calls write.
 */
import { afterAll, describe, expect, it } from "vitest";
import { heard } from "./heard";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { defineFlow, dispatcher, handler } from "@flow-state-dev/core";
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
import { ALLOW_FOR_RUN, harnessManager, harnessStub, harnessTaskInputSchema, runOwnerClaimOrder, type HarnessFeeds, type HarnessStubOptions, type StubToolCall } from "../src";
import { harnessTaskId } from "../src/workspace";
import { seedRepo } from "./fixtures";

const BOARD_ID = "eng.feature.work";
const FLOW = "approve-host";
const ORG_ID = "org_approve";
const ALICE = "alice";
const ISSUE = "FIX-1";
const PHASE = "implement";
const TASK_ID = harnessTaskId(ISSUE, PHASE);

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** A shell call that writes `name` in the run's folder when it runs. */
function marker(name: string, command = `touch ${name}`): StubToolCall {
  return { toolName: "Bash", input: { command }, run: (run) => writeFileSync(join(run.cwd, name), "ran\n") };
}

function host(options: {
  calls: StubToolCall[];
  approveTools?: boolean;
  durable?: boolean;
  userDeadlineMs?: number;
  statusOf?: HarnessStubOptions["statusOf"];
  /** Every run starts a new coding session: the resume feed offers none. */
  cold?: boolean;
}) {
  const dir = mkdtempSync(join(tmpdir(), "harness-manager-approve-"));
  dirs.push(dir);
  const sourceRepo = join(dir, "repo");
  mkdirSync(sourceRepo, { recursive: true });
  seedRepo(sourceRepo);

  const ledger = defineTaskCollection({ id: BOARD_ID, scope: "org" as const, stateSchema: harnessTaskInputSchema });
  const stub = harnessStub({ toolCalls: options.calls, ...(options.statusOf === undefined ? {} : { statusOf: options.statusOf }) });
  const handed: Array<keyof HarnessFeeds> = [];
  const manager = harnessManager({
    boardCollectionId: BOARD_ID,
    boardCollection: ledger,
    tenant: undefined,
    phase: { phase: PHASE, buildPrompt: async (run) => `Work on ${run.issue}, attempt ${run.attempt}.`, isDone: async () => true },
    workspace: { root: join(dir, "checkouts"), sourceRepo, baseRef: "main", provisionTimeoutMs: 10_000 },
    runTimeoutMs: 20_000,
    ownership: { pollMs: 25 },
    harness: (feeds) => {
      handed.push(...(Object.keys(feeds) as Array<keyof HarnessFeeds>));
      return stub.slot(options.cold === true ? { ...feeds, resume: async () => null } : feeds);
    },
    ...(options.approveTools === false ? {} : { approveTools: true }),
  });
  const board = taskBoard({
    name: "approve-board",
    boardId: "approve-board",
    mode: "delegation",
    collection: ledger,
    concurrency: 1,
    claimOrder: runOwnerClaimOrder(),
    workers: { coder: dispatcher({ name: "approve-board-dispatch", action: "work", session: "per-task" }) },
  });
  const seed = handler({
    name: "approve-seed",
    inputSchema: z.object({}),
    outputSchema: z.object({ id: z.string() }),
    uses: [board.capability],
    execute: async (_input, ctx) => {
      const tasks = (ctx as { cap: Record<string, any> }).cap["approve-board"];
      if ((await tasks.getTask(TASK_ID)) === undefined) {
        await tasks.createTask({ id: TASK_ID, goal: "the feature", input: { issue: ISSUE, phase: PHASE }, assignee: "coder", maxAttempts: 2 });
      }
      return { id: TASK_ID };
    },
  });
  const cancel = handler({
    name: "approve-cancel",
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
  const until = async (predicate: (task: Task) => boolean, what: string, timeoutMs = 30_000): Promise<Task> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const current = await row();
      if (current !== undefined && predicate(current)) return current;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}; row is ${JSON.stringify(current)}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };
  /** The row's open approval, as a screen reads it off its holds. */
  const approval = (task: Task): SuspensionHold | undefined =>
    task.holds?.find(
      (hold): hold is SuspensionHold => hold.source.kind === "suspension" && hold.ask.kind === "approval",
    );
  const waiting = (task: Task) => task.status === "in_progress" && approval(task) !== undefined;
  /** Answer the open approval through the engine's answer route, as a screen does. */
  const answer = async (action: "approve" | "reject", data?: unknown): Promise<Response> => {
    const hold = approval(await row())!;
    const router = await state.getRouter();
    const path = [FLOW, "requests", hold.source.requestId, "answer"];
    return router.POST(
      new Request(`http://localhost/api/flows/${path.join("/")}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-org-id": ORG_ID },
        body: JSON.stringify({ suspensionId: hold.source.suspensionId, action, ...(data === undefined ? {} : { data }), userId: ALICE }),
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
  /** Whether the run's folder has the marker a call writes. */
  const ran = (name: string) => stub.runs.length > 0 && existsSync(join(stub.runs[0]!.cwd, name));
  return { act, row, until, approval, waiting, answer, start, ran, stub, handed, dispose: () => state.dispose() };
}

const decisions = (h: ReturnType<typeof host>) => h.stub.toolCalls.map((call) => `${call.run}:${call.decision}`);

describe("a coding run's tool call waits for a person's approval", () => {
  it("stops the run with the call unrun, the task waiting on an approval naming the tool, the command and the folder", async () => {
    const h = host({ calls: [marker("marker")] });
    try {
      await h.start();
      const held = await h.until(h.waiting, "the approval");
      const hold = h.approval(held)!;
      const cwd = h.stub.runs[0]!.cwd;
      expect(hold.ask.prompt).toContain("Bash");
      expect(hold.ask.prompt).toContain("touch marker");
      expect(hold.ask.prompt).toContain(cwd);
      expect(h.ran("marker")).toBe(false);
      expect(decisions(h)).toEqual(["0:held"]);
      expect(held.attempts).toBe(1);
      // Nothing is kept alive while it waits: the checkout is free.
      expect(existsSync(`${cwd}.lock`)).toBe(false);
    } finally {
      await h.dispose();
    }
  }, 60_000);

  it("resumes the session that asked on Allow, and the call runs once, after the answer", async () => {
    const h = host({ calls: [marker("marker")] });
    try {
      await h.start();
      await h.until(h.waiting, "the approval");
      const answeredAt = Date.now();
      expect((await h.answer("approve")).status).toBe(202);
      const done = await h.until((t) => t.status === "completed", "the run to complete");
      expect(done.attempts).toBe(1);
      expect(h.stub.runs).toHaveLength(2);
      expect(h.stub.runs[1]!.resume).toBe(h.stub.runs[0]!.session);
      expect(h.stub.runs[1]!.prompt).toContain("Make the call again");
      expect(decisions(h)).toEqual(["0:held", "1:allow"]);
      expect(h.stub.toolCalls[1]!.at).toBeGreaterThanOrEqual(answeredAt);
      expect(h.ran("marker")).toBe(true);
    } finally {
      await h.dispose();
    }
  }, 60_000);

  it("never runs the call on Deny, tells the session with the person's note, and the run goes on", async () => {
    const h = host({ calls: [marker("marker"), marker("second")] });
    try {
      await h.start();
      await h.until(h.waiting, "the approval");
      await h.answer("reject", { note: "not in this repo" });
      // The run goes on to its next call, which waits in turn.
      const again = await h.until((t) => h.waiting(t) && h.approval(t)!.ask.prompt.includes("touch second"), "the next call's approval");
      expect(h.stub.runs[1]!.resume).toBe(h.stub.runs[0]!.session);
      expect(h.stub.runs[1]!.prompt).toContain("did not allow");
      expect(h.stub.runs[1]!.prompt).toContain("not in this repo");
      expect(h.ran("marker")).toBe(false);
      expect(again.attempts).toBe(1);
    } finally {
      await h.dispose();
    }
  }, 60_000);

  it("lets the same command through for the rest of the run on Allow for this run, and asks again for another", async () => {
    const h = host({ calls: [marker("one", "pnpm test"), marker("two", "pnpm test"), marker("three", "pnpm test -- foo")] });
    try {
      await h.start();
      await h.until(h.waiting, "the first approval");
      await h.answer("approve", ALLOW_FOR_RUN.data);
      const next = await h.until((t) => h.waiting(t) && h.approval(t)!.ask.prompt.includes("pnpm test -- foo"), "the other command's approval");
      expect(decisions(h)).toEqual(["0:held", "1:allow", "1:allow", "1:held"]);
      expect(h.ran("one") && h.ran("two")).toBe(true);
      expect(h.ran("three")).toBe(false);
      expect(next.attempts).toBe(1);
    } finally {
      await h.dispose();
    }
  }, 60_000);

  it("lets a plain Allow through once: the same command asks again", async () => {
    const h = host({ calls: [marker("one", "pnpm test"), marker("two", "pnpm test")] });
    try {
      await h.start();
      const first = await h.until(h.waiting, "the first approval");
      await h.answer("approve");
      await h.until((t) => h.waiting(t) && h.approval(t)!.id !== h.approval(first)!.id, "the second approval");
      expect(decisions(h)).toEqual(["0:held", "1:allow", "1:held"]);
      expect(h.ran("one")).toBe(true);
      expect(h.ran("two")).toBe(false);
    } finally {
      await h.dispose();
    }
  }, 60_000);

  it("reads nobody answering by the host's deadline as a no, and the run goes on without the call", async () => {
    const h = host({ calls: [marker("marker")], userDeadlineMs: 1_000 });
    try {
      await h.start();
      await h.until(h.waiting, "the approval");
      const done = await h.until((t) => t.status === "completed", "the deadline's no and the run's end", 20_000);
      expect(done.attempts).toBe(1);
      expect(h.stub.runs[1]!.prompt).toContain("in time");
      expect(h.ran("marker")).toBe(false);
    } finally {
      await h.dispose();
    }
  }, 60_000);

  it("resumes nothing on a cancel", async () => {
    const h = host({ calls: [marker("marker")] });
    try {
      await h.start();
      await h.until(h.waiting, "the approval");
      await h.act("cancel");
      await h.until((t) => t.status === "cancelled" && h.approval(t) === undefined, "the cancel to close the approval");
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(h.stub.runs).toHaveLength(1);
      expect(h.ran("marker")).toBe(false);
    } finally {
      await h.dispose();
    }
  }, 60_000);

  it("hands no approval feed on a manager built without the option, and the run is as before", async () => {
    const h = host({ calls: [marker("marker")], approveTools: false });
    try {
      await h.start();
      const done = await h.until((t) => t.status === "completed", "the run to complete");
      expect(h.handed).not.toContain("onToolApproval");
      expect(decisions(h)).toEqual(["0:unasked"]);
      expect(done.holds ?? []).toEqual([]);
    } finally {
      await h.dispose();
    }
  }, 60_000);

  it("makes the scripted calls again in a new coding session, so a cold retry still exercises them", async () => {
    // The first attempt errors; the retry resumes nothing, so its script starts over.
    const h = host({ calls: [marker("marker")], approveTools: false, cold: true, statusOf: (run) => (run.session === "sess_stub_1" ? "errored" : "completed") });
    try {
      await h.start();
      await h.until((t) => t.status === "pending" && t.attempts === 1, "the first attempt to fail");
      await h.act("drain");
      await h.until((t) => t.status === "completed", "the retry to complete");
      expect(h.stub.runs.map((run) => run.resume)).toEqual([null, null]);
      expect(decisions(h)).toEqual(["0:unasked", "1:unasked"]);
    } finally {
      await h.dispose();
    }
  }, 60_000);

  it("refuses the run before any harness step on a host with no durable execution", async () => {
    const h = host({ calls: [marker("marker")], durable: false });
    try {
      await h.start();
      const done = await h.until((t) => t.status !== "pending" && t.status !== "in_progress", "the refusal");
      expect(done.status).toBe("cancelled");
      expect(JSON.stringify(done.error ?? done.feedback ?? null)).toContain("approveTools");
      expect(h.stub.runs).toHaveLength(0);
    } finally {
      await h.dispose();
    }
  }, 60_000);
});
