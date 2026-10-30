/**
 * Waiting for a reply (FIX-2239, folded into the reply request by FIX-2318):
 * `sendMessage({ to, text, wait: true })` asks for a reply and parks in this
 * request until that answer or the deadline. The answer is `sendMessage({ inReplyTo })`.
 * While the sender still waits, that send is held and is the tool's result.
 * Once the wait has ended, at the deadline with no answer yet, the tool answers
 * `running` and the same answer arrives later as a message.
 */
import { waitOnRequest } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { checkWaitable, toolCallOf } from "@flow-state-dev/orchestration/task-board";
import { hasEnded } from "@flow-state-dev/orchestration/tasks";
import type { WorkerInstallation } from "../workers/installation";
import { messageLogOf, newMessageId, type WorkerMessageRow } from "./message-log";
import { sendMessage, type SendMessageInput } from "./send-message";

/** What a wait came to, once its checks passed. `sent` is the message's id. */
export type WaitResult =
  | { readonly status: "answered"; readonly sent: string; readonly reply: string; readonly noAnswer?: true }
  | { readonly status: "running"; readonly sent: string; readonly recipient?: "waiting_on_person" }
  | { readonly status: "failed"; readonly sent: string; readonly error: string };

/** A wait's outcome: its result, or a refusal before anything was written. */
export type WaitOutcome = WaitResult | { readonly ok: false; readonly error: string };

/** How often an answer tries to wake its wait in one landing, and how far apart, before its sender's pass sends it again. */
const WAKE_TRIES = 5;
const WAKE_RETRY_MS = 200;

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
  // `fsd.call.*` (and the `call:` gate prefix below) are historical idempotency names from before
  // FIX-2318: requests parked before it recorded them, so they are kept and a replay sends nothing again.
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

/**
 * In the waiting sender's session, `row`'s landing: when it is the answer a
 * wait there still holds (the message it answers names it in `answeredBy`,
 * has a deadline, and no `waitEndedAt`), resume that wait's gate with it
 * (`RequestHost.resumeWait`), so the sender has it as soon as it is given, not
 * at the end of the turn that gave it. Such an answer is the wait's result and
 * never lands as a message.
 *
 * @returns `"not-held"` for any other message; `"woken"` once the gate took
 *   it or had already ended (the wait reads the answer off the log either way);
 *   `"retry"` while the sender hasn't parked yet, or the gate is busy, so the
 *   answer stays undelivered and its sender's pass sends it again.
 */
export async function wakeHeldWait(ctx: BlockContext, row: Pick<WorkerMessageRow, "id" | "inReplyTo">): Promise<"not-held" | "woken" | "retry"> {
  if (row.inReplyTo === undefined) return "not-held";
  const log = messageLogOf(ctx);
  for (let tries = 0; tries < WAKE_TRIES; tries += 1) {
    if (tries > 0) await new Promise((resolve) => setTimeout(resolve, WAKE_RETRY_MS));
    const asked = (await log.getOptional(row.inReplyTo))?.state;
    if (asked === undefined || asked.answeredBy !== row.id || asked.deadlineAt === undefined || asked.waitEndedAt !== undefined) return "not-held";
    if (asked.fromSession !== ctx.session.identity.id) return "not-held";
    const resumeWait = ctx.requestHost?.resumeWait;
    // No host that resumes waits holds none: the wait read the answer at its request's end.
    if (resumeWait === undefined) return "woken";
    // Not parked yet: look again shortly.
    if (asked.waitGate === undefined) continue;
    const { gateId, requestId } = asked.waitGate;
    const result = await resumeWait({ gateId, outcome: { answered: true, answer: { answeredBy: row.id } } });
    if (result.ok || result.refused === "already-resolved") return "woken";
    // Busy: another resume holds the turn (the engine's, at the recipient's request end, which
    // reads the answer off the log too) or it hasn't finished parking. Not found: the waiting
    // request finished, or hasn't parked on this gate yet, or moved on to a later one.
    if (result.refused !== "busy" && (await hasEnded(ctx, requestId))) return "woken";
  }
  // Still not woken: left for the answer's sender's pass to send again.
  return "retry";
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
      // The request acting on the message now: the one it was delivered in, else its taker.
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
    // A nonce of this wait's own: a later wait on the same request parks on a gate of its own.
    // Kept under runOnce, so a replay records and parks on the same gate.
    const gateId = await ctx.runOnce!(`fsd.call.gate:${key}:${round}`, async () => `call:${id}#${globalThis.crypto.randomUUID()}`);
    // Recorded before the park: an answer given while this request still runs resumes this
    // gate from this session (`wakeHeldWait`), not only the request's end.
    await (await log.getOptional(id))?.patchState({ waitGate: { gateId, requestId: ctx.request.identity.id } });
    const outcome = await waitOnRequest(ctx, {
      requestId: target,
      gateId,
      planKey: `fsd.call.wait:${key}:${round}`,
      deadlineAt,
      message: `Waiting on the reply to message ${id}`
    });
    if (outcome.status === "running") return end();
    // The answer woke it (`wakeHeldWait`), or the request ended: its turn
    // answered, or it acted on nothing (a copy, or a taker that died before it
    // landed), and the row names who acts on it now.
    const next = await read(round + 1);
    if (next.answeredBy !== undefined) return answered(ctx, id, next.answeredBy);
    if (next.ended !== undefined) return { status: "failed", sent: id, error: next.ended };
    // Nobody new to follow: waiting again would park on a request that already ended.
    if (next.target === undefined || next.target === target) return end();
    target = next.target;
  }
  return end();
}
