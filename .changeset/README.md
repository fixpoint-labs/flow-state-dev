# Changesets

This directory stores release-note fragments. Most PRs don't add one.

`pnpm version-packages` later consumes the fragments, bumps each affected package, appends to per-package `CHANGELOG.md`, and deletes the fragments. Only `README.md` and `config.json` persist between releases.

For the full workflow — when to write a fragment, the pre-1.0 discipline, the multi-package case, common mistakes — see [`docs/contributing/release-notes-workflow.md`](../docs/contributing/release-notes-workflow.md) and [BP-022](../docs/contributing/best-practices.md#bp-022-release-notes-via-changesets).

## When to write one

A changeset is not required by default. Write one when somebody who has installed a published package needs to know: public API, a capability, block, CLI command, hook, environment variable, or config key they call has changed, or behavior they can observe from outside the package has shifted. Name the Linear issue in the body — CI enforces it.

Skip it otherwise, including for anything scoped to a private package (`labs/*`, `examples/*`, `apps/*`, `packages/ui`, `packages/integration-tests`, `plugins/*`, `goals`). Say "no changeset needed" in the PR description if a reviewer might wonder. `pnpm changeset --empty` still works and still flips `changeset-bot` green, but it is a convenience, not an obligation.

## Pre-1.0 discipline

Packages are all `0.x.y`. Changesets has no built-in pre-1.0 mode — a `major` against `0.x.y` bumps straight to `1.0.0`. Until the first launch, pick `patch` for a change no consumer's existing code can trip over (bug fixes, additive API) and `minor` for anything that can break them. **Never `major`.** If you believe a change warrants `major`, raise it in the PR and a maintainer will decide.

## Writing one

```bash
pnpm changeset
```

The picker shows publishable `@flow-state-dev/*` packages plus `@thought-fabric/core`; `config.json` sets `privatePackages: { version: false }`, so every `private: true` package is filtered out. Pick the ones this PR actually affects, choose `patch` or `minor`, and write a single user-facing sentence. The CLI saves `.changeset/<random>.md`. Commit it with the PR.

Fragment format:

```md
---
"@flow-state-dev/<package>": patch
---

One-sentence user-facing description (FIX-123). Multi-paragraph or
migration notes are fine when warranted.
```

Don't hand-write one that names a private package: a fragment mixing a skipped package with a publishable one fails the entire release run, not just that fragment.

## The pre-release archive

The 422 fragments written before the first publish are archived at [`docs/internal/archive/changesets/`](../docs/internal/archive/changesets/README.md). They were never released and are not release notes.

## Releasing on `main`

`.github/workflows/release.yml` runs `changesets/action@v1` after each merge to `main`. When pending fragments exist it opens (or updates) a "Version Packages" PR; merging that PR triggers `pnpm release:ci`, which publishes to npm with provenance and creates GitHub Releases from each package's `CHANGELOG.md`.

## Snapshot releases

Use `.github/workflows/snapshot-release.yml` (`workflow_dispatch`) from a feature branch to publish canary builds with npm dist-tags.
