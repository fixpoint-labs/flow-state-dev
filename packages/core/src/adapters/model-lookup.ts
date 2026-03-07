import type { CostEstimator, ModelUsageEntry } from "../types/flow";

export interface ModelLookupEntry {
  /** Substring matched against the model ID — first match wins. */
  keyword: string;
  /** Estimated characters per token for the model family. */
  charsPerToken: number;
  /** USD per 1M tokens. */
  pricing?: {
    promptPer1M: number;
    completionPer1M: number;
    cacheReadPer1M?: number;
    cacheCreationPer1M?: number;
  };
}

export const DEFAULT_MODEL_LOOKUP: ModelLookupEntry[] = [
  { keyword: "claude-opus-4", charsPerToken: 4.0, pricing: { promptPer1M: 15.0, completionPer1M: 75.0 } },
  { keyword: "claude-sonnet-4-5", charsPerToken: 4.0, pricing: { promptPer1M: 3.0, completionPer1M: 15.0 } },
  { keyword: "claude-sonnet-4", charsPerToken: 4.0, pricing: { promptPer1M: 3.0, completionPer1M: 15.0 } },
  { keyword: "claude-haiku-4-5", charsPerToken: 4.0, pricing: { promptPer1M: 0.8, completionPer1M: 4.0 } },
  { keyword: "claude-haiku-4", charsPerToken: 4.0, pricing: { promptPer1M: 0.8, completionPer1M: 4.0 } },
  { keyword: "claude-opus", charsPerToken: 4.0 },
  { keyword: "claude-sonnet", charsPerToken: 4.0 },
  { keyword: "claude-haiku", charsPerToken: 4.0 },
  { keyword: "claude", charsPerToken: 4.0 },
  { keyword: "gpt-5-mini", charsPerToken: 3.5, pricing: { promptPer1M: 0.25, completionPer1M: 2.0 } },
  { keyword: "gpt-5-nano", charsPerToken: 3.5, pricing: { promptPer1M: 0.05, completionPer1M: 0.4 } },
  { keyword: "gpt-5", charsPerToken: 3.5, pricing: { promptPer1M: 1.25, completionPer1M: 10.0 } },
  { keyword: "gpt-4.1-mini", charsPerToken: 3.5, pricing: { promptPer1M: 0.4, completionPer1M: 1.6 } },
  { keyword: "gpt-4.1-nano", charsPerToken: 3.5, pricing: { promptPer1M: 0.1, completionPer1M: 0.4 } },
  { keyword: "gpt-4.1", charsPerToken: 3.5, pricing: { promptPer1M: 2.0, completionPer1M: 8.0 } },
  { keyword: "gpt-4o-mini", charsPerToken: 3.5, pricing: { promptPer1M: 0.15, completionPer1M: 0.6 } },
  { keyword: "gpt-4o", charsPerToken: 3.5, pricing: { promptPer1M: 2.5, completionPer1M: 10.0 } },
  { keyword: "gpt-4-turbo", charsPerToken: 3.5, pricing: { promptPer1M: 10.0, completionPer1M: 30.0 } },
  { keyword: "gpt-4", charsPerToken: 3.5 },
  { keyword: "gpt-3.5", charsPerToken: 3.75 },
  { keyword: "o1-mini", charsPerToken: 3.5, pricing: { promptPer1M: 1.1, completionPer1M: 4.4 } },
  { keyword: "o1", charsPerToken: 3.5, pricing: { promptPer1M: 15.0, completionPer1M: 60.0 } },
  { keyword: "o3-mini", charsPerToken: 3.5 },
  { keyword: "o3", charsPerToken: 3.5 },
  { keyword: "gemini-3.0-pro", charsPerToken: 3.8 },
  { keyword: "gemini-3.0-flash", charsPerToken: 3.8 },
  { keyword: "gemini-3", charsPerToken: 3.8 },
  { keyword: "gemini-2.0-flash", charsPerToken: 3.8, pricing: { promptPer1M: 0.1, completionPer1M: 0.4 } },
  { keyword: "gemini-1.5-pro", charsPerToken: 3.8, pricing: { promptPer1M: 1.25, completionPer1M: 5.0 } },
  { keyword: "gemini-1.5-flash", charsPerToken: 3.8, pricing: { promptPer1M: 0.075, completionPer1M: 0.3 } },
  { keyword: "gemini", charsPerToken: 3.8 },
  { keyword: "llama-3.3", charsPerToken: 3.9 },
  { keyword: "llama-3", charsPerToken: 3.9 },
  { keyword: "llama", charsPerToken: 3.9 }
];

export function findModelEntry(
  model: string,
  lookup: ModelLookupEntry[] = DEFAULT_MODEL_LOOKUP
): ModelLookupEntry | undefined {
  return lookup.find((entry) => model.includes(entry.keyword));
}

export function modelPricingEstimator(
  lookup: ModelLookupEntry[] = DEFAULT_MODEL_LOOKUP
): CostEstimator {
  return {
    estimate(usage: ModelUsageEntry, model: string): number {
      const entry = findModelEntry(model, lookup);
      if (entry?.pricing === undefined) {
        return 0;
      }

      const { promptPer1M, completionPer1M, cacheReadPer1M, cacheCreationPer1M } = entry.pricing;
      const readRate = cacheReadPer1M ?? promptPer1M * 0.1;
      const writeRate = cacheCreationPer1M ?? promptPer1M * 1.25;
      const regularPrompt = Math.max(
        0,
        usage.prompt - usage.cacheReadTokens - usage.cacheCreationTokens
      );

      return (
        (regularPrompt / 1_000_000) * promptPer1M +
        (usage.completion / 1_000_000) * completionPer1M +
        (usage.cacheReadTokens / 1_000_000) * readRate +
        (usage.cacheCreationTokens / 1_000_000) * writeRate
      );
    }
  };
}
