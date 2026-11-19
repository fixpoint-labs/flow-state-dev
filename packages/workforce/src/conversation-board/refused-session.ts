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
 * The `dispatch` wake is cleared once nothing else is owed and it is past its
 * fence (before it, a writer may still be landing a debt: the wake's own fire
 * is refused, and the engine clears it past the fence). Anything still owed
 * keeps it, and the turn fails with an ordinary error, so the next fire tries
 * again.
 */
import { requestHostOf } from "@flow-state-dev/core/internal";
import type { BlockContext } from "@flow-state-dev/core/types";
import type { Task, TaskCollectionRef } from "@flow-state-dev/orchestration/tasks";
import {
  clearNotice,
  filerResolver,
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

/** What the refused turn pays beyond its boards: the messages the session owes. When the next falls due, or `undefined` when none is owed. */
export type PayRefusedSessionMessages = (ctx: BlockContext) => Promise<number | undefined>;

/**
 * Pay or settle what the running session's boards owe it, then clear its wake.
 *
 * @param detail Why its notices are undeliverable, as each records it.
 * @param payMessages The session's message debts, paid as its pass pays them.
 * @returns `undefined` once nothing is owed; else what still is. The wake is
 *   then kept, so the next refused turn tries again.
 */
export async function settleRefusedSession(
  ctx: BlockContext,
  detail: string,
  payMessages?: PayRefusedSessionMessages
): Promise<string | undefined> {
  let owed: string | undefined;
  try {
    owed = await payWhatIsOwed(ctx, detail, payMessages);
  } catch (error) {
    owed = (error as Error).message;
  }
  if (owed !== undefined) {
    console.warn("[workforce] a refused session couldn't pay all its board owes it: its wake stays, and the next refused turn tries again", {
      sessionId: ctx.session.identity.id,
      owed
    });
    return owed;
  }
  try {
    const wakes = requestHostOf(ctx)?.wakes;
    const read = await wakes?.read(DISPATCH_ENTRY);
    // Inside its fence a clear would only move the wake out to it: left as it
    // is, it fires at its due time, and that run, refused, clears it.
    if (wakes !== undefined && read !== undefined && Date.now() >= read.landBy) await wakes.settle(DISPATCH_ENTRY, read, null);
  } catch (error) {
    // Nothing is owed: a wake left kept fires once more, finds nothing, and is cleared.
    console.warn("[workforce] a refused session couldn't clear its wake: the engine clears it once its fire is refused", {
      sessionId: ctx.session.identity.id,
      error: (error as Error).message
    });
  }
  return undefined;
}

/** Pay what can be paid; say what is still owed, or `undefined` for nothing. */
async function payWhatIsOwed(ctx: BlockContext, detail: string, payMessages: PayRefusedSessionMessages | undefined): Promise<string | undefined> {
  const partition = await filingSessionIdOf(ctx.session);
  const still: string[] = [];
  const ledger = await conversationLedgerAt(ctx, partition);
  if (ledger !== undefined) {
    // The board's own filer rule, so a task filed before `Task.filer` names the
    // dependents its ending cancelled as the delivery and the pass name them.
    const filerOf = filerResolver(conversationDelivery(CONVERSATION_LEDGER_ID), partition);
    await settleOwedNotices(ctx, ledger, partition, detail, filerOf);
    await payBoardDebts(ctx, ledger, { filerOf, resend: false });
    // Reports stored before FIX-2078 (BP-030), once each.
    await sendLegacyReports(ctx, ledger, ledger.list(), { boardId: CONVERSATION_LEDGER_ID, partition }, "conversation-board-refused-session");
    still.push(...stillOwedOn(ledger, filerOf));
  }
  const plan = await planLedgerAt(ctx, partition);
  if (plan !== undefined) {
    const filerOf = filerResolver(conversationDelivery(PLAN_LEDGER_ID), plan.partition);
    await payBoardDebts(ctx, plan, { filerOf, resend: false });
    still.push(...stillOwedOn(plan, filerOf));
  }
  if (payMessages !== undefined && (await payMessages(ctx)) !== undefined) still.push("a message it sent or owes an answer to");
  return still.length === 0 ? undefined : `still owed: ${still.join("; ")}`;
}

/**
 * The debts a board's repair left on `ref`, by task: a notice, a cancel, a
 * resume, a cascade, a report an older version stored. A claimed row's lease
 * end is none of these.
 */
function stillOwedOn(ref: TaskCollectionRef, filerOf: (task: Task) => string | undefined): string[] {
  const tasks = ref.list();
  return tasks
    .filter(
      (task) =>
        task.cancelOwed === true ||
        task.resumeOwed === true ||
        task.cascadeOwed != null ||
        owedReports(task).length > 0 ||
        owedNotices(task, ref.collectionId, tasks, filerOf).length > 0
    )
    .map((task) => `task "${task.id}" on ${ref.collectionId}`);
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
      ctx.emit.message(`The conversation that filed task "${task.title ?? task.goal}" couldn't be told it ${notice.ending}: ${detail}`);
    }
  }
}
