import { createInMemoryStores, runAction, type StoreRegistry } from "@flow-state-dev/server";
import type { FlowInstance } from "@flow-state-dev/core/types";
import type { JsonObject, JsonValue } from "@flow-state-dev/core/types";
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

function normalizeStatus(
  value: "in_progress" | "completed" | "failed" | "incomplete" | undefined
): "completed" | "failed" | "incomplete" {
  if (value === "completed" || value === "failed" || value === "incomplete") {
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
  projectId?: string;
  userId: string;
  seed?: {
    request?: Record<string, unknown>;
    session?: Record<string, unknown>;
    user?: Record<string, unknown>;
    project?: Record<string, unknown>;
  };
}): Promise<void> {
  const now = Date.now();

  if (options.seed?.user !== undefined) {
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
      state: toJsonObject(cloneRecord(options.seed?.project ?? {})),
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
      state: toJsonObject(cloneRecord(options.seed?.session ?? {})),
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

  if (options.seed?.request !== undefined) {
    await options.stores.request.set(options.requestId, {
      id: options.requestId,
      flowKind: options.flow.kind,
      actionName: options.action,
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

/**
 * Executes one flow action in an isolated in-memory runtime and returns item/status artifacts.
 */
export async function testFlow<TInput = unknown>(
  options: TestFlowOptions<TInput>
): Promise<TestFlowResult> {
  const stores = createInMemoryStores();
  const requestId = generateId("test_flow_req");
  const sessionId =
    options.sessionId ?? (options.flow.requireSession ? "test-session" : undefined);
  const projectId = options.seed?.project === undefined ? undefined : "test-project";

  await seedFlowStores({
    stores,
    flow: options.flow,
    action: options.action,
    requestId,
    sessionId,
    projectId,
    userId: options.userId,
    seed: options.seed
  });

  const result = await runAction({
    flow: options.flow,
    actionName: options.action as keyof typeof options.flow.actions & string,
    input: options.input,
    sessionId,
    projectId,
    userId: options.userId,
    requestId,
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
