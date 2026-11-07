/**
 * `GET /sessions?include=status` (FIX-2411): each row's latest request
 * status, so a list of sessions shows which one needs its user without the
 * browser reading every session's requests.
 *
 * The rule is the runs listing's: a request still going wins over a later one
 * that ended; else the most recent speaks. `suspended` and `interrupted` go
 * out as themselves, since the user acts on each. Without the include, the
 * rows carry no status, as before.
 */
import { defineFlow, handler, DEFAULT_ORG_ID } from "@flow-state-dev/core";
import type { FlowInstance, RequestStatus } from "@flow-state-dev/core/types";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  createCheckpointDurabilityProvider,
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores,
  type StoreRegistry
} from "../src";
import { type RequestRecord } from "../src/host";

const notes = defineFlow({
  kind: "notes",
  actions: {
    run: {
      inputSchema: z.object({}),
      block: handler({ name: "run", inputSchema: z.object({}), execute: () => ({}) })
    }
  }
});

function host(stores: StoreRegistry) {
  const registry = createFlowRegistry();
  registry.registerMany([notes() as unknown as FlowInstance]);
  return createFlowApiRouter({ registry, stores });
}

async function seedSession(stores: StoreRegistry, id: string, userId = "u_1"): Promise<void> {
  const now = Date.now();
  await stores.session.set(
    id,
    { id, orgId: DEFAULT_ORG_ID, flowKind: "notes", flowId: "notes", userId, state: {}, version: 0, createdAt: now, updatedAt: now, journal: [] },
    "any"
  );
}

async function seedRequest(
  stores: StoreRegistry,
  id: string,
  sessionId: string,
  status: RequestStatus,
  startedAtMs: number,
  userId = "u_1"
): Promise<void> {
  await stores.request.set(
    id,
    {
      id,
      sessionId,
      flowKind: "notes",
      flowId: "notes",
      actionName: "run",
      userId,
      orgId: DEFAULT_ORG_ID,
      source: "http",
      status,
      startedAtMs,
      state: {},
      version: 0,
      createdAt: startedAtMs,
      updatedAt: startedAtMs
    } as unknown as RequestRecord,
    "any"
  );
}

async function statuses(router: ReturnType<typeof createFlowApiRouter>, query: string): Promise<Record<string, unknown>> {
  const response = await router.GET(new Request(`http://localhost/api/flows/sessions${query}`), {
    params: { path: ["sessions"] }
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { sessions: Array<{ id: string; requestStatus?: string }> };
  return Object.fromEntries(body.sessions.map((s) => [s.id, s.requestStatus ?? null]));
}

describe("GET /sessions?include=status", () => {
  it("gives each row its latest request's status, keeping the ones the user acts on apart", async () => {
    const stores = createInMemoryStores();
    await seedSession(stores, "s_done");
    await seedRequest(stores, "r1", "s_done", "failed", 1000);
    await seedRequest(stores, "r2", "s_done", "completed", 2000);
    await seedSession(stores, "s_failed");
    await seedRequest(stores, "r3", "s_failed", "completed", 1000);
    await seedRequest(stores, "r4", "s_failed", "failed", 2000);
    await seedSession(stores, "s_waiting");
    await seedRequest(stores, "r5", "s_waiting", "suspended", 1000);
    await seedSession(stores, "s_lost");
    await seedRequest(stores, "r6", "s_lost", "interrupted", 1000);
    await seedSession(stores, "s_new");

    expect(await statuses(host(stores), "?flowKind=notes&include=status")).toEqual({
      s_done: "completed",
      s_failed: "failed",
      s_waiting: "suspended",
      s_lost: "interrupted",
      s_new: null
    });
  });

  it("says whether a stopped turn waits for the user or on other work", async () => {
    const stores = createInMemoryStores();
    const stop = (requestId: string, sessionId: string, reason: string) =>
      stores.suspensions.set({
        suspensionId: `stop_${requestId}`,
        requestId,
        flowKind: "notes",
        actionName: "run",
        sessionId,
        userId: "u_1",
        reason,
        message: "",
        status: "pending",
        blockInstanceId: "b",
        stepIndex: 0,
        createdAt: 1
      } as never);
    await seedSession(stores, "s_question");
    await seedRequest(stores, "rq", "s_question", "suspended", 1000);
    await stop("rq", "s_question", "user_input");
    await seedSession(stores, "s_reply");
    await seedRequest(stores, "rw", "s_reply", "suspended", 1000);
    await stop("rw", "s_reply", "wait");
    await seedSession(stores, "s_done");
    await seedRequest(stores, "rd", "s_done", "completed", 1000);

    const response = await host(stores).GET(
      new Request("http://localhost/api/flows/sessions?flowKind=notes&include=status"),
      { params: { path: ["sessions"] } }
    );
    const body = (await response.json()) as {
      sessions: Array<{ id: string; requestStatus?: string; requestWaitsForUser?: boolean }>;
    };
    const rows = Object.fromEntries(body.sessions.map((s) => [s.id, [s.requestStatus, s.requestWaitsForUser]]));
    // A question waits for the user; a wait on another worker's reply resumes by itself.
    expect(rows).toEqual({
      s_question: ["suspended", true],
      s_reply: ["suspended", false],
      s_done: ["completed", undefined]
    });
  });

  it("reads a stopped row's stops where the host's durability provider keeps them", async () => {
    const stores = createInMemoryStores();
    // The provider writes stops to its own storage, not to `stores.suspensions`.
    const elsewhere = createInMemoryStores();
    const durabilityProvider = createCheckpointDurabilityProvider(elsewhere);
    await seedSession(stores, "s_question");
    await seedRequest(stores, "rq", "s_question", "suspended", 1000);
    await durabilityProvider.suspend({
      suspensionId: "stop_rq",
      requestId: "rq",
      flowKind: "notes",
      actionName: "run",
      sessionId: "s_question",
      userId: "u_1",
      reason: "user_input",
      message: "",
      status: "pending",
      blockInstanceId: "b",
      stepIndex: 0,
      createdAt: 1
    } as never);

    const registry = createFlowRegistry();
    registry.registerMany([notes() as unknown as FlowInstance]);
    const router = createFlowApiRouter({ registry, stores, runtimeConfig: { durabilityProvider } });
    const response = await router.GET(
      new Request("http://localhost/api/flows/sessions?flowKind=notes&include=status"),
      { params: { path: ["sessions"] } }
    );
    const body = (await response.json()) as { sessions: Array<{ id: string; requestWaitsForUser?: boolean }> };
    expect(body.sessions.find((s) => s.id === "s_question")?.requestWaitsForUser).toBe(true);
  });

  it("lets a request still going win over a later one that ended", async () => {
    const stores = createInMemoryStores();
    await seedSession(stores, "s1");
    await seedRequest(stores, "early", "s1", "in_progress", 1000);
    await seedRequest(stores, "late", "s1", "completed", 2000);
    expect(await statuses(host(stores), "?flowKind=notes&include=status")).toEqual({ s1: "in_progress" });
  });

  it("reads only the session's own requests, never another owner's under the same id", async () => {
    const stores = createInMemoryStores();
    await seedSession(stores, "s1");
    await seedRequest(stores, "mine", "s1", "completed", 1000);
    await seedRequest(stores, "theirs", "s1", "failed", 2000, "u_2");
    expect(await statuses(host(stores), "?flowKind=notes&include=status")).toEqual({ s1: "completed" });
  });

  it("combines with dispatch-runs, and leaves rows without a status when not asked", async () => {
    const stores = createInMemoryStores();
    await seedSession(stores, "s1");
    await seedRequest(stores, "r1", "s1", "failed", 1000);
    expect(await statuses(host(stores), "?flowKind=notes&include=dispatch-runs,status")).toEqual({ s1: "failed" });
    expect(await statuses(host(stores), "?flowKind=notes")).toEqual({ s1: null });
  });

  it("refuses an include it doesn't know, naming both it accepts", async () => {
    const stores = createInMemoryStores();
    const response = await host(stores).GET(new Request("http://localhost/api/flows/sessions?include=stauts"), {
      params: { path: ["sessions"] }
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain(`"status"`);
  });
});
