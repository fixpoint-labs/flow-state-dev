/**
 * Index-time facets on the mock evaluation model (no API key).
 *
 * Why these matter: a facet search trusts stored answers blindly. A stored
 * answer that describes an older body is a wrong result nobody can detect, so
 * most of these tests are about the paths where that could happen: a failed
 * reclassify, two writes racing, and a facet write parked mid-flight.
 */
import { createInMemoryStores, type StoreRegistry } from "@flow-state-dev/engine";
import { generator, defineFlow } from "@flow-state-dev/core";
import { mockGenerator, testFlow } from "@flow-state-dev/testing";
import { describe, expect, it } from "vitest";
import { ticketsFlow } from "../src/flow";
import {
  BILLING_OPEN,
  OUTAGE_CLOSED,
  controlFlow,
  deferred,
  scriptedModel,
  storedTicket,
  triageOn,
  turn,
  type BodyScript,
} from "./helpers";

const A = "I was charged twice for March.";
const B = "The dashboard has been down since 9am.";

function modelFor(scripts: Record<string, BodyScript>) {
  return scriptedModel((body) => scripts[body] ?? { error: new Error(`unscripted body: ${body}`) });
}

type TraceRow = { type: string; blockKind?: string; blockName?: string; modelUsage?: { totalTokens?: number } };

/** Block kinds that would mean a model ran in this turn. */
function modelRows(items: unknown[]): TraceRow[] {
  return (items as TraceRow[]).filter(
    (i) => i.type === "block_trace" && (i.blockKind === "evaluator" || i.blockKind === "generator"),
  );
}

async function search(flow: ReturnType<typeof ticketsFlow>, stores: StoreRegistry, query: object) {
  const r = await turn(flow, stores, "search", query, "s-search");
  expect(r.error).toBeUndefined();
  return { keys: (r.output as { keys: string[] }).keys.sort(), items: r.items };
}

describe("writing a body classifies it once", () => {
  it("V1: stores the evaluator's answers as given; a body-less create classifies nothing", async () => {
    const model = modelFor({ [A]: { answers: BILLING_OPEN } });
    const flow = ticketsFlow(triageOn(model));
    const stores = createInMemoryStores();

    const created = await turn(flow, stores, "write", { key: "t0", title: "No body yet" });
    expect(created.status).toBe("completed");
    expect(model.calls).toHaveLength(0);
    expect((await storedTicket(stores, "t0"))?.facets).toBeNull();

    const written = await turn(flow, stores, "write", { key: "t1", title: "Charged", body: A });
    expect(written.status).toBe("completed");
    expect(model.calls).toEqual([A]);

    const facets = (await storedTicket(stores, "t1"))?.facets;
    expect(facets).toEqual({
      topic: { type: "choice", choice: "billing", confidence: 0.9 },
      status: { type: "choice", choice: "open" },
    });
    // Confidence is stored only where the model reported it; nothing invents one.
    expect("confidence" in facets!.status).toBe(false);
  });

  it("V6: storing facets does not re-fire the content reaction", async () => {
    const model = modelFor({ [A]: { answers: BILLING_OPEN } });
    const flow = ticketsFlow(triageOn(model));
    const stores = createInMemoryStores();
    await turn(flow, stores, "write", { key: "t1", body: A });
    expect((await storedTicket(stores, "t1"))?.facets).not.toBeNull();
    await turn(flow, stores, "search", { topic: "billing" });
    expect(model.calls).toHaveLength(1);
  });
});

describe("searching stored facets makes no model call", () => {
  it("V2: returns only matching tickets, never an unclassified one, with no model row in the trace", async () => {
    const model = modelFor({ [A]: { answers: BILLING_OPEN }, [B]: { answers: OUTAGE_CLOSED } });
    const flow = ticketsFlow(triageOn(model));
    const stores = createInMemoryStores();
    await turn(flow, stores, "write", { key: "t1", body: A });
    await turn(flow, stores, "write", { key: "t2", body: B });
    await turn(flow, stores, "write", { key: "t3", title: "never classified" });
    const callsBefore = model.calls.length;

    const billing = await search(flow, stores, { topic: "billing", status: "open" });
    expect(billing.keys).toEqual(["t1"]);
    const everything = await search(flow, stores, {});
    expect(everything.keys).toEqual(["t1", "t2"]); // t3 has no facets, so it never matches

    expect(model.calls.length).toBe(callsBefore);
    expect(modelRows(billing.items)).toEqual([]);
    // The control for the trace check: the write turn does carry the evaluator row.
    const write = await turn(flow, stores, "write", { key: "t4", body: A });
    expect(modelRows(write.items).map((r) => r.blockKind)).toContain("evaluator");
  });

  it("V2: the same search handed to an agent as a tool returns the same tickets", async () => {
    const model = modelFor({ [A]: { answers: BILLING_OPEN }, [B]: { answers: OUTAGE_CLOSED } });
    const flow = ticketsFlow(triageOn(model));
    const stores = createInMemoryStores();
    await turn(flow, stores, "write", { key: "t1", body: A });
    await turn(flow, stores, "write", { key: "t2", body: B });
    const callsBefore = model.calls.length;

    const searchBlock = flow.actions.search.block;
    const agent = generator({ name: "support-agent", model: "mock/agent", prompt: "Find tickets.", tools: [searchBlock] });
    // An app hands the tool to an agent in the flow that owns the collection;
    // the flow's own actions are what register `tickets`.
    const agentFlow = defineFlow({
      kind: "index-time-facets",
      actions: { ask: { block: agent }, search: { block: searchBlock } },
    })();
    const result = await testFlow({
      flow: agentFlow,
      stores,
      action: "ask",
      input: "any open billing tickets?",
      userId: "u",
      sessionId: "s-agent",
      generators: {
        "support-agent": mockGenerator({
          name: "support-agent",
          script: [
            { toolCalls: [{ toolCallId: "tc1", toolName: "search-tickets", args: { topic: "billing" } }] },
            { text: "done" },
          ],
        }),
      },
    });
    expect(result.error).toBeUndefined();
    const outputs = (result.items as Array<{ type: string; output?: unknown }>)
      .filter((i) => i.type === "tool_output")
      .map((i) => i.output);
    // Same answer as the search action gives for the same values.
    const direct = await search(flow, stores, { topic: "billing" });
    expect(outputs).toEqual([{ keys: direct.keys }]);
    expect(direct.keys).toEqual(["t1"]);
    expect(model.calls.length).toBe(callsBefore);
  });

  it("V4: a minimum confidence keeps only answers reported at or above it; none reported fails it", async () => {
    const bodies = { high: "refund please (sure)", low: "refund please (unsure)", none: "refund please (silent)" };
    const model = modelFor({
      [bodies.high]: { answers: { ...BILLING_OPEN, topic: { type: "choice", choice: "billing", confidence: 0.9 } } },
      [bodies.low]: { answers: { ...BILLING_OPEN, topic: { type: "choice", choice: "billing", confidence: 0.3 } } },
      [bodies.none]: { answers: { ...BILLING_OPEN, topic: { type: "choice", choice: "billing" } } },
    });
    const flow = ticketsFlow(triageOn(model));
    const stores = createInMemoryStores();
    for (const [key, body] of Object.entries(bodies)) await turn(flow, stores, "write", { key, body });

    expect((await search(flow, stores, { topic: "billing" })).keys).toEqual(["high", "low", "none"]);
    expect((await search(flow, stores, { topic: "billing", minConfidence: 0.5 })).keys).toEqual(["high"]);
  });
});

describe("stale answers never reach a search", () => {
  it("V3: a failed reclassify leaves no facets, and the save still succeeds", async () => {
    const model = modelFor({ [A]: { answers: BILLING_OPEN }, [B]: { error: new Error("model down") } });
    const flow = ticketsFlow(triageOn(model));
    const stores = createInMemoryStores();
    await turn(flow, stores, "write", { key: "t1", body: A });
    expect((await search(flow, stores, { topic: "billing" })).keys).toEqual(["t1"]);

    const rewrite = await turn(flow, stores, "write", { key: "t1", body: B });
    expect(rewrite.status).toBe("completed");
    expect(rewrite.error).toBeUndefined();
    expect((await storedTicket(stores, "t1"))?.facets).toBeNull();
    expect((await search(flow, stores, { topic: "billing" })).keys).toEqual([]);
  });

  it("V3 control: a reaction without the clear step serves the old answers for the new body", async () => {
    const model = modelFor({ [A]: { answers: BILLING_OPEN }, [B]: { error: new Error("model down") } });
    const flow = controlFlow(triageOn(model), "no-clear");
    const stores = createInMemoryStores();
    await turn(flow, stores, "write", { key: "t1", body: A });
    await turn(flow, stores, "write", { key: "t1", body: B });
    const r = await turn(flow, stores, "search", { topic: "billing" }, "s-search");
    expect((r.output as { keys: string[] }).keys).toEqual(["t1"]); // stale: body B is an outage
  });

  /** Write A with a held classification, land B, then release A. */
  async function raceTwoWrites(flow: ReturnType<typeof ticketsFlow>, stores: StoreRegistry, release: () => void, held: Promise<void>) {
    const first = turn(flow, stores, "write", { key: "t1", body: A }, "s-a");
    await held;
    const second = await turn(flow, stores, "write", { key: "t1", body: B }, "s-b");
    expect(second.status).toBe("completed");
    release();
    const firstDone = await first;
    expect(firstDone.status).toBe("completed");
  }

  function heldOnA() {
    const gate = deferred();
    const entered = deferred();
    const model = scriptedModel((body) => {
      if (body === A) {
        entered.resolve();
        return { answers: BILLING_OPEN, gate: gate.promise };
      }
      return { answers: OUTAGE_CLOSED };
    });
    return { model, gate, entered };
  }

  it("V5: a slow classification of a superseded body is discarded", async () => {
    const { model, gate, entered } = heldOnA();
    const stores = createInMemoryStores();
    await raceTwoWrites(ticketsFlow(triageOn(model)), stores, gate.resolve, entered.promise);
    expect((await storedTicket(stores, "t1"))?.facets?.topic.choice).toBe("outage");
  });

  it("V5 control: storing without the token check lets the superseded answers win", async () => {
    const { model, gate, entered } = heldOnA();
    const stores = createInMemoryStores();
    await raceTwoWrites(controlFlow(triageOn(model), "no-token") as never, stores, gate.resolve, entered.promise);
    expect((await storedTicket(stores, "t1"))?.facets?.topic.choice).toBe("billing");
  });

  /**
   * Park A's facet write at the store, after its classification returned and
   * its check passed. While it is parked, B is written and B's classification
   * fails. Then release A's write.
   */
  async function parkedFacetWrite(flow: ReturnType<typeof ticketsFlow>) {
    const stores = createInMemoryStores();
    const park = deferred();
    const parked = deferred();
    const realSet = stores.resourceState.set.bind(stores.resourceState);
    let parkedOnce = false;
    stores.resourceState.set = async (scopeType, scopeId, key, state, expected) => {
      const facets = (state as { facets?: { topic?: { choice?: string } } | null }).facets;
      if (!parkedOnce && key === "tickets/t1" && facets?.topic?.choice === "billing") {
        parkedOnce = true;
        parked.resolve();
        await park.promise;
      }
      return realSet(scopeType, scopeId, key, state, expected);
    };

    const first = turn(flow, stores, "write", { key: "t1", body: A }, "s-a");
    await parked.promise;
    const second = await turn(flow, stores, "write", { key: "t1", body: B }, "s-b");
    expect(second.status).toBe("completed");
    park.resolve();
    expect((await first).status).toBe("completed");
    expect(parkedOnce).toBe(true);
    return stores;
  }

  const failsOnB = () =>
    modelFor({ [A]: { answers: BILLING_OPEN }, [B]: { error: new Error("model down") } });

  it("V9: a facet write parked across a newer write and a failed reclassify stays discarded", async () => {
    const flow = ticketsFlow(triageOn(failsOnB()));
    const stores = await parkedFacetWrite(flow);
    expect((await storedTicket(stores, "t1"))?.facets).toBeNull();
    expect((await search(flow, stores, { topic: "billing" })).keys).toEqual([]);
  });

  it("V9 control: a body check followed by patchState brings the old answers back onto body B", async () => {
    const flow = controlFlow(triageOn(failsOnB()), "body-check");
    const stores = await parkedFacetWrite(flow as never);
    expect((await storedTicket(stores, "t1"))?.facets?.topic.choice).toBe("billing");
  });
});

describe("tickets stored before facets existed", () => {
  /**
   * A row persisted before the `facets` field was added has no `facets` key at
   * all. The schema default fills it only on the next write, so search and
   * reindex both read the old shape (BP-030).
   */
  it("BR-9, BR-14: a legacy row with no facets key never matches a search and is picked up by reindex", async () => {
    const model = modelFor({ [A]: { answers: BILLING_OPEN } });
    const flow = ticketsFlow(triageOn(model));
    const stores = createInMemoryStores();
    await turn(flow, stores, "write", { key: "legacy", body: A });
    // Rewrite the stored row in the pre-facets shape: body kept, no facets or indexedAs keys.
    await stores.resourceState.set("user", "u", "tickets/legacy", { title: "legacy" }, "any");
    const raw = await stores.resourceState.get("user", "u", "tickets/legacy");
    expect(raw?.state).toEqual({ title: "legacy" });
    model.calls.length = 0;

    expect((await search(flow, stores, {})).keys).toEqual([]);
    expect((await search(flow, stores, { topic: "billing" })).keys).toEqual([]);
    expect((await search(flow, stores, { topic: "billing", minConfidence: 0.5 })).keys).toEqual([]);
    expect(model.calls).toHaveLength(0);

    const r = await turn(flow, stores, "reindex", {});
    expect(r.error).toBeUndefined();
    expect(model.calls).toEqual([A]);
    expect((await search(flow, stores, { topic: "billing" })).keys).toEqual(["legacy"]);
  });
});

describe("reindex", () => {
  it("V7: classifies only unfaceted tickets; force reclassifies every one", async () => {
    let down = true;
    const model = scriptedModel((body) =>
      down && body === B ? { error: new Error("model down") } : { answers: body === A ? BILLING_OPEN : OUTAGE_CLOSED },
    );
    const flow = ticketsFlow(triageOn(model));
    const stores = createInMemoryStores();
    await turn(flow, stores, "write", { key: "t1", body: A });
    await turn(flow, stores, "write", { key: "t2", body: B }); // fails: no facets
    await turn(flow, stores, "write", { key: "t3", title: "no body" });
    down = false;
    model.calls.length = 0;

    const r = await turn(flow, stores, "reindex", {});
    expect(r.error).toBeUndefined();
    expect(model.calls).toEqual([B]);
    expect((await storedTicket(stores, "t2"))?.facets?.topic.choice).toBe("outage");

    model.calls.length = 0;
    await turn(flow, stores, "reindex", { force: true });
    expect(model.calls.sort()).toEqual([A, B].sort());
  });
});
