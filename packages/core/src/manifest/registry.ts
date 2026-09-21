/**
 * The manifest-source registry (FIX-817) — what a scope carries, and the one
 * place a source is registered.
 *
 * A registry is built once from the sources a scope declares. That declaration
 * IS the fence: the door is built over a registry and can only ever answer for
 * a domain the registry holds, so a caller naming something out of scope
 * cannot reach it. The gate lives here rather than in the tool, because the
 * tool's `domain` argument is model-supplied (BP-031) — a tool that filtered a
 * wider list would be one bug away from answering with it.
 *
 * Registration is construction. Two sources claiming one domain are refused
 * here, where both sites are named, rather than at the first ambiguous read.
 */

import type { ManifestDomain, ManifestSource } from "@flow-state-dev/contracts";
import { MANIFEST_DOMAINS } from "@flow-state-dev/contracts";
import type { BlockContext } from "../types/block";

/** A manifest source bound to the block context its `entries` reads. */
export type BlockManifestSource = ManifestSource<BlockContext>;

/**
 * The sources one scope carries. Immutable — everything it holds was named at
 * construction, so "what is in scope" is a fact about the declaration site and
 * not about call order.
 */
export type ManifestRegistry = {
  /** Domains this scope carries, in the canonical domain order. */
  domains(): ManifestDomain[];
  /**
   * This scope's source for `domain`, or `undefined` when it carries none.
   * An absent source is an ordinary state, not an error: a workforce with no
   * channels registered yet simply has nothing to say about channels.
   */
  source(domain: ManifestDomain): BlockManifestSource | undefined;
};

/** How a source names itself in a duplicate-registration error. */
function siteOf(source: BlockManifestSource): string {
  return source.origin ?? "an unnamed registration site";
}

/**
 * Build the registry for one scope from the sources it declares.
 *
 * @throws when two sources claim the same domain, naming both sites.
 */
export function createManifestRegistry(sources: readonly BlockManifestSource[]): ManifestRegistry {
  const byDomain = new Map<ManifestDomain, BlockManifestSource>();

  for (const source of sources) {
    const existing = byDomain.get(source.domain);
    if (existing !== undefined) {
      throw new Error(
        `createManifestRegistry: two sources registered the domain "${source.domain}" — ` +
          `${siteOf(existing)} and ${siteOf(source)}. A domain has exactly one source; ` +
          `drop one of the two registrations.`,
      );
    }
    byDomain.set(source.domain, source);
  }

  return {
    domains: () => MANIFEST_DOMAINS.filter((domain) => byDomain.has(domain)),
    source: (domain) => byDomain.get(domain),
  };
}
