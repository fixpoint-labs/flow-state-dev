/**
 * HTTP helpers for the tests of user and org resources by scope (FIX-2624):
 * callers signed in from two headers, requests through a real router, and a
 * settle loop over the request store.
 */
import { afterEach, expect } from "vitest";
import { createFlowApiRouter, createFlowRegistry, disposeFlowApiRouter } from "../../src";
import { createInMemoryBus, createInMemoryStores } from "../../src/host";
import type { StoreRegistry } from "../../src";

export const ORG_A = "org-a";
export const ORG_B = "org-b";

/** Signs callers in from two headers, as a real app's session cookie would. */
export const signIn = (context: { request?: Request }) => {
  const user = context.request?.headers.get("x-user");
  const org = context.request?.headers.get("x-org") ?? ORG_A;
  return user == null ? null : { userId: user, orgId: org };
};

export type Router = ReturnType<typeof createFlowApiRouter>;
export type Caller = { user?: string; org?: string };

export const alice: Caller = { user: "alice", org: ORG_A };
export const bob: Caller = { user: "bob", org: ORG_A };
export const carol: Caller = { user: "carol", org: ORG_B };

const routers: Router[] = [];

/** Dispose every router the test built. Call once per test file. */
export function disposeRoutersAfterEach(): void {
  afterEach(async () => {
    await Promise.all(routers.splice(0).map((router) => disposeFlowApiRouter(router)));
  });
}

/** A router over `flows` and fresh in-memory stores with a change bus. */
export function buildRouter(flows: unknown[], options: Record<string, unknown> = {}) {
  const registry = createFlowRegistry();
  for (const flow of flows) registry.register(flow as never);
  const stores = { ...createInMemoryStores(), bus: createInMemoryBus() };
  const router = createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0, ...options } as never);
  routers.push(router);
  return { router, stores, registry };
}

function headers(caller: Caller): Record<string, string> {
  return {
    "content-type": "application/json",
    ...(caller.user === undefined ? {} : { "x-user": caller.user }),
    ...(caller.org === undefined ? {} : { "x-org": caller.org })
  };
}

export function get(router: Router, path: string[], caller: Caller, query = ""): Promise<Response> {
  const request = new Request(`http://localhost/api/flows/${path.map(encodeURIComponent).join("/")}${query}`, {
    headers: headers(caller)
  });
  return router.GET(request, { params: { path } });
}

export function post(router: Router, path: string[], caller: Caller, body: unknown): Promise<Response> {
  const request = new Request(`http://localhost/api/flows/${path.map(encodeURIComponent).join("/")}`, {
    method: "POST",
    headers: headers(caller),
    body: JSON.stringify(body)
  });
  return router.POST(request, { params: { path } });
}

/** Wait for a request to leave `in_progress`, and return its record. */
export async function settle(stores: StoreRegistry, requestId: string) {
  for (let i = 0; i < 300; i += 1) {
    const record = await stores.request.get(requestId);
    if (record !== undefined && record.status !== "in_progress") return record;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`request ${requestId} did not settle`);
}

/** Send `action` to a resource and wait for the request it records. */
export async function send(
  router: Router,
  stores: StoreRegistry,
  scope: string,
  key: string,
  action: string,
  caller: Caller,
  body: unknown
) {
  const res = await post(router, ["resources", scope, key, "actions", action], caller, body);
  expect(res.status, await res.clone().text()).toBe(202);
  const { request } = (await res.json()) as { request: { id: string } };
  return settle(stores, request.id);
}

/** Everything a read could leave behind in the session and request stores. */
export async function sessionAndRequests(stores: StoreRegistry) {
  return JSON.stringify({
    sessions: (await stores.session.list({})).map((s) => [s.id, s.version]),
    requests: (await stores.request.list({})).map((r) => [r.id, r.status])
  });
}
