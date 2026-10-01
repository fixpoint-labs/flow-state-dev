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
 */
export type RequestStopResult =
  | { kind: "gone" }
  | { kind: "finished"; status: RequestStatus }
  | { kind: "fired" }
  | { kind: "recorded" };

/**
 * Record a stop on `record`, the request the caller already checked, and fire
 * its controller when it runs in this process.
 *
 * @param requests The request store the record was read from.
 * @param record The record the caller's access check admitted.
 */
export async function recordRequestStop(
  requests: RequestStore,
  record: Pick<RequestRecord, "id" | "createdAt" | "incarnation">
): Promise<RequestStopResult> {
  // The request the caller's check read. Everything below acts on it and on
  // nothing else that later takes the id.
  const incarnation = resolveRequestIncarnation(record);

  // One atomic step: record the intent only while the request is still
  // running. A read-then-write cannot express this — the worker can commit a
  // terminal status between the two, and writing afterwards would restore an
  // `in_progress` record over a finished one. Fenced to the checked request by
  // its incarnation: if the id was deleted and taken by someone else since,
  // the write misses; if the owner's own retry handed the record off, the
  // incarnation held and the write lands.
  const result = await requests.setFieldsIfStatus(
    record.id,
    { abortRequested: true },
    ["in_progress"],
    Date.now(),
    incarnation
  );

  if (result.status === undefined) return { kind: "gone" };
  if (!result.applied) return { kind: "finished", status: result.status };

  // Fire the in-memory controller if the checked request runs in this
  // process. A controller of a later request under the id is not it; that
  // request never received the intent, so it is left running.
  return abortRequest(record.id, incarnation) ? { kind: "fired" } : { kind: "recorded" };
}
