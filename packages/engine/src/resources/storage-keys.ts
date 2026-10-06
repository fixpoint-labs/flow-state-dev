/**
 * Re-export shim: accessor → storage-key resolution lives in core
 * (`@flow-state-dev/core/types` → `storage-identity.ts`), so `defineFlow`'s
 * build-time collision check resolves the same keys the engine persists to.
 * See that module for the canonicalization rule and the stability note.
 *
 * Preserved at this path so `createExecutionContext` and `routes/route-utils`
 * keep importing it without a cycle through `resources/internal.ts`.
 *
 * FIX-591: resource state is keyed by ref identity, not accessor name.
 */
export { resourceStorageKeys } from "@flow-state-dev/core/types";
