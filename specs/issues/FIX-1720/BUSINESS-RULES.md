# FIX-1720 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md)

When a run starts, what it runs on, and what happens to a finding. What each step checks, which
step each control fails, and what the report holds are in [PLAN.md](PLAN.md). The states the run
shows absent are SPEC's [*not done if*](SPEC.md#the-goal-and-how-well-know-its-met). *Proved by*
names the plan step or report line that shows the rule held.

## When a run may start

| # | When | Then | Proved by |
|---|---|---|---|
| QR-1 | FIX-1621, FIX-1718 (every PR: PR 3 with [D1](DECISIONS.md#d1)'s workstreams, and the CoS wiring), FIX-1719 (both PRs), or the two Shift Manager surfaces the legs drive, FIX-1722 (the Chief of Staff view) and FIX-1723 (TEAMS), is not merged, or CI is red on `main` | No run. Each blocks this issue | Linear · the report lists each merge commit |
| QR-2 | A child joins FIX-1650 mid-run, a finding included | It blocks this issue; the run in flight opens no closure PR | The epic wake |
| QR-3 | The last blocker merges | One `main` commit is picked, and every check in parts 1 to 4 runs against it | Every verdict row carries that SHA |
| QR-4 | No model key is set, or no Chromium starts | The run is *blocked*, not failed. With no browser, the check goes to `fsd-qa` over the mailbox | Report |
| QR-5 | Someone wants the check outside a closure | It runs on demand only: at this closure and at the closure of each later epic that touches CoS. It is not a CI gate and has no schedule, because it rests on a real model with no retry | `goal.md` |

## What a run runs on

| # | When | Then | Proved by |
|---|---|---|---|
| QR-6 | A leg runs | Against a production build of Shift Manager from that commit, started with `--team devteam`, in real Chromium, as the profile's owner; the outsider and second member in their own browser contexts | The build step; each context's user |
| QR-7 | A run starts | It owns a set of store files, each created fresh: one shared by legs a and b across their restarts, one for leg c's three boots, one per control, one for J4. No step reads another's file. All are deleted when the run ends, pass or fail. A restart is the server stopped and started again on the same file | The report names each file and the steps on it |
| QR-8 | A CoS turn or the room's answer is graded | Once ([D2](DECISIONS.md#d2)). A miss is a finding, quoting the turn's tool calls and results by item id. A provider error re-runs that one turn and is reported | Report |
| QR-9 | Leg c boots with its cut kind | Boot 1 on the `extra-kind` patch; every later boot is the commit as shipped | The patch, in the report |
| QR-10 | A control runs | On its own build or patch, over a fresh store. Today's `main` is the commit before FIX-1650's first child merged | Each build's SHA and patch |

## What happens to a finding

| # | When | Then | Proved by |
|---|---|---|---|
| QR-11 | A step, a control or a *required* part-4 row fails | Filed through `issue-manager` as a Bug (a Feature for a missing capability), under FIX-1650, blocking this issue | Linear |
| QR-12 | A finding matches an open issue | The closure worker wires it: under FIX-1650 (or `relates-to` if it has another parent), blocking this issue | Linear |
| QR-13 | A step fails on a surface another epic owns (the CoS or Roster screen, a board, attention) | Still a finding within the goal: it blocks this issue, filed under its owner's epic or related to it, as QR-11 and QR-12 wire it. Only a part-4 *observation*, outside the epic's goal, is filed normally and blocks nothing | Linear |
| QR-14 | J4 hits a step the docs don't cover | A failed step, reason *doc silent*: QR-11 | J4 |
| QR-15 | The run files anything | No PR. The row stays at `NEEDS_IMPLEMENTATION`. When the last fix merges, **the whole plan** runs again on a fresh commit. With D2, one model miss costs one full run | The epic wake |
| QR-16 | The owner closes a finding with a reason | The report quotes it; whoever records the drop removes the blocks relation | Report |
| QR-17 | A run files nothing | The closure PR opens with the goal check and its verdict log; its body is the report | The closure PR |

## Failure taxonomy

A check that cannot run stops the run and is reported as blocked, not failed (QR-4). A build or
boot that fails on `main` is a finding. A provider error is retried once per turn (QR-8).

## Acceptance criteria this issue owns

One run on one `main` commit files nothing: legs a to c pass and each control fails its leg, J4
passes, part 3 passes, and every required part-4 row holds (QR-17).
