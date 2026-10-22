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
 */
import { defineCapability, handler, sequencer, type DefinedCapability } from "@flow-state-dev/core";
import type { BlockContext, HarnessBlock } from "@flow-state-dev/core/types";
import { isTerminalStatus, type Task, type TaskCollectionRef } from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";
import type { HarnessSlot } from "./manager";
import { readRunRow, RUNS, runRecordCollection, runTopic } from "./run-record";
import { runBoardSegment } from "./workspace";

/** What the door takes: the line. Shift Manager builds it without knowing the kind. */
export const sessionDoorInputSchema = z.object({ message: z.string() });

/** What the door did: steered the open task, or answered the line. */
export const sessionDoorOutputSchema = z.union([
  z.object({ steered: z.string() }),
  z.object({ reply: z.string().nullable(), taskId: z.string() }),
]);

/** Why the door refused, in stable terms. */
export type SessionDoorRefusalReason = "not-started" | "cannot-continue" | "steer-refused";

/** What a person reads for each refusal. */
const REFUSAL_TEXT: Record<SessionDoorRefusalReason, string> = {
  "not-started": "This task hasn't started here, so there's no session to write into.",
  "cannot-continue": "This run's harness confirmed no coding session, so it can't take a message once finished.",
  "steer-refused": "This task can't take your message now. Cancel it and file it again, or file a follow-up once it ends.",
};

/** The door refused. The request fails with this, so nothing reads as delivered. */
export class SessionDoorRefused extends Error {
  readonly code = "session-door-refused";

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

/** How a host builds the door. */
export interface HarnessSessionDoorOptions {
  /** Names the door's blocks. Default `"harness-manager"`. */
  readonly name?: string;
  /**
   * The board the calling session's run is on, resolved per request from
   * server state (the session's own fields), never from the line.
   */
  readonly board: (ctx: BlockContext) => Promise<SessionDoorBoard | undefined>;
  /** The harness, as the managers behind the door are given it: talk resumes the coding session with it. */
  readonly harness: HarnessSlot;
  /**
   * Called after a steer that left the task waiting on it (it was running
   * nothing): start the turn the steer is owed. A Workforce host passes
   * `startOwedSteerTurn`.
   */
  readonly onSteered?: (ctx: BlockContext, row: Task) => Promise<void>;
  /** Capabilities the door's blocks hold, for the board ledgers `board` resolves. */
  readonly uses?: readonly DefinedCapability[];
}

/** The row this session's run works: the running one its run link names, else the latest. */
function sessionRow(tasks: TaskCollectionRef, sessionId: string): Task | undefined {
  const linked = tasks.list().filter((task) => (task as Task).run?.sessionId === sessionId) as Task[];
  return (
    linked.find((task) => !isTerminalStatus(task.status)) ??
    linked.sort((a, b) => b.createdAt - a.createdAt || b.attempts - a.attempts)[0]
  );
}

/** What the decide step hands on: a steer done, or the talk to run. */
const decidedSchema = z.union([
  z.object({ steered: z.string() }),
  z.object({ talk: z.object({ prompt: z.string(), cwd: z.string(), resume: z.string(), taskId: z.string() }) }),
]);

/** The door's per-request values: where the talk runs and what it resumes. */
const doorStateSchema = z.object({
  cwd: z.string().nullable().default(null),
  resume: z.string().nullable().default(null),
  taskId: z.string().nullable().default(null),
});

/**
 * A coding run's door: declare it as the coding flow's action,
 * `actions: { message: harnessSessionDoor({ board, harness }) }`.
 *
 * @returns The action entry.
 */
export function harnessSessionDoor(options: HarnessSessionDoorOptions) {
  const name = options.name ?? "harness-manager";
  const capability = defineCapability({
    name: `harness-manager-session-door:${name}`,
    resources: { [RUNS]: runRecordCollection },
  }) as unknown as DefinedCapability;
  const uses = [capability, ...(options.uses ?? [])];

  // The talk's harness, fed from this door's own state: the checkout the
  // finished run worked in and the session it confirmed. Outside any
  // attempt, so it records no session of its own.
  const stateOf = (ctx: { sequencer?: { state?: unknown } }) => (ctx.sequencer?.state ?? {}) as z.infer<typeof doorStateSchema>;
  const talkHarness: HarnessBlock = options.harness({
    cwd: (ctx) => stateOf(ctx as never).cwd ?? "",
    resume: (ctx) => stateOf(ctx as never).resume,
    onSession: () => undefined,
  });

  const decide = handler({
    name: `${name}-session-door`,
    inputSchema: sessionDoorInputSchema,
    outputSchema: decidedSchema,
    sequencerStateSchema: doorStateSchema,
    uses,
    execute: async (input, ctx: BlockContext) => {
      const board = await options.board(ctx);
      const row = board === undefined ? undefined : sessionRow(board.tasks, ctx.session.identity.id);
      if (board === undefined || row === undefined) throw new SessionDoorRefused("not-started");
      if (!isTerminalStatus(row.status)) {
        const userId = (ctx as { user?: { identity?: { userId?: string } } }).user?.identity?.userId;
        const outcome = await board.tasks.steer?.(row.id, {
          message: input.message,
          from: "user",
          ...(userId !== undefined ? { by: userId } : {}),
          key: `line:${ctx.request.identity.id}`,
        });
        if (outcome === undefined || outcome.outcome === "declined") throw new SessionDoorRefused("steer-refused");
        const after = board.tasks.get(row.id);
        if (after?.waitingOn === "steer") await options.onSteered?.(ctx, after);
        return { steered: row.id };
      }
      // Finished: talk, resuming the coding session its run confirmed.
      const identity = board.runOf(row);
      const record =
        identity === undefined
          ? undefined
          : await readRunRow(ctx, runTopic(runBoardSegment(board.tasks.collectionId, board.tasks.partition), identity.issue, identity.phase));
      if (record?.sessionId == null || record.workspacePath == null) throw new SessionDoorRefused("cannot-continue");
      await ctx.sequencer!.patchState({ cwd: record.workspacePath, resume: record.sessionId, taskId: row.id });
      return { talk: { prompt: input.message, cwd: record.workspacePath, resume: record.sessionId, taskId: row.id } };
    },
  });

  const reply = handler({
    name: `${name}-session-door-reply`,
    inputSchema: z.unknown(),
    outputSchema: sessionDoorOutputSchema,
    sequencerStateSchema: doorStateSchema,
    execute: async (value, ctx) => {
      const handle = value as { finalMessage?: string | null; steered?: string };
      if (typeof handle.steered === "string") return { steered: handle.steered };
      return { reply: handle.finalMessage ?? null, taskId: stateOf(ctx as never).taskId ?? "" };
    },
  });

  const block = sequencer({ name: `${name}-session-door`, inputSchema: sessionDoorInputSchema, stateSchema: doorStateSchema })
    .step(decide)
    .stepIf(
      (decided: z.infer<typeof decidedSchema>) => "talk" in decided,
      (decided: z.infer<typeof decidedSchema>) => ({ prompt: (decided as { talk: { prompt: string } }).talk.prompt }),
      talkHarness,
    )
    .step(reply);

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
