/**
 * The connector keys route `defineProjectBlocks` serves (`.connectorKeys`):
 * each user's own key for a connector the host offers, read as whether it is
 * set and when, set, and cleared, never through an action.
 *
 * The caller is the user the projects flow's own sign-in verifies, never a
 * field of the body or the path (BP-031). The offered connectors are the
 * blocks' own `mcpServers`, so a host keeps one list; a host offering none
 * serves no route. Keys are stored under `mcp-credentials/<server>` in the
 * caller's user scope, the prefix the run's resolution reads.
 *
 * Real engine, real HTTP router, in process.
 */
import { afterEach, describe, expect, it } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { createFlowState, createInProcessFetch, inMemoryStores, PrincipalResolutionError, resolveUserStorageKey, type FlowState } from "@flow-state-dev/engine";
import { defineProjectBlocks, MCP_CREDENTIALS_PREFIX, PROJECTS_FLOW } from "../src/index";
import { CONNECTOR_KEYS_PATH, type ConnectorKeyStatus } from "../src/browser";

const ORG = "acme";
const SENTINEL = `lin_api_SENTINEL${Math.random().toString(36).slice(2)}`;
const BEARERS: Record<string, string> = { "token-alice": "alice", "token-bob": "bob" };
/** The same user id signed in under a second org. */
const OTHER_ORG = "globex";

const states: FlowState[] = [];
afterEach(async () => {
  for (const state of states.splice(0)) await state.dispose();
});

/**
 * A host whose projects flow is built from the blocks offering `servers`,
 * signing in by the flow's own resolver (a bearer it knows), with the blocks'
 * route mounted. No app-level resolver: the route must ask the projects flow's.
 */
async function host(servers: readonly string[] | undefined) {
  const projects = defineProjectBlocks(servers === undefined ? {} : { mcpServers: servers });
  const state = createFlowState({
    flows: [
      defineFlow({
        kind: PROJECTS_FLOW,
        actions: { ...projects.actions },
        views: { ...projects.views },
        authentication: {
          resolvePrincipal: (context: { request?: Request }) => {
            const bearer = context.request?.headers.get("authorization")?.replace(/^Bearer /, "");
            // A sign-in that breaks, rather than refusing: not a 401.
            if (bearer === "token-broken") throw new Error("the sign-in service is down");
            // The engine's own error for a host it can't sign anyone in on: a 500, not a refusal.
            if (bearer === "token-misconfigured") throw new PrincipalResolutionError("the flow has no user to sign in", { status: 500 });
            if (bearer === "token-alice-globex") return { userId: "alice", orgId: OTHER_ORG };
            const user = bearer === undefined ? undefined : BEARERS[bearer];
            return user === undefined ? null : { userId: user, orgId: ORG };
          }
        }
      } as never)
    ],
    stores: { default: { primary: inMemoryStores() } },
    adapters: [projects.connectorKeys]
  } as never);
  states.push(state);
  await state.ready();
  const inProcess = createInProcessFetch(state);
  const door = async (
    method: "GET" | "POST" | "DELETE",
    server?: string,
    options: { as?: "alice" | "alice-globex" | "bob" | "broken" | "misconfigured" | null; body?: unknown; raw?: string; headers?: Record<string, string> } = {}
  ): Promise<{ status: number; body: any }> => {
    const as = options.as === undefined ? "alice" : options.as;
    const response = await inProcess(`http://host${CONNECTOR_KEYS_PATH}${server === undefined ? "" : `/${server}`}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(as === null ? {} : { authorization: `Bearer token-${as}` }),
        ...options.headers
      },
      ...(options.raw !== undefined ? { body: options.raw } : options.body === undefined ? {} : { body: JSON.stringify(options.body) })
    });
    const text = await response.text();
    return { status: response.status, body: text.length > 0 ? JSON.parse(text) : undefined };
  };
  const stored = async (user: string, server: string, org: string = ORG) => {
    const cell = resolveUserStorageKey(user, org, { id: "", isolateUserState: false });
    return (await (await state.getRuntime()).stores.resourceState.get("user", cell, `${MCP_CREDENTIALS_PREFIX}${server}`))?.state;
  };
  return { door, stored };
}

describe("a user's connector keys, through the blocks' route", () => {
  it("sets, replaces and clears the caller's own key, and answers only whether it is set and when", async () => {
    const h = await host(["linear"]);
    const unset: ConnectorKeyStatus[] = [{ name: "linear", setAt: null }];
    expect(await h.door("GET")).toEqual({ status: 200, body: { servers: unset } });

    const set = await h.door("POST", "linear", { body: { value: SENTINEL } });
    expect(set).toEqual({ status: 200, body: { name: "linear", setAt: expect.any(String) } });
    const read = await h.door("GET");
    expect(read.body.servers).toEqual([{ name: "linear", setAt: set.body.setAt }]);
    expect(JSON.stringify([set, read])).not.toContain("SENTINEL");
    // Stored where a run's resolution reads it: the caller's own record, under the kept prefix.
    expect(await h.stored("alice", "linear")).toEqual({ value: SENTINEL, setAt: set.body.setAt });

    // Each user's own: the other user's read says nothing of alice's key, and their set leaves it.
    expect((await h.door("GET", undefined, { as: "bob" })).body.servers).toEqual(unset);
    expect((await h.door("POST", "linear", { as: "bob", body: { value: "other-key" } })).status).toBe(200);
    expect((await h.door("GET")).body.servers[0].setAt).toBe(set.body.setAt);
    expect((await h.stored("alice", "linear")) as { value: string }).toMatchObject({ value: SENTINEL });

    expect(await h.door("DELETE", "linear")).toEqual({ status: 200, body: { name: "linear", setAt: null } });
    expect((await h.door("GET")).body.servers).toEqual(unset);
    expect(await h.stored("alice", "linear")).toBeUndefined();
    expect((await h.door("GET", undefined, { as: "bob" })).body.servers[0].setAt).not.toBeNull();
  });

  it("refuses a connector the host doesn't offer, an empty key and one with whitespace, without echoing it", async () => {
    const h = await host(["linear", "github"]);
    const unknown = await h.door("POST", "jira", { body: { value: SENTINEL } });
    expect(unknown.status).toBe(404);
    expect(unknown.body).toMatchObject({ error: "unknown-mcp-server", message: expect.stringContaining("It offers: linear, github") });
    expect((await h.door("DELETE", "jira")).status).toBe(404);
    for (const value of ["", `${SENTINEL} trailing`, `${SENTINEL}\n`, 42]) {
      const refused = await h.door("POST", "linear", { body: { value } });
      expect(refused.status, JSON.stringify(value)).toBe(400);
      expect(refused.body.error).toBe("invalid-mcp-credential");
      expect(JSON.stringify(refused)).not.toContain("SENTINEL");
    }
    expect(JSON.stringify(unknown)).not.toContain("SENTINEL");
    expect(await h.stored("alice", "jira")).toBeUndefined();
    expect((await h.door("GET")).body.servers).toEqual([
      { name: "linear", setAt: null },
      { name: "github", setAt: null }
    ]);
  });

  it("refuses a caller the projects flow's sign-in can't verify, 401, before anything is read or written", async () => {
    const h = await host(["linear"]);
    expect((await h.door("GET", undefined, { as: null })).status).toBe(401);
    expect((await h.door("POST", "linear", { as: null, body: { value: SENTINEL } })).status).toBe(401);
    expect((await h.door("DELETE", "linear", { as: null })).status).toBe(401);
    // A userId in the body is not a sign-in.
    expect((await h.door("POST", "linear", { as: null, body: { value: SENTINEL, userId: "alice" } })).status).toBe(401);
    expect(await h.stored("alice", "linear")).toBeUndefined();
  });

  it("answers a sign-in that breaks as a server error, not a refusal, and writes nothing", async () => {
    const h = await host(["linear"]);
    const broken = await h.door("POST", "linear", { as: "broken", body: { value: SENTINEL } }).catch((error: unknown) => error);
    // Whatever the host makes of a thrown handler, it is not the route's 401 refusal.
    expect((broken as { status?: number }).status).not.toBe(401);
    expect(await h.stored("alice", "linear")).toBeUndefined();
  });

  it("lets the engine's own 500 through as a server error, not a refusal, and writes nothing", async () => {
    const h = await host(["linear"]);
    const misconfigured = await h.door("POST", "linear", { as: "misconfigured", body: { value: SENTINEL } }).catch((error: unknown) => error);
    // Only a 4xx sign-in is the caller being refused; a server-side failure stays one.
    expect((misconfigured as { body?: { error?: string } }).body?.error).not.toBe("unauthorized");
    expect(await h.stored("alice", "linear")).toBeUndefined();
  });

  it("refuses a write from another site, 403, and stores nothing, as the router refuses every other browser write", async () => {
    const h = await host(["linear"]);
    // A foreign page's no-preflight form: a CORS-safelisted content type, sent cross-site with the victim's credentials.
    const crossSite = { "content-type": "text/plain", "sec-fetch-site": "cross-site" };
    const post = await h.door("POST", "linear", { raw: JSON.stringify({ value: SENTINEL }), headers: crossSite });
    expect(post.status).toBe(403);
    expect(await h.stored("alice", "linear")).toBeUndefined();
    // Even as JSON, a cross-site set or clear is refused.
    expect((await h.door("POST", "linear", { body: { value: SENTINEL }, headers: { "sec-fetch-site": "cross-site" } })).status).toBe(403);
    expect(await h.stored("alice", "linear")).toBeUndefined();
    expect((await h.door("POST", "linear", { body: { value: SENTINEL } })).status).toBe(200);
    expect((await h.door("DELETE", "linear", { headers: { "sec-fetch-site": "cross-site" } })).status).toBe(403);
    expect(await h.stored("alice", "linear")).toMatchObject({ value: SENTINEL });
    // Same-site and same-origin writes are the screens' own.
    expect((await h.door("DELETE", "linear", { headers: { "sec-fetch-site": "same-origin" } })).status).toBe(200);
  });

  it("refuses a set whose body isn't JSON, 415, and stores nothing", async () => {
    const h = await host(["linear"]);
    const refused = await h.door("POST", "linear", { raw: JSON.stringify({ value: SENTINEL }), headers: { "content-type": "text/plain" } });
    expect(refused.status).toBe(415);
    expect(JSON.stringify(refused)).not.toContain("SENTINEL");
    expect(await h.stored("alice", "linear")).toBeUndefined();
    const charset = await h.door("POST", "linear", { raw: JSON.stringify({ value: SENTINEL }), headers: { "content-type": "application/json; charset=utf-8" } });
    expect(charset.status).toBe(200);
  });

  it("keeps the same user's key apart in each org they sign in under", async () => {
    const h = await host(["linear"]);
    expect((await h.door("POST", "linear", { body: { value: SENTINEL } })).status).toBe(200);
    expect((await h.door("GET", undefined, { as: "alice-globex" })).body.servers).toEqual([{ name: "linear", setAt: null }]);
    expect(await h.stored("alice", "linear", OTHER_ORG)).toBeUndefined();
    expect((await h.door("POST", "linear", { as: "alice-globex", body: { value: "globex-key" } })).status).toBe(200);
    expect(await h.stored("alice", "linear")).toMatchObject({ value: SENTINEL });
    expect(await h.stored("alice", "linear", OTHER_ORG)).toMatchObject({ value: "globex-key" });
  });

  it("is not served by a host that offers no connectors", async () => {
    for (const servers of [undefined, []]) {
      const h = await host(servers);
      expect((await h.door("GET")).status, JSON.stringify(servers)).toBe(404);
      expect((await h.door("POST", "linear", { body: { value: SENTINEL } })).status).toBe(404);
    }
  });
});
