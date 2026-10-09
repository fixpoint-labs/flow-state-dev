/**
 * Session routes that act on the session the owner check admitted the caller
 * to, and on no other.
 *
 * With route-level authentication on, the guard reads the session and checks
 * the caller owns it; the handler then reads it again to do the work. A
 * session id is the caller's to choose and can be deleted and used again, so
 * between those two reads the id can change hands. Each route here must then
 * answer as for an unknown session, never delete, list, read or write the
 * session that now holds the id.
 *
 * Two ways the id can change hands, both covered for every route: the checked
 * session is deleted and another user's created under the id ("taken"), or the
 * guard found no session and one arrived before the handler's read
 * ("arrived").
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  defineFlow,
  defineResource,
  defineResourceCollection,
  handler
} from "@flow-state-dev/core";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores,
  disposeFlowApiRouter
} from "../src";
import type { RequestRecord, SessionRecord, StoreRegistry } from "../src";

const ORG = "org_test";
const SESSION = "sess_shared";

const notes = defineResourceCollection({
  scope: "session",
  pattern: "notes/*",
  stateSchema: z.object({ title: z.string().default("") }),
  client: {
    content: { read: true, create: true, update: true, delete: true },
    state: { read: true }
  }
});

const doc = defineResource({
  scope: "session",
  stateSchema: z.object({}),
  content: "the doc",
  client: { content: { read: true } }
});

function build(authenticated: boolean) {
  const flow = defineFlow({
    kind: "guarded",
    actions: {
      run: {
        block: handler({ name: "guarded-run", resources: { notes, doc }, execute: () => ({}) })
      }
    },
    ...(authenticated
      ? {
          authentication: {
            resolvePrincipal: (context: { request?: Request }) => {
              const user = context.request?.headers.get("x-user");
              return user == null ? null : { userId: user, orgId: ORG };
            }
          }
        }
      : {})
  })();
  const registry = createFlowRegistry();
  registry.register(flow);
  const stores = createInMemoryStores();
  const router = createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0 });
  routers.push(router);
  return { router, stores };
}

const routers: ReturnType<typeof createFlowApiRouter>[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(routers.splice(0).map((router) => disposeFlowApiRouter(router)));
});

function sessionOf(userId: string, createdAt: number): SessionRecord {
  return {
    id: SESSION,
    flowKind: "guarded",
    userId,
    orgId: ORG,
    state: {},
    version: 0,
    createdAt,
    updatedAt: createdAt,
    journal: []
  };
}

/** A finished request mallory ran in the session that now holds the id. */
function malloryRequest(): RequestRecord {
  return {
    id: "req_mallory",
    flowKind: "guarded",
    actionName: "run",
    userId: "mallory",
    orgId: ORG,
    sessionId: SESSION,
    source: "http",
    status: "completed",
    startedAtMs: 1,
    state: {},
    version: 0,
    createdAt: Date.now(),
    updatedAt: Date.now()
  } as RequestRecord;
}

function call(
  router: ReturnType<typeof createFlowApiRouter>,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string[],
  body?: unknown
): Promise<Response> {
  const init: RequestInit = {
    method,
    headers: { "content-type": "application/json", "x-user": "alice" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  };
  const request = new Request(`http://localhost/api/flows/${path.join("/")}`, init);
  return router[method](request, { params: { path } });
}

type RouteCase = {
  name: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string[];
  body?: unknown;
  /** What the route answers its own caller when nothing changes hands. */
  okStatus: number;
};

const ROUTES: RouteCase[] = [
  { name: "delete_session", method: "DELETE", path: ["sessions", SESSION], okStatus: 204 },
  { name: "list_session_children", method: "GET", path: ["sessions", SESSION, "children"], okStatus: 200 },
  { name: "list_session_requests", method: "GET", path: ["sessions", SESSION, "requests"], okStatus: 200 },
  {
    name: "get_resource_content",
    method: "GET",
    path: ["sessions", SESSION, "resources", "doc", "content"],
    okStatus: 200
  },
  {
    name: "get_collection_item_content",
    method: "GET",
    path: ["sessions", SESSION, "resources", "notes", "n1", "content"],
    okStatus: 200
  },
  {
    name: "create_collection_item",
    method: "POST",
    path: ["sessions", SESSION, "resources", "notes"],
    body: { topic: "n2", content: "alice's new note" },
    okStatus: 201
  },
  {
    name: "update_resource_content",
    method: "PATCH",
    path: ["sessions", SESSION, "resources", "notes", "n1", "content"],
    body: { content: "alice's edit" },
    okStatus: 200
  },
  {
    name: "delete_collection_item",
    method: "DELETE",
    path: ["sessions", SESSION, "resources", "notes", "n1"],
    okStatus: 200
  }
];

/**
 * Alice's session with one note in it, written through the route as she
 * would, plus mallory's request and child to be served if the id changes
 * hands. With `none`, the note is kept and the session record removed. Mallory's rows carry her owner, so a route that serves them read the
 * session that is hers.
 */
async function seed(router: ReturnType<typeof createFlowApiRouter>, stores: StoreRegistry, owner: "alice" | "none") {
  await stores.request.set("req_mallory", malloryRequest(), "any");
  await stores.session.set(
    "child_mallory",
    { ...sessionOf("mallory", Date.now()), id: "child_mallory", parentSessionId: SESSION },
    "any"
  );
  await stores.session.set(SESSION, sessionOf("alice", Date.now() - 60_000), "any");
  const created = await call(router, "POST", ["sessions", SESSION, "resources", "notes"], {
    topic: "n1",
    content: "alice's note"
  });
  expect(created.status).toBe(201);
  // No session at the id, but the note stays under it, so a route that read
  // the session arriving there has an item to serve.
  if (owner === "none") await stores.session.delete(SESSION);
}

/**
 * Once the guard has read the session at `SESSION` (alice's, or none), the
 * id is mallory's before the handler reads it.
 */
function handIdToMallory(stores: StoreRegistry): { changed: () => boolean } {
  const get = stores.session.get.bind(stores.session);
  const set = stores.session.set.bind(stores.session);
  const remove = stores.session.delete.bind(stores.session);
  let changed = false;
  vi.spyOn(stores.session, "get").mockImplementation(async (id) => {
    const found = await get(id);
    if (!changed && id === SESSION) {
      changed = true;
      if (found !== undefined) await remove(id);
      await set(id, sessionOf("mallory", Date.now()), "absent");
    }
    return found;
  });
  return { changed: () => changed };
}

describe("a session route acts only on the session the owner check admitted the caller to", () => {
  for (const scenario of ["taken", "arrived"] as const) {
    describe(
      scenario === "taken"
        ? "the checked session was deleted and another user's created under the id"
        : "the check found no session and another user's arrived under the id",
      () => {
        for (const route of ROUTES) {
          it(`${route.name} answers as for an unknown session and changes nothing`, async () => {
            const { router, stores } = build(true);
            await seed(router, stores, scenario === "taken" ? "alice" : "none");
            const notesBefore = await stores.resourceState.getAll("session", SESSION);
            const contentBefore = await stores.content.getAll("session", SESSION);
            const swap = handIdToMallory(stores);

            const res = await call(router, route.method, route.path, route.body);

            expect(swap.changed()).toBe(true);
            expect(res.status).toBe(404);
            const text = await res.text();
            // Nothing of mallory's session reached alice.
            expect(text).not.toContain("req_mallory");
            expect(text).not.toContain("child_mallory");
            vi.restoreAllMocks();
            // Mallory's session is still hers, and its content as it was.
            const held = await stores.session.get(SESSION);
            expect(held?.userId).toBe("mallory");
            expect(await stores.resourceState.getAll("session", SESSION)).toEqual(notesBefore);
            expect(await stores.content.getAll("session", SESSION)).toEqual(contentBefore);
          });
        }
      }
    );
  }

  // The control for every case above: the same route, the same caller, the
  // same session, nothing changing hands, answers as it always has.
  for (const route of ROUTES) {
    it(`${route.name} still serves the checked session's owner`, async () => {
      const { router, stores } = build(true);
      await seed(router, stores, "alice");
      const res = await call(router, route.method, route.path, route.body);
      expect(res.status).toBe(route.okStatus);
    });
  }

  // The framework default resolver checks nothing, so there is nothing to
  // compare against and nothing changes for an app on it.
  for (const route of ROUTES) {
    it(`${route.name} is unchanged on the framework default resolver`, async () => {
      const { router, stores } = build(false);
      await seed(router, stores, "alice");
      const res = await call(router, route.method, route.path, route.body);
      expect(res.status).toBe(route.okStatus);
    });
  }
});
