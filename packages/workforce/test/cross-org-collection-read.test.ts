/**
 * Opening the worker inventory to the browser must open exactly what was
 * intended (FIX-1502, BR-1–BR-6).
 *
 * The worker inventory declares a `client` block so a browser panel can read it
 * at all — without one, the collection-state route refuses every read with
 * `403 State read not permitted`, and an action's return value has no path to
 * a browser, so there is no other door. Opening that door raises two separate
 * questions, and this file answers them separately because one cannot stand
 * in for the other:
 *
 *  1. **Whose rows come back?** The route resolves rows through the SESSION's
 *     stored `orgId` (`getPersistedData` → `resourceScopeIds(session.orgId, …)`),
 *     and a session binds its org from the resolved principal at creation
 *     (`handleCreateSession`: `ctx.principal?.orgId ?? DEFAULT_ORG_ID`, with
 *     `body.orgId` never consulted). So the isolation tests authenticate as
 *     one org while claiming the other in every place a caller can put it —
 *     the session-create body, the read's query string, and two headers.
 *
 *     Worth recording because it surprised: making `handleCreateSession`
 *     prefer `body.orgId` does NOT produce a cross-org read. It fails earlier
 *     with a `403`, because a session whose stored org disagrees with the
 *     request's principal is refused before any row is read. That is defence
 *     in depth working, and it is why the red state below is aimed at the read
 *     rather than at the binding.
 *
 *  2. **Which FIELDS come back?** `resolveClientProjection` returns the stored
 *     state *unchanged* when a `client` block declares no `data`, `expose` or
 *     `exclude`. A bare `{ state: { read: true } }` would therefore publish the
 *     whole row, including any key a later write adds. The declaration carries
 *     an explicit `expose` (BP-015).
 *
 * Scope, not `flowIsolation`, is the axis the org half rests on (BP-027 is a
 * different concern): the collection is org-scoped, so its rows are shared
 * within the org by construction.
 *
 * The engine's own unauthenticated-binding regression lives in
 * `packages/engine/test/principal-org-spoofing.test.ts` and covers the ACTION
 * path. This covers the collection-state READ route, which that file does not
 * touch.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, defineResourceCollection, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { createFlowState, createInProcessFetch, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { defineWorkerInventoryCollection, inventoryWriterActions, openInventory } from "../src/index";

type Harness = {
  post: (path: string[], body: unknown, headers?: Record<string, string>) => Promise<Answer>;
  get: (path: string[], query?: string, headers?: Record<string, string>) => Promise<Answer>;
};
type Answer = { status: number; json: any };

/** Reads a collection through the real client-facing route. */
function readCollection(
  h: Harness,
  sessionId: string,
  ref: string,
  query = "",
  headers: Record<string, string> = {}
): Promise<Answer> {
  return h.get(["sessions", sessionId, "resources", ref], query, headers);
}

// ---------------------------------------------------------------------------
// FIX-1502 · the live inventory's browser read (V1, V2, V5)
// ---------------------------------------------------------------------------

/**
 * The inventory, on the path an app actually runs: a writer flow that spreads
 * `inventoryWriterActions()` into its `internal.actions`, reader sessions
 * opened over the real session route, rows written by `openInventory` through
 * the real writer, and every read through the real collection-state route.
 *
 * Two organizations, with DIFFERENT worker ids. Identical rows in both would make
 * a read that leaks look isolated: the org-a session would get org-b's rows
 * back and they would compare equal.
 *
 * Each case asserts the rows are STORED for both organizations (straight out of
 * org storage, never through the route) before it judges what the route
 * returns, so an empty read cannot pass as an isolated one.
 *
 * **Red states, observed:**
 * - Drop the `client` line from `defineWorkerInventoryCollection`: the manifest
 *   stops listing it, so V1 fails with `org-a worker read — the manifest lists no
 *   such collection` and V2 with `inventory/workers/* on a flow carrying the
 *   writer: expected undefined to be defined`.
 * - Drop `expose` from the worker inventory's `client` and the BR-5 case fails
 *   with `a workers row must not carry "secret"`.
 * - Point the route's org read at another org (`resourceScopeIds(session.orgId,
 *   …)` in `resources/internal.ts`) and V1 fails with `org-a's workers: expected
 *   [ 'beta.analyst', 'beta.lead' ] to deeply equal [ 'alpha.coder',
 *   'alpha.lead' ]` — the other org's workers, by id.
 */

const INV_USER = "u_boot";
const WRITER_KIND = "inventory-writer";
const PLAIN_KIND = "no-inventory";

/** Org -> the workers it hires. No id appears in both. */
const INVENTORY_ORGS = {
  "org-a": { workers: ["alpha.lead", "alpha.coder"] },
  "org-b": { workers: ["beta.lead", "beta.analyst"] }
} as const;
type InvOrg = keyof typeof INVENTORY_ORGS;
const INV_ORGS = Object.keys(INVENTORY_ORGS) as InvOrg[];

/** The session each org reads through, opened over the route as that org. */
const readerSession = (org: string) => `reader-${org}`;

type InventoryHarness = Harness & {
  runtime: any;
  /** Every inventory row physically stored for one org, keyed by storage key. */
  stored: (org: string) => Promise<Record<string, Record<string, unknown>>>;
};

/** Identity from a verified header — never from the body. Stands in for a real verifier. */
function verifiedHeaderPrincipal(userId: (org: string) => string) {
  return (context: any) => {
    const org = context.request?.headers.get("x-verified-org");
    return org === null || org === undefined ? null : { userId: userId(org), orgId: org };
  };
}

/** A `Harness` over one router. */
function harnessOver(router: any): Harness {
  const inProcess = createInProcessFetch(router);
  const call = async (
    method: "GET" | "POST",
    path: string[],
    query: string,
    body: unknown,
    headers: Record<string, string>
  ): Promise<Answer> => {
    const response = await inProcess(`/api/flows/${path.join("/")}${query}`, {
      method,
      headers: { "content-type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const text = await response.text();
    return { status: response.status, json: text.length > 0 ? JSON.parse(text) : undefined };
  };
  return {
    post: (path, body, headers = {}) => call("POST", path, "", body, headers),
    get: (path, query = "", headers = {}) => call("GET", path, query, undefined, headers)
  };
}

/** A flow carrying one public no-op, so a session can be opened on it. */
const noopAction = {
  inputSchema: z.object({}),
  block: handler({
    name: "noop",
    inputSchema: z.object({}),
    outputSchema: z.object({}),
    execute: async () => ({})
  })
};

/**
 * Stand the writer flow up behind a verified-header resolver, open each org's
 * reader session over the session route, and fill each org's inventory.
 *
 * @param options.fill Run `openInventory` for both orgs. Off for V2's
 *   manifest-only case.
 */
async function buildInventoryHarness(options: { fill?: boolean } = {}): Promise<InventoryHarness> {
  const writer = defineFlow({
    kind: WRITER_KIND,
    actions: { noop: noopAction },
    internal: { actions: { ...inventoryWriterActions() } }
  } as never);
  // The same app without the writer — V2's other state.
  const plain = defineFlow({ kind: PLAIN_KIND, actions: { noop: noopAction } });
  const state = createFlowState({
    flows: { [WRITER_KIND]: writer, [PLAIN_KIND]: plain },
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({}),
    // Host-level, so both flows resolve the same principal. The org comes from
    // a verified header, never the body.
    resolvePrincipal: verifiedHeaderPrincipal(() => INV_USER)
  } as never);
  const runtime = await state.getRuntime();
  const h: InventoryHarness = {
    ...harnessOver(await state.getRouter()),
    runtime,
    stored: async (org) =>
      Object.fromEntries(
        Object.entries(
          await runtime.stores.resourceState.getByPrefix("org", org, "inventory/")
        ).map(([key, entry]: [string, any]) => [key, entry.state])
      )
  };

  for (const org of INV_ORGS) {
    // Opened over the real session route, as the org's own principal.
    for (const flowKind of [WRITER_KIND, PLAIN_KIND]) {
      const created = await h.post(
        [flowKind, "sessions"],
        { userId: INV_USER, sessionId: `${readerSession(org)}${flowKind === PLAIN_KIND ? "-plain" : ""}` },
        { "x-verified-org": org }
      );
      if (created.status >= 400) throw new Error(`create ${created.status}: ${JSON.stringify(created.json)}`);
    }
    if (options.fill === false) continue;

    const binding = await openInventory(
      { workers: INVENTORY_ORGS[org].workers.map((id) => ({ id, kind: "agent", actions: {} })) },
      {
        run: async (request) => {
          const result: any = await runAction({
            flow: writer,
            actionName: request.action,
            input: request.input,
            userId: request.userId,
            orgId: request.orgId,
            sessionId: request.sessionId,
            source: request.source,
            stores: runtime.stores,
            runtimeConfig: { ...runtime.runtimeConfig }
          } as never);
          if (result?.error !== undefined) {
            throw result.error instanceof Error ? result.error : new Error(String(result.error));
          }
          return result;
        },
        // One worker-writer session per org: the default id is one per store,
        // and two orgs writing through one session would be one org's session.
        workerWriter: { flowKind: WRITER_KIND, sessionId: `inventory-binder-${org}` },
        userId: INV_USER,
        orgId: org
      }
    );
    if (binding.problems.length > 0) {
      throw new Error(`openInventory for ${org}: ${binding.problems.join("; ")}`);
    }
  }
  return h;
}

/** The ref a session's manifest gives the worker collection, found by pattern, and the whole list. */
async function inventoryRefs(h: Harness, sessionId: string, org: string) {
  const { status, json } = await h.get(["sessions", sessionId, "manifest"], "", {
    "x-verified-org": org
  });
  if (status !== 200) throw new Error(`manifest ${status}: ${JSON.stringify(json)}`);
  const resources = json.resources as Array<Record<string, any>>;
  return {
    resources,
    workers: resources.find((entry) => entry.pattern === "inventory/workers/*")?.ref as string | undefined
  };
}

/** Every page of one collection through the route, as `org`, with optional steering. */
async function listAll(
  h: Harness,
  sessionId: string,
  ref: string | undefined,
  org: string,
  steer: { query?: string; headers?: Record<string, string> } = {}
): Promise<{ status: number; rows: Array<Record<string, unknown>>; raw: string }> {
  if (ref === undefined) return { status: -1, rows: [], raw: "the manifest lists no such collection" };
  const rows: Array<Record<string, unknown>> = [];
  let raw = "";
  let cursor: string | undefined;
  do {
    const query =
      `?limit=1${steer.query ?? ""}` + (cursor === undefined ? "" : `&cursor=${encodeURIComponent(cursor)}`);
    const answer = await readCollection(h, sessionId, ref, query, {
      "x-verified-org": org,
      ...(steer.headers ?? {})
    });
    if (answer.status !== 200) return { status: answer.status, rows, raw: JSON.stringify(answer.json) };
    raw += JSON.stringify(answer.json);
    rows.push(...answer.json.items.map((item: any) => item.clientData as Record<string, unknown>));
    cursor = answer.json.nextCursor;
  } while (cursor !== undefined);
  return { status: 200, rows, raw };
}

describe("FIX-1502 · the worker inventory's client read", () => {
  it("V1 · each organization's session lists only its own worker rows (BR-1, BR-2, BR-4)", async () => {
    const h = await buildInventoryHarness();

    // The positive record first: both organizations' rows are in storage.
    for (const org of INV_ORGS) {
      const { workers } = INVENTORY_ORGS[org];
      expect(Object.keys(await h.stored(org)).sort(), `${org}'s stored inventory keys`).toEqual(
        workers.map((worker) => `inventory/workers/${worker}`).sort()
      );
    }

    for (const org of INV_ORGS) {
      const own = INVENTORY_ORGS[org];
      const otherOrg: InvOrg = org === "org-a" ? "org-b" : "org-a";
      const other = INVENTORY_ORGS[otherOrg];
      const refs = await inventoryRefs(h, readerSession(org), org);
      // Every place a caller can name an organization names the OTHER one.
      const steer = {
        query: `&orgId=${otherOrg}`,
        headers: { "x-org-id": otherOrg, "x-organization": otherOrg }
      };

      // `limit=1`, so the read below crosses pages.
      const workers = await listAll(h, readerSession(org), refs.workers, org, steer);

      expect(workers.status, `${org} worker read — ${workers.raw}`).toBe(200);
      expect(workers.rows.map((r) => r.id).sort(), `${org}'s workers`).toEqual([...own.workers].sort());

      // Over the raw payload too, so a shape change cannot turn the above into a no-op.
      for (const foreign of other.workers) {
        expect(workers.raw, `${org}'s read leaked ${foreign}`).not.toContain(foreign);
      }
    }
  });

  it("V1 · a session created claiming another organization in its body is still its principal's (BR-4)", async () => {
    const h = await buildInventoryHarness();
    const refs = await inventoryRefs(h, readerSession("org-a"), "org-a");
    const created = await h.post(
      [WRITER_KIND, "sessions"],
      { userId: INV_USER, orgId: "org-b", sessionId: "s-claims-b" },
      { "x-verified-org": "org-a" }
    );
    expect(created.status, JSON.stringify(created.json)).toBeLessThan(400);
    const workers = await listAll(h, "s-claims-b", refs.workers, "org-a");
    expect(workers.status).toBe(200);
    expect(workers.rows.map((r) => r.id).sort()).toEqual([...INVENTORY_ORGS["org-a"].workers].sort());
    expect(workers.raw).not.toContain("beta.");
  });

  it("V1 control · the same pattern declared WITHOUT the read is refused 403 (BR-3)", async () => {
    // Same pattern, scope and sharing as the factory, and no `client`.
    const unread = {
      workers: defineResourceCollection({
        pattern: "inventory/workers/*",
        scope: "org",
        flowIsolation: false,
        stateSchema: z.object({ id: z.string(), kind: z.string() })
      })
    };
    const flow = defineFlow({
      kind: "inventory-unread",
      resources: unread,
      actions: { noop: noopAction },
      authentication: { resolvePrincipal: verifiedHeaderPrincipal((org) => `user-of-${org}`) }
    });
    const state = createFlowState({
      flows: { "inventory-unread": flow },
      stores: { default: { primary: inMemoryStores() } },
      modelResolver: createMockModelResolver({})
    });
    const h = harnessOver(await state.getRouter());
    const created = await h.post(["inventory-unread", "sessions"], { userId: "user-of-org-a" }, {
      "x-verified-org": "org-a"
    });
    const sessionId = created.json.session?.id ?? created.json.id;
    expect(sessionId, JSON.stringify(created.json)).toBeDefined();
    for (const ref of Object.keys(unread)) {
      const answer = await readCollection(h, sessionId, ref, "", { "x-verified-org": "org-a" });
      expect(answer.status, `${ref} without a declared read`).toBe(403);
      expect(JSON.stringify(answer.json)).toMatch(/State read not permitted/);
    }
  });

  it("V1 control · a key written into a stored row does not reach the browser (BR-5)", async () => {
    const h = await buildInventoryHarness();
    const org = "org-a";
    const { workers } = INVENTORY_ORGS[org];
    // A key the named fields leave out, planted straight into the stored row.
    const key = `inventory/workers/${workers[0]}`;
    const current = await h.runtime.stores.resourceState.get("org", org, key);
    expect(current, `${key} is stored`).toBeDefined();
    await h.runtime.stores.resourceState.set(
      "org",
      org,
      key,
      { ...current.state, secret: "LEAKED-INVENTORY-KEY" },
      "any"
    );
    const planted = await h.runtime.stores.resourceState.get("org", org, key);
    expect(planted.state.secret, `${key} carries the planted key`).toBe("LEAKED-INVENTORY-KEY");

    const refs = await inventoryRefs(h, readerSession(org), org);
    const read = await listAll(h, readerSession(org), refs.workers, org);
    expect(read.status, `workers read — ${read.raw}`).toBe(200);
    // The row carrying the planted key is in the read at all.
    expect(read.rows.map((r) => r.id)).toContain(workers[0]);
    for (const row of read.rows) {
      expect(row, `a workers row must not carry "secret"`).not.toHaveProperty("secret");
    }
    expect(read.raw, "workers payload").not.toContain("LEAKED-INVENTORY-KEY");
  });

  it("V2 · the manifest lists the worker collection as readable on a flow with the writer, and none without it (BR-6)", async () => {
    const h = await buildInventoryHarness({ fill: false });
    const on = await inventoryRefs(h, readerSession("org-a"), "org-a");
    const off = await inventoryRefs(h, `${readerSession("org-a")}-plain`, "org-a");

    const entry = on.resources.find((e) => e.pattern === "inventory/workers/*");
    expect(entry, "inventory/workers/* on a flow carrying the writer").toBeDefined();
    expect(entry!.kind).toBe("collection");
    expect(entry!.scope).toBe("org");
    expect(entry!.client?.state?.read, "inventory/workers/* is readable").toBe(true);
    expect(
      off.resources.filter((e) => String(e.pattern ?? "").startsWith("inventory/")),
      "inventory collections on a flow without the writer"
    ).toEqual([]);
  });

});
