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
 */
import { createHash } from "node:crypto";
import type { ActiveRequestEntry, RequestRecord, StoreRegistry } from "../stores/types";
import { tenantMatches } from "../stores/scope-keys";

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
  const holder: PrincipalOwnedRecord | ActiveRequestEntry | undefined =
    (await stores.request.get(suppliedId)) ?? (await stores.activeRequests.get(suppliedId));
  if (holder === undefined || principalOwnsRequest(holder, principal)) return suppliedId;
  return principalRequestId(suppliedId, principal);
}
