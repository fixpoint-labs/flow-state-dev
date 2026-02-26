# flow-state-dev (Implementation Workspace)

`@flow-state-dev` is a block-based AI workflow framework focused on typed flows, resumable streaming, and predictable execution behavior.

This repository is the active implementation workspace for Phase 1.

## Why this project exists

Building AI features often means stitching together orchestration, retries, streaming, state, and UI glue in app-specific ways.  
`@flow-state-dev` aims to make those concerns first-class framework primitives so teams can ship faster with less runtime drift.

## Why this repo may be worth your time

- You want a framework that doesn't prebake the patterns that you use to implement agentic systems, but instead the primitives that allow you to build your own.
- You want a typed flow model, not ad-hoc handler chains.
- You want advanced state and memory management for your agentic workflows and agents.
- You care about execution semantics (retry, rescue, lifecycle) being explicit and testable.
- You want item-first streaming with replay/resume, not one-off transport wiring.
- You want one stack across server, client, React UI, CLI, and tests.

## Current maturity (Phase 1)

- Core contracts and block builders are implemented.
- Server execution, stores, and streaming runtime are implemented.
- Client transport/session/SSE APIs are implemented and tested.
- React hook wrappers, renderer registry, and item render helpers are implemented and tested.
- Testing package APIs are implemented and validated.
- Canonical Wave K example flows are implemented in:
  - `examples/hello-chat/src/flows/hello-chat/flow.ts`
  - `examples/kitchen-sink/src/flows/kitchen-sink/flow.ts`
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
- `examples/hello-chat`: minimal canonical chat flow example.
- `examples/kitchen-sink`: comprehensive canonical feature-reference flow example.

## Repository layout

```text
packages/
  core/               # Isomorphic builders, type contracts, item taxonomy
  server/             # Action runtime, stores, SSE streaming
  client/             # Isomorphic HTTP/SSE transport client
  react/              # React hooks, renderers, context providers
  testing/            # Test harnesses for blocks, flows, generators
  cli/                # fsdev CLI for running/inspecting flows
apps/
  devtool/            # First-party inspector app
  docs/               # Docusaurus documentation site
examples/
  hello-chat/         # Minimal canonical chat flow
  kitchen-sink/       # Comprehensive feature-reference flow
docs/
  architecture/       # Framework developer reference (9 topic docs)
  contributing/       # Standards, setup, process docs
  internal/           # Wave plans, journals, changelogs
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

1. Read architecture overview: `docs/architecture/overview.md`
2. Browse topic docs: `docs/architecture/` (blocks, flows, state, streaming, etc.)
3. Review current progress: `changelog.md`
4. Review standards: `docs/contributing/best-practices.md`
5. For canonical edge cases: `../preperation/architecture/`

## Documentation map

**Architecture reference** (`docs/architecture/`):
- [Overview](docs/architecture/overview.md) — package structure, core abstractions, data flow
- [Blocks](docs/architecture/blocks.md) — handler, generator, sequencer, router
- [Flows and Actions](docs/architecture/flows-and-actions.md) — defineFlow, actions, lifecycle
- [State and Scopes](docs/architecture/state-and-scopes.md) — 4 scopes, state ops, CAS
- [Streaming](docs/architecture/streaming.md) — item/content model, SSE protocol, resume
- [Execution and Errors](docs/architecture/execution-and-errors.md) — retry, rescue, work queue
- [Resources and Projections](docs/architecture/resources-and-projections.md) — typed data management
- [Sequencer DSL](docs/architecture/sequencer-dsl.md) — full method reference
- [Server and Client](docs/architecture/server-and-client.md) — routes, transport, React hooks

**Contributing** (`docs/contributing/`):
- [Best Practices](docs/contributing/best-practices.md) — implementation standards (BP-001–BP-009)
- [Architecture Reference](docs/contributing/architecture-reference.md) — locked contracts quick reference
- [Development Setup](docs/contributing/development-setup.md) — monorepo setup and workflow
- [Wave Process](docs/contributing/wave-process.md) — wave execution protocol

**Other**:
- Canonical architecture (authoritative for edge cases): `../preperation/architecture/`
- Package READMEs: `packages/*/README.md`
- Example READMEs: `examples/*/README.md`
- Changelog: `changelog.md`
- Agent protocol: `AGENTS.md`

## Contributing notes

- Keep onboarding-relevant changes reflected in this README.
- Keep implementation standards in `docs/contributing/best-practices.md`.
- Keep wave/process protocol in `AGENTS.md` (not in README).
- See `AGENTS.md` for the full documentation maintenance protocol.
