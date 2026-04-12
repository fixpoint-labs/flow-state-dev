/**
 * Canonical runtime error model for execution, validation, and transportable failure metadata.
 */
export type FlowErrorScope = "request" | "work" | "resource" | "block";

export type FlowErrorOptions = {
  code: string;
  retryable: boolean;
  blockName?: string;
  blockInstanceId?: string;
  scope?: FlowErrorScope;
  cause?: unknown;
  details?: Record<string, unknown>;
};

/**
 * Base error shape used across server runtime boundaries.
 */
export class FlowError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly blockName?: string;
  readonly blockInstanceId?: string;
  readonly scope?: FlowErrorScope;
  override readonly cause?: unknown;
  readonly details?: Record<string, unknown>;

  constructor(message: string, options: FlowErrorOptions) {
    super(message);
    this.name = "FlowError";
    this.code = options.code;
    this.retryable = options.retryable;
    this.blockName = options.blockName;
    this.blockInstanceId = options.blockInstanceId;
    this.scope = options.scope;
    this.cause = options.cause;
    this.details = options.details;
  }
}

type SubclassOptions = Omit<FlowErrorOptions, "code" | "retryable">;

function withDefaults(
  options: SubclassOptions | undefined,
  defaults: Pick<FlowErrorOptions, "code" | "retryable">
): FlowErrorOptions {
  return {
    code: defaults.code,
    retryable: defaults.retryable,
    blockName: options?.blockName,
    blockInstanceId: options?.blockInstanceId,
    scope: options?.scope,
    cause: options?.cause,
    details: options?.details
  };
}

/**
 * Error for invalid input or schema validation failures.
 */
export class ValidationError extends FlowError {
  constructor(message: string, options?: SubclassOptions) {
    super(
      message,
      withDefaults(options, {
        code: "validation_error",
        retryable: false
      })
    );
    this.name = "ValidationError";
  }
}

/**
 * Error for retryable network-related failures.
 */
export class NetworkError extends FlowError {
  constructor(message: string, options?: SubclassOptions) {
    super(
      message,
      withDefaults(options, {
        code: "network_error",
        retryable: true
      })
    );
    this.name = "NetworkError";
  }
}

/**
 * Error for retryable timeout-related failures.
 */
export class TimeoutError extends FlowError {
  constructor(message: string, options?: SubclassOptions) {
    super(
      message,
      withDefaults(options, {
        code: "timeout_error",
        retryable: true
      })
    );
    this.name = "TimeoutError";
  }
}

/**
 * Error for retryable upstream rate limit failures.
 */
export class RateLimitError extends FlowError {
  constructor(message: string, options?: SubclassOptions) {
    super(
      message,
      withDefaults(options, {
        code: "rate_limit_error",
        retryable: true
      })
    );
    this.name = "RateLimitError";
  }
}

/**
 * Error for retryable model invocation failures.
 */
export class ModelError extends FlowError {
  constructor(message: string, options?: SubclassOptions) {
    super(
      message,
      withDefaults(options, {
        code: "model_error",
        retryable: true
      })
    );
    this.name = "ModelError";
  }
}

/**
 * Error for tool failures that are typically not retryable by default.
 */
export class ToolExecutionError extends FlowError {
  constructor(message: string, options?: SubclassOptions) {
    super(
      message,
      withDefaults(options, {
        code: "tool_execution_error",
        retryable: false
      })
    );
    this.name = "ToolExecutionError";
  }
}

/**
 * Error for ambiguous block name lookups while resolving execution targets.
 */
export class AmbiguousBlockNameError extends FlowError {
  constructor(message: string, options?: SubclassOptions) {
    super(
      message,
      withDefaults(options, {
        code: "ambiguous_block_name",
        retryable: false
      })
    );
    this.name = "AmbiguousBlockNameError";
  }
}

/**
 * Thrown inside a block when a suspension is rejected by the client.
 */
export class SuspensionRejectedError extends FlowError {
  constructor(message: string, options?: SubclassOptions) {
    super(
      message,
      withDefaults(options, {
        code: "suspension_rejected",
        retryable: false
      })
    );
    this.name = "SuspensionRejectedError";
  }
}

/**
 * Thrown inside a block when a suspension times out before the client responds.
 */
export class SuspensionTimeoutError extends FlowError {
  constructor(message: string, options?: SubclassOptions) {
    super(
      message,
      withDefaults(options, {
        code: "suspension_timeout",
        retryable: false
      })
    );
    this.name = "SuspensionTimeoutError";
  }
}
