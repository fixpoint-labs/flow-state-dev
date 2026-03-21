import { describe, expect, it } from "vitest";
import {
  createEstimateTokenCounter,
  DEFAULT_MODEL_LOOKUP,
  findModelEntry,
  modelPricingEstimator
} from "../src";

describe("model lookup", () => {
  it("prefers the first keyword match", () => {
    const entry = findModelEntry("anthropic/claude-sonnet-4-5-20250514", DEFAULT_MODEL_LOOKUP);
    expect(entry?.keyword).toBe("claude-sonnet-4-5");
  });


  it("matches GPT-5 variants before the family fallback", () => {
    const mini = findModelEntry("openai/gpt-5-mini-2026-01-15", DEFAULT_MODEL_LOOKUP);
    const nano = findModelEntry("openai/gpt-5-nano", DEFAULT_MODEL_LOOKUP);
    const base = findModelEntry("openai/gpt-5", DEFAULT_MODEL_LOOKUP);

    expect(mini?.keyword).toBe("gpt-5-mini");
    expect(nano?.keyword).toBe("gpt-5-nano");
    expect(base?.keyword).toBe("gpt-5");
  });


  it("matches Gemini 3 variants before generic Gemini fallback", () => {
    const pro = findModelEntry("google/gemini-3.1-pro", DEFAULT_MODEL_LOOKUP);
    const flash = findModelEntry("google/gemini-3-flash", DEFAULT_MODEL_LOOKUP);
    const family = findModelEntry("google/gemini-3", DEFAULT_MODEL_LOOKUP);

    expect(pro?.keyword).toBe("gemini-3.1-pro");
    expect(flash?.keyword).toBe("gemini-3-flash");
    expect(family?.keyword).toBe("gemini");
  });

  it("estimates counts using model-specific ratios", async () => {
    const counter = createEstimateTokenCounter();
    const estimated = await counter.count("12345678", "openai/gpt-5-mini");
    expect(estimated).toBe(3);
  });

  it("accounts for cache token pricing", () => {
    const estimator = modelPricingEstimator();
    const usd = estimator.estimate(
      {
        prompt: 1000,
        completion: 500,
        total: 1500,
        cacheReadTokens: 400,
        cacheCreationTokens: 200
      },
      "anthropic/claude-sonnet-4-5"
    );

    expect(usd).toBeGreaterThan(0);
    expect(Number(usd.toFixed(6))).toBeCloseTo(0.00957, 5);
  });
});
