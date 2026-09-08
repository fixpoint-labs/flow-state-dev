/**
 * Cost, decision 3: an ESTIMATE from the framework's one price table, present
 * only when the block knows which model ran, and ABSENT — never zero —
 * otherwise.
 *
 * The absences are the point. `cost: 0` reads as "this run was free"; `null`
 * reads as "nobody knows", which is the truth in all three cases below and the
 * only one a spend report can present honestly.
 */
import { describe, it, expect } from "vitest";
import { findModelEntry } from "@flow-state-dev/core";
import { estimateCodexCost } from "../src/cost";
import type { CodexRunUsage } from "../src/types";

const USAGE: CodexRunUsage = {
  inputTokens: 1_000_000,
  cachedInputTokens: 0,
  cacheWriteInputTokens: 0,
  outputTokens: 1_000_000,
  reasoningOutputTokens: 250_000,
};

describe("estimateCodexCost", () => {
  it("prices a configured, known Codex model and always says the number is an estimate", () => {
    const cost = estimateCodexCost(USAGE, "gpt-5.4-codex");
    expect(cost).not.toBeNull();
    expect(cost?.basis).toBe("estimated");
    expect(cost?.usd).toBeGreaterThan(0);
  });

  it("core's table knows the Codex models, so a Codex run is priceable at all", () => {
    // The rows are the change to core this issue makes. Without them a Codex
    // run silently falls through to whichever generic OpenAI row happens to be
    // a substring match — a price nobody chose.
    expect(findModelEntry("gpt-5.4-codex")?.pricing).toBeDefined();
    expect(findModelEntry("gpt-5.4-codex-mini")?.pricing).toBeDefined();
    // The mini variant must not be priced as the full model: `includes` matching
    // means a missing row is not a missing price, it is the WRONG price.
    expect(findModelEntry("gpt-5.4-codex-mini")?.pricing?.promptPer1M).toBeLessThan(
      findModelEntry("gpt-5.4-codex")!.pricing!.promptPer1M,
    );
  });

  it("prices cached input at the cache-read rate, not the prompt rate", () => {
    const allCached = estimateCodexCost(
      { ...USAGE, cachedInputTokens: USAGE.inputTokens },
      "gpt-5.4-codex",
    );
    const noneCached = estimateCodexCost(USAGE, "gpt-5.4-codex");
    expect(allCached!.usd).toBeLessThan(noneCached!.usd);
  });

  it("does not price reasoning tokens twice — they are already inside the output count", () => {
    const withReasoning = estimateCodexCost(USAGE, "gpt-5.4-codex");
    const withoutReasoning = estimateCodexCost(
      { ...USAGE, reasoningOutputTokens: 0 },
      "gpt-5.4-codex",
    );
    expect(withReasoning!.usd).toBe(withoutReasoning!.usd);
  });

  it("is absent, not zero, when the model was left to Codex's default", () => {
    expect(estimateCodexCost(USAGE, undefined)).toBeNull();
    expect(estimateCodexCost(USAGE, "")).toBeNull();
  });

  it("is absent when core's table has no priced row for the model", () => {
    expect(estimateCodexCost(USAGE, "some-unreleased-codex-model")).toBeNull();
  });

  it("is absent when the run reported no usage", () => {
    expect(estimateCodexCost(null, "gpt-5.4-codex")).toBeNull();
  });
});
