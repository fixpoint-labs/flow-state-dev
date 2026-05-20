# Changesets

This directory stores release-note fragments. Every PR with user-facing impact ships one.

`pnpm version-packages` later consumes the fragments, bumps each affected package, appends to per-package `CHANGELOG.md`, and deletes the fragments. Only `README.md` and `config.json` persist between releases.

For the full workflow — when to write a fragment, the pre-1.0 discipline, the multi-package case, common mistakes — see [`docs/contributing/release-notes-workflow.md`](../docs/contributing/release-notes-workflow.md) and [BP-022](../docs/contributing/best-practices.md#bp-022-release-notes-via-changesets).

## When to write one

Write a changeset whenever a PR changes anything end users observe: public API, capability, block, CLI command, hook, environment variable, config key, or runtime behavior.

Skip the changeset for internal-only changes (refactors, test-only edits, internal helpers, infra). State that explicitly in the PR description, or run `pnpm changeset --empty` and commit the resulting empty fragment so `changeset-bot` flips to green automatically.

## Pre-1.0 discipline

Packages are all `0.x.y`. Changesets has no built-in pre-1.0 mode — a `major` against `0.x.y` bumps straight to `1.0.0`. Until the first launch, pick `patch` for non-breaking changes and `minor` for new capabilities or breaking changes. **Never `major`.** If you believe a change warrants `major`, raise it in the PR and a maintainer will decide.

## Writing one

```bash
pnpm changeset
```

The picker shows publishable `@flow-state-dev/*` packages plus `@thought-fabric/core`. Pick the ones this PR actually affects, choose `patch` or `minor`, and write a single user-facing sentence. The CLI saves `.changeset/<random>.md`. Commit it with the PR.

Fragment format:

```md
---
"@flow-state-dev/<package>": patch
---

One-sentence user-facing description. Multi-paragraph or migration notes
are fine when warranted.
```

## Releasing on `main`

`.github/workflows/release.yml` runs `changesets/action@v1` after each merge to `main`. When pending fragments exist it opens (or updates) a "Version Packages" PR; merging that PR triggers `pnpm release:ci`, which publishes to npm with provenance and creates GitHub Releases from each package's `CHANGELOG.md`.

The release-PR step uses `CHANGESETS_RELEASE_TOKEN`, a repository secret backed by a PAT or GitHub App token that can open pull requests. If that secret is absent, the workflow leaves a notice and skips PR creation instead of failing unrelated `main` builds.

## Snapshot releases

Use `.github/workflows/snapshot-release.yml` (`workflow_dispatch`) from a feature branch to publish canary builds with npm dist-tags.
