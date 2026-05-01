import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import type {
  AnyResourceRef,
  ItemQuery,
  JournalEntry,
  JournalEntryInput,
  JsonObject,
  JsonValue,
  LLMMessage,
  MessageLimit,
  CollectionHookContext,
  OrgScopeHandle,
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
  AgentType,
  BlockOutputItem,
  BlockToolOutputItem,
  BlockValue,
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
import { resolveBlockValue, resolveItemVisibility } from "@flow-state-dev/core/items";
import type { BlockContext, BlockOutputHint, BlockResult, ExecutionParent, StateRef } from "@flow-state-dev/core/types";
import { createScopeStateOps, createStateContainer } from "../stores/state-container";
import type { CASPersist } from "../stores/cas";
import type { SetResult } from "../stores/types";
import type {
  OrgRecord,
  RequestRecord,
  SessionRecord,
  UserRecord
} from "../stores/types";
import { createModelResolver } from "@flow-state-dev/core/models";
import type { ModelResolver } from "@flow-state-dev/core";
import { logRuntimeEvent, summarizeForLog } from "../execution/logging";
import { isTraceObservabilityEnabled } from "@flow-state-dev/core";
import { deepEqual, getTransientKeys } from "@flow-state-dev/core/utils";
import {
  buildConnectedInputDebugPayload,
  buildGeneratorDebugPayload,
  emitBlockDebugItem,
} from "../execution/internal/debug-items";
import { AmbiguousBlockNameError } from "../errors/flow-error";
import { normalizeError } from "../errors/normalize-error";
import { cloneValue } from "../utils/clone";
import { isJsonObject, asJsonObject } from "../utils/json-helpers";
import {
  resolveUserStorageKey,
  resolveOrgStorageKey
} from "../stores/scope-keys";
import type { CreateExecutionContextOptions, ExecutionContext } from "./types";
import { OrgBindingMismatchError, UserBindingMismatchError } from "./binding-errors";

/**
 * Builds a CAS persist callback for a scope record. `buildNext` constructs
 * the record to write (stamped with version/updatedAt); `write` performs the
 * actual CAS store call. On success `ref.current` is advanced to the new
 * record; on conflict it's refreshed to the store's current record.
 */
function createScopePersist<
  TState,
  TRecord extends { state: unknown; version: number }
>(
  ref: { current: TRecord },
  buildNext: (expectedVersion: number, state: Readonly<TState>) => TRecord,
  write: (nextRecord: TRecord, expectedVersion: number) => Promise<SetResult<TRecord>>
): CASPersist<TState> {
  return async (state, expectedVersion) => {
    const nextRecord = buildNext(expectedVersion, state);
    const result = await write(nextRecord, expectedVersion);
    if (result.ok) {
      ref.current = nextRecord;
      return { ok: true, version: result.version };
    }
    const current = result.conflict.currentValue;
    if (current !== undefined) {
      ref.current = current;
    }
    return {
      ok: false,
      currentState: current?.state as TState | undefined,
      currentVersion: result.conflict.currentVersion
    };
  };
}

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
 *
 * `allItems` is used to resolve `block_output` BlockValue refs back to their
 * source items (FIX-413); pass the same list you're iterating over.
 */
function itemToLLMMessages(item: OutputItem, allItems: readonly OutputItem[]): LLMMessage[] {
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
    // Resolve the BlockValue union to its typed payload before stringifying
    // (FIX-413). Refs would otherwise serialize to `{kind:"ref",sourceItemId}`.
    // FIX-480: refs may target `message` items, so accept any item type.
    const resolvedOutput = resolveBlockValue(bo.output, (id) => {
      for (let i = allItems.length - 1; i >= 0; i -= 1) {
        if (allItems[i].id === id) return allItems[i];
      }
      return undefined;
    });
    const resultText = typeof resolvedOutput === "string"
      ? resolvedOutput
      : JSON.stringify(resolvedOutput);
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

      const llmMessages = itemToLLMMessages(item, sorted);
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
    agentType: item.agentType,
    agentName: item.agentName,
  };
}

/**
 * Applies `agentType` / `agentName` filters from a SessionItem query.
 * Both accept scalar or array form; scalar treated as single-element set.
 * Returns true if the item passes the filter (or no filter applies).
 */
function matchesIdentityFilter(
  item: SessionItem,
  query: ItemQuery | undefined,
): boolean {
  if (query?.agentType !== undefined) {
    const allowed = Array.isArray(query.agentType)
      ? new Set(query.agentType)
      : new Set([query.agentType]);
    if (item.agentType === undefined || !allowed.has(item.agentType)) {
      return false;
    }
  }
  if (query?.agentName !== undefined) {
    const allowed = Array.isArray(query.agentName)
      ? new Set(query.agentName)
      : new Set([query.agentName]);
    if (item.agentName === undefined || !allowed.has(item.agentName)) {
      return false;
    }
  }
  return true;
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

      // Identity filters (agentType, agentName) — honored by all views.
      if (!matchesIdentityFilter(item, query)) {
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
      ),
    selectForContext: (query) => select(query),
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
  /**
   * Agent identity that scope-emitted items inherit. Set by the owning
   * generator; undefined at the root (runtime-level emissions carry no
   * identity). Callers may override per-emission via options.
   */
  agentType?: AgentType;
  agentName?: string;
};

function createEmitMessage(
  emCtx: EmissionContext
): {
  (text: string, options?: { agentType?: AgentType; agentName?: string; transient?: boolean }): void;
  (content: Content[], options?: { agentType?: AgentType; agentName?: string; transient?: boolean }): void;
} {
  return function emitMessage(
    textOrContent: string | Content[],
    options?: { agentType?: AgentType; agentName?: string; transient?: boolean }
  ): void {
    const content: Content[] =
      typeof textOrContent === "string"
        ? [{ type: "output_text", text: textOrContent }]
        : textOrContent;

    const itemIndex = emCtx.nextItemIndex();
    // FIX-478: explicit emit calls are user-facing content, not bookkeeping.
    // Default non-transient; the block's `transient` flag governs only the
    // auto-emitted block_output trace (see emitNestedBlockTrace). Per-call
    // `{ transient: true }` is the explicit opt-in for live-only output.
    const item: MessageItem = {
      id: `item_message_${itemIndex}_${Math.random().toString(16).slice(2)}`,
      type: "message",
      status: "completed",
      transient: options?.transient === true ? true : undefined,
      requestId: emCtx.requestId,
      itemIndex,
      provenance: emCtx.provenance(),
      ts: Date.now(),
      ownedBy: emCtx.ownedBy,
      agentType: options?.agentType ?? emCtx.agentType,
      agentName: options?.agentName ?? emCtx.agentName,
      role: "assistant",
      content
    };

    void emCtx.response.emitItemAdded(item);
    void emCtx.response.emitItemDone(item);
  };
}

function createEmitComponent(
  emCtx: EmissionContext
): (
  component: string,
  data: Record<string, unknown>,
  options?: {
    key?: string;
    agentType?: AgentType;
    agentName?: string;
    transient?: boolean;
  },
) => void {
  return function emitComponent(
    component: string,
    data: Record<string, unknown>,
    options?: {
      key?: string;
      agentType?: AgentType;
      agentName?: string;
      transient?: boolean;
    },
  ): void {
    const itemIndex = emCtx.nextItemIndex();
    // FIX-478: explicit emit calls are user-facing content, not bookkeeping.
    // Default non-transient; the block's `transient` flag governs only the
    // auto-emitted block_output trace (see emitNestedBlockTrace). Per-call
    // `{ transient: true }` is the explicit opt-in (e.g. live-only progress
    // with dedup).
    const item: ComponentItem = {
      id: `item_component_${itemIndex}_${Math.random().toString(16).slice(2)}`,
      type: "component",
      status: "completed",
      transient: options?.transient === true ? true : undefined,
      requestId: emCtx.requestId,
      itemIndex,
      provenance: emCtx.provenance(),
      ts: Date.now(),
      ownedBy: emCtx.ownedBy,
      agentType: options?.agentType ?? emCtx.agentType,
      agentName: options?.agentName ?? emCtx.agentName,
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
  response: unknown;
  requestId: string;
  nextItemIndex: () => number;
  provenance: () => ItemProvenance;
  blockInstanceId: string;
  transientStateChanges: boolean;
  /**
   * Top-level keys of the parent sequencer's `stateSchema` that were marked
   * with `transientSlot()`. Patches affecting only these keys are persisted
   * to the in-memory container (so later steps can read them) but suppressed
   * from `state_change` SSE emits and `state_snapshot` payloads.
   */
  transientKeys?: Set<string>;
}): Pick<StateRef<TState>, "patchState" | "setState" | "incState" | "pushState" | "setStateRecord" | "deleteStateRecord" | "atomicState"> {
  // Target state has no backing store. `createScopeStateOps` supplies a
  // container-based CAS fallback when no `persist` is provided — that's what
  // we want here, so concurrent mutators serialize through the container.
  const baseOps = createScopeStateOps<TState>(options.container);
  const transientKeys = options.transientKeys ?? new Set<string>();

  function isTransientKey(key: string): boolean {
    return transientKeys.has(key);
  }

  function filterTransientFromDelta<T extends Record<string, unknown>>(
    delta: T
  ): { filtered: Partial<T>; hasNonTransient: boolean } {
    if (transientKeys.size === 0) {
      return { filtered: delta, hasNonTransient: Object.keys(delta).length > 0 };
    }
    const filtered: Record<string, unknown> = {};
    let hasNonTransient = false;
    for (const k of Object.keys(delta)) {
      if (!isTransientKey(k)) {
        filtered[k] = delta[k];
        hasNonTransient = true;
      }
    }
    return { filtered: filtered as Partial<T>, hasNonTransient };
  }

  return {
    async patchState(
      updatesOrKey: Partial<TState> | keyof TState,
      updater?: (current: TState[keyof TState]) => TState[keyof TState]
    ) {
      const committed = await (baseOps.patchState as (
        updatesOrKey: Partial<TState> | keyof TState,
        updater?: (current: TState[keyof TState]) => TState[keyof TState]
      ) => Promise<boolean>)(updatesOrKey, updater);
      if (!committed) return false;
      const version = options.container.getVersion();
      if (typeof updatesOrKey === "string") {
        if (isTransientKey(updatesOrKey)) return true;
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
        return true;
      }

      const { filtered, hasNonTransient } = filterTransientFromDelta(
        updatesOrKey as Record<string, unknown>
      );
      if (!hasNonTransient) return true;

      await emitStateChangeItem({
        response: options.response,
        requestId: options.requestId,
        nextItemIndex: options.nextItemIndex,
        provenance: options.provenance,
        scope: "block_instance",
        operation: "patch",
        delta: filtered,
        version,
        blockInstanceId: options.blockInstanceId,
        transient: options.transientStateChanges
      });
      return true;
    },
    async setState(nextState: TState) {
      const committed = await baseOps.setState(nextState);
      if (!committed) return false;
      const { filtered, hasNonTransient } = filterTransientFromDelta(
        nextState as Record<string, unknown>
      );
      if (!hasNonTransient) return true;
      await emitStateChangeItem({
        response: options.response,
        requestId: options.requestId,
        nextItemIndex: options.nextItemIndex,
        provenance: options.provenance,
        scope: "block_instance",
        operation: "set",
        delta: filtered,
        version: options.container.getVersion(),
        blockInstanceId: options.blockInstanceId,
        transient: options.transientStateChanges
      });
      return true;
    },
    async incState(increments: Record<string, number>) {
      const committed = await baseOps.incState(increments);
      if (!committed) return false;
      const { filtered, hasNonTransient } = filterTransientFromDelta(increments);
      if (!hasNonTransient) return true;
      await emitStateChangeItem({
        response: options.response,
        requestId: options.requestId,
        nextItemIndex: options.nextItemIndex,
        provenance: options.provenance,
        scope: "block_instance",
        operation: "increment",
        delta: filtered,
        version: options.container.getVersion(),
        blockInstanceId: options.blockInstanceId,
        transient: options.transientStateChanges
      });
      return true;
    },
    async pushState(field: string, value: unknown) {
      const committed = await baseOps.pushState(field, value);
      if (!committed) return false;
      if (isTransientKey(field)) return true;
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
      return true;
    },
    async setStateRecord(field: string, key: string, value: unknown) {
      const committed = await baseOps.setStateRecord(field, key, value);
      if (!committed) return false;
      if (isTransientKey(field)) return true;
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
      return true;
    },
    async deleteStateRecord(field: string, key: string) {
      const committed = await baseOps.deleteStateRecord(field, key);
      if (!committed) return false;
      if (isTransientKey(field)) return true;
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
      return true;
    },
    async atomicState(mutator: (state: Readonly<TState>) => Partial<TState>) {
      const before = options.container.read() as Record<string, unknown>;
      const committed = await baseOps.atomicState(mutator);
      if (!committed) return false;
      // atomicState has no structured delta. To honor transient slots we
      // diff before/after by top-level key — if every changed key is
      // transient, suppress the emit; otherwise emit as today.
      if (transientKeys.size > 0) {
        const after = options.container.read() as Record<string, unknown>;
        const changedKeys: string[] = [];
        const allKeys = new Set<string>([
          ...Object.keys(before),
          ...Object.keys(after)
        ]);
        for (const k of allKeys) {
          if (!deepEqual(before[k], after[k])) {
            changedKeys.push(k);
          }
        }
        if (changedKeys.length > 0 && changedKeys.every((k) => isTransientKey(k))) {
          return true;
        }
      }
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
      return true;
    }
  };
}
/**
 * Request-scoped status slot. Shared across every `createEmitStatus` call
 * within a single request so nested scopes see the same "current message"
 * value — implements the single-slot semantics from FIX-387.
 */
type StatusSlot = { message: string };

function createEmitStatus(
  emCtx: EmissionContext,
  slot: StatusSlot
): (message: string | undefined, options?: { blocked?: boolean; backgroundTasks?: number; transient?: boolean }) => void {
  return function emitStatus(
    message: string | undefined,
    options?: { blocked?: boolean; backgroundTasks?: number; transient?: boolean }
  ): void {
    if (message !== undefined) {
      // Dedupe: skip when the proposed message matches the slot. `undefined`
      // callers fall through — they update signals only and always emit.
      if (message === slot.message) {
        return;
      }
      slot.message = message;
    }

    const itemIndex = emCtx.nextItemIndex();
    // FIX-478: status defaults to transient (live-only; statuses are
    // naturally ephemeral). Per-call `{ transient: false }` opts out for
    // symmetry with emitMessage / emitComponent. `false` produces a
    // persisted item; `undefined` keeps the field absent.
    const item: StatusItem = {
      id: `item_status_${itemIndex}_${Math.random().toString(16).slice(2)}`,
      type: "status",
      status: "completed",
      transient: options?.transient === false ? undefined : true,
      requestId: emCtx.requestId,
      itemIndex,
      provenance: emCtx.provenance(),
      ts: Date.now(),
      ownedBy: emCtx.ownedBy,
      message: slot.message,
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
  TOrgState extends JsonObject = JsonObject
>(
  options: CreateExecutionContextOptions<
    TRequestState,
    TSessionState,
    TUserState,
    TOrgState
  >
): Promise<
  ExecutionContext<TRequestState, TSessionState, TUserState, TOrgState>
> {
  const now = Date.now();
  const {
    flow,
    stores
  } = options;
  const transientStateChanges = !shouldPersistScopeChange(flow);
  // FIX-435: resources live in a single flat `flow.resources` map. Each
  // entry is routed to the appropriate scope storage via its intrinsic
  // `scope`. Partition the flat map back into per-scope buckets so the
  // existing per-scope storage helpers can keep doing their job.
  const flatFlowResources = (flow.resources ?? {}) as Record<
    string,
    (ResourceConfig | ResourceCollectionConfig) & { scope: "session" | "user" | "org" }
  >;
  const sessionResourceConfigs: Record<string, ResourceConfig | ResourceCollectionConfig> = {};
  const userResourceConfigs: Record<string, ResourceConfig | ResourceCollectionConfig> = {};
  const orgResourceConfigs: Record<string, ResourceConfig | ResourceCollectionConfig> = {};
  /**
   * accessor → scope mapping so the flat ctx.resources registry can route
   * gets/lists across all three per-scope registries below.
   */
  const accessorScope: Record<string, "session" | "user" | "org"> = {};

  for (const [accessor, def] of Object.entries(flatFlowResources)) {
    const scope = def.scope;
    if (scope === "session") sessionResourceConfigs[accessor] = def;
    else if (scope === "user") userResourceConfigs[accessor] = def;
    else if (scope === "org") orgResourceConfigs[accessor] = def;
    else throw new Error(`Resource "${accessor}" has unknown scope ${JSON.stringify(scope)}`);
    accessorScope[accessor] = scope;
  }

  if (!options.userId || options.userId.trim().length === 0) {
    throw new Error(`Flow "${flow.kind}" requires a userId`);
  }

  const userId = options.userId;
  const sessionId = options.sessionId ?? `ephemeral_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const requestId = options.requestId;

  // Storage keys — namespaced by flowKind when the flow opts into per-flow
  // isolation for user/org scope. Bare identity ids otherwise. See
  // `packages/server/src/stores/scope-keys.ts` and FIX-431.
  const userKey = resolveUserStorageKey(userId, flow);
  const optionsOrgId = options.orgId;
  const optionsOrgKey =
    optionsOrgId !== undefined
      ? resolveOrgStorageKey(optionsOrgId, flow)
      : undefined;

  // Parallelize independent store lookups — user, session, org, and request
  // records don't depend on each other for the initial load.
  const [loadedUser, loadedSession, loadedOrg, loadedRequest, priorRequests] = await Promise.all([
    stores.user.get(userKey),
    stores.session.get(sessionId),
    optionsOrgKey !== undefined ? stores.org.get(optionsOrgKey) : undefined,
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
    // `id` is the storage key (namespaced when isolated); `userId` stays as
    // the bare identity so listing and cross-reference by userId work across
    // isolated and shared records alike.
    userRecord = {
      id: userKey,
      userId,
      state: (options.userState ?? {}) as TUserState,
      resources: normalizeScopeResources(userResourceConfigs, undefined),
      version: 0,
      createdAt: now,
      updatedAt: now
    };
    await stores.user.set(userRecord.id, userRecord, "any");
  }

  let sessionRecord = loadedSession;
  if (sessionRecord === undefined) {
    sessionRecord = {
      id: sessionId,
      flowKind: flow.kind,
      userId,
      orgId: options.orgId,
      state: (options.sessionState ?? {}) as TSessionState,
      resources: normalizeScopeResources(sessionResourceConfigs, undefined),
      version: 0,
      createdAt: now,
      updatedAt: now,
      journal: []
    };
    await stores.session.set(sessionRecord.id, sessionRecord, "any");
  } else {
    ensureJournalDefaults(sessionRecord);

    // userId mismatch — closes a long-standing gap. The loaded session record's
    // userId is authoritative; a request claiming a different identity would
    // route this user's actions against another user's data.
    if (sessionRecord.userId !== userId) {
      throw new UserBindingMismatchError(sessionId, sessionRecord.userId, userId);
    }
  }

  // orgId immutability. Org binding is fixed for the lifetime of a session;
  // a request that claims a different orgId — including binding an
  // unbound session — is rejected. Apps that need to "move" a session
  // create a new one. The previous code (`optionsOrgId ?? sessionRecord?.orgId`)
  // silently let the request override the session's stored value, vacating
  // the immutability guarantee FIX-428 promises.
  const sessionOrgId = sessionRecord.orgId;
  if (optionsOrgId !== undefined && optionsOrgId !== sessionOrgId) {
    throw new OrgBindingMismatchError(sessionId, sessionOrgId ?? "<unbound>", optionsOrgId);
  }

  const resolvedOrgId = sessionOrgId;
  const resolvedOrgKey =
    resolvedOrgId !== undefined
      ? resolveOrgStorageKey(resolvedOrgId, flow)
      : undefined;
  let orgRecord: OrgRecord | undefined = loadedOrg;
  if (
    orgRecord === undefined &&
    resolvedOrgKey !== undefined &&
    resolvedOrgKey !== optionsOrgKey
  ) {
    orgRecord = await stores.org.get(resolvedOrgKey);
  }
  if (resolvedOrgId !== undefined && resolvedOrgKey !== undefined && orgRecord === undefined) {
    orgRecord = {
      id: resolvedOrgKey,
      orgId: resolvedOrgId,
      userId,
      state: (options.orgState ?? {}) as TOrgState,
      resources: normalizeScopeResources(orgResourceConfigs, undefined),
      version: 0,
      createdAt: now,
      updatedAt: now
    };
    await stores.org.set(orgRecord.id, orgRecord, "any");
  }

  // Load content from ContentStore, merging with any inline record content
  // for backward compatibility with records created before ContentStore existed.
  // ContentStore values take precedence over inline record values.
  // Content scope keys mirror the scope record keys — namespaced when the
  // flow isolates that scope.
  const [sessionContentFromStore, userContentFromStore, projectContentFromStore] = await Promise.all([
    stores.content.getAll("session", sessionId),
    stores.content.getAll("user", userKey),
    resolvedOrgKey !== undefined ? stores.content.getAll("org", resolvedOrgKey) : Promise.resolve({})
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
    orgResourceConfigs,
    resolvedOrgId !== undefined
      ? { ...(orgRecord?.resourceContent ?? {}), ...projectContentFromStore }
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
      orgId: orgRecord?.orgId,
      source: options.source ?? "http",
      status: "in_progress",
      startedAtMs: now,
      metadata: options.metadata,
      input: options.input,
      state: (options.requestState ?? {}) as TRequestState,
      version: 0,
      createdAt: now,
      updatedAt: now
    };
    await stores.request.set(requestRecord.id, requestRecord, "any");
  } else if (requestRecord.source === undefined) {
    // Pre-FIX-438 records read from a store that hasn't been migrated
    // default to the HTTP source. New writes always carry the field.
    requestRecord = { ...requestRecord, source: "http" };
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
  const orgRef: { current: OrgRecord | undefined } = {
    current: orgRecord
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
      orgResourceConfigs,
      orgRef.current?.resources as Record<string, unknown> | undefined
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
    // Resource metadata writes are outside the state CAS path today
    // (see FIX-347 for splitting resources from scope records). Use "any"
    // to preserve current last-write-wins behavior for the resources field
    // until that split lands.
    await stores.session.set(sessionRef.current.id, sessionRef.current, "any");
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
    // Last-write-wins for resources; see persistSessionResources comment.
    await stores.user.set(userRef.current.id, userRef.current, "any");
  };

  const persistUserResourceContent = async (
    next: Record<string, string>
  ): Promise<void> => {
    const normalized = normalizeScopeResourceContent(userResourceConfigs, next);
    const previous = userContentRef.current;

    for (const [key, value] of Object.entries(normalized)) {
      if (previous[key] !== value) {
        await stores.content.set("user", userKey, key, value);
      }
    }
    for (const key of Object.keys(previous)) {
      if (!(key in normalized)) {
        await stores.content.delete("user", userKey, key);
      }
    }

    userContentRef.current = normalized;
  };

  const persistProjectResources = async (
    next: Record<string, JsonObject>
  ): Promise<void> => {
    const current = orgRef.current;
    if (current === undefined) {
      return;
    }

    orgRef.current = {
      ...current,
      resources: normalizeScopeResources(orgResourceConfigs, next),
      updatedAt: Date.now()
    };
    // Last-write-wins for resources; see persistSessionResources comment.
    await stores.org.set(orgRef.current.id, orgRef.current, "any");
  };

  const persistProjectResourceContent = async (
    next: Record<string, string>
  ): Promise<void> => {
    if (resolvedOrgKey === undefined) {
      return;
    }

    const normalized = normalizeScopeResourceContent(orgResourceConfigs, next);
    const previous = projectContentRef.current;

    for (const [key, value] of Object.entries(normalized)) {
      if (previous[key] !== value) {
        await stores.content.set("org", resolvedOrgKey, key, value);
      }
    }
    for (const key of Object.keys(previous)) {
      if (!(key in normalized)) {
        await stores.content.delete("org", resolvedOrgKey, key);
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
    orgRef.current === undefined
      ? undefined
      : createStateContainer<TOrgState>(
          orgRef.current.state as TOrgState,
          orgRef.current.version
        );

  const onStateSizeWarning = (detail: {
    sizeBytes: number;
    maxStateSizeBytes: number;
  }): void => {
    console.warn("[flow-state] Scope state exceeds recommended CAS size", detail);
  };

  const requestOps = createScopeStateOps(requestContainer, {
    onStateSizeWarning,
    persist: createScopePersist<TRequestState, RequestRecord>(
      requestRef,
      (expectedVersion, state) => ({
        ...requestRef.current,
        state: state as TRequestState,
        version: expectedVersion + 1,
        updatedAt: Date.now()
      }),
      (nextRecord, expectedVersion) =>
        stores.request.set(nextRecord.id, nextRecord, expectedVersion)
    )
  });

  const userOps = createScopeStateOps(userContainer, {
    onStateSizeWarning,
    persist: createScopePersist<TUserState, UserRecord>(
      userRef,
      (expectedVersion, state) => ({
        ...userRef.current,
        state: state as TUserState,
        version: expectedVersion + 1,
        updatedAt: Date.now()
      }),
      (nextRecord, expectedVersion) =>
        stores.user.set(nextRecord.id, nextRecord, expectedVersion)
    )
  });

  const sessionOps = createScopeStateOps(sessionContainer, {
    onStateSizeWarning,
    persist: createScopePersist<TSessionState, SessionRecord>(
      sessionRef,
      (expectedVersion, state) => ({
        ...sessionRef.current,
        state: state as TSessionState,
        version: expectedVersion + 1,
        updatedAt: Date.now()
      }),
      (nextRecord, expectedVersion) =>
        stores.session.set(nextRecord.id, nextRecord, expectedVersion)
    )
  });

  const projectOps =
    orgRef.current === undefined || projectContainer === undefined
      ? undefined
      : createScopeStateOps(projectContainer, {
          onStateSizeWarning,
          persist: async (state, expectedVersion) => {
            const current = orgRef.current;
            if (current === undefined) {
              // Org removed mid-execution; short-circuit so the retry loop exits.
              return { ok: true, version: expectedVersion + 1 };
            }
            const nextRecord: OrgRecord = {
              ...current,
              state: state as TOrgState,
              version: expectedVersion + 1,
              updatedAt: Date.now()
            };
            const result = await stores.org.set(
              nextRecord.id,
              nextRecord,
              expectedVersion
            );
            if (result.ok) {
              orgRef.current = nextRecord;
              return { ok: true, version: result.version };
            }
            const stored = result.conflict.currentValue;
            if (stored !== undefined) {
              orgRef.current = stored;
            }
            return {
              ok: false,
              currentState: stored?.state as TOrgState | undefined,
              currentVersion: result.conflict.currentVersion
            };
          }
        });

  // Resource change emitter — pushes transient resource_change items via SSE
  // so clients can refresh clientData without waiting for request completion.
  const rawResponse = options.response as unknown as Record<string, unknown> | undefined;
  const emitter = rawResponse && typeof rawResponse.emitResourceChange === "function"
    ? (rawResponse as unknown as { emitResourceChange: (opts: { scope: string; resourcePath: string; changeType: string; transient?: boolean }) => Promise<unknown> })
    : undefined;

  function makeResourceChangeHandler(scope: "session" | "user" | "org") {
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

  const orgResources =
    orgRef.current === undefined
      ? undefined
      : createScopeResourceRegistry({
          scope: "org",
          configs: orgResourceConfigs,
          readResources: readProjectResources,
          persistResources: persistProjectResources,
          readResourceContent: readProjectResourceContent,
          persistResourceContent: persistProjectResourceContent,
          onResourceChanged: makeResourceChangeHandler("org"),
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
        orgId: orgRef.current?.orgId
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
        orgId: sessionRef.current.orgId
      },
      get metadata() {
        const s = sessionRef.current;
        return {
          ...(s.title !== undefined ? { title: s.title } : {}),
          ...(s.description !== undefined ? { description: s.description } : {}),
          ...(s.tags !== undefined ? { tags: s.tags } : {})
        };
      },
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
        // Journal is append-only and not part of the state CAS path.
        await stores.session.set(
          sessionRef.current.id,
          sessionRef.current,
          "any"
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
        // Session metadata (title/description/tags/metadata) is non-CAS today.
        await stores.session.set(
          sessionRef.current.id,
          sessionRef.current,
          "any"
        );

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
    orgRef.current === undefined || projectOps === undefined || projectContainer === undefined
      ? undefined
      : (defineStateProperty(
          {
            identity: {
              type: "org" as const,
              id: orgRef.current.id,
              userId: orgRef.current.userId,
              orgId: orgRef.current.orgId
            },
            ...projectOps
          },
          () => projectContainer.read()
        ) as OrgScopeHandle<TOrgState>);

  // FIX-435: build the flat ctx.resources registry by merging the per-scope
  // registries. A resource's accessor key routes to the registry that owns
  // its intrinsic scope. `get()` and `list()` mirror the merged surface.
  const flatResourcesHandles: Record<string, AnyResourceRef> = {};
  for (const [accessor, scope] of Object.entries(accessorScope)) {
    let registry: ResourceRegistry<Record<string, AnyResourceRef>> | undefined;
    if (scope === "session") registry = sessionResources as ResourceRegistry<Record<string, AnyResourceRef>>;
    else if (scope === "user") registry = userResources as ResourceRegistry<Record<string, AnyResourceRef>>;
    else registry = orgResources as ResourceRegistry<Record<string, AnyResourceRef>> | undefined;
    if (registry === undefined) continue;
    const handle = (registry as Record<string, AnyResourceRef>)[accessor];
    if (handle !== undefined) flatResourcesHandles[accessor] = handle;
  }
  const flatResourcesRegistry: ResourceRegistry<Record<string, AnyResourceRef>> = {
    ...flatResourcesHandles,
    get(name: string) {
      const handle = flatResourcesHandles[String(name)];
      if (handle === undefined) {
        throw new Error(`Resource "${String(name)}" is not registered`);
      }
      return handle;
    },
    list() {
      return Object.values(flatResourcesHandles);
    }
  } as ResourceRegistry<Record<string, AnyResourceRef>>;

  /**
   * Fire-and-forget lifecycle trace item for nested blocks.
   * Single emission (completed or failed) with timing, avoiding two-phase overhead.
   * Uses void + catch to avoid blocking the execution hot path.
   *
   * `hint` controls the BlockValue kind stored in `output` (FIX-413):
   * - unset / `inline` → `{ kind: "inline", value: blockOutput }`
   * - `ref` → `{ kind: "ref", sourceItemId }` with flatten-at-emit
   * - `structure` → `{ kind: "structure", shape }`
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
    ownedBy?: string,
    hint?: BlockOutputHint
  ): void {
    const completedAt = Date.now();
    const itemIndex = nextIndex();
    const blockValue: BlockValue<unknown> =
      status === "failed"
        ? { kind: "inline", value: undefined }
        : buildEmitterBlockValue(blockOutput, hint, (id) => {
            const typed = responseRef.current as unknown as { getItems?: () => OutputItem[] };
            if (typeof typed.getItems === "function") {
              const items = typed.getItems();
              for (let i = items.length - 1; i >= 0; i -= 1) {
                if (items[i].id === id) return items[i] as BlockOutputItem;
              }
            }
            return undefined;
          });
    const item: BlockOutputItem = {
      id: `item_trace_${itemIndex}_${Math.random().toString(16).slice(2)}`,
      type: "block_output",
      status,
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
      output: blockValue,
      error: blockError,
      startedAt,
      completedAt,
      duration: completedAt - startedAt
    };
    void emitter.emitItemAdded(item)
      .then(() => emitter.emitItemDone(item))
      .catch(() => { /* trace emission is best-effort */ });
  }

  /**
   * Translate a BlockOutputHint + raw output into a BlockValue, flattening
   * refs one hop so every emitted ref points at a content-bearing item
   * (FIX-413 flatten-at-emit invariant).
   */
  function buildEmitterBlockValue(
    output: unknown,
    hint: BlockOutputHint | undefined,
    lookupItem: (id: string) => BlockOutputItem | undefined
  ): BlockValue<unknown> {
    if (hint === undefined || hint.kind === "inline") {
      return { kind: "inline", value: output };
    }
    if (hint.kind === "structure") {
      return { kind: "structure", shape: hint.shape };
    }
    // ref — flatten one hop if the target is itself a ref.
    let sourceItemId = hint.sourceItemId;
    const target = lookupItem(sourceItemId);
    if (target !== undefined) {
      const targetValue = target.output;
      if (
        targetValue !== undefined &&
        typeof targetValue === "object" &&
        "kind" in targetValue &&
        targetValue.kind === "ref"
      ) {
        sourceItemId = targetValue.sourceItemId;
      }
    }
    return { kind: "ref", sourceItemId };
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

  // Request-scoped status slot — shared across every scope's createEmitStatus.
  // Terminates naturally when this context is discarded at request end.
  const statusSlot: StatusSlot = { message: "" };
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
    response: emissionResponse,
    provenance: () => ({
      blockName: "runtime",
      blockInstanceId: `runtime_${requestRef.current.id}`,
      phase: "main" as const
    }),
    nextItemIndex: () => emittedItemCount++,
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
  ): ExecutionContext<TRequestState, TSessionState, TUserState, TOrgState> => {
    const activeEmCtx = scopeEmCtx ?? emCtx;
    const childSiblingRegistry: SiblingRegistryEntry[] = [];
    const context: ExecutionContext<TRequestState, TSessionState, TUserState, TOrgState> = {
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
      org: projectHandle,
      resources: flatResourcesRegistry,
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
                  response: responseRef.current,
                  requestId: requestRef.current.id,
                  nextItemIndex: () => emittedItemCount++,
                  provenance: () => ({
                    blockName: matched.parent.name,
                    blockInstanceId: matched.parent.instanceId,
                    phase: "main"
                  }),
                  blockInstanceId: matched.parent.instanceId,
                  transientStateChanges,
                  transientKeys: getTransientKeys(matched.parent.stateSchema)
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
      emitStatus: createEmitStatus(activeEmCtx, statusSlot),
      // ctx.cap is populated per-block in executeBlock (see buildCapObject below).
      cap: {} as any,
      // Defined below via Object.defineProperty to close over parentChain.
      parent: undefined,
      _runtimeHooks,
      _withExecutionScope: async <TValue>(parent: ExecutionParent, execute: (ctx: BlockContext) => Promise<TValue>) => {
        const resolvedParent: ExecutionParent = {
          ...parent,
          parentInstanceId: parent.parentInstanceId ?? parentChain?.parent.instanceId,
          phase: parent.phase ?? parentChain?.parent.phase,
          path: parent.path ?? parentChain?.parent.path
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
        const childPhase = resolvedParent.phase ?? "main";
        // Each scope starts with no identity. Generators that declare an
        // `agentType` stamp it directly on the items they emit; other
        // blocks inherit nothing — they emit structural items (status,
        // component, container) whose visibility comes from the type
        // defaults in `resolveItemVisibility()`.
        const childEmCtx: EmissionContext = {
          requestId: requestRef.current.id,
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
          phase: resolvedParent.phase ?? "main",
          blockPath: resolvedParent.path
        };

        // Capture start time before execution — this is the only trace cost paid
        // unconditionally. Item construction and emission happen post-execution.
        const traceStartedAt = Date.now();

        try {
          const output = await execute(childContext);
          siblingEntry.result.status = "completed";
          siblingEntry.result.output = output;
          siblingEntry.result.error = undefined;

          // Harvest the BlockValue hint set by the child's execute (if any)
          // so the emitted block_output carries a ref/structure rather than
          // duplicating content (FIX-413).
          const capturedHint = (childContext as { _blockOutputHint?: BlockOutputHint })._blockOutputHint;
          if (capturedHint !== undefined) {
            (childContext as { _blockOutputHint?: BlockOutputHint })._blockOutputHint = undefined;
          }

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
              childEmCtx.ownedBy,
              capturedHint
            );
          } else if (parentChain === undefined && capturedHint !== undefined) {
            // Root block case: server's executeBlock reads the hint off the
            // outer (non-scoped) ctx. Forward the child's hint so the root's
            // block_output can be emitted as ref/structure (FIX-413).
            (context as { _blockOutputHint?: BlockOutputHint })._blockOutputHint = capturedHint;
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
