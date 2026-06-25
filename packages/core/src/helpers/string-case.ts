/**
 * Re-export shim: this pure helper now lives in `@flow-state-dev/contracts`.
 * Preserved at this path so `@flow-state-dev/core/helpers` and core-internal
 * deep imports resolve unchanged. See packages/contracts.
 */
export * from "@flow-state-dev/contracts/helpers/string-case";
