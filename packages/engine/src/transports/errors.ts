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
 * Thrown when TRUSTED code submits an identity with no usable organization
 * (FIX-1442) — a direct `runAction`, a pre-resolved adapter envelope, a CLI
 * seed, a queued job replayed from a durable substrate.
 *
 * Distinct from {@link PrincipalResolutionError}, which answers an inbound
 * *caller* and carries an HTTP status. This one answers the framework's own
 * embedder, so it is layer-agnostic and carries no status: an adapter that
 * chooses to expose a trusted-input failure over HTTP maps it to 400 itself.
 * Reaching it means a call site skipped the resolver rather than that a caller
 * failed to authenticate — which is why it names the seam, not the flow alone.
 */
export class OrgRequiredError extends Error {
  readonly flowKind: string;

  constructor(flowKind: string, seam = "this call") {
    super(
      `${seam} requires an organization for flow "${flowKind}". Trusted direct ` +
        `execution must pass a nonempty orgId — the verified organization for an ` +
        `authenticated caller, or DEFAULT_ORG_ID for single-organization development.`
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
