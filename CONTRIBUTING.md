# Contributing to flow-state-dev

Thanks for your interest in contributing. This is a TypeScript monorepo implementing the flow-state-dev framework.

## Before you start

Read these first:

- [`AGENTS.md`](AGENTS.md) — Process protocol and code style rules
- [`docs/contributing/best-practices.md`](docs/contributing/best-practices.md) — Implementation standards (active BPs listed at top of file)
- [`docs/architecture/overview.md`](docs/architecture/overview.md) — System architecture and package roles
- [`docs/contributing/development-setup.md`](docs/contributing/development-setup.md) — Monorepo workflow
- [`docs/contributing/release-notes-workflow.md`](docs/contributing/release-notes-workflow.md) — When and how to write a changeset

## Setup

```bash
# Prerequisites: Node.js >=18, pnpm@10.4.1
pnpm install
pnpm typecheck
pnpm test
```

## Package structure

| Package | Purpose |
|---------|---------|
| `@flow-state-dev/core` | Block builders, type contracts, item taxonomy |
| `@flow-state-dev/engine` | Execution runtime, stores, SSE streaming, HTTP routes |
| `@flow-state-dev/client` | Isomorphic API client |
| `@flow-state-dev/react` | React hooks and renderers |
| `@flow-state-dev/testing` | Test harnesses and generator mocks |
| `@flow-state-dev/cli` | Terminal interface (`fsdev`) |

## Key constraints

The architecture has locked contracts. Don't change these without explicit discussion:

- Block kinds: exactly `handler`, `generator`, `sequencer`, `router`
- Actions are flow-level: `defineFlow({ actions })`
- Required caller input: `userId`
- Lifecycle hooks: past tense (`onStarted`, `onCompleted`, `onErrored`, `onFinished`)
- `server` never depends on `client` or `react`
- `react` wraps `client` — no transport logic in react

## Submitting changes

1. Open an issue to discuss significant changes before implementing
2. Keep PRs focused — one concern per PR
3. Include tests for new behavior
4. Run `pnpm typecheck && pnpm test` before submitting
5. Follow the code style in `AGENTS.md`
6. Run `pnpm changeset` if the change has user-facing impact (see [`docs/contributing/release-notes-workflow.md`](docs/contributing/release-notes-workflow.md)). Internal-only PRs can skip this — state that in the PR description or commit an empty fragment via `pnpm changeset --empty`.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Be respectful.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
