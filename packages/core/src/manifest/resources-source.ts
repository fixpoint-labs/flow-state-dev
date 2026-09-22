/**
 * The resources manifest source (FIX-817) — the resources domain's projection
 * into the discovery door.
 *
 * Built over the readers that already ship. `collectReadableResources` is
 * unchanged and still the gate: a collection that did not opt into
 * `llmReadable` is skipped BEFORE it is listed, so a lazy or broken collection
 * is never bulk-loaded just to discover it was never allowed.
 *
 * That helper reaches static resources and store-backed collections only —
 * `collectCollections` classifies projected refs out by their `projected` brand.
 * A projected collection that IS readable is in scope for the agent,
 * so it is reached separately; a manifest that lies by omission is worse than
 * no manifest. Projected collections are read-through and paged by design, so
 * they project as ONE entry for the collection rather than a row per instance:
 * enumerating them to build a catalog is the thing their laziness exists to
 * avoid, and the agent reaches their rows through search.
 */

import type { ManifestEntry } from "@flow-state-dev/contracts";
import type { BlockContext } from "../types/block";
import type { ResourceRef } from "../types/resource";
import { collectReadableProjectedCollections, collectReadableResources } from "../tools/resource-tools";
import type { BlockManifestSource } from "./registry";

/**
 * What an agent chooses on. A resource that declared a description in its
 * `metadata` says what it is for in its author's words; otherwise the entry
 * falls back to its address, which is all the declaration actually carries.
 */
function purposeOf(ref: ResourceRef<any>): string {
  const described = ref.config?.metadata?.description;
  if (typeof described === "string" && described.trim() !== "") return described.trim();
  return `Readable resource at ${ref.path}`;
}

/**
 * How the agent may work with this resource — the deeper half of an entry.
 *
 * Writes are advertised only when BOTH gates open: `llmWritable` (the agent is
 * permitted to ask) and `writable` (the store will accept it — default `true`,
 * enforced in the engine's resource registry, which throws `resource_read_only`
 * when it is `false`). Either one alone is a half-truth, and a contract that
 * promises an operation which always throws is worse than no contract: an
 * orchestrator plans confidently and wrongly, which is the failure this door
 * exists to remove. Collection instances carry their collection's config, so
 * the collection-level `writable` is read through this same expression.
 */
function contractOf(ref: ResourceRef<any>): string {
  const mayWrite = ref.config?.llmWritable === true && ref.config?.writable !== false;
  return `Reachable by uri "${ref.uri}"; you may ${mayWrite ? "read and write" : "read"} its content.`;
}

/**
 * The resources domain, projected on demand from `collectReadableResources`
 * plus the readable projected collections that helper does not reach.
 */
export function resourcesManifestSource(): BlockManifestSource {
  return {
    domain: "resources",
    origin: "resourcesManifestSource (@flow-state-dev/core)",
    entries: async (ctx: BlockContext): Promise<ManifestEntry[]> => {
      const entries: ManifestEntry[] = [];

      for (const ref of await collectReadableResources(ctx)) {
        entries.push({
          id: ref.uri,
          kind: "resource",
          purpose: purposeOf(ref),
          contract: contractOf(ref),
        });
      }

      for (const ns of collectReadableProjectedCollections(ctx)) {
        entries.push({
          id: `${ns.scope}/${ns.name}`,
          kind: "collection",
          purpose: `Readable collection of resources under ${ns.name}`,
          contract: "Search it to get uris, then read those uris. Not enumerable up front.",
        });
      }

      return entries;
    },
  };
}
