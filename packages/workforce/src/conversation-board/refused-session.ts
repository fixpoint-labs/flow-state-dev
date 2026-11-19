// FIX-2849.
/**
 * A session whose every turn is refused (its worker was fired, or can no
 * longer run there), as a turn of it is refused: what its board owes it is
 * settled, and its wake let go, before the refusal is thrown.
 *
 * Its board's pass, the only thing that pays its debts and clears its wake,
 * never runs again. A refused session is terminal, never retried: each notice
 * its board still owes it is settled undeliverable, with the record a notice
 * to a conversation that is gone gets, and its `dispatch` wake is cleared once
 * past its fence (before it, a writer may still be landing a debt: the wake's
 * own fire is refused, and the engine clears it past the fence). A task that
 * ends after the refusal owes a notice and a wake again; the turn either
 * starts is refused, and settles it the same way.
 *
 * Each notice is said once, in this session, and a task that failed for good
 * is reported to the Error Reporter once, under this session's own board.
 */
import { requestHostOf } from "@flow-state-dev/core/internal";
import type { BlockContext } from "@flow-state-dev/core/types";
import { clearNotice, filerResolver, owedNotices, undeliverableRecord } from "@flow-state-dev/orchestration/internal";
import { DISPATCH_ENTRY } from "./board-entries";
import { conversationDelivery } from "./delivery";
import { filingSessionIdOf } from "./filing-session";
import { CONVERSATION_LEDGER_ID, conversationLedgerAt } from "./ledger";
import { sendTaskReport } from "./report-owed";

/**
 * Settle what the running session's board owes it, then clear its wake.
 *
 * @param detail Why its notices are undeliverable, as each records it.
 * @returns `undefined` once every notice is settled; else why one wasn't. The
 *   wake is then kept, so the next refused turn tries again.
 */
export async function settleRefusedSession(ctx: BlockContext, detail: string): Promise<string | undefined> {
  try {
    await settleOwedNotices(ctx, detail);
  } catch (error) {
    const reason = (error as Error).message;
    console.warn("[workforce] a refused session couldn't settle what its board owes it: its wake stays, and the next refused turn tries again", {
      sessionId: ctx.session.identity.id,
      error: reason
    });
    return reason;
  }
  try {
    const wakes = requestHostOf(ctx)?.wakes;
    const read = await wakes?.read(DISPATCH_ENTRY);
    // Inside its fence a clear would only move the wake out to it: left as it
    // is, it fires at its due time, and that run, refused, clears it.
    if (wakes !== undefined && read !== undefined && Date.now() >= read.landBy) await wakes.settle(DISPATCH_ENTRY, read, null);
  } catch (error) {
    // Everything is settled: a wake left kept fires once more, finds nothing, and is cleared.
    console.warn("[workforce] a refused session couldn't clear its wake: the engine clears it once its fire is refused", {
      sessionId: ctx.session.identity.id,
      error: (error as Error).message
    });
  }
  return undefined;
}

async function settleOwedNotices(ctx: BlockContext, detail: string): Promise<void> {
  const partition = await filingSessionIdOf(ctx.session);
  const ledger = await conversationLedgerAt(ctx, partition);
  if (ledger === undefined) return;
  // The board's own filer rule, so a task filed before `Task.filer` names the
  // dependents its ending cancelled as the delivery and the pass name them.
  const filerOf = filerResolver(conversationDelivery(CONVERSATION_LEDGER_ID), partition);
  const tasks = ledger.list();
  for (const task of tasks) {
    for (const notice of owedNotices(task, ledger.collectionId, tasks, filerOf)) {
      await ledger.patchMetadata(task.id, { ...clearNotice(notice), ...undeliverableRecord(notice, detail, Date.now()) });
      ctx.emit.message(`The conversation that filed task "${task.title ?? task.goal}" couldn't be told it ${notice.ending}: ${detail}`);
      // Its notice entry reports a final failure; it will never run, so the
      // report goes from here, under the board the task is on: this session's.
      if (notice.ending === "errored") {
        await sendTaskReport(
          ctx,
          task,
          { attempt: notice.attempt, error: notice.error ?? "" },
          { boardId: CONVERSATION_LEDGER_ID, partition },
          "conversation-board-refused-session"
        );
      }
    }
  }
}
