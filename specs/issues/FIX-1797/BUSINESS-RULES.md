# FIX-1797 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md)

When a run may start, what it runs on, and what happens to a finding. What each step checks and
which step each control fails are in [PLAN.md](PLAN.md). The states the run shows absent are
SPEC's [*not done if*](SPEC.md#the-goal-and-how-well-know-its-met). *Proved by* names the plan
step or report line that shows the rule held.

## When a run may start

| # | When | Then | Proved by |
|---|---|---|---|
| QR-1 | Any child of FIX-1786 other than FIX-1795 is not merged (every PR of a multi-PR child; FIX-1802, which joined under the epic's [D8](../../epics/FIX-1786/DECISIONS.md#d8), included), or CI is red on `main` | No final run. Each blocks this issue in Linear | Linear · the report lists each merge commit |
| QR-2 | FIX-1788's last PR merges | The coordinator dispatches the milestone run on that merge commit ([D1](DECISIONS.md#d1)), under the milestone sub-issue it created when this spec merged, related to FIX-1791 and FIX-1795, not blocking them: their builds run in parallel, and neither gets implementation merge authorization while the sub-issue is open. The run uses the milestone's own steps, which use only what that commit has. It and its reruns (QR-15) are the only runs before QR-1 holds | The milestone report names the commit |
| QR-3 | A child joins FIX-1786 mid-run, a finding included | It blocks this issue ([ER-27](../../epics/FIX-1786/BUSINESS-RULES.md#how-the-set-is-run)); the run in flight opens no closure PR | The epic wake |
| QR-4 | QR-1 holds | One `main` commit is picked, and every check in parts 1 to 4 runs against it | Every verdict row carries that SHA |
| QR-5 | Someone wants the check outside a closure | It runs on demand only: at this closure, and at the closure of each later epic that touches workers, coordinators or projects. Not a CI gate, no schedule: it rests on a real model with no retry | `goal.md` |
| QR-6 | No model key is set, or no Chromium starts | The run is *blocked*, not failed. With no browser, the browser steps go to `fsd-qa` over the mailbox | Report |

## What a run runs on

| # | When | Then | Proved by |
|---|---|---|---|
| QR-7 | A leg runs | Against a production build of Shift Manager from that commit on its DevTeam install, served by its own command, as Alice (the owner) and Bob (the second member), each in a browser context and a route client carrying only their own verified bearer | The build step; each context's user |
| QR-8 | A run starts | It owns its store files, each created fresh: one for legs a and b across their restarts, one for leg c, one per control, one for c7's old store, one for J1. No step reads another's file. All are deleted when the run ends | The report names each file and its steps |
| QR-9 | A step makes a change | Through the app ([D2](DECISIONS.md#d2)): the screen, else a coordinator turn, else the app's own action as that user. Never a store write, a fixture or a block the check calls | The report tags each step's surface |
| QR-10 | A model turn is graded | Once. A miss is a finding, quoting the turn's tool calls and results by item id. A provider error re-runs that one turn and is reported | Report |
| QR-11 | A control runs | On its own scratch patch over a copy of the commit, over a fresh store. The pre-epic baseline control is its own checkout and build of the commit before the first child's implementation merged, which the run resolves and records; it has its own expectation ([PLAN → Controls](PLAN.md#controls)) | Each patch in full, each SHA, the baseline's resolved SHA |
| QR-12 | c7 runs | On a store the pre-epic baseline wrote with Alice's records in it, upgraded only by the steps the published docs give | The steps, quoted from the page |

## What happens to a finding

| # | When | Then | Proved by |
|---|---|---|---|
| QR-13 | A step, a control, a part-3 check or a *required* part-4 row fails | Filed through `issue-manager` as a Bug (a Feature for a missing capability), under FIX-1786, blocking this issue | Linear |
| QR-14 | A finding matches an open issue | The closure worker wires it: under FIX-1786 (or `relates-to` if it has another parent), blocking this issue | Linear |
| QR-15 | The milestone run files a finding | The finding blocks the milestone sub-issue and this issue. When its fix merges, the coordinator dispatches the milestone again on that merge commit. The sub-issue closes only on a rerun that files nothing, and until it does the coordinator authorizes neither FIX-1791 nor FIX-1795 to merge; closing the bug alone releases neither | Linear · the rerun's report names the fix commit |
| QR-16 | An older check is red, or deleted with no line naming what replaced it ([D3](DECISIONS.md#d3)) | A finding against the child whose PR touched what the check asserts | P3.9 |
| QR-17 | A promised screen is missing or broken | A finding against the child that promised it; an unpromised one is an observation ([D2](DECISIONS.md#d2)) | Report |
| QR-18 | J1 hits a step the docs don't cover | A failed step, reason *doc silent*: QR-13 | J1 |
| QR-19 | The run files anything | No PR. The row stays at `NEEDS_IMPLEMENTATION`. When the last fix merges, **the whole plan** runs again on a fresh commit | The epic wake |
| QR-20 | The owner closes a finding with a reason | The report quotes it; whoever records the drop removes the blocks relation | Report |
| QR-21 | A final run files nothing | The closure PR opens with the goal check and its verdict log; its body is the report | The closure PR |

## Failure taxonomy

A check that cannot run stops the run and is reported as blocked, not failed (QR-6). A build or
boot that fails on `main` is a finding. A provider error is retried once per turn (QR-10). A
control that fails at setup, or reddens a step it doesn't name, is a finding against the control.

## Acceptance criteria this issue owns

The milestone run on FIX-1788's merge commit files nothing, or reruns on each fix's merge commit
until it does. Then one
final run on one `main` commit files nothing: legs a to c pass and each control fails its step,
J1 passes, part 3 passes with every older check green or retired with its line, and every
required part-4 row holds (QR-21).
