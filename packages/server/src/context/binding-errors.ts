/**
 * Errors raised by `createExecutionContext` when an incoming request's claimed
 * `userId` or `orgId` conflicts with the values the session was created with.
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
