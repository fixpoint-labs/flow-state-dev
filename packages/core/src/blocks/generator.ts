import { z, type ZodTypeAny } from "zod";
import type {
  BlockConfig,
  BlockContext,
  BlockDefinition,
  ConnectorFn,
  MessageOption,
  RenderContext,
  RenderOption,
  RetryPolicy
} from "../types/block";
import { buildBlock } from "./internal/build-block";

const DEFAULT_MAX_ITERATIONS = 8;
const DEFAULT_REPAIR_ATTEMPTS = 1;

type MaybePromise<TValue> = TValue | Promise<TValue>;

type ResolvableString<TInput> = string | ((input: TInput, ctx: BlockContext) => MaybePromise<string>);

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
  toolName: string;
  input: unknown;
  output?: unknown;
  error?: Error;
}

export interface ToolBinding {
  name: string;
  description?: string;
  enabled?: boolean | ((state: GeneratorLoopState, ctx: BlockContext) => MaybePromise<boolean>);
  input?: (state: GeneratorLoopState, ctx: BlockContext) => MaybePromise<unknown>;
  execute: (input: unknown, ctx: BlockContext) => MaybePromise<unknown>;
  continueOnError?: boolean;
}

export interface GeneratorConfig<TInput, TOutput> extends Omit<BlockConfig<TInput, TOutput>, "execute"> {
  requestStateSchema?: ZodTypeAny;
  sessionStateSchema?: ZodTypeAny;
  userStateSchema?: ZodTypeAny;
  projectStateSchema?: ZodTypeAny;
  requestResourcesSchema?: ZodTypeAny;
  sessionResourcesSchema?: ZodTypeAny;
  userResourcesSchema?: ZodTypeAny;
  projectResourcesSchema?: ZodTypeAny;
  connectInput?: ConnectorFn<unknown, TInput>;
  model: ResolvableString<TInput>;
  prompt: ResolvableString<TInput>;
  context?: GeneratorSlot;
  history?: GeneratorSlot;
  user?: GeneratorSlot;
  tools?: ToolBinding[] | ((ctx: BlockContext) => MaybePromise<ToolBinding[]>);
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
  generate?: (state: GeneratorLoopState<TInput>, ctx: BlockContext) => MaybePromise<unknown>;
  retry?: RetryPolicy;
  render?: RenderOption<TOutput>;
  message?: MessageOption<TOutput>;
}

function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }

  if (typeof value === "string" && value.length > 0) {
    return new Error(value);
  }

  return new Error("Generator execution failed");
}

async function resolveString<TInput>(
  value: ResolvableString<TInput>,
  input: TInput,
  ctx: BlockContext
): Promise<string> {
  return typeof value === "function" ? value(input, ctx) : value;
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
  tools: ToolBinding[] | ((ctx: BlockContext) => MaybePromise<ToolBinding[]>) | undefined,
  ctx: BlockContext
): Promise<ToolBinding[]> {
  if (tools === undefined) {
    return [];
  }

  const resolved = typeof tools === "function" ? await tools(ctx) : tools;
  return Array.isArray(resolved) ? resolved : [];
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
  config: GeneratorConfig<TInput, TOutput>,
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

async function invokeTools<TInput>(
  tools: ToolBinding[],
  state: GeneratorLoopState<TInput>,
  ctx: BlockContext
): Promise<GeneratorToolResult[]> {
  const results: GeneratorToolResult[] = [];

  for (const tool of tools) {
    const enabled = typeof tool.enabled === "function" ? await tool.enabled(state as GeneratorLoopState, ctx) : tool.enabled;
    if (enabled === false) {
      continue;
    }

    const toolInput = tool.input === undefined ? state.input : await tool.input(state as GeneratorLoopState, ctx);

    try {
      const output = await tool.execute(toolInput, ctx);
      results.push({
        toolName: tool.name,
        input: toolInput,
        output
      });
    } catch (error) {
      const normalizedError = toError(error);
      results.push({
        toolName: tool.name,
        input: toolInput,
        error: normalizedError
      });

      if (tool.continueOnError !== true) {
        throw normalizedError;
      }
    }
  }

  return results;
}

function buildFallbackCandidate<TInput>(state: GeneratorLoopState<TInput>): unknown {
  for (let index = state.toolResults.length - 1; index >= 0; index -= 1) {
    const result = state.toolResults[index];
    if (result.error === undefined) {
      return result.output;
    }
  }

  const lastUserMessage = state.messages[state.messages.length - 1];
  if (lastUserMessage !== undefined) {
    return lastUserMessage;
  }

  return state.prompt;
}

function resolveMaxIterations<TInput, TOutput>(config: GeneratorConfig<TInput, TOutput>): number {
  const configured = config.loop?.maxIterations ?? config.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  return Math.max(1, configured);
}

export async function resolveGeneratorMessage<TOutput>(
  option: MessageOption<TOutput> | undefined,
  output: TOutput,
  ctx: BlockContext
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

  return option(output, ctx);
}

export async function resolveGeneratorRender<TOutput>(
  option: RenderOption<TOutput> | undefined,
  output: TOutput,
  ctx: RenderContext
): Promise<unknown | null> {
  if (option === false || option === undefined) {
    return null;
  }

  if (option === true) {
    return output;
  }

  if (typeof option === "string") {
    return option;
  }

  return option(output, ctx);
}

export function generator<TInput, TOutput>(
  config: GeneratorConfig<TInput, TOutput>
): BlockDefinition<TInput, TOutput> {
  const outputSchema = config.outputSchema ?? z.string();
  const normalizedConfig: GeneratorConfig<TInput, TOutput> = {
    ...config,
    outputSchema
  };

  return buildBlock<TInput, TOutput>({
    kind: "generator",
    config: normalizedConfig,
    execute: async (input, ctx) => {
      const model = await resolveString(normalizedConfig.model, input, ctx);
      const prompt = await resolveString(normalizedConfig.prompt, input, ctx);
      const contextValues = await resolveSlotValues(normalizedConfig.context, input, ctx);
      const historyValues = await resolveSlotValues(normalizedConfig.history, input, ctx);
      const userValues = await resolveSlotValues(normalizedConfig.user, input, ctx);
      const messages = [
        { role: "system", content: prompt },
        ...contextValues.map(asSystemMessage),
        ...historyValues,
        ...userValues.map(asUserMessage)
      ];

      const tools = await resolveTools(normalizedConfig.tools, ctx);
      const maxIterations = resolveMaxIterations(normalizedConfig);
      const runTools = normalizedConfig.loop?.runTools !== false;

      let lastError: Error | undefined;
      let previousCandidate: unknown;
      const aggregatedToolResults: GeneratorToolResult[] = [];

      for (let iteration = 0; iteration < maxIterations; iteration += 1) {
        const state: GeneratorLoopState<TInput> = {
          iteration,
          input,
          model,
          prompt,
          messages,
          toolResults: aggregatedToolResults,
          lastCandidate: previousCandidate
        };

        if (runTools && tools.length > 0) {
          const toolResults = await invokeTools(tools, state, ctx);
          aggregatedToolResults.push(...toolResults);
        }

        const candidate =
          normalizedConfig.generate === undefined
            ? buildFallbackCandidate(state)
            : await normalizedConfig.generate(state, ctx);

        previousCandidate = candidate;

        try {
          return await applyRepairPolicy(normalizedConfig, outputSchema, candidate, state, ctx);
        } catch (error) {
          lastError = toError(error);
        }

        if (normalizedConfig.loop?.stopWhen !== undefined) {
          const shouldStop = await normalizedConfig.loop.stopWhen(state, ctx);
          if (shouldStop) {
            break;
          }
        }
      }

      throw (
        lastError ??
        new Error(`Generator "${normalizedConfig.name}" did not produce a valid output in ${maxIterations} iteration(s)`)
      );
    }
  });
}
