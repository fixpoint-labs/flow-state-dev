/**
 * Index-time demo: seed → classify-on-write → deterministic search.
 * Package-off removes the tools. Reindex fires on content or schema change.
 */
import { describe, expect, it } from "vitest";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { testFlow } from "@flow-state-dev/testing";
import {
  INDEXED_DOCS_FLOW_KIND,
  SEARCH_INDEXED_DOCUMENTS_TOOL,
  createIndexedDocsFlow,
} from "../src/index-flow";
import { INDEX_FACET_QUESTIONS } from "../src/facets";
import { FACET_SCHEMA_VERSION } from "../src/indexed-docs-resource";
import type { TypeSafeRequest } from "../src/client";
import type { TypeSafeEvaluateOutput } from "../src/schemas";
import { scriptedClient } from "./scripted-client";

const USER = "lab-user";

function facetResult(
  kind: string,
  topic: string,
  status: string,
  urgency: string,
  confidence = 0.9,
): TypeSafeEvaluateOutput {
  const choice = (value: string) => ({
    type: "choice" as const,
    choice: value,
    probabilities: { [value]: confidence },
    confidence,
  });
  return {
    model: "typesafe/jev-1.13-20260917",
    answers: {
      kind: choice(kind),
      topic: choice(topic),
      status: choice(status),
      urgency: choice(urgency),
    },
  };
}

function byContent(request: TypeSafeRequest): TypeSafeEvaluateOutput {
  const state = request.state;
  const text =
    typeof state === "string"
      ? state
      : JSON.stringify(state);
  if (text.includes("charge") || text.includes("refund")) {
    return facetResult("ticket", "billing", "open", "high");
  }
  if (text.includes("launch")) return facetResult("spec", "launch", "open", "normal");
  if (text.includes("standup")) return facetResult("note", "other", "closed", "low");
  return facetResult("other", "other", "unknown", "normal");
}

const DOCS = [
  { key: "dup-charge", title: "Duplicate charge", body: "Card charged twice, need refund" },
  { key: "launch-plan", title: "Launch plan", body: "Spec for the September launch" },
  { key: "standup-note", title: "Standup", body: "Quick note from Monday standup" },
] as const;

describe("indexed-docs flow (systemOne on)", () => {
  it("declares ingest, search, reindex, classifyQuery, and status", () => {
    const { client } = scriptedClient(byContent);
    const flow = createIndexedDocsFlow({ systemOne: true, client });
    expect(flow.kind).toBe(INDEXED_DOCS_FLOW_KIND);
    expect(Object.keys(flow.actions).sort()).toEqual([
      "classifyQuery",
      "ingest",
      "reindex",
      "search",
      "status",
    ]);
  });

  it("classifies on write and search returns the stored subset without another model call", async () => {
    const { client, calls } = scriptedClient(byContent);
    const flow = createIndexedDocsFlow({ systemOne: true, client });
    const stores = createInMemoryStores();

    for (const doc of DOCS) {
      const ingested = await testFlow({
        flow,
        action: "ingest",
        userId: USER,
        input: doc,
        stores,
      });
      expect(ingested.status).toBe("completed");
      expect(ingested.output).toMatchObject({ key: doc.key, wrote: true });
    }

    const charge = await testFlow({
      flow,
      action: "ingest",
      userId: USER,
      input: DOCS[0],
      stores,
    });
    expect(charge.status).toBe("completed");
    expect(charge.output).toMatchObject({
      key: "dup-charge",
      wrote: false,
      facets: {
        kind: "ticket",
        topic: "billing",
        status: "open",
        urgency: "high",
        schemaVersion: FACET_SCHEMA_VERSION,
      },
    });

    const afterIngest = calls.length;
    expect(afterIngest).toBe(DOCS.length);
    expect(calls[0]?.request.questions).toEqual(INDEX_FACET_QUESTIONS);

    const tickets = await testFlow({
      flow,
      action: "search",
      userId: USER,
      input: { kind: "ticket" },
      stores,
    });
    expect(tickets.status).toBe("completed");
    expect(tickets.output).toMatchObject({
      matches: [
        {
          key: "dup-charge",
          title: "Duplicate charge",
          facets: { kind: "ticket", topic: "billing" },
        },
      ],
    });
    expect(calls).toHaveLength(afterIngest);

    const launch = await testFlow({
      flow,
      action: "search",
      userId: USER,
      input: { topic: "launch" },
      stores,
    });
    expect(launch.status).toBe("completed");
    expect((launch.output as { matches: { key: string }[] }).matches.map((row) => row.key)).toEqual([
      "launch-plan",
    ]);
    expect(calls).toHaveLength(afterIngest);
  });

  it("reclassifies when content changes or the facet schema version moves", async () => {
    const { client, calls } = scriptedClient(byContent);
    const flow = createIndexedDocsFlow({ systemOne: true, client });
    const stores = createInMemoryStores();

    await testFlow({
      flow,
      action: "ingest",
      userId: USER,
      input: DOCS[0],
      stores,
    });
    expect(calls).toHaveLength(1);

    const updated = await testFlow({
      flow,
      action: "ingest",
      userId: USER,
      input: { ...DOCS[0], body: "Card charged twice — still need a refund" },
      stores,
    });
    expect(updated.status).toBe("completed");
    expect(updated.output).toMatchObject({ wrote: true, key: "dup-charge" });
    expect(calls).toHaveLength(2);

    const reindex = await testFlow({
      flow,
      action: "reindex",
      userId: USER,
      input: { schemaVersion: FACET_SCHEMA_VERSION + 1 },
      stores,
    });
    expect(reindex.status).toBe("completed");
    expect(reindex.output).toEqual({ scanned: 1, reclassified: 1, skipped: 0 });
    expect(calls).toHaveLength(3);

    const unchanged = await testFlow({
      flow,
      action: "reindex",
      userId: USER,
      input: { schemaVersion: FACET_SCHEMA_VERSION + 1 },
      stores,
    });
    expect(unchanged.status).toBe("completed");
    expect(unchanged.output).toEqual({ scanned: 1, reclassified: 0, skipped: 1 });
    expect(calls).toHaveLength(3);
  });

  it("status lists the facet search tool when the package is on", async () => {
    const { client } = scriptedClient(byContent);
    const result = await testFlow({
      flow: createIndexedDocsFlow({ systemOne: true, client }),
      action: "status",
      userId: USER,
      input: {},
    });
    expect(result.status).toBe("completed");
    expect(result.output).toEqual({
      systemOne: true,
      tools: [SEARCH_INDEXED_DOCUMENTS_TOOL],
    });
  });
});

describe("indexed-docs flow (systemOne off)", () => {
  it("does not install ingest, search, or facet tools", async () => {
    const flow = createIndexedDocsFlow({ systemOne: false });
    expect(Object.keys(flow.actions)).toEqual(["status"]);
    expect(flow.actions.search).toBeUndefined();
    expect(flow.actions.ingest).toBeUndefined();

    const result = await testFlow({
      flow,
      action: "status",
      userId: USER,
      input: {},
    });
    expect(result.status).toBe("completed");
    expect(result.output).toEqual({ systemOne: false, tools: [] });
  });
});
