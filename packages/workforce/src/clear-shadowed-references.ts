/**
 * The `references/` migration — find and clear the stored rows that shadow a
 * reference's file, for a document that was written while it still lived under
 * `resources/`.
 *
 * **Why this is work and not a note.** Moving a file from `resources/` to
 * `references/` changes how it is served: the install half points the resource
 * at the file and seals it, so nothing can write it again. What the seal cannot
 * do is evict a row that is ALREADY there. A stored content row wins over
 * `contentFile` exactly as it wins over `content`, so a handbook that anything
 * wrote once — a block, an HTTP content PUT, an agent with the write tool —
 * keeps serving that write after the move. Forever, silently, with the file in
 * git looking authoritative and being read by nobody.
 *
 * So for a tree that has ever been written to, `git mv` does not make the
 * promise true. This does.
 *
 * **The old shape is tolerated, not assumed away** (BP-030). A row may be
 * there or may not; both are ordinary. What this refuses to do is leave a
 * present one in place and say nothing — the whole point is that the outcome
 * is reported rather than silent, so a deploy log says which handbooks were
 * unshadowed and what they had been serving.
 *
 * **Run it once per org, after the move, before or at boot.** It is idempotent:
 * a second run over a migrated tree finds nothing and clears nothing, because
 * the seal means no new row can appear.
 *
 * Isomorphic by construction — it takes the store it writes through rather than
 * reaching for one, so this module has no `node:fs` and no engine import.
 */

import type { DeclaredResources } from "@flow-state-dev/core";

/**
 * The slice of the engine's `ContentStore` this needs: read one row, delete one
 * row.
 *
 * Declared structurally rather than imported, so `workforce` does not take a
 * dependency on `engine` for two method signatures. Any `ContentStore`
 * satisfies it — `stores.content` is passed straight in.
 */
export interface ReferenceContentStore {
  /** Read a single resource's stored content, or `undefined` when there is none. */
  get(scopeType: "org", scopeId: string, resourceKey: string): Promise<string | undefined>;
  /** Delete a single resource's stored content. */
  delete(scopeType: "org", scopeId: string, resourceKey: string): Promise<void>;
}

/** One reference that had a stored row shadowing its file. */
export interface ShadowedReference {
  /** The reference's ref, which is also its storage key. */
  ref: string;
  /**
   * What the stored row was serving instead of the file.
   *
   * Carried so the caller can log it, diff it, or keep it: this is the only
   * moment the written body still exists anywhere, and a migration that
   * discards it without showing it is a migration that loses an edit somebody
   * made on purpose. Truncation is the caller's call, not this function's.
   */
  shadowedContent: string;
}

/** What {@link clearShadowedReferences} found and did. */
export interface ClearShadowedReferencesResult {
  /**
   * Every reference whose row was cleared, in catalog order.
   *
   * **Empty is the ordinary answer** — a tree that was never written to, or one
   * already migrated. Non-empty is the finding: each entry is a file that was
   * being ignored in favour of a stored write.
   */
  cleared: ShadowedReference[];
  /**
   * Every reference that was checked. `cleared.length` out of
   * `checked.length` is the line worth logging, because "cleared 0" and
   * "checked nothing" are the two outcomes a silent migration confuses.
   */
  checked: string[];
}

/**
 * Clear every stored content row shadowing a reference's file, for one org.
 *
 * @param input.references The app's references, keyed by ref — the map
 *   `referencesFromDocs` returns. Only these keys are touched; a `resources/`
 *   document's row is never read and never deleted.
 * @param input.orgId The org whose rows to check. References are org-scoped, so
 *   this is the scope id their rows are stored under.
 * @param input.content The engine's content store — `stores.content`.
 * @param input.dryRun When `true`, report what WOULD be cleared and delete
 *   nothing. For a first run against a tree nobody wants to surprise.
 * @returns What was checked and what was cleared. Nothing is thrown for an
 *   absent row; that is the ordinary case.
 */
export async function clearShadowedReferences(input: {
  references: DeclaredResources;
  orgId: string;
  content: ReferenceContentStore;
  dryRun?: boolean;
}): Promise<ClearShadowedReferencesResult> {
  const { references, orgId, content, dryRun = false } = input;

  const cleared: ShadowedReference[] = [];
  const checked: string[] = [];

  for (const ref of Object.keys(references)) {
    checked.push(ref);
    // The ref IS the storage key for a file-declared document: `resourcesFromDocs`
    // and `referencesFromDocs` both pass it as `ref`, and the registry keys
    // content by it.
    const shadowedContent = await content.get("org", orgId, ref);
    // `undefined` is no row. An empty STRING is a row — something wrote a blank
    // body — and it shadows the file just as completely, so it is cleared too.
    // `== null` rather than a falsy check, for exactly that reason.
    if (shadowedContent == null) continue;

    cleared.push({ ref, shadowedContent });
    if (!dryRun) await content.delete("org", orgId, ref);
  }

  return { cleared, checked };
}

/**
 * The migration's result as one line for a deploy log.
 *
 * Exported so the sentence is the same wherever it is printed, and because the
 * caller that most needs it is a boot script that should not have to invent
 * one. Bodies are not included — they can be a whole handbook; the result
 * carries them for a caller that wants them.
 */
export function describeShadowedReferences(result: ClearShadowedReferencesResult): string {
  if (result.checked.length === 0) return "references: none declared, nothing to migrate";
  if (result.cleared.length === 0) {
    return `references: ${result.checked.length} checked, none shadowed — every file is the source`;
  }
  return (
    `references: ${result.cleared.length} of ${result.checked.length} were shadowed by a ` +
    `stored write and have been cleared — ${result.cleared.map((r) => r.ref).join(", ")}. ` +
    `Each now serves its file again.`
  );
}
