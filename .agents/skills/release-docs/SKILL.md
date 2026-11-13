---
name: release-docs
description: Write the user docs for a release in one pass — every pending changeset, planned together, written by docs-writer, checked by docs-editor, polished as a set — and open one release-docs PR for review. The only way user docs (apps/docs pages, package READMEs) change outside a docs-fix. Run in a fresh session when a release is being cut, or via Actions > Release docs. Unblocks the Version Packages PR's "Release docs cover this release" check.
argument-hint: "(none)"
---

# Release docs

User docs describe what a person can install. Normal PRs don't touch them; they leave a changeset.
This skill turns the pending changesets into docs, once per release, so the pages are planned and
read as one set instead of accreting a paragraph per PR. The process is
[`docs/contributing/release-docs.md`](../../../docs/contributing/release-docs.md); the prose
standard is [`docs/contributing/user-docs.md`](../../../docs/contributing/user-docs.md).

**Run this in a fresh session.** A session that has been implementing features is holding the specs,
diffs and review arguments that leak into published prose. You should know the release only through
the inputs below.

## 1. Set up

```bash
git fetch origin && git switch -c release-docs/$(date +%F) origin/main
```

The branch prefix is what lets `validate-user-docs-scope.mjs` accept the PR. Never push to an existing
release-docs branch someone else opened; start a new one.

## 2. Inventory

- **Pending changesets:** every `.changeset/*.md` except `README.md`, skipping empty ones (no package
  in the frontmatter). For each, note its id (file name), packages, bump, body and issue ids.
- **Already covered:** `apps/docs/release-docs.json` lists changesets an earlier pass this release
  reviewed. Those still pending are covered; plan only the rest, but re-read the pages they touched
  so the new writing fits.
- **Docs line per issue:** for each issue id, read only the docs line of
  `specs/issues/<ID>/SPEC.md` (its create / update / remove destinations, or its no-impact reason).
  Don't read the rest of the spec. A bug with no spec has no docs line; decide from the changeset.
- **Public surface since the last release:** the last release of a package is its newest
  `@flow-state-dev/<pkg>@<version>` tag. Diff its exported surface:
  `git diff <tag>..HEAD -- packages/<pkg>/src/index.ts` (and any subpath entry its `package.json`
  `exports` names). Exports the changesets don't mention are a finding: report them in the PR,
  don't document them on a guess.

If there are no uncovered changesets, stop and say so.

## 3. Plan the release's docs

One plan for the whole release, organized by **page**, not by changeset. Several changesets often
land on one concept page; one changeset may touch three.

| Page | Op | Changesets | What a reader can now do |
|---|---|---|---|

- Ops are create / update / remove / merge-into. Check `apps/docs/sidebars.ts` and
  `sidebarsGuides.ts` for where a new page belongs.
- Every changeset appears in the plan, either against pages or under **No docs change** with a
  one-line reason (a bug fix whose documented behavior was already right, a patch below the docs'
  level of detail).
- Prefer rewriting a page over appending to it. If a page now needs a section per feature to explain
  itself, the page is the wrong shape; restructure it.
- A pre-1.0 `minor` can break callers: what a reader changes in their code goes on the release's
  **Upgrading** page, not on the affected page. The plan always has two rows for it: create
  `reference/upgrading/<date>` (today's date, the branch's), and remove the previous release's
  Upgrading page. Every changeset a caller must act on is listed against the create row. The page's
  shape and what earns a row are
  [`release-docs.md`](../../../docs/contributing/release-docs.md#the-upgrading-page) → "The
  Upgrading page". Before the docs cutover the site has no Reference section: skip both rows and
  say so in the PR.

## 4. Write

For each page group in the plan, write a **surface brief** (shape in `.claude/agents/docs-writer.md`
→ "Your brief": Surface, Behavior, Limits, Targets), built from the changeset bodies, the docs lines
and the public surface. Never the spec narrative, never a changeset's issue ids.

1. Dispatch `docs-writer` with the brief. Independent page groups can run in parallel.
2. Dispatch `docs-editor` on its output. Send findings back to the same writer. **Three rounds**,
   then report the page as unconverged in the PR rather than looping.
3. A writer report that **the code contradicts the brief** is a finding for the PR body. Don't fix
   code here.

Package READMEs are in scope: their API sections go through the same pair.
Until the docs cutover, a package README also has a cut copy at
`docs/contributing/docs-revamp/readmes/<dir>.md`: an edit to the long one lands in both, or CI's
`check-cut-readmes.mjs` fails the PR.

## 5. Read it as a set

Run `polish-docs` scoped to the pages this pass touched, plus the overview and nav pages that link
to them. This is what makes the release read as one piece. Then:

```bash
pnpm --filter @flow-state-dev/docs build
```

It must pass. Broken links count.

## 6. Record coverage

Write `apps/docs/release-docs.json` listing **every currently pending, non-empty changeset id** (this
pass's and earlier passes' that are still pending; drop ids no longer in `.changeset/`):

```json
{
  "changesets": ["board-notices", "postgres-bus"],
  "updated": "2026-11-05"
}
```

Only list an id you put in the plan. The Version Packages PR's gate reads this file; listing an id
you didn't review lets a release ship undocumented.

## 7. Open the PR

Commit, push, and open a PR titled `docs: release docs for <date>`. Body:

- The plan table from step 3, with the **No docs change** list and reasons.
- Findings: unconverged pages, exports with no changeset, code that contradicted a brief.
- What the reviewer is asked to do: read the changed pages end to end, as a new user would.

Don't merge it. A person reviews it; merging it turns the Version Packages PR's gate green. The
docs go live when the Version Packages PR merges and packages publish.
