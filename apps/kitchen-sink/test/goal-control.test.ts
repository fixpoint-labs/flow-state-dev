/**
 * `goalControl()` — the one gate every goal control passes through.
 *
 * A control swaps real behaviour for a broken stand-in so a goal check can be
 * seen to fail. That must never reach a deployed build, so the gate reads
 * `GOAL_CONTROL` only under `KITCHEN_SINK_TEST_MODE=1`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { goalControl } from "@/lib/goal-control";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("goalControl", () => {
  it("names no control outside test mode, whatever GOAL_CONTROL says", () => {
    vi.stubEnv("GOAL_CONTROL", "no-author-filter");
    vi.stubEnv("KITCHEN_SINK_TEST_MODE", "");
    expect(goalControl()).toBeUndefined();
    vi.stubEnv("KITCHEN_SINK_TEST_MODE", "0");
    expect(goalControl()).toBeUndefined();
  });

  it("names the control in test mode, and none when GOAL_CONTROL is empty", () => {
    vi.stubEnv("KITCHEN_SINK_TEST_MODE", "1");
    vi.stubEnv("GOAL_CONTROL", "no-author-filter");
    expect(goalControl()).toBe("no-author-filter");
    vi.stubEnv("GOAL_CONTROL", "");
    expect(goalControl()).toBeUndefined();
  });
});
