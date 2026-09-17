# Releasing

How we publish `@flow-state-dev` and `@thought-fabric` packages to npm. For how to write changeset fragments, see [release-notes-workflow.md](./release-notes-workflow.md).

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

- All packages use npm provenance attestation (`--provenance` flag + `id-token: write` in CI).
- Scoped packages require `publishConfig.access: "public"` (already set in every `package.json`).
- `@thought-fabric/core` publishes under the `@thought-fabric` npm scope.

## Sourcemaps

Sourcemaps are stripped from published tarballs. Every publishable package declares `!dist/**/*.map` in its `files` array so `.map` files never reach npm.

## What the release build has to produce

`pnpm release` and `pnpm release:ci` run `pnpm packages:build` followed by `pnpm build:assets`. The
second step is not optional. `@flow-state-dev/devtool` ships `dist-client/`, the pre-built DevTool
app, and only `build:assets` produces it. Build without it and the tarball is 145 kB of JS with no
assets, so `fsdev dev` throws `pre-built assets not found` for anyone who installed from npm.

`packages:build` alone is what CI and the Vercel builds run, and that is correct for them. Only the
release path needs the extra step.

The devtool package guards this itself. Its `prepublishOnly` runs
`scripts/check-assets.mjs`, which fails the publish if `dist-client/index.html` is missing, so a
release script that loses `build:assets` aborts instead of shipping an empty package. `pnpm publish`
runs that hook, and `changeset publish` calls `pnpm publish`.

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
# Verify tarball contents per package
pnpm -r exec npm pack --dry-run

# Check exports and types resolution
npx publint ./packages/<name>
npx @arethetypeswrong/cli --pack ./packages/<name>

# Ensure no stray debug code in dist
grep -r 'console\.log\|debugger' packages/*/dist/ --include='*.js'
```

## First publish (one-time bootstrap)

Nothing is on npm yet. All 28 publishable packages return 404 from the registry, under both the
`@flow-state-dev` and `@thought-fabric` scopes.

That ordering matters, because npm will not let you configure a trusted publisher for a package that
does not exist yet. So the first publish is authenticated with a token, and OIDC takes over
afterwards. Phase 1 puts the packages on the registry; phase 2 removes the token.

### Phase 1: bootstrap with a token

What a human has to do, because none of it can be done from CI:

1. Confirm the npm orgs `flow-state-dev` and `thought-fabric` exist and that the publishing account
   is an owner of both.
2. Create an npm **automation** token with publish rights on both scopes and add it to the
   repository as the `NPM_TOKEN` secret. Automation tokens bypass 2FA, which is what a CI publish
   needs. `CHANGESETS_TOKEN` is already configured.

Then the release path takes over:

3. Merge the open **Version Packages** PR. It consumes the accumulated changeset fragments, bumps
   versions, and updates the per-package `CHANGELOG.md` files.
4. That merge pushes to main. `release.yml` runs, finds no changesets left, and so runs
   `pnpm release:ci` instead of opening another version PR. `changeset publish` publishes every
   public package whose current version is not already on the registry, which on the first run is
   all 28 at once, in whatever order it resolves them.
5. Smoke test from a fresh directory:
   ```bash
   mkdir /tmp/fsd-smoke && cd /tmp/fsd-smoke
   pnpm init && pnpm add @flow-state-dev/core @flow-state-dev/engine
   # verify types resolve and a basic import works
   ```
6. Check a few npmjs.com listings for the README, the repo subfolder link, and the provenance badge.
   For `@flow-state-dev/devtool`, confirm the tarball carries `dist-client/` (that is the pre-built
   DevTool app; `fsdev dev` throws without it).

Until `NPM_TOKEN` exists, `release:ci` prints `Skipping npm publish in CI: NPM_TOKEN is not set` and
exits 0, so merging the version PR would consume the changesets and publish nothing.

### Phase 2: switch to trusted publishing

Only possible once the packages exist, and it needs one workflow change that has nothing to do with
npm's side of the setup.

1. Configure a trusted publisher per package. `npm trust` needs npm CLI 11.15.0 or newer, account
   2FA, and a web login; it does not work with a granular access token, so a human runs it:

   ```bash
   # from the repo root
   node -e '
     const fs = require("node:fs");
     for (const d of fs.readdirSync("packages")) {
       const p = `packages/${d}/package.json`;
       if (!fs.existsSync(p)) continue;
       const j = JSON.parse(fs.readFileSync(p, "utf8"));
       if (!j.private) console.log(j.name);
     }' \
     | while read -r pkg; do
         npm trust github "$pkg" --repo fixpoint-labs/flow-state-dev --file release.yml --allow-publish
         sleep 2
       done
   ```

   That prints the 28 publishable names. npm's 2FA skip window is 5 minutes, which is enough for
   roughly 80 packages at one call every 2 seconds, so the whole set fits in one window.

   npm allows several configurations per package, so add a second entry naming
   `snapshot-release.yml` if snapshot releases should also publish without a token.

2. Change the workflow and the release script together:

   - **Upgrade npm on the runner.** `actions/setup-node` with `node-version: 22` installs npm
     10.9.8, and OIDC needs 11.5.1 or newer. Add a step before the publish:

     ```yaml
     - name: Use an npm that can do trusted publishing
       run: npm install -g npm@latest
     ```

     It is npm's version that decides, because of how the publish is layered: `changeset publish`
     picks the workspace's package manager and calls `pnpm publish`, and pnpm 10 packs the tarball
     and shells out to the `npm` on PATH to do the actual publish. (pnpm 11 implements OIDC itself,
     so upgrading pnpm instead would also work.)

   - **Drop the token guard** from `release:ci` in the root `package.json`. It currently skips the
     publish when `NPM_TOKEN` is unset, which is exactly the state trusted publishing runs in:

     ```
     "release:ci": "pnpm packages:build && pnpm build:assets && changeset publish --provenance"
     ```

   - **Stop passing `NPM_TOKEN`** to `changesets/action` and delete the secret. The action writes an
     `~/.npmrc` auth line whenever `NPM_TOKEN` is set and only falls back to OIDC when it is absent.

   - **Leave `actions/setup-node` without `registry-url`.** Setting it writes an `.npmrc` containing
     `_authToken=${NODE_AUTH_TOKEN}`, and an unresolved placeholder gets sent as a bearer token,
     which fails the publish with a 404 that reads like a permissions problem.

   - `id-token: write` is already on the job and stays.

3. On the next release, confirm the npm page shows the package was published via trusted publishing.

With trusted publishing, npm generates the provenance attestation itself, so `--provenance` becomes
redundant but harmless. Provenance needs a public repository either way, which this one is.

## Post-publish

- Verify npmjs.com pages render correctly (README, provenance badge, repo link to correct subfolder).
- If a publish goes wrong: `npm deprecate @flow-state-dev/<pkg>@<version> "reason"` to mark bad versions. Do not unpublish unless absolutely necessary.
- README-only changes require a version bump to update on npmjs.com.

## Required repository secrets

| Secret | Purpose |
|--------|---------|
| `CHANGESETS_TOKEN` | GitHub token with `contents: write` and `pull-requests: write` for release PR automation |
| `NPM_TOKEN` | npm automation token with publish access to `@flow-state-dev` and `@thought-fabric` scopes. Needed for the bootstrap publish only; delete it when trusted publishing is configured |

## Node.js version requirement

All packages declare `engines.node: ">=22"`. Node 22 is the current active LTS, and AI SDK 7 (the framework's generator provider layer) requires Node 22+. ESM-only; no CommonJS dual-build.
