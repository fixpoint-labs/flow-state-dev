# FIX-1793 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Proposed reader-facing prose, under the outsider rule
([`user-docs.md`](../../../docs/contributing/user-docs.md)): what projects do, never what they
used to do. The projects page's opening is the epic's
([epic DOCS](../../epics/FIX-1786/DOCS.md#update--appsdocsdocsworkforceprojectsmd--opening)) and
is not repeated here. Names that FIX-1796 renames (`seat` in older sections) are left to it.
Voice risks for this topic: em-dashes, "seamless", and sentences that start with "This".

## UPDATE · `apps/docs/docs/workforce/projects.md` · front matter and the opening

> description: "A project is a body of work, private to one user or shared with the org. Each
> workstream in it has one owner, and each user talks to it through their own project coordinator."

Replace everything from the H1 to "Declaring the collection" with the epic's opening, then:

> ### Private and shared
>
> You choose when you create a project. A **shared** project lives in the organization: everyone
> in the org can list it and read its row, its repository included, and every workstream's entry.
> Its members are the people who may open workstreams in it. A **private** project lives
> with you: nobody else can list, open or read it, its files included, and it shows only in the
> org you made it in. Either way it is the same kind of project, with the same fields. A
> private project can't become shared later, or the other way round.
>
> A project's address is its visibility and its id, `{ visibility: "shared", id: "apollo" }`,
> so your private `apollo` and the org's shared `apollo` are two projects.

## UPDATE · `projects.md` · "The row"

Replace the table and the line under it:

> | Field | What it holds |
> |---|---|
> | `id` | The project's id. One path segment. `unassigned` is reserved |
> | `title` | The project's name |
> | `brief` | What the project is for, or `null` |
> | `status` | A free label. New projects are `"active"` |
> | `ownerUserId` | The user who created it |
> | `members` | On a shared project, who may open workstreams in it. Always includes the owner. A private project has only its owner |
> | `repository` | The git remote the project's code lives in, or `null` |
>
> The row holds no workstreams. Each workstream is its own entry, so two owners updating theirs
> never wait on each other.

## UPDATE · `projects.md` · "Creating a project"

After the `defineProjectBlocks()` example, replace the `createProject` input paragraph and
example with:

> Call `createProject` with an id, a title, and optionally a brief, a visibility, the other
> members and the repository. With no visibility, the project is shared:
>
> ```ts
> import { createClient } from "@flow-state-dev/client";
>
> const projects = createClient({ flowKind: "projects", userId });
> await projects.sendAction(
>   "createProject",
>   { id: "apollo", title: "Apollo", visibility: "shared", members: ["bob"] },
>   { sessionId }
> );
> await projects.sendAction("createProject", { id: "notes", title: "My notes", visibility: "private" }, { sessionId });
> ```
>
> The owner is whoever's session sends it, never a field you pass. A private project can't name
> other members: `createProject` refuses it with `private-has-members`.

## CREATE · `projects.md` · "Workstreams", after "Creating a project"

> ## Workstreams
>
> A workstream is one area of a project with one owner. It's two things you already have: an
> **entry** on the project, and its **lead's workstream session**, a lasting session of one of the
> owner's workers, usually a coordinator, whose board holds the workstream's tasks.
>
> Open one with `openWorkstream`, naming the project, an id, a title and a lead from your own
> roster:
>
> ```ts
> const apollo = { visibility: "shared", id: "apollo" } as const;
> await projects.sendAction(
>   "openWorkstream",
>   { project: apollo, id: "checkout", title: "Checkout", lead: "eng-lead", objectives: ["Ship guest checkout"] },
>   { sessionId }
> );
> ```
>
> The entry is yours. Workforce starts the lead's workstream session, also yours, and records it
> on the entry. On a shared project, only its members may open a workstream. The lead must be a
> worker on your roster; anyone else's is refused as if it didn't exist. A workstream id is
> unique within a project for each owner, and can't hold `/`.
>
> **Who sees what.** Everyone who can read the project reads every entry: its title, owner,
> lead, status, due date, objectives, latest report, and who last wrote it. Only the owner can change an entry, and
> only the owner can open the workstream session, its board and its tasks. The lead keeps the
> entry current with `updateWorkstream`, which runs as the owner because the session is theirs:
>
> ```ts
> await projects.sendAction(
>   "updateWorkstream",
>   { project: apollo, id: "checkout", status: "at-risk", report: "Payments sandbox is down." },
>   { sessionId }
> );
> ```
>
> A write to someone else's entry is refused, whichever flow sends it. A workstream is never
> deleted; mark it `done` and it stays listed.
>
> ### Progress
>
> A project's progress is worked out from its entries each time you look: how many workstreams
> are on track, at risk, blocked or done, how many objectives are met, the next due date, and
> which entries nobody has updated for seven days, shown as stale. Nothing totals it on the row,
> so it can't drift from the workstreams.

## CREATE · `projects.md` · "Talking to a project", after "Workstreams"

> ## Talking to a project
>
> Each user talks to a project through their own **project coordinator**: a session of a
> coordinator worker your installation names, one per user per project, started the first time
> you open it. Find or start yours with `ensureWorkerSession`:
>
> ```ts
> import { createWorkforceClient } from "@flow-state-dev/workforce";
>
> const workforce = createWorkforceClient({ userId });
> const session = await workforce.ensureWorkerSession({ worker: "project-coordinator", projectId: apollo });
> ```
>
> It reads every workstream's entry, so it can answer how the project is going. Each workstream
> you have open in the project is one of its delegates, added when you open it and dropped when
> you mark it done. When you ask it for work, it hands the request to the lead of one of **your**
> workstreams, inside that workstream session. It never hands work to another member's workstream. To get something
> from theirs, read their entry or ask them. If you own no workstream in the project, it says so
> and opens nothing for you.

## UPDATE · `projects.md` · "A project's code and files"

After its first paragraph, add:

> A private project's repository and files are its owner's alone. On a shared project, everyone
> in the org can read the row, and so the repository's address.

Under "Coding work in a project", replace "from one of the project's workstreams" with "for one
of the project's workstreams", and add: "A run works for the workstream's owner; a run started by
anyone else is refused with `not-the-owner`."

## UPDATE · `projects.md` · "One project per workstream"

Replace the section with:

> ### Mailboxes on a project
>
> A project can still list mailboxes with `setWorkstreams`, and a coding run on such a mailbox's
> board works in that project. This is deprecated: open workstreams instead.

## REMOVE · `projects.md` · "Setting up the room", "The room and talk sessions", "Members only", "A room or a mailbox"

Remove the four sections, the `talk` option paragraph under "Declaring the collection", and
these figures: `project-room-handles.svg`, `project-room-membership.svg`,
`project-room-parts.svg`, `project-room-sessions.svg`, `mailbox-or-room.svg`,
`mailbox-room-flow.svg`. `project-overview.svg`
is redrawn as the epic's private-and-shared figure, in the boundary style of the other figures
on this page.

## UPDATE · `apps/docs/docs/resources/collections.md` · after the owner-private section

> ### Rows one user writes and everyone reads
>
> Some rows belong to one user but are meant to be read by everyone, such as a status each
> person keeps on a shared plan. Declare the collection with `ownerWrites`:
>
> ```ts
> const statuses = defineResourceCollection({
>   pattern: "statuses/[plan]/[owner]/[id]",
>   ownerWrites: { param: "owner" },
>   scope: "org",
>   stateSchema: statusSchema,
>   client: { state: { read: true } },
> });
>
> await ctx.resources.statuses.create({ plan: "q3", owner: ownerSegment(userId), id: "checkout" }, state);
> ```
>
> The key names the owner, as for an owner-private collection. Everyone the scope serves can
> read, list and count the rows, from the server or the browser. Only the user the owner segment
> names can create, update or delete one. Anyone else's write throws "A row of an owner-writes
> collection is written only by the user it belongs to", whichever flow sends it. The startup
> check and the limits are the same as for owner-private collections, except that browser reads
> are allowed.

## UPDATE · `apps/docs/docs/shift-manager/overview.md` · the screens table

> | **A project** | Shared with your org, or private to you. Tabs: Stream (your own project coordinator), Board (the boards of your own workstreams), Workstreams (every workstream's entry, with progress worked out from them) and Brief, which also names the project's repository, or says its coding work runs on the project's files. See [Projects](../workforce/projects.md). |
> | **A workstream** | On a project, its owner sees the lead's workstream session and its board; everyone else sees its entry. A mailbox and its boards keep their own Stream, Board, Brief and Results tabs. |

And under the table:

> **Opening a workstream.** Open one from its project and it comes with a coordinator of its own:
> a new worker on your roster, copied from the standard workstream coordinator, that leads
> it. Each workstream gets its own, so changing one coordinator's instructions or delegates
> changes only its workstream. Nobody else sees it on their roster. It stays when you mark the
> workstream done, so you can pick the workstream up again; fire it from your roster like any
> worker once you no longer need it.
>
> In your own app, `openWorkstream` takes whichever lead you name. See
> [Projects](../workforce/projects.md#workstreams).

## UPDATE · `apps/docs/docs/workforce/chief-of-staff.md`

Remove the paragraph about the project template's `seats` and the room. In "Starting projects",
replace the first two paragraphs and the tools table rows with:

> Ask the chief of staff for a project and it creates one, owned by you, shared or private as
> you ask. It can open workstreams in it for you, with leads from your roster. Give it the
> project tools, `createProject` and `openWorkstream`, in its `tools:` line.
>
> | `createProject` | Creates a project owned by the user asking, private or shared, with the members they name | Never |
> | `openWorkstream` | Opens a workstream the user asking owns, with a lead from their roster | Never |

## UPDATE · `apps/docs/docs/workforce/overview.md` · "Projects and the chief of staff" and the page list

Replace the workstream and project paragraphs with:

> A **workstream** is one area of a project with one owner: an entry on the project that everyone
> who reads the project can see, and a lasting session of one of the owner's workers that does
> the work. A mailbox and its boards still work as before.
>
> A **project** is a body of work, private to you or shared with your organization. Each user
> talks to it through their own project coordinator. See [Projects](./projects).

and the list line with:

> - [Projects](./projects) — private or shared, with workstreams that each have one owner.

## UPDATE · `apps/docs/docs/glossary.md` and its figures

Remove the **Room** row. In the Workforce figure (`glossary/workforce.svg`) and its description,
remove the Room term; in the layers figure, "projects and rooms" becomes "projects and
workstreams"; in the Shift Manager figure, PROJECT + ROOM becomes PROJECT, read through your own
project coordinator. Add a **Project coordinator** row: "A user's own session for talking to one
project. It reads every workstream and hands work only to the user's own."

## UPDATE · `packages/shift-manager/README.md` · "A project"

Replace the room lines with the project view in the screens table above: Stream is your own
project coordinator, Board your own workstreams' boards, Workstreams every entry with its
progress. Add the "Opening a workstream" paragraph above, and the DevTeam's workstream
coordinator to its list of standard workers. Remove "The room reads only at set times" and the room's sentence in the DevTeam
paragraph.

## UPDATE · `apps/docs/docs/workforce/inventory.md`

Remove the `mintFor: projects` removal sentence and "A project's talk session is never a mailbox
row."

## UPDATE · the owner-key contracts · `docs/architecture/resources-and-client-data.md`, `docs/contributing/architecture-reference.md`

Not published, but locked: both say a `~`-owned row is served only through an owner-private
collection and only to its owner. Restate the key fence for two modes: an owner-private
collection serves the row to its owner only; an owner-writes collection serves it to everyone
the scope serves, browser included, and refuses a create, update or delete by anyone but the
owner. The startup fence and the single-resource refusal cover both.

## UPDATE · `packages/core/README.md`, `packages/workforce/README.md`

`ownerWrites` beside `ownerPrivate` in core's collection options; in Workforce, the project
blocks gain `visibility`, `openWorkstream` and `updateWorkstream`, and the room and talk exports
leave the list.

## Publication ownership

This issue publishes every operation above, after its checks pass. The projects opening is the
epic's draft, published here because this issue ships the behaviour it describes. Removing
`mailboxes.md`, and the mailbox-list section above, is FIX-1792's.
