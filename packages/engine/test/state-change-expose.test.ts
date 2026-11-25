/**
 * A flow's `session.client.expose` (and the user and org scopes' own) decides
 * which state fields the browser sees. Client data honours it, and so must the
 * `state_change` items a run streams: a field left out of `expose` never
 * appears in one, on the live stream, on a replay of the stored log, or to a
 * DevTool asking for trace items.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createFlowApiRouter, createFlowRegistry } from "../src";
import { createInMemoryStores } from "../src/host";

const FLOW_KIND = "expose-stream-flow";
const SECRET = "secret-value";

const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
});

/** Writes an exposed and an unexposed field through every state operation that carries values. */
const write = handler({
  name: "write",
  inputSchema: z.any(),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async (_input, ctx) => {
    await ctx.session.patchState({ shown: "shown-1", internalNotes: SECRET });
    await ctx.session.setState({ ...ctx.session.state, shown: "shown-2", internalNotes: `${SECRET}-set` });
    await ctx.session.incState({ visits: 1, internalCount: 7 });
    await ctx.session.pushState("internalLog", SECRET);
    await ctx.session.setStateRecord("internalMap", "key", SECRET);
    await ctx.session.deleteStateRecord("internalMap", "key");
    await ctx.user.patchState({ nickname: "nick", internalToken: SECRET });
    return { ok: true };
  }
});

const flow = defineFlow({
  kind: FLOW_KIND,
  session: {
    stateSchema: z.object({
      shown: z.string().default(""),
      visits: z.number().default(0),
      internalNotes: z.string().default(""),
      internalCount: z.number().default(0),
      internalLog: z.array(z.string()).default([]),
      internalMap: z.record(z.string()).default({})
    }),
    client: { expose: ["shown", "visits"] }
  },
  user: {
    stateSchema: z.object({
      nickname: z.string().default(""),
      internalToken: z.string().default("")
    }),
    client: { expose: ["nickname"] }
  },
  actions: { run: { block: write, inputSchema: z.any() } }
})({ id: FLOW_KIND });

type StateChange = { type: "state_change"; scope: string; operation: string; path?: string; delta?: unknown };

/** The `state_change` items in an SSE body. */
function stateChanges(body: string): StateChange[] {
  return body
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice("data: ".length)) as { item?: StateChange })
    .flatMap((event) => (event.item?.type === "state_change" ? [event.item] : []));
}

async function run(query = ""): Promise<{ live: string; replayed: string }> {
  const stores = createInMemoryStores();
  const registry = createFlowRegistry();
  registry.register(flow as never);
  const router = createFlowApiRouter({ registry, stores });
  const requestId = "req_expose";
  const live = await router.POST(
    new Request(`http://localhost/api/flows/${FLOW_KIND}/actions/run${query}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ sessionId: "sess_expose", userId: "u1", requestId, input: {} })
    }),
    { params: { path: [FLOW_KIND, "actions", "run"] } }
  );
  const liveBody = await live.text();
  const replayed = await router.GET(
    new Request(`http://localhost/api/flows/${FLOW_KIND}/requests/${requestId}/stream${query}`),
    { params: { path: [FLOW_KIND, "requests", requestId, "stream"] } }
  );
  return { live: liveBody, replayed: await replayed.text() };
}

function expectOnlyExposed(body: string): void {
  const changes = stateChanges(body);
  expect(changes.length).toBeGreaterThan(0);
  const wire = JSON.stringify(changes);
  expect(wire).not.toContain(SECRET);
  // A change addressed to an unexposed field (push, record write, record
  // delete) arrives as its operation alone: no path names the field.
  const fieldAddressed = changes.filter((c) => c.scope === "session" && !("delta" in c));
  expect(new Set(fieldAddressed.map((c) => c.operation))).toEqual(new Set(["push", "patch", "delete_key"]));
  for (const change of fieldAddressed) expect(change).not.toHaveProperty("path");
  // The exposed fields still arrive.
  expect(changes).toContainEqual(expect.objectContaining({ scope: "session", operation: "patch", delta: { shown: "shown-1" } }));
  expect(changes).toContainEqual(expect.objectContaining({ scope: "session", operation: "set", delta: { shown: "shown-2", visits: 0 } }));
  expect(changes).toContainEqual(expect.objectContaining({ scope: "session", operation: "increment", delta: { visits: 1 } }));
  expect(changes).toContainEqual(expect.objectContaining({ scope: "user", operation: "patch", delta: { nickname: "nick" } }));
}

describe("state_change items carry only the fields a flow exposes", () => {
  it("on the live stream and on a replay of the stored log", async () => {
    process.env.NODE_ENV = "development"; // state changes are persisted, so replay carries them
    const { live, replayed } = await run();
    expectOnlyExposed(live);
    expectOnlyExposed(replayed);
  });

  it("to a trace request with trace observability on", async () => {
    process.env.NODE_ENV = "development";
    const { live, replayed } = await run("?include=trace");
    expectOnlyExposed(live);
    expectOnlyExposed(replayed);
  });
});
