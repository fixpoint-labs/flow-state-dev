# Release notes workflow

For the end-to-end publish process and runbook, see [RELEASING.md](./RELEASING.md).

When you submit a PR, you write a changeset. This page covers when to do it, how to do it, and what happens to the fragment after merge.

The authoritative rule is [BP-022](best-practices.md#bp-022-release-notes-via-changesets). This doc is the longer walk-through that BP-022 links to.

## When to write a changeset

Write one whenever the PR changes anything end users observe.

| Change | Changeset? | Which packages |
|---|---|---|
| New / changed public API, capability, block, CLI command, hook, env var, config key | Yes | every package whose published surface or behavior shifts |
| Bug fix that changes observable behavior (return value, emitted item, error message users key off) | Yes | the package whose behavior changed |
| Internal refactor, test-only change, internal helper, infra, docs-only edit, type-only tightening behind a public surface | No | — |
| Workflow file, lint config, repo-root tooling | No | — |

When in doubt, write one. A noisy changeset is easier to fix in review than a missing one is to add later.

For internal-only PRs you have two options:

- State "no changeset needed" in the PR description. A reviewer verifies the claim.
- Run `pnpm changeset --empty` and commit the resulting fragment. `changeset-bot` flips to green automatically. The fragment has no packages listed, so `pnpm version-packages` ignores it.

## Writing a changeset

```bash
pnpm changeset
```

The picker shows publishable packages only (`@flow-state-dev/*` + `@thought-fabric/core`). Private apps (`apps/devtool`, `apps/docs`, `apps/kitchen-sink`, `packages/integration-tests`, `packages/ui`) are filtered out by removing their `version` fields.

Pick the affected packages, choose the bump, write the entry. The CLI saves `.changeset/<random-words>.md` — keep the random name; you don't need to rename it. Commit it with the PR.

Fragment format:

```md
---
"@flow-state-dev/core": patch
"@flow-state-dev/engine": patch
---

One user-facing sentence. Multi-paragraph or migration notes are fine
when the change warrants them.
```

The body is what shows up under that package's heading in the next `CHANGELOG.md` release section, so write it for the next reader, not for the PR reviewer. Implementation rationale, decision lineage, file paths, exact test counts, "out of scope" sections, and Linear ticket internals belong in the PR description, not in the fragment.

## Pre-1.0 discipline (current state)

Every package is at `0.x.y`. Changesets has no built-in pre-1.0 mode — a `major` against `0.x.y` bumps straight to `1.0.0`. Until the first launch:

- `patch` — non-breaking changes (bug fixes, additive API).
- `minor` — new capabilities or breaking changes. Pre-1.0, `minor` is allowed to break.
- **Never `major`.** A `major` here would burn the 1.0 budget before the API has settled.

If you genuinely believe a breaking change warrants `major`, raise it in the PR and a maintainer will decide.

This matches the [Vercel AI SDK contributing guide](https://github.com/vercel/ai/blob/main/CONTRIBUTING.md)'s pre-1.0 rule: contributors stay on `patch` and maintainers decide when a non-`patch` bump is warranted.

## Multi-package PRs

Each fragment can list multiple packages with their own bumps:

```md
---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": patch
"@flow-state-dev/react": patch
---

One sentence describing the change for users.
```

Use one fragment per logical change, not one fragment per package. `pnpm version-packages` aggregates fragments per package — if two PRs each ship a fragment touching `core`, that's two entries under the next `@flow-state-dev/core` release heading and a single `core` version bump (taking the max of the bumps).

If a single PR ships two unrelated changes touching overlapping packages, write two fragments. They'll group naturally at release time.

### Workspace cascade

`.changeset/config.json` has `updateInternalDependencies: "patch"`. A `minor` on `@flow-state-dev/core` cascades a `patch` to every workspace consumer that depends on it. This is intentional — internal consumers ship updated dependency ranges with each `core` release — but it can swell the diff of a "Version Packages" PR. No action needed; just expect it.

## What happens at release time

A maintainer (or the release workflow) runs `pnpm version-packages`. For each affected package:

1. The `version` field in `package.json` is bumped (max of all pending bumps).
2. The fragments' bodies concatenate under a new section in that package's `CHANGELOG.md`.
3. The consumed fragments are deleted from `.changeset/`.

`.github/workflows/release.yml` automates this when `CHANGESETS_TOKEN` is configured: it opens a "Version Packages" PR with the proposed bumps and changelog edits. Merging that PR publishes to npm with provenance and creates GitHub Releases from the per-package changelogs.

`.changeset/` is not a persistent store. Anything that needs to outlive a release lives in `packages/<name>/CHANGELOG.md`.

## Common mistakes

- **Forgetting the fragment.** The PR merges; the user-facing change is invisible in the next release. `changeset-bot` flags this on every PR, but the contributor still has to act.
- **Picking `major`.** Bumps the package to `1.0.0`. Pre-1.0, always `patch` or `minor`.
- **Selecting a private package in the picker.** The five private apps have no `version` field, so the picker shouldn't show them. If you ever see one, that's a bug — file it.
- **Treating `.changeset/` as a persistent store.** `pnpm version-packages` deletes every `.md` except `README.md`. Don't park notes here.
- **Wording the fragment like a PR description.** "Refactored X to use Y; tests added in Z" reads as noise in a CHANGELOG. Write the user-facing fact: "X now respects Y when Z."

## Reference

- [BP-022 — Release notes via Changesets](best-practices.md#bp-022-release-notes-via-changesets)
- [`.changeset/README.md`](../../.changeset/README.md) — quick-start at the directory
- [`AGENTS.md` — Release notes](../../AGENTS.md#release-notes)
- [Changesets official docs](https://github.com/changesets/changesets)
- [Vercel AI SDK CONTRIBUTING.md](https://github.com/vercel/ai/blob/main/CONTRIBUTING.md) — pre-1.0 precedent
