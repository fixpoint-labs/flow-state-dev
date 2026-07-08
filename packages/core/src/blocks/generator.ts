import { z, type ZodTypeAny } from "zod";
import { OutputValidationError } from "../errors/output-validation-error";
import { isAbortLike, rootCause } from "../errors/abort";
import { jsonSchema } from "ai";
import { jsonrepair } from "jsonrepair";
import { zodToJsonSchema } from "zod-to-json-schema";
import { getZodTypeName } from "../helpers/zod-introspect";
import { assertStrictCompatible } from "../models/makeSchemaStrict";
import type {
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
import type { ItemVisibility } from "../items/types";
import type { AnyResourceRef } from "../types/resource";
import type { DeclaredResourceEntry } from "../types/block";
import type {
  CachingConfig,
  GeneratorModel,
  GeneratorModelResult,
  GeneratorModelSource,
  GeneratorModelStreamChunk,
  GeneratorModelTool,
  GeneratorModelToolCall,
  GeneratorModelUsage,
  GeneratorSearchConfig,
  GeneratorStepResult,
  ModelIdentity,
  PrepareStepFn,
  ProviderTool
} from "../types/model";
import {
  buildAssistantToolCallMessage,
  buildToolResultMessage,
  toolResultOutputForModel,
  type LLMToolResultOutput,
} from "../models/llm-messages";
import type { ModelSelection } from "../models/selectModel";
import { isModelSelection } from "../models/selectModel";
import type { ProviderPreference } from "../models/types";
import type { ToolsConfig } from "../types/flow";
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
import { sanitizeToolName, computeToolAliases } from "../helpers/tool-name";
import { resolveCapabilities, capabilityMatchesAgent } from "./internal/resolve-capabilities";
import {
  objectFormHasNestedFunction,
} from "./context-aggregator";
import {
  definePromptFile,
  getPromptFileBrand,
  isPromptFile,
  type PromptFile,
  type PromptFileBrand,
} from "../prompt/prompt-file";
import { getEmitterItemCount, toError } from "./internal/utils";
import {
  assembleMessages,
  buildSystemPrefix,
  asUserMessage,
  type PromptFileConfigMeta,
} from "./internal/message-assembly";
import { buildToolExecutor } from "./internal/tool-executor";

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
  /**
   * LLM coercion repair (FIX-841). When the deterministic repair pass can't
   * recover the model's structured output (e.g. it returned the right data
   * under the wrong field names), make one model call that reshapes the raw
   * output to the schema, preserving content. Runs only in `auto` mode and
   * only on the path that would otherwise throw.
   *
   * Default: enabled, using `intent/utility`. Set `false` to disable. Pass
   * `{ model }` to override the coercion model (any `ResolvableModel`, e.g. a
   * concrete model id or a `GeneratorModel` instance).
   */
  coerce?: boolean | { model?: ResolvableModel<unknown, BlockContext> };
}

/** Default model for the LLM coercion repair pass (overridable via `repair.coerce.model`). */
const DEFAULT_COERCION_MODEL = "intent/utility";

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

/** Instructions slot accepted by pattern factories — static string or context-aware function returning a prompt string. */
export type InstructionsSlot<TInput = unknown> =
  | string
  | ((input: TInput, ctx: any) => MaybePromise<string>);

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

/**
 * Runtime metadata passed as the third argument to a generator block's
 * `onCompleted`. Carries framework-resolved data that is not part of the
 * block's output — currently the identity of the model that produced the
 * output. Typed per block kind: only generators receive this shape, so other
 * kinds' `onCompleted` signatures stay free of generator-only fields.
 */
export interface GeneratorCompletedMeta {
  /**
   * Resolved identity of the model that produced this generator's output.
   * Always populated on the success path — the generator seeds `actual`
   * before invoking the model, so `onCompleted` (which fires only after a
   * successful execute) always sees at least `{ actual }`.
   */
  model: ModelIdentity;
}

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
> extends Omit<BlockConfig<TInputSchema, TOutputSchema, TInput, TOutput>, "execute" | "onCompleted"> {
  onCompleted?: (
    output: TOutput,
    ctx: TCtx,
    meta: GeneratorCompletedMeta
  ) => Promise<void> | void;
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
   * Transport and memory visibility stamped on every conversational item
   * this generator auto-emits.
   *
   * - `{ client: true, history: true }` — user-facing agent (primary).
   * - `{ client: true, history: false }` — observable work (sub-agent).
   * - `{ client: false, history: true }` — private/injected context.
   * - `{ client: false, history: false }` — trace (devtool only).
   * - *unset* (default): **no auto-emission**. Only the generator's typed
   *   `block_trace` output flows to parents via graph edges.
   *
   * There is no position-inferred default — every generator declares its
   * own visibility explicitly. Pattern factories set visibility on their
   * internal generators.
   */
  itemVisibility?: ItemVisibility;
  /**
   * Stable name of the producing agent. Defaults to the block's `name`
   * when `itemVisibility` is set and `agentName` is omitted. Generators
   * that share an `agentName` collaborate (same logical agent across
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
  /**
   * Prompt slot. Accepts an inline string, a resolver function, an array of
   * those, a branded PromptFile slot (`pf.prompt`), or a whole
   * {@link PromptFile} (`prompt: loadPromptFile(...)`). Passing the PromptFile
   * directly expands its `user` / `caching` / `maxTokens` / `temperature` /
   * `name` / `description` into this config — any sibling field set explicitly
   * here wins, matching `...definePromptFile(pf), <overrides>`.
   */
  prompt: PromptSlot<NoInfer<TInput>, TCtx> | PromptFile;
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


export type { PromptFileConfigMeta } from "./internal/message-assembly";


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
 * Compile tools WITH execute wrappers. Each tool's `run()` is wrapped
 * via `buildToolExecutor` (cache/retry/status-guard/observer/scope/envelope).
 * The AI SDK auto-executes these during its multi-step loop.
 */
function compileToolsWithExecute(
  tools: GeneratorTool[],
  ctx: BlockContext,
  flowTools: ToolsConfig | undefined,
  generatorBlockName: string,
  itemVisibility: ItemVisibility | undefined,
  agentName: string | undefined,
): GeneratorModelTool[] {
  const statusGuard = { active: 0, saved: "" };
  return tools.map((tool) => {
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
      execute: buildToolExecutor(
        tool,
        { flowTools, generatorBlockName, itemVisibility, agentName, statusGuard },
        ctx,
      ),
    };
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
      // Structural repair (FIX-841): fix malformed-but-right-shape JSON —
      // trailing commas, unclosed braces/strings, code fences, trailing prose.
      // Deterministic, no model call. Falls through to the raw string when even
      // jsonrepair can't produce parseable JSON (e.g. a renamed-key payload,
      // which is left for LLM coercion).
      try {
        return JSON.parse(jsonrepair(candidate));
      } catch {
        return candidate;
      }
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
      // Deterministic repair is exhausted. Last resort (FIX-841): one LLM
      // coercion pass that reshapes the raw output to the schema, preserving
      // content. Recovers semantic mismatches (renamed keys, wrong nesting)
      // that no deterministic step can. Gated on `auto` mode explicitly (not
      // just relying on `fail`/`rescue` having thrown earlier) so a future
      // mode can't silently enable it.
      if (mode === "auto" && config.repair?.coerce !== false) {
        const coerced = await attemptCoercionRepair(
          currentCandidate,
          outputSchema,
          parsed.error,
          config.repair?.coerce,
          state.input,
          ctx,
          blockName
        );
        if (coerced !== undefined) {
          const reparsed = parseOutputWithSchema<TOutput>(outputSchema, coerced, blockName, "final");
          if (reparsed.success) {
            return reparsed.output;
          }
        }
      }
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

/**
 * LLM coercion repair (FIX-841). Asks a model to rewrite a candidate that
 * failed schema validation into one that conforms, preserving the original
 * content. Returns the (deterministically re-parsed) coerced value, or
 * `undefined` when coercion couldn't produce anything usable — in which case
 * the caller throws the original validation error.
 *
 * The model defaults to `intent/utility` (overridable via `repair.coerce.model`)
 * so repair routes through the app's cheap utility tier, independent of the
 * primary model that produced the bad output. The block's `input` is threaded
 * through so an input-driven `coerce.model` resolver sees the same input the
 * primary model did. The call requests plain JSON text (no `outputSchema`) so
 * it can't re-enter the structured-output failure path. Abort-like errors
 * propagate; any other failure is swallowed (best-effort).
 */
async function attemptCoercionRepair(
  candidate: unknown,
  schema: ZodTypeAny,
  error: Error,
  coerce: boolean | { model?: ResolvableModel<unknown, BlockContext> } | undefined,
  input: unknown,
  ctx: BlockContext,
  blockName: string
): Promise<unknown | undefined> {
  try {
    const repairModel: ResolvableModel<unknown, BlockContext> =
      typeof coerce === "object" && coerce.model !== undefined
        ? coerce.model
        : DEFAULT_COERCION_MODEL;
    const { model } = await resolveModel(repairModel, input, ctx, `${blockName}-repair`);

    const targetSchema = JSON.stringify(zodToJsonSchema(schema));
    const raw = typeof candidate === "string" ? candidate : JSON.stringify(candidate);

    const result = await model.generate({
      messages: [
        {
          role: "system",
          content:
            "You are a JSON repair function. The previous output did not match the required JSON schema. " +
            "Rewrite it as a single JSON object that strictly matches the schema, preserving all original " +
            "content and intent. Map renamed fields to the schema's field names. Do not invent data. " +
            "Output only the JSON.",
        },
        {
          role: "user",
          content: `Schema:\n${targetSchema}\n\nValidation error:\n${error.message}\n\nOutput to fix:\n${raw}`,
        },
      ],
      // Propagate cancellation so an aborted parent request stops the repair
      // call instead of burning `intent/utility` tokens to completion.
      signal: ctx.signal,
    });

    // The coercion is a separate model invocation; report its usage to the same
    // hook the primary generation uses so its tokens are visible to billing and
    // observability rather than silently dropped.
    ctx._runtimeHooks?.onGeneratorModelResult?.({
      model: model.modelId,
      usage: result.usage,
      providerMetadata: result.providerMetadata,
      identity: result.resolvedIdentity,
    });

    // The coercion call returns plain text; run it through the deterministic
    // repair (JSON.parse / jsonrepair / unwrap) before the caller re-validates.
    return await attemptDefaultRepair(result.text);
  } catch (err) {
    if (isAbortLike(err)) throw err;
    console.warn(
      `[generator:repair] "${blockName}" coercion repair failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return undefined;
  }
}

function isTextOutputSchema(schema: ZodTypeAny): boolean {
  return getZodTypeName(schema) === "ZodString";
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
  itemVisibility: ItemVisibility | undefined,
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
    taskId: ctx._blockIdentity?.taskId,
    itemVisibility,
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
 * When `itemVisibility` is undefined, the generator produces no auto-emitted
 * items: the model still streams (so tool `execute` closures fire and
 * schema validation runs), but reasoning, messages, tool-call progress,
 * and source items are all suppressed.
 */
/**
 * FIX-663: rewrites a rejected model call into a legible failure. When the
 * error is abort-like and this block's signal aborted (explicit user
 * cancellation propagated to a background `.work()` task, or a foreground
 * `/abort`), surface the unwrapped root-cause text instead of the AI
 * Gateway's doubly-wrapped "Invalid error response format" noise, and log
 * concisely rather than dumping the wrap chain. The error is still thrown so
 * the existing `block_trace` failure surface fires unchanged — only its
 * message gets clearer. Genuine non-abort errors pass through untouched.
 */
function surfaceModelCallError(err: unknown, ctx: BlockContext, blockName: string): never {
  if (isAbortLike(err) && ctx.signal?.aborted) {
    const root = rootCause(err);
    const message = root instanceof Error ? root.message : String(root);
    // eslint-disable-next-line no-console
    console.warn(`[generator] "${blockName}" model call aborted: ${message}`);
    throw new Error(message, { cause: err });
  }
  throw err;
}

// ---------------------------------------------------------------------------
// Framework-owned step loop (FIX-814 PR2)
//
// When the resolved model implements the single-step contract
// (`generateStep` / `streamStep`), the generator drives the multi-step tool
// loop itself: one model call per step, framework tools executed by FSD
// between steps via the same `buildToolExecutor` closures the SDK path
// attaches (cache/retry/emission/scope behavior identical), inter-step
// messages built from the shared `llm-messages` builders. Models without
// the step methods run the legacy SDK-owned multi-step path unchanged —
// that path is the compatibility surface for hand-rolled test mocks, the
// public `mockGenerator`, and third-party adapters.
// ---------------------------------------------------------------------------

/** Per-tool state for the owned loop: model-facing alias, the model tool
 * (no execute — the model must never run framework tools), the framework
 * executor closure, and the optional model-output mapper. */
interface OwnedLoopToolEntry {
  block: GeneratorTool;
  /** Disambiguated model-facing alias (see `computeToolAliases`). */
  alias: string;
  /** Tool as passed to each step call — pre-renamed to `alias`, no execute. */
  modelTool: GeneratorModelTool;
  execute: (args: unknown, options?: { toolCallId?: string }) => Promise<unknown>;
  mapModelOutput?: (output: unknown, ctx: BlockContext) => string | Promise<string>;
}

interface OwnedLoopToolset {
  entries: OwnedLoopToolEntry[];
  byName: Map<string, OwnedLoopToolEntry>;
  byAlias: Map<string, OwnedLoopToolEntry>;
}

/**
 * Compiles the owned loop's toolset. Tools passed to step calls are
 * pre-renamed to their disambiguated alias so the adapter's own alias pass
 * is a no-op and the tool dictionary is stable across steps — bare
 * re-sanitization of inter-step messages would drop `ensureUniqueAlias`
 * suffixes and mis-correlate colliding names.
 */
function compileOwnedLoopToolset(
  tools: GeneratorTool[],
  ctx: BlockContext,
  flowTools: ToolsConfig | undefined,
  generatorBlockName: string,
  itemVisibility: ItemVisibility | undefined,
  agentName: string | undefined,
): OwnedLoopToolset {
  const aliases = computeToolAliases(tools.map((t) => t.name));
  const statusGuard = { active: 0, saved: "" };
  const entries = tools.map((tool): OwnedLoopToolEntry => ({
    block: tool,
    alias: aliases.get(tool.name)!,
    modelTool: {
      name: aliases.get(tool.name)!,
      description: tool.description,
      parameters: normalizeToolSchema(tool.inputSchema) as GeneratorModelTool["parameters"],
    },
    execute: buildToolExecutor(
      tool,
      { flowTools, generatorBlockName, itemVisibility, agentName, statusGuard },
      ctx,
    ),
    mapModelOutput: asRuntime(tool)._modelOutputMapper as
      | ((output: unknown, ctx: BlockContext) => string | Promise<string>)
      | undefined,
  }));
  return {
    entries,
    byName: new Map(entries.map((e) => [e.block.name, e] as const)),
    byAlias: new Map(entries.map((e) => [e.alias, e] as const)),
  };
}

/** Maps a model-reported tool name (usually the alias, since step tools are
 * pre-renamed) back to the framework block name for items and step metadata. */
function frameworkToolName(name: string, toolset: OwnedLoopToolset): string {
  return toolset.byAlias.get(name)?.block.name ?? name;
}

/** Remaps a step result's tool calls to framework names. */
function remapStepToolCalls(
  calls: GeneratorModelToolCall[] | undefined,
  toolset: OwnedLoopToolset
): GeneratorModelToolCall[] | undefined {
  if (calls === undefined) return undefined;
  return calls.map((call) => ({ ...call, toolName: frameworkToolName(call.toolName, toolset) }));
}

/** Sums per-step usage into the run aggregate the legacy SDK-owned path
 * reports (the SDK accumulates usage across internal steps the same way). */
function addGeneratorUsage(
  total: GeneratorModelUsage | undefined,
  step: GeneratorModelUsage | undefined
): GeneratorModelUsage | undefined {
  if (step === undefined) return total;
  if (total === undefined) return { ...step };
  const out: GeneratorModelUsage = {
    promptTokens: total.promptTokens + step.promptTokens,
    completionTokens: total.completionTokens + step.completionTokens,
    totalTokens: total.totalTokens + step.totalTokens,
  };
  if (total.cacheCreationInputTokens !== undefined || step.cacheCreationInputTokens !== undefined) {
    out.cacheCreationInputTokens =
      (total.cacheCreationInputTokens ?? 0) + (step.cacheCreationInputTokens ?? 0);
  }
  if (total.cacheReadInputTokens !== undefined || step.cacheReadInputTokens !== undefined) {
    out.cacheReadInputTokens =
      (total.cacheReadInputTokens ?? 0) + (step.cacheReadInputTokens ?? 0);
  }
  return out;
}

/** One settled framework tool call within a step. `call.toolName` carries the
 * framework block name; `entry` is absent when the model called an unknown tool. */
interface SettledToolCall {
  call: GeneratorModelToolCall;
  entry?: OwnedLoopToolEntry;
  ok: boolean;
  output?: unknown;
  error?: Error;
}

/**
 * Partitions a step's tool calls into the ones FSD must run and the ones it
 * must NOT. Provider-executed calls (web search / other `providerTools`) ran
 * server-side inside the model call — their results are already in the raw
 * response — so FSD skips them; they are also excluded from the
 * loop-continuation decision (a step whose only calls are provider-executed
 * is terminal from FSD's view). A NON-provider-executed call that resolves
 * to no framework tool is a genuine hallucinated unknown tool and stays in
 * `frameworkCalls` so it surfaces the model-visible error.
 */
function partitionStepCalls(
  calls: GeneratorModelToolCall[]
): { frameworkCalls: GeneratorModelToolCall[]; providerCalls: GeneratorModelToolCall[] } {
  const frameworkCalls: GeneratorModelToolCall[] = [];
  const providerCalls: GeneratorModelToolCall[] = [];
  for (const call of calls) {
    if (call.providerExecuted === true) providerCalls.push(call);
    else frameworkCalls.push(call);
  }
  return { frameworkCalls, providerCalls };
}

/**
 * Executes a step's tool calls CONCURRENTLY (matching the SDK's same-step
 * behavior) and settles ALL siblings. Errors — including `SuspensionError` /
 * `SuspensionRejectedError`, which are deliberately NOT special-cased in
 * this behavior-preserving refactor — become model-visible failed results,
 * exactly like the SDK-owned loop produced (the failed `tool_output` item is
 * emitted inside `emitToolOutputAround`). Suspension propagation is wired in
 * a later change.
 */
async function executeOwnedStepToolCalls(
  calls: GeneratorModelToolCall[],
  toolset: OwnedLoopToolset
): Promise<SettledToolCall[]> {
  return Promise.all(
    calls.map(async (call): Promise<SettledToolCall> => {
      const entry = toolset.byName.get(call.toolName) ?? toolset.byAlias.get(call.toolName);
      if (entry === undefined) {
        return {
          call,
          ok: false,
          error: new Error(`Model called unknown tool "${call.toolName}"`),
        };
      }
      try {
        const output = await entry.execute(call.args, { toolCallId: call.toolCallId });
        return { call, entry, ok: true, output };
      } catch (err) {
        return { call, entry, ok: false, error: toError(err) };
      }
    })
  );
}

/**
 * Builds the messages appended after a tool-calling step.
 *
 * Assistant turn — live-fidelity first: when the step result carries RAW
 * `responseMessages` (the AI SDK adapter populates them from the step's
 * `response.messages`), their assistant portion is appended VERBATIM. That
 * preserves reasoning/thinking parts and provider-specific payloads (e.g.
 * Anthropic thinking signatures, which MUST round-trip in the assistant
 * turn of a tool loop) that the normalized step fields cannot carry; the
 * raw messages already use the model-facing aliases since the loop
 * pre-renames its tools. When `responseMessages` is absent (step-capable
 * non-AI-SDK models, mocks), falls back to ONE constructed assistant
 * message carrying ALL of the step's tool-call parts plus the step's text.
 *
 * FRAMEWORK tool results are ALWAYS FSD-constructed — FSD ran those tools,
 * and the raw response contains no results for the execute-less framework
 * tools — one tool-result message per settled framework call in call order,
 * payloads mirroring what the AI SDK feeds the model (`mapModelOutput`
 * applied in memory, errors as `error-text`). PROVIDER-executed tool results
 * (role:"tool" messages the SDK put in the raw response) are carried forward
 * verbatim as part of the raw turn, so the model keeps its search results.
 * Ordering stays provider-valid: assistant turn (all tool-call parts) →
 * provider results (from raw) → framework results (FSD).
 */
async function buildOwnedStepMessages(
  step: { text?: string; responseMessages?: unknown[] } | undefined,
  settled: SettledToolCall[],
  ctx: BlockContext
): Promise<unknown[]> {
  const aliasFor = (s: SettledToolCall): string =>
    s.entry?.alias ?? sanitizeToolName(s.call.toolName);

  // Carry the raw turn forward verbatim (assistant + provider tool-result
  // messages, preserving the SDK's own ordering) when present. This keeps
  // reasoning/thinking parts and provider-executed tool results intact.
  const rawTurn = (step?.responseMessages ?? []).filter((m) => {
    if (typeof m !== "object" || m === null) return false;
    const role = (m as { role?: unknown }).role;
    return role === "assistant" || role === "tool";
  });

  const messages: unknown[] = rawTurn.length > 0
    ? [...rawTurn]
    : [
        buildAssistantToolCallMessage(
          settled.map((s) => ({
            toolCallId: s.call.toolCallId,
            toolName: aliasFor(s),
            input: s.call.args,
          })),
          step?.text
        ),
      ];

  for (const s of settled) {
    let output: LLMToolResultOutput;
    if (!s.ok) {
      output = { type: "error-text", value: s.error?.message ?? "unknown error" };
    } else {
      const mapped = s.entry?.mapModelOutput !== undefined
        ? await s.entry.mapModelOutput(s.output, ctx)
        : undefined;
      output = toolResultOutputForModel(s.output, mapped);
    }
    messages.push(
      buildToolResultMessage(
        { toolCallId: s.call.toolCallId, toolName: aliasFor(s) },
        output
      )
    );
  }

  return messages;
}

/** Throws promptly when the request signal already aborted, so the owned
 * loop stops between steps instead of issuing another model call. */
function throwIfAborted(ctx: BlockContext): void {
  if (ctx.signal?.aborted === true) {
    const reason = (ctx.signal as { reason?: unknown }).reason;
    if (reason instanceof Error) throw reason;
    const err = new Error("This operation was aborted");
    err.name = "AbortError";
    throw err;
  }
}

/** Shared per-step preamble for both owned loops: applies the generator's
 * `prepareStep` result FSD-side (message replacement carries forward,
 * `activeTools` filters the toolset by framework name, `modelId` re-resolves
 * through `ctx.resolveModel` for this step only). */
async function applyOwnedPrepareStep(params: {
  prepareStep: PrepareStepFn | undefined;
  stepNumber: number;
  messages: unknown[];
  steps: GeneratorStepResult[];
  activeToolNames: string[] | undefined;
  model: GeneratorModel;
  /** Which step method the calling loop needs on a `modelId`-override model. */
  requires: "generateStep" | "streamStep";
  ctx: BlockContext;
  blockName: string;
}): Promise<{
  messages: unknown[];
  activeToolNames: string[] | undefined;
  stepModel: GeneratorModel;
}> {
  const { prepareStep, stepNumber, steps, ctx, blockName } = params;
  let { messages, activeToolNames } = params;
  let stepModel = params.model;
  if (prepareStep !== undefined) {
    const prep = await prepareStep({ stepNumber, messages, steps });
    if (prep?.messages !== undefined) {
      // AI SDK 7 carry-forward semantics: a returned override becomes the
      // input of later steps (the loop keeps appending onto it).
      messages = prep.messages as unknown[];
    }
    if (prep?.activeTools !== undefined) {
      activeToolNames = prep.activeTools;
    }
    if (prep?.modelId !== undefined) {
      // Mirrors the AI SDK adapter's prepareStep bridge, which re-resolves a
      // returned modelId for that step only. Requires the resolved model to
      // support this loop's step method; otherwise the override is skipped
      // with a warning. Like the SDK bridge, this re-resolves by id alone —
      // any block-level `preferProvider` call option is intentionally not
      // threaded through a per-step model switch.
      const resolved = ctx.resolveModel(prep.modelId, blockName);
      if (resolved[params.requires] !== undefined) {
        stepModel = resolved;
      } else {
        // eslint-disable-next-line no-console
        console.warn(
          `[generator] "${blockName}" prepareStep modelId "${prep.modelId}" resolved to a model without ${params.requires}; keeping the current model for this step`
        );
      }
    }
  }
  return { messages, activeToolNames, stepModel };
}

/** Filters the toolset by the active framework tool names (when set) and
 * returns the model-facing tool array for a step call. */
function activeStepTools(
  toolset: OwnedLoopToolset,
  activeToolNames: string[] | undefined
): GeneratorModelTool[] | undefined {
  const entries = activeToolNames === undefined
    ? toolset.entries
    : toolset.entries.filter((e) => activeToolNames.includes(e.block.name));
  return entries.length > 0 ? entries.map((e) => e.modelTool) : undefined;
}

/**
 * The framework-owned NON-STREAMING step loop. Behavior-preserving stand-in
 * for the single `model.generate({ maxSteps })` call: drives up to
 * `maxSteps` single-step calls, executes framework tools between steps, and
 * returns a `GeneratorModelResult` shaped like the SDK-owned path's result
 * (final-step text/structuredOutput/toolCalls, aggregate usage, per-step
 * `steps`, sources accumulated across steps) so the caller's downstream
 * handling — candidate resolution, usage hook, source emission,
 * `tool_call_progress` synthesis, repair, final message emission — runs
 * unchanged.
 */
async function runOwnedGenerateLoop(params: {
  model: GeneratorModel;
  messages: unknown[];
  toolBlocks: GeneratorTool[];
  providerTools: ProviderTool[];
  outputSchema: ZodTypeAny | undefined;
  maxTokens: number | undefined;
  maxSteps: number;
  runTools: boolean;
  flowTools: ToolsConfig | undefined;
  blockName: string;
  ctx: BlockContext;
  itemVisibility: ItemVisibility | undefined;
  agentName: string | undefined;
  prepareStep: PrepareStepFn | undefined;
  providerOptions: Record<string, unknown> | undefined;
  caching: CachingConfig | undefined;
}): Promise<GeneratorModelResult> {
  const { model, ctx, blockName } = params;
  const toolset = compileOwnedLoopToolset(
    params.toolBlocks,
    ctx,
    params.flowTools,
    blockName,
    params.itemVisibility,
    params.agentName,
  );

  let messages = params.messages;
  const steps: GeneratorStepResult[] = [];
  const sources: GeneratorModelSource[] = [];
  let usage: GeneratorModelUsage | undefined;
  let last: GeneratorModelResult | undefined;
  let identity: ModelIdentity | undefined;
  let activeToolNames: string[] | undefined;

  for (let stepNumber = 0; stepNumber < params.maxSteps; stepNumber += 1) {
    throwIfAborted(ctx);
    const prep = await applyOwnedPrepareStep({
      prepareStep: params.prepareStep,
      stepNumber,
      messages,
      steps,
      activeToolNames,
      model,
      requires: "generateStep",
      ctx,
      blockName,
    });
    messages = prep.messages;
    activeToolNames = prep.activeToolNames;

    const step = await prep.stepModel.generateStep!({
      messages,
      tools: activeStepTools(toolset, activeToolNames),
      providerTools: params.providerTools.length > 0 ? params.providerTools : undefined,
      outputSchema: params.outputSchema,
      maxTokens: params.maxTokens,
      signal: ctx.signal,
      providerOptions: params.providerOptions,
      caching: params.caching,
    });

    last = step;
    if (step.resolvedIdentity !== undefined) {
      // Per-step identity stamping: tools executed after this step attribute
      // their `tool_output` to the model that actually issued the calls.
      identity = step.resolvedIdentity;
      (ctx as { _currentModelIdentity?: ModelIdentity })._currentModelIdentity = identity;
    }
    usage = addGeneratorUsage(usage, step.usage);
    if (step.sources !== undefined) {
      sources.push(...step.sources);
    }

    const calls = remapStepToolCalls(step.toolCalls, toolset) ?? [];
    // Provider-executed calls (web search etc.) ran server-side and are not
    // FSD's to run; only framework calls gate continuation and get executed.
    const { frameworkCalls } = partitionStepCalls(calls);

    if (frameworkCalls.length === 0 || !params.runTools) {
      // Final step from FSD's view — no framework calls to run (provider-only
      // steps included), or `loop.runTools: false` surfaces the calls and
      // TERMINATES (no tool-result messages are ever produced when tools
      // aren't run, so looping on would feed an orphaned tool turn).
      steps.push({
        text: step.text,
        toolCalls: calls.length > 0 ? calls : undefined,
        finishReason: step.finishReason,
        usage: step.usage,
      });
      break;
    }

    const settled = await executeOwnedStepToolCalls(frameworkCalls, toolset);
    messages = [...messages, ...(await buildOwnedStepMessages(step, settled, ctx))];
    steps.push({
      text: step.text,
      toolCalls: calls,
      toolResults: settled
        .filter((s) => s.ok)
        .map((s) => ({
          toolCallId: s.call.toolCallId,
          toolName: s.call.toolName,
          result: s.output,
        })),
      finishReason: step.finishReason,
      usage: step.usage,
    });
  }

  return {
    text: last?.text,
    structuredOutput: last?.structuredOutput,
    toolCalls: remapStepToolCalls(last?.toolCalls, toolset),
    finishReason: last?.finishReason,
    usage,
    providerMetadata: last?.providerMetadata,
    steps: steps.length > 0 ? steps : undefined,
    sources: sources.length > 0 ? sources : undefined,
    resolvedIdentity: identity,
  };
}

/**
 * Creates the mutable emission state shared by the legacy single-call stream
 * and the framework-owned per-step stream. One state instance spans the
 * WHOLE run (all steps): text deltas accumulate into a single assistant
 * message item, reasoning/message items are emitted lazily in stream order,
 * and the resolved model identity refines as chunks report it. Seeding also
 * primes `ctx._currentModelIdentity` so tools called on the very first turn
 * still stamp an identity on their `tool_output` items.
 */
function createStreamEmissionState(
  model: GeneratorModel,
  ctx: BlockContext,
  blockName: string,
  itemVisibility: ItemVisibility | undefined,
  agentName: string | undefined,
) {
  const identity = ctx._blockIdentity;
  // Resolved model identity stamped on each emitted item and propagated to
  // BlockTraceItem.model via onGeneratorModelResult. Initialized from the
  // first chunk that carries it; refined on the `finish` chunk. The pre-
  // chunk seed lets a tool called on the very first AI SDK turn still stamp
  // an identity on its `tool_output` item.
  const resolvedIdentity: ModelIdentity | undefined = { actual: model.modelId };
  (ctx as { _currentModelIdentity?: ModelIdentity })._currentModelIdentity = resolvedIdentity;
  return {
    emit: itemVisibility !== undefined,
    itemId: `item_msg_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    contentPartIndex: 0,
    provenance: {
      blockName: identity?.blockName ?? blockName,
      blockInstanceId: identity?.blockInstanceId ?? blockName,
      parentBlockInstanceId: identity?.parentBlockInstanceId,
      phase: identity?.phase ?? ("main" as const)
    },
    ownedBy: identity?.ownedBy,
    taskId: identity?.taskId,
    itemVisibility,
    agentName,
    // Reasoning and message items are emitted lazily so their order in the
    // item list matches the natural stream order (reasoning before text).
    reasoningItemId: `item_reasoning_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    reasoningContentIndex: 0,
    reasoningStarted: false,
    reasoningAccumulated: "",
    messageItem: null as Record<string, unknown> | null,
    messageEmitted: false,
    accumulated: "",
    resolvedIdentity,
    finalResult: undefined as GeneratorModelResult | undefined,
  };
}

type StreamEmissionState = ReturnType<typeof createStreamEmissionState>;

/**
 * Processes one framework stream chunk: emits the incremental
 * message/reasoning/tool_call_progress/source items and updates the shared
 * emission state. Extracted verbatim from the legacy streaming loop so the
 * SDK-owned single-call stream and the framework-owned per-step stream share
 * identical wire behavior.
 */
async function handleGeneratorStreamChunk(
  chunk: GeneratorModelStreamChunk,
  s: StreamEmissionState,
  ctx: BlockContext,
): Promise<void> {
  const { emit, itemVisibility, agentName, provenance, ownedBy, taskId } = s;
  if (chunk.resolvedIdentity !== undefined) {
    s.resolvedIdentity = chunk.resolvedIdentity;
    (ctx as { _currentModelIdentity?: ModelIdentity })._currentModelIdentity = s.resolvedIdentity;
  }
  if (chunk.type === "reasoning_delta" && chunk.reasoningDelta !== undefined) {
    if (emit) {
      if (!s.reasoningStarted) {
        s.reasoningStarted = true;
        const reasoningItem = {
          id: s.reasoningItemId,
          type: "reasoning" as const,
          status: "in_progress" as const,
          transient: false,
          requestId: ctx.request.identity.id,
          itemIndex: getEmitterItemCount(ctx.response),
          provenance,
          ts: Date.now(),
          ownedBy,
          taskId,
          itemVisibility,
          agentName,
          model: s.resolvedIdentity,
          summary: [{ type: "reasoning_text" as const, text: "" }]
        };
        await ctx.response.emit({ type: "item.added", item: reasoningItem });
        await ctx.response.emit({
          type: "content.added",
          itemId: s.reasoningItemId,
          contentIndex: s.reasoningContentIndex,
          content: { type: "reasoning_text", text: "" }
        });
      }
      s.reasoningAccumulated += chunk.reasoningDelta;
      await ctx.response.emit({
        type: "content.delta",
        itemId: s.reasoningItemId,
        contentIndex: s.reasoningContentIndex,
        delta: chunk.reasoningDelta
      });
    }
  } else if (chunk.type === "text_delta" && chunk.textDelta !== undefined) {
    if (!s.messageEmitted) {
      if (emit && s.reasoningStarted) {
        await ctx.response.emit({
          type: "content.done",
          itemId: s.reasoningItemId,
          contentIndex: s.reasoningContentIndex,
          content: { type: "reasoning_text", text: s.reasoningAccumulated }
        });
        const completedReasoning = {
          id: s.reasoningItemId,
          type: "reasoning" as const,
          status: "completed" as const,
          transient: false,
          requestId: ctx.request.identity.id,
          itemIndex: getEmitterItemCount(ctx.response),
          provenance,
          ts: Date.now(),
          ownedBy,
          taskId,
          itemVisibility,
          agentName,
          model: s.resolvedIdentity,
          summary: [{ type: "reasoning_text" as const, text: s.reasoningAccumulated }]
        };
        await ctx.response.emit({ type: "item.done", item: completedReasoning });
      }

      if (emit) {
        s.messageItem = {
          id: s.itemId,
          type: "message" as const,
          role: "assistant" as const,
          status: "in_progress" as const,
          transient: false,
          requestId: ctx.request.identity.id,
          itemIndex: getEmitterItemCount(ctx.response),
          provenance,
          ts: Date.now(),
          ownedBy,
          taskId,
          itemVisibility,
          agentName,
          model: s.resolvedIdentity,
          content: [{ type: "output_text" as const, text: "" }]
        };
        await ctx.response.emit({ type: "item.added", item: s.messageItem });
        await ctx.response.emit({
          type: "content.added",
          itemId: s.itemId,
          contentIndex: s.contentPartIndex,
          content: { type: "output_text", text: "" }
        });
      }
      s.messageEmitted = true;
    }
    s.accumulated += chunk.textDelta;
    if (emit) {
      await ctx.response.emit({
        type: "content.delta",
        itemId: s.itemId,
        contentIndex: s.contentPartIndex,
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
        taskId,
        itemVisibility,
        agentName,
        model: s.resolvedIdentity,
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
        taskId,
        itemVisibility,
        agentName,
        model: s.resolvedIdentity,
        toolCallId: tr.toolCallId,
        toolName: tr.toolName,
        result: tr.result
      };
      await ctx.response.emit({ type: "item.added", item: toolResultItem });
      await ctx.response.emit({ type: "item.done", item: toolResultItem });
    }
  } else if (chunk.type === "source_url" && chunk.source !== undefined) {
    if (emit) {
      const sourceItem = buildSourceItem(chunk.source, ctx, provenance, itemVisibility, agentName, s.resolvedIdentity);
      await ctx.response.emit({ type: "item.added", item: sourceItem });
      await ctx.response.emit({ type: "item.done", item: sourceItem });
    }
  } else if (chunk.type === "finish") {
    s.finalResult = chunk.fullResult;
    if (s.finalResult?.resolvedIdentity !== undefined) {
      s.resolvedIdentity = s.finalResult.resolvedIdentity;
    }
  }
}

/**
 * Post-stream finalization shared by both streaming paths: closes out
 * reasoning, emits the message envelope when no text arrived, validates the
 * accumulated text against the output schema, emits `content.done` +
 * `item.done`, and installs the FIX-480 ref-output hint. Returns the parsed
 * output; the caller reports usage via `onGeneratorModelResult` (legacy
 * passes the final result's usage, the owned loop its per-step aggregate).
 */
async function finalizeStreamedMessage(
  s: StreamEmissionState,
  ctx: BlockContext,
  outputSchema: ZodTypeAny,
  blockName: string,
): Promise<unknown> {
  const { emit, itemVisibility, agentName, provenance, ownedBy, taskId } = s;
  // If no text deltas arrived, still finalize reasoning and emit a message
  // envelope so downstream consumers see a completed assistant turn.
  if (!s.messageEmitted) {
    if (emit && s.reasoningStarted) {
      await ctx.response.emit({
        type: "content.done",
        itemId: s.reasoningItemId,
        contentIndex: s.reasoningContentIndex,
        content: { type: "reasoning_text", text: s.reasoningAccumulated }
      });
      const completedReasoning = {
        id: s.reasoningItemId,
        type: "reasoning" as const,
        status: "completed" as const,
        transient: false,
        requestId: ctx.request.identity.id,
        itemIndex: getEmitterItemCount(ctx.response),
        provenance,
        ts: Date.now(),
        ownedBy,
        taskId,
        itemVisibility,
        agentName,
        model: s.resolvedIdentity,
        summary: [{ type: "reasoning_text" as const, text: s.reasoningAccumulated }]
      };
      await ctx.response.emit({ type: "item.done", item: completedReasoning });
    }
    if (emit) {
      s.messageItem = {
        id: s.itemId,
        type: "message" as const,
        role: "assistant" as const,
        status: "in_progress" as const,
        transient: false,
        requestId: ctx.request.identity.id,
        itemIndex: getEmitterItemCount(ctx.response),
        provenance,
        ts: Date.now(),
        ownedBy,
        taskId,
        itemVisibility,
        agentName,
        model: s.resolvedIdentity,
        content: [{ type: "output_text" as const, text: "" }]
      };
      await ctx.response.emit({ type: "item.added", item: s.messageItem });
      await ctx.response.emit({
        type: "content.added",
        itemId: s.itemId,
        contentIndex: s.contentPartIndex,
        content: { type: "output_text", text: "" }
      });
    }
    s.messageEmitted = true;
  }

  // Validate output through the schema
  const parsed = parseOutputWithSchema<unknown>(outputSchema, s.accumulated, blockName, "stream");
  if (!parsed.success) {
    logUnparseableCandidate(blockName, s.accumulated, parsed.error, 'stream');
    throw parsed.error;
  }

  // Emit content.done and completed item (only when identity is declared).
  if (emit && s.messageItem) {
    await ctx.response.emit({
      type: "content.done",
      itemId: s.itemId,
      contentIndex: s.contentPartIndex,
      content: { type: "output_text", text: s.accumulated }
    });
    const completedItem = {
      ...s.messageItem,
      status: "completed" as const,
      model: s.resolvedIdentity,
      content: [{ type: "output_text" as const, text: s.accumulated }]
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
    s.messageItem !== null &&
    isTextOutputSchema(outputSchema) &&
    typeof parsed.output === "string" &&
    parsed.output.length > 0 &&
    parsed.output === s.accumulated
  ) {
    ctx._blockOutputHint = { kind: "ref", sourceItemId: s.itemId };
  }

  return parsed.output;
}

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
  itemVisibility: ItemVisibility | undefined,
  agentName: string | undefined,
  prepareStep?: PrepareStepFn,
  resolvedProviderOpts?: Record<string, unknown>,
  resolvedCaching?: CachingConfig
): Promise<TOutput> {
  const s = createStreamEmissionState(model, ctx, blockName, itemVisibility, agentName);

  // Stream text deltas (tool calls are handled internally by the AI SDK)
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
    await handleGeneratorStreamChunk(chunk, s, ctx);
  }

  const output = await finalizeStreamedMessage(s, ctx, outputSchema, blockName);

  ctx._runtimeHooks?.onGeneratorModelResult?.({
    model: model.modelId,
    usage: s.finalResult?.usage,
    providerMetadata: s.finalResult?.providerMetadata,
    identity: s.resolvedIdentity
  });

  return output as TOutput;
}

/** Remaps a chunk's model-facing tool names (the pre-renamed aliases) back
 * to framework block names so emitted `tool_call_progress` items match the
 * legacy stream's shape. Returns the original chunk when nothing changes. */
function remapChunkToolNames(
  chunk: GeneratorModelStreamChunk,
  toolset: OwnedLoopToolset
): GeneratorModelStreamChunk {
  if (chunk.type === "tool_call_delta" && chunk.toolCallDelta !== undefined) {
    const mapped = frameworkToolName(chunk.toolCallDelta.toolName, toolset);
    if (mapped === chunk.toolCallDelta.toolName) return chunk;
    return { ...chunk, toolCallDelta: { ...chunk.toolCallDelta, toolName: mapped } };
  }
  if (chunk.type === "tool_result" && chunk.toolResult !== undefined) {
    const mapped = frameworkToolName(chunk.toolResult.toolName, toolset);
    if (mapped === chunk.toolResult.toolName) return chunk;
    return { ...chunk, toolResult: { ...chunk.toolResult, toolName: mapped } };
  }
  if (chunk.type === "tool_input_start" && chunk.toolInput !== undefined) {
    const mapped = frameworkToolName(chunk.toolInput.toolName, toolset);
    if (mapped === chunk.toolInput.toolName) return chunk;
    return { ...chunk, toolInput: { ...chunk.toolInput, toolName: mapped } };
  }
  if (chunk.type === "finish" && chunk.fullResult?.toolCalls !== undefined) {
    return {
      ...chunk,
      fullResult: {
        ...chunk.fullResult,
        toolCalls: remapStepToolCalls(chunk.fullResult.toolCalls, toolset),
      },
    };
  }
  return chunk;
}

/**
 * The framework-owned STREAMING step loop. Same loop structure as
 * `runOwnedGenerateLoop`, but each step streams through `streamStep` and
 * forwards its chunks through the SHARED chunk handler, so the wire behavior
 * (incremental message/reasoning emission, tool_call_progress, sources) is
 * identical to the legacy single-call stream — only the loop boundary moves
 * to FSD. After FSD runs a step's tools, the completed `tool_call_progress`
 * items are synthesized through the same handler the legacy `tool_result`
 * chunks flow through.
 */
async function executeOwnedStreamingGeneration<TInput, TOutput>(
  model: GeneratorModel,
  initialMessages: unknown[],
  toolBlocks: GeneratorTool[],
  providerTools: ProviderTool[],
  config: GeneratorConfig<any, any, TInput, TOutput>,
  outputSchema: ZodTypeAny,
  blockName: string,
  maxSteps: number,
  runTools: boolean,
  ctx: BlockContext,
  itemVisibility: ItemVisibility | undefined,
  agentName: string | undefined,
  prepareStep?: PrepareStepFn,
  resolvedProviderOpts?: Record<string, unknown>,
  resolvedCaching?: CachingConfig
): Promise<TOutput> {
  const s = createStreamEmissionState(model, ctx, blockName, itemVisibility, agentName);
  const toolset = compileOwnedLoopToolset(
    toolBlocks,
    ctx,
    config.flowTools,
    blockName,
    itemVisibility,
    agentName,
  );

  let messages = initialMessages;
  const steps: GeneratorStepResult[] = [];
  let usage: GeneratorModelUsage | undefined;
  let lastFinish: GeneratorModelResult | undefined;
  let activeToolNames: string[] | undefined;

  for (let stepNumber = 0; stepNumber < maxSteps; stepNumber += 1) {
    throwIfAborted(ctx);
    const prep = await applyOwnedPrepareStep({
      prepareStep,
      stepNumber,
      messages,
      steps,
      activeToolNames,
      model,
      requires: "streamStep",
      ctx,
      blockName,
    });
    messages = prep.messages;
    activeToolNames = prep.activeToolNames;

    // Reset so this step's `finish` chunk is what we read below, not a
    // previous step's.
    s.finalResult = undefined;
    for await (const chunk of prep.stepModel.streamStep!({
      messages,
      tools: activeStepTools(toolset, activeToolNames),
      providerTools: providerTools.length > 0 ? providerTools : undefined,
      maxTokens: config.maxTokens,
      signal: ctx.signal,
      providerOptions: resolvedProviderOpts,
      caching: resolvedCaching,
    })) {
      await handleGeneratorStreamChunk(remapChunkToolNames(chunk, toolset), s, ctx);
    }

    // Widened read: the handler mutates `s.finalResult` inside the loop, so
    // TS's narrowing from the reset above must not stick.
    const stepFinal = (s as { finalResult: GeneratorModelResult | undefined }).finalResult;
    lastFinish = stepFinal;
    usage = addGeneratorUsage(usage, stepFinal?.usage);

    const calls = stepFinal?.toolCalls ?? [];
    // Provider-executed calls (web search etc.) ran server-side and are not
    // FSD's to run; only framework calls gate continuation and get executed.
    const { frameworkCalls } = partitionStepCalls(calls);
    if (frameworkCalls.length === 0 || !runTools) {
      steps.push({
        text: stepFinal?.text,
        toolCalls: calls.length > 0 ? calls : undefined,
        finishReason: stepFinal?.finishReason,
        usage: stepFinal?.usage,
      });
      break;
    }

    const settled = await executeOwnedStepToolCalls(frameworkCalls, toolset);

    // Completed tool_call_progress items for successful calls, synthesized
    // through the same handler the legacy stream's `tool_result` chunks use.
    for (const st of settled) {
      if (!st.ok) continue;
      await handleGeneratorStreamChunk(
        {
          type: "tool_result",
          toolResult: {
            toolCallId: st.call.toolCallId,
            toolName: st.call.toolName,
            result: st.output,
          },
        },
        s,
        ctx,
      );
    }

    messages = [...messages, ...(await buildOwnedStepMessages(stepFinal, settled, ctx))];
    steps.push({
      text: stepFinal?.text,
      toolCalls: calls,
      toolResults: settled
        .filter((st) => st.ok)
        .map((st) => ({
          toolCallId: st.call.toolCallId,
          toolName: st.call.toolName,
          result: st.output,
        })),
      finishReason: stepFinal?.finishReason,
      usage: stepFinal?.usage,
    });
  }

  const output = await finalizeStreamedMessage(s, ctx, outputSchema, blockName);

  // ONE aggregate usage report for the whole run, matching the legacy
  // path's single report (the SDK accumulates usage across its internal
  // steps the same way).
  ctx._runtimeHooks?.onGeneratorModelResult?.({
    model: model.modelId,
    usage,
    providerMetadata: lastFinish?.providerMetadata,
    identity: s.resolvedIdentity
  });

  return output as TOutput;
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
  const blockItemVisibility = config.itemVisibility;

  // Eager strict-mode guard: a reachable z.record / non-literal union in the
  // declared output schema fails OpenAI strict mode at the first live call with
  // an opaque error. Throw here, at definition, naming the offending node
  // instead. Only runs when the author declared an outputSchema — the z.string()
  // default and other text/primitive outputs are always strict-safe. See BP-016.
  if (config.outputSchema !== undefined) {
    assertStrictCompatible(config.outputSchema as ZodTypeAny, `Generator "${String(config.name)}"`);
  }

  const outputSchema = (config.outputSchema ?? z.string()) as ZodTypeAny;
  const normalizedConfig: GeneratorConfig<TInputSchema, TOutputSchema, TInput, TOutput> = {
    ...config,
    outputSchema: outputSchema as TOutputSchema
  } as GeneratorConfig<TInputSchema, TOutputSchema, TInput, TOutput>;

  // A whole PromptFile passed as `prompt` (`prompt: loadPromptFile(...)`)
  // expands into the same spreadable fields `definePromptFile` produces. Any
  // sibling field the author set explicitly wins, matching the spread form
  // `...definePromptFile(pf), <overrides>`. After this, `prompt` is the bare
  // branded slot the rest of the generator already understands.
  if (isPromptFile(config.prompt)) {
    const expanded = definePromptFile(config.prompt);
    const target = normalizedConfig as unknown as Record<string, unknown>;
    const authored = config as unknown as Record<string, unknown>;
    for (const key of ["name", "description", "user", "caching", "maxTokens", "temperature"] as const) {
      if (expanded[key] !== undefined && authored[key] === undefined) {
        target[key] = expanded[key];
      }
    }
    target.prompt = expanded.prompt;
  }

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
            if (!capabilityMatchesAgent(cap, blockItemVisibility)) continue;
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
            if (!capabilityMatchesAgent(cap, blockItemVisibility)) continue;
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
    // A generator is a leaf — its OWN declarations equal its bubble-up set
    // (own `resources` + capability-injected resources, no descendants).
    ownDeclaredResources: declaredResources,
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

      const promptFileBrand = getPromptFileBrand(normalizedConfig.prompt);
      const configMeta: PromptFileConfigMeta = {
        model: modelId,
        intent: promptFileBrand?.frontmatter.intent as string | undefined,
        tools: toolBlocks.map((t) => t.name),
        caching: resolvedCaching,
        maxTokens: normalizedConfig.maxTokens,
        // Read from the resolved config (not frontmatter) so a `temperature`
        // override placed after `...definePromptFile(pf)` wins, matching how
        // `maxTokens` and `prompt` overrides behave. `temperature` is not a
        // typed GeneratorConfig field today; `definePromptFile` spreads it in.
        temperature: (normalizedConfig as { temperature?: number }).temperature,
        providerOptions: resolvedProviderOpts,
      };
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

      const userBrand = getPromptFileBrand(normalizedConfig.user);
      const {
        messages,
        systemPrefixCount,
        promptText: prompt,
        userValues,
      } = await assembleMessages(
        {
          promptValue: normalizedConfig.prompt as Exclude<typeof normalizedConfig.prompt, PromptFile>,
          promptFileBrand,
          contextValues,
          historyValues,
          resolveUserValues: async (cv) =>
            userBrand?.hasUserBlock && cv !== undefined
              ? [await userBrand.renderUser({ input, ctx, config: cv })].filter(
                  (v): v is string => v != null,
                )
              : resolveSlotValues(normalizedConfig.user as GeneratorSlot | undefined, input, ctx),
          configMeta,
          input,
        },
        ctx,
      );

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
        // AI SDK 7 carry-forward: a returned `messages` override becomes the
        // input of later steps, so the prefix at the head of `currentMessages`
        // is whatever this callback last returned — not the assembly-time
        // prefix. Track the length of the prefix we last wrote so every step
        // slices off exactly that prefix; slicing by `systemPrefixCount` would
        // leak stale context whenever the fresh prefix length differs.
        let currentPrefixCount = systemPrefixCount;
        prepareStepFn = async ({ stepNumber, messages: currentMessages, steps: _steps }) => {
          if (stepNumber === 0) {
            // Fresh loop (also after a fallback retry re-enters at step 0):
            // the input messages carry the assembly-time prefix.
            currentPrefixCount = systemPrefixCount;
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

          const freshContext = await resolveSlotValues(normalizedConfig.context, input, ctx);
          if (freshToolDescription !== undefined) {
            freshContext.push(freshToolDescription);
          }

          const { messages: freshSystemPrefix } = await buildSystemPrefix(
            normalizedConfig.prompt as Exclude<typeof normalizedConfig.prompt, PromptFile>,
            promptFileBrand,
            freshContext,
            input,
            ctx,
            configMeta
          );

          // Replace the system prefix with fresh values; keep conversation
          // messages (history, user, accumulated tool calls/results).
          const conversationMessages = currentMessages.slice(currentPrefixCount);
          currentPrefixCount = freshSystemPrefix.length;
          return {
            messages: [...freshSystemPrefix, ...conversationMessages],
            activeTools
          };
        };
      }

      const runTools = normalizedConfig.loop?.runTools !== false;
      const maxSteps = resolveMaxIterations(normalizedConfig);

      // Visibility: generators without `itemVisibility` produce no auto-emitted
      // items (only block_trace output via graph edges). When set, `agentName`
      // defaults to the block name so collaborating generators can be
      // given a shared name explicitly.
      const itemVisibility = normalizedConfig.itemVisibility;
      const agentName = itemVisibility !== undefined
        ? (normalizedConfig.agentName ?? blockName)
        : undefined;

      // Compile tools for a LEGACY (SDK-owned) model call: with execute
      // wrappers (AI SDK auto-runs them) or without (model suggests calls but
      // doesn't execute them). The framework-owned loops never use these —
      // they build their own executors via `compileOwnedLoopToolset` — so
      // this is computed lazily at the two legacy call sites only, avoiding
      // per-tool `buildToolExecutor` closures on every owned-path generation
      // (the real AI-SDK adapter always takes the owned path). `hasTools`
      // gates on the raw block/provider-tool counts (1:1 with what would be
      // compiled), so streaming/emission decisions are unaffected.
      const compileLegacyTools = (): GeneratorModelTool[] =>
        toolBlocks.length > 0
          ? (runTools
              ? compileToolsWithExecute(toolBlocks, ctx, normalizedConfig.flowTools, blockName, itemVisibility, agentName)
              : compileToolsForModel(toolBlocks))
          : [];

      // Streaming path: text output + model supports streaming (SDK-owned
      // `stream` or the framework-owned per-step `streamStep`). We stream
      // whenever tools are present (so tool `execute` closures fire) or
      // whenever identity is set (so text deltas flow to the client).
      // Identity-less, tool-less generators fall through to non-streaming
      // and skip message emission entirely.
      const hasTools = toolBlocks.length > 0 || resolvedProviderTools.length > 0;
      const canStream = (itemVisibility !== undefined || hasTools)
        && isTextOutputSchema(outputSchema)
        && (model.stream !== undefined || model.streamStep !== undefined);

      // Emit debug capture for devtool inspection before the LLM call. Use
      // the same combined-system-message assembly the model sees so the
      // devtool view matches the real prompt rather than a flat join.
      // `user` and `history` are captured post-`asUserMessage` wrapping so
      // the devtool sees the exact message shapes sent to the model.
      const debugPrompt = messages.slice(0, systemPrefixCount)
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
              ...(promptFileBrand
                ? {
                    templateSource: promptFileBrand.rawText,
                    templateFrontmatter: promptFileBrand.frontmatter,
                  }
                : {}),
            },
          },
        },
        ctx
      );

      if (canStream) {
        try {
          // Framework-owned per-step loop when the model is step-capable;
          // legacy SDK-owned multi-step stream otherwise (compatibility path
          // for mocks and third-party adapters without `streamStep`).
          if (model.streamStep !== undefined) {
            return await executeOwnedStreamingGeneration(
              model,
              messages,
              toolBlocks,
              resolvedProviderTools,
              normalizedConfig,
              outputSchema,
              blockName,
              maxSteps,
              runTools,
              ctx,
              itemVisibility,
              agentName,
              prepareStepFn,
              resolvedProviderOpts,
              resolvedCaching
            );
          }
          return await executeStreamingGeneration(
            model,
            messages,
            compileLegacyTools(),
            resolvedProviderTools,
            normalizedConfig,
            outputSchema,
            blockName,
            maxSteps,
            ctx,
            itemVisibility,
            agentName,
            prepareStepFn,
            resolvedProviderOpts,
            resolvedCaching
          );
        } catch (err) {
          surfaceModelCallError(err, ctx, blockName);
        }
      }

      // Prime `_currentModelIdentity` with the requested model id so tools
      // called inside the AI SDK's multi-step loop (before the generate call
      // returns and `resolvedIdentity` is known) still stamp an identity on
      // their `tool_output` items. Refined to the resolved identity below.
      (ctx as { _currentModelIdentity?: ModelIdentity })._currentModelIdentity = {
        actual: model.modelId,
      };
      // Non-streaming. Step-capable models run the framework-owned per-step
      // loop (`runOwnedGenerateLoop`); models without `generateStep` run the
      // legacy path — a single call where the model handles the multi-step
      // loop via maxSteps (compatibility path for mocks and third-party
      // adapters). Both produce the same GeneratorModelResult shape, so all
      // downstream handling is shared.
      //
      // A ZodString output ("text" generators, including the z.string() default)
      // can't be a structured-output root: OpenAI and the AI Gateway require the
      // response_format root to be `type: "object"` and reject `type: "string"`.
      // The streaming path above already omits the schema and returns plain text;
      // mirror that here so the non-streaming path builds the same valid request.
      // Object schemas still flow through as structured output. Downstream,
      // resolveGenerationCandidate falls back to result.text, and the block
      // re-validates it against the real (z.string()) outputSchema.
      const generateOutputSchema = isTextOutputSchema(outputSchema) ? undefined : outputSchema;
      let generation: GeneratorModelResult;
      try {
        generation = model.generateStep !== undefined
          ? await runOwnedGenerateLoop({
              model,
              messages,
              toolBlocks,
              providerTools: resolvedProviderTools,
              outputSchema: generateOutputSchema,
              maxTokens: normalizedConfig.maxTokens,
              maxSteps,
              runTools,
              flowTools: normalizedConfig.flowTools,
              blockName,
              ctx,
              itemVisibility,
              agentName,
              prepareStep: prepareStepFn,
              providerOptions: resolvedProviderOpts,
              caching: resolvedCaching,
            })
          : await (async () => {
              const legacyTools = compileLegacyTools();
              return model.generate({
              messages,
              tools: legacyTools.length > 0 ? legacyTools : undefined,
              providerTools: resolvedProviderTools.length > 0 ? resolvedProviderTools : undefined,
              outputSchema: generateOutputSchema,
              maxTokens: normalizedConfig.maxTokens,
              signal: ctx.signal,
              maxSteps,
              providerOptions: resolvedProviderOpts,
              caching: resolvedCaching,
              prepareStep: prepareStepFn
            });
            })();
      } catch (err) {
        surfaceModelCallError(err, ctx, blockName);
      }

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
      if (itemVisibility !== undefined && generation.sources !== undefined && generation.sources.length > 0) {
        const sourceIdentity = ctx._blockIdentity;
        const sourceProv = {
          blockName: sourceIdentity?.blockName ?? blockName,
          blockInstanceId: sourceIdentity?.blockInstanceId ?? blockName,
          parentBlockInstanceId: sourceIdentity?.parentBlockInstanceId,
          phase: sourceIdentity?.phase ?? ("main" as const)
        };
        for (const source of generation.sources) {
          const sourceItem = buildSourceItem(source, ctx, sourceProv, itemVisibility, agentName, nonStreamingIdentity);
          await ctx.response.emit({ type: "item.added", item: sourceItem });
          await ctx.response.emit({ type: "item.done", item: sourceItem });
        }
      }

      // FIX-661: emit `tool_call_progress` items for tool calls that happened
      // inside the model's internal multi-step loop. Streaming providers
      // produce these via the chunk stream above; non-streaming providers
      // return them on the generation result and we synthesise the same
      // items here so observability is independent of transport. Mirrors the
      // streaming branch's emission shape (lines 1518-1562).
      //
      // Ordering caveat: on the streaming branch the interleave is
      // `tool_call_progress { in_progress }` → `tool_output` (durable, from
      // `emitToolOutputAround` inside the AI SDK's tool loop) →
      // `tool_call_progress { completed }`. Here the tool runs *during*
      // `model.generate()`, so any `tool_output` items have already been
      // emitted by the time this block runs. Subscribers that key UI state
      // off the `in_progress` transient must tolerate the durable
      // `tool_output` arriving first on non-streaming providers.
      if (itemVisibility !== undefined) {
        const toolIdentity = ctx._blockIdentity;
        const toolProvenance = {
          blockName: toolIdentity?.blockName ?? blockName,
          blockInstanceId: toolIdentity?.blockInstanceId ?? blockName,
          parentBlockInstanceId: toolIdentity?.parentBlockInstanceId,
          phase: toolIdentity?.phase ?? ("main" as const)
        };
        const toolOwnedBy = toolIdentity?.ownedBy;
        const toolTaskId = toolIdentity?.taskId;

        // Prefer per-step pairing when available — preserves call ordering and
        // matches each call to its result. Fall back to top-level toolCalls
        // when steps are absent (custom resolvers, older provider shapes); in
        // that case only `in_progress` items emit (no result to pair).
        const stepCalls = generation.steps?.flatMap((s) => s.toolCalls ?? []) ?? [];
        const stepResults = generation.steps?.flatMap((s) => s.toolResults ?? []) ?? [];
        const sourceCalls = stepCalls.length > 0 ? stepCalls : (generation.toolCalls ?? []);
        const resultByCallId = new Map(stepResults.map((r) => [r.toolCallId, r] as const));

        for (const call of sourceCalls) {
          const inProgressItem = {
            id: `item_toolcall_${call.toolCallId}`,
            type: "tool_call_progress" as const,
            status: "in_progress" as const,
            transient: true,
            requestId: ctx.request.identity.id,
            itemIndex: getEmitterItemCount(ctx.response),
            provenance: toolProvenance,
            ts: Date.now(),
            ownedBy: toolOwnedBy,
            taskId: toolTaskId,
            itemVisibility,
            agentName,
            model: nonStreamingIdentity,
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            argsDelta: JSON.stringify(call.args ?? {})
          };
          await ctx.response.emit({ type: "item.added", item: inProgressItem });
          await ctx.response.emit({ type: "item.done", item: inProgressItem });

          const result = resultByCallId.get(call.toolCallId);
          if (result !== undefined) {
            const completedItem = {
              id: `item_toolresult_${call.toolCallId}`,
              type: "tool_call_progress" as const,
              status: "completed" as const,
              transient: true,
              requestId: ctx.request.identity.id,
              itemIndex: getEmitterItemCount(ctx.response),
              provenance: toolProvenance,
              ts: Date.now(),
              ownedBy: toolOwnedBy,
              taskId: toolTaskId,
              itemVisibility,
              agentName,
              model: nonStreamingIdentity,
              toolCallId: call.toolCallId,
              toolName: call.toolName,
              result: result.result
            };
            await ctx.response.emit({ type: "item.added", item: completedItem });
            await ctx.response.emit({ type: "item.done", item: completedItem });
          }
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
      if (itemVisibility !== undefined && isTextOutputSchema(outputSchema) && typeof output === "string") {
        const itemId = `item_msg_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        const outputIdentity = ctx._blockIdentity;
        const provenance = {
          blockName: outputIdentity?.blockName ?? blockName,
          blockInstanceId: outputIdentity?.blockInstanceId ?? blockName,
          parentBlockInstanceId: outputIdentity?.parentBlockInstanceId,
          phase: outputIdentity?.phase ?? ("main" as const)
        };
        const nsOwnedBy = outputIdentity?.ownedBy;
        const nsTaskId = outputIdentity?.taskId;
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
          taskId: nsTaskId,
          itemVisibility,
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
