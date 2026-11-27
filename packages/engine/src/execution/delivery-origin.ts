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
 * Where it rides: the run's `metadata`, under `DELIVERY_ORIGIN_KEY`, which is
 * what lets the mark survive a job queue and a recovery the way the source does.
 * Two rules keep it the server's:
 *
 * - It is read **only** under a framework-stamped source (`internal`, `task`),
 *   whose top-level metadata the server assembles whole. The bag is
 *   caller-shaped on a caller-facing source (the HTTP action route spreads a
 *   body's `metadata` into it). The same rule `dispatch-metadata.ts` applies to
 *   the dispatch stamp.
 * - It is honoured only on a run the engine itself started. Those two sources
 *   are not reserved: an app's own code legitimately runs an internal entry
 *   through the public `runAction` (a boot binder, a test harness). So the
 *   public `runAction` and an adapter's `host.dispatch` drop the key, and only
 *   the engine's own paths keep it: a dispatch marked {@link asFrameworkDispatch},
 *   and the in-process runner, recovery and continuation that replay what the
 *   host accepted (`runFrameworkAction`). A caller can neither forge the mark
 *   nor carry one it was not stamped with.
 * - A worker on the other side of an external runner (the BullMQ worker, or
 *   any custom `FlowRunner`'s) replays through the public `runAction`, so its
 *   job's metadata is caller-shaped too. Its origin comes from the request
 *   record the host wrote under the request's id before handing the request
 *   to the runner: `runAction` reads it back from there for a
 *   framework-stamped source, and only there. A job enqueued around the host
 *   has no such record and runs unmarked.
 *
 * The mark follows dispatches, not data: a task a marked run files in its own
 * session, or the wake a settle starts, is not marked.
 */
import { isFrameworkStampedSource, WEBHOOK_SOURCE } from "./transport-sources";

/** Where an outside delivery that started a run came from. One kind today. */
export type DeliveryOrigin = "webhook";

/** The metadata key the server stamps the origin under, on a framework-stamped source only. */
const DELIVERY_ORIGIN_KEY = "deliveryOrigin";

/**
 * The run's delivery origin: `"webhook"` for a run the webhook transport
 * started, or an `internal` / `task` run the server stamped as fired by one;
 * `undefined` for every other run, including a caller whose metadata names an
 * origin.
 */
export function readDeliveryOrigin(source: string | undefined, metadata: unknown): DeliveryOrigin | undefined {
  if (source === WEBHOOK_SOURCE) return "webhook";
  if (!isFrameworkStampedSource(source)) return undefined;
  const origin = (metadata as Record<string, unknown> | undefined)?.[DELIVERY_ORIGIN_KEY];
  return origin === "webhook" ? origin : undefined;
}

/** The metadata entry that stamps `origin` on a framework-stamped dispatch; empty when there is none. */
export function deliveryOriginMetadata(origin: DeliveryOrigin | undefined): Record<string, DeliveryOrigin> {
  return origin === undefined ? {} : { [DELIVERY_ORIGIN_KEY]: origin };
}

/**
 * `metadata` without the origin key: what a public entry point (`runAction`,
 * an adapter's `host.dispatch`) passes on, so a caller cannot write the mark.
 * The same bag when it has no such key.
 */
export function withoutDeliveryOrigin<T extends Record<string, unknown> | undefined>(metadata: T): T {
  if (metadata === undefined || !Object.hasOwn(metadata, DELIVERY_ORIGIN_KEY)) return metadata;
  const { [DELIVERY_ORIGIN_KEY]: _dropped, ...rest } = metadata;
  return rest as T;
}

/**
 * Marks an envelope the engine itself built for `host.dispatch`. A module-local
 * symbol, never registered and never exported: no adapter or request input can
 * produce it.
 */
const FRAMEWORK_DISPATCH = Symbol("frameworkDispatch");

/** `envelope`, marked as the engine's own dispatch, whose origin `host.dispatch` keeps. */
export function asFrameworkDispatch<T extends object>(envelope: T): T {
  return Object.assign(envelope, { [FRAMEWORK_DISPATCH]: true });
}

/** Whether `envelope` is one the engine built and marked with {@link asFrameworkDispatch}. */
export function isFrameworkDispatch(envelope: object): boolean {
  return (envelope as Record<symbol, unknown>)[FRAMEWORK_DISPATCH] === true;
}
