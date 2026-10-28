/**
 * The one answer a transport route gives a caller whose dispatch the
 * concurrency arbiter refused under `reject`.
 *
 * A refusal reaches a route through the handle's `accepted`, on every
 * backend: the host takes the place only after the caller's ownership has been
 * checked (FIX-1837). Routes also call this from the `catch` around
 * `host.dispatch`, so a refusal thrown there could not get a different answer
 * for the same duplicate.
 */
import { jsonResponse } from "./route-utils";
import { ConcurrencyRejectedError } from "../transports/errors";

/**
 * The response for a `reject` refusal, or `undefined` when `error` is not one.
 *
 * - `action` — 409 naming the in-flight request, so a client may tail the
 *   surviving request instead of retrying.
 * - `webhook` — `200 { status: "skipped" }`: the provider is told the event
 *   was handled, so it does not redeliver the duplicate a 4xx/5xx would invite.
 */
export function concurrencyRefusalResponse(
  error: unknown,
  route: "action" | "webhook"
): Response | undefined {
  if (!(error instanceof ConcurrencyRejectedError)) return undefined;
  if (route === "webhook") {
    return jsonResponse(200, {
      status: "skipped",
      reason: "in_flight",
      requestId: error.inFlightRequestId
    });
  }
  return jsonResponse(409, {
    error: "ConcurrencyRejected",
    message: error.message,
    requestId: error.inFlightRequestId
  });
}
