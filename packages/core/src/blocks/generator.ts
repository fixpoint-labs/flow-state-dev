import { z, type ZodTypeAny } from "zod";
import { OutputValidationError } from "../errors/output-validation-error";
import { isAbortLike, rootCause } from "../errors/abort";
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
  GeneratorModelTool,
  GeneratorSearchConfig,
  ModelIdentity,
  PrepareStepFn,
  ProviderTool
} from "../types/model";
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
import { sanitizeToolName } from "../helpers/tool-name";
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
import { getEmitterItemCount } from "./internal/utils";
import {
  assembleMessages,
  buildSystemPrefix,
  asUserMessage,
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


/**
 * Post-resolution generator-config values exposed to PromptFile templates as
 * the `config` render variable. Distinct from `ctx`: this is "what the
 * generator will run with" (resolved model/tools/caching), not "what the call
 * brought" (state/resources). The aggregated context tag map is added per
 * call (it depends on resolved context entries).
 */
export interface PromptFileConfigMeta {
  model?: string;
  intent?: string;
  tools?: string[];
  caching?: CachingConfig;
  maxTokens?: number;
  temperature?: number;
  providerOptions?: Record<string, unknown>;
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
  const emit = itemVisibility !== undefined;
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
  const taskId = identity?.taskId;
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
            taskId,
            itemVisibility,
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
            taskId,
            itemVisibility,
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
            taskId,
            itemVisibility,
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
          taskId,
          itemVisibility,
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
          taskId,
          itemVisibility,
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
        const sourceItem = buildSourceItem(chunk.source, ctx, provenance, itemVisibility, agentName, resolvedIdentity);
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
        taskId,
        itemVisibility,
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
        taskId,
        itemVisibility,
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
  const blockItemVisibility = config.itemVisibility;

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
        configView,
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
          const conversationMessages = currentMessages.slice(systemPrefixCount);
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

      // Compile tools: with execute wrappers (AI SDK auto-runs them) or
      // without (model suggests calls but doesn't execute them).
      const compiledTools = toolBlocks.length > 0
        ? (runTools
            ? compileToolsWithExecute(toolBlocks, ctx, normalizedConfig.flowTools, blockName, itemVisibility, agentName)
            : compileToolsForModel(toolBlocks))
        : [];

      // Streaming path: text output + model supports streaming. We stream
      // whenever tools are present (so tool `execute` closures fire) or
      // whenever identity is set (so text deltas flow to the client).
      // Identity-less, tool-less generators fall through to non-streaming
      // and skip message emission entirely.
      const hasTools = compiledTools.length > 0 || resolvedProviderTools.length > 0;
      const canStream = (itemVisibility !== undefined || hasTools) && isTextOutputSchema(outputSchema) && model.stream !== undefined;

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
      // Non-streaming: single call, model handles multi-step loop via maxSteps.
      let generation: GeneratorModelResult;
      try {
        generation = await model.generate({
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
