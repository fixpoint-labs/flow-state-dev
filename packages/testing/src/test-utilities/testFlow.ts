/**
 * `testFlow` — runs one flow action against the same `runAction` engine the
 * server uses, against an isolated in-memory store registry, with mocked
 * generators. Returns the items, status, and persisted request snapshot.
 *
 * Pass `stores` to share state across multiple calls (session-resume
 * scenarios). When the same registry is reused, scope-seeding is idempotent
 * — `set()` only fires when the entity is missing, so prior journal entries
 * and resources survive subsequent runs.
 */
import {
  createInMemoryStores,
  mintStorageGeneration,
  resolveSessionResourceScopeId,
  runAction,
  type StoreRegistry
} from "@flow-state-dev/engine";
import type { FlowInstance, RequestStatus } from "@flow-state-dev/core/types";
import type { JsonObject, JsonValue } from "@flow-state-dev/core/types";
import { cloneValue } from "@flow-state-dev/core/helpers";
import { createMockModelResolver } from "../mocks/mockGenerator";
import type { TestFlowOptions, TestFlowResult } from "./types";

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function toJsonObject(value: Record<string, unknown>): JsonObject {
  const out: JsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    out[key] = entry as JsonValue;
  }

  return out;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
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

function normalizeStatus(
  value: RequestStatus | undefined
): "completed" | "failed" | "incomplete" | "interrupted" | "aborted" | "suspended" {
  if (
    value === "completed" || value === "failed" || value === "incomplete" ||
    value === "interrupted" || value === "aborted" || value === "suspended"
  ) {
    return value;
  }

  return "failed";
}

async function seedFlowStores(options: {
  stores: StoreRegistry;
  flow: FlowInstance;
  action: string;
  requestId: string;
  sessionId?: string;
  orgId?: string;
  userId: string;
  seed?: {
    request?: { state?: Record<string, unknown> };
    session?: { state?: Record<string, unknown>; resources?: Record<string, unknown> };
    user?: { state?: Record<string, unknown>; resources?: Record<string, unknown> };
    org?: { state?: Record<string, unknown>; resources?: Record<string, unknown> };
  };
}): Promise<void> {
  const now = Date.now();

  // Idempotent seeding: only `set()` an entity when no record exists yet for
  // its identity. Lets multiple `testFlow` calls share a registry without
  // resetting journals or resource state on each invocation.

  // Resource state lives in the ResourceStateStore (FIX-689), keyed per-resource
  // and separate from the scope record. Seed it there (idempotently) so flows
  // under test — which load state from the store, not the record — see it.
  const seedResourceState = async (
    scopeType: "session" | "user" | "org",
    scopeId: string,
    resources: Record<string, unknown> | undefined
  ): Promise<void> => {
    if (resources === undefined) return;
    const normalized = toJsonObjectRecord(cloneValue(resources));
    for (const [key, value] of Object.entries(normalized)) {
      // Seed-if-absent against a fresh scope. `"any"` matches the harness's
      // get-then-set shape; nothing else is writing this scope yet.
      const existing = await options.stores.resourceState.get(scopeType, scopeId, key);
      if (existing === undefined) {
        await options.stores.resourceState.set(scopeType, scopeId, key, value, "any");
      }
    }
  };

  if (options.seed?.user !== undefined) {
    const existing = await options.stores.user.get(options.userId);
    if (existing === undefined) {
      await options.stores.user.set(options.userId, {
        id: options.userId,
        userId: options.userId,
        state: toJsonObject(cloneValue(options.seed.user.state ?? {})),
        version: 0,
        createdAt: now,
        updatedAt: now
      }, "any");
    }
    await seedResourceState("user", options.userId, options.seed.user.resources);
  }

  if (options.orgId !== undefined) {
    const existing = await options.stores.org.get(options.orgId);
    if (existing === undefined) {
      await options.stores.org.set(options.orgId, {
        id: options.orgId,
        orgId: options.orgId,
        userId: options.userId,
        state: toJsonObject(cloneValue(options.seed?.org?.state ?? {})),
        version: 0,
        createdAt: now,
        updatedAt: now
      }, "any");
    }
    await seedResourceState("org", options.orgId, options.seed?.org?.resources);
  }

  if (options.sessionId !== undefined) {
    const existing = await options.stores.session.get(options.sessionId);
    // The record carries the generation that fences its resource address
    // (FIX-1000). On a fresh session, mint one and store it; on a reused
    // session (session-resume scenarios, `stores` shared across calls),
    // reuse the existing record's generation so reseeding lands at the same
    // address the first call's resources are already at.
    const record = existing ?? {
      id: options.sessionId,
      flowKind: options.flow.kind,
      userId: options.userId,
      orgId: options.orgId,
      metadata: undefined,
      latestRequestId: undefined,
      state: toJsonObject(cloneValue(options.seed?.session?.state ?? {})),
      storageGeneration: mintStorageGeneration(),
      version: 0,
      createdAt: now,
      updatedAt: now,
      journal: []
    };
    if (existing === undefined) {
      await options.stores.session.set(options.sessionId, record, "any");
    }
    const sessionResourceScopeId = resolveSessionResourceScopeId(record);
    await seedResourceState("session", sessionResourceScopeId, options.seed?.session?.resources);
  }

  if (options.seed?.request !== undefined) {
    // Request IDs are unique per call, so the existence check is mostly
    // defensive — but it keeps the seeding path uniform.
    const existing = await options.stores.request.get(options.requestId);
    if (existing === undefined) {
      await options.stores.request.set(options.requestId, {
        id: options.requestId,
        flowKind: options.flow.kind,
        actionName: options.action,
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
}

/**
 * Executes one flow action in an isolated in-memory runtime and returns item/status artifacts.
 */
export async function testFlow<TInput = unknown>(
  options: TestFlowOptions<TInput>
): Promise<TestFlowResult> {
  const stores = options.stores ?? createInMemoryStores();
  const requestId = generateId("test_flow_req");
  const sessionId = options.sessionId ?? "test-session";
  const orgId = options.seed?.org === undefined ? undefined : "test-org";

  await seedFlowStores({
    stores,
    flow: options.flow,
    action: options.action,
    requestId,
    sessionId,
    orgId,
    userId: options.userId,
    seed: options.seed
  });

  const result = await runAction({
    flow: options.flow,
    actionName: options.action as keyof typeof options.flow.actions & string,
    input: options.input,
    sessionId,
    orgId,
    userId: options.userId,
    requestId,
    stores,
    runtimeConfig: {
      modelResolver: createMockModelResolver({
        generators: options.generators,
        models: options.models,
        policy: options.unmockedGeneratorPolicy,
        unmockedDefault: options.unmockedDefault
      }),
      settings: options.settings
    }
  });

  const persistedRequest = await stores.request.get(requestId);

  return {
    status: normalizeStatus(
      persistedRequest?.status ?? (result.error === undefined ? "completed" : "failed")
    ),
    requestId,
    output: result.output,
    error: result.error,
    items: result.items
  };
}
