import { generateText, streamText, Output, stepCountIs } from "ai";
import type {
  GeneratorModel,
  GeneratorModelResult,
  GeneratorModelSource,
  GeneratorModelStreamChunk,
  GeneratorModelTool,
  GeneratorModelToolCall,
  GeneratorSearchConfig,
  ModelResolver,
  PrepareStepFn,
  ProviderTool
} from "@flow-state-dev/core/types";
import { makeSchemaStrict } from "./makeSchemaStrict.js";

export type ResolveAiSdkLanguageModel = (modelId: string) => unknown;

// ---------------------------------------------------------------------------
// Internal helpers — normalise AI SDK result shapes into framework types
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function resolveNestedNumber(
  root: Record<string, unknown>,
  key: string
): number | undefined {
  const direct = asNumber(root[key]);
  if (direct !== undefined) {
    return direct;
  }

  const nested = asRecord(root[key]);
  if (nested === undefined) {
    return undefined;
  }

  return asNumber(nested.total);
}

function normalizeUsage(value: unknown): GeneratorModelResult["usage"] | undefined {
  const usage = asRecord(value);
  if (usage === undefined) {
    return undefined;
  }

  const promptTokens =
    resolveNestedNumber(usage, "promptTokens") ??
    resolveNestedNumber(usage, "inputTokens");
  const completionTokens =
    resolveNestedNumber(usage, "completionTokens") ??
    resolveNestedNumber(usage, "outputTokens");
  const totalTokens =
    resolveNestedNumber(usage, "totalTokens") ??
    (promptTokens === undefined || completionTokens === undefined
      ? undefined
      : promptTokens + completionTokens);

  if (
    promptTokens === undefined &&
    completionTokens === undefined &&
    totalTokens === undefined
  ) {
    return undefined;
  }

  return {
    promptTokens: promptTokens ?? 0,
    completionTokens: completionTokens ?? 0,
    totalTokens:
      totalTokens ?? (promptTokens ?? 0) + (completionTokens ?? 0)
  };
}

function normalizeToolCalls(value: unknown): GeneratorModelToolCall[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const toolCalls: GeneratorModelToolCall[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const candidate = asRecord(value[index]);
    if (candidate === undefined) {
      continue;
    }

    const toolName =
      (typeof candidate.toolName === "string" ? candidate.toolName : undefined) ??
      (typeof candidate.name === "string" ? candidate.name : undefined);
    if (toolName === undefined) {
      continue;
    }

    const toolCallId =
      (typeof candidate.toolCallId === "string" ? candidate.toolCallId : undefined) ??
      (typeof candidate.id === "string" ? candidate.id : undefined) ??
      `tool_call_${index}`;
    const args =
      candidate.args ?? candidate.input ?? candidate.arguments ?? {};

    toolCalls.push({
      toolCallId,
      toolName,
      args
    });
  }

  return toolCalls.length === 0 ? undefined : toolCalls;
}

function normalizeFinishReason(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  const record = asRecord(value);
  if (record === undefined) {
    return undefined;
  }

  return typeof record.unified === "string" ? record.unified : undefined;
}

function normalizeStructuredOutput(value: Record<string, unknown>): unknown {
  const keys = ["experimental_output", "experimentalOutput", "output"] as const;
  for (const key of keys) {
    try {
      const candidate = (value as Record<string, unknown>)[key];
      if (candidate !== undefined) {
        return candidate;
      }
    } catch {
      // Some AI SDK result getters throw when no structured output exists.
    }
  }

  return undefined;
}

function asProviderMetadata(
  value: unknown
): Record<string, Record<string, unknown>> | undefined {
  const record = asRecord(value);
  if (record === undefined) {
    return undefined;
  }

  const normalized: Record<string, Record<string, unknown>> = {};
  for (const [provider, metadata] of Object.entries(record)) {
    const providerRecord = asRecord(metadata);
    if (providerRecord !== undefined) {
      normalized[provider] = providerRecord;
    }
  }

  return Object.keys(normalized).length === 0 ? undefined : normalized;
}

function parseStructuredOutputFromText(text: string | undefined): unknown {
  if (typeof text !== "string" || text.length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Shared request builder — single place to compile AI SDK config
// ---------------------------------------------------------------------------

function buildAiSdkRequest(
  languageModel: unknown,
  options: {
    messages: unknown[];
    tools?: GeneratorModelTool[];
    providerTools?: ProviderTool[];
    outputSchema?: unknown;
    maxTokens?: number;
    signal?: AbortSignal;
    maxSteps?: number;
    providerOptions?: Record<string, unknown>;
    prepareStep?: PrepareStepFn;
  }
): Record<string, unknown> {
  const request: Record<string, unknown> = {
    model: languageModel,
    messages: options.messages
  };

  // Compile block tools — include execute if provided (enables AI SDK auto-execution)
  const hasBlockTools = options.tools !== undefined && options.tools.length > 0;
  const hasProviderTools = options.providerTools !== undefined && options.providerTools.length > 0;

  if (hasBlockTools || hasProviderTools) {
    const compiled: Record<string, unknown> = {};

    // Block tools: compiled with description, inputSchema, optional execute
    if (hasBlockTools) {
      for (const tool of options.tools!) {
        const entry: Record<string, unknown> = {
          description: tool.description,
          inputSchema:
            tool.parameters ?? {
              type: "object",
              properties: {},
              additionalProperties: true
            }
        };
        if (tool.execute !== undefined) {
          entry.execute = tool.execute;
        }
        compiled[tool.name] = entry;
      }
    }

    // Provider tools: raw AI SDK tool objects, passed through without compilation.
    // The provider handles execution server-side.
    if (hasProviderTools) {
      for (const pt of options.providerTools!) {
        compiled[pt.name] = pt.tool;
      }
    }

    request.tools = compiled;
  }

  // Multi-step: stopWhen controls when the AI SDK's loop terminates.
  // Default is stepCountIs(1) in the SDK, so only override when > 1.
  const maxSteps = options.maxSteps ?? 1;
  if (maxSteps > 1) {
    request.stopWhen = stepCountIs(maxSteps);
  }

  // prepareStep: called by the AI SDK before each step in the multi-step
  // loop. The generator uses this to re-resolve dynamic context/prompt
  // slot functions so the LLM sees fresh state on every iteration.
  if (options.prepareStep !== undefined) {
    const fn = options.prepareStep;
    request.prepareStep = async (stepInfo: { stepNumber: number; messages: unknown[] }) => {
      return fn(stepInfo);
    };
  }

  if (options.outputSchema !== undefined) {
    // Transform the schema so all properties are required — OpenAI's
    // structured output API rejects schemas with optional properties.
    // The original schema is still used for response validation, where
    // Zod's .safeParse() applies .default() values automatically.
    const strictSchema = makeSchemaStrict(options.outputSchema as any);
    request.output = Output.object({ schema: strictSchema as any });
  }

  if (options.maxTokens !== undefined) {
    request.maxOutputTokens = options.maxTokens;
  }

  if (options.signal !== undefined) {
    request.abortSignal = options.signal;
  }

  if (options.providerOptions !== undefined) {
    request.providerOptions = options.providerOptions;
  }

  return request;
}

// ---------------------------------------------------------------------------
// Result normalisers — extract framework types from AI SDK results
// ---------------------------------------------------------------------------

function normalizeSources(value: unknown): GeneratorModelSource[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const sources: GeneratorModelSource[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const rec = asRecord(value[index]);
    if (rec === undefined || typeof rec.url !== "string") {
      continue;
    }

    sources.push({
      type: "source",
      sourceType: "url",
      id:
        (typeof rec.id === "string" ? rec.id : undefined) ??
        (typeof rec.sourceId === "string" ? rec.sourceId : undefined) ??
        `source_${index}`,
      url: rec.url,
      title: typeof rec.title === "string" ? rec.title : undefined,
      providerMetadata: asProviderMetadata(rec.providerMetadata)
    });
  }

  return sources.length > 0 ? sources : undefined;
}

function normalizeGenerateResult(
  result: Record<string, unknown>
): GeneratorModelResult {
  const text = typeof result.text === "string" ? result.text : undefined;
  const structuredOutput =
    normalizeStructuredOutput(result) ??
    parseStructuredOutputFromText(text);

  return {
    text,
    structuredOutput,
    toolCalls: normalizeToolCalls(result.toolCalls),
    finishReason: normalizeFinishReason(result.finishReason),
    usage: normalizeUsage(result.usage),
    providerMetadata: asProviderMetadata(
      result.providerMetadata ?? result.experimental_providerMetadata
    ),
    sources: normalizeSources(result.sources)
  };
}

function normalizeFinishChunk(
  result: Record<string, unknown>
): Omit<GeneratorModelStreamChunk, "type"> {
  const text = typeof result.text === "string" ? result.text : undefined;
  return {
    finishReason: normalizeFinishReason(result.finishReason),
    usage: normalizeUsage(result.usage),
    fullResult: {
      text,
      toolCalls: normalizeToolCalls(result.toolCalls),
      finishReason: normalizeFinishReason(result.finishReason),
      usage: normalizeUsage(result.usage),
      providerMetadata: asProviderMetadata(
        result.providerMetadata ?? result.experimental_providerMetadata
      ),
      sources: normalizeSources(result.sources)
    }
  };
}

// ---------------------------------------------------------------------------
// Provider search tool mapping
// ---------------------------------------------------------------------------

/**
 * Detects whether an object looks like an AI SDK provider with a `.tools`
 * namespace (e.g., the `openai` export from `@ai-sdk/openai`).
 */
function hasProviderTools(value: unknown): boolean {
  if (typeof value !== "function") {
    return false;
  }

  const obj = value as unknown as Record<string, unknown>;
  return typeof obj.tools === "object" && obj.tools !== null;
}

/**
 * Extracts the base provider name from an AI SDK language model's `provider`
 * property. Provider strings use dot-notation (e.g., "anthropic.chat",
 * "openai.chat") — we extract the prefix before the first dot.
 */
function detectProviderName(languageModel: unknown): string | undefined {
  const model = languageModel as Record<string, unknown> | undefined;
  const provider = model?.provider;
  if (typeof provider !== "string") {
    return undefined;
  }

  const dotIndex = provider.indexOf(".");
  return dotIndex > 0 ? provider.slice(0, dotIndex) : provider;
}

/**
 * Maps a normalized GeneratorSearchConfig to a provider-specific search tool.
 * Returns the raw AI SDK tool object + a display name, or undefined if the
 * provider doesn't support search tools.
 *
 * Unsupported config fields for a given provider are silently ignored.
 */
function mapToProviderSearchTool(
  providerName: string,
  providerTools: Record<string, unknown>,
  config: GeneratorSearchConfig
): { name: string; tool: unknown } | undefined {
  // Anthropic: webSearch_20250305 or webSearch
  if (providerName === "anthropic") {
    const factory =
      (providerTools as any).webSearch_20250305 ??
      (providerTools as any).webSearch;
    if (typeof factory !== "function") {
      return undefined;
    }

    const opts: Record<string, unknown> = {};
    if (config.maxUses !== undefined) opts.maxUses = config.maxUses;
    if (config.allowedDomains !== undefined) opts.allowedDomains = config.allowedDomains;
    if (config.blockedDomains !== undefined) opts.blockedDomains = config.blockedDomains;
    if (config.userLocation !== undefined) opts.userLocation = config.userLocation;

    return {
      name: "web_search",
      tool: Object.keys(opts).length > 0 ? factory(opts) : factory()
    };
  }

  // OpenAI: webSearch
  if (providerName === "openai") {
    if (typeof (providerTools as any).webSearch !== "function") {
      return undefined;
    }

    const opts: Record<string, unknown> = {};
    if (config.searchDepth !== undefined) opts.searchContextSize = config.searchDepth;
    if (config.userLocation !== undefined) opts.userLocation = config.userLocation;

    return {
      name: "web_search",
      tool: Object.keys(opts).length > 0
        ? (providerTools as any).webSearch(opts)
        : (providerTools as any).webSearch()
    };
  }

  // Google / Vertex: googleSearch
  if (providerName === "google" || providerName === "vertex") {
    const factory =
      (providerTools as any).googleSearch ??
      (providerTools as any).google_search;
    if (typeof factory !== "function") {
      return undefined;
    }

    return {
      name: "google_search",
      tool: factory()
    };
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Wraps an AI SDK language model instance into a framework GeneratorModel.
 * Use this when you already have a resolved model (e.g. `openai("gpt-5")`)
 * and want to pass it directly as a generator's `model` config.
 */
export function wrapAiSdkModel(
  languageModel: unknown,
  modelId?: string
): GeneratorModel {
  const resolvedId =
    modelId ??
    (typeof (languageModel as Record<string, unknown>)?.modelId === "string"
      ? (languageModel as Record<string, unknown>).modelId as string
      : "unknown");

  return createGeneratorModelFromAiSdk(resolvedId, languageModel, undefined);
}

function createGeneratorModelFromAiSdk(
  modelId: string,
  languageModel: unknown,
  providerWithTools: unknown | undefined
): GeneratorModel {
  return {
    modelId,

    async generate(options): Promise<GeneratorModelResult> {
      const request = buildAiSdkRequest(languageModel, options);
      const result = (await generateText(
        request as any
      )) as unknown as Record<string, unknown>;
      return normalizeGenerateResult(result);
    },

    async *stream(options): AsyncGenerator<GeneratorModelStreamChunk> {
      const request = buildAiSdkRequest(languageModel, options);
      const result = streamText(request as any);

      // Iterate fullStream to capture tool-call events during multi-step loops,
      // not just text deltas. AI SDK v6 fullStream part types use hyphenated
      // names: "text-delta", "reasoning-delta", "tool-call", "source", etc.
      for await (const part of (result as any).fullStream) {
        const partRecord = part as Record<string, unknown>;

        if (partRecord.type === "text-delta") {
          yield {
            type: "text_delta",
            textDelta: (partRecord.textDelta ?? partRecord.text) as string
          };
        } else if (partRecord.type === "reasoning" || partRecord.type === "reasoning-delta") {
          yield {
            type: "reasoning_delta",
            reasoningDelta: (partRecord.textDelta ?? partRecord.delta ?? partRecord.text) as string
          };
        } else if (partRecord.type === "tool-input-start") {
          yield {
            type: "tool_input_start",
            toolInput: {
              toolName: partRecord.toolName as string,
              providerExecuted: partRecord.providerExecuted === true ? true : undefined
            }
          };
        } else if (partRecord.type === "tool-call") {
          yield {
            type: "tool_call_delta",
            toolCallDelta: {
              toolCallId: partRecord.toolCallId as string,
              toolName: partRecord.toolName as string,
              argsDelta: JSON.stringify(partRecord.args)
            }
          };
        } else if (partRecord.type === "source" || partRecord.type === "source-url") {
          // Source references from provider-native tools (e.g., web search).
          const url = partRecord.url as string | undefined;
          if (typeof url === "string") {
            yield {
              type: "source_url",
              source: {
                type: "source",
                sourceType: "url",
                id:
                  (typeof partRecord.sourceId === "string" ? partRecord.sourceId : undefined) ??
                  (typeof partRecord.id === "string" ? partRecord.id : undefined) ??
                  `source_${Date.now()}_${Math.random().toString(16).slice(2)}`,
                url,
                title: typeof partRecord.title === "string" ? partRecord.title : undefined,
                providerMetadata: asProviderMetadata(partRecord.providerMetadata)
              }
            };
          }
        }
      }

      const finalResult = (await result) as unknown as Record<string, unknown>;
      yield {
        type: "finish",
        ...normalizeFinishChunk(finalResult)
      };
    },

    resolveSearchTool(config: GeneratorSearchConfig) {
      // Detect provider from the language model's .provider property
      const providerName = detectProviderName(languageModel);
      if (providerName === undefined) {
        return undefined;
      }

      // Get the provider's tools namespace from the stored provider reference
      const tools = (providerWithTools as Record<string, unknown> | undefined)?.tools;
      if (typeof tools !== "object" || tools === null) {
        return undefined;
      }

      return mapToProviderSearchTool(providerName, tools as Record<string, unknown>, config);
    }
  };
}

/**
 * Creates a framework ModelResolver backed by Vercel AI SDK `generateText`
 * and `streamText`. Accepts a provider function that maps model ID strings
 * to AI SDK language model instances (e.g. the `openai` export from
 * `@ai-sdk/openai`).
 *
 * When the resolver is a provider object with `.tools` (e.g., the `openai`
 * or `anthropic` export), provider-native search tools are automatically
 * available via generator's `search` config field.
 *
 * Both generate and stream paths use a shared request builder, so tools,
 * maxSteps, outputSchema, etc. are compiled identically regardless of
 * whether the caller requests full or streamed output.
 */
export function createAiSdkModelResolver(
  resolveLanguageModel: ResolveAiSdkLanguageModel
): ModelResolver {
  // Detect if the resolver itself is a provider object with .tools
  // (e.g., the `openai` or `anthropic` export from @ai-sdk/* packages).
  const providerWithTools = hasProviderTools(resolveLanguageModel)
    ? resolveLanguageModel
    : undefined;

  return (modelId: string) =>
    createGeneratorModelFromAiSdk(
      modelId,
      resolveLanguageModel(modelId),
      providerWithTools
    );
}
