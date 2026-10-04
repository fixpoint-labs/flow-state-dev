/**
 * Re-export shim: the resource-state write-version rule lives in
 * `@flow-state-dev/contracts`. Mirrored here so every `ResourceStateStore`
 * adapter reaches it through `@flow-state-dev/core/helpers`, the same path as
 * the other contracts-owned helpers. See packages/contracts.
 */
export * from "@flow-state-dev/contracts/helpers/write-version";
