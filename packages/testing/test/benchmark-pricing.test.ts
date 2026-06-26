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
