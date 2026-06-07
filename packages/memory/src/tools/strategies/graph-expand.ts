/**
 * Graph-expanded recall candidate building (FIX-745 read-side).
 *
 * Pure helper, strategy-agnostic. When the relations tier is enabled, a normal
 * recall query can surface facts/edges connected (within a small depth) to
 * entities mentioned in the query — the "graph expands and connects retrieval"
 * pattern. A keyword/intrinsic candidate set alone misses a relation that is
 * relevant only because it links to a named entity; running the ego-graph
 * around matched focal nodes recovers those edges.
 *
 * This is a strict NO-OP when the edge list is empty: no focal nodes match an
 * empty graph, so the disabled/empty path adds zero candidates and pays no
 * per-call cost beyond the (cheap) phrase extraction the caller already gates.
 */

import type { Edge } from '@flow-state-dev/core/graph'
import { egoGraph } from '@flow-state-dev/core/graph'
import { edgeToMemoryItem } from '../types'
import type { MemoryItem } from '../types'
import { extractExactPhrases } from './llm-filter-strategy'

/** Default ego-graph depth for query-driven expansion. */
const DEFAULT_EXPAND_DEPTH = 2

/** Maximum relation candidates appended to the candidate set per recall. */
export const GRAPH_EXPAND_CAP = 10

/** Options for `graphExpandCandidates`. */
export type GraphExpandOptions = {
  /** Max hops for the ego-graph around each matched focal node. Default 2. */
  depth?: number
}

/**
 * Build relation candidates connected to entities named in `query`.
 *
 * Focal nodes are derived from the query: each edge endpoint (a canonical
 * subject string) whose value appears as a whitespace-delimited token in the
 * lowercased query, plus any multi-word edge endpoint that appears verbatim as
 * an extracted exact phrase. The ego graph around each focal node is collected;
 * its edges become relation `MemoryItem`s, excluding any whose id is already in
 * `alreadyIncluded`. Capped at `GRAPH_EXPAND_CAP`.
 *
 * Returns `[]` when `edges` is empty or no endpoint matches the query, so the
 * relations-disabled path is unchanged.
 */
export function graphExpandCandidates(
  edges: Edge[],
  query: string,
  alreadyIncluded: Set<string>,
  opts?: GraphExpandOptions,
): MemoryItem[] {
  if (edges.length === 0) return []

  const depth = opts?.depth ?? DEFAULT_EXPAND_DEPTH
  const lowerQuery = query.toLowerCase()
  const queryTokens = new Set(
    lowerQuery.split(/\s+/).filter((t) => t.length > 0),
  )
  const phrases = extractExactPhrases(query).map((p) => p.toLowerCase())

  // Collect distinct endpoints (the graph's node set) and match against the
  // query. Single-token endpoints match a query token; multi-token endpoints
  // (e.g. "acme corp") must appear as a contiguous phrase or substring.
  const endpoints = new Set<string>()
  for (const e of edges) {
    endpoints.add(e.from)
    endpoints.add(e.to)
  }

  const focalNodes: string[] = []
  for (const node of endpoints) {
    // The generic 'user' subject is on nearly every edge, so matching it would
    // pull the entire user ego-graph for any query containing the word "user".
    // Exclude it from focal-node matching — a real named entity in the query is
    // what should drive expansion. Also require single-token endpoints to be at
    // least 2 chars so stray one-letter tokens can't trigger an expansion.
    if (node === 'user') continue
    const matches = node.includes(' ')
      ? phrases.includes(node) || lowerQuery.includes(node)
      : node.length >= 2 && queryTokens.has(node)
    if (matches) focalNodes.push(node)
  }
  if (focalNodes.length === 0) return []

  // Run the ego graph around each focal node, dedup edges by id, skip any
  // already in the candidate set.
  const seenEdgeIds = new Set<string>()
  const out: MemoryItem[] = []
  for (const node of focalNodes) {
    if (out.length >= GRAPH_EXPAND_CAP) break
    const { edges: egoEdges } = egoGraph(edges, node, { depth })
    for (const edge of egoEdges) {
      if (out.length >= GRAPH_EXPAND_CAP) break
      if (seenEdgeIds.has(edge.id)) continue
      if (alreadyIncluded.has(edge.id)) continue
      seenEdgeIds.add(edge.id)
      out.push(edgeToMemoryItem(edge))
    }
  }
  return out
}
