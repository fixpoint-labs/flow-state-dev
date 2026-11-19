// FIX-2849.
/**
 * A session whose worker was fired, as a turn of it is refused: what its
 * board owes it is settled, and its wake let go, before the refusal is thrown.
 *
 * Every turn of the session is refused at its start, so its board's pass, the
 * only thing that pays its debts and clears its wake, never runs again. A
 * refused session is terminal, never retried: each notice its board still
 * owes it is settled undeliverable ("its worker was fired"), by the path a
 * notice to a conversation that is gone takes, and its `dispatch` wake is
 * cleared once past its fence (before it, the wake's own fire is refused, and
 * the engine clears it then). A task that ends after the firing owes a
 * notice and a wake again; the turn either starts is refused, and settles it
 * the same way.
 *
 * Never throws: a write that fails here leaves the debt to the engine, which
 * clears a wake whose run is refused for good.
 */
import { requestHostOf } from "@flow-state-dev/core/internal";
import type { BlockContext } from "@flow-state-dev/core/types";
import { clearNotice, owedNotices, undeliverableRecord } from "@flow-state-dev/orchestration/internal";
import { DISPATCH_ENTRY } from "./board-entries";
import { conversationDelivery } from "./delivery";
import { filingSessionIdOf } from "./filing-session";
import { CONVERSATION_LEDGER_ID, conversationLedgerAt } from "./ledger";
import { sendTaskReport } from "./report-owed";

/** Why a notice to a fired worker's session is undeliverable. */
const FIRED_DETAIL = "its worker was fired";

/** Settle what the running session's board owes it, and clear its wake: its worker was fired. */
export async function settleFiredSession(ctx: BlockContext): Promise<void> {
  try {
    await settleOwedNotices(ctx);
  } catch (error) {
    console.warn("[workforce] a fired worker's session couldn't settle the notices its board owes it", {
      sessionId: ctx.session.identity.id,
      error: (error as Error).message
    });
  }
  try {
    const wakes = requestHostOf(ctx)?.wakes;
    const read = await wakes?.read(DISPATCH_ENTRY);
    // Inside its fence a clear would only move the wake out to it: left as it
    // is, it fires at its due time, and that run, refused, clears it.
    if (wakes !== undefined && read !== undefined && Date.now() >= read.landBy) await wakes.settle(DISPATCH_ENTRY, read, null);
  } catch (error) {
    console.warn("[workforce] a fired worker's session couldn't clear its wake: the engine clears it once it is refused", {
      sessionId: ctx.session.identity.id,
      error: (error as Error).message
    });
  }
}

async function settleOwedNotices(ctx: BlockContext): Promise<void> {
  const partition = await filingSessionIdOf(ctx.session);
  const ledger = await conversationLedgerAt(ctx, partition);
  if (ledger === undefined) return;
  const { onUndeliverable } = conversationDelivery(CONVERSATION_LEDGER_ID);
  const tasks = ledger.list();
  for (const task of tasks) {
    for (const notice of owedNotices(task, ledger.collectionId, tasks)) {
      await ledger.patchMetadata(task.id, { ...clearNotice(notice), ...undeliverableRecord(notice, FIRED_DETAIL, Date.now()) });
      await onUndeliverable?.(ctx, task, notice, FIRED_DETAIL);
      // The conversation's notice entry reports a final failure; it will never
      // run, so the report goes from here, for this session's own board.
      if (notice.ending === "errored") {
        await sendTaskReport(
          ctx,
          task,
          { attempt: notice.attempt, error: notice.error ?? "" },
          { boardId: CONVERSATION_LEDGER_ID, partition },
          "conversation-board-worker-fired"
        );
      }
    }
  }
}
