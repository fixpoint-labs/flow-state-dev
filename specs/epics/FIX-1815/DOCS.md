# FIX-1815 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

The shared story once, and who publishes each specific. The prose below is proposed reader-facing
text; names in `code` are working names until FIX-1816's spec fixes them.

## UPDATE · `apps/docs/docs/server/background-work.md` · new section after "Starting a job on another flow"

> ### Waiting for the answer
>
> A dispatch returns before the work it started has run. That is right for a job that outlives
> the turn, and wrong when the next step needs the result. For that case, ask instead of
> dispatching.
>
> An ask starts the work the same way, then parks the turn on it. When the answer arrives, the
> turn picks up where it stopped, with the answer as the tool's result. Nothing holds the request
> open in between, so a server restart while the turn waits loses nothing: the turn resumes after
> the restart, and the asked work ran once.
>
> Every ask has a time limit and a limit on how deep asks can nest. If two workers ask each
> other, both get a timeout error instead of waiting forever. Cancelling the turn that asked also
> cancels the work it is waiting on.
>
> Each wake replays the asking turn once, so an ask costs one extra replay. Use one when the
> answer changes what this turn does next. When it doesn't, dispatch the work, or assign it as a
> task, and let the turn end.

## UPDATE · `apps/docs/docs/orchestration/task-board.md` · "Which session a task runs in"

> A task keeps one session for its whole life. If the worker stops on a question, the task parks.
> The answer wakes that same session, which carries on with everything it did before it parked.
> When the task is done, the session stays open: you can ask it what it did, or hand it a
> follow-up task. A follow-up task is a new task that runs in the same session. The finished task
> itself does not change.

## Ownership

| Material | Publisher | Specific draft |
|---|---|---|
| "Waiting for the answer", above | FIX-1816, once the assembled behavior is verified | This document; names and limits from FIX-1816's `DOCS.md` |
| "Which session a task runs in", above | FIX-1817 | This document; the reply semantics from its spec with FIX-1765 (ER-14) |
| Ask's API reference: the call, its options, its errors | FIX-1816 | Its `DOCS.md` |
| The testing harness's durable runtime | FIX-1816 | Its `DOCS.md` |

Publish each specific with its implementation. If the kill line fires, "Waiting for the answer"
is not published, and the task-board text stands alone. No unchanged page is copied here.
