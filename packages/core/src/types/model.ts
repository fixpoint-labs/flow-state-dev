import type { ZodTypeAny } from "zod";
import type { ModelIdentity } from "@flow-state-dev/contracts";

// `ModelIdentity` is a pure shape consumed by the item taxonomy, so its
// declaration lives in the zero-dependency `@flow-state-dev/contracts` layer.
// Re-exported here to preserve the `@flow-state-dev/core/types` surface.
export type { ModelIdentity };

// ---------------------------------------------------------------------------
// Provider-native search config (normalized across providers)
// ---------------------------------------------------------------------------

export type GeneratorSearchConfig = {
  /** Max number of search invocations per generation. Maps to Anthropic `maxUses`. */
  maxUses?: number;
  /** Only search these domains. Maps to Anthropic/OpenAI `allowedDomains`. */
  allowedDomains?: string[];
  /** Never search these domains. Maps to Anthropic `blockedDomains`. */
  blockedDomains?: string[];
  /** Approximate user location for geo-relevant results. */
  userLocation?: {
    type: "approximate";
    city?: string;
    region?: string;
    country?: string;
    timezone?: string;
  };
  /** Search depth / context size. Maps to OpenAI `searchContextSize`. */
  searchDepth?: "low" | "medium" | "high";
};

// ---------------------------------------------------------------------------
// Provider-defined tools (passthrough to AI SDK without block compilation)
// ---------------------------------------------------------------------------

/**
 * Opaque wrapper for a Vercel AI SDK provider-defined tool. Passed through
 * to the AI SDK without compilation — the provider executes it server-side.
 *
 * Use the `providerTool()` factory to create instances.
 */
export type ProviderTool = {
  readonly __providerTool: true;
  /** The raw AI SDK tool object to pass through. */
  readonly tool: unknown;
  /** Display name for observability (item stream, devtool). */
  readonly name: string;
};

// ---------------------------------------------------------------------------
// Source references (returned by provider-native tools like web search)
// ---------------------------------------------------------------------------

export type GeneratorModelSource = {
  type: "source";
  sourceType: "url";
  id: string;
  url: string;
  title?: string;
  providerMetadata?: Record<string, Record<string, unknown>>;
};

// ---------------------------------------------------------------------------

export type GeneratorModelToolCall = {
  toolCallId: string;
  toolName: string;
  args: unknown;
};

export type GeneratorModelUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /**
   * Tokens billed at the cache write rate (~1.25x input). Populated when
   * a prompt-cache-enabled request creates a new cache entry.
   */
  cacheCreationInputTokens?: number;
  /**
   * Tokens billed at the cache read rate (~0.1x input). Populated when
   * a prompt-cache-enabled request hits an existing cache entry.
   */
  cacheReadInputTokens?: number;
};

// ---------------------------------------------------------------------------
// Prompt caching
// ---------------------------------------------------------------------------

/** Cache tier. Anthropic currently exposes `5m` and `1h` ephemeral tiers. */
export type CachingTtl = "5m" | "1h";

/** Where the adapter places cache breakpoints on Anthropic-flavored calls. */
export type CachingBreakpointMode = "auto" | "manual";

/**
 * Normalized caching config carried on a generator block and passed through
 * the `ModelCallOptions` to the AI SDK adapter. Every field is optional so
 * users can override just the axis they care about; defaults are documented
 * in `@flow-state-dev/core` `DEFAULT_CACHING_CONFIG`.
 */
export interface CachingConfig {
  /** Emit cache markers at all. Default `true`. */
  enabled?: boolean;
  /**
   * `auto` — adapter decides breakpoint placement.
   * `manual` — adapter passes user-supplied `cacheControl` through untouched.
   * Default `auto`.
   */
  breakpoints?: CachingBreakpointMode;
  /** Ephemeral tier for Anthropic markers. Default `5m`. */
  ttl?: CachingTtl;
}

export type GeneratorStepResult = {
  text?: string;
  toolCalls?: GeneratorModelToolCall[];
  toolResults?: Array<{ toolCallId: string; toolName: string; result: unknown }>;
  finishReason?: string;
  usage?: GeneratorModelUsage;
};

export type GeneratorModelResult = {
  text?: string;
  structuredOutput?: unknown;
  toolCalls?: GeneratorModelToolCall[];
  finishReason?: string;
  usage?: GeneratorModelUsage;
  providerMetadata?: Record<string, Record<string, unknown>>;
  steps?: GeneratorStepResult[];
  /** Sources from provider-native tools (e.g., web search results). */
  sources?: GeneratorModelSource[];
  /**
   * Resolved identity of the model that produced this result. Internal carrier
   * threaded from `wrapAiSdkModel` / `createFallbackModel` up to the generator
   * block, which stamps the public `model: ModelIdentity` field on emitted
   * items and on `BlockTraceItem`.
   */
  resolvedIdentity?: ModelIdentity;
};

export type GeneratorModelTool = {
  name: string;
  description?: string;
  parameters?: ZodTypeAny;
  execute?: (args: unknown, options?: { toolCallId?: string }) => Promise<unknown>;
  /**
   * Optional mapper from the structured tool output to the string the model
   * sees on its next turn. Forwarded to the AI SDK as `toModelOutput`. When
   * omitted, the AI SDK uses the structured output verbatim. Sourced from a
   * block's `mapModelOutput` declaration.
   */
  toModelOutput?: (output: unknown) => string | Promise<string>;
};

export type GeneratorModelStreamChunk = {
  type: "text_delta" | "tool_call_delta" | "tool_result" | "reasoning_delta" | "source_url" | "tool_input_start" | "finish";
  textDelta?: string;
  reasoningDelta?: string;
  toolCallDelta?: { toolCallId: string; toolName: string; argsDelta?: string };
  /** Completed tool result from the AI SDK's multi-step loop. */
  toolResult?: { toolCallId: string; toolName: string; result: unknown };
  /** Info about a tool that started executing (including provider-executed tools). */
  toolInput?: { toolName: string; providerExecuted?: boolean };
  /** Source reference from a provider-native tool (e.g., web search). */
  source?: GeneratorModelSource;
  finishReason?: string;
  usage?: GeneratorModelUsage;
  fullResult?: GeneratorModelResult;
  /**
   * Resolved identity of the model producing this chunk. Stamped on every
   * chunk once known (typically from the first AI SDK response or fallback
   * candidate selection).
   */
  resolvedIdentity?: ModelIdentity;
};

/**
 * Callback invoked before each step of the AI SDK's multi-step tool loop.
 * Returns updated system/messages/activeTools for the step, or undefined to
 * keep defaults.
 */
export type PrepareStepResult = {
  /**
   * Switch to a different model for this step. The model ID string is
   * re-resolved through the model resolver at the AI SDK adapter layer.
   * Only effective when the GeneratorModel was created via
   * `createAiSdkModelResolver` (not `wrapAiSdkModel`).
   */
  modelId?: string;
  system?: unknown;
  messages?: unknown[];
  /** Tool names to enable for this step (filters the compiled tool set). */
  activeTools?: string[];
};

export type PrepareStepFn = (stepInfo: {
  stepNumber: number;
  messages: unknown[];
  steps: GeneratorStepResult[];
}) => Promise<PrepareStepResult | undefined | void>;

export interface GeneratorModel {
  modelId: string;
  generate(options: {
    messages: unknown[];
    tools?: GeneratorModelTool[];
    providerTools?: ProviderTool[];
    outputSchema?: ZodTypeAny;
    maxTokens?: number;
    signal?: AbortSignal;
    maxSteps?: number;
    providerOptions?: Record<string, unknown>;
    prepareStep?: PrepareStepFn;
    /**
     * Prompt-cache config. When set, the AI SDK adapter stamps provider-
     * specific cache markers (e.g. Anthropic `cacheControl`) on the
     * request before dispatch. Omitted or `undefined` uses framework
     * defaults (auto breakpoints, 5m TTL, enabled).
     */
    caching?: CachingConfig;
  }): Promise<GeneratorModelResult>;
  stream?(options: {
    messages: unknown[];
    tools?: GeneratorModelTool[];
    providerTools?: ProviderTool[];
    outputSchema?: ZodTypeAny;
    maxTokens?: number;
    signal?: AbortSignal;
    maxSteps?: number;
    providerOptions?: Record<string, unknown>;
    prepareStep?: PrepareStepFn;
    caching?: CachingConfig;
  }): AsyncIterable<GeneratorModelStreamChunk>;
  /**
   * Resolves a provider-native search tool from normalized config.
   * Returns undefined if the provider does not support search tools.
   * Implemented by the AI SDK adapter based on provider detection.
   */
  resolveSearchTool?(config: GeneratorSearchConfig): { name: string; tool: unknown } | undefined;
}

/**
 * Per-call options for the {@link ModelResolver} callable. Currently only
 * carries `preferProvider` — a provider preference that overrides any
 * resolver-level default for this single resolution. Used to plumb a
 * `selectModel`-collected preference through to intent resolution.
 */
export interface ResolveModelCallOptions {
  /** Preferred provider(s). Overrides resolver-level providerPreference. */
  preferProvider?: string | string[];
}

export type ModelResolver = ((
  modelId: string,
  blockName?: string,
  options?: ResolveModelCallOptions
) => GeneratorModel) & {
  /**
   * Returns the primary underlying model string for any model reference.
   * For intents, returns the first available provider/model string (applying
   * the resolver's provider preference and any call-site override).
   * For direct model strings, returns the input as-is.
   *
   * @example
   * resolver.resolveId("intent/chat")
   *   // → "anthropic/claude-sonnet-4-6"
   * resolver.resolveId("intent/chat", { preferProvider: "openai" })
   *   // → "openai/gpt-5.4" (reorders the intent before walking it)
   * resolver.resolveId("anthropic/claude-sonnet-4-6")
   *   // → "anthropic/claude-sonnet-4-6"
   */
  resolveId(
    modelId: string,
    options?: { preferProvider?: string | string[] }
  ): string;
};
