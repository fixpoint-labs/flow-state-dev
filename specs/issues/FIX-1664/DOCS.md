# FIX-1664 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

App Lab is a private lab, so nothing goes in `apps/docs` (the epic's
[DOCS.md](../../epics/FIX-1649/DOCS.md#ownership)). This issue owns the README's task sentences
in the epic's shared opening and one section of its own. Both are reconciled against the running
app before they are published.

## UPDATE · `labs/app-lab/README.md` · the epic's opening, third paragraph

FIX-1662 publishes the opening without the task sentences. This issue adds them, in the words
below, which differ from the epic's draft because the composer and Hand off don't ship yet:

> A task shows one worker's run as it happens, and lets you stop it. The panel on the right
> follows along, with the team and its tasks at a workstream and the task's details at a task.

## CREATE · `labs/app-lab/README.md` · after "Posting"

> ## A task
>
> Open a task from Tasks or from a card on a board. The Session tab is that task's own run:
> every step the worker takes, the tool calls and edits as they happen, and every earlier
> attempt above them. It isn't the worker's chat, so what you read is what this task did.
>
> **Interrupt** stops the run (Esc does the same). The screen says *interrupted* once the run
> has actually stopped. What happens to the task afterwards, whether it's retried or left, is up
> to the board, not App Lab.
>
> The panel on the right shows who is on it, which harness, when it started, and tokens and
> cost once the run reports them. If the harness records its plan and the files it touched, as
> Claude Code does, they're listed; otherwise the panel says so. *Open trace* opens the devtool
> for the full detail. Tell App Lab where it runs:
>
> ```bash
> pnpm --filter @flow-state-dev/app-lab start --config <your config> --devtool http://localhost:4000
> ```
>
> The run's session id sits beside the link; the devtool doesn't open a session from its
> address yet, so paste it there.
>
> ### Not there yet
>
> | On the task screen | Shows today | Filled in by |
> |---|---|---|
> | Typing to the worker | A disabled composer | A way to add your message to a running coding run |
> | Hand off, reassign, Open PR | Disabled | The eng workstream kit |
> | Diff and Checks | An empty tab saying so | The eng workstream kit |
> | Acceptance criteria, who reviews | An empty section | The eng workstream kit |
> | A harness that records no plan | A line saying so | Attention and inspect |
>
> A board that hands work off keeps each task on the worker it was given to, which is why
> reassigning is off rather than refused.

The first row's *Filled in by* follows the open fork: the operation's issue by name if it is
filed, attention and inspect if not.

## Voice watch-outs for the publisher

No issue numbers in the README. "Worker" rather than "seat". No sentence starting with "This".
Keep the *not there yet* table in step with what has shipped when the PR merges.
