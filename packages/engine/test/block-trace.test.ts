/**
 * Tests for the block_trace observability gate (FIX-573).
 *
 * Validates only the env-var gating behavior here; the unified block_trace
 * lifecycle is exercised end-to-end by `execution-trace.test.ts` and the
 * BlockValue tests.
 */
import { describe, expect, it, afterEach } from "vitest";
import { isTraceObservabilityEnabled } from "@flow-state-dev/core";

describe("isTraceObservabilityEnabled", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns true when FSDEV_TRACE_OBSERVABILITY=true', () => {
    process.env.FSDEV_TRACE_OBSERVABILITY = "true";
    expect(isTraceObservabilityEnabled()).toBe(true);
  });

  it('returns false when FSDEV_TRACE_OBSERVABILITY=false', () => {
    process.env.FSDEV_TRACE_OBSERVABILITY = "false";
    expect(isTraceObservabilityEnabled()).toBe(false);
  });

  it('defaults to true when NODE_ENV is not production', () => {
    delete process.env.FSDEV_TRACE_OBSERVABILITY;
    process.env.NODE_ENV = "development";
    expect(isTraceObservabilityEnabled()).toBe(true);
  });

  it('defaults to false when NODE_ENV is production', () => {
    delete process.env.FSDEV_TRACE_OBSERVABILITY;
    process.env.NODE_ENV = "production";
    expect(isTraceObservabilityEnabled()).toBe(false);
  });
});
