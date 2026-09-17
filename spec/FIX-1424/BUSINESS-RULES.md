# FIX-1424 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md)

The cases, written as rules. Each says what a person or the sweep does and what happens. The *proved by* column is the check the plan runs. A human reviews this page; the plan turns it into work.

## Grading one entry

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | An entry is applied and every goal it claims goes red | **KILLED.** The report names the entry, the goals, and that the coverage is proved | CI · the two seed entries, run for real |
| BR-2 | An entry is applied and any goal it claims stays green | **SURVIVED.** The report names the entry and each surviving goal, the sweep continues, and the run exits non-zero | CI · an inert mutation must land here (the negative control) |
| BR-3 | A goal an entry claims is already red before the mutation is applied | **INVALID**, never KILLED. The report says the baseline failed, and the entry's verdict is withheld | CI |
| BR-4 | An entry's `find` text does not match its target file exactly once — zero times, or more than once | **STALE.** Nothing is applied for that entry, the run exits non-zero, and the message names the file and the match count | CI · plant a broken anchor, then remove it |
| BR-5 | Two entries target the same file | Each is applied and reverted on its own. Two mutations are never live at once | CI |
| BR-6 | An entry claims a goal that does not exist, has no `run.mts`, is not model-free, or has no machine-readable `Model:` line | Refused before anything runs, by name, with the reason (D2) | CI |
| BR-7 | An applied mutation makes the goal *error* rather than fail its assertions | Counted red, and the report keeps the distinction visible so nobody reads a crash as coverage | CI |

## The worktree

| # | When | Then | Proved by |
|---|---|---|---|
| BR-8 | The sweep starts and a file some selected entry targets has uncommitted local changes | It refuses to start, naming the file. Nothing is applied (D1) | CI |
| BR-9 | The sweep finishes, by any path — kill, survival, staleness, error | Every mutated file is byte-identical to how it started | CI · `git status --porcelain` empty after each case |
| BR-10 | The sweep is interrupted (Ctrl-C, SIGTERM, or the process dies mid-goal) | The mutation is reverted before exit. A crash that leaves a mutated worktree is the one failure that damages the repository, not just the report | CI · signal the runner mid-run |
| BR-11 | A goal an entry claims hangs | The existing per-goal wall-clock cap applies, the goal is recorded as timed out, and the entry is INVALID — a timeout is not a red | CI |

## The report

| # | When | Then | Proved by |
|---|---|---|---|
| BR-12 | A sweep completes | One table: per entry, the regression in plain words, the claimed goals, and one of KILLED / SURVIVED / INVALID / STALE | CI |
| BR-13 | Any entry is SURVIVED, STALE or INVALID | Non-zero exit, so a caller (or a schedule) can't read a broken sweep as a good one | CI |
| BR-14 | Anyone reads a completed sweep | The report states what the catalogue does **not** cover — that it is hand-authored, that model-backed goals are out of scope, and how many goals no entry claims. Never a score or a percentage | CI · assert the report carries the uncovered count |
| BR-15 | `--list` is passed | Entries and their claimed goals are printed and nothing is applied or run | CI |

## Failure taxonomy

STALE, INVALID and a refused entry (BR-6) are **configuration** failures: loud, non-zero, and nothing was measured — they must never read as coverage. SURVIVED is a real **finding** about a goal, also non-zero. Only KILLED is a pass. A failure to revert (BR-9, BR-10) is the one fatal class, because it leaves the repository modified; everything else is confined to the report. Nothing retries: a retried mutation run would mask exactly the non-determinism D2 exists to exclude.

## Acceptance criteria this issue owns

The two regressions hand-simulated during FIX-1367's review are entries in the catalogue, and `pnpm goal:mutate` shows each one turning the goals that claim it red, with an unmutated baseline green and the worktree clean afterwards. A deliberately inert mutation over the same goals is reported SURVIVED rather than KILLED — that is the run which proves the sweep can tell the difference.
