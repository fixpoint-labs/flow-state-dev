# FIX-1532 · Decisions

[Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md)

One decision is the sign-off surface. The rest are engineering calls, recorded so nobody
re-derives them.

```mermaid
flowchart TD
  I["FIX-1532 + FIX-1263"] --> D1["D1 · fail when no id in a new fragment is this PR's<br/>at least one, not all"]
  D1 -.->|"rejected"| X1["warn only<br/>a green run nobody opens"]
  D1 -.->|"rejected"| X2["every id must be this PR's<br/>breaks fragments that cite a parent and a sub-issue"]
  I --> E1["E1 · this PR's ids = branch + title"]
  E1 -.->|"rejected"| X3["+ PR body<br/>#1391's body named FIX-1209 four times"]
  I --> E4["E4 · suffix: diagnose in fragments, strip in branch/title"]
  E4 -.->|"rejected"| X4["accept LAB-138a as an id<br/>FIX-1263 rules out a grammar change"]
```

Solid edges are what you're signing. Dashed edges lost, and the label says why.

<a name="d1"></a>
## D1 · A new fragment fails unless at least one id it cites is this PR's issue

| | |
|---|---|
| **Instead of** | A warning on a green run; or requiring *every* cited id to be this PR's |
| **Because** | The ledger filed this as a guard because reviewer attention is what failed: a warning asks for that same attention. "All" breaks the fragments that already cite a sub-issue and its parent, e.g. `(FIX-850, part of FIX-1804)` on `main` |
| **Locks in** | A PR that bundles fixes for sibling issues under one parent must name the parent in each fragment, or name the siblings in its title. Replaying all 212 changeset PRs merged since the changeset reset, 4 would have failed this way (#2387, #2678, #2710, #2883) and none for a reason other than that ([replay](poc/replay/replay.mjs)) |

It comes down to who catches a wrong id: the guard, at a cost of one added id on ~2% of
changeset PRs, or a reviewer, at no cost until one is missed.

**Why this is not a live fork:** the issue already chose "at least one" and a failing guard. The
replay only priced it, and the remedy is a one-line edit the failure message spells out.

**What would change my mind:** a workflow where bundling sibling fixes is the norm rather than
2%. Then the parent id would belong in the title by convention, and the message should say that
first.

## Engineering calls

- <a name="e1"></a>**E1 · This PR's issue ids come from the branch name and the PR title, never
  the body.** Branch and title are where every lifecycle skill puts the issue id. The body is
  where a PR names its neighbours: #1391's named `FIX-1209` four times, so reading it would pass
  the case this issue exists for. The title is read from the event payload GitHub already writes
  for the run; no API call.
- **E2 · No id in the branch or title → the match is skipped, with a one-line notice.** There is
  nothing to compare against, and failing here would add a new rule ("every PR title names an
  issue") that nobody asked for. At most 20 of the 212 replayed PRs were in this state (fewer
  in fact: the replay can't see some titles), mostly `claude/project-thread-*` branches; the
  presence check still applies to them.
- <a name="e3"></a>**E3 · Only *added* fragments are matched. An edited fragment keeps
  today's presence check.** An edited fragment usually belongs to someone else's issue. Holding
  its editor to their own issue is the "fired at the wrong people" regress the script's header
  records. The rename exemption (case 3) is untouched.
- <a name="e4"></a>**E4 · A suffixed id is diagnosed in a fragment and stripped in the branch
  and title.** In a fragment, `LAB-138a` is still not an id (FIX-1263: "the defect is the
  diagnostic, not the rule"); when no id is found, the guard looks for one with a letter suffix
  and names the bare id. In the branch or title, `lab-138a` or `(LAB-138a)` means "this PR is
  LAB-138", so a sub-PR's fragment that cites the bare parent passes the match. This is the one
  point where the two issues meet, and why they ship together.
- **E5 · Branch ids are read case-insensitively and must end at a separator.** Branches are
  usually lower case (`claude/fix-1532-…`). Requiring a boundary after the number keeps random
  branch suffixes out: `project-thread-8ra0ke` would otherwise read as `THREAD-8`. On the replay,
  that rule took false failures from 13 to 8, all of them the four bundles above.
- **E6 · The decision logic is a pure exported function, tested from `packages/core/test/`.**
  That is how every sibling guard is tested (`spec-folder-check.test.ts`,
  `publish-set-check.test.ts`). The script's header says each case is exercised; no test exists
  today, and this makes the claim true.

## Considered and dropped

| Alternative | Why not |
|---|---|
| Ask Linear which issue the PR is attached to | Needs `LINEAR_API_KEY` in a fork-reachable check and a network call; the branch and title already carry the id |
| Read the PR body, with a weight for the "Links" line | Recovers the bundles, but the #1391 body had the wrong id in prose and the right one on its Links line; a parser that trusts one line of free text is a regress waiting to happen |
| Accept `LAB-138a` as a valid id | A grammar change FIX-1263 rejects: sub-PRs of one issue should cite that issue |

## How it got here

- **Draft** — one spec for both issues, at the architect's request. Framed as "the guard checks
  the id is this PR's", with the suffix diagnostic folded in where the two meet. Direction
  priced by replaying the rule over every changeset PR merged since the reset.

**Open: none.**
