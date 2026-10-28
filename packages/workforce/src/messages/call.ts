/**
 * A call (FIX-2239): a message whose sender waits for the reply in the same
 * request, until the reply comes or the deadline passes, whichever is first.
 * Not a task: the epic's decision (FIX-2070 D1). The `sendMessage` tool calls
 * it for `wait: true`, and for `{ callId }`, which waits again.
 *
 * - **Every check before anything is written**, orchestration's
 *   `checkWaitable`, the one `getTask`'s wait makes: the host can hold a wait
 *   (`wait_unavailable`, never turned into a send); the deadline is within
 *   the host's bounds (`wait_deadline_out_of_range`, never clamped), the
 *   host's default when unset; the chain of waits stays within
 *   `MAX_WAIT_DEPTH` (`wait_too_deep`); and one wait per model step
 *   (`wait_already_pending`), claimed last.
 * - **The send** is the send's, with a server-chosen id kept by `runOnce`, so
 *   the replay after the park writes nothing again. The row says it is a call
 *   and when its sender stops waiting, and its dispatch says the sender waits.
 * - **The wait** parks on the one wait gate (`waitOnRequest`), bound to the
 *   request that acts on the message: first the one its own dispatch became,
 *   then the row's taker while it is unconfirmed, then the request it was
 *   delivered in. A request that ended without acting on it (a copy, or a
 *   taker that died) sends the call to the row again.
 * - **The result** is that request's output: `{ reply }`, the final text of
 *   the recipient's `onMessageReceived` turn. At the deadline the call answers
 *   `running` with its call id, and nothing is stopped; the reply is kept as
 *   that request's own record, and `sendMessage({ callId })` waits again
 *   without sending anything, writing no row and paying no budget.
 */
import { waitOnRequest } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { checkWaitable, toolCallOf } from "@flow-state-dev/orchestration/task-board";
import type { WorkerInstallation } from "../workers/installation";
import { messageLogOf, newMessageId, type WorkerMessageRow } from "./message-log";
import { sendMessage, type SendMessageInput } from "./send-message";

/** What a call came to, once its checks passed. */
export type CallResult =
  | { readonly status: "answered"; readonly callId: string; readonly reply: string }
  | { readonly status: "running"; readonly callId: string; readonly recipient?: "waiting_on_person" }
  | { readonly status: "failed"; readonly callId: string; readonly error: string };

/** A call's outcome: its result, or a refusal before anything was written. */
export type CallOutcome = CallResult | { readonly ok: false; readonly error: string };

/** The most requests one call follows to its reply: a taker that died, and the one that took over. */
const MAX_FOLLOWS = 5;

/** The checks a wait passes before anything is written (orchestration's, shared with `getTask`): its key, and its deadline in ms. */
async function checkWait(
  ctx: BlockContext,
  deadline: number | undefined,
  binding?: { readonly requestId: string }
): Promise<{ readonly ok: false; readonly error: string } | { readonly key: string; readonly deadlineMs: number }> {
  const call = toolCallOf(ctx);
  const unavailable =
    "wait_unavailable: this host can't hold a wait (it needs durable execution, a store that keeps wakes and a " +
    "sweeper that resumes waits at their deadline). Nothing was sent. Send without wait, and the answer comes " +
    "back as a message.";
  if (call === undefined) return { ok: false, error: unavailable };
  const checked = await checkWaitable(ctx, {
    key: call.logicalId,
    step: call.stepKey,
    ...(deadline === undefined ? {} : { deadlineMs: deadline }),
    ...(binding === undefined ? {} : { binding }),
    unavailable
  });
  if (!checked.ok) {
    // A model reads the code first, then why; nothing was sent either way.
    return { ok: false, error: checked.error === "wait_unavailable" ? checked.message : `${checked.error}: ${checked.message.replace("Nothing was written.", "Nothing was sent.")}` };
  }
  return { key: call.logicalId, deadlineMs: checked.deadlineMs };
}

/**
 * Send a message and wait for its reply.
 *
 * @param from The sending block's name, for the dispatch's provenance.
 */
export async function callWorker(
  ctx: BlockContext,
  installation: WorkerInstallation,
  flowKind: string,
  input: SendMessageInput & { readonly deadline?: number },
  from: string
): Promise<CallOutcome> {
  const checked = await checkWait(ctx, input.deadline);
  if ("ok" in checked) return checked;
  const once = ctx.runOnce!.bind(ctx);
  const deadlineAt = await once(`fsd.call.deadline:${checked.key}`, async () => Date.now() + checked.deadlineMs);
  const id = await once(`fsd.call.id:${checked.key}`, async () => newMessageId());
  const { deadline: _deadline, ...message } = input;
  const sent = await once(`fsd.call.send:${checked.key}`, () =>
    sendMessage(ctx, installation, flowKind, message, from, { id, call: { deadlineAt } })
  );
  if (!sent.ok) return { ok: false, error: sent.error };
  return awaitReply(ctx, id, checked.key, deadlineAt, sent.requestId);
}

/**
 * Wait again on a call this session sent (`sendMessage({ callId })`): nothing
 * is sent, no row is written, and no budget is paid.
 */
export async function waitAgain(ctx: BlockContext, callId: string, deadline: number | undefined): Promise<CallOutcome> {
  const row = (await messageLogOf(ctx).getOptional(callId))?.state;
  // Another session's call reads as no call at all: it says nothing of it.
  if (row === undefined || row.call !== true || row.fromSession !== ctx.session.identity.id) {
    return { ok: false, error: `no_such_call: no call "${callId}" from this conversation. Pass the callId a call answered.` };
  }
  const target = actingRequest(row);
  const checked = await checkWait(ctx, deadline, target === undefined ? undefined : { requestId: target });
  if ("ok" in checked) return checked;
  const deadlineAt = await ctx.runOnce!(`fsd.call.deadline:${checked.key}`, async () => Date.now() + checked.deadlineMs);
  return awaitReply(ctx, callId, checked.key, deadlineAt, undefined);
}

/** The request acting on the message now: the one it was delivered in, else its taker. */
function actingRequest(row: Pick<WorkerMessageRow, "deliveredAs" | "takenBy">): string | undefined {
  return row.deliveredAs ?? row.takenBy;
}

/** Why the row ended without landing, or `undefined` while it can still land. */
function endedReason(row: Pick<WorkerMessageRow, "status" | "to" | "reason">): string | undefined {
  if (row.status !== "refused" && row.status !== "undeliverable") return undefined;
  return `not_delivered: the message to "${row.to}" was ${row.status} (${row.reason ?? "no reason was given"}).`;
}

/** The reply in an `onMessageReceived` request's output, or `undefined` when it acted on nothing. */
function replyOf(output: unknown): string | undefined {
  const reply = (output as { reply?: unknown } | null | undefined)?.reply;
  return typeof reply === "string" ? reply : undefined;
}

/** Park on the request acting on message `id` until its reply, or the deadline. */
async function awaitReply(
  ctx: BlockContext,
  id: string,
  key: string,
  deadlineAt: number,
  first: string | undefined
): Promise<CallResult> {
  const log = messageLogOf(ctx);
  // Read once per follow and recorded, so the replay after a park follows as the first run did.
  const read = (round: number) =>
    ctx.runOnce!(`fsd.call.next:${key}:${round}`, async () => {
      const row = (await log.getOptional(id))?.state;
      if (row === undefined) return { ended: `no_such_call: message "${id}" has no record.` };
      const ended = endedReason(row);
      if (ended !== undefined) return { ended };
      const target = actingRequest(row);
      return target === undefined ? {} : { target };
    });
  const running = async (): Promise<CallResult> => {
    const row = (await log.getOptional(id))?.state;
    return { status: "running", callId: id, ...(row?.queuedBehind === "user" ? { recipient: "waiting_on_person" as const } : {}) };
  };

  let target = first;
  for (let round = 0; round <= MAX_FOLLOWS; round += 1) {
    if (target === undefined) {
      const next = await read(round);
      if ("ended" in next && next.ended !== undefined) return { status: "failed", callId: id, error: next.ended };
      if (!("target" in next) || next.target === undefined) return running();
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
    if (outcome.status === "running") return running();
    if (outcome.status === "completed") {
      const reply = replyOf(outcome.output);
      if (reply !== undefined) return { status: "answered", callId: id, reply };
    }
    // It ended without acting on the message (a copy, or a taker that died
    // before it landed): the row names who acts on it now.
    const next = await read(round + 1);
    if ("ended" in next && next.ended !== undefined) return { status: "failed", callId: id, error: next.ended };
    const after = "target" in next ? next.target : undefined;
    // Nobody new to follow: the row still names the request that just ended (or no one), so
    // waiting again would park on a request that already ended. Answer with how it ended.
    if (after === undefined || after === target) {
      return outcome.status === "failed" ? { status: "failed", callId: id, error: outcome.error } : running();
    }
    target = after;
  }
  return running();
}
