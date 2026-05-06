/**
 * Internal-only items API. Not part of the public surface — accessible via
 * `@flow-state-dev/core/items/internal`. Carries the `ref` BlockValue case
 * and its constructor/resolver, used by the executor and persistence layers.
 */
export type { BlockValueInternal } from "./types";
export { refBlockValue, resolveBlockValueInternal } from "./resolve-value";
