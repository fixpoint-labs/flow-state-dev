/**
 * Talking to a run — the manager's door (FIX-1690).
 *
 * Driven end to end, in process, like `mailbox-board.spec.ts`: a real
 * `createFlowState`, a real board and its same-flow hand-off, real fenced
 * settlement and a real git checkout. Only the harness is a stub, and it
 * records what each attempt was handed: the prompt, and the session it was
 * told to resume.
 *
 * The door is called the way Shift Manager calls it: the `message` action, into the
 * session the task's run link names.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import { harnessRunHandleSchema, harnessRunInputSchema } from "@flow-state-dev/core";
import type { HarnessBlock } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { defineTaskCollection, type Task } from "@flow-state-dev/orchestration/tasks";
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
 * - `finish-later` — works for 400ms, then returns finished on its own.
 * - `ignore-stop` — works past its signal until the test releases it: a
 *   harness that does not stop in time.
 * - `late-session` — starts, and names its session only once the test opens
 *   the session gate; then works like `hold`. The window every real harness
 *   has between starting and the vendor naming its session.
 */
type Step =
  | "hold"
  | "finish-on-stop"
  | "fail-on-stop"
  | "finished"
  | "failed"
  | "ask"
  | "no-session"
  | "finish-later"
  | "ignore-stop"
  | "late-session";

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
  released: Promise<void>,
  sessionGate: Promise<void>,
  atHarnessStart: () => Promise<void>,
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
        await atHarnessStart();
        if (step === "late-session") await sessionGate;
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
        if (
          step === "hold" ||
          step === "late-session" ||
          step === "finish-on-stop" ||
          step === "fail-on-stop" ||
          step === "ignore-stop"
        ) {
          const signal = (ctx as { signal: AbortSignal }).signal;
          await new Promise<void>((resolve) => {
            if (signal.aborted) return resolve();
            signal.addEventListener("abort", () => resolve(), { once: true });
          });
          if (step === "finish-on-stop") await settleFirst("completed");
          if (step === "fail-on-stop") await settleFirst("pending");
          if (step === "ignore-stop") await released;
          await new Promise((resolve) => setTimeout(resolve, exitDelayMs));
          throw new DOMException("Aborted", "AbortError");
        }
        if (step === "finish-later") {
          await new Promise((resolve) => setTimeout(resolve, 400));
          return handle("completed");
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

/** What one call to the phase's prompt builder was handed, of the parts these specs read. */
interface SeenBuild {
  task: unknown;
  feedback: string | undefined;
}

function host(options: {
  script: Step[];
  maxAttempts?: number;
  exitDelayMs?: number;
  /** Extra fields the seeded row carries. */
  row?: Record<string, unknown>;
  /** Holds the first prompt build until the test calls `openPrompt`: an attempt still being prepared. */
  holdPrompt?: boolean;
  /** Runs as each attempt's harness starts, before it names a session. */
  atHarnessStart?: () => Promise<void>;
}) {
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
  const builds: SeenBuild[] = [];
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let openSession!: () => void;
  const sessionGate = new Promise<void>((resolve) => {
    openSession = resolve;
  });
  let openPrompt!: () => void;
  const promptGate = new Promise<void>((resolve) => {
    openPrompt = resolve;
  });
  const manager = harnessManager({
    boardCollectionId: BOARD_ID,
    boardCollection: ledger,
    tenant: undefined,
    phase: {
      phase: PHASE,
      buildPrompt: async (run) => {
        builds.push({ task: run.task, feedback: run.feedback });
        if (options.holdPrompt === true && builds.length === 1) await promptGate;
        return [
          `Work on ${run.issue}, attempt ${run.attempt}.`,
          "To ask, write it as the entire contents of this file:",
          `  ${run.askMarkerPath}`,
          ...run.answers.map((a) => `Answered: ${a.answer}`),
        ].join("\n");
      },
      isDone: () => true,
    },
    workspace: { root: join(dir, "checkouts"), sourceRepo, baseRef: "main", provisionTimeoutMs: 10_000 },
    runTimeoutMs: 20_000,
    ownership: { pollMs: 25 },
    harness: stubHarness(
      options.script,
      seen,
      options.exitDelayMs ?? 0,
      (to) => settleFirst(to),
      released,
      sessionGate,
      async () => options.atHarnessStart?.(),
    ),
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
          ...options.row,
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
      message: manager.messageDoor({ drain: "resume" }),
    },
    // Where the door re-runs the board: in the session that claimed the row.
    internal: { actions: { resume: { block: board.drain } } },
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

  /**
   * Hold the stop a second door sends while it waits on attempt 1, until the
   * row reads `completed`. Once the first door has parked the row, the only
   * stop still asked of attempt 1's request is the second door's, so this
   * wakes that door into a row its next attempt already finished: the moment
   * a loaded machine can produce, made certain.
   */
  const holdSecondDoorUntilFinished = async (attempt1RequestId: string): Promise<void> => {
    const stores = (await runtime()).stores;
    const original = stores.request.setFieldsIfStatus.bind(stores.request);
    stores.request.setFieldsIfStatus = async (id: string, ...rest: unknown[]) => {
      const current = await row();
      if (id === attempt1RequestId && (current.attempts >= 2 || current.status === "parked")) {
        await until((t) => t.status === "completed", "the next attempt to finish first");
      }
      return original(id, ...(rest as []));
    };
  };

  /**
   * Hold the door's first stop of the attempt's request until that attempt
   * has finished on its own and its row settled: the door read the row
   * running, and the stop then finds the request already over.
   */
  const holdStopUntilSettled = async (attemptRequestId: string): Promise<{ settledVersion?: number }> => {
    const seenAt: { settledVersion?: number } = {};
    const stores = (await runtime()).stores;
    const original = stores.request.setFieldsIfStatus.bind(stores.request);
    stores.request.setFieldsIfStatus = async (id: string, ...rest: unknown[]) => {
      if (id === attemptRequestId) {
        await until((t) => t.status === "completed", "the attempt to settle its row");
        for (;;) {
          const record = await stores.request.get(attemptRequestId);
          if (record?.status !== "in_progress") break;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        seenAt.settledVersion = await rowVersion();
      }
      return original(id, ...(rest as []));
    };
    return seenAt;
  };

  /** The kept turns, as stored now: the person's words and the attempt that took each. */
  const turns = async (): Promise<Array<{ message: string; deliveredTo: number | null }>> => {
    const rt = await runtime();
    const rows = await rt.stores.resourceState.getByPrefix("user", `${ALICE}:~org:${ORG_ID}`, "turns/");
    return Object.values(rows).map((row: any) => ({ message: row.state.message, deliveredTo: row.state.deliveredTo }));
  };

  /**
   * Hold the first store write to a user key under `prefix` until the test
   * releases it. `arrived` resolves once that write is waiting.
   */
  const holdWrite = async (prefix: string): Promise<{ arrived: Promise<void>; release: () => void }> => {
    const stores = (await runtime()).stores;
    const original = stores.resourceState.set.bind(stores.resourceState);
    let arrive!: () => void;
    const arrived = new Promise<void>((resolve) => {
      arrive = resolve;
    });
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let armed = true;
    stores.resourceState.set = async (...args: any[]) => {
      if (armed && args[0] === "user" && String(args[2]).startsWith(prefix)) {
        armed = false;
        arrive();
        await released;
      }
      return original(...(args as [any, any, any, any, any]));
    };
    return { arrived, release };
  };

  /** The session the run record holds, as stored now. */
  const recordedSession = async (): Promise<string | null> => {
    const rt = await runtime();
    const rows = await rt.stores.resourceState.getByPrefix("user", `${ALICE}:~org:${ORG_ID}`, "runs/");
    const named = Object.values(rows).map((row: any) => row.state?.sessionId).find((id) => typeof id === "string");
    return named ?? null;
  };

  /** The stored version of the row, which moves on every write to it. */
  const rowVersion = async (): Promise<number | undefined> => {
    const rt = await runtime();
    return (await rt.stores.resourceState.get("org", ORG_ID, `${BOARD_ID}/${TASK_ID}`))?.version;
  };

  /** Write the row as stored, the way a write the test stands in for would. */
  const writeRow = async (next: Record<string, unknown>): Promise<void> => {
    const rt = await runtime();
    await rt.stores.resourceState.set("org", ORG_ID, `${BOARD_ID}/${TASK_ID}`, next, "any");
  };

  /** Make the next write that re-queues the row (to `pending`) throw, once. */
  const failNextRequeue = async (): Promise<void> => {
    const stores = (await runtime()).stores;
    const original = stores.resourceState.set.bind(stores.resourceState);
    let armed = true;
    stores.resourceState.set = async (...args: any[]) => {
      if (armed && args[2] === `${BOARD_ID}/${TASK_ID}` && args[3]?.status === "pending") {
        armed = false;
        throw new Error("the store refused the re-queue");
      }
      return original(...(args as [any, any, any, any, any]));
    };
  };

  /**
   * Make the door's wait for a stop run out: from the door's second ask of
   * the attempt's request, the clock reads past the wait. Returns the restore.
   */
  const expireStopWait = async (attemptRequestId: string): Promise<() => void> => {
    const stores = (await runtime()).stores;
    const original = stores.request.setFieldsIfStatus.bind(stores.request);
    const realNow = Date.now;
    let asks = 0;
    stores.request.setFieldsIfStatus = async (id: string, ...rest: unknown[]) => {
      if (id === attemptRequestId && ++asks === 2) {
        const offset = 2 * 60_000;
        Date.now = () => realNow() + offset;
      }
      return original(id, ...(rest as []));
    };
    return () => {
      Date.now = realNow;
      stores.request.setFieldsIfStatus = original;
    };
  };

  return {
    act,
    row,
    writeRow,
    failNextRequeue,
    expireStopWait,
    release: () => release(),
    openSession: () => openSession(),
    openPrompt: () => openPrompt(),
    holdWrite,
    recordedSession,
    turns,
    until,
    send,
    request,
    userLines,
    seen,
    builds,
    settleFirst,
    holdSecondDoorUntilFinished,
    holdStopUntilSettled,
    rowVersion,
  };
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

/** Resolve after `ms`, with `value`. */
function after<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

// Every attempt starts with no confirmed session: the run record clears it when
// the attempt opens, and the harness names one only once the vendor answers,
// after the prompt is built and the checkout taken. A person watching the task
// sees it running all that time, so a line sent then is a line to a running
// run, and the door must not tell them the run can never take one.
describe("a turn sent while the run is still starting (FIX-1735)", () => {
  it("holds a line sent before the harness names its session, then continues that session with it", async () => {
    const lab = host({ script: ["late-session", "finished"] });
    await lab.act(ALICE, "seed");
    await lab.act(ALICE, "drain");
    const running = await lab.until((t) => t.status === "in_progress" && t.run !== undefined, "the run link");
    await lab.until(() => lab.seen.length === 1, "attempt 1 to start its harness");

    const pending = lab.send(ALICE, "please also update the README");
    // The harness has not named its session yet: the door waits for it rather
    // than answering for it.
    const early = await Promise.race([pending.then((sent) => sent), after(400, "waiting" as const)]);
    expect(early, `the door answered before the session was named: ${messageOf((early as { error?: unknown }).error)}`).toBe("waiting");

    lab.openSession();
    const sent = await pending;
    expect(sent.error, messageOf(sent.error)).toBeUndefined();
    expect(sent.output).toMatchObject({ outcome: "continuing" });
    expect((await lab.request(running.run!.requestId))?.status).toBe("aborted");

    await lab.until((t) => t.status === "completed", "the next attempt to finish");
    expect(lab.seen).toHaveLength(2);
    expect(lab.seen[1]!.prompt).toContain("please also update the README");
    // The same coding session, the one the harness named after the line was sent.
    expect(lab.seen[1]!.resume).toBe(lab.seen[0]!.session);
  }, 60_000);

  it("hands a line sent while the attempt is still being prepared to that attempt, and stops nothing", async () => {
    const lab = host({ script: ["finished"], holdPrompt: true });
    await lab.act(ALICE, "seed");
    await lab.act(ALICE, "drain");
    const running = await lab.until((t) => t.status === "in_progress" && t.run !== undefined, "the run link");
    await lab.until(() => lab.builds.length === 1, "attempt 1 to reach its prompt");

    const pending = lab.send(ALICE, "use the blue theme");
    await after(200, undefined);
    lab.openPrompt();
    const sent = await pending;
    expect(sent.error, messageOf(sent.error)).toBeUndefined();
    expect(sent.output).toMatchObject({ outcome: "continuing" });

    const done = await lab.until((t) => t.status === "completed", "the attempt to finish");
    // The attempt that was starting took the line into its own prompt: one
    // attempt, never stopped.
    expect(lab.seen).toHaveLength(1);
    expect(lab.seen[0]!.prompt).toContain("use the blue theme");
    expect(done.attempts).toBe(1);
    expect((await lab.request(running.run!.requestId))?.status).toBe("completed");
  }, 60_000);

  // The door's wait reads the session first and the turn second, and stops the
  // attempt once a session is named and the turn is not taken. That is only
  // safe because an attempt takes its turns before its harness starts: a turn
  // it will act on is marked taken before any session can be named.
  it("marks a turn kept for a starting attempt taken before that attempt's harness starts", async () => {
    let atStart: Array<{ message: string; deliveredTo: number | null }> | undefined;
    const lab = host({
      script: ["finished"],
      holdPrompt: true,
      atHarnessStart: async () => {
        atStart ??= await lab.turns();
      },
    });
    await lab.act(ALICE, "seed");
    await lab.act(ALICE, "drain");
    await lab.until(() => lab.builds.length === 1, "attempt 1 to reach its prompt");

    const pending = lab.send(ALICE, "use the blue theme");
    await after(200, undefined);
    expect(await lab.turns(), "the door kept no turn").toEqual([{ message: "use the blue theme", deliveredTo: null }]);
    lab.openPrompt();
    await pending;
    expect(atStart).toEqual([{ message: "use the blue theme", deliveredTo: 1 }]);
  }, 60_000);

  // The door decides from the run record and keeps the turn. A first attempt
  // has no record until it opens, and a record this request first read absent
  // stays absent to it. So if the door read the record, and the attempt then
  // opened, took its turns and named its session before the door's keep
  // landed, a door that read first would wait on a session it can never see,
  // for a turn no running attempt will take.
  it("continues the run with a line whose keep lands after the attempt opened and took its turns", async () => {
    const lab = host({ script: ["hold", "finished"] });
    await lab.act(ALICE, "seed");
    const opening = await lab.holdWrite("runs/");
    const draining = lab.act(ALICE, "drain");
    await opening.arrived;
    const running = await lab.until((t) => t.status === "in_progress" && t.run !== undefined, "the run link");

    const keeping = await lab.holdWrite("turns/");
    const pending = lab.send(ALICE, "use the blue theme");
    await keeping.arrived;
    opening.release();
    await lab.until(() => lab.seen.length === 1, "attempt 1 to start its harness");
    while ((await lab.recordedSession()) === null) await after(25, undefined);
    keeping.release();

    // A door that cannot see the session would hold the line until its wait
    // runs out; run the clock past it rather than wait a minute.
    const early = await Promise.race([pending, after(2_000, "waiting" as const)]);
    let sent: Awaited<typeof pending>;
    if (early === "waiting") {
      vi.setSystemTime(Date.now() + 2 * 60_000);
      try {
        sent = await pending;
      } finally {
        vi.useRealTimers();
      }
    } else {
      sent = early;
    }
    expect(sent.error, messageOf(sent.error)).toBeUndefined();
    expect(sent.output).toMatchObject({ outcome: "continuing" });
    expect((await lab.request(running.run!.requestId))?.status).toBe("aborted");

    await lab.until((t) => t.status === "completed", "the next attempt to finish");
    await draining;
    expect(lab.seen).toHaveLength(2);
    expect(lab.seen[1]!.prompt).toContain("use the blue theme");
    expect(lab.seen[1]!.resume).toBe(lab.seen[0]!.session);
  }, 60_000);

  it("says the run is still starting, and keeps nothing, when the harness never names its session in time", async () => {
    const lab = host({ script: ["late-session", "finished"] });
    await lab.act(ALICE, "seed");
    await lab.act(ALICE, "drain");
    await lab.until((t) => t.status === "in_progress" && t.run !== undefined, "the run link");
    await lab.until(() => lab.seen.length === 1, "attempt 1 to start its harness");

    const pending = lab.send(ALICE, "are you there?");
    await after(300, undefined);
    // The door's wait runs out while the session is still unnamed.
    vi.setSystemTime(Date.now() + 2 * 60_000);
    let sent: Awaited<typeof pending>;
    try {
      sent = await pending;
    } finally {
      vi.useRealTimers();
    }
    expect(sent.error, "the door completed with no session named").toBeDefined();
    expect(messageOf(sent.error)).toContain("This run is still starting");
    expect(messageOf(sent.error)).not.toContain("can't continue");

    // Withdrawn: once the harness names its session, a later line continues
    // the run, and the attempt it starts is not handed the line the person was
    // told didn't arrive.
    lab.openSession();
    await lab.until(() => lab.seen.length === 1, "attempt 1 to keep running");
    const later = await lab.send(ALICE, "now go ahead");
    expect(later.error, messageOf(later.error)).toBeUndefined();
    expect(later.output).toMatchObject({ outcome: "continuing" });
    await lab.until((t) => t.status === "completed", "the next attempt to finish");
    expect(lab.seen).toHaveLength(2);
    expect(lab.seen[1]!.prompt).toContain("now go ahead");
    expect(lab.seen[1]!.prompt).not.toContain("are you there?");
  }, 60_000);
});

describe("a turn to each of two attempts, one after the other (BR-5, BR-14)", () => {
  it("keeps the run in one session that holds both lines", async () => {
    const lab = host({ script: ["hold", "hold", "finished"] });
    await lab.act(ALICE, "seed");
    await lab.act(ALICE, "drain");
    const first = await lab.until((t) => t.status === "in_progress" && t.run !== undefined, "the run link");
    await lab.until(() => lab.seen.length === 1, "attempt 1 to reach its harness");
    const session = first.run!.sessionId;

    const one = await lab.send(ALICE, "line one", session);
    expect(one.error, messageOf(one.error)).toBeUndefined();
    expect(one.output.outcome).toBe("continuing");

    // The next attempt runs where the first did: the session the person is
    // looking at, not a new one beneath it.
    const second = await lab.until(
      (t) => t.status === "in_progress" && t.run?.attempt === 2,
      "attempt 2's run link",
    );
    expect(second.run!.sessionId).toBe(session);
    await lab.until(() => lab.seen.length === 2, "attempt 2 to reach its harness");

    // A line sent to that same session reaches the run again.
    const two = await lab.send(ALICE, "line two", session);
    expect(two.error, messageOf(two.error)).toBeUndefined();
    expect(two.output.outcome).toBe("continuing");

    const done = await lab.until((t) => t.status === "completed", "attempt 3 to finish");
    expect(done.run!.sessionId).toBe(session);
    expect((await lab.userLines(session)).sort()).toEqual(["line one", "line two"]);
    expect(lab.seen[1]!.prompt).toContain("line one");
    expect(lab.seen[2]!.prompt).toContain("line two");
    expect(lab.seen[2]!.resume).toBe(lab.seen[0]!.session);
    expect(done.turnReentries).toBe(2);
  }, 60_000);
});

describe("a turn between a claim and its run starting", () => {
  it("is kept for the attempt the claim started, not refused as never started", async () => {
    const lab = host({ script: ["failed", "finished"] });
    await lab.act(ALICE, "seed");
    await lab.act(ALICE, "drain");
    const pending = await lab.until((t) => t.status === "pending" && t.attempts === 1, "attempt 1 to fail");
    const session = pending.run!.sessionId;

    // Claimed for attempt 2, whose run has not linked yet: the claim cleared
    // the link.
    const claimed: Record<string, unknown> = {
      ...pending,
      status: "in_progress",
      attempts: 2,
      leaseUntil: Date.now() + 60_000,
      leaseDurationMs: 60_000,
    };
    delete claimed.run;
    await lab.writeRow(claimed);

    const sent = await lab.send(ALICE, "in the gap", session);
    expect(sent.error, messageOf(sent.error)).toBeUndefined();
    expect(sent.output.outcome).toBe("kept");

    // That claim's run starts and takes the line.
    await lab.writeRow(pending as unknown as Record<string, unknown>);
    await lab.act(ALICE, "drain");
    await lab.until((t) => t.status === "completed", "the next attempt");
    expect(lab.seen[1]!.prompt).toContain("in the gap");
  }, 60_000);
});

describe("a turn whose re-queue fails after the park", () => {
  it("answers kept, never not-delivered, and the line reaches the run", async () => {
    const lab = host({ script: ["hold", "finished"] });
    await lab.act(ALICE, "seed");
    await lab.act(ALICE, "drain");
    await lab.until((t) => t.status === "in_progress" && t.run !== undefined, "the run link");
    await lab.until(() => lab.seen.length === 1, "attempt 1 to reach its harness");
    await lab.failNextRequeue();

    const sent = await lab.send(ALICE, "kept anyway");
    expect(sent.error, messageOf(sent.error)).toBeUndefined();
    expect(sent.output.outcome).toBe("kept");
    const row = await lab.row();
    expect(row.status).toBe("parked");
    expect(row.parkedForTurn).toBe(true);

    // Whatever re-queues the row next runs the line.
    await lab.act(ALICE, "answer", { taskId: TASK_ID });
    await lab.until((t) => t.status === "completed", "the next attempt");
    expect(lab.seen[1]!.prompt).toContain("kept anyway");
  }, 60_000);

  it("answers kept when the claiming session can't be reached, and leaves the row queued", async () => {
    const lab = host({ script: ["hold", "finished"] });
    await lab.act(ALICE, "seed");
    await lab.act(ALICE, "drain");
    const running = await lab.until((t) => t.status === "in_progress" && t.run !== undefined, "the run link");
    await lab.until(() => lab.seen.length === 1, "attempt 1 to reach its harness");
    await lab.writeRow({ ...running, claimedBy: { ...running.claimedBy!, sessionId: "s_gone" } });

    const sent = await lab.send(ALICE, "queued anyway");
    expect(sent.error, messageOf(sent.error)).toBeUndefined();
    expect(sent.output.outcome).toBe("kept");
    expect((await lab.row()).status).toBe("pending");

    await lab.act(ALICE, "drain");
    const done = await lab.until((t) => t.status === "completed", "the next attempt");
    expect(lab.seen[1]!.prompt).toContain("queued anyway");
    expect(done.run!.sessionId).toBe(running.run!.sessionId);
  }, 60_000);
});

describe("a run that doesn't stop in time", () => {
  it("answers kept, so nothing invites a resend of a line the run will get", async () => {
    const lab = host({ script: ["ignore-stop", "finished"] });
    await lab.act(ALICE, "seed");
    await lab.act(ALICE, "drain");
    const running = await lab.until((t) => t.status === "in_progress" && t.run !== undefined, "the run link");
    await lab.until(() => lab.seen.length === 1, "attempt 1 to reach its harness");
    const restore = await lab.expireStopWait(running.run!.requestId);

    let sent;
    try {
      sent = await lab.send(ALICE, "when you can");
    } finally {
      restore();
      lab.release();
    }
    expect(sent.error, messageOf(sent.error)).toBeUndefined();
    expect(sent.output.outcome).toBe("kept");
    expect((await lab.request(sent.requestId))?.status).toBe("completed");
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
    // One door stops and re-queues. The other finds the row taken by then:
    // its line is kept for the attempt now starting, or, if that attempt
    // already finished with it, delivered (the case below makes that certain).
    const sorted = outcomes.map((sent) => sent.output.outcome).sort();
    expect(sorted[0]).toBe("continuing");
    expect(["continuing", "kept"]).toContain(sorted[1]);

    const done = await lab.until((t) => t.status === "completed", "the next attempt to finish");
    // One stop: attempt 1 stopped, attempt 2 ran to the end.
    expect(lab.seen).toHaveLength(2);
    const prompt = lab.seen[1]!.prompt;
    expect(prompt.indexOf("first line")).toBeGreaterThan(-1);
    expect(prompt.indexOf("second line")).toBeGreaterThan(prompt.indexOf("first line"));
    expect(done.turnReentries).toBe(1);
  }, 60_000);
});

describe("a second line whose door wakes after the next attempt finished (BR-10)", () => {
  it("answers delivered, because the attempt that finished took it", async () => {
    const lab = host({ script: ["hold", "finished"], exitDelayMs: 300 });
    await lab.act(ALICE, "seed");
    await lab.act(ALICE, "drain");
    const running = await lab.until((t) => t.status === "in_progress" && t.run !== undefined, "the run link");
    await lab.until(() => lab.seen.length === 1, "attempt 1 to reach its harness");
    await lab.holdSecondDoorUntilFinished(running.run!.requestId);

    const first = lab.send(ALICE, "first line");
    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = lab.send(ALICE, "second line");
    const outcomes = await Promise.all([first, second]);
    // Attempt 2 ran with both lines, so neither person may be told theirs
    // didn't reach the task.
    for (const sent of outcomes) expect(sent.error, messageOf(sent.error)).toBeUndefined();
    expect(outcomes.map((sent) => sent.output.outcome)).toEqual(["continuing", "continuing"]);
    expect(lab.seen).toHaveLength(2);
    expect(lab.seen[1]!.prompt).toContain("first line");
    expect(lab.seen[1]!.prompt).toContain("second line");
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

    // A refused line is withdrawn: were the task ever run again, its next
    // attempt must not act on a line the person was told didn't reach it.
    await lab.settleFirst("pending");
    await lab.act(ALICE, "drain");
    await lab.until(() => lab.seen.length === 2, "a later attempt");
    expect(lab.seen[1]!.prompt).not.toContain("too late");
  }, 60_000);

  it("refuses when the stop finds the attempt already over and its row settled", async () => {
    const lab = host({ script: ["finish-later"] });
    await lab.act(ALICE, "seed");
    await lab.act(ALICE, "drain");
    const running = await lab.until((t) => t.status === "in_progress" && t.run !== undefined, "the run link");
    await lab.until(() => lab.seen.length === 1, "attempt 1 to reach its harness");
    const seenAt = await lab.holdStopUntilSettled(running.run!.requestId);

    const sent = await lab.send(ALICE, "just missed");
    expect(sent.error, "the door completed for a task that finished first").toBeDefined();
    expect(messageOf(sent.error)).toContain("The task finished before your message reached it.");
    expect((await lab.row()).status).toBe("completed");
    // The door read the settled row and wrote nothing to it.
    expect(seenAt.settledVersion).toBeDefined();
    expect(await lab.rowVersion()).toBe(seenAt.settledVersion);
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

describe("the claimed task, handed to the prompt builder", () => {
  // A builder that only had the row's id would have to read the board back to
  // learn what the work is, and could read a different row than the one
  // claimed. It is handed the brief the board packed, on every attempt.
  const seeded = { goal: "the feature", input: { issue: ISSUE, phase: PHASE } };

  it("hands the task on the first attempt and again on a retry, beside why the last one stopped", async () => {
    const lab = host({ script: ["failed", "finished"] });
    await lab.act(ALICE, "seed");
    await lab.act(ALICE, "drain");
    await lab.until((t) => t.status === "pending" && t.attempts === 1, "attempt 1 to fail");
    await lab.act(ALICE, "drain");
    await lab.until((t) => t.status === "completed", "the retry");

    expect(lab.builds).toHaveLength(2);
    expect(lab.builds[0]!.task).toEqual(seeded);
    expect(lab.builds[0]!.feedback).toBeUndefined();
    expect(lab.builds[1]!.task).toEqual(seeded);
    expect(lab.builds[1]!.feedback).toEqual(expect.any(String));
  }, 60_000);

  it("hands the task to the attempt after a person's message, which still follows the prompt", async () => {
    const lab = host({ script: ["hold", "finished"] });
    await lab.act(ALICE, "seed");
    await lab.act(ALICE, "drain");
    await lab.until((t) => t.status === "in_progress" && t.run !== undefined, "the run link");
    await lab.until(() => lab.seen.length === 1, "attempt 1 to reach its harness");
    await lab.send(ALICE, "please also update the README");
    await lab.until((t) => t.status === "completed", "the next attempt");

    expect(lab.builds).toHaveLength(2);
    expect(lab.builds[1]!.task).toEqual(seeded);
    expect(lab.seen[1]!.prompt).toContain("please also update the README");
  }, 60_000);

  it("carries the row's title and context when it has them, never its metadata, and no key it lacks", async () => {
    const lab = host({
      script: ["finished"],
      row: { title: "Night mode", context: "Users asked for it twice.", metadata: { owner: "x" } },
    });
    await lab.act(ALICE, "seed");
    await lab.act(ALICE, "drain");
    await lab.until((t) => t.status === "completed", "the attempt");

    const task = lab.builds[0]!.task as Record<string, unknown>;
    expect(task).toEqual({ ...seeded, title: "Night mode", context: "Users asked for it twice." });
    // Absent, not present-and-undefined: the hand-off can cross a process boundary.
    expect(Object.keys(task).sort()).toEqual(["context", "goal", "input", "title"]);
  }, 60_000);
});
