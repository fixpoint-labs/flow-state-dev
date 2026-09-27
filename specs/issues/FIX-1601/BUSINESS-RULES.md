# FIX-1601 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

These rules govern the run: when it starts, what it runs on, and what it does with findings.
What each leg checks is defined in [PLAN.md](PLAN.md#checks); these rules point there.
*Proved by* names the plan step or report line that shows the rule held.

## When a run may start

| # | When | Then | Proved by |
|---|---|---|---|
| QR-1 | Any other child is not merged ([FIX-1609](https://linear.app/fixpoint-labs/issue/FIX-1609), [FIX-1610](https://linear.app/fixpoint-labs/issue/FIX-1610), [FIX-1611](https://linear.app/fixpoint-labs/issue/FIX-1611), [FIX-1612](https://linear.app/fixpoint-labs/issue/FIX-1612) are open), nor this amendment, or CI is red on `main` | No run. Each child blocks this issue | Linear · the report lists each merge commit |
| QR-2 | A child joins mid-run | It blocks this issue; the run in flight cannot open the closure PR | The epic wake |
| QR-3 | The last child merges | One `main` commit is picked, and every check in parts 1 to 4 runs against it | Every verdict row carries that SHA |

## What a run runs on

| # | When | Then | Proved by |
|---|---|---|---|
| QR-4 | A gated browser check runs | Against a production build of that commit, built by the run, in test mode on the memory store | The build step |
| QR-5 | A gated check runs | No provider key is set. The goal check fails if one is | The key assertion |
| QR-5a | The smoke, FIX-1610's live leg or `cli-principal` runs | In one keyed session on that commit, outside CI; the smoke without test mode | The report names the models |
| QR-5b | Today's `main` runs as a control | On its own build of the last commit before FIX-1609 and FIX-1610, old names passed in. It counts only when a leg fails at its own signal | The report names that SHA |
| QR-6 | The Playwright suite runs | Serially, `--workers=1` ([D2](DECISIONS.md#d2)) | The command in the report |
| QR-7 | FIX-1600's test, as re-pointed, fails | Re-run alone, up to twice. A pass is reported with the attempt count and FIX-1600. Three failures is a finding | Report |
| QR-8 | Any other check fails, the goal check included | A finding | Report |
| QR-8a | A smoke post gets no answer or two, or a clear one or the follow-up reaches the wrong specialist | A finding, never flake ([epic D3](../../epics/FIX-1592/DECISIONS.md#d3)) | Report |

## The plan

| # | When | Then | Proved by |
|---|---|---|---|
| QR-9 | Part 1 runs | Legs a to c pass before any reload and after their last one; each control fails its legs and leaves the rest green; the smoke passes | P1a to P1s · [Controls](PLAN.md#controls) |
| QR-10 | Part 2 runs | The escalation passes, and fails under FIX-1611's filing control | P2e |
| QR-11 | Part 3 runs | Every child's check passes with its held-outs, each control fails its own leg, and the ER-18 set stays green as re-pointed | P3.1 to P3.3 |
| QR-12 | `durable-hire-survives-redeploy` runs | It passes. Any failure is a finding, with no carve-out ([D3](DECISIONS.md#d3)) | P3.2 |
| QR-13 | Part 4 runs | Each row holds, and each state below is shown absent | P4 |

## What happens to a finding

| # | When | Then | Proved by |
|---|---|---|---|
| QR-14 | A check, a control or a part-4 row fails | Filed through `issue-manager` as a Bug (a Feature for a missing capability or control), under FIX-1592, blocking this issue | Linear |
| QR-14a | A doc gap that does not break the flows the legs and the smoke use | Filed as `relates-to` the epic. It does not block this issue | Linear |
| QR-15 | A finding matches an open issue | The closure worker wires it: under FIX-1592 (or `relates-to` if it has another parent), blocking this issue | Linear |
| QR-16 | A finding is FIX-1591's ground: draining `escalations` or the boot warning's fate | Filed normally, off the epic | Report |
| QR-17 | The run files anything | No PR. The row stays at `NEEDS_IMPLEMENTATION`. When the last fix merges, **the whole plan** runs again on a fresh commit | The epic wake |
| QR-18 | The owner closes a finding with a reason | The report quotes it; whoever records the drop removes the blocks relation | Report |
| QR-19 | A run files nothing | The closure PR opens with the goal check and the report: the commit, each PASS and its controls' FAILs, the smoke, each finding and its retest | The closure PR |

## Not done if · each state the run shows absent

| State that looks done | Absent when |
|---|---|
| The checks ran on different commits | Every verdict row carries the one SHA (QR-3) |
| A gated check needed a key | The key assertion held (QR-5) |
| A leg passed only after a reload, or off the CLI | Every leg asserts on the open page first |
| The answer landed because the script called the post tool | Leg a never calls it; `no-landing` fails a |
| One post ran two specialists | P1b, and `no-route` fails b |
| A specialist holds another's case, or its direct turns | P1b · part 4's segmentation row |
| The live view is a kitchen-sink poll | Part 4's no-poll row · `no-live` fails a |
| The smoke was skipped, or a missing answer called flake | P1s is in the report (QR-8a) |
| A control never failed, or failed at setup | Each control's FAIL names its leg (QR-5b) |

## Failure taxonomy

A check that cannot run stops the run and is reported as blocked, not failed. A missing browser
sends the check to `fsd-qa`. A build that fails on `main` is a finding.

## Acceptance criteria this issue owns

One run on one `main` commit files nothing, and QR-9 to QR-13 hold on it. The closure PR
carries the goal check and the report.
