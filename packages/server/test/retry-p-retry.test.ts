/**
 * Behavior tests specific to the p-retry-backed `retryWithPolicy`. Covers
 * the wrapper's contract surface that isn't exercised by the broader
 * execution suite: `AbortError` mapping for non-retryable errors, signal
 * propagation, and `onRetry` cause-unwrapping / scheduled-only semantics.
 */
import { describe, expect, it } from "vitest";
import { SuspensionError } from "@flow-state-dev/core";
import {
  NetworkError,
  ValidationError,
  isRetryableError,
  retryWithPolicy
} from "../src";

describe("retryWithPolicy (p-retry backed)", () => {
  it("does not retry non-retryable FlowErrors (AbortError mapping)", async () => {
    let attempts = 0;
    await expect(
      retryWithPolicy(
        async () => {
          attempts += 1;
          throw new ValidationError("bad input");
        },
        {
          maxAttempts: 5,
          baseDelayMs: 0,
          maxDelayMs: 0
        }
      )
    ).rejects.toBeInstanceOf(ValidationError);
    expect(attempts).toBe(1);
  });

  it("never retries a SuspensionError, and preserves it raw", async () => {
    // SuspensionError is control flow, not a failure: a retry-configured
    // durable action that suspends must not re-execute on every suspension.
    // It also must not be relabeled "Retry aborted".
    let attempts = 0;
    const suspension = new SuspensionError({
      reason: "human_approval",
      suspensionId: "susp_1"
    });
    await expect(
      retryWithPolicy(
        async () => {
          attempts += 1;
          throw suspension;
        },
        { maxAttempts: 5, baseDelayMs: 0, maxDelayMs: 0 }
      )
    ).rejects.toBe(suspension);
    expect(attempts).toBe(1);
  });

  it("classifies SuspensionError as non-retryable regardless of policy", () => {
    const suspension = new SuspensionError({
      reason: "human_approval",
      suspensionId: "susp_2"
    });
    expect(
      isRetryableError(suspension, {
        maxAttempts: 5,
        baseDelayMs: 0,
        maxDelayMs: 0
      })
    ).toBe(false);
  });

  it("preserves the original FlowError instance through rejection", async () => {
    const original = new ValidationError("preserve me");
    await expect(
      retryWithPolicy(
        async () => {
          throw original;
        },
        {
          maxAttempts: 3,
          baseDelayMs: 0,
          maxDelayMs: 0
        }
      )
    ).rejects.toBe(original);
  });

  it("forwards the original error to onRetry, not the FailedAttemptError wrapper", async () => {
    const seen: Error[] = [];
    let attempts = 0;
    await retryWithPolicy(
      async () => {
        attempts += 1;
        if (attempts < 3) throw new NetworkError(`transient ${attempts}`);
        return "ok";
      },
      {
        maxAttempts: 3,
        baseDelayMs: 0,
        maxDelayMs: 0,
        retryableErrors: [NetworkError]
      },
      {
        onRetry: (_attempt, err) => {
          seen.push(err);
        }
      }
    );
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBeInstanceOf(NetworkError);
    expect(seen[0].message).toBe("transient 1");
    expect(seen[1]).toBeInstanceOf(NetworkError);
    expect(seen[1].message).toBe("transient 2");
  });

  it("only fires onRetry for attempts that will be retried, not the terminal failure", async () => {
    const callbacks: number[] = [];
    await expect(
      retryWithPolicy(
        async () => {
          throw new NetworkError("always fails");
        },
        {
          maxAttempts: 3,
          baseDelayMs: 0,
          maxDelayMs: 0,
          retryableErrors: [NetworkError]
        },
        {
          onRetry: (attempt) => {
            callbacks.push(attempt);
          }
        }
      )
    ).rejects.toBeInstanceOf(NetworkError);
    // Three attempts run, but onRetry fires only after attempts 1 and 2 (each
    // schedules another try); the third failure is terminal and should not
    // call onRetry.
    expect(callbacks).toEqual([1, 2]);
  });

  it("propagates a pre-aborted signal as 'Retry aborted'", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      retryWithPolicy(
        async () => {
          throw new NetworkError("never reached");
        },
        {
          maxAttempts: 3,
          baseDelayMs: 5,
          maxDelayMs: 5,
          retryableErrors: [NetworkError]
        },
        { signal: controller.signal }
      )
    ).rejects.toThrow("Retry aborted");
  });

  it("propagates a mid-backoff abort as 'Retry aborted'", async () => {
    const controller = new AbortController();
    const promise = retryWithPolicy(
      async () => {
        throw new NetworkError("retry me");
      },
      {
        maxAttempts: 4,
        baseDelayMs: 50,
        maxDelayMs: 50,
        retryableErrors: [NetworkError]
      },
      { signal: controller.signal }
    );
    setTimeout(() => controller.abort(), 5);
    await expect(promise).rejects.toThrow("Retry aborted");
  });

  it("forwards the original thrown error (with its own cause chain) to onRetry", async () => {
    const fetchErr = new Error("underlying fetch failed");
    const thrown = new NetworkError("transient", { cause: fetchErr });
    let received: Error | undefined;
    await expect(
      retryWithPolicy(
        async () => {
          throw thrown;
        },
        {
          maxAttempts: 2,
          baseDelayMs: 0,
          maxDelayMs: 0,
          retryableErrors: [NetworkError]
        },
        {
          onRetry: (_attempt, err) => {
            received = err;
          }
        }
      )
    ).rejects.toBeInstanceOf(NetworkError);
    // p-retry decorates the thrown error in-place; `received` should be the
    // NetworkError itself, not its `.cause` (which would be a regression to
    // an earlier draft of this wrapper).
    expect(received).toBe(thrown);
    expect(received?.cause).toBe(fetchErr);
  });

  it("isRetryableError respects FlowError.retryable=false even with no allowlist", () => {
    const policy = {
      maxAttempts: 3,
      baseDelayMs: 0,
      maxDelayMs: 0
    };
    expect(isRetryableError(new NetworkError("x"), policy)).toBe(true);
    expect(isRetryableError(new ValidationError("x"), policy)).toBe(false);
  });
});
