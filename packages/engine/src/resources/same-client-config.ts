// FIX-2943; epic FIX-2941.
/**
 * What "the same definition" of a shared user or org resource means past its
 * schema: the client projection, owner rules, `secret`, `runBy` and `canWrite`.
 *
 * One comparison, read by both places that ask: the start-up clash check
 * (`validateScope` in `registry/flow-registry.ts`) refuses two flows that
 * declare one address with different settings, and the address path
 * (`resolveAddress` in `scope-address.ts`) answers 409 for the same pair.
 */
import type { ResourceCollectionConfig, ResourceConfig } from "@flow-state-dev/core/types";
import { isCollectionConfig } from "./is-collection-config";

/** Whether two declarations of one address project the same fields for a client and take the same writes. */
export function sameClientConfig(
  a: ResourceConfig | ResourceCollectionConfig,
  b: ResourceConfig | ResourceCollectionConfig
): boolean {
  if (a === b) return true;
  if (isCollectionConfig(a) !== isCollectionConfig(b)) return false;
  const ca = a.client as (ResourceConfig["client"] & ResourceCollectionConfig["client"]) | undefined;
  const cb = b.client as (ResourceConfig["client"] & ResourceCollectionConfig["client"]) | undefined;
  if (ca === undefined || cb === undefined) return ca === cb;
  const owner = (config: object) => {
    const { ownerPrivate, ownerWrites } = config as Pick<ResourceCollectionConfig, "ownerPrivate" | "ownerWrites">;
    return JSON.stringify([ownerPrivate ?? null, ownerWrites ?? null]);
  };
  return (
    ca.data === cb.data &&
    JSON.stringify(ca.state ?? null) === JSON.stringify(cb.state ?? null) &&
    owner(a) === owner(b) &&
    JSON.stringify(ca.expose ?? null) === JSON.stringify(cb.expose ?? null) &&
    JSON.stringify(ca.exclude ?? null) === JSON.stringify(cb.exclude ?? null) &&
    JSON.stringify(a.secret ?? null) === JSON.stringify(b.secret ?? null) &&
    JSON.stringify(a.runBy ?? null) === JSON.stringify(b.runBy ?? null) &&
    a.canWrite === b.canWrite
  );
}
