/**
 * Canonical runtime error model shared across packages. Lives in core so handler
 * authors in third-party packages can throw `FlowError` (and runtime-emitted
 * subclasses like `OutputValidationError`) without depending on
 * `@flow-state-dev/server`.
 *
 * Server defines typed subclasses (`ValidationError`, `NetworkError`, ...) that
 * extend this base. Internal-only metadata (`blockName`, `blockInstanceId`,
 * `scope`) is preserved here so server's `normalizeError` and subclasses keep
 * working unchanged.
 */

/**
 * Conceptual location of a failure for downstream classification.
 */
export type FlowErrorScope = "request" | "work" | "resource" | "block";

/**
 * Options accepted by `FlowError`. The author-facing surface is the narrow
 * `{ code, retryable, details, cause }` shape; `blockName`, `blockInstanceId`,
 * and `scope` are populated by the runtime when normalizing errors.
 */
export type FlowErrorOptions = {
  code?: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
  cause?: unknown;
  blockName?: string;
  blockInstanceId?: string;
  scope?: FlowErrorScope;
};

/**
 * Author-throwable runtime error. Carries an optional machine-readable `code`,
 * a `retryable` flag (default `false`), arbitrary structured `details`, and an
 * optional underlying `cause`.
 */
export class FlowError extends Error {
  readonly code?: string;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;
  override readonly cause?: unknown;
  readonly blockName?: string;
  readonly blockInstanceId?: string;
  readonly scope?: FlowErrorScope;

  constructor(message: string, options: FlowErrorOptions = {}) {
    super(message);
    this.name = "FlowError";
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
    this.cause = options.cause;
    this.blockName = options.blockName;
    this.blockInstanceId = options.blockInstanceId;
    this.scope = options.scope;
  }

  /**
   * Dual-realm-safe check: matches any `FlowError` (and subclasses) by
   * `name`-tag or by `instanceof`. Use when an instance may have crossed a
   * bundler boundary that produced a duplicate class identity.
   */
  static isInstance(err: unknown): err is FlowError {
    if (err instanceof FlowError) return true;
    if (err instanceof Error) {
      const name = (err as { name?: string }).name;
      if (name === "FlowError") return true;
    }
    return false;
  }
}
