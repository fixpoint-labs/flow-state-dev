/**
 * A message that asks for a reply gets one (FIX-2310): the obligation a
 * reply-requested message puts on the session that lands it, and the one way
 * it is met. The sender went on without waiting, so nothing waits on the
 * recipient's turn; the answer reaches the sender as a message.
 *
 * There is one reply path: `sendMessage` with `inReplyTo`. The recipient's
 * model may take it itself, during its turn. When it doesn't, the framework
 * takes it at the turn's end, as the recipient: the turn's final text, or a
 * "no answer" when the turn had nothing to say, threw, or ran no turn at all.
 * The message row's `answeredBy` is written once, by whichever send answered
 * first, so the other sends nothing.
 *
 * One case the turn's end can't reach: the server died mid-turn. So the
 * landing request owes its session's pass (as a send owes it for delivery,
 * FIX-2240): the pass answers "no answer" for a message whose landing request
 * ended without one. A call (`wait: true`) never owes one here: its reply is
 * its tool's result.
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import { hasEnded, NOTICE_DUE_MS } from "@flow-state-dev/orchestration/tasks";
import { DISPATCH_ENTRY } from "../conversation-board/board-entries";
import type { WorkerInstallation } from "../workers/installation";
import { WORKER_REPLIES_OWED_STATE } from "./keys";
import { owedRepliesOf, type OwedReply } from "./owed-reply-state";
import { MAX_MESSAGE_CHARS, messageLogOf, type WorkerMessageRow } from "./message-log";
import { sendMessage } from "./send-message";

/** The block name the framework's answer is dispatched from. */
const OWED_REPLY_FROM = "message-received-answer";

/** Whether `row` asks its recipient for a reply the framework owes: reply-requested, and not a call. */
export function wantsReply(row: Pick<WorkerMessageRow, "replyRequested" | "call">): boolean {
  return row.replyRequested === true && row.call !== true;
}

/** The id the framework's answer to `messageId` is sent under: one per message, whichever request sends it. */
function replyIdFor(messageId: string): string {
  return `a:${messageId}`;
}

/** The text of the framework's "no answer". */
function noAnswerText(messageId: string): string {
  return `I have no answer to your message ${messageId}.`;
}

/**
 * Owe the running session's pass an answer to `id`, landed by the running
 * request: one that takes a message over from a request that ended before
 * delivering it owes it in that one's place. Only a flow that carries the
 * pass can be owed; a host that keeps no wakes has the list only.
 */
export async function oweReply(ctx: BlockContext, id: string): Promise<void> {
  try {
    await ctx.requestHost?.wakes?.owe({ entry: DISPATCH_ENTRY, dueAt: Date.now() + NOTICE_DUE_MS });
  } catch {
    // The list still holds it; the next pass pays it.
  }
  const by = ctx.request.identity.id;
  await ctx.session.atomicState((state: Readonly<Record<string, unknown>>) => {
    const owed = owedRepliesOf(state);
    if (owed.some((entry) => entry.id === id && entry.by === by)) return {};
    return { [WORKER_REPLIES_OWED_STATE]: [...owed.filter((entry) => entry.id !== id), { id, by }] };
  });
}

/**
 * Take `ids` off the running session's owed replies; one given with its
 * request only while that request still owes it, so a take-over that owed it
 * since keeps it.
 */
async function dropOwedReplies(ctx: BlockContext, ids: ReadonlyArray<string | OwedReply>): Promise<void> {
  if (ids.length === 0) return;
  const goes = (entry: OwedReply) => ids.some((id) => (typeof id === "string" ? id === entry.id : id.id === entry.id && id.by === entry.by));
  await ctx.session.atomicState((state: Readonly<Record<string, unknown>>) => {
    const owed = owedRepliesOf(state);
    const kept = owed.filter((entry) => !goes(entry));
    return kept.length === owed.length ? {} : { [WORKER_REPLIES_OWED_STATE]: kept };
  });
}

/**
 * Send the reply owed to `messageId` from the running session, unless something answered it
 * already: `text` cut to a message's length, or "no answer" when it is blank.
 * Through `sendMessage({ inReplyTo })`, as the recipient, with the server's own
 * place (no budget) and an id derived from the message, so a replay sends once.
 * Never itself reply-requested. The owed entry goes either way: a refused
 * answer (its sender was let go since) is told the way any refused send is.
 */
export async function sendOwedReply(
  ctx: BlockContext,
  installation: WorkerInstallation,
  flowKind: string,
  messageId: string,
  text: string
): Promise<void> {
  const row = (await messageLogOf(ctx).getOptional(messageId))?.state;
  if (row !== undefined && wantsReply(row) && row.answeredBy === undefined) {
    const said = text.trim();
    await sendMessage(
      ctx,
      installation,
      flowKind,
      { to: row.from, text: said === "" ? noAnswerText(messageId) : said.slice(0, MAX_MESSAGE_CHARS), inReplyTo: messageId },
      OWED_REPLY_FROM,
      { id: replyIdFor(messageId), exempt: true, ...(said === "" ? { noAnswer: true as const } : {}) }
    );
  }
  await dropOwedReplies(ctx, [messageId]);
}

/**
 * The pass's reply step: for each reply the running session owes, drop it once
 * answered or once its message can't land; answer "no answer" for one whose
 * landing request ended after the delivery without answering (its server died
 * mid-turn); drop one whose request ended before the delivery, since the
 * sender's resend owns it now and the request that lands it owes it again;
 * keep the rest, while their turn runs or waits.
 *
 * @returns When the next owed reply should be looked at again, or `undefined` when none is owed.
 */
export async function payReplyDebts(ctx: BlockContext, installation: WorkerInstallation, flowKind: string): Promise<number | undefined> {
  const owed = owedRepliesOf(ctx.session.state);
  if (owed.length === 0) return undefined;
  const log = messageLogOf(ctx);
  const drop: Array<string | OwedReply> = [];
  let next: number | undefined;
  for (const entry of owed) {
    const row = (await log.getOptional(entry.id))?.state;
    if (row === undefined || row.answeredBy !== undefined || row.status === "refused" || row.status === "undeliverable") {
      drop.push(entry.id);
      continue;
    }
    // A take-over may have delivered it since this pass read the list: then
    // the request that owes it is the one that delivered it, looked at again
    // next time, never the dead one's end.
    const delivered = row.status === "delivered";
    if ((!delivered || row.deliveredAs === entry.by) && (await hasEnded(ctx, entry.by))) {
      if (delivered) await sendOwedReply(ctx, installation, flowKind, entry.id, "");
      else drop.push(entry);
      continue;
    }
    const at = Date.now() + NOTICE_DUE_MS;
    next = next === undefined ? at : Math.min(next, at);
  }
  await dropOwedReplies(ctx, drop);
  return next;
}
