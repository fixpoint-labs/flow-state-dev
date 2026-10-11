---
title: Projects
sidebar_position: 9
sidebar_label: Projects
description: "A project is a body of work, private to one user or shared with the org. Each workstream in it has one owner, and each user talks to it through their own project coordinator."
---

# Projects

A **project** is a body of work: a title, a brief, an owner and, on a shared project, the people working on it. It's data, not a file. You don't write a folder or a `MAILBOX.md` for one. It's a row created while the app runs, by your own code or by a worker acting for a person.

The work inside a project is split into **workstreams**. Each workstream has one owner and a lead worker from that owner's roster. Everyone who can read the project can read every workstream's entry, so anyone can see how the project is going. Only the owner can change their workstream or hand it work.

Each person talks to a project through their own **project coordinator**: a conversation with a coordinator worker that reads the whole project and hands work to that person's workstreams.

![A shared project lives in the organization and everyone in it reads it. A private project lives with its creator and nobody else reads it. Each workstream is one entry with one owner, read by everyone who reads the project and written only by its owner. Each person's project coordinator hands work only to their own open workstreams.](./project-overview.svg)

## Private and shared

You choose when you create a project.

A **shared** project lives in the organization. Everyone in the org can list it and read its row, its repository included, and every workstream's entry. Its members are the people who may open workstreams in it.

A **private** project lives with you. Nobody else can list, open or read it, its files included, and it shows only in the org you made it in. Its only member is you.

Either way it's the same kind of project, with the same fields. A private project can't become shared later, or the other way round.

A project's address is its visibility and its id, `{ visibility: "shared", id: "apollo" }`. Every project read and write after the create takes one. Your private `apollo` and the org's shared `apollo` are two different projects. Another user's private project can't be addressed at all: a call naming one is refused with `no-such-project`, exactly as if it didn't exist.

## The row

| Field | What it holds |
|-------|---------------|
| `id` | The project's id. One path segment. `unassigned` is reserved |
| `title` | The project's name |
| `brief` | What the project is for, or `null` |
| `status` | A free label. New projects are `"active"` |
| `ownerUserId` | The user who created it |
| `members` | On a shared project, who may open workstreams in it. Always includes the owner. A private project has only its owner |
| `repository` | The git remote the project's code lives in, such as `https://github.com/acme/storefront.git`, or `null` |

Each workstream is its own entry, not part of the row, so two owners can update their workstreams at the same time.

## Declaring the collections

Declare the shared projects once, at the organization level, in `workforce/org/resources/projects.ts`:

```ts
import { defineProjectsCollection } from "@flow-state-dev/workforce";

export default defineProjectsCollection();
```

`defineProjectsCollection()` is the org's `projects` collection. `definePrivateProjectsCollection()` is the same row at each user's own scope. The project and workstream blocks below declare both, so most apps never declare the private one themselves. You can call either function anywhere you need it: every call returns the same declaration, so they never conflict. Both are shared across flows and readable from the browser, where a user reads the org's shared projects and their own private ones.

## Creating a project

`defineProjectBlocks()` gives you the project blocks, `createProject`, `setRepository`, `readProject` and `readProjectFiles`, and the same blocks as an `actions` map to spread into a flow:

```ts
import { defineFlow } from "@flow-state-dev/core";
import { defineProjectBlocks } from "@flow-state-dev/workforce";

const projects = defineProjectBlocks();

export const projectsFlow = defineFlow({
  kind: "projects",
  actions: { ...projects.actions },
});
```

Call `createProject` with an id, a title, and optionally a brief, a visibility, the other members and the [repository](#a-projects-code-and-files). With no visibility, the project is shared:

```ts
import { createClient } from "@flow-state-dev/client";

const projects = createClient({ flowKind: "projects", userId });

await projects.sendAction(
  "createProject",
  { id: "apollo", title: "Apollo", brief: "Ship the new checkout.", visibility: "shared", members: ["bob"] },
  { sessionId }
);

await projects.sendAction("createProject", { id: "notes", title: "My notes", visibility: "private" }, { sessionId });
```

It returns the row, where it lives, and whether this call wrote it:

```ts
{
  project: { id: "apollo", title: "Apollo", ownerUserId: "alice", members: ["alice", "bob"], /* … */ },
  visibility: "shared",
  created: true,
}
```

The owner is whoever's session sent it, as the server recorded it, never a field you pass. The owner is always a member, and `members` lists who else they're letting in.

The write is a `create`, never an overwrite. If the same owner sends the same id again, they get the existing row back, unchanged, with `created: false`, so a retried create is safe. A refused create writes nothing, and the error is a `ProjectRefusedError` whose `reason` says why:

| `reason` | When |
|----------|------|
| `project-id-held` | Another owner's shared project holds the id |
| `invalid-project-id` | The id is empty, `unassigned`, or not one path segment |
| `private-has-members` | A private project names anyone besides its owner |
| `invalid-repository` | The repository isn't a remote. See [A project's code and files](#a-projects-code-and-files) |

### Default projects from app code

If your app should start with some projects already there, create them from its own code at boot, through the same `createProject` action, when the rows are absent. A re-run finds the row it already made and hands it back, so a second boot changes nothing.

### Giving the writes to a worker

A worker on the built-in `agent` kind can create projects and open workstreams for the person talking to it. Put the blocks in the kind's tool catalog, under the names a worker's `tools:` line spells. A catalog key must match the tool's own name, so give each block that name with `.as()`, along with the description the model reads:

```ts
import { defineAgentWorkerFlow, defineProjectBlocks } from "@flow-state-dev/workforce";

const projects = defineProjectBlocks();
// workstreams: from defineWorkstreamBlocks, below

const agent = defineAgentWorkerFlow({
  installation,
  catalog: {
    createProject: projects.createProject.as({
      name: "createProject",
      description: "Create a project for the person you're talking to. They own it; `members` adds the user ids they name.",
    }),
    openWorkstream: workstreams.openWorkstream.as({
      name: "openWorkstream",
      description: "Open a workstream the person owns in a project, led by a worker on their roster.",
    }),
  },
});
```

[Workstreams](#workstreams) covers `defineWorkstreamBlocks`. `.as()` only renames. If a write should wait for a person's approval first, keep a sequencer that asks before the step, as the [chief of staff](./chief-of-staff.md) does for `fire`.

A worker calls them only when its own `tools:` names them. The owner is the person whose session the worker is answering in, so a project or workstream a worker creates belongs to whoever asked for it.


[The chief of staff](./chief-of-staff.md#starting-projects) is a worker set up this way. On the `coordinator` flow, its own turn reads the catalog you pass `defineCoordinatorFlow` as `agent`, so the entries go there.

## Workstreams

A workstream is one area of a project with one owner. It's two things:

- An **entry** on the project: its title, owner, lead, status, due date, objectives and latest report.
- Its **workstream session**: a lasting session of the lead worker, owned by the workstream's owner. The lead is usually a worker with delegates it files tasks for, and the session's board holds the workstream's tasks.

`defineWorkstreamBlocks` builds the workstream writes from your [worker installation](./workers-on-disk.md) and the worker flows a lead can run on:

```ts
import { defineFlow } from "@flow-state-dev/core";
import {
  AGENT_FLOW,
  defineProjectBlocks,
  defineWorkstreamBlocks,
  WORKSTREAM_OPENED_ENTRY,
} from "@flow-state-dev/workforce";

// Describes the built-in agent flow (see below).
const agentLeads = { kind: AGENT_FLOW, internal: { actions: { [WORKSTREAM_OPENED_ENTRY]: {} } } };

const projects = defineProjectBlocks();
const workstreams = defineWorkstreamBlocks({ installation, leadFlows: [agentLeads] });

export const projectsFlow = defineFlow({
  kind: "projects",
  actions: { ...projects.actions, ...workstreams.actions },
});
```

It returns `openWorkstream` and `updateWorkstream`, the same two as `actions`, and `updateWorkstreamTool` for a lead.

A lead flow must declare the internal entry `workstreamOpenedEntry()` returns, under `internal.actions[WORKSTREAM_OPENED_ENTRY]`. The built-in `agent` flow declares it, and a worker flow of your own spreads it in to let its workers lead. `leadFlows` reads only each flow's `kind` and that entry, so you can pass the flow itself or describe it, as above. A lead flow without the entry is refused when the blocks are built.

### Opening one

Call `openWorkstream` with the project's address, an id, a title and a lead from your own roster, and optionally a due date and objectives:

```ts
const apollo = { visibility: "shared", id: "apollo" } as const;

await projects.sendAction(
  "openWorkstream",
  {
    project: apollo,
    id: "checkout",
    title: "Checkout",
    lead: "eng-lead",
    due: "2026-11-30",
    objectives: ["Ship guest checkout"],
  },
  { sessionId }
);
```

The entry is yours. Workforce starts the lead's workstream session, also yours, and records its id on the entry. The call returns the entry and whether this call made it:

```ts
{
  workstream: {
    project: { visibility: "shared", id: "apollo" },
    id: "checkout",
    owner: "alice",
    title: "Checkout",
    lead: "eng-lead",
    sessionId: "…",
    status: "on-track",
    due: "2026-11-30",
    objectives: [{ text: "Ship guest checkout", met: false, metAt: null, metBy: null }],
    openedAt: "2026-10-10T09:00:00.000Z",
    updatedAt: "2026-10-10T09:00:00.000Z",
    writtenBy: { /* who wrote it last */ },
  },
  opened: true,
}
```

A workstream id is unique within a project for each owner, so Alice's `checkout` and Bob's `checkout` are two workstreams. Opening your workstream again hands the entry back with `opened: false`, and finishes an earlier open that never got its session started. A refused open writes nothing:

| `reason` | When |
|----------|------|
| `no-such-project` | The address names no project you can read |
| `not-a-member` | On a shared project, you aren't one of its members |
| `invalid-workstream-id` | The id is empty or holds a `/` |
| `no-such-worker` | The lead isn't a worker on your roster. Another user's worker is refused the same way |
| `cannot-lead` | The lead runs on a flow that isn't in `leadFlows` |
| `lead-differs` | You already have this workstream open, with another lead. A workstream's lead doesn't change |
| `too-many-workstreams` | You already have 25 open workstreams in the project. Mark one done first. Applies when your installation names a [project coordinator](#talking-to-a-project) |

### Who sees what

Everyone who can read the project reads every entry: its title, owner, lead, status, due date, objectives, latest report, and who last wrote it. Only the owner can change an entry, and only the owner can open the workstream session, its board and its tasks.

Change an entry with `updateWorkstream`. Every field is optional, and what you leave out stays:

```ts
await projects.sendAction(
  "updateWorkstream",
  {
    project: apollo,
    id: "checkout",
    status: "at-risk",
    objectives: [{ text: "Ship guest checkout", met: false }],
    report: "Payments sandbox is down.",
  },
  { sessionId }
);
```

It returns `{ workstream }`, the entry as written.

- **`status`** is a short label in the owner's own words, such as `"on-track"` or `"waiting on legal"`, up to 80 characters. One label has a meaning: `"done"` marks the workstream finished.
- **`objectives`** is the whole list, each met or not. An objective that was already met keeps when and by whom. One met by this call is stamped now, as you.
- **`report`** is the latest report. It replaces the previous one.

The entries are an [owner-writes collection](../resources/collections.md#owner-writes-collections), so a write to someone else's entry throws "A row of an owner-writes collection is written only by the user it belongs to." and changes nothing, whichever flow sends it. A workstream you don't have is refused with `no-such-workstream`. A workstream is never deleted: mark it `done` and it stays listed.

**The lead keeps it current.** `updateWorkstreamTool` is the same write as a tool, named `updateWorkstream`, for the lead's flow. It takes only the changes, and writes the workstream whose session it runs in, as that session's owner. Put it in the lead flow's catalog and list `updateWorkstream` in the lead's `tools:`:

```ts
const agent = defineAgentWorkerFlow({
  installation,
  catalog: { updateWorkstream: workstreams.updateWorkstreamTool },
});
```

Run in a session that leads no workstream, it's refused with `not-a-workstream-session`.

### Reading a project and its progress

`readProject` takes a project's address and returns the row, every workstream's entry, oldest first, and the project's progress:

```ts
// input
{ project: { visibility: "shared", id: "apollo" } }

// output
{
  project: { id: "apollo", title: "Apollo", /* … */ },
  visibility: "shared",
  workstreams: [/* every entry, as openWorkstream returns one */],
  progress: {
    workstreams: 3,
    byStatus: { "on-track": 1, "at-risk": 1, done: 1 },
    objectives: { met: 2, total: 5 },
    nextDue: "2026-11-30",
    stale: [{ owner: "bob", id: "payments", updatedAt: "2026-09-28T16:02:11.000Z" }],
  },
}
```

Progress is worked out from the entries each time you read it, so it reflects the entries as they are when you read it.

- `byStatus` counts every workstream under its status label, done ones included.
- `nextDue` is the earliest due date of a workstream that isn't done, overdue ones included, or `null`.
- `stale` lists the workstreams that aren't done and whose entry hasn't changed for seven days (`STALE_AFTER_MS`), oldest first.

The entries `readProject` returns leave out the reports. A report is the entry's content: read it with the resource client's `getCollectionItemContent(sessionId, "workstreams", key)` (`"privateWorkstreams"` for a private project), where `key` is the entry's storage key.

A browser can read the entries itself through the resource routes. Parse each with `parseWorkstreamEntry(path, state)`, and pass the parsed entries to `projectProgress(entries, Date.now())` for the same counts the server gives. Import all three, with `DONE_STATUS` and `STALE_AFTER_MS`, from `@flow-state-dev/workforce/browser`.

## Talking to a project

Each user talks to a project through their own **project coordinator**: a session of one standard coordinator worker your installation names, one per user per project.

Name the worker when you build the installation. It must be a standard worker on the [`coordinator`](./coordinators.md) flow, or `createWorkerInstallation` throws:

```ts
const installation = createWorkerInstallation({
  standardWorkers: workers,
  workerFlows: () => kinds,
  projectCoordinator: "project-coordinator",
});
```

Give its flow the project coordinator's tool, `readProject`, which reads the project its session is linked to. Put `projectCoordinatorTools` in the catalog you pass `defineCoordinatorFlow` as `agent`, and name the tool in the worker's file:

```ts
import { defineCoordinatorFlow, projectCoordinatorTools } from "@flow-state-dev/workforce";

const coordinator = defineCoordinatorFlow({
  installation,
  delegateFlows: [agent],
  routeModel: "openai/gpt-5.4-mini",
  agent: { catalog: { ...projectCoordinatorTools } },
});
```

```md title="workforce/org/workers/project-coordinator/WORKER.md"
---
description: Your coordinator for one project. Says how its workstreams are going, and hands your asks to the workstreams you own there.
flow: coordinator
routing: judgment
tools: [readProject]
---

When the person asks how the project is going, call `readProject` and answer
from what it returns. When they ask for work, hand it to the delegate whose
workstream it belongs to.
```

Find or start your coordinator for a project with `ensureWorkerSession`, naming the project:

```ts
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";

const workforce = createWorkforceClient({ userId });
const session = await workforce.ensureWorkerSession({
  worker: "project-coordinator",
  projectId: { visibility: "shared", id: "apollo" },
});
```

The first call starts the session, and every later one returns the same session. Starting one for a project you can't read is refused with a 404, so another user's private project stays invisible.

Your coordinator reads every workstream's entry, so it can answer how the whole project is going. Its delegates are the workstreams you have open in the project: one per workstream, its lead with the workstream as the delegate's target. When you ask it for work, it hands the request to the lead of one of **your** workstreams, inside that workstream's session. It never hands work to another member's workstream. To get something from theirs, read their entry or ask them. If you have no open workstream in the project, it has no delegate to hand work to.

### How its delegates follow your workstreams

You never add or remove a project coordinator's workstream delegates yourself. They follow your workstreams:

- **When you start your coordinator**, its delegates are the workstreams you have open in the project.
- **When you open a workstream**, `openWorkstream` adds its delegate: the lead, with the workstream's address as the target. If you haven't started your coordinator yet, nothing changes now; it picks the workstream up when it starts.
- **When you mark a workstream `done`**, `updateWorkstream` removes its delegate. Change the status from `done` to anything else and the delegate comes back. The lead's own `updateWorkstream` tool does the same.
- **When the coordinator hands work to a delegate**, the post goes into that workstream's session, and the lead answers there. If the workstream can't take work then, because it's done or its session isn't started yet, the hand-off fails with that reason.

A coordinator holds at most 25 delegates, which is why `openWorkstream` refuses a 26th open workstream with `too-many-workstreams`.

## A project's code and files

A project can name the repository its code lives in. It's a remote, the address you'd pass to `git clone`, not a folder on some machine. Set it when you create the project, or later with `setRepository`. Send `null` to clear it:

```ts
// at create
{ id: "storefront", title: "Storefront", repository: "https://github.com/acme/storefront.git" }

// later, from a member's session
{ project: { visibility: "shared", id: "storefront" }, repository: "git@github.com:acme/storefront.git" }
{ project: { visibility: "shared", id: "storefront" }, repository: null }
```

A private project's repository and files are its owner's alone. On a shared project, everyone in the org can read the row, and so the repository's address.

`setRepository` returns `{ project }`, the row as written. It changes `repository` and nothing else on the row. Only members can call it; anyone else is refused with `not-a-member`, and an address that names no project with `no-such-project`. When two members set it at the same moment, one of the two values is kept whole.

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

### Coding work in a project

When a coding worker picks up work for one of the project's workstreams, it works in a fresh branch of the project's repository, as long as the host running the worker allows that remote. Nobody names a folder. Changing the repository applies to new work. Work already started stays where it began: on the repository it began with, or, if the project had none then, on the project's files.

A project with no repository still runs coding work. The first run starts from an empty set of files, and everything it writes is saved to the [project's files](#the-projects-own-files). The next run starts from what the last one left. If two runs change the same file, the changes are merged; a real conflict is reported on the run instead of overwriting anyone's work. A run isn't marked done until what it wrote is saved: if the last save fails, the attempt fails and the retry saves it.

To get this, build the coding worker's [harness manager](../orchestration/harness-manager.md) on a workspace host (from `@flow-state-dev/workspace`) whose source is `projectWorkspace`:

```ts
import { harnessManager } from "@flow-state-dev/harness-manager";
import { localWorkspaceHost } from "@flow-state-dev/workspace";
import { projectWorkspace, projectWorkspaceCapability } from "@flow-state-dev/workforce";

harnessManager({
  // ...the board it works and its other options, as usual
  workspace: localWorkspaceHost({
    root: "/var/fsd/runs",
    remotes: { allow: ["github.com"] },
    source: projectWorkspace(),
  }),
  uses: [projectWorkspaceCapability],
});
```

`projectWorkspace` finds the project a run works in, in this order:

1. The workstream the task came from, when it was filed from one.
2. The project the task came from, when it was filed from a project's conversation.
3. The project the task names in `input.project`, by its visibility and id, when it came from a conversation that belongs to no project, such as the person's own coordinator.

The run is refused, before any file is read, when:

| Refusal | When |
|---|---|
| `other-project` | The task names a project other than the one its conversation belongs to. The refusal names both. |
| `no-project` | The task names a project by its id alone. A private and a shared project can share an id, so a project is named by its visibility and id. |
| `no-project` | None of the three steps finds a project. The message says the task can name one in `input.project`. |
| `not-a-member` | The person the run belongs to isn't one of the project's members. |
| `not-the-owner` | The run is in a workstream whose owner is someone else. |
| `no-such-workstream`, `no-such-project` | What the task or its session names is gone. |

Membership is read from the person the run belongs to; nothing the task says counts toward it. The host also refuses a remote its `remotes.allow` doesn't list, naming it, before anything is cloned; list `"file"` to allow `file://` remotes. A refused run isn't retried. When the task came from a conversation, the task fails and the conversation hears why, in a line under the worker's name.

A coordinator filing for a coding worker from a conversation with no project names one:

```json
{ "goal": "Take a look at our repo and tell me what the checkout flow does", "assignee": "eng.coder", "input": { "project": { "visibility": "shared", "id": "storefront" } } }
```

Put `projectWorkspaceCapability` on the harness manager's `uses`, as in the example above.

### The project's own files

Notes, memory and anything else kept for a project live under the project's id: `project-files/<projectId>/<path>`. A shared project's files are the organization's `project-files` collection, declared with `defineProjectFilesCollection()`. A private project's are the same keys in its owner's own scope, `definePrivateProjectFilesCollection()`. Like the project collections, every call returns the same declaration. Both are shared across flows and loaded only when read.

Only the project's members can list the files, with `readProjectFiles`:

```ts
// input
{ project: { visibility: "shared", id: "storefront" } }

// output: each file's path under the project, and its size in bytes
{
  files: [
    { path: "notes.md", size: 7 },
    { path: "src/index.ts", size: 10 },
  ],
}
```

It lists paths and sizes, not file contents.

It returns that project's files, never another project's. A non-member is refused with `not-a-member`, and an unknown address with `no-such-project`. Neither collection has a browser read: a request for one through the collection route gets a 403.

In a project with a repository, a coding run finds the project's files in `project/`, next to its checkout and never inside it, so they don't show up in `git status`. Whatever the run leaves there is saved back to the project.

