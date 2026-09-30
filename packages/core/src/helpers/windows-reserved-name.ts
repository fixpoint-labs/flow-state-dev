/**
 * Re-export shim: this pure helper lives in `@flow-state-dev/contracts`.
 * Mirrored here so `@flow-state-dev/core/helpers` carries it alongside the
 * other contracts-owned helpers (`deep-equal`, `concurrency`, `string-case`,
 * `to-error`); engine, workforce and claude-code import it by that path.
 * See packages/contracts.
 */
export * from "@flow-state-dev/contracts/helpers/windows-reserved-name";
