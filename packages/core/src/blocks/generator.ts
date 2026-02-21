import { z, type ZodTypeAny } from "zod";
import type {
  BlockConfig,
  BlockContext,
  BlockDefinition,
  ClientOutputOption,
  ConnectorFn,
  LlmOutputOption,
  RetryPolicy
} from "../types/block";
import type {
  GeneratorModel,
  GeneratorModelResult,
  GeneratorModelTool,
  GeneratorModelToolCall
} from "../types/model";
import type { ToolLifecycleEvent, ToolsConfig } from "../types/flow";
import { buildBlock } from "./internal/build-block";
import { toError, withTimeout } from "./internal/utils";

const DEFAULT_MAX_ITERATIONS = 8;
const DEFAULT_REPAIR_ATTEMPTS = 1;

type MaybePromise<TValue> = TValue | Promise<TValue>;

type ResolvableString<TInput> = string | ((input: TInput, ctx: BlockContext) => MaybePromise<string>);
type ResolvableModel<TInput> =
  | string
  | GeneratorModel
  | ((input: TInput, ctx: BlockContext) => MaybePromise<string | GeneratorModel>);

export type GeneratorSlotReference = (
  input: unknown,
  ctx: BlockContext
) => unknown | Promise<unknown>;

export type GeneratorSlotEntry =
  | string
  | Record<string, unknown>
  | Array<Record<string, unknown>>
  | GeneratorSlotReference;

export type GeneratorSlot = GeneratorSlotEntry | GeneratorSlotEntry[];

export type GeneratorSlotRefOptions = {
  optional?: boolean;
  missing?: "error" | "empty";
  limit?: number | { tokens: number };
  as?: string;
};

export type GeneratorRepairMode = "auto" | "rescue" | "fail";

export interface GeneratorRepairConfig {
  mode?: GeneratorRepairMode;
  maxAttempts?: number;
}

export interface GeneratorLoopState<TInput = unknown> {
  iteration: number;
  input: TInput;
  model: string;
  prompt: string;
  messages: unknown[];
  toolResults: GeneratorToolResult[];
  lastCandidate?: unknown;
}

export interface GeneratorLoopConfig<TInput = unknown> {
  maxIterations?: number;
  runTools?: boolean;
  stopWhen?: (state: GeneratorLoopState<TInput>, ctx: BlockContext) => MaybePromise<boolean>;
}

export interface GeneratorToolResult {
  toolCallId?: string;
  toolName: string;
  input: unknown;
  output?: unknown;
  error?: Error;
}

export type GeneratorTool = BlockDefinition<any, any>;

/**
 * @deprecated Use GeneratorTool. Kept as an alias for compatibility.
 */
export type ToolBinding = GeneratorTool;

/**
 * Non-function slot entry forms (strings, objects, arrays).
 */
export type GeneratorSlotStatic =
  | string
  | Record<string, unknown>
  | Array<Record<string, unknown>>
  | Array<GeneratorSlotStatic>;

/**
 * Typed user-slot function — receives the block's actual TInput.
 * Preferred over GeneratorSlotReference for the `user` slot because it
 * preserves the input type without requiring a cast at the call site.
 */
export type TypedUserSlotFn<TInput> = (
  input: TInput,
  ctx: BlockContext
) => MaybePromise<unknown>;

export interface GeneratorConfig<
  TInputSchema extends ZodTypeAny = ZodTypeAny,
  TOutputSchema extends ZodTypeAny = ZodTypeAny,
  TInput = z.infer<TInputSchema>,
  TOutput = z.infer<TOutputSchema>,
> extends Omit<BlockConfig<TInputSchema, TOutputSchema, TInput, TOutput>, "execute"> {
  requestStateSchema?: ZodTypeAny;
  sessionStateSchema?: ZodTypeAny;
  userStateSchema?: ZodTypeAny;
  projectStateSchema?: ZodTypeAny;
  requestResourcesSchema?: ZodTypeAny;
  sessionResourcesSchema?: ZodTypeAny;
  userResourcesSchema?: ZodTypeAny;
  projectResourcesSchema?: ZodTypeAny;
  connectInput?: ConnectorFn<unknown, TInput>;
  model: ResolvableModel<TInput>;
  prompt: ResolvableString<TInput>;
  context?: GeneratorSlot;
  history?: GeneratorSlot;
  /** Typed user slot: accepts a function over TInput, a static string, or other non-function slot entries. */
  user?: TypedUserSlotFn<TInput> | GeneratorSlotStatic | Array<GeneratorSlotStatic>;
  tools?: GeneratorTool[] | ((ctx: BlockContext) => MaybePromise<GeneratorTool[]>);
  loop?: GeneratorLoopConfig<TInput>;
  maxIterations?: number;
  maxTokens?: number;
  repair?: GeneratorRepairConfig;
  repairOutput?: (
    candidate: unknown,
    error: Error,
    state: GeneratorLoopState<TInput>,
    ctx: BlockContext
  ) => MaybePromise<unknown>;
  flowTools?: ToolsConfig;
  retry?: RetryPolicy;
  clientOutput?: ClientOutputOption<TOutput>;
  llmOutput?: LlmOutputOption<TOutput>;
}

async function resolveString<TInput>(
  value: ResolvableString<TInput>,
  input: TInput,
  ctx: BlockContext
): Promise<string> {
  return typeof value === "function" ? value(input, ctx) : value;
}

function isGeneratorModel(value: unknown): value is GeneratorModel {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.modelId === "string" &&
    typeof candidate.generate === "function"
  );
}

async function resolveModel<TInput>(
  value: ResolvableModel<TInput>,
  input: TInput,
  ctx: BlockContext,
  blockName: string
): Promise<{ modelId: string; model: GeneratorModel }> {
  const resolved = typeof value === "function" ? await value(input, ctx) : value;

  if (typeof resolved === "string") {
    return {
      modelId: resolved,
      model: ctx.resolveModel(resolved, blockName)
    };
  }

  if (isGeneratorModel(resolved)) {
    return {
      modelId: resolved.modelId,
      model: resolved
    };
  }

  throw new Error(
    `Generator "${blockName}" model must resolve to a model id string or GeneratorModel instance`
  );
}

function normalizeSlotEntries(slot: GeneratorSlot | undefined): GeneratorSlotEntry[] {
  if (slot === undefined) {
    return [];
  }

  return Array.isArray(slot) ? slot : [slot];
}

function normalizeToArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (value === undefined || value === null) {
    return [];
  }

  return [value];
}

function asSystemMessage(value: unknown): unknown {
  if (typeof value === "string") {
    return { role: "system", content: value };
  }

  return value;
}

function asUserMessage(value: unknown): unknown {
  if (typeof value === "string") {
    return { role: "user", content: value };
  }

  return value;
}

async function resolveSlotValues(
  slot: GeneratorSlot | undefined,
  input: unknown,
  ctx: BlockContext
): Promise<unknown[]> {
  const values: unknown[] = [];

  for (const entry of normalizeSlotEntries(slot)) {
    const resolved = typeof entry === "function" ? await entry(input, ctx) : entry;
    values.push(...normalizeToArray(resolved));
  }

  return values;
}

async function resolveTools(
  tools: GeneratorTool[] | ((ctx: BlockContext) => MaybePromise<GeneratorTool[]>) | undefined,
  ctx: BlockContext
): Promise<GeneratorTool[]> {
  if (tools === undefined) {
    return [];
  }

  const resolved = typeof tools === "function" ? await tools(ctx) : tools;
  return Array.isArray(resolved) ? resolved : [];
}

function compileToolsForModel(tools: GeneratorTool[]): GeneratorModelTool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema
  }));
}

function indexToolsByName(tools: GeneratorTool[]): Map<string, GeneratorTool> {
  const map = new Map<string, GeneratorTool>();
  for (const tool of tools) {
    map.set(tool.name, tool);
  }
  return map;
}

function isBlockObserver(
  observer: ToolsConfig["onToolStarted"]
): observer is BlockDefinition<any, any> {
  return (
    typeof observer === "object" &&
    observer !== null &&
    "run" in observer &&
    typeof (observer as { run?: unknown }).run === "function"
  );
}

async function runToolObserver(
  observer: ToolsConfig["onToolStarted"] | ToolsConfig["onToolCompleted"] | ToolsConfig["onToolErrored"] | undefined,
  event: ToolLifecycleEvent,
  ctx: BlockContext
): Promise<void> {
  if (observer === undefined) {
    return;
  }

  if (isBlockObserver(observer as ToolsConfig["onToolStarted"])) {
    await (observer as BlockDefinition<any, any>).run(event, ctx);
    return;
  }

  await (observer as (input: ToolLifecycleEvent, ctx: BlockContext) => MaybePromise<void>)(event, ctx);
}

async function runWithRetry<TValue>(
  run: () => Promise<TValue>,
  retry: RetryPolicy | undefined
): Promise<TValue> {
  if (retry === undefined) {
    return run();
  }

  const maxAttempts = Math.max(1, retry.maxAttempts ?? 1);
  const baseDelayMs = Math.max(0, retry.baseDelayMs ?? 0);
  const maxDelayMs = Math.max(baseDelayMs, retry.maxDelayMs ?? Number.POSITIVE_INFINITY);
  let attempt = 0;

  while (attempt < maxAttempts) {
    attempt += 1;

    try {
      return await run();
    } catch (error) {
      const normalizedError = toError(error);
      if (attempt >= maxAttempts) {
        throw normalizedError;
      }

      if (retry.retryableErrors !== undefined && retry.retryableErrors.length > 0) {
        const isRetryable = retry.retryableErrors.some((ErrorType) => normalizedError instanceof ErrorType);
        if (!isRetryable) {
          throw normalizedError;
        }
      }

      const delayMs = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1));
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw new Error("Tool retry loop exited unexpectedly");
}

function parseOutputWithSchema<TOutput>(schema: ZodTypeAny, candidate: unknown): { success: true; output: TOutput } | {
  success: false;
  error: Error;
} {
  const parsed = schema.safeParse(candidate);
  if (parsed.success) {
    return { success: true, output: parsed.data as TOutput };
  }

  const issue = parsed.error.issues[0];
  const issuePath = issue?.path?.join(".") ?? "";
  const issueMessage = issue?.message ?? "schema validation failed";
  const suffix = issuePath.length > 0 ? ` at "${issuePath}"` : "";
  return {
    success: false,
    error: new Error(`Generator output validation failed${suffix}: ${issueMessage}`)
  };
}

async function attemptDefaultRepair(candidate: unknown): Promise<unknown> {
  if (typeof candidate === "string") {
    try {
      return JSON.parse(candidate);
    } catch {
      return candidate;
    }
  }

  if (typeof candidate === "object" && candidate !== null && "output" in candidate) {
    return (candidate as { output: unknown }).output;
  }

  return candidate;
}

async function applyRepairPolicy<TInput, TOutput>(
  config: { repair?: GeneratorRepairConfig; repairOutput?: GeneratorConfig<any, any>["repairOutput"] },
  outputSchema: ZodTypeAny,
  candidate: unknown,
  state: GeneratorLoopState<TInput>,
  ctx: BlockContext
): Promise<TOutput> {
  const mode = config.repair?.mode ?? "auto";
  const maxAttempts = Math.max(0, config.repair?.maxAttempts ?? DEFAULT_REPAIR_ATTEMPTS);

  let currentCandidate = candidate;
  let currentAttempt = 0;

  while (true) {
    const parsed = parseOutputWithSchema<TOutput>(outputSchema, currentCandidate);
    if (parsed.success) {
      return parsed.output;
    }

    if (mode === "fail" || mode === "rescue") {
      throw parsed.error;
    }

    if (currentAttempt >= maxAttempts) {
      throw parsed.error;
    }

    if (config.repairOutput !== undefined) {
      currentCandidate = await config.repairOutput(currentCandidate, parsed.error, state, ctx);
    } else {
      currentCandidate = await attemptDefaultRepair(currentCandidate);
    }

    currentAttempt += 1;
  }
}

function resolveGenerationCandidate(result: GeneratorModelResult): unknown {
  if (result.structuredOutput !== undefined) {
    return result.structuredOutput;
  }

  return result.text;
}

function createToolResultMessage(result: GeneratorToolResult): Record<string, unknown> {
  return {
    role: "tool",
    toolCallId: result.toolCallId,
    name: result.toolName,
    content:
      result.error === undefined
        ? result.output
        : {
            error: result.error.message
          }
  };
}

function appendIterationMessages(
  messages: unknown[],
  generationResult: GeneratorModelResult,
  toolResults: GeneratorToolResult[]
): void {
  if (generationResult.text !== undefined || (generationResult.toolCalls?.length ?? 0) > 0) {
    messages.push({
      role: "assistant",
      content: generationResult.text,
      toolCalls: generationResult.toolCalls
    });
  }

  for (const toolResult of toolResults) {
    messages.push(createToolResultMessage(toolResult));
  }
}

async function invokeModelTools<TInput>(
  toolCalls: GeneratorModelToolCall[],
  toolsByName: Map<string, GeneratorTool>,
  state: GeneratorLoopState<TInput>,
  ctx: BlockContext,
  flowTools: ToolsConfig | undefined
): Promise<GeneratorToolResult[]> {
  const timeoutMs = flowTools?.defaults?.timeoutMs;
  const retry = flowTools?.defaults?.retry;
  const concurrency = flowTools?.defaults?.concurrency ?? "serial";

  const runOne = async (
    toolCall: GeneratorModelToolCall
  ): Promise<{ result?: GeneratorToolResult; fatal?: Error }> => {
    const tool = toolsByName.get(toolCall.toolName);
    if (tool === undefined) {
      return {
        fatal: new Error(`Generator requested unknown tool "${toolCall.toolName}"`)
      };
    }

    const startedEvent: ToolLifecycleEvent = {
      toolName: toolCall.toolName,
      input: toolCall.args
    };
    await runToolObserver(flowTools?.onToolStarted, startedEvent, ctx);

    try {
      const output = await runWithRetry(
        async () =>
          withTimeout(
            Promise.resolve(tool.run(toolCall.args, ctx)),
            timeoutMs,
            `tool:${toolCall.toolName}`
          ),
        retry
      );

      const completedEvent: ToolLifecycleEvent = {
        toolName: toolCall.toolName,
        input: toolCall.args,
        output
      };
      await runToolObserver(flowTools?.onToolCompleted, completedEvent, ctx);

      return {
        result: {
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          input: toolCall.args,
          output
        }
      };
    } catch (error) {
      const normalizedError = toError(error);
      const erroredEvent: ToolLifecycleEvent = {
        toolName: toolCall.toolName,
        input: toolCall.args,
        error: normalizedError
      };
      await runToolObserver(flowTools?.onToolErrored, erroredEvent, ctx);

      return {
        result: {
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          input: toolCall.args,
          error: normalizedError
        },
        fatal: normalizedError
      };
    }
  };

  if (concurrency === "parallel") {
    const settled = await Promise.all(toolCalls.map((toolCall) => runOne(toolCall)));
    const results = settled.flatMap((entry) => (entry.result === undefined ? [] : [entry.result]));
    const fatal = settled.find((entry) => entry.fatal !== undefined)?.fatal;
    if (fatal !== undefined) {
      throw fatal;
    }

    return results;
  }

  const results: GeneratorToolResult[] = [];
  for (const toolCall of toolCalls) {
    const outcome = await runOne(toolCall);
    if (outcome.result !== undefined) {
      results.push(outcome.result);
    }
    if (outcome.fatal !== undefined) {
      throw outcome.fatal;
    }
  }

  return results;
}

function resolveMaxIterations(config: { loop?: GeneratorLoopConfig<unknown>; maxIterations?: number }): number {
  const configured = config.loop?.maxIterations ?? config.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  return Math.max(1, configured);
}

export async function resolveGeneratorLlmOutput<TOutput>(
  option: LlmOutputOption<TOutput> | undefined,
  output: TOutput,
  _ctx?: BlockContext
): Promise<unknown | null> {
  if (option === false) {
    return null;
  }

  if (option === undefined || option === true) {
    return output;
  }

  if (typeof option === "string") {
    return option;
  }

  return option(output);
}

export async function resolveGeneratorClientOutput<TOutput>(
  option: ClientOutputOption<TOutput> | undefined,
  output: TOutput,
  _ctx?: unknown
): Promise<unknown | null> {
  if (option === false || option === undefined) {
    return null;
  }

  if (option === true) {
    return output;
  }

  return option(output);
}

/**
 * @deprecated Use resolveGeneratorLlmOutput instead.
 */
export const resolveGeneratorMessage = resolveGeneratorLlmOutput;

/**
 * @deprecated Use resolveGeneratorClientOutput instead.
 */
export const resolveGeneratorRender = resolveGeneratorClientOutput;

export function generator<
  TInputSchema extends ZodTypeAny = ZodTypeAny,
  TOutputSchema extends ZodTypeAny = ZodTypeAny,
>(
  config: GeneratorConfig<TInputSchema, TOutputSchema>
): BlockDefinition<TInputSchema, TOutputSchema> {
  type TInput = z.infer<TInputSchema>;
  type TOutput = z.infer<TOutputSchema>;

  const outputSchema = (config.outputSchema ?? z.string()) as ZodTypeAny;
  const normalizedConfig: GeneratorConfig<TInputSchema, TOutputSchema> = {
    ...config,
    outputSchema: outputSchema as TOutputSchema
  };

  return buildBlock<TInputSchema, TOutputSchema>({
    kind: "generator",
    config: normalizedConfig as unknown as BlockConfig<TInputSchema, TOutputSchema>,
    execute: async (input: TInput, ctx) => {
      const blockName = String(normalizedConfig.name);
      const { modelId, model } = await resolveModel<TInput>(
        normalizedConfig.model,
        input,
        ctx,
        blockName
      );
      const prompt = await resolveString<TInput>(normalizedConfig.prompt, input, ctx);
      const contextValues = await resolveSlotValues(normalizedConfig.context, input, ctx);
      const historyValues = await resolveSlotValues(normalizedConfig.history, input, ctx);
      const userValues = await resolveSlotValues(normalizedConfig.user as GeneratorSlot | undefined, input, ctx);
      const messages: unknown[] = [
        { role: "system", content: prompt },
        ...contextValues.map(asSystemMessage),
        ...historyValues,
        ...userValues.map(asUserMessage)
      ];

      const toolBlocks = await resolveTools(normalizedConfig.tools, ctx);
      const toolsByName = indexToolsByName(toolBlocks);
      const compiledTools = compileToolsForModel(toolBlocks);
      const maxIterations = resolveMaxIterations(normalizedConfig);
      const runTools = normalizedConfig.loop?.runTools !== false;

      let lastError: Error | undefined;
      let previousCandidate: unknown;
      const aggregatedToolResults: GeneratorToolResult[] = [];

      for (let iteration = 0; iteration < maxIterations; iteration += 1) {
        const state: GeneratorLoopState<TInput> = {
          iteration,
          input,
          model: modelId,
          prompt,
          messages,
          toolResults: aggregatedToolResults,
          lastCandidate: previousCandidate
        };

        const generation = await model.generate({
          messages,
          tools: runTools ? compiledTools : undefined,
          outputSchema,
          maxTokens: normalizedConfig.maxTokens,
          signal: ctx.signal
        });

        const iterationToolCalls = runTools ? generation.toolCalls ?? [] : [];
        const iterationToolResults =
          iterationToolCalls.length === 0
            ? []
            : await invokeModelTools<TInput>(
                iterationToolCalls,
                toolsByName,
                state,
                ctx,
                normalizedConfig.flowTools
              );

        if (iterationToolResults.length > 0) {
          aggregatedToolResults.push(...iterationToolResults);
        }

        appendIterationMessages(messages, generation, iterationToolResults);

        const candidate = resolveGenerationCandidate(generation);
        if (candidate !== undefined) {
          previousCandidate = candidate;
          const candidateState: GeneratorLoopState<TInput> = {
            ...state,
            toolResults: aggregatedToolResults,
            lastCandidate: previousCandidate
          };

          try {
            return await applyRepairPolicy<TInput, TOutput>(normalizedConfig, outputSchema, candidate, candidateState, ctx);
          } catch (error) {
            lastError = toError(error);
          }
        }

        if (normalizedConfig.loop?.stopWhen !== undefined) {
          const shouldStop = await normalizedConfig.loop.stopWhen(
            {
              ...state,
              toolResults: aggregatedToolResults,
              lastCandidate: previousCandidate
            },
            ctx
          );
          if (shouldStop) {
            break;
          }
        }
      }

      throw (
        lastError ??
        new Error(`Generator "${blockName}" did not produce a valid output in ${maxIterations} iteration(s)`)
      );
    }
  });
}
