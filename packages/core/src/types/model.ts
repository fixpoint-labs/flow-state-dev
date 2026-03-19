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

export type GeneratorModelUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

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
};

export type GeneratorModelTool = {
  name: string;
  description?: string;
  parameters?: ZodTypeAny;
  execute?: (args: unknown, options?: { toolCallId?: string }) => Promise<unknown>;
};

export type GeneratorModelStreamChunk = {
  type: "text_delta" | "tool_call_delta" | "reasoning_delta" | "source_url" | "finish";
  textDelta?: string;
  reasoningDelta?: string;
  toolCallDelta?: { toolCallId: string; toolName: string; argsDelta?: string };
  /** Source reference from a provider-native tool (e.g., web search). */
  source?: GeneratorModelSource;
  finishReason?: string;
  usage?: GeneratorModelUsage;
  fullResult?: GeneratorModelResult;
};

/**
 * Callback invoked before each step of the AI SDK's multi-step tool loop.
 * Returns updated system/messages/activeTools for the step, or undefined to
 * keep defaults.
 */
export type PrepareStepResult = {
  system?: unknown;
  messages?: unknown[];
  /** Tool names to enable for this step (filters the compiled tool set). */
  activeTools?: string[];
};

export type PrepareStepFn = (stepInfo: {
  stepNumber: number;
  messages: unknown[];
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
  }): Promise<GeneratorModelResult>;
  stream?(options: {
    messages: unknown[];
    tools?: GeneratorModelTool[];
    providerTools?: ProviderTool[];
    maxTokens?: number;
    signal?: AbortSignal;
    maxSteps?: number;
    providerOptions?: Record<string, unknown>;
    prepareStep?: PrepareStepFn;
  }): AsyncIterable<GeneratorModelStreamChunk>;
  /**
   * Resolves a provider-native search tool from normalized config.
   * Returns undefined if the provider does not support search tools.
   * Implemented by the AI SDK adapter based on provider detection.
   */
  resolveSearchTool?(config: GeneratorSearchConfig): { name: string; tool: unknown } | undefined;
}

export type ModelResolver = (
  modelId: string,
  blockName?: string
) => GeneratorModel;
