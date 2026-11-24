// FIX-2848 D3.
/**
 * A session turn says whether the engine will run it again for its caller
 * (`retryable`), and the answer is the retry route's own.
 *
 * Why it matters: a screen offers Retry on a failed turn from this field, not
 * from a copy of the route's source list. A copy in the browser can't see a
 * host's own `publicReentrySources`, so Retry would never show on those turns,
 * and it would drift from the route the day the route's rule changes. Here the
 * same failed turns are read through a view and retried through the route on
 * one router, and the two must agree on every source: the built-in ones, the
 * dispatch seam's (never), a host's own, and one nobody declared.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, defineView, handler } from "@flow-state-dev/core";
import { requestHostOf } from "@flow-state-dev/core/internal";
import { createFlowApiRouter, createFlowRegistry } from "../src";
import { createInMemoryStores } from "../src/host";
import { INTERNAL_SOURCE, TASK_SOURCE } from "../src/execution/transport-sources";
import type { StoreRegistry } from "../src/stores/types";

const ORG = "acme";

/** The source a host's own transport stamps, declared in `publicReentrySources`. */
const HOST_SOURCE = "echo";
/** A source no one declared. */
const UNDECLARED_SOURCE = "carrier-pigeon";
// `scheduled` is built in too, but its run needs its schedule binding, which a seeded turn has no use for.
const SOURCES = ["http", "mcp", INTERNAL_SOURCE, TASK_SOURCE, HOST_SOURCE, UNDECLARED_SOURCE];

function flow() {
  return defineFlow({
    kind: "desk",
    actions: { run: { block: handler({ name: "run", inputSchema: z.object({}).passthrough(), outputSchema: z.object({ ok: z.boolean() }), execute: () => ({ ok: true }) }) } },
    views: {
      turns: defineView({
        scope: "user",
        block: handler({
          name: "turns",
          inputSchema: z.object({ sessionId: z.string() }),
          outputSchema: z.array(z.object({ id: z.string(), source: z.string(), retryable: z.boolean().optional() }).passthrough()),
          execute: async (input, ctx) => (await requestHostOf(ctx as never)!.sessions!.turns(input.sessionId)) ?? []
        })
      })
    }
  })();
}

async function seed(stores: StoreRegistry): Promise<void> {
  const now = Date.now();
  await stores.session.set(
    "sess_1",
    { id: "sess_1", orgId: ORG, flowKind: "desk", flowId: "desk", userId: "alice", state: {}, version: 0, createdAt: now, updatedAt: now, journal: [], lineageId: "lin_1" } as never,
    "any"
  );
  for (const [at, source] of SOURCES.entries()) {
    const id = `req_${source}`;
    await stores.request.set(
      id,
      { id, orgId: ORG, flowKind: "desk", flowId: "desk", actionName: "run", sessionId: "sess_1", userId: "alice", source, status: "failed", startedAtMs: now + at, state: {}, version: 0, createdAt: now, updatedAt: now },
      "any"
    );
  }
}

function app() {
  const registry = createFlowRegistry();
  registry.register(flow());
  const stores = createInMemoryStores();
  const router = createFlowApiRouter({
    registry,
    stores,
    staleSweepIntervalMs: 0,
    publicReentrySources: [HOST_SOURCE],
    resolvePrincipal: () => ({ userId: "alice", orgId: ORG })
  });
  return { router, stores };
}

const post = (router: ReturnType<typeof createFlowApiRouter>, path: string[], body: unknown) =>
  router.POST(new Request(`http://localhost/api/flows/${path.join("/")}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), {
    params: { path }
  });

describe("a session turn's retryable", () => {
  it("is what the retry route answers for that turn, on every source", async () => {
    const { router, stores } = app();
    await seed(stores);

    const read = await post(router, ["desk", "views", "turns"], { userId: "alice", input: { sessionId: "sess_1" } });
    if (read.status !== 200) throw new Error(`${read.status} ${await read.text()}`);
    const turns = ((await read.json()) as { output: Array<{ id: string; source: string; retryable?: boolean }> }).output;
    expect(turns.map((turn) => turn.source).sort()).toEqual([...SOURCES].sort());

    const routeSays: Record<string, boolean> = {};
    for (const turn of turns) {
      const response = await post(router, ["desk", "sessions", "sess_1", "requests", turn.id, "retry"], {});
      await response.text();
      expect([202, 404]).toContain(response.status);
      routeSays[turn.source] = response.status === 202;
    }
    const turnSays = Object.fromEntries(turns.map((turn) => [turn.source, turn.retryable]));
    expect(turnSays).toEqual(routeSays);
    // Neither side answered the same thing for every source, so the agreement is not two constants.
    expect(routeSays).toMatchObject({ http: true, [HOST_SOURCE]: true, [TASK_SOURCE]: false, [UNDECLARED_SOURCE]: false });
  });
});
