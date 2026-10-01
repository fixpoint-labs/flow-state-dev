# FIX-1722 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

Shift Manager is a private lab, so nothing goes in `apps/docs` (the epic's
[DOCS.md](../../epics/FIX-1649/DOCS.md)). Its README is the one reader-facing page, and this issue
owns three edits to it. The implementer reconciles each against the running app and publishes
it through `docs-writer` then `docs-editor`. Where FIX-1719 has landed by then, the CoS seat
lives under `org/workers/` and the third edit says so instead of the team path.

## UPDATE · `labs/shift-manager/README.md` · opening, first paragraph, last sentence

Replace the sentence that lists what Shift Manager shows with:

> It opens on Chief of Staff: a summary of what's waiting on you and what's running, and a
> conversation with the Lab's chief-of-staff seat. From there it shows the teams and their seats,
> the workstreams, each channel's board, the asks waiting on you, and each channel's transcript,
> which you can post to.

## UPDATE · `labs/shift-manager/README.md` · What you see, before the Sidebar bullet

> - **Chief of Staff.** Where Shift Manager opens, at `/` or `/cos`. The top of the screen is
>   Shift Manager's own summary of the shift: how many asks wait on you, each one with the same
>   Approve and Deny you'd get in Inbox, and how many runs are going across how many workstreams.
>   The numbers are the ones Inbox and Tasks show. Below it is your conversation with the Lab's
>   chief-of-staff seat. A line goes through the seat's door, like any other line you send to a
>   worker, and shows *delivered* once the seat's session holds it. The reply is what the seat
>   wrote in that session. Come back later and the same conversation is there. The panel on the
>   right lists each workstream with its running tasks and the asks its members have raised.
>
>   A Lab with no chief-of-staff seat still opens here. You get the summary, and in place of the
>   conversation a line saying how to add one.

And in the **Sidebar** bullet, put *Chief of Staff* first: "The organization, Jump to (⌘K),
Chief of Staff, Inbox and Tasks with their counts, …"

## UPDATE · `labs/shift-manager/README.md` · What a Lab's config provides, a new last item

> **A chief of staff, if you want one.** Shift Manager talks to the seat named `chief-of-staff`,
> whether it's an org seat or a team's worker.
> Declare it like any other worker, on the built-in `agent` kind, with instructions that say what
> it should do for the person running the Lab:
>
> ```md title="workforce/teams/<team>/workers/chief-of-staff/WORKER.md"
> ---
> description: The person's one point of contact.
> flow: agent
> model: openai/gpt-5.4-mini
> ---
> You are the chief of staff for this team. Answer questions about who is working on what.
> ```
>
> What it can do is up to its instructions and the tools you give it. Shift Manager only carries
> your lines to it and shows what it answers. A Lab with two seats of that name gets a line
> naming both, and Shift Manager talks to neither.

## UPDATE · `labs/shift-manager/README.md` · What isn't here yet

> - **Who's on call.** The Chief of Staff panel's ON CALL list is drawn empty and names what
>   fills it, until shift status ships.

Removed once FIX-1723 has merged at implementation time.

Voice checks for the publisher: no issue numbers in the README's prose (the existing README
carries none); *seat* and *worker* as the README already uses them; no em-dash runs.
