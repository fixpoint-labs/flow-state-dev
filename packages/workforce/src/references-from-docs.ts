/**
 * The install half of the `references/` convention — reference records become
 * the L1 resource map an app passes to a flow.
 *
 * Pure, and isomorphic, for the reason `./resources-from-docs` is: no
 * `node:fs`, no store, no registry. It composes `defineResource`, and the map
 * is returned rather than installed.
 *
 * **This module is the whole read path.** A reference differs from a document
 * in exactly three installed fields, and the three are one decision:
 *
 * - **`contentFile`** — the file, not a copy of its body. Re-read whenever an
 *   execution context is built, so an edit in git reaches the next request.
 * - **`writable: false` and `llmWritable: false`** — the seal, on both doors.
 * - **`render`** — strips the frontmatter the file carries, so a reader gets
 *   the document rather than the YAML above it.
 *
 * **The seal is load-bearing, not decoration.** A stored content row WINS over
 * `contentFile` exactly as it wins over `content`, so an unsealed `contentFile`
 * is a first-boot seed with a longer name: one write and the file never comes
 * back. Sealed, no row can ever be written, so the file is re-read every time.
 * The two halves ship together or the convention does not hold.
 *
 * **What the seal IS, stated exactly, because a weaker guarantee under a
 * stronger word is the failure this convention exists to prevent.** Three
 * things hold, and a fourth does not:
 *
 * 1. Code that calls `writeContent()` is refused at the engine, by name
 *    (`resource_read_only`).
 * 2. The model is never offered the write tool for it — that tool is gated on
 *    `llmWritable`, so there is no verb to call rather than a call that fails.
 * 3. **Neither key is an author's.** Both are DERIVED here, and a file
 *    declaring either is refused at load ({@link DERIVED_REFERENCE_KEYS}). The
 *    "one forgotten key restores the write" failure needs a key someone can
 *    forget, and after this there is none in the file.
 * 4. **The handle still CARRIES `writeContent`.** It is a runtime refusal, not
 *    an absent verb. `DeclaredResourceEntry` admits only `DefinedResource`, and
 *    `ResourceRef` declares `writeContent` as a required member, so a reference
 *    installed through this door cannot have the method removed from it without
 *    a core change — a read-only single-resource ref alongside today's
 *    `ExternalResourceRef` (which already omits it) plus the registry branch
 *    that builds one. That is additive, out of this module's reach, and NOT
 *    what ships here.
 *
 * So: no reachable write path, and no key to forget. Not an absent verb.
 *
 * **What the seal cannot do is evict a row that is ALREADY there** — a document
 * written while it lived under `resources/` keeps shadowing its file after the
 * move. That is a data migration rather than a file move, and it is
 * `./clear-shadowed-references`.
 *
 * **The promise is per REQUEST, not per read.** `readContent()` reads the
 * in-memory content map built once when the execution context is constructed,
 * so an edit made mid-request is not seen by a read already in flight. That is
 * the shape the substrate offers, and the one this convention promises.
 */

import { defineResource, type DeclaredResources } from "@flow-state-dev/core";
import { splitFrontmatter } from "@flow-state-dev/orchestration";
import { z } from "zod";
import { emptyMap } from "./empty-map";
import {
  DERIVED_REFERENCE_KEYS,
  refusedReferenceDeclarationMessage,
  type ResourceDoc,
} from "./manifest";

/**
 * A reference has no state, exactly as a document has none — it is a body the
 * framework serves and the model reads.
 */
const REFERENCE_STATE_SCHEMA = z.object({}).passthrough();

/** The derived set as a lookup. The array stays ordered for the refusal message. */
const DERIVED_KEYS = new Set<string>(DERIVED_REFERENCE_KEYS);

/**
 * Serve the document, not the file.
 *
 * `contentFile` hands the engine the bytes on disk, frontmatter and all, while
 * a `resources/` document is installed with its parsed body. Without this a
 * reference would read as `---\ndescription: …\n---\n` followed by the
 * handbook, which is a content change nobody asked for and one every prompt
 * would carry.
 *
 * The SAME `splitFrontmatter` the loader parses with, deliberately: a second
 * way of finding where the body starts is a way for the two to disagree about
 * a file with `---` in it.
 *
 * Applied per read, over the string the context already holds — no disk I/O, so
 * a grep across a hundred references costs what it costs today.
 */
export function referenceBody(raw: string): string {
  return splitFrontmatter(raw).body;
}

/**
 * The wording for a reference record with no file to read.
 *
 * Fatal rather than empty: a reference IS its file, so a record without one
 * would install a resource whose content is permanently `null` — a handbook
 * that loads, resolves, reads blank, and reports nothing.
 */
const referenceWithoutFileMessage = (ref: string): string =>
  `Reference "${ref}" carries no file path. A reference is served FROM its file, so a ` +
  `hand-built record needs \`filePath\` set to the document's absolute path — ` +
  `\`readReferencesDirectory\` fills it in for a record read off disk.`;

/**
 * Build the resource map from reference records, keyed by each one's ref.
 *
 * The accessor key is the ref, so a team's handbook reaches a block as
 * `ctx.resources["teams/engineering/handbook"]` — the same namespace a
 * `resources/` document lands in, which is what makes a basename claimed by
 * both refusable rather than silently resolved.
 *
 * **The installing flow has to require an org**, the same way and for the same
 * reason `resourcesFromDocs`'s does: every entry here is org-scoped, and a flow
 * that declares no `requireOrg` builds no org resource registry, so every
 * reference resolves as unregistered.
 *
 * Throws rather than collecting, matching the mutable install half: a reference
 * that cannot become a resource is startup misconfiguration.
 *
 * @param references Records from `readReferencesDirectory`, or hand-built ones
 *   carrying an absolute {@link ResourceDoc.filePath}.
 * @returns The L1 map, keyed by ref.
 * @throws If a record declares a derived setting, carries no file path, or
 *   `defineResource` rejects its frontmatter.
 */
export function referencesFromDocs(references: ResourceDoc[]): DeclaredResources {
  const resources: DeclaredResources = emptyMap();

  for (const doc of references) {
    const refused = refusedReferenceDeclarationMessage(doc.declared);
    if (refused !== undefined) {
      throw new Error(`Reference "${doc.ref}" ${refused}`);
    }

    const filePath = doc.filePath;
    if (typeof filePath !== "string" || filePath.trim().length === 0) {
      throw new Error(referenceWithoutFileMessage(doc.ref));
    }

    try {
      resources[doc.ref] = defineResource({
        // The derived fields come LAST, over a passthrough that cannot carry
        // one — the ordering `resourcesFromDocs` uses, and here it is guarding
        // a permission rather than a storage row: spreading frontmatter after
        // these would let a file hand itself `writable: true` back.
        ...passthroughForReference(doc.declared),
        ref: doc.ref,
        scope: "org",
        stateSchema: REFERENCE_STATE_SCHEMA,
        default: {},
        contentFile: filePath,
        // Both doors, and both DERIVED — the module header states exactly what
        // that guarantees and what it does not. `writable` refuses code at the
        // engine; `llmWritable` keeps the model's write tool from being offered
        // at all. Neither is a key any file can set.
        writable: false,
        llmWritable: false,
        render: referenceBody,
      });
    } catch (err) {
      throw new Error(`Reference "${doc.ref}" could not be built: ${(err as Error).message}`);
    }
  }

  return resources;
}

/**
 * The frontmatter a reference may pass through to `defineResource`: everything
 * it wrote, minus every field the references convention derives.
 *
 * A second copy of `passthroughFrom`'s shape rather than a shared one, because
 * the two strip DIFFERENT sets and a shared helper taking the set as an
 * argument would read as though the sets were interchangeable. Exported for its
 * own spec: this is the guard that holds when the named refusal does not.
 */
export function passthroughForReference(
  declared: Record<string, unknown>,
): Record<string, unknown> {
  const passthrough = emptyMap<unknown>();
  for (const [key, value] of Object.entries(declared)) {
    if (DERIVED_KEYS.has(key)) continue;
    passthrough[key] = value;
  }
  return passthrough;
}
