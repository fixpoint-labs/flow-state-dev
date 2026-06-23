import { describe, expect, it } from "vitest";
import { createInMemoryStores } from "../src/stores";
import { handleGetRequestStatus } from "../src/routes/request-status-routes";
import { parseFlowRoute } from "../src/routes/parseFlowRoute";

describe("parseFlowRoute — request_status", () => {
  it("parses GET /api/flows/:flowKind/requests/:requestId/status", () => {
    const route = parseFlowRoute("GET", [
      "chat",
      "requests",
      "req_1",
      "status"
    ]);
    expect(route).toEqual({
      kind: "request_status",
      flowKind: "chat",
      requestId: "req_1"
    });
  });

  it("does not match POST", () => {
    const route = parseFlowRoute("POST", [
      "chat",
      "requests",
      "req_1",
      "status"
    ]);
    // POST /api/flows/:flowKind/requests/:requestId/abort uses the same
    // shape but a different terminal segment, so this should be not_found.
    expect(route.kind).toBe("not_found");
  });
});

describe("handleGetRequestStatus", () => {
  it("returns 404 when the request is unknown", async () => {
    const stores = createInMemoryStores();
    const response = await handleGetRequestStatus(
      new Request("http://test/api/flows/chat/requests/nope/status"),
      { kind: "request_status", flowKind: "chat", requestId: "nope" },
      { stores }
    );
    expect(response.status).toBe(404);
  });

  it("returns 404 when the flowKind doesn't match", async () => {
    const stores = createInMemoryStores();
    const ts = Date.now();
    await stores.request.set(
      "req_1",
      {
        id: "req_1",
        flowKind: "chat",
        actionName: "run",
        userId: "u",
        source: "http",
        status: "in_progress",
        startedAtMs: ts,
        state: {},
        version: 0,
        createdAt: ts,
        updatedAt: ts
      },
      "any"
    );

    const response = await handleGetRequestStatus(
      new Request("http://test/api/flows/other/requests/req_1/status"),
      { kind: "request_status", flowKind: "other", requestId: "req_1" },
      { stores }
    );
    expect(response.status).toBe(404);
  });

  it("projects the snapshot shape with lastHeartbeatAt when registered", async () => {
    const stores = createInMemoryStores();
    const startedAt = Date.now() - 5_000;
    const heartbeat = Date.now() - 1_000;

    await stores.request.set(
      "req_1",
      {
        id: "req_1",
        flowKind: "chat",
        actionName: "run",
        userId: "u",
        source: "http",
        status: "in_progress",
        startedAtMs: startedAt,
        state: {},
        version: 0,
        createdAt: startedAt,
        updatedAt: startedAt
      },
      "any"
    );

    await stores.activeRequests.register({
      requestId: "req_1",
      flowKind: "chat",
      actionName: "run",
      userId: "u",
      source: "http",
      startedAt,
      lastHeartbeatAt: heartbeat
    });

    const response = await handleGetRequestStatus(
      new Request("http://test/api/flows/chat/requests/req_1/status"),
      { kind: "request_status", flowKind: "chat", requestId: "req_1" },
      { stores }
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe("req_1");
    expect(body.status).toBe("in_progress");
    expect(body.startedAtMs).toBe(startedAt);
    expect(body.lastHeartbeatAt).toBe(heartbeat);
    expect(body.ageMs).toBeGreaterThanOrEqual(5_000);
    expect(body.completedAtMs).toBeUndefined();
  });

  it("omits lastHeartbeatAt when no registry entry exists", async () => {
    const stores = createInMemoryStores();
    const startedAt = Date.now() - 5_000;
    const completedAt = Date.now() - 100;

    await stores.request.set(
      "req_1",
      {
        id: "req_1",
        flowKind: "chat",
        actionName: "run",
        userId: "u",
        source: "http",
        status: "completed",
        startedAtMs: startedAt,
        completedAtMs: completedAt,
        state: {},
        version: 0,
        createdAt: startedAt,
        updatedAt: completedAt
      },
      "any"
    );

    const response = await handleGetRequestStatus(
      new Request("http://test/api/flows/chat/requests/req_1/status"),
      { kind: "request_status", flowKind: "chat", requestId: "req_1" },
      { stores }
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("completed");
    expect(body.completedAtMs).toBe(completedAt);
    expect(body.lastHeartbeatAt).toBeUndefined();
  });
});
