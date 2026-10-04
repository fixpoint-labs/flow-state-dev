---
title: Projects
sidebar_position: 6
sidebar_label: Projects
description: "A project is a row your organization keeps: a title, a brief, an owner, its members, and the workstreams it groups. Each project has one room its members share, and only its members can read it."
---

# Projects

A workstream is a mailbox you declare in a `MAILBOX.md`, with the boards it holds. A **project** groups workstreams. It answers a question no single mailbox can: which pieces of work belong together, and who is working on them.

A project is data, not a file. You don't write a folder or a `MAILBOX.md` for one. It's a row in the organization's `projects` collection, created while the app runs, by your own code or by a seat acting for a person. It belongs to the organization rather than to a team, so one project usually gathers workstreams from several teams.

Each project also has a **room**: one conversation its members share. [The room and talk sessions](#the-room-and-talk-sessions) covers it, and [A room or a mailbox](#a-room-or-a-mailbox) compares it with a mailbox.

## How it fits together

The organization owns the projects. A project groups the workstreams that belong together and the people on it. Those members share one private room; anyone else in the org can see the project exists, but cannot read the conversation.

![A project groups work and gives its people one private room](./project-overview.svg)

## The row

| Field | What it holds |
|-------|---------------|
| `id` | The project's id, and its key: `projects/<id>`. One path segment. `unassigned` is reserved |
| `title` | The project's name |
| `brief` | What the project is for, or `null` |
| `status` | A free label. New projects are `"active"` |
| `ownerUserId` | The person who created it |
| `members` | Who can read and post in the room. Always includes the owner |
| `workstreams` | Full mailbox ids of the declared mailboxes it groups, such as `eng.feature` and `ops.release` |
| `repository` | The git remote the project's code lives in, such as `https://github.com/acme/storefront.git`, or `null` |
| `sessions` | Each member's own talk session on the room, at most one per person |

Everyone in the organization can list the rows. That a project exists isn't a secret. Its room is.

## Declaring the collection

Declare the collection once, at the organization level, in `workforce/org/resources/projects.ts`:

```ts
import { defineProjectsCollection } from "@flow-state-dev/workforce";

export default defineProjectsCollection();
```

You can call `defineProjectsCollection()` anywhere you need it. Every call returns the same declaration, so they never conflict. The collection is org-scoped, shared across flows, and readable from the browser, which is how a UI lists an organization's projects.

Its one option, `talk`, is the template every project's room is built from: the seats a post wakes and the charter they work under. Declare it once, usually in `org/resources/projects.ts`. Passing the same template again changes nothing, and passing a different one throws. [A room per project](./mailboxes.md#a-room-per-project) covers it.

## Creating a project

`defineProjectBlocks()` gives you the project blocks, `createProject`, `setWorkstreams`, `setRepository` and `readProjectFiles`, and the same blocks as an `actions` map to spread into a flow:

```ts
import { defineFlow } from "@flow-state-dev/core";
import { defineProjectBlocks } from "@flow-state-dev/workforce";

const projects = defineProjectBlocks();

export const lab = defineFlow({
  kind: "lab",
  actions: { ...projects.actions },
});
```

Call `createProject` with an id, a title, and optionally a brief, the other members, the workstreams, and the [repository](#a-projects-code-and-files):

```ts
{
  id: "storefront",
  title: "Storefront",
  brief: "Ship the new checkout.",
  members: ["bob"],
  workstreams: ["eng.feature", "ops.release"],
  repository: "https://github.com/acme/storefront.git",
}
```

The owner is whoever's session ran the call, as the server recorded it. Nothing in the input can name a different owner. The owner is always a member, and `members` lists who else they're letting in.

The write is a `create`, never an overwrite. An id another owner holds is refused. If the same owner sends the same id again, they get the existing row back, unchanged, with `created: false`. That makes a retried create safe. Two creates of one id sent at the same moment don't share workstreams, so the slower one can be refused with `workstream-claimed`. Send it again and you get the row back.

`setWorkstreams` replaces a project's list of workstreams. Any member can call it.

### Default projects from app code

If your app should start with some projects already there, create them from its own code at boot, through the same `createProject` action, when the rows are absent. A re-run finds the row it already made and hands it back, so a second boot changes nothing.

### Giving the writes to a seat

A seat on the built-in `agent` kind can create projects for the person talking to it. Put the two blocks in the kind's tool catalog, under the names a seat's `tools:` line spells. A catalog key must match the tool's own name, so give each one its name with a one-step sequencer:

```ts
import { sequencer } from "@flow-state-dev/core";
import {
  createProjectInputSchema,
  createProjectOutputSchema,
  defineAgentWorkerFlow,
  defineProjectBlocks,
  setWorkstreamsInputSchema,
  setWorkstreamsOutputSchema,
} from "@flow-state-dev/workforce";

const projects = defineProjectBlocks();

const agent = defineAgentWorkerFlow({
  catalog: {
    createProject: sequencer({
      name: "createProject",
      description: "Create a project for the person you're talking to. They own it; `members` adds the user ids they name.",
      inputSchema: createProjectInputSchema,
      outputSchema: createProjectOutputSchema,
    }).step(projects.createProject),
    setWorkstreams: sequencer({
      name: "setWorkstreams",
      description: "Replace a project's workstreams with this list of full mailbox ids.",
      inputSchema: setWorkstreamsInputSchema,
      outputSchema: setWorkstreamsOutputSchema,
    }).step(projects.setWorkstreams),
  },
});
```

A seat calls them only when its own `tools:` names them. The owner is the person whose session the seat is answering in, so a project a seat creates belongs to whoever asked for it, and `members` adds the people they name. The talk session `createProject` gets ready is that person's.

The writes read the organization's [mailbox inventory](./inventory.md) to check workstream ids. A flow takes one declaration of a collection, so if the same kind reads the inventory itself, for example through `createWorkforceCapability`'s `discover`, declare that read with `projectWritesMailboxInventory` rather than a `defineMailboxInventoryCollection()` of its own:

```ts
import { defineCapability } from "@flow-state-dev/core";
import { projectWritesMailboxInventory } from "@flow-state-dev/workforce";

const mailboxInventory = defineCapability({
  name: "mailbox-inventory",
  resources: { mailboxInventory: projectWritesMailboxInventory },
});
```

A second declaration of the inventory beside the writes fails when the flow is built:

```text
Resource collision in flow "agent": accessor keys "mailboxInventory" and "project-writes-mailbox-inventory" resolve to the same effective storage key (scope=org, ref=inventory/mailboxes/*, flowIsolation=false). Pick distinct refs or flowIsolation settings.
```

[The chief of staff](./chief-of-staff.md#starting-projects) is a seat set up this way.

## One project per workstream

A workstream belongs to at most one project. Each id must be a mailbox in the organization's [inventory](./inventory.md). Before a row is written, the write claims each of its workstreams. If two projects claim the same workstream at the same moment, exactly one of them gets it.

A refused write leaves nothing behind. If one workstream is already claimed, the whole write fails, the refusal names that workstream, and any claims the write had already taken are released. Removing a workstream with `setWorkstreams` releases its claim.

A workstream no project lists isn't lost. A UI shows it under **No project**.

## A project's code and files

A project can name the repository its code lives in. It's a remote, the address you'd pass to `git clone`, not a folder on some machine. Set it when you create the project, or later with `setRepository`. Send `null` to clear it:

```ts
// at create
{ id: "storefront", title: "Storefront", repository: "https://github.com/acme/storefront.git" }

// later, from a member's session
{ projectId: "storefront", repository: "git@github.com:acme/storefront.git" }
{ projectId: "storefront", repository: null }
```

`setRepository` returns `{ project }`, the row as written. It changes `repository` and nothing else on the row. Only members can call it; anyone else is refused with `not-a-member`, and an id no project holds with `no-such-project`. When two members set it at the same moment, one of the two values is kept whole.

A value has to be a remote. Both writes refuse these with `invalid-repository`, and the refusal never repeats the value:

| Refused | Example |
|---------|---------|
| A path | `/srv/git/storefront`, `./storefront`, `~/code/storefront`, `C:\code\storefront` |
| A value starting with `-` | `--upload-pack=…` |
| A control character | A newline or tab anywhere in the address |
| A remote-helper address | `ext::…` |
| A user or password on `http` or `https` | `https://alice:token@github.com/acme/storefront.git`, `https://token@github.com/…` |
| A password on any other scheme | `ssh://git:secret@github.com/acme/storefront.git` |

An SSH login name isn't a credential, so `git@github.com:acme/storefront.git` and `ssh://git@github.com/acme/storefront.git` are both accepted. So is `file:///srv/git/storefront.git`. Give the machine that clones the repository its credentials, rather than putting them in the address.

Stored rows aren't re-parsed when they're read, so a row saved without a `repository` key reads without one. Treat a missing value as `null`, or read rows through `projectRowSchema.parse(row)`, which fills it in.

### The project's own files

Notes, memory and anything else kept for a project live in the organization's `project-files` collection, under the project's id: `project-files/<projectId>/<path>`. Declare it with `defineProjectFilesCollection()`. Like `defineProjectsCollection()`, every call returns the same declaration. It's org-scoped, shared across flows, and loaded only when read.

Only the project's members can list the files, with `readProjectFiles`:

```ts
// input
{ projectId: "storefront" }

// output: each file's path under the project, and its size in bytes
{
  files: [
    { path: "notes.md", size: 7 },
    { path: "src/index.ts", size: 10 },
  ],
}
```

It lists paths and sizes, not file contents. A block's output is recorded in the session log and can reach a model's context, so a listing stays small however large the files are.

It returns that project's files, never another project's. A non-member is refused with `not-a-member`, and an unknown id with `no-such-project`. The collection has no browser read: a request for it through the collection route gets a 403.

## The room and talk sessions

A project's room is stored on the organization's side, one row per line. Nobody reaches it directly. Each member gets their own **talk session**: a session on the mailbox kind that knows which project it's about. Every room call goes through one.

A session, the room and a line are three separate things. The session is one person's, the room and its lines are the organization's, and none of them holds a copy of another.

![A talk session holds only which project it is about and belongs to one person. The project row, the room counter and the room lines are organization data. A line stores its number, poster, optional seat author and body.](./project-room-parts.svg)

The room is one shared org resource. Each member talks through their own live session. Posts from any of those sessions land in the same ordered room. A session reads to catch up — lines are not pushed live — and a second window for the same person reuses their talk session.

![Multiple talk sessions, one shared room](./project-room-sessions.svg)

Each member has exactly one talk session on the project, however many windows they open. The row lists one session per person, and every session reaches the same room.

![Alice, Bob and Cara each have one talk session. Alice's two windows share hers. The project row lists one session per person, and all three sessions reach the same single room.](./project-room-handles.svg)

| Call | What it does |
|------|--------------|
| `join { projectId }` | Returns your talk session on the project. If the project already lists one for you, you get that one back, so a second window ends up in the same session. Otherwise the session you called from becomes your talk session. A declared mailbox's own session can't become one: `join` from it is refused with `talk-on-a-mailbox` |
| `post { body }` | Adds a line to the room, as you |
| `read { after }` | Returns the lines after a cursor, up to 200 at a time, and the cursor for the next read, with the room's charter and seats |

`createProject` gets the creator's talk session ready for them. With a [talk template](./mailboxes.md#a-room-per-project) in place, so does any other code that creates a project inside a flow turn. Every other member joins.

Other members' lines aren't pushed to you. They show up the next time your view reads the room, so read on open, on focus, and after you post.

When several people post at once, every line lands, in one order everyone sees. A read never skips a line. A line still being written appears on a later read.

### Members only

Only a project's members can read or post in its room. A non-member's `join` is refused with `not-a-member`, binds nothing, and never adds them to `members`. Their `read` or `post` is refused too: with `talk-not-bound` when their session isn't bound to a project, and with `not-a-member` when its state names the project anyway.

Access comes from the project row, never from the session. Every room call checks the caller against the row's `members`. Writing a project id into a session's state grants nothing.

Everyone in the organization can see the row. Only the people in its `members` can get into the room, and `join` never changes who that is.

![Everyone in the organization can list project rows. Only members can read or post in the room, through their own talk session, and every room call checks the session's server-recorded owner against members. Join binds the session and lists it on the row but never adds to members.](./project-room-membership.svg)

Room lines aren't readable from the browser through the collection route. The only way to read them is `read` on a member's talk session.

## A room or a mailbox

![A mailbox and a room compared. Both usually run on the built-in mailbox flow kind; they differ in what the session is and where the talk is kept. A mailbox is declared in a MAILBOX.md in a team folder and opened at boot. The mailbox is one session on the mailbox kind, or on the kind its file names, such as support.desk. Its transcript is mailbox-post items in that one session. Its members are workers named in the file, fixed for that mailbox; when the kind has a notify block, a post wakes them. It can hold a board and route a post to one member. A room belongs to one project, created while the app runs; there is no file and it is never in the inventory. No session is the room: each member of the project has their own talk session on the built-in mailbox kind, and every one reaches the same room. The room's lines are organization data, the room-lines collection, and a member's view reads them; they are not pushed. Its members are the people on the project row, checked on every call. A post wakes the workers in the organization's talk template, which are not members. A room holds no board and routes nothing. Use a mailbox for a standing topic a team owns, set in files, with a board or routing. Use a room for the people on a project talking together, private to them](./mailbox-or-room.svg)

A room and a mailbox usually run on the same built-in mailbox kind, but a mailbox is one declared session that holds its own transcript, and a room is the project's lines in organization data, reached through each member's own talk session. Use a mailbox for a standing topic a team owns. Use the project's room when the people on a piece of work need to talk among themselves.

![How a post travels through a mailbox and through a project's room, as swimlanes with time running left to right. A mailbox: Alice owns the session support.desk, a session on the mailbox kind that holds the transcript. Alice posts, the line is kept in that session, the notify block wakes the worker in its own session keyed mailbox:support.desk, the worker's answer line lands back in support.desk, and Alice reads the transcript. Bob, another user, posts to support.desk and is refused with the same 404 as an unknown session, because the session belongs to Alice. A room: Alice and Bob are members of a project and each has their own talk session. Alice posts from hers, and the line is written to room-lines, organization data that holds the room's transcript. The template worker is woken as Alice, in a conversation it keeps per person, and its answer comes back through Alice's session as the next line in room-lines. Bob reads from his own session and gets both lines. Carol is in the organization but not a member, and her join is refused with not-a-member. Why a session per member: a session acts for one user, and anyone else is refused as if it did not exist, so people share a conversation through a room, each posting from their own session into one organization resource. A mailbox is one session, so only its owner can post to it or read it; it is how workers and one user talk](./mailbox-room-flow.svg)

Why a room needs a session per member: a session acts for one user, and a post from anyone else is refused as if the session did not exist. A mailbox is one session, so only the user who opened it, and the workers it wakes, can post to it. A room is how several people share one conversation.
