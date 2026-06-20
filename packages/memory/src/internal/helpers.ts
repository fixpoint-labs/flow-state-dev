/**
 * Internal helpers for the memory module.
 *
 * Text-matching helpers (shortId, tokenize, tokenOverlap, findBestOverlap)
 * live in @flow-state-dev/core/helpers — import from there.
 */

import type { ResourceEdgeApi } from '@flow-state-dev/core/graph'

/**
 * Canonicalize a subject / edge-endpoint name to its storage form: trimmed and
 * lowercased. The single source of truth for the canonicalization the write
 * path, the connect tool, and the relation helpers all apply so endpoints line
 * up with stored fact subjects.
 */
export function canonicalizeSubject(s: string): string {
  return s.trim().toLowerCase()
}

/**
 * Read the relations edge API off a block context's semantic-memory resource.
 * Returns `undefined` when the relations tier is disabled (no edge slot was
 * installed) so callers degrade to safe empties. Centralizes the otherwise
 * repeated untyped cast through `ctx.resources.semanticMemory.edges`.
 */
export function edgesOf(ctx: any): ResourceEdgeApi | undefined {
  return (ctx.resources?.semanticMemory as { edges?: ResourceEdgeApi } | undefined)?.edges
}
