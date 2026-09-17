# Releasing

How we publish the `@flow-state-dev` packages to npm. For how to write changeset fragments, see [release-notes-workflow.md](./release-notes-workflow.md).

## Versioning policy

- All packages start at 0.x (currently 0.1.0 baseline).
- Pre-1.0 discipline: `patch` for compatible changes, `minor` for breaking changes. Never file a `major` changeset while pre-1.0. Changesets will jump the package straight to 1.0.0. [release-notes-workflow.md](./release-notes-workflow.md#pre-10-discipline-current-state) is the authoritative wording.
- Graduate to 1.0 only by explicit decision, not by accident.
- Only publishable packages are versioned. `.changeset/config.json` sets `privatePackages: { version: false }`, so every `private: true` package — `labs/*`, `examples/*`, `apps/*`, `packages/ui`, `packages/integration-tests`, `plugins/*`, `goals` — is skipped by both `pnpm changeset` and `pnpm version-packages`.

## Tag scheme

- `latest`: stable releases, published by CI on merge to main.
- `canary` / `next`: snapshot releases via the `snapshot-release.yml` workflow (manual dispatch).
- Use snapshots for testing unreleased changes in consuming projects.

## Provenance and access

- All packages use npm provenance attestation (`--provenance` flag + `id-token: write` in CI). Under Trusted Publishing the flag becomes unnecessary — npm generates provenance automatically.
- Scoped packages require `publishConfig.access: "public"` (already set in every `package.json`).
- `@thought-fabric/core` is **not published**. It is marked `private` in its `package.json`, which is the only flag `changeset publish` filters on — `.changeset/config.json`'s `ignore` list affects versioning, not publishing. Only the private `kitchen-sink` app consumes it, over a workspace link.

## The publish must go through pnpm

Every package sets `main` / `types` / `exports` to `src/*.ts` for local development and overrides them to `dist/*` under `publishConfig`. Substituting those fields at pack time is a **pnpm** feature; `npm publish` ignores them and would ship a tarball whose `main` points at a `src/` path that `files: ["dist"]` excludes — a broken package, silently.

`changeset publish` detects the workspace's package manager and spawns `pnpm publish` here, so the normal path is already correct. Do not reach for `npm publish` as a workaround.

## `release:build`, not `packages:build`

Every release path builds through `release:build`, which is `packages:build` plus `build:assets`. The extra step copies the DevTool app's output into `packages/devtool/dist-client/`, which `@flow-state-dev/devtool` lists in `files` and resolves at runtime to serve `fsdev dev`. `packages:build` alone does not produce it: `build:assets` is not a turbo task, and it cannot become one — `apps/devtool` depends on the `@flow-state-dev/devtool` package, so folding the asset build into that package's own `build` would close a cycle.

The two stay separate because `packages:build` is also the editor/typecheck input and the Vercel build step for `packages/ui` and `apps/kitchen-sink`, none of which want an app build. Publishing is the only caller that needs the assets, so publishing is what pays for them.

The devtool package refuses to publish without them. Its `prepublishOnly` runs `scripts/check-assets.mjs`, which fails when `dist-client/index.html` is missing, so a release path that loses `build:assets` aborts rather than shipping a package whose `fsdev dev` throws. `pnpm publish` runs that hook before packing, and `changeset publish` calls `pnpm publish`.

```bash
# What the tarball actually contains. `pnpm pack` takes no filter — `--filter` puts pnpm
# in recursive mode, which pack rejects with "Unknown option: 'recursive'". Use --dir.
pnpm --dir packages/core pack --pack-destination /tmp
tar xzOf /tmp/flow-state-dev-core-*.tgz package/package.json | grep '"main"'   # ./dist/index.js
```

## Sourcemaps

Sourcemaps are stripped from published tarballs. Every publishable package declares `!dist/**/*.map` in its `files` array so `.map` files never reach npm.

## Routine release (CI-driven)

This is the normal path. No manual steps beyond merging PRs.

1. Land PRs. A minority carry a changeset fragment — the ones a consumer of a published package needs to hear about (see [release-notes-workflow.md](./release-notes-workflow.md)).
2. `release.yml` runs on every push to `main`. When pending changesets exist, the `changesets/action` opens (or updates) a **Version Packages** PR that bumps versions and updates per-package `CHANGELOG.md` files. With no pending fragments it does nothing, which is the normal state between releases — a release happens when a batch of consumer-visible changes has accumulated, not on every merge.
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
# Walk the real publish set — exactly the 27 publishable packages, private ones skipped
pnpm publish -r --dry-run --no-git-checks

# Check exports and types resolution
npx publint ./packages/<name>
npx @arethetypeswrong/cli --pack ./packages/<name>

# Ensure no stray debug code in dist
grep -r 'console\.log\|debugger' packages/*/dist/ --include='*.js'
```

## First publish (one-time — not done yet)

Nothing has been published under the `@flow-state-dev` scope. All 27 packages are new, and that is what makes the first publish different from every release after it: **npm will not let you configure a trusted publisher for a package that does not exist.** `npm trust` says so outright — "The package you're configuring must already exist on the npm registry." There is no pre-registration. So the first publish is token-authenticated, and Trusted Publishing is configured afterwards, against packages that by then exist.

### Already in place

- `CHANGESETS_TOKEN` is configured. `release.yml` runs on every push to `main` and keeps the **Version Packages** PR current — it has been open and refreshing since 2026-09-09.
- All 27 publishable packages carry `files`, `license`, `repository.directory`, a README, and the `publishConfig` dist-path override.
- `changesets/action@v1` resolves to v1.9.0, which writes the `.npmrc` auth line only when `NPM_TOKEN` is defined and omits it otherwise. The same pin works for both the token publish and the OIDC publish later, so the action version does not need to change. Do **not** jump to `@v2` while still on a token: v2 dropped `NPM_TOKEN` handling entirely.

### The token

`release:ci` publishes only when `NPM_TOKEN` is set; without it the step prints `Skipping npm publish in CI: NPM_TOKEN is not set` and publishes nothing. A secret's value and scope are not readable from CI, so the only proof the scope is right is the publish itself.

The token must be a **granular access token scoped to all packages in the `flow-state-dev` organization**, read and write. A token scoped to *selected packages* cannot work — there are no packages to select yet. No second org is involved: everything published lives under `@flow-state-dev`.

### Steps

1. Confirm the `flow-state-dev` npm org exists and the publishing account has publish rights on it.
2. Add the `NPM_TOKEN` repository secret.
3. Review the open **Version Packages** PR. Note that the accumulated changesets have already moved past the 0.1.0 launch baseline — most packages publish as `0.1.1`, `orchestration` and `workforce` as `0.2.0`, `codex` and `cursor` as `0.0.2`. That is legal and harmless; fighting changesets to force a clean 0.1.0 means hand-editing 76 generated files.
4. Merge it. `release.yml` runs `release:ci` → `release:build` → `changeset publish --provenance`.
5. Smoke test from a fresh directory:
   ```bash
   mkdir /tmp/fsd-smoke && cd /tmp/fsd-smoke
   pnpm init && pnpm add @flow-state-dev/core @flow-state-dev/engine
   # verify types resolve and a basic import works
   ```
6. Check that `fsdev dev` serves the DevTool from the published `@flow-state-dev/devtool` — that package ships `dist-client`, which only `build:assets` produces.
7. Verify each npmjs.com listing renders its README and shows the provenance badge.

## Switching to Trusted Publishing (after the first publish)

Blocked on the runner's npm version. A pnpm upgrade is one way to clear it, not a prerequisite.

`changeset publish` spawns **`pnpm publish`**, but on pnpm 10 that command does not itself publish. It packs the tarball and then spawns `npm publish` on the `npm` it finds on `PATH`, with the parent environment spread into the child — so the Actions OIDC variables reach npm, and **npm** is the CLI that performs the exchange. In pnpm 10.4.1's bundled `dist/pnpm.cjs` the publish command ends in `runNpm(opts.npmPath, ["publish", "--ignore-scripts", <tarball>, ...args])`, and the helper that spawns it builds the child env as `{ ...process.env, ... }`. [pnpm#11513](https://github.com/pnpm/pnpm/issues/11513) reads the same way round: the reporter's OIDC publishes worked on pnpm 10 and broke on 11.0.8, when pnpm took publishing in-house.

So the floor that matters is npm ≥ 11.5.1, and `actions/setup-node` with `node-version: 22` installs npm 10.9.8. Adding a `npm install -g npm@latest` step to the release workflow clears it. Upgrading to pnpm 11, which implements OIDC natively, is the other route and is a larger change with its own risk.

Either way the canary proof in step 2 is what settles it, since this rests on reading pnpm's source rather than on a publish anyone has watched.

Then:

1. Configure a trusted publisher for each of the 27 packages. `npm trust` (npm ≥ 11.15.0, 2FA required) does this from the CLI, so it can be a loop rather than 27 trips through the website:
   ```bash
   npm trust github <package> --repo fixpoint-labs/flow-state-dev --file release.yml --allow-publish -y
   ```
   Snapshot Release publishes from a second workflow, so `snapshot-release.yml` needs its own trusted-publisher entry per package if snapshots are to stay tokenless.
2. Prove it on `canary` before trusting it for `latest`. Run **Snapshot Release** and confirm it publishes with no token present. [pnpm#11513](https://github.com/pnpm/pnpm/issues/11513) reports OIDC publishes failing with a 404 on pnpm 11.0.8, so this is a real check, not a formality.
3. Edit `release.yml`: add `npm install -g npm@latest` before the publish step (unless the pnpm upgrade route was taken instead), and drop `NPM_TOKEN` from the `changesets/action` env block. Keep `id-token: write`. Keep the action at `@v1`.
4. Drop `--provenance` from `release`, `release:ci`, and `release:snapshot`, and drop the `NPM_TOKEN` guard from `release:ci`. Trusted Publishing generates provenance on its own.
5. Revoke the npm token and delete the secret.

## Post-publish

- Verify npmjs.com pages render correctly (README, provenance badge, repo link to correct subfolder).
- If a publish goes wrong: `npm deprecate @flow-state-dev/<pkg>@<version> "reason"` to mark bad versions. Do not unpublish unless absolutely necessary.
- README-only changes require a version bump to update on npmjs.com.

## Required repository secrets

| Secret | Purpose |
|--------|---------|
| `CHANGESETS_TOKEN` | GitHub token with `contents: write` and `pull-requests: write` for release PR automation |
| `NPM_TOKEN` | npm granular access token, read+write on all packages in the `flow-state-dev` org. Needed for the first publish only; removed once Trusted Publishing is in place |

## Node.js version requirement

All packages declare `engines.node: ">=22"`. Node 22 is the current active LTS, and AI SDK 7 (the framework's generator provider layer) requires Node 22+. ESM-only; no CommonJS dual-build.
