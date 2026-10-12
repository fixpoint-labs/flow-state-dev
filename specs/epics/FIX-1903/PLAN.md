# FIX-1903 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan** · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

An epic plan sequences the work and says what each piece entails. It does not say how to build
any piece; that's each issue's own plan. IDs cross-reference [DECISIONS.md](DECISIONS.md) (D-n)
and [BUSINESS-RULES.md](BUSINESS-RULES.md) (ER-n).

## The path

![The path as of 12 October 2026. An input lane: FIX-1762, a project's repository, done. This epic spec in review at the now line. All three specs and the closure's QA plan start once it merges; FIX-1906's spec carries the build proof. FIX-1906 the local checkout builds first. FIX-1904 the dev profile builds after FIX-1906. FIX-1905 builds as one PR after FIX-1904. The closure run comes last. The critical path runs through this spec, FIX-1906, FIX-1904, FIX-1905 and the closure run](figures/path.svg)

Specs run side by side. Builds are a chain: nothing builds on a worktree until FIX-1906 has
proved one builds, the profile can't point at your checkout until the host can, and FIX-1905
turns Linear on in a profile that has to exist first.

## What each issue entails

| Issue | Route | Consumes | Delivers | Releases | Size |
|---|---|---|---|---|---|
| **FIX-1906** local checkout | spec → impl PR | FIX-1762's host and run source · D3 | **First, before the rest builds on it:** proof that a fresh worktree of this repository installs and builds once, as a thin spike in its spec or its goal check's first leg. The spec chooses how a worktree gets its dependencies: a shared pnpm store, `node_modules` linked from the checkout, or an accepted first-run install, with its latency stated. Then the remote-to-checkout mapping, bound to project ids (ER-13); the project's files beside a worktree of a local checkout; the no-collision test (ER-4); whether a settled run's worktree detaches its branch | FIX-1904 | Medium |
| **FIX-1905** project MCP settings | spec → 1 impl PR, after FIX-1904 merges | The run's project, as `projectWorkspace()` reads it · D4 | The row's server aliases and the host config they resolve against (ER-14), the read at run start, a per-run MCP option on the Claude Code harness, the missing-credential notice, and Linear on both dev projects | The closure run | Medium |
| **FIX-1904** dev profile | spec → impl PR | The mapping · Q1's answer · D2 | The profile and its two projects and briefs; `start` and `dev` defaulting to it; the coder default; the dev page | FIX-1905 | Small–medium |
| **FIX-1919** closure · required | spec (the QA plan) → runs until one is clean → PR | Every other child, merged, on one `main` commit | Both legs, each team's journey, every child's check, the seam sweep, a QA report, and a bug child for every failure | The wrap | Medium, repeats per retest |

## Where it is

[The set table](SPEC.md#the-set--as-of-2026-10-12) is the review-time snapshot. Follow its Linear
links for current state. The one input, FIX-1762, is Done (PRs
[#2737](https://github.com/fixpoint-labs/flow-state-dev/pull/2737) to
[#2748](https://github.com/fixpoint-labs/flow-state-dev/pull/2748)).

## What unblocks what, from here

1. **This spec merges** → all three specs start, and the closure's QA plan with them. When it is
   approved, two Linear relations change to match it: FIX-1875 *blocks* FIX-1905 becomes
   *related* (D1, D4), and FIX-1906 *blocks* FIX-1904 is added.
2. **Q1 is answered** (merging this PR accepts the recommendation unless the owner says otherwise) → FIX-1904's spec states the coder default. Nothing else waits on it.
3. **FIX-1906's spec proves a fresh worktree builds** → the rest is safe to build on; if it can't, that is the kill line. **FIX-1906 merges** → FIX-1904's implementation starts.
4. **FIX-1904 merges** → FIX-1905's implementation PR is opened from `main`.
5. **FIX-1905 merges** → the closure's first run, on one `main` commit. A failure becomes
   a child of this epic that blocks FIX-1919, and the whole plan reruns after it lands.

## Coordination seams to watch

| Seam | Between | Rule |
|---|---|---|
| The dev profile file | FIX-1904 and FIX-1905 | FIX-1904 creates it; FIX-1905 adds only the Linear alias to its two projects and to its host config |
| The coding harness's options | FIX-1904 and FIX-1905 | FIX-1904 picks the harness; FIX-1905 adds per-run MCP servers and lets the run call the servers' tools. Neither widens the run's environment (ER-6) |
| A worktree of this repository | FIX-1906 and the closure | A coding agent that can't install or build in a fresh worktree hits the kill line. FIX-1906's spec proves it can, first, and picks the dependency strategy |
| `apps/docs/docs/shift-manager/overview.md` | FIX-1904 and FIX-1905 | FIX-1904 publishes the dev section; FIX-1905 adds the Linear line to it |
| `apps/docs/docs/workforce/projects.md` | FIX-1905 and FIX-1906 | FIX-1905 adds the MCP setting; FIX-1906 adds the host mapping. Whoever lands second links rather than repeats |

## Not children, deliberately

FIX-1763 (the parent epic for coding runs) · FIX-1762 and FIX-1888 (done, consumed) ·
FIX-1870 and FIX-1875 (hand-over; nothing here waits on them, D4) · FIX-1768 (push and pull
request from a run).

## Wrap

When ER-20 holds: run the lessons pass, dispatch docs polish over the pages above, and report the
outcome from Linear and implementation evidence. Meaningful design amendments go through a
follow-up PR, not a final status commit.
