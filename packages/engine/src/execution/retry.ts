/**
 * Retry policy resolution and retry-loop execution utilities for runtime blocks/actions.
 *
 * The retry loop itself is delegated to `p-retry`; this file owns
 * retryable-error classification, abort mapping, and the `onRetry` "scheduled"
 * semantics.
 *
 * The **policy merge** is not here: `mergeRetryPolicy` and `ResolvedRetryPolicy`
 * live in `@flow-state-dev/core` beside the `RetryPolicy` type they operate on
 * (FIX-1230). They are re-exported below so this module's public surface is
 * unchanged. The merge is pure arithmetic on a core type and `core` cannot
 * import `engine`, so keeping it here put it out of reach of core's own
 * `buildToolExecutor`.
 */
import pRetry, { AbortError, type FailedAttemptError } from "p-retry";
import { SuspensionError, mergeRetryPolicy } from "@flow-state-dev/core";
import type { ResolvedRetryPolicy } from "@flow-state-dev/core";
import { FlowError } from "../errors/flow-error";

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

  // SuspensionError is a control-flow signal (`ctx.suspend()`), not a failure.
  // Retrying it would re-execute the action on every suspension instead of
  // pausing. Classify it non-retryable so retryWithPolicy routes it through the
  // AbortError path, which rejects with the original error untouched — letting
  // the runtime catch it and suspend the request.
  if (error instanceof SuspensionError) {
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

// Re-exported so `execution/index.ts` and existing importers keep one import
// site for the retry surface even though the merge now lives in core.
export { mergeRetryPolicy };
export type { ResolvedRetryPolicy };
