/**
 * A user's stored MCP key does not come back from the engine's debug routes.
 *
 * The debug routes skip `client.*` shaping, so `expose: ["setAt"]` alone does
 * not cover them. The key collection's `secret` declaration does. This reads a
 * stored key's record back through the real router, from the same debug item
 * listing the DevTool reads, and checks that `setAt` arrives and the key does
 * not.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores,
  resolveUserStorageKey,
} from "@flow-state-dev/engine";
import { defineMcpCredentialsCollection, MCP_CREDENTIALS_RESOURCE } from "../src/projects/mcp-credentials";

const FLOW = "keys-desk";
const SESSION = "sess_keys";
const USER = "user_1";
const KEY = "lin_api_sentinel_0451";
const SET_AT = "2026-10-13T00:00:00.000Z";

describe("a stored MCP key through the debug routes", () => {
  it("returns when the key was set, never the key", async () => {
    const flow = defineFlow({
      kind: FLOW,
      resources: { [MCP_CREDENTIALS_RESOURCE]: defineMcpCredentialsCollection() },
      actions: { run: { inputSchema: z.object({}), block: handler({ name: "noop", execute: () => "ok" }) } },
    })();
    const stores = createInMemoryStores();
    const registry = createFlowRegistry();
    registry.register(flow);
    await stores.session.set(
      SESSION,
      { id: SESSION, flowKind: FLOW, userId: USER, orgId: DEFAULT_ORG_ID, state: {}, createdAt: Date.now(), updatedAt: Date.now() },
      "any",
    );
    await stores.resourceState.set(
      "user",
      resolveUserStorageKey(USER, DEFAULT_ORG_ID, { id: "", isolateUserState: false }),
      "mcp-credentials/linear",
      { value: KEY, setAt: SET_AT },
      "any",
    );
    const router = createFlowApiRouter({ registry, stores, debugEndpointsEnabled: true, debugAllowAnonymousLocal: true });

    const path = ["sessions", SESSION, "debug", "resources", MCP_CREDENTIALS_RESOURCE, "items"];
    const res = await router.GET(new Request(`http://localhost/api/flows/${path.join("/")}`), { params: { path } });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(KEY);
    const { items } = JSON.parse(text) as { items: Array<{ topic: string; state: unknown }> };
    expect(items).toEqual([expect.objectContaining({ topic: "linear", state: { setAt: SET_AT } })]);
  });
});
