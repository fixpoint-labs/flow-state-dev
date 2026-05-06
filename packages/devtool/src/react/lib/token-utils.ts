/**
 * Token usage aggregation utilities.
 *
 * Scans OutputItem arrays for BlockOutputItem.modelUsage and produces
 * per-model and total summaries for display in request headers and
 * session-level panels.
 */
import type { OutputItem } from "@flow-state-dev/core/items";
import type { DevtoolItem } from "./item-types";

export type ModelTokenSummary = {
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  calls: number;
};

export type TokenSummary = {
  byModel: ModelTokenSummary[];
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  calls: number;
};

const EMPTY_SUMMARY: TokenSummary = {
  byModel: [],
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  calls: 0,
};

export function aggregateTokenUsage(items: DevtoolItem[]): TokenSummary {
  const byModel = new Map<string, ModelTokenSummary>();
  let totalPrompt = 0;
  let totalCompletion = 0;
  let totalAll = 0;
  let totalCacheRead = 0;
  let totalCacheCreation = 0;
  let calls = 0;

  for (const item of items) {
    if (item.type !== "block_output") continue;
    const usage = (item as DevtoolItem & { type: "block_output" }).modelUsage;
    if (!usage) continue;

    calls++;
    totalPrompt += usage.promptTokens;
    totalCompletion += usage.completionTokens;
    totalAll += usage.totalTokens;
    totalCacheRead += usage.cacheReadTokens ?? 0;
    totalCacheCreation += usage.cacheCreationTokens ?? 0;

    const key = usage.model || "unknown";
    const existing = byModel.get(key);
    if (existing) {
      existing.promptTokens += usage.promptTokens;
      existing.completionTokens += usage.completionTokens;
      existing.totalTokens += usage.totalTokens;
      existing.cacheReadTokens += usage.cacheReadTokens ?? 0;
      existing.cacheCreationTokens += usage.cacheCreationTokens ?? 0;
      existing.calls++;
    } else {
      byModel.set(key, {
        model: key,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
        cacheReadTokens: usage.cacheReadTokens ?? 0,
        cacheCreationTokens: usage.cacheCreationTokens ?? 0,
        calls: 1,
      });
    }
  }

  if (calls === 0) return EMPTY_SUMMARY;

  return {
    byModel: Array.from(byModel.values()),
    promptTokens: totalPrompt,
    completionTokens: totalCompletion,
    totalTokens: totalAll,
    cacheReadTokens: totalCacheRead,
    cacheCreationTokens: totalCacheCreation,
    calls,
  };
}

/** Compact display: "1.2k" for 1200, "45" for 45. */
export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(0)}k`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
