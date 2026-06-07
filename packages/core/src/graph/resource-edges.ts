/**
 * Resource-edge slot: makes the typed-edge graph primitive a first-class
 * part of the `defineResource` contract.
 *
 * A resource can declare `edges: true | { vocabulary?, maxEdges? }`. When it
 * does, the framework stores an `Edge[]` field inside the resource's own state
 * object (no new storage key) and attaches the `ResourceEdgeApi` built here to
 * the live `ResourceRef` / `ResourceContext`. The API reads edges synchronously
 * from `ref.state.edges` and persists mutations through the resource's existing
 * `updateState`, so edge writes flow through the same persist + change-emit path
 * as any other state write.
 *
 * This module depends only on the pure edge data model (`./edge`) and the pure
 * traversal helpers (`./traverse`) — no store, runtime, or memory coupling.
 */

import type { Edge, NodeRef } from "./edge";
import type { TraversalOpts } from "./traverse";
import { activeAt, neighbors, egoGraph, shortestPath } from "./traverse";

/** Declares that a resource carries a typed-edge graph in its state. `true` = defaults. */
export type EdgeSlotConfig = {
  /** Curated relation vocabulary. When set, `add()` throws on an out-of-vocab `type`. */
  vocabulary?: string[];
  /** Max stored edges. On overflow, `add()` culls lowest-confidence edges down to this many. */
  maxEdges?: number;
};

/** Input to `add()` — id/createdAt/validUntil are framework-assigned. */
export type AddEdgeInput = {
  from: NodeRef;
  to: NodeRef;
  type: string;
  confidence?: number;
  validFrom?: string | null;
  source?: string[];
};

/** The `.edges` accessor attached to a ResourceRef/ResourceContext whose config declared edges. */
export type ResourceEdgeApi = {
  /** Add an edge. Assigns a crypto-strong id + createdAt. Enforces vocabulary + maxEdges. Returns the stored edge. */
  add(input: AddEdgeInput): Promise<Edge>;
  /** Supersede (do NOT delete) an edge: set validUntil = `at` (default now). No-op if id absent. */
  supersede(edgeId: string, at?: string): Promise<void>;
  /** Hard-remove an edge by id. */
  remove(edgeId: string): Promise<void>;
  /** All stored edges; pass { at } to filter to edges active at that instant. */
  all(opts?: { at?: string }): Edge[];
  /** Immediate neighbours of a node. */
  neighbors(node: NodeRef, opts?: TraversalOpts): Edge[];
  /** Ego graph within depth hops. */
  egoGraph(node: NodeRef, opts?: TraversalOpts): { nodes: NodeRef[]; edges: Edge[] };
  /** Shortest edge path between two nodes; null if unreachable. */
  shortestPath(from: NodeRef, to: NodeRef, opts?: TraversalOpts): Edge[] | null;
  /** Drop edges whose endpoints are not in `knownNodes` (referential cleanup). Returns removed count. */
  pruneDangling(knownNodes: Iterable<NodeRef>): Promise<number>;
};

/** The minimal ref surface the edge API needs (a ResourceRef satisfies this structurally). */
export type EdgeBackingRef = {
  readonly state: { edges?: Edge[] } & Record<string, unknown>;
  updateState(updater: (state: any) => any | Promise<any>): Promise<void>;
};

/**
 * Build the `.edges` API over a resource ref. `slot` is the resolved
 * EdgeSlotConfig (`{}` when declared as `true`). Read methods operate
 * synchronously on the current `ref.state.edges`; mutators persist via
 * `ref.updateState`.
 */
export function createResourceEdgeApi(ref: EdgeBackingRef, slot: EdgeSlotConfig): ResourceEdgeApi {
  const readEdges = (): Edge[] => (ref.state.edges as Edge[] | undefined) ?? [];

  return {
    async add(input: AddEdgeInput): Promise<Edge> {
      if (slot.vocabulary && !slot.vocabulary.includes(input.type)) {
        throw new Error(
          `Edge type "${input.type}" is not in the declared vocabulary: ${slot.vocabulary.join(", ")}`
        );
      }
      const edge: Edge = {
        id: crypto.randomUUID(),
        from: input.from,
        to: input.to,
        type: input.type,
        confidence: input.confidence ?? 1,
        validFrom: input.validFrom ?? null,
        validUntil: null,
        source: input.source ?? [],
        createdAt: new Date().toISOString(),
      };
      await ref.updateState((s) => {
        let edges: Edge[] = [...((s.edges as Edge[] | undefined) ?? []), edge];
        if (slot.maxEdges != null && edges.length > slot.maxEdges) {
          edges = [...edges]
            .sort((a, b) => b.confidence - a.confidence)
            .slice(0, slot.maxEdges);
        }
        return { ...s, edges };
      });
      return edge;
    },

    async supersede(edgeId: string, at?: string): Promise<void> {
      const stamp = at ?? new Date().toISOString();
      await ref.updateState((s) => ({
        ...s,
        edges: ((s.edges as Edge[] | undefined) ?? []).map((e) =>
          e.id === edgeId ? { ...e, validUntil: stamp } : e
        ),
      }));
    },

    async remove(edgeId: string): Promise<void> {
      await ref.updateState((s) => ({
        ...s,
        edges: ((s.edges as Edge[] | undefined) ?? []).filter((e) => e.id !== edgeId),
      }));
    },

    all(opts?: { at?: string }): Edge[] {
      return opts?.at !== undefined ? activeAt(readEdges(), opts.at) : readEdges();
    },

    neighbors(node: NodeRef, opts?: TraversalOpts): Edge[] {
      return neighbors(readEdges(), node, opts);
    },

    egoGraph(node: NodeRef, opts?: TraversalOpts): { nodes: NodeRef[]; edges: Edge[] } {
      return egoGraph(readEdges(), node, opts);
    },

    shortestPath(from: NodeRef, to: NodeRef, opts?: TraversalOpts): Edge[] | null {
      return shortestPath(readEdges(), from, to, opts);
    },

    async pruneDangling(knownNodes: Iterable<NodeRef>): Promise<number> {
      const known = new Set(knownNodes);
      let removed = 0;
      await ref.updateState((s) => {
        const edges = (s.edges as Edge[] | undefined) ?? [];
        const kept = edges.filter((e) => known.has(e.from) && known.has(e.to));
        removed = edges.length - kept.length;
        return { ...s, edges: kept };
      });
      return removed;
    },
  };
}
