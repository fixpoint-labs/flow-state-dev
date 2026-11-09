// FIX-2534, epic ER-5; FIX-2614; FIX-2538 D1.
/**
 * Subscribing and ending a subscription: the one
 * `subscribe` and the one `unsubscribe` everything that writes a subscription
 * goes through. The routine verbs call them (an event routine is a
 * subscription); so does a task's ending, and a thread's closing.
 *
 * `subscribe` writes for the session that will hear: the running one, or a
 * `target` its caller derived on the server (the user's own event routine, the
 * conversation's derived address; a resume, the saved subscription's). It selects by
 * provider, one thread key and optional kinds (epic D6), and refuses a thread
 * its user can't read, checked as that user on the provider's `canRead`
 * (ER-4). The session, the worker, the task and the user come from the turn's
 * own session or that target, never from the input. It writes the subscription,
 * then the thread index entry that mirrors its screen settings for the
 * service; a paused subscription is off and has no index entry.
 *
 * `unmatched: true` (a coordinator's session only, `not_a_coordinator`
 * elsewhere) makes a subscription that hears only what no ordinary
 * subscription heard; see `defineSubscriptionServiceFlow`'s `forwards`.
 *
 * `unsubscribe` turns the row off (`enabled: false`) and takes it out of the
 * index. A pause is an end with reason `paused`, the one a resume undoes. A
 * task's failure or cancel ends the subscriptions its session made, and a
 * thread's closing ends the ones on it (ER-7 as amended by #4675).
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import { readCommitted, updateStateWith } from "@flow-state-dev/core/helpers";
import { retryOnConflict } from "../projects/cas-retry";
import type { RoutineMaker } from "../routines/listed-routine";
import { TASK_ID_STATE_KEY, WORKER_ID_STATE_KEY } from "../workers/keys";
import { COORDINATOR_FLOW } from "../coordinator/coordinator-keys";
import {
  indexKeyOf,
  indexSlotOf,
  listedScreenSchema,
  subscriptionCursorsOf,
  subscriptionIndexOf,
  subscriptionsOf,
  type IndexEntry,
  type SubscriptionResourceState
} from "./rows";
import { requestHostOf } from "@flow-state-dev/core/internal";

/**
 * A provider a session can subscribe on: its key, who may read a thread, and
 * who the running user is there. Both read the running request's own user,
 * on that user's credentials.
 */
export interface SubscriptionProvider {
  /** The provider key, as events and thread keys carry it (`github`). */
  readonly provider: string;
  /** Whether the running request's user can read `thread`. Asked at subscribe, and again before a private event is delivered. */
  canRead(thread: string, ctx: BlockContext): boolean | Promise<boolean>;
  /** The running user's own id at the provider, so their own actions are dropped (`own`). */
  self?(ctx: BlockContext): string | undefined | Promise<string | undefined>;
}

/** What `subscribe` takes: the tool's input. */
export const subscribeInputSchema = z
  .object({
    provider: z.string().describe("The provider the thread is on, e.g. github."),
    thread: z.string().describe('One thread key the event names, e.g. "github:acme/api#412" for a PR, or "github:acme/api" for the whole repo.'),
    kinds: z.array(z.string().min(1)).optional().describe('The kinds of event to hear, e.g. ["review", "check"]. Leave it out to hear every kind.'),
    screens: z
      .array(listedScreenSchema)
      .optional()
      .describe(
        'Narrow what passes: { screen: "labels", any: [...] }, { screen: "words", any: [...] } (title or text, any case), ' +
          '{ screen: "allow", ids: [...] } (only these senders). Every listed screen must pass.'
      ),
    outsiders: z.literal(true).optional().describe("Also hear people outside the project (not members, collaborators or listed bots). Off by default."),
    unmatched: z
      .literal(true)
      .optional()
      .describe("Hear only the events on this thread that no other subscription heard, of the kinds the app forwards. A coordinator's only."),
    interest: z.string().min(1).max(500).describe("In one sentence, what you want to hear about, kept with the subscription.")
  })
  .strict();

export type SubscribeInput = z.infer<typeof subscribeInputSchema>;

/** What a subscribe came to. */
export type SubscribeOutcome = { readonly id: string } | { readonly refused: string };

/** Why a subscription ended. */
export type SubscriptionEnd = "unsubscribed" | "thread_closed" | "task_errored" | "task_cancelled" | "paused" | "config_removed";

/**
 * The session a subscription is written for when it isn't the running one:
 * derived on the server by the caller, never from a tool's input.
 */
export interface SubscribeTarget {
  /** The session that hears. */
  readonly sessionId: string;
  /** The flow that session runs on: a delivery opens it there when absent. */
  readonly flow: string;
  /** The worker that session runs. */
  readonly worker: string;
  /** The task that session works: its failure or cancel ends the subscription. */
  readonly taskId?: string;
  /**
   * The tenant that session runs under; omitted, none. A target's tenant wins over the running
   * session's: a resume from another tenant's roster keeps the saved subscription's.
   */
  readonly tenantId?: string;
}

/** How a server-side caller writes the subscription. Never a model's input. */
export interface SubscribeWrite {
  /** The subscription's id: a resume's saved one, or a declared routine's `cfg_` key. Omitted, derived from session and thread. */
  readonly id?: string;
  /** Who made it, kept with the subscription. */
  readonly madeBy?: RoutineMaker;
}

/**
 * Which life a write gives a subscription, decided against the saved subscription at the write
 * ({@link nextEntry}):
 *
 * - `fresh`: a subscribe, a new act: the subscription is on.
 * - `keep`: a seed's write of the config's fields over the saved subscription, by the seed rules below;
 *   a new one is on.
 * - `resume`: only `enabled`, over a paused subscription on the thread the resume checked; every other
 *   field stays as committed.
 */
type Life = "fresh" | "keep" | "resume";

/**
 * The transition rules every write and end of a subscription goes through, against the saved
 * subscription, so no interleaving of them leaves one its writers didn't agree on:
 *
 * - a terminal end (any reason but `paused`) is sticky: only a fresh subscribe starts a new life,
 *   and a resume or a pause leaves an ended subscription ended;
 * - a seed keeps the user's pause always; it keeps an end only while the thread is unchanged,
 *   since an end belongs to the thread it ended on (a closed PR says nothing of a new one); and a
 *   subscription ended `config_removed` comes back on when its entry returns. These are the only ways
 *   an ended subscription comes back short of a fresh subscribe;
 * - a pause applies only to an enabled subscription;
 * - a resume applies only to a paused subscription, and only while its thread is the one whose read
 *   access it checked; it turns it on and changes nothing else;
 * - an end applies to an enabled or a paused subscription.
 *
 * `undefined` leaves the subscription as it is.
 */
function nextEntry(current: SubscriptionResourceState | undefined, wanted: SubscriptionResourceState, life: Life): SubscriptionResourceState | undefined {
  if (life === "fresh") return wanted;
  if (life === "resume") {
    if (current === undefined || !isPaused(current) || current.provider !== wanted.provider || current.thread !== wanted.thread) return undefined;
    const { endedReason: _why, endedAt: _when, ...kept } = current;
    return { ...kept, enabled: true };
  }
  if (current === undefined || current.enabled) return wanted;
  // A seed keeps a pause always; an end only on the thread it ended on, and not config's own.
  if (!isPaused(current) && (current.endedReason === "config_removed" || current.thread !== wanted.thread)) return wanted;
  const { enabled: _on, endedReason: _why, endedAt: _when, ...fields } = wanted;
  return { ...fields, enabled: false, ...(current.endedReason === undefined ? {} : { endedReason: current.endedReason }), ...(current.endedAt === undefined ? {} : { endedAt: current.endedAt }) };
}

/** {@link nextEntry}'s rule for an end: a pause only of an enabled subscription; any other end of an enabled or paused one. */
function endedEntry(current: SubscriptionResourceState, reason: SubscriptionEnd, at: number): SubscriptionResourceState | undefined {
  const ends = reason === "paused" ? current.enabled : current.enabled || isPaused(current);
  return ends ? { ...current, enabled: false, endedReason: reason, endedAt: at } : undefined;
}

/**
 * A stable id for one session's subscription to one thread: subscribing again
 * updates it. A session id is unique only within its tenant, and every tenant's
 * rows share the user's cell, so the tenant is part of the id. A session with
 * no tenant keeps the id it had.
 */
async function subscriptionIdOf(sessionId: string, provider: string, thread: string, tenantId: string | undefined): Promise<string> {
  const tenant = tenantId === undefined ? "" : `\n${tenantId}`;
  const bytes = new TextEncoder().encode(`${sessionId}\n${provider}\n${thread}${tenant}`);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
  return `sub_${[...digest.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** The tenant the running session is under, or none. */
const tenantOf = (ctx: BlockContext): string | undefined => {
  const tenantId = (ctx.session.identity as { tenantId?: string }).tenantId;
  return tenantId === undefined || tenantId.length === 0 ? undefined : tenantId;
};

const indexEntryOf = (row: SubscriptionResourceState): IndexEntry => ({
  provider: row.provider,
  thread: row.thread,
  ...(row.kinds === undefined ? {} : { kinds: row.kinds }),
  screens: row.screens,
  ...(row.outsiders === true ? { outsiders: true as const } : {}),
  ...(row.self === undefined ? {} : { self: row.self }),
  ...(row.unmatched === true ? { unmatched: true as const } : {}),
  userId: row.userId,
  orgId: row.orgId,
  ...(row.tenantId === undefined ? {} : { tenantId: row.tenantId })
});

/** A refusal, or the session `subscribe` writes for. */
function hearer(ctx: BlockContext, target: SubscribeTarget | undefined): { refused: string } | { sessionId: string; worker: string; taskId?: string } {
  if (target !== undefined) return { sessionId: target.sessionId, worker: target.worker, ...(target.taskId === undefined ? {} : { taskId: target.taskId }) };
  const state = (ctx.session.state ?? {}) as Record<string, unknown>;
  const worker = state[WORKER_ID_STATE_KEY];
  if (typeof worker !== "string" || worker.length === 0) return { refused: "not_a_worker: this session runs no worker, so it can't subscribe." };
  const taskId = state[TASK_ID_STATE_KEY];
  return { sessionId: ctx.session.identity.id, worker, ...(typeof taskId === "string" && taskId.length > 0 ? { taskId } : {}) };
}

/**
 * Subscribe a session to one thread: the running one, or `target`.
 *
 * @param providers The providers a session may subscribe on.
 * @param target The session that hears, when it isn't the running one.
 * @param write The subscription's id and maker, from server code.
 */
export async function subscribe(
  ctx: BlockContext,
  providers: readonly SubscriptionProvider[],
  input: SubscribeInput,
  target?: SubscribeTarget,
  write: SubscribeWrite = {}
): Promise<SubscribeOutcome> {
  return writeSubscription(ctx, providers, input, target, write, "fresh");
}

/**
 * Resume a paused subscription from its saved state: `subscribe`'s write, taken only while it
 * is still paused. Not on the package's surface: the routine verbs call it.
 */
export async function resumeSubscription(
  ctx: BlockContext,
  providers: readonly SubscriptionProvider[],
  input: SubscribeInput,
  target: SubscribeTarget,
  write: SubscribeWrite
): Promise<SubscribeOutcome> {
  return writeSubscription(ctx, providers, input, target, write, "resume");
}

/**
 * A seed's write of a declared routine: the config's fields, over the saved subscription's on,
 * paused or ended state (a new one is on). Not on the package's surface: the routine seed calls it.
 */
export async function seedSubscription(
  ctx: BlockContext,
  providers: readonly SubscriptionProvider[],
  input: SubscribeInput,
  target: SubscribeTarget,
  write: SubscribeWrite
): Promise<SubscribeOutcome> {
  return writeSubscription(ctx, providers, input, target, write, "keep");
}

/** The one write behind `subscribe` and `resumeSubscription`. */
async function writeSubscription(
  ctx: BlockContext,
  providers: readonly SubscriptionProvider[],
  input: SubscribeInput,
  target: SubscribeTarget | undefined,
  write: SubscribeWrite,
  life: Life
): Promise<SubscribeOutcome> {
  const hears = hearer(ctx, target);
  if ("refused" in hears) return hears;
  const thread = input.thread.trim();
  if (thread.length === 0) return { refused: "no_thread: name one thread key to follow; a sentence alone selects nothing." };
  const provider = providers.find((p) => p.provider === input.provider);
  if (provider === undefined) {
    return { refused: `no_provider: "${input.provider}" isn't one you can subscribe on. You can: ${providers.map((p) => p.provider).join(", ") || "none"}.` };
  }
  if (!thread.startsWith(`${provider.provider}:`)) {
    return { refused: `wrong_provider: a ${provider.provider} thread key starts with "${provider.provider}:".` };
  }
  if (!(await provider.canRead(thread, ctx))) return { refused: `not_readable: you can't read "${thread}", so you can't follow it.` };

  const identity = ctx.session.identity as { id: string; userId?: string; orgId?: string; tenantId?: string };
  if (identity.userId === undefined || identity.orgId === undefined) {
    return { refused: "no_identity: a subscription needs a session that names its user and organization." };
  }
  // The flow a delivery lands on: the target's, or the session's own record, as the engine reads it for this user.
  let flowKind = target?.flow;
  if (flowKind === undefined) {
    const view = await requestHostOf(ctx)?.sessions?.read(identity.id);
    flowKind = view === undefined ? undefined : (view.flowId ?? view.flowKind);
  }
  // Only a coordinator reads `inferredWork`, so only its session hears what nobody else heard.
  if (input.unmatched === true && flowKind !== COORDINATOR_FLOW) {
    return { refused: "not_a_coordinator: only a coordinator's conversation can hear what no other subscription heard (unmatched)." };
  }
  const tenantId = target === undefined ? tenantOf(ctx) : target.tenantId;
  const id = write.id ?? (await subscriptionIdOf(hears.sessionId, provider.provider, thread, tenantId));
  const self = await provider.self?.(ctx);
  const at = Date.now();
  const row: SubscriptionResourceState = {
    id,
    provider: provider.provider,
    thread,
    ...(input.kinds === undefined ? {} : { kinds: input.kinds }),
    screens: input.screens ?? [],
    ...(input.outsiders === true ? { outsiders: true as const } : {}),
    ...(self === undefined ? {} : { self }),
    ...(input.unmatched === true ? { unmatched: true as const } : {}),
    interest: input.interest,
    sessionId: hears.sessionId,
    flow: flowKind ?? "",
    worker: hears.worker,
    ...(hears.taskId === undefined ? {} : { taskId: hears.taskId }),
    userId: identity.userId,
    orgId: identity.orgId,
    // The tenant its session runs under, so its deliveries reach that session.
    ...(tenantId === undefined ? {} : { tenantId }),
    enabled: true,
    at,
    ...(write.madeBy === undefined ? {} : { madeBy: write.madeBy })
  };
  if (row.flow.length === 0) return { refused: "no_session: this host can't read this session's record, so nothing could be delivered to it." };
  const saved = subscriptionsOf(ctx);
  const ref = life === "resume" ? await saved.getOptional(id) : await saved.getOrCreate(id, row);
  if (ref === undefined) return { refused: "ended: it no longer exists." };
  // One committed transition: what it replaced, and what it left.
  const moved = await retryOnConflict(() =>
    updateStateWith<SubscriptionResourceState, { prior: SubscriptionResourceState; now: SubscriptionResourceState }>(ref, (current) => {
      const next = nextEntry(current, row, life);
      return { state: next ?? current, result: { prior: current, now: next ?? current } };
    })
  );
  if (moved === undefined) return { refused: "ended: it no longer exists." };
  if (life === "resume" && !moved.now.enabled) {
    return isPaused(moved.now)
      ? { refused: "changed: its settings changed while it was resuming, so it stays paused. Resume it again." }
      : { refused: "ended: it ended while it was resuming, so it stays ended." };
  }
  await subscriptionCursorsOf(ctx).getOrCreate(id, { seen: [], window: { start: 0, sent: 0 }, held: 0 });
  // The same id on a new thread (a declared routine's entry changed): the thread the write replaced
  // loses its entry, or its stale screen settings keep nominating it there.
  if (moved.prior.thread !== moved.now.thread) await dropFromIndex(ctx, moved.prior.thread, id);
  await syncIndex(ctx, moved.now);
  return { id };
}

/**
 * The thread index entry for `subscription`, as saved: there if and only if it is on. An end that
 * lands between this write and the index's is read back committed, and takes the entry out.
 */
export async function syncIndex(ctx: BlockContext, subscription: SubscriptionResourceState): Promise<void> {
  if (!subscription.enabled) {
    await dropFromIndex(ctx, subscription.thread, subscription.id);
    return;
  }
  // Other users' subscribes to this thread may write at once: `updateState`
  // runs again against the subscription that won, so every entry lands.
  const index = await subscriptionIndexOf(ctx).getOrCreate(indexKeyOf(subscription.thread), { subscriptions: {} });
  const slot = indexSlotOf(subscription.userId, subscription.id);
  await retryOnConflict(() =>
    index.updateState((current) => {
      // A bare-id entry of this owner's, from before slots named one, gives way to the slot.
      const { [subscription.id]: legacy, ...rest } = current.subscriptions;
      const others = legacy !== undefined && legacy.userId !== subscription.userId ? { [subscription.id]: legacy } : {};
      return { subscriptions: { ...rest, ...others, [slot]: indexEntryOf(subscription) } };
    })
  );
  const ref = await subscriptionsOf(ctx).getOptional(subscription.id);
  const now = ref === undefined ? undefined : await readCommitted(ref, (committed) => committed);
  if (now === undefined || !now.enabled || now.thread !== subscription.thread) await dropFromIndex(ctx, subscription.thread, subscription.id);
}

/**
 * Take the running user's subscription `id` out of `thread`'s index entry: its slot, and a bare-id
 * entry of theirs written before slots named an owner. Another user's entry under the same id
 * (a declared routine's `cfg_` id) stays.
 */
export async function dropFromIndex(ctx: BlockContext, thread: string, id: string): Promise<void> {
  const userId = (ctx.session.identity as { userId?: string }).userId;
  if (userId === undefined) return;
  const slot = indexSlotOf(userId, id);
  const mine = (subscriptions: Record<string, IndexEntry>) => subscriptions[slot] !== undefined || subscriptions[id]?.userId === userId;
  const index = await subscriptionIndexOf(ctx).getOptional(indexKeyOf(thread));
  if (index === undefined || !mine(index.state.subscriptions)) return;
  await retryOnConflict(() =>
    index.updateState((current) => {
      const { [slot]: _gone, ...rest } = current.subscriptions;
      if (rest[id]?.userId === userId) delete rest[id];
      return { subscriptions: rest };
    })
  );
}

/** Whether `subscription` is paused: off, with the one end a resume undoes. */
export const isPaused = (subscription: SubscriptionResourceState): boolean => !subscription.enabled && subscription.endedReason === "paused";

/**
 * End one of the running user's subscriptions, as saved: off,
 * out of the index. A pause ends only an enabled one; any other end ends an
 * enabled or a paused one; an ended one stays as it ended.
 *
 * @returns Whether it was live.
 */
export async function unsubscribe(ctx: BlockContext, id: string, reason: SubscriptionEnd): Promise<boolean> {
  return (await endSubscription(ctx, id, reason)) === "enabled";
}

/** {@link unsubscribe}, answering what the subscription was when the end applied, or `undefined` when it didn't. */
async function endSubscription(ctx: BlockContext, id: string, reason: SubscriptionEnd): Promise<"enabled" | "paused" | undefined> {
  const ref = await subscriptionsOf(ctx).getOptional(id);
  if (ref === undefined) return undefined;
  const at = Date.now();
  const outcome = await retryOnConflict(() =>
    updateStateWith<SubscriptionResourceState, { was: "enabled" | "paused" | undefined; thread: string }>(ref, (current) => {
      const next = endedEntry(current, reason, at);
      return { state: next ?? current, result: { was: next === undefined ? undefined : current.enabled ? "enabled" : "paused", thread: current.thread } };
    })
  );
  // Out of the index even when the row was already off: a stop between the two writes leaves it there.
  await dropFromIndex(ctx, outcome?.thread ?? ref.state.thread, id);
  return outcome?.was;
}

/**
 * End the live and paused subscriptions a task's session made, when the task
 * failed or was cancelled (ER-7 as amended): a paused one ends too, so no
 * resume brings back a failed task's. A completed task's stay: its session
 * keeps hearing its thread until the thread closes.
 */
export async function endTaskSubscriptions(ctx: BlockContext, taskId: string, ending: "errored" | "cancelled"): Promise<number> {
  const reason: SubscriptionEnd = ending === "errored" ? "task_errored" : "task_cancelled";
  let ended = 0;
  // Every subscription in the cell: the collection filters by key prefix only,
  // and a subscription's key names its session and thread, not its task.
  for (const ref of await subscriptionsOf(ctx).list()) {
    if (ref.state.taskId !== taskId) continue;
    // Decided on the saved subscription, whatever this request's snapshot says.
    if ((await endSubscription(ctx, ref.state.id, reason)) !== undefined) ended += 1;
  }
  return ended;
}
