# FIX-1636 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md)

When a run may start, what it runs on, and what it does with findings. What each leg checks is
in [PLAN.md → Checks](PLAN.md#checks). *Proved by* names the plan check or report line that shows
the rule held.

## When a run may start

| # | When | Then | Proved by |
|---|---|---|---|
| QR-1 | A child of FIX-1635 other than FIX-1636, FIX-1658 and FIX-1665 is not Done, or `main`'s CI is red | No run | The POC's Linear assertion · the report lists each child's merge commits |
| QR-2 | A child joins mid-run, or the owner admits FIX-1665 or FIX-1658 to the done bar | It is wired to block this issue; the run in flight cannot open the closure PR | The epic wake |
| QR-3 | The last blocking child merges | One `main` commit is picked. The closure branch is that commit plus the runner, and its diff from it touches nothing under `packages/` or `apps/` | Every verdict row carries that SHA · the diff stat in the report |

## What a run runs on

| # | When | Then | Proved by |
|---|---|---|---|
| QR-4 | Leg a runs | Every publishable package is packed after `release:build` and installed, all together, into one empty ESM project | The job's existing checks |
| QR-5 | A leg b or c case runs | From that installed project. Every `@flow-state-dev/*` id it resolves, deep subpaths included, has a realpath under the project's `node_modules/`; otherwise the run fails, naming the case and the id | P1-resolve |
| QR-6 | Any suite case is skipped, or fewer case files ran than the suite directory holds, counted at runtime | The run fails | P1-total |
| QR-7 | `REDIS_URL` is unset, or Redis is unreachable, when leg c would run | The runner refuses to start leg c, whether or not `CI` is set; the queue case never skips. Locally the worker starts `redis-server`; in CI a service container provides it | P1c · S3 |
| QR-8 | No provider key may be set | The run is keyless; FIX-1628's case uses a scripted model | The runner's environment |
| QR-9 | A check fails on the closure commit | A finding. Only the two tests [D3](DECISIONS.md#d3) names may be re-run, once, and only in part 3 | Report |

## The plan

| # | When | Then | Proved by |
|---|---|---|---|
| QR-10 | Part 1 runs | Leg a passes and fails against the 0.1.1 tarball; every suite case passes against the install; the workspace-link control fails the resolution check | P1a · P1b · P1c · P1-resolve · P1-total · P1-control |
| QR-11 | Part 1 runs | Every team in the epic's table maps to a part-1 leg, so no part-2 journey is needed; a team with none gets one | [The mapping](PLAN.md#part-1-walks-every-team) |
| QR-12 | Part 3 runs | `pnpm test` passes on the commit, every file in the manifest ran with no skips, and each hole's child has a recorded pre-fix failure for its case | P3.1 · P3.2 · P3.3 |
| QR-13 | Part 4 runs | Each seam row holds, the docs are followed as written, and each *not done if* state is shown absent | P4 |

## What happens to a finding

| # | When | Then | Proved by |
|---|---|---|---|
| QR-14 | A check, a control or a part-4 row fails | Filed through `issue-manager` as a Bug (a Feature for a missing capability), under FIX-1635, blocking this issue | Linear |
| QR-15 | A finding matches an open issue (FIX-1665 among them) | The closure worker wires it under FIX-1635, blocking this issue, and the report says the owner's open question now blocks the wrap | Linear · report |
| QR-16 | Something noticed outside the epic's goal (the D3 tests failing twice, the pre-existing controller cleanup) | Filed normally, off the epic ([ER-15](../../epics/FIX-1635/BUSINESS-RULES.md#what-no-child-may-do)) | Report |
| QR-17 | The run files anything | No PR. The row stays at `NEEDS_IMPLEMENTATION`. When the last fix merges, **the whole plan** runs again on a fresh commit | The epic wake |
| QR-18 | The owner closes a finding with a reason | The report quotes it; whoever records the drop removes the blocks relation | Report |
| QR-19 | A run files nothing | The closure PR opens with the runner and the report. Its CI's packed-install job must pass too | The closure PR |

## Not done if · each state the run shows absent

| State that looks done | Absent when |
|---|---|
| A case ran against the repository, not the install | P1-resolve, and P1-control proved it can fail |
| A case was skipped, Redis included | P1-total · QR-7 |
| The checks ran on different commits | Every verdict row carries the one SHA (QR-3) |
| A hole's case has no recorded failure before its fix | P3.3 |
| A finding is open | QR-17 |
| A child's test from source was lost in a later merge | P3.2, against the manifest |

## Failure taxonomy

A check that cannot run (no registry access, no Redis binary) stops the run and is reported as
blocked, not failed. A build that fails on `main` is a finding.

## Acceptance criteria this issue owns

One run on one `main` commit files nothing, QR-10 to QR-13 hold on it, and the closure PR's CI
passes the same job (QR-19). That is the epic's [ER-19](../../epics/FIX-1635/BUSINESS-RULES.md#the-closure).
