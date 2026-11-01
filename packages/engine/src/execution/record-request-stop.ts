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
import { parkedInterruptedIds, stopSuspendedRequest, type SuspendedStopDeps } from "../durability/stop-suspended";
import { letOwedParkGo } from "../durability/park-owed";
import { resumeRequestWaiters } from "../durability/wait-chain";
import { settledRecordFields } from "./request-action-result";

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
 * - `stopped-parked`: the request was parked (`suspended`, or `interrupted` and
 *   parked by `parkedInterruptedIds`: a pending gate, or a logged gate owed a
 *   re-drive) and the stop resolved its gate (FIX-1816), overriding a
 *   person's resolution the turn never ran past (FIX-2108). It ends
 *   `aborted`; a turn parked on a wait first cancels the task it waits on.
 * - `ended`: the request was `interrupted` (its process died) behind no gate,
 *   so nothing would carry it on but a continue. The stop ends it `aborted`,
 *   and it leaves the interrupted list for good (FIX-2377).
 * - `already-resolved`: the request was parked, but its gate was resolved
 *   first (an answer won the race, or a resume or re-drive holds its lease),
 *   or it is `interrupted` owing a park and its continuation holds its lease
 *   (FIX-2269), so it runs again. Nothing was written.
 */
export type RequestStopResult =
  | { kind: "gone" }
  | { kind: "finished"; status: RequestStatus }
  | { kind: "fired" }
  | { kind: "recorded" }
  | { kind: "stopped-parked" }
  | { kind: "ended" }
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
  // Parked: `suspended`, or `interrupted` (the process died) while it is
  // parked (`parkedInterruptedIds`: a pending gate, or a logged gate owed a
  // re-drive). An interrupted request that is not is waiting on nothing, and
  // the stop ends it `aborted` (`endInterrupted`).
  if (
    !result.applied &&
    (result.status === "suspended" || result.status === "interrupted") &&
    parked !== undefined
  ) {
    // Re-read: the stop resolves the gate of the request the caller checked,
    // never of a later one that took the id.
    const current = await parked.stores.request.get(record.id);
    if (current === undefined || resolveRequestIncarnation(current) !== incarnation) {
      return { kind: "gone" };
    }
    if (current.status === "interrupted" && !(await parkedInterruptedIds(parked.provider, [current])).has(current.id)) {
      // Dead behind no gate. A park it owes would have the sweep continue it
      // (FIX-2269); the stop lets that go, so it stays stopped. A continuation
      // already holding its lease won the race: it runs again.
      if (parked.stores.wakes !== undefined && (await letOwedParkGo(parked.provider, parked.stores.wakes, current)) === "busy") {
        return { kind: "already-resolved" };
      }
      return endInterrupted(requests, record.id, incarnation, parked);
    }
    const stopped = await stopSuspendedRequest(parked, current);
    return stopped === "stopped" ? { kind: "stopped-parked" } : { kind: "already-resolved" };
  }
  // Interrupted on a host without durable execution: no gate can hold it.
  if (!result.applied && result.status === "interrupted") {
    return endInterrupted(requests, record.id, incarnation, parked);
  }
  if (!result.applied) return { kind: "finished", status: result.status };

  // Fire the in-memory controller if the checked request runs in this
  // process. A controller of a later request under the id is not it; that
  // request never received the intent, so it is left running.
  return abortRequest(record.id, incarnation) ? { kind: "fired" } : { kind: "recorded" };
}

/**
 * End a dead request no gate holds: `interrupted` becomes `aborted`, fenced on
 * its status and incarnation, so a continue that took it first keeps running
 * and a later request under the id is never written. A request that waits on
 * it (`dispatcher({ wait: true })`) is resumed, as every other ending resumes
 * it, rather than left parked until its deadline.
 */
async function endInterrupted(
  requests: RequestStore,
  id: string,
  incarnation: string,
  parked: SuspendedStopDeps | undefined
): Promise<RequestStopResult> {
  // No run is left to stamp the ending, so this write does: `abortedAt` dates
  // it for checkpoint pruning, and `finalizedAtMs` says nothing still writes.
  const now = Date.now();
  const ended = await requests.setFieldsIfStatus(
    id,
    {
      abortRequested: true,
      abortedAt: now,
      finalizedAtMs: now,
      heartbeatsUntilFinalized: false,
      ...settledRecordFields({ status: "aborted" })
    },
    ["interrupted"],
    now,
    incarnation
  );
  if (ended.applied) {
    if (parked !== undefined) {
      // Best-effort, as at a run's own ending: a resume this misses is caught
      // by the deadline sweep.
      try {
        const settled = await requests.get(id);
        if (settled !== undefined) await resumeRequestWaiters(parked, settled);
      } catch {
        // The stop itself landed; the waiter is left to the sweep.
      }
    }
    return { kind: "ended" };
  }
  if (ended.status === undefined) return { kind: "gone" };
  // A continue won the race: it runs again, and a stop now is a stop of that run.
  if (ended.status === "in_progress") return { kind: "already-resolved" };
  return { kind: "finished", status: ended.status };
}
