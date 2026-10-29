/**
 * The spend line a task's card, row and sheet draw from its row's `spend`:
 * a count nobody has reported reads as such, never as 0, since a 0 would say
 * the run spent nothing.
 */
import { describe, expect, it } from "vitest";
import type { TaskRow } from "../src/adapter";
import { spendLine, tokenCount } from "../src/components/Spend";

const task = (spend?: TaskRow["spend"]): TaskRow => ({ id: "t1", title: "t", goal: "g", status: "in_progress", ...(spend ? { spend } : {}) });
const spend = (inputTokens: number | null, outputTokens: number | null, unreported = false): TaskRow["spend"] => ({
  harness: "claude-code",
  model: "claude-sonnet-4-5",
  inputTokens,
  outputTokens,
  unreported,
  live: true,
});

describe("a task's spend line", () => {
  it("is empty for a task that never ran", () => {
    expect(spendLine(task())).toBe("");
  });

  it("names the model and says no tokens are reported yet, never 0, before the run reports", () => {
    expect(spendLine(task(spend(null, null, true)))).toBe("claude-sonnet-4-5 · no tokens reported yet");
    expect(spendLine(task(spend(null, null, true)), true)).not.toMatch(/\b0\b/);
  });

  it("sums input and output on a card, and splits them on the sheet", () => {
    expect(spendLine(task(spend(10_100, 2_300)))).toBe("claude-sonnet-4-5 · 12.4k tokens");
    expect(spendLine(task(spend(10_100, 2_300)), true)).toBe("claude-sonnet-4-5 · 10.1k in · 2.3k out");
  });

  it("shortens counts to k and M", () => {
    expect([tokenCount(980), tokenCount(12_400), tokenCount(1_250_000)]).toEqual(["980", "12.4k", "1.3M"]);
  });
});
