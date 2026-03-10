# Changesets

This directory stores release notes for package changes in the monorepo.

## Creating a changeset

Run:

```bash
pnpm changeset
```

Pick one or more publishable `@flow-state-dev/*` packages and choose the semver bump (`patch`, `minor`, or `major`).

## Releasing on `main`

The `release.yml` workflow automatically opens/updates a Version Packages PR and publishes when it is merged to `main`.

## Snapshot releases

Use the `snapshot-release.yml` workflow (`workflow_dispatch`) from a feature branch to publish canary builds with npm dist-tags.
