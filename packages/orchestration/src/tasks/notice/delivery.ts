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
import { dispatchThroughSeam } from "@flow-state-dev/core/types";
import type { BlockContext, DispatchOutcome, SessionTarget } from "@flow-state-dev/core/types";
import type { Task } from "../schema/task";
import { clearNotice, NOTICE_DUE_MS, owedNotices, type TaskNotice } from "./task-notice";

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
}

/** The metadata key a notice settled undeliverable is recorded under, on its row. */
const UNDELIVERABLE_PREFIX = "noticeUndeliverable:";

/** The record of a notice settled undeliverable: when, and why. */
export function undeliverableRecord(notice: Pick<TaskNotice, "attempt" | "ending">, detail: string, at: number): Record<string, unknown> {
  return { [`${UNDELIVERABLE_PREFIX}${notice.attempt}:${notice.ending}`]: { at, detail } };
}

/** What a backing runs around an ending's write, bound to the running request. */
export interface DeliveryHooks {
  /** The session that filed `row`, or `undefined` when none is known. */
  filerOf(row: Task): string | undefined;
  /** Before a write that may end `row`: owe the wake. */
  beforeEnding(row: Task): Promise<void>;
  /** After the write: deliver what `row` owes now, at once. */
  afterEnding(row: Task, rows: readonly Task[], patchMetadata: (id: string, patch: Record<string, unknown>) => Promise<void>): Promise<void>;
}

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
  const filerOf = (row: Task): string | undefined =>
    row.filer?.sessionId ?? declared.legacyFiler?.(row, board.partition);
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

  return {
    filerOf,

    async beforeEnding(row) {
      const filer = filerOf(row);
      const wakes = ctx.requestHost?.wakes;
      if (filer === undefined || wakes === undefined) return;
      try {
        await wakes.owe({ entry: passEntry, dueAt: Date.now() + NOTICE_DUE_MS, sessionId: filer });
      } catch {
        // The fast path still runs; a wake that couldn't be written leaves the
        // debt to the filer's next pass.
      }
    },

    async afterEnding(row, rows, patchMetadata) {
      try {
        const filer = filerOf(row);
        const notices = owedNotices(row, board.collectionId, rows);
        if (filer === undefined) {
          for (const notice of notices) await settleUndeliverable(row, notice, "no session is known to have filed it", patchMetadata);
          return;
        }
        const address = addressOf(filer);
        if (address === undefined) return;
        // A waited-on row's turn is resumed, and a retry's next attempt
        // started, by the filer's pass.
        const runsPass =
          row.resumeOwed === true || (row.status === "pending" && declared.passEntry !== undefined && row.attempts > 0);
        // Inside the filer's own pass that trigger is refused (one pass at a
        // time), and the pass's own repairs, after its drain, pay it.
        if (runsPass) await send(address, passEntry, {});
        const entry = declared.noticeEntry?.(row) ?? TASK_SETTLED_ENTRY;
        for (const notice of notices) {
          const outcome = await send(address, entry, notice);
          if (outcome !== undefined && !outcome.ok && outcome.refused === FILER_GONE) {
            await settleUndeliverable(row, notice, outcome.detail, patchMetadata);
          }
        }
      } catch {
        // Never fails the write that committed: the wake pays what is left.
      }
    }
  };
}

/** A declared ledger, as {@link markDelegating} reads it. */
type DelegatingLedger = { readonly __taskCollection: { delivery?: DeclaredDelivery } };

/**
 * Mark a ledger as one a board hands rows out from (FIX-2078): its delegated
 * rows owe their filer a notice of every ending, delivered by
 * {@link createDelivery}. A ledger that declares its own `delivery` keeps it.
 * Called by `taskBoard()` for a board with a task dispatcher.
 */
export function markDelegating(ledger: unknown): void {
  const declared = (ledger as Partial<DelegatingLedger> | undefined)?.__taskCollection;
  if (declared === undefined) return;
  declared.delivery ??= {};
}
