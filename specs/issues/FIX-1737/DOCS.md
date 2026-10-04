# FIX-1737 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

Shift Manager is a private lab, so nothing goes to `apps/docs`. Its README states three things
this issue changes, and gains one goal check. Each operation is published with the slice named;
the publisher reconciles the wording against what shipped.

## UPDATE · `labs/shift-manager/README.md` · What you see · *A workstream* (slice C)

Replace the bullet with:

> - **A workstream.** One channel and the boards attached to it. It has four tabs: Stream (the
>   transcript and the composer; an ask a member raises appears in the transcript at the time it
>   was raised, and answering it there clears it from Inbox too), Board (five columns: QUEUED,
>   RUNNING, IN REVIEW, NEEDS YOU, DONE, with done tasks as one line each), Brief (the channel's
>   charter) and Results. The right panel lists the channel's members with their status, and its
>   rows by column.

## UPDATE · same file · What you see · *Tasks* and *Inbox* (slice D)

Replace the Tasks bullet with:

> - **Tasks.** Every row on every attached board that isn't done, grouped by state, worker or
>   workstream, with its id and how long it has been running. Queued tasks are hidden until you
>   turn them on; the button says how many there are.

Add one sentence to the end of the Inbox bullet:

> Beside the ask, *From the session* shows the last few things the worker did before it asked.

## UPDATE · same file · the goal checks list, after the fifth (slice A)

> A sixth reads every screen against design v2, day and night, at a wide and a narrow window.
> For each element it checks the font that actually loaded, the surface, square corners, the
> highlighter (only on what waits on you) and the widths, and names the element and the line of
> the design it departs from. It needs no model key:
>
> ```bash
> PLAYWRIGHT_BROWSERS_PATH=<your Chromium pool> pnpm tsx goals/shift-manager/it-draws-v2s-look/run.mts
> ```

## Not changed

*How it looks* stays accurate: the look still comes from the one design-system import, and the
switch is unchanged. The sidebar bullet already describes the footer as v2 draws it.
