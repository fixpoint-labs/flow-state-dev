// FIX-2536 D1, D2, D3; epic FIX-2471 D10.
/**
 * Polling: one schedule resource per user and thread, at
 * `workforce/subscription-polls/*` in the user's cell, keyed by the thread. It
 * fires at the user's fastest enabled subscription's cadence, on that user's
 * credentials, and what it fetches reaches only that user's subscriptions on
 * the thread, through the same screens and delivery as push (ER-4).
 *
 * - **Cadence.** Every `everyMinutes` is one of {@link ROUTINE_CADENCES}; anything
 *   else throws ({@link assertPollCadence}). The schedule's cron fires every
 *   `everyMinutes`, offset by a minute its key picks, so polls spread over the
 *   hour and one poll's fires are exactly `everyMinutes` apart.
 * - **What it stores.** A schedule resource (`defineScheduleCollection`), whose
 *   `input` carries the thread and the poll's own mark: `polledThrough`, the
 *   ETags, and the deliveries it still owes (D2). Not a subscription:
 *   only `subscribe` and `unsubscribe` write those (ER-5).
 * - **Its life.** `subscribe` creates it or speeds it up ({@link ensurePollSchedule});
 *   a fire that finds no enabled subscription on the thread turns it off, and
 *   ends a declared routine's subscription whose entry left config.
 *
 * An app polls by giving `hireWorkforce(installation, { routines: { poll: { index } } })`
 * a schedule index of its own (one index ticks one flow, and the clock
 * routines' index is the roster's), and turning `poll` on in its service flow.
 * Each installation has one {@link installationPolling}: one poll collection,
 * declared when its flows are built and mirrored into that index once
 * `hireWorkforce` has run, so every flow that declares it declares the same one.
 */
import type { BlockContext, ResourceCollectionRef } from "@flow-state-dev/core/types";
import { defineScheduleCollection, type ScheduleCollectionState, type ScheduleIndex } from "@flow-state-dev/scheduled/collection";
import { z } from "zod";
import { ROUTINE_CADENCES } from "../routines/keys";
import { SUBSCRIPTION_POLL_HANDLER, SUBSCRIPTION_POLLS_PATTERN, SUBSCRIPTION_POLLS_RESOURCE } from "./keys";
import { indexKeyOf } from "./rows";
import { routinePollIndexOf, routinePollMinutesOf, routinePollingOn } from "../routines/routines-options";


/** Polls a fire may still owe a delivery before it gives that event up (D2). */
export const POLL_GIVE_UP_AFTER = 3;

/** Throw unless `minutes` is one of {@link ROUTINE_CADENCES}. */
export function assertPollCadence(minutes: number, where: string): void {
  if (!(ROUTINE_CADENCES as readonly number[]).includes(minutes)) {
    throw new Error(`${where}: everyMinutes must be one of ${ROUTINE_CADENCES.join(", ")}; got ${minutes}.`);
  }
}

/** A small, stable number from a key, for a poll's minute offset. */
function offsetOf(key: string, minutes: number): number {
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % minutes;
}

/** The cron a poll keyed `key` fires on every `minutes`: offset by its key, so its fires are exactly `minutes` apart. */
function pollCron(key: string, minutes: number): string {
  assertPollCadence(minutes, "pollCron");
  const offset = offsetOf(key, minutes);
  return minutes === 60 ? `${offset} * * * *` : `${offset}/${minutes} * * * *`;
}

/** A thread's poll schedule key: the thread, as one path segment. */
export const pollKeyOf = (thread: string) => indexKeyOf(thread);

/** What a poll schedule's `input` holds: the thread, and the poll's own mark (D2). */
export const pollScheduleInputSchema = z.object({
  /** The poll's own key, so its fire reads and writes the poll it was dispatched for. */
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
  fetched: z.object({ through: z.number(), etags: z.record(z.string()).optional(), incomplete: z.literal(true).optional() }).optional()
});

export type PollScheduleInput = z.infer<typeof pollScheduleInputSchema>;

/** A poll schedule as the schedule collection stores it, its `input` typed; a poll carries no `metadata`. */
export type PollScheduleState = Omit<ScheduleCollectionState, "input" | "metadata"> & { input: PollScheduleInput };

/** An installation's polling: the poll schedules' collection, mirrored into its index, and the default cadence. */
export interface SubscriptionPolling {
  readonly index: ScheduleIndex;
  /** The cadence a subscription that names none polls at: `routines.poll.everyMinutes`, else 5. */
  readonly everyMinutes: number;
  /** The poll schedules, for a flow's (or a block's) `resources`. */
  readonly resources: { readonly [SUBSCRIPTION_POLLS_RESOURCE]: ReturnType<typeof defineScheduleCollection> };
}

const pollings = new WeakMap<object, SubscriptionPolling>();

/**
 * `installation`'s polling: one per installation, so the service flow, the
 * routine verbs and the roster declare one collection. Its index and cadence
 * are the ones `hireWorkforce`'s `routines.poll` was given, read when a poll
 * schedule is written: a flow is built before `hireWorkforce` runs.
 */
export function installationPolling(installation: object): SubscriptionPolling {
  const known = pollings.get(installation);
  if (known !== undefined) return known;
  const index = routinePollIndexOf(installation);
  // Never isolated: the fire resolves a poll from the user's shared cell, whatever the subscribing flow isolates.
  const collection = defineScheduleCollection({ pattern: SUBSCRIPTION_POLLS_PATTERN, index, flowIsolation: false });
  const polling: SubscriptionPolling = {
    index,
    get everyMinutes() {
      return routinePollMinutesOf(installation);
    },
    resources: { [SUBSCRIPTION_POLLS_RESOURCE]: collection }
  };
  pollings.set(installation, polling);
  return polling;
}

/** `installation`'s polling once its `hireWorkforce` turned it on (`routines.poll`), and otherwise `undefined`: read when a write runs. */
export function pollingOn(installation: object): SubscriptionPolling | undefined {
  return routinePollingOn(installation) ? installationPolling(installation) : undefined;
}

/** The running user's poll schedules, when the running block declares them. */
export function pollSchedulesOf(ctx: BlockContext): ResourceCollectionRef<PollScheduleState> | undefined {
  return (ctx.resources as Record<string, unknown> | undefined)?.[SUBSCRIPTION_POLLS_RESOURCE] as ResourceCollectionRef<PollScheduleState> | undefined;
}

/** A poll schedule's state, for a thread at a cadence. */
export function pollScheduleState(provider: string, thread: string, everyMinutes: number, input: Partial<PollScheduleInput> = {}): PollScheduleState {
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
 * The poll schedule for the running user's `thread`, live at `everyMinutes` or
 * faster: created when missing or ended (its mark starting now, so it fetches
 * nothing from before), sped up when it polls slower, untouched otherwise.
 * A slower subscription never slows it; its next fire works the cadence out
 * again from every enabled subscription.
 *
 * Does nothing when the running block declares no poll schedules (an app that
 * doesn't poll).
 */
export async function ensurePollSchedule(ctx: BlockContext, provider: string, thread: string, everyMinutes: number): Promise<void> {
  const polls = pollSchedulesOf(ctx);
  if (polls === undefined) return;
  const key = pollKeyOf(thread);
  const existing = (await polls.getOptional(key))?.state;
  if (existing !== undefined && existing.enabled !== false && existing.input.everyMinutes <= everyMinutes) return;
  const input = existing !== undefined && existing.enabled !== false ? existing.input : { polledThrough: Date.now() };
  await polls.create(key, pollScheduleState(provider, thread, everyMinutes, { ...input, key }), { replace: true });
}
