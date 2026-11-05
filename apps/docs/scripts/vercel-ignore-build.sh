#!/usr/bin/env bash
# Vercel "Ignored Build Step" for the docs site (apps/docs/vercel.json → ignoreCommand).
# Exit 0 skips the build; exit 1 builds.
#
# The live site describes what a person can install. Normal PRs can't change
# user docs (scripts/validate-user-docs-scope.mjs), so the only unreleased prose
# that reaches main is a merged release docs PR waiting for its Version Packages
# PR. That docs pass is staged while any changeset it covers
# (apps/docs/release-docs.json) is still a pending fragment in .changeset/.
#
# Production skips while docs are staged and builds otherwise. Merging Version
# Packages deletes the fragments, so its commit builds. Site code and docs-fix
# merges deploy straight away, except while a release is staged, when they go
# live with it. Previews always build.
# Cases are exercised in packages/core/test/vercel-ignore-build.test.ts.
# See docs/contributing/release-docs.md.

if [ "$VERCEL_ENV" != "production" ]; then
  echo "Preview build: building."
  exit 1
fi

here="$(cd "$(dirname "$0")" && pwd)"
staged="$(node -e '
  const { existsSync, readFileSync } = require("node:fs");
  const [manifest, dir] = process.argv.slice(1);
  if (!existsSync(manifest)) process.exit(0);
  const ids = JSON.parse(readFileSync(manifest, "utf8")).changesets ?? [];
  console.log(ids.filter((id) => existsSync(`${dir}/${id}.md`)).join(" "));
' "$here/../release-docs.json" "$here/../../../.changeset")" || {
  echo "Could not read the release docs manifest: building."
  exit 1
}

if [ -n "$staged" ]; then
  echo "Release docs are staged for unpublished changesets ($staged): skipping until Version Packages merges."
  exit 0
fi

echo "No unreleased docs on main: deploying."
exit 1
