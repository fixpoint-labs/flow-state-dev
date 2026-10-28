import { describe, expect, it } from "vitest";
import { estimateCostUsd } from "../src/benchmark/pricing";

describe("estimateCostUsd", () => {
  it("prices a known cheap-paid model from token usage", () => {
    // gpt-5.4-mini: $0.2/1M input, $0.8/1M output.
    const cost = estimateCostUsd("openai/gpt-5.4-mini", {
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
      totalTokens: 2_000_000
    });
    expect(cost).toBeCloseTo(0.2 + 0.8, 6);
  });

  it("prices Claude Sonnet 4.6 above Haiku (the cross-model cost gap)", () => {
    const usage = {
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
      totalTokens: 2_000_000,
    };
    // claude-sonnet-4-6: $3/1M input, $15/1M output.
    const sonnet = estimateCostUsd("anthropic/claude-sonnet-4-6", usage);
    expect(sonnet).toBeCloseTo(3.0 + 15.0, 6);
    // The expensive baseline must price strictly above the cheap executor for the
    // same usage — the gap is what makes "cheap-orchestrated vs expensive-single"
    // a real question rather than a free lunch.
    const haiku = estimateCostUsd("anthropic/claude-haiku-4-5", usage);
    expect(sonnet).toBeGreaterThan(haiku);
  });

  it("prices every current-generation tier, so a maxCostUsd budget can trip on any of them", () => {
    const usage = { promptTokens: 1_000_000, completionTokens: 1_000_000, totalTokens: 2_000_000 };
    // An unpriced model estimates to 0 and never trips the budget, so the top
    // tier (the expensive one a budget exists for) must be priced too.
    expect(estimateCostUsd("openai/gpt-6-astra", usage)).toBeCloseTo(10.0 + 50.0, 6);
    expect(estimateCostUsd("anthropic/claude-opus-5-5", usage)).toBeCloseTo(4.0 + 20.0, 6);
    expect(estimateCostUsd("vercel:anthropic/claude-opus-5.5", usage)).toBeCloseTo(4.0 + 20.0, 6);
    expect(estimateCostUsd("openai/gpt-6.1-sol", usage)).toBeCloseTo(2.0 + 10.0, 6);
    expect(estimateCostUsd("openai/gpt-6-luna", usage)).toBeCloseTo(0.1 + 0.5, 6);
  });

  it("returns 0 for an unknown model without throwing", () => {
    expect(
      estimateCostUsd("some/unknown-model", {
        promptTokens: 1000,
        completionTokens: 1000,
        totalTokens: 2000
      })
    ).toBe(0);
  });

  it("returns 0 when usage is absent", () => {
    expect(estimateCostUsd("openai/gpt-5.4-mini", undefined)).toBe(0);
  });
});
