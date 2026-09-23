/**
 * FIX-1477 amendment 1 · premise proof, experiment 2 of 2.
 *
 * NOT production code and not part of any default test run. See README.md for
 * how to run it, what it observed, and its limits.
 *
 * What actually stops the roster and board panels, and what unblocks them.
 * Runs the REAL router; nothing is stubbed.
 *
 * Runs from `packages/engine/test/`, reaching into `workforce`'s source for the
 * two declarations under test: the route under test is engine's, and that is
 * where this file's imports resolve without ceremony. Built the way this probe
 * builds its runtime, a seeded block did not execute when the file lived in
 * `packages/workforce` — a property of this construction, not of that package.
 * See `packages/workforce/test/cross-org-collection-read.test.ts`, added by
 * PR #2036, which seeds from that package through `createFlowState` and works.
 *
 * These call the **list** route — `GET /sessions/:id/resources/:ref`, with no
 * trailing segment. That matters: `router.ts` maps a trailing segment to
 * `get_collection_item_state`, so a path ending in `/state` reads an ITEM whose
 * topic happens to be "state", not the list. Both routes carry the same gate,
 * so either would show the 403 — but only the list route is what `Roster` and
 * `BoardColumns` need, and only a seeded row makes a 200 mean anything.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, defineResourceCollection, handler } from "@flow-state-dev/core";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores
} from "@flow-state-dev/engine";
import { z } from "zod";
import { channelBoard } from "../../workforce/src/channel/channel-board";
import { defineHiredRosterCollection } from "../../workforce/src/roster/collections";

type Router = ReturnType<typeof createFlowApiRouter>;

/** One row shaped to the real `hiredSeatRowSchema`. */
const SEEDED_SEAT = {
  seatId: "support.ada",
  flow: "support-agent",
  settings: {},
  instructions: null
};

/** GET the collection LIST — no trailing segment. */
async function listState(router: Router, sessionId: string, ref: string) {
  const path = ["sessions", sessionId, "resources", ref];
  const response = await router.GET(
    new Request(`http://localhost/api/flows/${path.join("/")}`, { method: "GET" }),
    { params: { path } }
  );
  return { status: response.status, body: await response.text() };
}

/**
 * The accessor name must match the one the FLOW declares — the route resolves
 * the ref against the owning flow's resource map, so a handler declaring the
 * same collection under a different name is not the same binding.
 */
function seedBlock(refName: string, collection: unknown) {
  return handler({
    name: "seed",
    inputSchema: z.object({}),
    outputSchema: z.object({}),
    resources: { [refName]: collection } as never,
    execute: async (_input: unknown, ctx) => {
      const ref = (ctx.resources as Record<string, unknown>)[refName] as {
        create(k: string, v: unknown, o: { replace: boolean }): Promise<unknown>;
      };
      await ref.create(SEEDED_SEAT.seatId, SEEDED_SEAT, { replace: true });
      return {};
    }
  });
}

async function build(refName: string, collection: unknown) {
  const registry = createFlowRegistry();
  registry.register(
    defineFlow({
      kind: "shell",
      resources: { [refName]: collection } as never,
      actions: {
        seed: { inputSchema: z.object({}), block: seedBlock(refName, collection) }
      }
    })
  );
  const router = createFlowApiRouter({ registry, stores: createInMemoryStores() });
  const createPath = ["shell", "sessions"];
  const created = await router.POST(
    new Request(`http://localhost/api/flows/${createPath.join("/")}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "u1" })
    }),
    { params: { path: createPath } }
  );
  const json = (await created.json()) as { session?: { id: string }; id?: string };
  const sessionId = json.session?.id ?? json.id;
  if (sessionId === undefined) throw new Error("no session id");

  /**
   * Write one row through the action path, and WAIT for the request to reach a
   * terminal status before returning. Draining the SSE stream is not enough —
   * it closes while the block is still running, so a read issued straight after
   * it sees an empty collection and the test would "prove" the wrong thing.
   */
  const seed = async () => {
    const path = ["shell", sessionId, "actions", "seed"];
    const response = await router.POST(
      new Request(`http://localhost/api/flows/${path.join("/")}`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({ userId: "u1", input: {} })
      }),
      { params: { path } }
    );
    let stream = "";
    if (response.body !== null) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        stream += decoder.decode(chunk.value);
      }
    }
    const requestId = stream.match(/"requestId":"([^"]+)"/)?.[1];
    if (requestId === undefined) throw new Error("no requestId in seed stream");

    const statusPath = ["shell", "requests", requestId, "status"];
    for (let attempt = 0; attempt < 100; attempt++) {
      const status = await router.GET(
        new Request(`http://localhost/api/flows/${statusPath.join("/")}`, { method: "GET" }),
        { params: { path: statusPath } }
      );
      const body = (await status.json()) as { status?: string };
      if (body.status === "completed") return;
      if (body.status === "failed") throw new Error(`seed failed: ${JSON.stringify(body)}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("seed never reached a terminal status");
  };

  return { router, sessionId, seed };
}

describe("FIX-1477 · the collection-state read gate", () => {
  it("refuses the hired roster's list with 403, even with rows in it", async () => {
    const { router, sessionId, seed } = await build("roster", defineHiredRosterCollection());
    await seed();
    const result = await listState(router, sessionId, "roster");
    // eslint-disable-next-line no-console
    console.log("ROSTER LIST ->", result.status, result.body.slice(0, 200));
    expect(result.status).toBe(403);
    expect(result.body).toContain("State read not permitted");
  });

  it("refuses a channel board ledger's list with 403, and the ledger declares no client config", async () => {
    const ledger = channelBoard("eng.feature", "triage");

    // Asserted, not logged. This half of the claim is *why* the 403 below
    // happens, so it has to be able to fail on its own: add
    // `client: { state: { read: true } }` anywhere on the ledger's declaration
    // and this line goes red before the route is ever called.
    expect("client" in (ledger as unknown as Record<string, unknown>)).toBe(false);

    const { router, sessionId } = await build("eng.feature.triage", ledger);
    const result = await listState(router, sessionId, "eng.feature.triage");
    // eslint-disable-next-line no-console
    console.log("BOARD LIST ->", result.status, result.body.slice(0, 200));
    expect(result.status).toBe(403);
    expect(result.body).toContain("State read not permitted");
  });

  it("lists the seeded row for the same shape WITH the one-line client opt-in", async () => {
    const roster = defineHiredRosterCollection() as unknown as Record<string, unknown>;
    const opened = defineResourceCollection({
      pattern: roster.pattern as string,
      scope: roster.scope as "org",
      flowIsolation: roster.flowIsolation as boolean,
      stateSchema: roster.stateSchema as never,
      client: { state: { read: true } }
    });
    const { router, sessionId, seed } = await build("roster", opened);
    await seed();
    const result = await listState(router, sessionId, "roster");
    // eslint-disable-next-line no-console
    console.log("ROSTER LIST + OPT-IN ->", result.status, result.body.slice(0, 200));

    expect(result.status).toBe(200);
    // A populated list, not an empty 200 — this is what the panels need, and
    // what an item-route read would never have shown.
    const parsed = JSON.parse(result.body) as {
      items: { topic: string; clientData?: { seatId?: string } }[];
    };
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]?.clientData?.seatId).toBe(SEEDED_SEAT.seatId);
  });
});
