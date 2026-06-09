/**
 * Pure traversal functions over `Edge[]` for the reusable graph primitive.
 *
 * All traversals are depth-bounded (clamped to `MAX_DEPTH`) and cycle-safe
 * (maintain a visited-node set), and bidirectional by default. They operate
 * on a plain edge array with no store or runtime dependency, so the same
 * functions work over an in-memory slice or a fully materialised graph.
 *
 * "Active" filtering is bi-temporal: callers can ask for the graph as it
 * stood at any instant via `TraversalOpts.at`.
 */

import type { Edge, NodeRef } from "./edge";

/** Hard upper bound on traversal depth, to bound cost regardless of caller input. */
export const MAX_DEPTH = 6;

/** Options shared by every traversal function. */
export type TraversalOpts = {
  /** Max hops. Default 2; clamped to `MAX_DEPTH`. */
  depth?: number;
  /** Edge direction to follow. Default "both". */
  direction?: "out" | "in" | "both";
  /** Restrict to these edge types (matched on `edge.type`). */
  relationTypes?: string[];
  /** ISO time; only edges active at this instant (bi-temporal). Default now. */
  at?: string;
};

/** Edges valid at `at` (default: now). Active = validFrom is null or <= at, AND validUntil is null or > at. */
export function activeAt(edges: Edge[], at?: string): Edge[] {
  // Compare parsed instants, not raw ISO strings: caller-supplied timestamps
  // (`at`, `validFrom`, `supersede(id, at)`) may carry different fractional-
  // second precision, and lexicographic order misranks those (e.g.
  // "…:00.500Z" sorts before "…:00Z").
  const instant = at !== undefined ? Date.parse(at) : Date.now();
  return edges.filter((e) => {
    const startsOk = e.validFrom === null || Date.parse(e.validFrom) <= instant;
    const endsOk = e.validUntil === null || Date.parse(e.validUntil) > instant;
    return startsOk && endsOk;
  });
}

/** Apply active-at + relationType filtering to produce the graph slice a traversal walks. */
function filterEdges(edges: Edge[], opts?: TraversalOpts): Edge[] {
  let result = activeAt(edges, opts?.at);
  const types = opts?.relationTypes;
  if (types && types.length > 0) {
    const allowed = new Set(types);
    result = result.filter((e) => allowed.has(e.type));
  }
  return result;
}

/** Does this edge touch `node` in the requested direction? */
function touches(edge: Edge, node: NodeRef, direction: "out" | "in" | "both"): boolean {
  if (direction === "out") return edge.from === node;
  if (direction === "in") return edge.to === node;
  return edge.from === node || edge.to === node;
}

/** Immediate edges touching `node` in the requested direction (after active+relationType filtering). */
export function neighbors(edges: Edge[], node: NodeRef, opts?: TraversalOpts): Edge[] {
  const direction = opts?.direction ?? "both";
  return filterEdges(edges, opts).filter((e) => touches(e, node, direction));
}

/** The node reached by walking `edge` away from `node`, or null if `edge` does not lead anywhere new in this direction. */
function otherEnd(
  edge: Edge,
  node: NodeRef,
  direction: "out" | "in" | "both"
): NodeRef | null {
  if (direction === "out") return edge.from === node ? edge.to : null;
  if (direction === "in") return edge.to === node ? edge.from : null;
  if (edge.from === node) return edge.to;
  if (edge.to === node) return edge.from;
  return null;
}

/** Resolve effective depth: default 2, clamped to [0, MAX_DEPTH]. */
function resolveDepth(depth?: number): number {
  const d = depth ?? 2;
  if (d < 0) return 0;
  return Math.min(d, MAX_DEPTH);
}

/** Edges visited from `start` up to `depth`, in BFS order. */
export function traverse(edges: Edge[], start: NodeRef, opts?: TraversalOpts): Edge[] {
  const direction = opts?.direction ?? "both";
  const depth = resolveDepth(opts?.depth);
  const filtered = filterEdges(edges, opts);

  const visited = new Set<NodeRef>([start]);
  const visitedEdges = new Set<string>();
  const result: Edge[] = [];
  let frontier: NodeRef[] = [start];

  for (let hop = 0; hop < depth && frontier.length > 0; hop++) {
    const next: NodeRef[] = [];
    for (const node of frontier) {
      for (const edge of filtered) {
        const other = otherEnd(edge, node, direction);
        if (other === null) continue;
        if (!visitedEdges.has(edge.id)) {
          visitedEdges.add(edge.id);
          result.push(edge);
        }
        if (!visited.has(other)) {
          visited.add(other);
          next.push(other);
        }
      }
    }
    frontier = next;
  }

  return result;
}

/** All nodes + edges within `depth` hops of `node` (the ego graph / neighborhood). Includes `node` itself in nodes. */
export function egoGraph(
  edges: Edge[],
  node: NodeRef,
  opts?: TraversalOpts
): { nodes: NodeRef[]; edges: Edge[] } {
  const direction = opts?.direction ?? "both";
  const depth = resolveDepth(opts?.depth);
  const filtered = filterEdges(edges, opts);

  const visited = new Set<NodeRef>([node]);
  let frontier: NodeRef[] = [node];

  for (let hop = 0; hop < depth && frontier.length > 0; hop++) {
    const next: NodeRef[] = [];
    for (const current of frontier) {
      for (const edge of filtered) {
        const other = otherEnd(edge, current, direction);
        if (other === null) continue;
        if (!visited.has(other)) {
          visited.add(other);
          next.push(other);
        }
      }
    }
    frontier = next;
  }

  // Only keep edges fully contained in the reached node set (both endpoints visited),
  // so edges dangling to a depth+1 node are excluded.
  const reached = filtered.filter((e) => visited.has(e.from) && visited.has(e.to));

  return { nodes: [...visited], edges: reached };
}

/** Shortest edge path from -> to (BFS over the active, type-filtered graph). null if unreachable within depth. The returned array is the ordered chain of edges connecting from to to. */
export function shortestPath(
  edges: Edge[],
  from: NodeRef,
  to: NodeRef,
  opts?: TraversalOpts
): Edge[] | null {
  if (from === to) return [];

  const direction = opts?.direction ?? "both";
  const depth = resolveDepth(opts?.depth);
  const filtered = filterEdges(edges, opts);

  // Predecessor edge that first reached each node, for path reconstruction.
  const predecessor = new Map<NodeRef, Edge>();
  const visited = new Set<NodeRef>([from]);
  let frontier: NodeRef[] = [from];

  for (let hop = 0; hop < depth && frontier.length > 0; hop++) {
    const next: NodeRef[] = [];
    for (const node of frontier) {
      for (const edge of filtered) {
        const other = otherEnd(edge, node, direction);
        if (other === null || visited.has(other)) continue;
        visited.add(other);
        predecessor.set(other, edge);
        if (other === to) {
          return reconstruct(predecessor, from, to);
        }
        next.push(other);
      }
    }
    frontier = next;
  }

  return null;
}

/** Walk predecessor edges back from `to` to `from`, returning edges in forward order. */
function reconstruct(
  predecessor: Map<NodeRef, Edge>,
  from: NodeRef,
  to: NodeRef
): Edge[] {
  const path: Edge[] = [];
  let cursor: NodeRef = to;
  while (cursor !== from) {
    const edge = predecessor.get(cursor);
    if (!edge) break; // unreachable in practice; guards against a malformed predecessor map
    path.push(edge);
    // The previous node is the endpoint of `edge` that is not `cursor`.
    cursor = edge.from === cursor ? edge.to : edge.from;
  }
  return path.reverse();
}
