// @vitest-environment happy-dom
/**
 * The spend line every app draws for a task or a harness turn (FIX-2398).
 *
 * Why it matters: a person picks a harness by what it cost, so the line must
 * say the vendor's charge when there is one and never invent one: a
 * subscription run, which bills nothing per run, shows no dollar figure, and
 * a count nobody reported reads as such rather than 0.
 *
 * Red states produced before these were trusted: format a `null` cost as
 * `$0.00`: the subscription case fails; drop the attempts guard: a
 * first-attempt task reads "1 attempts".
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Spend, durationText, spendLine, type SpendSummary } from "../../registry/components/spend";

afterEach(cleanup);

const view = (over: Partial<SpendSummary> = {}): SpendSummary => ({
  harness: "claude-code",
  model: "claude-sonnet-4-5",
  inputTokens: 10_100,
  outputTokens: 2_300,
  costUsd: 0.42,
  unreported: false,
  live: false,
  ...over,
});

describe("spendLine", () => {
  it("says the model, the tokens and the vendor's charge", () => {
    expect(spendLine(view())).toBe("claude-sonnet-4-5 · 12.4k tokens · $0.42");
    expect(spendLine(view(), { split: true, harnessLabel: "Claude Code" })).toBe("Claude Code · claude-sonnet-4-5 · 10.1k in · 2.3k out · $0.42");
  });

  it("shows no dollar figure for a run that reported no charge, never $0.00", () => {
    expect(spendLine(view({ costUsd: null }))).toBe("claude-sonnet-4-5 · 12.4k tokens");
    expect(spendLine(view({ costUsd: undefined }))).not.toContain("$");
  });

  it("reads an unreported count as such, and marks a partial one", () => {
    expect(spendLine(view({ inputTokens: null, outputTokens: null, costUsd: null }))).toBe("claude-sonnet-4-5 · no tokens reported yet");
    expect(spendLine(view({ unreported: true }))).toContain("12.4k tokens (partial)");
  });

  it("counts attempts only from the second on, and says how long it took", () => {
    expect(spendLine(view(), { attempts: 1 })).not.toContain("attempt");
    expect(spendLine(view(), { attempts: 3, durationMs: 252_000 })).toBe("claude-sonnet-4-5 · 12.4k tokens · $0.42 · 3 attempts · 4m 12s");
    expect(durationText(42_400)).toBe("42s");
    expect(durationText(3_780_000)).toBe("1h 3m");
  });

  it("is empty when there is no spend to show", () => {
    expect(spendLine(null)).toBe("");
    expect(spendLine(undefined)).toBe("");
  });
});

describe("Spend", () => {
  it("draws the line, marked live while the run works, and nothing without spend", () => {
    const { container } = render(<Spend spend={view({ live: true })} />);
    expect(screen.getByText("claude-sonnet-4-5 · 12.4k tokens · $0.42").getAttribute("data-spend")).toBe("live");
    cleanup();
    expect(render(<Spend spend={null} />).container.innerHTML).toBe("");
    void container;
  });
});
