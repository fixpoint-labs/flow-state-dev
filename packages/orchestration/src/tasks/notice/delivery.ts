/**
 * The one delivery of a delegated row's ending (FIX-2078, the convergence
 * point): run by every writer of such an ending, whoever it is (the claim
 * gate in a task session, a refused hand-over, the settle of a row whose
 * worker died too often, a cancel), because every ending passes through a
 * backing's transition and the backing runs it there.
 *
 * Around the ending's write:
 *
 * 1. **Before**, the wake (`RequestHost.wakes`): a debt's due time in the
 *    filer's session, naming the board's pass entry. Written first, so a crash
 *    between the two leaves a wake that pays nothing, never a debt with none.
 * 2. **The write** marks what is owed (`./task-notice`'s `recordEnding`, and
 *    `Task.resumeOwed` for a waited-on row).
 * 3. **After**, the fast path: the notice goes to the filer's notice entry at
 *    once, naming the dependents the ending cancelled; a waited-on row's
 *    ending, or a retry, runs the filer's pass, which resumes the turn or
 *    starts the next attempt. A send that fails or can't be addressed from
 *    here leaves the debt to the wake. Only the filer's delivery clears it.
 *
 * A filer whose session is gone can never be told: its notice is settled
 * undeliverable, recorded on the row, and handed to the board's
 * `onUndeliverable`. Nothing here fails the write that already committed.
 */
import { dispatchThroughSeam, onRequestEnded, REQUEST_END_SEAM } from "@flow-state-dev/core/types";
import type { BlockContext, DispatchOutcome, SessionTarget } from "@flow-state-dev/core/types";
import type { Task } from "../schema/task";
import type { RowQuestion } from "../schema/hold";
import { openRowQuestions } from "../collection/holds";
import { clearNotice, NOTICE_DUE_MS, owedNotices, UNDELIVERABLE_PREFIX, type TaskNotice } from "./task-notice";

/** The internal entry a notice arrives on in the filer's session, unless a board names another. Pinned. */
export const TASK_SETTLED_ENTRY = "onTaskSettled";

/** Where a notice goes from the running request: a session target, and its flow when not the sender's own. */
export interface NoticeAddress {
  readonly session: SessionTarget;
  readonly flowKind?: string;
}

/**
 * How a board that hands rows out delivers its endings (FIX-2078), declared on
 * its ledger (`defineTaskCollection({ delivery })`). A board built with a task
 * dispatcher marks its ledger with the defaults ({@link markDelegating}).
 */
export interface DeclaredDelivery {
  /**
   * The internal entry a wake runs in the filer's session: the board's pass,
   * which pays what is owed and clears the wake. Default
   * {@link TASK_SETTLED_ENTRY}, which pays on an empty input.
   */
  readonly passEntry?: string;
  /** The entry a row's notice arrives on. Default {@link TASK_SETTLED_ENTRY}. */
  readonly noticeEntry?: (row: Task) => string;
  /**
   * How the running request reaches the filer's session, or `undefined` when
   * it can't (the wake delivers instead). Default: the filer's session by id,
   * on the running flow.
   */
  readonly address?: (ctx: BlockContext, filerSessionId: string) => NoticeAddress | undefined;
  /** The filer of a row filed before `Task.filer` (BP-030), from its partition. */
  readonly legacyFiler?: (row: Task, partition: string | undefined) => string | undefined;
  /** A notice settled undeliverable: its filer's session is gone. */
  readonly onUndeliverable?: (ctx: BlockContext, row: Task, notice: TaskNotice, detail: string) => Promise<void>;
  /**
   * A task on this ledger asked its filer's questions midway (FIX-2241): told
   * with the row's open midway questions, read from the committed row, from
   * the asking request. Not the notice pipeline: no marker, no wake, no
   * `noticeEntry`. The same declaration, a different moment. Called again
   * when a replayed turn asks again, so it must be idempotent per hold (a
   * Workforce board sends one message per hold, its id derived from the
   * hold). Called only for a row whose filer is known. Runs inline in the
   * asking turn, after its lease is dropped, so a slow telling only delays
   * that turn's end. A throw is logged, never fails the question.
   */
  readonly onMidwayQuestion?: (ctx: BlockContext, row: Task, questions: readonly RowQuestion[]) => Promise<void>;
  /**
   * `false`: an ending owes its filer no notice, only the resume of a request
   * parked on it (FIX-2082). A plan board's ledger: its drain waits on every
   * row, so nobody else is told how one ended. Default: every ending owes one.
   */
  readonly notices?: false;
}

/** The record of a notice settled undeliverable: when, and why. */
export function undeliverableRecord(notice: Pick<TaskNotice, "attempt" | "ending">, detail: string, at: number): Record<string, unknown> {
  return { [`${UNDELIVERABLE_PREFIX}${notice.attempt}:${notice.ending}`]: { at, detail } };
}

/**
 * Who filed a row on a ledger with `declared` delivery: `Task.filer`, or for a
 * row filed before it, the ledger's legacy filer at `partition` (BP-030). The
 * one rule a cascade's notice suppression and a notice's naming both use.
 */
export function filerResolver(declared: DeclaredDelivery, partition: string | undefined): (row: Task) => string | undefined {
  return (row) => row.filer?.sessionId ?? declared.legacyFiler?.(row, partition);
}

/** What a backing runs around an ending's write, bound to the running request. */
export interface DeliveryHooks {
  /**
   * Tell the filer of `row` its open midway questions, through the ledger's
   * {@link DeclaredDelivery.onMidwayQuestion}. Absent when the ledger declares none.
   */
  tellMidwayQuestions?(row: Task): Promise<void>;
  /** `false` when an ending owes no notice, only a parked wait's resume ({@link DeclaredDelivery.notices}). */
  readonly notices?: false;
  /** The session that filed `row`, or `undefined` when none is known. */
  filerOf(row: Task): string | undefined;
  /** Before a write that may end `row`: owe the wake. */
  beforeEnding(row: Task): Promise<void>;
  /**
   * Owe the filer's pass at `dueAt` for `row`: a claim's lease end. Always
   * written, in the filer's own session too: a claim made by another request
   * between a pass's read of the wake and its settle must bump the version, or
   * that settle would drop the lease end. A claim by the pass's own drain makes
   * that pass settle stale, which costs one more pass, not a debt.
   */
  owePassAt(row: Task, dueAt: number): Promise<void>;
  /** After the write: deliver what `row` owes now, at once. */
  afterEnding(
    row: Task,
    rows: readonly Task[],
    patchMetadata: (id: string, patch: Record<string, unknown>) => Promise<void>
  ): Promise<void>;
  /**
   * Run `send` once the running request has ended (FIX-2123), on the
   * engine's request-end seam. `send` doesn't run when it parks: a parked
   * request holds no notice and no ending, so the filer's pass is owed one
   * wake shortly after (FIX-2149) and sends what the request held, past its
   * backoff, and releases the wait slots it lapsed (FIX-2170). No
   * row is read or written there: a hook at a park delays the request's park
   * record. A failure is logged, never
   * thrown; what `send` didn't send stays owed for the filer's pass. Nothing
   * runs on a context with no seam, or on a host that doesn't record which
   * requests are running. Optional, so hooks built by hand keep compiling:
   * without it, the pass sends instead.
   */
  whenRequestEnds?(send: () => Promise<void>): void;
}

/**
 * The boards a request has asked to send at its stop (FIX-2123), keyed by
 * its request-end seam, which every resolution in the request shares and a
 * resume replaces. Weak, so a request's entry goes with it.
 */
const sendsAtStop = new WeakMap<object, Set<string>>();

/** The refusal that says the filer's session is gone: it can never be told. */
const FILER_GONE = "session-not-found";

/**
 * Bind a ledger's delivery to the running request.
 *
 * @param board The ledger's id and the partition this resolution reads.
 */
export function createDelivery(
  ctx: BlockContext,
  declared: DeclaredDelivery,
  board: { readonly collectionId: string; readonly partition?: string }
): DeliveryHooks {
  const passEntry = declared.passEntry ?? TASK_SETTLED_ENTRY;
  const filerOf = filerResolver(declared, board.partition);
  const addressOf = (filer: string): NoticeAddress | undefined =>
    declared.address !== undefined ? declared.address(ctx, filer) : { session: { id: filer } };

  const send = async (address: NoticeAddress, action: string, payload: unknown): Promise<DispatchOutcome | undefined> => {
    try {
      return await dispatchThroughSeam(ctx, {
        type: "internal",
        action,
        ...(address.flowKind !== undefined ? { flowKind: address.flowKind } : {}),
        session: address.session,
        payload,
        from: `${board.collectionId}-delivery`
      });
    } catch {
      // Not definitive: the debt stays for the wake.
      return undefined;
    }
  };

  const settleUndeliverable = async (
    row: Task,
    notice: TaskNotice,
    detail: string,
    patchMetadata: (id: string, patch: Record<string, unknown>) => Promise<void>
  ): Promise<void> => {
    await patchMetadata(row.id, { ...clearNotice(notice), ...undeliverableRecord(notice, detail, Date.now()) });
    await declared.onUndeliverable?.(ctx, row, notice, detail);
  };

  // A ledger that owes no notices owes its filer's pass only for a request
  // parked on a row: a live wait slot.
  const owesNothing = (row: Task): boolean => declared.notices === false && (row.wait == null || row.wait.lapsed === true);

  return {
    ...(declared.notices === false ? { notices: false as const } : {}),
    filerOf,
    beforeEnding: (row) => owePassAt(row, Date.now() + NOTICE_DUE_MS),
    owePassAt,
    afterEnding,
    whenRequestEnds,
    ...(declared.onMidwayQuestion !== undefined ? { tellMidwayQuestions } : {})
  };

  async function tellMidwayQuestions(row: Task): Promise<void> {
    const holds = openRowQuestions(row).filter((hold) => hold.midway === true);
    if (holds.length === 0) return;
    if (filerOf(row) === undefined) {
      // A screen's or a schedule's filing, or a filer no longer known: the Inbox has it.
      console.debug("[orchestration] a midway question has no filer to tell: it is in the Inbox only", { boardId: board.collectionId, taskId: row.id });
      return;
    }
    try {
      await declared.onMidwayQuestion!(ctx, row, holds);
    } catch (error) {
      // The question stands on the row and in the Inbox; only the filer's telling failed.
      console.warn("[orchestration] a midway question couldn't be told to its filer: it stays in the Inbox", {
        boardId: board.collectionId,
        taskId: row.id,
        error: (error as Error).message
      });
    }
  }

  function whenRequestEnds(send: () => Promise<void>): void {
    // Only where a notice can be held for this request: a host that records
    // which requests are running. Anywhere else nothing is held for it, and a
    // hook would be owed for nothing: a context built outside a request's
    // run (a test harness's) never runs its hooks, and a host's shutdown
    // waits out its drain budget for every hook still owed in the process.
    if (ctx.requestHost?.waits?.running === undefined) return;
    // Once per request and board: every resolution of the board in this
    // request reaches the same request-end list.
    const seam = (ctx as { readonly [REQUEST_END_SEAM]?: object })[REQUEST_END_SEAM];
    if (seam === undefined) return;
    const boardKey = `${board.collectionId}\u0000${board.partition ?? ""}`;
    const registered = sendsAtStop.get(seam) ?? new Set<string>();
    if (registered.has(boardKey)) return;
    registered.add(boardKey);
    sendsAtStop.set(seam, registered);
    onRequestEnded(ctx, async (ending) => {
      // At a park, one wake and no row I/O (FIX-2149): a parked request holds
      // no notice, so the filer's pass is owed shortly, once the park is
      // recorded, and sends what it held then, past its backoff. It releases
      // the wait slots the request lapsed too, so an ending one held goes out
      // (FIX-2170). A hook here
      // runs before the request is recorded parked, so it stays small. The
      // request that runs again after the park registers anew (the board
      // notes the rows it filed).
      if (ending.status === "suspended") {
        if (declared.notices !== false) await owePassAtPark();
        return;
      }
      try {
        await send();
      } catch (error) {
        console.warn("[orchestration] a notice held for the request that filed its task wasn't sent as it ended: the filer's pass sends it", {
          boardId: board.collectionId,
          error: (error as Error).message
        });
      }
    });
  }

  /** The filing or waiting request parked: owe this (its filer's) session's pass one wake (FIX-2149, FIX-2170). */
  async function owePassAtPark(): Promise<void> {
    try {
      await ctx.requestHost?.wakes?.owe({ entry: passEntry, dueAt: Date.now() + NOTICE_DUE_MS });
    } catch (error) {
      console.warn("[orchestration] a wake for the filer's pass at a park couldn't be written: a notice held for the request goes out at its next resend", {
        boardId: board.collectionId,
        error: (error as Error).message
      });
    }
  }

  async function owePassAt(row: Task, dueAt: number): Promise<void> {
    if (owesNothing(row)) return;
    const filer = filerOf(row);
    const wakes = ctx.requestHost?.wakes;
    if (filer === undefined || wakes === undefined) return;
    try {
      await wakes.owe({ entry: passEntry, dueAt, sessionId: filer });
    } catch (error) {
      // The fast path still runs; a debt with no wake waits for the filer's
      // next pass, so say so.
      console.warn("[orchestration] a wake for the filer's pass couldn't be written: its debt waits for the filer's next pass", {
        boardId: board.collectionId,
        taskId: row.id,
        error: (error as Error).message
      });
    }
  }

  async function afterEnding(
    row: Task,
    rows: readonly Task[],
    patchMetadata: (id: string, patch: Record<string, unknown>) => Promise<void>
  ): Promise<void> {
    try {
      const filer = filerOf(row);
      const notices = owedNotices(row, board.collectionId, rows, filerOf);
      if (filer === undefined) {
        for (const notice of notices) await settleUndeliverable(row, notice, "no session is known to have filed it", patchMetadata);
        return;
      }
      const address = addressOf(filer);
      if (address === undefined) return;
      // A waited-on row's turn is resumed, and a retry's next attempt
      // started, by the filer's pass. Only a board that declares its own
      // `passEntry` (Workforce's run entry) has a pass that starts pending
      // rows; the default `onTaskSettled` pass pays notices and cascades
      // only, so a retry there is started by the board's own drain; the wake
      // only pays its notice.
      const runsPass = row.resumeOwed === true || (row.status === "pending" && declared.passEntry !== undefined && row.attempts > 0);
      // Inside the filer's own pass that trigger waits its turn (one pass at
      // a time), and runs once the running pass ends.
      if (runsPass) await send(address, passEntry, {});
      const entry = declared.noticeEntry?.(row) ?? TASK_SETTLED_ENTRY;
      for (const notice of notices) {
        const outcome = await send(address, entry, notice);
        if (outcome !== undefined && !outcome.ok && outcome.refused === FILER_GONE) {
          await settleUndeliverable(row, notice, outcome.detail, patchMetadata);
        }
      }
    } catch (error) {
      // Never fails the write that committed: the wake pays what is left.
      console.warn("[orchestration] a settled task's delivery failed after its write: the filer's next wake pays it", {
        boardId: board.collectionId,
        taskId: row.id,
        error: (error as Error).message
      });
    }
  }
}

/** A declared ledger, as {@link markDelegating} reads it. */
type DelegatingLedger = { readonly __taskCollection: { delivery?: DeclaredDelivery } };

/**
 * Mark a ledger as one a board hands rows out from (FIX-2078): its delegated
 * rows owe their filer a notice of every ending, delivered by
 * {@link createDelivery}. A ledger that declares its own `delivery` keeps it.
 * Called by `taskBoard()` for a board with a task dispatcher; a plan board
 * passes `{ notices: false }`, since its drain waits on every row it hands
 * out and is resumed by its ending (FIX-2082).
 */
export function markDelegating(ledger: unknown, delivery: DeclaredDelivery = {}): void {
  const declared = (ledger as Partial<DelegatingLedger> | undefined)?.__taskCollection;
  if (declared === undefined) return;
  declared.delivery ??= delivery;
}
