import { describe, expect, it } from "vitest";
import { edgeSchema, nodeRef, parseNodeRef } from "../../src/graph/edge";

describe("nodeRef / parseNodeRef", () => {
  it("builds and parses a namespaced ref, round-tripping", () => {
    const ref = nodeRef("ticker", "NVDA");
    expect(ref).toBe("ticker:nvda");
    expect(parseNodeRef(ref)).toEqual({ namespace: "ticker", key: "nvda" });
  });

  it("splits only on the first colon (keys may contain colons)", () => {
    expect(parseNodeRef("url:https://example.com")).toEqual({
      namespace: "url",
      key: "https://example.com",
    });
  });

  it("returns namespace undefined for a bare ref", () => {
    expect(parseNodeRef("user")).toEqual({ key: "user" });
  });
});

describe("edgeSchema", () => {
  it("applies defaults (confidence 1, validFrom/validUntil null, source [])", () => {
    const edge = edgeSchema.parse({
      id: "e1",
      from: "a",
      to: "b",
      type: "drives",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(edge.confidence).toBe(1);
    expect(edge.validFrom).toBe(null);
    expect(edge.validUntil).toBe(null);
    expect(edge.source).toEqual([]);
  });
});
