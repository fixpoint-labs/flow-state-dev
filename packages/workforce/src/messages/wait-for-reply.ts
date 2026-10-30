/**
 * Waiting for a reply (FIX-2239, folded into the reply request by FIX-2318):
 * `sendMessage({ to, text, wait: true })` asks for a reply and parks in this
 * request until that answer or the deadline. The answer is `sendMessage({ inReplyTo })`.
 * While the sender still waits, that send is held and is the tool's result.
 * Once the wait has ended, the same answer arrives as a message.
 */
import { waitOnRequest } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { checkWaitable, toolCallOf } from "@flow-state-dev/orchestration/task-board";
import type { WorkerInstallation } from "../workers/installation";
import { messageLogOf, newMessageId } from "./message-log";
import { sendMessage, type SendMessageInput } from "./send-message";

/** What a wait came to, once its checks passed. `sent` is the message's id. */
export type WaitResult =
  | { readonly status: "answered"; readonly sent: string; readonly reply: string; readonly noAnswer?: true }
  | { readonly status: "running"; readonly sent: string; readonly recipient?: "waiting_on_person" }
  | { readonly status: "failed"; readonly sent: string; readonly error: string };

/** A wait's outcome: its result, or a refusal before anything was written. */
export type WaitOutcome = WaitResult | { readonly ok: false; readonly error: string };

/** The most requests one wait follows to its answer: a taker that died, and the one that took over. */
const MAX_FOLLOWS = 5;

/** The checks a wait passes before anything is written (orchestration's, shared with `getTask`): its key, and its deadline in ms. */
async function checkWait(
  ctx: BlockContext,
  deadline: number | undefined
): Promise<{ readonly ok: false; readonly error: string } | { readonly key: string; readonly deadlineMs: number }> {
  const call = toolCallOf(ctx);
  const unavailable =
    "wait_unavailable: this host can't hold a wait (it needs durable execution, a store that keeps wakes and a " +
    "sweeper that resumes waits at their deadline). Nothing was sent. Send with replyRequested and without wait, " +
    "and the answer comes back as a message.";
  if (call === undefined) return { ok: false, error: unavailable };
  const checked = await checkWaitable(ctx, {
    key: call.logicalId,
    step: call.stepKey,
    ...(deadline === undefined ? {} : { deadlineMs: deadline }),
    unavailable
  });
  if (!checked.ok) {
    // A model reads the code first, then why; nothing was sent either way.
    return { ok: false, error: checked.error === "wait_unavailable" ? checked.message : `${checked.error}: ${checked.message.replace("Nothing was written.", "Nothing was sent.")}` };
  }
  return { key: call.logicalId, deadlineMs: checked.deadlineMs };
}

/**
 * Send a message that asks for a reply, and wait for the answer.
 *
 * @param from The sending block's name, for the dispatch's provenance.
 */
export async function sendAndWaitForReply(
  ctx: BlockContext,
  installation: WorkerInstallation,
  flowKind: string,
  input: SendMessageInput & { readonly deadline?: number },
  from: string
): Promise<WaitOutcome> {
  const checked = await checkWait(ctx, input.deadline);
  if ("ok" in checked) return checked;
  const once = ctx.runOnce!.bind(ctx);
  // The `fsd.call.*` keys are recorded in requests already parked: kept, so their replay sends nothing again.
  const deadlineAt = await once(`fsd.call.deadline:${checked.key}`, async () => Date.now() + checked.deadlineMs);
  const id = await once(`fsd.call.id:${checked.key}`, async () => newMessageId());
  const { deadline: _deadline, ...message } = input;
  const sendThenWait = async (): Promise<WaitOutcome> => {
    const sent = await once(`fsd.call.send:${checked.key}`, () =>
      sendMessage(ctx, installation, flowKind, message, from, { id, replyRequested: { deadlineAt } })
    );
    if (!sent.ok) return { ok: false, error: sent.error };
    return awaitAnswer(ctx, id, checked.key, deadlineAt, sent.requestId);
  };
  // The park is owed before the row (FIX-2269): a process that dies between
  // the row and the park leaves the request for the engine to continue.
  const waits = ctx.requestHost?.waits;
  return waits?.owingPark !== undefined ? waits.owingPark(sendThenWait) : sendThenWait();
}

/** The answer `answeredBy` names, as the wait's result. */
async function answered(ctx: BlockContext, id: string, answeredBy: string): Promise<WaitResult> {
  const answer = (await messageLogOf(ctx).getOptional(answeredBy))?.state;
  return { status: "answered", sent: id, reply: answer?.text ?? "", ...(answer?.noAnswer === true ? { noAnswer: true as const } : {}) };
}

/** Park on the request acting on message `id` until its answer, or the deadline. */
async function awaitAnswer(
  ctx: BlockContext,
  id: string,
  key: string,
  deadlineAt: number,
  first: string | undefined
): Promise<WaitResult> {
  const log = messageLogOf(ctx);
  // Read once per follow and recorded, so the replay after a park follows as the first run did.
  const read = (round: number) =>
    ctx.runOnce!(`fsd.call.next:${key}:${round}`, async (): Promise<{ ended?: string; answeredBy?: string; target?: string }> => {
      const row = (await log.getOptional(id))?.state;
      if (row === undefined) return { ended: `no_such_message: message "${id}" has no record.` };
      if (row.answeredBy !== undefined) return { answeredBy: row.answeredBy };
      if (row.status === "refused" || row.status === "undeliverable") {
        return { ended: `not_delivered: the message to "${row.to}" was ${row.status} (${row.reason ?? "no reason was given"}).` };
      }
      const target = row.deliveredAs ?? row.takenBy;
      return target === undefined ? {} : { target };
    });
  // End the wait unless an answer claimed the row first: the one guarded write
  // the send's hold reads, so an answer is either this wait's or a message.
  const end = (): Promise<WaitResult> =>
    ctx.runOnce!(`fsd.call.end:${key}`, async () => {
      const ref = await log.getOptional(id);
      if (ref === undefined) return { status: "failed", sent: id, error: `no_such_message: message "${id}" has no record.` };
      await ref.updateState((row) => (row.answeredBy !== undefined || row.waitEndedAt !== undefined ? row : { ...row, waitEndedAt: Date.now() }));
      const row = ref.state;
      if (row.answeredBy !== undefined) return answered(ctx, id, row.answeredBy);
      return { status: "running", sent: id, ...(row.queuedBehind === "user" ? { recipient: "waiting_on_person" as const } : {}) };
    });

  let target = first;
  for (let round = 0; round <= MAX_FOLLOWS; round += 1) {
    if (target === undefined) {
      const next = await read(round);
      if (next.answeredBy !== undefined) return answered(ctx, id, next.answeredBy);
      if (next.ended !== undefined) return { status: "failed", sent: id, error: next.ended };
      if (next.target === undefined) return end();
      target = next.target;
    }
    const outcome = await waitOnRequest(ctx, {
      requestId: target,
      // A nonce of this wait's own: a later wait on the same request parks on a gate of its own.
      // The fresh UUID is safe on replay: `planKey` keeps the first plan under runOnce, so a
      // replay parks on the stored gate and deadline, not this one.
      gateId: `call:${id}#${globalThis.crypto.randomUUID()}`,
      planKey: `fsd.call.wait:${key}:${round}`,
      deadlineAt,
      message: `Waiting on the reply to message ${id}`
    });
    if (outcome.status === "running") return end();
    // The request ended: its turn answered (held for this wait), or it acted on
    // nothing (a copy, or a taker that died before it landed), and the row
    // names who acts on it now.
    const next = await read(round + 1);
    if (next.answeredBy !== undefined) return answered(ctx, id, next.answeredBy);
    if (next.ended !== undefined) return { status: "failed", sent: id, error: next.ended };
    // Nobody new to follow: waiting again would park on a request that already ended.
    if (next.target === undefined || next.target === target) return end();
    target = next.target;
  }
  return end();
}
