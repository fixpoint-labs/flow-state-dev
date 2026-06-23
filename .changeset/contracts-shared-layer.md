---
"@flow-state-dev/contracts": minor
"@flow-state-dev/core": patch
"@flow-state-dev/react": patch
"@flow-state-dev/client": patch
---

Extract the item taxonomy, the deterministic `block-instance-id` helpers, and the pure leaf types (`ModelIdentity`, `SuspensionReason`, `SuspensionStatus`, `RequestStatus`) out of `@flow-state-dev/core` into a new zero-dependency `@flow-state-dev/contracts` package.

`@flow-state-dev/core` re-exports every moved symbol from its original path (`@flow-state-dev/core`, `@flow-state-dev/core/items`, `@flow-state-dev/core/items/internal`, `@flow-state-dev/core/types`), so this is **non-breaking** for existing consumers — import paths are unchanged.

Browser packages now value-import the canonical helpers (`resolveItemVisibility`, `collapseToCanonicalLog`, `resolveBlockValue`/`buildItemLookup`) directly from the zero-dependency layer instead of hand-mirroring them. The previously-mirrored `react` copies — including a lossy `collapseToCanonicalLog` that used a partial block-instance-id parse — are removed, so `react` now runs the same canonical-log collapse the server runs.
