/**
 * Errors raised when an incoming request's claimed `userId`, `orgId`,
 * `tenantId` or flow instance conflicts with the values a stored session or
 * request record was created with.
 *
 * Sessions own a single user and at most one org for their lifetime. Subsequent
 * requests that claim a different identity are rejected here rather than
 * silently routed against the loaded session's data.
 */
import {
  foreignRecordRefusal,
  ownsRecord,
  type OwnedRecord,
  type OwnerIdentity
} from "./record-owner";
import { tenantMatches } from "../stores/scope-keys";

/**
 * Thrown when a request supplies a `userId` that doesn't match the user the
 * session was created against. Closes a long-standing gap where the loaded
 * session record's `userId` was preserved without cross-checking the incoming
 * `options.userId`.
 *
 * Raised at admission, before a run is registered or acknowledged
 * (`runAction`, and the transport host for a queued run), and again at
 * context creation for a session created in between. The HTTP action route
 * answers it as an unknown session. The message names the session only, never
 * its owner: it reaches the caller as the run's error item, and the caller is
 * the one user who must not learn whose the session is. `sessionUserId` still
 * carries the owner for server-side code.
 */
export class UserBindingMismatchError extends Error {
  readonly sessionId: string;
  readonly sessionUserId: string;
  readonly requestedUserId: string;

  constructor(sessionId: string, sessionUserId: string, requestedUserId: string) {
    super(`Session ${sessionId} belongs to another user and cannot be used by this caller.`);
    this.name = "UserBindingMismatchError";
    this.sessionId = sessionId;
    this.sessionUserId = sessionUserId;
    this.requestedUserId = requestedUserId;
  }
}

/**
 * Thrown when a request supplies an `orgId` that doesn't match the org the
 * session was bound to at creation. Org binding is immutable for the lifetime
 * of a session — apps that need to "move" a session create a new one.
 */
export class OrgBindingMismatchError extends Error {
  readonly sessionId: string;
  readonly sessionOrgId: string;
  readonly requestedOrgId: string;

  constructor(sessionId: string, sessionOrgId: string, requestedOrgId: string) {
    super(
      `Session ${sessionId} is bound to org ${sessionOrgId} but request supplied org ${requestedOrgId}.`
    );
    this.name = "OrgBindingMismatchError";
    this.sessionId = sessionId;
    this.sessionOrgId = sessionOrgId;
    this.requestedOrgId = requestedOrgId;
  }
}

/**
 * Thrown when a request resolves to a session record whose stored `tenantId`
 * differs from the request's tenant (FIX-682). The `${tenantId}:${sessionId}`
 * storage key is ambiguous when the caller controls `sessionId` — omitting the
 * tenant header while passing `sessionId = "${otherTenant}:${id}"` collides on
 * another tenant's key. Comparing the stored tenant to the request's closes
 * that bypass: a key collision can never be acted on across a tenant boundary.
 * `"<none>"` stands in for an absent tenant in the message.
 */
export class TenantBindingMismatchError extends Error {
  readonly sessionId: string;
  readonly sessionTenantId: string;
  readonly requestedTenantId: string;

  constructor(
    sessionId: string,
    sessionTenantId: string | undefined,
    requestedTenantId: string | undefined
  ) {
    super(
      `Session ${sessionId} belongs to tenant ${sessionTenantId ?? "<none>"} but request supplied tenant ${requestedTenantId ?? "<none>"}.`
    );
    this.name = "TenantBindingMismatchError";
    this.sessionId = sessionId;
    this.sessionTenantId = sessionTenantId ?? "<none>";
    this.requestedTenantId = requestedTenantId ?? "<none>";
  }
}

/**
 * Thrown when a request addressed to one flow instance reaches a session or
 * request record another instance owns — or one whose owner this runtime
 * cannot attribute. Ownership is decided by `context/record-owner.ts`; this
 * is the refusal it produces at every admission point (host enqueue, direct
 * execution, re-entry, recovery), before any write, active registration or
 * data read against the foreign record.
 *
 * `record` says which kind of record was addressed, so a host can name it
 * (`wrong-instance-session` / `wrong-instance-request`) without parsing the
 * message; `reason` carries the owner-resolution refusal when the record's
 * owner could not even be resolved, and is absent for a plain mismatch.
 */
export class FlowInstanceBindingMismatchError extends Error {
  readonly record: "session" | "request";
  readonly recordId: string;
  readonly addressedFlowId: string;
  readonly reason?: "owner-not-registered" | "owner-kind-mismatch" | "migration-required";

  constructor(
    record: "session" | "request",
    recordId: string,
    addressedFlowId: string,
    detail: string,
    reason?: FlowInstanceBindingMismatchError["reason"]
  ) {
    super(
      `${record === "session" ? "Session" : "Request"} ${recordId} is not owned by flow instance ` +
        `"${addressedFlowId}": ${detail}.`
    );
    this.name = "FlowInstanceBindingMismatchError";
    this.record = record;
    this.recordId = recordId;
    this.addressedFlowId = addressedFlowId;
    this.reason = reason;
  }
}

/**
 * Thrown when a dispatch reaches a request record, or an in-flight entry,
 * that another principal owns: a different user, tenant or organization
 * (`context/request-principal.ts`). Raised at every point a dispatch writes or
 * adopts a request record, before it does, so a request id can never move a
 * record from one user to another. The HTTP action route hands such a caller
 * its own id first; this is the refusal for the race it cannot see, and for
 * any other entry point. The message names the id only, never the owner.
 */
export class RequestOwnerMismatchError extends Error {
  readonly requestId: string;

  constructor(requestId: string) {
    super(`Request ${requestId} belongs to another principal and cannot be used by this caller.`);
    this.name = "RequestOwnerMismatchError";
    this.requestId = requestId;
  }
}

/**
 * Refuse a loaded session this caller must not run in.
 *
 * Another user's session is refused first, then another flow instance's, so
 * the refusal names neither the owner nor which flow holds the session. A
 * session in another tenant is left alone: the tenant binding refuses a key
 * collision later, and it is not an ownership fact. No session is nothing
 * to admit. `runAction` and the transport host both admit through this, so
 * the order cannot drift between the direct path and a queued one.
 */
export function assertSessionAdmitted(
  flow: OwnerIdentity & { id: string },
  session: (OwnedRecord & { userId: string; tenantId?: string }) | undefined,
  caller: { sessionId: string; userId: string; tenantId?: string }
): void {
  if (session === undefined || !tenantMatches(session.tenantId, caller.tenantId)) return;
  if (session.userId !== caller.userId) {
    throw new UserBindingMismatchError(caller.sessionId, session.userId, caller.userId);
  }
  if (!ownsRecord(flow, session)) {
    const refusal = foreignRecordRefusal(flow, session);
    throw new FlowInstanceBindingMismatchError(
      "session",
      caller.sessionId,
      flow.id,
      refusal.detail,
      refusal.reason
    );
  }
}
