# FIX-1718 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Where each change lands and what it says. `docs-writer` reconciles it against shipped behaviour
at implement time. PR 1 publishes the channel key, the row field and `discover`; PR 2 Shift
Manager's README and the epic's shared paragraphs. Nothing here goes under `apps/docs` with an
issue number in it.

## Terms every page must get right

- **Workstream:** a declared channel, with its kind, its members and the boards it holds. Not a
  type of its own.
- **Project:** a channel that at least one workstream names in its `project:` line. Its body is
  the project's brief and its conversation is the project's stream. No folder, no type.
- **`project:`** a full channel id, `<team>.<name>`. One level: a project names no project.
- **No project:** where a workstream that names none is listed. Not a channel.
- **Vocabulary:** "seat", never "worker" as a noun (ER-13). `members:` and paths stay.

## Operations

| Op | Page · anchor | What changes | PR |
|---|---|---|---|
| UPDATE | `apps/docs/docs/workforce/channels.md` · "Declaring a channel", the key-list paragraph | The list becomes eight keys, `boardActions` and `project` included; points to the new section | 1 |
| CREATE | same page · a new section `## Grouping workstreams into a project`, after "Holding a board" | Draft 1 below | 1 |
| UPDATE | `apps/docs/docs/workforce/inventory.md` · "What each row holds", the channel example and the paragraphs under it | `project` in the example; Draft 2 below | 1 |
| UPDATE | `packages/workforce/README.md` · the `declared` row of the channel record table, and the channel row in the inventory section | `project` among the keys checked at `channelInstances`; the row field, one line each | 1 |
| UPDATE | `apps/docs/docs/workforce/overview.md` · the epic's shared section | Publish its first two paragraphs ([epic DOCS.md](../../epics/FIX-1650/DOCS.md)), as drafted there; nothing in them changes | 2 |
| UPDATE | `labs/shift-manager/README.md` · "What you see" | Replace "PROJECTS (the workstreams, until projects exist)" with Draft 3's sidebar line; add Draft 3's project bullet after "A workstream" | 2 |
| REMOVE | `labs/shift-manager/README.md` · "What isn't here yet" | The "Projects" bullet | 2 |

"What a channel is" in `channels.md` says a channel is a session. It stays as written: a
channel is still a session opened for one user, and rewording it belongs to the per-participant
follow-up.

## Draft 1 · `channels.md` · Grouping workstreams into a project

> ## Grouping workstreams into a project
>
> A channel with its boards is a workstream: one place to talk about a piece of work, and the
> rows people claim to do it. When several workstreams serve one goal, group them under a
> project.
>
> A project is a channel too. Its body is the project's brief, and its conversation is where the
> project as a whole is discussed. Declare it like any other channel:
>
> ```md
> ---
> description: The storefront rebuild.
> ---
>
> Ship the new checkout by the end of the quarter. Payments and search each run a workstream.
> ```
>
> Then each workstream names it, by its full id:
>
> ```md
> ---
> description: Where this team talks about the checkout flow.
> members: [eng.lead, eng.coder]
> boards: [work]
> project: eng.storefront
> ---
> ```
>
> A channel becomes a project when a workstream names it. A project can gather workstreams from
> several teams, since the id carries the team.
>
> The link is checked when you bind the roster. Binding refuses, naming the channel, when
> `project:` names a channel the roster doesn't declare, names its own channel, or names a
> channel that has a `project:` line of its own. Projects don't nest. A channel on a kind of your
> own can't declare `project:`, for the same reason it can't hold a board.
>
> A workstream with no `project:` line belongs to no project, and that's fine. Shift Manager
> lists it under No project.
>
> `project:` is read at every start, so an edit takes effect when the app restarts. Unlike
> `members:`, it doesn't wait for a fresh channel.

## Draft 2 · `inventory.md` · the channel row

> ```ts
> {
>   id: "engineering.standup",
>   kind: "channel",
>   members: ["engineering.lead", "engineering.analyst"],
>   openedAt: "2026-09-19T09:14:07.123Z",
>   project: "engineering.platform"
> }
> ```
>
> `project` is the id the channel's `CHANNEL.md` names in its
> [`project:` line](./channels.md#grouping-workstreams-into-a-project), or `null` when it names
> none. It's written from the declaration at every start, so it follows the file after a
> restart. A row written before the field existed reads as `null`.
>
> A project has no row of its own beyond its channel's. To list a project's workstreams, read
> the channel rows and keep the ones whose `project` is its id.

## Draft 3 · Shift Manager's README

> - **Sidebar.** The organization, Jump to (⌘K), Inbox and Tasks with their counts, PROJECTS
>   (each project with its workstreams beneath it, then No project for the workstreams that name
>   none), and TEAMS: each team in the Lab's seat inventory, with exactly its seats.

> - **A project.** A channel its workstreams name. It has four tabs: Stream (the project
>   channel's transcript and composer), Board (a lane for each channel in the project that holds
>   a board), Workstreams, and Brief (the project channel's charter). No project shows its
>   workstreams' boards and list, and says it has no stream or brief, since it isn't a channel.

## Voice

Watch for em-dashes and "This" openers in Draft 1. "Workstream" and "project" are introduced on
first use, as above. No `FIX-` ids in anything under `apps/docs`.
