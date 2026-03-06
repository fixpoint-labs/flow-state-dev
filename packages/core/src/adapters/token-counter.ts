import type { TokenCounter } from "../types/tokens";
import { DEFAULT_MODEL_LOOKUP, findModelEntry, type ModelLookupEntry } from "./model-lookup";

const FALLBACK_CHARS_PER_TOKEN = 4.0;

export function createEstimateTokenCounter(
  lookup: ModelLookupEntry[] = DEFAULT_MODEL_LOOKUP
): TokenCounter {
  return {
    async count(text: string, model: string): Promise<number> {
      const ratio = findModelEntry(model, lookup)?.charsPerToken ?? FALLBACK_CHARS_PER_TOKEN;
      return Math.ceil(text.length / ratio);
    },
    async countMessages(messages, model): Promise<number> {
      const ratio = findModelEntry(model, lookup)?.charsPerToken ?? FALLBACK_CHARS_PER_TOKEN;
      const total = messages.reduce((acc, message) => {
        return acc + JSON.stringify(message.content).length;
      }, 0);
      return Math.ceil(total / ratio);
    }
  };
}

export const estimateTokenCounter = createEstimateTokenCounter();
