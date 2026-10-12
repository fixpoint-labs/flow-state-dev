# FIX-1907 · Rules every issue in the set obeys

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

At epic altitude the rules aren't behaviours of one feature; they're the constraints every child
spec and implementation must satisfy, and the place a cross-spec review checks. Each says who owns
it and where it's checked.

## What a team gets, and what it doesn't

| # | Rule | Owner | Checked at |
|---|---|---|---|
| ER-1 | Kitchen Sink opens on a picker with four modes: Flow State, Claude Code, Codex, Cursor. The rail lists the picked mode's sessions only. A mode the host can't run (no key, no sign-in, a deployed host) shows as unavailable with the reason, and opens no session | FIX-1914 | FIX-1914's goal check · the closure |
| ER-2 | **One session, one harness conversation.** The harness id is written only by the block's `onSession` and read only by its `resume`. A resume the harness refuses is shown as refused. A harness that answers in a different conversation is shown as having started a new one. The session never silently starts over | FIX-1915 ([D2](DECISIONS.md#d2)) · FIX-1916, FIX-1917 consume | Each mode's goal check · the closure's turn 2 and its control |
| ER-3 | A run's items reach the session while it works, from the harness emitter only | FIX-1915 | The closure's live-item leg |
| ER-4 | Stopping a turn cancels the harness run, and the session can still be continued | FIX-1915 | FIX-1915's goal check · each mode's gap sweep |
| ER-5 | **The plan.** Each coding harness's own to-do list is mirrored, read-only, into one plan record whose shape lives in `@flow-state-dev/core`. A harness that reports no plan is shown as reporting none | FIX-1915 defines ([D3](DECISIONS.md#d3)) · FIX-1916, FIX-1917 write theirs | The closure's plan leg and its control |
| ER-6 | One session flow and one workspace resolver serve the three coding harnesses. A harness differs only by its block's options | FIX-1915 ([D2](DECISIONS.md#d2)) · FIX-1916, FIX-1917 consume | FIX-1916's and FIX-1917's spec review |
| ER-7 | Claude Code's plan record fills on the in-process SDK path, or a written finding names why, and the panel says so | FIX-1185 | FIX-1185's verification · the closure |
| ER-8 | Flow State mode's sessions and tasks are its flows' own, including their task boards. Nothing new is built for them | FIX-1914 | FIX-1914's spec review |

## What no child may do

| # | Rule | Because |
|---|---|---|
| ER-9 | Drive a harness through harness-manager or a task board, or coordinate work across harnesses | D2. That is Shift Manager's ([FIX-1786](https://linear.app/fixpoint-labs/issue/FIX-1786), [FIX-1650](https://linear.app/fixpoint-labs/issue/FIX-1650)) |
| ER-10 | Create a task for a harness, or turn a plan item into board work | D3. The plan is not a work queue |
| ER-11 | Patch a harness gap in Kitchen Sink: a shell-written item, invented progress, or a plan kept by the app. Fix the package, or file a bug | The test bed exists to show the gap, not to hide it |
| ER-12 | Import or list harness sessions started outside Kitchen Sink, or turn on harness modes on a deployed host | Not built. Both widen the epic past "use each harness directly" |
| ER-13 | Change the harness handle or the `resume` / `onSession` contract, other than moving the plan record into core | Three packages and harness-manager read it |

## How the set is run

| # | Rule | Because |
|---|---|---|
| ER-14 | A child's Linear state is mirrored the moment it changes | The epic wake derives blocked-by from Linear |
| ER-15 | A gap a child finds in a harness package is filed as a child of this epic that blocks the closure. A cross-cutting question is raised to the epic, not settled locally; after merge, any amendment gets a follow-up PR | ER-11. A gap fixed quietly in one mode is a gap the others keep |
| ER-16 | The epic finishes only when the closure issue closes: a clean run on one `main` commit, with every finding fixed and retested | Surface without proof doesn't move Goal 1 |

## The closure

| # | The epic is done when | Proved by |
|---|---|---|
| ER-17 | [The goal](SPEC.md#the-goal-and-how-well-know-its-met) is met in all four modes, and each control fails | FIX-1918's goal check, real models, in a browser |
| ER-18 | Kitchen Sink's README teaches the picker and each mode, and a person can follow it as written | FIX-1914 publishes the opening; the closure follows it |
