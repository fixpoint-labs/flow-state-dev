/**
 * The install half of the resources convention — document records become the
 * L1 resource map an app already passes to a flow.
 *
 * Pure, and isomorphic: no `node:fs`, no store, and no registry. It composes
 * `defineResource`, the same function an author calls by hand today, because
 * L1's resource map already is the registry and a second one would be a second
 * place for a document to exist.
 *
 * The map is returned rather than installed. A flow instance's `resources`
 * option *replaces* the definition's map instead of merging with it, so
 * installing on the app's behalf would silently delete whatever resources the
 * flow kind declared. The app spreads the map into its own, visibly, at its own
 * call site.
 */

import { defineResource, type DeclaredResources } from "@flow-state-dev/core";
import { z } from "zod";
import {
  DERIVED_RESOURCE_KEYS,
  refusedDeclarationMessage,
  type ResourceDoc,
} from "./manifest";

/**
 * A document has no state — it is a body the framework stores and the model
 * reads. `defineResource` still requires a state schema, so the convention
 * supplies a permissive empty object and an empty default rather than inventing
 * a shape no file declared.
 */
const DOCUMENT_STATE_SCHEMA = z.object({}).passthrough();

/**
 * Build the resource map from document records, keyed by each document's ref.
 *
 * The accessor key is the ref, so a team's handbook reaches a block as
 * `ctx.resources["teams/engineering/handbook"]`.
 *
 * Throws, rather than collecting, when a record cannot become a resource — a
 * declaration the convention derives, or frontmatter `defineResource` itself
 * rejects. That is startup misconfiguration, and the loader's
 * collect-don't-throw discipline does not extend to it, exactly as
 * `hireWorkforce` throws where `readWorkforceDirectory` collects.
 */
export function resourcesFromDocs(documents: ResourceDoc[]): DeclaredResources {
  const resources: DeclaredResources = {};

  for (const doc of documents) {
    const refused = refusedDeclarationMessage(doc.declared);
    if (refused !== undefined) {
      throw new Error(`Resource "${doc.ref}" ${refused}`);
    }

    try {
      resources[doc.ref] = defineResource({
        // The derived fields come LAST, over a passthrough that cannot carry
        // one. Both halves matter: the strip is what makes a derived field
        // unreachable, and the ordering is what holds if a refusal is ever
        // missed. Spreading the frontmatter after these is the bug this shape
        // exists to prevent — it lets a document point itself at another
        // document's storage row, replace its own body, or hand a YAML string
        // to the engine where a Zod schema belongs.
        ...passthroughFrom(doc.declared),
        ref: doc.ref,
        scope: "org",
        stateSchema: DOCUMENT_STATE_SCHEMA,
        default: {},
        content: doc.body,
      });
    } catch (err) {
      throw new Error(`Resource "${doc.ref}" could not be built: ${(err as Error).message}`);
    }
  }

  return resources;
}

/**
 * The frontmatter a document is allowed to pass through to `defineResource`:
 * everything it wrote, minus every field the convention derives.
 *
 * Exported for its own spec rather than for consumers — this is the guard that
 * holds when the named refusal does not, so it is tested directly instead of
 * through a path the refusal has already closed.
 */
export function passthroughFrom(
  declared: Record<string, unknown>,
): Record<string, unknown> {
  const passthrough: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(declared)) {
    if ((DERIVED_RESOURCE_KEYS as readonly string[]).includes(key)) continue;
    passthrough[key] = value;
  }
  return passthrough;
}
