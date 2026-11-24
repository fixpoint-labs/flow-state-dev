/**
 * The HTTP action route answers a send that names no session — not in the
 * path, not in the body — `400 { error: "session-required" }`, before it
 * resolves the caller or writes anything. Only the caller knows which
 * conversation it means, so the server never guesses one. The sessionless
 * route form stays registered, so a body `sessionId` still works there and a
 * missing one gets this named answer, not a 404.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { createFlowApiRouter, createFlowRegistry } from "../src";
import { createInMemoryStores } from "../src/host";

function build() {
  const flow = defineFlow({
    kind: "needs-session",
    actions: {
      run: { block: handler({ name: "run", inputSchema: z.object({}), outputSchema: z.object({}), execute: () => ({}) }) }
    }
  })();
  const registry = createFlowRegistry();
  registry.register(flow);
  const stores = createInMemoryStores();
  const router = createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0 });
  const send = (path: string[], body: Record<string, unknown>) =>
    router.POST(
      new Request(`http://localhost/api/flows/${path.join("/")}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      }),
      { params: { path } }
    );
  return { send, stores };
}

describe("an HTTP send with no session id", () => {
  it.each([
    ["no sessionId", { input: {} }],
    ["an empty sessionId", { input: {}, sessionId: "" }]
  ])("is refused session-required with %s, before principal resolution, writing nothing", async (_name, body) => {
    const { send, stores } = build();
    // No userId either: the default resolver would refuse that by name, so a
    // session-required answer shows the session was checked first.
    const res = await send(["needs-session", "actions", "run"], body);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "session-required" });
    expect(await stores.request.list()).toEqual([]);
    expect(await stores.session.list()).toEqual([]);
    expect(await stores.activeRequests.listAll()).toEqual([]);
  });

  it("runs on the same route once the body names a session", async () => {
    const { send, stores } = build();
    const res = await send(["needs-session", "actions", "run"], { input: {}, userId: "u", sessionId: "s-body" });
    expect(res.status).toBeLessThan(300);
    await res.text();
    const [record] = await stores.request.list();
    expect(record?.sessionId).toBe("s-body");
  });
});
