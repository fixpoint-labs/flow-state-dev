# FIX-1662 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

App Lab is a private lab, so nothing goes in `apps/docs` (the epic's
[DOCS.md](../../epics/FIX-1649/DOCS.md#ownership)). The README opens with the epic's shared
opening, minus the task sentences FIX-1664 adds; what follows is this issue's own material,
reconciled against the running app before it is published.

## CREATE · `labs/app-lab/README.md` · after the epic's opening

> ## Opening a Lab
>
> App Lab doesn't know any Lab in advance. You point it at the server config your Lab already
> has for `fsdev dev`, and it reads everything else from the running Lab: the teams, the
> workers on each, the channels, the boards attached to them, and what each worker is waiting
> on.
>
> ```bash
> pnpm --filter @flow-state-dev/app-lab build
> pnpm --filter @flow-state-dev/app-lab start --config goals/devforce-lab/lab/fsdev.config.mts
> ```
>
> Open the address it prints. You land on the Inbox.
>
> Your Lab's config has three jobs, and none of them is about App Lab:
>
> - **Default-export the `FlowState`** built from your tree, the same file `fsdev dev` loads.
> - **Resolve a principal with an organization.** App Lab won't show a Lab without one. A
>   request with no verified organization gets a screen saying so, and nothing else.
> - **Open the inventory at boot** (`openInventory`), after opening your channels. The sidebar's
>   teams and workstreams come from it. Skip it and those sections say the inventory is missing.
>
> `goals/multi-seat-collab/lab/fsdev.config.mts` is a small complete example.
>
> ## What you'll see before the rest of Workforce ships
>
> App Lab places things before every part of Workforce gives them meaning. Where there is
> nothing real to show yet, the surface says so and names what fills it. It never shows a
> made-up row.
>
> | Surface | Shows today | Filled in by |
> |---|---|---|
> | Workstreams | Your tree's channels: the transcript, with any approval or question a worker on the channel is waiting on, the boards the channel's `boards:` line attaches, and its charter | The eng workstream kit adds progress and results |
> | Projects | Your workstreams, listed directly | Org primitives |
> | A worker's harness | A dash | Attention and inspect |
> | Inbox | Pending approvals and questions in the worker sessions you can see | Attention and inspect |
> | Board columns and Tasks | Task statuses mapped onto QUEUED, RUNNING, NEEDS YOU and DONE; IN REVIEW stays empty | The eng workstream kit |
>
> A board declared only inside a worker kind's code isn't attached to a channel, so it doesn't
> show up on a workstream. Attach it with `boards:` in the channel's `CHANNEL.md`.
>
> ## Posting
>
> Type in a workstream's composer and press Enter. The line appears once the channel has it;
> if the post is refused, your draft stays put with the reason. Addressing a worker with
> `@name` sends into that worker's session, and until that part ships the send button says so.

## UPDATE · `labs/README.md` · the directory table

> | [`app-lab/`](app-lab) | The app a Workforce Lab is used through: point it at a Lab's `fsdev` config and work its Inbox, tasks, workstreams and teams in one browser tab. |

Added as the table's first row, keeping the table alphabetical.

## Voice watch-outs for the publisher

Short sentences, no issue numbers in the README (sibling epics by name, as above), no
"seamless", and "worker" for what the design calls a worker, with "seat" only where a reader
needs the Workforce term.
