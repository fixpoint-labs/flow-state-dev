/**
 * The normalized subscription event (FIX-2534, epic FIX-2471 ER-6): the one
 * shape an outside event takes before a service flow routes it to the
 * sessions that subscribed to one of its threads.
 *
 * Push (a verified webhook, `WebhookInboundEvent`) and poll both map into it;
 * the provider's own `normalize` does the mapping, and the service flow's
 * routing entry takes it as input. It carries what routing and a subscriber
 * read, and nothing of the raw request: no headers, no bytes, a bounded text.
 *
 * - `threads`: the thread keys the event is on, **widest first**
 *   (`github:acme/api`, then `github:acme/api#412`). A subscription names one.
 * - `object`: the thing that changed, and its version. A subscription sees an
 *   object's version once; a session gets it once.
 * - `sender.role`: who sent it, as the provider sees them. `unknown` reads as
 *   an outsider's (the screens fail closed, epic Q1).
 * - `audience`: `private` when the thread is not public. A private event is
 *   checked again, as its subscriber, before it is delivered (ER-4).
 * - `closes`: the last and narrowest of `threads` closed with this event (a PR
 *   merged or closed); the wider ones stay open. The subscriptions to that
 *   thread end, whether or not it reached them (ER-7 as amended).
 */
import { z } from "zod";

/** The most text an event carries. A longer body is cut by the provider's `normalize`, never stored whole. */
export const MAX_SUBSCRIPTION_EVENT_TEXT = 4_000;

/** Who sent an event, as the provider sees them. */
export const SUBSCRIPTION_SENDER_ROLES = ["member", "collaborator", "bot", "outsider", "unknown"] as const;

export type SubscriptionSenderRole = (typeof SUBSCRIPTION_SENDER_ROLES)[number];

/** The normalized event. Strict: a key it doesn't name is refused, so raw request parts can't ride along. */
export const subscriptionEventSchema = z
  .object({
    /** The provider key (`github`, `slack`): a subscription names one. */
    provider: z.string().min(1),
    /** The thread keys the event is on, widest first. */
    threads: z.array(z.string().min(1)).min(1),
    /** What happened (`review`, `check`, `comment`, `message`): a subscription may list the kinds it hears. */
    kind: z.string().min(1),
    /** The object that changed and its version: what a subscription sees once. */
    object: z.object({ id: z.string().min(1), version: z.number().int().min(0) }).strict(),
    sender: z
      .object({ id: z.string().min(1), name: z.string(), role: z.enum(SUBSCRIPTION_SENDER_ROLES) })
      .strict(),
    audience: z.enum(["public", "private"]),
    title: z.string(),
    text: z.string().max(MAX_SUBSCRIPTION_EVENT_TEXT),
    labels: z.array(z.string()),
    url: z.string(),
    /** When the service received it, in ms. */
    received: z.number(),
    /** When it happened at the provider, in ms. */
    at: z.number(),
    /** The provider's delivery id: provenance only, never a dedupe key. */
    deliveryId: z.string().min(1).optional(),
    /** The last and narrowest of `threads` closed with this event. */
    closes: z.literal(true).optional()
  })
  .strict();

export type SubscriptionEvent = z.infer<typeof subscriptionEventSchema>;
