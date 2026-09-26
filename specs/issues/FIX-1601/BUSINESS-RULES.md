# FIX-1601 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

A closure issue's rules are about the run, not a feature: when it may start, what it runs on,
what counts, and what happens to what it finds. *Proved by* names the plan step or the report
line that shows the rule held.

## When a run may start

| # | When | Then | Proved by |
|---|---|---|---|
| QR-1 | Any of FIX-1585, FIX-1589, FIX-1590, FIX-1594 is not merged | No run. Implementation of this issue is blocked by each | Linear blocked-by · the report lists each child's merge commit |
| QR-2 | A child joins the epic mid-run, or a finding is filed | It blocks this issue too. The run in flight finishes, but its result cannot open the closure PR | The epic wake · the report |
| QR-3 | The last child merges | One `main` commit is picked. Every check in parts 1 to 4 runs against it, and the report names it once, at the top | Report header · every verdict row carries that SHA |

## What a run runs on

| # | When | Then | Proved by |
|---|---|---|---|
| QR-4 | Any browser check runs | Against a production build of that commit, built by the run, under `KITCHEN_SINK_TEST_MODE=1` and the memory store | Each goal check's build step |
| QR-5 | Any check runs | No provider key is set in its environment. The goal check fails fast if one is | The goal check's key assertion · `intentFreeEnv` |
| QR-6 | The Playwright suite runs | Serially, `--workers=1` ([D2](DECISIONS.md#d2)) | The command in the report |
| QR-7 | The FIX-1600 otto test fails | It is re-run alone, up to twice. A pass is reported with the attempt count and FIX-1600. Three failures is a finding | Report · [D2](DECISIONS.md#d2) |
| QR-8 | Any other check fails, the goal check included | A finding. No retry | Report |

## The plan

| # | When | Then | Proved by |
|---|---|---|---|
| QR-9 | Part 1 runs | Legs a to c pass, and each of the four controls fails exactly its named leg. Legs a to c carry FIX-1590's and FIX-1594's signals and controls, so those two checks are not re-run. If either can't be carried in full, that check re-runs in part 3 | P1 in [PLAN.md](PLAN.md#checks) |
| QR-10 | Part 2 runs | Leg d passes and fails under `GOAL_CONTROL=echo` | P2 |
| QR-11 | Part 3 runs | FIX-1585's and FIX-1589's goal checks pass with their held-outs, and each named control fails its own leg. The epic's ER-18 set stays green | P3 |
| QR-12 | `durable-hire-survives-redeploy` fails | Not a finding if the failure matches FIX-1598's signature and the control leg FIX-1589 recorded stays green. Any other failure is. If FIX-1598 has merged, it must pass ([D3](DECISIONS.md#d3)) | P3 · report quotes it |
| QR-13 | Part 4 runs | Each seam is exercised from both sides; each published page is followed as written; each *not done if* state below is shown absent | P4 |

## What happens to a finding

| # | When | Then | Proved by |
|---|---|---|---|
| QR-14 | A check fails or a seam or page is wrong | Filed through `issue-manager` as a Bug (a Feature when the fix is missing capability), parented under FIX-1592, blocking this issue | Linear |
| QR-15 | A finding matches an open issue | The closure worker wires that issue itself: parented under FIX-1592 (or `relates-to` if it has another parent), blocking this issue | Linear |
| QR-16 | A finding touches FIX-1591's ground: draining `escalations`, a person picking it up, the boot warning's fate | Not a finding against this epic. Filed normally, off the epic | Report |
| QR-17 | The run files anything | No PR. The row stays at `NEEDS_IMPLEMENTATION` with the findings in its status line. When the last one merges, **the whole plan** runs again on a fresh commit | The epic wake |
| QR-18 | The owner closes a finding with a reason | The report quotes the reason, and whoever records the drop removes its blocks relation | Report · Linear |
| QR-19 | A run files nothing | The closure PR opens, carrying the goal check and the report: the commit, each check's PASS and its control's FAIL, each finding with its issue and the run that retested it | The closure PR |

## Not done if · each state the gap sweep shows absent

| State that looks done | Absent when |
|---|---|
| The checks ran on different commits | Every verdict row carries the one SHA (QR-3) |
| A check needed a key | The key assertion held on every run (QR-5) |
| A check read a return value, the CLI or a package test instead of the page | Every leg's evidence is text read off the page after a reload |
| A post lands in otto's direct chat | Leg b: the direct conversation holds nothing with the post's token |
| Otto's channel line wakes iris, or anyone | Leg c: one woken turn per seat per post |
| The clerk's reply is the note, or a fixed string | Leg d: the reply carries `[clerk:answered]` and not the note's token |
| A desk post runs a clerk or the runner | Legs b and d: ada, grace and wren hold nothing with the token |
| The line reads `devuser` | Leg c: labelled `support.otto` |
| Something passes only before the reload | Every leg is graded after one |
| The boot warning vanished | The server log of the run shows it |
| A control never failed | Each control's FAIL row is in the report |

## Failure taxonomy

A failed check is a finding, never a retry, except FIX-1600's test (QR-7). A check that cannot
run (no browser, a build that fails) stops the run and is reported as blocked, not failed; a
browser that can't run here goes to `fsd-qa`. A build failure on `main` is a finding against
whichever change broke it.

## Acceptance criteria this issue owns

- One run, on one `main` commit with all four children merged, files nothing.
- On that commit, legs a to d pass in a real browser, keyless, and each control fails its own leg.
- FIX-1585's and FIX-1589's goal checks and the ER-18 set pass there.
- Every seam and published page in the sweep holds.
- The closure PR carries the goal check and the report.
