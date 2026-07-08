import { generateText, streamText, Output, isStepCount } from "ai";
import type {
  CachingConfig,
  GeneratorModel,
  GeneratorModelResult,
  GeneratorModelSource,
  GeneratorModelStreamChunk,
  GeneratorModelTool,
  GeneratorModelToolCall,
  GeneratorSearchConfig,
  GeneratorStepResult,
  ModelResolver,
  PrepareStepFn,
  ProviderTool
} from "../types";
import { makeSchemaStrict } from "./makeSchemaStrict";
import { applyCaching } from "./caching";
import { sanitizeToolName, ensureUniqueAlias } from "../helpers/tool-name";

export type ResolveAiSdkLanguageModel = (modelId: string) => unknown;

// ---------------------------------------------------------------------------
// Internal helpers — normalise AI SDK result shapes into framework types
// ---------------------------------------------------------------------------

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

function resolveNestedFieldNumber(
  root: Record<string, unknown>,
  key: string,
  nestedKey: string
): number | undefined {
  const nested = asRecord(root[key]);
  if (nested === undefined) {
    return undefined;
  }

  return asNumber(nested[nestedKey]);
}

function normalizeUsage(
  value: unknown,
  providerMetadata?: unknown
): GeneratorModelResult["usage"] | undefined {
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

  // Cache tokens: AI SDK v6 exposes `cachedInputTokens` in a few shapes
  // depending on provider. Anthropic also sets them on
  // `providerMetadata.anthropic.cacheReadInputTokens` /
  // `cacheCreationInputTokens`. Prefer provider metadata (more accurate
  // split between creation vs read) and fall back to the SDK aggregate.
  const anthropicMeta = asRecord(asRecord(providerMetadata)?.anthropic);
  const cacheReadInputTokens =
    asNumber(anthropicMeta?.cacheReadInputTokens) ??
    asNumber(anthropicMeta?.cache_read_input_tokens) ??
    resolveNestedNumber(usage, "cacheReadInputTokens") ??
    resolveNestedNumber(usage, "cachedInputTokens") ??
    resolveNestedFieldNumber(usage, "inputTokenDetails", "cacheReadTokens") ??
    resolveNestedFieldNumber(usage, "inputTokens", "cacheRead");
  const cacheCreationInputTokens =
    asNumber(anthropicMeta?.cacheCreationInputTokens) ??
    asNumber(anthropicMeta?.cache_creation_input_tokens) ??
    resolveNestedNumber(usage, "cacheCreationInputTokens") ??
    resolveNestedFieldNumber(usage, "inputTokenDetails", "cacheWriteTokens") ??
    resolveNestedFieldNumber(usage, "inputTokens", "cacheWrite");

  if (
    promptTokens === undefined &&
    completionTokens === undefined &&
    totalTokens === undefined &&
    cacheReadInputTokens === undefined &&
    cacheCreationInputTokens === undefined
  ) {
    return undefined;
  }

  const result: GeneratorModelResult["usage"] = {
    promptTokens: promptTokens ?? 0,
    completionTokens: completionTokens ?? 0,
    totalTokens:
      totalTokens ?? (promptTokens ?? 0) + (completionTokens ?? 0)
  };

  if (cacheReadInputTokens !== undefined) {
    result.cacheReadInputTokens = cacheReadInputTokens;
  }
  if (cacheCreationInputTokens !== undefined) {
    result.cacheCreationInputTokens = cacheCreationInputTokens;
  }

  return result;
}

function normalizeToolCalls(
  value: unknown,
  toolNameMap?: ToolNameMap
): GeneratorModelToolCall[] | undefined {
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
      toolName: resolveOriginalToolName(toolName, toolNameMap),
      args,
      // v7 tool-call parts carry `providerExecuted: true` when the provider
      // ran the tool server-side (e.g. web search). Propagate it so the
      // framework-owned loop skips these instead of trying to run them.
      ...(candidate.providerExecuted === true ? { providerExecuted: true } : {})
    });
  }

  return toolCalls.length === 0 ? undefined : toolCalls;
}

// Reverse mapping so the framework continues to see the original (framework)
// tool names everywhere — block-name routing, observability, and items
// emitted into the SSE stream — while the model only ever sees a sanitized
// alias that satisfies provider name patterns (notably OpenAI's
// /^[a-zA-Z0-9_-]+$/).
type ToolNameMap = ReadonlyMap<string, string>;

function resolveOriginalToolName(
  modelName: string,
  map: ToolNameMap | undefined
): string {
  if (map === undefined) {
    return modelName;
  }
  return map.get(modelName) ?? modelName;
}

/**
 * Walk inbound `messages` and rewrite any toolName references to the
 * sanitized alias. Returns a fresh structure when changes happen so the
 * caller's array stays untouched; returns the original reference when
 * nothing needed to change (the common case for messages that are pure
 * text). Handles AI SDK v6 content-array shape:
 *   { role: "assistant", content: [{ type: "tool-call", toolName, ... }] }
 *   { role: "tool",      content: [{ type: "tool-result", toolName, ... }] }
 *
 * Defence-in-depth: with `BlockToolOutputItem.toolCall.alias` populated at
 * emit time, the upstream replay path (`itemToLLMMessages` in the server
 * package) already produces sanitized toolNames for tool-call / tool-result
 * parts. This pass therefore no-ops on messages built from new items but
 * remains a safety net for messages that did not flow through that path —
 * dev/test sessions persisted before the field existed, third-party
 * harnesses that bypass the framework's replay logic, etc.
 */
function sanitizeToolNamesInMessages(messages: unknown[]): unknown[] {
  let out: unknown[] | undefined;
  for (let i = 0; i < messages.length; i += 1) {
    const msg = messages[i];
    if (msg === null || typeof msg !== "object") continue;
    const record = msg as Record<string, unknown>;
    const content = record.content;
    if (!Array.isArray(content)) continue;
    let nextContent: unknown[] | undefined;
    for (let j = 0; j < content.length; j += 1) {
      const part = content[j];
      if (part === null || typeof part !== "object") continue;
      const partRecord = part as Record<string, unknown>;
      const toolName = partRecord.toolName;
      if (typeof toolName !== "string") continue;
      const alias = sanitizeToolName(toolName);
      if (alias === toolName) continue;
      if (nextContent === undefined) nextContent = content.slice();
      nextContent[j] = { ...partRecord, toolName: alias };
    }
    if (nextContent !== undefined) {
      if (out === undefined) out = messages.slice();
      out[i] = { ...record, content: nextContent };
    }
  }
  return out ?? messages;
}

// Alias disambiguation lives in `helpers/tool-name.ts` (`ensureUniqueAlias`,
// `computeToolAliases`) so the framework-owned generator step loop can
// pre-compute the exact aliases this adapter assigns. See the seam note on
// `computeToolAliases`.

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

function asProviderMetadata(
  value: unknown
): Record<string, Record<string, unknown>> | undefined {
  const record = asRecord(value);
  if (record === undefined) {
    return undefined;
  }

  const normalized: Record<string, Record<string, unknown>> = {};
  for (const [provider, metadata] of Object.entries(record)) {
    const providerRecord = asRecord(metadata);
    if (providerRecord !== undefined) {
      normalized[provider] = providerRecord;
    }
  }

  return Object.keys(normalized).length === 0 ? undefined : normalized;
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

// ---------------------------------------------------------------------------
// Shared request builder — single place to compile AI SDK config
// ---------------------------------------------------------------------------

function buildAiSdkRequest(
  languageModel: unknown,
  options: {
    messages: unknown[];
    tools?: GeneratorModelTool[];
    providerTools?: ProviderTool[];
    outputSchema?: unknown;
    maxTokens?: number;
    signal?: AbortSignal;
    maxSteps?: number;
    providerOptions?: Record<string, unknown>;
    prepareStep?: PrepareStepFn;
    caching?: CachingConfig;
  },
  resolveLanguageModel?: ResolveAiSdkLanguageModel
): { request: Record<string, unknown>; toolNameMap: ToolNameMap | undefined } {
  // Historical tool-call / tool-result messages carry the framework's tool
  // names (e.g. `tf.memory/recall`). When AI SDK serialises those into
  // OpenAI's request format the toolName lands in `input[N].name`, which
  // OpenAI validates against the same /^[a-zA-Z0-9_-]+$/ pattern as tool
  // names. Sanitize every toolName reference in inbound messages so the
  // alias the model previously saw matches the alias it sees now.
  const request: Record<string, unknown> = {
    model: languageModel,
    messages: sanitizeToolNamesInMessages(options.messages),
    // AI SDK 7 rejects system messages inside `messages` by default. The
    // framework deliberately keeps the system prefix in `messages` (rather
    // than migrating to the `instructions` option): `applyCaching` anchors
    // Anthropic cache markers on the last `role: "system"` message, and the
    // generator's prepareStep slices the system prefix out of `messages`.
    allowSystemInMessages: true
  };

  // Compile block tools — include execute if provided (enables AI SDK auto-execution)
  const hasBlockTools = options.tools !== undefined && options.tools.length > 0;
  const hasProviderTools = options.providerTools !== undefined && options.providerTools.length > 0;

  // Reverse map: alias (sent to model) → original framework name. Only
  // populated when we actually rename a tool, so callers can skip the
  // translation step when no renaming happened.
  let toolNameMap: Map<string, string> | undefined;

  if (hasBlockTools || hasProviderTools) {
    const compiled: Record<string, unknown> = {};

    // Block tools: compiled with description, inputSchema, optional execute
    if (hasBlockTools) {
      for (const tool of options.tools!) {
        const alias = ensureUniqueAlias(sanitizeToolName(tool.name), compiled);
        const entry: Record<string, unknown> = {
          description: tool.description,
          inputSchema:
            tool.parameters ?? {
              type: "object",
              properties: {},
              additionalProperties: true
            }
        };
        if (tool.execute !== undefined) {
          entry.execute = tool.execute;
        }
        // Forward the block's `mapModelOutput` mapper as the AI SDK's
        // `toModelOutput`. The AI SDK invokes it when materialising tool-
        // result content for the next-turn assistant message; the framework's
        // `block_tool_output` items continue to carry the structured value.
        // The framework mapper returns a plain string; wrap it in the SDK's
        // `ToolResultOutput` content envelope here so block authors don't
        // need to know about the SDK's content shape. AI SDK 7 canonicalized
        // the content variant to `text` + `file` entries only (the v6
        // `image-*`/legacy `file-*` parts are gone); this bridge emits `text`.
        if (tool.toModelOutput !== undefined) {
          const mapper = tool.toModelOutput;
          entry.toModelOutput = async ({ output }: { output: unknown }) => {
            const text = await mapper(output);
            return { type: "content" as const, value: [{ type: "text" as const, text }] };
          };
        }
        compiled[alias] = entry;
        if (alias !== tool.name) {
          if (toolNameMap === undefined) toolNameMap = new Map();
          toolNameMap.set(alias, tool.name);
        }
      }
    }

    // Provider tools: raw AI SDK tool objects, passed through without compilation.
    // The provider handles execution server-side. Provider tool names already
    // come from the provider SDK and conform to its pattern, but sanitize for
    // safety so downstream stream-chunk reverse-mapping is consistent.
    if (hasProviderTools) {
      for (const pt of options.providerTools!) {
        const alias = ensureUniqueAlias(sanitizeToolName(pt.name), compiled);
        compiled[alias] = pt.tool;
        if (alias !== pt.name) {
          if (toolNameMap === undefined) toolNameMap = new Map();
          toolNameMap.set(alias, pt.name);
        }
      }
    }

    request.tools = compiled;
  }

  // Multi-step: stopWhen controls when the AI SDK's loop terminates.
  // Default is isStepCount(1) in the SDK, so only override when > 1.
  const maxSteps = options.maxSteps ?? 1;
  if (maxSteps > 1) {
    request.stopWhen = isStepCount(maxSteps);
  }

  // prepareStep: called by the AI SDK before each step in the multi-step
  // loop. The generator uses this to re-resolve dynamic context/prompt
  // slot functions so the LLM sees fresh state on every iteration.
  if (options.prepareStep !== undefined) {
    const fn = options.prepareStep;
    request.prepareStep = async (stepInfo: {
      stepNumber: number;
      messages: unknown[];
      steps: unknown[];
      model: unknown;
    }) => {
      const result = await fn({
        stepNumber: stepInfo.stepNumber,
        messages: stepInfo.messages,
        steps: normalizeSteps(stepInfo.steps) ?? []
      });

      // When the callback returns a modelId and a resolver is available,
      // re-resolve the model ID to an AI SDK LanguageModel for this step.
      if (result?.modelId !== undefined && resolveLanguageModel !== undefined) {
        const { modelId: _modelId, ...rest } = result;
        return { ...rest, model: resolveLanguageModel(result.modelId) };
      }

      return result;
    };
  }

  if (options.outputSchema !== undefined) {
    // Transform the schema so all properties are required — OpenAI's
    // structured output API rejects schemas with optional properties.
    // The original schema is still used for response validation, where
    // Zod's .safeParse() applies .default() values automatically.
    const strictSchema = makeSchemaStrict(options.outputSchema as any);
    request.output = Output.object({ schema: strictSchema as any });
  }

  if (options.maxTokens !== undefined) {
    request.maxOutputTokens = options.maxTokens;
  }

  if (options.signal !== undefined) {
    request.abortSignal = options.signal;
  }

  if (options.providerOptions !== undefined) {
    request.providerOptions = options.providerOptions;
  }

  // Apply prompt-cache markers (Anthropic cacheControl / gateway auto)
  // after the request is otherwise finalised. User-set markers from
  // `providerOptions` are never overwritten.
  applyCaching(request, options.caching, languageModel);

  return { request, toolNameMap };
}

// ---------------------------------------------------------------------------
// Result normalisers — extract framework types from AI SDK results
// ---------------------------------------------------------------------------

function normalizeSources(value: unknown): GeneratorModelSource[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const sources: GeneratorModelSource[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const rec = asRecord(value[index]);
    if (rec === undefined || typeof rec.url !== "string") {
      continue;
    }

    sources.push({
      type: "source",
      sourceType: "url",
      id:
        (typeof rec.id === "string" ? rec.id : undefined) ??
        (typeof rec.sourceId === "string" ? rec.sourceId : undefined) ??
        `source_${index}`,
      url: rec.url,
      title: typeof rec.title === "string" ? rec.title : undefined,
      providerMetadata: asProviderMetadata(rec.providerMetadata)
    });
  }

  return sources.length > 0 ? sources : undefined;
}

function normalizeToolResults(
  value: unknown,
  toolNameMap?: ToolNameMap
): Array<{ toolCallId: string; toolName: string; result: unknown }> | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }

  const results: Array<{ toolCallId: string; toolName: string; result: unknown }> = [];
  for (const item of value) {
    const record = asRecord(item);
    if (record === undefined) continue;

    const toolCallId =
      typeof record.toolCallId === "string" ? record.toolCallId : undefined;
    const toolName =
      typeof record.toolName === "string" ? record.toolName : undefined;
    if (toolCallId === undefined || toolName === undefined) continue;

    results.push({
      toolCallId,
      toolName: resolveOriginalToolName(toolName, toolNameMap),
      result: record.result ?? record.output
    });
  }

  return results.length === 0 ? undefined : results;
}

function normalizeSteps(
  value: unknown,
  toolNameMap?: ToolNameMap
): GeneratorStepResult[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }

  const steps: GeneratorStepResult[] = [];
  for (const step of value) {
    const record = asRecord(step);
    if (record === undefined) continue;

    steps.push({
      text: typeof record.text === "string" ? record.text : undefined,
      toolCalls: normalizeToolCalls(record.toolCalls, toolNameMap),
      toolResults: normalizeToolResults(record.toolResults, toolNameMap),
      finishReason: normalizeFinishReason(record.finishReason),
      usage: normalizeUsage(
        record.usage,
        record.providerMetadata ?? record.experimental_providerMetadata
      )
    });
  }

  return steps.length === 0 ? undefined : steps;
}

/**
 * Extract the provider-reported model id from an AI SDK result, when
 * present. Surfaces as the preferred `actual` for `ModelIdentity`. Returns
 * undefined when the provider didn't report a modelId.
 *
 * On AI SDK 7 the top-level `response` is deprecated (generate) or a
 * PromiseLike (stream); the final step's `response` carries the id. Reads
 * `finalStep.response` first and falls back to a plain `response` for
 * callers that pass a step record or an error payload.
 */
function extractProviderModelId(result: Record<string, unknown>): string | undefined {
  const finalStep = asRecord(result.finalStep);
  const response = asRecord(finalStep?.response) ?? asRecord(result.response);
  const id = response?.modelId;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

/**
 * Extracts a step's RAW response messages (`step.response.messages`, v7's
 * `ModelMessage[]` for the step's assistant turn + any SDK-executed tool
 * results). Surfaced as `GeneratorModelResult.responseMessages` — the
 * live-fidelity carrier the framework-owned step loop appends verbatim so
 * reasoning/thinking parts (and their provider signatures) round-trip
 * between steps. Deliberately NOT alias-translated: these messages go back
 * to the model, so they must keep the model-facing tool aliases.
 */
function extractResponseMessages(
  step: Record<string, unknown> | undefined
): unknown[] | undefined {
  const response = asRecord(step?.response);
  const messages = response?.messages;
  return Array.isArray(messages) && messages.length > 0 ? messages : undefined;
}

function normalizeGenerateResult(
  result: Record<string, unknown>,
  toolNameMap?: ToolNameMap
): GeneratorModelResult {
  const text = typeof result.text === "string" ? result.text : undefined;
  const structuredOutput =
    normalizeStructuredOutput(result) ??
    parseStructuredOutputFromText(text);

  // AI SDK 7: top-level `toolCalls` accumulates across steps and top-level
  // `providerMetadata` is deprecated — final-step values live on `finalStep`.
  // The framework result keeps v6 semantics (final step only) for both, so a
  // multi-step run whose final step ends in text does not re-report earlier
  // steps' tool calls. The only caller passes a real `generateText` result,
  // where `finalStep` is non-optional — no top-level fallbacks (falling back
  // to accumulated `result.toolCalls` would silently reintroduce
  // across-steps semantics). `usage` deliberately stays the top-level
  // accumulated total: cost accounting wants the whole call, per-step usage
  // is in `steps`.
  const finalStep = asRecord(result.finalStep);
  const rawProviderMeta = finalStep?.providerMetadata;
  return {
    text,
    structuredOutput,
    toolCalls: normalizeToolCalls(finalStep?.toolCalls, toolNameMap),
    finishReason: normalizeFinishReason(result.finishReason),
    usage: normalizeUsage(result.usage, rawProviderMeta),
    providerMetadata: asProviderMetadata(rawProviderMeta),
    steps: normalizeSteps(result.steps, toolNameMap),
    sources: normalizeSources(result.sources),
    responseMessages: extractResponseMessages(finalStep)
  };
}

/**
 * Settled finish metadata gathered from a v7 `StreamTextResult` once the
 * stream has completed. Every field is awaited by the caller before it gets
 * here — the v7 result exposes them as PromiseLike properties, and handing
 * a raw promise to the normalizers would silently drop the metadata.
 */
interface SettledStreamFinish {
  /** `await result.finalStep` — final-step-only values (text, toolCalls, providerMetadata, response). */
  finalStep: Record<string, unknown> | undefined;
  /** `await result.finishReason` — the last step's unified finish reason. */
  finishReason: unknown;
  /** `await result.usage` — accumulated total across all steps (cost accounting wants the whole call). */
  usage: unknown;
  /** `await result.sources` — sources collected across all steps. */
  sources: unknown;
}

function normalizeFinishChunk(
  final: SettledStreamFinish,
  toolNameMap?: ToolNameMap
): Omit<GeneratorModelStreamChunk, "type"> {
  const step = final.finalStep ?? {};
  const text = typeof step.text === "string" ? step.text : undefined;
  const rawProviderMeta = step.providerMetadata;
  const finishReason =
    normalizeFinishReason(final.finishReason) ??
    normalizeFinishReason(step.finishReason);
  const usage = normalizeUsage(final.usage, rawProviderMeta);
  return {
    finishReason,
    usage,
    fullResult: {
      text,
      toolCalls: normalizeToolCalls(step.toolCalls, toolNameMap),
      finishReason,
      usage,
      providerMetadata: asProviderMetadata(rawProviderMeta),
      sources: normalizeSources(final.sources),
      responseMessages: extractResponseMessages(step)
    }
  };
}

// ---------------------------------------------------------------------------
// Provider search tool mapping
// ---------------------------------------------------------------------------

/**
 * Detects whether an object looks like an AI SDK provider with a `.tools`
 * namespace (e.g., the `openai` export from `@ai-sdk/openai`).
 */
function hasProviderTools(value: unknown): boolean {
  if (typeof value !== "function") {
    return false;
  }

  const obj = value as unknown as Record<string, unknown>;
  return typeof obj.tools === "object" && obj.tools !== null;
}

/**
 * Extracts the base provider name from an AI SDK language model's `provider`
 * property. Provider strings use dot-notation (e.g., "anthropic.chat",
 * "openai.chat") — we extract the prefix before the first dot.
 */
function detectProviderName(languageModel: unknown): string | undefined {
  const model = languageModel as Record<string, unknown> | undefined;
  const provider = model?.provider;
  if (typeof provider !== "string") {
    return undefined;
  }

  const dotIndex = provider.indexOf(".");
  return dotIndex > 0 ? provider.slice(0, dotIndex) : provider;
}

/**
 * Maps a normalized GeneratorSearchConfig to a provider-specific search tool.
 * Returns the raw AI SDK tool object + a display name, or undefined if the
 * provider doesn't support search tools.
 *
 * Unsupported config fields for a given provider are silently ignored.
 *
 * CONSTRAINT: the factory names below are string-indexed off the provider's
 * `.tools` namespace — a provider-package rename silently disables
 * `search: true` (this function just returns undefined) while the mocked
 * suite stays green. Inventory re-verified against the v7-paired provider
 * packages (2026-07-04):
 * - `@ai-sdk/anthropic@4.0.8` exports `anthropic.tools.webSearch_20250305`
 *   (a newer `webSearch_20260209` also exists — not adopted, parity).
 * - `@ai-sdk/openai@4.0.7` (installed core devDependency):
 *   `createOpenAI(...).tools.webSearch` — pinned by the real-factory smoke
 *   in `test/models/provider-search-tools.test.ts`.
 * - `@ai-sdk/google@4.0.8` exports `google.tools.googleSearch`.
 * Anthropic/Google are not installed in this workspace, so their names are
 * covered by this inventory rather than a smoke test.
 */
function mapToProviderSearchTool(
  providerName: string,
  providerTools: Record<string, unknown>,
  config: GeneratorSearchConfig
): { name: string; tool: unknown } | undefined {
  // Anthropic: webSearch_20250305 or webSearch
  if (providerName === "anthropic") {
    const factory =
      (providerTools as any).webSearch_20250305 ??
      (providerTools as any).webSearch;
    if (typeof factory !== "function") {
      return undefined;
    }

    const opts: Record<string, unknown> = {};
    if (config.maxUses !== undefined) opts.maxUses = config.maxUses;
    if (config.allowedDomains !== undefined) opts.allowedDomains = config.allowedDomains;
    if (config.blockedDomains !== undefined) opts.blockedDomains = config.blockedDomains;
    if (config.userLocation !== undefined) opts.userLocation = config.userLocation;

    return {
      name: "web_search",
      tool: Object.keys(opts).length > 0 ? factory(opts) : factory()
    };
  }

  // OpenAI: webSearch
  if (providerName === "openai") {
    if (typeof (providerTools as any).webSearch !== "function") {
      return undefined;
    }

    const opts: Record<string, unknown> = {};
    if (config.searchDepth !== undefined) opts.searchContextSize = config.searchDepth;
    if (config.userLocation !== undefined) opts.userLocation = config.userLocation;

    return {
      name: "web_search",
      tool: Object.keys(opts).length > 0
        ? (providerTools as any).webSearch(opts)
        : (providerTools as any).webSearch()
    };
  }

  // Google / Vertex: googleSearch
  if (providerName === "google" || providerName === "vertex") {
    const factory =
      (providerTools as any).googleSearch ??
      (providerTools as any).google_search;
    if (typeof factory !== "function") {
      return undefined;
    }

    return {
      name: "google_search",
      tool: factory()
    };
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Identity hints passed to `wrapAiSdkModel` so the AI SDK adapter can
 * stamp a fully-formed `ModelIdentity` on every result/chunk. The framework
 * knows the requested string and (when applicable) the gateway from parsing
 * the model string before the wrap call; the adapter knows the
 * provider-reported model id from the AI SDK response.
 */
export interface WrapAiSdkModelIdentityHints {
  /** The framework's requested model string (e.g. `openai/gpt-5.5`). */
  requested?: string;
  /** Gateway name when the model was routed through a gateway. */
  gateway?: string;
}

/**
 * Wraps an AI SDK language model instance into a framework GeneratorModel.
 * Use this when you already have a resolved model (e.g. `openai("gpt-5")`)
 * and want to pass it directly as a generator's `model` config.
 *
 * Identity hints (`requested`, `gateway`) thread through so that
 * `ModelIdentity` surfaced on emitted items reflects what the caller asked
 * for in addition to what the provider reported.
 */
export function wrapAiSdkModel(
  languageModel: unknown,
  modelId?: string,
  identityHints?: WrapAiSdkModelIdentityHints
): GeneratorModel {
  const resolvedId =
    modelId ??
    (typeof (languageModel as Record<string, unknown>)?.modelId === "string"
      ? (languageModel as Record<string, unknown>).modelId as string
      : "unknown");

  return createGeneratorModelFromAiSdk(resolvedId, languageModel, undefined, undefined, identityHints);
}

/**
 * Builds the `ModelIdentity` payload to stamp on an AI SDK result or chunk.
 *
 * `actual` is the concrete model that ran: provider-reported id when present,
 * otherwise the framework's winning candidate string (`fallbackModelId` — never
 * the intent string, which would violate the `ModelIdentity` contract).
 *
 * `requested` is the caller's input — typically the framework requested
 * string, or the intent string when intent resolution surfaced one. Omitted
 * when equal to `actual` (the common direct-call case).
 */
function buildResolvedIdentity(
  providerReportedId: string | undefined,
  hints: WrapAiSdkModelIdentityHints | undefined,
  fallbackModelId: string
): { actual: string; requested?: string; gateway?: string } {
  const actual = providerReportedId ?? fallbackModelId;
  const requested = hints?.requested ?? fallbackModelId;
  const identity: { actual: string; requested?: string; gateway?: string } = { actual };
  if (requested !== actual) identity.requested = requested;
  if (hints?.gateway !== undefined) identity.gateway = hints.gateway;
  return identity;
}

function createGeneratorModelFromAiSdk(
  modelId: string,
  languageModel: unknown,
  providerWithTools: unknown | undefined,
  resolveLanguageModel?: ResolveAiSdkLanguageModel,
  identityHints?: WrapAiSdkModelIdentityHints
): GeneratorModel {
  /**
   * Enforce the single-step contract for `generateStep`/`streamStep`: strip
   * any `execute` closure so the SDK cannot run framework tools inside the
   * call. With no executable tools and no `stopWhen` override (the step
   * option bag has no `maxSteps`), `generateText`/`streamText` run exactly
   * one provider step and return the step's tool calls unexecuted — a
   * `tool-calls` finish is a normal return, not an error (structured-output
   * parsing only fires on a `stop` finish; the lazy `output` getter is
   * guarded by `normalizeStructuredOutput`).
   */
  const asStepOptions = (
    options: Parameters<NonNullable<GeneratorModel["generateStep"]>>[0]
  ): Parameters<GeneratorModel["generate"]>[0] => ({
    ...options,
    tools: options.tools?.map((tool) =>
      tool.execute === undefined ? tool : { ...tool, execute: undefined }
    ),
  });

  const model: GeneratorModel = {
    modelId,

    async generate(options): Promise<GeneratorModelResult> {
      const { request, toolNameMap } = buildAiSdkRequest(languageModel, options, resolveLanguageModel);
      try {
        const result = (await generateText(
          request as any
        )) as unknown as Record<string, unknown>;
        const normalized = normalizeGenerateResult(result, toolNameMap);
        normalized.resolvedIdentity = buildResolvedIdentity(
          extractProviderModelId(result),
          identityHints,
          modelId
        );
        return normalized;
      } catch (err: unknown) {
        // AI SDK throws NoObjectGeneratedError / NoOutputGeneratedError when
        // the model returns empty or unparseable output for structured generation.
        // Extract the diagnostic fields (text, cause, usage) before deciding
        // whether to recover or re-throw.
        const rec = err as Record<string, unknown> | undefined;
        const text = typeof rec?.text === "string" ? rec.text : undefined;
        const cause = rec?.cause;
        const usage = rec?.usage;
        const name = err instanceof Error ? err.name : "UnknownError";
        const message = err instanceof Error ? err.message : String(err);

        // Recoverable case (FIX-841): the model produced text, it just didn't
        // match the structured-output schema. Hand the raw text back as the
        // candidate so the generator's repair pipeline — deterministic
        // parse/jsonrepair, then LLM coercion — can try to reshape it instead
        // of crashing the block. Errors with no text (empty output, abort,
        // network) are not recoverable and still throw.
        const isStructuredParseFailure =
          (name === "AI_NoObjectGeneratedError" || name === "NoObjectGeneratedError") &&
          typeof text === "string" &&
          text.length > 0;
        if (isStructuredParseFailure) {
          const recovered: GeneratorModelResult = {
            text,
            structuredOutput: undefined,
            resolvedIdentity: buildResolvedIdentity(
              extractProviderModelId(rec ?? {}),
              identityHints,
              modelId
            ),
          };
          // Normalize usage the same way the success path does so recovered
          // calls don't drop prompt/completion tokens from cost accounting.
          const normalizedUsage = normalizeUsage(usage, rec?.providerMetadata);
          if (normalizedUsage !== undefined) {
            recovered.usage = normalizedUsage;
          }
          return recovered;
        }

        const details: string[] = [`[ai-sdk-generate] ${name}: ${message}`];
        if (text) details.push(`  model text: ${text.slice(0, 500)}`);
        if (cause) details.push(`  cause: ${cause instanceof Error ? cause.message : String(cause)}`);
        if (usage) details.push(`  usage: ${JSON.stringify(usage)}`);
        console.warn(details.join("\n"));

        throw err;
      }
    },

    async *stream(options): AsyncGenerator<GeneratorModelStreamChunk> {
      const { request, toolNameMap } = buildAiSdkRequest(languageModel, options, resolveLanguageModel);
      // Baseline identity from framework hints. The provider-reported model
      // id only lands on the final response, so chunks emitted before
      // `finish` carry this baseline; the `finish` chunk refines to the
      // provider id when present.
      let resolvedIdentity = buildResolvedIdentity(undefined, identityHints, modelId);

      // onError: AI SDK callback for streaming errors. Captures errors
      // inline rather than letting them surface as unhandled rejections.
      (request as Record<string, unknown>).onError = ({ error }: { error: unknown }) => {
        const rec = error as Record<string, unknown> | undefined;
        const text = typeof rec?.text === "string" ? rec.text : undefined;
        const cause = rec?.cause;
        const errName = error instanceof Error ? error.name : "UnknownError";
        const message = error instanceof Error ? error.message : String(error);
        const details: string[] = [`[ai-sdk-stream] ${errName}: ${message}`];
        if (text) details.push(`  model text: ${text.slice(0, 500)}`);
        if (cause) details.push(`  cause: ${cause instanceof Error ? cause.message : String(cause)}`);
        console.warn(details.join("\n"));
      };

      const result = streamText(request as any);

      // Track tool names announced by `tool-input-start` so subsequent
      // `tool-input-delta` parts (which carry only `id`/`delta` on the wire)
      // can report the tool they belong to.
      const toolNamesByCallId = new Map<string, string>();

      // Iterate `result.stream` to capture tool-call events during
      // multi-step loops, not just text deltas. AI SDK 7 `TextStreamPart`
      // types use hyphenated names: "text-delta", "reasoning-delta",
      // "tool-input-delta", "tool-call", "source", "finish", etc.; text and
      // reasoning deltas carry their payload in `text`.
      for await (const part of (result as any).stream) {
        const partRecord = part as Record<string, unknown>;
        let chunk: GeneratorModelStreamChunk | undefined;

        if (partRecord.type === "text-delta") {
          chunk = {
            type: "text_delta",
            textDelta: partRecord.text as string
          };
        } else if (partRecord.type === "reasoning-delta") {
          chunk = {
            type: "reasoning_delta",
            reasoningDelta: partRecord.text as string
          };
        } else if (partRecord.type === "tool-input-start") {
          toolNamesByCallId.set(partRecord.id as string, partRecord.toolName as string);
          chunk = {
            type: "tool_input_start",
            toolInput: {
              toolName: resolveOriginalToolName(partRecord.toolName as string, toolNameMap),
              providerExecuted: partRecord.providerExecuted === true ? true : undefined
            }
          };
        } else if (partRecord.type === "tool-input-delta") {
          // Incremental tool arguments. The part carries only `id`/`delta`;
          // the tool name is inherited from the matching `tool-input-start`.
          // Map to framework tool_call_delta so clients can show progress.
          const rawToolName = toolNamesByCallId.get(partRecord.id as string) ?? "";
          chunk = {
            type: "tool_call_delta",
            toolCallDelta: {
              toolCallId: partRecord.id as string,
              toolName: rawToolName === "" ? "" : resolveOriginalToolName(rawToolName, toolNameMap),
              argsDelta: partRecord.delta as string
            }
          };
        } else if (partRecord.type === "tool-call") {
          chunk = {
            type: "tool_call_delta",
            toolCallDelta: {
              toolCallId: partRecord.toolCallId as string,
              toolName: resolveOriginalToolName(partRecord.toolName as string, toolNameMap),
              argsDelta: JSON.stringify(partRecord.input)
            }
          };
        } else if (partRecord.type === "tool-result") {
          chunk = {
            type: "tool_result",
            toolResult: {
              toolCallId: partRecord.toolCallId as string,
              toolName: resolveOriginalToolName(partRecord.toolName as string, toolNameMap),
              result: partRecord.output
            }
          };
        } else if (partRecord.type === "source") {
          // Source references from provider-native tools (e.g., web search).
          // v7 source parts are flat; only the `sourceType: "url"` variant
          // carries a `url` (the `document` variant is filtered out here).
          const url = partRecord.url as string | undefined;
          if (typeof url === "string") {
            chunk = {
              type: "source_url",
              source: {
                type: "source",
                sourceType: "url",
                id:
                  (typeof partRecord.sourceId === "string" ? partRecord.sourceId : undefined) ??
                  (typeof partRecord.id === "string" ? partRecord.id : undefined) ??
                  `source_${Date.now()}_${Math.random().toString(16).slice(2)}`,
                url,
                title: typeof partRecord.title === "string" ? partRecord.title : undefined,
                providerMetadata: asProviderMetadata(partRecord.providerMetadata)
              }
            };
          }
        } else if (partRecord.type === "error") {
          console.error("[ai-sdk-stream] error event:", partRecord.error);
        } else if (partRecord.type === "tool-error") {
          console.error("[ai-sdk-stream] tool-error event:", partRecord.toolName, partRecord.error);
        } else if (partRecord.type === "abort") {
          console.warn("[ai-sdk-stream] abort event:", partRecord.reason);
        }

        if (chunk !== undefined) {
          chunk.resolvedIdentity = resolvedIdentity;
          yield chunk;
        }
      }

      // Gather finish metadata from the settled result. AI SDK 7's
      // StreamTextResult is not awaitable: finish values live on PromiseLike
      // properties that settle once the stream completes, and any property
      // the finish path consumes MUST be awaited here — a raw promise handed
      // to the normalizers would silently drop the metadata. The awaits may
      // reject (e.g. AI_NoOutputGeneratedError when the model produces no
      // output, abort errors on cancellation); catch and re-throw as a clear
      // error rather than leaking an unhandled rejection.
      let settledFinish: SettledStreamFinish;
      try {
        const resultPromises = result as unknown as {
          finalStep: PromiseLike<unknown>;
          finishReason: PromiseLike<unknown>;
          usage: PromiseLike<unknown>;
          sources: PromiseLike<unknown>;
        };
        const [finalStep, finishReason, usage, sources] = await Promise.all([
          resultPromises.finalStep,
          resultPromises.finishReason,
          resultPromises.usage,
          resultPromises.sources
        ]);
        settledFinish = {
          finalStep: asRecord(finalStep),
          finishReason,
          usage,
          sources
        };
      } catch (err: unknown) {
        // FIX-663: preserve the original error as `cause` so the wrap chain
        // is walkable (via `rootCause`/`isAbortLike`). Previously this threw
        // a string-concatenated message, which buried the AI Gateway's
        // doubly-wrapped "Invalid error response format: Gateway request
        // failed: This operation was aborted" (vercel/ai#9579) as opaque text
        // with no walkable cause. The clean top-level message keeps the
        // block-failure surface legible; the cause carries the detail.
        const cause = err instanceof Error ? err : new Error(String(err));
        const wrapped = new Error("AI SDK stream failed", { cause });
        wrapped.name = "ModelStreamError";
        throw wrapped;
      }
      // Refine identity with the provider-reported model id, when present.
      resolvedIdentity = buildResolvedIdentity(
        extractProviderModelId(settledFinish.finalStep ?? {}),
        identityHints,
        modelId
      );
      const finishChunk = normalizeFinishChunk(settledFinish, toolNameMap);
      if (finishChunk.fullResult !== undefined) {
        finishChunk.fullResult.resolvedIdentity = resolvedIdentity;
      }
      yield {
        type: "finish",
        ...finishChunk,
        resolvedIdentity
      };
    },

    resolveSearchTool(config: GeneratorSearchConfig) {
      // Detect provider from the language model's .provider property
      const providerName = detectProviderName(languageModel);
      if (providerName === undefined) {
        return undefined;
      }

      // Get the provider's tools namespace from the stored provider reference
      const tools = (providerWithTools as Record<string, unknown> | undefined)?.tools;
      if (typeof tools !== "object" || tools === null) {
        return undefined;
      }

      return mapToProviderSearchTool(providerName, tools as Record<string, unknown>, config);
    }
  };

  // Single-step methods for the framework-owned tool loop. Delegate to the
  // multi-step implementations with the step option bag (no `maxSteps`, no
  // `prepareStep`), which compiles to a request without `stopWhen` — the
  // SDK's default `isStepCount(1)` then guarantees exactly one provider
  // model call per invocation. See `asStepOptions` for the no-execute guard.
  model.generateStep = (options) => model.generate(asStepOptions(options));
  model.streamStep = (options) => model.stream!(asStepOptions(options));

  return model;
}

/**
 * Creates a framework ModelResolver backed by Vercel AI SDK `generateText`
 * and `streamText`. Accepts a provider function that maps model ID strings
 * to AI SDK language model instances (e.g. the `openai` export from
 * `@ai-sdk/openai`).
 *
 * When the resolver is a provider object with `.tools` (e.g., the `openai`
 * or `anthropic` export), provider-native search tools are automatically
 * available via generator's `search` config field.
 *
 * Both generate and stream paths use a shared request builder, so tools,
 * maxSteps, outputSchema, etc. are compiled identically regardless of
 * whether the caller requests full or streamed output.
 */
export function createAiSdkModelResolver(
  resolveLanguageModel: ResolveAiSdkLanguageModel
): ModelResolver {
  // Detect if the resolver itself is a provider object with .tools
  // (e.g., the `openai` or `anthropic` export from @ai-sdk/* packages).
  const providerWithTools = hasProviderTools(resolveLanguageModel)
    ? resolveLanguageModel
    : undefined;

  const resolver = ((modelId: string) =>
    createGeneratorModelFromAiSdk(
      modelId,
      resolveLanguageModel(modelId),
      providerWithTools,
      resolveLanguageModel
    )) as ModelResolver;

  // Direct AI SDK resolver — no presets, so model strings are already concrete.
  resolver.resolveId = (modelId: string): string => modelId;

  return resolver;
}
