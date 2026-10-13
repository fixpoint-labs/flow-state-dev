/**
 * The door — a person's message into a coding run (FIX-1690).
 *
 * A public action a coding kind declares
 * (`message: manager.messageDoor({ drain: "resume" })` for a manager's fixed
 * board, or `message: harnessMessageDoor({ boards })` for a flow whose runs
 * come from more than one board: the host names, per request, the boards the
 * calling session's run may be on, each with its drain).
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
 * | finished (`completed`, `errored` or `cancelled`) | keeps the turn for the next attempt, reopens the row and drains: the next attempt resumes the same coding session with the line (FIX-1764) |
 * | not started in this session, someone else's, or on a harness that named no session | refuses, by name |
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
import { defineCapability, handler, sequencer, type DefinedCapability } from "@flow-state-dev/core";
import { readCommitted } from "@flow-state-dev/core/helpers";
import { dispatchThroughSeam, encodeUserSegment, markDispatcher, type BlockContext } from "@flow-state-dev/core/types";
import {
  isTerminalStatus,
  resolveResourceCollection,
  ticketForClaim,
  type DefinedTaskCollection,
  type Task,
  type TaskCollectionRef,
} from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";
import {
  findRunRowBySession,
  readConfirmedSession,
  readRunRow,
  RUNS,
  runRecordCollection,
  runTopic,
  sessionConfirmedBy,
} from "./run-record";
import { isRunOwner, runOwnerOf, runPrincipal } from "./run-owner";
import { keepTurn, turnCollection, turnTakenBy, TURNS, withdrawTurn } from "./turns";
import { runBoardSegment, sleep } from "./workspace";

/** What the door takes. Shift Manager builds it without knowing the kind. */
export const messageDoorInputSchema = z.object({ message: z.string() });

/**
 * What the door did.
 *
 * - `continuing` — the run acts on the message now: the running attempt was
 *   stopped and the next one starts, resuming the same coding session with
 *   the message, or the attempt that was starting took it into its prompt,
 *   or the finished task was reopened and its next attempt starts with it.
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
  "task-finished": "This task has finished, and its board can't reopen it.",
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

/**
 * Ask `check` until it answers, soon at first and then backing off (see
 * {@link TURN_STOP_POLL_FIRST_MS}). `undefined` once `waitMs` has passed, or
 * the request was aborted, with no answer.
 */
async function pollUntil<T>(
  waitMs: number,
  signal: AbortSignal,
  check: () => Promise<T | undefined>,
): Promise<T | undefined> {
  const deadline = Date.now() + waitMs;
  let pollMs = TURN_STOP_POLL_FIRST_MS;
  for (;;) {
    const answer = await check();
    if (answer !== undefined) return answer;
    if (signal.aborted || Date.now() >= deadline) return undefined;
    await sleep(pollMs, signal);
    pollMs = Math.min(pollMs * 2, TURN_STOP_POLL_MAX_MS);
  }
}

/** The note a row parked for a turn carries. */
const TURN_PARK_NOTE = "A person sent a message; the run continues with it.";

/** The payload a feature row carries. */
const rowPayloadSchema = z.object({ issue: z.string(), phase: z.string() });

/** A run's identity on its board: the issue and phase its run record is keyed by. */
export interface DoorRunIdentity {
  issue: string;
  phase: string;
}

/**
 * One board a door may find the calling session's run on, as the host resolves
 * it for this request.
 */
export interface MessageDoorBoard {
  /**
   * The board's rows as the substrate sees them. Its `collectionId` and
   * `partition` key the run records the door reads (`runBoardSegment`), the
   * same way the manager that ran the row keyed them.
   */
  tasks: TaskCollectionRef;
  /**
   * The board is kept per organization: the door then answers only the run's
   * own person, and refuses anyone else as a run that does not exist.
   */
  orgScoped: boolean;
  /**
   * Where the next attempt is started after a stop: the `internal` entry that
   * runs this board's drain, and the flow that declares it, dispatched into
   * the session that claimed the row.
   */
  drain: MessageDoorOptions;
  /**
   * The issue and phase a row's run is keyed by, or `undefined` for a row no
   * manager behind this door runs. Absent, the row's `{ issue, phase }`
   * payload, as on a feature board.
   */
  runOf?: (row: Task) => DoorRunIdentity | undefined;
  /**
   * The session that runs this board's drain, for a finished row: the row's
   * claim, which names it for a running one, is cleared when the row settles.
   * Absent, a finished row's line is refused (`task-finished`) rather than
   * reopened with nowhere to run.
   */
  reopenIn?: string;
}

/** What the door needs from the host or the manager that built it. */
export interface MessageDoorDeps {
  name: string;
  /** The collections the door reads and writes: the run records and the kept turns. */
  capability: DefinedCapability;
  /** More capabilities the door's blocks hold: the board ledgers, when the flow doesn't install them. */
  uses?: readonly DefinedCapability[];
  /**
   * The boards the calling session's run may be on, for this request. The door
   * takes the first whose run link names the session, else the first whose
   * run record does (a claimed row whose run hasn't linked yet).
   */
  boards: (ctx: BlockContext) => Promise<readonly MessageDoorBoard[]>;
  /**
   * The drain entry `defineFlow` checks the flow declares, when there is one
   * fixed drain. Absent, nothing is checked at build.
   */
  markDrain?: MessageDoorOptions;
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

/** The run-record segment a board's runs are keyed under. */
function segmentOf(board: MessageDoorBoard): string {
  return runBoardSegment(board.tasks.collectionId, board.tasks.partition);
}

/**
 * The row whose next attempt was claimed but whose run has not linked yet: a
 * claim clears the run link, so the row is found by the run record's session
 * instead. A listing of the user's run records, read only when no row links
 * this session.
 */
async function claimedRow(board: MessageDoorBoard, ctx: BlockContext): Promise<Task | undefined> {
  const record = await findRunRowBySession(ctx, segmentOf(board), ctx.session.identity.id);
  if (record?.taskId == null) return undefined;
  const row = (board.tasks.list() as Task[]).find((task) => task.id === record.taskId);
  return row?.status === "in_progress" && row.run === undefined ? row : undefined;
}

/** The board and row this session's run works, or `undefined` when no run has worked here. */
async function findRun(
  deps: MessageDoorDeps,
  ctx: BlockContext,
): Promise<{ board: MessageDoorBoard; row: Task; linked: boolean } | undefined> {
  const boards = await deps.boards(ctx);
  for (const board of boards) {
    const row = linkedRow(board.tasks, ctx.session.identity.id);
    if (row !== undefined) return { board, row, linked: true };
  }
  for (const board of boards) {
    const row = await claimedRow(board, ctx);
    if (row !== undefined) return { board, row, linked: false };
  }
  return undefined;
}

/** What the decide step hands the re-queue step. */
type Decided = MessageDoorOutput & {
  requeue: boolean;
  /** Set when the decide step already put a finished row back in the queue. */
  reopened?: true;
  /** The session that claimed the row, where its drain runs. */
  resumeIn: string | null;
  /** The board the row is on, so the re-queue resolves the same one. */
  collectionId: string | null;
  partition: string | null;
  /** The drain the re-queue dispatches. */
  drain: string | null;
  flowKind: string | null;
};

const decidedSchema = messageDoorOutputSchema.extend({
  requeue: z.boolean(),
  reopened: z.literal(true).optional(),
  resumeIn: z.string().nullable(),
  collectionId: z.string().nullable(),
  partition: z.string().nullable(),
  drain: z.string().nullable(),
  flowKind: z.string().nullable(),
});

/** A decision that re-queues nothing. */
function answered(outcome: MessageDoorOutput["outcome"], taskId: string): Decided {
  return { outcome, taskId, requeue: false, resumeIn: null, collectionId: null, partition: null, drain: null, flowKind: null };
}

/** Decide what a person's line does to the run, and do it. */
async function deliverTurn(deps: MessageDoorDeps, message: string, ctx: BlockContext): Promise<Decided> {
  const found = await findRun(deps, ctx);
  // No run has worked in this session: the task never started here (BR-14).
  if (found === undefined) throw new TurnRefused("not-started");
  const { board, row } = found;
  const linked = found.linked ? row : undefined;

  // The run's own person only, refused as a run that does not exist (BR-6).
  if (board.orgScoped) {
    const owner = runOwnerOf(row);
    if (owner !== null && !isRunOwner(owner, runPrincipal(ctx))) throw new TurnRefused("no-run");
  }
  if (isTerminalStatus(row.status) && board.reopenIn === undefined) throw new TurnRefused("task-finished");

  const identity = board.runOf === undefined ? payloadRun(row) : board.runOf(row);
  if (identity === undefined) throw new TurnRefused("no-run");
  const { issue, phase } = identity;

  // A run whose harness never confirmed a coding session has nothing to
  // continue: its next attempt would start fresh, and the line would reach a
  // conversation that never saw the work. A running attempt with none yet is
  // still starting, and is waited for instead.
  const topic = runTopic(segmentOf(board), issue, phase);
  const keep = (forAttempt: number) =>
    keepTurn(ctx, { issue, phase, forAttempt, requestId: ctx.request.identity.id, message });
  let turnKey: string;
  let starting: boolean;
  if (row.status === "in_progress") {
    // Durable first, then the record. The attempt takes its turns after it
    // opens the record and before its harness names a session, so a record
    // read after this keep that names no session for this attempt is an
    // attempt that will still take the turn, and one that names it has taken
    // its turns already and leaves this one to the next. Read first, the
    // attempt could open and take its turns between the read and the keep,
    // and a record this request first read absent stays absent to it.
    turnKey = await keep(row.attempts);
    // Decided once from this read; the wait re-reads the stored record
    // (`readConfirmedSession`), since the harness names its session from another request.
    const record = await readRunRow(ctx, topic);
    // A linked attempt is stopped once a session is named, so only a session
    // it named counts: one an earlier attempt left means it has not opened
    // yet, and will take the turn. A claimed row's run is not linked, so
    // nothing is stopped, and any confirmed session keeps the line for it.
    starting =
      linked === undefined
        ? record?.sessionId == null
        : sessionConfirmedBy(record, row.attempts) === null;
  } else {
    // Between attempts, or finished: the next attempt takes the turn.
    if ((await readRunRow(ctx, topic))?.sessionId == null) throw new TurnRefused("cannot-continue");
    starting = false;
    turnKey = await keep(row.attempts + 1);
  }

  try {
    if (isTerminalStatus(row.status)) return await reopenRun(board, row);
    return starting
      ? await continueOnceStarted(board, row, topic, turnKey, ctx)
      : await continueRun(board, row, ctx);
  } catch (error) {
    // Anything unexpected leaves the kept turn for the next attempt.
    if (!(error instanceof TurnRefused)) throw error;
    if ((await withdrawTurn(ctx, turnKey)) === "delivered") return answered("continuing", row.id);
    throw error;
  }
}

/** A feature row's run identity: its `{ issue, phase }` payload. */
function payloadRun(row: Task): DoorRunIdentity | undefined {
  const payload = rowPayloadSchema.safeParse(row.input);
  return payload.success ? payload.data : undefined;
}

/**
 * The row as stored now. The board this request resolved is the snapshot it
 * read when it started, so a row the attempt settled since reads as running
 * there. A conditional update that returns what it finds and changes nothing
 * reads the committed row, and writes nothing.
 *
 * A board kept per partition stores a row under its partition's segment
 * (orchestration's layout: `<partition segment>/<task id>`).
 */
async function storedRow(
  ctx: BlockContext,
  board: MessageDoorBoard,
  taskId: string,
): Promise<Record<string, unknown> | undefined> {
  const { collectionId, partition } = board.tasks;
  const key = partition === undefined ? taskId : `${encodeUserSegment(partition)}/${taskId}`;
  const ref = await resolveResourceCollection(ctx, collectionId)?.getOptional(key);
  if (ref === undefined) return undefined;
  return readCommitted<Record<string, unknown>, Record<string, unknown> | undefined>(ref, (current) => current);
}

/**
 * With the turn kept for an attempt whose harness has not named its session:
 * wait until that attempt takes the line, names its session, or ends. Every
 * read is of the stored record, since this request's own reads are the
 * snapshot it started with. See "A run that is still starting" above.
 */
async function continueOnceStarted(
  board: MessageDoorBoard,
  row: Task,
  topic: string,
  turnKey: string,
  ctx: BlockContext,
): Promise<Decided> {
  const decided = await pollUntil(TURN_START_WAIT_MS, ctx.signal, async (): Promise<Decided | undefined> => {
    // The session first, then the turn: an attempt takes its turns before its
    // harness starts, so a session named by now means a turn not taken by now
    // was not taken by this attempt, and stopping it loses nothing.
    const session = await readConfirmedSession(ctx, topic, row.attempts);
    // The attempt took the line into its own prompt: it acts on it now.
    if ((await turnTakenBy(ctx, turnKey)) !== null) return answered("continuing", row.id);
    if (session !== null) return continueRun(board, row, ctx);

    const stored = await storedRow(ctx, board, row.id);
    const status = stored?.status;
    if (typeof status === "string" && isTerminalStatus(status as Task["status"])) {
      throw new TurnRefused("finished-first");
    }
    if (status !== "in_progress" || stored?.attempts !== row.attempts) {
      // The attempt ended. If it named its session on the way out, the run
      // continues from it; if not, it had none to continue.
      if ((await readConfirmedSession(ctx, topic, row.attempts)) !== null) return continueRun(board, row, ctx);
      throw new TurnRefused("cannot-continue");
    }
    return undefined;
  });
  if (decided === undefined) throw new TurnRefused("still-starting");
  return decided;
}

/**
 * With the turn kept for the next attempt: put the finished row back in the
 * queue, for the requeue step to drain where the board says. A row that left
 * its finished status first (another line reopened it) keeps the turn for
 * whatever runs it next.
 */
async function reopenRun(board: MessageDoorBoard, row: Task): Promise<Decided> {
  const { tasks } = board;
  const reopened = await tasks.reopen(row.id);
  if (reopened.outcome !== "recorded") return answered("kept", row.id);
  return {
    outcome: "continuing",
    taskId: row.id,
    requeue: true,
    reopened: true,
    resumeIn: board.reopenIn ?? null,
    collectionId: tasks.collectionId,
    partition: tasks.partition ?? null,
    drain: board.drain.drain,
    flowKind: board.drain.flowKind ?? null,
  };
}

/** With the turn kept: stop the running attempt and park the row for it, or leave it kept. */
async function continueRun(board: MessageDoorBoard, row: Task, ctx: BlockContext): Promise<Decided> {
  const { tasks } = board;
  const kept = answered("kept", row.id);
  const continuing: Decided = {
    outcome: "continuing",
    taskId: row.id,
    requeue: true,
    resumeIn: row.claimedBy?.sessionId ?? null,
    collectionId: tasks.collectionId,
    partition: tasks.partition ?? null,
    drain: board.drain.drain,
    flowKind: board.drain.flowKind ?? null,
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
    const status = (await storedRow(ctx, board, row.id))?.status;
    if (typeof status === "string" && isTerminalStatus(status as Task["status"])) {
      throw new TurnRefused("finished-first");
    }
    return kept;
  }

  // Wait for the stopped attempt to finish, so nothing it does lands after the
  // park. Asking again is the read: once the request has ended the stop
  // answers `already-finished`, and until then it rewrites the same flag, so
  // a repeat is idempotent. `already-resolved` is an attempt resuming from a
  // gate an answer resolved first: still running, so the wait goes on and the
  // next ask stops it. An attempt that outlasts the wait is not parked: the
  // turn is kept, and the attempt after it gets the line.
  const ended = await pollUntil(TURN_STOP_WAIT_MS, ctx.signal, async () => {
    const outcome = await ctx.session.stopRequest(runRequest);
    return outcome === "stopped" || outcome === "already-resolved" ? undefined : true;
  });
  if (ended === undefined) return kept;

  // Park it for a turn, fenced to the attempt that was stopped. Refused when
  // that attempt settled the row first, or another claim holds it.
  const parked = await tasks.awaitReview(row.id, TURN_PARK_NOTE, {
    claim: ticketForClaim(tasks.collectionId, row, tasks.partition),
    forTurn: true,
  });
  if (parked.outcome !== "declined") return continuing;
  if (parked.status !== undefined && isTerminalStatus(parked.status)) {
    throw new TurnRefused("finished-first");
  }
  return kept;
}

/**
 * Put a parked row back in the queue without charging it, then drain in the
 * session that claimed it. A reopened row is queued already, and drains in
 * the session its board names. Any failure answers `kept`: the turn stays,
 * and whatever runs the row next gets the line.
 */
async function requeue(deps: MessageDoorDeps, decided: Decided, ctx: BlockContext): Promise<MessageDoorOutput> {
  const { outcome, taskId } = decided;
  if (!decided.requeue) return { outcome, taskId };
  const kept = { outcome: "kept" as const, taskId };
  try {
    // The board the decision was made on, resolved again for this step.
    const board = (await deps.boards(ctx)).find(
      (candidate) =>
        candidate.tasks.collectionId === decided.collectionId &&
        (candidate.tasks.partition ?? null) === decided.partition,
    );
    if (board === undefined) return kept;
    // A reopened row is in the queue already; a parked one is put there now.
    if (!decided.reopened) {
      const unparked = await board.tasks.unpark(taskId);
      // Someone re-queued it first; the turn is kept for what they started.
      if (unparked.outcome !== "recorded") return kept;
    }
    if (decided.resumeIn === null || decided.drain === null) return kept;
    const drained = await dispatchThroughSeam(ctx, {
      type: "internal",
      action: decided.drain,
      ...(decided.flowKind !== null ? { flowKind: decided.flowKind } : {}),
      session: { id: decided.resumeIn },
      payload: {},
      from: `${deps.name}-message-requeue`,
    });
    return drained.ok ? { outcome, taskId } : kept;
  } catch {
    return kept;
  }
}

function buildDoorSequencer(deps: MessageDoorDeps) {
  const decide = handler({
    name: `${deps.name}-message-door`,
    inputSchema: messageDoorInputSchema,
    outputSchema: decidedSchema,
    uses: [deps.capability, ...(deps.uses ?? [])],
    execute: async (input, ctx: BlockContext) => deliverTurn(deps, input.message, ctx),
  });

  const requeueStep = handler({
    name: `${deps.name}-message-requeue`,
    inputSchema: decidedSchema,
    outputSchema: messageDoorOutputSchema,
    uses: [deps.capability, ...(deps.uses ?? [])],
    execute: async (decided, ctx: BlockContext) => requeue(deps, decided, ctx),
  });
  // So `defineFlow` checks the flow declares the drain entry.
  if (deps.markDrain !== undefined) {
    markDispatcher(requeueStep, {
      type: "internal",
      action: deps.markDrain.drain,
      ...(deps.markDrain.flowKind !== undefined ? { flowKind: deps.markDrain.flowKind } : {}),
    });
  }

  return sequencer({
    name: `${deps.name}-message`,
    inputSchema: messageDoorInputSchema,
    outputSchema: messageDoorOutputSchema,
  })
    .step(decide)
    .step(requeueStep);
}

/** The action entry for a door over `deps`. */
function doorAction(deps: MessageDoorDeps): MessageDoorAction {
  return {
    block: buildDoorSequencer(deps),
    inputSchema: messageDoorInputSchema,
    userMessage: (input) => input.message,
    description:
      "Send a person's message into this coding run. A running attempt stops and the run " +
      "continues the same coding session with the message; otherwise the message waits for " +
      "the next attempt.",
  };
}

/** What a manager with a fixed board hands its door. */
export interface FixedBoardDoorDeps {
  name: string;
  boardCollection: DefinedTaskCollection;
  /** The manager's own collections, plus the turn record. */
  capability: DefinedCapability;
  /** Resolve the board's rows as the substrate sees them. */
  boardTasks: (ctx: BlockContext) => Promise<TaskCollectionRef>;
}

/**
 * Build the door for one manager's fixed board. `options.drain` names the
 * flow's `internal` entry that runs the board's drain.
 */
export function createMessageDoor(deps: FixedBoardDoorDeps) {
  return (options: MessageDoorOptions): MessageDoorAction =>
    doorAction({
      name: deps.name,
      capability: deps.capability,
      markDrain: options,
      boards: async (ctx) => [
        { tasks: await deps.boardTasks(ctx), orgScoped: deps.boardCollection.scope === "org", drain: options },
      ],
    });
}

/** How a host builds one door over every board its managers run rows from. */
export interface HarnessMessageDoorOptions {
  /** Names the door's blocks. Default `"harness-manager"`. */
  name?: string;
  /**
   * The boards the calling session's run may be on, resolved per request from
   * server state (the session's own fields, a resolver keyed by them), never
   * from the request's input (BP-031). Each names its drain and, for rows with
   * no `{ issue, phase }` payload, how its runs are keyed (`runOf`).
   */
  boards: (ctx: BlockContext) => Promise<readonly MessageDoorBoard[]>;
  /**
   * Capabilities the door's blocks hold, for the board ledgers `boards`
   * resolves when the flow doesn't install them itself.
   */
  uses?: readonly DefinedCapability[];
}

/**
 * A person's message into a coding run, for a flow whose runs come from more
 * than one board: a manager that reads its board from the claim, or several
 * managers on one flow. The same door a fixed-board manager's `messageDoor`
 * builds, with the host saying which boards the calling session's run may be
 * on. Every manager behind it must use the default run-record and turn
 * collections, which every `harnessManager` does.
 *
 * Declare it as the flow's action: `actions: { message: harnessMessageDoor({ boards }) }`.
 *
 * @param options The boards the calling session's run may be on, and the door's name.
 * @returns The action entry.
 */
export function harnessMessageDoor(options: HarnessMessageDoorOptions): MessageDoorAction {
  const name = options.name ?? "harness-manager";
  const capability = defineCapability({
    name: `harness-manager-door:${name}`,
    resources: { [RUNS]: runRecordCollection, [TURNS]: turnCollection },
  }) as unknown as DefinedCapability;
  return doorAction({ name, capability, boards: options.boards, ...(options.uses === undefined ? {} : { uses: options.uses }) });
}
