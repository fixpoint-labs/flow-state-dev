/**
 * `sessionKind` — the persisted discriminator relay's door gates on, its four
 * writers, and the one-time repair for rows that predate it (FIX-1230).
 *
 * The field is the thing a fail-closed reader refuses on, so two failures are
 * possible and only one is loud. A writer that forgets to stamp ships a session
 * nobody can reach; a sweep that enumerates the wrong rows reports success while
 * leaving exactly the set it exists for unrepaired. Both are tested here, and
 * the second is tested through the **actual sweep** rather than through the
 * function that stamps a row — a unit test of the stamper passes no matter which
 * rows the sweep enumerated, so it cannot catch the mistake that matters.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler, requireRequestHost } from "@flow-state-dev/core";
import {
  backfillSessionKind,
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores,
  ensureSessionRecord
} from "../../src";
import type { SessionRecord, StoreRegistry } from "../../src/stores/types";

async function drain(stream: ReadableStream<Uint8Array> | null): Promise<void> {
  if (stream === null) return;
  const reader = stream.getReader();
  while (true) {
    const { done } = await reader.read();
    if (done) break;
  }
}

/**
 * Persist a row the way a release BEFORE this one did — with no `sessionKind`
 * key at all, rather than one holding `undefined`. In TypeScript those are the
 * same value; in a store that round-trips JSON they are different rows, and the
 * legacy case is the first.
 */
async function seedLegacy(
  stores: StoreRegistry,
  id: string,
  extra: Partial<SessionRecord> = {}
): Promise<void> {
  const ts = Date.now();
  await stores.session.set(
    id,
    {
      id,
      state: {},
      version: 0,
      createdAt: ts,
      updatedAt: ts,
      flowKind: "legacy",
      userId: "u_alice",
      lineageId: `lin_${id}`,
      journal: [],
      ...extra
    } as SessionRecord,
    "any"
  );
}

describe("every writer stamps sessionKind", () => {
  it("ensureSessionRecord defaults top-level, covering action execution and the webhook resolver", async () => {
    const stores = createInMemoryStores();

    const record = await ensureSessionRecord(stores, "s_shared", () => ({
      id: "s_shared",
      flowKind: "f",
      userId: "u_alice",
      state: {},
      version: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      journal: []
    }));

    expect(record.sessionKind).toBe("top-level");
    // Persisted, not just returned — the door reads the row, not this value.
    expect((await stores.session.get("s_shared"))?.sessionKind).toBe("top-level");
  });

  it("the public create route stamps top-level — it does NOT go through the shared helper", async () => {
    // This route owes the caller a 409 on a lost race, which `ensureSessionRecord`
    // resolves into an adoption instead, so it makes the same decision itself.
    // An enumeration that covered the helper's callers and missed this one would
    // leave every caller-created session unreachable.
    const stores = createInMemoryStores();
    const registry = createFlowRegistry();
    registry.register(
      defineFlow({
        kind: "create-route",
        actions: {
          noop: {
            inputSchema: z.object({}).passthrough(),
            block: handler({
              name: "noop",
              inputSchema: z.object({}).passthrough(),
              outputSchema: z.object({}),
              execute: async () => ({})
            })
          }
        }
      })
    );
    const router = createFlowApiRouter({ registry, stores });

    const res = await router.POST(
      new Request("http://localhost/api/flows/create-route/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "s_created", userId: "u_alice" })
      }),
      { params: { path: ["create-route", "sessions"] } }
    );
    expect(res.status).toBe(201);

    expect((await stores.session.get("s_created"))?.sessionKind).toBe("top-level");
  });

  it("the detached child writer is the one site that stamps workstream", async () => {
    // And it has to be a *different* answer from the default, or the two-axis
    // door has nothing to discriminate on and every guard in it is inert.
    const stores = createInMemoryStores();
    const registry = createFlowRegistry();
    let childSessionId: string | undefined;

    const spawn = handler({
      name: "spawn",
      inputSchema: z.object({}).passthrough(),
      outputSchema: z.object({}),
      execute: async (_input, ctx) => {
        const started = await requireRequestHost(ctx).startDetached({
          seed: { topic: "work" },
          input: {}
        });
        if (started.ok) childSessionId = started.sessionId;
        return {};
      }
    });

    const flow = defineFlow({
      kind: "detached-kind",
      actions: { spawn: { inputSchema: z.object({}).passthrough(), block: spawn } }
    });
    // The framework builds `workstream` from a board's drain bindings, which
    // nothing populates here. Standing it up is the precondition, not the thing
    // under test.
    const instance = flow();
    (instance as { workstream?: unknown }).workstream = {
      block: handler({
        name: "core",
        inputSchema: z.object({}).passthrough(),
        outputSchema: z.object({}),
        execute: async () => ({})
      })
    };
    registry.register(instance);

    const router = createFlowApiRouter({ registry, stores });
    const res = await router.POST(
      new Request("http://localhost/api/flows/detached-kind/actions/spawn", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({ userId: "u_alice", sessionId: "s_parent", input: {} })
      }),
      { params: { path: ["detached-kind", "actions", "spawn"] } }
    );
    await drain(res.body);

    expect(childSessionId).toBeDefined();
    expect((await stores.session.get(childSessionId!))?.sessionKind).toBe("workstream");
    // …and the parent is not a workstream, which is what makes the assertion
    // above about the child rather than about the default.
    expect((await stores.session.get("s_parent"))?.sessionKind).toBe("top-level");
  });
});

describe("the sessionKind backfill", () => {
  it("reaches PARENTED rows — the set it exists for, and the one an unqualified list() skips", async () => {
    // `SessionListOptions.parentage` narrows when omitted, so the obvious
    // enumeration returns only top-level sessions and misses every legacy
    // detached child. The sweep would report success having examined the wrong
    // rows. Run against the REAL sweep, because a unit test of the stamping
    // function passes whichever rows were enumerated.
    const stores = createInMemoryStores();
    await seedLegacy(stores, "s_top");
    await seedLegacy(stores, "s_child", { parentSessionId: "s_top" });

    const result = await backfillSessionKind(stores);

    expect((await stores.session.get("s_child"))?.sessionKind).toBe("workstream");
    expect((await stores.session.get("s_top"))?.sessionKind).toBe("top-level");
    expect(result).toMatchObject({ examined: 2, stamped: 2, alreadyStamped: 0, unrepaired: [] });
  });

  it("is a no-op on a re-run, so it can be run again after a rollout", async () => {
    // An older instance still rolling can create another unstamped row after the
    // scan has passed it, so re-running has to be safe and has to be cheap.
    const stores = createInMemoryStores();
    await seedLegacy(stores, "s_a");
    await backfillSessionKind(stores);

    const second = await backfillSessionKind(stores);

    expect(second).toMatchObject({ examined: 1, stamped: 0, alreadyStamped: 1, unrepaired: [] });
  });

  it("loses a CAS to a live writer WITHOUT clobbering its state, and repairs the row anyway", async () => {
    // Because the reader refuses on absent, a lost race is not "repaired next
    // time" — it is a permanently unreachable session. So the retry has to
    // re-read and win, and it must not write back the pre-race snapshot.
    const stores = createInMemoryStores();
    await seedLegacy(stores, "s_busy");

    const realSet = stores.session.set.bind(stores.session);
    let firstWrite = true;
    stores.session.set = async (id, value, expected) => {
      if (id === "s_busy" && firstWrite && expected !== "any") {
        firstWrite = false;
        // A live writer lands between the sweep's read and its write.
        const current = (await stores.session.get(id))!;
        await realSet(
          id,
          { ...current, state: { written: "by the live writer" }, version: current.version + 1 },
          "any"
        );
      }
      return realSet(id, value, expected);
    };

    const result = await backfillSessionKind(stores);

    const row = await stores.session.get("s_busy");
    expect(row?.sessionKind).toBe("top-level");
    // The live writer's state survived. Retrying against the LISTED copy would
    // write back a snapshot taken before the writer we just lost to.
    expect(row?.state).toEqual({ written: "by the live writer" });
    expect(result.unrepaired).toEqual([]);
  });

  it("reports a row it could not repair rather than counting it as done", async () => {
    // Non-zero `unrepaired` is a session relay still refuses. Reporting it as
    // stamped would be the sweep telling an operator it had finished a job it
    // had not.
    const stores = createInMemoryStores();
    await seedLegacy(stores, "s_contended");

    const realSet = stores.session.set.bind(stores.session);
    stores.session.set = async (id, value, expected) => {
      if (id === "s_contended" && expected !== "any") {
        // Always lose: a writer that never lets go.
        const current = (await stores.session.get(id))!;
        await realSet(id, { ...current, version: current.version + 1 }, "any");
      }
      return realSet(id, value, expected);
    };

    const result = await backfillSessionKind(stores, { maxAttemptsPerRecord: 2 });

    expect(result.stamped).toBe(0);
    expect(result.unrepaired).toEqual(["s_contended"]);
  });

  it("pages past its own page size", async () => {
    const stores = createInMemoryStores();
    for (let i = 0; i < 7; i += 1) await seedLegacy(stores, `s_${i}`);

    const result = await backfillSessionKind(stores, { pageSize: 2 });

    expect(result).toMatchObject({ examined: 7, stamped: 7 });
    for (let i = 0; i < 7; i += 1) {
      expect((await stores.session.get(`s_${i}`))?.sessionKind).toBe("top-level");
    }
  });
});
