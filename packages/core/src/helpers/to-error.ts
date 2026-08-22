/**
 * Re-export shim: this pure helper lives in `@flow-state-dev/contracts`.
 * Mirrored here so `@flow-state-dev/core/helpers` carries it alongside the
 * other contracts-owned helpers (`deep-equal`, `concurrency`, `string-case`)
 * and core-internal deep imports have one path to reach for. See
 * packages/contracts.
 */
export * from "@flow-state-dev/contracts/helpers/to-error";
