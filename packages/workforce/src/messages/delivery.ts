/**
 * A worker message lands once (FIX-2240): the debt a send owes, the take on
 * its row, and the sending session's pass step that sends it again.
 * The take and the backoff are orchestration's (`decideTake`, `nextResendAt`).
 */
import { withOutcome } from "@flow-state-dev/core/helpers";
import { dispatchThroughSeam, type BlockContext, type DispatchOutcome, type DispatchRefusal, type ResourceRef } from "@flow-state-dev/core/types";
import { decideTake, hasEnded, nextResendAt, NOTICE_DUE_MS } from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";
import { DISPATCH_ENTRY } from "../conversation-board/board-entries";
import type { WorkerInstallation } from "../workers/installation";
import { MESSAGE_RECEIVED_ENTRY, WORKER_MESSAGES_OWED_STATE } from "./keys";
import { messageLogOf, type WorkerMessageRow } from "./message-log";

/** The host's debt age when it keeps no wakes to say one: a day. */
const DEFAULT_DEBT_AGE_MS = 24 * 60 * 60 * 1000;

/** One message a session owes: its id, and the request that sent it. */
const owedMessageSchema = z.object({ id: z.string().min(1), by: z.string().min(1) });

type OwedMessage = z.infer<typeof owedMessageSchema>;

/** The session state the owed list is kept in. Server-owned. */
export const messageDeliveryStateShape = {
  [WORKER_MESSAGES_OWED_STATE]: z.array(owedMessageSchema).default([])
} as const;

/** The block name a resend is dispatched from: a resend's request record names it as its sender. */
export const MESSAGE_RESEND_FROM = "worker-message-resend";

/** The owed list in a session's state. */
function owedOf(state: unknown): OwedMessage[] {
  const list = (state as Record<string, unknown> | undefined)?.[WORKER_MESSAGES_OWED_STATE];
  if (!Array.isArray(list)) return [];
  // An entry that doesn't parse is skipped, never run.
  return list.flatMap((entry) => {
    const parsed = owedMessageSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

/** Whether `flowKind`'s flow carries the board's pass, which sends an owed message again. */
export function carriesPass(installation: WorkerInstallation, flowKind: string): boolean {
  const flow = installation.workerFlows()[flowKind]?.flow as { internal?: { actions?: Record<string, unknown> } } | undefined;
  return flow?.internal?.actions?.[DISPATCH_ENTRY] !== undefined;
}

/**
 * Owe a message before its row is written: the session's pass a wake, then
 * the id on the owed list with the running request beside it. A crash after
 * this and before the row leaves an id the pass drops once this request has
 * ended. A host that keeps no wakes has the owed list only.
 */
export async function oweMessage(ctx: BlockContext, id: string): Promise<void> {
  try {
    await ctx.requestHost?.wakes?.owe({ entry: DISPATCH_ENTRY, dueAt: Date.now() + NOTICE_DUE_MS });
  } catch {
    // The owed list still holds it; the next pass pays it.
  }
  const by = ctx.request.identity.id;
  await ctx.session.atomicState((state: Readonly<Record<string, unknown>>) => {
    const owed = owedOf(state);
    return owed.some((entry) => entry.id === id) ? {} : { [WORKER_MESSAGES_OWED_STATE]: [...owed, { id, by }] };
  });
}

/** Take `ids` off the running session's owed list. */
export async function dropOwed(ctx: BlockContext, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await ctx.session.atomicState((state: Readonly<Record<string, unknown>>) => {
    const owed = owedOf(state);
    const kept = owed.filter((entry) => !ids.includes(entry.id));
    return kept.length === owed.length ? {} : { [WORKER_MESSAGES_OWED_STATE]: kept };
  });
}

/**
 * Whether a refusal is final: the recipient can never take the message.
 * Retryable: `dispatch-rejected` (busy under a `reject` policy),
 * `no-dispatch-operation`, and `flow-not-found` (a rolling deploy can leave a
 * flow missing for a moment). A throw is retryable too.
 */
export function isFinalRefusal(refused: DispatchRefusal): boolean {
  return refused !== "dispatch-rejected" && refused !== "no-dispatch-operation" && refused !== "flow-not-found";
}

/** Dispatch `row` to its recipient's `onMessageReceived`, at the address the row keeps whole. */
export function dispatchMessage(ctx: BlockContext, row: WorkerMessageRow, from: string): Promise<DispatchOutcome> {
  return dispatchThroughSeam(ctx, {
    type: "internal",
    action: MESSAGE_RECEIVED_ENTRY,
    flowKind: row.toFlow,
    session: row.toState === undefined ? { id: row.toSession } : { id: row.toSession, state: row.toState },
    payload: { messageId: row.id },
    from
  });
}

/**
 * End a message `refused` or `undeliverable`, guarded: only while it is
 * `unconfirmed` and nobody took it, so a late refusal never overwrites a
 * delivery or a take that may still deliver. `told` records that the sender
 * was told already (the tool's answer said it).
 *
 * @param force Write it even over a take: a taken message past the host's debt age whose recipient is gone.
 * @returns Whether it was written.
 */
export async function endMessage(
  ref: ResourceRef<WorkerMessageRow>,
  status: "refused" | "undeliverable",
  reason: string,
  options: { told?: boolean; force?: boolean } = {}
): Promise<boolean> {
  const ended = await withOutcome(
    (mutator: (row: WorkerMessageRow) => WorkerMessageRow) => ref.updateState(mutator),
    (row: WorkerMessageRow) => {
      if (row.status !== "unconfirmed" || (row.takenBy !== undefined && options.force !== true)) return { state: row, result: false };
      return { state: { ...row, status, reason, ...(options.told === true ? { toldAt: Date.now() } : {}) }, result: true };
    }
  );
  return ended === true;
}

/** D1's line: what the sending session's next turn reads of a message that couldn't land. */
function undeliveredLine(row: Pick<WorkerMessageRow, "id" | "to" | "reason">): string {
  return `Your message ${row.id} to ${row.to} wasn't delivered: ${row.reason ?? "no reason was given"}.`;
}

/** Leave D1's line in the running session (the sender's), then record it on the row. */
async function tellSender(ctx: BlockContext, ref: ResourceRef<WorkerMessageRow>): Promise<void> {
  const emit = storedEmitters(ctx);
  await emit.message(undeliveredLine(ref.state), { itemVisibility: { client: true, history: true } });
  await emit.stored();
  await ref.patchState({ toldAt: Date.now() });
}

/**
 * The emitters for an item a later write says landed (`delivered`, `toldAt`):
 * each settles on its emission, and `stored()` waits for the request store,
 * so the write never runs ahead of the item it records. A context that can't
 * confirm either throws: the row stays as it was, and the next copy or pass
 * finishes it.
 */
export function storedEmitters(ctx: BlockContext) {
  const { _emitMessageAwaited: message, _emitComponentAwaited: component, _flushItems: flush } = ctx;
  if (message === undefined || component === undefined || flush === undefined) {
    throw new Error("worker messages: this context can't confirm an item was stored, so nothing is recorded as landed");
  }
  return { message: message.bind(ctx), component: component.bind(ctx), stored: flush.bind(ctx) };
}

/**
 * Take message `id` for the running request, in the recipient's session
 * (FIX-2123's take, on a message): one guarded write of `takenBy` while the
 * row is `unconfirmed`, for the session the row is addressed to. A taker that
 * hasn't ended keeps it; one that ended without delivering is taken over.
 *
 * @returns The row to land, or `undefined` when this request runs nothing.
 */
export async function takeMessage(ctx: BlockContext, id: string): Promise<WorkerMessageRow | undefined> {
  const ref = await messageLogOf(ctx).getOptional(id);
  const row = ref?.state;
  if (ref === undefined || row === undefined || row.toSession !== ctx.session.identity.id || row.status !== "unconfirmed") return undefined;
  const rule = await decideTake(ctx, row.takenBy);
  if (rule.take === "busy") return undefined;
  const own = ctx.request.identity.id;
  const seen = row.takenBy;
  return withOutcome(
    (mutator: (current: WorkerMessageRow) => WorkerMessageRow) => ref.updateState(mutator),
    (current: WorkerMessageRow) => {
      if (current.status !== "unconfirmed" || current.takenBy !== seen) return { state: current, result: undefined };
      return { state: { ...current, takenBy: own }, result: { ...current, takenBy: own } };
    }
  );
}

/**
 * Mark message `id` delivered in the running request, once its items have
 * landed: guarded on this request's take, so it is written once.
 */
export async function markDelivered(ctx: BlockContext, id: string): Promise<boolean> {
  const ref = await messageLogOf(ctx).getOptional(id);
  if (ref === undefined) return false;
  const own = ctx.request.identity.id;
  const marked = await withOutcome(
    (mutator: (current: WorkerMessageRow) => WorkerMessageRow) => ref.updateState(mutator),
    (current: WorkerMessageRow) => {
      if (current.status !== "unconfirmed" || current.takenBy !== own) return { state: current, result: false };
      return { state: { ...current, status: "delivered" as const, deliveredAs: own, deliveredAt: Date.now() }, result: true };
    }
  );
  return marked === true;
}

/**
 * Pay what the running session owes for the messages it sent.
 *
 * @param recheck Why the message can't go to its recipient now, or `undefined`
 *   when it can. The send's check, without the budget the row paid once.
 * @returns When the next owed message falls due, or `undefined` when none is owed.
 */
export async function payMessageDebts(
  ctx: BlockContext,
  recheck: (ctx: BlockContext, row: WorkerMessageRow) => Promise<string | undefined>
): Promise<number | undefined> {
  const owed = owedOf(ctx.session.state);
  if (owed.length === 0) return undefined;
  const log = messageLogOf(ctx);
  const maxAge = ctx.requestHost?.wakes?.maxDebtAgeMs ?? DEFAULT_DEBT_AGE_MS;
  const drop: string[] = [];
  let next: number | undefined;
  const later = (at: number) => {
    next = next === undefined ? at : Math.min(next, at);
  };
  // End the row, tell the sender, drop the id: false when another writer ended it first.
  const close = async (ref: ResourceRef<WorkerMessageRow>, id: string, status: "refused" | "undeliverable", reason: string, force = false) => {
    if (!(await endMessage(ref, status, reason, force ? { force: true } : undefined))) return false;
    await tellSender(ctx, ref);
    drop.push(id);
    return true;
  };

  for (const entry of owed) {
    const ref = await log.getOptional(entry.id);
    if (ref === undefined) {
      if (await hasEnded(ctx, entry.by)) drop.push(entry.id);
      else later(Date.now() + NOTICE_DUE_MS);
      continue;
    }
    if (ref.state.status === "delivered") {
      drop.push(entry.id);
      continue;
    }
    if (ref.state.status !== "unconfirmed") {
      if (ref.state.toldAt === undefined) await tellSender(ctx, ref);
      drop.push(entry.id);
      continue;
    }
    const now = Date.now();
    const pastAge = now - ref.state.at > maxAge;
    if (pastAge && ref.state.takenBy === undefined) {
      if (!(await close(ref, entry.id, "undeliverable", `it couldn't be delivered within ${Math.round(maxAge / 60_000)} minutes`))) later(now + NOTICE_DUE_MS);
      continue;
    }
    // Taken, and past the age: a taker may still hold it (a turn waiting on the
    // user), so it is never ended for its age; it is sent again at the
    // backoff's cap, which a copy takes over from a taker that ended.
    const due = nextResendAt(ref.state.resent, ref.state.at + NOTICE_DUE_MS);
    if (due > now) {
      later(due);
      continue;
    }
    const refusal = await recheck(ctx, ref.state);
    // Past the age, a recipient that is gone ends even a taken message, or it is sent again forever.
    if (refusal !== undefined) {
      if (await close(ref, entry.id, "refused", refusal, pastAge)) continue;
    } else {
      let outcome: DispatchOutcome | undefined;
      try {
        outcome = await dispatchMessage(ctx, ref.state, MESSAGE_RESEND_FROM);
      } catch (error) {
        await ref.patchState({ reason: error instanceof Error ? error.message : String(error) });
      }
      if (outcome !== undefined && !outcome.ok) {
        const reason = `${outcome.refused}: ${outcome.detail}`;
        if (isFinalRefusal(outcome.refused) && (await close(ref, entry.id, "refused", reason))) continue;
        await ref.patchState({ reason });
      }
    }
    const resent = { n: (ref.state.resent?.n ?? 0) + 1, at: Date.now() };
    await ref.patchState({ resent });
    // With `resent` set, the backoff counts from `resent.at`; the second argument only anchors a first send.
    later(nextResendAt(resent, resent.at));
  }

  await dropOwed(ctx, drop);
  return next;
}
