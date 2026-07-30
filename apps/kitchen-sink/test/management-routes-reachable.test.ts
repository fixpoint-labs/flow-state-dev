/**
 * The management surface stays reachable for this app's browser-facing flows.
 *
 * The kitchen-sink is a mixed app: `chat-agent` and `rich-text-component` are
 * open, while `weekly-digest` configures an `authentication.resolvePrincipal`
 * so its scheduled dispatch can be bearer-authenticated. Route-level
 * authorization in the engine keys off "does a resolver govern this route", so
 * the digest flow's presence must not make the app's cross-flow endpoints
 * unserviceable — `GET /api/flows/sessions` backs the session list the UI loads
 * on mount, and a `401` there leaves the composer disabled with no visible
 * cause.
 *
 * Guarding it here rather than only in the E2E suite: this reproduces the
 * failure in milliseconds against the real flow definitions, where Playwright
 * needs a production build and reports it as a disabled textarea.
 */
import { describe, expect, it } from "vitest";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores
} from "@flow-state-dev/engine";
import chatAgentFlow from "../flows/chat-agent/flow";
import richTextComponentFlow from "../flows/rich-text-component/flow";
import weeklyDigestFlow from "../flows/weekly-digest/flow";

function buildRouter() {
  const registry = createFlowRegistry();
  registry.register(chatAgentFlow);
  registry.register(richTextComponentFlow);
  registry.register(weeklyDigestFlow);
  return {
    router: createFlowApiRouter({ registry, stores: createInMemoryStores() }),
    registry
  };
}

function get(router: ReturnType<typeof createFlowApiRouter>, path: string[]) {
  return router.GET(
    new Request(`http://localhost/api/flows/${path.join("/")}`),
    { params: { path } }
  );
}

describe("kitchen-sink management routes", () => {
  it("confirms the app really is mixed", async () => {
    // If this stops holding, the test below no longer exercises what it claims
    // to and the assertions above it are vacuous.
    const { registry } = buildRouter();
    const digest = registry.get("weekly-digest");
    const chat = registry.get("chat-agent");

    expect(digest?.authentication?.resolvePrincipal).toBeDefined();
    expect(chat?.authentication?.resolvePrincipal).toBeUndefined();
  });

  it("serves the session list that the UI loads on mount", async () => {
    const { router } = buildRouter();

    const res = await get(router, ["sessions"]);

    expect(res.status).toBe(200);
  });

  it("serves the active-request listing", async () => {
    const { router } = buildRouter();

    const res = await get(router, ["active-requests"]);

    expect(res.status).toBe(200);
  });

  it("keeps an open flow's session readable", async () => {
    const { router } = buildRouter();
    const created = await router.POST(
      new Request("http://localhost/api/flows/chat-agent/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "s-e2e", userId: "e2e-user" })
      }),
      { params: { path: ["chat-agent", "sessions"] } }
    );
    expect(created.status).toBe(201);

    const res = await get(router, ["sessions", "s-e2e"]);

    expect(res.status).toBe(200);
  });
});
