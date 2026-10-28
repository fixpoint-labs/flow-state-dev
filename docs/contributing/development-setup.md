# Development Setup

Guide for setting up the Flow State Dev monorepo for local development.

## Prerequisites

- **Node.js** >= 22
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

`pnpm install` also installs a pre-push git hook (husky, `.husky/pre-push`) that
runs `pnpm lint`, then the retired-term guard and the one-word-per-thing sweep, and
blocks the push if any fails. The first lint run takes about a minute. Later runs
still walk the whole repo, but ESLint's cache skips files that have not changed, so
they take a few seconds. The two vocabulary checks take a second or two each.

> Run `pnpm packages:build` once after cloning. Workspace packages resolve
> their `types` condition to `./dist/*.d.ts`, so without it VS Code / `tsserver`
> reports "Cannot find module '@flow-state-dev/…'" on workspace imports. The
> Next dev server doesn't need it (it consumes source), but your editor does.

## Monorepo Structure

```
packages/
  core/          Isomorphic builders, types, item taxonomy
  engine/        Execution runtime, stores, SSE streaming, routes
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
| `pnpm lint` | Whole repo | ESLint over every JS/TS file, tests and goals included (`eslint.config.mjs`). Also runs as the pre-push hook |
| `pnpm test:watch` | All packages | Watch mode tests |
| `pnpm --filter @flow-state-dev/core test` | Single package | Test one package |
| `pnpm --filter @flow-state-dev/engine typecheck` | Single package | Typecheck one package |
| `pnpm --filter @flow-state-dev/kitchen-sink dev` | App | Run kitchen-sink dev server |


## OMP development sessions

OMP uses the shared development skills, with native agents in `.omp/agents/` and
model-role mappings in `.omp/config.yml`. Restart OMP after changing these files.
The shared `review` skill includes the native mixed-model dispatch path.

Writing workers use isolated checkouts and return patches for deliberate integration;
automatic application is disabled. An isolation preparation failure stops the worker.
Do not bypass it by sending the same writing task into the shared checkout.

Advisor selection and activation are separate: `/advisor status` reports the live
state; `/advisor on` enables it for the session.

At substantive session start, top-level sessions follow the `agent-mailbox` skill
and state the relevant handle(s), or why none is relevant. Local delivery requires
an authenticated `gh` CLI with access to `fixpoint-labs/agent-mailbox`.

| Command | Purpose |
|---------|---------|
| `/mailbox subscribe <pr> <subscriber>` | Subscribe to a handle; addressed backlog arrives as an inbound follow-up |
| `/mailbox status` | Inspect subscriptions, errors, and the session's posting identity |
| `/mailbox unsubscribe <pr>` | Stop watching a handle |

For delivery, session persistence, and subscription semantics, see
[`agent-mailbox` → Native OMP](../../.agents/skills/agent-mailbox/SKILL.md#native-omp).

Mailbox regressions: `node --test .omp/test/mailbox.test.mjs`.

## Versioning and Publishing

This repo uses [Changesets](https://github.com/changesets/changesets) for semver, changelogs, and coordinated workspace version bumps. The contributor walk-through — when to write a fragment, the pre-1.0 discipline, multi-package PRs — lives in [`release-notes-workflow.md`](release-notes-workflow.md). The full publish runbook (CI pipeline, snapshots, first-publish ceremony) is in [`RELEASING.md`](RELEASING.md).

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
running multiple packages' vitests at once oversubscribes the machine and makes
tests flake on the default 5s timeout. Serial execution still benefits from
turbo's caching (unchanged packages are skipped). Build and typecheck stay fully
parallel.

CI gets its parallelism from runners instead: the `Test (n/3)` jobs each run a
shard of the packages serially, split by `scripts/test-shards.mjs`. Its named
shards hold the slowest packages; the last shard is every other package, so a
new package needs no entry. Rebalance the named shards when one job runs much
longer than the others. `Typecheck & Test` stays the single check to require:
it passes only when the typecheck and every shard pass.

### Dead code and duplication

The `Fallow` CI job runs [fallow](https://fallow.tools) against
`.fallowrc.json` in three steps:

- **Every run, whole tree:** `pnpm fallow:ci` fails on an import that doesn't
  resolve or a package imported without being declared in that workspace's
  `package.json`.
- **PRs only:** `pnpm fallow:new-dead-code <PR base>` fails on an unused file,
  export, type or dependency the PR leaves anywhere in the tree, including an
  export in a file the PR never touched whose last caller it deleted. What's
  already on the base doesn't count, so the backlog never blocks a PR.
- **PRs only:** `pnpm fallow:audit --base <PR base>` lists new duplicated
  blocks and complexity findings in the changed files, without failing.

Run the dead-code check locally with `pnpm fallow:new-dead-code origin/main` on
a clean working tree (it checks out the base briefly to analyze it). When it
fails, remove the dead export or file. If a finding is wrong, suppress that one
line with a reason (`// fallow-ignore-next-line unused-export -- loaded by path
from X`). If the tool can't see an entry point at all, add it to `entry` or
`dynamicallyLoaded` in the config instead. `pnpm fallow` prints the whole
backlog.

You don't order builds by hand. The one explicit edge in `turbo.json` is
`@flow-state-dev/engine#build`, pinned to `core` only: `testing` is a dev-only
dependency of `engine`, so the default graph traversal would otherwise see a
`engine ⇄ testing` cycle.

A test task's cache key covers only its own package's files. A test that reads
a file outside the package, such as a docs page it quotes, must declare that
file in the package's own `turbo.json` (`"extends": ["//"]`, then
`tasks.test.inputs: ["$TURBO_DEFAULT$", "$TURBO_ROOT$/<path>"]`). Without it, an
edit to that file alone replays the cached pass, and CI goes green on a test
that fails. `packages/workforce` and two guide examples under
`examples/guides/` do this for the `apps/docs` pages their tests read.

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

### Redis in CI

`test` and `packed-install` share `&redis_service` in `.github/workflows/ci.yml`.
BullMQ cases fail rather than skip when `CI` is set and that service is missing.
The image is official `redis`, pinned by tag and index digest
(`redis:7.4.12@sha256:…`). To bump it, run
`docker buildx imagetools inspect redis:<tag>` and put the `Digest:` line on
that anchor.

### Type-level assertions

Type-level assertions (`expectTypeOf`, a `// @ts-expect-error` with its reason, an `Assert<…>` helper) go in whichever test file they belong to: a `.test.ts`, a `.test-d.ts`, or a `.type-test.ts` under the package's `test/`. Vitest strips types, so it never fails them; `pnpm typecheck` compiles every one of those files and fails on a wrong one. When you add an assertion, prove it can fail once: negate it (add or drop `.not`, change the asserted type, or delete the directive), run `pnpm --filter <package> typecheck`, see it fail on that line, then put it back. Workforce's `.test.ts` files are not compiled yet, so a type assertion there goes in a `.test-d.ts` for now. How test files are compiled and guarded (`tsconfig.test.json`, `scripts/validate-test-typecheck.mjs`, its `DEFERRED` list) is under [TypeScript Configuration](#typescript-configuration).

### Shared module cache

`engine`, `core`, `orchestration` and `integration-tests` run their test files on
a shared module cache (`isolate: false`) instead of re-importing every file's
module graph, which was most of their run time. The split lives in
`scripts/vitest-isolation.mjs`:

- A file that calls `vi.mock` or `vi.doMock` runs isolated automatically. A mock
  only takes effect on a module's first import, so it needs a fresh cache.
- A file that depends on module state another file changes first (a warn-once
  flag, a module-level registry) goes in that package's `alsoIsolate` list in
  its `vitest.config.ts`.

If a test in one of these packages passes on its own but fails in the full run,
it is the second kind: restore the state it changes, or add the file to
`alsoIsolate`. `vitest run --sequence.shuffle.files` reproduces order-dependent
failures.

The testing package (`@flow-state-dev/testing`) provides framework-specific harnesses:
- `testBlock`, `testSequencer`, `testRouter`, `testFlow` — block/flow test helpers
- `mockGenerator`, `createMockModelResolver` — generator mocking
- `testItems`, `snapshotTrace` — assertion utilities

## TypeScript Configuration

- `tsconfig.base.json` at the repo root defines base settings and path mappings
- Each package has its own `tsconfig.json` extending the base
- `scripts/typecheck.mjs` runs `tsc --noEmit` for one package; it requires the root TypeScript install, and fails with a message naming `pnpm install` when that is missing
- Test files are typechecked too. A package's `tsconfig.json` is its build config and covers `src` only; its `tsconfig.test.json` extends it with `composite: false`, `rootDir: "../.."` and `noEmit: true`, and includes `src` and `test`. `scripts/typecheck.mjs` runs `tsconfig.test.json` after `tsconfig.json` when the file exists; that list is `scripts/typecheck-programs.mjs`, which the guard below reads too. Copy `packages/core/tsconfig.test.json` for a new package
- `scripts/validate-test-typecheck.mjs`, chained into root `pnpm typecheck`, fails when a tracked test file is outside every program that package's typecheck compiles. Name a package still waiting in its `DEFERRED` list with the issue that wires it, and remove the entry once the package is covered
- In a test, say a deliberate partial mock with `as unknown as T` or a typed helper, and mark deliberately invalid input with `// @ts-expect-error` and the reason. Don't clear errors with `@ts-nocheck` or `@ts-ignore`

## Key Files to Know

| File | Purpose |
|------|---------|
| `AGENTS.md` | Agent collaboration protocol and code style rules |
| `README.md` | Project overview and onboarding |
| `packages/*/CHANGELOG.md` | Per-package release notes (generated from `.changeset/` fragments) |
| `.changeset/` | Pending release-note fragments; see [`release-notes-workflow.md`](release-notes-workflow.md) |
| `docs/contributing/RELEASING.md` | Publish runbook (CI pipeline, snapshots, first-publish ceremony) |
| `docs/architecture/` | Framework architecture reference |
| `docs/contributing/best-practices.md` | Implementation standards (active BPs listed at top of file) |
| `docs/contributing/architecture-reference.md` | Quick reference for locked contracts |
| `docs/internal/waves/` | Wave plans, journals, changelogs |

## Reference Flows

The best way to understand the framework is to read the reference flows:

- **hello-chat** (`examples/hello-chat/src/flows/hello-chat/flow.ts`): Minimal chat flow showing generator, handler, sequencer, and defineFlow patterns
- **chat-agent** (`apps/kitchen-sink/flows/chat-agent/flow.ts`): Comprehensive example: generators with tools, routing, resources, clientData, and lifecycle hooks

## Package-Level READMEs

Each package has its own README with:
- Package purpose and public API surface
- Quick usage examples
- Package-local scripts

See `packages/*/README.md`.
