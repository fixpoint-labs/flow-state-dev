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
 * | `in_progress`, its harness not yet named its session | keeps the turn and waits (bounded) for the attempt to start: it takes the line into its prompt, or names its session and the door goes on as for a running row |
 * | `parked` on its own question, or `pending` after an attempt | keeps the turn for the next attempt; stops nothing, unparks nothing |
 * | `parked` for an earlier turn | re-queues it (an interrupted earlier door) |
 * | not started in this session, finished, someone else's, or on a harness that named no session | refuses, by name |
 *
 * ## A run that is still starting
 *
 * Every attempt opens with no confirmed session: the run record clears it when
 * the attempt opens, and the harness names one only once the vendor answers,
 * after the prompt is built and the checkout taken. To a person the task reads
 * running that whole time, so a line sent then is held, not refused (FIX-1735).
 * The door keeps it for the attempt that is starting and waits, polling the
 * stored record, for whichever comes first: the attempt takes it into its
 * prompt (it acts on it now, nothing is stopped); the harness names its session
 * (the door stops and continues the run as for any running row); or the
 * attempt ends without naming one (refused as a harness that can't continue).
 * A harness still silent after {@link TURN_START_WAIT_MS} is refused as still
 * starting, so the request is never held open for a run's whole life.
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
import { findRunRowBySession, readConfirmedSession, readRunRow, runTopic } from "./run-record";
import { isRunOwner, runOwnerOf, runPrincipal } from "./run-owner";
import { keepTurn, turnTakenBy, withdrawTurn } from "./turns";
import { sleep } from "./workspace";

/** What the door takes. Shift Manager builds it without knowing the kind. */
export const messageDoorInputSchema = z.object({ message: z.string() });

/**
 * What the door did.
 *
 * - `continuing` — the run acts on the message now: the running attempt was
 *   stopped and the next one starts, resuming the same coding session with
 *   the message, or the attempt that was starting took it into its prompt.
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
  | "cannot-continue"
  | "still-starting";

/** What a person reads for each refusal. */
const REFUSAL_TEXT: Record<TurnRefusalReason, string> = {
  "no-run": "No such run.",
  "not-started": "This task hasn't started, so there's no session to write into.",
  "task-finished": "A finished task takes no message.",
  "finished-first": "The task finished before your message reached it.",
  "cannot-continue": "This run's harness can't continue with a message.",
  "still-starting": "This run is still starting and can't take a message yet. Send it again once it's under way.",
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

/**
 * How long the door holds a line for an attempt whose harness has not named its
 * session yet (FIX-1735). Covers a prompt build, a checkout and a vendor's
 * start several times over; past it the door refuses as still starting rather
 * than holding the person's request open for as long as the run takes.
 */
export const TURN_START_WAIT_MS = 60_000;

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
  // conversation that never saw the work. A running attempt with none yet is
  // still starting, and is waited for instead.
  const topic = runTopic(deps.boardCollectionId, issue, phase);
  const record = await readRunRow(ctx, topic);
  const starting = record?.sessionId == null;
  if (starting && row.status !== "in_progress") throw new TurnRefused("cannot-continue");

  // Durable first. A claimed row's run has not started, nor has an attempt
  // still starting, so that attempt takes the turn; otherwise the next one does.
  const turnKey = await keepTurn(ctx, {
    issue,
    phase,
    forAttempt: linked === undefined || starting ? row.attempts : row.attempts + 1,
    requestId: ctx.request.identity.id,
    message,
  });

  try {
    return starting
      ? await continueOnceStarted(deps, tasks, row, topic, turnKey, ctx)
      : await continueRun(deps, tasks, row, ctx);
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
 * The row as stored now. The board this request resolved is the snapshot it
 * read when it started, so a row the attempt settled since reads as running
 * there. A conditional update that returns what it finds and changes nothing
 * reads the committed row, and writes nothing.
 */
async function storedRow(
  ctx: BlockContext,
  collectionId: string,
  taskId: string,
): Promise<Record<string, unknown> | undefined> {
  const ref = await resolveResourceCollection(ctx, collectionId)?.getOptional(taskId);
  if (ref === undefined) return undefined;
  return updateStateWith<Record<string, unknown>, Record<string, unknown> | undefined>(ref, (current) => ({
    state: current,
    result: current,
  }));
}

/**
 * With the turn kept for an attempt whose harness has not named its session:
 * wait until that attempt takes the line, names its session, or ends. Every
 * read is of the stored record, since this request's own reads are the
 * snapshot it started with. See "A run that is still starting" above.
 */
async function continueOnceStarted(
  deps: MessageDoorDeps,
  tasks: TaskCollectionRef,
  row: Task,
  topic: string,
  turnKey: string,
  ctx: BlockContext,
): Promise<Decided> {
  const deadline = Date.now() + TURN_START_WAIT_MS;
  let pollMs = TURN_STOP_POLL_FIRST_MS;
  for (;;) {
    // The session first, then the turn: an attempt takes its turns before its
    // harness starts, so a session named by now means a turn not taken by now
    // was not taken by this attempt, and stopping it loses nothing.
    const session = await readConfirmedSession(ctx, topic);
    // The attempt took the line into its own prompt: it acts on it now.
    if ((await turnTakenBy(ctx, turnKey)) !== null) {
      return { outcome: "continuing", taskId: row.id, requeue: false, resumeIn: null };
    }
    if (session !== null) return continueRun(deps, tasks, row, ctx);

    const stored = await storedRow(ctx, deps.boardCollectionId, row.id);
    const status = stored?.status;
    if (typeof status === "string" && isTerminalStatus(status as Task["status"])) {
      throw new TurnRefused("finished-first");
    }
    if (status !== "in_progress" || stored?.attempts !== row.attempts) {
      // The attempt ended. If it named its session on the way out, the run
      // continues from it; if not, it had none to continue.
      if ((await readConfirmedSession(ctx, topic)) !== null) return continueRun(deps, tasks, row, ctx);
      throw new TurnRefused("cannot-continue");
    }
    if (ctx.signal.aborted || Date.now() >= deadline) throw new TurnRefused("still-starting");
    await sleep(pollMs, ctx.signal);
    pollMs = Math.min(pollMs * 2, TURN_STOP_POLL_MAX_MS);
  }
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
    const status = (await storedRow(ctx, deps.boardCollectionId, row.id))?.status;
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
