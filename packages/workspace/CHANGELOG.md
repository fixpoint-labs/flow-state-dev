# @flow-state-dev/workspace

## 0.2.0

### Minor Changes

- ba74f01: `harnessManager({ workspace })` accepts a workspace host from `@flow-state-dev/workspace` as well as a fixed `{ root, sourceRepo, baseRef }`, and provisions every run through the host either way. A run keeps the repository and base it started on (recorded on its run record) when its source later changes, and a run that started with no repository stays on its kept files. Its kept files are saved at the end of each turn, when it asks a question, and when the harness fails, and a run is not completed while its last save failed. A run its workspace refuses (the source answers `refused`, or the host won't provision the remote) is cancelled on its first attempt instead of being retried, and `HarnessRunRefused` is exported. `localWorkspaceHost` gains `localRepositories`, for a repository on the machine that runs are cut from directly, with no clone and no fetch, and a place request can name a directory the checkout's repository must keep out of git, which a run with no repository also leaves out of its saved files. A provision's `provisionTimeoutMs` now covers its waits for other provisions of the same place or clone, and `save` refuses a place handle that a later provision of the same place has replaced. `run`, `GIT_TIMEOUT_MS` and `CHECKOUT_CLEANUP_TIMEOUT_MS` from `@flow-state-dev/harness-manager/checkout` are now re-exported from `@flow-state-dev/workspace` (FIX-1762).
- 9510a03: Requests now carry `ctx.request.incarnation`, a token that stays the same across a request's retries and resumes and that request-scoped workspace keys and local `scope: "run"` bash directories now include, so a request reusing a deleted request's id starts empty; existing run workspaces move once on upgrade, and a run in flight at deploy continues in an empty directory (FIX-1286).
- 57a859d: A workspace host can now hold a repository run's commits and uncommitted files off the machine, and rebuild the checkout on another host. Off by default: pass `heldWork: fileHeldWorkStore({ dir })` (or your own `HeldWorkStore`) to `localWorkspaceHost`, and have the run source answer a `heldPrefix`. `checkpoint(place, recorded?)` now returns the hold (or `null`) instead of nothing; new `dropHeld`, `hostId` and `holds` on the host; `provision` takes the run's `recorded` place and hold, returns `origin`, and rejects with `HeldWorkMismatchError` when held work disagrees with the record. A host without a store rejects a recorded hold with `field: "disabled"` instead of starting the run over (FIX-1766).
- 707b340: Add `localWorkspaceHost`, which turns a run source's answer into a place a worker edits (a fresh branch of an allowed remote in `checkout/` with kept files in `project/`, or kept files alone in `workspace/`) and saves the kept files back, plus a `scope` on `Mount` that confines a projection to one key prefix of its collection (FIX-1762).

### Patch Changes

- 8628a54: `redactRemote` is exported so a caller can show a git remote with its userinfo removed (FIX-1762).
- Updated dependencies [cd6f7fb]
- Updated dependencies [0b57bc9]
- Updated dependencies [be1bddf]
- Updated dependencies [58ffc93]
- Updated dependencies [397cfa7]
- Updated dependencies [53b50f0]
- Updated dependencies [456fe85]
- Updated dependencies [62133c4]
- Updated dependencies [9d02ac6]
- Updated dependencies [8dc242e]
- Updated dependencies [7d4158f]
- Updated dependencies [211679a]
- Updated dependencies [5181ddb]
- Updated dependencies [2969b30]
- Updated dependencies [a74429a]
- Updated dependencies [49d6397]
- Updated dependencies [a55d07f]
- Updated dependencies [7db4d13]
- Updated dependencies [9e3b823]
- Updated dependencies [df3de3b]
- Updated dependencies [423a405]
- Updated dependencies [7da156e]
- Updated dependencies [01b29f0]
- Updated dependencies [712dc22]
- Updated dependencies [afb512f]
- Updated dependencies [a7f1c41]
- Updated dependencies [80f6e25]
- Updated dependencies [b808784]
- Updated dependencies [311a6d5]
- Updated dependencies [7d4c413]
- Updated dependencies [27b198a]
- Updated dependencies [db7df1c]
- Updated dependencies [839e915]
- Updated dependencies [02ee032]
- Updated dependencies [16bb676]
- Updated dependencies [9510a03]
- Updated dependencies [385d01e]
- Updated dependencies [3311cc2]
- Updated dependencies [7c9e932]
- Updated dependencies [0503c38]
- Updated dependencies [8195995]
- Updated dependencies [97894aa]
- Updated dependencies [334c1e3]
- Updated dependencies [9ed6b29]
- Updated dependencies [a021cd1]
- Updated dependencies [cd180d7]
- Updated dependencies [68b8957]
- Updated dependencies [9cd314d]
- Updated dependencies [30aa133]
- Updated dependencies [407964a]
- Updated dependencies [5708f16]
- Updated dependencies [50edfd4]
- Updated dependencies [84cc226]
  - @flow-state-dev/core@0.3.0

## 0.1.3

### Patch Changes

- Updated dependencies [b597600]
- Updated dependencies [6b8bfe4]
- Updated dependencies [b48158a]
- Updated dependencies [f25f03c]
- Updated dependencies [e4c443e]
- Updated dependencies [bff5e06]
  - @flow-state-dev/core@0.2.0

## 0.1.2

### Patch Changes

- b56e7d1: Every package can be imported again: 0.1.1 shipped JavaScript whose relative imports were missing the file extensions Node's ESM resolver requires, so importing any 0.1.1 package failed with `ERR_MODULE_NOT_FOUND` (FIX-1431).
- Updated dependencies [b56e7d1]
  - @flow-state-dev/core@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [7c52923]
- Updated dependencies [a8e22c4]
  - @flow-state-dev/core@0.1.1

## 0.1.0

### Minor Changes

- b3e6e22: Initial release (FIX-1187).

### Patch Changes

- Updated dependencies [67b4157]
- Updated dependencies [527c5ca]
- Updated dependencies [4e562d0]
- Updated dependencies [afcac3d]
- Updated dependencies [3cbc411]
- Updated dependencies [b3e6e22]
- Updated dependencies [ce85e80]
- Updated dependencies [d7208f7]
- Updated dependencies [1b94521]
- Updated dependencies [5fa52aa]
- Updated dependencies [2c4b0f5]
- Updated dependencies [4054c64]
- Updated dependencies [fda9b15]
  - @flow-state-dev/core@0.1.0

## 0.0.0

- Initial release. The file projection between resource collections and
  wherever an agent works: `createProjection({ mounts, place })` hydrates
  mounted collections into a place and flushes them back, reporting an
  outcome for every path it reached. A path two writers touched comes back
  as a `conflict` carrying what the projection last committed, what the
  collection holds, and what the place holds — the three values needed to
  tell "I changed this" from "somebody else changed this". Ships
  `createHostPlace` (a real directory, contained, symlinks neither listed
  nor followed) and `createMemoryPlace` (a `Map`, for tests).
