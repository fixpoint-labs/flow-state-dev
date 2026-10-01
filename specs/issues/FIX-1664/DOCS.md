# FIX-1664 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

shift-manager is a private lab, so nothing goes in `apps/docs` (the epic's
[DOCS.md](../../epics/FIX-1649/DOCS.md#ownership)). This issue owns the README's task sentences
in the epic's shared opening and one section of its own. Both are reconciled against the running
app before they are published.

## UPDATE · `labs/shift-manager/README.md` · the epic's opening, third paragraph

FIX-1662 publishes the opening without the task sentences. This issue adds them, in the words
below, which differ from the epic's draft because the composer and Hand off don't ship yet:

> A task shows one worker's run as it happens, and lets you stop it. The panel on the right
> follows along, with the team and its tasks at a workstream and the task's details at a task.

## CREATE · `labs/shift-manager/README.md` · after "Posting"

> ## A task
>
> Open a task from Tasks or from a card on a board. The Session tab is that task's own run:
> every step the worker takes, the tool calls and edits as they happen, and earlier attempts
> above them when they ran in the same place. It isn't the worker's chat, so what you read is
> what this task did. If the worker keeps one session for several tasks, the tab shows only
> this task's steps and says the session is shared. A task handed off a moment ago shows its
> run once the run starts; the screen checks for it for up to a minute, then offers Retry.
>
> **Interrupt** stops the run (Esc does the same). The screen says *interrupted* once the run
> has actually stopped. What happens to the task afterwards, whether it's retried or left, is up
> to the board, not shift-manager.
>
> The panel on the right shows who is on it and when it started. If the harness records its
> plan and the files it touched, as
> Claude Code does, they're listed; otherwise the panel says so. *Open trace* opens the devtool
> for the full detail. Tell shift-manager where it runs:
>
> ```bash
> pnpm --filter @flow-state-dev/shift-manager start --config <your config> --devtool http://localhost:4000
> ```
>
> The run's session id sits beside the link; the devtool doesn't open a session from its
> address yet, so paste it there.
>
> ### Not there yet
>
> | On the task screen | Shows today | Filled in by |
> |---|---|---|
> | Typing to the worker | A disabled composer | A way to add your message to a running coding run, once one is built |
> | Hand off, reassign, Open PR | Disabled | The eng workstream kit |
> | Diff and Checks | An empty tab saying so | The eng workstream kit |
> | Acceptance criteria, who reviews | An empty section | The eng workstream kit |
> | Which harness, tokens and cost | An empty field saying so | Attention and inspect |
> | A harness that records no plan | A line saying so | Attention and inspect |
>
> A board that hands work off keeps each task on the worker it was given to, which is why
> reassigning is off rather than refused.

The table mirrors the [gap registry](BUSINESS-RULES.md#gap-registry), which is canonical. The
first row follows the open fork there: if the operation is left out of the first cut, its
*Filled in by* says it isn't planned yet.

## Voice watch-outs for the publisher

No issue numbers in the README. "Worker" rather than "seat". No sentence starting with "This".
Keep the *not there yet* table in step with what has shipped when the PR merges.
