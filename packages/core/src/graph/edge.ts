/**
 * Reusable typed-edge data model for `@flow-state-dev/core`.
 *
 * Defines the pure, dependency-free building blocks for a directed,
 * typed, bi-temporal knowledge graph: node references and the `Edge`
 * schema. This module has no dependency on any store, the memory
 * package, or the runtime — it is the shared data contract that
 * traversal (`./traverse`) and consumers build on.
 */

import { z } from "zod";

/** A node identifier. Bare string; convention is "<namespace>:<key>" for cross-resource edges. */
export type NodeRef = string;

/** Build a namespaced node ref. Lowercases the key for canonicalisation. e.g. nodeRef("ticker","NVDA") -> "ticker:nvda". */
export function nodeRef(namespace: string, key: string): NodeRef {
  return `${namespace}:${key.toLowerCase()}`;
}

/** Split a namespaced ref. "ticker:nvda" -> { namespace: "ticker", key: "nvda" }; "user" -> { key: "user" } (namespace undefined). Only the FIRST colon splits (keys may contain colons). */
export function parseNodeRef(ref: NodeRef): { namespace?: string; key: string } {
  const idx = ref.indexOf(":");
  if (idx === -1) return { key: ref };
  return { namespace: ref.slice(0, idx), key: ref.slice(idx + 1) };
}

/**
 * A directed, typed, bi-temporal edge between two nodes.
 *
 * Bi-temporal: `validFrom`/`validUntil` describe when the relation holds in
 * the modelled world (null = open-ended / currently valid), independent of
 * `createdAt` (when the edge was recorded).
 */
export const edgeSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  type: z.string(), // relation type, active voice ("drives")
  confidence: z.number().min(0).max(1).default(1),
  validFrom: z.string().datetime().nullable().default(null),
  validUntil: z.string().datetime().nullable().default(null), // null = currently valid
  source: z.array(z.string()).default([]), // provenance ids (e.g. episode ids)
  createdAt: z.string().datetime(),
});

/** A directed, typed, bi-temporal edge between two nodes. */
export type Edge = z.infer<typeof edgeSchema>;

/** A list of edges. */
export const edgeListSchema = z.array(edgeSchema);
