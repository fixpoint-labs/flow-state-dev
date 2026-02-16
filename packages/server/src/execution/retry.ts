import type { RetryPolicy } from "@flow-state-dev/core/types";
import { FlowError } from "../errors/flow-error";

export type ResolvedRetryPolicy = {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryableErrors?: Array<new (...args: any[]) => Error>;
};

const DEFAULT_MAX_ATTEMPTS = 1;
const DEFAULT_BASE_DELAY_MS = 0;
const DEFAULT_MAX_DELAY_MS = 5000;

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

async function waitWithAbort(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (ms <= 0) {
    return;
  }

  if (signal?.aborted === true) {
    throw new Error("Retry aborted");
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = (): void => {
      clearTimeout(timeout);
      cleanup();
      reject(new Error("Retry aborted"));
    };

    const cleanup = (): void => {
      signal?.removeEventListener("abort", onAbort);
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

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

  let attempt = 0;
  while (attempt < policy.maxAttempts) {
    attempt += 1;

    try {
      return await run();
    } catch (error) {
      const normalized =
        error instanceof Error ? error : new Error("Unknown retry failure");
      const canRetry =
        attempt < policy.maxAttempts && isRetryableError(normalized, policy);

      if (!canRetry) {
        throw normalized;
      }

      await options.onRetry?.(attempt, normalized);
      const delayMs = Math.min(
        policy.maxDelayMs,
        policy.baseDelayMs * Math.pow(2, attempt - 1)
      );
      await waitWithAbort(delayMs, options.signal);
    }
  }

  throw new Error("Retry loop exited unexpectedly");
}
