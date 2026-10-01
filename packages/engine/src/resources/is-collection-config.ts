/**
 * Re-export shim: the collection type guard lives in core
 * (`@flow-state-dev/core/types` → `storage-identity.ts`), so `defineFlow`'s
 * build-time collision check and the engine's persistence path apply one
 * predicate. Preserved at this path so engine imports resolve unchanged.
 */
export { isCollectionConfig } from "@flow-state-dev/core/types";
