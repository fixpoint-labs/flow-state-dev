# `spec-poc/` — legacy experiments

New issue/epic experiments live with their owning retained spec:

- `specs/issues/<ISSUE-ID>/poc/<experiment>/`
- `specs/epics/<EPIC-ISSUE-ID>/poc/<experiment>/`

See [`specs/README.md`](../specs/README.md) for navigation and
[Spec-branch POCs](../docs/contributing/orchestration.md#spec-branch-pocs-learn-before-implementing)
for the canonical experiment contract. Retained evidence is not production code:
keep it outside production imports, workspace packages, default builds and test/lint/knip
discovery. Keep authored artifacts, not installed dependencies, generated output or secrets.

A POC added after the owning spec merges uses a follow-up PR from fresh `main`.
Never reopen or push to the original merged review PR. Materially changed direction
needs renewed human approval under the [amendment rule](../docs/contributing/orchestration.md#merging-and-amending-a-spec).

Do not migrate or delete unrelated historical POCs in this directory or on old branches.
This guide changes where new work goes, not the historical archive. A claim settlement
in a disposable worktree and an app's private `_prototypes/` exploration remain distinct
from retained spec evidence.
