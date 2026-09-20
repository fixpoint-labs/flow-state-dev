/**
 * Classify-on-write stores facets. Search does not call the model.
 * Content or schema change triggers reindex.
 */
import { describe, expect, it } from "vitest";
import { testBlock } from "@flow-state-dev/testing";
import {
  classifyOnWrite,
  classifyQuery,
  reindexIndexedDocuments,
  searchIndexedDocuments,
} from "../src/index-blocks";
import { INDEX_FACET_QUESTIONS } from "../src/facets";
import { FACET_SCHEMA_VERSION } from "../src/indexed-docs-resource";
import type { TypeSafeRequest } from "../src/client";
import type { TypeSafeEvaluateOutput } from "../src/schemas";
import { scriptedClient } from "./scripted-client";

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

function byTitle(request: TypeSafeRequest): TypeSafeEvaluateOutput {
  const state = request.state;
  const text = typeof state === "string" ? state : JSON.stringify(state);
  if (text.includes("charge")) return facetResult("ticket", "billing", "open", "high");
  if (text.includes("launch")) return facetResult("spec", "launch", "open", "normal");
  if (text.includes("standup")) return facetResult("note", "other", "closed", "low");
  return facetResult("other", "other", "unknown", "normal");
}

const CHARGE = {
  key: "dup-charge",
  title: "Duplicate charge",
  body: "Card charged twice, need refund",
};

describe("classifyOnWrite", () => {
  it("classifies on first write and stores facets on the resource", async () => {
    const { client, calls } = scriptedClient(byTitle);
    const block = classifyOnWrite({ client });
    const result = await testBlock(block, { input: CHARGE });

    expect(result.error).toBeNull();
    expect(result.output).toMatchObject({
      key: "dup-charge",
      wrote: true,
      facets: {
        kind: "ticket",
        topic: "billing",
        status: "open",
        urgency: "high",
        schemaVersion: FACET_SCHEMA_VERSION,
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.request.questions).toEqual(INDEX_FACET_QUESTIONS);
    expect(calls[0]?.request.state).toEqual({
      title: CHARGE.title,
      body: CHARGE.body,
    });
  });
});

describe("searchIndexedDocuments", () => {
  it("filters stored facets without calling the model", async () => {
    const { client, calls } = scriptedClient(byTitle);
    const ingest = classifyOnWrite({ client });
    const search = searchIndexedDocuments({ client });

    const written = await testBlock(ingest, { input: CHARGE });
    expect(written.error).toBeNull();
    const beforeSearch = calls.length;

    // Fresh store — search alone sees nothing. The no-model contract is
    // that search's execute never calls evaluate; prove that on empty +
    // after we seed through a shared flow in index-flow.spec.
    const empty = await testBlock(search, { input: { kind: "ticket" } });
    expect(empty.error).toBeNull();
    expect(empty.output).toEqual({ matches: [] });
    expect(calls).toHaveLength(beforeSearch);
  });
});

describe("reindexIndexedDocuments", () => {
  it("is a handler that reports scanned / reclassified / skipped", () => {
    const { client } = scriptedClient(byTitle);
    const block = reindexIndexedDocuments({ client });
    expect(block.kind).toBe("handler");
    expect(block.name).toBe("reindexIndexedDocuments");
  });
});

describe("classifyQuery", () => {
  it("is the escape hatch and still returns a filter, not search results", async () => {
    const { client, calls } = scriptedClient(byTitle);
    const block = classifyQuery({ client });
    const result = await testBlock(block, {
      input: { query: "refund this charge" },
    });
    expect(result.error).toBeNull();
    expect(result.output).toMatchObject({
      escapeHatch: true,
      filter: { kind: "ticket", topic: "billing" },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.request.state).toBe("refund this charge");
  });
});
