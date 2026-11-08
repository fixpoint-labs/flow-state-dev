/**
 * The spend line a task's card, row and sheet draw from its row's `spend`,
 * through the registry's `spend` item: a count nobody has reported reads as
 * such, never as 0, since a 0 would say the run spent nothing; the vendor's
 * charge shows when the run reported one, and a subscription run shows none.
 */
import { describe, expect, it } from "vitest";
import type { LabTask } from "../src/adapter";
import { spendLine } from "../src/components/flow-state/spend";
import { harnessLabelOf } from "../src/components/ThreadStatus";

const task = (spend?: LabTask["spend"]): LabTask => ({ id: "t1", title: "t", goal: "g", status: "in_progress", ...(spend ? { spend } : {}) });
const spend = (inputTokens: number | null, outputTokens: number | null, unreported = false, costUsd: number | null = null): NonNullable<LabTask["spend"]> => ({
  harness: "claude-code",
  model: "claude-sonnet-4-5",
  inputTokens,
  outputTokens,
  costUsd,
  unreported,
  live: true,
});

describe("a task's spend line", () => {
  it("is empty for a task that never ran", () => {
    expect(spendLine(task().spend)).toBe("");
  });

  it("names the model and says no tokens are reported yet, never 0, before the run reports", () => {
    expect(spendLine(spend(null, null, true))).toBe("claude-sonnet-4-5 · no tokens reported yet");
  });

  it("sums input and output on a card, and splits them on the sheet", () => {
    expect(spendLine(spend(10_100, 2_300))).toBe("claude-sonnet-4-5 · 12.4k tokens");
    expect(spendLine(spend(10_100, 2_300), { split: true })).toBe("claude-sonnet-4-5 · 10.1k in · 2.3k out");
  });

  it("shows the vendor's charge an API-key run reported, and none for a subscription run", () => {
    expect(spendLine(spend(10_100, 2_300, false, 0.42))).toBe("claude-sonnet-4-5 · 12.4k tokens · $0.42");
    expect(spendLine(spend(10_100, 2_300, false, null))).not.toContain("$");
  });

  it("names the harness first where no harness tag shows it, and leaves out what nobody named", () => {
    const named = task(spend(10_100, 2_300));
    expect(spendLine(named.spend, { harnessLabel: harnessLabelOf(named) })).toBe("Claude Code · claude-sonnet-4-5 · 12.4k tokens");
    const anonymous = task({ ...spend(10_100, 2_300), harness: null, model: null });
    expect(spendLine(anonymous.spend, { harnessLabel: harnessLabelOf(anonymous) })).toBe("12.4k tokens");
  });
});
