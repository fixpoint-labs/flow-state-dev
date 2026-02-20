import { asSchema, generateText } from "ai";
import type {
  GeneratorModelResult,
  GeneratorModelTool,
  GeneratorModelToolCall,
  ModelResolver
} from "@flow-state-dev/core/types";

export type ResolveAiSdkLanguageModel = (modelId: string) => unknown;

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

function compileToolsForAiSdk(
  tools: GeneratorModelTool[] | undefined
): Record<string, unknown> | undefined {
  if (tools === undefined || tools.length === 0) {
    return undefined;
  }

  const compiled: Record<string, unknown> = {};
  for (const tool of tools) {
    compiled[tool.name] = {
      description: tool.description,
      inputSchema:
        tool.parameters ??
        {
          type: "object",
          properties: {},
          additionalProperties: true
        }
    };
  }

  return compiled;
}

/**
 * Creates a framework ModelResolver backed by Vercel AI SDK `generateText`.
 * The provided function maps `modelId` strings to AI SDK language model instances.
 */
export function createAiSdkModelResolver(
  resolveLanguageModel: ResolveAiSdkLanguageModel
): ModelResolver {
  return (modelId: string) => ({
    modelId,
    async generate(options): Promise<GeneratorModelResult> {
      const request: Record<string, unknown> = {
        model: resolveLanguageModel(modelId),
        messages: options.messages
      };

      const compiledTools = compileToolsForAiSdk(options.tools);
      if (compiledTools !== undefined) {
        request.tools = compiledTools;
      }

      if (options.maxTokens !== undefined) {
        request.maxOutputTokens = options.maxTokens;
      }

      if (options.signal !== undefined) {
        request.abortSignal = options.signal;
      }

      if (options.outputSchema !== undefined) {
        const schema = asSchema(options.outputSchema as any);
        request.responseFormat = {
          type: "json",
          schema: await schema.jsonSchema
        };
      }

      const result = (await generateText(
        request as any
      )) as unknown as Record<string, unknown>;
      const text = typeof result.text === "string" ? result.text : undefined;
      const structuredOutput =
        normalizeStructuredOutput(result) ??
        parseStructuredOutputFromText(text);

      return {
        text,
        structuredOutput,
        toolCalls: normalizeToolCalls(result.toolCalls),
        finishReason: normalizeFinishReason(result.finishReason),
        usage: normalizeUsage(result.usage)
      };
    }
  });
}
