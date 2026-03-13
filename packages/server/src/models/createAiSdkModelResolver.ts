import { generateText, streamText, Output, stepCountIs } from "ai";
import type {
  GeneratorModel,
  GeneratorModelResult,
  GeneratorModelStreamChunk,
  GeneratorModelTool,
  GeneratorModelToolCall,
  ModelResolver,
  PrepareStepFn
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

  // Compile tools — include execute if provided (enables AI SDK auto-execution)
  if (options.tools !== undefined && options.tools.length > 0) {
    const compiled: Record<string, unknown> = {};
    for (const tool of options.tools) {
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
    )
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
      usage: normalizeUsage(result.usage)
    }
  };
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

  return createGeneratorModelFromAiSdk(resolvedId, languageModel);
}

function createGeneratorModelFromAiSdk(
  modelId: string,
  languageModel: unknown
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
      // names: "text-delta", "reasoning-delta", "tool-call", etc.
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
        } else if (partRecord.type === "tool-call") {
          yield {
            type: "tool_call_delta",
            toolCallDelta: {
              toolCallId: partRecord.toolCallId as string,
              toolName: partRecord.toolName as string,
              argsDelta: JSON.stringify(partRecord.args)
            }
          };
        }
      }

      const finalResult = (await result) as unknown as Record<string, unknown>;
      yield {
        type: "finish",
        ...normalizeFinishChunk(finalResult)
      };
    }
  };
}

/**
 * Creates a framework ModelResolver backed by Vercel AI SDK `generateText`
 * and `streamText`. Accepts a provider function that maps model ID strings
 * to AI SDK language model instances (e.g. the `openai` export from
 * `@ai-sdk/openai`).
 *
 * Both generate and stream paths use a shared request builder, so tools,
 * maxSteps, outputSchema, etc. are compiled identically regardless of
 * whether the caller requests full or streamed output.
 */
export function createAiSdkModelResolver(
  resolveLanguageModel: ResolveAiSdkLanguageModel
): ModelResolver {
  return (modelId: string) =>
    createGeneratorModelFromAiSdk(modelId, resolveLanguageModel(modelId));
}
