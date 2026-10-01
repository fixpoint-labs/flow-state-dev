/**
 * The door — a person's message into a coding run (FIX-1690).
 *
 * A public action a coding kind declares
 * (`message: manager.messageDoor({ drain: "resume" })`).
 * It takes `{ message }` and declares `userMessage`, so the engine writes the
 * person's line into the session as a user item before this block runs. What
 * the block decides is what that line *does* to the run:
 *
 * | The run's row is | The door |
 * |---|---|
 * | `in_progress` | keeps the turn, stops the attempt, parks the row for a turn, re-queues it and drains — the next attempt resumes the same coding session with the line |
 * | `in_progress`, claimed but its run not linked yet | keeps the turn for the attempt the claim started |
 * | `parked` on its own question, or `pending` after an attempt | keeps the turn for the next attempt; stops nothing, unparks nothing |
 * | `parked` for an earlier turn | re-queues it (an interrupted earlier door) |
 * | not started in this session, finished, someone else's, or on a harness that named no session | refuses, by name |
 *
 * ## The drain runs where the row was claimed
 *
 * The door runs in the run's own session, and a board that hands a row off
 * derives the run's session from the session that drains it. Draining here
 * would put the next attempt in a session beneath this one, and every message
 * would move the run one level deeper. So the door re-queues the row and
 * dispatches the board's drain into the session that claimed it (the row's
 * `claimedBy`), as an `internal` entry the flow declares: the next attempt
 * lands in this same session, as a coordinator's own retry would.
 *
 * ## Kept is never reported as not delivered
 *
 * Once the turn is kept and the attempt stopped, the run will act on the line.
 * If the re-queue or the drain fails after that, or the stop does not finish
 * in time, the door answers `kept`: the line waits for whatever runs the row
 * next. Failing the request would tell the person to send it again.
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
import { dispatchThroughSeam, markDispatcher, type BlockContext } from "@flow-state-dev/core/types";
import {
  isTerminalStatus,
  resolveResourceCollection,
  ticketForClaim,
  type DefinedTaskCollection,
  type Task,
  type TaskCollectionRef,
} from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";
import { findRunRowBySession, readRunRow, runTopic } from "./run-record";
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
 * - `kept` — the message waits for the run's next attempt: nothing was
 *   running, or the run could not be re-queued now.
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
  | "cannot-continue";

/** What a person reads for each refusal. */
const REFUSAL_TEXT: Record<TurnRefusalReason, string> = {
  "no-run": "No such run.",
  "not-started": "This task hasn't started, so there's no session to write into.",
  "task-finished": "A finished task takes no message.",
  "finished-first": "The task finished before your message reached it.",
  "cannot-continue": "This run's harness can't continue with a message.",
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
 * How long the door waits for a stopped attempt to finish before answering
 * `kept`.
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

/** How a flow wires the door. */
export interface MessageDoorOptions {
  /**
   * The flow's `internal` entry that runs the board's drain
   * (`internal: { actions: { resume: { block: board.drain } } }`). The door
   * dispatches it into the session that claimed the row.
   */
  drain: string;
  /**
   * The flow instance that declares `drain`, when the board is drained from
   * another flow than this one: the flow whose drain hands rows to this one
   * across flows. Its sessions are the ones that claim the rows. Absent is
   * this flow.
   */
  flowKind?: string;
}

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

/**
 * The row whose next attempt was claimed but whose run has not linked yet: a
 * claim clears the run link, so the row is found by the run record's session
 * instead. A listing of the user's run records, read only when no row links
 * this session.
 */
async function claimedRow(
  deps: MessageDoorDeps,
  tasks: TaskCollectionRef,
  ctx: BlockContext,
): Promise<Task | undefined> {
  const record = await findRunRowBySession(ctx, deps.boardCollectionId, ctx.session.identity.id);
  if (record?.taskId == null) return undefined;
  const row = (tasks.list() as Task[]).find((task) => task.id === record.taskId);
  return row?.status === "in_progress" && row.run === undefined ? row : undefined;
}

/** What the decide step hands the re-queue step. */
type Decided = MessageDoorOutput & {
  requeue: boolean;
  /** The session that claimed the row, where its drain runs. */
  resumeIn: string | null;
};

/** Decide what a person's line does to the run, and do it. */
async function deliverTurn(deps: MessageDoorDeps, message: string, ctx: BlockContext): Promise<Decided> {
  const tasks = await deps.boardTasks(ctx);
  const linked = linkedRow(tasks, ctx.session.identity.id);
  const row = linked ?? (await claimedRow(deps, tasks, ctx));
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

  // Durable first. A claimed row's run has not started, so its claimed
  // attempt takes the turn; otherwise the next one does.
  const turnKey = await keepTurn(ctx, {
    issue,
    phase,
    forAttempt: linked === undefined ? row.attempts : row.attempts + 1,
    requestId: ctx.request.identity.id,
    message,
  });

  try {
    return await continueRun(deps, tasks, row, ctx);
  } catch (error) {
    // Anything unexpected leaves the kept turn for the next attempt.
    if (!(error instanceof TurnRefused)) throw error;
    if ((await withdrawTurn(ctx, turnKey)) === "delivered") {
      return { outcome: "continuing", taskId: row.id, requeue: false, resumeIn: null };
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
): Promise<Decided> {
  const kept = { outcome: "kept" as const, taskId: row.id, requeue: false, resumeIn: null };
  const continuing = {
    outcome: "continuing" as const,
    taskId: row.id,
    requeue: true,
    resumeIn: row.claimedBy?.sessionId ?? null,
  };

  if (row.status === "parked") return row.parkedForTurn === true ? continuing : kept;
  // Claimed, with its run not linked yet: that attempt takes the turn.
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
  // a repeat is idempotent. An attempt that outlasts the wait is not parked:
  // the turn is kept, and the attempt after it gets the line.
  const deadline = Date.now() + TURN_STOP_WAIT_MS;
  let pollMs = TURN_STOP_POLL_FIRST_MS;
  while ((await ctx.session.stopRequest(runRequest)) === "stopped") {
    if (ctx.signal.aborted || Date.now() >= deadline) return kept;
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

/**
 * Re-queue a row parked for a turn without charging it, and run the board's
 * drain in the session that claimed it, so the next attempt starts now in the
 * run's own session. Any failure here answers `kept`: the turn is kept and the
 * attempt stopped, so the run gets the line from whatever runs the row next.
 */
async function requeue(
  deps: MessageDoorDeps,
  options: MessageDoorOptions,
  decided: Decided,
  ctx: BlockContext,
): Promise<MessageDoorOutput> {
  const { outcome, taskId } = decided;
  if (!decided.requeue) return { outcome, taskId };
  const kept = { outcome: "kept" as const, taskId };
  try {
    const unparked = await (await deps.boardTasks(ctx)).unpark(taskId);
    // Someone re-queued it first; the turn is kept for what they started.
    if (unparked.outcome !== "recorded") return kept;
    if (decided.resumeIn === null) return kept;
    const drained = await dispatchThroughSeam(ctx, {
      type: "internal",
      action: options.drain,
      ...(options.flowKind !== undefined ? { flowKind: options.flowKind } : {}),
      session: { id: decided.resumeIn },
      payload: {},
      from: `${deps.name}-message-requeue`,
    });
    return drained.ok ? { outcome, taskId } : kept;
  } catch {
    return kept;
  }
}

function buildDoorSequencer(deps: MessageDoorDeps, options: MessageDoorOptions) {
  const decide = handler({
    name: `${deps.name}-message-door`,
    inputSchema: messageDoorInputSchema,
    outputSchema: messageDoorOutputSchema.extend({
      requeue: z.boolean(),
      resumeIn: z.string().nullable(),
    }),
    uses: [deps.capability],
    execute: async (input, ctx: BlockContext) => deliverTurn(deps, input.message, ctx),
  });

  const requeueStep = handler({
    name: `${deps.name}-message-requeue`,
    inputSchema: messageDoorOutputSchema.extend({
      requeue: z.boolean(),
      resumeIn: z.string().nullable(),
    }),
    outputSchema: messageDoorOutputSchema,
    uses: [deps.capability],
    execute: async (decided, ctx: BlockContext) => requeue(deps, options, decided, ctx),
  });
  // So `defineFlow` checks the flow declares the drain entry.
  markDispatcher(requeueStep, {
    type: "internal",
    action: options.drain,
    ...(options.flowKind !== undefined ? { flowKind: options.flowKind } : {}),
  });

  return sequencer({
    name: `${deps.name}-message`,
    inputSchema: messageDoorInputSchema,
    outputSchema: messageDoorOutputSchema,
  })
    .step(decide)
    .step(requeueStep);
}

/**
 * Build the door for one manager. `options.drain` names the flow's `internal`
 * entry that runs the board's drain.
 */
export function createMessageDoor(deps: MessageDoorDeps) {
  return (options: MessageDoorOptions): MessageDoorAction => ({
    block: buildDoorSequencer(deps, options),
    inputSchema: messageDoorInputSchema,
    userMessage: (input) => input.message,
    description:
      "Send a person's message into this coding run. A running attempt stops and the run " +
      "continues the same coding session with the message; otherwise the message waits for " +
      "the next attempt.",
  });
}
