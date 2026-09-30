/**
 * Settle a request whose run never started.
 *
 * Shared by the two places that accept a request and can then fail to start
 * it: the inbound transport host (an enqueue or a concurrency wait that fails
 * after the request record was written) and a queue adapter's worker (a job
 * that waited out its concurrency budget, or could not take its turn). Both
 * write the same terminal record, through the same settlement fields
 * `runAction` writes, so a reader cannot tell which of them ended it.
 */
import type { StoreRegistry } from "../stores/types";
import { resolveRequestIncarnation } from "../stores/scope-keys";
import { isTerminalRequestStatus } from "../stores/subscribe-helpers";
import { normalizeError } from "../errors/normalize-error";
import { settledRecordFields, type RequestSettlement } from "./request-action-result";

/** How an unstarted request ends: failed, with its cause, or aborted. */
export type UnstartedRequestEnding = { status: "failed"; cause: unknown } | { status: "aborted" };

/**
 * End a request whose run never started. With `expectedIncarnation`, only
 * that request is ended: a record another request put under the id since is
 * left alone. Without it, whatever holds the id is ended. A missing or
 * already-terminal record is left as it is.
 *
 * The read and the write are separate calls, so a record replaced between
 * them is still overwritten. The conditional store write cannot close that:
 * it does not write `status`.
 *
 * Best effort: a store failure is swallowed, because the caller's own error
 * is what it reports.
 */
export async function settleUnstartedRequest(
  stores: StoreRegistry,
  requestId: string,
  ending: UnstartedRequestEnding,
  expectedIncarnation?: string
): Promise<void> {
  try {
    const record = await stores.request.get(requestId);
    if (record === undefined || isTerminalRequestStatus(record.status)) return;
    if (
      expectedIncarnation !== undefined &&
      resolveRequestIncarnation(record) !== expectedIncarnation
    ) {
      return;
    }
    const now = Date.now();
    // The failure's cause is the record's action result, written with the
    // status (FIX-1661); an abort carries none.
    const settlement: RequestSettlement =
      ending.status === "failed"
        ? { status: "failed", error: normalizeError(ending.cause, { scope: "request" }) }
        : { status: "aborted" };
    await stores.request.set(
      requestId,
      {
        ...record,
        ...settledRecordFields(settlement),
        ...(ending.status === "failed" ? { failedAtMs: now } : {}),
        updatedAt: now
      },
      "any"
    );
  } catch {
    // Best-effort cleanup; the caller's own error is what propagates.
  }
}
