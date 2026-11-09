// FIX-2536 D1, D2, D3; epic FIX-2471 D10.
/**
 * Polling: one schedule row per user and thread, at
 * `workforce/subscription-polls/*` in the user's cell, keyed by the thread. It
 * fires at the user's fastest enabled subscription's cadence, on that user's
 * credentials, and what it fetches reaches only that user's subscriptions on
 * the thread, through the same screens and delivery as push (ER-4).
 *
 * - **Cadence.** Every `everyMinutes` is one of {@link POLL_CADENCES}; anything
 *   else throws ({@link assertPollCadence}). The row's cron fires every
 *   `everyMinutes`, offset by a minute its key picks, so rows spread over the
 *   hour and one row's fires are exactly `everyMinutes` apart.
 * - **The row's state.** A schedule row (`defineScheduleCollection`), whose
 *   `input` carries the thread and the poll's own mark: `polledThrough`, the
 *   ETags, and the deliveries it still owes (D2). Not a subscription row:
 *   only `subscribe` and `unsubscribe` write those (ER-5).
 * - **Its life.** `subscribe` creates it or speeds it up ({@link ensurePollRow});
 *   a fire that finds no enabled subscription on the thread turns it off.
 *
 * An app polls by building one {@link subscriptionPolling} from its schedule
 * index and handing it to the service flow and to whatever subscribes
 * (`subscriptionTools`, `followPullRequest`, the config seed). One index is
 * one polling, so every flow that declares it declares the same collection.
 */
import type { BlockContext, ResourceCollectionRef } from "@flow-state-dev/core/types";
import { defineScheduleCollection, type ScheduleCollectionState, type ScheduleIndex } from "@flow-state-dev/scheduled/collection";
import { z } from "zod";
import { SUBSCRIPTION_POLL_HANDLER, SUBSCRIPTION_POLLS_PATTERN, SUBSCRIPTION_POLLS_RESOURCE } from "./keys";
import { indexKeyOf } from "./rows";

/** The cadences a subscription may poll at, in minutes. Five is the floor (epic D10). **Pinned.** */
export const POLL_CADENCES = [5, 10, 15, 20, 30, 60] as const;

/** The cadence a subscription that names none polls at, unless the app names another. */
export const DEFAULT_POLL_MINUTES = 5;

/** Polls a fire may still owe a delivery before it gives that event up (D2). */
export const POLL_GIVE_UP_AFTER = 3;

/** Throw unless `minutes` is one of {@link POLL_CADENCES}. */
export function assertPollCadence(minutes: number, where: string): void {
  if (!(POLL_CADENCES as readonly number[]).includes(minutes)) {
    throw new Error(`${where}: everyMinutes must be one of ${POLL_CADENCES.join(", ")}; got ${minutes}.`);
  }
}

/** A small, stable number from a key, for a row's minute offset. */
function offsetOf(key: string, minutes: number): number {
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % minutes;
}

/** The cron a row keyed `key` fires on every `minutes`: offset by its key, so its fires are exactly `minutes` apart. */
export function pollCron(key: string, minutes: number): string {
  assertPollCadence(minutes, "pollCron");
  const offset = offsetOf(key, minutes);
  return minutes === 60 ? `${offset} * * * *` : `${offset}/${minutes} * * * *`;
}

/** A thread's poll row key: the thread, as one path segment. */
export const pollKeyOf = (thread: string) => indexKeyOf(thread);

/** What a poll row's `input` holds: the thread, and the poll's own mark (D2). */
export const pollRowInputSchema = z.object({
  /** The row's own key, so its fire reads and writes the row it was dispatched for. */
  key: z.string().min(1).optional(),
  provider: z.string().min(1),
  thread: z.string().min(1),
  /** The cadence it fires at, in minutes. */
  everyMinutes: z.number().int().positive(),
  /** Fetch from here next, in ms: the time of the oldest event any subscription still owes, else the last poll's end. */
  polledThrough: z.number().optional(),
  /** The provider's validators from the last poll, sent only while no delivery is owed. */
  etags: z.record(z.string()).optional(),
  /** Deliveries the poll still owes, as `[subscription, object, version, polls, at]`: given up after {@link POLL_GIVE_UP_AFTER}. */
  owed: z.array(z.tuple([z.string(), z.string(), z.number(), z.number(), z.number()])).optional(),
  /** What this fire's fetch reached, applied by its last step: its end and validators. */
  fetched: z.object({ through: z.number(), etags: z.record(z.string()).optional() }).optional()
});

export type PollRowInput = z.infer<typeof pollRowInputSchema>;

/** A poll row as the schedule collection stores it, its `input` typed. */
export type PollRow = Omit<ScheduleCollectionState, "input"> & { input: PollRowInput };

/** What {@link subscriptionPolling} is built with. */
export interface SubscriptionPollingOptions {
  /** The schedule index the rows mirror into, for the tick to claim due rows from. Required: a row no tick finds never fires. */
  readonly index: ScheduleIndex;
  /** The cadence a subscription that names none polls at. One of {@link POLL_CADENCES}; default {@link DEFAULT_POLL_MINUTES}. */
  readonly everyMinutes?: number;
}

/** An app's polling: the poll rows' collection, mirrored into its index, and the default cadence. */
export interface SubscriptionPolling {
  readonly index: ScheduleIndex;
  readonly everyMinutes: number;
  /** The poll rows, for a flow's (or a block's) `resources`. */
  readonly resources: { readonly [SUBSCRIPTION_POLLS_RESOURCE]: ReturnType<typeof defineScheduleCollection> };
}

const pollings = new WeakMap<ScheduleIndex, SubscriptionPolling>();

/**
 * One app's polling, by its schedule index. The same index gives the same
 * collection, so the service flow and the subscribe tools declare one
 * resource; a second default cadence for one index throws.
 */
export function subscriptionPolling(options: SubscriptionPollingOptions | SubscriptionPolling): SubscriptionPolling {
  if ("resources" in options) return options;
  const everyMinutes = options.everyMinutes ?? DEFAULT_POLL_MINUTES;
  assertPollCadence(everyMinutes, "poll");
  const known = pollings.get(options.index);
  if (known !== undefined) {
    if (known.everyMinutes !== everyMinutes) {
      throw new Error(`poll: this schedule index already polls every ${known.everyMinutes} minutes by default; got ${everyMinutes}.`);
    }
    return known;
  }
  const collection = defineScheduleCollection({ pattern: SUBSCRIPTION_POLLS_PATTERN, index: options.index });
  const polling: SubscriptionPolling = { index: options.index, everyMinutes, resources: { [SUBSCRIPTION_POLLS_RESOURCE]: collection } };
  pollings.set(options.index, polling);
  return polling;
}

/** The running user's poll rows, when the running block declares them. */
export function pollRowsOf(ctx: BlockContext): ResourceCollectionRef<PollRow> | undefined {
  return (ctx.resources as Record<string, unknown> | undefined)?.[SUBSCRIPTION_POLLS_RESOURCE] as ResourceCollectionRef<PollRow> | undefined;
}

/** A poll row's state, for a thread at a cadence. */
export function pollRowState(provider: string, thread: string, everyMinutes: number, input: Partial<PollRowInput> = {}): PollRow {
  return {
    cron: pollCron(input.key ?? pollKeyOf(thread), everyMinutes),
    kind: SUBSCRIPTION_POLL_HANDLER,
    onOverlap: "skip",
    enabled: true,
    description: `Polls ${thread} every ${everyMinutes} minutes.`,
    input: { ...input, key: input.key ?? pollKeyOf(thread), provider, thread, everyMinutes }
  };
}

/**
 * The poll row for the running user's `thread`, live at `everyMinutes` or
 * faster: created when missing or ended (its mark starting now, so it fetches
 * nothing from before), sped up when it polls slower, untouched otherwise.
 * A slower subscription never slows it; its next fire works the cadence out
 * again from every enabled subscription.
 *
 * Does nothing when the running block declares no poll rows (an app that
 * doesn't poll).
 */
export async function ensurePollRow(ctx: BlockContext, provider: string, thread: string, everyMinutes: number): Promise<void> {
  const rows = pollRowsOf(ctx);
  if (rows === undefined) return;
  const key = pollKeyOf(thread);
  const existing = (await rows.getOptional(key))?.state;
  if (existing !== undefined && existing.enabled !== false && existing.input.everyMinutes <= everyMinutes) return;
  const input = existing !== undefined && existing.enabled !== false ? existing.input : { polledThrough: Date.now() };
  await rows.create(key, pollRowState(provider, thread, everyMinutes, { ...input, key }), { replace: true });
}
