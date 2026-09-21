/**
 * What ONE seat's own file narrows the discovery door to.
 *
 * The same contract `seat-capabilities.ts` establishes for `capabilities:`,
 * applied to a second surface — with the arrow reversed, because the two keys
 * answer opposite questions. `capabilities:` names presets a seat wants ON, so
 * it ADDS. `discover:` names the domains a seat wants to SEE, so it SUBTRACTS:
 * the list is what crosses, and everything else the scope carries is withheld.
 *
 * Either way the invariant is the one that matters: **a seat may not widen its
 * own reach.** A domain the scope does not carry is not added by a file naming
 * it, and there is nothing to filter past — the narrowing is an intersection
 * over the registry the app built, so a name the registry never held reaches no
 * source at all (BR-11).
 *
 * That is also why the narrowing happens HERE, on the registry, and not inside
 * the door. The door's `domain` argument is model-supplied; if the tool held
 * the wider list and filtered, a seat naming something out of scope would be
 * one bug away from reaching it (BP-031). A narrowed registry has nothing
 * wider behind it.
 *
 * **This is not a second install door.** Which capability and resource modules
 * an app *has* is settled at author and boot time through `uses` and presets;
 * this key only picks from what an already-installed door answers for.
 */

import { createManifestRegistry, isManifestDomain } from "@flow-state-dev/core";
import type { ManifestDomain, ManifestRegistry } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";

/**
 * The worker-file key, pinned.
 *
 * Authored by a human in `WORKER.md`; renaming it later breaks files already
 * on disk.
 */
export const SEAT_DISCOVER_KEY = "discover";

/**
 * The domains this seat's file named, or `undefined` when it named none.
 *
 * `undefined` and `[]` are different answers and both are legal: a file with no
 * `discover:` key sees every domain its scope carries (BR-10), and a file
 * naming an empty list has asked to see none.
 *
 * Read defensively off an erased config bag — this runs on a block whose
 * settings shape the capability cannot see, and a flow that declares no such
 * setting is the common case rather than an error.
 */
export function seatDiscoverSelection(ctx: BlockContext): ManifestDomain[] | undefined {
  const declared = (ctx.flow?.config as Record<string, unknown> | undefined)?.[
    SEAT_DISCOVER_KEY
  ];
  if (!Array.isArray(declared)) return undefined;
  return declared.filter(
    (entry): entry is ManifestDomain => typeof entry === "string" && isManifestDomain(entry),
  );
}

/**
 * The registry this seat reads through: the scope's, intersected with what its
 * file named.
 *
 * Returns the scope's own registry untouched when the seat named nothing, so a
 * zero-configuration seat costs no rebuild and reads exactly what the app
 * installed.
 *
 * @param registry The scope's registry — the fence, built where the app
 *   declared its sources.
 * @param selection What this seat's file named, from {@link seatDiscoverSelection}.
 * @returns A registry carrying at most what both agree on.
 */
export function narrowToSeatSelection(
  registry: ManifestRegistry,
  selection: readonly ManifestDomain[] | undefined,
): ManifestRegistry {
  if (selection === undefined) return registry;
  const named = new Set(selection);
  return createManifestRegistry(
    registry
      .domains()
      .filter((domain) => named.has(domain))
      .map((domain) => registry.source(domain)!),
  );
}
