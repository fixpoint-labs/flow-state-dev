/**
 * Cost: an ESTIMATE from the framework's one price table, present only when the
 * block knows which model ran, and ABSENT — never zero — otherwise.
 *
 * The absences are the point. `cost: 0` reads as "this run was free"; `null`
 * reads as "nobody knows", which is the truth in every case below and the only
 * one a spend report can present honestly.
 */
import { describe, it, expect } from "vitest";
import { estimateCursorCost } from "../src/cost";
import type { CursorRunUsage } from "../src/types";

const USAGE: CursorRunUsage = {
  inputTokens: 1_000_000,
  outputTokens: 1_000_000,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 2_000_000,
  reasoningTokens: 250_000,
};

describe("estimateCursorCost", () => {
  it("prices a model core's table knows and always says the number is an estimate", () => {
    const cost = estimateCursorCost(USAGE, "gpt-5.4");
    expect(cost).not.toBeNull();
    expect(cost?.basis).toBe("estimated");
    expect(cost?.usd).toBeGreaterThan(0);
  });

  it("prices cached input at the cache-read rate, not the prompt rate", () => {
    const allCached = estimateCursorCost(
      { ...USAGE, inputTokens: 0, cacheReadTokens: USAGE.inputTokens },
      "gpt-5.4",
    );
    const noneCached = estimateCursorCost(USAGE, "gpt-5.4");
    expect(allCached!.usd).toBeLessThan(noneCached!.usd);
  });

  it("does not price reasoning tokens twice — they are already inside the output count", () => {
    const withReasoning = estimateCursorCost(USAGE, "gpt-5.4");
    const withoutReasoning = estimateCursorCost({ ...USAGE, reasoningTokens: 0 }, "gpt-5.4");
    expect(withReasoning!.usd).toBe(withoutReasoning!.usd);
  });

  it("is absent, not zero, when no model could be established", () => {
    expect(estimateCursorCost(USAGE, undefined)).toBeNull();
    expect(estimateCursorCost(USAGE, "")).toBeNull();
  });

  it("is absent when core's table has no priced row for the model", () => {
    // Cursor spells its own ids its own way, and the table does not carry those
    // spellings today. `null` is the honest answer: a substring fallback would
    // give a run a price somebody else's model charges, which is a WRONG number
    // rather than a missing one.
    expect(estimateCursorCost(USAGE, "composer-2.5")).toBeNull();
    expect(estimateCursorCost(USAGE, "claude-4.5-sonnet")).toBeNull();
  });

  it("is absent when the run reported no usage", () => {
    expect(estimateCursorCost(null, "gpt-5.4")).toBeNull();
  });
});
