import { describe, expect, it } from "vitest";
import { parseFlowRoute } from "../src/routes/parseFlowRoute";

describe("parseFlowRoute — recovery routes", () => {
  it("parses retry_request route", () => {
    // POST /api/flows/:flowKind/sessions/:sessionId/requests/:requestId/retry
    const route = parseFlowRoute("POST", [
      "chat", "sessions", "sess_1", "requests", "req_1", "retry"
    ]);

    expect(route).toEqual({
      kind: "retry_request",
      flowKind: "chat",
      sessionId: "sess_1",
      requestId: "req_1"
    });
  });

  it("parses continue_request route", () => {
    // POST /api/flows/:flowKind/sessions/:sessionId/requests/:requestId/continue
    const route = parseFlowRoute("POST", [
      "chat", "sessions", "sess_1", "requests", "req_1", "continue"
    ]);

    expect(route).toEqual({
      kind: "continue_request",
      flowKind: "chat",
      sessionId: "sess_1",
      requestId: "req_1"
    });
  });

  it("does not match continue with wrong method", () => {
    const route = parseFlowRoute("GET", [
      "chat", "sessions", "sess_1", "requests", "req_1", "continue"
    ]);
    expect(route.kind).toBe("not_found");
  });

  it("parses active_requests route", () => {
    // GET /api/flows/active-requests
    const route = parseFlowRoute("GET", ["active-requests"]);
    expect(route).toEqual({ kind: "active_requests" });
  });

  it("does not match retry with wrong method", () => {
    const route = parseFlowRoute("GET", [
      "chat", "sessions", "sess_1", "requests", "req_1", "retry"
    ]);
    expect(route.kind).toBe("not_found");
  });

  it("does not match active_requests with POST", () => {
    const route = parseFlowRoute("POST", ["active-requests"]);
    expect(route.kind).toBe("not_found");
  });

  it("parses check_interrupted_requests route", () => {
    // POST /api/flows/users/:userId/check-interrupted
    const route = parseFlowRoute("POST", ["users", "alice", "check-interrupted"]);
    expect(route).toEqual({
      kind: "check_interrupted_requests",
      userId: "alice"
    });
  });

  it("does not match check_interrupted_requests with GET", () => {
    const route = parseFlowRoute("GET", ["users", "alice", "check-interrupted"]);
    expect(route.kind).toBe("not_found");
  });
});
