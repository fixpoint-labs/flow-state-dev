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
 * the repository looking authoritative and being read by nobody.
 *
 * So for a tree that has ever been written to, moving the file does not make
 * the promise true. This does.
 *
 * **The old shape is tolerated, not assumed away** (BP-030). A row may be there
 * or may not; both are ordinary. What this refuses to do is leave a present one
 * in place and say nothing.
 *
 * <a name="coordinate"></a>
 * ## Addressing the row, and where this REFUSES rather than guesses
 *
 * A row is addressed by `(scopeType, scopeId, resourceKey)`. For a reference,
 * `scopeType` is `"org"` and `resourceKey` is its ref — but `scopeId` is NOT
 * simply the org id, and getting that wrong is the one failure mode worse than
 * having no migration at all: the lookup finds nothing, the run reports
 * "nothing to clear", and the stale body keeps winning.
 *
 * Two things decide it, and this module handles both explicitly.
 *
 * **Isolation.** A resource whose scope is isolated stores under
 * `<orgId>:<flowId>` rather than under the org id alone. A reference can never
 * be isolated by its own frontmatter — `flowIsolation` is a derived key and a
 * file declaring it is refused — but the installing FLOW can isolate the whole
 * org scope, and then every resource on it is isolated. That is why
 * {@link ReferenceInstallFlow.isolatesOrgState} is required rather than
 * defaulted: a default would be a guess, and a wrong guess is silent.
 *
 * **Escaping.** The engine escapes `:` and `\` in each component before joining
 * them, so a bucket for an org id containing either is not the string this
 * module would build. That escape is private to the engine, and duplicating it
 * here would put one fact in two places — the exact drift this package's
 * conventions exist to prevent. So instead of guessing, this **throws**, naming
 * the id and why. Loud beats silently addressing the wrong cell.
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
 * runtime dependency on `engine` for two method signatures. Any `ContentStore`
 * satisfies it — `stores.content` is passed straight in.
 */
export interface ReferenceContentStore {
  /** Read a single resource's stored content, or `undefined` when there is none. */
  get(scopeType: "org", scopeId: string, resourceKey: string): Promise<string | undefined>;
  /** Delete a single resource's stored content. */
  delete(scopeType: "org", scopeId: string, resourceKey: string): Promise<void>;
}

/** The flow the references are installed on, as the storage coordinate needs it. */
export interface ReferenceInstallFlow {
  /** The flow instance's id — half the bucket when the org scope is isolated. */
  id: string;
  /**
   * Whether that flow isolates its org scope (`isolateOrgState`).
   *
   * Required, not optional. A reference inherits the flow's org isolation, and
   * the two settings address different buckets — so a default here would be a
   * guess that reports success while looking in the wrong place.
   */
  isolatesOrgState: boolean;
}

/** Everything {@link clearShadowedReferences} needs. */
export interface ClearShadowedReferencesInput {
  /**
   * The app's references, keyed by ref — the map `referencesFromDocs` returns.
   * Only these keys are touched; a `resources/` document's row is never read
   * and never deleted.
   */
  references: DeclaredResources;
  /** The org whose rows to check. */
  orgId: string;
  /** The engine's content store — `stores.content`. */
  content: ReferenceContentStore;
  /** The flow the references were installed on. See [the coordinate](#coordinate). */
  installedOn: ReferenceInstallFlow;
  /** Report what WOULD be cleared and delete nothing. */
  dryRun?: boolean;
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
   * Every reference whose row was cleared — or WOULD be, when
   * {@link ClearShadowedReferencesResult.dryRun} is true.
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
  /**
   * Whether this was a preview.
   *
   * **On the result, not only in the caller's memory**, because
   * {@link describeShadowedReferences} reads it. A preview that prints "have
   * been cleared" is worse than no preview: an operator reads a completed
   * migration, moves on, and leaves the stale content live.
   */
  dryRun: boolean;
  /** The bucket the rows were addressed in, for a log that has to be believed. */
  scopeId: string;
}

/**
 * The bucket a reference's content row lives in.
 *
 * Mirrors the engine's `resolveResourceScopeId` for the cases this module
 * accepts, and **throws for the case it cannot mirror**: the engine escapes `:`
 * and `\` per component with a function it does not export, so an id carrying
 * either would key somewhere this cannot name. See [the coordinate](#coordinate).
 */
function referenceScopeId(orgId: string, installedOn: ReferenceInstallFlow): string {
  const needsEscaping = (value: string): boolean => /[\\:]/.test(value);
  const offending = [
    ...(needsEscaping(orgId) ? [`orgId "${orgId}"`] : []),
    ...(installedOn.isolatesOrgState && needsEscaping(installedOn.id)
      ? [`flow id "${installedOn.id}"`]
      : []),
  ];
  if (offending.length > 0) {
    throw new Error(
      `Cannot address this org's reference rows: ${offending.join(" and ")} contains ":" or a ` +
        `backslash, which the engine escapes when it builds a storage bucket — with a rule this ` +
        `package cannot reproduce without keeping a second copy of it. Refusing rather than ` +
        `reading the wrong cell and reporting nothing to clear. Clear these rows with the ` +
        `engine's own store helpers, or migrate this org by hand.`,
    );
  }
  return installedOn.isolatesOrgState ? `${orgId}:${installedOn.id}` : orgId;
}

/**
 * Clear every stored content row shadowing a reference's file, for one org.
 *
 * Idempotent: a second run over a migrated tree finds nothing and clears
 * nothing, because the seal means no new row can appear.
 *
 * @param input The references, the org, the store, and the flow they are
 *   installed on. See {@link ClearShadowedReferencesInput}.
 * @returns What was checked, what was cleared, and whether it was a preview.
 *   Nothing is thrown for an absent row; that is the ordinary case.
 * @throws If the org or flow id needs the engine's bucket escaping — see
 *   [the coordinate](#coordinate).
 */
export async function clearShadowedReferences(
  input: ClearShadowedReferencesInput,
): Promise<ClearShadowedReferencesResult> {
  const { references, orgId, content, installedOn, dryRun = false } = input;

  const scopeId = referenceScopeId(orgId, installedOn);
  const cleared: ShadowedReference[] = [];
  const checked: string[] = [];

  for (const ref of Object.keys(references)) {
    checked.push(ref);
    // The ref IS the storage key for a file-declared document: both install
    // halves pass it as `ref`, and the registry keys content by it.
    const shadowedContent = await content.get("org", scopeId, ref);
    // `undefined` is no row. An empty STRING is a row — something wrote a blank
    // body — and it shadows the file just as completely, so it is cleared too.
    // `== null` rather than a falsy check, for exactly that reason.
    if (shadowedContent == null) continue;

    cleared.push({ ref, shadowedContent });
    if (!dryRun) await content.delete("org", scopeId, ref);
  }

  return { cleared, checked, dryRun, scopeId };
}

/**
 * The migration's result as one line for a deploy log.
 *
 * Exported so the sentence is the same wherever it is printed, and because the
 * caller that most needs it is a boot script that should not have to invent
 * one. Bodies are not included — they can be a whole handbook; the result
 * carries them for a caller that wants them.
 *
 * A preview says **would**, and says it is a preview. That is the whole reason
 * `dryRun` is on the result rather than only in the caller's memory.
 */
export function describeShadowedReferences(result: ClearShadowedReferencesResult): string {
  if (result.checked.length === 0) return "references: none declared, nothing to migrate";

  if (result.cleared.length === 0) {
    return result.dryRun
      ? `references: dry run — ${result.checked.length} checked, none shadowed. Nothing to do`
      : `references: ${result.checked.length} checked, none shadowed — every file is the source`;
  }

  const refs = result.cleared.map((r) => r.ref).join(", ");
  return result.dryRun
    ? `references: dry run — ${result.cleared.length} of ${result.checked.length} are shadowed ` +
      `by a stored write and WOULD be cleared: ${refs}. Nothing has been changed; re-run ` +
      `without dryRun to clear them`
    : `references: ${result.cleared.length} of ${result.checked.length} were shadowed by a ` +
      `stored write and have been cleared — ${refs}. Each now serves its file again.`;
}
