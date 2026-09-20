/**
 * Facet helpers are deterministic. Search never needs a client.
 */
import { describe, expect, it } from "vitest";
import {
  facetsFromAnswers,
  filterByFacets,
  hashIndexedContent,
  needsReindex,
} from "../src/facets";
import { FACET_SCHEMA_VERSION, type IndexedDocumentFacets } from "../src/indexed-docs-resource";
import { TypeSafeError } from "../src/errors";

function facets(partial: Partial<IndexedDocumentFacets>): IndexedDocumentFacets {
  return {
    kind: "ticket",
    topic: "billing",
    status: "open",
    urgency: "high",
    classifiedAt: "2026-09-18T00:00:00.000Z",
    contentHash: "abc",
    schemaVersion: FACET_SCHEMA_VERSION,
    ...partial,
  };
}

describe("hashIndexedContent / needsReindex", () => {
  it("changes when title or body changes", () => {
    const a = hashIndexedContent("Invoice", "charged twice");
    const b = hashIndexedContent("Invoice", "charged twice, please refund");
    expect(a).not.toBe(b);
    expect(a).toBe(hashIndexedContent("Invoice", "charged twice"));
  });

  it("reindexes when facets are missing, content moves, or schema moves", () => {
    const hash = hashIndexedContent("Invoice", "charged twice");
    expect(needsReindex({ facets: null }, hash)).toBe(true);
    expect(needsReindex({ facets: facets({ contentHash: hash }) }, hash)).toBe(false);
    expect(needsReindex({ facets: facets({ contentHash: hash }) }, "other")).toBe(true);
    expect(
      needsReindex({ facets: facets({ contentHash: hash, schemaVersion: 1 }) }, hash, 2),
    ).toBe(true);
  });
});

describe("filterByFacets", () => {
  const rows = [
    { key: "a", facets: facets({ kind: "ticket", topic: "billing" }) },
    { key: "b", facets: facets({ kind: "spec", topic: "launch", urgency: "normal" }) },
    { key: "c", facets: null },
  ];

  it("returns the matching subset and drops unclassified rows", () => {
    expect(filterByFacets(rows, { kind: "ticket" }).map((row) => row.key)).toEqual(["a"]);
    expect(filterByFacets(rows, { topic: "launch" }).map((row) => row.key)).toEqual(["b"]);
    expect(filterByFacets(rows, { kind: "note" })).toEqual([]);
  });
});

describe("facetsFromAnswers", () => {
  it("maps Choice answers and nulls a field below the confidence floor", () => {
    const mapped = facetsFromAnswers(
      {
        kind: {
          type: "choice",
          choice: "ticket",
          probabilities: { ticket: 0.9 },
          confidence: 0.9,
        },
        topic: {
          type: "choice",
          choice: "billing",
          probabilities: { billing: 0.4 },
          confidence: 0.2,
        },
        status: {
          type: "choice",
          choice: "open",
          probabilities: { open: 0.8 },
          confidence: 0.8,
        },
        urgency: {
          type: "choice",
          choice: "high",
          probabilities: { high: 0.7 },
          confidence: 0.7,
        },
      },
      "hash-1",
      { now: "2026-09-18T00:00:00.000Z", minConfidence: 0.5 },
    );
    expect(mapped.kind).toBe("ticket");
    expect(mapped.topic).toBeNull();
    expect(mapped.status).toBe("open");
    expect(mapped.contentHash).toBe("hash-1");
    expect(mapped.schemaVersion).toBe(FACET_SCHEMA_VERSION);
  });

  it("throws when an answer is not a Choice", () => {
    expect(() =>
      facetsFromAnswers(
        { kind: { type: "noul", noul: 0.9 } },
        "hash-1",
      ),
    ).toThrow(TypeSafeError);
  });
});
