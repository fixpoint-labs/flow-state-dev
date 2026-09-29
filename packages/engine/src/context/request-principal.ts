/**
 * Which principal a request record belongs to, and the id a caller gets when
 * the one it supplied is already someone else's.
 *
 * A request id is an address, not an ownership. Callers may choose their own
 * (`body.requestId` on an action call) so a retry reaches the same request,
 * and the id is never secret: it comes back in the `x-request-id` header and
 * the 202 body, and travels in URLs and logs. So an id alone must never let
 * one user's dispatch write, adopt or re-parent another user's record.
 *
 * `record-owner.ts` answers the other owner question, which flow instance a
 * record belongs to. Both must agree before a dispatch touches a record.
 *
 * Two surfaces, two contracts, on purpose. The HTTP action route is where a
 * caller's own id arrives, so it remaps (`resolveCallerRequestId`): reusing
 * another principal's id gets the caller its own request. Below it,
 * `host.dispatch`, `runAction` and the execution context never remap: they
 * refuse a record another principal holds with `RequestOwnerMismatchError`
 * (`claimRequestRecord`). A remap there would hand a server-side caller an id
 * it did not ask for; a refusal is the answer every other entry point and
 * every race gets. An HTTP caller succeeding where a direct dispatch is
 * refused is this contract, not a gap in it.
 */
import { createHash } from "node:crypto";
import type { FlowInstance } from "@flow-state-dev/core/types";
import type { ActiveRequestEntry, RequestRecord, StoreRegistry } from "../stores/types";
import { resolveRequestIncarnation, tenantMatches } from "../stores/scope-keys";
import { FlowInstanceBindingMismatchError, RequestOwnerMismatchError } from "./binding-errors";
import { foreignRecordRefusal, ownsRecord } from "./record-owner";

/** The identity a dispatch runs under, as the host resolved it. */
export type RequestPrincipal = {
  userId: string;
  orgId?: string;
  tenantId?: string;
};

/** The identity facts a request record or an in-flight entry carries. */
type PrincipalOwnedRecord = Pick<RequestRecord, "userId" | "orgId" | "tenantId">;

/**
 * Whether `record` belongs to `principal`: the same user, in the same tenant
 * and, when the record carries one, the same organization. A record written
 * before organizations were stamped is decided by user and tenant (BP-030).
 */
export function principalOwnsRequest(
  record: PrincipalOwnedRecord,
  principal: RequestPrincipal
): boolean {
  if (record.userId !== principal.userId) return false;
  if (!tenantMatches(record.tenantId ?? undefined, principal.tenantId)) return false;
  return record.orgId == null || record.orgId === principal.orgId;
}

/**
 * The request id `principal` gets for a `suppliedId` another principal holds.
 * Deterministic, so the caller's own retries under the same supplied id reach
 * the same request, and distinct per principal, so two callers reusing one id
 * never meet.
 */
function principalRequestId(suppliedId: string, principal: RequestPrincipal): string {
  const digest = createHash("sha256")
    .update([principal.tenantId ?? "", principal.orgId ?? "", principal.userId, suppliedId].join("\u0000"))
    .digest("hex")
    .slice(0, 32);
  return `req_${digest}`;
}

/**
 * Resolve a caller-supplied request id to the id its dispatch runs under.
 *
 * Unchanged when nothing holds the id, or when `principal` already does (a
 * retry). When another principal's record or in-flight entry holds it, the
 * caller gets its own request under {@link principalRequestId} instead; the
 * other principal's record is never read further or touched. A race that
 * creates a foreign record after this read is refused at the write by the
 * owner fences in the host and the execution context, never overwritten.
 */
export async function resolveCallerRequestId(
  stores: Pick<StoreRegistry, "request" | "activeRequests">,
  suppliedId: string,
  principal: RequestPrincipal
): Promise<string> {
  const [record, active] = await Promise.all([
    stores.request.get(suppliedId),
    stores.activeRequests.get(suppliedId)
  ]);
  const holder: PrincipalOwnedRecord | ActiveRequestEntry | undefined = record ?? active;
  if (holder === undefined || principalOwnsRequest(holder, principal)) return suppliedId;
  return principalRequestId(suppliedId, principal);
}

/**
 * Write `record` create-if-absent, or take it over only from its own flow
 * instance and principal. The one claim every writer of a fresh request
 * record makes: the host's enqueue-time stub, `runAction` before it registers
 * or acknowledges anything, and the execution context's create race.
 *
 * A lost race against the same owner (a retry reusing its id) keeps the
 * last-write-wins hand-off it always was, except for the holder's
 * `incarnation`: that is the request's identity, stamped once, so the
 * hand-off writes the holder's value rather than its own. A legacy holder's
 * derived value is written out, since the hand-off also replaces the
 * `createdAt` it was derived from. A record another flow instance owns throws
 * `FlowInstanceBindingMismatchError`; one another principal owns throws
 * `RequestOwnerMismatchError`. Either way nothing is written.
 *
 * @returns The record as written, whose `incarnation` is the one the store
 * kept. A caller that goes on to run the request uses this, never `record`.
 */
export async function claimRequestRecord<T extends RequestRecord>(
  stores: Pick<StoreRegistry, "request">,
  flow: FlowInstance,
  record: T
): Promise<T> {
  const created = await stores.request.set(record.id, record, "absent");
  if (created.ok) return record;
  const holder = created.conflict.currentValue;
  if (holder === undefined || !ownsRecord(flow, holder)) {
    const refusal = holder === undefined ? undefined : foreignRecordRefusal(flow, holder);
    throw new FlowInstanceBindingMismatchError(
      "request",
      record.id,
      flow.id,
      refusal === undefined
        ? "a request with this id exists and could not be read back"
        : `a request with this id: ${refusal.detail}`,
      refusal?.reason
    );
  }
  if (!principalOwnsRequest(holder, record)) {
    throw new RequestOwnerMismatchError(record.id);
  }
  const handedOff: T = { ...record, incarnation: resolveRequestIncarnation(holder) };
  await stores.request.set(record.id, handedOff, "any");
  return handedOff;
}
