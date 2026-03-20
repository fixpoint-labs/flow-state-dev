import type {
  GeneratorModel,
  GeneratorModelResult,
  GeneratorModelStreamChunk,
  GeneratorSearchConfig,
} from "../types";
import type { ModelGroupDefaults, RetryPolicy } from "./types";
import { deepMerge } from "../utils/deep-merge";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FallbackModelEntry {
  model: GeneratorModel;
  modelId: string;
  /** Provider prefix extracted from 'provider:model-id'. */
  providerName: string;
}

interface FallbackModelConfig {
  groupName: string;
  models: FallbackModelEntry[];
  defaults?: ModelGroupDefaults;
  retryPolicy: Required<RetryPolicy>;
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

export function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  // AI SDK APICallError.isRetryable
  if (
    "isRetryable" in error &&
    typeof (error as Record<string, unknown>).isRetryable === "boolean"
  ) {
    return (error as Record<string, unknown>).isRetryable as boolean;
  }

  // LoadAPIKeyError — not retryable, should fall back to next model
  if (
    error.constructor?.name === "LoadAPIKeyError" ||
    error.constructor?.name === "AI_LoadAPIKeyError"
  ) {
    return false;
  }

  // HTTP status codes
  if ("statusCode" in error) {
    const status = (error as Record<string, unknown>).statusCode;
    return status === 429 || status === 500 || status === 502 || status === 503;
  }

  // Network errors
  if (
    error.message.includes("fetch failed") ||
    error.message.includes("ECONNREFUSED") ||
    error.message.includes("ETIMEDOUT")
  ) {
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Default merging
// ---------------------------------------------------------------------------

function mergeDefaults<T extends Record<string, unknown>>(
  options: T,
  defaults: ModelGroupDefaults | undefined,
  providerName: string
): T {
  if (!defaults) return options;

  const merged: Record<string, unknown> = { ...options };

  // maxTokens: group default only if caller didn't set it
  if (merged.maxTokens === undefined && defaults.maxTokens !== undefined) {
    merged.maxTokens = defaults.maxTokens;
  }

  // providerOptions: filter to only the resolved provider, then deep-merge
  if (defaults.providerOptions) {
    const providerSpecific = defaults.providerOptions[providerName];
    if (providerSpecific) {
      const filtered: Record<string, Record<string, unknown>> = {
        [providerName]: providerSpecific,
      };
      merged.providerOptions = merged.providerOptions
        ? deepMerge(
            filtered,
            merged.providerOptions as Record<string, unknown>
          )
        : filtered;
    }
  }

  return merged as T;
}

// ---------------------------------------------------------------------------
// Fallback execution
// ---------------------------------------------------------------------------

async function executeWithFallback<T>(
  models: FallbackModelEntry[],
  retryPolicy: Required<RetryPolicy>,
  groupName: string,
  fn: (model: GeneratorModel, entry: FallbackModelEntry) => Promise<T>
): Promise<T> {
  const errors: Array<{ modelId: string; error: Error }> = [];

  for (const entry of models) {
    for (let attempt = 1; attempt <= retryPolicy.maxAttemptsPerModel; attempt++) {
      try {
        return await fn(entry.model, entry);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        errors.push({ modelId: entry.modelId, error: err });

        if (!isRetryableError(error)) {
          // Non-retryable: skip remaining attempts, try next model
          break;
        }

        if (attempt < retryPolicy.maxAttemptsPerModel) {
          // Exponential backoff before retry
          const delay = Math.min(
            retryPolicy.baseDelayMs * Math.pow(2, attempt - 1),
            retryPolicy.maxDelayMs
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
        // After max attempts, fall through to next model
      }
    }
  }

  // All models exhausted
  const summary = errors
    .map((e) => `  ${e.modelId}: ${e.error.message}`)
    .join("\n");

  throw new Error(
    `All models in group "${groupName}" failed:\n${summary}`
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Creates a GeneratorModel that tries models in order with retry-per-model.
 * On retryable errors, retries the current model up to `maxAttemptsPerModel`,
 * then falls back to the next model in the list.
 */
export function createFallbackModel(config: FallbackModelConfig): GeneratorModel {
  const { models, defaults, retryPolicy, groupName } = config;

  if (models.length === 0) {
    throw new Error(
      `Model group "${groupName}" has no available models. ` +
        `Configure API keys for at least one provider in the group, ` +
        `or set AI_GATEWAY_API_KEY / OPENROUTER_API_KEY for gateway access.`
    );
  }

  const hasStreamSupport = models.some((m) => m.model.stream !== undefined);

  return {
    modelId: `fsd:${groupName}`,

    async generate(options): Promise<GeneratorModelResult> {
      return executeWithFallback(models, retryPolicy, groupName, (model, entry) =>
        model.generate(mergeDefaults(options, defaults, entry.providerName))
      );
    },

    stream: hasStreamSupport
      ? async function* stream(
          options: Parameters<NonNullable<GeneratorModel["stream"]>>[0]
        ): AsyncGenerator<GeneratorModelStreamChunk> {
          // For streaming, try each model once. If it fails before yielding
          // its first chunk, fall back to the next model.
          const errors: Array<{ modelId: string; error: Error }> = [];

          for (let i = 0; i < models.length; i++) {
            const entry = models[i]!;
            if (!entry.model.stream) continue;

            try {
              const merged = mergeDefaults(options, defaults, entry.providerName);
              yield* entry.model.stream(merged);
              return;
            } catch (error) {
              const err =
                error instanceof Error ? error : new Error(String(error));
              errors.push({ modelId: entry.modelId, error: err });

              if (i === models.length - 1 || !isRetryableError(error)) {
                // Last model or non-retryable — throw
                if (!isRetryableError(error)) {
                  throw error;
                }
              }
              // Fall back to next model
            }
          }

          // If we get here, all streaming models failed with retryable errors
          const summary = errors
            .map((e) => `  ${e.modelId}: ${e.error.message}`)
            .join("\n");
          throw new Error(
            `All streaming models in group "${groupName}" failed:\n${summary}`
          );
        }
      : undefined,

    resolveSearchTool(config: GeneratorSearchConfig) {
      // Delegate to the first model that supports search tools
      for (const entry of models) {
        if (entry.model.resolveSearchTool) {
          const result = entry.model.resolveSearchTool(config);
          if (result) return result;
        }
      }
      return undefined;
    },
  };
}
