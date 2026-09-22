/**
 * FIX-1477 amendment 1 · premise proof, experiment 2 of 2.
 *
 * NOT production code and not part of any default test run. See README.md for
 * how to run it, what it observed, and its limits.
 *
 * What actually stops the roster and the board panels, and what unblocks them.
 * Runs the REAL router; nothing is stubbed.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, defineResourceCollection } from "@flow-state-dev/core";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores
} from "@flow-state-dev/engine";
import { channelBoard } from "../src/channel/channel-board";
import { defineHiredRosterCollection } from "../src/roster/collections";

type Router = ReturnType<typeof createFlowApiRouter>;

async function readState(router: Router, sessionId: string, ref: string) {
  const path = ["sessions", sessionId, "resources", ref, "state"];
  const response = await router.GET(
    new Request(`http://localhost/api/flows/${path.join("/")}`, { method: "GET" }),
    { params: { path } }
  );
  return { status: response.status, body: await response.text() };
}

async function build(resources: Record<string, unknown>) {
  const registry = createFlowRegistry();
  registry.register(
    defineFlow({ kind: "shell", resources: resources as never, actions: {} })
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
  return { router, sessionId };
}

describe("FIX-1477 · the collection-state read gate", () => {
  it("refuses the hired roster with 403", async () => {
    const { router, sessionId } = await build({
      roster: defineHiredRosterCollection()
    });
    const result = await readState(router, sessionId, "roster");
    // eslint-disable-next-line no-console
    console.log("ROSTER ->", result.status, result.body.slice(0, 200));
    expect(result.status).toBe(403);
    expect(result.body).toContain("State read not permitted");
  });

  it("refuses a channel board ledger with 403, and the ledger declares no client config", async () => {
    const ledger = channelBoard("eng.feature", "triage");
    // eslint-disable-next-line no-console
    console.log(
      "LEDGER DECL ->",
      JSON.stringify({
        hasClientKey: "client" in (ledger as unknown as Record<string, unknown>),
        client: (ledger as unknown as { client?: unknown }).client ?? null
      })
    );
    const { router, sessionId } = await build({ "eng.feature.triage": ledger });
    const result = await readState(router, sessionId, "eng.feature.triage");
    // eslint-disable-next-line no-console
    console.log("BOARD ->", result.status, result.body.slice(0, 200));
    expect(result.status).toBe(403);
    expect(result.body).toContain("State read not permitted");
  });

  it("returns 200 for the same shape WITH the one-line client opt-in", async () => {
    const roster = defineHiredRosterCollection() as unknown as Record<string, unknown>;
    const opened = defineResourceCollection({
      pattern: roster.pattern as string,
      scope: roster.scope as "org",
      flowIsolation: roster.flowIsolation as boolean,
      stateSchema: roster.stateSchema as never,
      client: { state: { read: true } }
    });
    const { router, sessionId } = await build({ roster: opened });
    const result = await readState(router, sessionId, "roster");
    // eslint-disable-next-line no-console
    console.log("ROSTER + OPT-IN ->", result.status, result.body.slice(0, 200));
    expect(result.status).toBe(200);
  });
});
