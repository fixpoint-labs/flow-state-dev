# Pre-release changeset fragments

These 422 files are the `.changeset/*.md` fragments that accumulated between the
adoption of Changesets (FIX-653) and the first npm publish. They were never
consumed by a release, because there has never been a release: every package sat
at `0.0.0` the whole time they were being written.

**They are internal history, not release notes.** Nothing here has shipped, and
nothing here should be turned into a CHANGELOG entry.

## Why they were archived instead of released

A release note describes a delta a user can feel: what changed between the
version they have and the version they are upgrading to. About 60% of these
fragments describe a delta against a version that never existed — "Remove the
deprecated flat emitters" is accurate about the repo's history and meaningless
to a first-time installer, who never had flat emitters to lose.

Consuming the corpus would have produced 556 changelog entries and about 80,000
words of migration guidance for an audience of zero, and buried the small
number of entries that actually describe the shipping product. So the corpus
moved here and the first release ships one entry per package: `Initial release.`

Two other things they were carrying, now handled elsewhere:

- **`@flow-state-dev/ui` in six fragments alongside a publishable package.** `ui`
  is not versionable (no `version` field), and Changesets rejects a fragment that
  mixes a skipped package with a publishable one — which broke `pnpm changeset
  status` repo-wide (FIX-870). Archiving the corpus removed the instance.
- **Two fragments declaring `major` bumps** while every package was pre-1.0
  (FIX-1192), each of which would have jumped its package straight to `1.0.0`.

## Reading them

Each file is verbatim, under its original filename. The frontmatter names the
packages the change touched and the bump its author intended; the body names the
Linear issue it came from (BP-022's rule, enforced by
`scripts/validate-changeset-refs.mjs`). The issue is the durable record — the
repo keeps no spec copy — so a fragment here is best used as an index into
Linear, not as a standalone account of what happened.

## The policy now

Changesets are no longer written by default. One is written when a change is
something a downstream consumer of a published package needs to know about;
private packages, labs included, never get one. See
[`docs/contributing/release-notes-workflow.md`](../../../contributing/release-notes-workflow.md)
and [BP-022](../../../contributing/best-practices.md#bp-022-release-notes-via-changesets).
