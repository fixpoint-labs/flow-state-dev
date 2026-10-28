/**
 * A host for the split (FIX-1802 P2): the board host, plus `splitter`, an
 * app's own worker flow carrying the filing kit whose turn runs no model. Its
 * turn does what the test's controls say for the running worker, through the
 * very ref the task tools and actions write through (the board's resolver):
 *
 * - on a message that isn't a notice, it files the worker's `plans` entry,
 *   one row per piece, and records any refusal by its error's name;
 * - on a notice, it throws when the worker is in `failNoticeTurn`, and files
 *   the worker's `onErrored` piece once when the notice is a failure for good,
 *   and its `onCompleted` piece once when the notice is a completion;
 * - after filing, it waits `holdAfterFiling[worker]` ms, then throws when the
 *   worker is in `failAfterFiling` (FIX-2080: the work a failed task filed);
 * - before filing, a worker in `waitForUserBeforeFiling` (by its id, or as
 *   `<worker>:<message>` for one turn) waits for the user, and records what
 *   came back in `answered` (FIX-2129; needs a durable host).
 *
 * Every turn is recorded (worker, session, message).
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import { defineSessionBoard, workerConfigSchema, type WorkerManifest } from "../src";
import { workerTaskEntry } from "../src/conversation-board/task-entry";
import type { WorkerInstallation } from "../src/workers/installation";
import type { ChainRecord } from "../src/conversation-board/chain";
import { ORG, boardWorkers, bootBoardHost, messageOf, type BoardHostOptions } from "./conversation-board-harness";

/** A piece a turn files, with the filing settings it is filed with (FIX-2080). */
export type Piece = {
  goal: string;
  assignee?: string;
  id?: string;
  session?: "new" | "ongoing";
  resultTo?: "filer" | "conversation";
  maxAttempts?: number;
  held?: boolean;
  followUpOf?: string;
  deps?: string[];
};

/** What the splitter's turns do, by worker id: the test sets and changes these. */
export type SplitControls = {
  plans: Record<string, Piece[]>;
  failNoticeTurn: Set<string>;
  onErrored: Record<string, Piece>;
  /** The piece (or pieces, filed together) a worker files once on a completion notice. */
  onCompleted: Record<string, Piece | Piece[]>;
  /** What a worker's turn on a notice answers, in place of what it heard. */
  noticeAnswer: Record<string, unknown>;
  refusals: Array<{ worker: string; error: string; message?: string }>;
  turns: Array<{ worker: string; sessionId: string; message: string }>;
  /** Workers whose turn throws after filing its pieces (not on a notice). */
  failAfterFiling: Set<string>;
  /** How long a worker's turn waits after filing its pieces, in ms. */
  holdAfterFiling: Record<string, number>;
  /** Workers whose turn files its pieces as one batch (`createTasks`), not one by one. */
  batch: Set<string>;
  /** What a worker's turn waits on before it files its pieces (not on a notice). */
  holdBeforeFiling: Record<string, Promise<void>>;
  /**
   * Once, the next time a worker's turn files: after it has read its board
   * (the request's snapshot) and before it files, call `reached`, then wait on
   * `release` (FIX-2114: a dependency another request ends meanwhile).
   */
  holdAfterResolve: Record<string, { reached: () => void; release: Promise<void> }>;
  /** Workers whose turn waits for the user before it files (not on a notice), or `<worker>:<message>` for one turn. */
  waitForUserBeforeFiling: Set<string>;
  /** What each such wait came back with, by worker. */
  answered: Array<{ worker: string; answer: unknown }>;
};

const doorInput = z.object({ message: z.string() });

function splitterFlow(installation: WorkerInstallation, controls: SplitControls) {
  const board = defineSessionBoard({ installation, flowKind: "splitter" });
  const turn = handler({
    name: "splitter-turn",
    inputSchema: doorInput,
    outputSchema: z.unknown(),
    resources: { ...installation.resources, ...board.resources },
    execute: async (input, rawCtx) => {
      const ctx = rawCtx as unknown as BlockContext;
      const worker = String((ctx.session.state as Record<string, unknown>).workerId);
      controls.turns.push({ worker, sessionId: ctx.session.identity.id, message: input.message });
      const notice = input.message.startsWith('Task "');
      if (notice && controls.failNoticeTurn.has(worker)) throw new Error(`${worker}'s turn failed on the notice`);
      const pieces: Piece[] = [];
      if (!notice) pieces.push(...(controls.plans[worker] ?? []));
      if (notice && input.message.includes("failed for good") && controls.onErrored[worker] !== undefined) {
        pieces.push(controls.onErrored[worker]!);
        delete controls.onErrored[worker];
      }
      if (notice && input.message.includes(" completed by ") && controls.onCompleted[worker] !== undefined) {
        pieces.push(...[controls.onCompleted[worker]!].flat());
        delete controls.onCompleted[worker];
      }
      if (pieces.length === 0) return notice && Object.hasOwn(controls.noticeAnswer, worker) ? controls.noticeAnswer[worker] : `${worker} heard: ${input.message}`;
      const before = notice ? undefined : controls.holdBeforeFiling[worker];
      if (before !== undefined) await before;
      if (!notice && (controls.waitForUserBeforeFiling.has(worker) || controls.waitForUserBeforeFiling.has(`${worker}:${input.message}`))) {
        const answer = await (ctx as unknown as { waitForUser(options: unknown): Promise<unknown> }).waitForUser({ kind: "input", prompt: "Go ahead?" });
        controls.answered.push({ worker, answer });
      }
      const ref = await board.board.resolver(ctx as never);
      if (ref === undefined) {
        controls.refusals.push({ worker, error: "no_delegation_board" });
        return `${worker} has no board`;
      }
      const afterResolve = controls.holdAfterResolve[worker];
      if (afterResolve !== undefined) {
        delete controls.holdAfterResolve[worker];
        // Read the board, as a turn's tools do before they file: the snapshot this request keeps.
        ref.list();
        afterResolve.reached();
        await afterResolve.release;
      }
      const initOf = ({ goal, assignee, id, ...settings }: Piece) => ({ goal, ...(assignee ? { assignee } : {}), ...(id ? { id } : {}), ...settings });
      const refused = (error: unknown) =>
        controls.refusals.push({
          worker,
          error: error instanceof Error ? error.name : String(error),
          // A filing refused by its settings names the rule (FIX-2080).
          ...(error instanceof Error && error.name === "TaskFilingRefusedError" ? { message: error.message } : {})
        });
      if (controls.batch.has(worker)) {
        await ref.createTasks(pieces.map(initOf)).catch(refused);
      } else {
        for (const piece of pieces) await ref.createTask(initOf(piece)).catch(refused);
      }
      const hold = notice ? undefined : controls.holdAfterFiling[worker];
      if (hold !== undefined) await new Promise((resolve) => setTimeout(resolve, hold));
      if (!notice && controls.failAfterFiling.has(worker)) throw new Error(`${worker}'s turn failed after filing`);
      return `${worker} filed ${pieces.map((piece) => piece.goal).join(", ")}`;
    }
  });
  const resolveWorker = handler({
    name: "splitter-resolve-worker",
    inputSchema: z.unknown(),
    outputSchema: z.object({ worker: z.string() }),
    resources: { ...installation.resources },
    execute: async (_input, ctx) => ({ worker: (await installation.resolveWorker(ctx, "splitter")).id })
  });
  return defineFlow({
    kind: "splitter",
    configSchema: workerConfigSchema(),
    session: { ...installation.session(board.sessionStateShape), serverOwned: [...board.serverOwned] },
    resources: { ...installation.resources, ...board.resources },
    request: { onStarted: resolveWorker },
    actions: {
      respond: { inputSchema: doorInput.strict(), block: turn, userMessage: (input: { message: string }) => input.message },
      ...board.actions
    },
    internal: { actions: board.entries(turn) },
    task: { actions: { work: workerTaskEntry({ name: "splitter-task", turn }) } }
  } as never);
}

const worker = (id: string, declared: Record<string, unknown>): WorkerManifest => ({ id, declared, body: "", skills: [] });

/** The splitter workers: `planner` files tops for `s1`, which splits for `s2` and the taskers, and a chain `d1` to `d5`. */
export function splitWorkers(): WorkerManifest[] {
  return [
    ...boardWorkers(),
    worker("planner", { flow: "splitter", delegates: ["s1"] }),
    worker("planner.two", { flow: "splitter", delegates: ["s1"] }),
    worker("s1", { flow: "splitter", delegates: ["eng.tasker", "s2", "eng.writer"] }),
    worker("s2", { flow: "splitter", delegates: ["eng.tasker", "eng.writer"] }),
    worker("top", { flow: "splitter", delegates: ["d1"] }),
    worker("d1", { flow: "splitter", delegates: ["d2"] }),
    worker("d2", { flow: "splitter", delegates: ["d3"] }),
    worker("d3", { flow: "splitter", delegates: ["d4"] }),
    worker("d4", { flow: "splitter", delegates: ["d5"] }),
    worker("d5", { flow: "splitter", delegates: ["eng.tasker"] })
  ];
}

/** A board host with the splitter flow registered, and its controls. */
export function bootSplitHost(options: BoardHostOptions = {}) {
  const controls: SplitControls = {
    plans: {},
    failNoticeTurn: new Set(),
    onErrored: {},
    onCompleted: {},
    noticeAnswer: {},
    refusals: [],
    turns: [],
    failAfterFiling: new Set(),
    holdAfterFiling: {},
    batch: new Set(),
    holdBeforeFiling: {},
    holdAfterResolve: {},
    waitForUserBeforeFiling: new Set(),
    answered: []
  };
  const host = bootBoardHost({
    standard: splitWorkers(),
    flows: (installation) => ({ splitter: { flow: splitterFlow(installation, controls), roles: ["contributor", "manager"] } }),
    ...options
  });

  /** A splitter session of `workerId` for `userId`. */
  const open = async (userId: string, workerId: string): Promise<string> => {
    const created = await host.create(userId, "splitter", { state: { workerId } });
    if (created.status >= 300) throw new Error(`creating ${workerId}'s session failed (${created.status}): ${JSON.stringify(created.body)}`);
    return created.body.session!.id;
  };

  /** Run a turn of `sessionId` that files its worker's plan. */
  const turn = async (userId: string, sessionId: string, message = "file the plan") => {
    const result = await host.act(userId, sessionId, "respond", { message }, "splitter");
    if (result.error !== undefined) throw new Error(`the turn failed: ${messageOf(result.error)}`);
    return result.output as string;
  };

  /** A task-tool action on a splitter session. */
  const tool = async (userId: string, sessionId: string, name: string, input: Record<string, unknown>) => {
    const result = await host.act(userId, sessionId, `${name}_tasks`, input, "splitter");
    if (result.error !== undefined) throw new Error(`${name} failed: ${messageOf(result.error)}`);
    return result.output as { ok: boolean; error?: string; taskId?: string; tasks?: Array<{ id: string; status: string; goal: string }> };
  };

  /** The task session a task ran in: the session its row's run names. */
  const taskSessionOf = async (userId: string, taskId: string): Promise<string> => {
    const row = (await host.rows(userId)).find((candidate) => candidate.id === taskId);
    const sessionId = row?.run?.sessionId;
    if (sessionId === undefined) throw new Error(`task "${taskId}" has no run`);
    return sessionId;
  };

  /** The rows filed with `goal`, wherever they are. */
  const rowsNamed = async (userId: string, goal: string) => (await host.rows(userId)).filter((row) => row.goal === goal);

  /** The `onTaskSettled` requests a session ran, with what each noticed. */
  const noticesIn = async (sessionId: string) =>
    (await host.requestsOf(sessionId))
      .filter((request) => request.actionName === "onTaskSettled")
      .map((request) => (request as unknown as { input?: { taskId: string; ending: string } }).input);

  /** Every chain record `userId` holds, by key: read from the store. */
  const chains = async (userId: string) => {
    const runtime = await host.state.getRuntime();
    const entries = await runtime.stores.resourceState.getByPrefix("user", `${userId}:~org:${ORG}`, "workforce/task-chains/");
    return Object.fromEntries(Object.entries(entries).map(([key, value]) => [key, value.state as ChainRecord]));
  };

  /** Write a chain record as a crash would leave it. */
  const writeChain = async (userId: string, key: string, record: ChainRecord) => {
    const runtime = await host.state.getRuntime();
    await runtime.stores.resourceState.set("user", `${userId}:~org:${ORG}`, key, record as never, "any" as never);
  };

  /** Write a session's state as a crash would leave it. */
  const writeSessionState = async (sessionId: string, patch: Record<string, unknown>) => {
    const runtime = await host.state.getRuntime();
    const record = (await runtime.stores.session.get(sessionId))!;
    await runtime.stores.session.set(sessionId, { ...record, state: { ...(record.state as object), ...patch } } as never, "any" as never);
  };

  /** Poll `check` until it holds, for at most `ms`. */
  const until = async (check: () => Promise<boolean> | boolean, ms = 5000) => {
    for (const deadline = Date.now() + ms; Date.now() < deadline; ) {
      if (await check()) return true;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return check();
  };

  return Object.assign(host, {
    controls,
    open,
    turn,
    tool,
    taskSessionOf,
    rowsNamed,
    noticesIn,
    chains,
    writeChain,
    writeSessionState,
    until
  });
}

export type SplitHost = ReturnType<typeof bootSplitHost>;
