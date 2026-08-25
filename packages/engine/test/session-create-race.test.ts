/**
 * FIX-1007 goal check: concurrent `POST /sessions` on one session id.
 *
 * This is the assertion that fails before the change and passes after. The
 * route used to `get` the id, find nothing, and `set(…, "any")` — an upsert —
 * so two requests arriving together both passed the existence check and both
 * wrote, and the second silently overwrote the first. Nothing about a
 * derived or composite session id prevented it.
 *
 * The route now writes with `expectedVersion: "absent"`, so the store decides
 * the race and the loser is told it lost.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores
} from "../src";

function makeFlow(kind: string): FlowInstance {
  return defineFlow({
    kind,
    actions: {
      run: {
        inputSchema: z.object({ value: z.string() }),
        block: handler<{ value: string }, { ok: boolean }>({
          name: `${kind}-run`,
          execute: () => ({ ok: true })
        })
      }
    }
  })({ id: kind });
}

function createRouter() {
  const registry = createFlowRegistry();
  const stores = createInMemoryStores();
  registry.register(makeFlow("demo"));
  return { router: createFlowApiRouter({ registry, stores }), stores };
}

type Router = ReturnType<typeof createRouter>["router"];

function createSession(router: Router, sessionId: string, state: Record<string, unknown>) {
  return router.POST(
    new Request("http://localhost/api/flows/demo/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "user_1", sessionId, state })
    }),
    { params: { path: ["demo", "sessions"] } }
  );
}

describe("POST /sessions — concurrent creates of one session id", () => {
  it("returns exactly one 201 and one 409, and stores one record", async () => {
    const { router, stores } = createRouter();

    const [first, second] = await Promise.all([
      createSession(router, "workstream_topic_a", { writer: "A" }),
      createSession(router, "workstream_topic_a", { writer: "B" })
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);

    // The winner's record is what is stored — the loser did not overwrite it.
    const winner = first.status === 201 ? first : second;
    const winnerBody = (await winner.json()) as { session: { state: Record<string, unknown> } };
    const stored = await stores.session.get("workstream_topic_a");
    expect(stored?.state).toEqual(winnerBody.session.state);

    const loser = first.status === 409 ? first : second;
    const loserBody = (await loser.json()) as { error: string };
    expect(loserBody.error).toContain("already exists");
  });

  it("still rejects a sequential duplicate create with 409", async () => {
    const { router } = createRouter();

    const created = await createSession(router, "sess_dup", { writer: "A" });
    expect(created.status).toBe(201);

    const duplicate = await createSession(router, "sess_dup", { writer: "B" });
    expect(duplicate.status).toBe(409);
  });

  it("does not collide across distinct session ids", async () => {
    const { router } = createRouter();

    const responses = await Promise.all([
      createSession(router, "sess_a", { writer: "A" }),
      createSession(router, "sess_b", { writer: "B" }),
      createSession(router, "sess_c", { writer: "C" })
    ]);

    expect(responses.map((response) => response.status)).toEqual([201, 201, 201]);
  });
});
