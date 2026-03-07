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
  providerMetadata?: Record<string, Record<string, unknown>>;
  steps?: GeneratorStepResult[];
};

export type GeneratorModelTool = {
  name: string;
  description?: string;
  parameters?: ZodTypeAny;
  execute?: (args: unknown) => Promise<unknown>;
};

export type GeneratorModelStreamChunk = {
  type: "text_delta" | "tool_call_delta" | "reasoning_delta" | "finish";
  textDelta?: string;
  reasoningDelta?: string;
  toolCallDelta?: { toolCallId: string; toolName: string; argsDelta?: string };
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
    maxTokens?: number;
    signal?: AbortSignal;
    maxSteps?: number;
    providerOptions?: Record<string, unknown>;
    prepareStep?: PrepareStepFn;
  }): AsyncIterable<GeneratorModelStreamChunk>;
}

export type ModelResolver = (
  modelId: string,
  blockName?: string
) => GeneratorModel;
