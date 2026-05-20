# @flow-state-dev/patterns

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
