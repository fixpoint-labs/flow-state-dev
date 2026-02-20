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

export type GeneratorModelResult = {
  text?: string;
  structuredOutput?: unknown;
  toolCalls?: GeneratorModelToolCall[];
  finishReason?: string;
  usage?: GeneratorModelUsage;
};

export type GeneratorModelTool = {
  name: string;
  description?: string;
  parameters?: ZodTypeAny;
};

export interface GeneratorModel {
  modelId: string;
  generate(options: {
    messages: unknown[];
    tools?: GeneratorModelTool[];
    outputSchema?: ZodTypeAny;
    maxTokens?: number;
    signal?: AbortSignal;
  }): Promise<GeneratorModelResult>;
}

export type ModelResolver = (
  modelId: string,
  blockName?: string
) => GeneratorModel;
