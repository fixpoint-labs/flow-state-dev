# Architecture Quick Reference

Compact reference for locked contracts and key decisions. For detailed explanations, see the full architecture docs in `docs/architecture/`.

## Authority Order

1. `preperation/architecture/*` — Canonical specs (highest authority)
2. `docs/architecture/*` — Adapted reference docs (this repo)
3. `docs/contributing/best-practices.md` — Implementation standards
4. `AGENTS.md` — Process protocol

Conflict rule: `preperation/architecture/*` wins.

## Locked Contracts (Phase 1)

- Block kinds only: `handler`, `generator`, `sequencer`, `router` → [Blocks](../architecture/blocks.md)
- Actions are flow-level only (`defineFlow({ actions })`) → [Flows](../architecture/flows-and-actions.md)
- Required caller input: `userId`
- Stream model: item/content lifecycle; no part-envelope model → [Streaming](../architecture/streaming.md)
- Stream cursor: `${requestId}:${sequence_number}`
- Resume paths: both `Last-Event-ID` and `starting_after`
- Generator provider boundary: Vercel AI SDK in Phase 1
- `@flow-state-dev/client` required; `@flow-state-dev/react` wraps client (no transport logic)

## Sequencer Surface (14 methods)

`then`, `thenIf`, `map`, `parallel`, `forEach`, `doUntil`, `doWhile`, `loopBack`, `work`, `waitForWork`, `tap`, `tapIf`, `rescue`, `branch`

- `.work(...)`: non-aborting by default
- `.waitForWork({ failOnError: true })`: promote background failures to terminal request error

→ [Sequencer DSL](../architecture/sequencer-dsl.md)

## Scopes and State

- Hierarchy: `request → session → user → project` → [State and Scopes](../architecture/state-and-scopes.md)
- State ops (atomic): `patchState`, `setState`, `incState`, `pushState`, `setStateRecord`, `deleteStateRecord`, `atomicState`
- CAS + bounded retries for concurrency safety
- `getTarget(name)`: resolves nearest-first across dispatched siblings at the current execution level, then falls back to the ancestor parent chain; may return `undefined` or throw `AmbiguousBlockNameError` when multiple ancestors share the same name

## Streaming

- SSE named events; deterministic ordering by `sequence_number`
- Replay correctness: persisted items + sequence ordering
- Event categories: request/item/content lifecycle, optional `resource.changed`, debug

→ [Streaming](../architecture/streaming.md)

## Lifecycle Hooks

| Hook | When |
|------|------|
| `onStarted` | Request begins |
| `onCompleted` | Terminal success only |
| `onErrored` | Terminal failure only |
| `onFinished` | Always |
| `onStepErrored` | Non-terminal step/work visibility |

→ [Execution and Errors](../architecture/execution-and-errors.md)

## Package Boundaries

| Package | Role | Key constraint |
|---------|------|----------------|
| `core` | Isomorphic builders/types/items | No platform-specific code |
| `server` | Execution/runtime/stores/streaming/routes | No dependency on react or client |
| `client` | Transport + session/request APIs | No dependency on server or react |
| `react` | Hooks/renderers only | Wraps client; no transport logic |
| `testing` | Deterministic harnesses + mocks | Uses core + server |
| `cli` | Run/inspect/scaffold flows | Uses core + server + testing |
| `apps/devtool` | Inspector app | Public APIs only (client + react) |

→ [Architecture Overview](../architecture/overview.md)

## Resources and Projections

- Concrete resources are persisted, attached to scopes
- Projections are derived views; `client: true` exposes to client
- Generator context should use `projection(...)` references, not raw state
- `defineResource()` / `defineProjection()` for portable declarations
- Blocks declare resources via `sessionResources`, `userResources`, `projectResources` (using `defineResource()` values)
- Sequencers collect `declaredResources` from all child blocks automatically
- `defineFlow` merges block-declared resources into flow scope configs; flow-level wins over block-level
- Same `defineResource()` reference across blocks = no conflict; different references for same name = build-time error

→ [Resources and Projections](../architecture/resources-and-projections.md)

## Definition of Done (Phase 1)

- All package contracts compile + match canonical docs
- Tests pass across packages
- Example flows run with item-first streams + explicit `userId`
- CLI commands work end-to-end
- Dev tool runs actions, streams live, replays with both resume modes
- No residual legacy part-model terminology
