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
  ResourceHandle,
  ResourceRegistry,
  ScopeType,
  SessionItem,
  SessionItemViews,
  SessionScopeHandle,
  UserScopeHandle
} from "@flow-state-dev/core/types";
import type {
  FunctionCallItem,
  FunctionCallOutputItem,
  MessageItem,
  OutputItem
} from "@flow-state-dev/core/items";
import { createScopeStateOps, createStateContainer } from "../stores/state-container";
import type {
  ProjectRecord,
  RequestRecord,
  SessionRecord,
  StoreRegistry,
  UserRecord
} from "../stores/types";
import { createDefaultModelResolver } from "../models/createDefaultModelResolver";
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

function createScopeResourceRegistry<TResources extends Record<string, ResourceHandle<any>>>(
  options: {
    scope: ScopeType;
    configs: Record<string, ResourceConfig> | undefined;
    readResources: () => Record<string, JsonObject>;
    persistResources: (next: Record<string, JsonObject>) => Promise<void>;
  }
): ResourceRegistry<TResources> {
  const handles = {} as Record<string, ResourceHandle<JsonObject>>;
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
      async readContent(): Promise<string> {
        const state = readState();
        const content = state.content;

        if (typeof content === "string") {
          return content;
        }

        return JSON.stringify(state);
      },
      async writeContent(content: string): Promise<void> {
        const state = readState();
        const nextState = {
          ...state,
          content: asJsonValue(content)
        };

        await persistResourceState(resourceName, config, nextState);
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

function defineStateProperty<THandle extends object, TState extends JsonObject>(
  handle: THandle,
  readState: () => Readonly<TState>
): THandle & { readonly state: Readonly<TState> } {
  return Object.defineProperty(handle, "state", {
    enumerable: true,
    get: readState
  }) as THandle & { readonly state: Readonly<TState> };
}

/**
 * Converts a persisted OutputItem into an LLM-ready message.
 * Returns null for item types that don't map to conversation messages.
 */
function itemToLLMMessage(item: OutputItem): LLMMessage | null {
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

  if (item.type === "function_call") {
    const fc = item as FunctionCallItem;
    return {
      role: "assistant",
      content: JSON.stringify({
        type: "function_call",
        callId: fc.callId,
        name: fc.name,
        arguments: fc.arguments
      })
    };
  }

  if (item.type === "function_call_output") {
    const fco = item as FunctionCallOutputItem;
    return { role: "tool", content: fco.output };
  }

  return null;
}

/**
 * Rough token estimate: ~4 characters per token (conservative for English text).
 */
function estimateTokens(message: LLMMessage): number {
  const content = typeof message.content === "string"
    ? message.content
    : JSON.stringify(message.content);
  return Math.ceil(content.length / 4);
}

/**
 * Loads conversation history from prior completed requests in this session,
 * converts to LLM-ready messages, and applies filtering/limiting.
 */
async function loadLLMHistory(
  stores: StoreRegistry,
  sessionId: string,
  currentRequestId: string,
  query?: ItemQuery
): Promise<LLMMessage[]> {
  const requests = await stores.request.list({ sessionId });

  const priorRequests = requests
    .filter((r) => r.id !== currentRequestId && r.status === "completed")
    .sort((a, b) => a.startedAtMs - b.startedAtMs);

  const allowedTypes = new Set(query?.itemTypes ?? ["message"]);
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

      if (item.visibility !== "llm" && item.visibility !== "both") {
        continue;
      }

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

  for (let i = messages.length - 1; i >= 0; i--) {
    const tokens = estimateTokens(messages[i]!);
    if (tokensUsed + tokens > tokenBudget) {
      break;
    }

    tokensUsed += tokens;
    startIndex = i;
  }

  return messages.slice(startIndex);
}

function createSessionItemViews(
  readRecord: () => SessionRecord | undefined,
  options: {
    stores: StoreRegistry;
    sessionId: string;
    currentRequestId: string;
  }
): SessionItemViews {
  const select = (query: ItemQuery | undefined): SessionItem[] => {
    const record = readRecord();
    if (record === undefined) {
      return [];
    }

    const includeTransient = query?.includeTransient === true;
    const visibilityFilter = query?.visibility;
    const allowedVisibility = visibilityFilter === undefined
      ? undefined
      : Array.isArray(visibilityFilter)
        ? visibilityFilter
        : [visibilityFilter];

    const filtered = (record.items ?? []).filter((item) => {
      if (!includeTransient && item.transient === true) {
        return false;
      }

      if (
        allowedVisibility !== undefined &&
        !allowedVisibility.includes(item.visibility)
      ) {
        return false;
      }

      return true;
    });

    return listByQuery(filtered, { limit: query?.limit });
  };

  return {
    all: (query) => select(query),
    client: (query) =>
      select({
        ...query,
        visibility: ["ui", "both"]
      }),
    llm: (query) =>
      loadLLMHistory(
        options.stores,
        options.sessionId,
        options.currentRequestId,
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

  let userRecord = await stores.user.get(userId);
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

  let sessionRecord = await stores.session.get(sessionId);
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

  const projectId = options.projectId ?? sessionRecord?.projectId;
  let projectRecord: ProjectRecord | undefined;
  if (projectId !== undefined) {
    projectRecord = await stores.project.get(projectId);
    if (projectRecord === undefined) {
      projectRecord = {
        id: projectId,
        projectId,
        userId,
        state: (options.projectState ?? {}) as TProjectState,
        resources: normalizeScopeResources(projectResourceConfigs, undefined),
        version: 0,
        createdAt: now,
        updatedAt: now
      };
      await stores.project.set(projectRecord.id, projectRecord);
    }
  }

  let requestRecord = await stores.request.get(requestId);
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

  const readUserResources = (): Record<string, JsonObject> =>
    normalizeScopeResources(
      userResourceConfigs,
      userRef.current.resources as Record<string, unknown> | undefined
    );

  const readProjectResources = (): Record<string, JsonObject> =>
    normalizeScopeResources(
      projectResourceConfigs,
      projectRef.current?.resources as Record<string, unknown> | undefined
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

  const requestOps = createScopeStateOps(requestContainer, {
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
    persistResources: persistUserResources
  });

  const sessionResources = createScopeResourceRegistry({
    scope: "session",
    configs: sessionResourceConfigs,
    readResources: readSessionResources,
    persistResources: persistSessionResources
  });

  const projectResources =
    projectRef.current === undefined
      ? undefined
      : createScopeResourceRegistry({
          scope: "project",
          configs: projectResourceConfigs,
          readResources: readProjectResources,
          persistResources: persistProjectResources
        });

  const requestHandle = defineStateProperty(
    {
      identity: {
        type: "request" as const,
        id: requestRef.current.id,
        userId,
        projectId: projectRef.current?.id
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
      items: createSessionItemViews(() => sessionRef.current, {
        stores,
        sessionId,
        currentRequestId: requestId
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

  const blockResults = new Map<string, unknown>();
  const response = options.response ?? {
    emit: async () => undefined
  };
  const resolveModel =
    options.modelResolver ?? createDefaultModelResolver();

  return {
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
    response,
    signal: options.signal ?? new AbortController().signal,
    resolveModel,
    getBlockResult: (name: string): unknown => blockResults.get(name),
    getTarget: () => undefined
  };
}
