# @flow-state-dev — Implementation Repo

`@flow-state-dev` is a TypeScript block-based AI workflow framework. This is the active implementation workspace for Phase 1 (Foundation).

## Orientation

**Read first (every session):**
1. `docs/architecture/overview.md` — System architecture and package roles
2. `docs/contributing/architecture-reference.md` — Locked contracts quick reference
3. `AGENTS.md` — Process protocol and code style rules

**Read when relevant:**
- `docs/architecture/*.md` — Deep dives into blocks, flows, state, streaming, execution, etc.
- `docs/contributing/best-practices.md` — Implementation standards (BP-001–BP-009)
- `changelog.md` — What waves have shipped
- `packages/*/README.md` — Per-package API docs

## Package Map

| Package | Purpose |
|---------|---------|
| `@flow-state-dev/core` | Isomorphic builders, type contracts, item taxonomy |
| `@flow-state-dev/server` | Execution runtime, stores, SSE streaming, HTTP routes |
| `@flow-state-dev/client` | Isomorphic API client (actions, sessions, streams) |
| `@flow-state-dev/react` | React hooks and renderers (wraps client) |
| `@flow-state-dev/testing` | Test harnesses and mocks |
| `@flow-state-dev/cli` | Terminal interface (`fsdev`) |
| `apps/devtool` | First-party inspector app |
| `apps/docs` | Documentation site (Docusaurus) |

## Documentation Structure

```
docs/
  architecture/     Framework architecture reference (9 docs)
  contributing/     Development setup, best practices, wave process
  internal/         Wave plans, journals, changelogs (process artifacts)
```

## Key Architectural Constraints

- Block kinds: exactly `handler`, `generator`, `sequencer`, `router`
- Actions are flow-level: `defineFlow({ actions })`
- Required caller input: `userId`
- Streaming: SSE item/content model with sequence-number resume
- Generator provider: Vercel AI SDK in Phase 1
- Lifecycle hooks: past tense (`onStarted`, `onCompleted`, `onErrored`, `onFinished`)
- Package boundary: `react` wraps `client` — no transport logic in react
- Package boundary: `server` never depends on `client` or `react`

## Authority Hierarchy

1. `../preperation/architecture/*` — Canonical specs (highest authority)
2. `docs/architecture/*` — Adapted reference docs
3. `docs/contributing/best-practices.md` — Implementation standards
4. `AGENTS.md` — Process protocol

If docs conflict, `preperation/architecture/*` wins.

## Commands

```bash
pnpm install          # Install all dependencies
pnpm typecheck        # TypeCheck all packages
pnpm test             # Run all tests
pnpm test:watch       # Watch mode
pnpm --filter @flow-state-dev/core test    # Test single package
```

## Current Phase

Phase 1 (Foundation): Waves 1.a–1.k complete. Remaining: 1.l (CLI), 1.m (devtool), 1.n (cross-package validation).
