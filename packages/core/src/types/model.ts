import type { ZodTypeAny } from "zod";

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

// ---------------------------------------------------------------------------
// Tool-call approval (FIX-275) — surfaced when a gated tool call ends the turn
// ---------------------------------------------------------------------------

/**
 * A tool call the model requested that requires human approval before it
 * runs. Surfaced on {@link GeneratorModelResult.approvalRequests} when the
 * model turn ended awaiting approval. `toolName`/`args` are the framework
 * tool name and parsed arguments (reverse-mapped from provider aliases).
 */
export type GeneratorApprovalRequest = {
  /** Provider approval id; round-trips back on the matching response. */
  approvalId: string;
  toolCallId: string;
  toolName: string;
  args: unknown;
};

/**
 * A human decision on a previously-surfaced {@link GeneratorApprovalRequest},
 * fed back through the resolver's `continuation` option on resume. `approved`
 * false materializes a denial tool result the model adapts to; `reason` is
 * surfaced to the model as the denial's steering context.
 */
export type GeneratorApprovalResponse = {
  approvalId: string;
  approved: boolean;
  reason?: string;
};

/**
 * Replay payload for resuming a suspended tool-approval turn (FIX-275).
 * `messages` is the persisted turn (request messages + the assistant
 * tool-call/sibling-result messages); `approvalResponses` are the human
 * decisions the adapter appends as a tool message before re-entering the
 * model loop.
 */
export type ModelContinuation = {
  messages: unknown[];
  approvalResponses: GeneratorApprovalResponse[];
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

/**
 * Identity of a model that actually executed a generator call. Surfaced on
 * generator-emitted items and on `BlockTraceItem` so consumers can answer
 * "which model produced this?" without consulting internal/debug surfaces.
 *
 * `actual` is always populated. `requested` and `gateway` appear only when
 * meaningful (intent fallback, gateway-routed call, provider substitution).
 */
export interface ModelIdentity {
  /**
   * The concrete model that actually executed the call. Prefers the
   * provider-reported model id (e.g. `gpt-5.5-2025-04-12`); falls back to
   * the framework's winning candidate string (e.g. `openai/gpt-5.5`) when
   * the provider doesn't report one.
   */
  actual: string;
  /**
   * What the caller requested, when different from `actual`. Populated for
   * intent strings (`intent/chat`), for non-first candidates inside a
   * fallback chain, and when the provider reports a different model id
   * than the framework requested. Omitted when equal to `actual`.
   */
  requested?: string;
  /** The gateway that routed the call, when one was used. */
  gateway?: string;
}

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
  /**
   * Tool-call approval requests surfaced when the model called one or more
   * gated tools and the turn ended awaiting human approval (FIX-275). Empty
   * or undefined on an ordinary turn. When present, the generator suspends
   * instead of parsing output.
   */
  approvalRequests?: GeneratorApprovalRequest[];
  /**
   * The serialized model messages produced this turn (assistant tool-call
   * message plus any completed sibling tool results), from the provider's
   * response. Carried only when `approvalRequests` is present so a resumed
   * turn can continue from this exact state without replaying the model call.
   */
  responseMessages?: unknown[];
  /**
   * The compiled model messages sent on this call. Paired with
   * `responseMessages` to reconstruct the full turn on resume. Carried only
   * when `approvalRequests` is present.
   */
  requestMessages?: unknown[];
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
  /**
   * Human-approval gate for this tool (FIX-275). Forwarded to the AI SDK as
   * the tool's `needsApproval`: a boolean, or a predicate over the parsed
   * arguments. When it resolves true the SDK ends the turn with a
   * tool-approval-request instead of executing. The generator stamps this
   * from its `toolApproval` policy combined with the block's
   * `requiresApproval` flag. Omitted when the tool can never gate.
   */
  needsApproval?: boolean | ((args: unknown) => boolean | Promise<boolean>);
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
    /**
     * Resume a previously-suspended tool-approval turn (FIX-275). When set,
     * the adapter replays `messages` (the persisted turn) plus a tool message
     * carrying the `approvalResponses`, instead of composing the call from
     * the normal `messages`/slot input. The SDK then executes approved tools
     * and materializes denial results for rejected ones — without replaying
     * the original model call.
     */
    continuation?: ModelContinuation;
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
