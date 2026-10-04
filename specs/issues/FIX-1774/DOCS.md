# FIX-1774 · Docs

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

Three updates to pages that exist. No new page and no sidebar change. Write "worker", never
"seat", in every sentence added; leave the rest of each page's wording alone. Tool names are
placeholders until FIX-1778 and FIX-1779 pin them.

## 1 · Update `apps/docs/docs/workforce/chief-of-staff.md` — new section after *Adding one*

> ## Getting a request done
>
> Ask a chief of staff for work, "build me a hello-world page", and it gets that work to a
> worker who will do it. It looks for a worker who already does that kind of work and creates a
> task for them. If nobody fits, it hires one and gives the task to the new hire. And if no
> mailbox in your project can hold the task, it sets one up with a task list, adds the worker,
> and files the task there.
>
> Tell it how in its `WORKER.md`:
>
> ```md title="workforce/org/workers/chief-of-staff/WORKER.md (excerpt)"
> **Get the person's request done.** When the person asks for work, get it
> assigned to a worker who will do it, in this turn.
>
> 1. Find a worker who does this kind of work (`discover`). If one fits,
>    create the task for that worker.
> 2. If none fits, hire one of a kind you may hire, then create the task for
>    the worker you hired. Hire once.
> 3. If no mailbox in the person's project can hold the task, set one up
>    there with a task list, subscribe the worker, then create the task on it.
> ```
>
> Give it the tools those steps name in `tools:`. It hires once per request: asking again
> doesn't hire a second worker or create a second task. When nothing it can do would start the
> work, it tells you what is missing.

## 2 · Update `labs/shift-manager/README.md` — the `devteam` bullet under *Team profiles*

After "The EM answers every line posted in a project's room.", add:

> Ask the chief of staff for something to be built and it creates a task for the coder, with any
> choices you left open filled in, and the coder starts on it. Ask for work in a project with no
> mailbox for it, Platform for one, and it sets one up there first.

## 3 · Update `apps/docs/docs/shift-manager/overview.md` — the `devteam` paragraph

After "Two projects exist from the start, Storefront and Platform.", add:

> Ask the chief of staff on Shift Coordinator to build something and it hands the task to a
> worker who can do it, hiring one if it has to, and the run shows up under Tasks.

## Not changed

- The Workforce reference for the new verbs: FIX-1778 and FIX-1779 document their own tools.
