#!/usr/bin/env bash
# Vercel "Ignored Build Step" for the docs site (apps/docs/vercel.json → ignoreCommand).
# Exit 0 skips the build; exit 1 builds.
#
# The live site describes what a person can install, so production only deploys
# when packages publish: the merge of the changesets "Version Packages" PR.
# Docs land on main earlier, through the release docs PR, and wait for it.
# A `docs-fix` in the commit message (put it in the PR title) deploys a fix to
# already-released docs straight away. Previews always build.
# See docs/contributing/release-docs.md.

if [ "$VERCEL_ENV" != "production" ]; then
  echo "Preview build: building."
  exit 1
fi

case "$VERCEL_GIT_COMMIT_MESSAGE" in
  *"Version Packages"*|*"docs-fix"*)
    echo "Release or docs-fix commit: deploying docs."
    exit 1
    ;;
esac

echo "Not a release: skipping the production docs deploy until packages publish."
exit 0
