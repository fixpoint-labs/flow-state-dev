import { z, type ZodTypeAny } from "zod";
import { jsonSchema } from "ai";
import type {
  BlockConfig,
  BlockContext,
  BlockDefinition,
  ConnectorFn,
  InferBlockResources,
  InferStateFromSchema,
  RetryPolicy
} from "../types/block";
import type { AnyResourceRef } from "../types/resource";
import type { DeclaredResourceEntry } from "../types/block";
import type {
  GeneratorModel,
  GeneratorModelResult,
  GeneratorModelSource,
  GeneratorModelTool,
  GeneratorSearchConfig,
  PrepareStepFn,
  ProviderTool
} from "../types/model";
import type { ToolLifecycleEvent, ToolsConfig } from "../types/flow";
import type { CapabilityRef, InferCapabilities } from "../capability/types";
import { resolveActivePresets, flattenCapabilities } from "../capability/merge";
import { buildBlock } from "./internal/build-block";
import { resolveCapabilities } from "./internal/resolve-capabilities";
import { toError, withTimeout } from "./internal/utils";

const DEFAULT_MAX_ITERATIONS = 8;
const DEFAULT_REPAIR_ATTEMPTS = 1;

// ---------------------------------------------------------------------------
// Dynamic capability helpers — resolve context/tools from runtime-resolved caps
// ---------------------------------------------------------------------------

interface DynamicCapSurface {
  contextEntries: Array<(input: any, ctx: any) => any>;
  tools: GeneratorTool[];
}

/**
 * Extract context and tool entries from a capability's active presets in a
 * single traversal. Walks nested static uses recursively via flattenCapabilities.
 */
async function resolveDynamicCapSurface(
  cap: CapabilityRef,
  ctx: BlockContext,
): Promise<DynamicCapSurface> {
  const contextEntries: Array<(input: any, ctx: any) => any> = [];
  const tools: GeneratorTool[] = [];

  // Walk nested static uses
  if (cap.uses) {
    const flattened = flattenCapabilities(
      cap.uses.filter((e): e is CapabilityRef => typeof e !== "function")
    );
    for (const nested of flattened) {
      const nestedSurface = await resolveDynamicCapSurface(nested, ctx);
      contextEntries.push(...nestedSurface.contextEntries);
      tools.push(...nestedSurface.tools);
    }
  }

  for (const { preset } of resolveActivePresets(cap)) {
    if (preset.context) {
      const entries = Array.isArray(preset.context) ? preset.context : [preset.context];
      contextEntries.push(...entries);
    }
    if (preset.tools) {
      if (Array.isArray(preset.tools)) {
        tools.push(...preset.tools);
      } else {
        tools.push(...(await preset.tools(ctx)));
      }
    }
  }

  return { contextEntries, tools };
}

type MaybePromise<TValue> = TValue | Promise<TValue>;

type ResolvableString<TInput, TCtx = BlockContext> =
  string | ((input: TInput, ctx: TCtx) => MaybePromise<string>);
type ResolvableModel<TInput, TCtx = BlockContext> =
  | string
  | string[]
  | GeneratorModel
  | ((input: TInput, ctx: TCtx) => MaybePromise<string | string[] | GeneratorModel>);
type ResolvableProviderOptions<TInput, TCtx = BlockContext> =
  | Record<string, unknown>
  | ((input: TInput, ctx: TCtx) => MaybePromise<Record<string, unknown> | undefined>);

export type GeneratorSlotReference<TInput = unknown, TCtx = BlockContext> = (
  input: TInput,
  ctx: TCtx
) => unknown | Promise<unknown>;

export type GeneratorSlotEntry<TInput = unknown, TCtx = BlockContext> =
  | string
  | Record<string, unknown>
  | Array<Record<string, unknown>>
  | GeneratorSlotReference<TInput, TCtx>;

export type GeneratorSlot<TInput = unknown, TCtx = BlockContext> =
  | GeneratorSlotEntry<TInput, TCtx>
  | GeneratorSlotEntry<TInput, TCtx>[];

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

export interface GeneratorLoopConfig<TInput = unknown, TCtx = BlockContext> {
  maxIterations?: number;
  runTools?: boolean;
  stopWhen?: (state: GeneratorLoopState<TInput>, ctx: TCtx) => MaybePromise<boolean>;
}

export interface GeneratorToolResult {
  toolCallId?: string;
  toolName: string;
  input: unknown;
  output?: unknown;
  error?: Error;
}

export type GeneratorTool = BlockDefinition<any, any>;

/** Tools slot accepted by generators and pattern factories — static array or context-aware function. */
export type ToolsSlot = GeneratorTool[] | ((ctx: any) => MaybePromise<GeneratorTool[]>);

/**
 * @deprecated Use GeneratorTool. Kept as an alias for compatibility.
 */
export type ToolBinding = GeneratorTool;

/**
 * Wraps a Vercel AI SDK provider-defined tool for use in a generator's
 * `providerTools` array. The tool is passed through to the AI SDK without
 * compilation — the provider executes it server-side.
 *
 * @example
 * import { anthropic } from '@ai-sdk/anthropic';
 * import { providerTool } from '@flow-state-dev/core';
 *
 * generator({
 *   providerTools: [
 *     providerTool('webSearch', anthropic.tools.webSearch_20250305({ maxUses: 3 }))
 *   ],
 * })
 */
export function providerTool(name: string, tool: unknown): ProviderTool {
  return { __providerTool: true, tool, name } as const;
}

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
export type TypedUserSlotFn<TInput, TCtx = BlockContext> = (
  input: TInput,
  ctx: TCtx
) => MaybePromise<unknown>;

export interface GeneratorConfig<
  TInputSchema extends ZodTypeAny = ZodTypeAny,
  TOutputSchema extends ZodTypeAny = ZodTypeAny,
  TInput = z.infer<TInputSchema>,
  TOutput = z.infer<TOutputSchema>,
  // State schemas — optional, default to undefined (no schema declared)
  TRequestStateSchema extends ZodTypeAny | undefined = undefined,
  TSessionStateSchema extends ZodTypeAny | undefined = undefined,
  TUserStateSchema extends ZodTypeAny | undefined = undefined,
  TProjectStateSchema extends ZodTypeAny | undefined = undefined,
  TSequencerStateSchema extends ZodTypeAny | undefined = undefined,
  // Derive-once: evaluate z.infer exactly once per provided schema
  TRequestState extends object = InferStateFromSchema<TRequestStateSchema>,
  TSessionState extends object = InferStateFromSchema<TSessionStateSchema>,
  TUserState extends object = InferStateFromSchema<TUserStateSchema>,
  TProjectState extends object = InferStateFromSchema<TProjectStateSchema>,
  TSequencerState extends object = InferStateFromSchema<TSequencerStateSchema>,
  // Resource schemas — optional, default to undefined (no typed resources)
  TSessionResourceSchemas extends ZodTypeAny | undefined = undefined,
  TUserResourceSchemas extends ZodTypeAny | undefined = undefined,
  TProjectResourceSchemas extends ZodTypeAny | undefined = undefined,
  // Resource definitions — optional, provide typing AND auto-installation
  TSessionResourceDefs extends Record<string, DeclaredResourceEntry> | undefined = undefined,
  TUserResourceDefs extends Record<string, DeclaredResourceEntry> | undefined = undefined,
  TProjectResourceDefs extends Record<string, DeclaredResourceEntry> | undefined = undefined,
  // Derive-once: map resource schemas/definitions to typed ResourceRef records
  TSessionResources extends Record<string, AnyResourceRef> = InferBlockResources<TSessionResourceSchemas, TSessionResourceDefs>,
  TUserResources extends Record<string, AnyResourceRef> = InferBlockResources<TUserResourceSchemas, TUserResourceDefs>,
  TProjectResources extends Record<string, AnyResourceRef> = InferBlockResources<TProjectResourceSchemas, TProjectResourceDefs>,
  TTargetSchemas extends Record<string, ZodTypeAny> | undefined = undefined,
  // Capability type inference
  TUses extends readonly CapabilityRef[] = readonly [],
  TCapabilities extends Record<string, Record<string, (...args: any[]) => any>> = InferCapabilities<TUses>,
  // Single typed context threaded into all callbacks
  TCtx = BlockContext<
    TRequestState, TSessionState, TUserState, TProjectState,
    TSessionResources, TUserResources, TProjectResources, TSequencerState, unknown, TTargetSchemas,
    TCapabilities
  >,
> extends Omit<BlockConfig<TInputSchema, TOutputSchema, TInput, TOutput>, "execute"> {
  requestStateSchema?: TRequestStateSchema;
  sessionStateSchema?: TSessionStateSchema;
  userStateSchema?: TUserStateSchema;
  projectStateSchema?: TProjectStateSchema;
  sequencerStateSchema?: TSequencerStateSchema;
  sessionResourceSchemas?: TSessionResourceSchemas;
  userResourceSchemas?: TUserResourceSchemas;
  projectResourceSchemas?: TProjectResourceSchemas;
  sessionResources?: TSessionResourceDefs;
  userResources?: TUserResourceDefs;
  projectResources?: TProjectResourceDefs;
  connectInput?: ConnectorFn<unknown, TInput>;
  targetStateSchemas?: TTargetSchemas;
  /** Capabilities to install. Merges resources, state schemas, targets,
   *  and any active preset surfaces into this block's config. */
  uses?: TUses;
  model: ResolvableModel<NoInfer<TInput>, TCtx>;
  prompt: ResolvableString<TInput, TCtx>;
  context?: GeneratorSlot<NoInfer<TInput>, TCtx>;
  history?: GeneratorSlot<NoInfer<TInput>, TCtx>;
  /** Typed user slot: accepts a function over TInput, a static string, or other non-function slot entries. */
  user?: TypedUserSlotFn<TInput, TCtx> | GeneratorSlotStatic | Array<GeneratorSlotStatic>;
  tools?: GeneratorTool[] | ((ctx: TCtx) => MaybePromise<GeneratorTool[]>);
  /**
   * Enable provider-native web search. When `true`, uses defaults.
   * When an object, maps normalized config to the provider's native search tool.
   * The provider is detected at execution time from the resolved model.
   */
  search?: boolean | GeneratorSearchConfig;
  /** Provider-defined tools passed through to the AI SDK without block compilation. */
  providerTools?: ProviderTool[];
  loop?: GeneratorLoopConfig<TInput, TCtx>;
  maxIterations?: number;
  maxTokens?: number;
  repair?: GeneratorRepairConfig;
  repairOutput?: (
    candidate: unknown,
    error: Error,
    state: GeneratorLoopState<TInput>,
    ctx: TCtx
  ) => MaybePromise<unknown>;
  flowTools?: ToolsConfig;
  retry?: RetryPolicy;
  emit?: false | {
    reasoning?: boolean;
    messages?: boolean | 'reasoning';
    toolCalls?: boolean;
  };
  providerOptions?: ResolvableProviderOptions<TInput, TCtx>;
  /** When true (default), auto-inject tool name+description pairs into the system context. */
  describeTools?: boolean;
}



async function resolveString<TInput, TCtx extends BlockContext>(
  value: ResolvableString<TInput, TCtx>,
  input: TInput,
  ctx: TCtx
): Promise<string> {
  return typeof value === "function" ? value(input, ctx) : value;
}

async function resolveProviderOptions<TInput, TCtx extends BlockContext>(
  value: ResolvableProviderOptions<TInput, TCtx> | undefined,
  input: TInput,
  ctx: TCtx
): Promise<Record<string, unknown> | undefined> {
  if (value === undefined) return undefined;
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

async function resolveModel<TInput, TCtx extends BlockContext>(
  value: ResolvableModel<TInput, TCtx>,
  input: TInput,
  ctx: TCtx,
  blockName: string
): Promise<{ modelId: string; model: GeneratorModel }> {
  const resolved = typeof value === "function" ? await value(input, ctx) : value;

  if (typeof resolved === "string") {
    return {
      modelId: resolved,
      model: ctx.resolveModel(resolved, blockName)
    };
  }

  if (Array.isArray(resolved)) {
    if (resolved.length === 0) {
      throw new Error(`Generator "${blockName}" model array cannot be empty`);
    }
    const { createFallbackModel } = await import("../models/fallbackModel");
    const { parseModelString } = await import("../models/providerDetection");
    const entries = resolved.map((modelStr) => {
      const parsed = parseModelString(modelStr);
      return {
        modelId: modelStr,
        providerName: parsed.provider ?? "unknown",
        model: ctx.resolveModel(modelStr, blockName),
      };
    });
    const fallback = createFallbackModel({
      groupName: `${blockName}-fallback`,
      models: entries,
      retryPolicy: { maxAttemptsPerModel: 2, baseDelayMs: 1000, maxDelayMs: 10000 },
    });
    return { modelId: resolved[0], model: fallback };
  }

  if (isGeneratorModel(resolved)) {
    return {
      modelId: resolved.modelId,
      model: resolved
    };
  }

  throw new Error(
    `Generator "${blockName}" model must resolve to a model id string, string array, or GeneratorModel instance`
  );
}

function normalizeSlotEntries<TInput, TCtx extends BlockContext>(
  slot: GeneratorSlot<TInput, TCtx> | undefined
): GeneratorSlotEntry<TInput, TCtx>[] {
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

async function resolveSlotValues<TInput, TCtx extends BlockContext>(
  slot: GeneratorSlot<TInput, TCtx> | undefined,
  input: TInput,
  ctx: TCtx
): Promise<unknown[]> {
  const values: unknown[] = [];

  for (const entry of normalizeSlotEntries(slot)) {
    const resolved = typeof entry === "function" ? await entry(input, ctx) : entry;
    values.push(...normalizeToArray(resolved));
  }

  return values;
}

async function resolveTools<TCtx extends BlockContext>(
  tools: GeneratorTool[] | ((ctx: TCtx) => MaybePromise<GeneratorTool[]>) | undefined,
  ctx: TCtx
): Promise<GeneratorTool[]> {
  if (tools === undefined) {
    return [];
  }

  const resolved = typeof tools === "function" ? await tools(ctx) : tools;
  return Array.isArray(resolved) ? resolved : [];
}

const AI_SDK_SCHEMA_SYMBOL = Symbol.for("vercel.ai.schema");

/**
 * Normalize a tool's `inputSchema` into a form the AI SDK's `asSchema()` can
 * consume. Zod schemas carry `~standard`, AI-SDK Schema wrappers carry the
 * `vercel.ai.schema` symbol — both are already handled by `asSchema`. Anything
 * else (raw JSON Schema objects, MCP tool definitions that were unwrapped
 * somewhere upstream) gets wrapped via `jsonSchema()` so it doesn't fall into
 * the LazySchema `schema()` fallback and crash with "schema is not a function".
 */
function normalizeToolSchema(inputSchema: unknown): unknown {
  if (inputSchema == null) return inputSchema;
  if (typeof inputSchema !== "object") return inputSchema;
  // Zod and other Standard Schemas — AI SDK detects and handles these.
  if ("~standard" in inputSchema) return inputSchema;
  // Already an AI SDK Schema wrapper (from any compatible package version).
  if (AI_SDK_SCHEMA_SYMBOL in inputSchema) return inputSchema;
  // Raw JSON Schema object — wrap so AI SDK recognizes it as a Schema.
  return jsonSchema(inputSchema as any);
}

/**
 * Compile tools WITHOUT execute functions. Used when `runTools: false` — the
 * model will suggest tool calls, but the AI SDK won't auto-execute them.
 */
function compileToolsForModel(tools: GeneratorTool[]): GeneratorModelTool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: normalizeToolSchema(tool.inputSchema) as GeneratorModelTool["parameters"]
  }));
}

/**
 * Compile tools WITH execute wrappers. Each framework tool's `run()` method
 * is wrapped with the framework's retry/timeout/lifecycle hooks in an
 * `execute` closure. The AI SDK will auto-execute these tools during its
 * built-in multi-step loop.
 */
function compileToolsWithExecute(
  tools: GeneratorTool[],
  ctx: BlockContext,
  flowTools: ToolsConfig | undefined,
  generatorBlockName: string
): GeneratorModelTool[] {
  const timeoutMs = flowTools?.defaults?.timeoutMs;
  const retry = flowTools?.defaults?.retry;
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: normalizeToolSchema(tool.inputSchema) as GeneratorModelTool["parameters"],
    execute: async (args: unknown, options?: { toolCallId?: string }) => {
      const runTool = async (scopedCtx: BlockContext): Promise<unknown> => {
        await runToolObserver(flowTools?.onToolStarted, { toolName: tool.name, input: args }, scopedCtx);
        try {
          const output = await runWithRetry(
            () => withTimeout(Promise.resolve(tool.run(args, scopedCtx)), timeoutMs, `tool:${tool.name}`),
            retry
          );
          await runToolObserver(flowTools?.onToolCompleted, { toolName: tool.name, input: args, output }, scopedCtx);

          // Emit block_tool_output item so tool results appear in the stream
          // and can be replayed into LLM context on subsequent requests.
          if (options?.toolCallId !== undefined) {
            const identity = scopedCtx._blockIdentity;
            const toolOutputItem = {
              id: `item_tool_output_${Date.now()}_${Math.random().toString(16).slice(2)}`,
              type: "block_tool_output" as const,
              status: "completed" as const,
              requestId: scopedCtx.request.identity.id,
              itemIndex: getEmitterItemCount(scopedCtx.response),
              provenance: {
                blockName: identity?.blockName ?? tool.name,
                blockInstanceId: identity?.blockInstanceId ?? tool.name,
                parentBlockInstanceId: identity?.parentBlockInstanceId,
                phase: "main" as const
              },
              ts: Date.now(),
              ownedBy: identity?.ownedBy,
              blockName: tool.name,
              output,
              toolCall: {
                callId: options.toolCallId,
                name: tool.name,
                arguments: typeof args === "string" ? args : JSON.stringify(args),
                generatorBlock: generatorBlockName
              }
            };
            await scopedCtx.response.emit({ type: "item.added", item: toolOutputItem });
            await scopedCtx.response.emit({ type: "item.done", item: toolOutputItem });
          }

          return output;
        } catch (error) {
          const err = toError(error);
          await runToolObserver(flowTools?.onToolErrored, { toolName: tool.name, input: args, error: err }, scopedCtx);

          // Emit a failed block_tool_output so the devtool can display the error
          if (options?.toolCallId !== undefined) {
            const identity = scopedCtx._blockIdentity;
            const toolErrorItem = {
              id: `item_tool_output_${Date.now()}_${Math.random().toString(16).slice(2)}`,
              type: "block_tool_output" as const,
              status: "failed" as const,
              requestId: scopedCtx.request.identity.id,
              itemIndex: getEmitterItemCount(scopedCtx.response),
              provenance: {
                blockName: identity?.blockName ?? tool.name,
                blockInstanceId: identity?.blockInstanceId ?? tool.name,
                parentBlockInstanceId: identity?.parentBlockInstanceId,
                phase: "main" as const
              },
              ts: Date.now(),
              ownedBy: identity?.ownedBy,
              blockName: tool.name,
              output: undefined,
              toolCall: {
                callId: options.toolCallId,
                name: tool.name,
                arguments: typeof args === "string" ? args : JSON.stringify(args),
                generatorBlock: generatorBlockName
              },
              error: {
                message: err.message,
                code: (err as any).code
              }
            };
            await scopedCtx.response.emit({ type: "item.added", item: toolErrorItem });
            await scopedCtx.response.emit({ type: "item.done", item: toolErrorItem });
          }

          throw err;
        }
      };

      if (ctx._withExecutionScope === undefined) {
        return runTool(ctx);
      }

      return ctx._withExecutionScope(
        {
          name: tool.name,
          kind: tool.kind,
          instanceId: `${tool.name}_${Date.now()}_${Math.random().toString(16).slice(2)}`,
          input: args
        },
        runTool
      );
    }
  }));
}

/**
 * Build a context string listing available tools by name and description.
 * Returns undefined if no tools have descriptions.
 */
function buildToolDescriptionContext(tools: GeneratorTool[]): string | undefined {
  const described = tools.filter((t) => t.description);
  if (described.length === 0) {
    return undefined;
  }

  const lines = described.map((t) => `- ${t.name}: ${t.description}`);
  return `Available tools:\n${lines.join("\n")}`;
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
  config: { repair?: GeneratorRepairConfig; repairOutput?: (candidate: unknown, error: Error, state: GeneratorLoopState<TInput>, ctx: BlockContext) => MaybePromise<unknown> },
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

function isTextOutputSchema(schema: ZodTypeAny): boolean {
  // Detect z.string() — the default text output schema.
  // ZodString has _def.typeName === "ZodString".
  // Guard against non-Zod schemas (e.g. passthrough mocks) that lack _def.
  const def = (schema as { _def?: { typeName?: string } })._def;
  return def?.typeName === "ZodString";
}

function resolveGenerationCandidate(result: GeneratorModelResult): unknown {
  if (result.structuredOutput !== undefined) {
    return result.structuredOutput;
  }

  return result.text;
}


function resolveMaxIterations(config: { loop?: GeneratorLoopConfig<unknown>; maxIterations?: number }): number {
  const configured = config.loop?.maxIterations ?? config.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  return Math.max(1, configured);
}

/**
 * Builds a SourceItem from a GeneratorModelSource for emission into the
 * item stream. Used by both streaming and non-streaming paths.
 */
function buildSourceItem(
  source: GeneratorModelSource,
  ctx: BlockContext,
  provenance: { blockName: string; blockInstanceId: string; phase: "main" | "work" }
) {
  return {
    id: `item_source_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    type: "source" as const,
    status: "completed" as const,
    requestId: ctx.request.identity.id,
    itemIndex: getEmitterItemCount(ctx.response),
    provenance,
    ts: Date.now(),
    ownedBy: ctx._blockIdentity?.ownedBy,
    sourceType: "url" as const,
    sourceId: source.id,
    url: source.url,
    title: source.title,
    providerMetadata: source.providerMetadata
  };
}

/**
 * Duck-typed helper to get the current item count from the response emitter.
 * The core ResponseEmitterHandle only exposes `emit()`, but the server-side
 * ResponseEmitter also has `getItems()`. We use duck-typing so the generator
 * can assign a sequential itemIndex without importing server types.
 */
function getEmitterItemCount(response: unknown): number {
  if (
    typeof response === "object" &&
    response !== null &&
    "getItems" in response &&
    typeof (response as { getItems?: unknown }).getItems === "function"
  ) {
    const items = (response as { getItems: () => unknown[] }).getItems();
    return Array.isArray(items) ? items.length : 0;
  }
  return 0;
}

/** Resolved emit configuration with all flags normalized to concrete values. */
type NormalizedEmit = {
  reasoning: boolean;
  messages: boolean | 'reasoning';
  toolCalls: boolean;
};

/** Normalizes the user-facing emit config into concrete flags. */
function normalizeEmit(emit: GeneratorConfig<any, any, any, any>['emit']): NormalizedEmit {
  if (emit === false) return { reasoning: false, messages: false, toolCalls: false };
  return {
    reasoning: emit?.reasoning !== false,
    messages: emit?.messages ?? true,
    toolCalls: emit?.toolCalls !== false,
  };
}

/**
 * Executes a streaming text generation: emits item.added, content.added,
 * content.delta per chunk, content.done, and item.done events.
 *
 * Supports multi-step tool loops — the AI SDK drives tool execution via
 * `execute` closures on compiled tools, and this function streams all text
 * deltas to the client as they arrive.
 */
async function executeStreamingGeneration<TInput, TOutput>(
  model: GeneratorModel,
  messages: unknown[],
  compiledTools: GeneratorModelTool[],
  providerTools: ProviderTool[],
  config: GeneratorConfig<any, any, TInput, TOutput>,
  outputSchema: ZodTypeAny,
  blockName: string,
  maxSteps: number,
  ctx: BlockContext,
  emitConfig: NormalizedEmit,
  prepareStep?: PrepareStepFn,
  resolvedProviderOpts?: Record<string, unknown>
): Promise<TOutput> {
  const itemId = `item_msg_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const contentPartIndex = 0;
  const identity = ctx._blockIdentity;
  const provenance = {
    blockName: identity?.blockName ?? blockName,
    blockInstanceId: identity?.blockInstanceId ?? blockName,
    parentBlockInstanceId: identity?.parentBlockInstanceId,
    phase: "main" as const
  };
  const ownedBy = identity?.ownedBy;
  const emitReasoning = emitConfig.reasoning;
  let reasoningAccumulated = "";

  // Reasoning and message items are emitted lazily so their order in the
  // item list matches the natural stream order (reasoning before text).
  const reasoningItemId = `item_reasoning_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const reasoningContentIndex = 0;
  let reasoningStarted = false;

  let messageItem: Record<string, unknown> | null = null;
  let messageEmitted = false;
  let finalResult: GeneratorModelResult | undefined;

  // Stream text deltas (tool calls are handled internally by the AI SDK)
  let accumulated = "";
  for await (const chunk of model.stream!({
    messages,
    tools: compiledTools.length > 0 ? compiledTools : undefined,
    providerTools: providerTools.length > 0 ? providerTools : undefined,
    maxTokens: config.maxTokens,
    signal: ctx.signal,
    maxSteps,
    providerOptions: resolvedProviderOpts,
    prepareStep
  })) {
    if (chunk.type === "reasoning_delta" && chunk.reasoningDelta !== undefined) {
      if (emitReasoning) {
        // On first reasoning delta, emit in-progress reasoning item
        if (!reasoningStarted) {
          reasoningStarted = true;
          const reasoningItem = {
            id: reasoningItemId,
            type: "reasoning" as const,
            status: "in_progress" as const,
            transient: false,
            requestId: ctx.request.identity.id,
            itemIndex: getEmitterItemCount(ctx.response),
            provenance,
            ts: Date.now(),
            ownedBy,
            summary: [{ type: "reasoning_text" as const, text: "" }]
          };
          await ctx.response.emit({ type: "item.added", item: reasoningItem });
          await ctx.response.emit({
            type: "content.added",
            itemId: reasoningItemId,
            contentIndex: reasoningContentIndex,
            content: { type: "reasoning_text", text: "" }
          });
        }
        // Stream each reasoning delta to the client
        reasoningAccumulated += chunk.reasoningDelta;
        await ctx.response.emit({
          type: "content.delta",
          itemId: reasoningItemId,
          contentIndex: reasoningContentIndex,
          delta: chunk.reasoningDelta
        });
      }
    } else if (chunk.type === "text_delta" && chunk.textDelta !== undefined) {
      // On first text delta, finalize reasoning and start the message (or
      // a reasoning item when messages are remapped via emit.messages: 'reasoning').
      // When messages are fully suppressed, just accumulate text silently.
      const emitMessages = emitConfig.messages;
      if (!messageEmitted) {
        // Close reasoning item if it was started
        if (reasoningStarted) {
          await ctx.response.emit({
            type: "content.done",
            itemId: reasoningItemId,
            contentIndex: reasoningContentIndex,
            content: { type: "reasoning_text", text: reasoningAccumulated }
          });
          const completedReasoning = {
            id: reasoningItemId,
            type: "reasoning" as const,
            status: "completed" as const,
            transient: false,
            requestId: ctx.request.identity.id,
            itemIndex: getEmitterItemCount(ctx.response),
            provenance,
            ts: Date.now(),
            ownedBy,
            summary: [{ type: "reasoning_text" as const, text: reasoningAccumulated }]
          };
          await ctx.response.emit({ type: "item.done", item: completedReasoning });
        }

        if (emitMessages === false) {
          // Messages suppressed — no item emitted, just accumulate text
        } else if (emitMessages === 'reasoning') {
          // Emit text as a reasoning item instead of a message
          messageItem = {
            id: itemId,
            type: "reasoning" as const,
            status: "in_progress" as const,
            transient: false,
            requestId: ctx.request.identity.id,
            itemIndex: getEmitterItemCount(ctx.response),
            provenance,
            ts: Date.now(),
            ownedBy,
            summary: [{ type: "reasoning_text" as const, text: "" }]
          };
          await ctx.response.emit({ type: "item.added", item: messageItem });
          await ctx.response.emit({
            type: "content.added",
            itemId,
            contentIndex: contentPartIndex,
            content: { type: "reasoning_text", text: "" }
          });
        } else {
          // Normal assistant message
          messageItem = {
            id: itemId,
            type: "message" as const,
            role: "assistant" as const,
            status: "in_progress" as const,
            transient: false,
            requestId: ctx.request.identity.id,
            itemIndex: getEmitterItemCount(ctx.response),
            provenance,
            ts: Date.now(),
            ownedBy,
            content: [{ type: "output_text" as const, text: "" }]
          };
          await ctx.response.emit({ type: "item.added", item: messageItem });
          await ctx.response.emit({
            type: "content.added",
            itemId,
            contentIndex: contentPartIndex,
            content: { type: "output_text", text: "" }
          });
        }
        messageEmitted = true;
      }
      accumulated += chunk.textDelta;
      if (emitMessages !== false) {
        await ctx.response.emit({
          type: "content.delta",
          itemId,
          contentIndex: contentPartIndex,
          delta: chunk.textDelta
        });
      }
    } else if (chunk.type === "tool_input_start" && chunk.toolInput !== undefined) {
      // Emit a status item so clients see progress during provider tool execution.
      // Gated by emit.toolCalls — worker generators suppress these to avoid flooding.
      if (emitConfig.toolCalls) {
        const toolName = chunk.toolInput.toolName;
        const statusItem = {
          id: `item_status_${Date.now()}_${Math.random().toString(16).slice(2)}`,
          type: "status" as const,
          status: "completed" as const,
          transient: true,
          requestId: ctx.request.identity.id,
          itemIndex: getEmitterItemCount(ctx.response),
          provenance,
          ts: Date.now(),
          message: `Using ${toolName}…`,
          detail: { toolName, providerExecuted: chunk.toolInput.providerExecuted ?? false }
        };
        await ctx.response.emit({ type: "item.added", item: statusItem });
        await ctx.response.emit({ type: "item.done", item: statusItem });
      }
    } else if (chunk.type === "tool_call_delta" && chunk.toolCallDelta !== undefined) {
      // Emit tool call progress so clients can show incremental tool call args.
      // Each delta is emitted as a transient status update — the full tool call
      // lifecycle (start → args → result) is tracked by toolCallId.
      // Gated by emit.toolCalls — worker generators suppress these to avoid flooding.
      if (emitConfig.toolCalls) {
        const delta = chunk.toolCallDelta;
        const toolCallItem = {
          id: `item_toolcall_${delta.toolCallId}`,
          type: "tool_call_progress" as const,
          status: "in_progress" as const,
          transient: true,
          requestId: ctx.request.identity.id,
          itemIndex: getEmitterItemCount(ctx.response),
          provenance,
          ts: Date.now(),
          ownedBy,
          toolCallId: delta.toolCallId,
          toolName: delta.toolName,
          argsDelta: delta.argsDelta
        };
        await ctx.response.emit({ type: "item.added", item: toolCallItem });
        await ctx.response.emit({ type: "item.done", item: toolCallItem });
      }
    } else if (chunk.type === "tool_result" && chunk.toolResult !== undefined) {
      // Emit completed tool result so clients see the outcome of tool execution.
      // Gated by emit.toolCalls — worker generators suppress these to avoid flooding.
      if (emitConfig.toolCalls) {
        const tr = chunk.toolResult;
        const toolResultItem = {
          id: `item_toolresult_${tr.toolCallId}`,
          type: "tool_call_progress" as const,
          status: "completed" as const,
          transient: true,
          requestId: ctx.request.identity.id,
          itemIndex: getEmitterItemCount(ctx.response),
          provenance,
          ts: Date.now(),
          ownedBy,
          toolCallId: tr.toolCallId,
          toolName: tr.toolName,
          result: tr.result
        };
        await ctx.response.emit({ type: "item.added", item: toolResultItem });
        await ctx.response.emit({ type: "item.done", item: toolResultItem });
      }
    } else if (chunk.type === "source_url" && chunk.source !== undefined) {
      const sourceItem = buildSourceItem(chunk.source, ctx, provenance);
      await ctx.response.emit({ type: "item.added", item: sourceItem });
      await ctx.response.emit({ type: "item.done", item: sourceItem });
    } else if (chunk.type === "finish") {
      finalResult = chunk.fullResult;
    }
  }

  // If no text deltas arrived, still finalize reasoning and emit message
  const emitMessages = emitConfig.messages;
  if (!messageEmitted) {
    if (reasoningStarted) {
      await ctx.response.emit({
        type: "content.done",
        itemId: reasoningItemId,
        contentIndex: reasoningContentIndex,
        content: { type: "reasoning_text", text: reasoningAccumulated }
      });
      const completedReasoning = {
        id: reasoningItemId,
        type: "reasoning" as const,
        status: "completed" as const,
        transient: false,
        requestId: ctx.request.identity.id,
        itemIndex: getEmitterItemCount(ctx.response),
        provenance,
        ts: Date.now(),
        ownedBy,
        summary: [{ type: "reasoning_text" as const, text: reasoningAccumulated }]
      };
      await ctx.response.emit({ type: "item.done", item: completedReasoning });
    }
    if (emitMessages === false) {
      // Messages suppressed — no item emitted
    } else if (emitMessages === 'reasoning') {
      messageItem = {
        id: itemId,
        type: "reasoning" as const,
        status: "in_progress" as const,
        transient: false,
        requestId: ctx.request.identity.id,
        itemIndex: getEmitterItemCount(ctx.response),
        provenance,
        ts: Date.now(),
        ownedBy,
        summary: [{ type: "reasoning_text" as const, text: "" }]
      };
      await ctx.response.emit({ type: "item.added", item: messageItem });
      await ctx.response.emit({
        type: "content.added",
        itemId,
        contentIndex: contentPartIndex,
        content: { type: "reasoning_text", text: "" }
      });
    } else {
      messageItem = {
        id: itemId,
        type: "message" as const,
        role: "assistant" as const,
        status: "in_progress" as const,
        transient: false,
        requestId: ctx.request.identity.id,
        itemIndex: getEmitterItemCount(ctx.response),
        provenance,
        ts: Date.now(),
        ownedBy,
        content: [{ type: "output_text" as const, text: "" }]
      };
      await ctx.response.emit({ type: "item.added", item: messageItem });
      await ctx.response.emit({
        type: "content.added",
        itemId,
        contentIndex: contentPartIndex,
        content: { type: "output_text", text: "" }
      });
    }
    messageEmitted = true;
  }

  // Validate output through the schema
  const parsed = outputSchema.safeParse(accumulated);
  if (!parsed.success) {
    throw new Error(
      `Generator "${blockName}" streaming output failed schema validation: ${parsed.error.issues[0]?.message ?? "unknown"}`
    );
  }

  // Emit content.done and completed item (skip when messages are suppressed)
  if (emitMessages !== false && messageItem) {
    const isReasoning = emitMessages === 'reasoning';
    const contentType = isReasoning ? "reasoning_text" : "output_text";
    await ctx.response.emit({
      type: "content.done",
      itemId,
      contentIndex: contentPartIndex,
      content: { type: contentType, text: accumulated }
    });
    const completedItem = isReasoning
      ? { ...messageItem, status: "completed" as const, summary: [{ type: "reasoning_text" as const, text: accumulated }] }
      : { ...messageItem, status: "completed" as const, content: [{ type: "output_text" as const, text: accumulated }] };
    await ctx.response.emit({ type: "item.done", item: completedItem });
  }

  ctx._runtimeHooks?.onGeneratorModelResult?.({
    model: model.modelId,
    usage: finalResult?.usage,
    providerMetadata: finalResult?.providerMetadata
  });

  return parsed.data as TOutput;
}

export function generator<
  TInputSchema extends ZodTypeAny = ZodTypeAny,
  TOutputSchema extends ZodTypeAny = ZodTypeAny,
  TInput = z.infer<TInputSchema>,
  TOutput = z.infer<TOutputSchema>,
  TRequestStateSchema extends ZodTypeAny | undefined = undefined,
  TSessionStateSchema extends ZodTypeAny | undefined = undefined,
  TUserStateSchema extends ZodTypeAny | undefined = undefined,
  TProjectStateSchema extends ZodTypeAny | undefined = undefined,
  TSequencerStateSchema extends ZodTypeAny | undefined = undefined,
  TRequestState extends object = InferStateFromSchema<TRequestStateSchema>,
  TSessionState extends object = InferStateFromSchema<TSessionStateSchema>,
  TUserState extends object = InferStateFromSchema<TUserStateSchema>,
  TProjectState extends object = InferStateFromSchema<TProjectStateSchema>,
  TSequencerState extends object = InferStateFromSchema<TSequencerStateSchema>,
  TSessionResourceSchemas extends ZodTypeAny | undefined = undefined,
  TUserResourceSchemas extends ZodTypeAny | undefined = undefined,
  TProjectResourceSchemas extends ZodTypeAny | undefined = undefined,
  TSessionResourceDefs extends Record<string, DeclaredResourceEntry> | undefined = undefined,
  TUserResourceDefs extends Record<string, DeclaredResourceEntry> | undefined = undefined,
  TProjectResourceDefs extends Record<string, DeclaredResourceEntry> | undefined = undefined,
  TSessionResources extends Record<string, AnyResourceRef> = InferBlockResources<TSessionResourceSchemas, TSessionResourceDefs>,
  TUserResources extends Record<string, AnyResourceRef> = InferBlockResources<TUserResourceSchemas, TUserResourceDefs>,
  TProjectResources extends Record<string, AnyResourceRef> = InferBlockResources<TProjectResourceSchemas, TProjectResourceDefs>,
  TTargetSchemas extends Record<string, ZodTypeAny> | undefined = undefined,
  TUses extends readonly CapabilityRef[] = readonly [],
  TCapabilities extends Record<string, Record<string, (...args: any[]) => any>> = InferCapabilities<TUses>,
  TCtx = BlockContext<
    TRequestState, TSessionState, TUserState, TProjectState,
    TSessionResources, TUserResources, TProjectResources, TSequencerState, unknown, TTargetSchemas,
    TCapabilities
  >,
>(
  config: GeneratorConfig<
    TInputSchema, TOutputSchema, TInput, TOutput,
    TRequestStateSchema, TSessionStateSchema, TUserStateSchema, TProjectStateSchema, TSequencerStateSchema,
    TRequestState, TSessionState, TUserState, TProjectState, TSequencerState,
    TSessionResourceSchemas, TUserResourceSchemas, TProjectResourceSchemas,
    TSessionResourceDefs, TUserResourceDefs, TProjectResourceDefs,
    TSessionResources, TUserResources, TProjectResources, TTargetSchemas,
    TUses, TCapabilities, TCtx
  >
): BlockDefinition<TInputSchema, TOutputSchema, TInput, TOutput> {
  const { declaredResources, resolvedCapabilities, mergedSurface, dynamicUses } = resolveCapabilities(config, "generator");

  const outputSchema = (config.outputSchema ?? z.string()) as ZodTypeAny;
  const normalizedConfig: GeneratorConfig<TInputSchema, TOutputSchema, TInput, TOutput> = {
    ...config,
    outputSchema: outputSchema as TOutputSchema
  } as GeneratorConfig<TInputSchema, TOutputSchema, TInput, TOutput>;

  // -----------------------------------------------------------------------
  // Merge all capability contributions (static + dynamic) into the
  // generator's context and tools slots in a single pass. No layered
  // wrapping — each slot is set exactly once.
  // -----------------------------------------------------------------------

  const staticContextEntries = mergedSurface?.contextEntries ?? [];
  const staticToolEntries = mergedSurface?.toolEntries ?? [];
  const hasStaticContext = staticContextEntries.length > 0;
  const hasStaticTools = staticToolEntries.length > 0;
  const hasDynamic = dynamicUses.length > 0;

  // -- Context: append static + dynamic entries to the user's context array
  if (hasStaticContext || hasDynamic) {
    const userContext = normalizedConfig.context;
    const userArr = userContext === undefined
      ? []
      : Array.isArray(userContext)
        ? userContext
        : [userContext];

    const additions: unknown[] = [...staticContextEntries];

    // Dynamic context: a single entry that resolves all dynamic capabilities.
    // Uses resolveDynamicCapSurface for a single-pass traversal.
    if (hasDynamic) {
      additions.push(async (input: unknown, ctx: BlockContext) => {
        const parts: string[] = [];
        for (const resolver of dynamicUses) {
          for (const cap of resolver(ctx)) {
            const surface = await resolveDynamicCapSurface(cap, ctx);
            for (const entry of surface.contextEntries) {
              const v = typeof entry === "function" ? entry(input, ctx) : entry;
              if (v != null && v !== "") parts.push(String(v));
            }
          }
        }
        return parts.length > 0 ? parts.join("\n\n") : null;
      });
    }

    (normalizedConfig as any).context = [...userArr, ...additions];
  }

  // -- Tools: single async resolver combining user tools + static caps + dynamic caps
  if (hasStaticTools || hasDynamic) {
    const userTools = normalizedConfig.tools;

    (normalizedConfig as any).tools = async (ctx: BlockContext) => {
      // 1. User-declared tools (static array or function)
      const base: GeneratorTool[] = userTools
        ? Array.isArray(userTools) ? userTools : await userTools(ctx as any)
        : [];

      // 2. Static capability preset tools
      const staticTools: GeneratorTool[] = hasStaticTools
        ? (await Promise.all(
            staticToolEntries.map((f) => Array.isArray(f) ? f : f(ctx))
          )).flat()
        : [];

      // 3. Dynamic capability tools (single-pass via resolveDynamicCapSurface)
      const dynTools: GeneratorTool[] = [];
      if (hasDynamic) {
        for (const resolver of dynamicUses) {
          for (const cap of resolver(ctx)) {
            const surface = await resolveDynamicCapSurface(cap, ctx);
            dynTools.push(...surface.tools);
          }
        }
      }

      return [...base, ...staticTools, ...dynTools];
    };
  }

  return buildBlock<TInputSchema, TOutputSchema, TInput, TOutput>({
    kind: "generator",
    config: normalizedConfig as unknown as BlockConfig<TInputSchema, TOutputSchema, TInput, TOutput>,
    declaredResources,
    resolvedCapabilities,
    execute: async (input: TInput, ctx) => {
      const blockName = String(normalizedConfig.name);
      const { modelId, model } = await resolveModel(
        normalizedConfig.model,
        input,
        ctx,
        blockName
      );

      const resolvedProviderOpts = await resolveProviderOptions(
        normalizedConfig.providerOptions,
        input,
        ctx
      );

      // Resolve provider-native tools (search + explicit providerTools).
      const resolvedProviderTools: ProviderTool[] = [
        ...(normalizedConfig.providerTools ?? [])
      ];
      if (normalizedConfig.search) {
        const searchConfig = normalizedConfig.search === true ? {} : normalizedConfig.search;
        const searchTool = model.resolveSearchTool?.(searchConfig);
        if (searchTool) {
          resolvedProviderTools.push({ __providerTool: true, ...searchTool });
        }
      }

      const autoDescribe = normalizedConfig.describeTools !== false;
      const toolBlocks = await resolveTools(normalizedConfig.tools, ctx);

      const prompt = await resolveString(normalizedConfig.prompt, input, ctx);
      const contextValues = await resolveSlotValues(normalizedConfig.context, input, ctx);

      // Auto-describe: inject tool name+description pairs into context.
      if (autoDescribe) {
        const toolDescription = buildToolDescriptionContext(toolBlocks);
        if (toolDescription !== undefined) {
          contextValues.push(toolDescription);
        }
      }

      const historyValues = await resolveSlotValues(normalizedConfig.history, input, ctx);
      const userValues = await resolveSlotValues(normalizedConfig.user as GeneratorSlot | undefined, input, ctx);

      // Build initial system prefix (prompt + context + tool descriptions)
      // separately so prepareStep can replace it with freshly resolved values.
      const systemPrefix: unknown[] = [
        { role: "system", content: prompt },
        ...contextValues.map(asSystemMessage)
      ];
      const systemPrefixCount = systemPrefix.length;
      const messages: unknown[] = [
        ...systemPrefix,
        ...historyValues,
        ...userValues.map(asUserMessage)
      ];

      // Build prepareStep callback when prompt, context, or tools contain
      // dynamic (function-typed) entries. The AI SDK calls this before each
      // step of the multi-step tool loop, letting us re-resolve dynamic
      // slots so the LLM sees fresh state and the correct active tools.
      const hasDynamicPrompt = typeof normalizedConfig.prompt === "function";
      const hasDynamicContext = normalizeSlotEntries(normalizedConfig.context).some(
        (entry) => typeof entry === "function"
      );
      const hasDynamicTools = typeof normalizedConfig.tools === "function";

      let prepareStepFn: PrepareStepFn | undefined;
      if (hasDynamicPrompt || hasDynamicContext || hasDynamicTools) {
        prepareStepFn = async ({ stepNumber, messages: currentMessages, steps: _steps }) => {
          if (stepNumber === 0) {
            return undefined;
          }

          // Re-resolve tools when dynamic so we can update activeTools and
          // rebuild tool descriptions to match the current step's tool set.
          let activeTools: string[] | undefined;
          let freshToolDescription: string | undefined;
          if (hasDynamicTools) {
            const freshTools = await resolveTools(normalizedConfig.tools, ctx);
            activeTools = freshTools.map((t) => t.name);
            if (autoDescribe) {
              freshToolDescription = buildToolDescriptionContext(freshTools);
            }
          } else if (autoDescribe) {
            freshToolDescription = buildToolDescriptionContext(toolBlocks);
          }

          const freshPrompt = await resolveString(normalizedConfig.prompt, input, ctx);
          const freshContext = await resolveSlotValues(normalizedConfig.context, input, ctx);
          if (freshToolDescription !== undefined) {
            freshContext.push(freshToolDescription);
          }

          const freshSystemPrefix: unknown[] = [
            { role: "system", content: freshPrompt },
            ...freshContext.map(asSystemMessage)
          ];

          // Replace the system prefix with fresh values; keep conversation
          // messages (history, user, accumulated tool calls/results).
          const conversationMessages = currentMessages.slice(systemPrefixCount);
          return {
            messages: [...freshSystemPrefix, ...conversationMessages],
            activeTools
          };
        };
      }

      const runTools = normalizedConfig.loop?.runTools !== false;
      const maxSteps = resolveMaxIterations(normalizedConfig);

      // Compile tools: with execute wrappers (AI SDK auto-runs them) or
      // without (model suggests calls but doesn't execute them).
      const compiledTools = toolBlocks.length > 0
        ? (runTools
            ? compileToolsWithExecute(toolBlocks, ctx, normalizedConfig.flowTools, blockName)
            : compileToolsForModel(toolBlocks))
        : [];

      // Streaming path: text output + model supports streaming.
      // Use streaming when messages are enabled OR when tools are present (so tool
      // status events flow to the client even when message text is suppressed).
      const emitConfig = normalizeEmit(normalizedConfig.emit);
      const messagesEnabled = emitConfig.messages !== false;
      const hasTools = compiledTools.length > 0 || resolvedProviderTools.length > 0;
      const canStream = (messagesEnabled || hasTools) && isTextOutputSchema(outputSchema) && model.stream !== undefined;

      if (canStream) {
        return await executeStreamingGeneration(
          model,
          messages,
          compiledTools,
          resolvedProviderTools,
          normalizedConfig,
          outputSchema,
          blockName,
          maxSteps,
          ctx,
          emitConfig,
          prepareStepFn,
          resolvedProviderOpts
        );
      }

      // Non-streaming: single call, model handles multi-step loop via maxSteps.
      const generation = await model.generate({
        messages,
        tools: compiledTools.length > 0 ? compiledTools : undefined,
        providerTools: resolvedProviderTools.length > 0 ? resolvedProviderTools : undefined,
        outputSchema,
        maxTokens: normalizedConfig.maxTokens,
        signal: ctx.signal,
        maxSteps,
        providerOptions: resolvedProviderOpts,
        prepareStep: prepareStepFn
      });

      const candidate = resolveGenerationCandidate(generation);
      ctx._runtimeHooks?.onGeneratorModelResult?.({
        model: model.modelId,
        usage: generation.usage,
        providerMetadata: generation.providerMetadata
      });

      // Emit source items from provider-native tools (e.g., web search).
      if (generation.sources !== undefined && generation.sources.length > 0) {
        const sourceIdentity = ctx._blockIdentity;
        const sourceProv = {
          blockName: sourceIdentity?.blockName ?? blockName,
          blockInstanceId: sourceIdentity?.blockInstanceId ?? blockName,
          parentBlockInstanceId: sourceIdentity?.parentBlockInstanceId,
          phase: "main" as const
        };
        for (const source of generation.sources) {
          const sourceItem = buildSourceItem(source, ctx, sourceProv);
          await ctx.response.emit({ type: "item.added", item: sourceItem });
          await ctx.response.emit({ type: "item.done", item: sourceItem });
        }
      }
      if (candidate === undefined) {
        throw new Error(`Generator "${blockName}" did not produce output after ${maxSteps} step(s)`);
      }

      // Build a loop state for the repair policy (iteration 0, post-hoc)
      const state: GeneratorLoopState<TInput> = {
        iteration: 0,
        input,
        model: model.modelId,
        prompt,
        messages,
        toolResults: [],
        lastCandidate: candidate
      };

      const output = await applyRepairPolicy<TInput, TOutput>(
        normalizedConfig, outputSchema, candidate, state, ctx
      );

      // For text-output generators, emit an assistant MessageItem (or reasoning
      // item when messages are remapped) so the output appears in the stream.
      // Suppress entirely when emit.messages is false.
      if (emitConfig.messages !== false && isTextOutputSchema(outputSchema) && typeof output === "string") {
        const itemId = `item_msg_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        const outputIdentity = ctx._blockIdentity;
        const provenance = {
          blockName: outputIdentity?.blockName ?? blockName,
          blockInstanceId: outputIdentity?.blockInstanceId ?? blockName,
          parentBlockInstanceId: outputIdentity?.parentBlockInstanceId,
          phase: "main" as const
        };
        const nsOwnedBy = outputIdentity?.ownedBy;
        if (emitConfig.messages === 'reasoning') {
          const reasoningItem = {
            id: itemId,
            type: "reasoning" as const,
            status: "completed" as const,
            transient: false,
            requestId: ctx.request.identity.id,
            itemIndex: getEmitterItemCount(ctx.response),
            provenance,
            ts: Date.now(),
            ownedBy: nsOwnedBy,
            summary: [{ type: "reasoning_text" as const, text: output }]
          };
          await ctx.response.emit({ type: "item.added", item: reasoningItem });
          await ctx.response.emit({ type: "item.done", item: reasoningItem });
        } else {
          const messageItem = {
            id: itemId,
            type: "message" as const,
            role: "assistant" as const,
            status: "completed" as const,
            transient: false,
            requestId: ctx.request.identity.id,
            itemIndex: getEmitterItemCount(ctx.response),
            provenance,
            ts: Date.now(),
            ownedBy: nsOwnedBy,
            content: [{ type: "output_text" as const, text: output }]
          };
          await ctx.response.emit({ type: "item.added", item: messageItem });
          await ctx.response.emit({ type: "item.done", item: messageItem });
        }
      }

      return output;
    }
  });
}
