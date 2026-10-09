# FIX-1532 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md)

The cases, as rules. "This PR's ids" means the ids read from its branch name and title
([E1](DECISIONS.md#e1)). Every row is proved by a unit test on the exported check unless it says
otherwise.

## A new fragment

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A new fragment cites an id that is one of this PR's ids | Passes | Unit |
| BR-2 | A new fragment cites only ids that are not this PR's | Fails, naming the ids it cites, this PR's ids, and where they came from (branch or title) | Unit · #1391's real inputs |
| BR-3 | A new fragment cites a sub-issue and this PR's issue | Passes. One match is enough ([D1](DECISIONS.md#d1)) | Unit |
| BR-4 | Two new fragments, one matching and one not | Only the non-matching one is reported | Unit |
| BR-5 | The branch and title name no id | The match is skipped; one notice line says so; the presence check still runs ([E2](DECISIONS.md#e2)) | Unit |
| BR-6 | A new fragment has no package bump (an empty changeset) | Skipped, as today | Unit |

## Reading this PR's ids

| # | When | Then | Proved by |
|---|---|---|---|
| BR-7 | The branch is `claude/fix-1532-thing` or `spec/FIX-1532` | This PR's ids include `FIX-1532` | Unit |
| BR-8 | The branch is `claude/project-thread-8ra0ke` | No id is read from it ([E5](DECISIONS.md#e5)) | Unit |
| BR-9 | The title is `fix(core): thing (FIX-1, FIX-2)` | Both are this PR's ids | Unit |
| BR-10 | The branch or title carries `LAB-138a` | This PR's ids include `LAB-138` ([E4](DECISIONS.md#e4)) | Unit |
| BR-11 | The PR body names other ids | They are not read | Unit · #1391's real body |
| BR-12 | The run has no event payload (a local run) | This PR's ids come from the current branch alone; no title | Unit |
| BR-17 | The PR title is edited after a green run | The guard runs again on the new title ([E7](DECISIONS.md#e7)) | Observed once on the implementation PR: edit its title, see a new run |

## Suffixed ids in a fragment (FIX-1263)

| # | When | Then | Proved by |
|---|---|---|---|
| BR-13 | A fragment cites only `LAB-138a` | Fails, naming `LAB-138a` and the bare id `LAB-138` | Unit |
| BR-14 | A fragment cites `LAB-138a` and `LAB-138` | Passes the presence check; `LAB-138` is matched against this PR's ids | Unit |
| BR-15 | A fragment cites no id and no suffixed id | Fails with today's "no issue id" reason | Unit |

## Unchanged

| # | When | Then | Proved by |
|---|---|---|---|
| BR-16 | An existing fragment is edited | Today's presence check only: it needs some issue id, not this PR's ([E3](DECISIONS.md#e3)) | Unit |
| BR-18 | The PR adds no fragment | Passes | Unit |

## Failure taxonomy

Every rule failure exits 1 with the offending path and a reason a person can act on. A missing
event payload or an unreadable one is not a failure: the guard falls back to the branch
(BR-12). A failed `git diff` against the base stays fatal, as today.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met): #1391's case fails naming both ids, a
fragment citing only `LAB-138a` fails naming `LAB-138`, and editing a PR's title re-runs the
guard. Today's guard passes #1391's case.
