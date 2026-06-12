import { describe, expect, it } from "vitest";
import * as graph from "../../src/graph";

describe("graph barrel", () => {
  it("re-exports the full public surface", () => {
    const expected = [
      "edgeListSchema",
      "edgeSchema",
      "nodeRef",
      "parseNodeRef",
      "activeAt",
      "egoGraph",
      "MAX_DEPTH",
      "neighbors",
      "shortestPath",
      "traverse",
    ];
    for (const name of expected) {
      expect(graph).toHaveProperty(name);
    }
  });
});
