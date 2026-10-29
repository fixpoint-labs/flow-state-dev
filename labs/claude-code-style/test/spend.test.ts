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
    expect(spendLine(task(spend(null, null, true)), { split: true })).toBe("claude-sonnet-4-5 · no tokens reported yet");
  });

  it("sums input and output on a card, and splits them on the sheet", () => {
    expect(spendLine(task(spend(10_100, 2_300)))).toBe("claude-sonnet-4-5 · 12.4k tokens");
    expect(spendLine(task(spend(10_100, 2_300)), { split: true })).toBe("claude-sonnet-4-5 · 10.1k in · 2.3k out");
  });

  it("marks a count still missing a source as partial, and a side nobody reported as not reported", () => {
    expect(spendLine(task(spend(10_100, 2_300, true)))).toBe("claude-sonnet-4-5 · 12.4k tokens (partial)");
    expect(spendLine(task(spend(10_100, null, true)), { split: true })).toBe("claude-sonnet-4-5 · 10.1k in · not reported out (partial)");
  });

  it("names the harness first where no harness tag shows it, and leaves out what nobody named", () => {
    expect(spendLine(task(spend(10_100, 2_300)), { harness: true })).toBe("Claude Code · claude-sonnet-4-5 · 12.4k tokens");
    expect(spendLine(task({ ...spend(10_100, 2_300)!, harness: null, model: null }), { harness: true })).toBe("12.4k tokens");
  });

  it("shortens counts to k and M", () => {
    expect([tokenCount(980), tokenCount(12_400), tokenCount(1_250_000)]).toEqual(["980", "12.4k", "1.3M"]);
  });
});
