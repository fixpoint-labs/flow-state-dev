# @flow-state-dev/contracts

## 0.1.1

### Patch Changes

- b56e7d1: Every package can be imported again: 0.1.1 shipped JavaScript whose relative imports were missing the file extensions Node's ESM resolver requires, so importing any 0.1.1 package failed with `ERR_MODULE_NOT_FOUND` (FIX-1431).

## 0.1.0

### Minor Changes

- b3e6e22: Initial release (FIX-1187).

## 0.0.0

- Initial release. Extracts the item taxonomy, the deterministic
  block-instance-id helpers, and the pure leaf types (`ModelIdentity`,
  `SuspensionReason`, `SuspensionStatus`, `RequestStatus`) out of
  `@flow-state-dev/core` into a zero-dependency shared layer. `core`
  re-exports every moved symbol from its original path, so the move is
  non-breaking for existing consumers.
