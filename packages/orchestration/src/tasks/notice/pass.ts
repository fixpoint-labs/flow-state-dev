/**
 * What a board's pass pays, in the filer's own session (FIX-2078): every debt
 * its delegated rows still owe, each by its due time, so nothing waits on a
 * later touch.
 *
 * {@link payBoardDebts} is the repairs half of a pass. It pays, in order:
 *
 * 1. **Cancels owed** (`Task.cancelOwed`): a stopped wait whose cancel failed.
 * 2. **Cascades owed** (`Task.cascadeOwed`) past their due time (FIX-2080 D2),
 *    before any notice, so a resent notice names what its ending cancelled.
 *    Then **held questions past a deadline the host set** (FIX-2133): each
 *    closes "no answer came", and the last lets the work go on. A question
 *    with no deadline is never closed here.
 * 3. **Resumes owed** (`Task.resumeOwed`): the turn parked on a waited-on row.
 * 4. **Wait slots lapsed** for a request that has since parked (FIX-2170) or
 *    ended (FIX-2082): released, so an ending held for it is owed to the
 *    filer's notice. A slot whose request still runs is looked at again less
 *    and less often, and no more once it is past the maximum age.
 * 5. **Notices owed** past their due time, sent again to this session's notice
 *    entry. A send turned away (the 32-notice cap among them) stays owed. One
 *    last turned away for the request that filed its task, which has since
 *    parked or ended, is sent at once, past its backoff (FIX-2149).
 *
 * Then it answers when the board's next debt falls due: the earliest due time
 * over the debts still outstanding, a claimed row's lease end among them (a
 * worker that died lets its lease lapse, and the next pass reclaims the row).
 * The caller moves the pass's wake there, or clears it ({@link settlePassWake}).
 *
 * A debt still outstanding past the host's maximum age (`maxDebtAgeMs`,
 * counted from its due time) ends: a notice is settled undeliverable, a marker
 * is cleared, a lapsed wait slot is no longer looked at (counted from its
 * lapse), and it is logged. So every wake clears.
 */
import type { BlockContext, WakeView } from "@flow-state-dev/core/types";
import { dispatchThroughSeam } from "@flow-state-dev/core/types";
import type { Task } from "../schema/task";
import { isTerminalStatus } from "../schema/task-status";
import type { TaskCollectionRef } from "../collection/types";
import { payOwedResumes, releaseEndedWaits } from "../helpers/wait-on-task";
import { nextQuestionDue } from "../collection/questions";
import { requestStates } from "../helpers/request-states";
import { isDefinedTaskCollection } from "../collection/define-task-collection";
import { resolveResourceCollection } from "../collection/resolve-resource-collection";
import { resolveTaskPartition } from "../collection/partition";
import { getOrCreateTaskCollection } from "../collection/get-or-create";
import {
  clearNotice,
  heldWhileRunning,
  LAPSED_SLOT_CHECK_MS,
  NOTICE_DUE_MS,
  noticeDueAt,
  noticeTimes,
  owedNotices,
  resentRecord,
  type TaskNotice
} from "./task-notice";
import { TASK_SETTLED_ENTRY, undeliverableRecord, type DeclaredDelivery } from "./delivery";

/** The default most a debt may stay outstanding past its due time, when the host names none: 24 hours. */
const DEFAULT_MAX_DEBT_AGE_MS = 86_400_000;

/** What {@link payBoardDebts} found still outstanding. */
export interface BoardDebts {
  /** When the board's next outstanding debt falls due, or `undefined` when none is outstanding. */
  readonly nextDue: number | undefined;
}

/** How a board's debts are paid. */
export interface PayBoardDebtsOptions {
  /** The entry a row's notice arrives on in this session. Default `onTaskSettled`. */
  readonly noticeEntry?: (row: Task) => string;
  /** A notice settled undeliverable here: past the maximum age. */
  readonly onUndeliverable?: (ctx: BlockContext, row: Task, notice: TaskNotice, detail: string) => Promise<void>;
  /** The clock. Default `ref.now()`. */
  readonly now?: number;
  /**
   * Send past-due notices again. Default `true`. A pass's repairs after its
   * drain pass `false`: the drain's own endings went on their fast path, and
   * the repairs before it already sent what was past due.
   */
  readonly resend?: boolean;
  /**
   * The session that filed a row, as the board's delivery resolves it (a row
   * filed before `Task.filer` by its legacy filer). Names a notice's cancelled
   * dependents by the same rule the cascade suppressed their notices by.
   */
  readonly filerOf?: (row: Task) => string | undefined;
}

function log(message: string, detail: Record<string, unknown>): void {
  console.warn(`[orchestration] ${message}`, detail);
}

/**
 * Pay what `ref`'s rows owe, in this (the filer's) session, and say when the
 * next debt falls due. Never throws for one row: a debt it can't pay stays
 * outstanding, and counts toward the next due time.
 */
export async function payBoardDebts(
  ctx: BlockContext,
  ref: TaskCollectionRef,
  options: PayBoardDebtsOptions = {}
): Promise<BoardDebts> {
  const now = options.now ?? ref.now();
  const maxAge = ctx.requestHost?.wakes?.maxDebtAgeMs ?? DEFAULT_MAX_DEBT_AGE_MS;
  const tooOld = (due: number): boolean => now - due > maxAge;

  // 1 and 3: cancels owed, then resumes owed. Never fails the pass.
  try {
    await payOwedResumes(ctx, ref);
  } catch (error) {
    log("a pass's resumes failed and stay owed", { error: (error as Error).message });
  }
  // 2: cascades past due.
  try {
    await ref.payOwedCascades?.();
  } catch (error) {
    log("a pass's cascades failed and stay owed", { error: (error as Error).message });
  }
  // 2b: held questions past their deadline (FIX-2133): the work goes on without an answer.
  try {
    await ref.payQuestionDeadlines?.();
  } catch (error) {
    log("a pass's question deadlines failed and stay owed", { error: (error as Error).message });
  }

  // 4: slots lapsed for a request that has ended. Before the notices, so an
  // ending a slot held is owed, then sent at its due time.
  let lapsedCheck: number | undefined;
  try {
    lapsedCheck = await releaseEndedWaits(ctx, ref, now, maxAge);
  } catch (error) {
    log("a pass's lapsed wait slots stay for the next pass", { error: (error as Error).message });
    lapsedCheck = now + LAPSED_SLOT_CHECK_MS;
  }

  // A notice stored before FIX-2078 has no due time: it is due now, the
  // upgrade's, and its age counts from here (BP-030).
  await stampLegacyNotices(ref, now);

  // 5: notices past due, sent again here; one too old ends. A notice last
  // turned away for its filing request, which has since parked or ended, is
  // due now, past its backoff (FIX-2149).
  const rows = ref.list();
  const released = options.resend === false ? new Set<string>() : await stoppedFilingRequests(ctx, ref, rows);
  for (const row of rows) {
    const due = noticeDueAt(row);
    if (due === undefined || options.resend === false) continue;
    const owed = owedNotices(row, ref.collectionId, rows, options.filerOf);
    const sendsNow = (notice: TaskNotice): boolean => {
      const heldFor = heldWhileRunning(row, notice);
      return heldFor !== undefined && released.has(heldFor);
    };
    if (due > now && !owed.some(sendsNow)) continue;
    for (const notice of owed) {
      const times = noticeTimes(row, notice);
      if (times === undefined) continue;
      // Its age counts from its due time, or from the last time a busy session
      // turned it away (FIX-2113), which is no failed delivery.
      if (tooOld(times.since)) {
        const detail = `it was still owed ${Math.round((now - times.since) / 1000)} s past its due time`;
        log("a notice past the maximum debt age was settled undeliverable", { taskId: row.id, ending: notice.ending });
        await ref.patchMetadata(row.id, { ...clearNotice(notice), ...undeliverableRecord(notice, detail, now) });
        await options.onUndeliverable?.(ctx, row, notice, detail);
        continue;
      }
      // Sent again lately: that copy is taken to be on its way.
      if (times.next > now && !sendsNow(notice)) continue;
      try {
        // Recorded before the send, so a send that hangs still backs off.
        await ref.patchMetadata(row.id, resentRecord(row, notice, now));
        await dispatchThroughSeam(ctx, {
          type: "internal",
          action: options.noticeEntry?.(row) ?? TASK_SETTLED_ENTRY,
          session: { id: ctx.session.identity.id },
          payload: notice,
          from: `${ref.collectionId}-pass`
        });
      } catch {
        // Still owed: the next pass sends it.
      }
    }
  }

  // What is still outstanding, and when it falls due.
  let nextDue: number | undefined;
  const owe = (at: number): void => {
    nextDue = nextDue === undefined ? at : Math.min(nextDue, at);
  };
  if (lapsedCheck !== undefined) owe(lapsedCheck);
  for (const row of ref.list()) {
    const notice = noticeDueAt(row);
    // A notice the pass just sent again is outstanding until its entry clears it.
    if (notice !== undefined) owe(notice > now ? notice : now + NOTICE_DUE_MS);
    if (row.resumeOwed === true || row.cancelOwed === true) {
      const due = row.updatedAt + NOTICE_DUE_MS;
      if (tooOld(due)) {
        log("a resume or cancel past the maximum debt age was dropped", { taskId: row.id });
        if (row.resumeOwed === true) await ref.clearResumeOwed?.(row.id);
      } else {
        owe(Math.max(due, now + NOTICE_DUE_MS));
      }
    }
    if (row.cascadeOwed != null) owe(Math.max(row.cascadeOwed.due, now + NOTICE_DUE_MS));
    // A held question's deadline, when the host set one (FIX-2133).
    const held = nextQuestionDue(row);
    if (held !== undefined) owe(Math.max(held, now + NOTICE_DUE_MS));
    // A claimed row's lease: if its worker died, the lease lapses, and the
    // pass at its end reclaims the row.
    if (row.status === "in_progress" && row.leaseUntil != null && !isTerminalStatus(row.status)) owe(row.leaseUntil);
  }
  return { nextDue };
}

/**
 * The filing requests that notices on `rows` were last turned away for and
 * that no longer run (FIX-2149): parked or ended. One read of those requests,
 * made only when such a notice is owed; empty on a host that doesn't record
 * which requests are running, where no notice is held for one.
 */
async function stoppedFilingRequests(ctx: BlockContext, ref: TaskCollectionRef, rows: readonly Task[]): Promise<Set<string>> {
  const held = new Set<string>();
  if (ctx.requestHost?.waits?.running === undefined) return held;
  for (const row of rows) {
    for (const notice of owedNotices(row, ref.collectionId)) {
      const heldFor = heldWhileRunning(row, notice);
      if (heldFor !== undefined) held.add(heldFor);
    }
  }
  if (held.size === 0) return held;
  try {
    const states = await requestStates(ctx, [...held]);
    return new Set([...held].filter((id) => states?.[id] === "parked" || states?.[id] === "ended"));
  } catch (error) {
    log("a pass couldn't read whether the requests its notices were held for still run: they wait for their next resend", {
      error: (error as Error).message
    });
    return new Set();
  }
}

/** Give each owed-notice marker that carries no due time (stored before FIX-2078) one: `now`. */
async function stampLegacyNotices(ref: TaskCollectionRef, now: number): Promise<void> {
  for (const row of ref.list()) {
    const stamped: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row.metadata ?? {})) {
      if (!key.startsWith("noticeOwed:") || value === null || typeof value !== "object") continue;
      if ((value as { due?: unknown }).due === undefined) stamped[key] = { ...(value as object), due: now };
    }
    if (Object.keys(stamped).length > 0) await ref.patchMetadata(row.id, stamped);
  }
}

/**
 * After a pass: move the session's wake for `entry` to `nextDue`, or clear it
 * when nothing is outstanding, conditional on the version the pass read at its
 * start (`RequestHost.wakes`). A pass that read none owes one at `nextDue`. A
 * no-op on a host that keeps no wakes.
 */
export async function settlePassWake(
  ctx: BlockContext,
  entry: string,
  read: WakeView | undefined,
  nextDue: number | undefined
): Promise<void> {
  const wakes = ctx.requestHost?.wakes;
  if (wakes === undefined) return;
  if (read === undefined) {
    // A pass that started with no wake to move still leaves its next debt one.
    if (nextDue === undefined) return;
    try {
      await wakes.owe({ entry, dueAt: nextDue });
    } catch (error) {
      log("a pass's next debt got no wake", { entry, error: (error as Error).message });
    }
    return;
  }
  try {
    await wakes.settle(entry, read, nextDue ?? null);
  } catch (error) {
    log("a pass's wake was left as it was", { entry, error: (error as Error).message });
  }
}

/**
 * The boards this flow hands rows out from, at this session's partition: every
 * declared task collection with a delivery (FIX-2078). What the plain
 * `onTaskSettled` entry pays on a wake. With `only`, just that ledger.
 */
export async function delegatingBoardsOf(
  ctx: BlockContext,
  only?: string
): Promise<Array<{ ref: TaskCollectionRef; delivery: DeclaredDelivery }>> {
  const registry = ctx.resources as { list?: () => unknown[] } | undefined;
  const found: Array<{ ref: TaskCollectionRef; delivery: DeclaredDelivery }> = [];
  for (const entry of registry?.list?.() ?? []) {
    const config = (entry as { config?: unknown }).config;
    if (!isDefinedTaskCollection(config) || config.__taskCollection.delivery === undefined) continue;
    const id = config.__taskCollection.id;
    // Resolving a ledger reads it as this request's snapshot: resolve only
    // the one asked for, so a later read of another sees its rows as they are then.
    if (only !== undefined && id !== only) continue;
    const collection = resolveResourceCollection(ctx, id);
    if (collection === undefined) continue;
    const partitionBy = config.__taskCollection.partitionBy;
    const ref = await getOrCreateTaskCollection({
      ctx,
      backing: "resource",
      collectionId: id,
      collection,
      ...(partitionBy !== undefined ? { partition: await resolveTaskPartition(id, partitionBy, ctx) } : {})
    });
    found.push({ ref, delivery: config.__taskCollection.delivery });
  }
  return found;
}
