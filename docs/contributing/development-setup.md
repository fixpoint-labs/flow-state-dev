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
pnpm packages:build   # emit dist/*.d.ts so the editor's TS server resolves workspace imports
pnpm typecheck
pnpm test
```

These commands should pass cleanly before starting any work.

> Run `pnpm packages:build` once after cloning. Workspace packages resolve
> their `types` condition to `./dist/*.d.ts`, so without it VS Code / `tsserver`
> reports "Cannot find module '@flow-state-dev/…'" on workspace imports. The
> Next dev server doesn't need it (it consumes source), but your editor does.

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

- `CHANGESETS_TOKEN`: release automation token with repository contents and pull request write access
- `NPM_TOKEN`: npm automation token with publish access to `@flow-state-dev` packages

### npm organization checklist

Before first publish, verify the npm org is configured:

- `@flow-state-dev` npm organization exists
- automation token account is a member with publish permissions
- package access defaults to public (or package-level `publishConfig.access` remains `public`)

## Builds and the dev loop

Builds run through [Turborepo](https://turborepo.dev). It derives task ordering
from the workspace dependency graph (`dependsOn: ["^build"]`), runs independent
tasks in parallel, and caches task output — an unchanged rebuild is a near-
instant cache hit instead of a full recompile.

| Command | Purpose |
|---------|---------|
| `pnpm packages:build` | Build every `packages/*` to `dist` (typecheck/publish input) |
| `pnpm build` | Build the whole workspace, including apps |
| `pnpm typecheck` | Typecheck all packages (builds deps first, from cache) |
| `pnpm test` | Run all tests (turbo `--concurrency=1` — see below) |

`pnpm test` runs package test tasks **serially** (`--concurrency=1`). Each
package's vitest already parallelizes across its own files using all cores;
running multiple packages' vitests at once oversubscribes CI runners and makes
tests flake on the default 5s timeout. Serial execution matches the prior
`pnpm -r test` behavior and still benefits from turbo's caching (unchanged
packages are skipped). Build and typecheck stay fully parallel.

You don't order builds by hand. The one explicit edge in `turbo.json` is
`@flow-state-dev/server#build`, pinned to `core` only: `testing` is a dev-only
dependency of `server`, so the default graph traversal would otherwise see a
`server ⇄ testing` cycle.

To build the DevTool static assets (for `fsdev dev`), run
`pnpm --filter @flow-state-dev/devtool build:assets`. It builds the DevTool app
and its workspace dependencies through Turborepo, so no prior build step is
needed.

### Source consumption in dev

Apps and examples consume workspace packages as **TypeScript source**, not built
`dist`. Each package's `package.json` `exports` point at `./src` in the
workspace; the `dist` build is swapped in at publish time via `publishConfig`
(verify with `pnpm pack`). The `types` condition stays on the built `.d.ts` so
consumers type-check against clean declarations rather than recompiling
dependency source.

The upshot: running an app (`pnpm --filter @flow-state-dev/kitchen-sink dev`)
needs no package build, and editing a package reflects in the running app via
Next's HMR with no rebuild step. Next transpiles workspace source via
`transpilePackages`, derived from the workspace in each app's `next.config.mjs`
so the list can't drift.

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
