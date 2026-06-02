# Releasing

How we publish `@flow-state-dev` and `@thought-fabric` packages to npm. For how to write changeset fragments, see [release-notes-workflow.md](./release-notes-workflow.md).

## Versioning policy

- All packages start at 0.x (currently 0.1.0 baseline).
- Pre-1.0 discipline: `patch` for compatible changes, `minor` for breaking changes. Never file a `major` changeset while pre-1.0. Changesets will jump the package straight to 1.0.0.
- Graduate to 1.0 only by explicit decision, not by accident.

## Tag scheme

- `latest`: stable releases, published by CI on merge to main.
- `canary` / `next`: snapshot releases via the `snapshot-release.yml` workflow (manual dispatch).
- Use snapshots for testing unreleased changes in consuming projects.

## Provenance and access

- All packages use npm provenance attestation (`--provenance` flag + `id-token: write` in CI).
- Scoped packages require `publishConfig.access: "public"` (already set in every `package.json`).
- `@thought-fabric/core` publishes under the `@thought-fabric` npm scope.

## Sourcemaps

Sourcemaps are stripped from published tarballs. Every publishable package declares `!dist/**/*.map` in its `files` array so `.map` files never reach npm.

## Routine release (CI-driven)

This is the normal path. No manual steps beyond merging PRs.

1. Land PRs with changeset fragments (see [release-notes-workflow.md](./release-notes-workflow.md)).
2. `release.yml` runs on every push to `main`. When pending changesets exist, the `changesets/action` opens (or updates) a **Version Packages** PR that bumps versions and updates per-package `CHANGELOG.md` files.
3. Merge the Version Packages PR. `release.yml` runs again, this time publishing all changed packages to npm with provenance and creating GitHub Releases from the generated changelogs.

### Snapshot releases

For pre-merge testing in consuming projects:

1. Go to Actions > **Snapshot Release** > Run workflow.
2. Choose a dist-tag (`canary` is the default; `next` also works).
3. The workflow versions packages as snapshots, builds, and publishes with `--no-git-tag`.

Consumers install with:

```bash
pnpm add @flow-state-dev/core@canary
```

Snapshots are not permanent. They exist for integration testing, not production use.

## Manual release (fallback)

Only if CI is broken or for debugging. Requires `NPM_TOKEN` in your environment.

```bash
pnpm version-packages    # consume changesets, bump versions
pnpm release              # build packages and publish with --provenance
```

Note: `changeset publish` does not guarantee topological order. For strict ordering, use `pnpm publish -r`. There is no true `--dry-run` for `changeset publish`.

## Pre-publish sanity checks

Run before any publish (automated or manual):

```bash
# Verify tarball contents per package
pnpm -r exec npm pack --dry-run

# Check exports and types resolution
npx publint ./packages/<name>
npx @arethetypeswrong/cli --pack ./packages/<name>

# Ensure no stray debug code in dist
grep -r 'console\.log\|debugger' packages/*/dist/ --include='*.js'
```

## First-publish ceremony (one-time)

This checklist runs once for the initial npm publish:

1. Confirm npm orgs exist: `flow-state-dev`, `thought-fabric`.
2. Configure trusted publisher (OIDC) or set the `NPM_TOKEN` secret in GitHub. Set `CHANGESETS_TOKEN` for release PR automation.
3. Set the launch baseline version (0.1.0) across all publishable packages.
4. Run `pnpm version-packages` to consume accumulated changesets. Review the diff.
5. Per-package `npm pack --dry-run` for a final sanity check.
6. Merge to main so `release.yml` publishes, or run `pnpm release` locally.
7. Post-publish smoke test from a fresh directory:
   ```bash
   mkdir /tmp/fsd-smoke && cd /tmp/fsd-smoke
   pnpm init && pnpm add @flow-state-dev/core @flow-state-dev/server
   # verify types resolve and a basic import works
   ```
8. Verify each npmjs.com listing renders the README and shows the provenance badge.

## Post-publish

- Verify npmjs.com pages render correctly (README, provenance badge, repo link to correct subfolder).
- If a publish goes wrong: `npm deprecate @flow-state-dev/<pkg>@<version> "reason"` to mark bad versions. Do not unpublish unless absolutely necessary.
- README-only changes require a version bump to update on npmjs.com.

## Required repository secrets

| Secret | Purpose |
|--------|---------|
| `CHANGESETS_TOKEN` | GitHub token with `contents: write` and `pull-requests: write` for release PR automation |
| `NPM_TOKEN` | npm automation token with publish access to `@flow-state-dev` and `@thought-fabric` scopes |

## Node.js version requirement

All packages declare `engines.node: ">=20"`. Node 22 is the current active LTS. Node 20 reached EOL on April 30, 2026 but is still permitted by the engine floor. ESM-only; no CommonJS dual-build.
