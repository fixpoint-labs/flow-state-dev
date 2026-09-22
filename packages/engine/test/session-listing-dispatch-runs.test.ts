/**
 * `GET /sessions?include=dispatch-runs` — the door this change opens, and the
 * one it must leave shut (FIX-1440).
 *
 * The two cases that matter are a pair, and neither is worth much alone:
 *
 * - **With the include**, a session a dispatcher ran work in is in the listing,
 *   so it can be found without descending from the session that started it.
 * - **Without it**, the response is byte-identical to the one this route
 *   returned before the include existed. That is the FIX-1009 protection — a
 *   caller that never asked for machine sessions must not start seeing them —
 *   and it is asserted on the serialized body rather than on a field, because a
 *   widened default would show up as extra rows whatever shape they arrive in.
 *
 * The boundary cases are here for the same reason: the include widens
 * **parentage** and nothing else, so another principal's run stays absent at
 * every setting. A test that only proved the first bullet would pass just as
 * well against a listing that had stopped filtering at all.
 */
import { defineFlow, handler, DEFAULT_ORG_ID } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores,
  type SessionRecord,
  type StoreRegistry
} from "../src";

const reports = defineFlow({
  kind: "reports",
  actions: {
    run: {
      inputSchema: z.object({}),
      block: handler({ name: "run", inputSchema: z.object({}), execute: () => ({}) })
    }
  }
});

function host(stores: StoreRegistry) {
  const registry = createFlowRegistry();
  registry.registerMany([reports() as unknown as FlowInstance]);
  return createFlowApiRouter({ registry, stores });
}

async function seed(
  stores: StoreRegistry,
  record: Partial<SessionRecord> & { id: string }
): Promise<void> {
  const now = Date.now();
  await stores.session.set(
    record.id,
    {
      orgId: DEFAULT_ORG_ID,
      flowKind: "reports",
      flowId: "reports",
      userId: "u_1",
      state: {},
      version: 0,
      createdAt: now,
      updatedAt: now,
      journal: [],
      ...record
    },
    "any"
  );
}

/** A conversation, and the run a dispatcher started from it. */
async function seedConversationAndRun(stores: StoreRegistry): Promise<void> {
  await seed(stores, { id: "sess_talk" });
  await seed(stores, {
    id: "dsx_run",
    parentSessionId: "sess_talk",
    topic: "task|6:issues|6:task-a",
    coordinate: "task:implement"
  });
}

function list(
  router: ReturnType<typeof createFlowApiRouter>,
  query: string
): Promise<Response> {
  return router.GET(
    new Request(`http://localhost/api/flows/sessions${query}`),
    { params: { path: ["sessions"] } }
  );
}

async function idsOf(response: Response): Promise<string[]> {
  const body = (await response.json()) as { sessions: Array<{ id: string }> };
  return body.sessions.map((session) => session.id);
}

describe("GET /sessions — including dispatch runs", () => {
  it("returns the run beside the session that started it when asked", async () => {
    const stores = createInMemoryStores();
    const router = host(stores);
    await seedConversationAndRun(stores);

    const response = await list(router, "?flowKind=reports&include=dispatch-runs");
    expect(response.status).toBe(200);
    expect((await idsOf(response)).sort()).toEqual(["dsx_run", "sess_talk"]);
  });

  it("carries the provenance edge and the run's labels on the row", async () => {
    const stores = createInMemoryStores();
    const router = host(stores);
    await seedConversationAndRun(stores);

    const body = (await (
      await list(router, "?flowKind=reports&include=dispatch-runs")
    ).json()) as {
      sessions: Array<{ id: string; parentSessionId?: string; coordinate?: string }>;
    };
    const run = body.sessions.find((session) => session.id === "dsx_run");
    // Without these the row is in the list and unreadable: nothing says which
    // session started it, or what it was started to do.
    expect(run?.parentSessionId).toBe("sess_talk");
    expect(run?.coordinate).toBe("task:implement");
  });

  it("returns today's result set, byte for byte, when the include is absent", async () => {
    const stores = createInMemoryStores();
    const router = host(stores);
    await seedConversationAndRun(stores);

    const plain = await (await list(router, "?flowKind=reports")).text();
    const expected = JSON.stringify({
      sessions: [{ ...(await stores.session.get("sess_talk")) }]
    });

    // The serialized body, not a row count: this is the assertion that fails if
    // the default ever widens, in whatever shape the widening arrives.
    expect(plain).toBe(expected);
  });

  it("refuses an include it does not know, naming what it accepts", async () => {
    const stores = createInMemoryStores();
    const router = host(stores);
    await seedConversationAndRun(stores);

    const response = await list(router, "?flowKind=reports&include=children");
    // A silent ignore would tell a caller who misspelled the include that the
    // flow has no dispatch runs, which is a wrong answer rather than a refusal.
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain("dispatch-runs");
  });

  it("widens parentage only — another principal's run is absent at every setting", async () => {
    const stores = createInMemoryStores();
    const router = host(stores);
    await seedConversationAndRun(stores);
    await seed(stores, { id: "sess_theirs", userId: "u_2" });
    await seed(stores, {
      id: "dsx_theirs",
      userId: "u_2",
      parentSessionId: "sess_theirs"
    });

    const mine = await idsOf(
      await list(router, "?flowKind=reports&userId=u_1&include=dispatch-runs")
    );
    expect(mine.sort()).toEqual(["dsx_run", "sess_talk"]);
    expect(mine).not.toContain("dsx_theirs");
  });
});
