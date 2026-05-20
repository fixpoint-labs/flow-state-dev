# Development Setup

Guide for setting up the Flow State Dev monorepo for local development.

## Prerequisites

- **Node.js** >= 18 (Node 20+ recommended)
- **pnpm** 10.4.1 (`corepack enable && corepack prepare pnpm@10.4.1`)

## Initial Setup

```bash
git clone https://github.com/fixpoint-labs/flow-state-dev
cd implementation
pnpm install
pnpm typecheck
pnpm test
```

All three commands should pass cleanly before starting any work.

## Monorepo Structure

```
packages/
  core/          Isomorphic builders, types, item taxonomy
  server/        Execution runtime, stores, SSE streaming, routes
  client/        Isomorphic API client (actions, sessions, streams)
  react/         React hooks and renderers
  testing/       Test harnesses and mocks
  cli/           Terminal interface (fsdev)
apps/
  devtool/       First-party inspector app
  docs/          Documentation site (Docusaurus)
  kitchen-sink/  Reference app (hosts chat-agent and future flows)
examples/
  hello-chat/    Minimal canonical chat flow
docs/
  architecture/  Framework architecture reference
  contributing/  This directory
  internal/      Wave plans, journals, process artifacts
```

## Common Commands

| Command | Scope | Purpose |
|---------|-------|---------|
| `pnpm test` | All packages | Run all tests |
| `pnpm typecheck` | All packages | TypeScript type checking |
| `pnpm lint` | All packages | Lint (currently stubbed) |
| `pnpm test:watch` | All packages | Watch mode tests |
| `pnpm --filter @flow-state-dev/core test` | Single package | Test one package |
| `pnpm --filter @flow-state-dev/server typecheck` | Single package | Typecheck one package |
| `pnpm --filter @flow-state-dev/kitchen-sink dev` | App | Run kitchen-sink dev server |


## Versioning and Publishing

This repo uses [Changesets](https://github.com/changesets/changesets) for semver, changelogs, and coordinated workspace version bumps. The contributor walk-through — when to write a fragment, the pre-1.0 discipline, multi-package PRs — lives in [`release-notes-workflow.md`](release-notes-workflow.md).

| Command | Purpose |
|---------|---------|
| `pnpm changeset` | Create a release note for modified publishable packages |
| `pnpm version-packages` | Apply pending changesets to versions + package changelogs |
| `pnpm release` | Build `packages/*` and publish with npm provenance |

### CI release automation

- `.github/workflows/release.yml` runs on `main` and uses `changesets/action` to:
  - open/update a **Version Packages** PR when pending changesets exist
  - publish to npm (with `--provenance`) after the version PR is merged
  - create GitHub releases from generated changelogs
- `.github/workflows/snapshot-release.yml` supports manual snapshot/canary publishing from feature branches via `workflow_dispatch`.

### Required repository secrets

- `NPM_TOKEN`: npm automation token with publish access to `@flow-state-dev` packages

### npm organization checklist

Before first publish, verify the npm org is configured:

- `@flow-state-dev` npm organization exists
- automation token account is a member with publish permissions
- package access defaults to public (or package-level `publishConfig.access` remains `public`)

## Build Order

Packages have a dependency hierarchy. When building from scratch:

```
1. core           (no internal deps)
2. server         (depends on core)
   client         (no internal deps — can build in parallel with server)
3. react          (depends on core + client)
   testing        (depends on core + server)
   devtool        (no internal deps — can build in parallel with react/testing)
4. cli            (depends on core + server + testing; optional peer: devtool)
```

To build the DevTool static assets (for `fsdev dev`), run `pnpm --filter @flow-state-dev/devtool build:assets` after building `apps/devtool`'s dependencies (core, client, react).

Some packages have dependency-aware build scripts that build their upstream deps first.

## Testing

Tests use **Vitest** across all packages:

```bash
# Run all tests
pnpm test

# Run tests for a specific package
pnpm --filter @flow-state-dev/testing test

# Watch mode (all packages)
pnpm test:watch

# Watch mode (single package)
pnpm --filter @flow-state-dev/core test:watch
```

The testing package (`@flow-state-dev/testing`) provides framework-specific harnesses:
- `testBlock`, `testSequencer`, `testRouter`, `testFlow` — block/flow test helpers
- `mockGenerator`, `createMockModelResolver` — generator mocking
- `testItems`, `snapshotTrace` — assertion utilities

## TypeScript Configuration

- `tsconfig.base.json` at the repo root defines base settings and path mappings
- Each package has its own `tsconfig.json` extending the base
- `scripts/typecheck.mjs` provides offline TypeScript checking (handles registry unavailability)

## Key Files to Know

| File | Purpose |
|------|---------|
| `AGENTS.md` | Agent collaboration protocol and code style rules |
| `README.md` | Project overview and onboarding |
| `packages/*/CHANGELOG.md` | Per-package release notes (generated from `.changeset/` fragments) |
| `.changeset/` | Pending release-note fragments; see [`release-notes-workflow.md`](release-notes-workflow.md) |
| `docs/architecture/` | Framework architecture reference |
| `docs/contributing/best-practices.md` | Implementation standards (active BPs listed at top of file) |
| `docs/contributing/architecture-reference.md` | Quick reference for locked contracts |
| `docs/internal/waves/` | Wave plans, journals, changelogs |

## Reference Flows

The best way to understand the framework is to read the reference flows:

- **hello-chat** (`examples/hello-chat/src/flows/hello-chat/flow.ts`): Minimal chat flow showing generator, handler, sequencer, and defineFlow patterns
- **chat-agent** (`apps/kitchen-sink/flows/chat-agent/flow.ts`): Comprehensive example covering all 4 block kinds, router, tools, resources, clientData, and lifecycle hooks

## Package-Level READMEs

Each package has its own README with:
- Package purpose and public API surface
- Quick usage examples
- Package-local scripts

See `packages/*/README.md`.
