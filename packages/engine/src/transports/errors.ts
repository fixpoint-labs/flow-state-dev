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
