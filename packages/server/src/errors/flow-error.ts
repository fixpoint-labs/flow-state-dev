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
