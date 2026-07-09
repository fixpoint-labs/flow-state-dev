import type {
  GeneratorModel,
  GeneratorModelResult,
  GeneratorModelStreamChunk,
  GeneratorSearchConfig,
} from "../types";
import type { ModelGroupDefaults, RetryPolicy } from "./types";
import { deepMerge } from "../helpers/deep-merge";

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
  /**
   * Fires when a candidate succeeds — once per `generate` call, and once
   * per `stream` call (after the candidate's stream yielded a first chunk
   * without throwing). Lets the caller record which concrete model won the
   * fallback race so its identity can be surfaced to consumers.
   */
  onResolved?: (entry: FallbackModelEntry) => void;
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

/**
 * Provider/gateway package load failure surfaced by `createModelResolver`'s
 * lazy loader (stamped with `name: "ProviderLoadError"`). A broken install
 * cannot heal on retry, but the next candidate uses a different package —
 * both fallback loops skip straight to it. Recognized by name (realm/module
 * safe), matching the duck-typed checks in {@link isRetryableError}.
 */
function isProviderLoadError(error: unknown): boolean {
  return error instanceof Error && error.name === "ProviderLoadError";
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
  fn: (model: GeneratorModel, entry: FallbackModelEntry) => Promise<T>,
  onResolved?: (entry: FallbackModelEntry) => void
): Promise<T> {
  const errors: Array<{ modelId: string; error: Error }> = [];

  for (const entry of models) {
    for (let attempt = 1; attempt <= retryPolicy.maxAttemptsPerModel; attempt++) {
      try {
        const result = await fn(entry.model, entry);
        onResolved?.(entry);
        return result;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        errors.push({ modelId: entry.modelId, error: err });

        if (isProviderLoadError(error) || !isRetryableError(error)) {
          // Broken provider install or non-retryable error: skip remaining
          // attempts, try next model
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

/**
 * Streaming fallback loop shared by `stream` and `streamStep`: try each
 * candidate once, in order; a candidate that fails BEFORE yielding its first
 * chunk falls through to the next one, while an error after content has been
 * emitted surfaces (a restart would duplicate already-yielded output).
 * `pickStream` selects which streaming method to run per candidate
 * (`model.stream` or `model.streamStep`); candidates without it are skipped.
 */
async function* executeStreamWithFallback(
  models: FallbackModelEntry[],
  defaults: ModelGroupDefaults | undefined,
  groupName: string,
  onResolved: ((entry: FallbackModelEntry) => void) | undefined,
  pickStream: (
    model: GeneratorModel
  ) => GeneratorModel["stream"] | GeneratorModel["streamStep"],
  options: Record<string, unknown>
): AsyncGenerator<GeneratorModelStreamChunk> {
  const errors: Array<{ modelId: string; error: Error }> = [];

  for (let i = 0; i < models.length; i++) {
    const entry = models[i]!;
    const streamFn = pickStream(entry.model);
    if (!streamFn) continue;

    let yieldedFirstChunk = false;
    try {
      const merged = mergeDefaults(options, defaults, entry.providerName);
      for await (const chunk of streamFn.call(
        entry.model,
        merged as Parameters<NonNullable<GeneratorModel["stream"]>>[0]
      )) {
        if (!yieldedFirstChunk) {
          yieldedFirstChunk = true;
          onResolved?.(entry);
        }
        yield chunk;
      }
      return;
    } catch (error) {
      const err =
        error instanceof Error ? error : new Error(String(error));
      errors.push({ modelId: entry.modelId, error: err });

      // Provider-load failure: the lazy loader rejected while
      // executing the candidate's package, before anything streamed.
      // The install is broken for THIS candidate only — skip to the
      // next one, mirroring the generate loop. Guarded on "no chunk
      // yielded" so an error after content has been emitted still
      // surfaces instead of silently restarting on another model.
      if (!yieldedFirstChunk && isProviderLoadError(error)) {
        continue;
      }

      if (!isRetryableError(error)) {
        throw error;
      }
      // Retryable — fall back to next model
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Creates a GeneratorModel that tries models in order with retry-per-model.
 * On retryable errors, retries the current model up to `maxAttemptsPerModel`,
 * then falls back to the next model in the list.
 *
 * Exposes the single-step `generateStep`/`streamStep` (FIX-814) — but only
 * over the subset of candidates that implement them — so a generator using a
 * fallback model group can drive the framework-owned per-step loop (and the
 * in-loop suspension built on it). Each step call runs the same
 * per-candidate retry / default-merge / `onResolved` fallback wrapping
 * `generate`/`stream` already use. When no candidate implements the step
 * methods, they are absent and the generator falls back to the SDK-owned
 * `generate({ maxSteps })` path (checked via `model.generateStep === undefined`).
 *
 * NOTE (deliberate v1 limitation): this instance is CACHED and shared across
 * concurrent requests (see `createModelResolver`'s `intentCache`), so it holds
 * no cross-call "pinned candidate" state — each step call independently
 * selects a candidate. A candidate that transient-fails mid-loop can therefore
 * hand its successor another provider's accumulated turn history (including
 * provider-specific reasoning-signature blocks). True per-loop candidate
 * pinning needs loop-scoped state that the shared instance cannot safely carry;
 * see the report. In practice a candidate that succeeded on step 0 typically
 * continues to win.
 */
export function createFallbackModel(config: FallbackModelConfig): GeneratorModel {
  const { models, defaults, retryPolicy, groupName, onResolved } = config;

  if (models.length === 0) {
    throw new Error(
      `Model group "${groupName}" has no available models. ` +
        `Configure API keys for at least one provider in the group, ` +
        `or set AI_GATEWAY_API_KEY / OPENROUTER_API_KEY for gateway access.`
    );
  }

  const hasStreamSupport = models.some((m) => m.model.stream !== undefined);
  const stepModels = models.filter((m) => m.model.generateStep !== undefined);
  const streamStepModels = models.filter((m) => m.model.streamStep !== undefined);

  return {
    modelId: `fsd:${groupName}`,

    async generate(options): Promise<GeneratorModelResult> {
      return executeWithFallback(
        models,
        retryPolicy,
        groupName,
        (model, entry) =>
          model.generate(mergeDefaults(options, defaults, entry.providerName)),
        onResolved
      );
    },

    stream: hasStreamSupport
      ? (options: Parameters<NonNullable<GeneratorModel["stream"]>>[0]) =>
          executeStreamWithFallback(
            models,
            defaults,
            groupName,
            onResolved,
            (model) => model.stream,
            options
          )
      : undefined,

    generateStep: stepModels.length > 0
      ? async (options): Promise<GeneratorModelResult> =>
          executeWithFallback(
            stepModels,
            retryPolicy,
            groupName,
            (model, entry) =>
              model.generateStep!(mergeDefaults(options, defaults, entry.providerName)),
            onResolved
          )
      : undefined,

    streamStep: streamStepModels.length > 0
      ? (options: Parameters<NonNullable<GeneratorModel["streamStep"]>>[0]) =>
          executeStreamWithFallback(
            streamStepModels,
            defaults,
            groupName,
            onResolved,
            (model) => model.streamStep,
            options
          )
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
