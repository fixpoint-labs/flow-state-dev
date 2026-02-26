# Wave Process

Waves are the framework's unit of incremental delivery. Each wave has a letter identifier (e.g., 1.a, 1.b) and delivers a specific milestone within a phase.

## Wave Structure

Each wave produces three artifacts under `docs/internal/waves/wave-1/`:

| File | Purpose |
|------|---------|
| `wave-1.<letter>.md` | **Plan** — objective, scope, task breakdown, deliverables, verification gates |
| `wave-1.<letter>-journal.md` | **Journal** — execution record of what was actually done |
| `wave-1.<letter>-changelog.md` | **Changelog** — delta summary of changes |

A wave template is available at `docs/internal/waves/WAVE_TEMPLATE.md`.

## Wave Lifecycle

### 1. Planning

Create `wave-1.<letter>.md` with:
- **Objective**: What this wave achieves
- **Scope**: Files, packages, and systems affected
- **Tasks**: Numbered breakdown of work items
- **Deliverables**: Concrete outputs with verification commands
- **Verification gates**: Commands that must pass before wave close

### 2. Execution

Work through tasks sequentially. During execution:
- Keep the wave journal updated with decisions and observations
- Track any deviations from the plan
- Flag gaps or discoveries for future waves

### 3. Close-Out

Before declaring a wave complete, all of these must pass:

- [ ] `pnpm typecheck` — all packages
- [ ] `pnpm test` — targeted tests for the wave's deliverables
- [ ] Lint/static checks pass
- [ ] Architecture contract spot-check against `docs/architecture/`
- [ ] Wave changelog and journal updated
- [ ] Root `changelog.md` updated with concise summary

## Wave Completion Record

Current state (Phase 1):

| Wave | Status | Key Deliverables |
|------|--------|------------------|
| 1.a | Complete | Workspace scaffolding, package setup, tooling |
| 1.b | Complete | Core type contracts, item/stream models |
| 1.c | Complete | Block runtime builders |
| 1.d | Complete | defineFlow, flow actions, generator tools |
| 1.e | Complete | Server context, stores, CAS, state ops |
| 1.f | Complete | Streaming (SSE, emitter, replay, seams) |
| 1.g | Complete | Error model, execution engine (retry, rescue, work) |
| 1.h | Complete | Flow registry, routes, HTTP handlers |
| 1.i | Complete | Client APIs, React hooks/components |
| 1.j | Complete | Testing harness |
| 1.k | Complete | Example flows, AI SDK resolver |
| 1.l | Pending | CLI package implementation |
| 1.m | Pending | DevTool app implementation |
| 1.n | Pending | Cross-package validation |

## Rules

- Waves execute in order — no skipping dependencies
- Every implementation change must map to a wave task (BP-002)
- Wave labels must NOT appear in runtime code or tests (BP-006)
- Documentation updates ship in the same change set as code changes
- The `preperation/architecture/IMPLEMENTATION_PLAN.md` tracks the canonical wave sequence
