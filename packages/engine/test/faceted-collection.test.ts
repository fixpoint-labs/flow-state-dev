/**
 * `defineFacetedCollection` in the runtime, on in-memory stores and the mock
 * evaluation model (no API key).
 *
 * Why these matter: a facet search trusts stored answers blindly. A stored
 * answer that describes an older body is a wrong result nobody can detect, so
 * most of these tests are about the paths where that could happen: a failed
 * reclassify, two writes racing, and a facet write parked mid-flight. Each of
 * those carries a control: the same flow around a reaction missing one rule,
 * which must fail the assertion the real one passes.
 *
 * The rest pin what an app relies on: a search runs no model, reindex picks
 * up what writes missed, rows the hand-written recipe stored are read as they
 * are, and the wiring fails loudly when the collection or the evaluator's own
 * resources aren't registered.
 */
import {
  boolean,
  choice,
  defineFacetedCollection,
  defineFlow,
  defineResourceCollection,
  evaluator,
  generator,
  handler,
  resourceContentChangeSchema,
  sequencer,
  type EvaluationModel,
} from "@flow-state-dev/core";
import type { DefinedResourceCollection, ResourceCollectionRef } from "@flow-state-dev/core/types";
import {
  mockEvaluationModel,
  mockGenerator,
  testFlow,
  type MockEvaluationAnswer,
  type MockEvaluationCall,
} from "@flow-state-dev/testing";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { createInMemoryStores, type StoreRegistry } from "../src";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const questions = {
  topic: choice("What is this support ticket about?", {
    billing: "Payments, charges, refunds and invoices",
    outage: "Something is down, broken or erroring",
    other: "Anything else",
  }),
  status: choice("Is the customer's problem still open?", {
    open: "The customer still needs something from us",
    closed: "The problem is resolved",
  }),
  urgent: boolean("Does this need someone now?"),
};

const A = "I was charged twice for March.";
const B = "The dashboard has been down since 9am.";
const USER = "u";

const BILLING_OPEN: Record<string, MockEvaluationAnswer> = {
  topic: { type: "choice", choice: "billing", confidence: 0.9 },
  status: { type: "choice", choice: "open" },
  urgent: { type: "boolean", probability: 0.2 },
};
const OUTAGE_CLOSED: Record<string, MockEvaluationAnswer> = {
  topic: { type: "choice", choice: "outage", confidence: 0.8 },
  status: { type: "choice", choice: "closed", confidence: 0.7 },
  urgent: { type: "boolean", probability: 0.9, confidence: 0.6 },
};

type BodyScript = { answers?: Record<string, MockEvaluationAnswer>; error?: Error; gate?: Promise<void> };
type ScriptedModel = EvaluationModel & { calls: string[] };

/** An evaluation model that answers per body, delegating to the shipped mock. */
function scriptedModel(byBody: (body: string) => BodyScript): ScriptedModel {
  const calls: string[] = [];
  const model = {
    specificationVersion: "v4",
    provider: "mock.evaluation",
    modelId: "mock-evaluation",
    supportedQuestionTypes: ["choice", "score", "boolean"],
    calls,
    async doEvaluate(call: MockEvaluationCall) {
      const body = String(call.state);
      calls.push(body);
      const script = byBody(body);
      if (script.gate !== undefined) await script.gate;
      return mockEvaluationModel({ answers: script.answers, error: script.error }).doEvaluate(call as never);
    },
  };
  return model as unknown as ScriptedModel;
}

function modelFor(scripts: Record<string, BodyScript>) {
  return scriptedModel((body) => scripts[body] ?? { error: new Error(`unscripted body: ${body}`) });
}

function triageOn(model: EvaluationModel) {
  return evaluator({ name: "ticket-facets", model, questions });
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

type StoredTicket = {
  title?: string;
  facets?: Record<string, { choice?: string; confidence?: number; probability?: number }> | null;
  indexedAs?: string | null;
};

async function storedTicket(stores: StoreRegistry, key: string): Promise<StoredTicket | undefined> {
  const row = await stores.resourceState.get("user", USER, `tickets/${key}`);
  return row?.state as StoredTicket | undefined;
}

/** A write action that creates the row and writes its body, as an app would. */
function writeBlock(collection: DefinedResourceCollection<any>, accessor = "tickets") {
  return handler({
    name: "write-ticket",
    inputSchema: z.object({ key: z.string(), title: z.string().optional(), body: z.string().optional() }),
    outputSchema: z.object({ key: z.string() }),
    resources: { [accessor]: collection },
    execute: async (input, ctx) => {
      const tickets = (ctx.resources as Record<string, ResourceCollectionRef>)[accessor]!;
      const ref = await tickets.getOrCreate(input.key, { title: input.title ?? input.key });
      if (input.body !== undefined) await ref.writeContent(input.body);
      return { key: input.key };
    },
  });
}

/** The example's flow, on the utility: write, search, reindex. */
function ticketsFlow(triage: ReturnType<typeof triageOn>, extra: { reactTo?: object } = {}) {
  const tickets = defineFacetedCollection({
    name: "tickets",
    pattern: "tickets/*",
    scope: "user",
    stateSchema: z.object({ title: z.string() }),
    evaluator: triage,
    ...(extra.reactTo !== undefined ? { reactTo: extra.reactTo } : {}),
  });
  return {
    tickets,
    flow: defineFlow({
      kind: "faceted-tickets",
      resources: tickets.resources,
      actions: {
        write: { block: writeBlock(tickets.collection) },
        search: { block: tickets.search },
        reindex: { block: tickets.reindex },
      },
    })(),
  };
}

type AnyFlow = Parameters<typeof testFlow>[0]["flow"];

async function turn(flow: AnyFlow, stores: StoreRegistry, action: string, input: unknown, sessionId = "s1") {
  return testFlow({ flow, stores, action, input, userId: USER, sessionId });
}

type TraceRow = { type: string; blockKind?: string; blockName?: string; status?: string };

function modelRows(items: unknown[]): TraceRow[] {
  return (items as TraceRow[]).filter(
    (i) => i.type === "block_trace" && (i.blockKind === "evaluator" || i.blockKind === "generator")
  );
}

async function search(flow: AnyFlow, stores: StoreRegistry, query: object) {
  const r = await turn(flow, stores, "search", query, "s-search");
  expect(r.error).toBeUndefined();
  return { keys: [...(r.output as { keys: string[] }).keys].sort(), items: r.items };
}

// ---------------------------------------------------------------------------
// Controls: the same flow around a reaction missing one rule
// ---------------------------------------------------------------------------

/**
 * - `no-clear`: old facets stay while the new body is classified;
 * - `no-token`: answers are stored unconditionally;
 * - `body-check`: a body-equality check followed by a separate `patchState`.
 */
type BrokenVariant = "no-clear" | "no-token" | "body-check";

function controlFlow(triage: ReturnType<typeof triageOn>, variant: BrokenVariant) {
  const ticketsOf = (ctx: { resources: unknown }) =>
    (ctx.resources as { tickets: ResourceCollectionRef<StoredTicket & { title: string }> }).tickets;
  const stamped = z.object({ key: z.string(), token: z.string(), body: z.string() });
  const stamp = handler({
    name: "control-stamp",
    inputSchema: resourceContentChangeSchema(),
    outputSchema: stamped,
    execute: async (change, ctx) => {
      const ref = await ticketsOf(ctx).get(change.key);
      const token = crypto.randomUUID();
      if (variant === "no-clear") await ref.patchState({ indexedAs: token });
      else await ref.patchState({ facets: null, indexedAs: token });
      return { key: change.key, token, body: (await ref.readContent()) ?? "" };
    },
  });
  const store = handler({
    name: "control-store",
    inputSchema: z.object({ answers: z.record(z.string(), z.unknown()) }),
    parentInputSchema: stamped,
    execute: async ({ answers }, ctx) => {
      const { key, token, body } = ctx.parent!.input;
      const ref = await ticketsOf(ctx).get(key);
      const facets = answers as StoredTicket["facets"];
      if (variant === "no-token") await ref.patchState({ facets });
      else if (variant === "body-check") {
        if ((await ref.readContent()) === body) await ref.patchState({ facets });
      } else await ref.updateState((s) => (s.indexedAs === token ? { ...s, facets } : s));
    },
  });
  const classify = sequencer({ name: "control-classify", inputSchema: stamped })
    .step((s) => s.body, triage)
    .step(store);
  const reaction = sequencer({ name: "control-index", inputSchema: resourceContentChangeSchema() })
    .step(stamp)
    .sideChain(classify);

  // The same stored shape the utility writes, so the utility's search reads it.
  const { tickets: shaped } = ticketsFlow(triage);
  const tickets = defineResourceCollection({
    pattern: "tickets/*",
    scope: "user",
    stateSchema: shaped.collection.stateSchema,
    reactTo: { contentUpdated: reaction },
  });
  // The controls only ever search by topic.
  const controlSearch = handler({
    name: "control-search",
    inputSchema: z.object({ topic: z.string() }),
    resources: { tickets },
    execute: async (query, ctx) => ({
      keys: (await ctx.resources.tickets.list())
        .filter((t) => (t.state as StoredTicket).facets?.topic?.choice === query.topic)
        .map((t) => t.path.slice("tickets/".length)),
    }),
  });
  return defineFlow({
    kind: "faceted-tickets-control",
    resources: { tickets },
    actions: { write: { block: writeBlock(tickets) }, search: { block: controlSearch } },
  })();
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

describe("writing a body classifies it once", () => {
  it("V1: stores the evaluator's answers as given; no body or an empty one classifies nothing", async () => {
    const model = modelFor({ [A]: { answers: BILLING_OPEN } });
    const { flow } = ticketsFlow(triageOn(model));
    const stores = createInMemoryStores();

    expect((await turn(flow, stores, "write", { key: "t0", title: "No body yet" })).status).toBe("completed");
    expect((await turn(flow, stores, "write", { key: "t-empty", body: "   " })).status).toBe("completed");
    expect(model.calls).toHaveLength(0);
    expect((await storedTicket(stores, "t0"))?.facets).toBeNull();
    expect((await storedTicket(stores, "t-empty"))?.facets).toBeNull();

    const written = await turn(flow, stores, "write", { key: "t1", title: "Charged", body: A });
    expect(written.status).toBe("completed");
    expect(model.calls).toEqual([A]);

    const facets = (await storedTicket(stores, "t1"))?.facets;
    expect(facets).toEqual({
      topic: { type: "choice", choice: "billing", confidence: 0.9 },
      status: { type: "choice", choice: "open" },
      urgent: { type: "boolean", probability: 0.2 },
    });
    // Confidence is stored only where the model reported it; nothing invents one.
    expect("confidence" in facets!.status!).toBe(false);
    expect("confidence" in facets!.urgent!).toBe(false);
    // The app's own field is kept beside the added ones.
    expect((await storedTicket(stores, "t1"))?.title).toBe("Charged");
  });

  it("V6: storing facets does not re-fire the content reaction", async () => {
    const model = modelFor({ [A]: { answers: BILLING_OPEN } });
    const { flow } = ticketsFlow(triageOn(model));
    const stores = createInMemoryStores();
    await turn(flow, stores, "write", { key: "t1", body: A });
    expect((await storedTicket(stores, "t1"))?.facets).not.toBeNull();
    await turn(flow, stores, "search", { topic: "billing" });
    expect(model.calls).toHaveLength(1);
  });

  it("V10: an app's stateUpdated binding still fires beside the utility's reaction", async () => {
    const seen: Array<{ key: string; facets: unknown }> = [];
    const recorder = handler({
      name: "record-state-updates",
      inputSchema: z.any(),
      execute: async (change: { key: string; state: { facets?: unknown } | null }) => {
        seen.push({ key: change.key, facets: change.state?.facets ?? null });
      },
    });
    const model = modelFor({ [A]: { answers: BILLING_OPEN } });
    const { flow } = ticketsFlow(triageOn(model), { reactTo: { stateUpdated: recorder } });
    const stores = createInMemoryStores();
    await turn(flow, stores, "write", { key: "t1", body: A });

    // The clear-and-stamp write and the facet store are both state writes.
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen.every((s) => s.key === "t1")).toBe(true);
    expect(seen.some((s) => (s.facets as { topic?: { choice?: string } } | null)?.topic?.choice === "billing")).toBe(
      true
    );
    expect((await storedTicket(stores, "t1"))?.facets?.topic?.choice).toBe("billing");
  });
});

// ---------------------------------------------------------------------------
// Searching
// ---------------------------------------------------------------------------

describe("searching stored facets makes no model call", () => {
  it("V2: returns only matching rows, never an unclassified one, with no model row in the trace", async () => {
    const model = modelFor({ [A]: { answers: BILLING_OPEN }, [B]: { answers: OUTAGE_CLOSED } });
    const { flow } = ticketsFlow(triageOn(model));
    const stores = createInMemoryStores();
    await turn(flow, stores, "write", { key: "t1", body: A });
    await turn(flow, stores, "write", { key: "t2", body: B });
    await turn(flow, stores, "write", { key: "t3", title: "never classified" });
    const callsBefore = model.calls.length;

    const billing = await search(flow, stores, { topic: "billing", status: "open" });
    expect(billing.keys).toEqual(["t1"]);
    expect((await search(flow, stores, { status: "closed" })).keys).toEqual(["t2"]);
    expect((await search(flow, stores, {})).keys).toEqual(["t1", "t2"]); // t3 has no facets

    expect(model.calls.length).toBe(callsBefore);
    expect(modelRows(billing.items)).toEqual([]);
    // The control for the trace check: a write turn does carry the evaluator row.
    const write = await turn(flow, stores, "write", { key: "t4", body: A });
    expect(modelRows(write.items).map((r) => r.blockKind)).toContain("evaluator");
  });

  it("V2: the same search handed to an agent as a tool returns the same rows", async () => {
    const model = modelFor({ [A]: { answers: BILLING_OPEN }, [B]: { answers: OUTAGE_CLOSED } });
    const { flow, tickets } = ticketsFlow(triageOn(model));
    const stores = createInMemoryStores();
    await turn(flow, stores, "write", { key: "t1", body: A });
    await turn(flow, stores, "write", { key: "t2", body: B });
    const callsBefore = model.calls.length;

    const agent = generator({ name: "support-agent", model: "mock/agent", prompt: "Find tickets.", tools: [tickets.search] });
    // Offered only as a tool: the flow's `resources` is what registers the collection.
    const agentFlow = defineFlow({
      kind: "faceted-tickets",
      resources: tickets.resources,
      actions: { ask: { block: agent } },
    })();
    const result = await testFlow({
      flow: agentFlow,
      stores,
      action: "ask",
      input: "any open billing tickets?",
      userId: USER,
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
    const direct = await search(flow, stores, { topic: "billing" });
    expect(direct.keys).toEqual(["t1"]);
    expect(outputs).toEqual([{ keys: direct.keys }]);
    expect(model.calls.length).toBe(callsBefore);
  });

  it("V4: a minimum confidence keeps only answers reported at or above it; none reported fails it", async () => {
    const bodies = { high: "refund please (sure)", low: "refund please (unsure)", none: "refund please (silent)" };
    const withTopic = (confidence?: number): Record<string, MockEvaluationAnswer> => ({
      ...BILLING_OPEN,
      topic: confidence === undefined ? { type: "choice", choice: "billing" } : { type: "choice", choice: "billing", confidence },
    });
    const model = modelFor({
      [bodies.high]: { answers: withTopic(0.9) },
      [bodies.low]: { answers: withTopic(0.3) },
      [bodies.none]: { answers: withTopic() },
    });
    const { flow } = ticketsFlow(triageOn(model));
    const stores = createInMemoryStores();
    for (const [key, body] of Object.entries(bodies)) await turn(flow, stores, "write", { key, body });

    expect((await search(flow, stores, { topic: "billing" })).keys).toEqual(["high", "low", "none"]);
    expect((await search(flow, stores, { topic: "billing", minConfidence: 0.5 })).keys).toEqual(["high"]);
  });

  it("V12: rows the hand-written recipe stored are found as they are, with no evaluator call", async () => {
    const model = modelFor({});
    const { flow } = ticketsFlow(triageOn(model));
    const stores = createInMemoryStores();
    // The recipe's exact stored shape: title, facets as the evaluator returned them, a token.
    await stores.resourceState.set(
      "user",
      USER,
      "tickets/legacy-billing",
      {
        title: "Charged twice",
        facets: {
          topic: { type: "choice", choice: "billing", confidence: 0.9 },
          status: { type: "choice", choice: "open" },
          urgent: { type: "boolean", probability: 0.1 },
        },
        indexedAs: "3f1c2b9e-0000-4000-8000-000000000001",
      },
      "any"
    );
    await stores.resourceState.set(
      "user",
      USER,
      "tickets/legacy-outage",
      {
        title: "Down",
        facets: {
          topic: { type: "choice", choice: "outage" },
          status: { type: "choice", choice: "open" },
          urgent: { type: "boolean", probability: 0.9 },
        },
        indexedAs: "3f1c2b9e-0000-4000-8000-000000000002",
      },
      "any"
    );

    expect((await search(flow, stores, { topic: "billing" })).keys).toEqual(["legacy-billing"]);
    expect((await search(flow, stores, { status: "open", minConfidence: 0.5 })).keys).toEqual([]);
    expect((await search(flow, stores, { topic: "billing", minConfidence: 0.5 })).keys).toEqual(["legacy-billing"]);
    // Reindex without force leaves them alone: they already have facets.
    const r = await turn(flow, stores, "reindex", {});
    expect(r.output).toEqual({ reindexed: [] });
    expect(model.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Stale answers
// ---------------------------------------------------------------------------

describe("stale answers never reach a search", () => {
  it("V3: a failed reclassify leaves no facets, and the save still succeeds", async () => {
    const model = modelFor({ [A]: { answers: BILLING_OPEN }, [B]: { error: new Error("model down") } });
    const { flow } = ticketsFlow(triageOn(model));
    const stores = createInMemoryStores();
    await turn(flow, stores, "write", { key: "t1", body: A });
    expect((await search(flow, stores, { topic: "billing" })).keys).toEqual(["t1"]);

    const rewrite = await turn(flow, stores, "write", { key: "t1", body: B });
    expect(rewrite.status).toBe("completed");
    expect(rewrite.error).toBeUndefined();
    // The failure is in the trace, not hidden.
    expect(modelRows(rewrite.items).some((r) => r.blockKind === "evaluator" && r.status === "failed")).toBe(true);
    expect((await storedTicket(stores, "t1"))?.facets).toBeNull();
    expect((await search(flow, stores, { topic: "billing" })).keys).toEqual([]);
    // Nothing retried.
    expect(model.calls).toEqual([A, B]);
  });

  it("V3 control: a reaction without the clear step serves the old answers for the new body", async () => {
    const model = modelFor({ [A]: { answers: BILLING_OPEN }, [B]: { error: new Error("model down") } });
    const flow = controlFlow(triageOn(model), "no-clear");
    const stores = createInMemoryStores();
    await turn(flow, stores, "write", { key: "t1", body: A });
    await turn(flow, stores, "write", { key: "t1", body: B });
    expect((await search(flow, stores, { topic: "billing" })).keys).toEqual(["t1"]); // stale: B is an outage
  });

  /** Write A with a held classification, land B, then release A. */
  async function raceTwoWrites(flow: AnyFlow, stores: StoreRegistry, release: () => void, held: Promise<void>) {
    const first = turn(flow, stores, "write", { key: "t1", body: A }, "s-a");
    await held;
    const second = await turn(flow, stores, "write", { key: "t1", body: B }, "s-b");
    expect(second.status).toBe("completed");
    release();
    expect((await first).status).toBe("completed");
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
    await raceTwoWrites(ticketsFlow(triageOn(model)).flow, stores, gate.resolve, entered.promise);
    expect((await storedTicket(stores, "t1"))?.facets?.topic?.choice).toBe("outage");
  });

  it("V5 control: storing without the token check lets the superseded answers win", async () => {
    const { model, gate, entered } = heldOnA();
    const stores = createInMemoryStores();
    await raceTwoWrites(controlFlow(triageOn(model), "no-token"), stores, gate.resolve, entered.promise);
    expect((await storedTicket(stores, "t1"))?.facets?.topic?.choice).toBe("billing");
  });

  /**
   * Park A's facet write at the store, after its classification returned and
   * its check passed. While it is parked, B is written and B's classification
   * fails. Then release A's write.
   */
  async function parkedFacetWrite(flow: AnyFlow) {
    const stores = createInMemoryStores();
    const park = deferred();
    const parked = deferred();
    const realSet = stores.resourceState.set.bind(stores.resourceState);
    let parkedOnce = false;
    stores.resourceState.set = async (scopeType, scopeId, key, state, expected) => {
      const facets = (state as StoredTicket).facets;
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

  const failsOnB = () => modelFor({ [A]: { answers: BILLING_OPEN }, [B]: { error: new Error("model down") } });

  it("V9: a facet write parked across a newer write and a failed reclassify stays discarded", async () => {
    const { flow } = ticketsFlow(triageOn(failsOnB()));
    const stores = await parkedFacetWrite(flow);
    expect((await storedTicket(stores, "t1"))?.facets).toBeNull();
    expect((await search(flow, stores, { topic: "billing" })).keys).toEqual([]);
  });

  it("V9 control: a body check followed by patchState brings the old answers back onto body B", async () => {
    const flow = controlFlow(triageOn(failsOnB()), "body-check");
    const stores = await parkedFacetWrite(flow);
    expect((await storedTicket(stores, "t1"))?.facets?.topic?.choice).toBe("billing");
  });
});

// ---------------------------------------------------------------------------
// Reindexing
// ---------------------------------------------------------------------------

describe("reindex", () => {
  it("V7: classifies only rows without facets, including a legacy row with no facets key; force reclassifies all", async () => {
    let down = true;
    const model = scriptedModel((body) =>
      down && body === B ? { error: new Error("model down") } : { answers: body === A ? BILLING_OPEN : OUTAGE_CLOSED }
    );
    const { flow } = ticketsFlow(triageOn(model));
    const stores = createInMemoryStores();
    await turn(flow, stores, "write", { key: "t1", body: A });
    await turn(flow, stores, "write", { key: "t2", body: B }); // fails: no facets
    await turn(flow, stores, "write", { key: "t3", title: "no body" });
    await turn(flow, stores, "write", { key: "legacy", body: A });
    // Rewrite one row in the pre-facets shape: body kept, no facets or indexedAs keys.
    await stores.resourceState.set("user", USER, "tickets/legacy", { title: "legacy" }, "any");
    expect((await stores.resourceState.get("user", USER, "tickets/legacy"))?.state).toEqual({ title: "legacy" });
    down = false;
    model.calls.length = 0;

    // A legacy row never matches a search before it is reindexed.
    expect((await search(flow, stores, {})).keys).toEqual(["t1"]);
    expect(model.calls).toHaveLength(0);

    const r = await turn(flow, stores, "reindex", {});
    expect(r.error).toBeUndefined();
    expect([...model.calls].sort()).toEqual([A, B].sort());
    expect([...(r.output as { reindexed: string[] }).reindexed].sort()).toEqual(["legacy", "t2"]);
    expect((await storedTicket(stores, "t2"))?.facets?.topic?.choice).toBe("outage");
    expect((await search(flow, stores, { topic: "billing" })).keys).toEqual(["legacy", "t1"]);

    model.calls.length = 0;
    const forced = await turn(flow, stores, "reindex", { force: true });
    expect([...model.calls].sort()).toEqual([A, A, B].sort());
    expect([...(forced.output as { reindexed: string[] }).reindexed].sort()).toEqual(["legacy", "t1", "t2"]);
  });
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

describe("wiring", () => {
  function flowRegisteredAs(accessor: string, triage: ReturnType<typeof triageOn>) {
    const tickets = defineFacetedCollection({
      name: "tickets",
      pattern: "tickets/*",
      scope: "user",
      stateSchema: z.object({ title: z.string() }),
      evaluator: triage,
    });
    return defineFlow({
      kind: "faceted-tickets-wiring",
      resources: { [accessor]: tickets.collection },
      actions: { write: { block: writeBlock(tickets.collection, accessor) } },
    })();
  }

  it("V11: a collection registered under another accessor fails its first body write, naming resources", async () => {
    const model = modelFor({ [A]: { answers: BILLING_OPEN } });
    const stores = createInMemoryStores();
    const r = await turn(flowRegisteredAs("docs", triageOn(model)), stores, "write", { key: "t1", body: A });
    expect(r.status).toBe("failed");
    expect(r.error?.message).toMatch(/registered under "tickets"/);
    expect(r.error?.message).toMatch(/resources/);
    expect(model.calls).toHaveLength(0);
  });

  it("V11 control: registered under its name, the same write succeeds", async () => {
    const model = modelFor({ [A]: { answers: BILLING_OPEN } });
    const stores = createInMemoryStores();
    const r = await turn(flowRegisteredAs("tickets", triageOn(model)), stores, "write", { key: "t1", body: A });
    expect(r.status).toBe("completed");
    expect((await storedTicket(stores, "t1"))?.facets?.topic?.choice).toBe("billing");
  });

  /** An evaluator that reads a collection it declares, in `state`. */
  function glossaryEvaluator(model: EvaluationModel) {
    const glossary = defineResourceCollection({
      pattern: "glossary/*",
      scope: "user",
      stateSchema: z.object({ term: z.string() }),
    });
    return evaluator({
      name: "ticket-facets",
      model,
      questions,
      resources: { glossary },
      state: async (body: string, ctx) => {
        const terms = (await ctx.resources.glossary.list()).map((t) => t.state.term);
        return `${body}${terms.length > 0 ? ` [${terms.join(", ")}]` : ""}`;
      },
    });
  }

  function glossaryFlow(model: EvaluationModel, carry: boolean) {
    const tickets = defineFacetedCollection({
      name: "tickets",
      pattern: "tickets/*",
      scope: "user",
      stateSchema: z.object({ title: z.string() }),
      evaluator: glossaryEvaluator(model),
    });
    return defineFlow({
      kind: "faceted-tickets-glossary",
      resources: carry ? tickets.resources : { tickets: tickets.collection },
      actions: { write: { block: writeBlock(tickets.collection) }, search: { block: tickets.search } },
    })();
  }

  it("V13: the evaluator's own resources are carried, so its reaction reads them in a flow that only writes and searches", async () => {
    const model = scriptedModel(() => ({ answers: BILLING_OPEN }));
    const stores = createInMemoryStores();
    const flow = glossaryFlow(model, true);
    const r = await turn(flow, stores, "write", { key: "t1", body: A });
    expect(r.status).toBe("completed");
    expect(model.calls).toEqual([A]);
    expect((await storedTicket(stores, "t1"))?.facets?.topic?.choice).toBe("billing");
  });

  it("V13 control: registering the collection alone leaves the evaluator's read failing", async () => {
    const model = scriptedModel(() => ({ answers: BILLING_OPEN }));
    const stores = createInMemoryStores();
    const r = await turn(glossaryFlow(model, false), stores, "write", { key: "t1", body: A });
    // The classification fails on the side chain: the save stands, the row has no facets.
    expect(r.status).toBe("completed");
    expect(model.calls).toEqual([]);
    expect(modelRows(r.items).some((row) => row.blockKind === "evaluator" && row.status === "failed")).toBe(true);
    expect((await storedTicket(stores, "t1"))?.facets).toBeNull();
  });
});
