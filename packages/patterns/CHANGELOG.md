# @flow-state-dev/patterns

## 0.2.1

### Patch Changes

- Updated dependencies [824ce87]
- Updated dependencies [8be6d45]
- Updated dependencies [387bee2]
- Updated dependencies [3aced5b]
  - @flow-state-dev/core@0.4.0
  - @flow-state-dev/orchestration@0.5.0

## 0.2.0

### Minor Changes

- 849f6ec: Built-in model defaults move to the current generation (FIX-2050). `utility.sessionTitleGenerator`, `utility.decomposer`, the `planAndExecute` / `routedSpecialists` pattern defaults and `workingMemoryObserve` now default to `gpt-6-luna`, as do Shift Manager's Lab default model (`LAB_DEFAULT_MODEL`) and its DevTeam workers (previously `gpt-5-nano`, `gpt-5.4-mini`, `gpt-5-mini` or `gpt-4o-mini`). Pass `model` explicitly to keep the old one. The cost tables in `core` and `testing` now price `gpt-6-astra`, `gpt-6.1-sol`, `gpt-6-sol`, `gpt-6-luna` and Claude Opus, Sonnet and Haiku 5.5.
- 02ee032: Remove backward-compatibility paths (FIX-1804, FIX-850): stores read only the current on-disk and table layouts with no migration of older data, `@flow-state-dev/claude-code` drops its package-root entry and deprecated handle aliases, `@flow-state-dev/patterns` drops `legacyWorkerAdapter` and `executableTaskSchema`, and removed options such as `clientData`, `requireOrg`, `presets`, `preset/*` model strings, `prefer` and `fileFilter`/`syncMode` are no longer refused by name.
- d81b2db: Removed the `rlm` (Recursive Language Model) pattern and its `@flow-state-dev/patterns/rlm` subpath (FIX-2057). Removed exports: `rlmPipeline`, `rootGenerator`, `subQueryGenerator`, `storeContext`, `contextResource`, `contextResourceStateSchema`, `rlmQueryInputSchema`, `subQueryOutputSchema`, `rlmOutputSchema`, `peek`, `grep`, `chunk`.
- 7052203: A task now runs by the settings it was filed with, and nothing waits on work that will never finish (FIX-2080).

  - **`held` replaces `blocked`.** A held task is filed but doesn't start until it is released. `TaskCollection.block` / `unblock` become `hold` / `release`, the `"blocked"` status and `listTasks` filter value become `"held"`, `Task.undispatched` / `TaskInit.undispatched` become `held`, change kinds `blocked` / `unblocked` / `dispatched` become `held` / `released`, and the board's `counts.blocked` becomes `counts.held`. Stored `blocked` rows and recorded-not-started rows read as `held`; a `blocked` row's reason moves to `metadata.heldReason`, and a release starts it even if it had been retried.
  - **`blockTask` is removed.** Use `updateTask({ taskId, patch: { status: "held" } })` to hold a task before it starts, and `"pending"` to release it. `addTask` on a dispatching board files the task held.
  - **`patchSettings`** changes `held`, `deps` and `maxAttempts` until a task first starts, and declines `started` after.
  - **Dependencies are checked at filing.** A dependency on another board, on an ended task, or one that closes a loop throws `TaskFilingRefusedError` (`dependency_not_on_board`, `dependency_ended`, `dependency_loop`) and files nothing. To wait on another board, use a wait or a held task. A Workforce batch that names one id twice is refused (`duplicate_task_id`).
  - **Every board cancels the open dependents of a failed or cancelled task**, labelled `skipped`, with `causedBy`. `createCascadeSkipDependents` is removed; drop its `.tap()`. Plan-and-execute and supervisor now also cancel a cancelled step's dependents. A plan whose dependencies name no task, or loop, fails the run; a replanned task that depends on a failed one is filed skipped.
  - **Workforce:** a follow-up into a busy session waits, then runs when the open task ends, instead of being refused. The follow-up refusal code `follow_up_of_unfinished` is now `follow_up_of_unrun`: a follow-up of a task that never ran with a worker is refused, from the tools and from the board's ref alike. Code filing through the board's ref can set `session: "new" | "ongoing"` and `resultTo: "filer" | "conversation"` (one attempt; a wait on it is refused). When a task fails, is retried or is cancelled, the open pieces it filed are cancelled.

### Patch Changes

- Updated dependencies [dc17a39]
- Updated dependencies [92b2b70]
- Updated dependencies [20aa58f]
- Updated dependencies [a5c1ce8]
- Updated dependencies [9f237f5]
- Updated dependencies [5d31955]
- Updated dependencies [bea14a0]
- Updated dependencies [15f7c6b]
- Updated dependencies [5c8a130]
- Updated dependencies [24afa6e]
- Updated dependencies [f8df86f]
- Updated dependencies [82eea02]
- Updated dependencies [e2c190e]
- Updated dependencies [0d55d46]
- Updated dependencies [1abab86]
- Updated dependencies [cb364e8]
- Updated dependencies [8e67ce5]
- Updated dependencies [af6c7cd]
- Updated dependencies [dd353e2]
- Updated dependencies [c245f7c]
- Updated dependencies [0836ffa]
- Updated dependencies [ad0babd]
- Updated dependencies [10ded49]
- Updated dependencies [e00a3b0]
- Updated dependencies [3221d05]
- Updated dependencies [58ffc93]
- Updated dependencies [4cdc088]
- Updated dependencies [f97b0ed]
- Updated dependencies [397cfa7]
- Updated dependencies [70cfac9]
- Updated dependencies [53b50f0]
- Updated dependencies [2ffc03c]
- Updated dependencies [646f8d2]
- Updated dependencies [16a8dab]
- Updated dependencies [456fe85]
- Updated dependencies [62133c4]
- Updated dependencies [9d02ac6]
- Updated dependencies [d5ce1e0]
- Updated dependencies [8dc242e]
- Updated dependencies [89af7db]
- Updated dependencies [7d4158f]
- Updated dependencies [5d94e61]
- Updated dependencies [5492a77]
- Updated dependencies [6819520]
- Updated dependencies [b234f0d]
- Updated dependencies [ad5df6f]
- Updated dependencies [211679a]
- Updated dependencies [dd80e01]
- Updated dependencies [2ce15c7]
- Updated dependencies [5181ddb]
- Updated dependencies [3c10d9d]
- Updated dependencies [2969b30]
- Updated dependencies [3ee61e5]
- Updated dependencies [a74429a]
- Updated dependencies [04ff39d]
- Updated dependencies [e71ea1a]
- Updated dependencies [49d6397]
- Updated dependencies [a55d07f]
- Updated dependencies [7db4d13]
- Updated dependencies [f12089e]
- Updated dependencies [35bec56]
- Updated dependencies [9e3b823]
- Updated dependencies [df3de3b]
- Updated dependencies [3b40ca1]
- Updated dependencies [fe5df7d]
- Updated dependencies [17444fe]
- Updated dependencies [423a405]
- Updated dependencies [809cebd]
- Updated dependencies [08a9b05]
- Updated dependencies [c4d9743]
- Updated dependencies [90a5e64]
- Updated dependencies [7da156e]
- Updated dependencies [01b29f0]
- Updated dependencies [712dc22]
- Updated dependencies [afb512f]
- Updated dependencies [f9995b1]
- Updated dependencies [a7f1c41]
- Updated dependencies [3a6c910]
- Updated dependencies [80f6e25]
- Updated dependencies [d356f52]
- Updated dependencies [3cbab3a]
- Updated dependencies [3cbab3a]
- Updated dependencies [849f6ec]
- Updated dependencies [028af6f]
- Updated dependencies [a965a50]
- Updated dependencies [eb831f8]
- Updated dependencies [859f621]
- Updated dependencies [16455f2]
- Updated dependencies [41638f3]
- Updated dependencies [24744af]
- Updated dependencies [4a3b026]
- Updated dependencies [311a6d5]
- Updated dependencies [7d4c413]
- Updated dependencies [27b198a]
- Updated dependencies [12bf045]
- Updated dependencies [db7df1c]
- Updated dependencies [0d6278e]
- Updated dependencies [726de78]
- Updated dependencies [968faa6]
- Updated dependencies [653549d]
- Updated dependencies [d348ae7]
- Updated dependencies [f292079]
- Updated dependencies [dd2563b]
- Updated dependencies [839e915]
- Updated dependencies [f5b5457]
- Updated dependencies [02ee032]
- Updated dependencies [16bb676]
- Updated dependencies [16bb676]
- Updated dependencies [c4150e7]
- Updated dependencies [9510a03]
- Updated dependencies [adbcf0b]
- Updated dependencies [1027b98]
- Updated dependencies [1cfd80c]
- Updated dependencies [3b0161c]
- Updated dependencies [385d01e]
- Updated dependencies [d1a4cab]
- Updated dependencies [d1a4cab]
- Updated dependencies [3311cc2]
- Updated dependencies [2ab7ea2]
- Updated dependencies [7c9e932]
- Updated dependencies [60c8192]
- Updated dependencies [d2dd7f7]
- Updated dependencies [0503c38]
- Updated dependencies [8195995]
- Updated dependencies [edc3197]
- Updated dependencies [295e96a]
- Updated dependencies [97894aa]
- Updated dependencies [334c1e3]
- Updated dependencies [9ed6b29]
- Updated dependencies [b552b50]
- Updated dependencies [a021cd1]
- Updated dependencies [d994f51]
- Updated dependencies [afb512f]
- Updated dependencies [09e3705]
- Updated dependencies [eb66ddd]
- Updated dependencies [2f342f6]
- Updated dependencies [cd180d7]
- Updated dependencies [68b8957]
- Updated dependencies [e11764a]
- Updated dependencies [edb3d46]
- Updated dependencies [872a088]
- Updated dependencies [9edbfa2]
- Updated dependencies [437727e]
- Updated dependencies [9cd314d]
- Updated dependencies [2e8f640]
- Updated dependencies [9af8ce5]
- Updated dependencies [7035b4c]
- Updated dependencies [30aa133]
- Updated dependencies [912ae98]
- Updated dependencies [7052203]
- Updated dependencies [407964a]
- Updated dependencies [5708f16]
- Updated dependencies [50edfd4]
- Updated dependencies [78178a9]
- Updated dependencies [d97031f]
- Updated dependencies [49d2aca]
- Updated dependencies [3c10d9d]
- Updated dependencies [da86f88]
- Updated dependencies [96ff077]
- Updated dependencies [84cc226]
- Updated dependencies [721a811]
- Updated dependencies [98b90a6]
  - @flow-state-dev/orchestration@0.4.0
  - @flow-state-dev/core@0.3.0

## 0.1.3

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

- b3e6e22: Initial release (FIX-1187).

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

## Pre-1.0 history

Captured from the project's pre-Changesets development log (root `changelog.md`,
deleted on FIX-653). Entries are listed newest-first.

### 2026-05-18 — Moderated Debate (FIX-607)

`debate()` now accepts an optional `moderator` block that opens each round. The moderator picks who speaks, can supply a `briefing` and `newAngle` that the round's debaters see, and may flag a round as the last one. Supports tools. New `terminateWhen?: (ctx) => boolean` predicate. New `createModerator(opts)` factory. New optional `transcript` resource. `DebateRawOutput` carries a `moderatorDecisions` field.

### 2026-05-18 — Configurable downstream information flow on Task Board (FIX-610)

Pattern defaults updated: `planAndExecute` pins `recentTrajectory({ n: 8 })`; `supervisor` pins `declaredDepsOnly`; bare `taskBoard` defaults to `declaredDepsOnly`. Pattern factories now forward `uses` to their default internal generators.

### 2026-05-16 — Round Robin pattern reshape (FIX-597) [BREAKING]

`roundRobin()` no longer requires a judge. The `judge` config is removed; a new optional `referee` slot runs after every round as a per-round argument-quality auditor and does not control termination. New `terminateWhen?: (ctx) => boolean` drives runtime early-exit. `RoundRobinFinalShape` drops `done` and `summary`; adds `refereeCritiques`. Schema/factory renames: `roundRobinJudgeOutputSchema` → `roundRobinRefereeOutputSchema`, `createJudge` → `createReferee`.

### 2026-05-13 — Skills declare a pattern (FIX-450)

`@flow-state-dev/patterns` exports `defaultPatternRegistry` with eight entries: task-board, plan-and-execute, supervisor, parallel-tasks, routed-specialists, the deprecated `coordinator` alias, and stubs for event-actors and approval-gate. Each adapter validates its kebab-case `pattern-config` via a strict Zod schema.

### 2026-05-11 — Round Robin default roster streams text (FIX-561)

`createRosterAgent` no longer hardcodes a `z.object({ text })` output schema. It now uses the generator's default `z.string()` output, which makes the streaming gate fire and emit live `message` items. The agent now stamps `agentName` on its underlying generator so transcript filters keyed on known agents don't drop messages.

### 2026-05-08 — Round Robin: `contributions` config (FIX-561)

`roundRobin({ contributions })` accepts an externally-provided contributions resource. When omitted the pattern still creates its own internal instance. Sharing one resource across multiple instances behind a `router()` now succeeds.

### 2026-05-07 — Debate pattern (FIX-328)

New `debate` factory and `@flow-state-dev/patterns/debate` subpath export. Multi-round adversarial argumentation with assigned stances and a single judge that runs once at the end. Built on the Round Robin chassis. Bias mitigations ship on by default (`anonymizeTranscript`, `shuffleForJudge`). Default `maxRounds` is 2; values above 4 emit a warning.

### 2026-05-06 — Round Robin pattern (FIX-318)

New `roundRobin` factory and `@flow-state-dev/patterns/round-robin` subpath export. Fixed-roster, deterministic-order multi-agent coordination. The transcript lives in a session-scoped writable resource owned by the pattern. Per-turn audit records mirror it in a sequencer-backed `TaskCollection`.

### 2026-05-01 — Migrate queue-shaped patterns onto `taskBoard` (FIX-448) [BREAKING]

Removed `drainPool` and `eventQueue` — `taskBoard` substrate provides both. Renamed `blackboard` → `routedSpecialists` (and `createBlackboard` → `createWorkspace`). Renamed `reactiveBlackboard` → `eventActors` (and `mesh()` → `eventActors()`, `reactiveBlackboard()` → `createEventActorsWorkspace()`). The default controller's "previous decisions" prompt section is now read from `collection.list({ status: "completed" })`.

### 2026-04-29 — Patterns migrated onto `taskBoard` substrate (FIX-447) [BREAKING]

Renamed `coordinator` → `parallelTasks` (`coordinator()` still works as a deprecation-warned alias). `planAndExecute` and `supervisor` now run on the `taskBoard` substrate with a request-backed `TaskCollection`. Both emit `task-change` and `task-board-meta` items. Status vocabulary aligns with the substrate (`errored`, `cancelled`); public output shapes translate back to legacy `failed` / `skipped` for backward compat. Supervisor replaces its wave-level review loop with per-task review baked into each worker chain (`worker → reviewer → applyVerdict`); `maxAttemptsPerTask` (default 3) bounds retries.

### 2026-04-29 — `taskBoard` re-entry across outer loop (FIX-471)

Added `backing: "request"` to `taskBoard({ collection })` so multiple board invocations within one request share a single task collection. Unblocks "wrap a board inside a higher-level loop" patterns.

### 2026-04-29 — `taskBoard` capability + idiom revision (FIX-446)

`taskBoard().capability` returns a `DefinedCapability` with a `tasks()` accessor. Blocks across a flow opt in via `uses: [board.capability]` and address the board through `ctx.cap["taskBoard.<name>"].tasks()`. Replaced the custom `task_change` item type with a `task-change` component item keyed by `${collectionId}/${taskId}`.

### 2026-04-29 — `taskBoard` pattern (FIX-446)

New `taskBoard` pattern. Concurrent drain over a `TaskCollection` with dependency gating, per-task worker routing by `task.assignee`, and CAS-safe claim semantics. Five standard dispatchers (`fifo`, `topological`, `priority`, `classifier`, `event`); default is `topological`. HITL-ready: `awaiting_review` keeps the loop alive until external resume. Individual remix blocks exported.

### 2026-04-26 — Org scope rename (FIX-428) [BREAKING]

Pattern internals renamed `project` → `org`.
