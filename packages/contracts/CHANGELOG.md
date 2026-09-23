# @flow-state-dev/contracts

## 0.1.2

### Patch Changes

- b597600: An agent can now ask what it can work with: `discoveryTools(createManifestRegistry([...]))` returns one `discover` tool that answers from whatever domains a scope registers a source for, and `resourcesManifestSource()` ships the resources domain. Two enumerators that ignored the `llmReadable` gate are closed with it — `resourceTools().listResources` is **removed** (it had no caller), and `globResources` now lists only resources the agent may read (FIX-817).
- e4c443e: A task board now reports when it saves a task's result and then cannot announce
  it, instead of finishing the run as though nothing went wrong. The failure lands
  on a persisted `task-board-recorder-failure` item and fails the run once every
  other task has drained; on a handed-off task it fails that child run. `onError`
  does not suppress it. Where the board cannot tell whether the write landed —
  permanently so on a task store you supplied, and on rows that predate write
  provenance — it says `undetermined` rather than assuming the write was lost, and
  hands the row back rather than leaving it claimed. `createRecordSuccess` and
  `createRecordError` composed outside a board raise the failure where it happens,
  since nothing downstream would read the report (FIX-963).

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
