/**
 * Server-side error taxonomy. The base `FlowError` lives in
 * `@flow-state-dev/core` so author code in third-party packages can throw it
 * without a server dependency. This file re-exports the core base and defines
 * the server's typed subclasses (`ValidationError`, `NetworkError`, ...).
 */
import { FlowError } from "@flow-state-dev/core";
import type { FlowErrorOptions, FlowErrorScope } from "@flow-state-dev/core";

export { FlowError };
export type { FlowErrorOptions, FlowErrorScope };

type SubclassOptions = Omit<FlowErrorOptions, "code" | "retryable">;

function withDefaults(
  options: SubclassOptions | undefined,
  defaults: Pick<Required<FlowErrorOptions>, "code" | "retryable">
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
 * Error for prompts that exceed the model's context window. Not retryable —
 * resending the same oversized prompt fails identically; the caller must
 * shrink the input.
 */
export class ContextLengthError extends FlowError {
  constructor(message: string, options?: SubclassOptions) {
    super(
      message,
      withDefaults(options, {
        code: "context_length_error",
        retryable: false
      })
    );
    this.name = "ContextLengthError";
  }
}

/**
 * Error for transient upstream provider outages (5xx responses, gateway
 * failures). Retryable — the provider is expected to recover.
 */
export class ProviderUnavailableError extends FlowError {
  constructor(message: string, options?: SubclassOptions) {
    super(
      message,
      withDefaults(options, {
        code: "provider_unavailable_error",
        retryable: true
      })
    );
    this.name = "ProviderUnavailableError";
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
 * Configuration error from `createFlowState` — bad `stores` shape, an
 * unknown `FSD_ENV` / `defaultProfile` profile, or a profile slot whose
 * adapter doesn't declare the capability. Never retryable; the process
 * must be reconfigured and restarted.
 */
export class FlowStateConfigError extends FlowError {
  constructor(message: string, options?: SubclassOptions) {
    super(
      message,
      withDefaults(options, {
        code: "flowstate_config_error",
        retryable: false
      })
    );
    this.name = "FlowStateConfigError";
  }
}

/**
 * Thrown when `getRouter()` / `ready()` is called after `dispose()`. The
 * instance's pooled resources are gone and unrecoverable.
 */
export class FlowStateDisposedError extends FlowError {
  constructor(message: string, options?: SubclassOptions) {
    super(
      message,
      withDefaults(options, {
        code: "flowstate_disposed_error",
        retryable: false
      })
    );
    this.name = "FlowStateDisposedError";
  }
}

/**
 * Thrown when a CAS retry loop exhausts its budget on an external-store scope.
 * Only surfaces for read-modify-write ops (`setState`, `atomicState`,
 * multi-field `patchState`, updater-form `patchState`); commutative ops
 * and in-memory scopes never throw it.
 */
export class ConcurrentModificationError extends FlowError {
  readonly attempts: number;

  constructor(message: string, attempts: number, options?: SubclassOptions) {
    super(
      message,
      withDefaults(options, {
        code: "concurrent_modification",
        retryable: true
      })
    );
    this.name = "ConcurrentModificationError";
    this.attempts = attempts;
    if (!this.details) {
      (this as { details: Record<string, unknown> }).details = {};
    }
    (this.details as Record<string, unknown>).attempts = attempts;
  }
}
