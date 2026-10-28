/**
 * A coding run's door: a person's line typed in the run's session (FIX-2086).
 *
 * The session's task is the board row whose run link names the session (the
 * task, or the latest of its follow-ups, which run there one at a time),
 * found from server state, never from the line (BP-031).
 *
 * | The task is | The line |
 * |---|---|
 * | open | a steer from the person, kept on the task: the coding run takes it at its next step, or the task gets one more turn before it settles |
 * | finished | talk: one harness run resumes the task's coding session with the line, outside any attempt, and its answer is a reply in the session. The task, its output and its attempts don't change |
 * | finished, its harness confirmed no coding session | refused, by name |
 * | not started in this session | refused, by name |
 *
 * A refusal fails the request, so a composer never reads it as delivered;
 * the line stays in the session with the refusal after it.
 *
 * The talk half is {@link harnessTalkTurn}, one block the door runs for a
 * finished task and a coder runs for a message about one (FIX-2160): there is
 * one talk path. A message never steers, so the turn refuses an open task.
 */
import { defineCapability, handler, sequencer, type DefinedCapability } from "@flow-state-dev/core";
import type { BlockContext, HarnessBlock } from "@flow-state-dev/core/types";
import {
  isTerminalStatus,
  LINE_STEER_REFUSALS,
  rowsInSession,
  steerFromLine,
  type LineSteerRefusal,
  type Task,
  type TaskCollectionRef,
} from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";
import { resolveOwnership, type HarnessSlot } from "./manager";
import { readRunRow, RUNS, runRecordCollection, runTopic } from "./run-record";
import { HARNESS_USAGE, harnessUsageCollection, recordHarnessUsage } from "./harness-usage";
import { acquireCheckout, releaseCheckout, runBoardSegment } from "./workspace";

/** What the door takes: the line. Shift Manager builds it without knowing the kind. */
export const sessionDoorInputSchema = z.object({ message: z.string() });

/** What the door did: steered the open task, or answered the line. */
export const sessionDoorOutputSchema = z.union([
  z.object({ steered: z.string() }),
  z.object({ reply: z.string().nullable(), taskId: z.string() }),
]);

/** What a talk turn takes: the text the coding session is resumed with. */
export const harnessTalkInputSchema = z.object({ message: z.string() });

/** What a talk turn answers: the coding session's reply, and the task it was about. */
export const harnessTalkOutputSchema = z.object({ reply: z.string().nullable(), taskId: z.string() });

/**
 * Why the door refused a line. The steer refusals (`steer-limit`, `finished`,
 * `not-supported`) read as they do on every door that takes a line.
 * `task-running` is a talk turn's alone: a message about a task still open,
 * which never steers it.
 */
export type SessionDoorRefusalReason = "not-started" | "cannot-continue" | "task-running" | LineSteerRefusal;

/** What a person reads for each refusal. */
const REFUSAL_TEXT: Record<SessionDoorRefusalReason, string> = {
  "not-started": "This task hasn't started here, so there's no session to write into.",
  "cannot-continue": "This run's harness confirmed no coding session, so it can't take a message once finished.",
  "task-running": "This task is still running, so a message can't reach its coding session until it finishes.",
  ...LINE_STEER_REFUSALS,
};

/** The door refused. The request fails with this, so nothing reads as delivered. */
export class SessionDoorRefused extends Error {
  constructor(readonly reason: SessionDoorRefusalReason) {
    super(REFUSAL_TEXT[reason]);
    this.name = "SessionDoorRefused";
  }
}

/** The board a session's run may be on, as the host resolves it per request. */
export interface SessionDoorBoard {
  /** The board's rows, as the managers that ran them read them. */
  readonly tasks: TaskCollectionRef;
  /** The issue and phase a row's run is keyed by, or `undefined` for a row no manager behind this door runs. */
  readonly runOf: (row: Task) => { issue: string; phase: string } | undefined;
}

/** How a host builds a talk turn: the door's options but the steer's. */
export interface HarnessTalkTurnOptions {
  /** Names the turn's blocks. Default `"harness-manager"`. */
  readonly name?: string;
  /**
   * The board the calling session's run is on, resolved per request from
   * server state (the session's own fields), never from the line.
   */
  readonly board: (ctx: BlockContext) => Promise<SessionDoorBoard | undefined>;
  /** The harness, as the managers behind the door are given it: talk resumes the coding session with it. */
  readonly harness: HarnessSlot;
  /** Capabilities the turn's blocks hold, for the board ledgers `board` resolves. */
  readonly uses?: readonly DefinedCapability[];
  /**
   * How long one talk run may take, in ms, which also sizes the hold on the
   * checkout it runs in. Default 10 minutes.
   */
  readonly talkTimeoutMs?: number;
}

/** How a host builds the door. */
export interface HarnessSessionDoorOptions extends HarnessTalkTurnOptions {
  /**
   * Called after a steer that left the task waiting on it (it was running
   * nothing): start the turn the steer is owed. A Workforce host passes
   * `startOwedSteerTurn`.
   */
  readonly onSteered?: (ctx: BlockContext, row: Task) => Promise<void>;
}

/** The newest of `rows`, by filing time, then attempts. */
function newest(rows: readonly Task[]): Task {
  return rows.reduce((last, task) =>
    task.createdAt > last.createdAt || (task.createdAt === last.createdAt && task.attempts > last.attempts) ? task : last,
  );
}

/**
 * The row a line in this session is about, in the chain of the task the
 * session ran (that task and its follow-ups, which run here one at a time),
 * as Workforce's door resolves it: the open row running here; else the
 * latest open one, a follow-up waiting to start; else, every one finished,
 * the latest that ran here, whose coding session talk resumes.
 */
function sessionRow(tasks: TaskCollectionRef, sessionId: string): Task | undefined {
  const rows = rowsInSession(tasks, sessionId);
  const linked = rows.filter((task) => task.run?.sessionId === sessionId);
  if (linked.length === 0) return undefined;
  const open = rows.filter((task) => !isTerminalStatus(task.status));
  const here = open.filter((task) => task.run?.sessionId === sessionId);
  return newest(here.length > 0 ? here : open.length > 0 ? open : linked);
}

/** The default bound on one talk run. */
const DEFAULT_TALK_TIMEOUT_MS = 10 * 60_000;

/** What the talk's first step hands on: the prompt the harness resumes the coding session with. */
const talkPromptSchema = z.object({ prompt: z.string() });

/** The talk's per-request values: where it runs and what it resumes. */
const talkStateSchema = z.object({
  cwd: z.string().nullable().default(null),
  resume: z.string().nullable().default(null),
  taskId: z.string().nullable().default(null),
  /** The hold on the checkout the talk runs in, released when it ends. */
  lockPath: z.string().nullable().default(null),
  leaseToken: z.string().nullable().default(null),
});

/**
 * The talk half of a coding run's door, as a block of its own (FIX-2160): one
 * harness run resumes the coding session of this session's finished task with
 * the message, outside any attempt, and its final text is the reply. The task,
 * its output and its attempts don't change. The door runs it for a person's
 * line; a coder's `onMessageReceived` runs it as its turn for a message.
 *
 * Refuses, failing the request, when the session has no task
 * (`not-started`), when its task is still open (`task-running`: a message
 * never steers), and when the run confirmed no coding session
 * (`cannot-continue`).
 *
 * @returns A block taking `{ message }` and answering `{ reply, taskId }`.
 */
export function harnessTalkTurn(options: HarnessTalkTurnOptions) {
  const name = options.name ?? "harness-manager";
  const capability = defineCapability({
    name: `harness-manager-talk:${name}`,
    // The usage record a talk's harness writes its windows into, as a run's does.
    resources: { [RUNS]: runRecordCollection, [HARNESS_USAGE]: harnessUsageCollection },
  }) as unknown as DefinedCapability;
  const uses = [capability, ...(options.uses ?? [])];
  const talkTimeoutMs = options.talkTimeoutMs ?? DEFAULT_TALK_TIMEOUT_MS;
  const { ownership } = resolveOwnership({ runTimeoutMs: talkTimeoutMs });
  const stateOf = (ctx: { sequencer?: { state?: unknown } }) => (ctx.sequencer?.state ?? {}) as z.infer<typeof talkStateSchema>;
  const releaseTalkLease = (ctx: { sequencer?: { state?: unknown } }) => {
    const state = stateOf(ctx);
    if (state.lockPath != null && state.leaseToken != null) releaseCheckout({ lockPath: state.lockPath, token: state.leaseToken });
  };

  // The talk's harness, fed from this turn's own state: the checkout the
  // finished run worked in and the session it confirmed. Outside any
  // attempt, so it records no session of its own.
  const talkHarness: HarnessBlock = options.harness({
    cwd: (ctx) => stateOf(ctx as never).cwd ?? "",
    resume: (ctx) => stateOf(ctx as never).resume,
    onSession: () => undefined,
    // A talk is one turn the person waits on: a line while it runs is its own talk.
    onSteerable: () => undefined,
    // The person talking is the principal, so the window lands in their row.
    onUsage: async (report, ctx) => {
      await recordHarnessUsage(ctx, report);
    },
  });

  const find = handler({
    name: `${name}-talk`,
    inputSchema: harnessTalkInputSchema,
    outputSchema: talkPromptSchema,
    sequencerStateSchema: talkStateSchema,
    uses,
    execute: async (input, ctx: BlockContext) => {
      const board = await options.board(ctx);
      const row = board === undefined ? undefined : sessionRow(board.tasks, ctx.session.identity.id);
      if (board === undefined || row === undefined) throw new SessionDoorRefused("not-started");
      if (!isTerminalStatus(row.status)) throw new SessionDoorRefused("task-running");
      const identity = board.runOf(row);
      const record =
        identity === undefined
          ? undefined
          : await readRunRow(ctx, runTopic(runBoardSegment(board.tasks.collectionId, board.tasks.partition), identity.issue, identity.phase));
      if (record?.sessionId == null || record.workspacePath == null) throw new SessionDoorRefused("cannot-continue");
      // The checkout is held for the talk, as for any run, so a follow-up
      // claimed meanwhile waits rather than resume the same session beside it.
      const lease = await acquireCheckout(record.workspacePath, `talk:${row.id}:${ctx.request.identity.id}`, ownership, Date.now, ctx.signal);
      await ctx.sequencer!.patchState({
        cwd: record.workspacePath,
        resume: record.sessionId,
        taskId: row.id,
        lockPath: lease.lockPath,
        leaseToken: lease.token,
      });
      return { prompt: input.message };
    },
  });

  const reply = handler({
    name: `${name}-talk-reply`,
    inputSchema: z.unknown(),
    outputSchema: harnessTalkOutputSchema,
    sequencerStateSchema: talkStateSchema,
    execute: async (value, ctx) => {
      releaseTalkLease(ctx as never);
      const handle = value as { finalMessage?: string | null };
      return { reply: handle.finalMessage ?? null, taskId: stateOf(ctx as never).taskId ?? "" };
    },
  });

  return sequencer({ name: `${name}-talk`, inputSchema: harnessTalkInputSchema, stateSchema: talkStateSchema })
    .step(find)
    .step(talkHarness, { abortSignal: () => AbortSignal.timeout(talkTimeoutMs) })
    .step(reply)
    .rescue([
      {
        block: handler({
          name: `${name}-talk-release`,
          inputSchema: z.unknown(),
          outputSchema: z.unknown(),
          sequencerStateSchema: talkStateSchema,
          execute: (error: unknown, ctx) => {
            releaseTalkLease(ctx as never);
            throw error;
          },
        }),
      },
    ]);
}

/** What the door's first step hands on: a steer done, or the line to talk with. */
const decidedSchema = z.union([z.object({ steered: z.string() }), z.object({ talk: z.string() })]);

/**
 * A coding run's door: declare it as the coding flow's action,
 * `actions: { message: harnessSessionDoor({ board, harness }) }`.
 *
 * @returns The action entry.
 */
export function harnessSessionDoor(options: HarnessSessionDoorOptions) {
  const name = options.name ?? "harness-manager";
  const talk = harnessTalkTurn(options);

  // An open task takes the line as a steer; a finished one hands it to the
  // talk turn, which reads the row again and refuses what changed meanwhile.
  const decide = handler({
    name: `${name}-session-door`,
    inputSchema: sessionDoorInputSchema,
    outputSchema: decidedSchema,
    uses: options.uses ?? [],
    execute: async (input, ctx: BlockContext) => {
      const board = await options.board(ctx);
      const row = board === undefined ? undefined : sessionRow(board.tasks, ctx.session.identity.id);
      if (board === undefined || row === undefined) throw new SessionDoorRefused("not-started");
      if (isTerminalStatus(row.status)) return { talk: input.message };
      const refused = await steerFromLine(board.tasks, row.id, input.message, ctx as never);
      if (refused !== undefined) throw new SessionDoorRefused(refused);
      const after = board.tasks.get(row.id);
      // A line that answered the task's last open question owes it its turn too (FIX-2133).
      if (after?.keptOpenBy === "steer" || after?.turnOwed === true) await options.onSteered?.(ctx, after);
      return { steered: row.id };
    },
  });

  const block = sequencer({ name: `${name}-session-door`, inputSchema: sessionDoorInputSchema })
    .step(decide)
    .stepIf(
      (decided: z.infer<typeof decidedSchema>) => "talk" in decided,
      (decided: z.infer<typeof decidedSchema>) => ({ message: (decided as { talk: string }).talk }),
      talk,
    )
    .step(
      handler({
        name: `${name}-session-door-reply`,
        inputSchema: z.unknown(),
        outputSchema: sessionDoorOutputSchema,
        execute: (value) => value as z.infer<typeof sessionDoorOutputSchema>,
      }),
    );

  return {
    block,
    inputSchema: sessionDoorInputSchema,
    userMessage: (input: { message: string }) => input.message,
    description:
      "Send a person's line into this coding run's session. While its task is open, the line steers it; " +
      "once the task has finished, the line is talk: the run's coding session answers it, and the task " +
      "doesn't change.",
  };
}
