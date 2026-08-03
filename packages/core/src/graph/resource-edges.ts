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
import { updateStateWith } from "../helpers/update-state-with";

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
 * Cull an over-cap edge list down to `maxEdges`, preserving the live graph.
 *
 * Policy (in order):
 *  1. Drop superseded edges (`validUntil !== null`) first, oldest `createdAt`
 *     first, only as many as needed to reach `maxEdges`. Superseded edges are
 *     tombstones — keeping them while evicting an active edge would let a
 *     bounded graph fill with closed history and starve out live relations.
 *  2. If still over cap after all superseded edges are gone, cull active edges
 *     by lowest `confidence` first; ties broken by oldest `createdAt` first
 *     (older edges go before newer ones). The newest/highest-confidence edges
 *     are kept.
 *
 * `protectId` (when given) is never dropped — `add()` passes the edge it just
 * created so a freshly-added edge is always persisted, even when it is the
 * lowest-value edge in a saturated graph. This keeps `add()`'s "returns the
 * stored edge" contract honest: the returned id always exists in state, so a
 * follow-up `supersede(id)` / `remove(id)` resolves.
 *
 * Returns a new array; preserves the relative order of the survivors as they
 * appeared in `edges`.
 */
function cullToMax(edges: Edge[], maxEdges: number, protectId?: string): Edge[] {
  let overflow = edges.length - maxEdges;
  if (overflow <= 0) return edges;

  const dropIds = new Set<string>();

  // Phase 1: drop oldest superseded edges first (never the protected edge).
  const superseded = edges
    .filter((e) => e.validUntil !== null && e.id !== protectId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const e of superseded) {
    if (overflow <= 0) break;
    dropIds.add(e.id);
    overflow--;
  }

  // Phase 2: still over cap — cull active edges by lowest confidence, then
  // oldest createdAt. Sort the cull candidates worst-first and drop the head.
  // The protected edge is excluded so the just-added edge always survives.
  if (overflow > 0) {
    const active = edges
      .filter((e) => e.validUntil === null && e.id !== protectId)
      .sort((a, b) =>
        a.confidence !== b.confidence
          ? a.confidence - b.confidence
          : a.createdAt.localeCompare(b.createdAt),
      );
    for (const e of active) {
      if (overflow <= 0) break;
      dropIds.add(e.id);
      overflow--;
    }
  }

  return edges.filter((e) => !dropIds.has(e.id));
}

/**
 * Build the `.edges` API over a resource ref. `slot` is the resolved
 * EdgeSlotConfig (`{}` when declared as `true`). Read methods operate
 * synchronously on the current `ref.state.edges`; mutators persist via
 * `ref.updateState`.
 */
export function createResourceEdgeApi(ref: EdgeBackingRef, slot: EdgeSlotConfig): ResourceEdgeApi {
  // Fail loud on misconfiguration. `defineResource` / `defineResourceCollection`
  // inject an `edges` array into the state schema + default when `edges` is
  // declared, so a correctly-configured resource always has one here. If it is
  // missing, the state schema lacks an `edges` field and Zod would silently
  // strip every edge write on persist — surface that at construction instead.
  if (!Array.isArray(ref.state.edges)) {
    throw new Error(
      "createResourceEdgeApi: resource state has no `edges` array — the state schema is missing the framework-injected field. Declare edges via defineResource/defineResourceCollection so the field is injected.",
    );
  }
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
          // Protect the just-added edge so it is never the one culled — `add`
          // must persist what it returns.
          edges = cullToMax(edges, slot.maxEdges, edge.id);
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
      return (
        (await updateStateWith(ref, (s) => {
          const edges = (s.edges as Edge[] | undefined) ?? [];
          const kept = edges.filter((e) => known.has(e.from) && known.has(e.to));
          return { state: { ...s, edges: kept }, result: edges.length - kept.length };
        })) ?? 0
      );
    },
  };
}
