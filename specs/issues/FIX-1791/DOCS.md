# FIX-1791 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

This issue's specifics, per the epic's [ownership table](../../epics/FIX-1786/DOCS.md#ownership):
a new coordinators page and the chief of staff page reworded. The overview's shared story is the
epic's and FIX-1796 publishes it. The mailboxes page is FIX-1792's to remove; nothing here edits
it. Names marked *as shipped* are reconciled in P3.

## CREATE · `apps/docs/docs/workforce/coordinators.md`

Sidebar: `workforce/coordinators`, right after `workforce/built-in-worker` in `apps/docs/sidebars.ts`.
It is the second worker flow a reader meets. Front matter `sidebar_label: Coordinators`.

> # Coordinators
>
> Sometimes you want to send work to one place and let it find the right worker. A
> **coordinator** is that place. It is a worker like any other on your roster, run by the
> built-in `coordinator` flow, and the workers it hands work to are its **delegates**.
>
> Each post you send it goes to one or more delegates. Each delegate works the post in its own
> conversation, and its answer comes back into yours, under its own name.
>
> ## Choosing how it routes
>
> | `routing:` | Who gets a post |
> |---|---|
> | `judgment` (the default) | The coordinator reads the post and decides, with its own tools. It can hand it on or answer itself |
> | `best-fit` | One model call picks the delegate whose note, or else description, fits best. A follow-up goes to the delegate still working your last post |
> | `round-robin` | The next delegate in the list, one step per post |
> | `everyone` | Every delegate |
>
> With `best-fit`, set a `fallback:` delegate for a post the call can't place. If there is none,
> the post isn't handed to anyone, and the conversation says so.
>
> ```md title="workforce/teams/support/workers/help/WORKER.md"
> ---
> description: Ask the support team anything.
> flow: coordinator
> delegates: [support.devices, support.accounts, support.general]
> routing: best-fit
> fallback: support.general
> ---
> ```
>
> ## Changing the delegates
>
> The `delegates:` in the file are defaults. Each new conversation starts with a copy, and
> changes to it stay in that conversation. You can change them two ways, and both are checked the
> same way:
>
> - **From your app**, with the `delegates` action on the conversation:
>
>   ```ts
>   await clients.actions("coordinator").sendAction("delegates", { add: "researcher", note: "license questions" }, { sessionId })
>   ```
>
> - **By the coordinator itself**, with its delegate tools, when you ask it to bring someone in.
>
> A delegate must be a worker on your own roster: one of yours, or a standard worker. Anything
> else is refused with the same answer as a worker that doesn't exist. A conversation holds at
> most 25 delegates, and the worker's flow must be able to take a delegated post. Ask a
> coordinator who its delegates are and it reads the list; it doesn't guess.
>
> Removing a delegate doesn't take back what it was already handed. If you remove the
> `fallback:` delegate, best fit has no fallback in that conversation until you set one.
>
> ## Letting delegates answer each other
>
> By default an answer goes nowhere further. Set `rounds:` (at most 3) and each answer goes back
> out by the same policy, never to its own author, for that many rounds. With `everyone`, each
> delegate gets the round's answers together, once. A post then costs at most
> delegates × (rounds + 1) turns.
>
> ## What it records
>
> Every routing decision leaves one `coordinator-route` record in the conversation: the post, the
> round, how the delegates were picked, and why any was skipped. A client shows records apart from
> lines. A delegate answers each post once per round, even if the post reaches it twice.
>
> **What this doesn't do.** A coordinator never hands work to another user's worker, and its
> conversations are yours alone. It keeps no separate transcript: its conversation is the record.

## UPDATE · `apps/docs/docs/workforce/chief-of-staff.md` · the opening and "Adding one"

> The chief of staff is the standard coordinator at the top of your roster. Ask it who works for
> you, and it reads its delegates. Ask it for help, and it hands the work to the delegate that
> fits, or hires a worker for you, adds it as a delegate and hands it on. It routes by judgment,
> so it can also answer itself.
>
> ```md title="workforce/org/workers/chief-of-staff/WORKER.md"
> ---
> description: Your one point of contact, and the one worker that changes your roster.
> flow: coordinator
> routing: judgment
> delegates: [eng.em, eng.coder]
> model: openai/gpt-5.4-mini
> tools: [hire, fire, rehire, createProject]
> ---
> ```
>
> A standard coordinator can only name standard workers in `delegates:`; anything else is refused
> when the app loads. The workers you hire join a conversation's delegates when it adds them.

The tools table and "What asks first" are unchanged. The example's tool list follows the shipped
names *as shipped*.

## UPDATE · `packages/workforce/README.md` · a "Coordinators" section after the built-in worker

> The built-in `coordinator` flow hands each post to delegates on the same user's roster, by
> `judgment`, `best-fit`, `round-robin` or `everyone`. Delegates live in each conversation and
> change through the `delegates` action or the coordinator's tools. See
> [Coordinators](../../apps/docs/docs/workforce/coordinators.md).

## UPDATE · `apps/docs/docs/shift-manager/overview.md` · "What you see", the Shift Coordinator row

> | **Shift Coordinator** | Where Shift Manager opens. A summary of the asks waiting on you and the runs going, then your conversation with the Lab's [chief of staff](../workforce/chief-of-staff.md), a [coordinator](../workforce/coordinators.md) first on your roster. Its delegates panel lists who it hands work to: add a worker from your roster, or remove one. Without one, you get the summary and a line saying how to add one. |
