/**
 * BR-20 — the first session into an organization initializes its SHARED record,
 * and a second initializer that raced it adopts the winner's row (FIX-1442).
 *
 * An organization record is shared: every session in the org reads and writes
 * the same row. So two "first" sessions racing here are not two copies of one
 * private record, they are two initializers of one shared one — and an
 * unconditional write lets the slower one land its blank template on top of
 * state the winner has already committed.
 *
 * The race is made deterministic by withholding the winner's row from the
 * loser's READ only. The loser's `set` still meets the real store, so the
 * create-if-absent precondition is what decides the outcome — which is the
 * thing under test.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { createExecutionContext } from "../src/context/createExecutionContext";
import { createInMemoryStores, createResponseEmitter } from "../src";
import type { StoreRegistry } from "../src";

const ORG_ID = "org-race";

function racingFlow() {
  return defineFlow({
    kind: "org-race",
    orgStateSchema: z.object({ tier: z.string().default("free") }),
    actions: {
      run: {
        inputSchema: z.number(),
        block: handler({
          name: "noop",
          inputSchema: z.number(),
          outputSchema: z.number(),
          execute: (input) => input
        })
      }
    }
  })();
}

function contextFor(
  stores: StoreRegistry,
  init: { requestId: string; sessionId: string; userId: string }
) {
  return createExecutionContext({
    flow: racingFlow(),
    actionName: "run",
    requestId: init.requestId,
    sessionId: init.sessionId,
    userId: init.userId,
    orgId: ORG_ID,
    stores,
    response: createResponseEmitter({ requestId: init.requestId })
  });
}

/**
 * `stores`, but the org record reads back as absent to the NEXT caller — the
 * stale read a real racing initializer performs before the winner's write
 * lands. Everything else, `set` included, is the real store.
 */
function withOneStaleOrgRead(stores: StoreRegistry): StoreRegistry {
  let stale = true;
  const real = stores.org;
  // A Proxy rather than a spread: the store's methods live on its prototype,
  // so `{ ...real }` would hand back an object with no `set` at all.
  const org = new Proxy(real, {
    get(target, prop, receiver) {
      if (prop !== "get") return Reflect.get(target, prop, receiver);
      return async (id: string) => {
        if (stale) {
          stale = false;
          return undefined;
        }
        return target.get(id);
      };
    }
  });
  return { ...stores, org } as StoreRegistry;
}

describe("BR-20 · initializing an organization's shared record", () => {
  it("adopts the winner's row instead of overwriting it with a blank template", async () => {
    const stores = createInMemoryStores();

    // The winner: first session in, initializes the org and commits state.
    const winner = await contextFor(stores, {
      requestId: "req-winner",
      sessionId: "sess-winner",
      userId: "user-winner"
    });
    await winner.org!.patchState({ tier: "pro" });

    // The loser: raced the winner, so its read of the org record came back
    // absent and it built a blank seed of its own.
    const loser = await contextFor(withOneStaleOrgRead(stores), {
      requestId: "req-loser",
      sessionId: "sess-loser",
      userId: "user-loser"
    });

    // It must be looking at the winner's row, not the template it seeded.
    expect(loser.org!.state).toEqual({ tier: "pro" });
    // And the durable row must still be the winner's.
    expect((await stores.org.get(ORG_ID))?.state).toEqual({ tier: "pro" });
  });

  it("still initializes the record when there genuinely is no winner", async () => {
    // The control: "adopted the existing row" and "never wrote anything" look
    // identical from the durable side unless the uncontested case is shown to
    // create the record.
    const stores = createInMemoryStores();

    const first = await contextFor(stores, {
      requestId: "req-only",
      sessionId: "sess-only",
      userId: "user-only"
    });

    // The seed carries no state — the schema's defaults are applied on read,
    // not baked into the row — so the record EXISTING is the claim here.
    expect(first.org!.state).toEqual({});
    expect(await stores.org.get(ORG_ID)).toBeDefined();
  });
});
