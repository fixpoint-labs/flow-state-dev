/**
 * Tool-executor suspension control-flow (FIX-814).
 *
 * `runWithRetry` must NEVER retry a suspension signal — retrying would
 * re-enter the gate under the configured policy before the generator loop can
 * surface it (or convert a rejection into the denial result). This holds even
 * when a retry policy with no `retryableErrors` allowlist would otherwise
 * retry every error.
 */
import { describe, it, expect, vi } from "vitest";
import { runWithRetry } from "../src/blocks/internal/tool-executor";
import {
  SuspensionError,
  SuspensionRejectedError,
  SuspensionTimeoutError,
} from "../src/errors/suspension-error";

describe("runWithRetry — suspension bail (FIX-814)", () => {
  it("does not retry a SuspensionError even with a permissive retry policy", async () => {
    const run = vi.fn(async () => {
      throw new SuspensionError({ suspensionId: "s1", reason: "approval" });
    });
    await expect(
      runWithRetry(run, { maxAttempts: 5, baseDelayMs: 0 })
    ).rejects.toBeInstanceOf(SuspensionError);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not retry a SuspensionRejectedError even with a permissive retry policy", async () => {
    const run = vi.fn(async () => {
      throw new SuspensionRejectedError("s1", "alice");
    });
    await expect(
      runWithRetry(run, { maxAttempts: 5, baseDelayMs: 0 })
    ).rejects.toBeInstanceOf(SuspensionRejectedError);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not retry a SuspensionTimeoutError even with a permissive retry policy", async () => {
    const run = vi.fn(async () => {
      throw new SuspensionTimeoutError("s1");
    });
    await expect(
      runWithRetry(run, { maxAttempts: 5, baseDelayMs: 0 })
    ).rejects.toBeInstanceOf(SuspensionTimeoutError);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("still retries an ordinary error under the same policy (control)", async () => {
    let attempts = 0;
    const run = vi.fn(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("transient");
      return "ok";
    });
    await expect(
      runWithRetry(run, { maxAttempts: 5, baseDelayMs: 0 })
    ).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(3);
  });
});
