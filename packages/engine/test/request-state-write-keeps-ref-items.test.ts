/**
 * A request-state write leaves `items` off the record it persists, so the
 * store keeps the items persisted since the run started (FIX-1735). The record
 * the context keeps for itself after that write still has to carry them: with
 * no response emitter to read from, the session item views fall back to it,
 * and a write that dropped them there would hide the current request's items
 * from `ctx.session.items` for the rest of the run.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import type { OutputItem } from "@flow-state-dev/core/items";
import { createExecutionContext, createInMemoryStores } from "../src";

const flow = defineFlow({
  kind: "state-write-keeps-ref-items",
  request: { stateSchema: z.object({ phase: z.string().default("idle") }) },
  actions: {
    run: {
      inputSchema: z.object({}),
      block: handler({
        name: "noop",
        inputSchema: z.object({}),
        outputSchema: z.object({}),
        execute: () => ({})
      })
    }
  }
})();

const REQUEST_ID = "req_ref_items";

function statusItem(id: string, message: string): OutputItem {
  return {
    id,
    type: "status",
    status: "completed",
    requestId: REQUEST_ID,
    itemIndex: 0,
    ts: 1,
    message,
    provenance: { blockName: "noop", blockInstanceId: `${REQUEST_ID}:root:0`, phase: "main" }
  } as unknown as OutputItem;
}

async function open(stores: ReturnType<typeof createInMemoryStores>) {
  return createExecutionContext({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: "run",
    requestId: REQUEST_ID,
    sessionId: "sess_ref_items",
    userId: "user_ref_items",
    stores
  });
}

describe("a request-state write, with no response emitter", () => {
  it("keeps the adopted request's items in the session item views", async () => {
    const stores = createInMemoryStores();
    // The request exists, with an item persisted while it ran.
    await open(stores);
    stores.request.persistItems(REQUEST_ID, [statusItem("item_reading", "Reading the brief.")]);
    await stores.request.flushItems(REQUEST_ID);

    // A context adopting it, as a continuation does, with no emitter.
    const ctx = await open(stores);
    const ids = () => ctx.session.items.all().map((item) => item.id);
    expect(ids()).toContain("item_reading");

    await ctx.request.setState({ phase: "editing" });

    expect(ctx.request.state).toEqual({ phase: "editing" });
    expect(ids()).toContain("item_reading");
    // And the store still holds it.
    expect((await stores.request.get(REQUEST_ID))?.items?.map((item) => item.id)).toEqual(["item_reading"]);
  });
});
