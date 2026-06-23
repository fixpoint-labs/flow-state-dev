# @flow-state-dev/contracts

The zero-dependency shared layer at the bottom of the framework spine.

`core` is the full authoring runtime — it carries heavy dependencies (zod,
picomatch, liquidjs, gray-matter, cron-parser). Browser packages and the wider
block-authoring ecosystem need the item taxonomy and a handful of pure helpers,
but not that weight. `contracts` is that minimal, dependency-free foundation.

## The zero-dependency invariant

This package declares **no** `dependencies` and imports nothing outside its own
relative module graph. That is the whole point: any consumer can value-import
it without pulling the authoring runtime into a browser bundle. The invariant is
machine-checked by `test/contracts-zero-dep.spec.ts` (empty `dependencies` +
a no-non-relative-import scan over `src/`), so it cannot silently regress.

## What it exports

- **Item taxonomy** (`@flow-state-dev/contracts/items`) — the `OutputItem`
  union and its members, `Content` parts, stream-event types, and the pure
  resolution helpers: `resolveItemVisibility`, `collapseToCanonicalLog`,
  `resolveBlockValue` / `buildItemLookup` / `inlineBlockValue` /
  `isBlockValue` / `structureBlockValue`, task-attribution and predicate
  helpers.
- **Internal item surface** (`@flow-state-dev/contracts/items/internal`) — the
  runtime item union (`RuntimeItem`), `BlockValueInternal`, `refBlockValue`,
  `resolveBlockValueInternal`, and `parseBlockInstanceId`.
- **Block-instance-id helpers** (`@flow-state-dev/contracts/block-instance-id`)
  — deterministic `buildBlockInstanceId` / `parseBlockInstanceId` and the
  `blockPath*` segment builders.
- **Pure leaf types** — `ModelIdentity`, `SuspensionReason`,
  `SuspensionStatus`, `RequestStatus`.

The package barrel (`@flow-state-dev/contracts`) re-exports the item taxonomy,
the block-instance-id helpers, and the suspension leaf types.

## Who depends on it

`core`, `client`, `react`, and `server` all depend on `contracts`. **`core`
re-exports every symbol from its original path** (`@flow-state-dev/core`,
`@flow-state-dev/core/items`, `@flow-state-dev/core/items/internal`, the leaf
types), so importing these from `core` is unchanged for end users — the
declaration simply lives here now. Browser packages value-import the canonical
helpers directly from `contracts` instead of hand-mirroring them.
