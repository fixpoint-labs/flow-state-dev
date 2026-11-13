# Release docs

User docs are written once per release, not per PR. Docs written PR by PR came out crammed with
internals and read as a pile of additions, and they documented things nobody could install yet. Now
a PR leaves a changeset, and one pass at release time turns the release's changesets into docs that
are planned, written and reviewed together.

## What counts as user docs

| Path | Who changes it |
|---|---|
| `apps/docs/docs/`, `apps/docs/guides/`, `apps/docs/blog/`, `apps/docs/sidebars*.ts` | Release docs PR only |
| `packages/*/README.md` | Release docs PR only (they ship to npm with the package) |
| `apps/docs/release-docs.json` (the coverage manifest) | Release docs PR only |
| `docs/architecture/`, `docs/contributing/`, `docs/internal/`, `AGENTS.md`, `CLAUDE.md` | Any PR, in the same change (these are for contributors and agents, and track `main`) |
| `apps/docs/src/`, config, scripts | Any PR (site code, not prose) |

`scripts/validate-user-docs-scope.mjs` (workflow **User docs scope**) fails a PR that edits a user-doc
path, unless its branch starts with `release-docs/` or it has the `docs-fix` label. That script holds
the path list; change this table with it.

The PR author picks the branch name and the label, so the check catches accidents and review is the
control. The same goes for the manifest that turns the release gate green. To make either a hard
gate, put `apps/docs/` and `packages/*/README.md` under CODEOWNERS.

Until the docs cutover, each published package has two READMEs: the long `packages/<dir>/README.md`
on npm, and the cut copy that replaces it at cutover, under
[`docs-revamp/readmes/`](./docs-revamp/readmes). A PR that edits a long README edits its cut copy
too. `scripts/check-cut-readmes.mjs` (CI's **Export check** job) can't tell whether an edit reaches
what the short copy says, so it fails a PR that edits the long one alone, and holds each cut copy to its
shape: an install line, one example under 20 lines, and a link to the package's API reference.

## In a normal PR

- Write a changeset if a user of a published package needs to know
  ([release-notes-workflow.md](./release-notes-workflow.md)). That, the issue it names, and the spec's
  docs line are what the release pass works from, so make the changeset say what a user can now do or
  must change.
- If the issue has a spec, keep its docs line (which pages to create, update or remove) accurate. It
  is decided at spec time and used at release time.
- Don't edit user docs. If you find a page that is wrong about something **already released**, fix it
  in its own PR with the `docs-fix` label. It deploys when it merges, unless a release docs pass is
  waiting to publish, in which case it goes live with that release.

## Cutting a release

1. **Decide to release.** Pending changesets have built up on `main`, and the **Version Packages** PR
   (opened by `release.yml`) shows the bumps. Its **Release docs cover this release** check is red.
2. **Run `/release-docs`**: in a fresh Claude Code session, or Actions > **Release docs** > Run
   workflow. It plans the docs for every uncovered changeset, writes them through `docs-writer` and
   `docs-editor`, polishes the touched pages as a set, writes `apps/docs/release-docs.json`, and
   opens one `release-docs/<date>` PR.
3. **Review the docs PR** as a new user would: read the changed pages end to end. Merge it.
4. **The Version Packages PR rebuilds** from `main` and its check goes green. A changeset merged after
   the docs pass turns it red again; run `/release-docs` once more and it covers only the new ones.
5. **Merge the Version Packages PR.** `release.yml` publishes the packages, then triggers the docs
   production deploy, so the live docs change when the packages are installable.

From step 3 until the publish finishes, `main` holds docs for versions nobody can install yet.
Production skips every docs deploy while either of these is true
(`apps/docs/scripts/docs-deploy-gate.mjs`):

- a changeset in `apps/docs/release-docs.json` is still a pending file in `.changeset/` (docs merged,
  Version Packages not yet), or
- a public package's version on `main` isn't on npm (versions bumped, publish not done, failed or
  skipped). If npm can't be reached, it skips too.

The rest of the time, site code and `docs-fix` merges deploy as usual. If a publish fails, rerunning
`release.yml` publishes and deploys the docs.

## The Upgrading page

Migration notes live on one page per release, `reference/upgrading/<date>`, and nowhere else: no
concept, guide or catalog page carries an "After upgrading" or "Migrating" section. Each release's
docs pass writes that release's page and deletes the one before. Each package's `CHANGELOG.md`
keeps the older releases; the page links to them instead of repeating them.

- **What goes on it:** only what a user must do. A changeset whose body says a caller changes their
  code (a renamed or removed export, a changed default, a new required field, a pre-1.0 `minor`
  that breaks callers) is a row. A change a user needs to do nothing about is not, even when it is
  on a concept page.
- **Its shape:** `type: reference` frontmatter, one sentence saying which release it covers, then
  one table, a row per change, grouped by package:

  | Package | What changed | What to do |
  | --- | --- | --- |

  It ends with a link to each changed package's `CHANGELOG.md`. A release with nothing to act on
  gets a page that says so in one sentence, with the links.
- **`<date>`** is the date of the docs pass, the same as its `release-docs/<date>` branch. Packages
  version on their own, so no one version number names a release.
- **Before the docs cutover** the site has no Reference section, and a docs pass writes no Upgrading
  page. The first is written at cutover, from the changesets pending then.

## Setup (once)

- Make **Release docs cover this release** and **User docs change only at release** required checks
  on `main`. The gate job is skipped on every PR but the Version Packages PR, which a required check
  treats as passing.
- `CHANGESETS_TOKEN` must be set for `release.yml` to open the Version Packages PR, and the gate
  only runs because that PR is opened with it.
- `ANTHROPIC_API_KEY` for the **Release docs** workflow, if you want the button.
- The `docs-fix` label.
- `VERCEL_DOCS_DEPLOY_HOOK`: a Vercel deploy hook for the docs project on `main` (Project Settings >
  Git > Deploy Hooks). `release.yml` calls it after a publish. Without it, a release's docs go live on
  the next push to `main`, and the run shows a warning.
