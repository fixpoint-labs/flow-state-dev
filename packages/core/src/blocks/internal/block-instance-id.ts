/**
 * Re-export shim: the deterministic blockInstanceId construction/parsing
 * helpers now live in `@flow-state-dev/contracts` (pure, dependency-free
 * string logic). Preserved at this path so core-internal imports of
 * `blocks/internal/block-instance-id` resolve unchanged. See packages/contracts.
 */
export * from "@flow-state-dev/contracts/block-instance-id";
