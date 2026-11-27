// FIX-2942 D1; BP-031.
/**
 * Whether a run was started by an outside delivery (a webhook), directly or
 * through the runs that delivery fires, and the **one** reader allowed to
 * trust the mark.
 *
 * A webhook delivery reaches its worker through runs dispatched as
 * `internal`: the service's routing and each owner run it fires
 * (`durability/owner-runs.ts`). The `webhook` source never reaches those runs,
 * so the delivery's origin rides beside it, stamped by the server on every
 * run the delivery fires and on every dispatch such a run makes.
 *
 * Where it rides: the run's `metadata`, under {@link DELIVERY_ORIGIN_KEY}. The
 * bag is caller-shaped on a caller-facing source (the HTTP action route spreads
 * a body's `metadata` into it), so the mark is read **only** under a
 * framework-stamped source (`internal`, `task`), whose top-level metadata the
 * server assembles whole, never from a caller. That is the rule
 * `dispatch-metadata.ts` applies to the dispatch stamp, and it is what lets the
 * mark survive a job queue and a recovery the way the source does.
 *
 * The mark follows dispatches, not data: a task a marked run files in its own
 * session, or the wake a settle starts, is not marked.
 */
import { INTERNAL_SOURCE, TASK_SOURCE, WEBHOOK_SOURCE } from "./transport-sources";

/** Where an outside delivery that started a run came from. One kind today. */
export type DeliveryOrigin = "webhook";

/** The metadata key the server stamps the origin under, on a framework-stamped source only. */
export const DELIVERY_ORIGIN_KEY = "deliveryOrigin";

/**
 * The run's delivery origin: `"webhook"` for a run the webhook transport
 * started, or an `internal` / `task` run the server stamped as fired by one;
 * `undefined` for every other run, including a caller whose metadata names an
 * origin.
 */
export function readDeliveryOrigin(source: string | undefined, metadata: unknown): DeliveryOrigin | undefined {
  if (source === WEBHOOK_SOURCE) return "webhook";
  if (source !== INTERNAL_SOURCE && source !== TASK_SOURCE) return undefined;
  const origin = (metadata as Record<string, unknown> | undefined)?.[DELIVERY_ORIGIN_KEY];
  return origin === "webhook" ? origin : undefined;
}

/** The metadata entry that stamps `origin` on a framework-stamped dispatch; empty when there is none. */
export function deliveryOriginMetadata(origin: DeliveryOrigin | undefined): Record<string, DeliveryOrigin> {
  return origin === undefined ? {} : { [DELIVERY_ORIGIN_KEY]: origin };
}
