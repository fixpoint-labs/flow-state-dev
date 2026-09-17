# FIX-1424 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md)

The cases, written as rules. Each says what a person or the sweep does and what happens. The *proved by* column is the check the plan runs. **It names the check, not when it runs**: whether the full sweep gates every pull request or runs off the PR path is an [open decision](DECISIONS.md#open--cadence-run-the-sweep-in-ci-on-every-pr-or-as-a-periodic-sweep-off-the-pr-path), and no rule here presumes an answer. "CI" below means the fast, goal-free checks that already run on every PR. A human reviews this page; the plan turns it into work.

## Grading one entry

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | An entry is applied and every goal it claims renders a **red verdict** — its assertions ran and failed | **KILLED.** The report names the entry, the goals, and that the coverage is proved | The sweep, over the two seed entries, run for real ([cadence is open](DECISIONS.md#open--cadence-run-the-sweep-in-ci-on-every-pr-or-as-a-periodic-sweep-off-the-pr-path)) |
| BR-2 | An entry is applied and any goal it claims stays green | **SURVIVED.** The report names the entry and each surviving goal, the sweep continues, and the run exits non-zero | The sweep, with an inert mutation that must land here — the negative control ([cadence is open](DECISIONS.md#open--cadence-run-the-sweep-in-ci-on-every-pr-or-as-a-periodic-sweep-off-the-pr-path)) |
| BR-3 | A goal an entry claims is already red before the mutation is applied | **INVALID**, never KILLED. The report says the baseline failed, and the entry's verdict is withheld | CI |
| BR-4 | An entry's `find` text does not match its target file exactly once — zero times, or more than once | **STALE.** Nothing is applied for that entry, the run exits non-zero, and the message names the file and the match count | CI · plant a broken anchor, then remove it |
| BR-5 | Two entries target the same file | Each is applied and reverted on its own. Two mutations are never live at once | CI |
| BR-6 | An entry claims a goal that does not exist, has no `run.mts`, is not model-free, has no machine-readable `Model:` line, or does not route its verdict through the shared `runGoal` protocol | Refused before anything runs, by name, with the reason (D2) | CI |
| BR-7 | An applied mutation makes a claimed goal *error* — it exits non-zero without its assertions ever deciding (a syntax, import, startup or infrastructure failure) | **ERRORED**, never KILLED. The entry's verdict is withheld, the report names the goal and that nothing was measured, and the run exits non-zero. A goal that never reached its assertions proves nothing about coverage (D1) | CI · a mutation that makes the target file fail to parse |

## The worktree

| # | When | Then | Proved by |
|---|---|---|---|
| BR-8 | The sweep starts and a file some selected entry targets has uncommitted local changes | It refuses to start, naming the file. Nothing is applied (D1) | CI |
| BR-9 | The sweep finishes, by any path — kill, survival, staleness, error | Every mutated file is byte-identical to how it started | CI · `git status --porcelain` empty after each case |
| BR-10 | The sweep is interrupted by Ctrl-C or SIGTERM, or throws mid-goal | The mutation is reverted before exit, from the bytes captured before it was applied | CI · signal the runner mid-run |
| BR-11 | A goal an entry claims hangs | The existing per-goal wall-clock cap applies, the goal is recorded as timed out, and the entry is INVALID — a timeout is not a red | CI |
| BR-16 | The runner is killed in a way it cannot observe (SIGKILL, OOM, a native crash, machine loss) | The mutation is **left in place and recorded**: a journal written before the edit names the file and holds its original bytes. The next `goal:mutate` **or** anchor-guard run refuses to proceed, names the file, and restores it from the journal. The window in which the tree stays mutated is real, bounded by the next run of either command, and visible in `git status` — the guarantee is *detected and repaired*, not *never happened* (D1) | CI · kill -9 the runner mid-goal, then assert the next guard run refuses, names the file, and restores it |
| BR-17 | At revert time the target file is not byte-identical to what the runner wrote — somebody edited it while the goals ran | It is **not** overwritten. The run stops, names the file, keeps the journal, and tells the person their edit and the mutation are both still on disk. Restoring blind would erase a real edit *and* destroy the evidence that it happened, leaving a clean `git status` that proves nothing (D1) | CI · edit the target mid-run, assert refusal and that the edit survives |

## The report

| # | When | Then | Proved by |
|---|---|---|---|
| BR-12 | A sweep completes | One table: per entry, the regression in plain words, the claimed goals, and one of KILLED / SURVIVED / INVALID / STALE / ERRORED | CI |
| BR-13 | Any entry is SURVIVED, STALE, INVALID or ERRORED | Non-zero exit, so a caller (or a schedule) can't read a broken sweep as a good one | CI |
| BR-14 | Anyone reads a completed sweep | The report states what the catalogue does **not** cover — that it is hand-authored, that model-backed goals are out of scope, and how many goals no entry claims. Never a score or a percentage | CI · assert the report carries the uncovered count |
| BR-15 | `--list` is passed | Entries and their claimed goals are printed and nothing is applied or run | CI |

## Failure taxonomy

STALE, INVALID, ERRORED and a refused entry (BR-6) are **nothing-was-measured** failures: loud, non-zero, and no claim about coverage follows from them. STALE and BR-6 are configuration; INVALID and ERRORED are the goal never rendering a usable verdict — INVALID before the mutation, ERRORED under it. SURVIVED is a real **finding** about a goal, also non-zero. Only KILLED is a pass, and only a red verdict its assertions actually decided earns it. A failure to revert (BR-9, BR-10, BR-16, BR-17) is the one fatal class, because it leaves the repository modified; everything else is confined to the report. Nothing retries: a retried mutation run would mask exactly the non-determinism D2 exists to exclude.

## Acceptance criteria this issue owns

The two regressions hand-simulated during FIX-1367's review are entries in the catalogue, and `pnpm goal:mutate` shows each one turning the goals that claim it red, with an unmutated baseline green and the worktree clean afterwards. A deliberately inert mutation over the same goals is reported SURVIVED rather than KILLED — that is the run which proves the sweep can tell the difference. A third control, a mutation that makes the target file fail to parse, is reported ERRORED rather than KILLED: the sweep must not read a crash as coverage, which is the same defect class this issue exists to remove.
