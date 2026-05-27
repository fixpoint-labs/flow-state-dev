/**
 * Test for the session-requests list endpoint over-fetch fix (FIX-685
 * Slice D). `GET /sessions/:id/requests` must not request full item logs
 * (`withItems: true`) just to list request summaries; pagination filters
 * still pass through to the store.
 */
import { describe, expect, it, vi } from "vitest";
import { handleListSessionRequests } from "../src/routes/session-routes";
import { createInMemoryStores } from "../src";
import type { FlowRegistry } from "../src/registry/flow-registry";
import type { ParsedFlowRoute } from "../src/routes/parseFlowRoute";
import type { SessionRecord, StoreRegistry } from "../src/stores/types";

const registry = { get: () => undefined } as unknown as FlowRegistry;

function sessionRecord(id: string): SessionRecord {
  return {
    id,
    flowKind: "demo",
    userId: "u1",
    state: {},
    resources: {},
    version: 1,
    createdAt: 1,
    updatedAt: 1,
    journal: []
  };
}

function route(sessionId: string): Extract<ParsedFlowRoute, { kind: "list_session_requests" }> {
  return { kind: "list_session_requests", sessionId };
}

describe("session-requests list over-fetch (Slice D)", () => {
  it("does not request item logs and forwards pagination filters", async () => {
    const stores: StoreRegistry = createInMemoryStores();
    await stores.session.set("sess_1", sessionRecord("sess_1"), "any");

    const listSpy = vi.spyOn(stores.request, "list");

    const response = await handleListSessionRequests(
      new Request("https://x/api/flows/sessions/sess_1/requests?limit=5&offset=2&status=completed"),
      route("sess_1"),
      { registry, stores }
    );

    expect(response.status).toBe(200);
    expect(listSpy).toHaveBeenCalledTimes(1);
    const args = listSpy.mock.calls[0]![0]!;
    expect(args.withItems).not.toBe(true);
    expect(args).toMatchObject({ sessionId: "sess_1", limit: 5, offset: 2, status: "completed" });
  });
});
