/**
 * Errors raised when an incoming request's claimed `userId`, `orgId`,
 * `tenantId` or flow instance conflicts with the values a stored session or
 * request record was created with.
 *
 * Sessions own a single user and at most one org for their lifetime. Subsequent
 * requests that claim a different identity are rejected here rather than
 * silently routed against the loaded session's data.
 */

/**
 * Thrown when a request supplies a `userId` that doesn't match the user the
 * session was created against. Closes a long-standing gap where the loaded
 * session record's `userId` was preserved without cross-checking the incoming
 * `options.userId`.
 */
export class UserBindingMismatchError extends Error {
  readonly sessionId: string;
  readonly sessionUserId: string;
  readonly requestedUserId: string;

  constructor(sessionId: string, sessionUserId: string, requestedUserId: string) {
    super(
      `Session ${sessionId} is owned by user ${sessionUserId} but request supplied user ${requestedUserId}.`
    );
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
