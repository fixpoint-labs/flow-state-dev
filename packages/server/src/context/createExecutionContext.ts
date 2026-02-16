import type {
  ItemQuery,
  JournalEntry,
  JournalEntryInput,
  JsonObject,
  LLMMessage,
  Message,
  MessageLimit,
  MessageQuery,
  MessageViews,
  ProjectScopeHandle,
  RequestScopeHandle,
  ResourceHandle,
  ResourceRegistry,
  SessionItem,
  SessionItemViews,
  SessionScopeHandle,
  UserScopeHandle
} from "@flow-state-dev/core/types";
import { createScopeStateOps, createStateContainer } from "../stores/state-container";
import type {
  ProjectRecord,
  RequestRecord,
  SessionRecord,
  StoreRegistry,
  UserRecord
} from "../stores/types";
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

function createEmptyResourceRegistry<
  TResources extends Record<string, ResourceHandle<any>>
>(): ResourceRegistry<TResources> {
  const registry = {
    get: (name: keyof TResources): TResources[keyof TResources] => {
      throw new Error(`Resource "${String(name)}" is not registered`);
    },
    list: (): Array<TResources[keyof TResources]> => []
  };

  return registry as ResourceRegistry<TResources>;
}

function ensureJournalDefaults(record: SessionRecord): void {
  if (!Array.isArray(record.journal)) {
    record.journal = [];
  }

  if (!Array.isArray(record.items)) {
    record.items = [];
  }

  if (
    typeof record.messages !== "object" ||
    record.messages === null
  ) {
    record.messages = {
      ui: [],
      llm: []
    };
  }

  if (!Array.isArray(record.messages.ui)) {
    record.messages.ui = [];
  }

  if (!Array.isArray(record.messages.llm)) {
    record.messages.llm = [];
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

function createSessionItemViews(record: SessionRecord): SessionItemViews {
  const select = (query: ItemQuery | undefined): SessionItem[] => {
    const includeTransient = query?.includeTransient === true;
    const visibilityFilter = query?.visibility;
    const allowedVisibility = visibilityFilter === undefined
      ? undefined
      : Array.isArray(visibilityFilter)
        ? visibilityFilter
        : [visibilityFilter];

    const filtered = record.items.filter((item) => {
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
    ui: (query) =>
      select({
        ...query,
        visibility: ["ui", "both"]
      }),
    llm: (query) =>
      select({
        ...query,
        visibility: ["llm", "both"]
      })
  };
}

function createMessageViews(record: SessionRecord): MessageViews {
  return {
    ui: (query: MessageQuery | undefined): Message[] =>
      listByQuery(record.messages.ui, query),
    llm: (query: MessageQuery | undefined): LLMMessage[] =>
      listByQuery(record.messages.llm, query)
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

  if (!options.userId || options.userId.trim().length === 0) {
    throw new Error(`Flow "${flow.kind}" requires a userId`);
  }

  const shouldUseSession = flow.requireSession === true || options.sessionId !== undefined;
  if (flow.requireSession === true && options.sessionId === undefined) {
    throw new Error(`Flow "${flow.kind}" requires a sessionId`);
  }

  const userId = options.userId;
  const sessionId = options.sessionId;
  const requestId = options.requestId;

  let userRecord = await stores.user.get(userId);
  if (userRecord === undefined) {
    userRecord = {
      id: userId,
      userId,
      state: (options.userState ?? {}) as TUserState,
      version: 0,
      createdAt: now,
      updatedAt: now
    };
    await stores.user.set(userRecord.id, userRecord);
  }

  let sessionRecord: SessionRecord | undefined;
  if (shouldUseSession && sessionId !== undefined) {
    sessionRecord = await stores.session.get(sessionId);
    if (sessionRecord === undefined) {
      sessionRecord = {
        id: sessionId,
        flowKind: flow.kind,
        userId,
        projectId: options.projectId,
        state: (options.sessionState ?? {}) as TSessionState,
        version: 0,
        createdAt: now,
        updatedAt: now,
        journal: [],
        items: [],
        messages: {
          ui: [],
          llm: []
        }
      };
      await stores.session.set(sessionRecord.id, sessionRecord);
    } else {
      ensureJournalDefaults(sessionRecord);
    }
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
  const sessionRef: { current: SessionRecord | undefined } = {
    current: sessionRecord
  };
  const projectRef: { current: ProjectRecord | undefined } = {
    current: projectRecord
  };

  const requestContainer = createStateContainer<TRequestState>(
    requestRef.current.state as TRequestState,
    requestRef.current.version
  );
  const userContainer = createStateContainer<TUserState>(
    userRef.current.state as TUserState,
    userRef.current.version
  );
  const sessionContainer =
    sessionRef.current === undefined
      ? undefined
      : createStateContainer<TSessionState>(
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

  const sessionOps =
    sessionRef.current === undefined || sessionContainer === undefined
      ? undefined
      : createScopeStateOps(sessionContainer, {
          onPersist: async (state, version) => {
            const current = sessionRef.current;
            if (current === undefined) {
              return;
            }

            sessionRef.current = {
              ...current,
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
      resources: createEmptyResourceRegistry(),
      ...userOps
    },
    () => userContainer.read()
  ) as UserScopeHandle<TUserState>;

  const sessionHandle =
    sessionRef.current === undefined || sessionOps === undefined || sessionContainer === undefined
      ? undefined
      : (defineStateProperty(
          {
            identity: {
              type: "session" as const,
              id: sessionRef.current.id,
              userId: sessionRef.current.userId,
              projectId: sessionRef.current.projectId
            },
            resources: createEmptyResourceRegistry(),
            items: createSessionItemViews(sessionRef.current),
            messages: createMessageViews(sessionRef.current),
            appendJournal: async (entry: JournalEntryInput): Promise<void> => {
              const current = sessionRef.current;
              if (current === undefined) {
                return;
              }

              const journalEntry = buildJournalEntry(entry);
              sessionRef.current = {
                ...current,
                journal: [...current.journal, journalEntry],
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
              const current = sessionRef.current;
              if (current === undefined) {
                return [];
              }

              const offset = Math.max(0, query?.offset ?? 0);
              const start = offset;
              const list = current.journal.slice(start);

              if (query?.limit === undefined) {
                return [...list];
              }

              return list.slice(0, Math.max(0, query.limit));
            },
            ...sessionOps
          },
          () => sessionContainer.read()
        ) as SessionScopeHandle<TSessionState>);

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
            resources: createEmptyResourceRegistry(),
            ...projectOps
          },
          () => projectContainer.read()
        ) as ProjectScopeHandle<TProjectState>);

  const blockResults = new Map<string, unknown>();
  const response = options.response ?? {
    emit: async () => undefined
  };

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
    getBlockResult: (name: string): unknown => blockResults.get(name),
    getTarget: () => undefined
  };
}
