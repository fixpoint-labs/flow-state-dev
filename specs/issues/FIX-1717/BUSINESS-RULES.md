# FIX-1717 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. Each says what a person or the system does and what happens. The
*proved by* column is the check the plan runs. "Goal leg a/b" is the goal check in
[SPEC.md](SPEC.md#the-goal-and-how-well-know-its-met).

## What a run is handed

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A person approves a feature in Inbox, or posts `slug: goal` on the workstream | The coding run's prompt opens on that goal, verbatim | Goal leg a, on one approved and one posted held-out feature · leg b |
| BR-2 | The task carries a title, a context, an input, or outputs the board selected from earlier tasks | Each reaches the prompt builder exactly as the board packed it. One the task lacks is absent, not empty | `harness-manager` spec |
| BR-3 | The working seat is a declared member of the channel whose board holds the task | The prompt carries that channel's charter | Goal leg a |
| BR-4 | The working seat is not a member of that channel | No charter. Not an error | Goal leg a, on a tree copy with the coder removed from `members` |
| BR-5 | The prompt is built | It still carries the seat's own instructions, its declared document and its skill union (FIX-1426 BR-10) | `devforce-lab/it-wakes-the-seat-a-file-declared` |
| BR-6 | The prompt is built | It states where to work, on which branch, and what counts as done. With acceptance required, it says the acceptance check decides | Goal leg a |

## What a run is never handed

| # | When | Then | Proved by |
|---|---|---|---|
| BR-7 | The coordinator seat has its own instructions, document and session | None of it reaches the run | Goal leg a: the coordinator's held-out tokens are absent |
| BR-8 | Lines were posted on the channel before the task was approved | None reaches the run. The charter is the only channel content handed over | Goal leg a: a held-out posted line is absent |
| BR-9 | The Lab's process has environment keys | Nothing in the prompt comes from the environment. Which keys a run inherits is FIX-1716's | Review: the builder reads no `process.env` |

## Every attempt, and the paths beside it

| # | When | Then | Proved by |
|---|---|---|---|
| BR-10 | An attempt fails and the board retries the task | The retry's prompt carries the task again, and why the last attempt stopped | `harness-manager` spec · `it-wakes…` leg 6 |
| BR-11 | A person sends a message into the running task | The next attempt's prompt carries the task, then their message, marked as theirs (FIX-1690) | `harness-manager` message-door spec |
| BR-12 | A phase builder ignores the task, as the conductor lab's does | It builds exactly the prompt it builds today | `harness-manager` and `labs/conductor` suites, unchanged |
| BR-13 | The harness is Claude Code, Codex or Cursor | It receives one prompt string, as today. No adapter changes | Goal leg b · no diff under those packages |

## Failure taxonomy

Nothing new is fatal. A task always has a goal: the board refuses one without, and the
coordinator's schemas require it. A seat naming a document it doesn't hold still fails loudly,
as today. A Lab with no channel record to hand the builder gets no charter section, which is
BR-4's outcome, not an error. Retries are the board's, unchanged.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met): through Shift Manager's own approval path,
the run's prompt carries the approved goal and the shared charter and none of the coordinator's
files (leg a), and a real coding run's commit carries the goal's held-out token (leg b). Both
FAIL under `GOAL_CONTROL=drop-task`, and leg a FAILS on today's `main`. The four existing
`devforce-lab` checks and `it-waits-for-a-person-before-it-files` still PASS. Shift Manager's
README says what a run is handed and what it never is.
