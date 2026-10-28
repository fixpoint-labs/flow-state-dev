/**
 * A message queues behind the user (FIX-2239, epic ER-4 and D3): one to a
 * session stopped for the user, or to a task held on one, lands only once
 * nothing holds it. Checked at `onMessageReceived`'s admission, after the take
 * and before the items, the one point every send, call and resend passes.
 *
 * What holds a session:
 *
 * - **a request of the session parked for the user** (`RequestHost.waits.userStop`).
 *   The message parks on the wait gate bound to that request, and the engine
 *   resumes it when that request ends: it waits for the stopped request to
 *   end, not merely resume, since the session is busy until then.
 * - **in a task's session, an open hold on its task** (`hasOpenQuestion`, FIX-2058
 *   ER-2): a stop for the user and a question both hold. A question has no
 *   request to wait on, so the message parks bound to the task row, with a
 *   short deadline, and looks again.
 *
 * Every resume looks again. While it waits, the row says so
 * (`queuedBehind: "user"`), which a call's `running` answer reads. A parked
 * message is a wait, never the user's stop: nothing the user answers counts it.
 * A message whose park would pass `MAX_WAIT_DEPTH` isn't admitted: its request
 * ends without landing it, and the sending session's pass sends it again.
 */
import { canHoldWait, MAX_WAIT_DEPTH, parkOnWait } from "@flow-state-dev/core";
import type { BlockContext, WaitGateBinding } from "@flow-state-dev/core/types";
import { findTaskPartitions, hasOpenQuestion, rowsInSession } from "@flow-state-dev/orchestration/tasks";
import { CONVERSATION_LEDGER_ID, conversationLedgerAt } from "../conversation-board/ledger";
import { TASK_ID_STATE_KEY } from "../workers/keys";
import { messageLogOf, type WorkerMessageRow } from "./message-log";

/** How often a message queued behind a task's question looks again, at most. */
export const QUESTION_RECHECK_MS = 30_000;

/** What holds the running session for the user now, as a wait binds to it; `null` when nothing does. */
async function userHoldOf(ctx: BlockContext): Promise<WaitGateBinding | null> {
  const stop = await ctx.requestHost?.waits?.userStop?.();
  if (stop !== undefined) return { requestId: stop.requestId };
  const taskId = (ctx.session.state as Record<string, unknown> | undefined)?.[TASK_ID_STATE_KEY];
  if (typeof taskId !== "string" || taskId.length === 0) return null;
  const sessionId = ctx.session.identity.id;
  for (const partition of await findTaskPartitions(ctx, CONVERSATION_LEDGER_ID, taskId)) {
    const ledger = await conversationLedgerAt(ctx, partition);
    if (ledger === undefined) continue;
    const held = rowsInSession(ledger, sessionId).find(hasOpenQuestion);
    if (held !== undefined) return { board: ledger.collectionId, taskId: held.id };
  }
  return null;
}

/**
 * Wait while the user holds the running session, before message `row` lands.
 *
 * @returns `"admitted"` once nothing holds it; `"not_admitted"` when its wait
 *   would be too deep, or the request was stopped while it waited.
 */
export async function queueBehindUser(ctx: BlockContext, row: Pick<WorkerMessageRow, "id">): Promise<"admitted" | "not_admitted"> {
  const waits = ctx.requestHost?.waits;
  // A host that can't hold a wait can't queue a message: it lands as before. That includes a host
  // with no sweeper, since a question's park looks again only when its deadline resumes it.
  if (waits === undefined || !canHoldWait(ctx) || ctx.runOnce === undefined || ctx.suspend === undefined) return "admitted";
  const once = ctx.runOnce.bind(ctx);
  const ref = await messageLogOf(ctx).getOptional(row.id);
  for (let round = 0; ; round += 1) {
    // Read once per round and recorded: the replay after a park decides as the first run did.
    const hold = await once(`fsd.queue.hold:${row.id}:${round}`, () => userHoldOf(ctx));
    if (hold === null) {
      if (round > 0) await ref?.updateState(({ queuedBehind: _queued, ...rest }) => rest);
      return "admitted";
    }
    const depth = await once(`fsd.queue.depth:${row.id}:${round}`, () => waits.depth({ binding: hold }));
    if (depth > MAX_WAIT_DEPTH) return "not_admitted";
    if (round === 0) await ref?.patchState({ queuedBehind: "user" });
    const planned = await once(`fsd.queue.plan:${row.id}:${round}`, async () => ({
      gateId: `queue:${row.id}#${globalThis.crypto.randomUUID()}`,
      deadline:
        Date.now() +
        ("requestId" in hold
          ? waits.deadlines.defaultMs
          : Math.min(waits.deadlines.maxMs, Math.max(waits.deadlines.minMs, QUESTION_RECHECK_MS)))
    }));
    const outcome = await parkOnWait(ctx, {
      gateId: planned.gateId,
      binding: hold,
      deadline: planned.deadline,
      message: `Message ${row.id} waits for the user to answer`
    });
    if ("stopped" in outcome) return "not_admitted";
  }
}
