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
- `getTarget(name)`: state-only escape hatch; resolves nearest-first across dispatched siblings at the current execution level, then falls back to the ancestor parent chain; may return `undefined` or throw `AmbiguousBlockNameError` when multiple ancestors share the same name
- `targetStateSchemas`: typed declaration surface for `ctx.targets.<name>` state handles
- `getBlockOutput(blockDef)`: returns completed output from already-dispatched sibling blocks at the current execution level, otherwise `undefined`
- `getBlockResult(blockDef)`: returns `{status: not_started|running|completed|failed}` for already-dispatched sibling blocks at the current execution level (not ancestor chain), with output/error payload on terminal states

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

## Macro Blocks (Helpers)

Eight pre-built helper factories wrapping generator/handler blocks:

| Macro | Kind | Purpose |
|-------|------|---------|
| `contextReducer` | generator | Context reduction (distill, denoise, compress) |
| `memoryExtractor` | generator | Extract durable memory candidates |
| `decomposer` | generator | Break requests into subtasks with dependency graph |
| `composer` | generator | Assemble coherent output from parts |
| `summarizer` | generator | Summarize at brief/detailed/executive granularity |
| `combiner` | handler | Deterministic artifact merge (no LLM) |
| `synthesizer` | generator | Reconcile overlapping/conflicting inputs |
| `analyzer` | generator | Evaluate artifacts against criteria |
| `intentClassifier` | generator | Classify input into bounded category set for routing |
| `intentRouter` | sequencer | Pre-wired classifier + router for classification-driven branching |

- Access via `helper.<name>(config)` — returns a standard `BlockDefinition`
- All generators default to `"gpt-5-mini"` model
- All macros accept optional `outputSchema` override
- Combiner is the only handler (deterministic, no model)

> [Macro Blocks](../architecture/macros.md)

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
