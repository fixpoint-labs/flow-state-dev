/**
 * The door — a person's message into a coding run (FIX-1690).
 *
 * A public action a coding kind declares (`message: manager.messageDoor(board)`).
 * It takes `{ message }` and declares `userMessage`, so the engine writes the
 * person's line into the session as a user item before this block runs. What
 * the block decides is what that line *does* to the run:
 *
 * | The run's row is | The door |
 * |---|---|
 * | `in_progress` | keeps the turn, stops the attempt, parks the row for a turn, re-queues it and drains — the next attempt resumes the same coding session with the line |
 * | `parked` on its own question, or `pending` after an attempt | keeps the turn for the next attempt; stops nothing, unparks nothing |
 * | `parked` for an earlier turn | re-queues it (an interrupted earlier door) |
 * | not started in this session, finished, someone else's, or on a harness that named no session | refuses, by name |
 *
 * ## It decides from server state only (BP-031)
 *
 * The task is the board row whose run link names the session this request
 * arrived in; the owner check reads the row's recorded run owner against the
 * request's principal; the session to resume is the one the harness confirmed
 * on the run record. Nothing in `{ message }` picks a run.
 *
 * ## The turn is kept before the stop
 *
 * So a crash between the two leaves a kept turn and a running attempt, never a
 * stopped attempt with nothing to continue with.
 *
 * ## Who parks the stopped attempt
 *
 * The door does, not the attempt. A stopped request ends `aborted` and its
 * chain's rescue does not run, so the attempt has no exit in which to park
 * itself; left alone, its row would sit `in_progress` until the lease lapsed
 * and come back as an abandonment. Instead the door waits (bounded) until the
 * stopped request reads finished, then parks the row for a turn with a claim
 * ticket minted from the attempt it stopped. The ticket fences the write: if
 * that attempt settled the row in the meantime, or another claim took it, the
 * park is refused and the door answers from what it found.
 *
 * ## A refusal is a failed request, never a returned value
 *
 * The composer shows *delivered* only when this request is `completed` and its
 * user item is in the session, so a refusal must not complete. It throws a
 * {@link TurnRefused} naming the reason; the line stays in the session with the
 * refusal after it.
 *
 * A refusal after the turn was kept withdraws it, so no later attempt acts on a
 * line the person was told didn't arrive. If an attempt already took it (a
 * second line whose door woke after the next attempt finished with it), the
 * door answers as delivered instead: refusing would tell the person a line
 * didn't reach the task that the task acted on.
 */
import { handler, sequencer, type DefinedCapability } from "@flow-state-dev/core";
import { updateStateWith } from "@flow-state-dev/core/helpers";
import type { BlockContext } from "@flow-state-dev/core/types";
import {
  isTerminalStatus,
  resolveResourceCollection,
  ticketForClaim,
  type DefinedTaskCollection,
  type Task,
  type TaskCollectionRef,
} from "@flow-state-dev/orchestration/tasks";
import type { TaskBoardHandle } from "@flow-state-dev/orchestration/task-board";
import { z } from "zod";
import { readRunRow, runTopic } from "./run-record";
import { isRunOwner, runOwnerOf, runPrincipal } from "./run-owner";
import { keepTurn, withdrawTurn } from "./turns";
import { sleep } from "./workspace";

/** What the door takes. App Lab builds it without knowing the kind. */
export const messageDoorInputSchema = z.object({ message: z.string() });

/**
 * What the door did.
 *
 * - `continuing` — the running attempt was stopped and the next one starts
 *   now, resuming the same coding session with the message.
 * - `kept` — nothing was running; the message waits for the next attempt.
 */
export const messageDoorOutputSchema = z.object({
  outcome: z.enum(["continuing", "kept"]),
  taskId: z.string(),
});

export type MessageDoorOutput = z.infer<typeof messageDoorOutputSchema>;

/** Why the door refused, in stable terms. */
export type TurnRefusalReason =
  | "no-run"
  | "not-started"
  | "task-finished"
  | "finished-first"
  | "cannot-continue"
  | "stop-timeout";

/** What a person reads for each refusal. */
const REFUSAL_TEXT: Record<TurnRefusalReason, string> = {
  "no-run": "No such run.",
  "not-started": "This task hasn't started, so there's no session to write into.",
  "task-finished": "A finished task takes no message.",
  "finished-first": "The task finished before your message reached it.",
  "cannot-continue": "This run's harness can't continue with a message.",
  "stop-timeout":
    "The run didn't stop in time to take your message. It is kept, and the run's next attempt will get it.",
};

/** The door refused. The request fails with this, so nothing reads *delivered*. */
export class TurnRefused extends Error {
  readonly code = "turn-refused";

  constructor(readonly reason: TurnRefusalReason) {
    super(REFUSAL_TEXT[reason]);
    this.name = "TurnRefused";
  }
}

/**
 * How long the door waits for a stopped attempt to finish before refusing.
 * Bounded so a harness that ignores its signal cannot hold the person's
 * request open; a request running in another process stops on its next
 * heartbeat, so this covers several.
 */
export const TURN_STOP_WAIT_MS = 60_000;
/**
 * How often the door asks whether the stopped attempt has finished: soon at
 * first (a run in this process stops at once), then backing off, so a run
 * stopping on another process's heartbeat isn't asked ten times a second.
 */
const TURN_STOP_POLL_FIRST_MS = 100;
const TURN_STOP_POLL_MAX_MS = 1_000;

/** The note a row parked for a turn carries. */
const TURN_PARK_NOTE = "A person sent a message; the run continues with it.";

/** The payload a row this manager runs carries. */
const rowPayloadSchema = z.object({ issue: z.string(), phase: z.string() });

/** What the door needs from the manager that built it. */
export interface MessageDoorDeps {
  name: string;
  boardCollectionId: string;
  boardCollection: DefinedTaskCollection;
  /** The manager's own collections, plus the turn record. */
  capability: DefinedCapability;
  /** Resolve the board's rows as the substrate sees them. */
  boardTasks: (ctx: BlockContext) => Promise<TaskCollectionRef>;
}

/** The board surface the door re-queues through. */
export type MessageDoorBoard = Pick<TaskBoardHandle, "unparkAndDrain">;

/** The action entry a kind declares. */
export interface MessageDoorAction {
  block: ReturnType<typeof buildDoorSequencer>;
  inputSchema: typeof messageDoorInputSchema;
  userMessage: (input: { message: string }) => string;
  description: string;
}

/**
 * The row this session's run works: the one whose run link names this
 * session. A session the per-task policy keyed holds one; a shared session can
 * hold several, and the running one (else the latest) is the one a person is
 * talking to.
 */
function linkedRow(tasks: TaskCollectionRef, sessionId: string): Task | undefined {
  const linked = tasks
    .list()
    .filter((task) => (task as Task).run?.sessionId === sessionId) as Task[];
  return (
    linked.find((task) => task.status === "in_progress") ??
    linked.sort((a, b) => b.attempts - a.attempts)[0]
  );
}

/** Decide what a person's line does to the run, and do it. */
async function deliverTurn(
  deps: MessageDoorDeps,
  message: string,
  ctx: BlockContext,
): Promise<MessageDoorOutput & { requeue: boolean }> {
  const tasks = await deps.boardTasks(ctx);
  const row = linkedRow(tasks, ctx.session.identity.id);
  // No run has worked in this session: the task never started here (BR-14).
  if (row === undefined) throw new TurnRefused("not-started");

  // The run's own person only, refused as a run that does not exist (BR-6).
  if (deps.boardCollection.scope === "org") {
    const owner = runOwnerOf(row);
    if (owner !== null && !isRunOwner(owner, runPrincipal(ctx))) throw new TurnRefused("no-run");
  }
  if (isTerminalStatus(row.status)) throw new TurnRefused("task-finished");

  const payload = rowPayloadSchema.safeParse(row.input);
  if (!payload.success) throw new TurnRefused("no-run");
  const { issue, phase } = payload.data;

  // A run whose harness never confirmed a coding session has nothing to
  // continue: its next attempt would start fresh, and the line would reach a
  // conversation that never saw the work.
  const record = await readRunRow(ctx, runTopic(deps.boardCollectionId, issue, phase));
  if (record?.sessionId == null) throw new TurnRefused("cannot-continue");

  // Durable first.
  const turnKey = await keepTurn(ctx, {
    issue,
    phase,
    forAttempt: row.attempts + 1,
    requestId: ctx.request.identity.id,
    message,
  });

  try {
    return await continueRun(deps, tasks, row, ctx);
  } catch (error) {
    // A stop that timed out keeps its turn by design (its text says so), and
    // anything unexpected leaves the kept turn for the next attempt.
    if (!(error instanceof TurnRefused) || error.reason === "stop-timeout") throw error;
    if ((await withdrawTurn(ctx, turnKey)) === "delivered") {
      return { outcome: "continuing", taskId: row.id, requeue: false };
    }
    throw error;
  }
}

/**
 * The row's status as stored now. The board this request resolved is the
 * snapshot it read when it started, so a row the attempt settled since reads
 * as running there. A conditional update that returns what it finds and
 * changes nothing reads the committed row, and writes nothing.
 */
async function storedStatus(ctx: BlockContext, collectionId: string, taskId: string): Promise<unknown> {
  const ref = await resolveResourceCollection(ctx, collectionId)?.getOptional(taskId);
  if (ref === undefined) return undefined;
  return updateStateWith<Record<string, unknown>, unknown>(ref, (current) => ({
    state: current,
    result: current?.status,
  }));
}

/** With the turn kept: stop the running attempt and park the row for it, or leave it kept. */
async function continueRun(
  deps: MessageDoorDeps,
  tasks: TaskCollectionRef,
  row: Task,
  ctx: BlockContext,
): Promise<MessageDoorOutput & { requeue: boolean }> {
  const kept = { outcome: "kept" as const, taskId: row.id, requeue: false };
  const continuing = { outcome: "continuing" as const, taskId: row.id, requeue: true };

  if (row.status === "parked") return row.parkedForTurn === true ? continuing : kept;
  if (row.status !== "in_progress" || row.run?.attempt !== row.attempts) return kept;

  const runRequest = row.run.requestId;
  const first = await ctx.session.stopRequest(runRequest);
  if (first === "not-in-this-session") throw new TurnRefused("no-run");
  // The attempt ended between the read and the stop (BR-11). If it settled
  // the row, the turn reached no one. Otherwise the kept turn stands and the
  // board decides what follows, which is also what an Interrupt gets (BR-17).
  if (first === "already-finished") {
    const status = await storedStatus(ctx, deps.boardCollectionId, row.id);
    if (typeof status === "string" && isTerminalStatus(status as Task["status"])) {
      throw new TurnRefused("finished-first");
    }
    return kept;
  }

  // Wait for the stopped attempt to finish, so nothing it does lands after the
  // park. Asking again is the read: once the request has ended the stop
  // answers `already-finished`, and until then it rewrites the same flag, so
  // a repeat is idempotent.
  const deadline = Date.now() + TURN_STOP_WAIT_MS;
  let pollMs = TURN_STOP_POLL_FIRST_MS;
  while ((await ctx.session.stopRequest(runRequest)) === "stopped") {
    if (ctx.signal.aborted) throw new TurnRefused("stop-timeout");
    if (Date.now() >= deadline) throw new TurnRefused("stop-timeout");
    await sleep(pollMs, ctx.signal);
    pollMs = Math.min(pollMs * 2, TURN_STOP_POLL_MAX_MS);
  }

  // Park it for a turn, fenced to the attempt that was stopped. Refused when
  // that attempt settled the row first, or another claim holds it.
  const parked = await tasks.awaitReview(row.id, TURN_PARK_NOTE, {
    claim: ticketForClaim(tasks.collectionId, row),
    forTurn: true,
  });
  if (parked.outcome !== "declined") return continuing;
  if (parked.status !== undefined && isTerminalStatus(parked.status)) {
    throw new TurnRefused("finished-first");
  }
  return kept;
}

function buildDoorSequencer(deps: MessageDoorDeps, board: MessageDoorBoard) {
  const decide = handler({
    name: `${deps.name}-message-door`,
    inputSchema: messageDoorInputSchema,
    outputSchema: messageDoorOutputSchema.extend({ requeue: z.boolean() }),
    uses: [deps.capability],
    execute: async (input, ctx: BlockContext) => deliverTurn(deps, input.message, ctx),
  });

  return sequencer({
    name: `${deps.name}-message`,
    inputSchema: messageDoorInputSchema,
    outputSchema: messageDoorOutputSchema,
  })
    .step(decide)
    // Re-queue without charging and run the board, so the next attempt
    // starts now. Only for a row parked for a turn: a kept turn waits for
    // whatever runs the row next.
    .tapIf(
      (decided: { requeue: boolean }) => decided.requeue,
      board.unparkAndDrain.connectInput((decided: { taskId: string }) => ({
        taskId: decided.taskId,
      })),
    )
    .map(({ outcome, taskId }) => ({ outcome, taskId }));
}

/**
 * Build the door for one manager. Called once per board the kind declares it
 * on; the board is what re-queues and drains the row.
 */
export function createMessageDoor(deps: MessageDoorDeps) {
  return (board: MessageDoorBoard): MessageDoorAction => ({
    block: buildDoorSequencer(deps, board),
    inputSchema: messageDoorInputSchema,
    userMessage: (input) => input.message,
    description:
      "Send a person's message into this coding run. A running attempt stops and the run " +
      "continues the same coding session with the message; otherwise the message waits for " +
      "the next attempt.",
  });
}
