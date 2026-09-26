# FIX-1601 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

These rules govern the run: when it starts, what it runs on, and what it does with findings.
What each leg checks is defined in [PLAN.md](PLAN.md#checks); these rules point there.
*Proved by* names the plan step or report line that shows the rule held.

## When a run may start

| # | When | Then | Proved by |
|---|---|---|---|
| QR-1 | Any of the four children, [FIX-1598](https://linear.app/fixpoint-labs/issue/FIX-1598) or the epic amendment [#2289](https://github.com/fixpoint-labs/flow-state-dev/pull/2289) is not merged, or CI is red on `main` | No run. This issue is blocked by each child and by FIX-1598 | Linear · the report lists each merge commit |
| QR-2 | A child joins mid-run | It blocks this issue; the run in flight cannot open the closure PR | The epic wake |
| QR-3 | The last child merges | One `main` commit is picked, and every check in parts 1 to 4 runs against it | Every verdict row carries that SHA |

## What a run runs on

| # | When | Then | Proved by |
|---|---|---|---|
| QR-4 | A browser check runs | Against a production build of that commit, built by the run, in test mode on the memory store | The build step |
| QR-5 | Any check runs | No provider key is set. The goal check fails if one is | The key assertion |
| QR-6 | The Playwright suite runs | Serially, `--workers=1` ([D2](DECISIONS.md#d2)) | The command in the report |
| QR-7 | FIX-1600's otto test fails | It is re-run alone, up to twice. A pass is reported with the attempt count and FIX-1600. Three failures is a finding | Report |
| QR-8 | Any other check fails, the goal check included | A finding | Report |

## The plan

| # | When | Then | Proved by |
|---|---|---|---|
| QR-9 | Part 1 runs | Legs a to c pass, and each of their four controls fails exactly its leg | P1a to P1c |
| QR-10 | Part 2 runs | Leg d passes, and fails under `echo` | P2d |
| QR-11 | Part 3 runs | All four children's goal checks pass with their held-outs, each control fails its own leg, and the epic's ER-18 set stays green | P3.1 to P3.3 |
| QR-12 | `durable-hire-survives-redeploy` runs | It passes. Any failure is a finding, with no carve-out ([D3](DECISIONS.md#d3)) | P3.2 |
| QR-13 | Part 4 runs | Each part-4 row holds, and each state below is shown absent | P4 |

## What happens to a finding

| # | When | Then | Proved by |
|---|---|---|---|
| QR-14 | A check or a part-4 row fails | Filed through `issue-manager` as a Bug (a Feature for missing capability), under FIX-1592, blocking this issue | Linear |
| QR-14a | A doc gap that does not break the flows legs a to d use | Filed as `relates-to` the epic. It does not block this issue | Linear |
| QR-15 | A finding matches an open issue | The closure worker wires it: under FIX-1592 (or `relates-to` if it has another parent), blocking this issue | Linear |
| QR-16 | A finding is FIX-1591's ground: draining `escalations` or the boot warning's fate | Filed normally, off the epic | Report |
| QR-17 | The run files anything | No PR. The row stays at `NEEDS_IMPLEMENTATION`. When the last finding's fix merges, **the whole plan** runs again on a fresh commit | The epic wake |
| QR-18 | The owner closes a finding with a reason | The report quotes it; whoever records the drop removes the blocks relation | Report |
| QR-19 | A run files nothing | The closure PR opens with the goal check and the report: the commit, each PASS and its control's FAIL, each finding and the run that retested it | The closure PR |

## Not done if · each state the gap sweep shows absent

| State that looks done | Absent when |
|---|---|
| The checks ran on different commits | Every verdict row carries the one SHA (QR-3) |
| A check needed a key | The key assertion held on every run (QR-5) |
| A check read a return value or the CLI | Every leg is read off the page after a reload |
| A post lands in otto's direct chat | P1b |
| Otto's channel line wakes anyone, or reads `devuser` | P1c |
| The clerk's reply is the note, or the boot warning vanished | P2d |
| A desk post runs a clerk or the runner | P1b, P2d |
| A control never failed | Each control's FAIL row is in the report |

## Failure taxonomy

A check that cannot run stops the run and is reported as blocked, not failed. A missing browser
sends the check to `fsd-qa`. A build that fails on `main` is a finding.

## Acceptance criteria this issue owns

One run on one `main` commit files nothing, and QR-9 to QR-13 hold on it. The closure PR
carries the goal check and the report.
