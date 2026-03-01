import type { TargetHandle } from "@flow-state-dev/core/types";
import type { FlowInstance } from "@flow-state-dev/core/types";
import type { JsonObject, JsonValue } from "@flow-state-dev/core/types";
import { z } from "zod";
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
import { createMockModelResolver } from "../mocks/mockGenerator";

const STATE_OPERATIONS = [
  "patchState",
  "setState",
  "incState",
  "pushState",
  "setStateRecord",
  "deleteStateRecord",
  "atomicState"
] as const;

type ScopeName = "request" | "session" | "user" | "project" | "block_instance";

type ScopeOperation = (typeof STATE_OPERATIONS)[number];

type MutableTargetState = {
  value: Record<string, unknown>;
  scope: ScopeName;
  instanceId: string;
  name: string;
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
  sequencerName?: string;
};

export type TestContextRuntime = {
  ctx: ExecutionContext;
  stores: StoreRegistry;
  response: ReturnType<typeof createResponseEmitter>;
  stateChanges: StateChange[];
  requestId: string;
  sessionId: string;
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

function toJsonObjectRecord(
  value: Record<string, unknown>
): Record<string, JsonObject> {
  const out: Record<string, JsonObject> = {};

  for (const [key, entry] of Object.entries(value)) {
    out[key] = toJsonObject(asRecord(entry));
  }

  return out;
}

function nowMs(): number {
  return Date.now();
}

function generateId(prefix: string): string {
  return `${prefix}_${nowMs()}_${Math.random().toString(16).slice(2)}`;
}

function createResourceConfig(
  resources: Record<string, unknown> | undefined
): Record<string, { stateSchema: z.ZodTypeAny; writable: true }> | undefined {
  if (resources === undefined) {
    return undefined;
  }

  const names = Object.keys(resources);
  if (names.length === 0) {
    return undefined;
  }

  return Object.fromEntries(
    names.map((name) => [
      name,
      {
        stateSchema: z.record(z.string(), z.unknown()),
        writable: true
      }
    ])
  );
}

function createTestFlow(options: {
  flow?: FlowInstance;
  sessionId?: string;
  sessionResources?: Record<string, unknown>;
  userResources?: Record<string, unknown>;
  projectResources?: Record<string, unknown>;
}): FlowInstance {
  if (options.flow !== undefined) {
    return options.flow;
  }

  return {
    id: "testing-flow",
    kind: "testing-flow",
    requireUser: true,
    actions: {},
    session: {
      resources: createResourceConfig(options.sessionResources)
    },
    user: {
      resources: createResourceConfig(options.userResources)
    },
    project:
      options.projectResources === undefined
        ? undefined
        : {
            resources: createResourceConfig(options.projectResources)
          }
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
    request?: { state?: Record<string, unknown> };
    session?: { state?: Record<string, unknown>; resources?: Record<string, unknown> };
    user?: { state?: Record<string, unknown>; resources?: Record<string, unknown> };
    project?: { state?: Record<string, unknown>; resources?: Record<string, unknown> };
  };
}): Promise<void> {
  const now = nowMs();

  if (options.seed.user !== undefined) {
    await options.stores.user.set(options.userId, {
      id: options.userId,
      userId: options.userId,
      state: toJsonObject(cloneRecord(options.seed.user.state ?? {})),
      resources:
        options.seed.user.resources === undefined
          ? undefined
          : toJsonObjectRecord(cloneRecord(options.seed.user.resources)),
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
      state: toJsonObject(cloneRecord(options.seed.project?.state ?? {})),
      resources:
        options.seed.project?.resources === undefined
          ? undefined
          : toJsonObjectRecord(cloneRecord(options.seed.project.resources)),
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
      state: toJsonObject(cloneRecord(options.seed.session?.state ?? {})),
      resources:
        options.seed.session?.resources === undefined
          ? undefined
          : toJsonObjectRecord(cloneRecord(options.seed.session.resources)),
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
      state: toJsonObject(cloneRecord(options.seed.request.state ?? {})),
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
  targetState: MutableTargetState,
  stateChanges: StateChange[]
): TargetHandle<Record<string, unknown>> {
  const mutate = async (
    mutator: (current: Record<string, unknown>) => Record<string, unknown>
  ): Promise<void> => {
    targetState.value = mutator(targetState.value);
  };

  const pushTargetStateChange = (operation: ScopeOperation, args: unknown[]): void => {
    stateChanges.push({
      scope: targetState.scope,
      operation,
      args,
      resultingState: cloneRecord(targetState.value),
      targetName: targetState.name,
      targetInstanceId: targetState.instanceId
    });
  };

  return {
    name: targetState.name,
    instanceId: targetState.instanceId,
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

      pushTargetStateChange("patchState", [updates]);
    },
    setState: async (nextState: unknown): Promise<void> => {
      await mutate(() => asRecord(nextState));
      pushTargetStateChange("setState", [nextState]);
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

      pushTargetStateChange("incState", [increments]);
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

      pushTargetStateChange("pushState", [field, value]);
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

      pushTargetStateChange("setStateRecord", [field, key, value]);
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

      pushTargetStateChange("deleteStateRecord", [field, key]);
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

      pushTargetStateChange("atomicState", [mutator]);
    }
  };
}

export async function createTestContext<TInput = unknown>(
  options: CreateTestContextOptions<TInput> = {}
): Promise<TestContextRuntime> {
  const flow = createTestFlow({
    flow: options.flow,
    sessionId: options.sessionId,
    sessionResources: options.session?.resources,
    userResources: options.user?.resources,
    projectResources: options.project?.resources
  });
  const actionName = options.actionName ?? "test-action";
  const requestId = options.requestId ?? generateId("test_req");
  const sessionId = options.sessionId ?? generateId("test_session");
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
      request:
        options.request === undefined
          ? undefined
          : {
              state: options.request.state
            },
      session:
        options.session === undefined
          ? undefined
          : {
              state: options.session.state,
              resources: options.session.resources
            },
      user:
        options.user === undefined
          ? undefined
          : {
              state: options.user.state,
              resources: options.user.resources
            },
      project:
        options.project === undefined
          ? undefined
          : {
              state: options.project.state,
              resources: options.project.resources
            }
    }
  });

  const modelResolver = createMockModelResolver({
    generators: options.generators,
    models: options.models,
    policy: options.unmockedGeneratorPolicy
  });

  const ctx = await createExecutionContext({
    flow,
    actionName,
    requestId,
    sessionId,
    userId,
    projectId,
    response,
    stores,
    modelResolver
  });

  wrapScopeStateOps("request", ctx.request as unknown as Record<string, unknown>, stateChanges);
  wrapScopeStateOps("session", ctx.session as unknown as Record<string, unknown>, stateChanges);
  wrapScopeStateOps("user", ctx.user as unknown as Record<string, unknown>, stateChanges);
  wrapScopeStateOps("project", ctx.project as unknown as Record<string, unknown>, stateChanges);

  const targetStateByName = new Map<string, MutableTargetState>();

  const sequencerName = options.sequencer?.name ?? options.sequencerName ?? "sequencer";
  if (options.sequencer !== undefined) {
    targetStateByName.set(sequencerName, {
      value: cloneRecord(options.sequencer.state),
      scope: "block_instance",
      instanceId: `${sequencerName}_instance`,
      name: sequencerName
    });
  }

  for (const [name, target] of Object.entries(options.targets ?? {})) {
    targetStateByName.set(name, {
      value: cloneRecord(target.state),
      scope: "request",
      instanceId: `${name}_instance`,
      name
    });
  }

  const originalGetTarget = ctx.getTarget.bind(ctx);

  ctx.getTarget = <TState extends object = Record<string, unknown>>(
    name: string
  ) => {
    const targetState = targetStateByName.get(name);
    if (targetState !== undefined) {
      return createTargetHandle(targetState, stateChanges) as unknown as TargetHandle<TState>;
    }

    return originalGetTarget(name) as TargetHandle<TState> | undefined;
  };

  const targetsProxy = new Proxy({}, {
    get(_target, prop) {
      if (typeof prop !== "string") {
        return undefined;
      }

      return ctx.getTarget(prop);
    }
  });

  const proxiedContext = new Proxy(ctx, {
    get(target, prop, receiver) {
      if (prop === "getTarget") {
        return ctx.getTarget;
      }

      if (prop === "sequencer" && options.sequencer !== undefined) {
        return ctx.getTarget(sequencerName);
      }

      if (prop === "targets") {
        return targetsProxy;
      }

      return Reflect.get(target, prop, receiver);
    }
  }) as ExecutionContext;

  ctx.resolveModel = modelResolver;

  return {
    ctx: proxiedContext,
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
