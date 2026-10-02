# FIX-1718 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

This says where each change lands and what it must say. `docs-writer` writes the prose from
shipped behaviour at implement time. The cases are in [BUSINESS-RULES.md](BUSINESS-RULES.md),
which stays the one source for refusals. Nothing under `apps/docs` carries an issue number.

## Terms every page must get right

- **Project:** a row in the organization's `projects` collection. It holds a title, brief,
  status, owner, members, the workstreams it holds, and each member's talk session. It is
  created at runtime or by the app's own code. It is not a folder, a type or a channel.
- **Workstream:** a declared channel, with its kind, members and boards. It belongs to at most
  one project.
- **Room:** a project's one conversation. Its lines are rows of `room-lines`. Only the
  project's members read or post it.
- **Talk session:** a person's own way into a project's room, minted from a template. It
  stores only which project it's about, and that grants nothing: membership does.
- **Template:** the shape of a project's room: its seats and charter. The default is org-level, in `org/resources/projects.ts`. A project names no team, and usually spans several.
- **`mintFor:`** marks a team's `CHANNEL.md` as that team's template for a collection's rows, not a channel. Its
  `members:` are the seats a post wakes, which is not the same thing as a project's members.
- **No project:** where a workstream that no project lists is shown. It is not a project.
- **Vocabulary:** "seat", never "worker" as a noun (ER-13).

## Operations

| Op | Page · anchor | What changes | PR |
|---|---|---|---|
| UPDATE | `apps/docs/docs/workforce/channels.md` · "Declaring a channel", the key-list paragraph | Eight keys, including `boardActions` and `mintFor` | 2 |
| CREATE | same page · `## A room per project`, after "Holding a board" | Covers: <br/>· what a template is <br/>· its seats and charter apply to every project's room, and an edit lands at the next restart <br/>· it can't hold a board <br/>· a post wakes seats under the person who posted <br/>· other members' lines arrive on the next read, not live <br/>· rooms aren't in the inventory <br/>· a channel's transcript is its items, while a room's is its rows | 2 |
| CREATE | `apps/docs/docs/workforce/projects.md`, sidebar `Projects` | Covers: <br/>· the row and its fields <br/>· declaring the collection in `org/resources/projects.ts` <br/>· creating a project, and setting its members and workstreams <br/>· the one-project rule <br/>· members only, and why a talk session's own state grants nothing <br/>· default projects from app code | 1 |
| UPDATE | `apps/docs/docs/workforce/inventory.md` · "What each row holds" | One line: talk sessions are never channel rows | 2 |
| UPDATE | `packages/workforce/README.md` | One line each: `mintFor` among the keys checked at bind; the project blocks; the talk entries | 1, 2 |
| UPDATE | `apps/docs/docs/workforce/overview.md` · the epic's shared section | Publish the epic's paragraphs as #2622's rewrite drafts them | 3 |
| UPDATE | `labs/shift-manager/README.md` · "What you see" | PROJECTS lists the Lab's projects with their workstreams, then No project. A project has four tabs: Stream (its room for members, or Join), Board, Workstreams and Brief. The room refreshes on focus and after your post | 3 |
| REMOVE | `labs/shift-manager/README.md` · "What isn't here yet" | The "Projects" bullet | 3 |

## Voice

Introduce "project", "room", "workstream" and "template" on first use. Avoid chains of
em-dashes and sentences that open with "This".
