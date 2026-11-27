/**
 * One resource's entry in a session snapshot, found by its key across the
 * snapshot's scopes (session first, then user, then org). A collection's entry
 * carries `count` and/or `prefetched`; a single resource's carries
 * `clientData`/`content`. `kind` says which to find, so a single resource and
 * a collection under one key never answer for each other. Shared by
 * `useResource` and `useResourceContent`. Not exported from the package.
 */
import type { ResourceSnapshotEntry } from "@flow-state-dev/client";

type SnapshotResources = Partial<Record<"session" | "user" | "org", Record<string, unknown> | undefined>>;

/** The snapshot entry for `ref`, or `undefined` when the snapshot has none of that kind. */
export function findSnapshotResource(
  resources: SnapshotResources | undefined,
  ref: string,
  kind: "single" | "collection"
): (ResourceSnapshotEntry & { count?: unknown; prefetched?: unknown }) | undefined {
  if (!resources) return undefined;
  for (const scope of ["session", "user", "org"] as const) {
    const scopeResources = resources[scope];
    if (!scopeResources || !(ref in scopeResources)) continue;
    const candidate = scopeResources[ref] as ResourceSnapshotEntry & { count?: unknown; prefetched?: unknown };
    const isCollection = "count" in candidate || "prefetched" in candidate;
    if (isCollection === (kind === "collection")) return candidate;
  }
  return undefined;
}
