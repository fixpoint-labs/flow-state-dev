# @flow-state-dev/harness-manager

## 0.3.0

### Minor Changes

- 0b37a7f: A person can send a running coding run a message (FIX-1690). `manager.messageDoor({ drain })` builds a public action that takes `{ message }` on the run's own session: it stops a running attempt, and the next attempt resumes the same coding session with the message in its prompt. `drain` names an `internal` entry on the flow that runs the board's drain; the door dispatches it into the session that claimed the row, so every attempt stays in the run's session. A run waiting on a question, between attempts, about to start one, or that didn't stop in time keeps the message for its next attempt and answers `kept`. A refusal (never started, finished, a harness that can't resume) fails the request with `TurnRefused`. The manager registers a new `turns` collection, so a capability that claims the `turns` accessor is now refused.

  In orchestration, `awaitReview(id, feedback, { forTurn: true })` parks a running row for a person's turn. It runs only from `in_progress`, and the claim that follows its `unpark` is counted in the new `turnReentries` field and not charged against `maxAttempts`.

- 3b3171a: A phase's `buildPrompt` now receives `run.task`: the claimed row's goal, plus its title, context, input, dependency outputs and selected prior work when present. `PromptRunContext.task` is a required field, so code that builds a `PromptRunContext` by hand (a test fixture, say) must now supply it. Prompt builders that only read `run.issue` keep working unchanged (FIX-1717).

### Patch Changes

- a1b122e: `harnessManager` now runs a board a channel holds. A board id may carry a single dot between its parts (`eng.feature.work`), and the manager uses it as is for each run's checkout folder and branch, so it never shares either with `eng-feature-work`. Board ids that worked before derive exactly the same folders and branches. An id a git branch can't carry, such as one ending in `.lock`, is now refused when the manager is built rather than when a row is claimed.

  On a board kept per organization, a row's coding run belongs to the member who started it. Wire the new `runOwnerDispatcher()` on the board that drains the rows, and another member's drain is refused, naming whose run it is, without charging the row an attempt; the starter's own retry continues in the same checkout, branch, run record and agent session (FIX-1667).

- 7c9e932: A running request's items are now readable while it runs on the in-memory stores too, and a message sent to a coding run whose harness hasn't named its session yet is held until it does instead of being refused as a run that can't continue (FIX-1735). `readCommitted` (in `@flow-state-dev/core/helpers`) reads a resource's state as committed now rather than as the request first read it.
- Updated dependencies [53b50f0]
- Updated dependencies [456fe85]
- Updated dependencies [9d02ac6]
- Updated dependencies [8dc242e]
- Updated dependencies [7d4158f]
- Updated dependencies [211679a]
- Updated dependencies [2969b30]
- Updated dependencies [a74429a]
- Updated dependencies [9e3b823]
- Updated dependencies [df3de3b]
- Updated dependencies [0b37a7f]
- Updated dependencies [01b29f0]
- Updated dependencies [712dc22]
- Updated dependencies [afb512f]
- Updated dependencies [a7f1c41]
- Updated dependencies [80f6e25]
- Updated dependencies [7d4c413]
- Updated dependencies [69a9e29]
- Updated dependencies [9510a03]
- Updated dependencies [385d01e]
- Updated dependencies [3311cc2]
- Updated dependencies [7c9e932]
- Updated dependencies [0503c38]
- Updated dependencies [8195995]
- Updated dependencies [9ed6b29]
- Updated dependencies [a021cd1]
- Updated dependencies [d994f51]
- Updated dependencies [afb512f]
- Updated dependencies [edb3d46]
- Updated dependencies [2e8f640]
- Updated dependencies [912ae98]
- Updated dependencies [407964a]
- Updated dependencies [5708f16]
- Updated dependencies [50edfd4]
- Updated dependencies [84cc226]
  - @flow-state-dev/core@0.3.0
  - @flow-state-dev/orchestration@0.4.0

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
