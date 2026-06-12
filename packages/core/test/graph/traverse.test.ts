import { describe, expect, it } from "vitest";
import type { Edge } from "../../src/graph/edge";
import {
  activeAt,
  egoGraph,
  neighbors,
  shortestPath,
  traverse,
} from "../../src/graph/traverse";

/** Build a minimal edge for tests, overriding only what matters. */
function edge(over: Partial<Edge> & Pick<Edge, "id" | "from" | "to">): Edge {
  return {
    type: "rel",
    confidence: 1,
    validFrom: null,
    validUntil: null,
    source: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("activeAt", () => {
  it("includes open edges (validUntil null) and excludes edges that ended before `at`", () => {
    const open = edge({ id: "open", from: "a", to: "b" });
    const ended = edge({
      id: "ended",
      from: "a",
      to: "c",
      validUntil: "2026-01-01T00:00:00.000Z",
    });
    const at = "2026-06-01T00:00:00.000Z";
    const result = activeAt([open, ended], at);
    expect(result.map((e) => e.id)).toEqual(["open"]);
  });

  it("respects an explicit `at` for validFrom (excludes not-yet-valid edges)", () => {
    const future = edge({
      id: "future",
      from: "a",
      to: "b",
      validFrom: "2026-12-01T00:00:00.000Z",
    });
    expect(activeAt([future], "2026-06-01T00:00:00.000Z")).toEqual([]);
    expect(activeAt([future], "2026-12-15T00:00:00.000Z").map((e) => e.id)).toEqual(
      ["future"]
    );
  });
});

describe("neighbors", () => {
  const edges = [
    edge({ id: "ab", from: "a", to: "b" }),
    edge({ id: "ca", from: "c", to: "a" }),
    edge({ id: "bd", from: "b", to: "d" }),
  ];

  it("returns only immediate edges touching the node (both directions by default)", () => {
    const ids = neighbors(edges, "a").map((e) => e.id).sort();
    expect(ids).toEqual(["ab", "ca"]);
  });

  it("direction 'out' returns only edges where node is `from`", () => {
    expect(neighbors(edges, "a", { direction: "out" }).map((e) => e.id)).toEqual([
      "ab",
    ]);
  });

  it("direction 'in' returns only edges where node is `to`", () => {
    expect(neighbors(edges, "a", { direction: "in" }).map((e) => e.id)).toEqual([
      "ca",
    ]);
  });
});

describe("traverse", () => {
  // a -> b -> c, plus a -> d via a different relation type
  const edges = [
    edge({ id: "ab", from: "a", to: "b", type: "drives" }),
    edge({ id: "bc", from: "b", to: "c", type: "drives" }),
    edge({ id: "ad", from: "a", to: "d", type: "mentions" }),
  ];

  it("visits edges in BFS order from the start node", () => {
    const ids = traverse(edges, "a", { direction: "out", depth: 6 }).map(
      (e) => e.id
    );
    // depth-1 edges (ab, ad) before depth-2 edge (bc)
    expect(ids.slice(0, 2).sort()).toEqual(["ab", "ad"]);
    expect(ids[2]).toBe("bc");
  });

  it("restricts to relationTypes", () => {
    const ids = traverse(edges, "a", {
      direction: "out",
      relationTypes: ["drives"],
      depth: 6,
    }).map((e) => e.id);
    expect(ids).toEqual(["ab", "bc"]);
  });
});

describe("egoGraph", () => {
  // a - b - c - d chain
  const edges = [
    edge({ id: "ab", from: "a", to: "b" }),
    edge({ id: "bc", from: "b", to: "c" }),
    edge({ id: "cd", from: "c", to: "d" }),
  ];

  it("returns nodes exactly within depth (includes the node itself), excludes depth+1", () => {
    const { nodes, edges: reached } = egoGraph(edges, "a", { depth: 2 });
    expect(nodes.sort()).toEqual(["a", "b", "c"]);
    expect(reached.map((e) => e.id).sort()).toEqual(["ab", "bc"]);
    expect(nodes).not.toContain("d"); // d is at depth 3
  });
});

describe("shortestPath", () => {
  // a -> b -> d (2 hops) and a -> c -> ... no shortcut; plus a direct longer detour
  const edges = [
    edge({ id: "ab", from: "a", to: "b" }),
    edge({ id: "bd", from: "b", to: "d" }),
    edge({ id: "ac", from: "a", to: "c" }),
    edge({ id: "cd", from: "c", to: "d" }),
  ];

  it("returns the ordered minimal chain of edges from -> to", () => {
    const path = shortestPath(edges, "a", "d", { depth: 6 });
    expect(path).not.toBeNull();
    expect(path!.length).toBe(2);
    // first edge starts at a, chain ends reaching d
    expect(path![0].from).toBe("a");
    const last = path![path!.length - 1];
    expect(last.from === "d" || last.to === "d").toBe(true);
  });

  it("returns [] for the same node", () => {
    expect(shortestPath(edges, "a", "a")).toEqual([]);
  });

  it("returns null when unreachable within depth", () => {
    expect(shortestPath(edges, "a", "z")).toBeNull();
    // reachable in 2 hops but depth 1 cannot reach d
    expect(shortestPath(edges, "a", "d", { depth: 1 })).toBeNull();
  });
});

describe("cycle safety", () => {
  // a -> b -> c -> a (cycle)
  const edges = [
    edge({ id: "ab", from: "a", to: "b" }),
    edge({ id: "bc", from: "b", to: "c" }),
    edge({ id: "ca", from: "c", to: "a" }),
  ];

  it("terminates and returns bounded results on a cyclic graph", () => {
    const visited = traverse(edges, "a", { direction: "out", depth: 6 });
    expect(visited.map((e) => e.id).sort()).toEqual(["ab", "bc", "ca"]);
  });

  it("shortestPath terminates on a cycle", () => {
    const path = shortestPath(edges, "a", "c", { direction: "out", depth: 6 });
    expect(path!.map((e) => e.id)).toEqual(["ab", "bc"]);
  });
});
