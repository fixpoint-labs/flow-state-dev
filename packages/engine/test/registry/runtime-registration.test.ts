/**
 * Registering and unregistering a flow AFTER the runtime was built (FIX-1475).
 *
 * Two checks, and the first one has an anti-game clause that is the whole
 * reason it is evidence rather than decoration.
 *
 * **V1 holds ONE router across all three steps.** The claim under test is that
 * a post-construction `register` is visible to the router with no rebuild —
 * i.e. that the action route resolves the registry per request rather than
 * snapshotting a flow list when it is built. A test that fetched a fresh
 * router between steps would pass against a router that snapshots, which is
 * exactly the implementation the claim denies. So the router is resolved once,
 * before anything is registered, and the same object serves all three
 * requests.
 *
 * Red state, produced before the green was trusted: making
 * `InternalFlowState.register` a no-op leaves step 2 a 404, and making
 * `unregister` a no-op leaves step 3 a 200.
 *
 * **V2 is the registry's own contract**, including the one line that is easy
 * to write the other way: a kind keeps its cross-flow schema participant when
 * its last instance is unregistered. Red state: `delete`ing the participant in
 * `unregister` lets the third assertion admit a conflicting schema over a
 * durable cell another kind's rows are already in.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { createFlowState, inMemoryStores } from "../../src";
import { createFlowRegistry } from "../../src/registry/flow-registry";
import { CrossFlowSchemaConflictError, FlowIdentityConflictError } from "../../src/registry/errors";

/** A collection kind, so copies of it can be minted under explicit ids. */
const deskClerk = defineFlow({
  kind: "desk-clerk",
  cardinality: "collection",
  configSchema: z.object({ desk: z.string().default("front") }),
  actions: {
    answer: {
      inputSchema: z.object({}).passthrough(),
      block: handler({
        name: "answer",
        inputSchema: z.object({}).passthrough(),
        outputSchema: z.object({ desk: z.string() }),
        execute: async (_input, ctx) => ({ desk: String(ctx.flow.config.desk) }),
      }),
    },
  },
});

/** The one flow the app is constructed with, so the registry is not empty. */
const resident = defineFlow({
  kind: "resident",
  actions: {
    ping: {
      inputSchema: z.object({}).passthrough(),
      block: handler({
        name: "ping",
        inputSchema: z.object({}).passthrough(),
        execute: () => undefined,
      }),
    },
  },
})();

function answerRequest(address: string): [Request, { params: { path: string[] } }] {
  return [
    new Request(`http://localhost/api/flows/${address}/actions/answer`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Streamed rather than dispatched, so the assertion can read what the
        // flow actually produced. A bare POST answers `202 accepted` without
        // saying which instance took it, and `202` is a status a wrong seat
        // would return just as happily.
        accept: "text/event-stream",
      },
      body: JSON.stringify({ userId: "u", input: {} }),
    }),
    { params: { path: [address, "actions", "answer"] } },
  ];
}

async function drain(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (stream === null) return "";
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

describe("V1 · a flow registered after construction is served by the SAME router", () => {
  it("404s, then serves, then 404s again — one router object throughout", async () => {
    const flowstate = createFlowState({
      flows: { resident },
      stores: { dev: { primary: inMemoryStores() } },
    });

    // Resolved ONCE, before anything is registered. Every step below uses this
    // object. Re-resolving here would defeat the check — see the file header.
    const router = await flowstate.getRouter();

    const before = await router.POST(...answerRequest("acme.support.ada"));
    expect(before.status).toBe(404);

    // A three-segment instance id, which is the address shape a runtime hire
    // mints (`<org>.<seatId>`). Asserted rather than assumed: nothing but the
    // non-empty check validates an instance id, and this is the check that
    // says so.
    const seat = deskClerk({ id: "acme.support.ada", config: { desk: "back-left" } });
    flowstate.register(seat);

    const during = await router.POST(...answerRequest("acme.support.ada"));
    expect(during.status).toBe(200);
    // Not just "something answered" — the instance registered a moment ago,
    // running on the settings IT was minted with. A different seat, or the
    // kind's own default, reads `front`, so the marker is deliberately not one.
    expect(await drain(during.body)).toContain("back-left");

    expect(flowstate.unregister("acme.support.ada")).toBe(true);

    const after = await router.POST(...answerRequest("acme.support.ada"));
    expect(after.status).toBe(404);

    await flowstate.dispose();
  });

  it("meta.flowKeys tracks the registry, not the construction options", async () => {
    const flowstate = createFlowState({
      flows: { resident },
      stores: { dev: { primary: inMemoryStores() } },
    });

    expect(flowstate.meta.flowKeys).toEqual(["resident"]);

    flowstate.register(deskClerk({ id: "acme.support.ada" }));
    expect(flowstate.meta.flowKeys).toContain("acme.support.ada");

    flowstate.unregister("acme.support.ada");
    expect(flowstate.meta.flowKeys).not.toContain("acme.support.ada");

    await flowstate.dispose();
  });
});

describe("V2 · the registry's admission contract survives unregister", () => {
  it("refuses a duplicate id and leaves the registry byte-identical", () => {
    const registry = createFlowRegistry();
    const first = deskClerk({ id: "acme.support.ada", config: { desk: "front" } });
    registry.register(first);

    expect(() =>
      registry.register(deskClerk({ id: "acme.support.ada", config: { desk: "back" } }))
    ).toThrow(FlowIdentityConflictError);

    // Not merely "still one entry" — the SAME object, with the settings the
    // first registration carried. A refusal that overwrote and then threw
    // would pass a count assertion.
    expect(registry.list()).toHaveLength(1);
    expect(registry.get("acme.support.ada")).toBe(first);
    expect(registry.get("acme.support.ada")?.config).toEqual({ desk: "front" });
  });

  it("answers false for an unknown id rather than throwing", () => {
    const registry = createFlowRegistry();
    expect(registry.unregister("nobody.is.here")).toBe(false);
  });

  it("keeps a kind's schema participant after its LAST instance is unregistered", () => {
    // Two kinds writing one shared org-scoped cell with incompatible schemas.
    const ledgerString = defineFlow({
      kind: "ledger-string",
      org: { stateSchema: z.object({ balance: z.string().default("") }) },
      actions: {
        noop: {
          inputSchema: z.object({}).passthrough(),
          block: handler({
            name: "noop",
            inputSchema: z.object({}).passthrough(),
            execute: () => undefined,
          }),
        },
      },
    })();

    const ledgerNumber = defineFlow({
      kind: "ledger-number",
      org: { stateSchema: z.object({ balance: z.number().default(0) }) },
      actions: {
        noop: {
          inputSchema: z.object({}).passthrough(),
          block: handler({
            name: "noop",
            inputSchema: z.object({}).passthrough(),
            execute: () => undefined,
          }),
        },
      },
    })();

    const registry = createFlowRegistry();
    registry.register(ledgerString);

    // The conflict while the instance is live — the control. Without this, the
    // assertion below could pass because the two schemas never conflicted at
    // all, and the check would be measuring nothing.
    expect(() => registry.register(ledgerNumber)).toThrow(CrossFlowSchemaConflictError);

    expect(registry.unregister("ledger-string")).toBe(true);
    expect(registry.get("ledger-string")).toBeUndefined();

    // The rows `ledger-string` wrote are still in the store. The constraint
    // that protects them has to outlive the registration, so this still
    // throws. Drop the retention line in `unregister` and it admits.
    expect(() => registry.register(ledgerNumber)).toThrow(CrossFlowSchemaConflictError);
  });

  it("known gap · a kind redefined under its own name is admitted and keeps reporting its FIRST schema", () => {
    // What retention actually costs, pinned. The `unregister` doc used to
    // claim the replacement "still conflicts against the old declaration" —
    // it does not, and this is the check that says so. Same-kind pairs are
    // never compared (exclusion 2 in `validateScope`'s own doc), so the
    // replacement walks straight in; `indexParticipant` then returns early
    // because the kind is already a participant, so the schema on file stays
    // the ORIGINAL one. Nothing throws, and nothing is updated.
    //
    // Fixing it means changing what the check keys its identity on, which is
    // FIX-1207's, not this issue's.
    const balanceAsString = z.object({ balance: z.string().default("") });
    const balanceAsNumber = z.object({ balance: z.number().default(0) });

    const ledgerAs = (stateSchema: z.ZodTypeAny) =>
      defineFlow({
        kind: "ledger",
        org: { stateSchema: stateSchema as never },
        actions: {
          noop: {
            inputSchema: z.object({}).passthrough(),
            block: handler({
              name: "noop",
              inputSchema: z.object({}).passthrough(),
              execute: () => undefined,
            }),
          },
        },
      })();

    const registry = createFlowRegistry();
    registry.register(ledgerAs(balanceAsString));
    expect(registry.describeSharedSchemas().org.stateSchema).toBe(balanceAsString);

    expect(registry.unregister("ledger")).toBe(true);

    // Cost (a): the genuinely different definition is admitted, silently.
    expect(() => registry.register(ledgerAs(balanceAsNumber))).not.toThrow();

    // Cost (c): the description still reports the schema of a definition that
    // is no longer registered anywhere. Not merely "some schema" — the OLD
    // object, and it still refuses the number the live definition requires.
    const described = registry.describeSharedSchemas().org.stateSchema;
    expect(described).toBe(balanceAsString);
    expect(described!.safeParse({ balance: 1 }).success).toBe(false);

    // Cost (b) falls out of the same stale entry: every OTHER kind registered
    // afterwards is compared against `balanceAsString`, not against the
    // `balanceAsNumber` definition that is actually live. So a kind that
    // AGREES with what is running is refused…
    const agreesWithLive = defineFlow({
      kind: "ledger-number",
      org: { stateSchema: balanceAsNumber },
      actions: {
        noop: {
          inputSchema: z.object({}).passthrough(),
          block: handler({
            name: "noop",
            inputSchema: z.object({}).passthrough(),
            execute: () => undefined,
          }),
        },
      },
    })();
    expect(() => registry.register(agreesWithLive)).toThrow(CrossFlowSchemaConflictError);

    // …and a kind that CONTRADICTS what is running is admitted.
    const contradictsLive = defineFlow({
      kind: "ledger-string",
      org: { stateSchema: z.object({ balance: z.string().default("") }) },
      actions: {
        noop: {
          inputSchema: z.object({}).passthrough(),
          block: handler({
            name: "noop",
            inputSchema: z.object({}).passthrough(),
            execute: () => undefined,
          }),
        },
      },
    })();
    expect(() => registry.register(contradictsLive)).not.toThrow();
  });
});
