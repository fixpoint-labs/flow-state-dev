import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import type {
  ItemQuery,
  JournalEntry,
  JournalEntryInput,
  JsonObject,
  JsonValue,
  LLMMessage,
  MessageLimit,
  CollectionHookContext,
  ProjectScopeHandle,
  RequestScopeHandle,
  ResourceConfig,
  ResourceRef,
  ResourceRegistry,
  ResourceCollectionConfig,
  ResourceCollectionRef,
  ScopeType,
  SessionItem,
  SessionItemViews,
  SessionMetadataInput,
  SessionScopeHandle,
  UserScopeHandle,
  FlowInstance,
  TokenCounter
} from "@flow-state-dev/core/types";
import {
  isDefinedResourceCollection,
  resolveCollectionKey,
  normalizeResourcePath,
  matchesPattern,
  getPatternPrefix,
} from "@flow-state-dev/core/types";
import type {
  BlockOutputItem,
  BlockToolOutputItem,
  ComponentItem,
  ContainerItem,
  Content,
  ItemProvenance,
  MessageItem,
  OutputItem,
  RouterDecisionItem,
  StateChangeItem,
  StatusItem
} from "@flow-state-dev/core/items";
import { resolveItemVisibility } from "@flow-state-dev/core/items";
import type { BlockContext, BlockResult, ExecutionParent, StateRef } from "@flow-state-dev/core/types";
import { createScopeStateOps, createStateContainer } from "../stores/state-container";
import type {
  ProjectRecord,
  RequestRecord,
  SessionRecord,
  UserRecord
} from "../stores/types";
import { createModelResolver } from "@flow-state-dev/core/models";
import type { ModelResolver } from "@flow-state-dev/core";
import { logRuntimeEvent, summarizeForLog } from "../execution/logging";
import { isTraceObservabilityEnabled } from "@flow-state-dev/core";
import {
  buildConnectedInputDebugPayload,
  buildGeneratorDebugPayload,
  emitBlockDebugItem,
} from "../execution/internal/debug-items";
import { AmbiguousBlockNameError } from "../errors/flow-error";
import { normalizeError } from "../errors/normalize-error";
import { cloneValue } from "../utils/clone";
import { isJsonObject, asJsonObject } from "../utils/json-helpers";
import type { CreateExecutionContextOptions, ExecutionContext } from "./types";

function normalizeLimit(
  valuesLength: number,
  limit: MessageLimit | undefined
): number {
  if (limit === undefined) {
    return valuesLength;
  }

  if (typeof limit === "number") {
    return Math.max(0, Math.min(valuesLength, limit));
  }

  return Math.max(0, Math.min(valuesLength, limit.tokens));
}

function listByQuery<TValue>(
  values: TValue[],
  query: { limit?: MessageLimit } | undefined
): TValue[] {
  const max = normalizeLimit(values.length, query?.limit);
  if (max >= values.length) {
    return [...values];
  }

  return values.slice(Math.max(0, values.length - max));
}

function normalizeResourceDefault(config: ResourceConfig): JsonObject {
  if (config.default !== undefined && isJsonObject(config.default)) {
    return cloneValue(config.default);
  }

  const parsedFromUndefined = config.stateSchema.safeParse(undefined);
  if (parsedFromUndefined.success && isJsonObject(parsedFromUndefined.data)) {
    return asJsonObject(parsedFromUndefined.data);
  }

  const parsedFromEmptyObject = config.stateSchema.safeParse({});
  if (parsedFromEmptyObject.success && isJsonObject(parsedFromEmptyObject.data)) {
    return asJsonObject(parsedFromEmptyObject.data);
  }

  return {};
}

function normalizeStateDefault(
  stateSchema: { safeParse: (value: unknown) => { success: boolean; data?: unknown } } | undefined
): JsonObject {
  if (stateSchema === undefined) {
    return {};
  }

  const parsedFromUndefined = stateSchema.safeParse(undefined);
  if (parsedFromUndefined.success) {
    return asJsonObject(parsedFromUndefined.data);
  }

  const parsedFromEmptyObject = stateSchema.safeParse({});
  if (parsedFromEmptyObject.success) {
    return asJsonObject(parsedFromEmptyObject.data);
  }

  return {};
}

function normalizeResourceState(
  config: ResourceConfig,
  value: unknown
): JsonObject {
  const parsed = config.stateSchema.safeParse(value);
  if (parsed.success && isJsonObject(parsed.data)) {
    return asJsonObject(parsed.data);
  }

  return normalizeResourceDefault(config);
}

function isCollectionConfig(config: unknown): config is ResourceCollectionConfig {
  return (
    typeof config === "object" &&
    config !== null &&
    "pattern" in config &&
    typeof (config as ResourceCollectionConfig).pattern === "string"
  );
}

function normalizeScopeResources(
  configs: Record<string, ResourceConfig | ResourceCollectionConfig> | undefined,
  seed: Record<string, unknown> | undefined
): Record<string, JsonObject> {
  const normalized: Record<string, JsonObject> = {};

  for (const [resourceName, config] of Object.entries(configs ?? {})) {
    // Skip collection configs — their instances are stored with path-based keys
    if (isCollectionConfig(config)) continue;

    normalized[resourceName] = normalizeResourceState(
      config,
      seed?.[resourceName]
    );
  }

  // Preserve any collection instance data from seed
  if (seed !== undefined) {
    for (const [key, value] of Object.entries(seed)) {
      if (key in normalized) continue; // already handled as static
      if (isJsonObject(value)) {
        normalized[key] = asJsonObject(value);
      }
    }
  }

  return normalized;
}

function normalizeScopeResourceContent(
  configs: Record<string, ResourceConfig | ResourceCollectionConfig> | undefined,
  seed: Record<string, unknown> | undefined
): Record<string, string> {
  const normalized: Record<string, string> = {};

  for (const [resourceName, config] of Object.entries(configs ?? {})) {
    // Skip collection configs — collection instances don't have definition-time content
    if (isCollectionConfig(config)) continue;

    const existing = seed?.[resourceName];
    if (typeof existing === "string") {
      normalized[resourceName] = existing;
      continue;
    }

    if (typeof config.content === "string") {
      normalized[resourceName] = config.content;
      continue;
    }

    if (typeof config.contentFile === "string") {
      try {
        // contentFile is resolved relative to process.cwd()
        normalized[resourceName] = readFileSync(config.contentFile, "utf8");
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Failed to load contentFile for resource "${resourceName}" (path: ${config.contentFile}): ${message}`
        );
      }
    }
  }

  // Preserve any collection instance content from seed
  if (seed !== undefined) {
    for (const [key, value] of Object.entries(seed)) {
      if (key in normalized) continue;
      if (typeof value === "string") {
        normalized[key] = value;
      }
    }
  }

  return normalized;
}

function asJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => asJsonValue(entry)) as JsonValue;
  }

  if (!isJsonObject(value)) {
    return {};
  }

  const out: JsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    out[key] = asJsonValue(entry);
  }

  return out;
}

function updateObjectState(
  currentState: JsonObject,
  updates: Partial<JsonObject>
): JsonObject {
  const next: JsonObject = {
    ...currentState
  };

  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) {
      delete next[key];
      continue;
    }

    next[key] = value;
  }

  return next;
}

function createScopeResourceRegistry<TResources extends Record<string, ResourceRef<any>>>(
  options: {
    scope: ScopeType;
    configs: Record<string, ResourceConfig | ResourceCollectionConfig> | undefined;
    readResources: () => Record<string, JsonObject>;
    persistResources: (next: Record<string, JsonObject>) => Promise<void>;
    readResourceContent: () => Record<string, string>;
    persistResourceContent: (next: Record<string, string>) => Promise<void>;
    /** Called after any resource mutation so the streaming layer can push change events to clients. */
    onResourceChanged?: (resourcePath: string, changeType: "created" | "updated" | "deleted") => void;
  }
): ResourceRegistry<TResources> {
  const handles = {} as Record<string, ResourceRef<JsonObject> | ResourceCollectionRef<JsonObject>>;
  const configs = options.configs ?? {};

  const persistResourceState = async (
    name: string,
    config: ResourceConfig,
    next: unknown
  ): Promise<void> => {
    if (config.writable === false) {
      throw new Error(`Resource "${name}" is read-only`);
    }

    const nextResources = {
      ...options.readResources(),
      [name]: normalizeResourceState(config, next)
    };

    await options.persistResources(nextResources);
  };

  const persistResourceContent = async (
    name: string,
    content: string
  ): Promise<void> => {
    const nextContent = {
      ...options.readResourceContent(),
      [name]: content
    };

    await options.persistResourceContent(nextContent);
  };

  // --- Namespace instance persistence helpers ---
  const persistNamespaceInstanceState = async (
    storageKey: string,
    nsConfig: ResourceCollectionConfig,
    next: unknown
  ): Promise<void> => {
    const parsed = nsConfig.stateSchema.safeParse(next);
    const value = parsed.success && isJsonObject(parsed.data) ? asJsonObject(parsed.data) : {};

    const nextResources = {
      ...options.readResources(),
      [storageKey]: value
    };

    await options.persistResources(nextResources);
  };

  const deleteNamespaceInstance = async (
    storageKey: string
  ): Promise<void> => {
    const current = options.readResources();
    const next = { ...current };
    delete next[storageKey];

    await options.persistResources(next);

    // Also remove content if present
    const currentContent = options.readResourceContent();
    if (storageKey in currentContent) {
      const nextContent = { ...currentContent };
      delete nextContent[storageKey];
      await options.persistResourceContent(nextContent);
    }
  };

  /**
   * Create a ResourceRef for a collection instance at a given storage key.
   */
  function createNamespaceInstanceRef(
    storageKey: string,
    nsConfig: ResourceCollectionConfig,
    nsHookCtx?: CollectionHookContext
  ): ResourceRef<JsonObject> {
    const readState = (): JsonObject => {
      const raw = options.readResources()[storageKey];
      if (raw !== undefined) return cloneValue(raw);
      // Parse defaults from schema
      const parsed = nsConfig.stateSchema.safeParse({});
      return parsed.success && isJsonObject(parsed.data) ? asJsonObject(parsed.data) : {};
    };

    return {
      name: storageKey,
      scope: options.scope,
      config: nsConfig as unknown as ResourceConfig,
      get state() {
        return readState();
      },
      async patchState(updates: Partial<JsonObject>): Promise<void> {
        const prev = readState();
        await persistNamespaceInstanceState(
          storageKey,
          nsConfig,
          updateObjectState(prev, updates)
        );
        if (nsConfig.onInstanceUpdated && nsHookCtx) {
          await nsConfig.onInstanceUpdated(
            storageKey,
            readState(),
            prev,
            nsHookCtx
          );
        }
        options.onResourceChanged?.(storageKey, "updated");
      },
      async setState(nextState: JsonObject): Promise<void> {
        const prev = readState();
        await persistNamespaceInstanceState(storageKey, nsConfig, nextState);
        if (nsConfig.onInstanceUpdated && nsHookCtx) {
          await nsConfig.onInstanceUpdated(
            storageKey,
            readState(),
            prev,
            nsHookCtx
          );
        }
        options.onResourceChanged?.(storageKey, "updated");
      },
      async updateState(
        updater: (state: JsonObject) => JsonObject | Promise<JsonObject>
      ): Promise<void> {
        const prev = readState();
        const next = await updater(prev);
        await persistNamespaceInstanceState(storageKey, nsConfig, next);
        if (nsConfig.onInstanceUpdated && nsHookCtx) {
          await nsConfig.onInstanceUpdated(
            storageKey,
            readState(),
            prev,
            nsHookCtx
          );
        }
        options.onResourceChanged?.(storageKey, "updated");
      },
      async readContentRaw(): Promise<string | null> {
        const content = options.readResourceContent()[storageKey];
        return typeof content === "string" ? content : null;
      },
      async readContent(): Promise<string | null> {
        const raw = options.readResourceContent()[storageKey];
        return typeof raw === "string" ? raw : null;
      },
      async writeContent(content: string): Promise<void> {
        const nextContent = {
          ...options.readResourceContent(),
          [storageKey]: content
        };
        await options.persistResourceContent(nextContent);
        options.onResourceChanged?.(storageKey, "updated");
      }
    };
  }

  for (const [resourceName, config] of Object.entries(configs)) {
    if (isCollectionConfig(config)) {
      // --- Create collection ref ---
      const nsConfig = config;
      // LRU tracking: storageKey → last access timestamp
      const lruAccess = new Map<string, number>();

      /** Populated hook context for lifecycle callbacks. */
      const hookCtx: CollectionHookContext = {
        log: (_message: string) => {
          // Hook log messages are available for debugging; runtime logger
          // integration is handled at a higher level when available.
        },
        scopeType: options.scope,
      };

      const nsHandle: ResourceCollectionRef<JsonObject> = {
        pattern: nsConfig.pattern,
        scope: options.scope,
        config: nsConfig,

        get(key: string | Record<string, string>): ResourceRef<JsonObject> {
          const storageKey = resolveCollectionKey(nsConfig.pattern, key);
          const resources = options.readResources();
          if (!(storageKey in resources)) {
            throw new Error(`Resource instance "${storageKey}" not found in collection "${nsConfig.pattern}"`);
          }
          lruAccess.set(storageKey, Date.now());
          return createNamespaceInstanceRef(storageKey, nsConfig, hookCtx);
        },

        getOptional(key: string | Record<string, string>): ResourceRef<JsonObject> | undefined {
          const storageKey = resolveCollectionKey(nsConfig.pattern, key);
          const resources = options.readResources();
          if (!(storageKey in resources)) {
            return undefined;
          }
          lruAccess.set(storageKey, Date.now());
          return createNamespaceInstanceRef(storageKey, nsConfig, hookCtx);
        },

        async create(
          key: string | Record<string, string>,
          initial?: Partial<JsonObject>
        ): Promise<ResourceRef<JsonObject>> {
          const storageKey = resolveCollectionKey(nsConfig.pattern, key);

          // Validate that key matches pattern
          if (!matchesPattern(nsConfig.pattern, storageKey)) {
            throw new Error(
              `Key "${storageKey}" does not match collection pattern "${nsConfig.pattern}"`
            );
          }

          const resources = options.readResources();
          if (storageKey in resources) {
            throw new Error(`Resource instance "${storageKey}" already exists`);
          }

          // Check instance limits
          const currentCount = countInstances(nsConfig.pattern, resources);
          if (nsConfig.maxInstances !== undefined && currentCount >= nsConfig.maxInstances) {
            const eviction = nsConfig.eviction ?? "none";
            if (eviction === "none") {
              throw new Error(
                `Namespace "${nsConfig.pattern}" has reached maxInstances (${nsConfig.maxInstances})`
              );
            }
            // Evict one instance — persists the deletion
            await evictInstance(nsConfig, resources, eviction, lruAccess, options.persistResources, hookCtx);
          }

          // Validate state via schema — throw on invalid input, never silent fallback
          const parseResult = nsConfig.stateSchema.safeParse(initial ?? {});
          if (!parseResult.success) {
            const issue = parseResult.error.issues[0];
            const issuePath = issue === undefined ? "" : issue.path.join(".");
            const issueMessage = issue === undefined ? "schema validation failed" : issue.message;
            const pathSuffix = issuePath.length > 0 ? ` at "${issuePath}"` : "";
            throw new Error(
              `Namespace "${nsConfig.pattern}" create("${storageKey}") state validation failed${pathSuffix}: ${issueMessage}`
            );
          }

          const state = isJsonObject(parseResult.data) ? asJsonObject(parseResult.data) : {};

          const nextResources = { ...resources, [storageKey]: state };
          await options.persistResources(nextResources);

          lruAccess.set(storageKey, Date.now());

          if (nsConfig.onInstanceCreated) {
            await nsConfig.onInstanceCreated(storageKey, state, hookCtx);
          }

          options.onResourceChanged?.(storageKey, "created");

          return createNamespaceInstanceRef(storageKey, nsConfig, hookCtx);
        },

        async getOrCreate(
          key: string | Record<string, string>,
          initial?: Partial<JsonObject>
        ): Promise<ResourceRef<JsonObject>> {
          const storageKey = resolveCollectionKey(nsConfig.pattern, key);
          const resources = options.readResources();
          if (storageKey in resources) {
            lruAccess.set(storageKey, Date.now());
            return createNamespaceInstanceRef(storageKey, nsConfig, hookCtx);
          }
          return nsHandle.create(key, initial);
        },

        list(prefix?: string): ResourceRef<JsonObject>[] {
          const resources = options.readResources();
          const instances: ResourceRef<JsonObject>[] = [];

          for (const storageKey of Object.keys(resources)) {
            if (!matchesPattern(nsConfig.pattern, storageKey)) continue;
            if (prefix !== undefined) {
              const nsPrefix = getPatternPrefix(nsConfig.pattern);
              const fullPrefix = nsPrefix.length > 0 ? `${nsPrefix}/${prefix}` : prefix;
              if (!storageKey.startsWith(fullPrefix)) continue;
            }
            instances.push(createNamespaceInstanceRef(storageKey, nsConfig, hookCtx));
          }

          return instances;
        },

        async delete(key: string | Record<string, string>): Promise<void> {
          const storageKey = resolveCollectionKey(nsConfig.pattern, key);
          const resources = options.readResources();
          if (!(storageKey in resources)) {
            // Idempotent — no-op if instance doesn't exist
            return;
          }

          await deleteNamespaceInstance(storageKey);
          lruAccess.delete(storageKey);

          if (nsConfig.onInstanceDeleted) {
            await nsConfig.onInstanceDeleted(storageKey, hookCtx);
          }

          options.onResourceChanged?.(storageKey, "deleted");
        },

        count(): number {
          const resources = options.readResources();
          return countInstances(nsConfig.pattern, resources);
        }
      };

      handles[resourceName] = nsHandle as unknown as ResourceRef<JsonObject>;
      continue;
    }

    // --- Static resource (unchanged) ---
    const readState = (): JsonObject =>
      cloneValue(
        options.readResources()[resourceName] ??
          normalizeResourceDefault(config)
      );

    handles[resourceName] = {
      name: resourceName,
      scope: options.scope,
      config,
      get state() {
        return readState();
      },
      async patchState(updates: Partial<JsonObject>): Promise<void> {
        await persistResourceState(
          resourceName,
          config,
          updateObjectState(readState(), updates)
        );
      },
      async setState(nextState: JsonObject): Promise<void> {
        await persistResourceState(resourceName, config, nextState);
      },
      async updateState(
        updater: (
          state: JsonObject
        ) => JsonObject | Promise<JsonObject>
      ): Promise<void> {
        const next = await updater(readState());
        await persistResourceState(resourceName, config, next);
      },
      async readContentRaw(): Promise<string | null> {
        const content = options.readResourceContent()[resourceName];
        return typeof content === "string" ? content : null;
      },
      async readContent(): Promise<string | null> {
        const raw = options.readResourceContent()[resourceName];
        if (typeof raw !== "string") {
          return null;
        }

        if (config.render === undefined) {
          return raw;
        }

        return await config.render(raw, readState());
      },
      async writeContent(content: string): Promise<void> {
        if (config.writable === false) {
          throw new Error(`Resource "${resourceName}" content is read-only`);
        }

        await persistResourceContent(resourceName, content);
      }
    };
  }

  return {
    ...(handles as TResources),
    get(name) {
      const handle = handles[String(name)];
      if (handle === undefined) {
        throw new Error(`Resource "${String(name)}" is not registered`);
      }

      return handle as TResources[keyof TResources];
    },
    list() {
      return Object.values(handles) as Array<TResources[keyof TResources]>;
    }
  } as ResourceRegistry<TResources>;
}

function countInstances(
  pattern: string,
  resources: Record<string, JsonObject>
): number {
  let count = 0;
  for (const key of Object.keys(resources)) {
    if (matchesPattern(pattern, key)) count++;
  }
  return count;
}

async function evictInstance(
  nsConfig: ResourceCollectionConfig,
  resources: Record<string, JsonObject>,
  policy: "lru" | "oldest",
  lruAccess: Map<string, number>,
  persistResources: (next: Record<string, JsonObject>) => Promise<void>,
  hookCtx: CollectionHookContext
): Promise<void> {
  const keys = Object.keys(resources).filter((k) =>
    matchesPattern(nsConfig.pattern, k)
  );

  if (keys.length === 0) return;

  let evictKey: string;
  if (policy === "lru") {
    // Evict least-recently-used (lowest timestamp in lruAccess)
    evictKey = keys.reduce((oldest, key) => {
      const oldestTime = lruAccess.get(oldest) ?? 0;
      const keyTime = lruAccess.get(key) ?? 0;
      return keyTime < oldestTime ? key : oldest;
    }, keys[0]!);
  } else {
    // "oldest" — evict first key (insertion order)
    evictKey = keys[0]!;
  }

  // Remove from in-memory map and persist the deletion
  delete resources[evictKey];
  await persistResources({ ...resources });
  lruAccess.delete(evictKey);

  if (nsConfig.onInstanceDeleted) {
    await nsConfig.onInstanceDeleted(evictKey, hookCtx);
  }
}

function ensureJournalDefaults(record: SessionRecord): void {
  if (!Array.isArray(record.journal)) {
    record.journal = [];
  }
}

function defineStateProperty<THandle extends object, TState extends object>(
  handle: THandle,
  readState: () => Readonly<TState>
): THandle & { readonly state: Readonly<TState> } {
  return Object.defineProperty(handle, "state", {
    enumerable: true,
    get: readState
  }) as THandle & { readonly state: Readonly<TState> };
}

/**
 * Set of item types that enter LLM context.
 * `block_output` is conditional — only when it has a `toolCall` field (legacy).
 * `block_tool_output` is the dedicated tool-result type.
 */
const LLM_AUDIENCE_TYPES = new Set([
  "message",
  "reasoning",
  "block_output",
  "block_tool_output"
]);

/**
 * Set of item types visible to the client.
 * `block_output`, `context` are NOT client-visible.
 */
const CLIENT_AUDIENCE_TYPES = new Set([
  "message",
  "reasoning",
  "component",
  "container",
  "block_tool_output",
  "status",
  "source",
  "state_change",
  "resource_change",
  "error",
  "step_error"
]);

/**
 * Converts a persisted OutputItem into an LLM-ready message.
 *
 * Items with `history: false` (resolved via `resolveItemVisibility`) are
 * excluded. Returns an empty array for item types that don't map to
 * conversation messages (status, state_change, resource_change, etc.).
 */
function itemToLLMMessages(item: OutputItem): LLMMessage[] {
  if (!resolveItemVisibility(item).history) {
    return [];
  }

  if (item.type === "message") {
    const msg = item as MessageItem;
    const text = (msg.content ?? [])
      .filter((c) => c.type === "output_text")
      .map((c) => (c as { text: string }).text)
      .join("");

    if (text.length === 0) {
      return [];
    }

    return [{ role: msg.role, content: text }];
  }

  if (item.type === "reasoning") {
    const summary = (item as { summary: Content[] }).summary ?? [];
    const text = summary
      .filter((c) => c.type === "output_text" || c.type === "reasoning_text")
      .map((c) => (c as { text: string }).text)
      .join("");

    return text.length > 0
      ? [{ role: "assistant", content: text }]
      : [];
  }

  if (item.type === "block_output") {
    const bo = item as BlockOutputItem;
    // Only enters LLM context when invoked as a tool by a generator (legacy path).
    if (bo.toolCall === undefined) {
      return [];
    }

    // AI SDK v6 requires tool messages as Array<ToolResultPart> (not strings)
    // and each tool result must be preceded by an assistant message containing
    // the matching tool-call part. Emit both in order.
    const resultText = typeof bo.output === "string"
      ? bo.output
      : JSON.stringify(bo.output);
    let input: Record<string, unknown> = {};
    try { input = JSON.parse(bo.toolCall.arguments); } catch { /* use empty */ }
    return [
      {
        role: "assistant",
        content: [{
          type: "tool-call",
          toolCallId: bo.toolCall.callId,
          toolName: bo.blockName,
          input
        }]
      },
      {
        role: "tool",
        content: [{
          type: "tool-result",
          toolCallId: bo.toolCall.callId,
          toolName: bo.blockName,
          output: { type: "text", value: resultText }
        }]
      }
    ];
  }

  if (item.type === "block_tool_output") {
    const bto = item as BlockToolOutputItem;
    const resultText = bto.status === "failed" && bto.error
      ? `Tool "${bto.toolCall.name}" failed: ${bto.error.message}`
      : typeof bto.output === "string"
        ? bto.output
        : JSON.stringify(bto.output);

    let input: Record<string, unknown> = {};
    try { input = JSON.parse(bto.toolCall.arguments); } catch { /* use empty */ }
    return [
      {
        role: "assistant",
        content: [{
          type: "tool-call",
          toolCallId: bto.toolCall.callId,
          toolName: bto.toolCall.name,
          input
        }]
      },
      {
        role: "tool",
        content: [{
          type: "tool-result",
          toolCallId: bto.toolCall.callId,
          toolName: bto.toolCall.name,
          output: { type: "text", value: resultText }
        }]
      }
    ];
  }

  return [];
}

/**
 * Trims orphaned tool messages from the start/end of a sliced message array.
 * AI SDK v6 requires assistant tool-call messages to be immediately followed
 * by their matching tool-result messages. When a numeric or token-based limit
 * slices mid-pair, the orphaned message causes models to produce empty output
 * (AI_NoOutputGeneratedError). This function:
 *  - Drops leading `tool` role messages (orphaned results without their call)
 *  - Drops trailing `assistant` messages that contain only tool-call parts
 *    (orphaned calls without their result)
 */
function trimOrphanedToolMessages(messages: LLMMessage[]): LLMMessage[] {
  let start = 0;
  let end = messages.length;

  // Trim leading orphaned tool-result messages
  while (start < end && messages[start]!.role === "tool") {
    start++;
  }

  // Trim trailing orphaned assistant tool-call messages
  while (end > start) {
    const last = messages[end - 1]!;
    if (last.role !== "assistant" || !Array.isArray(last.content)) break;
    const isToolCallOnly = last.content.every(
      (part: any) => part.type === "tool-call"
    );
    if (!isToolCallOnly) break;
    end--;
  }

  if (start === 0 && end === messages.length) return messages;
  return messages.slice(start, end);
}

/**
 * Loads conversation history from prior completed requests in this session,
 * converts to LLM-ready messages, and applies filtering/limiting.
 *
 * Optionally includes items from the current in-flight request via
 * `readLiveItems` so that blocks like `sessionTitleGenerator` running as
 * background work can see the current request's output.
 */
async function loadLLMHistory(
  priorRequests: RequestRecord[],
  tokenCounter: TokenCounter,
  resolveModelId: () => string,
  query?: ItemQuery,
  readLiveItems?: () => OutputItem[]
): Promise<LLMMessage[]> {

  const allowedTypes = query?.itemTypes
    ? new Set(query.itemTypes)
    : LLM_AUDIENCE_TYPES;
  const allowedRoles = query?.roles ? new Set(query.roles) : undefined;

  const messages: LLMMessage[] = [];

  function processItems(items: OutputItem[]): void {
    const sorted = [...items].sort((a, b) => {
      const tsDiff = a.ts - b.ts;
      return tsDiff !== 0 ? tsDiff : a.itemIndex - b.itemIndex;
    });

    for (const item of sorted) {
      if (item.transient === true) {
        continue;
      }

      if (!allowedTypes.has(item.type)) {
        continue;
      }

      const llmMessages = itemToLLMMessages(item);
      for (const llmMessage of llmMessages) {
        if (allowedRoles !== undefined && !allowedRoles.has(llmMessage.role as "user" | "assistant" | "system" | "developer" | "tool")) {
          continue;
        }

        messages.push(llmMessage);
      }
    }
  }

  for (const request of priorRequests) {
    if (request.items !== undefined) {
      processItems(request.items);
    }
  }

  // Include current request's live items so background work blocks (e.g.
  // sessionTitleGenerator) can see the just-completed output.
  if (readLiveItems !== undefined) {
    processItems(readLiveItems());
  }

  // Apply limit
  const limit = query?.limit;
  if (limit === undefined) {
    return messages;
  }

  if (typeof limit === "number") {
    const sliced = limit < messages.length
      ? messages.slice(messages.length - limit)
      : messages;
    // Ensure the slice didn't orphan a tool-result from its preceding
    // assistant tool-call. AI SDK v6 requires tool-call/tool-result pairs;
    // an orphaned tool-result causes models to produce empty output.
    return trimOrphanedToolMessages(sliced);
  }

  // Token-based limit: pack from end within budget
  const tokenBudget = limit.tokens;
  let tokensUsed = 0;
  let startIndex = messages.length;
  const model = resolveModelId();

  for (let i = messages.length - 1; i >= 0; i--) {
    const tokens = await tokenCounter.countMessages([messages[i]!], model);
    if (tokensUsed + tokens > tokenBudget) {
      break;
    }

    tokensUsed += tokens;
    startIndex = i;
  }

  return trimOrphanedToolMessages(messages.slice(startIndex));
}

/**
 * Converts an OutputItem (from the response emitter) to a SessionItem
 * so it can be included in the all() view alongside historical items.
 */
function outputItemToSessionItem(item: OutputItem): SessionItem {
  // Extract readable content for the payload based on item type.
  // Message items get their text extracted; other items pass through.
  let payload: unknown;
  if (item.type === "message") {
    const msg = item as MessageItem;
    const texts = msg.content
      .filter((c: Content) => c.type === "output_text")
      .map((c) => (c as { type: "output_text"; text: string }).text);
    payload = texts.length > 0 ? texts.join("") : msg.content;
  } else {
    payload = (item as Record<string, unknown>).output ?? item;
  }

  return {
    id: item.id,
    type: item.type,
    status: item.status,
    transient: item.transient,
    requestId: item.requestId,
    itemIndex: item.itemIndex,
    payload,
    ts: item.ts,
  };
}

function createSessionItemViews(
  priorItems: SessionItem[],
  priorRequests: RequestRecord[],
  options: {
    tokenCounter: TokenCounter;
    resolveModelId: () => string;
    readLiveItems?: () => OutputItem[];
  }
): SessionItemViews {
  // Compute once — priorItems is immutable for the request lifetime.
  const priorIds = new Set(priorItems.map((i) => i.id));

  const select = (
    query: ItemQuery | undefined,
    audienceTypes?: Set<string>,
    clientOnly?: boolean
  ): SessionItem[] => {
    const includeTransient = query?.includeTransient === true;
    const itemTypeFilter = query?.itemTypes
      ? new Set(query.itemTypes)
      : undefined;

    // Merge prior request items (loaded eagerly at context creation) with
    // live items from the current request's response emitter.
    const liveItems = options.readLiveItems?.() ?? [];
    const liveSessionItems = liveItems.map(outputItemToSessionItem);
    const deduplicatedLive = liveSessionItems.filter((i) => !priorIds.has(i.id));
    const allItems = [...priorItems, ...deduplicatedLive];

    const filtered = allItems.filter((item) => {
      if (!includeTransient && item.transient === true) {
        return false;
      }

      // Visibility-based audience filtering: client view uses resolveItemVisibility.
      if (clientOnly && !resolveItemVisibility(item as unknown as OutputItem).client) {
        return false;
      }

      // Type-based audience filtering when provided (for LLM audience).
      if (audienceTypes !== undefined && !audienceTypes.has(item.type)) {
        return false;
      }

      // Explicit item type filter from query.
      if (itemTypeFilter !== undefined && !itemTypeFilter.has(item.type)) {
        return false;
      }

      return true;
    });

    return listByQuery(filtered, { limit: query?.limit });
  };

  return {
    all: (query) => select(query),
    client: (query) => select(query, undefined, true),
    history: (query) =>
      loadLLMHistory(
        priorRequests,
        options.tokenCounter,
        options.resolveModelId,
        query,
        options.readLiveItems
      )
  };
}

function buildJournalEntry(entry: JournalEntryInput): JournalEntry {
  return {
    id: `journal_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    ts: Date.now(),
    ...entry
  };
}

type EmissionContext = {
  requestId: string;
  blockTransient: boolean;
  response: {
    emitItemAdded(item: OutputItem): Promise<unknown>;
    emitItemDone(item: OutputItem): Promise<unknown>;
    emitContentAdded?(itemId: string, contentIndex: number, content: Content): Promise<unknown>;
    emitContentDelta?(itemId: string, contentIndex: number, delta: string): Promise<unknown>;
    emitContentDone?(itemId: string, contentIndex: number, content: Content): Promise<unknown>;
  };
  provenance: () => ItemProvenance;
  nextItemIndex: () => number;
  /** Container ownership tag — set when emitting inside a container scope. */
  ownedBy?: string;
  /** Whether emitted items are sent to clients by default in this scope. */
  client: boolean;
  /** Whether emitted items enter LLM history by default in this scope. */
  history: boolean;
};

function createEmitMessage(
  emCtx: EmissionContext
): {
  (text: string, options?: { client?: boolean; history?: boolean }): void;
  (content: Content[], options?: { client?: boolean; history?: boolean }): void;
} {
  return function emitMessage(textOrContent: string | Content[], options?: { client?: boolean; history?: boolean }): void {
    const content: Content[] =
      typeof textOrContent === "string"
        ? [{ type: "output_text", text: textOrContent }]
        : textOrContent;

    const itemIndex = emCtx.nextItemIndex();
    const item: MessageItem = {
      id: `item_message_${itemIndex}_${Math.random().toString(16).slice(2)}`,
      type: "message",
      status: "completed",
      transient: emCtx.blockTransient || undefined,
      client: options?.client ?? emCtx.client,
      history: options?.history ?? emCtx.history,
      requestId: emCtx.requestId,
      itemIndex,
      provenance: emCtx.provenance(),
      ts: Date.now(),
      ownedBy: emCtx.ownedBy,
      role: "assistant",
      content
    };

    void emCtx.response.emitItemAdded(item);
    void emCtx.response.emitItemDone(item);
  };
}

function createEmitComponent(
  emCtx: EmissionContext
): (component: string, data: Record<string, unknown>, options?: { key?: string; client?: boolean; history?: boolean }) => void {
  return function emitComponent(
    component: string,
    data: Record<string, unknown>,
    options?: { key?: string; client?: boolean; history?: boolean }
  ): void {
    const itemIndex = emCtx.nextItemIndex();
    const item: ComponentItem = {
      id: `item_component_${itemIndex}_${Math.random().toString(16).slice(2)}`,
      type: "component",
      status: "completed",
      transient: emCtx.blockTransient || undefined,
      client: options?.client ?? emCtx.client,
      history: options?.history ?? emCtx.history,
      requestId: emCtx.requestId,
      itemIndex,
      provenance: emCtx.provenance(),
      ts: Date.now(),
      ownedBy: emCtx.ownedBy,
      component,
      data,
      ...(options?.key !== undefined ? { key: options.key } : {}),
    };

    void emCtx.response.emitItemAdded(item);
    void emCtx.response.emitItemDone(item);
  };
}

type StateChangeScope = StateChangeItem["scope"];
type StateChangeOperation = StateChangeItem["operation"];

function shouldPersistScopeChange(flow: FlowInstance): boolean {
  const withFlags = flow as FlowInstance & {
    persistStateChanges?: boolean;
  };

  if (withFlags.persistStateChanges === true) {
    return true;
  }

  return process.env.NODE_ENV !== "production";
}

async function emitStateChangeItem(options: {
  response: unknown;
  requestId: string;
  nextItemIndex: () => number;
  provenance: () => ItemProvenance;
  scope: StateChangeScope;
  operation: StateChangeOperation;
  version: number;
  delta?: unknown;
  path?: string;
  blockInstanceId?: string;
  transient: boolean;
}): Promise<void> {
  const typed = options.response as {
    emitItemAdded?: (item: OutputItem) => Promise<unknown>;
    emitItemDone?: (item: OutputItem) => Promise<unknown>;
  };

  if (
    typeof typed.emitItemAdded !== "function" ||
    typeof typed.emitItemDone !== "function"
  ) {
    return;
  }

  const itemIndex = options.nextItemIndex();
  const item: StateChangeItem = {
    id: `item_state_change_${itemIndex}_${Math.random().toString(16).slice(2)}`,
    type: "state_change",
    status: "completed",
    transient: options.transient,
    requestId: options.requestId,
    itemIndex,
    provenance: options.provenance(),
    ts: Date.now(),
    scope: options.scope,
    blockInstanceId: options.blockInstanceId,
    operation: options.operation,
    path: options.path,
    delta: options.delta,
    version: options.version
  };

  await typed.emitItemAdded(item);
  await typed.emitItemDone(item);
}

function createTargetStateOps<TState extends JsonObject>(options: {
  container: ReturnType<typeof createStateContainer<TState>>;
  persist: (state: Readonly<TState>, version: number) => Promise<void> | void;
  response: unknown;
  requestId: string;
  nextItemIndex: () => number;
  provenance: () => ItemProvenance;
  blockInstanceId: string;
  transientStateChanges: boolean;
}): Pick<StateRef<TState>, "patchState" | "setState" | "incState" | "pushState" | "setStateRecord" | "deleteStateRecord" | "atomicState"> {
  const baseOps = createScopeStateOps<TState>(options.container, {
    onPersist: options.persist
  });

  return {
    async patchState(
      updatesOrKey: Partial<TState> | keyof TState,
      updater?: (current: TState[keyof TState]) => TState[keyof TState]
    ) {
      await (baseOps.patchState as (
        updatesOrKey: Partial<TState> | keyof TState,
        updater?: (current: TState[keyof TState]) => TState[keyof TState]
      ) => Promise<void>)(updatesOrKey, updater);
      const version = options.container.getVersion();
      if (typeof updatesOrKey === "string") {
        await emitStateChangeItem({
          response: options.response,
          requestId: options.requestId,
          nextItemIndex: options.nextItemIndex,
          provenance: options.provenance,
          scope: "block_instance",
          operation: "patch",
          path: updatesOrKey,
          delta: { path: updatesOrKey },
          version,
          blockInstanceId: options.blockInstanceId,
          transient: options.transientStateChanges
        });
        return;
      }

      await emitStateChangeItem({
        response: options.response,
        requestId: options.requestId,
        nextItemIndex: options.nextItemIndex,
        provenance: options.provenance,
        scope: "block_instance",
        operation: "patch",
        delta: updatesOrKey,
        version,
        blockInstanceId: options.blockInstanceId,
        transient: options.transientStateChanges
      });
    },
    async setState(nextState: TState) {
      await baseOps.setState(nextState);
      await emitStateChangeItem({
        response: options.response,
        requestId: options.requestId,
        nextItemIndex: options.nextItemIndex,
        provenance: options.provenance,
        scope: "block_instance",
        operation: "set",
        delta: nextState,
        version: options.container.getVersion(),
        blockInstanceId: options.blockInstanceId,
        transient: options.transientStateChanges
      });
    },
    async incState(increments: Record<string, number>) {
      await baseOps.incState(increments);
      await emitStateChangeItem({
        response: options.response,
        requestId: options.requestId,
        nextItemIndex: options.nextItemIndex,
        provenance: options.provenance,
        scope: "block_instance",
        operation: "increment",
        delta: increments,
        version: options.container.getVersion(),
        blockInstanceId: options.blockInstanceId,
        transient: options.transientStateChanges
      });
    },
    async pushState(field: string, value: unknown) {
      await baseOps.pushState(field, value);
      await emitStateChangeItem({
        response: options.response,
        requestId: options.requestId,
        nextItemIndex: options.nextItemIndex,
        provenance: options.provenance,
        scope: "block_instance",
        operation: "push",
        path: field,
        delta: value,
        version: options.container.getVersion(),
        blockInstanceId: options.blockInstanceId,
        transient: options.transientStateChanges
      });
    },
    async setStateRecord(field: string, key: string, value: unknown) {
      await baseOps.setStateRecord(field, key, value);
      await emitStateChangeItem({
        response: options.response,
        requestId: options.requestId,
        nextItemIndex: options.nextItemIndex,
        provenance: options.provenance,
        scope: "block_instance",
        operation: "patch",
        path: `${field}.${key}`,
        delta: { [field]: { [key]: value } },
        version: options.container.getVersion(),
        blockInstanceId: options.blockInstanceId,
        transient: options.transientStateChanges
      });
    },
    async deleteStateRecord(field: string, key: string) {
      await baseOps.deleteStateRecord(field, key);
      await emitStateChangeItem({
        response: options.response,
        requestId: options.requestId,
        nextItemIndex: options.nextItemIndex,
        provenance: options.provenance,
        scope: "block_instance",
        operation: "delete_key",
        path: `${field}.${key}`,
        delta: { [field]: key },
        version: options.container.getVersion(),
        blockInstanceId: options.blockInstanceId,
        transient: options.transientStateChanges
      });
    },
    async atomicState(mutator: (state: Readonly<TState>) => Partial<TState>) {
      await baseOps.atomicState(mutator);
      await emitStateChangeItem({
        response: options.response,
        requestId: options.requestId,
        nextItemIndex: options.nextItemIndex,
        provenance: options.provenance,
        scope: "block_instance",
        operation: "atomic",
        version: options.container.getVersion(),
        blockInstanceId: options.blockInstanceId,
        transient: options.transientStateChanges
      });
    }
  };
}
function createEmitStatus(
  emCtx: EmissionContext
): (message: string, options?: { blocked?: boolean; backgroundTasks?: number; client?: boolean }) => void {
  return function emitStatus(message: string, options?: { blocked?: boolean; backgroundTasks?: number; client?: boolean }): void {
    const itemIndex = emCtx.nextItemIndex();
    const item: StatusItem = {
      id: `item_status_${itemIndex}_${Math.random().toString(16).slice(2)}`,
      type: "status",
      status: "completed",
      transient: true,
      client: options?.client ?? true,
      history: false,
      requestId: emCtx.requestId,
      itemIndex,
      provenance: emCtx.provenance(),
      ts: Date.now(),
      ownedBy: emCtx.ownedBy,
      message,
      blocked: options?.blocked,
      backgroundTasks: options?.backgroundTasks
    };

    void emCtx.response.emitItemAdded(item);
    void emCtx.response.emitItemDone(item);
  };
}

export async function createExecutionContext<
  TRequestState extends JsonObject = JsonObject,
  TSessionState extends JsonObject = JsonObject,
  TUserState extends JsonObject = JsonObject,
  TProjectState extends JsonObject = JsonObject
>(
  options: CreateExecutionContextOptions<
    TRequestState,
    TSessionState,
    TUserState,
    TProjectState
  >
): Promise<
  ExecutionContext<TRequestState, TSessionState, TUserState, TProjectState>
> {
  const now = Date.now();
  const {
    flow,
    stores
  } = options;
  const transientStateChanges = !shouldPersistScopeChange(flow);
  const sessionResourceConfigs = flow.session?.resources as
    | Record<string, ResourceConfig | ResourceCollectionConfig>
    | undefined;
  const userResourceConfigs = flow.user?.resources as
    | Record<string, ResourceConfig | ResourceCollectionConfig>
    | undefined;
  const projectResourceConfigs = flow.project?.resources as
    | Record<string, ResourceConfig | ResourceCollectionConfig>
    | undefined;

  if (!options.userId || options.userId.trim().length === 0) {
    throw new Error(`Flow "${flow.kind}" requires a userId`);
  }

  const userId = options.userId;
  const sessionId = options.sessionId ?? `ephemeral_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const requestId = options.requestId;

  // Parallelize independent store lookups — user, session, project, and request
  // records don't depend on each other for the initial load.
  const optionsProjectId = options.projectId;
  const [loadedUser, loadedSession, loadedProject, loadedRequest, priorRequests] = await Promise.all([
    stores.user.get(userId),
    stores.session.get(sessionId),
    optionsProjectId !== undefined ? stores.project.get(optionsProjectId) : undefined,
    stores.request.get(requestId),
    stores.request.list({ sessionId })
  ]);

  // Filter to completed prior requests once — reused by both all()/client()
  // (via priorItems) and history() (via loadLLMHistory).
  const completedPriorRequests = priorRequests
    .filter((r) => r.id !== requestId && r.status === "completed")
    .sort((a, b) => a.startedAtMs - b.startedAtMs);

  // Build prior items from completed request records. This replaces the
  // deprecated SessionRecord.items field — items are canonical on request records.
  const priorItems: SessionItem[] = [];
  for (const req of completedPriorRequests) {
    if (req.items === undefined) {
      continue;
    }
    for (const item of req.items) {
      priorItems.push(outputItemToSessionItem(item));
    }
  }
  // Sort by timestamp then index for stable ordering
  priorItems.sort((a, b) => {
    const tsDiff = (a.ts ?? 0) - (b.ts ?? 0);
    return tsDiff !== 0 ? tsDiff : a.itemIndex - b.itemIndex;
  });

  let userRecord = loadedUser;
  if (userRecord === undefined) {
    userRecord = {
      id: userId,
      userId,
      state: (options.userState ?? {}) as TUserState,
      resources: normalizeScopeResources(userResourceConfigs, undefined),
      version: 0,
      createdAt: now,
      updatedAt: now
    };
    await stores.user.set(userRecord.id, userRecord);
  }

  let sessionRecord = loadedSession;
  if (sessionRecord === undefined) {
    sessionRecord = {
      id: sessionId,
      flowKind: flow.kind,
      userId,
      projectId: options.projectId,
      state: (options.sessionState ?? {}) as TSessionState,
      resources: normalizeScopeResources(sessionResourceConfigs, undefined),
      version: 0,
      createdAt: now,
      updatedAt: now,
      journal: []
    };
    await stores.session.set(sessionRecord.id, sessionRecord);
  } else {
    ensureJournalDefaults(sessionRecord);
  }

  // Resolve projectId: prefer options, fall back to session record.
  // If session had a projectId we didn't know about at parallel-load time,
  // we need a separate fetch.
  const resolvedProjectId = optionsProjectId ?? sessionRecord?.projectId;
  let projectRecord: ProjectRecord | undefined = loadedProject;
  if (projectRecord === undefined && resolvedProjectId !== undefined && resolvedProjectId !== optionsProjectId) {
    projectRecord = await stores.project.get(resolvedProjectId);
  }
  if (resolvedProjectId !== undefined && projectRecord === undefined) {
    projectRecord = {
      id: resolvedProjectId,
      projectId: resolvedProjectId,
      userId,
      state: (options.projectState ?? {}) as TProjectState,
      resources: normalizeScopeResources(projectResourceConfigs, undefined),
      version: 0,
      createdAt: now,
      updatedAt: now
    };
    await stores.project.set(projectRecord.id, projectRecord);
  }

  // Load content from ContentStore, merging with any inline record content
  // for backward compatibility with records created before ContentStore existed.
  // ContentStore values take precedence over inline record values.
  const [sessionContentFromStore, userContentFromStore, projectContentFromStore] = await Promise.all([
    stores.content.getAll("session", sessionId),
    stores.content.getAll("user", userId),
    resolvedProjectId !== undefined ? stores.content.getAll("project", resolvedProjectId) : Promise.resolve({})
  ]);

  const initialSessionContent = normalizeScopeResourceContent(
    sessionResourceConfigs,
    { ...(sessionRecord.resourceContent ?? {}), ...sessionContentFromStore }
  );
  const initialUserContent = normalizeScopeResourceContent(
    userResourceConfigs,
    { ...(userRecord.resourceContent ?? {}), ...userContentFromStore }
  );
  const initialProjectContent = normalizeScopeResourceContent(
    projectResourceConfigs,
    resolvedProjectId !== undefined
      ? { ...(projectRecord?.resourceContent ?? {}), ...projectContentFromStore }
      : undefined
  );

  let requestRecord = loadedRequest;
  if (requestRecord === undefined) {
    requestRecord = {
      id: requestId,
      flowKind: flow.kind,
      actionName: options.actionName,
      userId,
      sessionId: sessionRecord?.id,
      projectId: projectRecord?.id,
      status: "in_progress",
      startedAtMs: now,
      metadata: options.metadata,
      input: options.input,
      state: (options.requestState ?? {}) as TRequestState,
      version: 0,
      createdAt: now,
      updatedAt: now
    };
    await stores.request.set(requestRecord.id, requestRecord);
  }

  if (requestRecord === undefined) {
    throw new Error(`Request "${requestId}" could not be initialized`);
  }

  const requestRef: { current: RequestRecord } = {
    current: requestRecord
  };
  const userRef: { current: UserRecord } = {
    current: userRecord
  };
  const sessionRef: { current: SessionRecord } = {
    current: sessionRecord
  };
  const projectRef: { current: ProjectRecord | undefined } = {
    current: projectRecord
  };

  const readSessionResources = (): Record<string, JsonObject> =>
    normalizeScopeResources(
      sessionResourceConfigs,
      sessionRef.current.resources as Record<string, unknown> | undefined
    );

  // Content refs: eagerly loaded from ContentStore at initialization.
  // All reads during execution use the in-memory cache (synchronous).
  // Writes update the cache and persist to ContentStore (async, per-key).
  const sessionContentRef = { current: initialSessionContent };
  const userContentRef = { current: initialUserContent };
  const projectContentRef = { current: initialProjectContent };

  const readSessionResourceContent = (): Record<string, string> =>
    sessionContentRef.current;

  const readUserResources = (): Record<string, JsonObject> =>
    normalizeScopeResources(
      userResourceConfigs,
      userRef.current.resources as Record<string, unknown> | undefined
    );

  const readUserResourceContent = (): Record<string, string> =>
    userContentRef.current;

  const readProjectResources = (): Record<string, JsonObject> =>
    normalizeScopeResources(
      projectResourceConfigs,
      projectRef.current?.resources as Record<string, unknown> | undefined
    );

  const readProjectResourceContent = (): Record<string, string> =>
    projectContentRef.current;

  const persistSessionResources = async (
    next: Record<string, JsonObject>
  ): Promise<void> => {
    sessionRef.current = {
      ...sessionRef.current,
      resources: normalizeScopeResources(sessionResourceConfigs, next),
      updatedAt: Date.now()
    };
    await stores.session.set(sessionRef.current.id, sessionRef.current);
  };

  const persistSessionResourceContent = async (
    next: Record<string, string>
  ): Promise<void> => {
    const normalized = normalizeScopeResourceContent(sessionResourceConfigs, next);
    const previous = sessionContentRef.current;

    for (const [key, value] of Object.entries(normalized)) {
      if (previous[key] !== value) {
        await stores.content.set("session", sessionId, key, value);
      }
    }
    for (const key of Object.keys(previous)) {
      if (!(key in normalized)) {
        await stores.content.delete("session", sessionId, key);
      }
    }

    sessionContentRef.current = normalized;
  };

  const persistUserResources = async (
    next: Record<string, JsonObject>
  ): Promise<void> => {
    userRef.current = {
      ...userRef.current,
      resources: normalizeScopeResources(userResourceConfigs, next),
      updatedAt: Date.now()
    };
    await stores.user.set(userRef.current.id, userRef.current);
  };

  const persistUserResourceContent = async (
    next: Record<string, string>
  ): Promise<void> => {
    const normalized = normalizeScopeResourceContent(userResourceConfigs, next);
    const previous = userContentRef.current;

    for (const [key, value] of Object.entries(normalized)) {
      if (previous[key] !== value) {
        await stores.content.set("user", userId, key, value);
      }
    }
    for (const key of Object.keys(previous)) {
      if (!(key in normalized)) {
        await stores.content.delete("user", userId, key);
      }
    }

    userContentRef.current = normalized;
  };

  const persistProjectResources = async (
    next: Record<string, JsonObject>
  ): Promise<void> => {
    const current = projectRef.current;
    if (current === undefined) {
      return;
    }

    projectRef.current = {
      ...current,
      resources: normalizeScopeResources(projectResourceConfigs, next),
      updatedAt: Date.now()
    };
    await stores.project.set(projectRef.current.id, projectRef.current);
  };

  const persistProjectResourceContent = async (
    next: Record<string, string>
  ): Promise<void> => {
    if (resolvedProjectId === undefined) {
      return;
    }

    const normalized = normalizeScopeResourceContent(projectResourceConfigs, next);
    const previous = projectContentRef.current;

    for (const [key, value] of Object.entries(normalized)) {
      if (previous[key] !== value) {
        await stores.content.set("project", resolvedProjectId, key, value);
      }
    }
    for (const key of Object.keys(previous)) {
      if (!(key in normalized)) {
        await stores.content.delete("project", resolvedProjectId, key);
      }
    }

    projectContentRef.current = normalized;
  };

  const requestContainer = createStateContainer<TRequestState>(
    requestRef.current.state as TRequestState,
    requestRef.current.version
  );
  const userContainer = createStateContainer<TUserState>(
    userRef.current.state as TUserState,
    userRef.current.version
  );
  const sessionContainer = createStateContainer<TSessionState>(
    sessionRef.current.state as TSessionState,
    sessionRef.current.version
  );
  const projectContainer =
    projectRef.current === undefined
      ? undefined
      : createStateContainer<TProjectState>(
          projectRef.current.state as TProjectState,
          projectRef.current.version
        );

  const onStateSizeWarning = (detail: {
    sizeBytes: number;
    maxStateSizeBytes: number;
  }): void => {
    console.warn("[flow-state] Scope state exceeds recommended CAS size", detail);
  };

  const requestOps = createScopeStateOps(requestContainer, {
    onStateSizeWarning,
    onPersist: async (state, version) => {
      requestRef.current = {
        ...requestRef.current,
        state: state as TRequestState,
        version,
        updatedAt: Date.now()
      };
      await stores.request.set(requestRef.current.id, requestRef.current);
    }
  });

  const userOps = createScopeStateOps(userContainer, {
    onStateSizeWarning,
    onPersist: async (state, version) => {
      userRef.current = {
        ...userRef.current,
        state: state as TUserState,
        version,
        updatedAt: Date.now()
      };
      await stores.user.set(userRef.current.id, userRef.current);
    }
  });

  const sessionOps = createScopeStateOps(sessionContainer, {
    onStateSizeWarning,
    onPersist: async (state, version) => {
      sessionRef.current = {
        ...sessionRef.current,
        state: state as TSessionState,
        version,
        updatedAt: Date.now()
      };
      await stores.session.set(
        sessionRef.current.id,
        sessionRef.current
      );
    }
  });

  const projectOps =
    projectRef.current === undefined || projectContainer === undefined
      ? undefined
      : createScopeStateOps(projectContainer, {
          onStateSizeWarning,
          onPersist: async (state, version) => {
            const current = projectRef.current;
            if (current === undefined) {
              return;
            }

            projectRef.current = {
              ...current,
              state: state as TProjectState,
              version,
              updatedAt: Date.now()
            };
            await stores.project.set(
              projectRef.current.id,
              projectRef.current
            );
          }
        });

  // Resource change emitter — pushes transient resource_change items via SSE
  // so clients can refresh clientData without waiting for request completion.
  const rawResponse = options.response as unknown as Record<string, unknown> | undefined;
  const emitter = rawResponse && typeof rawResponse.emitResourceChange === "function"
    ? (rawResponse as unknown as { emitResourceChange: (opts: { scope: string; resourcePath: string; changeType: string; transient?: boolean }) => Promise<unknown> })
    : undefined;

  function makeResourceChangeHandler(scope: "session" | "user" | "project") {
    if (!emitter) return undefined;
    return (resourcePath: string, changeType: "created" | "updated" | "deleted") => {
      void emitter.emitResourceChange({ scope, resourcePath, changeType, transient: true });
    };
  }

  const userResources = createScopeResourceRegistry({
    scope: "user",
    configs: userResourceConfigs,
    readResources: readUserResources,
    persistResources: persistUserResources,
    readResourceContent: readUserResourceContent,
    persistResourceContent: persistUserResourceContent,
    onResourceChanged: makeResourceChangeHandler("user"),
  });

  const sessionResources = createScopeResourceRegistry({
    scope: "session",
    configs: sessionResourceConfigs,
    readResources: readSessionResources,
    persistResources: persistSessionResources,
    readResourceContent: readSessionResourceContent,
    persistResourceContent: persistSessionResourceContent,
    onResourceChanged: makeResourceChangeHandler("session"),
  });

  const projectResources =
    projectRef.current === undefined
      ? undefined
      : createScopeResourceRegistry({
          scope: "project",
          configs: projectResourceConfigs,
          readResources: readProjectResources,
          persistResources: persistProjectResources,
          readResourceContent: readProjectResourceContent,
          persistResourceContent: persistProjectResourceContent,
          onResourceChanged: makeResourceChangeHandler("project"),
        });



  const modelResolver = options.modelResolver ?? createModelResolver();
  const tokenCounter: TokenCounter = flow.tokenCounter ?? {
    async count(text: string): Promise<number> {
      return Math.ceil(text.length / 4);
    },
    async countMessages(messages: LLMMessage[]): Promise<number> {
      const total = messages.reduce((acc, message) => acc + JSON.stringify(message.content).length, 0);
      return Math.ceil(total / 4);
    }
  };
  const resolvedModelStorage = new AsyncLocalStorage<string>();
  const resolveModel = ((modelId: string, blockName?: string) => {
    resolvedModelStorage.enterWith(modelId);
    return modelResolver(modelId, blockName);
  }) as ModelResolver;
  resolveModel.resolveId = (modelId: string) => modelResolver.resolveId(modelId);

  const readLiveItems = (): OutputItem[] => {
    const typedResponse = responseRef.current as { getItems?: () => OutputItem[] };
    if (typeof typedResponse.getItems === "function") {
      return typedResponse.getItems();
    }
    return requestRef.current.items ?? [];
  };

  const computeTokenUsage = () => {
    const byModel: Record<string, { prompt: number; completion: number; total: number; cacheReadTokens: number; cacheCreationTokens: number }> = {};
    for (const item of readLiveItems()) {
      if (item.type !== "block_output") {
        continue;
      }
      const modelUsage = item.modelUsage;
      if (modelUsage === undefined) {
        continue;
      }
      const existing = byModel[modelUsage.model] ?? {
        prompt: 0,
        completion: 0,
        total: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0
      };
      existing.prompt += Number(modelUsage.promptTokens ?? 0);
      existing.completion += Number(modelUsage.completionTokens ?? 0);
      existing.total += Number(modelUsage.totalTokens ?? 0);
      existing.cacheReadTokens += Number(modelUsage.cacheReadTokens ?? 0);
      existing.cacheCreationTokens += Number(modelUsage.cacheCreationTokens ?? 0);
      byModel[modelUsage.model] = existing;
    }

    const totalConsumed = Object.values(byModel).reduce((acc, model) => acc + model.total, 0);
    const maxBudget = flow.actions[options.actionName]?.tokenBudget?.maxTotalTokens;

    return {
      totalConsumed,
      byModel,
      remaining: typeof maxBudget === "number" ? Math.max(0, maxBudget - totalConsumed) : Number.POSITIVE_INFINITY
    };
  };

  const computeCostEstimate = () => {
    const estimator = flow.costEstimator;
    const usage = computeTokenUsage();
    const byModel: Record<string, number> = {};

    for (const [model, entry] of Object.entries(usage.byModel)) {
      byModel[model] = estimator?.estimate(entry, model) ?? 0;
    }

    const totalUSD = Object.values(byModel).reduce((acc, value) => acc + value, 0);
    return { totalUSD, byModel };
  };

  const requestHandle = defineStateProperty(
    {
      identity: {
        type: "request" as const,
        id: requestRef.current.id,
        userId,
        projectId: projectRef.current?.id
      },
      get tokenUsage() {
        return computeTokenUsage();
      },
      get costEstimate() {
        return computeCostEstimate();
      },
      ...requestOps
    },
    () => requestContainer.read()
  ) as RequestScopeHandle<TRequestState>;

  const userHandle = defineStateProperty(
    {
      identity: {
        type: "user" as const,
        id: userRef.current.id,
        userId: userRef.current.userId
      },
      resources: userResources,
      ...userOps
    },
    () => userContainer.read()
  ) as UserScopeHandle<TUserState>;

  const sessionHandle = defineStateProperty(
    {
      identity: {
        type: "session" as const,
        id: sessionRef.current.id,
        userId: sessionRef.current.userId,
        projectId: sessionRef.current.projectId
      },
      get metadata() {
        const s = sessionRef.current;
        return {
          ...(s.title !== undefined ? { title: s.title } : {}),
          ...(s.description !== undefined ? { description: s.description } : {}),
          ...(s.tags !== undefined ? { tags: s.tags } : {})
        };
      },
      resources: sessionResources,
      items: createSessionItemViews(priorItems, completedPriorRequests, {
        tokenCounter,
        readLiveItems,
        resolveModelId: () => {
          const active = resolvedModelStorage.getStore();
          if (typeof active === "string") {
            return active;
          }

          const items = readLiveItems();
          for (let index = items.length - 1; index >= 0; index -= 1) {
            const item = items[index];
            if (item?.type === "block_output" && item.modelUsage !== undefined) {
              return item.modelUsage.model;
            }
          }

          return "gpt-4o-mini";
        }
      }),
      appendJournal: async (entry: JournalEntryInput): Promise<void> => {
        const journalEntry = buildJournalEntry(entry);
        sessionRef.current = {
          ...sessionRef.current,
          journal: [...sessionRef.current.journal, journalEntry],
          updatedAt: Date.now()
        };
        await stores.session.set(
          sessionRef.current.id,
          sessionRef.current
        );
      },
      getJournal: async (query?: {
        limit?: number;
        offset?: number;
      }): Promise<JournalEntry[]> => {
        const offset = Math.max(0, query?.offset ?? 0);
        const start = offset;
        const list = sessionRef.current.journal.slice(start);

        if (query?.limit === undefined) {
          return [...list];
        }

        return list.slice(0, Math.max(0, query.limit));
      },
      setMetadata: async (input: SessionMetadataInput): Promise<void> => {
        const now = Date.now();
        sessionRef.current = {
          ...sessionRef.current,
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.tags !== undefined ? { tags: input.tags } : {}),
          ...(input.metadata !== undefined
            ? { metadata: { ...sessionRef.current.metadata, ...input.metadata } }
            : {}),
          updatedAt: now
        };
        await stores.session.set(sessionRef.current.id, sessionRef.current);

        await response.emit({
          type: "session.metadata.changed",
          sessionId: sessionRef.current.id,
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.tags !== undefined ? { tags: input.tags } : {}),
          ...(input.metadata !== undefined ? { metadata: input.metadata } : {})
        });
      },
      ...sessionOps
    },
    () => sessionContainer.read()
  ) as SessionScopeHandle<TSessionState>;

  const projectHandle =
    projectRef.current === undefined || projectOps === undefined || projectContainer === undefined
      ? undefined
      : (defineStateProperty(
          {
            identity: {
              type: "project" as const,
              id: projectRef.current.id,
              userId: projectRef.current.userId,
              projectId: projectRef.current.projectId
            },
            resources: projectResources,
            ...projectOps
          },
          () => projectContainer.read()
        ) as ProjectScopeHandle<TProjectState>);

  /**
   * Fire-and-forget lifecycle trace item for nested blocks.
   * Single emission (completed or failed) with timing, avoiding two-phase overhead.
   * Uses void + catch to avoid blocking the execution hot path.
   */
  function emitNestedBlockTrace(
    parent: ExecutionParent,
    startedAt: number,
    status: "completed" | "failed",
    emitter: EmissionContext["response"],
    reqRef: { current: { id: string } },
    nextIndex: () => number,
    blockOutput?: unknown,
    blockError?: { message: string; code?: string },
    ownedBy?: string
  ): void {
    const completedAt = Date.now();
    const itemIndex = nextIndex();
    const item: BlockOutputItem = {
      id: `item_trace_${itemIndex}_${Math.random().toString(16).slice(2)}`,
      type: "block_output",
      status,
      client: false,
      history: false,
      transient: parent.transient || undefined,
      requestId: reqRef.current.id,
      itemIndex,
      provenance: {
        blockName: parent.name,
        blockInstanceId: parent.instanceId,
        parentBlockInstanceId: parent.parentInstanceId,
        phase: "main"
      },
      ts: completedAt,
      ownedBy,
      blockName: parent.name,
      blockKind: parent.kind,
      output: blockOutput,
      error: blockError,
      startedAt,
      completedAt,
      duration: completedAt - startedAt
    };
    void emitter.emitItemAdded(item)
      .then(() => emitter.emitItemDone(item))
      .catch(() => { /* trace emission is best-effort */ });
  }

  type ExecutionParentNode = {
    parent: ExecutionParent;
    parentStateContainer?: ReturnType<typeof createStateContainer<JsonObject>>;
    result: { status: "not_started" | "running" | "completed" | "failed"; output?: unknown; error?: Error };
    previous?: ExecutionParentNode;
  };
  type SiblingRegistryEntry = {
    parent: ExecutionParent;
    parentStateContainer?: ReturnType<typeof createStateContainer<JsonObject>>;
    result: { status: "not_started" | "running" | "completed" | "failed"; output?: unknown; error?: Error };
  };
  const response = options.response ?? {
    emit: async () => undefined
  };
  const responseRef: { current: unknown } = {
    current: response
  };

  // Emission context used by emitMessage/emitComponent/emitStatus.
  // Duck-type the response: if it has emitItemAdded/emitItemDone, use those;
  // otherwise fall back to the generic emit() method via a thin adapter.
  let emittedItemCount = 0;
  const typedResponse = response as unknown as Record<string, unknown>;
  const hasTypedEmitter =
    typeof typedResponse.emitItemAdded === "function" &&
    typeof typedResponse.emitItemDone === "function";

  const emissionResponse: EmissionContext["response"] = hasTypedEmitter
    ? (response as unknown as EmissionContext["response"])
    : {
        async emitItemAdded(item: OutputItem) {
          await response.emit({ type: "item.added", item });
        },
        async emitItemDone(item: OutputItem) {
          await response.emit({ type: "item.done", item });
        }
      };

  const emCtx: EmissionContext = {
    requestId: requestRef.current.id,
    blockTransient: false,
    response: emissionResponse,
    provenance: () => ({
      blockName: "runtime",
      blockInstanceId: `runtime_${requestRef.current.id}`,
      phase: "main" as const
    }),
    nextItemIndex: () => emittedItemCount++,
    client: true,
    history: true,
  };

  const logger = options.logger;
  const baseLogContext = {
    requestId: requestRef.current.id,
    actionName: options.actionName,
    flowKind: flow.kind
  };

  const _runtimeHooks: ExecutionContext["_runtimeHooks"] = {
    onBlockStart: logger
      ? (blockName, blockKind, input) => {
          logRuntimeEvent(logger, "debug", "[flow-state] nested block started", {
            ...baseLogContext,
            blockName,
            blockKind,
            input: summarizeForLog(input)
          });
        }
      : undefined,
    onBlockComplete: logger
      ? (blockName, blockKind, output, durationMs) => {
          logRuntimeEvent(logger, "debug", "[flow-state] nested block completed", {
            ...baseLogContext,
            blockName,
            blockKind,
            durationMs,
            output: summarizeForLog(output)
          });
        }
      : undefined,
    onBlockError: logger
      ? (blockName, blockKind, error, durationMs) => {
          logRuntimeEvent(logger, "error", "[flow-state] nested block failed", {
            ...baseLogContext,
            blockName,
            blockKind,
            durationMs,
            error: summarizeForLog(error)
          });
        }
      : undefined,
    onRouteSelected: (routerName, selectedBlockName, routerInstanceId) => {
      if (logger) {
        logRuntimeEvent(logger, "debug", "[flow-state] router selected route", {
          ...baseLogContext,
          routerName,
          selectedRoute: selectedBlockName
        });
      }

      // Emit router_decision trace item — fire-and-forget to avoid blocking routing.
      const itemIndex = emittedItemCount++;
      const decisionItem: RouterDecisionItem = {
        id: `item_router_${itemIndex}_${Math.random().toString(16).slice(2)}`,
        type: "router_decision",
        status: "completed",
        client: false,
        history: false,
        requestId: requestRef.current.id,
        itemIndex,
        provenance: {
          blockName: routerName,
          blockInstanceId: routerInstanceId ?? `${routerName}_${requestRef.current.id}`,
          phase: "main"
        },
        ts: Date.now(),
        routerName,
        selectedRoute: selectedBlockName
      };
      void emissionResponse.emitItemAdded(decisionItem)
        .then(() => emissionResponse.emitItemDone(decisionItem))
        .catch(() => { /* trace emission is best-effort */ });
    },
    // Debug observability hooks — installed on the shared _runtimeHooks so
    // every context (root and nested) fires them. The hooks read the firing
    // ctx's `_blockIdentity` at invocation time to emit against the correct
    // block instance, avoiding closure capture of any specific block.
    onBlockDebugCapture: isTraceObservabilityEnabled()
      ? (capture, firingCtx) => {
          const identity = firingCtx._blockIdentity;
          if (identity === undefined) return;
          const metadata = {
            requestId: requestRef.current.id,
            userId: userRef.current.id,
            flowKind: baseLogContext.flowKind,
            actionName: baseLogContext.actionName,
            blockName: identity.blockName,
            blockKind: (identity.blockKind ?? "generator") as "handler" | "generator" | "sequencer" | "router",
            blockInstanceId: identity.blockInstanceId,
            parentBlockInstanceId: identity.parentBlockInstanceId,
            scope: identity.phase === "work" ? "work" : "block",
          } as Parameters<typeof emitBlockDebugItem>[2];
          const blockShim = {
            name: identity.blockName,
            kind: identity.blockKind ?? "generator",
          } as Parameters<typeof emitBlockDebugItem>[1];
          void emitBlockDebugItem(
            emissionResponse,
            blockShim,
            metadata,
            buildGeneratorDebugPayload(capture)
          ).catch(() => { /* best-effort */ });
        }
      : undefined,
    onConnectedInput: isTraceObservabilityEnabled()
      ? (value, firingCtx) => {
          const identity = firingCtx._blockIdentity;
          if (identity === undefined) return;
          const metadata = {
            requestId: requestRef.current.id,
            userId: userRef.current.id,
            flowKind: baseLogContext.flowKind,
            actionName: baseLogContext.actionName,
            blockName: identity.blockName,
            blockKind: (identity.blockKind ?? "handler") as "handler" | "generator" | "sequencer" | "router",
            blockInstanceId: identity.blockInstanceId,
            parentBlockInstanceId: identity.parentBlockInstanceId,
            scope: identity.phase === "work" ? "work" : "block",
          } as Parameters<typeof emitBlockDebugItem>[2];
          const blockShim = {
            name: identity.blockName,
            kind: identity.blockKind ?? "handler",
          } as Parameters<typeof emitBlockDebugItem>[1];
          void emitBlockDebugItem(
            emissionResponse,
            blockShim,
            metadata,
            buildConnectedInputDebugPayload(value)
          ).catch(() => { /* best-effort */ });
        }
      : undefined,
    emitNestedBlockDebug: undefined,
  };

  const createContext = (
    parentChain: ExecutionParentNode | undefined,
    siblingRegistry: SiblingRegistryEntry[] | undefined,
    siblingSearchLimit: number | undefined,
    scopeEmCtx?: EmissionContext
  ): ExecutionContext<TRequestState, TSessionState, TUserState, TProjectState> => {
    const activeEmCtx = scopeEmCtx ?? emCtx;
    const childSiblingRegistry: SiblingRegistryEntry[] = [];
    const context: ExecutionContext<TRequestState, TSessionState, TUserState, TProjectState> = {
      flow,
      actionName: options.actionName,
      requestRuntime: {
        requestId: requestRef.current.id,
        actionName: requestRef.current.actionName,
        status: requestRef.current.status,
        startedAtMs: requestRef.current.startedAtMs,
        completedAtMs: requestRef.current.completedAtMs,
        failedAtMs: requestRef.current.failedAtMs,
        metadata: requestRef.current.metadata
      },
      stores,
      request: requestHandle,
      session: sessionHandle,
      user: userHandle,
      project: projectHandle,
      response: responseRef.current as ExecutionContext["response"],
      signal: options.signal ?? new AbortController().signal,
      resolveModel,
      targets: new Proxy({}, {
        get(_target, prop) {
          if (typeof prop !== "string") {
            return undefined;
          }

          return context.getTarget(prop);
        },
        ownKeys() {
          return [];
        },
        getOwnPropertyDescriptor() {
          return { enumerable: true, configurable: true };
        }
      }) as BlockContext["targets"],
      getTarget: <TState extends object = Record<string, unknown>>(name: string): StateRef<TState> | undefined => {
        const toTargetRef = (
          matched: Pick<SiblingRegistryEntry, "parent" | "parentStateContainer">
        ): StateRef<TState> => {
          const container = matched.parentStateContainer;
          const noState = async (): Promise<never> => {
            throw new Error(
              `Target "${matched.parent.name}" does not expose instance state operations.`
            );
          };
          const ops: Pick<StateRef<TState>, "patchState" | "setState" | "incState" | "pushState" | "setStateRecord" | "deleteStateRecord" | "atomicState"> =
            container === undefined
              ? {
                  patchState: noState,
                  setState: noState,
                  incState: noState,
                  pushState: noState,
                  setStateRecord: noState,
                  deleteStateRecord: noState,
                  atomicState: noState
                }
              : (createTargetStateOps({
                  container,
                  persist: async () => undefined,
                  response: responseRef.current,
                  requestId: requestRef.current.id,
                  nextItemIndex: () => emittedItemCount++,
                  provenance: () => ({
                    blockName: matched.parent.name,
                    blockInstanceId: matched.parent.instanceId,
                    phase: "main"
                  }),
                  blockInstanceId: matched.parent.instanceId,
                  transientStateChanges
                }) as unknown as Pick<StateRef<TState>, "patchState" | "setState" | "incState" | "pushState" | "setStateRecord" | "deleteStateRecord" | "atomicState">);

          return defineStateProperty(
            {
              name: matched.parent.name,
              instanceId: matched.parent.instanceId,
              input: matched.parent.input,
              ...ops
            },
            () => (container?.read() ?? {}) as TState
          ) as unknown as StateRef<TState>;
        };

        if (siblingRegistry !== undefined && siblingRegistry.length > 0) {
          const searchFrom = Math.min(
            siblingSearchLimit ?? siblingRegistry.length - 1,
            siblingRegistry.length - 1
          );
          for (let index = searchFrom; index >= 0; index -= 1) {
            const sibling = siblingRegistry[index];
            if (sibling?.parent.name === name) {
              return toTargetRef(sibling);
            }
          }
        }

        const matches: ExecutionParentNode[] = [];
        for (let cursor = parentChain; cursor !== undefined; cursor = cursor.previous) {
          if (cursor.parent.name === name) {
            matches.push(cursor);
          }
        }

        if (matches.length === 0) {
          return undefined;
        }

        if (matches.length > 1) {
          const nearest = matches[0]!.parent;
          const ambiguous = matches.map((entry) => entry.parent.instanceId).join(", ");
          throw new AmbiguousBlockNameError(
            `getTarget("${name}") is ambiguous from block instance "${nearest.instanceId}". Matching instances: ${ambiguous}`
          );
        }

        return toTargetRef(matches[0]!);
      },

      getBlockOutput: (block) => {
        const name = block.name;

        if (siblingRegistry !== undefined && siblingRegistry.length > 0) {
          const searchFrom = Math.min(
            siblingSearchLimit ?? siblingRegistry.length - 1,
            siblingRegistry.length - 1
          );
          for (let index = searchFrom; index >= 0; index -= 1) {
            const sibling = siblingRegistry[index];
            if (sibling?.parent.name === name && sibling.result.status === "completed") {
              return sibling.result.output as never;
            }
          }
        }

        return undefined;
      },
      getBlockResult: (block): BlockResult<never> => {
        const name = block.name;

        if (siblingRegistry !== undefined && siblingRegistry.length > 0) {
          const searchFrom = Math.min(
            siblingSearchLimit ?? siblingRegistry.length - 1,
            siblingRegistry.length - 1
          );
          for (let index = searchFrom; index >= 0; index -= 1) {
            const sibling = siblingRegistry[index];
            if (sibling?.parent.name !== name) {
              continue;
            }

            if (sibling.result.status === "completed") {
              return { status: "completed", output: sibling.result.output } as BlockResult<never>;
            }

            if (sibling.result.status === "failed") {
              return {
                status: "failed",
                error: sibling.result.error ?? new Error(`Block "${name}" failed.`)
              } as BlockResult<never>;
            }

            return { status: sibling.result.status } as BlockResult<never>;
          }
        }

        return { status: "not_started" } as BlockResult<never>;
      },
      emitMessage: createEmitMessage(activeEmCtx),
      emitComponent: createEmitComponent(activeEmCtx),
      emitStatus: createEmitStatus(activeEmCtx),
      // ctx.cap is populated per-block in executeBlock (see buildCapObject below).
      cap: {} as any,
      // Defined below via Object.defineProperty to close over parentChain.
      parent: undefined,
      _runtimeHooks,
      _withExecutionScope: async <TValue>(parent: ExecutionParent, execute: (ctx: BlockContext) => Promise<TValue>) => {
        const resolvedParent: ExecutionParent = {
          ...parent,
          parentInstanceId: parent.parentInstanceId ?? parentChain?.parent.instanceId,
          phase: parent.phase ?? parentChain?.parent.phase
        };

        const parentStateContainer =
          resolvedParent.kind === "sequencer" && resolvedParent.stateSchema !== undefined
            ? createStateContainer<JsonObject>(
                normalizeStateDefault(resolvedParent.stateSchema)
              )
            : undefined;

        if (resolvedParent.container !== undefined) {
          const typed = responseRef.current as {
            emitItemAdded?: (item: OutputItem) => Promise<unknown>;
            emitItemDone?: (item: OutputItem) => Promise<unknown>;
          };
          if (
            typeof typed.emitItemAdded === "function" &&
            typeof typed.emitItemDone === "function"
          ) {
            const itemIndex = emittedItemCount++;
            const item: ContainerItem = {
              id: `item_container_${itemIndex}_${Math.random().toString(16).slice(2)}`,
              type: "container",
              status: "completed",
              // FIX-391: container items MUST be client-visible — they carry
              // the component key (e.g. "reactive-blackboard") the UI uses to
              // pick a renderer and suppress owned children. Hardcoding
              // client: false here caused the SSE client-filter to strip the
              // container during live streaming, leaving rb-entry children to
              // render as raw JSON. Revisit when the client/history model is
              // redesigned — until then, keep in sync with ITEM_TYPE_DEFAULTS
              // in core/items/resolve-role.ts (container: client: true).
              client: true,
              history: false,
              transient: resolvedParent.transient || undefined,
              requestId: requestRef.current.id,
              itemIndex,
              provenance: {
                blockName: resolvedParent.name,
                blockInstanceId: resolvedParent.instanceId,
                parentBlockInstanceId: resolvedParent.parentInstanceId,
                phase: "main"
              },
              ts: Date.now(),
              ownedBy: activeEmCtx.ownedBy,
              blockName: resolvedParent.name,
              component: resolvedParent.container.component,
              label: resolvedParent.container.label,
              metadata: resolvedParent.container.metadata
            };
            await typed.emitItemAdded(item);
            await typed.emitItemDone(item);
          }
        }

        const siblingEntry: SiblingRegistryEntry = {
          parent: resolvedParent,
          parentStateContainer,
          result: { status: "running" }
        };
        childSiblingRegistry.push(siblingEntry);

        const childChain: ExecutionParentNode = {
          parent: resolvedParent,
          parentStateContainer,
          result: siblingEntry.result,
          previous: parentChain
        };
        const childClient = resolvedParent.client ?? activeEmCtx.client;
        const childHistory = resolvedParent.history ?? activeEmCtx.history;
        const childPhase = resolvedParent.phase ?? "main";
        const childEmCtx: EmissionContext = {
          requestId: requestRef.current.id,
          blockTransient: resolvedParent.transient === true,
          response: emissionResponse,
          provenance: () => ({
            blockName: resolvedParent.name,
            blockInstanceId: resolvedParent.instanceId,
            parentBlockInstanceId: resolvedParent.parentInstanceId,
            phase: childPhase
          }),
          nextItemIndex: () => emittedItemCount++,
          ownedBy: resolvedParent.container !== undefined
            ? resolvedParent.instanceId
            : activeEmCtx.ownedBy,
          client: childClient,
          history: childHistory,
        };
        const childContext = createContext(
          childChain,
          childSiblingRegistry,
          childSiblingRegistry.length - 1,
          childEmCtx
        );

        (childContext as { _blockIdentity?: unknown })._blockIdentity = {
          blockName: resolvedParent.name,
          blockKind: resolvedParent.kind,
          blockInstanceId: resolvedParent.instanceId,
          parentBlockInstanceId: resolvedParent.parentInstanceId,
          ownedBy: childEmCtx.ownedBy,
          client: resolvedParent.client,
          history: resolvedParent.history,
          itemRole: resolvedParent.itemRole,
          phase: resolvedParent.phase ?? "main"
        };

        // Capture start time before execution — this is the only trace cost paid
        // unconditionally. Item construction and emission happen post-execution.
        const traceStartedAt = Date.now();

        try {
          const output = await execute(childContext);
          siblingEntry.result.status = "completed";
          siblingEntry.result.output = output;
          siblingEntry.result.error = undefined;

          // Emit lifecycle trace item for nested blocks only.
          // Root blocks are traced by executeBlock's emitBlockOutputItem.
          // Suppressed for:
          //  - tool calls — the generator's tool wrapper emits a richer
          //    `block_tool_output` that supersedes this trace.
          //  - generator blocks — sequencer.ts owns the generator trace so
          //    modelUsage can ride on a single block_output item without
          //    producing a duplicate here.
          const suppressTrace =
            resolvedParent.isToolCall === true ||
            resolvedParent.kind === "generator";
          if (parentChain !== undefined && !suppressTrace) {
            emitNestedBlockTrace(
              resolvedParent, traceStartedAt, "completed",
              emissionResponse, requestRef, () => emittedItemCount++,
              output,
              undefined,
              childEmCtx.ownedBy
            );
          }

          return output;
        } catch (error) {
          siblingEntry.result.status = "failed";
          siblingEntry.result.error = error instanceof Error ? error : new Error(String(error));
          siblingEntry.result.output = undefined;
          const normalized = normalizeError(error, {
            blockName: resolvedParent.name,
            scope: "block"
          });

          const suppressFailureTrace =
            resolvedParent.isToolCall === true ||
            resolvedParent.kind === "generator";
          if (parentChain !== undefined && !suppressFailureTrace) {
            emitNestedBlockTrace(
              resolvedParent, traceStartedAt, "failed",
              emissionResponse, requestRef, () => emittedItemCount++,
              undefined,
              {
                message: normalized.message,
                code: normalized.code
              },
              childEmCtx.ownedBy
            );
          }

          throw error;
        }
      }
    };

    Object.defineProperty(context, "sequencer", {
      enumerable: true,
      get() {
        let cursor = parentChain;
        while (cursor !== undefined) {
          if (
            cursor.parent.kind === "sequencer" &&
            cursor.parentStateContainer !== undefined
          ) {
            return context.getTarget(cursor.parent.name);
          }

          cursor = cursor.previous;
        }

        return undefined;
      }
    });

    Object.defineProperty(context, "parent", {
      enumerable: true,
      get() {
        if (parentChain?.previous === undefined) {
          return undefined;
        }

        const p = parentChain.previous.parent;
        return { name: p.name, kind: p.kind, input: p.input };
      }
    });

    Object.defineProperty(context, "response", {
      get() {
        return responseRef.current as ExecutionContext["response"];
      },
      set(value: unknown) {
        responseRef.current = value;
      },
      enumerable: true,
      configurable: true
    });

    return context;
  };

  return createContext(undefined, undefined, undefined);
}
