# flow-state-dev (Implementation Workspace)

`@flow-state-dev` is a block-based AI workflow framework focused on typed flows, resumable streaming, and predictable execution behavior.

This repository is the active implementation workspace for Phase 1.

## Why this project exists

Building AI features often means stitching together orchestration, retries, streaming, state, and UI glue in app-specific ways.  
`@flow-state-dev` aims to make those concerns first-class framework primitives so teams can ship faster with less runtime drift.

## Why this repo may be worth your time

- You want a typed flow model, not ad-hoc handler chains.
- You care about execution semantics (retry, rescue, lifecycle) being explicit and testable.
- You want item-first streaming with replay/resume, not one-off transport wiring.
- You want one stack across server, client, React UI, CLI, and tests.

## Current maturity (Phase 1)

- Core contracts and block builders are implemented.
- Server execution, stores, and streaming runtime are implemented.
- Client transport/session/SSE APIs are implemented and tested.
- React hook wrappers, renderer registry, and item render helpers are implemented and tested.
- Testing package APIs are implemented and validated.
- CLI/devtool packages remain in active implementation.

This is an implementation-phase repository, not a polished production release yet.

## Core concepts

- **Flow**: declared via `defineFlow`, with flow-level `actions`.
- **Block kinds**: exactly `handler`, `generator`, `sequencer`, `router`.
- **Generator**: loop-capable runtime unit with framework-managed execution.
- **Scopes**: request/session/user/project state + resource updates.
- **Execution entrypoint**: blocks execute via framework-owned `block.run(...)`.
- **Streaming model**: item/content lifecycle events with sequence-based replay.
- **Execution model**: normalized errors, retry policy, rescue routing, work convergence.

## Package map

- `@flow-state-dev/core`: builders, contracts, item/event taxonomy.
- `@flow-state-dev/server`: action runtime, stores, SSE streaming, orchestration.
- `@flow-state-dev/client`: isomorphic action/session/stream API client.
- `@flow-state-dev/react`: hooks and render/runtime bindings.
- `@flow-state-dev/testing`: flow/block/runtime test harnesses.
- `@flow-state-dev/cli`: `fsdev` CLI for running/inspecting flows.
- `apps/devtool`: first-party inspector app using public framework APIs.

## Repository layout

```text
packages/
  core/
  server/
  client/
  react/
  testing/
  cli/
apps/
  devtool/
docs/
  BEST_PRACTICES.md
  ARCHITECTURE_CHEAT_SHEET.compact.md
  waves/
```

## Quick start

### Prerequisites

- Node.js `>=18` (Node 20+ recommended)
- `pnpm@10.4.1`

### Setup

```bash
pnpm install
pnpm typecheck
pnpm test
```

### Common commands

- Run all tests: `pnpm test`
- Run all typechecks: `pnpm typecheck`
- Watch tests: `pnpm test:watch`
- Test one package: `pnpm --filter @flow-state-dev/server test`
- Typecheck one package: `pnpm --filter @flow-state-dev/core typecheck`

## Start here (new contributors)

1. Read architecture summary: `docs/ARCHITECTURE_CHEAT_SHEET.compact.md`
2. Check canonical specs: `../preperation/architecture/`
3. Review current progress: `changelog.md`
4. Review standards: `docs/BEST_PRACTICES.md`

## Documentation map

- Canonical architecture (authoritative): `../preperation/architecture/`
- Implementation plan: `../preperation/architecture/IMPLEMENTATION_PLAN.md`
- Package docs:
  - `packages/server/README.md`
  - `packages/client/README.md`
  - `packages/react/README.md`
  - `packages/testing/README.md`
- Best practices (living): `docs/BEST_PRACTICES.md`
- Changelog: `changelog.md`
- Agent collaboration protocol: `AGENTS.md`

## Contributing notes

- Keep onboarding-relevant changes reflected in this README.
- Keep implementation standards in `docs/BEST_PRACTICES.md`.
- Keep wave/process protocol in `AGENTS.md` (not in README).
