// ---------------------------------------------------------------------------
// importOkf — hydrate an on-disk OKF bundle into a concept collection.
//
// Two passes over the parsed bundle. First, every concept becomes an instance
// (frontmatter -> state, body -> content). Then, with the full set of concept
// IDs known, each concept's links become typed edges (default type
// `"references"`, since OKF links are untyped — SPEC §5.3) resolved through the
// ID index; a link to an absent concept is a warning, not a failure (SPEC §9).
// Edges are stored on the source instance, so the second pass needs the refs
// the first pass created.
// ---------------------------------------------------------------------------

import type { ResourceCollectionRef, ResourceRef } from "@flow-state-dev/core/types";
import { getPatternPrefix } from "@flow-state-dev/core/types";
import { parseOkfBundle } from "./parse";
import { DEFAULT_EDGE_TYPE } from "./types";
import { frontmatterToState, conceptIdFromPath, type ConceptState } from "../concepts";

/** Outcome of an import: how many concepts landed, and any best-effort warnings. */
export interface ImportResult {
  imported: number;
  warnings: string[];
}

/**
 * Import the OKF bundle at `dir` into `collection`, SYNCING the collection to
 * the bundle: instances at incoming keys are replaced, and instances NOT present
 * in the bundle are pruned — so after a mount the collection mirrors the bundle
 * exactly (a re-mount of a different bundle does not leave stragglers, and a
 * subsequent export matches the mounted bundle). Returns the count imported and
 * the accumulated warnings (missing `type`, dangling links, unreadable/unparseable
 * concepts). Best-effort: a partial bundle imports the concepts it can.
 */
export async function importOkf(
  dir: string,
  collection: ResourceCollectionRef<ConceptState>,
): Promise<ImportResult> {
  const { concepts, warnings } = await parseOkfBundle(dir);
  const ids = new Set(concepts.map((c) => c.id));

  // Prune concepts absent from the incoming bundle (mount = sync, not merge).
  const prefix = getPatternPrefix(collection.pattern);
  for (const existing of await collection.list()) {
    const existingId = conceptIdFromPath(existing.path, prefix);
    if (!ids.has(existingId)) await collection.delete(existingId);
  }

  // Pass 1: state + content.
  const refs = new Map<string, ResourceRef<ConceptState>>();
  for (const concept of concepts) {
    const state = frontmatterToState(concept.frontmatter, concept.id, warnings);
    const ref = await collection.create(concept.id, state, { replace: true });
    await ref.writeContent(concept.body);
    refs.set(concept.id, ref);
  }

  // Pass 2: links -> typed edges, resolved through the ID index.
  for (const concept of concepts) {
    const ref = refs.get(concept.id);
    if (ref?.edges === undefined) continue;
    for (const target of concept.links) {
      if (!ids.has(target)) {
        warnings.push(`${concept.id}: dangling link to "${target}" (no such concept); edge skipped`);
        continue;
      }
      await ref.edges.add({ from: concept.id, to: target, type: DEFAULT_EDGE_TYPE });
    }
  }

  return { imported: concepts.length, warnings };
}
