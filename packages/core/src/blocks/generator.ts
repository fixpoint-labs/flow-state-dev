import { z, type ZodTypeAny } from "zod";
import { OutputValidationError } from "../errors/output-validation-error";
import { jsonSchema } from "ai";
import type {
  BlockCacheableConfig,
  BlockConfig,
  BlockContext,
  BlockDefinition,
  ConnectorFn,
  InferBlockResources,
  InferStateFromSchema,
  RetryPolicy
} from "../types/block";
import { asRuntime } from "../types/block";
import type { ItemQuery, MessageLimit } from "../types/scope";
import type { AgentType } from "../items/types";
import type { AnyResourceRef } from "../types/resource";
import type { DeclaredResourceEntry } from "../types/block";
import type {
  CachingConfig,
  GeneratorModel,
  GeneratorModelResult,
  GeneratorModelSource,
  GeneratorModelTool,
  GeneratorSearchConfig,
  ModelIdentity,
  PrepareStepFn,
  ProviderTool
} from "../types/model";
import type { ModelSelection } from "../models/selectModel";
import { isModelSelection } from "../models/selectModel";
import type { ProviderPreference } from "../models/types";
import type { ToolLifecycleEvent, ToolsConfig } from "../types/flow";
import type {
  CapabilityRef,
  InferCapabilities,
  InferCapabilityResources,
  InferCapabilitySequencerState,
  InferCapabilitySessionState,
  MergeTargetSchemas,
  Prettify,
  UsesEntry,
} from "../capability/types";

import { resolveActivePresets, flattenCapabilities } from "../capability/merge";
import { buildBlock } from "./internal/build-block";
import { sanitizeToolName } from "../utils/tool-name";
import { resolveCapabilities, capabilityMatchesAgent } from "./internal/resolve-capabilities";
import {
  aggregateContextEntries,
  objectFormHasNestedFunction,
} from "./context-aggregator";
import { renderTaggedContext } from "../prompt";
import {
  blockPathTool,
  buildBlockInstanceId,
  extendBlockPath,
  ROOT_BLOCK_PATH
} from "./internal/block-instance-id";

import { getEmitterItemCount, toError, withTimeout } from "./internal/utils";
import { emitToolOutputAround } from "./internal/emit-tool-output";
import {
  buildCacheKey,
  getInFlightMap,
  isFresh,
  normalizeCacheable,
  resolveCacheSourceTask,
  resolveToolCacheStore,
  writeToolObservation,
  type ToolCacheStore,
} from "./internal/cache-tool-call";
import { isTraceObservabilityEnabled } from "../utils/trace-observability";

const DEFAULT_MAX_ITERATIONS = 8;
const DEFAULT_REPAIR_ATTEMPTS = 1;

// ---------------------------------------------------------------------------
// Dynamic capability helpers — resolve context/tools from runtime-resolved caps
// ---------------------------------------------------------------------------

interface DynamicCapSurface {
  contextEntries: Array<unknown>;
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
  const contextEntries: Array<unknown> = [];
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

/** Single prompt entry: a static string, a resolver function, or null/undefined (filtered out). */
type PromptSlotEntry<TInput, TCtx = BlockContext> =
  | string
  | null
  | undefined
  | ((input: TInput, ctx: TCtx) => MaybePromise<string | null | undefined>);

/**
 * Prompt slot — accepts a single entry or an array. Array entries are resolved
 * individually (functions called with input+ctx), nulls filtered, then joined
 * with newlines. This lets patterns compose prompts declaratively:
 *
 * ```ts
 * prompt: [instructions, basePrompt]
 * ```
 */
export type PromptSlot<TInput = unknown, TCtx = BlockContext> =
  | PromptSlotEntry<TInput, TCtx>
  | PromptSlotEntry<TInput, TCtx>[];
export type ResolvableModel<TInput, TCtx = BlockContext> =
  | string
  | string[]
  | GeneratorModel
  | ((
      input: TInput,
      ctx: TCtx
    ) => MaybePromise<string | string[] | GeneratorModel | ModelSelection>);
export type ResolvableProviderOptions<TInput, TCtx = BlockContext> =
  | Record<string, unknown>
  | ((input: TInput, ctx: TCtx) => MaybePromise<Record<string, unknown> | undefined>);
export type ResolvableCachingConfig<TInput, TCtx = BlockContext> =
  | CachingConfig
  | ((input: TInput, ctx: TCtx) => MaybePromise<CachingConfig | undefined>);

export type GeneratorSlotReference<TInput = unknown, TCtx = BlockContext> = (
  input: TInput,
  ctx: TCtx
) => unknown | Promise<unknown>;

/**
 * Object-form context: keys become XML tag names. Values may be strings,
 * nested `ContextObject`s (recursive), functions resolved at render time,
 * heterogeneous arrays of those (strings, functions, nested objects mixed),
 * or `null`/`undefined` placeholders that reserve insertion order but emit
 * nothing if no contributor fills them.
 *
 * Authored keys may be `camelCase`, `snake_case`, or `kebab-case` — all
 * normalize to kebab-case before aggregation, so contributions to the same
 * key from different sources collapse into a single tag.
 *
 * @example
 * generator({
 *   prompt: "You are a research assistant.",
 *   context: {
 *     documents: [docA, docB],
 *     userPreferences: () => loadPrefs(),
 *     memory: { shortTerm: items, longTerm: () => loadLongTerm() },
 *     skills: [catalogContext, activeContext],
 *   },
 * })
 */
export type ContextObject<TInput = unknown, TCtx = BlockContext> = {
  [tagName: string]:
    | string
    | ContextObject<TInput, TCtx>
    | ContextValueFn<TInput, TCtx>
    | Array<
        | string
        | ContextObject<TInput, TCtx>
        | ContextValueFn<TInput, TCtx>
        | null
        | undefined
      >
    | null
    | undefined;
};

/** Function value within a `ContextObject` — resolved at render time. */
export type ContextValueFn<TInput = unknown, TCtx = BlockContext> = (
  input: TInput,
  ctx: TCtx
) => unknown | Promise<unknown>;

export type GeneratorSlotEntry<TInput = unknown, TCtx = BlockContext> =
  | string
  | ContextObject<TInput, TCtx>
  | Array<ContextObject<TInput, TCtx>>
  | GeneratorSlotReference<TInput, TCtx>;

export type GeneratorSlot<TInput = unknown, TCtx = BlockContext> =
  | GeneratorSlotEntry<TInput, TCtx>
  | GeneratorSlotEntry<TInput, TCtx>[];

/**
 * History slot config with shorthands:
 *
 * - `true` — auto-fetch session history with defaults
 * - `ItemQuery` object — auto-fetch with options (e.g. `{ limit: 8 }`)
 * - `GeneratorSlot` — custom function or static messages (full control)
 */
export type GeneratorHistoryConfig<TInput = unknown, TCtx = BlockContext> =
  | true
  | ItemQuery
  | GeneratorSlot<TInput, TCtx>;

export type GeneratorSlotRefOptions = {
  optional?: boolean;
  missing?: "error" | "empty";
  limit?: MessageLimit;
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
  | ContextObject
  | Array<ContextObject>
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
  TOrgStateSchema extends ZodTypeAny | undefined = undefined,
  TSequencerStateSchema extends ZodTypeAny | undefined = undefined,
  TResourceDefs extends Record<string, DeclaredResourceEntry> | undefined = undefined,
  TTargetSchemas extends Record<string, ZodTypeAny> | undefined = undefined,
  // Capability type inference — declared above the derived state/resource
  // params so their defaults can intersect capability contributions.
  TUses extends readonly UsesEntry[] = readonly [],
  // Derive-once: evaluate z.infer exactly once per provided schema, then
  // intersect with capability-declared shapes (block-own on the LEFT of `&`
  // so its property declaration wins on a valid-object collision).
  TRequestState extends object = InferStateFromSchema<TRequestStateSchema>,
  TSessionState extends object = Prettify<InferStateFromSchema<TSessionStateSchema> & InferCapabilitySessionState<TUses>>,
  TUserState extends object = InferStateFromSchema<TUserStateSchema>,
  TOrgState extends object = InferStateFromSchema<TOrgStateSchema>,
  TSequencerState extends object = Prettify<InferStateFromSchema<TSequencerStateSchema> & InferCapabilitySequencerState<TUses>>,
  TResources extends Record<string, AnyResourceRef> = Prettify<InferBlockResources<undefined, TResourceDefs> & InferCapabilityResources<TUses>>,
  TMergedTargetSchemas extends Record<string, ZodTypeAny> | undefined = MergeTargetSchemas<TTargetSchemas, TUses>,
  TCapabilities extends Record<string, Record<string, (...args: any[]) => any>> = InferCapabilities<TUses>,
  // Single typed context threaded into all callbacks
  TCtx = BlockContext<
    TRequestState, TSessionState, TUserState, TOrgState,
    TResources, TSequencerState, unknown, TMergedTargetSchemas,
    TCapabilities
  >,
> extends Omit<BlockConfig<TInputSchema, TOutputSchema, TInput, TOutput>, "execute"> {
  requestStateSchema?: TRequestStateSchema;
  sessionStateSchema?: TSessionStateSchema;
  userStateSchema?: TUserStateSchema;
  orgStateSchema?: TOrgStateSchema;
  sequencerStateSchema?: TSequencerStateSchema;
  /** Flat resource declaration. See `HandlerConfig.resources` (FIX-435). */
  resources?: TResourceDefs;
  connectInput?: ConnectorFn<unknown, TInput>;
  targetStateSchemas?: TTargetSchemas;
  /** Capabilities to install. Merges resources, state schemas, targets,
   *  and any active preset surfaces into this block's config. */
  uses?: TUses;
  /**
   * Identity of this generator — classifies its auto-emitted items.
   *
   * - `"primary"`: user-facing agent. Items flow to the client and into
   *   conversation history.
   * - `"sub"`: task-executor under a primary agent. Items reach the client
   *   for live observability but are excluded from conversation history —
   *   sub-agents are deaf to prior turns by design.
   * - `"trace"`: observability-only emissions (devtool/replay). Not on the
   *   client stream, not in history.
   * - *unset* (default): **no auto-emission**. Only the generator's typed
   *   `block_trace` output flows to parents via graph edges.
   *
   * There is no position-inferred default — every generator declares its
   * own identity explicitly. Pattern factories set identity on their
   * internal generators.
   */
  agentType?: AgentType;
  /**
   * Stable name of the producing agent. Defaults to the block's `name`
   * when `agentType` is set and `agentName` is omitted. Generators that
   * share an `agentName` collaborate (same logical agent across
   * instances); distinct names stay isolated. Items emitted by the
   * generator are stamped with this name.
   */
  agentName?: string;
  /**
   * Model selection. Optional when a capability in `uses` contributes a
   * model (see `PresetDef.model`); a block-level setting always wins over
   * the capability's. Missing on both is a runtime error at construction.
   */
  model?: ResolvableModel<NoInfer<TInput>, TCtx>;
  prompt: PromptSlot<NoInfer<TInput>, TCtx>;
  context?: GeneratorSlot<NoInfer<TInput>, TCtx>;
  history?: GeneratorHistoryConfig<NoInfer<TInput>, TCtx>;
  /** Typed user slot: accepts a function over TInput, a static string, or other non-function slot entries. */
  user?: TypedUserSlotFn<TInput, TCtx> | GeneratorSlotStatic | Array<GeneratorSlotStatic>;
  tools?: GeneratorTool[] | ((input: NoInfer<TInput>, ctx: TCtx) => MaybePromise<GeneratorTool[]>);
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
  providerOptions?: ResolvableProviderOptions<TInput, TCtx>;
  /**
   * Prompt caching config. Defaults to `{ enabled: true, breakpoints: 'auto',
   * ttl: '5m' }`. In `auto` mode the adapter places a cache breakpoint at
   * the end of the system prefix on Anthropic-flavored providers (Anthropic,
   * OpenRouter) when the cacheable prefix is large enough to activate, and
   * opts the Vercel AI Gateway into automatic marking (`caching: 'auto'`).
   * Other providers (OpenAI, Google, DeepSeek) cache implicitly and are
   * left untouched. Set `{ enabled: false }` to disable, or
   * `{ breakpoints: 'manual' }` to take full control of `cacheControl`
   * placement via user-supplied provider options.
   */
  caching?: ResolvableCachingConfig<TInput, TCtx>;
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

async function resolvePrompt<TInput, TCtx extends BlockContext>(
  value: PromptSlot<TInput, TCtx>,
  input: TInput,
  ctx: TCtx
): Promise<string> {
  if (!Array.isArray(value)) {
    if (value == null) return "";
    return typeof value === "function" ? (await value(input, ctx)) ?? "" : value;
  }
  const parts: string[] = [];
  for (const entry of value) {
    if (entry == null) continue;
    const resolved = typeof entry === "function" ? await entry(input, ctx) : entry;
    if (resolved != null) parts.push(resolved);
  }
  return parts.join("\n");
}

async function resolveValueOrFn<T, TInput, TCtx extends BlockContext>(
  value: T | ((input: TInput, ctx: TCtx) => MaybePromise<T | undefined>) | undefined,
  input: TInput,
  ctx: TCtx
): Promise<T | undefined> {
  if (value === undefined) return undefined;
  return typeof value === "function"
    ? (value as (input: TInput, ctx: TCtx) => MaybePromise<T | undefined>)(input, ctx)
    : value;
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

  // Unwrap structured selection from selectModel into a model value plus
  // optional per-call preferProvider that threads into ctx.resolveModel.
  let modelValue: string | string[] | GeneratorModel;
  let preferProvider: ProviderPreference | undefined;
  if (isModelSelection(resolved)) {
    modelValue = resolved.model;
    preferProvider = resolved.preferProvider;
  } else {
    modelValue = resolved as string | string[] | GeneratorModel;
  }
  const callOptions = preferProvider !== undefined ? { preferProvider } : undefined;

  if (typeof modelValue === "string") {
    return {
      modelId: modelValue,
      model: ctx.resolveModel(modelValue, blockName, callOptions),
    };
  }

  if (Array.isArray(modelValue)) {
    if (modelValue.length === 0) {
      throw new Error(`Generator "${blockName}" model array cannot be empty`);
    }
    const { createFallbackModel } = await import("../models/fallbackModel");
    const { parseModelString } = await import("../models/providerDetection");
    const entries = modelValue.map((modelStr) => {
      const parsed = parseModelString(modelStr);
      return {
        modelId: modelStr,
        providerName: parsed.provider ?? "unknown",
        model: ctx.resolveModel(modelStr, blockName, callOptions),
      };
    });
    const fallback = createFallbackModel({
      groupName: `${blockName}-fallback`,
      models: entries,
      retryPolicy: { maxAttemptsPerModel: 2, baseDelayMs: 1000, maxDelayMs: 10000 },
    });
    return { modelId: modelValue[0], model: fallback };
  }

  if (isGeneratorModel(modelValue)) {
    return {
      modelId: modelValue.modelId,
      model: modelValue,
    };
  }

  throw new Error(
    `Generator "${blockName}" model must resolve to a model id string, string array, or GeneratorModel instance`
  );
}

/**
 * Resolves history shorthand (`true` or `ItemQuery`) into a slot function.
 * Pass-through for function/static slot entries.
 */
function normalizeHistorySlot<TInput, TCtx extends BlockContext>(
  history: GeneratorHistoryConfig<TInput, TCtx> | undefined
): GeneratorSlot<TInput, TCtx> | undefined {
  if (history === undefined) return undefined;
  if (history === true) {
    return ((_input: TInput, ctx: TCtx) =>
      ctx.session.items.history()) as GeneratorSlotReference<TInput, TCtx>;
  }
  if (typeof history !== "function" && !Array.isArray(history) && typeof history === "object") {
    const obj = history as Record<string, unknown>;
    if (!("content" in obj) && !("role" in obj)) {
      const query = history as ItemQuery;
      return ((_input: TInput, ctx: TCtx) =>
        ctx.session.items.history(query)) as GeneratorSlotReference<TInput, TCtx>;
    }
  }
  return history as GeneratorSlot<TInput, TCtx>;
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

/**
 * Build the system-message prefix from a resolved prompt and a list of
 * already-resolved context entries.
 *
 * Aggregates object-form entries under their normalized tag keys, renders
 * the result as a single XML block, and prepends it (with a blank-line
 * separator) to the prompt to form one combined system message. String
 * entries and pre-built `{role, content}` messages are emitted as their
 * own additional system messages, in author order, after the combined one.
 *
 * Returns an empty array when both prompt and context are empty.
 */
async function buildSystemPrefix<TInput, TCtx extends BlockContext>(
  promptStr: string,
  contextValues: unknown[],
  input: TInput,
  ctx: TCtx
): Promise<unknown[]> {
  const aggregated = await aggregateContextEntries(contextValues, input, ctx);
  const xmlBlock = renderTaggedContext(aggregated.tagged, aggregated.taggedOrder);

  const combinedParts: string[] = [];
  if (promptStr.length > 0) combinedParts.push(promptStr);
  if (xmlBlock.length > 0) combinedParts.push(xmlBlock);
  const combinedContent = combinedParts.join("\n\n");

  const messages: unknown[] = [];
  if (combinedContent.length > 0) {
    messages.push({ role: "system", content: combinedContent });
  }
  for (const pt of aggregated.passThrough) {
    messages.push(asSystemMessage(pt));
  }
  return messages;
}

function asUserMessage(value: unknown): unknown {
  if (typeof value === "string") {
    return { role: "user", content: value };
  }

  return value;
}

/**
 * Whether two values represent the same user-role LLM message. Used at
 * message-assembly time to avoid double-emitting the current turn's user
 * input when both `action.userMessage` (via live items in historyValues)
 * and the generator's `user` slot resolve to identical content.
 *
 * Tolerates the two shapes the codebase produces today:
 *   - { role: "user", content: string }      (asUserMessage; itemToLLMMessages on output_text)
 *   - { role: "user", content: Array<...> }  (multipart future-proofing)
 *
 * If either side is not a recognizable user message, returns false (do not
 * dedup). Equality on content uses a stable stringified key so the helper
 * is robust to shape evolution without re-deriving normalization rules
 * across the two production paths (asUserMessage and itemToLLMMessages).
 */
function isEquivalentUserMessage(a: unknown, b: unknown): boolean {
  if (!isUserRoleMessage(a) || !isUserRoleMessage(b)) return false;
  return userMessageContentKey(a) === userMessageContentKey(b);
}

function isUserRoleMessage(value: unknown): value is { role: "user"; content: unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { role?: unknown }).role === "user" &&
    "content" in (value as object)
  );
}

function userMessageContentKey(msg: { content: unknown }): string {
  const c = msg.content;
  if (typeof c === "string") return c;
  try { return JSON.stringify(c); } catch { return String(c); }
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

async function resolveTools<TInput, TCtx extends BlockContext>(
  tools:
    | GeneratorTool[]
    | ((input: TInput, ctx: TCtx) => MaybePromise<GeneratorTool[]>)
    | undefined,
  input: TInput,
  ctx: TCtx
): Promise<GeneratorTool[]> {
  if (tools === undefined) {
    return [];
  }

  const resolved = typeof tools === "function" ? await tools(input, ctx) : tools;
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
  generatorBlockName: string,
  agentType: AgentType | undefined,
  agentName: string | undefined,
): GeneratorModelTool[] {
  const timeoutMs = flowTools?.defaults?.timeoutMs;
  const retry = flowTools?.defaults?.retry;
  // Snapshot the request-scoped status slot when the first tool in a
  // (possibly parallel) round starts; restore when the last one exits.
  // Without this, a finished tool's `activeStatusMessage` lingers as a
  // stale "still running" indicator after the tool itself returns.
  const statusGuard = { active: 0, saved: "" };
  return tools.map((tool) => {
    // Pluck the model-output mapper off the tool's runtime view (set by
    // `BlockDefinition.mapModelOutput`). Forwarded as `toModelOutput` on the
    // resulting tool entry so the AI SDK substitutes the mapper's string for
    // the structured output when materialising next-turn tool-result content.
    // The wrapper's `tool_output` emit path below continues to use the raw
    // structured `output`; the mapper's string is captured on the unified
    // `block_trace` item's `mapModelOutput` field so devtool can render what
    // the LLM saw alongside the structured output.
    const modelOutputMapper = asRuntime(tool)._modelOutputMapper;
    return {
    name: tool.name,
    description: tool.description,
    parameters: normalizeToolSchema(tool.inputSchema) as GeneratorModelTool["parameters"],
    ...(modelOutputMapper !== undefined
      ? {
          toModelOutput: async (output: unknown) =>
            modelOutputMapper(output as never, ctx),
        }
      : {}),
    execute: async (args: unknown, options?: { toolCallId?: string }) => {
      // FIX-610: opt-in tool-result memoization. The cache wrapping
      // composes around the rest of this closure. On a hit we skip the
      // entire scope/retry/timeout machinery and emit a `tool_output`
      // carrying `cached: true`; observers fire with `cached: true` so
      // downstream consumers see the same lifecycle pair. Errors are
      // never cached. Misses fall through to the normal path and write
      // the cache afterward unless `cacheIf` returned false.
      const cacheable = tool.config.cacheable;
      let cacheMiss: { key: string; cfg: BlockCacheableConfig; store: ToolCacheStore } | undefined;
      if (cacheable !== undefined) {
        const cacheResult = await tryServeFromCache(
          tool,
          args,
          ctx,
          flowTools,
          generatorBlockName,
          agentType,
          agentName,
          options?.toolCallId,
        );
        if (cacheResult.kind === "hit") return cacheResult.output;
        if (cacheResult.kind === "in-flight") return cacheResult.promise;
        if (
          cacheResult.kind === "miss" &&
          cacheResult.key !== undefined &&
          cacheResult.cfg !== undefined &&
          cacheResult.store !== undefined
        ) {
          cacheMiss = {
            key: cacheResult.key,
            cfg: cacheResult.cfg,
            store: cacheResult.store,
          };
        }
      }

      // FIX-573 Path A: when invoked through the model loop with a
      // `toolCallId`, emit a `tool_output` placeholder around the called
      // block's run. The called block's own `block_trace.output` is set to a
      // ref pointing at the tool_output (via `_blockOutputHint`) so the tool
      // result is stored once and surfaced in two places.
      const callTool = async (scopedCtx: BlockContext): Promise<unknown> => {
        if (statusGuard.active === 0) {
          statusGuard.saved = scopedCtx._peekStatus?.() ?? "";
        }
        statusGuard.active++;
        // Surface the tool's run in the status slot so the in-flight indicator
        // reflects "what's happening now". Routing through emit.status (rather
        // than emitting a raw status item) updates the slot, which is what
        // makes the restore in `finally` actually publish a clearing item
        // instead of being deduped against an unchanged slot.
        scopedCtx.emit.status(`Using ${tool.name}…`);
        // FSDEV_DEBUG_TOOLS=1 prints per-tool start/end with timing. Used
        // to localize tool-dispatch hangs (e.g. when a tool_output envelope
        // emits but the handler never completes). Off by default.
        const debugTools = typeof process !== "undefined" && process.env?.FSDEV_DEBUG_TOOLS === "1";
        const toolStartedAt = debugTools ? Date.now() : 0;
        if (debugTools) {
          // eslint-disable-next-line no-console
          console.error(`[fsd-tool] start ${tool.name} callId=${options?.toolCallId ?? "-"}`);
        }
        try {
          await runToolObserver(flowTools?.onToolStarted, { toolName: tool.name, input: args }, scopedCtx);
          const output = await runWithRetry(
            () => withTimeout(Promise.resolve(asRuntime(tool).run(args, scopedCtx)), timeoutMs, `tool:${tool.name}`),
            retry
          );
          await runToolObserver(flowTools?.onToolCompleted, { toolName: tool.name, input: args, output }, scopedCtx);
          if (debugTools) {
            // eslint-disable-next-line no-console
            console.error(`[fsd-tool] done  ${tool.name} callId=${options?.toolCallId ?? "-"} dur=${Date.now() - toolStartedAt}ms`);
          }
          return output;
        } catch (err) {
          if (debugTools) {
            const msg = err instanceof Error ? err.message : String(err);
            // eslint-disable-next-line no-console
            console.error(`[fsd-tool] fail  ${tool.name} callId=${options?.toolCallId ?? "-"} dur=${Date.now() - toolStartedAt}ms err=${msg}`);
          }
          throw err;
        } finally {
          statusGuard.active--;
          if (statusGuard.active === 0) {
            scopedCtx.emit.status(statusGuard.saved);
          }
        }
      };

      // `_withExecutionScope` is the durable-runtime hook that disambiguates
      // tool invocations across resumes by deriving a deterministic path.
      // `toolCallId` is the stable disambiguator; "0" is fine when absent
      // because that path also skips the envelope.
      const withScope = (run: (scopedCtx: BlockContext) => Promise<unknown>): Promise<unknown> => {
        if (ctx._withExecutionScope === undefined) return run(ctx);
        const parentPath = ctx._blockIdentity?.blockPath ?? ROOT_BLOCK_PATH;
        const toolPath = extendBlockPath(parentPath, blockPathTool(tool.name, options?.toolCallId ?? "0"));
        const instanceId = buildBlockInstanceId(ctx.request.identity.id, toolPath, 0);
        return ctx._withExecutionScope(
          { name: tool.name, kind: tool.kind, instanceId, path: toolPath, input: args },
          run
        );
      };

      // Wrap with `onToolErrored` so the observer fires BEFORE the
      // `tool_output` envelope settles to failed and emits `item.done`.
      // Consumers that listen for `item.done` and expect the observer's
      // side-effects (memo writes, additional emitted items) to already
      // have run rely on this ordering. The outer envelope-emit path
      // catches whatever this rethrows and only then emits item.done.
      const callToolWithErrorObserver = async (scopedCtx: BlockContext): Promise<unknown> => {
        try {
          return await callTool(scopedCtx);
        } catch (error) {
          const err = toError(error);
          await runToolObserver(flowTools?.onToolErrored, { toolName: tool.name, input: args, error: err }, scopedCtx);
          throw err;
        }
      };

      // Wrap the chosen execute path in cache + observation bookkeeping.
      // - Single-flight: when this is a cacheable miss, register the
      //   executing promise on the in-flight map so concurrent identical
      //   calls in the same request join this one execution instead of
      //   each kicking off their own.
      // - Observation: write a ledger entry on both success and error so
      //   flow policies can see every tool call, including failures.
      // - Cache write: only on success, gated by `cacheIf`.
      const runAndRecord = async (runOnce: () => Promise<unknown>): Promise<unknown> => {
        const inFlightMap = cacheMiss !== undefined ? getInFlightMap(ctx) : undefined;
        const execute = runOnce();
        if (inFlightMap !== undefined && cacheMiss !== undefined) {
          inFlightMap.set(cacheMiss.key, execute);
        }
        try {
          const output = await execute;
          if (cacheMiss !== undefined) {
            maybeWriteCache(tool, args, output, ctx, cacheMiss);
          }
          writeToolObservation(ctx, {
            toolName: tool.name,
            args,
            result: output,
            cached: false,
          });
          return output;
        } catch (err) {
          // Errors are never cached. Record the failure as an
          // observation so flow policies can surface it on a retry's
          // priorWork. The original throw still propagates.
          writeToolObservation(ctx, {
            toolName: tool.name,
            args,
            error: err instanceof Error ? err.message : String(err),
            cached: false,
          });
          throw err;
        } finally {
          if (inFlightMap !== undefined && cacheMiss !== undefined) {
            inFlightMap.delete(cacheMiss.key);
          }
        }
      };

      // No `toolCallId` → no stable envelope callId; run the tool directly
      // with retry + observer hooks (matches prior behavior).
      if (options?.toolCallId === undefined) {
        return await runAndRecord(() => withScope(callToolWithErrorObserver));
      }
      const attribution = {
        callId: options.toolCallId,
        generatorBlock: generatorBlockName,
        agentType,
        agentName,
        // Read the current generator identity off ctx so a multi-turn tool
        // loop sees the identity that was active when the model invoked the
        // tool. The generator block writes `_currentModelIdentity` on every
        // chunk that carries a resolvedIdentity.
        model: (ctx as { _currentModelIdentity?: ModelIdentity })._currentModelIdentity,
      };
      return await runAndRecord(() =>
        emitToolOutputAround(tool, ctx, args, attribution, (_outerCtx, toolOutputId) =>
          withScope((scopedCtx) => {
            (scopedCtx as { _blockOutputHint?: { kind: "ref"; sourceItemId: string } })
              ._blockOutputHint = { kind: "ref", sourceItemId: toolOutputId };
            return callToolWithErrorObserver(scopedCtx);
          })
        )
      );
    }
    };
  });
}

/**
 * Cache-lookup helper for `compileToolsWithExecute`. Returns:
 *  - `{ kind: "hit", output }` when the call was served from the cache
 *    (observers fired, `tool_output` item emitted if a `toolCallId` is
 *    present, observation hook called).
 *  - `{ kind: "in-flight", promise }` when an identical call is already
 *    running in this request; the caller awaits the shared promise.
 *  - `{ kind: "miss" }` when the call should fall through to the normal
 *    execute path. The miss path registers an in-flight entry so
 *    siblings can join it.
 *
 * Cache attribution (`sourceTask`) flows through via the Task Board
 * `_resolveCacheSourceTask` hook installed by board wiring. When no
 * cache store is installed, returns `miss` immediately — caching is
 * a no-op for non-board generators.
 */
async function tryServeFromCache(
  tool: GeneratorTool,
  args: unknown,
  ctx: BlockContext,
  flowTools: ToolsConfig | undefined,
  generatorBlockName: string,
  agentType: AgentType | undefined,
  agentName: string | undefined,
  toolCallId: string | undefined,
): Promise<
  | { kind: "hit"; output: unknown }
  | { kind: "in-flight"; promise: Promise<unknown> }
  | { kind: "miss"; key?: string; cfg?: BlockCacheableConfig; store?: ToolCacheStore }
> {
  const cacheable = tool.config.cacheable;
  if (cacheable === undefined) return { kind: "miss" };
  const store = resolveToolCacheStore(ctx);
  if (store === undefined) return { kind: "miss" };

  const cfg = normalizeCacheable(cacheable);
  let key: string;
  try {
    key = buildCacheKey(tool.name, args, ctx, cfg, store);
  } catch (err) {
    // Canonicalize failure → fall back to executing the call (no
    // caching). The thrown message names the offending tool.
    // eslint-disable-next-line no-console
    console.warn((err as Error).message);
    return { kind: "miss" };
  }

  const inFlightMap = getInFlightMap(ctx);
  const inFlight = inFlightMap.get(key);
  if (inFlight !== undefined) return { kind: "in-flight", promise: inFlight };

  const entry = store.get(key);
  if (entry !== undefined && isFresh(entry, cfg, store)) {
    const ageMs = Date.now() - entry.storedAt;
    await runToolObserver(
      flowTools?.onToolStarted,
      { toolName: tool.name, input: args, cached: true },
      ctx,
    );
    await runToolObserver(
      flowTools?.onToolCompleted,
      { toolName: tool.name, input: args, output: entry.output, cached: true },
      ctx,
    );

    if (toolCallId !== undefined) {
      const attribution = {
        callId: toolCallId,
        generatorBlock: generatorBlockName,
        agentType,
        agentName,
        model: (ctx as { _currentModelIdentity?: ModelIdentity })._currentModelIdentity,
        cached: {
          ageMs,
          ...(entry.sourceTask !== undefined ? { sourceTask: entry.sourceTask } : {}),
        },
      };
      await emitToolOutputAround(
        tool,
        ctx,
        args,
        attribution,
        async () => entry.output,
      );
    }

    writeToolObservation(ctx, {
      toolName: tool.name,
      args,
      result: entry.output,
      cached: true,
    });

    return { kind: "hit", output: entry.output };
  }

  // Miss: hand back the key+cfg+store so the caller can register the
  // executing promise in the in-flight map (single-flight) and write
  // through after the call resolves.
  return { kind: "miss", key, cfg, store };
}

/**
 * Post-execute cache write. Invoked from the call site only on the
 * success path — errors are never cached, by contract. Honors
 * `cacheIf` and stamps the active source-task attribution if any
 * board wiring resolved one.
 */
function maybeWriteCache(
  tool: GeneratorTool,
  args: unknown,
  output: unknown,
  ctx: BlockContext,
  miss: { key: string; cfg: BlockCacheableConfig; store: ToolCacheStore },
): void {
  const shouldCache = miss.cfg.cacheIf === undefined ? true : miss.cfg.cacheIf(output, args);
  if (!shouldCache) return;
  const ttl = miss.cfg.ttl ?? miss.store.defaultTtl;
  const sourceTask = resolveCacheSourceTask(ctx);
  miss.store.set(miss.key, {
    output,
    storedAt: Date.now(),
    ...(ttl !== undefined ? { ttl } : {}),
    toolName: tool.name,
    ...(sourceTask !== undefined ? { sourceTask } : {}),
  });
}

/**
 * Build a context string listing available tools by name and description.
 * Returns undefined if no tools have descriptions.
 *
 * Names are sanitized to the same alias the model receives in the tools
 * dict (see `sanitizeToolName`). This keeps the listing the model reads
 * in its prompt consistent with the name it must call — e.g. a framework
 * tool block named `tf.memory/recall` is listed as `tf_memory_recall`.
 */
function buildToolDescriptionContext(tools: GeneratorTool[]): string | undefined {
  const described = tools.filter((t) => t.description);
  if (described.length === 0) {
    return undefined;
  }

  const lines = described.map((t) => `- ${sanitizeToolName(t.name)}: ${t.description}`);
  return `<tools>\n${lines.join("\n")}</tools>`;
}

function isBlockObserver(
  observer: ToolsConfig["onToolStarted"]
): observer is BlockDefinition<any, any> {
  // Block observers carry the substrate `run` dispatch entry point installed
  // by `buildBlock`; plain function observers don't. Discriminate on that.
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
    await asRuntime(observer as BlockDefinition<any, any>).run(event, ctx);
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

function parseOutputWithSchema<TOutput>(
  schema: ZodTypeAny,
  candidate: unknown,
  blockName: string,
  phase: "final" | "stream" = "final"
): { success: true; output: TOutput } | {
  success: false;
  error: OutputValidationError;
} {
  const parsed = schema.safeParse(candidate);
  if (parsed.success) {
    return { success: true, output: parsed.data as TOutput };
  }

  const issue = parsed.error.issues[0];
  const issuePath = issue?.path?.join(".") ?? "";
  const issueMessage = issue?.message ?? "schema validation failed";
  const suffix = issuePath.length > 0 ? ` at "${issuePath}"` : "";
  const rawOutput =
    typeof candidate === "string" ? candidate : JSON.stringify(candidate, null, 2);
  const error = new OutputValidationError(
    `Generator "${blockName}" output validation failed${suffix}: ${issueMessage}`,
    { rawOutput, issues: parsed.error.issues, phase },
    parsed.error
  );
  return { success: false, error };
}

/** Cap dumped candidates so a runaway model output doesn't flood logs. */
const UNPARSEABLE_CANDIDATE_MAX_CHARS = 2000;

/**
 * Log the candidate that failed final schema validation so operators can
 * inspect what the model actually returned. Truncates at
 * `UNPARSEABLE_CANDIDATE_MAX_CHARS` to keep stderr legible — full payloads
 * can still be recovered from the request's block_trace item.
 */
function logUnparseableCandidate(
  blockName: string,
  candidate: unknown,
  error: Error,
  source: 'generate' | 'stream'
): void {
  let dump: string;
  if (typeof candidate === 'string') {
    dump = candidate;
  } else {
    try {
      dump = JSON.stringify(candidate);
    } catch {
      dump = String(candidate);
    }
  }
  if (dump.length > UNPARSEABLE_CANDIDATE_MAX_CHARS) {
    dump = `${dump.slice(0, UNPARSEABLE_CANDIDATE_MAX_CHARS)}… [truncated, total ${dump.length} chars]`;
  }
  console.warn(
    `[generator:${source}] "${blockName}" output failed schema validation: ${error.message}\n` +
    `[generator:${source}] candidate (${typeof candidate === 'string' ? 'string' : 'non-string'}): ${dump}`,
  );
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
  ctx: BlockContext,
  blockName: string
): Promise<TOutput> {
  const mode = config.repair?.mode ?? "auto";
  const maxAttempts = Math.max(0, config.repair?.maxAttempts ?? DEFAULT_REPAIR_ATTEMPTS);

  let currentCandidate = candidate;
  let currentAttempt = 0;

  while (true) {
    const parsed = parseOutputWithSchema<TOutput>(outputSchema, currentCandidate, blockName, "final");
    if (parsed.success) {
      return parsed.output;
    }

    if (mode === "fail" || mode === "rescue") {
      logUnparseableCandidate(blockName, currentCandidate, parsed.error, 'generate');
      throw parsed.error;
    }

    if (currentAttempt >= maxAttempts) {
      logUnparseableCandidate(blockName, currentCandidate, parsed.error, 'generate');
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
 * item stream. Used by both streaming and non-streaming paths. Visibility
 * is derived at consumption time by `resolveItemVisibility()` from the
 * structural default for `source`; this function only stamps identity.
 */
function buildSourceItem(
  source: GeneratorModelSource,
  ctx: BlockContext,
  provenance: { blockName: string; blockInstanceId: string; phase: "main" | "work" },
  agentType: AgentType | undefined,
  agentName: string | undefined,
  model: ModelIdentity | undefined
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
    agentType,
    agentName,
    sourceType: "url" as const,
    sourceId: source.id,
    url: source.url,
    title: source.title,
    providerMetadata: source.providerMetadata,
    model
  };
}

/**
 * Executes a streaming text generation: emits item.added, content.added,
 * content.delta per chunk, content.done, and item.done events.
 *
 * Supports multi-step tool loops — the AI SDK drives tool execution via
 * `execute` closures on compiled tools, and this function streams all text
 * deltas to the client as they arrive.
 *
 * When `agentType` is undefined, the generator produces no auto-emitted
 * items: the model still streams (so tool `execute` closures fire and
 * schema validation runs), but reasoning, messages, tool-call progress,
 * and source items are all suppressed.
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
  agentType: AgentType | undefined,
  agentName: string | undefined,
  prepareStep?: PrepareStepFn,
  resolvedProviderOpts?: Record<string, unknown>,
  resolvedCaching?: CachingConfig
): Promise<TOutput> {
  const emit = agentType !== undefined;
  const itemId = `item_msg_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const contentPartIndex = 0;
  const identity = ctx._blockIdentity;
  const provenance = {
    blockName: identity?.blockName ?? blockName,
    blockInstanceId: identity?.blockInstanceId ?? blockName,
    parentBlockInstanceId: identity?.parentBlockInstanceId,
    phase: identity?.phase ?? ("main" as const)
  };
  const ownedBy = identity?.ownedBy;
  let reasoningAccumulated = "";
  // Resolved model identity stamped on each emitted item and propagated to
  // BlockTraceItem.model via onGeneratorModelResult. Initialized from the
  // first chunk that carries it; refined on the `finish` chunk. The pre-
  // chunk seed lets a tool called on the very first AI SDK turn still stamp
  // an identity on its `tool_output` item.
  let resolvedIdentity: ModelIdentity | undefined = { actual: model.modelId };
  (ctx as { _currentModelIdentity?: ModelIdentity })._currentModelIdentity = resolvedIdentity;

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
    caching: resolvedCaching,
    prepareStep
  })) {
    if (chunk.resolvedIdentity !== undefined) {
      resolvedIdentity = chunk.resolvedIdentity;
      (ctx as { _currentModelIdentity?: ModelIdentity })._currentModelIdentity = resolvedIdentity;
    }
    if (chunk.type === "reasoning_delta" && chunk.reasoningDelta !== undefined) {
      if (emit) {
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
            agentType,
            agentName,
            model: resolvedIdentity,
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
        reasoningAccumulated += chunk.reasoningDelta;
        await ctx.response.emit({
          type: "content.delta",
          itemId: reasoningItemId,
          contentIndex: reasoningContentIndex,
          delta: chunk.reasoningDelta
        });
      }
    } else if (chunk.type === "text_delta" && chunk.textDelta !== undefined) {
      if (!messageEmitted) {
        if (emit && reasoningStarted) {
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
            agentType,
            agentName,
            model: resolvedIdentity,
            summary: [{ type: "reasoning_text" as const, text: reasoningAccumulated }]
          };
          await ctx.response.emit({ type: "item.done", item: completedReasoning });
        }

        if (emit) {
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
            agentType,
            agentName,
            model: resolvedIdentity,
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
      if (emit) {
        await ctx.response.emit({
          type: "content.delta",
          itemId,
          contentIndex: contentPartIndex,
          delta: chunk.textDelta
        });
      }
    } else if (chunk.type === "tool_call_delta" && chunk.toolCallDelta !== undefined) {
      if (emit) {
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
          agentType,
          agentName,
          model: resolvedIdentity,
          toolCallId: delta.toolCallId,
          toolName: delta.toolName,
          argsDelta: delta.argsDelta
        };
        await ctx.response.emit({ type: "item.added", item: toolCallItem });
        await ctx.response.emit({ type: "item.done", item: toolCallItem });
      }
    } else if (chunk.type === "tool_result" && chunk.toolResult !== undefined) {
      if (emit) {
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
          agentType,
          agentName,
          model: resolvedIdentity,
          toolCallId: tr.toolCallId,
          toolName: tr.toolName,
          result: tr.result
        };
        await ctx.response.emit({ type: "item.added", item: toolResultItem });
        await ctx.response.emit({ type: "item.done", item: toolResultItem });
      }
    } else if (chunk.type === "source_url" && chunk.source !== undefined) {
      if (emit) {
        const sourceItem = buildSourceItem(chunk.source, ctx, provenance, agentType, agentName, resolvedIdentity);
        await ctx.response.emit({ type: "item.added", item: sourceItem });
        await ctx.response.emit({ type: "item.done", item: sourceItem });
      }
    } else if (chunk.type === "finish") {
      finalResult = chunk.fullResult;
      if (finalResult?.resolvedIdentity !== undefined) {
        resolvedIdentity = finalResult.resolvedIdentity;
      }
    }
  }

  // If no text deltas arrived, still finalize reasoning and emit a message
  // envelope so downstream consumers see a completed assistant turn.
  if (!messageEmitted) {
    if (emit && reasoningStarted) {
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
        agentType,
        agentName,
        model: resolvedIdentity,
        summary: [{ type: "reasoning_text" as const, text: reasoningAccumulated }]
      };
      await ctx.response.emit({ type: "item.done", item: completedReasoning });
    }
    if (emit) {
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
        agentType,
        agentName,
        model: resolvedIdentity,
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
  const parsed = parseOutputWithSchema<unknown>(outputSchema, accumulated, blockName, "stream");
  if (!parsed.success) {
    logUnparseableCandidate(blockName, accumulated, parsed.error, 'stream');
    throw parsed.error;
  }

  // Emit content.done and completed item (only when identity is declared).
  if (emit && messageItem) {
    await ctx.response.emit({
      type: "content.done",
      itemId,
      contentIndex: contentPartIndex,
      content: { type: "output_text", text: accumulated }
    });
    const completedItem = {
      ...messageItem,
      status: "completed" as const,
      model: resolvedIdentity,
      content: [{ type: "output_text" as const, text: accumulated }]
    };
    await ctx.response.emit({ type: "item.done", item: completedItem });
  }

  // FIX-480 §3.2: when this generator's logical output IS the streamed
  // text, emit a `block_trace.output { kind: "ref", sourceItemId: <messageId> }`
  // instead of inlining the same string. The `parsed.output === accumulated`
  // check guards against post-validation transforms (e.g.
  // `z.string().transform(s => s.trim())`) where the returned value
  // diverges from what was streamed; in that case we fall back to inline.
  // Skip empty strings — a ref to an empty message resolves to "" too,
  // but inline is cheaper and avoids a dangling-looking pointer.
  if (
    emit &&
    messageItem !== null &&
    isTextOutputSchema(outputSchema) &&
    typeof parsed.output === "string" &&
    parsed.output.length > 0 &&
    parsed.output === accumulated
  ) {
    ctx._blockOutputHint = { kind: "ref", sourceItemId: itemId };
  }

  ctx._runtimeHooks?.onGeneratorModelResult?.({
    model: model.modelId,
    usage: finalResult?.usage,
    providerMetadata: finalResult?.providerMetadata,
    identity: resolvedIdentity
  });

  return parsed.output as TOutput;
}

export function generator<
  TInputSchema extends ZodTypeAny = ZodTypeAny,
  TOutputSchema extends ZodTypeAny = ZodTypeAny,
  TInput = z.infer<TInputSchema>,
  TOutput = z.infer<TOutputSchema>,
  TRequestStateSchema extends ZodTypeAny | undefined = undefined,
  TSessionStateSchema extends ZodTypeAny | undefined = undefined,
  TUserStateSchema extends ZodTypeAny | undefined = undefined,
  TOrgStateSchema extends ZodTypeAny | undefined = undefined,
  TSequencerStateSchema extends ZodTypeAny | undefined = undefined,
  TResourceDefs extends Record<string, DeclaredResourceEntry> | undefined = undefined,
  TTargetSchemas extends Record<string, ZodTypeAny> | undefined = undefined,
  TUses extends readonly UsesEntry[] = readonly [],
  TRequestState extends object = InferStateFromSchema<TRequestStateSchema>,
  TSessionState extends object = Prettify<InferStateFromSchema<TSessionStateSchema> & InferCapabilitySessionState<TUses>>,
  TUserState extends object = InferStateFromSchema<TUserStateSchema>,
  TOrgState extends object = InferStateFromSchema<TOrgStateSchema>,
  TSequencerState extends object = Prettify<InferStateFromSchema<TSequencerStateSchema> & InferCapabilitySequencerState<TUses>>,
  TResources extends Record<string, AnyResourceRef> = Prettify<InferBlockResources<undefined, TResourceDefs> & InferCapabilityResources<TUses>>,
  TMergedTargetSchemas extends Record<string, ZodTypeAny> | undefined = MergeTargetSchemas<TTargetSchemas, TUses>,
  TCapabilities extends Record<string, Record<string, (...args: any[]) => any>> = InferCapabilities<TUses>,
  TCtx = BlockContext<
    TRequestState, TSessionState, TUserState, TOrgState,
    TResources, TSequencerState, unknown, TMergedTargetSchemas,
    TCapabilities
  >,
>(
  config: GeneratorConfig<
    TInputSchema, TOutputSchema, TInput, TOutput,
    TRequestStateSchema, TSessionStateSchema, TUserStateSchema, TOrgStateSchema, TSequencerStateSchema,
    TResourceDefs, TTargetSchemas, TUses,
    TRequestState, TSessionState, TUserState, TOrgState, TSequencerState,
    TResources, TMergedTargetSchemas, TCapabilities, TCtx
  >
): BlockDefinition<TInputSchema, TOutputSchema, TInput, TOutput> {
  const { declaredResources, resolvedCapabilities, mergedSurface, dynamicUses } = resolveCapabilities(config, "generator");
  const blockAgentType = config.agentType;

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

  // -- Singletons (model, providerOptions, caching): block-level wins over
  // capability; among capabilities, last-wins (handled in mergeSurfaceInto).
  if (normalizedConfig.model === undefined && mergedSurface?.model !== undefined) {
    (normalizedConfig as { model?: unknown }).model = mergedSurface.model;
  }
  if (normalizedConfig.model === undefined) {
    throw new Error(
      `Generator "${String(normalizedConfig.name)}" requires a model. ` +
      `Set one on the block or via a capability that contributes \`model\`.`,
    );
  }
  if (normalizedConfig.providerOptions === undefined && mergedSurface?.providerOptions !== undefined) {
    (normalizedConfig as { providerOptions?: unknown }).providerOptions = mergedSurface.providerOptions;
  }
  if (normalizedConfig.caching === undefined && mergedSurface?.caching !== undefined) {
    (normalizedConfig as { caching?: unknown }).caching = mergedSurface.caching;
  }

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
    // Uses resolveDynamicCapSurface for a single-pass traversal. Returns an
    // array of resolved values (strings + object-form entries) so the
    // aggregator can fold object contributions into shared XML tags rather
    // than collapsing them to flat strings.
    if (hasDynamic) {
      additions.push(async (input: unknown, ctx: BlockContext) => {
        const resolved: unknown[] = [];
        for (const resolver of dynamicUses) {
          for (const cap of resolver(ctx)) {
            if (!capabilityMatchesAgent(cap, blockAgentType)) continue;
            const surface = await resolveDynamicCapSurface(cap, ctx);
            for (const entry of surface.contextEntries) {
              const v = typeof entry === "function"
                ? await (entry as (i: unknown, c: BlockContext) => unknown)(input, ctx)
                : entry;
              if (v != null && v !== "") resolved.push(v);
            }
          }
        }
        return resolved.length > 0 ? resolved : null;
      });
    }

    (normalizedConfig as any).context = [...userArr, ...additions];
  }

  // -- Tools: single async resolver combining user tools + static caps + dynamic caps
  if (hasStaticTools || hasDynamic) {
    const userTools = normalizedConfig.tools;

    (normalizedConfig as any).tools = async (input: unknown, ctx: BlockContext) => {
      // 1. User-declared tools (static array or function of input+ctx)
      const base: GeneratorTool[] = userTools
        ? Array.isArray(userTools) ? userTools : await (userTools as any)(input, ctx)
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
            if (!capabilityMatchesAgent(cap, blockAgentType)) continue;
            const surface = await resolveDynamicCapSurface(cap, ctx);
            dynTools.push(...surface.tools);
          }
        }
      }

      return [...base, ...staticTools, ...dynTools];
    };
  }

  const definition = buildBlock<TInputSchema, TOutputSchema, TInput, TOutput>({
    kind: "generator",
    config: normalizedConfig as unknown as BlockConfig<TInputSchema, TOutputSchema, TInput, TOutput>,
    declaredResources,
    resolvedCapabilities,
    execute: async (input: TInput, ctx) => {
      const blockName = String(normalizedConfig.name);
      // model is guaranteed non-undefined at this point — the construction-
      // time check above throws if neither the block nor any capability
      // contributed a model.
      const { modelId, model } = await resolveModel(
        normalizedConfig.model as ResolvableModel<TInput, BlockContext>,
        input,
        ctx,
        blockName
      );

      const resolvedProviderOpts = await resolveValueOrFn<Record<string, unknown>, TInput, BlockContext>(
        normalizedConfig.providerOptions,
        input,
        ctx
      );

      const resolvedCaching = await resolveValueOrFn<CachingConfig, TInput, BlockContext>(
        normalizedConfig.caching,
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
      const toolBlocks = await resolveTools(normalizedConfig.tools, input, ctx);

      const prompt = await resolvePrompt(normalizedConfig.prompt, input, ctx);
      const contextValues = await resolveSlotValues(normalizedConfig.context, input, ctx);

      // Auto-describe: inject tool name+description pairs into context.
      if (autoDescribe) {
        const toolDescription = buildToolDescriptionContext(toolBlocks);
        if (toolDescription !== undefined) {
          contextValues.push(toolDescription);
        }
      }

      const historySlot = normalizeHistorySlot(normalizedConfig.history);
      const historyValues = await resolveSlotValues(historySlot, input, ctx);
      const userValues = await resolveSlotValues(normalizedConfig.user as GeneratorSlot | undefined, input, ctx);

      // Build initial system prefix (prompt + context + tool descriptions)
      // separately so prepareStep can replace it with freshly resolved values.
      // Object-form context entries are aggregated under shared XML tag keys
      // and rendered into a single combined system message alongside the
      // prompt; string entries follow as their own messages.
      const systemPrefix: unknown[] = await buildSystemPrefix(
        prompt,
        contextValues,
        input,
        ctx
      );
      const systemPrefixCount = systemPrefix.length;
      // FIX-662: when action.userMessage emits a runtime user item, it lands
      // in live items and flows through historyValues. If the generator's
      // `user` slot resolves to equivalent content, drop the leading
      // userValues entry so the model does not see the user's turn twice.
      // Anthropic silently merges adjacent same-role messages, which is the
      // visible symptom this guards against. The drop is on userValues (not
      // historyValues) because historyValues is the retry/resume contract
      // surface and live items must remain visible to retried turns.
      const userMessages = userValues.map(asUserMessage);
      const dropLeadingUserDuplicate =
        userMessages.length > 0 &&
        historyValues.length > 0 &&
        isEquivalentUserMessage(historyValues[historyValues.length - 1], userMessages[0]);
      const messages: unknown[] = [
        ...systemPrefix,
        ...historyValues,
        ...(dropLeadingUserDuplicate ? userMessages.slice(1) : userMessages)
      ];

      // Build prepareStep callback when prompt, context, or tools contain
      // dynamic (function-typed) entries. The AI SDK calls this before each
      // step of the multi-step tool loop, letting us re-resolve dynamic
      // slots so the LLM sees fresh state and the correct active tools.
      const hasDynamicPrompt = typeof normalizedConfig.prompt === "function"
        || (Array.isArray(normalizedConfig.prompt) && normalizedConfig.prompt.some((e) => typeof e === "function"));
      const hasDynamicContext = normalizeSlotEntries(normalizedConfig.context).some(
        (entry) => typeof entry === "function" || objectFormHasNestedFunction(entry)
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
            const freshTools = await resolveTools(normalizedConfig.tools, input, ctx);
            activeTools = freshTools.map((t) => t.name);
            if (autoDescribe) {
              freshToolDescription = buildToolDescriptionContext(freshTools);
            }
          } else if (autoDescribe) {
            freshToolDescription = buildToolDescriptionContext(toolBlocks);
          }

          const freshPrompt = await resolvePrompt(normalizedConfig.prompt, input, ctx);
          const freshContext = await resolveSlotValues(normalizedConfig.context, input, ctx);
          if (freshToolDescription !== undefined) {
            freshContext.push(freshToolDescription);
          }

          const freshSystemPrefix: unknown[] = await buildSystemPrefix(
            freshPrompt,
            freshContext,
            input,
            ctx
          );

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

      // Identity: generators without `agentType` produce no auto-emitted
      // items (only block_trace output via graph edges). When set, `agentName`
      // defaults to the block name so collaborating generators can be
      // given a shared name explicitly.
      // Resolved BEFORE `compileToolsWithExecute` so the tool runner can
      // stamp `agentType`/`agentName` on emitted `tool_output`
      // items — `resolveItemVisibility()` uses those to decide
      // sub-agent visibility (client: true, history: false).
      const agentType = normalizedConfig.agentType;
      const agentName = agentType !== undefined
        ? (normalizedConfig.agentName ?? blockName)
        : undefined;

      // Compile tools: with execute wrappers (AI SDK auto-runs them) or
      // without (model suggests calls but doesn't execute them).
      const compiledTools = toolBlocks.length > 0
        ? (runTools
            ? compileToolsWithExecute(toolBlocks, ctx, normalizedConfig.flowTools, blockName, agentType, agentName)
            : compileToolsForModel(toolBlocks))
        : [];

      // Streaming path: text output + model supports streaming. We stream
      // whenever tools are present (so tool `execute` closures fire) or
      // whenever identity is set (so text deltas flow to the client).
      // Identity-less, tool-less generators fall through to non-streaming
      // and skip message emission entirely.
      const hasTools = compiledTools.length > 0 || resolvedProviderTools.length > 0;
      const canStream = (agentType !== undefined || hasTools) && isTextOutputSchema(outputSchema) && model.stream !== undefined;

      // Emit debug capture for devtool inspection before the LLM call. Use
      // the same combined-system-message assembly the model sees so the
      // devtool view matches the real prompt rather than a flat join.
      // `user` and `history` are captured post-`asUserMessage` wrapping so
      // the devtool sees the exact message shapes sent to the model.
      const debugPrompt = systemPrefix
        .map((m) => (m && typeof m === "object" && "content" in m
          ? String((m as { content: unknown }).content ?? "")
          : ""))
        .filter((s) => s.length > 0)
        .join("\n\n");
      const debugUserMessages = userValues.map(asUserMessage);
      ctx._runtimeHooks?.onBlockTraceCapture?.(
        {
          phase: "generator",
          data: {
            generator: {
              model: modelId,
              prompt: debugPrompt,
              tools: toolBlocks.map((t) => t.name),
              user: debugUserMessages,
              history: historyValues,
            },
          },
        },
        ctx
      );

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
          agentType,
          agentName,
          prepareStepFn,
          resolvedProviderOpts,
          resolvedCaching
        );
      }

      // Prime `_currentModelIdentity` with the requested model id so tools
      // called inside the AI SDK's multi-step loop (before the generate call
      // returns and `resolvedIdentity` is known) still stamp an identity on
      // their `tool_output` items. Refined to the resolved identity below.
      (ctx as { _currentModelIdentity?: ModelIdentity })._currentModelIdentity = {
        actual: model.modelId,
      };
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
        caching: resolvedCaching,
        prepareStep: prepareStepFn
      });

      const candidate = resolveGenerationCandidate(generation);
      const nonStreamingIdentity = generation.resolvedIdentity;
      if (nonStreamingIdentity !== undefined) {
        (ctx as { _currentModelIdentity?: ModelIdentity })._currentModelIdentity = nonStreamingIdentity;
      }
      ctx._runtimeHooks?.onGeneratorModelResult?.({
        model: model.modelId,
        usage: generation.usage,
        providerMetadata: generation.providerMetadata,
        identity: nonStreamingIdentity
      });

      // Emit source items from provider-native tools (e.g., web search).
      // Only when the generator has a declared identity.
      if (agentType !== undefined && generation.sources !== undefined && generation.sources.length > 0) {
        const sourceIdentity = ctx._blockIdentity;
        const sourceProv = {
          blockName: sourceIdentity?.blockName ?? blockName,
          blockInstanceId: sourceIdentity?.blockInstanceId ?? blockName,
          parentBlockInstanceId: sourceIdentity?.parentBlockInstanceId,
          phase: sourceIdentity?.phase ?? ("main" as const)
        };
        for (const source of generation.sources) {
          const sourceItem = buildSourceItem(source, ctx, sourceProv, agentType, agentName, nonStreamingIdentity);
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
        normalizedConfig, outputSchema, candidate, state, ctx, blockName
      );

      // Emit a completed assistant message when the generator has identity
      // and produced text output. Identity-less generators skip emission —
      // their typed `block_trace` output is the only signal to downstream blocks.
      if (agentType !== undefined && isTextOutputSchema(outputSchema) && typeof output === "string") {
        const itemId = `item_msg_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        const outputIdentity = ctx._blockIdentity;
        const provenance = {
          blockName: outputIdentity?.blockName ?? blockName,
          blockInstanceId: outputIdentity?.blockInstanceId ?? blockName,
          parentBlockInstanceId: outputIdentity?.parentBlockInstanceId,
          phase: outputIdentity?.phase ?? ("main" as const)
        };
        const nsOwnedBy = outputIdentity?.ownedBy;
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
          agentType,
          agentName,
          model: nonStreamingIdentity,
          content: [{ type: "output_text" as const, text: output }]
        };
        await ctx.response.emit({ type: "item.added", item: messageItem });
        await ctx.response.emit({ type: "item.done", item: messageItem });

        // FIX-480 §3.2: emit `block_trace.output` as a ref to this message
        // instead of an inline copy of the same text. The message's
        // content equals `output` by construction (built from `output`
        // above), so no defensive equality check is needed here. Skip
        // empty strings to keep block_trace.output inline for the trivial case.
        if (output.length > 0) {
          ctx._blockOutputHint = { kind: "ref", sourceItemId: itemId };
        }
      }

      return output;
    }
  });

  return definition;
}
