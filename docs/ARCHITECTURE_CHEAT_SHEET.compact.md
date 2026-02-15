# FSD Phase 1 Compact Architecture Cheat Sheet

## Mission

- Build a runnable Phase 1 framework in `implementation/` with:
  - `core`, `server`, `client`, `react`, `testing`, `cli`, `apps/devtool`
- Preserve clean separation:
  - `preperation/` = research/planning authority inputs
  - `implementation/` = production code + execution records

`preperation` should be treated as a sibling directory in the file system, but is a separate repository in order to keep this repo history clean.

## Authority Order

1. `preperation/architecture/ARCHITECTURE_OVERVIEW.md`
2. `preperation/architecture/BLOCKS.md`
3. `preperation/architecture/FLOW_SYSTEM.md`
4. `preperation/architecture/STATE_AND_SCOPES.md`
5. `preperation/architecture/STREAMING.md`
6. `preperation/architecture/EXECUTION_AND_ERRORS.md`
7. `preperation/architecture/SERVER_AND_CLIENT.md`
8. `preperation/architecture/TESTING.md`
9. `preperation/architecture/CLI.md`
10. `preperation/architecture/DEV_TOOL.md`
11. `preperation/architecture/IMPLEMENTATION_PLAN.md`
12. `preperation/planning/PHASE_1_OVERVIEW.md` (scope framing only)

Conflict rule: `architecture/*` wins.

## Locked Contracts

- Block kinds only: `handler`, `generator`, `sequencer`, `router`
- Actions are flow-level only (`defineFlow({ actions })`)
- Required caller input: `userId`
- Stream model: item/content lifecycle; no part-envelope model
- Stream cursor: `${requestId}:${sequence_number}`
- Resume paths: support both `Last-Event-ID` and `starting_after`
- Generator provider boundary: Vercel AI SDK in Phase 1
- `@flow-state-dev/client` required; `@flow-state-dev/react` wraps client (no transport logic in react)

## Sequencer Surface (Phase 1)

- `then`, `thenIf`, `map`, `parallel`, `forEach`, `doUntil`, `doWhile`, `loopBack`, `work`, `waitForWork`, `tap`, `tapIf`, `rescue`, `branch`
- `.work(...)`: non-aborting by default
- `.waitForWork({ failOnError: true })`: promote background failures to terminal request error

## Scope + State

- Scopes: `request -> session -> user -> project`
- State ops (atomic semantics): `patchState`, `setState`, `incState`, `pushState`, `setStateRecord`, `deleteStateRecord`, `atomicState`
- CAS + bounded retries required for contention safety
- `getTarget(name)` (Phase 1): nearest ancestor block instance by execution stack; may return `undefined`

## Streaming

- SSE named events; deterministic ordering by `sequence_number`
- Replay correctness based on persisted items + sequence ordering
- Event categories: request/item/content lifecycle, optional `resource.changed`, debug

## Lifecycle Semantics

- Observational hooks: `onStarted`, `onCompleted`, `onErrored`, `onFinished`
- `onCompleted`: terminal success only
- `onErrored`: terminal failure only
- `onFinished`: always
- `onStepErrored`: non-terminal step/work visibility

## Package Boundaries

- `core`: isomorphic builders/types/items
- `server`: execution/runtime/stores/streaming/routes
- `client`: transport + session/request APIs
- `react`: hooks/renderers only; consume client + core type/item subpaths
- `testing`: deterministic harnesses + mocks
- `cli`: run/inspect/scaffold flows
- `apps/devtool`: dogfood client/react APIs

## Wave Discipline

- Execute waves in order; no skipping dependencies
- Wave close requires:
  - typecheck
  - targeted tests
  - lint/static checks
  - architecture contract spot-check
  - wave changelog + journal updates
  - root `changelog.md` summary update

## Definition Of Done (Phase 1)

- All package contracts compile + match canonical docs
- Tests pass across packages
- Example flows run with item-first streams + explicit `userId`
- CLI commands work end-to-end
- Dev tool runs actions, streams live, replays with both resume modes
- No residual legacy part-model terminology in canonical implementation artifacts
