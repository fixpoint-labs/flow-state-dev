import type { TargetHandle } from "@flow-state-dev/core/types";
import type { FlowInstance } from "@flow-state-dev/core/types";
import type { JsonObject, JsonValue } from "@flow-state-dev/core/types";
import {
  createExecutionContext,
  createInMemoryStores,
  createResponseEmitter,
  type ExecutionContext,
  type StoreRegistry
} from "@flow-state-dev/server";
import type { OutputItem } from "@flow-state-dev/core/items";
import type {
  StateChange,
  TestBlockOptions
} from "../test-utilities/types";

const STATE_OPERATIONS = [
  "patchState",
  "setState",
  "incState",
  "pushState",
  "setStateRecord",
  "deleteStateRecord",
  "atomicState"
] as const;

type ScopeName = "request" | "session" | "user" | "project";

type ScopeOperation = (typeof STATE_OPERATIONS)[number];

type MutableTargetState = {
  value: Record<string, unknown>;
};

export type CreateTestContextOptions<TInput = unknown> = Omit<
  TestBlockOptions<TInput>,
  "input"
> & {
  flow?: FlowInstance;
  actionName?: string;
  requestId?: string;
  sessionId?: string;
  userId?: string;
  projectId?: string;
};

export type TestContextRuntime = {
  ctx: ExecutionContext;
  stores: StoreRegistry;
  response: ReturnType<typeof createResponseEmitter>;
  stateChanges: StateChange[];
  requestId: string;
  sessionId?: string;
  userId: string;
  projectId?: string;
  flow: FlowInstance;
  getItems: () => OutputItem[];
};

function cloneRecord<TValue extends Record<string, unknown>>(value: TValue): TValue {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value) as TValue;
  }

  return JSON.parse(JSON.stringify(value)) as TValue;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function toJsonObject(value: Record<string, unknown>): JsonObject {
  const out: JsonObject = {};

  for (const [key, entry] of Object.entries(value)) {
    out[key] = entry as JsonValue;
  }

  return out;
}

function nowMs(): number {
  return Date.now();
}

function generateId(prefix: string): string {
  return `${prefix}_${nowMs()}_${Math.random().toString(16).slice(2)}`;
}

function createTestFlow(options: {
  flow?: FlowInstance;
  sessionId?: string;
}): FlowInstance {
  if (options.flow !== undefined) {
    return options.flow;
  }

  return {
    id: "testing-flow",
    kind: "testing-flow",
    requireSession: options.sessionId !== undefined,
    requireUser: true,
    actions: {}
  } as FlowInstance;
}

async function seedStores(options: {
  stores: StoreRegistry;
  flow: FlowInstance;
  actionName: string;
  requestId: string;
  sessionId?: string;
  userId: string;
  projectId?: string;
  seed: {
    request?: Record<string, unknown>;
    session?: Record<string, unknown>;
    user?: Record<string, unknown>;
    project?: Record<string, unknown>;
  };
}): Promise<void> {
  const now = nowMs();

  if (options.seed.user !== undefined) {
    await options.stores.user.set(options.userId, {
      id: options.userId,
      userId: options.userId,
      state: toJsonObject(cloneRecord(options.seed.user)),
      version: 0,
      createdAt: now,
      updatedAt: now
    });
  }

  if (options.projectId !== undefined) {
    await options.stores.project.set(options.projectId, {
      id: options.projectId,
      projectId: options.projectId,
      userId: options.userId,
      state: toJsonObject(cloneRecord(options.seed.project ?? {})),
      version: 0,
      createdAt: now,
      updatedAt: now
    });
  }

  if (options.sessionId !== undefined) {
    await options.stores.session.set(options.sessionId, {
      id: options.sessionId,
      flowKind: options.flow.kind,
      userId: options.userId,
      projectId: options.projectId,
      metadata: undefined,
      latestRequestId: undefined,
      state: toJsonObject(cloneRecord(options.seed.session ?? {})),
      version: 0,
      createdAt: now,
      updatedAt: now,
      journal: [],
      items: [],
      messages: {
        ui: [],
        llm: []
      }
    });
  }

  if (options.seed.request !== undefined) {
    await options.stores.request.set(options.requestId, {
      id: options.requestId,
      flowKind: options.flow.kind,
      actionName: options.actionName,
      userId: options.userId,
      sessionId: options.sessionId,
      projectId: options.projectId,
      status: "in_progress",
      startedAtMs: now,
      state: toJsonObject(cloneRecord(options.seed.request)),
      metadata: undefined,
      version: 0,
      createdAt: now,
      updatedAt: now
    });
  }
}

function wrapScopeStateOps(
  scope: ScopeName,
  handle: Record<string, unknown> | undefined,
  stateChanges: StateChange[]
): void {
  if (handle === undefined) {
    return;
  }

  for (const operation of STATE_OPERATIONS) {
    const original = handle[operation];
    if (typeof original !== "function") {
      continue;
    }

    handle[operation] = async (...args: unknown[]): Promise<unknown> => {
      const result = await (original as (...values: unknown[]) => Promise<unknown>)(
        ...args
      );

      stateChanges.push({
        scope,
        operation,
        args,
        resultingState: cloneRecord(asRecord(handle.state))
      });

      return result;
    };
  }
}

function createTargetHandle(
  name: string,
  targetState: MutableTargetState
): TargetHandle<Record<string, unknown>> {
  const mutate = async (
    mutator: (current: Record<string, unknown>) => Record<string, unknown>
  ): Promise<void> => {
    targetState.value = mutator(targetState.value);
  };

  return {
    name,
    instanceId: `${name}_instance`,
    get state() {
      return cloneRecord(targetState.value);
    },
    patchState: async (updates: unknown): Promise<void> => {
      if (typeof updates === "object" && updates !== null) {
        await mutate((current) => ({
          ...current,
          ...(updates as Record<string, unknown>)
        }));
      }
    },
    setState: async (nextState: unknown): Promise<void> => {
      await mutate(() => asRecord(nextState));
    },
    incState: async (increments: unknown): Promise<void> => {
      await mutate((current) => {
        const next = { ...current };
        for (const [field, value] of Object.entries(asRecord(increments))) {
          const currentValue = typeof next[field] === "number" ? (next[field] as number) : 0;
          const incValue = typeof value === "number" ? value : 0;
          next[field] = currentValue + incValue;
        }

        return next;
      });
    },
    pushState: async (field: unknown, value: unknown): Promise<void> => {
      const key = typeof field === "string" ? field : String(field);
      await mutate((current) => {
        const existing = Array.isArray(current[key]) ? (current[key] as unknown[]) : [];
        return {
          ...current,
          [key]: [...existing, value]
        };
      });
    },
    setStateRecord: async (
      field: unknown,
      key: unknown,
      value: unknown
    ): Promise<void> => {
      const fieldName = typeof field === "string" ? field : String(field);
      const recordKey = typeof key === "string" ? key : String(key);

      await mutate((current) => ({
        ...current,
        [fieldName]: {
          ...asRecord(current[fieldName]),
          [recordKey]: value
        }
      }));
    },
    deleteStateRecord: async (field: unknown, key: unknown): Promise<void> => {
      const fieldName = typeof field === "string" ? field : String(field);
      const recordKey = typeof key === "string" ? key : String(key);

      await mutate((current) => {
        const nextRecord = { ...asRecord(current[fieldName]) };
        delete nextRecord[recordKey];

        return {
          ...current,
          [fieldName]: nextRecord
        };
      });
    },
    atomicState: async (mutator: unknown): Promise<void> => {
      if (typeof mutator !== "function") {
        return;
      }

      await mutate((current) => {
        const patch = asRecord(
          (mutator as (state: Readonly<Record<string, unknown>>) => unknown)(current)
        );

        return {
          ...current,
          ...patch
        };
      });
    }
  };
}

export async function createTestContext<TInput = unknown>(
  options: CreateTestContextOptions<TInput> = {}
): Promise<TestContextRuntime> {
  const flow = createTestFlow({
    flow: options.flow,
    sessionId: options.sessionId
  });
  const actionName = options.actionName ?? "test-action";
  const requestId = options.requestId ?? generateId("test_req");
  const sessionId = options.sessionId;
  const userId = options.userId ?? "test-user";
  const projectId = options.projectId;

  const stores = createInMemoryStores();
  const response = createResponseEmitter({ requestId });
  const stateChanges: StateChange[] = [];

  await seedStores({
    stores,
    flow,
    actionName,
    requestId,
    sessionId,
    userId,
    projectId,
    seed: {
      request: options.request?.state,
      session: options.session?.state,
      user: options.user?.state,
      project: options.project?.state
    }
  });

  const ctx = await createExecutionContext({
    flow,
    actionName,
    requestId,
    sessionId,
    userId,
    projectId,
    response,
    stores
  });

  wrapScopeStateOps("request", ctx.request as unknown as Record<string, unknown>, stateChanges);
  wrapScopeStateOps("session", ctx.session as unknown as Record<string, unknown>, stateChanges);
  wrapScopeStateOps("user", ctx.user as unknown as Record<string, unknown>, stateChanges);
  wrapScopeStateOps("project", ctx.project as unknown as Record<string, unknown>, stateChanges);

  const targetStateByName = new Map<string, MutableTargetState>();
  for (const [name, target] of Object.entries(options.targets ?? {})) {
    targetStateByName.set(name, {
      value: cloneRecord(target.state)
    });
  }

  ctx.getTarget = <TState extends object = Record<string, unknown>>(
    name: string
  ) => {
    const targetState = targetStateByName.get(name);
    if (targetState === undefined) {
      return undefined;
    }

    return createTargetHandle(name, targetState) as unknown as TargetHandle<TState>;
  };

  return {
    ctx,
    stores,
    response,
    stateChanges,
    requestId,
    sessionId,
    userId,
    projectId,
    flow,
    getItems: () => response.getItems()
  };
}
