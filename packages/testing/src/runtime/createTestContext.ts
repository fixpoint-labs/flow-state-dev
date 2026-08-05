import type { StateRef } from "@flow-state-dev/core/types";
import type { FlowInstance } from "@flow-state-dev/core/types";
import type { DeclaredResources } from "@flow-state-dev/core";
import type { JsonObject, JsonValue } from "@flow-state-dev/core/types";
import { cloneValue, deepEqual } from "@flow-state-dev/core/helpers";
import { z } from "zod";
import {
  createExecutionContext,
  createInMemoryStores,
  createResponseEmitter,
  type ExecutionContext,
  type StoreRegistry
} from "@flow-state-dev/engine";
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
  /**
   * Resources the block-under-test declares on its `resources:` slots (bubbled
   * up from descendants). Merged into the synthetic flow's `resources` so
   * `ctx.resources.X` is wired the way production does via `flow.resources`.
   * Explicitly-seeded scope resources take precedence on accessor-key conflict.
   */
  declaredResources?: DeclaredResources;
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
  declaredResources?: DeclaredResources;
}): FlowInstance {
  if (options.flow !== undefined) {
    return options.flow;
  }

  // FIX-435: every resource is intrinsically scoped; the test harness now
  // emits a single flat `flow.resources` map covering all three buckets.
  //
  // Block-declared resources are merged first so a block that declares a
  // resource on its `resources:` slot (e.g. round-robin/debate/routed-specialists)
  // gets `ctx.resources.X` wired the same way production's `flow.resources` does.
  // Explicitly-seeded scope resources are spread on top, so a test that opts to
  // seed an accessor keeps its generic entry and existing behavior is unchanged.
  const resources: Record<string, unknown> = {
    ...(options.declaredResources ?? {}),
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

  // Resource state lives in the ResourceStateStore (FIX-689), keyed per-resource
  // and separate from the scope record. Seed it there so the execution context
  // (which loads state from the store, not the record) sees the seeded values.
  const seedResourceState = async (
    scopeType: "session" | "user" | "org",
    scopeId: string,
    resources: Record<string, unknown> | undefined
  ): Promise<void> => {
    if (resources === undefined) return;
    const normalized = toJsonObjectRecord(cloneValue(resources));
    for (const [key, value] of Object.entries(normalized)) {
      // Seeding a fresh scope before the flow runs: no concurrent writer
      // exists, so `"any"` is the honest posture rather than a version the
      // harness would have to invent.
      await options.stores.resourceState.set(scopeType, scopeId, key, value, "any");
    }
  };

  if (options.seed.user !== undefined) {
    await options.stores.user.set(options.userId, {
      id: options.userId,
      userId: options.userId,
      state: toJsonObject(cloneValue(options.seed.user.state ?? {})),
      version: 0,
      createdAt: now,
      updatedAt: now
    }, "any");
    await seedResourceState("user", options.userId, options.seed.user.resources);
  }

  if (options.orgId !== undefined) {
    await options.stores.org.set(options.orgId, {
      id: options.orgId,
      orgId: options.orgId,
      userId: options.userId,
      state: toJsonObject(cloneValue(options.seed.org?.state ?? {})),
      version: 0,
      createdAt: now,
      updatedAt: now
    }, "any");
    await seedResourceState("org", options.orgId, options.seed.org?.resources);
  }

  if (options.sessionId !== undefined) {
    await options.stores.session.set(options.sessionId, {
      id: options.sessionId,
      flowKind: options.flow.kind,
      userId: options.userId,
      orgId: options.orgId,
      metadata: undefined,
      latestRequestId: undefined,
      state: toJsonObject(cloneValue(options.seed.session?.state ?? {})),
      version: 0,
      createdAt: now,
      updatedAt: now,
      journal: []
    }, "any");
    await seedResourceState("session", options.sessionId, options.seed.session?.resources);
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
      state: toJsonObject(cloneValue(options.seed.request.state ?? {})),
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
        resultingState: cloneValue(asRecord(handle.state))
      });

      return result;
    };
  }
}

function createTargetRef(
  targetState: MutableTargetState,
  stateChanges: StateChange[]
): StateRef<Record<string, unknown>> {
  // Mirror the framework's no-op guard: when the mutator's output is
  // structurally equal to the current state, leave the value untouched
  // and signal `false` so callers branching on the return value behave
  // consistently with production (FIX-477).
  const mutate = async (
    mutator: (current: Record<string, unknown>) => Record<string, unknown>
  ): Promise<boolean> => {
    const next = mutator(targetState.value);
    if (deepEqual(targetState.value, next)) {
      return false;
    }
    targetState.value = next;
    return true;
  };

  const pushTargetStateChange = (operation: ScopeOperation, args: unknown[]): void => {
    stateChanges.push({
      scope: targetState.scope,
      operation,
      args,
      resultingState: cloneValue(targetState.value),
      targetName: targetState.name,
      targetInstanceId: targetState.instanceId
    });
  };

  return {
    name: targetState.name,
    instanceId: targetState.instanceId,
    input: undefined,
    get state() {
      return cloneValue(targetState.value);
    },
    patchState: async (updates: unknown): Promise<boolean> => {
      let changed = false;
      if (typeof updates === "object" && updates !== null) {
        changed = await mutate((current) => ({
          ...current,
          ...(updates as Record<string, unknown>)
        }));
      }

      pushTargetStateChange("patchState", [updates]);
      return changed;
    },
    setState: async (nextState: unknown): Promise<boolean> => {
      const changed = await mutate(() => asRecord(nextState));
      pushTargetStateChange("setState", [nextState]);
      return changed;
    },
    incState: async (increments: unknown): Promise<boolean> => {
      const changed = await mutate((current) => {
        const next = { ...current };
        for (const [field, value] of Object.entries(asRecord(increments))) {
          const currentValue = typeof next[field] === "number" ? (next[field] as number) : 0;
          const incValue = typeof value === "number" ? value : 0;
          next[field] = currentValue + incValue;
        }

        return next;
      });

      pushTargetStateChange("incState", [increments]);
      return changed;
    },
    pushState: async (field: unknown, value: unknown): Promise<boolean> => {
      const key = typeof field === "string" ? field : String(field);
      const changed = await mutate((current) => {
        const existing = Array.isArray(current[key]) ? (current[key] as unknown[]) : [];
        return {
          ...current,
          [key]: [...existing, value]
        };
      });

      pushTargetStateChange("pushState", [field, value]);
      return changed;
    },
    setStateRecord: async (
      field: unknown,
      key: unknown,
      value: unknown
    ): Promise<boolean> => {
      const fieldName = typeof field === "string" ? field : String(field);
      const recordKey = typeof key === "string" ? key : String(key);

      const changed = await mutate((current) => ({
        ...current,
        [fieldName]: {
          ...asRecord(current[fieldName]),
          [recordKey]: value
        }
      }));

      pushTargetStateChange("setStateRecord", [field, key, value]);
      return changed;
    },
    deleteStateRecord: async (field: unknown, key: unknown): Promise<boolean> => {
      const fieldName = typeof field === "string" ? field : String(field);
      const recordKey = typeof key === "string" ? key : String(key);

      const changed = await mutate((current) => {
        const nextRecord = { ...asRecord(current[fieldName]) };
        delete nextRecord[recordKey];

        return {
          ...current,
          [fieldName]: nextRecord
        };
      });

      pushTargetStateChange("deleteStateRecord", [field, key]);
      return changed;
    },
    atomicState: async (mutator: unknown): Promise<boolean> => {
      if (typeof mutator !== "function") {
        return false;
      }

      const changed = await mutate((current) => {
        const patch = asRecord(
          (mutator as (state: Readonly<Record<string, unknown>>) => unknown)(current)
        );

        return {
          ...current,
          ...patch
        };
      });

      pushTargetStateChange("atomicState", [mutator]);
      return changed;
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
    orgResources: options.org?.resources,
    declaredResources: options.declaredResources
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

  // A real resolver injected by the caller (e.g. the benchmark engine) wins over
  // the deterministic mock resolver; absent one, fall back to the scripted mock.
  // Warn if the caller mixed both: the mock-config options are ignored when a
  // resolver is supplied, which is easy to do by accident.
  if (
    options.modelResolver !== undefined &&
    (options.generators !== undefined ||
      options.models !== undefined ||
      options.unmockedGeneratorPolicy !== undefined)
  ) {
    console.warn(
      "[flow-state-dev] createTestContext: `modelResolver` overrides the mock " +
        "resolver, so `generators`/`models`/`unmockedGeneratorPolicy` are ignored.",
    );
  }
  const modelResolver = options.modelResolver ?? createMockModelResolver({
    generators: options.generators,
    models: options.models,
    policy: options.unmockedGeneratorPolicy,
    unmockedDefault: options.unmockedDefault
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
      value: cloneValue(options.sequencer.state),
      scope: "block_instance",
      instanceId: `${sequencerName}_instance`,
      name: sequencerName
    });
  }

  for (const [name, target] of Object.entries(options.targets ?? {})) {
    targetStateByName.set(name, {
      value: cloneValue(target.state),
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
