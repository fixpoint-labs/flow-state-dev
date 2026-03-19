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
  ProjectScopeHandle,
  RequestScopeHandle,
  ResourceConfig,
  ResourceRef,
  ResourceRegistry,
  ScopeType,
  SessionItem,
  SessionItemViews,
  SessionScopeHandle,
  UserScopeHandle,
  FlowInstance,
  TokenCounter
} from "@flow-state-dev/core/types";
import type {
  BlockOutputItem,
  BlockToolOutputItem,
  ComponentItem,
  ContainerItem,
  Content,
  ContextItem,
  ItemProvenance,
  MessageItem,
  OutputItem,
  RouterDecisionItem,
  StateChangeItem,
  StatusItem
} from "@flow-state-dev/core/items";
import type { BlockContext, BlockResult, ComponentHandle, ExecutionParent, MessageHandle, StateRef } from "@flow-state-dev/core/types";
import { createScopeStateOps, createStateContainer } from "../stores/state-container";
import type {
  ProjectRecord,
  RequestRecord,
  SessionRecord,
  UserRecord
} from "../stores/types";
import { createDefaultModelResolver } from "../models/createDefaultModelResolver";
import { logRuntimeEvent, summarizeForLog } from "../execution/logging";
import { AmbiguousBlockNameError } from "../errors/flow-error";
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

function cloneValue<TValue>(value: TValue): TValue {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value) as TValue;
  }

  return JSON.parse(JSON.stringify(value)) as TValue;
}

function isJsonObject(value: unknown): value is JsonObject {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function asJsonObject(value: unknown): JsonObject {
  if (!isJsonObject(value)) {
    return {};
  }

  return value;
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

function normalizeScopeResources(
  configs: Record<string, ResourceConfig> | undefined,
  seed: Record<string, unknown> | undefined
): Record<string, JsonObject> {
  const normalized: Record<string, JsonObject> = {};

  for (const [resourceName, config] of Object.entries(configs ?? {})) {
    normalized[resourceName] = normalizeResourceState(
      config,
      seed?.[resourceName]
    );
  }

  return normalized;
}

function normalizeScopeResourceContent(
  configs: Record<string, ResourceConfig> | undefined,
  seed: Record<string, unknown> | undefined
): Record<string, string> {
  const normalized: Record<string, string> = {};

  for (const [resourceName, config] of Object.entries(configs ?? {})) {
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
    configs: Record<string, ResourceConfig> | undefined;
    readResources: () => Record<string, JsonObject>;
    persistResources: (next: Record<string, JsonObject>) => Promise<void>;
    readResourceContent: () => Record<string, string>;
    persistResourceContent: (next: Record<string, string>) => Promise<void>;
  }
): ResourceRegistry<TResources> {
  const handles = {} as Record<string, ResourceRef<JsonObject>>;
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

  for (const [resourceName, config] of Object.entries(configs)) {
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
  "context",
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
  "status",
  "state_change",
  "resource_change",
  "error",
  "step_error"
]);

/**
 * Converts a persisted OutputItem into an LLM-ready message.
 * Uses type-based audience routing: message, reasoning, context, and
 * block_output (with toolCall) enter LLM context.
 * Structural trace items (trace: true) are always excluded — they carry
 * lifecycle metadata for debugging, not conversational content.
 * Returns null for item types that don't map to conversation messages.
 */
function itemToLLMMessage(item: OutputItem): LLMMessage | null {
  // Fast path: structural trace items never enter LLM context.
  if (item.trace === true) {
    return null;
  }

  if (item.type === "message") {
    const msg = item as MessageItem;
    const text = (msg.content ?? [])
      .filter((c) => c.type === "output_text")
      .map((c) => (c as { text: string }).text)
      .join("");

    if (text.length === 0) {
      return null;
    }

    return { role: msg.role, content: text };
  }

  if (item.type === "reasoning") {
    const summary = (item as { summary: Content[] }).summary ?? [];
    const text = summary
      .filter((c) => c.type === "output_text")
      .map((c) => (c as { text: string }).text)
      .join("");

    return text.length > 0
      ? { role: "assistant", content: text }
      : null;
  }

  if (item.type === "context") {
    const ctx = item as ContextItem;
    return ctx.text.length > 0
      ? { role: "system", content: ctx.text }
      : null;
  }

  if (item.type === "block_output") {
    const bo = item as BlockOutputItem;
    // Only enters LLM context when invoked as a tool by a generator (legacy path).
    if (bo.toolCall === undefined) {
      return null;
    }

    return {
      role: "tool",
      content: typeof bo.output === "string"
        ? bo.output
        : JSON.stringify(bo.output)
    };
  }

  if (item.type === "block_tool_output") {
    const bto = item as BlockToolOutputItem;
    if (bto.status === "failed" && bto.error) {
      return {
        role: "tool",
        content: `Tool "${bto.toolCall.name}" failed: ${bto.error.message}`
      };
    }
    return {
      role: "tool",
      content: typeof bto.output === "string"
        ? bto.output
        : JSON.stringify(bto.output)
    };
  }

  return null;
}

/**
 * Loads conversation history from prior completed requests in this session,
 * converts to LLM-ready messages, and applies filtering/limiting.
 */
async function loadLLMHistory(
  priorRequests: RequestRecord[],
  tokenCounter: TokenCounter,
  resolveModelId: () => string,
  query?: ItemQuery
): Promise<LLMMessage[]> {

  const allowedTypes = query?.itemTypes
    ? new Set(query.itemTypes)
    : LLM_AUDIENCE_TYPES;
  const allowedRoles = query?.roles ? new Set(query.roles) : undefined;

  const messages: LLMMessage[] = [];

  for (const request of priorRequests) {
    if (request.items === undefined) {
      continue;
    }

    const sorted = [...request.items].sort((a, b) => {
      const tsDiff = a.ts - b.ts;
      return tsDiff !== 0 ? tsDiff : a.itemIndex - b.itemIndex;
    });

    for (const item of sorted) {
      if (item.transient === true) {
        continue;
      }

      // Type-based audience routing: only LLM-audience types proceed.
      if (!allowedTypes.has(item.type)) {
        continue;
      }

      const llmMessage = itemToLLMMessage(item);
      if (llmMessage === null) {
        continue;
      }

      if (allowedRoles !== undefined && !allowedRoles.has(llmMessage.role as "user" | "assistant" | "system" | "developer" | "tool")) {
        continue;
      }

      messages.push(llmMessage);
    }
  }

  // Apply limit
  const limit = query?.limit;
  if (limit === undefined) {
    return messages;
  }

  if (typeof limit === "number") {
    return limit < messages.length
      ? messages.slice(messages.length - limit)
      : messages;
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

  return messages.slice(startIndex);
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
    audienceTypes?: Set<string>
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

      // Type-based audience filtering when provided.
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
    client: (query) => select(query, CLIENT_AUDIENCE_TYPES),
    llm: (query) =>
      loadLLMHistory(
        priorRequests,
        options.tokenCounter,
        options.resolveModelId,
        query
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
};

function createEmitMessage(
  emCtx: EmissionContext
): {
  (text: string): MessageHandle;
  (content: Content[]): MessageHandle;
} {
  return function emitMessage(textOrContent: string | Content[]): MessageHandle {
    const content: Content[] =
      typeof textOrContent === "string"
        ? [{ type: "output_text", text: textOrContent }]
        : textOrContent;

    const itemIndex = emCtx.nextItemIndex();
    const item: MessageItem = {
      id: `item_message_${itemIndex}_${Math.random().toString(16).slice(2)}`,
      type: "message",
      status: "in_progress",
      transient: emCtx.blockTransient || undefined,
      requestId: emCtx.requestId,
      itemIndex,
      provenance: emCtx.provenance(),
      ts: Date.now(),
      role: "assistant",
      content
    };

    // Fire-and-forget the added event; streaming content follows via handle.
    void emCtx.response.emitItemAdded(item);

    let contentIndex = content.length;

    const handle: MessageHandle = {
      addContent(newContent: Content): void {
        const idx = contentIndex;
        contentIndex += 1;
        item.content.push(newContent);
        if (emCtx.response.emitContentAdded) {
          void emCtx.response.emitContentAdded(item.id, idx, newContent);
        }
      },
      appendDelta(delta: string): void {
        // Append delta to last output_text content part or create new one.
        const lastIdx = item.content.length - 1;
        const last = item.content[lastIdx];
        if (last !== undefined && last.type === "output_text") {
          (last as { text: string }).text += delta;
          if (emCtx.response.emitContentDelta) {
            void emCtx.response.emitContentDelta(item.id, lastIdx, delta);
          }
        } else {
          handle.addContent({ type: "output_text", text: delta });
        }
      },
      done(): void {
        item.status = "completed";
        void emCtx.response.emitItemDone(item);
      }
    };

    return handle;
  };
}

function createEmitComponent(
  emCtx: EmissionContext
): (component: string, data: Record<string, unknown>) => ComponentHandle {
  return function emitComponent(
    component: string,
    data: Record<string, unknown>
  ): ComponentHandle {
    const itemIndex = emCtx.nextItemIndex();
    const item: ComponentItem = {
      id: `item_component_${itemIndex}_${Math.random().toString(16).slice(2)}`,
      type: "component",
      status: "in_progress",
      transient: emCtx.blockTransient || undefined,
      requestId: emCtx.requestId,
      itemIndex,
      provenance: emCtx.provenance(),
      ts: Date.now(),
      component,
      data
    };

    void emCtx.response.emitItemAdded(item);

    return {
      update(newData: Record<string, unknown>): void {
        Object.assign(item.data, newData);
      },
      done(): void {
        item.status = "completed";
        void emCtx.response.emitItemDone(item);
      }
    };
  };
}

function createEmitLLMContext(
  emCtx: EmissionContext
): (text: string) => void {
  return function emitLLMContext(text: string): void {
    const itemIndex = emCtx.nextItemIndex();
    const item: ContextItem = {
      id: `item_context_${itemIndex}_${Math.random().toString(16).slice(2)}`,
      type: "context",
      status: "completed",
      transient: emCtx.blockTransient || undefined,
      requestId: emCtx.requestId,
      itemIndex,
      provenance: emCtx.provenance(),
      ts: Date.now(),
      text
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
): (message: string) => void {
  return function emitStatus(message: string): void {
    const itemIndex = emCtx.nextItemIndex();
    const item: StatusItem = {
      id: `item_status_${itemIndex}_${Math.random().toString(16).slice(2)}`,
      type: "status",
      status: "completed",
      transient: true,
      requestId: emCtx.requestId,
      itemIndex,
      provenance: emCtx.provenance(),
      ts: Date.now(),
      message
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
    | Record<string, ResourceConfig>
    | undefined;
  const userResourceConfigs = flow.user?.resources as
    | Record<string, ResourceConfig>
    | undefined;
  const projectResourceConfigs = flow.project?.resources as
    | Record<string, ResourceConfig>
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
  // (via priorItems) and llm() (via loadLLMHistory).
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
      resourceContent: normalizeScopeResourceContent(userResourceConfigs, undefined),
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
      resourceContent: normalizeScopeResourceContent(sessionResourceConfigs, undefined),
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
      resourceContent: normalizeScopeResourceContent(projectResourceConfigs, undefined),
      version: 0,
      createdAt: now,
      updatedAt: now
    };
    await stores.project.set(projectRecord.id, projectRecord);
  }

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

  const readSessionResourceContent = (): Record<string, string> =>
    normalizeScopeResourceContent(
      sessionResourceConfigs,
      sessionRef.current.resourceContent as Record<string, unknown> | undefined
    );

  const readUserResources = (): Record<string, JsonObject> =>
    normalizeScopeResources(
      userResourceConfigs,
      userRef.current.resources as Record<string, unknown> | undefined
    );

  const readUserResourceContent = (): Record<string, string> =>
    normalizeScopeResourceContent(
      userResourceConfigs,
      userRef.current.resourceContent as Record<string, unknown> | undefined
    );

  const readProjectResources = (): Record<string, JsonObject> =>
    normalizeScopeResources(
      projectResourceConfigs,
      projectRef.current?.resources as Record<string, unknown> | undefined
    );

  const readProjectResourceContent = (): Record<string, string> =>
    normalizeScopeResourceContent(
      projectResourceConfigs,
      projectRef.current?.resourceContent as Record<string, unknown> | undefined
    );

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
    sessionRef.current = {
      ...sessionRef.current,
      resourceContent: normalizeScopeResourceContent(sessionResourceConfigs, next),
      updatedAt: Date.now()
    };
    await stores.session.set(sessionRef.current.id, sessionRef.current);
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
    userRef.current = {
      ...userRef.current,
      resourceContent: normalizeScopeResourceContent(userResourceConfigs, next),
      updatedAt: Date.now()
    };
    await stores.user.set(userRef.current.id, userRef.current);
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
    const current = projectRef.current;
    if (current === undefined) {
      return;
    }

    projectRef.current = {
      ...current,
      resourceContent: normalizeScopeResourceContent(projectResourceConfigs, next),
      updatedAt: Date.now()
    };
    await stores.project.set(projectRef.current.id, projectRef.current);
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

  const userResources = createScopeResourceRegistry({
    scope: "user",
    configs: userResourceConfigs,
    readResources: readUserResources,
    persistResources: persistUserResources,
    readResourceContent: readUserResourceContent,
    persistResourceContent: persistUserResourceContent
  });

  const sessionResources = createScopeResourceRegistry({
    scope: "session",
    configs: sessionResourceConfigs,
    readResources: readSessionResources,
    persistResources: persistSessionResources,
    readResourceContent: readSessionResourceContent,
    persistResourceContent: persistSessionResourceContent
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
          persistResourceContent: persistProjectResourceContent
        });



  const modelResolver = options.modelResolver ?? createDefaultModelResolver();
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
  const resolveModel = (modelId: string, blockName?: string) => {
    resolvedModelStorage.enterWith(modelId);
    return modelResolver(modelId, blockName);
  };

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
    blockOutput?: unknown
  ): void {
    const completedAt = Date.now();
    const itemIndex = nextIndex();
    const item: BlockOutputItem = {
      id: `item_trace_${itemIndex}_${Math.random().toString(16).slice(2)}`,
      type: "block_output",
      status,
      trace: true,
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
      blockName: parent.name,
      blockKind: parent.kind,
      output: blockOutput,
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

  // Emission context used by emitMessage/emitComponent/emitLLMContext/emitStatus.
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
    nextItemIndex: () => emittedItemCount++
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
        trace: true,
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
    }
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
      emitLLMContext: createEmitLLMContext(activeEmCtx),
      emitStatus: createEmitStatus(activeEmCtx),
      _runtimeHooks,
      _withExecutionScope: async <TValue>(parent: ExecutionParent, execute: (ctx: BlockContext) => Promise<TValue>) => {
        const resolvedParent: ExecutionParent = {
          ...parent,
          parentInstanceId: parent.parentInstanceId ?? parentChain?.parent.instanceId
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
        const childEmCtx: EmissionContext = {
          requestId: requestRef.current.id,
          blockTransient: resolvedParent.transient === true,
          response: emissionResponse,
          provenance: () => ({
            blockName: resolvedParent.name,
            blockInstanceId: resolvedParent.instanceId,
            parentBlockInstanceId: resolvedParent.parentInstanceId,
            phase: "main" as const
          }),
          nextItemIndex: () => emittedItemCount++
        };
        const childContext = createContext(
          childChain,
          childSiblingRegistry,
          childSiblingRegistry.length - 1,
          childEmCtx
        );

        // Expose the block's identity so nested code (e.g. generator tool
        // output emission) can construct provenance without reaching into
        // server-internal structures.
        (childContext as { _blockIdentity?: unknown })._blockIdentity = {
          blockName: resolvedParent.name,
          blockInstanceId: resolvedParent.instanceId,
          parentBlockInstanceId: resolvedParent.parentInstanceId
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
          if (parentChain !== undefined) {
            emitNestedBlockTrace(
              resolvedParent, traceStartedAt, "completed",
              emissionResponse, requestRef, () => emittedItemCount++,
              output
            );
          }

          return output;
        } catch (error) {
          siblingEntry.result.status = "failed";
          siblingEntry.result.error = error instanceof Error ? error : new Error(String(error));
          siblingEntry.result.output = undefined;

          if (parentChain !== undefined) {
            emitNestedBlockTrace(
              resolvedParent, traceStartedAt, "failed",
              emissionResponse, requestRef, () => emittedItemCount++
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
