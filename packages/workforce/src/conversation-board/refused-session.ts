// FIX-2849.
/**
 * A session whose every turn is refused (its worker was fired, or can no
 * longer run there), as a turn of it is refused: what its boards owe it is
 * paid or settled, and its wake let go, before the refusal is thrown.
 *
 * Its board's pass, the only thing that pays its debts and clears its wake,
 * never runs again, so the refused turn does the pass's repairs itself:
 *
 * - **Notices** can never be heard here: each is settled undeliverable, with
 *   the record a notice to a conversation that is gone gets, said once in this
 *   session. A task that failed for good is reported to the Error Reporter
 *   first, under this session's own board; a report the intake didn't take
 *   leaves the notice owed, as a notice entry leaves it.
 * - **Every other debt** is paid by the board's own repair (`payBoardDebts`,
 *   with no notice resend, on the conversation board and the plan board): a
 *   cancel owed, a cascade, a resume owed (the resumed turn is refused for
 *   good and ends `failed`), a held question past its deadline, a lapsed wait
 *   slot. Then the reports an older version stored, and the messages the
 *   session sent or owes an answer to (`payMessages`).
 * - **A claimed row's lease end** keeps no wake: a row that ends owes its
 *   notice and a wake again, and is settled then. A row whose worker dies
 *   after the refusal is left claimed.
 *
 * Whether the wake stays is what the board's repair answers: its next due
 * time (`payBoardDebts`), the messages' too. With one, the wake is kept to it
 * and the turn fails with an ordinary error, so the engine keeps it and the
 * refused turn then pays what fell due. With none, the `dispatch` wake is
 * cleared, at the version read before the boards were, once past its fence
 * (before it, a writer may still be landing a debt: the wake's own fire is
 * refused, and the engine clears it past the fence).
 */
import { requestHostOf } from "@flow-state-dev/core/internal";
import type { BlockContext } from "@flow-state-dev/core/types";
import type { Task, TaskCollectionRef } from "@flow-state-dev/orchestration/tasks";
import {
  clearNotice,
  filerResolver,
  NOTICE_DUE_MS,
  noticeKey,
  owedNotices,
  payBoardDebts,
  undeliverableRecord
} from "@flow-state-dev/orchestration/internal";
import { DISPATCH_ENTRY } from "./board-entries";
import { conversationDelivery } from "./delivery";
import { filingSessionIdOf } from "./filing-session";
import { CONVERSATION_LEDGER_ID, conversationLedgerAt } from "./ledger";
import { PLAN_LEDGER_ID, planLedgerAt } from "./plan";
import { owedReports, sendLegacyReports, sendTaskReport } from "./report-owed";
import { noteSeen } from "./task-settled";

/** What the refused turn pays beyond its boards: the messages the session owes. When the next falls due, or `undefined` when none is owed. */
export type PayRefusedSessionMessages = (ctx: BlockContext) => Promise<number | undefined>;

/**
 * Pay or settle what the running session's boards owe it, then clear its wake,
 * or keep it to when the next debt falls due.
 *
 * @param detail Why its notices are undeliverable, as each records it.
 * @param payMessages The session's message debts, paid as its pass pays them.
 * @returns `undefined` once nothing is owed; else what still is. The wake is
 *   then kept (to the next due time), so a later refused turn pays it.
 */
export async function settleRefusedSession(
  ctx: BlockContext,
  detail: string,
  payMessages?: PayRefusedSessionMessages
): Promise<string | undefined> {
  // The wake as it stands before the boards are read: only this version is
  // settled, and cleared only when its fence had passed by then. A debt that
  // lands while the boards are read owes the wake again, which the settle
  // then finds changed (`stale`) and leaves.
  const wakes = requestHostOf(ctx)?.wakes;
  let read: Awaited<ReturnType<NonNullable<typeof wakes>["read"]>>;
  try {
    read = await wakes?.read(DISPATCH_ENTRY);
  } catch {
    read = undefined;
  }
  const pastFence = read !== undefined && Date.now() >= read.landBy;
  let nextDue: number | undefined;
  try {
    nextDue = await payWhatIsOwed(ctx, detail, payMessages);
  } catch (error) {
    // Nothing is settled about the wake: the next fire tries again.
    const reason = (error as Error).message;
    console.warn("[workforce] a refused session couldn't pay what its board owes it: its wake stays, and the next refused turn tries again", {
      sessionId: ctx.session.identity.id,
      error: reason
    });
    return reason;
  }
  try {
    if (nextDue !== undefined) {
      // Owed later (a question's deadline, a wait slot's next look, a busy
      // resume, a message's resend): the wake is kept to then, as a pass's
      // settle keeps it.
      if (read !== undefined) await wakes!.settle(DISPATCH_ENTRY, read, nextDue);
      else await wakes?.owe({ entry: DISPATCH_ENTRY, dueAt: nextDue });
      return `still owed: the next debt falls due at ${new Date(nextDue).toISOString()}`;
    }
    // Inside its fence a clear would only move the wake out to it: left as it
    // is, it fires at its due time, and that run, refused, clears it.
    if (read !== undefined && pastFence) await wakes!.settle(DISPATCH_ENTRY, read, null);
  } catch (error) {
    // A wake left as it was fires again, and that refused turn settles it.
    console.warn("[workforce] a refused session couldn't settle its wake: it fires again", {
      sessionId: ctx.session.identity.id,
      error: (error as Error).message
    });
  }
  return undefined;
}

/**
 * Pay what can be paid, as the board's pass pays it, and answer when the next
 * debt falls due, or `undefined` when nothing is owed. A claimed row's lease
 * end is no debt here (`leases: false`): this session can't reclaim a row.
 */
async function payWhatIsOwed(ctx: BlockContext, detail: string, payMessages: PayRefusedSessionMessages | undefined): Promise<number | undefined> {
  const partition = await filingSessionIdOf(ctx.session);
  let next: number | undefined;
  const owe = (at: number | undefined): void => {
    if (at !== undefined) next = next === undefined ? at : Math.min(next, at);
  };
  const ledger = await conversationLedgerAt(ctx, partition);
  if (ledger !== undefined) {
    // The board's own filer rule, so a task filed before `Task.filer` names the
    // dependents its ending cancelled as the delivery and the pass name them.
    const filerOf = filerResolver(conversationDelivery(CONVERSATION_LEDGER_ID), partition);
    await settleOwedNotices(ctx, ledger, partition, detail, filerOf);
    owe((await payBoardDebts(ctx, ledger, { filerOf, resend: false, leases: false })).nextDue);
    // Reports stored before FIX-2078 (BP-030), once each; one the intake
    // didn't take goes again.
    await sendLegacyReports(ctx, ledger, ledger.list(), { boardId: CONVERSATION_LEDGER_ID, partition }, "conversation-board-refused-session");
    if (ledger.list().some((task) => owedReports(task).length > 0)) owe(Date.now() + NOTICE_DUE_MS);
  }
  const plan = await planLedgerAt(ctx, partition);
  if (plan !== undefined) {
    const filerOf = filerResolver(conversationDelivery(PLAN_LEDGER_ID), plan.partition);
    owe((await payBoardDebts(ctx, plan, { filerOf, resend: false, leases: false })).nextDue);
  }
  if (payMessages !== undefined) owe(await payMessages(ctx));
  return next;
}

async function settleOwedNotices(
  ctx: BlockContext,
  ledger: TaskCollectionRef,
  partition: string,
  detail: string,
  filerOf: (task: Task) => string | undefined
): Promise<void> {
  const tasks = ledger.list();
  for (const task of tasks) {
    for (const notice of owedNotices(task, ledger.collectionId, tasks, filerOf)) {
      // Its notice entry reports a final failure; it will never run, so the
      // report goes from here, under the board the task is on: this session's.
      // First, as the notice entry does: a report the intake didn't take
      // leaves the notice owed, and the scan unfinished, so it goes again.
      if (notice.ending === "errored") {
        const outcome = await sendTaskReport(
          ctx,
          task,
          { attempt: notice.attempt, error: notice.error ?? "" },
          { boardId: CONVERSATION_LEDGER_ID, partition },
          "conversation-board-refused-session"
        );
        if (outcome === "not-taken") throw new Error(`the Error Reporter didn't take task "${task.id}"'s failure`);
      }
      await ledger.patchMetadata(task.id, { ...clearNotice(notice), ...undeliverableRecord(notice, detail, Date.now()) });
      // A refused `dispatch` and a refused notice entry can read the same
      // notice at once (two concurrency keys): only the first says it.
      if ((await noteSeen(ctx, noticeKey(notice))) === true) {
        ctx.emit.message(`The conversation that filed task "${task.title ?? task.goal}" couldn't be told it ${notice.ending}: ${detail}`);
      }
    }
  }
}
