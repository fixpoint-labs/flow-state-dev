import { createInMemoryStores, runAction, type StoreRegistry } from "@flow-state-dev/server";
import type { FlowInstance } from "@flow-state-dev/core/types";
import type { JsonObject, JsonValue } from "@flow-state-dev/core/types";
import { createMockModelResolver } from "../mocks/mockGenerator";
import type { TestFlowOptions, TestFlowResult } from "./types";

function cloneRecord<TValue extends Record<string, unknown>>(value: TValue): TValue {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value) as TValue;
  }

  return JSON.parse(JSON.stringify(value)) as TValue;
}

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
  value: "in_progress" | "completed" | "failed" | "incomplete" | "interrupted" | "aborted" | undefined
): "completed" | "failed" | "incomplete" | "interrupted" | "aborted" {
  if (value === "completed" || value === "failed" || value === "incomplete" || value === "interrupted" || value === "aborted") {
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

  if (options.seed?.user !== undefined) {
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
      state: toJsonObject(cloneRecord(options.seed?.org?.state ?? {})),
      resources:
        options.seed?.org?.resources === undefined
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
      state: toJsonObject(cloneRecord(options.seed?.session?.state ?? {})),
      resources:
        options.seed?.session?.resources === undefined
          ? undefined
          : toJsonObjectRecord(cloneRecord(options.seed.session.resources)),
      version: 0,
      createdAt: now,
      updatedAt: now,
      journal: []
    }, "any");
  }

  if (options.seed?.request !== undefined) {
    await options.stores.request.set(options.requestId, {
      id: options.requestId,
      flowKind: options.flow.kind,
      actionName: options.action,
      userId: options.userId,
      sessionId: options.sessionId,
      orgId: options.orgId,
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

/**
 * Executes one flow action in an isolated in-memory runtime and returns item/status artifacts.
 */
export async function testFlow<TInput = unknown>(
  options: TestFlowOptions<TInput>
): Promise<TestFlowResult> {
  const stores = createInMemoryStores();
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
    modelResolver: createMockModelResolver({
      generators: options.generators,
      models: options.models,
      policy: options.unmockedGeneratorPolicy
    }),
    stores
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
