# Release notes workflow

For the end-to-end publish process and runbook, see [RELEASING.md](./RELEASING.md).

Most PRs do not need a changeset. This page covers the ones that do, how to write the fragment, and what happens to it after merge.

The authoritative rule is [BP-022](best-practices.md#bp-022-release-notes-via-changesets). This doc is the longer walk-through that BP-022 links to.

## When to write a changeset

A changeset exists for one reader: somebody who has installed a published `@flow-state-dev/*` or `@thought-fabric/core` package and is deciding whether to upgrade. Write one when that person needs to know something. Otherwise don't — an empty fragment is not required either.

| Change | Changeset? |
|---|---|
| Public API, capability, block, CLI command, hook, env var, or config key a consumer calls — added, changed, or removed | Yes |
| Behavior a consumer can observe from outside the package: return value, emitted item, error message they key off, default that shifts | Yes |
| Anything scoped to a private package — `labs/*`, `examples/*`, `apps/*`, `packages/ui`, `packages/integration-tests`, `plugins/*`, `goals` | No |
| Internal refactor, test-only change, internal helper, infra, docs-site edit, type tightening behind a public surface | No |
| Workflow file, lint config, repo-root tooling, agent skills | No |

The old rule was "write one whenever in doubt." That produced 422 unreleased fragments, most describing a delta against a version that never existed; they are archived at [`docs/internal/archive/changesets/`](../internal/archive/changesets/README.md). The rule now runs the other way: if you cannot name what the installed-package reader would do differently, skip it.

Skipping needs no ceremony. Say "no changeset needed" in the PR description if a reviewer might wonder, and move on. `pnpm changeset --empty` still works and still flips `changeset-bot` green, but it is a convenience, not an obligation.

### Labs and other private packages

`labs/conductor`, `labs/knowledge-hub`, and `labs/trading-desk` are `private: true`, and so are the examples, the apps, the plugin tree, and `goals`. None of them publish, so none of them have a downstream consumer to notify.

This is enforced by `.changeset/config.json`, which sets `privatePackages: { version: false }`. Every `private: true` package is skipped: the `pnpm changeset` picker will not offer it, and `pnpm version-packages` will not bump it or write it a `CHANGELOG.md`. Adding a fourth lab needs no config change.

Do not hand-write a fragment naming a private package. Changesets rejects a fragment that mixes a skipped package with a publishable one, and it fails the whole run, not just that fragment — `pnpm changeset status` was broken repo-wide for exactly this reason (FIX-870).

## Writing a changeset

```bash
pnpm changeset
```

The picker shows publishable packages only (`@flow-state-dev/*` + `@thought-fabric/core`); private packages are filtered out by `privatePackages: { version: false }`.

Pick the affected packages, choose the bump, write the entry. The CLI saves `.changeset/<random-words>.md` — keep the random name; you don't need to rename it. Commit it with the PR.

Fragment format:

```md
---
"@flow-state-dev/core": patch
"@flow-state-dev/engine": patch
---

One user-facing sentence (FIX-123).
```

**Every fragment names its Linear issue.** The repo keeps no spec copy ([BP-037](best-practices/process.md)), so the issue id is the only route from a released change back to the reasoning behind it. `scripts/validate-changeset-refs.mjs` enforces this in CI on fragments a PR adds or edits.

The body is what shows up under that package's heading in the next `CHANGELOG.md` release section, so write it for the next reader, not for the PR reviewer. Implementation rationale, decision lineage, file paths, exact test counts, "out of scope" sections, and Linear ticket internals belong in the PR description, not in the fragment.

## Pre-1.0 discipline (current state)

Packages are at `0.x.y`. Changesets has no built-in pre-1.0 mode — a `major` against `0.x.y` bumps straight to `1.0.0`. Until the first launch:

- `patch` — a change no consumer's existing code can trip over: bug fixes, and additive API (a new export, a new optional field, a new function).
- `minor` — anything a consumer's existing code *can* trip over. Pre-1.0, `minor` is allowed to break. A new member of an exported union counts, because it can stop an exhaustive `switch` compiling.
- **Never `major`.** A `major` here would burn the 1.0 budget before the API has settled.

"New capability" is not the test; "can this break somebody" is. This paragraph is the authoritative answer for the pre-1.0 bump choice — `AGENTS.md` defers to it.

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

One sentence describing the change for users (FIX-123).
```

Use one fragment per logical change, not one fragment per package. `pnpm version-packages` aggregates fragments per package — if two PRs each ship a fragment touching `core`, that's two entries under the next `@flow-state-dev/core` release heading and a single `core` version bump (taking the max of the bumps).

If a single PR ships two unrelated changes touching overlapping packages, write two fragments. They'll group naturally at release time.

### Workspace cascade

`.changeset/config.json` has `updateInternalDependencies: "patch"`. A `minor` on `@flow-state-dev/core` cascades a `patch` to every publishable workspace consumer that depends on it. This is intentional — internal consumers ship updated dependency ranges with each `core` release — but it can swell the diff of a "Version Packages" PR. No action needed; just expect it.

## What happens at release time

A maintainer (or the release workflow) runs `pnpm version-packages`. For each affected package:

1. The `version` field in `package.json` is bumped (max of all pending bumps).
2. The fragments' bodies concatenate under a new section in that package's `CHANGELOG.md`.
3. The consumed fragments are deleted from `.changeset/`.

With no pending fragments, `pnpm version-packages` prints `No unreleased changesets found, exiting` and changes nothing. That is the expected steady state now, not a problem.

`.github/workflows/release.yml` automates this when `CHANGESETS_TOKEN` is configured: it opens a "Version Packages" PR with the proposed bumps and changelog edits. Merging that PR publishes to npm with provenance and creates GitHub Releases from the per-package changelogs.

`.changeset/` is not a persistent store. Anything that needs to outlive a release lives in `packages/<name>/CHANGELOG.md`.

## Common mistakes

- **Writing one out of habit.** A fragment for an internal refactor becomes a CHANGELOG line telling an installer about something they cannot see. That is the failure the archive exists to record.
- **Picking `major`.** Bumps the package to `1.0.0`. Pre-1.0, always `patch` or `minor`.
- **Hand-writing a fragment that names a private package.** It is skipped, and if the same fragment also names a publishable package the whole release run errors out (FIX-870). Use the picker.
- **Treating `.changeset/` as a persistent store.** `pnpm version-packages` deletes every `.md` except `README.md`. Don't park notes here.
- **Wording the fragment like a PR description.** "Refactored X to use Y; tests added in Z" reads as noise in a CHANGELOG. Write the user-facing fact: "X now respects Y when Z."
- **Treating `changeset-bot`'s red mark as a blocker.** It comments on any PR without a fragment. Under this policy most PRs won't have one; the bot is advisory and CI does not gate on it.

## Reference

- [BP-022 — Release notes via Changesets](best-practices.md#bp-022-release-notes-via-changesets)
- [`.changeset/README.md`](../../.changeset/README.md) — quick-start at the directory
- [`AGENTS.md` — Release notes](../../AGENTS.md#release-notes)
- [`docs/internal/archive/changesets/`](../internal/archive/changesets/README.md) — the 422 pre-release fragments
- [Changesets official docs](https://github.com/changesets/changesets)
- [Vercel AI SDK CONTRIBUTING.md](https://github.com/vercel/ai/blob/main/CONTRIBUTING.md) — pre-1.0 precedent
