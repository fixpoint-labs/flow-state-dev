/**
 * The example flow end to end on the mock evaluation model (no API key):
 * writing a ticket classifies it, and a search finds it with no model call.
 *
 * The mechanism's own cases (a failed reclassify, racing writes, a parked
 * facet write, legacy rows, reindex) are tested once, where
 * `defineFacetedCollection` lives. This file checks the example wires it up.
 */
import { createInMemoryStores } from "@flow-state-dev/engine";
import { describe, expect, it } from "vitest";
import { ticketsFlow } from "../src/flow";
import { BILLING_OPEN, OUTAGE_CLOSED, scriptedModel, storedTicket, triageOn, turn } from "./helpers";

const A = "I was charged twice for March.";
const B = "The dashboard has been down since 9am.";

describe("the ticket flow", () => {
  it("classifies a ticket when its body is written, then finds it by facet with no model call", async () => {
    const model = scriptedModel((body) => ({ answers: body === A ? BILLING_OPEN : OUTAGE_CLOSED }));
    const flow = ticketsFlow(triageOn(model));
    const stores = createInMemoryStores();

    expect((await turn(flow, stores, "write", { key: "t1", title: "Charged", body: A })).status).toBe("completed");
    expect((await turn(flow, stores, "write", { key: "t2", body: B })).status).toBe("completed");
    expect(model.calls).toEqual([A, B]);
    expect((await storedTicket(stores, "t1"))?.facets?.topic.choice).toBe("billing");

    const search = await turn(flow, stores, "search", { topic: "billing" }, "s-search");
    expect(search.error).toBeUndefined();
    expect(search.output).toEqual({ keys: ["t1"] });
    const confident = await turn(flow, stores, "search", { status: "closed", minConfidence: 0.5 }, "s-search");
    expect(confident.output).toEqual({ keys: ["t2"] });
    expect(model.calls).toHaveLength(2);
  });

  it("reindexes a ticket whose classification failed", async () => {
    let down = true;
    const model = scriptedModel(() => (down ? { error: new Error("model down") } : { answers: BILLING_OPEN }));
    const flow = ticketsFlow(triageOn(model));
    const stores = createInMemoryStores();

    const write = await turn(flow, stores, "write", { key: "t1", body: A });
    expect(write.status).toBe("completed");
    expect((await storedTicket(stores, "t1"))?.facets).toBeNull();

    down = false;
    const reindex = await turn(flow, stores, "reindex", {});
    expect(reindex.output).toEqual({ reindexed: ["t1"], failed: [] });
    expect((await turn(flow, stores, "search", { topic: "billing" }, "s-search")).output).toEqual({ keys: ["t1"] });
  });
});
