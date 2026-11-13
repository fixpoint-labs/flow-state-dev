/**
 * Usage's labels: what a window, an age and a harness are called on screen.
 * The rows themselves are the Lab's; these only name them.
 */
import { describe, expect, it } from "vitest";
import { ClientHttpError, type Client } from "@flow-state-dev/client";
import {
  ageLabel,
  billingLabel,
  costLabel,
  noTokensReported,
  reportedTokensLabel,
  harnessName,
  levelLabel,
  percentLabel,
  readHarnessUsageView,
  readWorkerUsageView,
  tokensLabel,
  toHarnessUsage,
  toWorkerUsage,
  USAGE_PERIODS,
  windowName,
  type HarnessUsage,
} from "../src/lib/usage";

describe("Usage labels", () => {
  it("names a window by its length, after its limit's name when it has one", () => {
    expect(windowName({ id: "codex:primary", label: null, minutes: 300 })).toBe("5-hour");
    expect(windowName({ id: "codex:secondary", label: null, minutes: 10_080 })).toBe("Weekly");
    expect(windowName({ id: "codex_other:primary", label: "GPT-6 Spark", minutes: 300 })).toBe("GPT-6 Spark · 5-hour");
    expect(windowName({ id: "codex:primary", label: null, minutes: 45 })).toBe("45-minute");
  });

  it("falls back to the limit and its slot when the vendor gave no length", () => {
    expect(windowName({ id: "codex:primary", label: null, minutes: null })).toBe("codex · primary");
    expect(windowName({ id: "codex_other:secondary", label: "GPT-6 Spark", minutes: null })).toBe("GPT-6 Spark · secondary");
    expect(windowName({ id: "five_hour", label: null, minutes: null })).toBe("five_hour");
  });

  it("says how old a reading is in words", () => {
    expect(ageLabel(4_000)).toBe("a few seconds ago");
    expect(ageLabel(3 * 60_000)).toBe("3 min ago");
    expect(ageLabel(3 * 3_600_000)).toBe("3 h ago");
    expect(ageLabel(3 * 86_400_000)).toBe("3 days ago");
  });

  it("shows a percent as the vendor gave it, fraction and all", () => {
    expect(percentLabel(7.5)).toBe("7.5% used");
    expect(percentLabel(42)).toBe("42% used");
  });

  it("says how close a window with no percent is, never as a number", () => {
    expect(levelLabel("ok", "claude-code")).toBe("under Claude Code's warning line");
    expect(levelLabel("warning", "claude-code")).toBe("near its limit");
    expect(levelLabel("reached", "claude-code")).toBe("limit reached");
    expect(levelLabel(null, "claude-code")).not.toMatch(/\d/);
  });

  it("names harnesses for the user, and keeps only rows that are rows", () => {
    expect(harnessName("codex")).toBe("Codex");
    expect(harnessName("claude-code")).toBe("Claude Code");
    expect(toHarnessUsage({ harnesses: [{ harness: "codex" }, null, "x"] })).toEqual([{ harness: "codex" }]);
    expect(toHarnessUsage(undefined)).toEqual([]);
  });
});

/**
 * The worker section's labels (FIX-2145): a dollar figure only where a harness
 * reported one, and nothing that reads as what is left.
 */
describe("Usage by worker labels", () => {
  it("says tokens were not reported when no run reported any, never 0", () => {
    // A harness killed before its result reports no usage: its stored count is
    // 0, and showing "0 tokens" would claim a measured zero.
    const silent = { runs: 2, unreported: 2 };
    const partial = { runs: 2, unreported: 1 };
    expect(noTokensReported(silent)).toBe(true);
    expect(noTokensReported(partial)).toBe(false);
    expect(reportedTokensLabel(0, [silent])).toBe("tokens not reported");
    expect(reportedTokensLabel(0, [silent, silent])).toBe("tokens not reported");
    expect(reportedTokensLabel(1_500, [silent, partial])).toBe("1,500 tokens");
  });

  it("shows a cost only where one was reported, and says who reported it", () => {
    expect(costLabel({ source: "claude-code", kind: "harness", costUsd: 0.42 })).toBe("$0.42, reported by Claude Code");
    expect(costLabel({ source: "claude-code", kind: "harness", costUsd: null })).toBe("cost not reported");
    expect(costLabel({ source: "openai/gpt-6-luna", kind: "model", costUsd: null })).not.toMatch(/\$/);
  });

  it("counts tokens in words a user reads at a glance", () => {
    expect(tokensLabel(16)).toBe("16 tokens");
    expect(tokensLabel(1_500)).toBe("1,500 tokens");
    expect(tokensLabel(12_500)).toBe("12.5 K tokens");
    expect(tokensLabel(1_200_000)).toBe("1.2 M tokens");
  });

  it("names how a run was paid for, and nothing when nobody said", () => {
    expect(billingLabel("api-key")).toBe("API key");
    expect(billingLabel("subscription")).toBe("subscription");
    expect(billingLabel(null)).toBeNull();
  });

  it("offers today, 7 and 30 days, and keeps only rows that are rows", () => {
    expect(USAGE_PERIODS.map((p) => p.days)).toEqual([1, 7, 30]);
    expect(toWorkerUsage({ workers: [{ worker: "coder" }, null, 3] })).toEqual([{ worker: "coder" }]);
    expect(toWorkerUsage(undefined)).toEqual([]);
  });

  it("never labels a total as left, remaining or a limit", () => {
    const words = [
      costLabel({ source: "claude-code", kind: "harness", costUsd: 1 }),
      costLabel({ source: "codex", kind: "harness", costUsd: null }),
      tokensLabel(42),
      ...USAGE_PERIODS.map((p) => p.label),
    ].join(" ");
    expect(words).not.toMatch(/left|remaining|limit/i);
  });
});

/**
 * The usage reads over a fake connection: what Re-check and the views answer.
 * A Lab with no usage reads as `null`; any other refusal reaches the screen as
 * a failure; and a Re-check that fails never hides the stored rows.
 */
const STORED: HarnessUsage = {
  harness: "codex",
  status: "windows",
  reason: null,
  plan: "pro",
  windows: [],
  checkedAt: 1,
  ageMs: 0,
  refreshError: null,
};

function fakeLab(answers: { recheck?: () => Promise<unknown>; view?: () => Promise<unknown> }) {
  return {
    userId: "alice",
    resource: () => ({ send: answers.recheck ?? (async () => ({ asked: [] })) }),
    view: async () => ({ value: await (answers.view ?? (async () => ({ harnesses: [STORED], workers: [] })))(), topics: [] }),
  } as unknown as Client;
}

const refused = (status: number, error: string) => async () => {
  throw new ClientHttpError(`Request failed (${status})`, { status, body: { error, message: error } });
};

describe("the usage reads", () => {
  it("read as no usage only when nothing serves it: a 404, or a Re-check whose writer flow isn't registered", async () => {
    expect(await readHarnessUsageView(fakeLab({ recheck: refused(404, "unknown_resource") }))).toBeNull();
    expect(await readHarnessUsageView(fakeLab({ recheck: refused(409, "runby_flow_missing") }))).toBeNull();
    expect(await readHarnessUsageView(fakeLab({ view: refused(404, "unknown_view") }))).toBeNull();
    expect(await readWorkerUsageView(fakeLab({ view: refused(404, "unknown_view") }), 7)).toBeNull();
  });

  it("pass any other 409 on to the screen, from Re-check and from either view", async () => {
    await expect(readHarnessUsageView(fakeLab({ recheck: refused(409, "declarations_disagree") }))).rejects.toThrow(/409/);
    await expect(readHarnessUsageView(fakeLab({ view: refused(409, "declarations_disagree") }))).rejects.toThrow(/409/);
    await expect(readWorkerUsageView(fakeLab({ view: refused(409, "runby_flow_missing") }), 7)).rejects.toThrow(/409/);
  });

  it("still answer the stored rows when Re-check fails, with why beside them", async () => {
    const harnesses = await readHarnessUsageView(fakeLab({ recheck: refused(500, "store offline") }));
    expect(harnesses).toEqual([{ ...STORED, refreshError: "store offline" }]);
  });
});
