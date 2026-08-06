/**
 * FIX-1000 spec POC — characterization.
 *
 * ONE question, and the whole spec rests on it: **is the purged-scope create
 * reachable on the real path, or only at the store's own API?**
 *
 * FIX-992 pinned the store-level fact in a committed conformance case
 * (`packages/engine/src/stores/testing/resource-store-conformance.ts:809`,
 * *"deleteAll racing a create of a never-existed key: the create LANDS"*). That
 * case calls `store.set(..., 0)` directly. It proves the store PERMITS the
 * write; it does not prove any production path DRIVES one. If nothing does,
 * FIX-1000 is a theoretical fix and its P0 is wrong — which is exactly the kind
 * of premise this epic has twice burned review rounds re-arguing instead of
 * running.
 *
 * So this drives it end to end with nothing about the mechanism mocked: the
 * real `createFlowApiRouter` session routes, the real `createExecutionContext`
 * registry, `createInMemoryStores`. The only thing arranged is the interleaving
 * — a context created before the DELETE writes a resource after it, which is
 * what any action outliving a concurrent session delete does.
 *
 * Run it:
 *   pnpm --filter @flow-state-dev/engine exec vitest run \
 *     --root ../.. spec-poc/FIX-1000-purged-scope-create
 *
 * Throwaway. Never merged, never graduated as-is — §10 of the spec names the
 * CI specs this becomes.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, defineResourceCollection, handler } from "@flow-state-dev/core";
import {
  createExecutionContext,
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores,
  type StoreRegistry
} from "../../packages/engine/src";

const tasks = defineResourceCollection({
  scope: "session",
  pattern: "tasks/**",
  stateSchema: z.object({}).passthrough()
});

const FLOW_KIND = "fix1000-poc";
/** Caller-supplied, and therefore reusable — `session-routes.ts:135`. */
const SESSION_ID = "sess_reused";

function makeFlow() {
  return defineFlow({
    kind: FLOW_KIND,
    actions: {
      run: {
        inputSchema: z.string(),
        block: handler({
          name: "noop",
          resources: { tasks },
          execute: () => "ok"
        })
      }
    }
  })({ id: FLOW_KIND });
}

function makeRouter() {
  const registry = createFlowRegistry();
  const stores = createInMemoryStores();
  registry.register(makeFlow());
  return { router: createFlowApiRouter({ registry, stores }), stores };
}

type Router = ReturnType<typeof makeRouter>["router"];

async function createSession(router: Router): Promise<number> {
  const res = await router.POST(
    new Request(`http://localhost/api/flows/${FLOW_KIND}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "user_1", sessionId: SESSION_ID })
    }),
    { params: { path: [FLOW_KIND, "sessions"] } }
  );
  return res.status;
}

async function deleteSession(router: Router): Promise<number> {
  const res = await router.DELETE(
    new Request(`http://localhost/api/flows/sessions/${SESSION_ID}`, {
      method: "DELETE"
    }),
    // Note the asymmetry, which is real and not a harness detail: session
    // CREATION is flow-scoped (`/:flowKind/sessions`) while DELETION is not
    // (`/sessions/:sessionId` — `routes/router.ts:55`). The session record is
    // the only carrier of a session's identity.
    { params: { path: ["sessions", SESSION_ID] } }
  );
  return res.status;
}

/** One in-flight request: its own registry, caches and version map. */
async function makeCtx(stores: StoreRegistry, requestId: string) {
  return createExecutionContext({
    flow: makeFlow(),
    actionName: "run",
    requestId,
    sessionId: SESSION_ID,
    userId: "user_1",
    stores
  });
}

/** What the durable store holds for the session scope, ignoring the registry cache. */
async function storedKeys(stores: StoreRegistry): Promise<string[]> {
  return Object.keys(await stores.resourceState.getAll("session", SESSION_ID)).sort();
}

describe("FIX-1000 premise: a create racing session deletion on the real path", () => {
  it("CLAIM: an in-flight context's create of a previously-absent key lands in the purged scope, and a session recreated under the same caller-supplied id inherits it", async () => {
    const { router, stores } = makeRouter();
    expect(await createSession(router)).toBe(201);

    // An action is in flight: its context (and its resource registry) exists
    // before the DELETE arrives. Nothing here is contrived — this is any
    // action that outlives a concurrent session delete.
    const inFlight = await makeCtx(stores, "req_inflight");

    expect(await deleteSession(router)).toBe(204);
    expect(await storedKeys(stores)).toEqual([]); // the purge did run

    // The in-flight action now creates a collection item. `tasks/late` never
    // existed, so the CAS insert carries `expectedVersion: 0` = "no live row",
    // which a never-existed key satisfies against a purged scope exactly as
    // against a fresh one. FIX-992's per-key predicate has no row to match.
    await (inFlight.resources.tasks as any).create("late", { claimedBy: "worker-a" });

    // Half one: the row is live in a scope that was deleted.
    expect(await storedKeys(stores)).toEqual(["tasks/late"]);

    // Half two, the one that makes it a defect rather than garbage: the id is
    // caller-supplied, so the scope is re-enterable.
    expect(await createSession(router)).toBe(201);
    const fresh = await makeCtx(stores, "req_fresh");
    const inherited = await (fresh.resources.tasks as any).list();

    // A brand-new session is born holding the previous generation's state.
    // Printed, not just asserted, so the verdict is legible in the run output.
    console.log(
      "[FIX-1000] brand-new session inherited:",
      JSON.stringify(await storedKeys(stores)),
      "instances:",
      inherited.length
    );
    expect(await storedKeys(stores)).toEqual(["tasks/late"]);
    expect(inherited).toHaveLength(1);
  });

  it("DISCRIMINATION: the same interleaving for a key that EXISTED before the purge does not land — so the case above isolates the previously-absent key, and the harness really reaches the store", async () => {
    const { router, stores } = makeRouter();
    expect(await createSession(router)).toBe(201);

    const inFlight = await makeCtx(stores, "req_inflight");
    // The key exists, and the in-flight context holds its version.
    await (inFlight.resources.tasks as any).create("early", { claimedBy: null });
    const instance = await (inFlight.resources.tasks as any).get("early");

    expect(await deleteSession(router)).toBe(204);

    // FIX-992's tombstone retains the version, so this stale write conflicts.
    // A harness that could not reach the store would see this succeed too.
    await expect(instance.patchState({ claimedBy: "worker-a" })).rejects.toThrow();

    expect(await createSession(router)).toBe(201);
    const fresh = await makeCtx(stores, "req_fresh");
    expect(await (fresh.resources.tasks as any).list()).toEqual([]);
  });

  it("SCOPE OF THE HOLE: ContentStore leaks the same way and has no version at all — so no predicate can close it, only an address change", async () => {
    const { router, stores } = makeRouter();
    expect(await createSession(router)).toBe(201);

    await deleteSession(router);
    // Content is LWW by decision (FIX-992 D3). There is no expectedVersion to
    // pass, so `deleteAll` racing a content write is unfenceable by any
    // per-key predicate — the argument for a namespace generation over a
    // version/generation column.
    await stores.content.set("session", SESSION_ID, "tasks/late", "straggler body");

    expect(await createSession(router)).toBe(201);
    const carried = await stores.content.getAll("session", SESSION_ID);
    expect(carried["tasks/late"]).toBe("straggler body");
  });

  it("SHAPE OF THE FIX: with a per-generation scope id, the straggler is unreachable rather than fenced — no predicate, no barrier, and it works for BOTH stores", async () => {
    const stores = createInMemoryStores();
    // What the spec proposes, at the store layer only: the session record
    // carries a generation, and the resource scope id is derived from it.
    const gen1 = `${SESSION_ID}#g1`;
    const gen2 = `${SESSION_ID}#g2`;

    await stores.resourceState.set("session", gen1, "tasks/a", { v: 1 } as never, 0);
    await stores.content.set("session", gen1, "tasks/a", "body-1");

    // Session deleted; a straggler from the old generation still commits.
    await stores.resourceState.deleteAll("session", gen1);
    await stores.resourceState.set("session", gen1, "tasks/late", { v: 9 } as never, 0);
    await stores.content.set("session", gen1, "tasks/late", "late body");

    // Recreated session mints a new generation and reads a different address.
    expect(await stores.resourceState.getAll("session", gen2)).toEqual({});
    expect(await stores.content.getAll("session", gen2)).toEqual({});
  });
});
