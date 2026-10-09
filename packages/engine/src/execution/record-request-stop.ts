/**
 * The one write that stops a running request: the abort route's, shared with
 * a block's `ctx.session.stopRequest`.
 *
 * Both callers check first that the caller may reach the request (the route by
 * owner and tenant, the session hook by session scope), then hand the record
 * they checked here. Neither re-implements the incarnation fence or the
 * terminal check: a second copy is how one of them would learn to overwrite a
 * finished request.
 */
import { resolveRequestIncarnation } from "../stores/scope-keys";
import type { RequestRecord, RequestStatus, RequestStore } from "../stores/types";
import { abortRequest } from "./abort-registry";
import { stopSuspendedRequest, type SuspendedStopDeps } from "../durability/stop-suspended";

/**
 * What recording a stop came to.
 *
 * - `gone`: the checked request no longer holds its id (deleted, or the id was
 *   taken by another request since the check). Nothing was written.
 * - `finished`: the request had reached a terminal `status`. Nothing was written.
 * - `fired`: the stop is recorded and the request's controller in this process
 *   was fired.
 * - `recorded`: the stop is recorded; the process running the request picks it
 *   up on its next heartbeat.
 * - `stopped-parked`: the request was parked (`suspended`) and the stop resolved
 *   its gate (FIX-1816). It ends `aborted`; a turn parked on an ask first
 *   cancels the task it asked for.
 * - `already-resolved`: the request was parked, but its gate was resolved
 *   first (an answer won the race), so it runs again. Nothing was written.
 */
export type RequestStopResult =
  | { kind: "gone" }
  | { kind: "finished"; status: RequestStatus }
  | { kind: "fired" }
  | { kind: "recorded" }
  | { kind: "stopped-parked" }
  | { kind: "already-resolved" };

/**
 * Record a stop on `record`, the request the caller already checked, and fire
 * its controller when it runs in this process.
 *
 * A parked (`suspended`) request has no run to signal, so it is stopped by
 * resolving its gate instead, when the host can (`parked`: it has durable
 * execution). Without that, a parked request answers `finished`, as before.
 *
 * @param requests The request store the record was read from.
 * @param record The record the caller's access check admitted.
 * @param parked How this host stops a parked request, when it can.
 */
export async function recordRequestStop(
  requests: RequestStore,
  record: Pick<RequestRecord, "id" | "createdAt" | "incarnation">,
  parked?: SuspendedStopDeps
): Promise<RequestStopResult> {
  // The request the caller's check read. Everything below acts on it and on
  // nothing else that later takes the id.
  const incarnation = resolveRequestIncarnation(record);

  // Atomic and fenced: written only while still `in_progress`, and only to
  // this incarnation, so a finished or re-taken id is never written.
  const result = await requests.setFieldsIfStatus(
    record.id,
    { abortRequested: true },
    ["in_progress"],
    Date.now(),
    incarnation
  );

  if (result.status === undefined) return { kind: "gone" };
  if (!result.applied && result.status === "suspended" && parked !== undefined) {
    // Re-read: the stop resolves the gate of the request the caller checked,
    // never of a later one that took the id.
    const current = await parked.stores.request.get(record.id);
    if (current === undefined || resolveRequestIncarnation(current) !== incarnation) {
      return { kind: "gone" };
    }
    const stopped = await stopSuspendedRequest(parked, current);
    return stopped === "stopped" ? { kind: "stopped-parked" } : { kind: "already-resolved" };
  }
  if (!result.applied) return { kind: "finished", status: result.status };

  // Fire the in-memory controller if the checked request runs in this
  // process. A controller of a later request under the id is not it; that
  // request never received the intent, so it is left running.
  return abortRequest(record.id, incarnation) ? { kind: "fired" } : { kind: "recorded" };
}
