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
import { resolveDurabilityProvider, runAction, type StoreRegistry } from "@flow-state-dev/engine";
import { createInMemoryStores } from "@flow-state-dev/engine/host";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import type { FlowInstance, RequestStatus } from "@flow-state-dev/core/types";
import type { OutputItem, SuspensionItem } from "@flow-state-dev/core/items";
import { cloneValue } from "@flow-state-dev/core/helpers";
import {
  generateId,
  toJsonObject,
  toJsonObjectRecord
} from "../internal/json-helpers";
import { createMockModelResolver } from "../mocks/mockGenerator";
import { userSeedCell } from "../internal/user-cell";
import { answerThroughRoute } from "./answerThroughRoute";
import type { TestFlowAnswer, TestFlowOptions, TestFlowResult } from "./types";

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
  /** The org the run uses: the seeded org, or `DEFAULT_ORG_ID`. */
  orgId: string;
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
    // The user's cell in the run's org, where the run reads it.
    const cell = userSeedCell(options.flow, options.userId, options.orgId);
    const existing = await options.stores.user.get(cell);
    if (existing === undefined) {
      await options.stores.user.set(cell, {
        id: cell,
        userId: options.userId,
        state: toJsonObject(cloneValue(options.seed.user.state ?? {})),
        version: 0,
        createdAt: now,
        updatedAt: now
      }, "any");
    }
    for (const [key, value] of Object.entries(options.seed.user.resources ?? {})) {
      await seedResourceState("user", userSeedCell(options.flow, options.userId, options.orgId, key), {
        [key]: value
      });
    }
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
    if (existing === undefined) {
      await options.stores.session.set(options.sessionId, {
        id: options.sessionId,
        flowKind: options.flow.kind,
        flowId: options.flow.id,
        userId: options.userId,
        orgId: options.orgId,
        metadata: undefined,
        latestRequestId: undefined,
        state: toJsonObject(cloneValue(options.seed?.session?.state ?? {})),
        version: 0,
        createdAt: now,
        updatedAt: now,
        journal: []
      }, "any");
    }
    await seedResourceState("session", options.sessionId, options.seed?.session?.resources);
  }

  if (options.seed?.request !== undefined) {
    // Request IDs are unique per call, so the existence check is mostly
    // defensive — but it keeps the seeding path uniform.
    const existing = await options.stores.request.get(options.requestId);
    if (existing === undefined) {
      await options.stores.request.set(options.requestId, {
        id: options.requestId,
        flowKind: options.flow.kind,
        flowId: options.flow.id,
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
 * The stops the run is waiting on: its `suspension` items that no
 * `suspension_resume` item answered.
 */
function pendingSuspensions(items: readonly OutputItem[]): SuspensionItem[] {
  const answered = new Set(
    items.flatMap((item) => (item.type === "suspension_resume" ? [item.suspensionId] : []))
  );
  return items.filter(
    (item): item is SuspensionItem => item.type === "suspension" && !answered.has(item.suspensionId)
  );
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
    orgId: orgId ?? DEFAULT_ORG_ID,
    userId: options.userId,
    seed: options.seed
  });

  // One runtime config for the run and every continuation of it: the test's
  // mocks, settings and durability. Durable by default, as a host with
  // persistent stores is, so a step that waits for a person stops the run.
  const runtimeConfig = {
    modelResolver: createMockModelResolver({
      generators: options.generators,
      models: options.models,
      policy: options.unmockedGeneratorPolicy,
      unmockedDefault: options.unmockedDefault
    }),
    settings: options.settings,
    durabilityProvider: resolveDurabilityProvider({ stores, durable: options.durable ?? true })
  };

  const result = await runAction({
    flow: options.flow,
    actionName: options.action as keyof typeof options.flow.actions & string,
    input: options.input,
    sessionId,
    orgId: orgId ?? DEFAULT_ORG_ID,
    userId: options.userId,
    requestId,
    stores,
    runtimeConfig
  });

  const persistedRequest = await stores.request.get(requestId);

  return testFlowResult(
    { flow: options.flow, stores, runtimeConfig, requestId },
    {
      status: normalizeStatus(
        persistedRequest?.status ?? (result.error === undefined ? "completed" : "failed")
      ),
      output: result.output,
      error: result.error,
      items: result.items
    }
  );
}

type RunContext = Parameters<typeof answerThroughRoute>[0];

/**
 * A run's result, with `answer` and `resume` bound to it: each continues the
 * run through the engine's route and returns the run that followed, which
 * can be answered in turn.
 */
function testFlowResult(
  context: RunContext,
  fields: Pick<TestFlowResult, "status" | "output" | "error" | "items">
): TestFlowResult {
  const waiting = pendingSuspensions(fields.items as OutputItem[]);
  const through = (route: "answer" | "resume") => async (answer: TestFlowAnswer): Promise<TestFlowResult> => {
    const suspensionId = answer.suspensionId ?? onlyStop(waiting, route);
    const outcome = await answerThroughRoute(context, {
      route,
      suspensionId,
      action: answer.action,
      data: answer.data,
      headers: answer.headers
    });
    return testFlowResult(context, { status: normalizeStatus(outcome.status), items: outcome.items });
  };
  return {
    ...fields,
    requestId: context.requestId,
    suspension: waiting.at(-1),
    answer: through("answer"),
    resume: through("resume")
  };
}

/** The one stop a call without a `suspensionId` answers; throws when there is none, or several. */
function onlyStop(waiting: SuspensionItem[], route: "answer" | "resume"): string {
  if (waiting.length === 0) {
    throw new Error(`run.${route}: this run is not waiting on a stop`);
  }
  if (waiting.length > 1) {
    throw new Error(
      `run.${route}: this run waits on ${waiting.length} stops (${waiting.map((s) => s.suspensionId).join(", ")}); pass suspensionId`
    );
  }
  return waiting[0]!.suspensionId;
}
