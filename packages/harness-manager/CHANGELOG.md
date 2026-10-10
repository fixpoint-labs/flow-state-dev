# @flow-state-dev/harness-manager

## 0.3.0

### Minor Changes

- ac632a0: On a workspace host with a held-work store, the manager now holds a run's repository work at the end of each turn, when it parks, and when the harness fails, and brings it back on another machine. The run record gains `place` (`{ host, state }`) and `held` (the last hold, or why it failed); both stay `null` with holding off. A run whose held work does not match its record, or lands on a host with holding off, is parked for its owner with a question naming what disagreed (`HarnessRunParked`), instead of starting over. A run is not completed on work it could not hold (FIX-1766).
- 0b37a7f: A person can send a running coding run a message (FIX-1690). `manager.messageDoor({ drain })` builds a public action that takes `{ message }` on the run's own session: it stops a running attempt, and the next attempt resumes the same coding session with the message in its prompt. `drain` names an `internal` entry on the flow that runs the board's drain; the door dispatches it into the session that claimed the row, so every attempt stays in the run's session. A run waiting on a question, between attempts, about to start one, or that didn't stop in time keeps the message for its next attempt and answers `kept`. A refusal (never started, finished, a harness that can't resume) fails the request with `TurnRefused`. The manager registers a new `turns` collection, so a capability that claims the `turns` accessor is now refused.

  In orchestration, `awaitReview(id, feedback, { forTurn: true })` parks a running row for a person's turn. It runs only from `in_progress`, and the claim that follows its `unpark` is counted in the new `turnReentries` field and not charged against `maxAttempts`.

- 3b3171a: A phase's `buildPrompt` now receives `run.task`: the claimed row's goal, plus its title, context, input, dependency outputs and selected prior work when present. `PromptRunContext.task` is a required field, so code that builds a `PromptRunContext` by hand (a test fixture, say) must now supply it. Prompt builders that only read `run.issue` keep working unchanged (FIX-1717).
- ba74f01: `harnessManager({ workspace })` accepts a workspace host from `@flow-state-dev/workspace` as well as a fixed `{ root, sourceRepo, baseRef }`, and provisions every run through the host either way. A run keeps the repository and base it started on (recorded on its run record) when its source later changes, and a run that started with no repository stays on its kept files. Its kept files are saved at the end of each turn, when it asks a question, and when the harness fails, and a run is not completed while its last save failed. A run its workspace refuses (the source answers `refused`, or the host won't provision the remote) is cancelled on its first attempt instead of being retried, and `HarnessRunRefused` is exported. `localWorkspaceHost` gains `localRepositories`, for a repository on the machine that runs are cut from directly, with no clone and no fetch, and a place request can name a directory the checkout's repository must keep out of git, which a run with no repository also leaves out of its saved files. A provision's `provisionTimeoutMs` now covers its waits for other provisions of the same place or clone, and `save` refuses a place handle that a later provision of the same place has replaced. `run`, `GIT_TIMEOUT_MS` and `CHECKOUT_CLEANUP_TIMEOUT_MS` from `@flow-state-dev/harness-manager/checkout` are now re-exported from `@flow-state-dev/workspace` (FIX-1762).

### Patch Changes

- d10b1ba: `harnessManager` now runs a board a mailbox holds. A board id may carry a single dot between its parts (`eng.feature.work`), and the manager uses it as is for each run's checkout folder and branch, so it never shares either with `eng-feature-work`. Board ids that worked before derive exactly the same folders and branches. An id a git branch can't carry, such as one ending in `.lock`, is now refused when the manager is built rather than when a row is claimed.

  On a board kept per organization, a row's coding run belongs to the member who started it. Wire the new `runOwnerDispatcher()` on the board that drains the rows, and another member's drain is refused, naming whose run it is, without charging the row an attempt; the starter's own retry continues in the same checkout, branch, run record and agent session (FIX-1667).

- 7c9e932: A running request's items are now readable while it runs on the in-memory stores too, and a message sent to a coding run whose harness hasn't named its session yet is held until it does instead of being refused as a run that can't continue (FIX-1735). `readCommitted` (in `@flow-state-dev/core/helpers`) reads a resource's state as committed now rather than as the request first read it.
- cd180d7: Stopping a paused request now ends it `aborted` and records its gate with the new `stopped` suspension status, a turn paused on an ask cancels the asked task instead of waiting for it, and a durable host now runs the durability sweeper even without `durabilityRetention`, so a paused request past its `expiresAt` expires and an ask past its deadline times out, while pruning still waits for a retention policy (FIX-1816).
- 78178a9: A run's owner is now the bare user id, not the user record's storage key (FIX-1790).
- Updated dependencies [cd6f7fb]
- Updated dependencies [0b57bc9]
- Updated dependencies [e457697]
- Updated dependencies [be1bddf]
- Updated dependencies [e00a3b0]
- Updated dependencies [58ffc93]
- Updated dependencies [397cfa7]
- Updated dependencies [70cfac9]
- Updated dependencies [53b50f0]
- Updated dependencies [456fe85]
- Updated dependencies [62133c4]
- Updated dependencies [9d02ac6]
- Updated dependencies [8dc242e]
- Updated dependencies [7d4158f]
- Updated dependencies [211679a]
- Updated dependencies [5181ddb]
- Updated dependencies [8628a54]
- Updated dependencies [2969b30]
- Updated dependencies [a74429a]
- Updated dependencies [49d6397]
- Updated dependencies [a55d07f]
- Updated dependencies [7db4d13]
- Updated dependencies [9e3b823]
- Updated dependencies [df3de3b]
- Updated dependencies [17444fe]
- Updated dependencies [423a405]
- Updated dependencies [0b37a7f]
- Updated dependencies [ba74f01]
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
- Updated dependencies [69a9e29]
- Updated dependencies [12bf045]
- Updated dependencies [db7df1c]
- Updated dependencies [839e915]
- Updated dependencies [02ee032]
- Updated dependencies [16bb676]
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
- Updated dependencies [d994f51]
- Updated dependencies [afb512f]
- Updated dependencies [09e3705]
- Updated dependencies [cd180d7]
- Updated dependencies [68b8957]
- Updated dependencies [edb3d46]
- Updated dependencies [9cd314d]
- Updated dependencies [6f5a697]
- Updated dependencies [2e8f640]
- Updated dependencies [30aa133]
- Updated dependencies [912ae98]
- Updated dependencies [407964a]
- Updated dependencies [5708f16]
- Updated dependencies [50edfd4]
- Updated dependencies [78178a9]
- Updated dependencies [84cc226]
- Updated dependencies [98b90a6]
- Updated dependencies [57a859d]
- Updated dependencies [707b340]
  - @flow-state-dev/core@0.3.0
  - @flow-state-dev/orchestration@0.4.0
  - @flow-state-dev/workspace@0.2.0

## 0.2.0

### Minor Changes

- 0ab8c2e: A phase's `isDone` is handed how the run said it stopped, as `CompletionRunContext.stopReport`, so a completion check can refuse to settle a row whose run ran out of budget partway (FIX-1438).

### Patch Changes

- Updated dependencies [0f812c9]
- Updated dependencies [b597600]
- Updated dependencies [8faf08e]
- Updated dependencies [6b8bfe4]
- Updated dependencies [b48158a]
- Updated dependencies [f25f03c]
- Updated dependencies [218de72]
- Updated dependencies [e4c443e]
- Updated dependencies [bff5e06]
  - @flow-state-dev/orchestration@0.3.0
  - @flow-state-dev/core@0.2.0

## 0.1.2

### Patch Changes

- b56e7d1: Every package can be imported again: 0.1.1 shipped JavaScript whose relative imports were missing the file extensions Node's ESM resolver requires, so importing any 0.1.1 package failed with `ERR_MODULE_NOT_FOUND` (FIX-1431).
- Updated dependencies [b56e7d1]
  - @flow-state-dev/core@0.1.2
  - @flow-state-dev/orchestration@0.2.1

## 0.1.1

### Patch Changes

- Updated dependencies [7c52923]
- Updated dependencies [a8e22c4]
- Updated dependencies [23bc757]
- Updated dependencies [64b323e]
- Updated dependencies [119936d]
- Updated dependencies [c25ad3e]
- Updated dependencies [8a1173a]
- Updated dependencies [23ac6de]
  - @flow-state-dev/core@0.1.1
  - @flow-state-dev/orchestration@0.2.0

## 0.1.0

### Minor Changes

- 7cf0ca3: New package: a task-board worker that turns a row into a supervised coding run —
  its own git checkout, a verdict read before the row settles, a question it can
  ask a person and be answered on, and the coding agent supplied as a slot rather
  than built in (LAB-154).

### Patch Changes

- Updated dependencies [67b4157]
- Updated dependencies [527c5ca]
- Updated dependencies [bea3a24]
- Updated dependencies [b484d86]
- Updated dependencies [4e562d0]
- Updated dependencies [afcac3d]
- Updated dependencies [0443742]
- Updated dependencies [3cbc411]
- Updated dependencies [b3e6e22]
- Updated dependencies [ce85e80]
- Updated dependencies [d7208f7]
- Updated dependencies [1b94521]
- Updated dependencies [5fa52aa]
- Updated dependencies [229da65]
- Updated dependencies [2c4b0f5]
- Updated dependencies [4054c64]
- Updated dependencies [fda9b15]
  - @flow-state-dev/core@0.1.0
  - @flow-state-dev/orchestration@0.1.0
