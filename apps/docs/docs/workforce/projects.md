---
title: Projects
sidebar_position: 6
sidebar_label: Projects
description: "A project is a row your organization keeps: a title, a brief, an owner, its members, and the workstreams it groups. Each project has one room its members share, and only its members can read it."
---

# Projects

A workstream is a channel you declare in a `CHANNEL.md`, with the boards it holds. A **project** groups workstreams. It answers a question no single channel can: which pieces of work belong together, and who is working on them.

A project is data, not a file. You don't write a folder or a `CHANNEL.md` for one. It's a row in the organization's `projects` collection, created while the app runs, by your own code or by a seat acting for a person. It belongs to the organization rather than to a team, so one project usually gathers workstreams from several teams.

Each project also has a **room**: one conversation its members share. Everyone on the project reads and posts in the same room, each through a session of their own.

## The row

| Field | What it holds |
|-------|---------------|
| `id` | The project's id, and its key: `projects/<id>`. One path segment. `unassigned` is reserved |
| `title` | The project's name |
| `brief` | What the project is for, or `null` |
| `status` | A free label. New projects are `"active"` |
| `ownerUserId` | The person who created it |
| `members` | Who can read and post in the room. Always includes the owner |
| `workstreams` | Full channel ids of the declared channels it groups, such as `eng.feature` and `ops.release` |
| `sessions` | Each member's own talk session on the room, at most one per person |

Everyone in the organization can list the rows. That a project exists isn't a secret. Its room is.

## Declaring the collection

Declare the collection once, at the organization level, in `workforce/org/resources/projects.ts`:

```ts
import { defineProjectsCollection } from "@flow-state-dev/workforce";

export default defineProjectsCollection();
```

You can call `defineProjectsCollection()` anywhere you need it. Every call returns the same declaration, so they never conflict. The collection is org-scoped, shared across flows, and readable from the browser, which is how a UI lists an organization's projects.

Its one option, `talk`, is the template every project's room is built from: the seats a post wakes and the charter they work under. [A room per project](./channels.md#a-room-per-project) covers it.

## Creating a project

`defineProjectBlocks()` gives you two blocks, `createProject` and `setWorkstreams`, and the same two as an `actions` map to spread into a flow:

```ts
import { defineFlow } from "@flow-state-dev/core";
import { defineProjectBlocks } from "@flow-state-dev/workforce";

const projects = defineProjectBlocks();

export const lab = defineFlow({
  kind: "lab",
  actions: { ...projects.actions },
});
```

Call `createProject` with an id, a title, and optionally a brief, the other members, and the workstreams:

```ts
{
  id: "storefront",
  title: "Storefront",
  brief: "Ship the new checkout.",
  members: ["bob"],
  workstreams: ["eng.feature", "ops.release"],
}
```

The owner is whoever's session ran the call, as the server recorded it. Nothing in the input can name a different owner. The owner is always a member, and `members` lists who else they're letting in.

The write is a `create`, never an overwrite. An id another owner holds is refused. If the same owner sends the same id again, they get the existing row back, unchanged, with `created: false`. That makes a retried create safe. Two creates of one id sent at the same moment don't share workstreams, so the slower one can be refused with `workstream-claimed`. Send it again and you get the row back.

`setWorkstreams` replaces a project's list of workstreams. Any member can call it.

### Default projects from app code

If your app should start with some projects already there, create them from its own code at boot, through the same `createProject` action, when the rows are absent. A re-run finds the row it already made and hands it back, so a second boot changes nothing.

## One project per workstream

A workstream belongs to at most one project. Each id must be a channel in the organization's [inventory](./inventory.md). Before a row is written, the write claims each of its workstreams. If two projects claim the same workstream at the same moment, exactly one of them gets it.

A refused write leaves nothing behind. If one workstream is already claimed, the whole write fails, the refusal names that workstream, and any claims the write had already taken are released. Removing a workstream with `setWorkstreams` releases its claim.

A workstream no project lists isn't lost. A UI shows it under **No project**.

## The room and talk sessions

A project's room is stored on the organization's side, one row per line. Nobody reaches it directly. Each member gets their own **talk session**: a session on the channel kind that knows which project it's about. Every room call goes through one.

| Call | What it does |
|------|--------------|
| `join { projectId }` | Returns your talk session on the project. If the project already lists one for you, you get that one back, so a second window ends up in the same session. Otherwise the session you called from becomes your talk session. A declared channel's own session can't become one: `join` from it is refused with `talk-on-a-channel` |
| `post { body }` | Adds a line to the room, as you |
| `read { after }` | Returns the lines after a cursor, up to 200 at a time, and the cursor for the next read, with the room's charter and seats |

`createProject` gets the creator's talk session ready for them. With a [talk template](./channels.md#a-room-per-project) in place, so does any other code that creates a project inside a flow turn. Every other member joins.

Other members' lines aren't pushed to you. They show up the next time your view reads the room, so read on open, on focus, and after you post.

When several people post at once, every line lands, in one order everyone sees. A read never skips a line. A line still being written appears on a later read.

### Members only

Only a project's members can read or post in its room. A non-member's `join` binds nothing and never adds them to `members`, and their `read` or `post` is refused with `not-a-member`.

Access comes from the project row, never from the session. Every room call checks the caller against the row's `members`. Writing a project id into a session's state grants nothing.

Room lines aren't readable from the browser through the collection route. The only way to read them is `read` on a member's talk session.
