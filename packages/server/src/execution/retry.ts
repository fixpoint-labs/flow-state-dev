/**
 * Retry policy resolution and retry-loop execution utilities for runtime blocks/actions.
 *
 * The retry loop itself is delegated to `p-retry`; this file owns the
 * framework-specific policy merge, retryable-error classification, abort
 * mapping, and the `onRetry` "scheduled" semantics.
 */
import pRetry, { AbortError, type FailedAttemptError } from "p-retry";
import type { RetryPolicy } from "@flow-state-dev/core/types";
import { FlowError } from "../errors/flow-error";

/**
 * Concrete retry settings after block and runtime policy merge.
 */
export type ResolvedRetryPolicy = {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryableErrors?: Array<new (...args: any[]) => Error>;
};

const DEFAULT_MAX_ATTEMPTS = 1;
const DEFAULT_BASE_DELAY_MS = 0;
const DEFAULT_MAX_DELAY_MS = 5000;

/**
 * Merges block-level and runtime retry policy with normalized defaults.
 */
export function mergeRetryPolicy(
  blockRetry: RetryPolicy | undefined,
  runtimeRetry: RetryPolicy | undefined
): ResolvedRetryPolicy | undefined {
  if (blockRetry === undefined && runtimeRetry === undefined) {
    return undefined;
  }

  const merged: RetryPolicy = {
    ...runtimeRetry,
    ...blockRetry
  };
  const baseDelayMs = Math.max(0, merged.baseDelayMs ?? DEFAULT_BASE_DELAY_MS);
  const maxDelayMs = Math.max(
    baseDelayMs,
    merged.maxDelayMs ?? DEFAULT_MAX_DELAY_MS
  );

  return {
    maxAttempts: Math.max(1, merged.maxAttempts ?? DEFAULT_MAX_ATTEMPTS),
    baseDelayMs,
    maxDelayMs,
    retryableErrors: merged.retryableErrors
  };
}

/**
 * Returns whether an error should be retried under the provided policy.
 */
export function isRetryableError(
  error: Error,
  policy: ResolvedRetryPolicy | undefined
): boolean {
  if (policy === undefined) {
    return false;
  }

  if (error instanceof FlowError) {
    if (!error.retryable) {
      return false;
    }
  }

  if (
    policy.retryableErrors === undefined ||
    policy.retryableErrors.length === 0
  ) {
    return true;
  }

  return policy.retryableErrors.some((ErrorType) => error instanceof ErrorType);
}

/**
 * Executes work with retry/backoff semantics and optional abort support.
 *
 * Non-retryable throws are converted to `p-retry`'s `AbortError` at the throw
 * site so the loop terminates without further attempts. Non-`Error` throws
 * are normalized to `Error("Unknown retry failure")`. Signal aborts surface
 * as `Error("Retry aborted")` regardless of when the abort fires (before the
 * first call, during a backoff wait, or while the function is in flight).
 *
 * `onRetry` fires only when another attempt will be scheduled — i.e., it
 * reports retries that are about to happen, not the final terminal failure.
 */
export async function retryWithPolicy<TValue>(
  run: () => Promise<TValue>,
  policy: ResolvedRetryPolicy | undefined,
  options: {
    signal?: AbortSignal;
    onRetry?: (attempt: number, error: Error) => Promise<void> | void;
  } = {}
): Promise<TValue> {
  if (policy === undefined) {
    return run();
  }

  // Defensive guard against an unmerged policy with maxAttempts <= 0;
  // mergeRetryPolicy clamps to 1, so this is unreachable in normal paths.
  if (policy.maxAttempts <= 0) {
    throw new Error("Retry loop exited unexpectedly");
  }

  // p-retry doesn't short-circuit on a pre-aborted signal (it only attaches
  // its abort listener when `!signal.aborted`), so the caller's expectation
  // of "abort means abort" wouldn't hold without this pre-flight check.
  if (options.signal?.aborted === true) {
    throw new Error("Retry aborted");
  }

  try {
    return await pRetry(
      async () => {
        try {
          return await run();
        } catch (caught) {
          const normalized =
            caught instanceof Error ? caught : new Error("Unknown retry failure");
          if (!isRetryableError(normalized, policy)) {
            throw new AbortError(normalized);
          }
          throw normalized;
        }
      },
      {
        retries: policy.maxAttempts - 1,
        factor: 2,
        minTimeout: policy.baseDelayMs,
        maxTimeout: policy.maxDelayMs,
        randomize: false,
        signal: options.signal,
        onFailedAttempt: async (attemptError: FailedAttemptError) => {
          // Fire only when another attempt will run, so callers (e.g.
          // `executeBlock`'s "retry scheduled" log) don't see the terminal
          // failure. p-retry decorates the thrown error in-place — not a
          // wrapper — so forward as-is rather than reading `.cause`.
          if (attemptError.retriesLeft <= 0) return;
          await options.onRetry?.(attemptError.attemptNumber, attemptError);
        }
      }
    );
  } catch (err) {
    // Normalize signal aborts to a stable message — but only when the
    // rejection itself is an abort, not when an unrelated non-retryable
    // error happens to coincide with an abort fired between the inner
    // rejection and this catch handler. Checking the error identity (vs.
    // checking `signal.aborted`) avoids silently relabeling a real
    // failure as "Retry aborted" when the abort lands during the gap.
    if (isAbortError(err)) {
      throw new Error("Retry aborted");
    }
    throw err;
  }
}

function isAbortError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === "AbortError";
}
