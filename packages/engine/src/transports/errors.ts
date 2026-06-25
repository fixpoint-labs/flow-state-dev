/**
 * Error classes raised by the inbound transport contract.
 *
 * Adapters and the host throw these so the outer factory can map them to
 * transport-native error responses (HTTP status codes, MCP error codes,
 * etc.) without leaking framework internals.
 */

/**
 * Thrown by a principal resolver when the caller cannot be authenticated.
 * Carries an HTTP-shaped `status` so HTTP adapters can map to a response
 * directly; non-HTTP transports translate the status to their native form.
 */
export class PrincipalResolutionError extends Error {
  readonly status: number;

  constructor(message: string, options: { status?: number } = {}) {
    super(message);
    this.name = "PrincipalResolutionError";
    this.status = options.status ?? 401;
  }
}

/**
 * Thrown by the transport host when a flow requires an org-bound session
 * but no orgId is present on the envelope, the principal, or the stored
 * session. Layer-agnostic — carries no HTTP `status` field; the HTTP
 * adapter maps it to 400 at the route level.
 */
export class OrgRequiredError extends Error {
  readonly flowKind: string;

  constructor(flowKind: string) {
    super(
      `Flow "${flowKind}" requires an org-bound session. Create a new session with orgId.`
    );
    this.name = "OrgRequiredError";
    this.flowKind = flowKind;
  }
}

/**
 * Thrown synchronously from `host.dispatch` (before any request record exists)
 * when an action's concurrency policy is `reject` and another request already
 * holds the key (default: the session). Carries an HTTP-shaped `status` (409)
 * like `PrincipalResolutionError`, the contended `key`, and the in-flight
 * `requestId` so a caller may choose to tail the surviving request instead of
 * retrying. Fire-and-forget adapters (scheduled/webhook) map it to a benign
 * skipped response so the provider stops redelivering.
 */
export class ConcurrencyRejectedError extends Error {
  readonly status = 409;
  readonly key: string;
  readonly inFlightRequestId?: string;

  constructor(key: string, inFlightRequestId?: string) {
    super(
      `A request is already in flight for concurrency key "${key}"; ` +
        `this action's policy is "reject" so the competing request was dropped.`
    );
    this.name = "ConcurrencyRejectedError";
    this.key = key;
    this.inFlightRequestId = inFlightRequestId;
  }
}

/**
 * Thrown when a `queue` request waits past its budget for the key to free up,
 * instead of hanging indefinitely. Carries an HTTP-shaped `status` (503) and
 * the contended `key`. Retryable with backoff.
 */
export class ConcurrencyQueueTimeoutError extends Error {
  readonly status = 503;
  readonly key: string;
  readonly timeoutMs: number;

  constructor(key: string, timeoutMs: number) {
    super(
      `Timed out after ${timeoutMs}ms waiting for concurrency key "${key}" to free up.`
    );
    this.name = "ConcurrencyQueueTimeoutError";
    this.key = key;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Thrown at host construction when two adapters declare the same
 * `(method, path)` pair. The message names both adapter sources and the
 * colliding path so the failure is actionable.
 */
export class TransportRouteCollisionError extends Error {
  readonly method: string;
  readonly path: string;
  readonly sources: readonly string[];

  constructor(method: string, path: string, sources: readonly string[]) {
    super(
      `Route collision on ${method} ${path}: declared by adapters [${sources.join(", ")}]`
    );
    this.name = "TransportRouteCollisionError";
    this.method = method;
    this.path = path;
    this.sources = sources;
  }
}
