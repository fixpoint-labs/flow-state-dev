import type { ZodTypeAny } from "zod";

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
  steps?: GeneratorStepResult[];
};

export type GeneratorModelTool = {
  name: string;
  description?: string;
  parameters?: ZodTypeAny;
  execute?: (args: unknown) => Promise<unknown>;
};

export type GeneratorModelStreamChunk = {
  type: "text_delta" | "tool_call_delta" | "finish";
  textDelta?: string;
  toolCallDelta?: { toolCallId: string; toolName: string; argsDelta?: string };
  finishReason?: string;
  usage?: GeneratorModelUsage;
  fullResult?: GeneratorModelResult;
};

export interface GeneratorModel {
  modelId: string;
  generate(options: {
    messages: unknown[];
    tools?: GeneratorModelTool[];
    outputSchema?: ZodTypeAny;
    maxTokens?: number;
    signal?: AbortSignal;
    maxSteps?: number;
  }): Promise<GeneratorModelResult>;
  stream?(options: {
    messages: unknown[];
    tools?: GeneratorModelTool[];
    maxTokens?: number;
    signal?: AbortSignal;
    maxSteps?: number;
  }): AsyncIterable<GeneratorModelStreamChunk>;
}

export type ModelResolver = (
  modelId: string,
  blockName?: string
) => GeneratorModel;
