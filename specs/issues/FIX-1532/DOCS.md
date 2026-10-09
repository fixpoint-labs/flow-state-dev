# FIX-1532 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

Contributor docs only. Nothing under `apps/docs` or a package README changes: the guard is a
repository script, and no published package's behaviour moves.

## UPDATE · `docs/contributing/release-notes-workflow.md` · the "Every fragment names its Linear issue" paragraph

Replace its last sentence with:

> `scripts/validate-changeset-refs.mjs` checks this in CI. On a fragment a PR adds, at least one
> cited id must be the PR's own issue, read from its branch name and title (not its
> description). A fragment for a sub-issue fixed under a parent names both, as in
> `(FIX-1621, part of FIX-1719)`. A lettered sub-PR id such as `LAB-138a` is not an issue id:
> cite the bare parent, `LAB-138`. A fragment a PR only edits needs an issue id, not the PR's.

## UPDATE · `docs/contributing/best-practices.md` · BP-022, the "Every non-empty fragment names its Linear issue" bullet

Replace its last sentence with:

> Enforced by `scripts/validate-changeset-refs.mjs`: an added fragment must cite the PR's own
> issue (from its branch or title); an edited one must cite some issue.

## Publication ownership

FIX-1532's implementation PR publishes both edits after V3 and V4 pass, so the docs describe the
rule the guard actually enforces.
