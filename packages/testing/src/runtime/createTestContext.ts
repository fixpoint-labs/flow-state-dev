import type { StateRef } from "@flow-state-dev/core/types";
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

type ScopeName = "request" | "session" | "user" | "org" | "block_instance";

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
  orgId?: string;
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
  orgId?: string;
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

function buildFlatResourceMap(
  resources: Record<string, unknown> | undefined,
  scope: "session" | "user" | "org"
): Record<string, { stateSchema: z.ZodTypeAny; writable: true; scope: "session" | "user" | "org" }> {
  if (resources === undefined) {
    return {};
  }

  return Object.fromEntries(
    Object.keys(resources).map((name) => [
      name,
      {
        stateSchema: z.record(z.string(), z.unknown()),
        writable: true,
        scope
      }
    ])
  );
}

function createTestFlow(options: {
  flow?: FlowInstance;
  sessionId?: string;
  sessionResources?: Record<string, unknown>;
  userResources?: Record<string, unknown>;
  orgResources?: Record<string, unknown>;
}): FlowInstance {
  if (options.flow !== undefined) {
    return options.flow;
  }

  // FIX-435: every resource is intrinsically scoped; the test harness now
  // emits a single flat `flow.resources` map covering all three buckets.
  const resources: Record<string, unknown> = {
    ...buildFlatResourceMap(options.sessionResources, "session"),
    ...buildFlatResourceMap(options.userResources, "user"),
    ...buildFlatResourceMap(options.orgResources, "org")
  };

  return {
    id: "testing-flow",
    kind: "testing-flow",
    requireUser: true,
    requiresOrg: false,
    actions: {},
    isolateUserState: false,
    isolateOrgState: false,
    resources: Object.keys(resources).length > 0 ? resources : undefined,
    session: {},
    user: {},
    org: options.orgResources === undefined ? undefined : {}
  } as unknown as FlowInstance;
}

async function seedStores(options: {
  stores: StoreRegistry;
  flow: FlowInstance;
  actionName: string;
  requestId: string;
  sessionId?: string;
  userId: string;
  orgId?: string;
  seed: {
    request?: { state?: Record<string, unknown> };
    session?: { state?: Record<string, unknown>; resources?: Record<string, unknown> };
    user?: { state?: Record<string, unknown>; resources?: Record<string, unknown> };
    org?: { state?: Record<string, unknown>; resources?: Record<string, unknown> };
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
    }, "any");
  }

  if (options.orgId !== undefined) {
    await options.stores.org.set(options.orgId, {
      id: options.orgId,
      orgId: options.orgId,
      userId: options.userId,
      state: toJsonObject(cloneRecord(options.seed.org?.state ?? {})),
      resources:
        options.seed.org?.resources === undefined
          ? undefined
          : toJsonObjectRecord(cloneRecord(options.seed.org.resources)),
      version: 0,
      createdAt: now,
      updatedAt: now
    }, "any");
  }

  if (options.sessionId !== undefined) {
    await options.stores.session.set(options.sessionId, {
      id: options.sessionId,
      flowKind: options.flow.kind,
      userId: options.userId,
      orgId: options.orgId,
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
      journal: []
    }, "any");
  }

  if (options.seed.request !== undefined) {
    await options.stores.request.set(options.requestId, {
      id: options.requestId,
      flowKind: options.flow.kind,
      actionName: options.actionName,
      userId: options.userId,
      sessionId: options.sessionId,
      orgId: options.orgId,
      source: "http",
      status: "in_progress",
      startedAtMs: now,
      state: toJsonObject(cloneRecord(options.seed.request.state ?? {})),
      metadata: undefined,
      version: 0,
      createdAt: now,
      updatedAt: now
    }, "any");
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

function createTargetRef(
  targetState: MutableTargetState,
  stateChanges: StateChange[]
): StateRef<Record<string, unknown>> {
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
    input: undefined,
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
    orgResources: options.org?.resources
  });
  const actionName = options.actionName ?? "test-action";
  const requestId = options.requestId ?? generateId("test_req");
  const sessionId = options.sessionId ?? generateId("test_session");
  const userId = options.userId ?? "test-user";
  const orgId = options.orgId;

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
    orgId,
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
      org:
        options.org === undefined
          ? undefined
          : {
              state: options.org.state,
              resources: options.org.resources
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
    orgId,
    response,
    stores,
    modelResolver
  });

  wrapScopeStateOps("request", ctx.request as unknown as Record<string, unknown>, stateChanges);
  wrapScopeStateOps("session", ctx.session as unknown as Record<string, unknown>, stateChanges);
  wrapScopeStateOps("user", ctx.user as unknown as Record<string, unknown>, stateChanges);
  wrapScopeStateOps("org", ctx.org as unknown as Record<string, unknown>, stateChanges);

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
      return createTargetRef(targetState, stateChanges) as unknown as StateRef<TState>;
    }

    return originalGetTarget(name) as StateRef<TState> | undefined;
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
    orgId,
    flow,
    getItems: () => response.getItems()
  };
}
