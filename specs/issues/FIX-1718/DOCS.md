# FIX-1718 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Where each change lands and what it must say. `docs-writer` writes the prose from shipped
behaviour at implement time; the cases are [BUSINESS-RULES.md](BUSINESS-RULES.md), which stays
the one source for refusals. Nothing under `apps/docs` carries an issue number.

## Terms every page must get right

- **Project:** a row in the organization's `projects` collection: title, brief, status, owner,
  the workstreams it holds, and each person's talk session. Created at runtime or by the app's
  own code. Not a folder, a type or a channel.
- **Workstream:** a declared channel with its kind, members and boards. In at most one project.
- **Talk session:** a person's own conversation about one project, minted from a template. It
  stores only which project it's about.
- **`mintFor:`** marks a `CHANNEL.md` as a template for a collection's rows, not a channel.
- **No project:** where a workstream no project lists is shown. Not a project.
- **Vocabulary:** "seat", never "worker" as a noun (ER-13).

## Operations

| Op | Page · anchor | What changes | PR |
|---|---|---|---|
| UPDATE | `apps/docs/docs/workforce/channels.md` · "Declaring a channel", the key-list paragraph | Eight keys, `boardActions` and `mintFor` included | 1 |
| CREATE | same page · `## A conversation per project`, after "Holding a board" | What a template is; that its members and charter apply to every project's conversation and an edit lands at the next restart; that it can't hold a board; that each person has their own conversation and joins to get one; that conversations aren't in the inventory | 1 |
| CREATE | `apps/docs/docs/workforce/projects.md`, sidebar `Projects` | The row and its fields, declaring the collection in `org/resources/projects.ts`, creating a project and setting its workstreams, the one-project rule, default projects from app code | 1 |
| UPDATE | `apps/docs/docs/workforce/inventory.md` · "What each row holds" | One line: per-person project conversations are never channel rows | 1 |
| UPDATE | `packages/workforce/README.md` | `mintFor` among the keys checked at bind; the project blocks, `bind` and `join`, one line each | 1 |
| UPDATE | `apps/docs/docs/workforce/overview.md` · the epic's shared section | Publish the epic's paragraphs as #2622's rewrite drafts them | 2 |
| UPDATE | `labs/shift-manager/README.md` · "What you see" | PROJECTS lists the Lab's projects with their workstreams, then No project; a project has Stream (your own conversation, or Join), Board, Workstreams and Brief | 2 |
| REMOVE | `labs/shift-manager/README.md` · "What isn't here yet" | The "Projects" bullet | 2 |

## Voice

Introduce "project", "workstream" and "template" on first use. No em-dash chains, no "This"
openers.
