/**
 * The user-route scoping table.
 *
 * A route addressed by `/users/:userId/...` is authorized by the route guard on
 * the path's `userId` alone: there is no stored record to read an organization
 * or tenant from (`route-auth.ts`, the `user` subject). Every other boundary —
 * the caller's tenant, the caller's organization, and in a mixed app the set of
 * flows an anonymous caller may reach — is applied by the route's HANDLER. The
 * handler of the one live route does that by hand. Nothing forced the next one
 * to, and a handler that filters only by the path's `userId` would serve one
 * person's rows across the organizations they belong to.
 *
 * This file is what forces it, in two stages:
 *
 *   1. **Every user-addressed route needs an entry.** The route set is derived
 *      from the guard's own classification over the real route table — not a
 *      list kept here — so a newly classified route fails the suite at once,
 *      with no edit to this file. A `/users/:userId/...` pattern classified as
 *      anything else fails too, as does an entry for a route that is no longer
 *      user-addressed.
 *   2. **Each entry is probed on three axes.** An entry says how to seed one row
 *      for a given identity and how to tell whether a response saw or changed
 *      that row. The harness — not the entry — chooses the identities, calls the
 *      route through the real router, and requires that a caller from another
 *      organization, from another tenant, or (in a mixed app) an anonymous
 *      caller neither sees nor changes a row.
 *
 * An entry cannot pass by doing nothing: the owner's own call runs first and
 * must see the owner's row, and on each axis the same caller must reach a row
 * it owns. The foreign row is seeded through the same seed call, differing only
 * on the axis under test, so it sits where the caller's own call just showed
 * the route reads — and it is probed ALONE, in a store holding nothing else,
 * so a route that pages or limits its results can't return an own row in its
 * place and pass.
 *
 * A route that is not built yet is pinned: its owner's call must answer 501 and
 * name no row. Building it breaks the pin, and the pin must then be replaced by
 * a real entry.
 */
import { defineFlow, handler, DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { createFlowApiRouter, createFlowRegistry, createInMemoryStores } from "../src";
import type { StoreRegistry } from "../src";
import { listFlowRoutes, matchFlowRoute } from "../src/routes/router";
import { routeSubject } from "../src/routes/route-auth";

// ─── The table ──────────────────────────────────────────────────────────────

/** Who a seeded row belongs to. The harness picks these; an entry never does. */
type Identity = {
  userId: string;
  orgId: string;
  tenantId: string;
  /** The flow instance that owns the row. */
  flowId: string;
};

/** What one call to the route produced, for an entry to judge. */
type Observed = { status: number; body: string; stores: StoreRegistry };

/** A route that is built: how to seed a row and how to tell it was reached. */
type ProbeEntry = {
  /** Seed ONE row with id `rowId`, owned by exactly `owner`. */
  seed: (stores: StoreRegistry, rowId: string, owner: Identity) => Promise<void>;
  /** Whether the call returned the row or changed it. */
  saw: (observed: Observed, rowId: string) => Promise<boolean>;
  /** Values for path params other than `:userId`, if the pattern has any. */
  params?: Record<string, string>;
  query?: string;
};

/** A route that is not built yet: it must answer 501 and serve nothing. */
type NotBuiltYet = { notBuiltYet: 501 };

type TableEntry = ProbeEntry | NotBuiltYet;

/**
 * An in-flight request whose heartbeat stopped long ago: a request record in
 * progress plus its registry entry, both owned by `owner`. Stale well past any
 * threshold, so the only thing that decides whether a sweep touches it is the
 * scope under test.
 */
async function seedStaleInFlight(
  stores: StoreRegistry,
  rowId: string,
  owner: Identity
): Promise<void> {
  const stale = Date.now() - 10 * 60_000;
  await stores.request.set(
    rowId,
    {
      id: rowId,
      flowKind: owner.flowId,
      flowId: owner.flowId,
      actionName: "run",
      sessionId: `${rowId}-session`,
      userId: owner.userId,
      orgId: owner.orgId,
      tenantId: owner.tenantId,
      source: "http",
      status: "in_progress",
      startedAtMs: stale,
      state: {},
      version: 0,
      createdAt: stale,
      updatedAt: stale
    },
    "any"
  );
  await stores.activeRequests.register({
    requestId: rowId,
    flowKind: owner.flowId,
    flowId: owner.flowId,
    actionName: "run",
    sessionId: `${rowId}-session`,
    userId: owner.userId,
    orgId: owner.orgId,
    tenantId: owner.tenantId,
    source: "http",
    input: {},
    startedAt: stale,
    lastHeartbeatAt: stale
  });
}

/** A response body as JSON, or `undefined` when it isn't JSON (a 501, an empty 200). */
function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/**
 * One entry per user-addressed route kind. Adding a route to the guard's
 * `user` classification without adding it here fails stage 1.
 */
const USER_ROUTE_SCOPING: Record<string, TableEntry> = {
  check_interrupted_requests: {
    seed: seedStaleInFlight,
    // The sweep reports what it interrupted and writes the record; either is
    // the row being reached. A row that is absent was not reached: reading
    // "missing" as "changed" would let an entry that seeds nothing pass.
    saw: async ({ body, stores }, rowId) => {
      const reported =
        (parseJson(body) as { interrupted?: { requestId: string }[] } | undefined)?.interrupted?.some(
          (entry) => entry.requestId === rowId
        ) ?? false;
      const record = await stores.request.get(rowId);
      return reported || record?.status === "interrupted";
    }
  },
  user_stream: { notBuiltYet: 501 }
};

// ─── The apps and callers the harness probes with ───────────────────────────

const TENANT_HEADER = "x-tenant-id";

const runAction = (kind: string) => ({
  run: {
    inputSchema: z.object({}),
    block: handler({
      name: `${kind}-run`,
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      execute: () => ({})
    })
  }
});

/** A flow with no resolver of its own: open unless the host authenticates. */
function openFlow(kind: string) {
  return defineFlow({ kind, actions: runAction(kind) });
}

/** A flow that authenticates its own callers, from a header only it reads. */
function secureFlow(kind: string) {
  return defineFlow({
    kind,
    actions: runAction(kind),
    authentication: {
      resolvePrincipal: (context) => {
        const user = context.request?.headers.get("x-flow-user");
        return user == null ? null : { userId: user, orgId: "acme" };
      }
    }
  });
}

/**
 * Enforcement on through a host resolver that verifies user AND organization,
 * the way a multi-org deployment does. The one flow is open, so every decision
 * is the host resolver's and the handler's.
 */
function hostResolverApp() {
  const registry = createFlowRegistry();
  registry.register(openFlow("demo"));
  const stores = createInMemoryStores();
  const router = createFlowApiRouter({
    registry,
    stores,
    resolvePrincipal: (context) => {
      const user = context.request?.headers.get("x-verified-user");
      const org = context.request?.headers.get("x-verified-org");
      return user == null || org == null ? null : { userId: user, orgId: org };
    }
  });
  return { router, stores };
}

/**
 * A mixed app: the host stays on the framework default resolver, one flow
 * authenticates and one is open. An anonymous caller may reach the open flow's
 * rows only.
 */
function mixedApp() {
  const registry = createFlowRegistry();
  registry.register(openFlow("open"));
  registry.register(secureFlow("secure"));
  const stores = createInMemoryStores();
  return { router: createFlowApiRouter({ registry, stores }), stores };
}

type App = ReturnType<typeof hostResolverApp>;

/** The owner of the addressed user id, in the host-resolver app. */
const OWNER: Identity = { userId: "alice", orgId: "acme", tenantId: "t1", flowId: "demo" };
const OWNER_HEADERS = {
  "x-verified-user": "alice",
  "x-verified-org": "acme",
  [TENANT_HEADER]: "t1"
};

/**
 * The three axes. Each names the app, the caller, the identity the caller
 * legitimately owns, and a foreign identity that differs from it on that axis
 * alone.
 */
const AXES: Array<{
  name: string;
  app: () => App;
  headers: Record<string, string>;
  own: Identity;
  foreign: Identity;
}> = [
  {
    name: "the same user acting for another organization",
    app: hostResolverApp,
    headers: OWNER_HEADERS,
    own: OWNER,
    foreign: { ...OWNER, orgId: "globex" }
  },
  {
    name: "the same user and organization on another tenant",
    app: hostResolverApp,
    headers: OWNER_HEADERS,
    own: OWNER,
    foreign: { ...OWNER, tenantId: "t2" }
  },
  {
    name: "an anonymous caller in a mixed app, against an authenticated flow's row",
    app: mixedApp,
    headers: { [TENANT_HEADER]: "t1" },
    own: { userId: "alice", orgId: DEFAULT_ORG_ID, tenantId: "t1", flowId: "open" },
    foreign: { userId: "alice", orgId: DEFAULT_ORG_ID, tenantId: "t1", flowId: "secure" }
  }
];

// ─── Deriving the route set from the guard ──────────────────────────────────

/** A concrete path for a pattern, one distinct value per param. */
function samplePath(pattern: string, values: Record<string, string> = {}): string {
  return pattern.replace(/[:*](\w+)/g, (_, name: string) => values[name] ?? `sample-${name}`);
}

/**
 * Every route in the table, parsed through the real router and classified by
 * the guard. A pattern whose sample path parses to another kind can't be
 * classified from here, and is a failure rather than a silent skip.
 */
function classifiedRoutes() {
  return listFlowRoutes().map((route) => {
    const parsed = matchFlowRoute(route.method, samplePath(route.pattern));
    if (parsed.kind !== route.kind) {
      throw new Error(
        `sample path for ${route.method} ${route.pattern} parsed as "${parsed.kind}", not "${route.kind}"`
      );
    }
    return { ...route, subject: routeSubject(parsed).kind };
  });
}

const userRoutes = classifiedRoutes().filter((route) => route.subject === "user");

/** Call a user-addressed route through the router, as `headers`, for `userId`. */
async function callRoute(
  app: App,
  route: { method: string; pattern: string },
  entry: { params?: Record<string, string>; query?: string },
  userId: string,
  headers: Record<string, string>
): Promise<Observed> {
  const path = samplePath(route.pattern, { ...entry.params, userId }).split("/").filter(Boolean);
  const method = route.method as "GET" | "POST" | "PATCH" | "DELETE";
  const query = entry.query === undefined ? "" : `?${entry.query}`;
  const response = await app.router[method](
    new Request(`http://localhost/api/flows/${path.join("/")}${query}`, { method, headers }),
    { params: { path } }
  );
  return { status: response.status, body: await response.text(), stores: app.stores };
}

// ─── Stage 1 · which routes need an entry ───────────────────────────────────

describe("user-route scoping · stage 1: every user-addressed route has an entry", () => {
  it("finds the user-addressed routes from the guard's classification", () => {
    // Guards the derivation itself: an empty set would pass everything below.
    expect(userRoutes.length).toBeGreaterThan(0);
  });

  it("has an entry for every route the guard classifies as user-addressed", () => {
    const missing = userRoutes
      .map((route) => route.kind)
      .filter((kind) => !(kind in USER_ROUTE_SCOPING));
    expect(missing, "user-addressed routes with no scoping-table entry").toEqual([]);
  });

  it("classifies every /users/:userId/... pattern as user-addressed", () => {
    const misclassified = classifiedRoutes()
      .filter((route) => route.pattern.startsWith("/users/:userId") && route.subject !== "user")
      .map((route) => `${route.method} ${route.pattern} → ${route.subject}`);
    expect(misclassified, "user-shaped paths the guard does not treat as user-addressed").toEqual([]);
  });

  it("has no entry for a route that is no longer user-addressed", () => {
    const kinds = new Set(userRoutes.map((route) => route.kind));
    const stale = Object.keys(USER_ROUTE_SCOPING).filter((kind) => !kinds.has(kind));
    expect(stale, "scoping-table entries for routes that are not user-addressed").toEqual([]);
  });
});

// ─── Stage 2 · what each caller gets, per route ─────────────────────────────

describe("user-route scoping · stage 2: no caller reaches a row outside their scope", () => {
  for (const route of userRoutes) {
    const entry = USER_ROUTE_SCOPING[route.kind];
    if (entry === undefined) continue; // stage 1 reports it
    const label = `${route.method} ${route.pattern}`;

    if ("notBuiltYet" in entry) {
      describe(label, () => {
        it("is not built yet: the owner's call answers 501 and names no row", async () => {
          const app = hostResolverApp();
          await seedStaleInFlight(app.stores, "owners-row", OWNER);
          const observed = await callRoute(app, route, {}, OWNER.userId, OWNER_HEADERS);
          expect(
            observed.status,
            "this route now answers; replace its notBuiltYet pin with a real scoping entry"
          ).toBe(501);
          expect(observed.body).not.toContain("owners-row");
        });
      });
      continue;
    }

    describe(label, () => {
      // Runs first, and alone: an entry whose seed writes nothing, or whose
      // observer never reports a row, fails here instead of passing every axis
      // below on an empty route.
      it("serves the owner their own row (the positive control)", async () => {
        const app = hostResolverApp();
        await entry.seed(app.stores, "owners-row", OWNER);
        // Before any call, the observer must not report the row as reached,
        // or "reached" below would mean nothing.
        expect(
          await entry.saw({ status: 0, body: "", stores: app.stores }, "owners-row"),
          "the entry's observer reports the row as reached before the route was called"
        ).toBe(false);
        const observed = await callRoute(app, route, entry, OWNER.userId, OWNER_HEADERS);
        expect(observed.status).toBeLessThan(400);
        expect(
          await entry.saw(observed, "owners-row"),
          "the owner's call did not reach the owner's row: the entry's seed or observer is vacuous"
        ).toBe(true);
      });

      for (const axis of AXES) {
        // The same caller, in the same app, reaches a row it owns: the seed
        // lands where this route reads for this caller, so the probe below
        // is meaningful. A separate call, so the own row is never in the
        // store when the foreign row is probed.
        it(`reaches the caller's own row (positive control for: ${axis.name})`, async () => {
          const app = axis.app();
          await entry.seed(app.stores, "own-row", axis.own);
          const observed = await callRoute(app, route, entry, axis.own.userId, axis.headers);
          expect(
            await entry.saw(observed, "own-row"),
            "the caller's own row was not reached, so the probe beside this proves nothing"
          ).toBe(true);
        });

        // The foreign row ALONE, differing from the own row above only on
        // this axis, through the same seed. With nothing else in the store,
        // a route that filters by the path's userId and pages or limits its
        // results has only this row to return: an own row can't mask it.
        it(`serves nothing to ${axis.name}`, async () => {
          const app = axis.app();
          await entry.seed(app.stores, "foreign-row", axis.foreign);
          const observed = await callRoute(app, route, entry, axis.own.userId, axis.headers);
          expect(await entry.saw(observed, "foreign-row"), "a row outside the caller's scope was reached").toBe(
            false
          );
        });
      }

      it("refuses an anonymous caller when a host resolver is configured, before reading a row", async () => {
        const app = hostResolverApp();
        await entry.seed(app.stores, "owners-row", OWNER);
        const observed = await callRoute(app, route, entry, OWNER.userId, { [TENANT_HEADER]: "t1" });
        expect(observed.status).toBe(401);
        expect(await entry.saw(observed, "owners-row")).toBe(false);
      });
    });
  }
});
