// FIX-2534; FIX-2537.
/**
 * Subscriptions' rows: the subscription, its cursor, and the thread
 * index entry, with the collections they live in and how a block reaches them.
 *
 * - **A subscription** is its user's (epic D5), written only by `subscribe`
 *   and `unsubscribe` (ER-5). It names the session that hears, the thread it
 *   follows, the kinds it hears, and the screens it listed (D1). An ended one
 *   keeps its row with `enabled: false`, which the host's owner-run check
 *   reads as off.
 * - **A cursor** is the subscription's delivery state, written by delivery:
 *   the last version it saw of each object (a redelivery or re-poll stops
 *   here, epic D4) and its cap's count. Its own row, since ER-5 lets only the
 *   two tools write the subscription.
 * - **The thread index** is one org-scoped row per thread key. It mirrors what
 *   the service's screens read of each subscription that follows the thread,
 *   so the service runs its screens without reading any user's cell. It only
 *   nominates: a delivery starts from the subscription's own row, checked by
 *   the host. Server-only.
 */
import { defineResourceCollection } from "@flow-state-dev/core";
import type { BlockContext, JsonObject, ResourceCollectionRef } from "@flow-state-dev/core/types";
import { z } from "zod";
import {
  SUBSCRIPTION_CURSORS_PATTERN,
  SUBSCRIPTION_CURSORS_RESOURCE,
  SUBSCRIPTION_INDEX_PATTERN,
  SUBSCRIPTION_INDEX_RESOURCE,
  SUBSCRIPTIONS_PATTERN,
  SUBSCRIPTIONS_RESOURCE
} from "./keys";
import { routineMakerSchema } from "../routines/listed-routine";

/** The most terms a listed screen carries. */
const MAX_SCREEN_TERMS = 20;

const terms = z.array(z.string().min(1).max(100)).min(1).max(MAX_SCREEN_TERMS);

/**
 * A screen a subscription lists (D1). `sender` and `own` always run and are
 * not listed. **Pinned**: saved subscriptions carry these kind names.
 *
 * - `labels`: the event carries at least one of these labels.
 * - `words`: the event's title or text contains at least one of these words, ignoring case.
 * - `allow`: the event's sender is one of these ids.
 * - `custom`: the app's own screen of this name, declared once on the provider (D2).
 * - `interest`: a model judges whether the event matches the subscription's
 *   sentence, after every code screen passed it (D1).
 */
export const listedScreenSchema = z.discriminatedUnion("screen", [
  z.object({ screen: z.literal("labels"), any: terms }).strict(),
  z.object({ screen: z.literal("words"), any: terms }).strict(),
  z.object({ screen: z.literal("allow"), ids: terms }).strict(),
  z.object({ screen: z.literal("custom"), name: z.string().min(1).max(100) }).strict(),
  z.object({ screen: z.literal("interest") }).strict()
]);

/** The five screen kinds, in the order the chain runs them. **Pinned**. */
export const SCREEN_KINDS = ["sender", "own", "labels", "words", "allow"] as const;

export type ScreenKind = (typeof SCREEN_KINDS)[number];

/** What the service's screens read of one subscription: in its row, and mirrored in the thread index. */
const screenSettingsSchema = z.object({
  provider: z.string().min(1),
  thread: z.string().min(1),
  kinds: z.array(z.string().min(1)).optional(),
  screens: z.array(listedScreenSchema).default([]),
  /** The subscription takes outsiders' events (epic Q1's per-subscription opt-in). */
  outsiders: z.literal(true).optional(),
  /** The subscriber's own id at the provider, for `own`. */
  self: z.string().min(1).optional(),
  /**
   * The subscription hears only what no other subscription heard: an event
   * every ordinary subscription refused on content, of a kind the app
   * forwards. Only a coordinator's session makes one.
   */
  unmatched: z.literal(true).optional()
});

/** One subscription. Server-written: the session, worker, task and user come from the subscribing turn, never from the tool's input. */
export const subscriptionResourceStateSchema = screenSettingsSchema.extend({
  id: z.string().min(1),
  /** The sentence the subscriber gave. The `interest` screen quotes it to the model, when listed. */
  interest: z.string(),
  /** The session that hears. */
  sessionId: z.string().min(1),
  /** The flow that session runs on. */
  flow: z.string().min(1),
  /** The worker that session runs. */
  worker: z.string().min(1),
  /** The task that session works, when it is a task's session: its failure or cancel ends this subscription. */
  taskId: z.string().min(1).optional(),
  userId: z.string().min(1),
  /** The organization it was made in: the host's owner-run check reads it. */
  orgId: z.string().min(1),
  /** The tenant the subscribing session ran under, when there was one: its deliveries run under it, and the host's owner-run check reads it. */
  tenantId: z.string().min(1).optional(),
  /** `false` once it ended. The host's owner-run check reads it as off. */
  enabled: z.boolean(),
  // FIX-2536 D3; BP-030.
  /** How often, in minutes, it is polled when its app polls: one of `ROUTINE_CADENCES`. Absent, the app's default. */
  everyMinutes: z.number().int().positive().optional(),
  /**
   * Why it ended: `unsubscribed`, `thread_closed`, `task_errored`,
   * `task_cancelled`, `config_removed`, or `paused`, the one end a resume undoes.
   */
  endedReason: z.string().optional(),
  endedAt: z.number().optional(),
  at: z.number(),
  /** Who made it, as the routine list names them. Optional: one saved before it names none. */
  madeBy: routineMakerSchema.optional()
});

export type SubscriptionResourceState = z.infer<typeof subscriptionResourceStateSchema>;

/** The most objects a cursor remembers; the oldest are forgotten first. */
export const MAX_CURSOR_OBJECTS = 500;

/** The most versions a cursor's `screened` keeps; the oldest are forgotten first. */
export const MAX_SCREENED = 500;

/** One subscription's delivery state. */
export const subscriptionCursorSchema = z.object({
  /** The last version delivered or passed over, by object id, oldest first. */
  seen: z.array(z.tuple([z.string(), z.number()])).default([]),
  /** The cap's window: when it began and how many went out in it. */
  window: z.object({ start: z.number(), sent: z.number().int().min(0) }).default({ start: 0, sent: 0 }),
  /** Events the cap held since the last one that went out. */
  held: z.number().int().min(0).default(0),
  /**
   * The objects a delivery took a slot for and is still sending, as
   * `[id, version, since]`: a copy of one stops here, without a slot and
   * without marking it seen. One past its lease (a delivery that stopped) no
   * longer counts.
   */
  inFlight: z.array(z.tuple([z.string(), z.number(), z.number()])).default([]),
  // FIX-2536 D2; BP-030.
  /**
   * The versions a poll's screens refused or held for this subscription, or
   * gave up on, as `[id, version, at]` (`at` the event's own time), oldest
   * first: a later poll that fetches one again drops it without judging it
   * again. Only a poll writes it; capped at {@link MAX_SCREENED}, and pruned
   * once the poll's mark passes an entry's time.
   */
  screened: z.array(z.tuple([z.string(), z.number(), z.number()])).default([])
});

export type SubscriptionCursor = z.infer<typeof subscriptionCursorSchema>;

/** One subscription, as the thread index names it: who owns it, and its screen settings. */
export const indexEntrySchema = screenSettingsSchema.extend({
  userId: z.string().min(1),
  orgId: z.string().min(1),
  tenantId: z.string().min(1).optional(),
  /**
   * The subscription's sentence, mirrored only for a subscription that lists
   * `interest`. An entry without one reads as not listing it (an entry from
   * before the screen has none).
   */
  interest: z.string().optional()
});

export type IndexEntry = z.infer<typeof indexEntrySchema>;

/**
 * One thread's subscriptions, by subscription id. Two users subscribing to one
 * thread at once both land: `updateState` re-runs its updater against the row
 * that won a write race, on every store.
 */
const threadIndexResourceStateSchema = z.object({ subscriptions: z.record(indexEntrySchema).default({}) });

type ThreadIndexResourceState = z.infer<typeof threadIndexResourceStateSchema>;

/** The subscriptions, at `workforce/subscriptions/*` in the user's scope, shared across flows. Server-written. */
const subscriptionsCollection = defineResourceCollection({
  pattern: SUBSCRIPTIONS_PATTERN,
  scope: "user",
  flowIsolation: false,
  prefetchMode: "lazy",
  stateSchema: subscriptionResourceStateSchema
});

/** The cursors, at `workforce/subscription-cursors/*` in the user's scope. Server-only. */
const subscriptionCursorsCollection = defineResourceCollection({
  pattern: SUBSCRIPTION_CURSORS_PATTERN,
  scope: "user",
  flowIsolation: false,
  prefetchMode: "lazy",
  stateSchema: subscriptionCursorSchema
});

/** The thread index, at `workforce/subscription-index/*` in the org's scope. Server-only. */
const subscriptionIndexCollection = defineResourceCollection({
  pattern: SUBSCRIPTION_INDEX_PATTERN,
  scope: "org",
  flowIsolation: false,
  prefetchMode: "lazy",
  stateSchema: threadIndexResourceStateSchema
});

/** The flow resources a flow that subscribes, delivers or ends subscriptions declares. */
export const subscriptionResources = {
  [SUBSCRIPTIONS_RESOURCE]: subscriptionsCollection,
  [SUBSCRIPTION_CURSORS_RESOURCE]: subscriptionCursorsCollection,
  [SUBSCRIPTION_INDEX_RESOURCE]: subscriptionIndexCollection
} as const;

function declared<T extends JsonObject>(ctx: BlockContext, name: string): ResourceCollectionRef<T> {
  const ref = (ctx.resources as Record<string, unknown> | undefined)?.[name];
  if (ref === undefined) {
    throw new Error(`The running block doesn't declare "${name}". Spread \`subscriptionResources\` into its resources.`);
  }
  return ref as unknown as ResourceCollectionRef<T>;
}

/** The running user's subscriptions. */
export const subscriptionsOf = (ctx: BlockContext) => declared<SubscriptionResourceState>(ctx, SUBSCRIPTIONS_RESOURCE);

/** The running user's cursors. */
export const subscriptionCursorsOf = (ctx: BlockContext) => declared<SubscriptionCursor>(ctx, SUBSCRIPTION_CURSORS_RESOURCE);

/** The running org's thread index. */
export const subscriptionIndexOf = (ctx: BlockContext) => declared<ThreadIndexResourceState>(ctx, SUBSCRIPTION_INDEX_RESOURCE);

/** A thread key as an index row's key: one path segment. */
export const indexKeyOf = (thread: string) => encodeURIComponent(thread);

/**
 * A subscription's slot in a thread's index entry: its owner and its id. A declared routine's id
 * (`cfg_…`) is the same for every user who has one, and the thread index is the org's, so the id
 * alone would give two users one slot.
 */
export const indexSlotOf = (userId: string, id: string) => `${encodeURIComponent(userId)}:${id}`;

/**
 * The subscription id a slot names: the id after its owner, or a whole key written before slots
 * named an owner (a bare id).
 */
export function subscriptionIdOfSlot(slot: string, entry: { readonly userId: string }): string {
  const owner = `${encodeURIComponent(entry.userId)}:`;
  return slot.startsWith(owner) ? slot.slice(owner.length) : slot;
}

/** A subscription's full storage key, as the host's owner-run check reads it. */
export const subscriptionResourceKey = (id: string) => `${SUBSCRIPTIONS_PATTERN.replace("*", "")}${id}`;
