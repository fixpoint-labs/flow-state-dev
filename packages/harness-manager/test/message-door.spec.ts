/**
 * Talking to a run — the manager's door (FIX-1690).
 *
 * Driven end to end, in process, like `channel-board.spec.ts`: a real
 * `createFlowState`, a real board and its same-flow hand-off, real fenced
 * settlement and a real git checkout. Only the harness is a stub, and it
 * records what each attempt was handed: the prompt, and the session it was
 * told to resume.
 *
 * The door is called the way App Lab calls it: the `message` action, into the
 * session the task's run link names.
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import { harnessRunHandleSchema, harnessRunInputSchema } from "@flow-state-dev/core";
import type { HarnessBlock } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { defineTaskCollection, ticketForClaim, type Task } from "@flow-state-dev/orchestration/tasks";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import {
  harnessManager,
  harnessTaskInputSchema,
  runOwnerDispatcher,
  type HarnessFeeds,
} from "../src";
import { harnessTaskId } from "../src/workspace";
import { seedRepo } from "./fixtures";

const BOARD_ID = "eng.feature.work";
const ORG_ID = "org_door";
const ALICE = "alice";
const BOB = "bob";
const ISSUE = "FIX-1";
const PHASE = "implement";
const TASK_ID = harnessTaskId(ISSUE, PHASE);

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/**
 * What one attempt does.
 *
 * - `hold` — works until its signal fires, then stops (after `exitDelayMs`,
 *   so a slow harness can be modelled).
 * - `finished` / `failed` — returns at once.
 * - `ask` — writes a question to its ask marker and returns.
 * - `finish-on-stop` / `fail-on-stop` — works until its signal fires, and in
 *   that moment its row settles `completed` / re-pends: the attempt ended on
 *   its own as the stop was sent. A stopped request's recorder leaves the row
 *   alone, so the race is written the way the board would have written it.
 * - `no-session` — fails without ever naming a session (a dispatch-only
 *   harness).
 */
type Step =
  | "hold"
  | "finish-on-stop"
  | "fail-on-stop"
  | "finished"
  | "failed"
  | "ask"
  | "no-session";

interface SeenAttempt {
  prompt: string;
  resume: string | null;
  session: string | null;
}

function stubHarness(
  script: Step[],
  seen: SeenAttempt[],
  exitDelayMs: number,
  settleFirst: (to: "completed" | "pending") => Promise<void>,
) {
  return (feeds: HarnessFeeds): HarnessBlock =>
    handler({
      name: "stub-harness",
      inputSchema: harnessRunInputSchema,
      outputSchema: harnessRunHandleSchema,
      execute: async (input, ctx) => {
        const resume = await feeds.resume(ctx as never);
        const step = script[seen.length] ?? "finished";
        const session = step === "no-session" ? null : resume ?? `sess_${seen.length + 1}`;
        seen.push({ prompt: input.prompt, resume, session });
        if (session !== null) await feeds.onSession(session, ctx as never);
        const handle = (status: "completed" | "failed") => ({
          source: "stub/test",
          status,
          sessionId: session,
          url: null,
          dispatchedAt: Date.now(),
          outcome: status === "completed" ? ("finished" as const) : ("failed" as const),
          finalMessage: null,
          usage: null,
          cost: null,
        });
        if (step === "hold" || step === "finish-on-stop" || step === "fail-on-stop") {
          const signal = (ctx as { signal: AbortSignal }).signal;
          await new Promise<void>((resolve) => {
            if (signal.aborted) return resolve();
            signal.addEventListener("abort", () => resolve(), { once: true });
          });
          if (step === "finish-on-stop") await settleFirst("completed");
          if (step === "fail-on-stop") await settleFirst("pending");
          await new Promise((resolve) => setTimeout(resolve, exitDelayMs));
          throw new DOMException("Aborted", "AbortError");
        }
        if (step === "ask") {
          const marker = /write it as the entire contents of this file:\n {2}(\S+)/.exec(input.prompt)?.[1];
          if (marker === undefined) throw new Error("the prompt named no ask marker");
          mkdirSync(dirname(marker), { recursive: true });
          writeFileSync(marker, "Which option?");
          return handle("completed");
        }
        return handle(step === "failed" || step === "no-session" ? "failed" : "completed");
      },
    }) as unknown as HarnessBlock;
}

function host(options: { script: Step[]; maxAttempts?: number; exitDelayMs?: number }) {
  const dir = mkdtempSync(join(tmpdir(), "harness-manager-door-"));
  dirs.push(dir);
  const sourceRepo = join(dir, "repo");
  mkdirSync(sourceRepo, { recursive: true });
  seedRepo(sourceRepo);

  const ledger = defineTaskCollection({
    id: BOARD_ID,
    scope: "org" as const,
    stateSchema: harnessTaskInputSchema,
  });
  const seen: SeenAttempt[] = [];
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
          ...run.answers.map((a) => `Answered: ${a.answer}`),
        ].join("\n"),
      isDone: () => true,
    },
    workspace: { root: join(dir, "checkouts"), sourceRepo, baseRef: "main", provisionTimeoutMs: 10_000 },
    runTimeoutMs: 20_000,
    ownership: { pollMs: 25 },
    harness: stubHarness(options.script, seen, options.exitDelayMs ?? 0, (to) => settleFirst(to)),
  });
  const board = taskBoard({
    name: "door-board",
    boardId: "door-board",
    collection: ledger,
    concurrency: 1,
    onReview: "exit",
    dispatcher: runOwnerDispatcher(),
    workers: {
      coder: dispatcher({ name: "door-board-hand-off", action: "work", session: "per-task" }),
    },
  });
  const seed = handler({
    name: "door-seed",
    inputSchema: z.object({}),
    outputSchema: z.object({ id: z.string() }),
    uses: [board.capability],
    execute: async (_input, ctx) => {
      const tasks = (ctx as { cap: Record<string, any> }).cap["door-board"];
      if ((await tasks.getTask(TASK_ID)) === undefined) {
        await tasks.addTask({
          id: TASK_ID,
          goal: "the feature",
          input: { issue: ISSUE, phase: PHASE },
          assignee: "coder",
          maxAttempts: options.maxAttempts ?? 3,
        });
      }
      return { id: TASK_ID };
    },
  });
  // The shipped abort, reached from inside the run's session: what an
  // Interrupt does to the running request.
  const interrupt = handler({
    name: "door-interrupt",
    inputSchema: z.object({ requestId: z.string() }),
    outputSchema: z.object({ outcome: z.string() }),
    execute: async (input, ctx) => ({ outcome: await ctx.session.stopRequest(input.requestId) }),
  });
  const flow = defineFlow({
    kind: "door-host",
    actions: {
      seed: { block: seed },
      drain: { block: board.drain },
      // How a person's answer to the run's own question re-queues it.
      answer: { block: board.unparkAndDrain },
      interrupt: { block: interrupt },
      message: manager.messageDoor(board),
    },
    task: { actions: { work: { block: manager } } },
  } as never)({ id: "door-host" } as never);
  const state = createFlowState({
    flows: { "door-host": flow },
    stores: { test: { primary: inMemoryStores() } },
    defaultProfile: "test",
    dispatchDrainTimeoutMs: 60_000,
  } as never);

  const runtime = async () =>
    (state as unknown as { getRuntime(): Promise<{ stores: any; runtimeConfig: object }> }).getRuntime();

  const act = async (
    userId: string,
    action: string,
    input: unknown = {},
    sessionId = `s_${userId}`,
  ): Promise<{ output?: any; error?: any; requestId: string }> => {
    const rt = await runtime();
    const requestId = `req_${action}_${Math.random().toString(36).slice(2)}`;
    const result = (await runAction({
      flow,
      actionName: action,
      input,
      userId,
      orgId: ORG_ID,
      sessionId,
      requestId,
      stores: rt.stores,
      runtimeConfig: { ...rt.runtimeConfig },
    } as never)) as { output?: unknown; error?: unknown };
    return { ...result, requestId };
  };

  const row = async (): Promise<Task> => {
    const rt = await runtime();
    const record = await rt.stores.resourceState.get("org", ORG_ID, `${BOARD_ID}/${TASK_ID}`);
    return record?.state as Task;
  };

  /**
   * Settle the row the way the board does when an attempt ends on its own:
   * `completed`, or re-pended for its next attempt with the claim released.
   */
  const settleFirst = async (to: "completed" | "pending"): Promise<void> => {
    const rt = await runtime();
    const current = (await row()) as Task & Record<string, unknown>;
    const next: Record<string, unknown> = { ...current, status: to };
    if (to === "pending") {
      delete next.claimedBy;
      delete next.leaseUntil;
      delete next.leaseDurationMs;
    }
    await rt.stores.resourceState.set("org", ORG_ID, `${BOARD_ID}/${TASK_ID}`, next, "any");
  };

  const until = async (
    predicate: (task: Task) => boolean,
    what: string,
    timeoutMs = 30_000,
  ): Promise<Task> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const current = await row();
      if (current !== undefined && predicate(current)) return current;
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for ${what}; row is ${JSON.stringify(current)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };

  /** Send a person's line into the session the row's run link names. */
  const send = (userId: string, message: string, sessionId?: string) =>
    row().then((current) => act(userId, "message", { message }, sessionId ?? current.run!.sessionId));

  /** The request record the run link names. */
  const request = async (requestId: string) => (await runtime()).stores.request.get(requestId);

  /** The user items in a session, as their text. */
  const userLines = async (sessionId: string): Promise<string[]> => {
    const rt = await runtime();
    const requests = await rt.stores.request.list({ sessionId, withItems: true });
    return requests.flatMap((r: { items?: Array<{ type: string; role?: string; content?: unknown }> }) =>
      (r.items ?? [])
        .filter((item) => item.type === "message" && item.role === "user")
        .map((item) =>
          Array.isArray(item.content)
            ? (item.content as Array<{ text?: string }>).map((part) => part.text ?? "").join("")
            : String(item.content),
        ),
    );
  };

  return { act, row, until, send, request, userLines, seen };
}

/** A task's retry standing: claims it spent out of its own budget. */
function standing(task: Task): number {
  return task.attempts - (task.abandonments ?? 0) - (task.turnReentries ?? 0);
}

/** The message a refused action carries, however the engine wrapped it. */
function messageOf(error: unknown): string {
  const e = error as { message?: unknown; cause?: { message?: unknown } } | undefined;
  return `${String(e?.message ?? "")} ${String(e?.cause?.message ?? "")} ${JSON.stringify(error)}`;
}

describe("a person's turn into a running coding run", () => {
  it("stops the attempt, and the next attempt continues the same session with the line", async () => {
    const lab = host({ script: ["hold", "finished"] });
    await lab.act(ALICE, "seed");
    await lab.act(ALICE, "drain");
    const running = await lab.until((t) => t.status === "in_progress" && t.run !== undefined, "the run link");
    await lab.until(() => lab.seen.length === 1, "attempt 1 to reach its harness");
    const before = standing(running);

    const sent = await lab.send(ALICE, "please also update the README");
    expect(sent.error, messageOf(sent.error)).toBeUndefined();
    expect(sent.output).toMatchObject({ outcome: "continuing" });

    // The line is in the run's session as the person's own words.
    expect(await lab.userLines(running.run!.sessionId)).toEqual(["please also update the README"]);
    // The running attempt was stopped, not failed.
    expect((await lab.request(running.run!.requestId))?.status).toBe("aborted");

    const done = await lab.until((t) => t.status === "completed", "the next attempt to finish");
    expect(lab.seen).toHaveLength(2);
    expect(lab.seen[1]!.prompt).toContain("please also update the README");
    expect(lab.seen[1]!.prompt).toContain("A person sent you this");
    // Same coding session, resumed by id.
    expect(lab.seen[1]!.resume).toBe(lab.seen[0]!.session);
    // The turn spent nothing.
    expect(standing(done)).toBe(before);
    expect(done.turnReentries).toBe(1);
  }, 60_000);
});

describe("two turns before the next attempt starts", () => {
  it("keeps both, stops once, and the next attempt gets both in order", async () => {
    // The stopped harness takes 300ms to exit, so the second line arrives
    // while the first door is still waiting on the stop.
    const lab = host({ script: ["hold", "finished"], exitDelayMs: 300 });
    await lab.act(ALICE, "seed");
    await lab.act(ALICE, "drain");
    await lab.until((t) => t.status === "in_progress" && t.run !== undefined, "the run link");
    await lab.until(() => lab.seen.length === 1, "attempt 1 to reach its harness");

    const first = lab.send(ALICE, "first line");
    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = lab.send(ALICE, "second line");
    const outcomes = await Promise.all([first, second]);
    for (const sent of outcomes) expect(sent.error, messageOf(sent.error)).toBeUndefined();
    expect(outcomes.map((sent) => sent.output.outcome).sort()).toEqual(["continuing", "kept"]);

    const done = await lab.until((t) => t.status === "completed", "the next attempt to finish");
    // One stop: attempt 1 stopped, attempt 2 ran to the end.
    expect(lab.seen).toHaveLength(2);
    const prompt = lab.seen[1]!.prompt;
    expect(prompt.indexOf("first line")).toBeGreaterThan(-1);
    expect(prompt.indexOf("second line")).toBeGreaterThan(prompt.indexOf("first line"));
    expect(done.turnReentries).toBe(1);
  }, 60_000);
});

describe("the run finished in the moment the stop was sent (BR-11)", () => {
  it("refuses when the row settled first", async () => {
    const lab = host({ script: ["finish-on-stop"] });
    await lab.act(ALICE, "seed");
    await lab.act(ALICE, "drain");
    await lab.until((t) => t.status === "in_progress" && t.run !== undefined, "the run link");
    await lab.until(() => lab.seen.length === 1, "attempt 1 to reach its harness");

    const sent = await lab.send(ALICE, "too late");
    expect(sent.error, "the door completed for a task that finished first").toBeDefined();
    expect(messageOf(sent.error)).toContain("The task finished before your message reached it.");
    const row = await lab.row();
    expect(["completed", "in_progress"]).toContain(row.status);
    expect(row.status).not.toBe("parked");
  }, 60_000);

  it("keeps the turn when the row re-pended first", async () => {
    const lab = host({ script: ["fail-on-stop", "finished"] });
    await lab.act(ALICE, "seed");
    await lab.act(ALICE, "drain");
    await lab.until((t) => t.status === "in_progress" && t.run !== undefined, "the run link");
    await lab.until(() => lab.seen.length === 1, "attempt 1 to reach its harness");

    const sent = await lab.send(ALICE, "still useful");
    expect(sent.error, messageOf(sent.error)).toBeUndefined();
    expect(sent.output.outcome).toBe("kept");
    await lab.act(ALICE, "drain");
    await lab.until((t) => t.status === "completed", "the next attempt");
    expect(lab.seen[1]!.prompt).toContain("still useful");
  }, 60_000);
});

describe("a turn to a run that is not working right now", () => {
  it("is kept for the attempt after a question, and does not answer it (BR-12)", async () => {
    const lab = host({ script: ["ask", "finished"] });
    await lab.act(ALICE, "seed");
    await lab.act(ALICE, "drain");
    const parked = await lab.until((t) => t.status === "parked", "the run to ask");

    const sent = await lab.send(ALICE, "and use tabs");
    expect(sent.error, messageOf(sent.error)).toBeUndefined();
    expect(sent.output.outcome).toBe("kept");
    // Still waiting on its question: the turn did not unpark it.
    const still = await lab.row();
    expect(still.status).toBe("parked");
    expect(still.feedback).toBe(parked.feedback);
    expect(lab.seen).toHaveLength(1);

    await lab.act(ALICE, "answer", { taskId: TASK_ID });
    await lab.until((t) => t.status === "completed", "the attempt after the answer");
    expect(lab.seen[1]!.prompt).toContain("and use tabs");
  }, 60_000);

  it("is kept for the next attempt of a row between attempts, and stops nothing (BR-13)", async () => {
    const lab = host({ script: ["failed", "finished"] });
    await lab.act(ALICE, "seed");
    await lab.act(ALICE, "drain");
    await lab.until((t) => t.status === "pending" && t.attempts === 1, "attempt 1 to fail");

    const sent = await lab.send(ALICE, "try the other approach");
    expect(sent.error, messageOf(sent.error)).toBeUndefined();
    expect(sent.output.outcome).toBe("kept");
    expect((await lab.row()).status).toBe("pending");

    await lab.act(ALICE, "drain");
    await lab.until((t) => t.status === "completed", "the next attempt");
    expect(lab.seen[1]!.prompt).toContain("try the other approach");
    // Delivered once: a third attempt would not see it again.
    expect(lab.seen[1]!.prompt.split("try the other approach")).toHaveLength(2);
  }, 60_000);
});

describe("refusals", () => {
  it("refuses a session no run is linked to, and leaves the line in it (BR-14, BR-5)", async () => {
    const lab = host({ script: ["finished"] });
    await lab.act(ALICE, "seed");
    const sent = await lab.act(ALICE, "message", { message: "hello?" }, "s_nowhere");
    expect(sent.error, "the door completed with no run").toBeDefined();
    expect(messageOf(sent.error)).toContain("This task hasn't started, so there's no session to write into.");
    expect((await lab.request(sent.requestId))?.status).toBe("failed");
    expect(await lab.userLines("s_nowhere")).toEqual(["hello?"]);
  }, 60_000);

  it("refuses a finished task (BR-15)", async () => {
    const lab = host({ script: ["finished"] });
    await lab.act(ALICE, "seed");
    await lab.act(ALICE, "drain");
    await lab.until((t) => t.status === "completed", "the run to finish");
    const sent = await lab.send(ALICE, "one more thing");
    expect(messageOf(sent.error)).toContain("A finished task takes no message.");
  }, 60_000);

  it("refuses a run whose harness never named a coding session (BR-16)", async () => {
    const lab = host({ script: ["no-session", "finished"] });
    await lab.act(ALICE, "seed");
    await lab.act(ALICE, "drain");
    await lab.until((t) => t.status === "pending" && t.attempts === 1, "attempt 1 to end");
    const sent = await lab.send(ALICE, "continue please");
    expect(messageOf(sent.error)).toContain("This run's harness can't continue with a message.");
  }, 60_000);

  it("refuses someone other than the run's person, and keeps nothing (BR-6)", async () => {
    const lab = host({ script: ["failed", "finished"] });
    await lab.act(ALICE, "seed");
    await lab.act(ALICE, "drain");
    await lab.until((t) => t.status === "pending" && t.attempts === 1, "attempt 1 to fail");

    // The run's session is Alice's: the engine refuses Bob before the door
    // runs, so nothing of his is written into it.
    const sent = await lab.send(BOB, "from bob").catch((error: unknown) => ({ error }));
    expect(sent.error, "Bob's line reached Alice's run").toBeDefined();
    expect(messageOf(sent.error)).toContain("belongs to another user");
    expect(await lab.userLines((await lab.row()).run!.sessionId)).not.toContain("from bob");
    await lab.act(ALICE, "drain");
    await lab.until((t) => t.status === "completed", "Alice's next attempt");
    expect(lab.seen[1]!.prompt).not.toContain("from bob");
  }, 60_000);
});

describe("a turn and an Interrupt (BR-17)", () => {
  it("leaves an interrupted attempt to the board, and keeps the turn", async () => {
    const lab = host({ script: ["hold", "finished"] });
    await lab.act(ALICE, "seed");
    await lab.act(ALICE, "drain");
    const running = await lab.until((t) => t.status === "in_progress" && t.run !== undefined, "the run link");
    await lab.until(() => lab.seen.length === 1, "attempt 1 to reach its harness");

    const stopped = await lab.act(ALICE, "interrupt", { requestId: running.run!.requestId }, running.run!.sessionId);
    expect(stopped.output).toEqual({ outcome: "stopped" });
    for (let i = 0; i < 100; i += 1) {
      if ((await lab.request(running.run!.requestId))?.status === "aborted") break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    const sent = await lab.send(ALICE, "after the interrupt");
    expect(sent.error, messageOf(sent.error)).toBeUndefined();
    expect(sent.output.outcome).toBe("kept");
    // Not parked for a turn: the board decides what an interrupted attempt
    // comes to.
    const row = await lab.row();
    expect(row.status).toBe("in_progress");
    expect(row.parkedForTurn).toBeUndefined();
  }, 60_000);
});
