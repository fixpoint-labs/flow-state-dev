/**
 * Re-export shim: the BlockValue resolution helpers now lives in `@flow-state-dev/contracts`.
 * Preserved at this path so `@flow-state-dev/core/items*` consumers (and
 * core-internal deep imports) resolve unchanged. See packages/contracts.
 */
export * from "@flow-state-dev/contracts/items/resolve-value";
