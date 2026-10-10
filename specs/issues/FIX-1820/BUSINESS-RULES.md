# FIX-1820 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md)

When a run may start, what it runs on, and what happens to a finding. What each step checks is in
[PLAN.md](PLAN.md). The states a run shows absent are SPEC's
[*not done if*](SPEC.md#the-goal-and-how-well-know-its-met). *Proved by* names where the report
shows the rule held.

## When a run may start

| # | When | Then | Proved by |
|---|---|---|---|
| QR-1 | Any other child of FIX-1815 is not merged: every PR of FIX-1816 (#2964, #2999, #3015, **and its follow-up #3032**), FIX-1817 (#3014), and every child [Q1](DECISIONS.md#q1) keeps under the epic | No run. Each blocks this issue in Linear | The report lists each merge commit |
| QR-2 | A child joins FIX-1815 while a run is in flight, a finding included | It blocks this issue (the closure rule); the run in flight opens no PR | The epic wake |
| QR-3 | QR-1 holds and CI is green on `main` | One `main` commit is checked out clean, and every part runs against it. A dirty tree, or a part that finds a different `HEAD`, stops the run | Every verdict row carries that SHA |
| QR-4 | No key serves the model | The run is *blocked*, not failed. Nothing needs a browser | Report |
| QR-5 | Someone wants the check outside a closure | On demand only, never a CI gate: it rests on a real model | `goal.md` |

## What a run runs on

| # | When | Then | Proved by |
|---|---|---|---|
| QR-6 | Any part runs | On SQLite, on a store file it creates fresh, behind the server a real process serves. Leg a runs on Shift Manager's DevTeam install; leg b and J4 on leg b's goal-local Lab; each neighbouring check on its own setup. No part reads another's store | The report names each store and its part |
| QR-7 | A restart happens | SIGKILL to the server and every process under it, only after the store shows the wait: `suspended` for an ask, `parked` for a task. Then a new process on the same file | The store state at the kill, and its ms after the hand-off, in the report |
| QR-8 | After a restart, something must move | Only what a person does: list the board's tasks every five seconds, answer, ask, follow up. Never a row write, a waker call or a resume from the runner | The runner's calls, listed in the report |
| QR-9 | A model step misses | The check runs up to `GOAL_ATTEMPTS` fresh stores until it first passes, as each child's check already does (default 3, 1 under a control). Every attempt is in the report. A pass on attempt 3 is a pass; three misses are a finding | Report |
| QR-10 | A control runs | As a scratch patch applied while the server loads, printed in full, refused when it never reached the code, on its own fresh store | Each patch in the report |

## What counts

| # | When | Then | Proved by |
|---|---|---|---|
| QR-11 | A check passes | Every one of its tagged signals held on one attempt | Its verdict line |
| QR-12 | A control runs | It fails at the signal PLAN names, and only that signal's group. One that passes, fails at setup, or reddens another part is a finding against the control | PLAN → Controls |
| QR-13 | A sweep line names a check or package test | That check passed on this commit, or it is a finding. The one *observe* line (ask's shipped caller) is recorded, never filed | PLAN → Part 3 |
| QR-14 | A published promise has no check or package test that reaches it | A finding against the child whose page made it, reason *unchecked promise* | PLAN → Part 3 |

## What happens to a finding

| # | When | Then | Proved by |
|---|---|---|---|
| QR-15 | A check, a control, or a sweep line fails | Filed through `issue-manager` as a Bug (a Feature for a missing capability), under FIX-1815, blocking this issue | Linear |
| QR-16 | A finding matches an open issue | The closure worker wires it: under FIX-1815 (or `relates-to` if it has another parent), blocking this issue | Linear |
| QR-17 | The run files anything | No PR. The row stays at `NEEDS_IMPLEMENTATION`. When the last fix merges, **the whole plan** runs again on a fresh commit | The epic wake |
| QR-18 | The owner closes a finding with a reason | The report quotes it, and whoever records the drop removes its blocks relation | Report |
| QR-19 | A run files nothing | The closure PR opens: the new directory, with the report as its body. No changeset, no product code, no edit to either child's check | The closure PR |

## Failure taxonomy

A check that cannot start is *blocked*, not failed (QR-4). A server that will not boot on the
commit is a finding. A model miss is retried on a fresh store, up to the attempt cap (QR-9); a
provider error inside an attempt fails that attempt. A control that fails at setup is a finding
against the control, never a pass for the check.

## Acceptance criteria this issue owns

One run on one `main` commit files nothing: legs a and b pass and each control fails its named
signal, the neighbouring checks pass, J4 passes and `fresh-store` fails it, and every sweep line holds
(QR-19).
