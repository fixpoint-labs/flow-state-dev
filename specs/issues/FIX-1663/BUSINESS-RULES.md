# FIX-1663 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

When the run starts, what it runs on, and what it does with findings. What each leg checks, and
which legs each control fails, is in [PLAN.md](PLAN.md#checks). *Proved by* names the plan step
or report line that shows the rule held.

## When a run may start

| # | When | Then | Proved by |
|---|---|---|---|
| QR-1 | FIX-1655, FIX-1662 or FIX-1664 is not merged, or a child [D1](DECISIONS.md#d1) filed is open, or CI is red on `main` | No run. Each blocks this issue | Linear · the report lists each merge commit |
| QR-2 | The final design hand-back is not committed under the epic's `assets/design/` and linked on FIX-1649 | No run; the row reports *blocked on the final hand-back* ([epic ER-9](../../epics/FIX-1649/BUSINESS-RULES.md#how-the-set-is-run)) | Report |
| QR-3 | A child joins the epic mid-run | It blocks this issue; the run in flight cannot open the closure PR | The epic wake |
| QR-4 | The last blocker merges | One `main` commit is picked, and every check in parts 1 to 4 runs against it | Every verdict row carries that SHA |

## What a run runs on

| # | When | Then | Proved by |
|---|---|---|---|
| QR-5 | A leg runs | Against a production build of Shift Manager from that commit, built by the run, in real Chromium | The build step |
| QR-6 | Leg a runs | Under a real org with a key and a real model set; a1 to a3 raise their ask and board row through D1's children's deterministic paths, and only a4's answer rests on the model. Legs b and c set no key; each fails if one is | The report names the model; the key assertion |
| QR-7 | Leg c runs | On a second build of the same commit with only the theme import removed, started on `--shift day` and then `--shift night` | The patch, in the report |
| QR-8 | A control runs | On its own build or server start. Today's `main` is the commit before FIX-1662's first merge | The report names each build's SHA and patch |
| QR-9 | a4's answer does not arrive in the seat's running task session within its window | A finding, never flake; not retried | Report |
| QR-10 | Any other check fails | A finding | Report |

## The plan

| # | When | Then | Proved by |
|---|---|---|---|
| QR-11 | Part 1 runs | Legs a, b and c pass, and each control fails the leg [Controls](PLAN.md#controls) names, at its signal | a1 to a4, b, c |
| QR-12 | Leg b's Lab is opened | By an isolated writer that sees only Shift Manager's README and the pentest tree; each step it had to guess is a finding ([D2](DECISIONS.md#d2)) | b0 in the report |
| QR-13 | Leg c renders | Every swept part appears on the page at least once in each theme pass; one that never does is a finding | c's sweep table |
| QR-14 | Part 2 runs | Each team journey passes | J3, J4 |
| QR-15 | Part 3 runs | Every child's check passes with its controls failing, and the goal labs' own checks stay green | P3.1 to P3.3 |
| QR-16 | Part 4 runs | Each row holds, and each *not done if* state is shown absent | P4 |

## What happens to a finding

| # | When | Then | Proved by |
|---|---|---|---|
| QR-17 | A check, a control or a part-4 row fails | Filed through `issue-manager` as a Bug (a Feature for a missing capability), under FIX-1649, blocking this issue | Linear |
| QR-18 | A finding matches an open issue | The closure worker wires it: under FIX-1649 (or `relates-to` if it has another parent), blocking this issue | Linear |
| QR-19 | A finding is a sibling epic's meaning (what a project, task state or ask is) | Filed on that sibling epic, not blocking this issue, unless Shift Manager shows an invented model in its place (epic ER-5), which is this epic's | Report |
| QR-20 | A doc gap that breaks no step leg b or part 2 follows | Filed `relates-to` FIX-1649, not blocking | Linear |
| QR-21 | The run files anything | No PR. The row stays at `NEEDS_IMPLEMENTATION`. When the last fix merges, **the whole plan** runs again on a fresh commit | The epic wake |
| QR-22 | The owner closes a finding with a reason | The report quotes it; whoever records the drop removes the blocks relation | Report |
| QR-23 | A run files nothing | The closure PR opens: the goal check, the pentest config, and the report as its body: the commit, each PASS and its controls' FAILs, each journey, each finding and its retest | The closure PR |

## Not done if · each state the run shows absent

| State that looks done | Absent when |
|---|---|
| A leg ran on kitchen-sink's tree, or on a tree the epic doesn't pin | The report names both trees' paths (QR-5) |
| Checks ran on different commits | Every verdict row carries the one SHA (QR-4) |
| A journey was skipped because the tree couldn't produce it | a1 and a2 each have a PASS row, not a skip |
| A swept part was never rendered in leg c | QR-13 |
| Leg c passed because more than the theme was removed | The patch in the report is the theme import alone |
| A reused component was restyled in Shift Manager, or a copy differs from its source | FIX-1655's drift check, with Shift Manager listed, in part 3 |
| A Shift Manager value sits in an FSD package | Leg c's static half, and FIX-1655's check in part 3 |
| A surface shows a model the shell invented | Leg a's rows equal store rows by id; J4 |
| A Lab needed a wrapper, or opened with no org | b0 and b's no-org step |
| A control never failed, or failed at setup | Each FAIL names its leg and signal, except today's `main`, whose expected red is that Shift Manager is absent |
| Final visuals merged before the final hand-back | P4's hand-back row |

## Failure taxonomy

A check that cannot run stops the run and is reported as blocked, not failed: no browser, no key
for leg a, the hand-back missing. A missing browser sends the check to `fsd-qa` over the mailbox.
A build that fails on `main` is a finding.

## Acceptance criteria this issue owns

One run on one `main` commit files nothing, and QR-11 to QR-16 hold on it (QR-23).
