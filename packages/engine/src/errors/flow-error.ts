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
 * Thrown when a resource write loses to a concurrent **delete** — the row this
 * caller held a live version for is now a tombstone.
 *
 * Terminal, never retryable: the only state a retry could re-apply is the
 * caller's pre-delete snapshot, so retrying would resurrect a resource somebody
 * deliberately removed. That is why resource state does not reuse
 * `runWithCAS`, whose conflict handler falls back to the container's cached
 * state and would do exactly that once a tombstone makes the version matchable.
 *
 * **Raised only when a live version was actually lost.** A key that was never
 * persisted — a declared resource that exists so far only through its schema
 * default — is *absent*, not deleted, and a write that asks for no change to
 * one is a no-op. Reporting a deletion there would be this store telling a
 * caller that something happened to a row that never existed.
 */
export class ResourceDeletedError extends FlowError {
  readonly resourceKey: string;

  constructor(resourceKey: string, options?: SubclassOptions) {
    super(
      `Resource "${resourceKey}" was deleted by another writer`,
      withDefaults(options, {
        code: "resource_deleted",
        retryable: false
      })
    );
    this.name = "ResourceDeletedError";
    this.resourceKey = resourceKey;
    if (!this.details) {
      (this as { details: Record<string, unknown> }).details = {};
    }
    (this.details as Record<string, unknown>).resourceKey = resourceKey;
  }
}

/**
 * Thrown when a create-if-absent resource write loses its race.
 *
 * Terminal by the same rule as {@link ResourceDeletedError}: retrying a losing
 * `create()` against the winner's version would overwrite the winner, and
 * silently succeeding would break `create()`'s already-exists contract. The
 * loser has to hear that it lost.
 *
 * It carries the winner's state and version because the store already reported
 * them on the conflict, and the first-touch APIs need them: `getOrCreate` and
 * `upsert` promise to hand back *the* instance, so a lost create is a "then
 * get" for them rather than an error. Handing the winner's row along with the
 * refusal is what lets them do that without a second read.
 */
export class ResourceAlreadyExistsError extends FlowError {
  readonly resourceKey: string;
  /** The winner's state, as the store reported it on the conflict. */
  readonly currentValue: Record<string, unknown> | undefined;
  /** The version now stored for the key. */
  readonly currentVersion: number;

  constructor(
    resourceKey: string,
    current?: { value: Record<string, unknown> | undefined; version: number },
    options?: SubclassOptions
  ) {
    super(
      `Resource instance "${resourceKey}" already exists`,
      withDefaults(options, {
        code: "resource_already_exists",
        retryable: false
      })
    );
    this.name = "ResourceAlreadyExistsError";
    this.resourceKey = resourceKey;
    this.currentValue = current?.value;
    this.currentVersion = current?.version ?? 0;
    if (!this.details) {
      (this as { details: Record<string, unknown> }).details = {};
    }
    (this.details as Record<string, unknown>).resourceKey = resourceKey;
  }
}

/**
 * Thrown when a version-checked write loses a race — either because a CAS
 * driver spent its whole retry budget without landing, or because a
 * version-checked resource `delete` conflicted. The class is `retryable: true`,
 * which on the CAS paths means a fresh attempt can win once contention
 * subsides. What sets the `delete` apart is that it has no internal retry loop
 * behind it at all: it passes the literal `attempts: 1` where both drivers pass
 * `maxRetries + 1`. That is a statement about the loop, not a claim about what
 * a caller's own retry policy can do.
 *
 * **Three raise sites, not one.** Both CAS drivers raise it when their retry
 * budget exhausts — `runWithCAS` (`../stores/cas.ts`) for scope state,
 * `runResourceCAS` (`../stores/resource-cas.ts`) for resource state — and the
 * version-checked resource `delete` in `createExecutionContext` raises it
 * terminally on the first conflict, with no retry loop behind it (`attempts`
 * is 1 there). Prose that names only the scope-state driver, or only budget
 * exhaustion, is describing one of the three. Three *paths*, four `throw`s:
 * the `delete` path holds two, one for the conflict it exists to catch (a live
 * row at an unexpected version, which refreshes the cached value and version
 * from the winner's row before it throws) and one for a store adapter that has
 * broken idempotent delete, which no retry can fix.
 *
 * **The ops below are examples, not a closed list.** On the scope-state
 * driver a call reaches the retry loop when the scope has a durable `persist`
 * and its `CASMutationHint` is non-commutative (`isCommutativeHint`,
 * `../stores/cas.ts`) — `setState`, `atomicState`, multi-field `patchState`,
 * updater-form `patchState` and multi-field `incState` qualify today, the last
 * because its mutator recomputes from the current field value on every retry.
 * An in-memory scope has no `persist`, no version, and never throws this. Note
 * what that does *not* say: a commutative op is still version-checked when the
 * adapter doesn't advertise the matching delta verb, because
 * `createScopePersist` then falls back to a full `set` at the held numeric
 * version — that refusal returns `false` instead of raising, which is a
 * different report, not an exemption. The resource driver has no such
 * *store-dependent* split — it does no delta-verb feature detection, so what
 * the adapter advertises never changes its `expectedVersion`. The caller's
 * intent decides that instead — `runResourceCAS` derives `expectedVersion` from
 * its `intent` argument. `mutate` sends the held version; `create` sends `0`, a
 * version check, but against "no live row" rather than the version this context
 * holds; and `replace`, reached by `create(key, state, { replace: true })`,
 * sends `"any"` and so is not version-checked at all.
 *
 * Read the hint routing before restating any of this narrower than it is.
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
