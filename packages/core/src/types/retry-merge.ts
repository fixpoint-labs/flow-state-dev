/**
 * Retry-policy merge, beside the `RetryPolicy` type it operates on.
 *
 * This lived in `@flow-state-dev/engine` (`execution/retry.ts`) until FIX-1230,
 * which is a package lower than it belongs: `RetryPolicy` is declared here in
 * `core` (`types/block.ts`), the function's only dependency is that type, and
 * `core` declares no dependency on `engine` — so anything in `core` that needed
 * to resolve a retry policy simply could not reach it.
 *
 * `buildToolExecutor` is exactly that caller. Moving the function is therefore a
 * correction rather than a new seam: the retry loop itself (`p-retry`, abort
 * mapping, `SuspensionError` classification) is genuinely engine-side and stays
 * there, while the pure policy arithmetic comes home.
 *
 * **One merge rule, one place.** The alternative — resolving per-tool retry with
 * `??` in `core` and leaving the merge in `engine` — would have given
 * `BlockConfig.retry` two different precedence rules under one field name:
 * merge-over-ambient on the block path, replace-ambient on the tool path.
 */

import type { RetryPolicy } from "./block";

/** Concrete retry settings after block and runtime policy merge. */
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
 *
 * Block-level wins field by field (`{ ...runtimeRetry, ...blockRetry }`): the
 * nearer declaration is the more specific one. `maxAttempts` clamps to at least
 * 1, so `1` is how a caller says "run once, never retry".
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
