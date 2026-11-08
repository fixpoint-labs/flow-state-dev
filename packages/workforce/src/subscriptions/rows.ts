// FIX-2534.
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

/** The most terms a listed screen carries. */
export const MAX_SCREEN_TERMS = 20;

const terms = z.array(z.string().min(1).max(100)).min(1).max(MAX_SCREEN_TERMS);

/**
 * A screen a subscription lists (D1). `sender` and `own` always run and are
 * not listed. **Pinned**: saved subscriptions carry these kind names.
 *
 * - `labels`: the event carries at least one of these labels.
 * - `words`: the event's title or text contains at least one of these words, ignoring case.
 * - `allow`: the event's sender is one of these ids.
 */
export const listedScreenSchema = z.discriminatedUnion("screen", [
  z.object({ screen: z.literal("labels"), any: terms }).strict(),
  z.object({ screen: z.literal("words"), any: terms }).strict(),
  z.object({ screen: z.literal("allow"), ids: terms }).strict()
]);

export type ListedScreen = z.infer<typeof listedScreenSchema>;

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
  self: z.string().min(1).optional()
});

/** One subscription. Server-written: the session, worker, task and user come from the subscribing turn, never from the tool's input. */
export const subscriptionResourceStateSchema = screenSettingsSchema.extend({
  id: z.string().min(1),
  /** The sentence the subscriber gave: kept, for the screens a later issue adds. */
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
  /** Why it ended: `unsubscribed`, `thread_closed`, `task_errored`, `task_cancelled`. */
  endedReason: z.string().optional(),
  endedAt: z.number().optional(),
  at: z.number()
});

export type SubscriptionResourceState = z.infer<typeof subscriptionResourceStateSchema>;

/** The most objects a cursor remembers; the oldest are forgotten first. */
export const MAX_CURSOR_OBJECTS = 500;

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
  inFlight: z.array(z.tuple([z.string(), z.number(), z.number()])).default([])
});

export type SubscriptionCursor = z.infer<typeof subscriptionCursorSchema>;

/** One subscription, as the thread index names it: who owns it, and its screen settings. */
export const indexEntrySchema = screenSettingsSchema.extend({
  userId: z.string().min(1),
  orgId: z.string().min(1),
  tenantId: z.string().min(1).optional()
});

export type IndexEntry = z.infer<typeof indexEntrySchema>;

/**
 * One thread's subscriptions, by subscription id. Two users subscribing to one
 * thread at once both land: `updateState` re-runs its updater against the row
 * that won a write race, on every store.
 */
const threadIndexRowSchema = z.object({ subscriptions: z.record(indexEntrySchema).default({}) });

type ThreadIndexRow = z.infer<typeof threadIndexRowSchema>;

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
  stateSchema: threadIndexRowSchema
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
export const subscriptionIndexOf = (ctx: BlockContext) => declared<ThreadIndexRow>(ctx, SUBSCRIPTION_INDEX_RESOURCE);

/** A thread key as an index row's key: one path segment. */
export const indexKeyOf = (thread: string) => encodeURIComponent(thread);

/** A subscription's full storage key, as the host's owner-run check reads it. */
export const subscriptionResourceKey = (id: string) => `${SUBSCRIPTIONS_PATTERN.replace("*", "")}${id}`;
