---
title: Projects
sidebar_position: 9
sidebar_label: Projects
description: "A project is a body of work, private to one user or shared with the org. Each workstream in it has one owner, and each user talks to it through their own project coordinator."
---

import Figure from "@site/src/components/Figure";
import ProjectOverviewDrawing from "./project-overview.svg";

# Projects

A **project** is a body of work: a title, a brief, an owner and, on a shared project, the people working on it. It's data, not a file. You don't write a folder or a file for one. It's a row created while the app runs, by your own code or by a worker acting for a user.

The work inside a project is split into **workstreams**. Each workstream has one owner and a lead worker from that owner's roster. Everyone who can read the project can read every workstream's entry, so anyone can see how the project is going. Only the owner can change their workstream or hand it work.

Each user talks to a project through their own **project coordinator**: a conversation with a coordinator worker that reads the whole project and hands work to that user's workstreams.

<Figure svg={ProjectOverviewDrawing} caption="A project is shared with the organization, or private to you" description={"A shared project lives in the organization and everyone in it reads it. A private project lives with its creator and nobody else reads it. Each workstream is one entry with one owner, read by everyone who reads the project and written only by its owner. Each user's project coordinator hands work only to their own open workstreams."} />

## Private and shared

You choose when you create a project.

A **shared** project lives in the organization. Everyone in the org can list it and read its row, its repository included, and every workstream's entry. Its members are the people who may open workstreams in it.

A **private** project lives with you. Nobody else can list, open or read it, its files included, and it shows only in the org you made it in. Its only member is you.

Either way it's the same kind of project, with the same fields. A private project can't become shared later, or the other way round.

A project's address is its visibility and its id, `{ visibility: "shared", id: "apollo" }`. Every project read and write after the create takes one. The exceptions are the writes a project coordinator makes in its own project: `openWorkstream` is covered in [Opening one](#opening-one); `editWorkstream` in [Changing workstreams from the coordinator](#changing-workstreams-from-the-coordinator); `setBrief` and `setRepository` in [Managing the project from the coordinator](#managing-the-project-from-the-coordinator). Your private `apollo` and the org's shared `apollo` are two different projects. Another user's private project can't be addressed at all: a call naming one is refused with `no-such-project`, exactly as if it didn't exist.

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
| `mcpServers` | The MCP servers the project's coding runs get, by name, such as `["linear"]`. Empty by default. See [Tools a project's coding work gets](#tools-a-projects-coding-work-gets) |

Each workstream is its own entry, not part of the row, so two owners can update their workstreams at the same time.

## Declaring the collections

Usually you don't declare anything. Shared projects live in the org's `projects` collection and private ones in each user's `privateProjects`, and three things declare both for you:

- `hireWorkforce` returns a [roster flow](./durable-hire.md#hiring-a-worker), `workforce-roster`, with your worker flows, and you register it with them. It declares both collections, and a client lists a user's projects and reads a project's workstreams through it.
- The blocks `defineProjectBlocks()` returns, and `openWorkstream` from `defineWorkstreamBlocks()`, declare both on themselves. A flow that holds one has the collections, whether you spread it as an action or put it in a worker flow's tool `catalog`.
- `defineCoordinatorFlow` declares both on the coordinator flow.

Otherwise, on a flow of your own that reads or writes project rows without those blocks, put both in its `resources`, where you build the flow, under the keys the workforce's own flows use:

```ts
import {
  definePrivateProjectsCollection,
  defineProjectsCollection,
  PRIVATE_PROJECTS_RESOURCE,
  PROJECTS_RESOURCE,
} from "@flow-state-dev/workforce";

const resources = {
  [PROJECTS_RESOURCE]: defineProjectsCollection(),
  [PRIVATE_PROJECTS_RESOURCE]: definePrivateProjectsCollection(),
};
```

Every call returns the same declaration, so declaring the collections on several flows never conflicts. Both are shared across flows and readable from the browser, where a user reads the org's shared projects and their own private ones.

## Creating a project

`defineProjectBlocks()` gives you the project blocks, `createProject`, `setBrief`, `setRepository`, `readProject` and `readProjectFiles`, and the same blocks as an `actions` map to spread into a flow:

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

const fsd = createClient({ userId, baseUrl });
const projects = fsd.flow("projects");

await projects.send(
  "createProject",
  { id: "apollo", title: "Apollo", brief: "Ship the new checkout.", visibility: "shared", members: ["bob"] },
  { sessionId }
);

await projects.send("createProject", { id: "notes", title: "My notes", visibility: "private" }, { sessionId });
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

### Changing the brief

`setBrief` sets, changes or clears a project's brief. Send `null` to clear it:

```ts
await projects.send(
  "setBrief",
  { project: { visibility: "shared", id: "apollo" }, brief: "Ship the new checkout before the holiday freeze." },
  { sessionId }
);
```

It returns `{ project }`, the row as written, and changes `brief` and nothing else on the row. Only members can call it; anyone else is refused with `not-a-member`, and an address that names no project with `no-such-project`. When two members set it at the same moment, one of the two values is kept whole.

`project` is optional. Left out, it changes the project the calling conversation belongs to (`no-such-project` when it belongs to none). From a project's conversation, naming another project is refused with `other-project`. See [Managing the project from the coordinator](#managing-the-project-from-the-coordinator).

### Default projects from app code

If your app should start with some projects already there, create them from its own code at boot, through the same `createProject` action, when the rows are absent. A re-run finds the row it already made and hands it back, so a second boot changes nothing.

### Giving the writes to a worker

A worker on the built-in `agent` worker flow can create projects and open workstreams for the user talking to it. Put the blocks in the flow's tool catalog, under the names a worker's `tools:` line spells. A catalog key must match the tool's own name, so give each block that name with `.as()`, along with the description the model reads:

```ts
import { defineAgentWorkerFlow, defineProjectBlocks } from "@flow-state-dev/workforce";

const projects = defineProjectBlocks();
// workstreams: from defineWorkstreamBlocks, below

const agent = defineAgentWorkerFlow({
  installation,
  catalog: {
    createProject: projects.createProject.as({
      name: "createProject",
      description: "Create a project for the user you're talking to. They own it; `members` adds the user ids they name.",
    }),
    openWorkstream: workstreams.openWorkstream.as({
      name: "openWorkstream",
      description: "Open a workstream the user owns in a project, led by a worker on their roster.",
    }),
  },
});
```

[Workstreams](#workstreams) covers `defineWorkstreamBlocks`. `.as()` only renames. If a write should wait for a user's approval first, keep a sequencer that asks before the step, as the [Shift Coordinator](./shift-coordinator.md) does for `fire`.

A worker calls them only when its own `tools:` names them. The owner is the user whose session the worker is answering in, so a project or workstream a worker creates belongs to whoever asked for it.


[The Shift Coordinator](./shift-coordinator.md#starting-projects) is a worker set up this way. On the `coordinator` flow, its own turn reads the catalog you pass `defineCoordinatorFlow` as `agent`, so the entries go there.

## Workstreams

A workstream is one area of a project with one owner. It's two things:

- An **entry** on the project: its title, owner, lead, status, due date, objectives and latest report.
- Its **workstream session**: a lasting session of the lead worker, owned by the workstream's owner. The lead runs the workstream through its delegates, filing tasks for them on the session's board, so a lead must list delegates in its configuration.

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

It returns `openWorkstream` and `updateWorkstream`, the same two as `actions`, `updateWorkstreamTool` for a lead, `editWorkstreamTool` for a project coordinator (see [Changing workstreams from the coordinator](#changing-workstreams-from-the-coordinator)), and `listLeadsTool` and `openWorkstreamTool` for a worker that picks a lead and opens the workstream (see [Opening workstreams from the coordinator](#opening-workstreams-from-the-coordinator)).

Pass `leadFit: { model }` to have `openWorkstreamTool` check a worker's pick of lead against the work before it opens. Left out, `openWorkstreamTool` is the same block as `openWorkstream`.

A lead flow must declare the internal entry `workstreamOpenedEntry()` returns, under `internal.actions[WORKSTREAM_OPENED_ENTRY]`. The built-in `agent` flow declares it, and a worker flow of your own spreads it in to let its workers lead. `leadFlows` reads only each flow's `kind` and that entry, so you can pass the flow itself or describe it, as above. A lead flow without the entry is refused when the blocks are built.

### Opening one

Call `openWorkstream` with the project's address, an id, a title and a lead from your own roster, and optionally a due date and objectives.

`project` is optional. Leave it out and the workstream opens in the project the calling conversation belongs to: a project coordinator's conversation belongs to its project; a user's own coordinator belongs to none. A conversation that belongs to a project opens workstreams only there, so naming a different project from it is refused.

```ts
const apollo = { visibility: "shared", id: "apollo" } as const;

await projects.send(
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
| `no-such-project` | The address names no project you can read, or you left `project` out in a conversation that belongs to no project |
| `other-project` | The conversation belongs to one project and you named another |
| `not-a-member` | On a shared project, you aren't one of its members |
| `invalid-workstream-id` | The id is empty or holds a `/` |
| `no-such-worker` | The lead isn't a worker on your roster. Another user's worker is refused the same way |
| `cannot-lead` | The lead runs on a flow that isn't in `leadFlows`, or lists no `delegates:` |
| `lead-doesnt-fit` | A worker opened it with `openWorkstreamTool`, `leadFit` is set, and the fit check answered that none fits: the lead's description says it does a different sort of work. See [Checking the lead fits](#checking-the-lead-fits) |
| `lead-differs` | You already have this workstream open, with another lead. A workstream's lead doesn't change |
| `too-many-workstreams` | You already have 25 open workstreams in the project. Mark one done first. Applies when your installation names a [project coordinator](#talking-to-a-project) |

### Who sees what

Everyone who can read the project reads every entry: its title, owner, lead, status, due date, objectives, latest report, and who last wrote it. Only the owner can change an entry, and only the owner can open the workstream session, its board and its tasks.

Change an entry with `updateWorkstream`. Every field is optional, and what you leave out stays:

```ts
await projects.send(
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

**The lead keeps it current.** `updateWorkstreamTool` is the same write as a tool, named `updateWorkstream`, for the lead's flow. It takes only the changes, and writes the workstream whose session it runs in, as that session's owner. The title is not one of those changes: the owner sets it through `updateWorkstream`, and their project coordinator through `editWorkstream`. Put it in the lead flow's catalog and list `updateWorkstream` in the lead's `tools:`:

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

The entries `readProject` returns leave out the reports. A report is the entry's content: read it with `fsd.resources.getCollectionItemContent(sessionId, "workstreams", key)` (`"privateWorkstreams"` for a private project), where `key` is the entry's storage key.

A browser can read the entries itself through the resource routes. Parse each with `parseWorkstreamEntry(path, state)`, and pass the parsed entries to `projectProgress(entries, Date.now())` for the same counts the server gives. Import all three, with `DONE_STATUS` and `STALE_AFTER_MS`, from `@flow-state-dev/workforce/browser`.

## Talking to a project

Each user talks to a project through their own **project coordinator**: a session of one standard coordinator worker your installation names, one per user per project.

Name the worker when you build the installation. It must be a standard worker on the [`coordinator`](./coordinators.md) flow, or `createWorkerInstallation` throws:

```ts
const installation = createWorkerInstallation({
  standardWorkers: workers,
  workerFlows: () => workerFlows,
  projectCoordinator: "project-coordinator",
});
```

Give its flow the project coordinator's tool, `readProject`, which reads the project its session is linked to and marks each workstream `yours: true` when the user owns it. Put `projectCoordinatorTools` in the catalog you pass `defineCoordinatorFlow` as `agent`, and name the tool in the worker's file:

```ts
import { defineCoordinatorFlow, projectCoordinatorTools } from "@flow-state-dev/workforce";

const coordinator = defineCoordinatorFlow({
  installation,
  routeModel: "openai/gpt-6-luna",
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

When the user asks how the project is going, call `readProject` and answer
from what it returns. When they ask for work, hand it to the delegate whose
workstream it belongs to.
```

Find or start your coordinator for a project with `ensureWorkerSession`, naming the project:

```ts
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";

const workforce = createWorkforceClient(fsd); // fsd: your app's client from createClient
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
- **When you mark a workstream `done`**, `updateWorkstream` removes its delegate. Change the status from `done` to anything else and the delegate comes back. The lead's own `updateWorkstream` tool does the same, and so does the coordinator's `editWorkstream`.
- **When the coordinator hands work to a delegate**, it files a routed task with `createTask`, naming the workstream's address as `target`. The task runs in that workstream's session, and the lead answers there; its answer lands in your conversation with the coordinator. If the workstream can't take work then, because it's done or its session isn't started yet, the filing fails with that reason. `target` is set when the task is filed and can't be changed.

A coordinator holds at most 25 delegates, which is why `openWorkstream` refuses a 26th open workstream with `too-many-workstreams`.

### Opening workstreams from the coordinator

Your coordinator can open a workstream for you when you ask for work none of your workstreams in the project covers. Add these tools from `defineWorkstreamBlocks` to its catalog:

- `listLeadsTool`, a tool named `listLeads`. It takes no input and returns `{ leads: [{ id, description }] }`: every worker on your roster, your own and the standard ones, that can lead a workstream, as the roster stands when the tool runs. `description` is `null` for a worker without one.
- `openWorkstreamTool`, the `openWorkstream` write for a worker, named for the catalog with `.as()`. Called without `project`, it opens the workstream in the coordinator's own project. Naming another project is refused with `other-project`, so tell the coordinator to leave `project` out, as the file below does.

```ts
// The same call as above, with leadFit added.
const workstreams = defineWorkstreamBlocks({
  installation,
  leadFlows: [agentLeads],
  leadFit: { model: "openai/gpt-6-luna" },
});

const coordinator = defineCoordinatorFlow({
  installation,
  routeModel: "openai/gpt-6-luna",
  agent: {
    catalog: {
      ...projectCoordinatorTools,
      listLeads: workstreams.listLeadsTool,
      openWorkstream: workstreams.openWorkstreamTool.as({ name: "openWorkstream" }),
    },
  },
});
```

List both in the worker's `tools:` and tell it when to use them:

```md title="workforce/org/workers/project-coordinator/WORKER.md"
---
description: Your coordinator for one project. Says how its workstreams are going, opens a workstream for new work, and hands your asks to the workstreams you own there.
flow: coordinator
routing: judgment
tools: [readProject, listLeads, openWorkstream]
---

When the user asks for work none of their workstreams here holds, call
`listLeads` and pick the worker whose description fits. Open a workstream
with `openWorkstream`, that worker as `lead` and no `project`, then hand the
ask to it, targeting `<project.visibility>/<project.id>/<id>` from the
workstream it returns. When nobody fits, say so and open nothing.
```

When `openWorkstream` runs in your own coordinator's turn, the new workstream is already one of the coordinator's delegates when the open returns, so the coordinator can hand your ask to it in the same turn. The delegate's target is `<project.visibility>/<project.id>/<id>`, read from the `workstream` the open returns, for example `shared/apollo/checkout`. One worker can lead several of your workstreams, each with its own session and board.

#### Checking the lead fits

`listLeads` returns every worker that can lead, whether or not it suits the work. A coordinator with a single lead tends to pick it even when its description says it does something else. Set `leadFit` to have the open refuse that pick.

With `leadFit: { model }` set, `openWorkstreamTool` runs a fit check on that model before it opens. It's the same check a coordinator's `best-fit` routing uses to pick a delegate (see [Coordinators](./coordinators.md)), so the two never disagree about whether a worker's description fits some work. Here it gets three choices for the workstream's title and objectives: the lead, judged by its description (from its worker file, as `listLeads` shows it), *none fits*, or *the work doesn't say what sort it is*. Only *none fits* refuses the open, with `lead-doesnt-fit`, and nothing is written. Work that doesn't say its sort, such as a bare name, passes, and so does a lead whose description is broad. The refusal's message tells the worker to pick another lead from `listLeads`, or, if none does the work, to open nothing and say a worker for it has to be hired first.

The check asks the model as an evaluation model first. If that call fails and `model` is a model string, it asks the same question once more as a language model, the way best fit does, so a model your gateway serves only for text generation still works here.

The check runs only once every other refusal has passed, so a bad id or a lead that can't lead is refused for that reason without a model call. Opening a workstream that is already open, with the same lead, isn't checked again.

The open goes through without a verdict when the check fails, answers something that isn't one of its choices, or the lead has no description, so a model outage never stops a workstream opening. Opens through the `openWorkstream` action, such as a user's own open from the app, are never checked.

The tool's answer says what became of the check in `leadFit`: `{ checked: true }` when the lead passed, or `{ checked: false, why }` when it went unchecked. `why` is `already-open`, `no-description`, or `unanswered:` followed by the check's error or what it answered, so a check that has stopped answering shows up in the answers rather than nowhere.

### Changing workstreams from the coordinator

Your coordinator can change your workstreams in its project when you ask: rename one, move its due date, rewrite its objectives, or close it. Add `editWorkstreamTool` from `defineWorkstreamBlocks` to its catalog. The block is already named `editWorkstream`, so it needs no `.as()`:

```ts
const coordinator = defineCoordinatorFlow({
  installation,
  routeModel: "openai/gpt-6-luna",
  agent: {
    catalog: {
      ...projectCoordinatorTools,
      listLeads: workstreams.listLeadsTool,
      openWorkstream: workstreams.openWorkstreamTool.as({ name: "openWorkstream" }),
      editWorkstream: workstreams.editWorkstreamTool,
    },
  },
});
```

```md title="workforce/org/workers/project-coordinator/WORKER.md"
---
description: Your coordinator for one project. Says how its workstreams are going, opens and changes your workstreams, and hands your asks to the workstreams you own there.
flow: coordinator
routing: judgment
tools: [readProject, listLeads, openWorkstream, editWorkstream]
---

When the user wants one of their workstreams renamed, re-dated, its
objectives changed or closed, call `editWorkstream` with its `id` and no
`project`.
```

The tool takes the workstream's `id`, an optional `project`, and any of `title`, `status`, `due` and `objectives`, which mean what they do for `updateWorkstream`. `due` is `YYYY-MM-DD`, or `null` to clear it. What you leave out stays. It returns `{ workstream }`, the entry as written.

```ts
{ id: "checkout", title: "Guest checkout", due: "2026-11-30" }
{ id: "checkout", status: "done" }
```

It always writes the caller's own entry, so it has no `owner` field. It has no `report` either: the report is the lead's, written with `updateWorkstreamTool`. A call that passes either fails validation.

Left out, `project` is the coordinator's own project. A refused change writes nothing and returns one of these reasons:

| `reason` | When |
|----------|------|
| `no-such-workstream` | You have no workstream with that id in the project. Another member's workstream id is refused the same way |
| `other-project` | The conversation belongs to one project and you named another |
| `no-such-project` | You left `project` out in a conversation that belongs to no project |

Setting `status` to `"done"` removes the workstream's delegate, as `updateWorkstream` does. When `editWorkstream` runs in your own coordinator's turn, the delegate is removed in that same turn, so a dispatch later in the turn never reaches a workstream it just closed.

### Managing the project from the coordinator

Your coordinator can keep its own project's row current: rewrite the brief when the goal shifts, or set the repository once there is one. Give its catalog `setBrief` and `setRepository` from `defineProjectBlocks()`, named for the catalog with `.as()`:

```ts
const projects = defineProjectBlocks();

const coordinator = defineCoordinatorFlow({
  installation,
  routeModel: "openai/gpt-6-luna",
  agent: {
    catalog: {
      ...projectCoordinatorTools,
      setBrief: projects.setBrief.as({ name: "setBrief" }),
      setRepository: projects.setRepository.as({ name: "setRepository" }),
      listLeads: workstreams.listLeadsTool,
      openWorkstream: workstreams.openWorkstream.as({ name: "openWorkstream" }),
    },
  },
});
```

List them in the worker's `tools:` and tell it to leave `project` out:

```md title="workforce/org/workers/project-coordinator/WORKER.md"
---
description: Your coordinator for one project. Says how its workstreams are going, keeps the project's brief and repository current, opens a workstream for new work, and hands your asks to the workstreams you own there.
flow: coordinator
routing: judgment
tools: [readProject, setBrief, setRepository, listLeads, openWorkstream]
---

When the user changes what the project is for, call `setBrief` with the new
brief and no `project`. When they name the project's repository, call
`setRepository` with it and no `project`.
```

Left out, `project` is the coordinator's own project, and naming any other one is refused with `other-project`. Called from a conversation that belongs to no project, such as a user's own coordinator, a write without `project` is refused with `no-such-project`. Either way, only the project's members can change it.

If a user should approve the repository before it's written, give the catalog a `setRepository` that asks first: a sequencer, a block that runs steps in order, with a step that waits for the user's approval before the write, as the [Shift Coordinator](./shift-coordinator.md) does for `fire`. When the input leaves `project` out, that step can name the project with `linkedProjectOf(ctx.session.state)` from `@flow-state-dev/workforce`. It returns the session's `{ visibility, id }`, or `undefined` for a session that belongs to no project:

```ts
setRepository: sequencer({
  name: "setRepository",
  inputSchema: setRepositoryInputSchema,
  outputSchema: setRepositoryOutputSchema,
})
  .tap(askToSetRepository) // reads input.project?.id ?? linkedProjectOf(ctx.session.state)?.id
  .step(projects.setRepository),
```

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

`project` is optional. Left out, it changes the project the calling conversation belongs to (`no-such-project` when it belongs to none). From a project's conversation, naming another project is refused with `other-project`. See [Managing the project from the coordinator](#managing-the-project-from-the-coordinator).

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
2. The project the task came from, when it was filed from a project's conversation, or from a conversation [set to work in a project](#setting-the-project-a-conversation-works-in).
3. The project the task names in `input.project`, by its visibility and id, when it came from a conversation with no project, such as the user's own coordinator until it's set to one.

A task filed from a workstream, a project's conversation or a conversation set to a project is stored naming that project, whatever the filer put in `input.project`. A worker filing from one is told which project it works in, so it doesn't have to name one.

The run is refused, before any file is read, when:

| Refusal | When |
|---|---|
| `other-project` | The task names a project other than the one its conversation belongs to, which a task filed through the conversation's own task tools never does. The refusal names both. |
| `no-project` | The task names a project by its id alone. A private and a shared project can share an id, so a project is named by its visibility and id. |
| `no-project` | None of the three steps finds a project. The message says to set the project of the conversation that files the task, then file it again. |
| `not-a-member` | The user the run belongs to isn't one of the project's members. |
| `not-the-owner` | The run is in a workstream whose owner is someone else. |
| `no-such-workstream`, `no-such-project` | What the task or its session names is gone. |

Membership is read from the user the run belongs to; nothing the task says counts toward it. The host also refuses a remote its `remotes.allow` doesn't list, naming it, before anything is cloned; list `"file"` to allow `file://` remotes. A refused run isn't retried. When the task came from a conversation, the task fails and the conversation hears why, in a line under the worker's name.

A coordinator filing for a coding worker from a conversation with no project names one:

```json
{ "goal": "Take a look at our repo and tell me what the checkout flow does", "assignee": "eng.coder", "input": { "project": { "visibility": "shared", "id": "storefront" } } }
```

Put `projectWorkspaceCapability` on the harness manager's `uses`, as in the example above.

#### Asking for a project before a task exists

A refused run means the task was already filed, and the user finds out late. Register the coding worker's flow with `needsProject: true` and the check moves to filing:

```ts
createWorkerInstallation({
  workerFlows: { coder: workerFlow(buildCoderFlow, { roles: ["contributor"], needsProject: true }) },
});
```

A task for one of that flow's workers is then refused when it is filed with nowhere to work: no workstream, no project on the conversation, and none named in `input.project`. Nothing is filed and nothing runs. The filer's `createTask` answers `{ ok: false, error: "no_project: …" }`, and the message tells it to set the conversation's project (`listProjects`, then `setWorkProject`) and file again. An app can watch for that answer and ask the user for a project right there. The run's own `no-project` refusal still catches anything filed some other way.

Set it only where runs find their files through `projectWorkspace`. A host whose runs always work in one fixed folder has somewhere to work for every task, so its coding flow leaves `needsProject` off.

### Setting the project a conversation works in

A user's own conversation with a worker can be set to work in one of their projects. From then on, its coding runs and every task it files work in that project, so nobody has to name it in `input.project`. Set it from the app with the workforce client's `setWorkProject`:

```ts
import { createClient } from "@flow-state-dev/client";
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";

const fsd = createClient({ userId, baseUrl, fetcher });
const workforce = createWorkforceClient(fsd);
// A worker's one conversation, at the first job that needs files
await workforce.setWorkProject("lead", { visibility: "shared", id: "apollo" });
// A new session, after the user picks a project
const session = await fsd.flow("lab-main").createSession({ state: { workerId: "main" } });
await workforce.setWorkProject("main", { visibility: "shared", id: "apollo" }, { sessionId: session.id });
```

Without `sessionId`, it sets the user's default conversation with that worker, creating the conversation if there isn't one. With `sessionId`, it sets that session, which must be the user's own and run that worker. It resolves to `{ project: { visibility, id } }`. A new session takes two calls, as above: create it, then set its project. A create that puts `workProjectId` in `state` is refused with a 400 naming the field.

To show the project on screen, read the session. Its state carries `workProjectId` as `<visibility>/<id>`, whoever set it and however long ago, and `parseProjectRef` from `@flow-state-dev/workforce/browser` splits it:

```ts
import { parseProjectRef, WORK_PROJECT_STATE_KEY } from "@flow-state-dev/workforce/browser";

const { state } = await fsd.sessions.get(session.id);
const project = parseProjectRef(String(state[WORK_PROJECT_STATE_KEY] ?? "")); // { visibility: "shared", id: "apollo" }
```

The field is read only. `setWorkProject` is the only way to change it.

Calling it again with another project replaces the first. Tasks already filed keep the project they were filed in, including one still waiting on the board for a delegate and one handed to a delegate's ongoing session, along with whatever that delegate files while working it. A run that has already started stays where it is. There's no way to clear the project: once set, the conversation always has one.

The worker flows the package ships take the call as they are: `agent`, `coordinator` and the [Error Reporter](./error-reporter.md)'s flow. A worker flow of your own declares the action under its name:

```ts
import { SET_WORK_PROJECT_ACTION, setWorkProjectAction } from "@flow-state-dev/workforce";

defineFlow({
  // ...
  actions: { respond, ...board.actions, [SET_WORK_PROJECT_ACTION]: setWorkProjectAction },
});
```

A refused call rejects with an `Error` whose message starts `Refused:`, and nothing is stored:

| Refused when | The message says |
|---|---|
| The project is shared and the user isn't one of its members | `not-a-member` |
| The user has no private project with that id | `you have no private project "<id>"` |
| The organization has no shared project with that id | `this organization has no project "<id>" you can read` |
| The session is a project coordinator's, a task's, a delegate's or a workstream lead's | Which of those it is. Each of them works in the project it was created, filed or opened in. |
| The session runs a different worker than the one named | `this session runs "<its worker>", not "<worker>"` |

Membership is checked again on every run, so a user removed from the project can't run work there through a conversation set to it earlier. A project coordinator's conversation gets its project from `ensureWorkerSession({ worker, projectId })`, as in [Talking to a project](#talking-to-a-project).

### Reading a project's files from a conversation

A worker can read the project its conversation works in without starting a coding run. It lists the files, reads one, and searches them in its own turn. So a question about the code gets answered from the code, and a change it hands to a coder can name the files to touch.

The app installs `projectSourceCapability` on the worker flow, with the same workspace host its coding runs use:

```ts
import { localWorkspaceHost } from "@flow-state-dev/workspace";
import { defineAgentWorkerFlow, projectSourceCapability, projectWorkspace } from "@flow-state-dev/workforce";

const workspace = localWorkspaceHost({
  root: "/var/fsd/runs",
  remotes: { allow: ["github.com"] },
  source: projectWorkspace(),
});

defineAgentWorkerFlow({
  installation,
  model: "openai/gpt-6-luna",
  uses: [projectSourceCapability({ workspace })],
});
// Pass the same `workspace` to the coding workers' harness manager.
```

Building the capability over a host that can't read files without a run throws, naming the problem. `localWorkspaceHost` can.

Each worker opts in from its own `WORKER.md`. A worker whose file doesn't name the preset gets none of the tools:

```yaml
---
description: Does the work you ask for.
capabilities:
  projectSource: [read]
---
```

The `read` preset gives the worker three tools:

| Tool | Takes | Returns |
|---|---|---|
| `globProjectSource` | `pattern`, a glob such as `src/**`; `limit` | The matching paths, at most 500 |
| `readProjectSource` | `path`; `startLine` and `endLine` for part of a file | The lines asked for, at most 2,000 lines or 256 KB, and the file's line count |
| `grepProjectSource` | `pattern`; `prefix` to search one folder; `maxResults` | Each matching line's path, line number and text (its first 200 characters), at most 200 matches |

A result that hit a limit has `cut: { left, by }`: how many paths, lines or matches were left out, and which limit cut it. A path is relative to the project's root, with `/` between names, no leading `/` and no `.` or `..` part. Anything else comes back refused with `invalid-path`. A path is matched exactly, never as a pattern. `readProjectSource` answers a binary file with `status: "binary"` instead of its bytes, and `grepProjectSource` skips binary files.

`grepProjectSource` reads its pattern as a regular expression, or as plain text when it isn't a valid one. The result names which in `dialect`: `extended-regex` (git's flavor) on a repository, `javascript-regex` on a project with no repository, or `literal` for plain text.

What the tools read depends on the project:

- **A project with a repository:** the remote's default branch, at one commit, named in each result's `at.commit`. The host keeps one clone of each remote, the same one its coding runs start from, and fetches it when the last fetch is more than a minute old. `at.fetchedAt` says when that was. A branch a coding run is working on isn't visible here until it reaches the default branch, so to find out what a run has done so far, ask the run.
- **A project [mapped to a checkout](#working-in-a-checkout-you-already-have):** the commit a new run there would start from. Uncommitted changes in the checkout aren't read.
- **A project with no repository:** the [project's own files](#the-projects-own-files). A project with a repository keeps files too, but these tools read the repository only.

The worker finds its project the way a coding run does, with `projectWorkspace`, and is refused for the same reasons, listed under [Coding work in a project](#coding-work-in-a-project). A user taken off a project's members loses reads along with coding runs. A refusal is the tool's result, `{ kind: "refused", reason, message }`, so the worker can tell the user why, and nothing is read. A delegate working a task reads the project the task was filed in.

None of the tools writes. Changing a project's files is a coding run's job.

### Tools a project's coding work gets

A project can name MCP servers, and every coding run on the project can use their tools. MCP, the Model Context Protocol, is how an agent reaches a tool outside its checkout: an issue tracker, a docs search, a database. A run gets the project's servers however the work reached it: from a workstream, from the project's conversation, or from a task that names the project.

The server running your workers decides which MCP servers exist, and their addresses. A project picks from those names. Each user sets their own key for a server, and a run uses the key of the user it works for, so it acts in that tool as them.

```ts
// the server's config, for example in a Shift Manager Lab
mcpServers: { linear: { url: "https://mcp.linear.app/mcp" } }

// a project, at create
{ id: "fsd", title: "FSD", repository: "https://github.com/acme/fsd.git", mcpServers: ["linear"] }

// later, from a member's session; [] turns them all off
{ project: { visibility: "shared", id: "fsd" }, mcpServers: ["linear"] }
```

`setMcpServers` replaces the list whole and returns `{ project }`. Only members can call it. Both writes refuse a name the server doesn't offer with `unknown-mcp-server`, naming the ones it does, and anything that isn't a plain name (lowercase letters, digits and hyphens) with `invalid-mcp-server`. A project row can't hold an address or a key.

The server holds the connection, not the coding agent. When a run starts, the server connects to each of the project's servers with the requester's key, and the agent gets the servers' tools. It never gets the key or the address: not on its command line, in its environment, in its MCP config or in its session. The connections close when the run ends.

A project that names no servers gets none: its runs don't pick up MCP servers from the server machine's own Claude Code settings, or the connectors of the Claude account it's signed in with. A list or a key changed while work is running applies from the next attempt.

If the requester hasn't set a key for one of the project's servers, the run goes ahead without it, and its session says which key is missing. The same happens for a name the server stopped offering, and for an MCP server that can't be reached.

Keys are stored in the server's own store, as written. A run with a shell and no sandbox runs as the same operating-system user as the server, so it could read that store. Sandbox the run if that matters, and use a key scoped to what runs need.

Only Claude Code runs get a project's servers. A Codex or Cursor run on the same project works without them, and says so.

In your own app, give the Claude Code block the resolver and the two collections it reads:

```ts
import { claudeCodeAgent } from "@flow-state-dev/claude-code/sdk";
import { mcpCredentialsCapability, projectMcpTools, projectWorkspaceCapability } from "@flow-state-dev/workforce";

claudeCodeAgent({
  // ...the run's other options
  uses: [projectWorkspaceCapability, mcpCredentialsCapability],
  mcpTools: projectMcpTools({ linear: { url: "https://mcp.linear.app/mcp" } }),
});
```

Pass the same names to `defineProjectBlocks({ mcpServers: ["linear"] })`, so a project can name them. Each user's key is a record at `mcp-credentials/<server>` in their own user scope, `{ value, setAt }`. Write it from a route of your own rather than an action: an action's input is kept on its request record. A browser read of the collection shows `setAt` only. Shift Manager's [Settings](../shift-manager/settings.md) page is one such route.

### Working in a checkout you already have

By default a coding run gets a fresh branch in the host's own clone of the project's repository. That clone lives under the host's root, so to see what a run did you fetch from it. When the server runs on the machine where you already have the repository checked out, you can have runs work in that checkout instead. Each run gets a worktree of your checkout on a branch of its own, and the branch shows up in `git branch` there.

The project's row names a remote, never a folder. The server's config says which projects are worked in which checkout:

```ts
harnessManager({
  workspace: localWorkspaceHost({
    root: "/var/fsd/runs",
    remotes: { allow: [] },
    localRepositories: ["/home/me/acme"],
    source: projectWorkspace({
      checkouts: [
        {
          remote: "https://github.com/acme/acme.git",
          checkout: "/home/me/acme",
          projects: [
            { orgId: "acme", id: "web" },
            { orgId: "acme", id: "api" },
          ],
          baseRef: "main",
        },
      ],
    }),
  }),
  uses: [projectWorkspaceCapability],
});
```

Only shared projects can be listed, each by its organization and id. A run uses the checkout only when its project is listed, the run's session belongs to that organization, and the project's `repository` is exactly the `remote` given here. The organization comes from the server's verified identity for the session, never from anything a task says. A private project with the same id and remote, or a shared one in another organization on the same server, never touches your checkout. Neither does a listed project whose repository was changed to something else. On a multi-tenant server, add `tenantId` to an entry; an entry without one matches only runs with no tenant. Those runs go the usual way: a clone, if the host allows the remote, or a refusal.

The checkout also has to be in the host's `localRepositories`. That list is what lets the host touch a folder on its machine at all. If the two disagree, the run is refused with `invalid-remote`, naming the path, before git runs. A relative `checkout` path, a `remote` a project couldn't store, or a project listed twice is refused when `projectWorkspace()` is called, naming the entry.

Each run's place has the worktree in `checkout/` and the [project's files](#the-projects-own-files) in `project/` beside it, as for any other repository. The branch is cut from `baseRef`, or from whatever your checkout has checked out when `baseRef` is left out.

Before the server cuts a new branch, it fetches that base's upstream, the remote branch it tracks, such as `origin/main`. Then it starts from whichever is newer: upstream when you haven't pulled, your own branch when it has commits you haven't pushed. Only the remote-tracking copy is updated. The server never switches, resets or cleans your working tree, and never moves your branch.

A few cases go differently:

- **Your branch and its upstream have each moved.** The run is refused with `base-diverged`, naming both commits, and nothing is made. Pull or rebase, or push, and the next run starts.
- **The fetch fails**, because you're offline, a credential is refused, or it times out. The run starts from your local branch, and the server logs a warning naming the checkout and git's error. It doesn't fall back to the copy you last fetched.
- **The remote or upstream changed since the server first saw it.** See [Changing your remote](#changing-your-remote).
- **The base is a remote's branch**, such as `baseRef: "origin/main"`. It is fetched from the pinned URL first, and the run starts at what that fetch brought. If the fetch fails, the run is refused with `remote-unreadable`. The remote-tracking copy on disk isn't used, because any run can move it.
- **The base has no upstream**, such as a tag, a commit, or a branch that tracks nothing. It is used as it is, with no fetch.
- **The run already has its branch**, on a retry or a later turn. It's handed back as it was, and nothing is fetched.

Listing the checkout is what allows the fetch, so the upstream doesn't need to be in `remotes.allow`. `remotes.allow` decides only which remotes the host clones. The upstream's URL is checked before git sees it: one that uses a transport helper such as `ext::`, starts with `-`, or uses a scheme other than `https`, `ssh` or `file` isn't fetched, and the server logs why.

Several projects can share one checkout, and their runs work side by side, each in its own worktree on its own branch.

#### Changing your remote

The server fetches only from the remote URLs and upstreams it pinned the first time it started with your checkout listed. The pins are kept in `<root>/.fetch-pins/`, not in your repository, and survive restarts. A remote or branch that appears later is pinned at the next start. A value already pinned doesn't change.

If a remote's URL no longer matches its pin, the server fetches nothing at all. It logs a warning that names the remote, both URLs and the pin file, and the run starts from your local branch. If a branch's upstream no longer matches its pin, the server still fetches the pinned upstream from the pinned URL, and logs a warning naming the pin file. If you made the change yourself, say because the repository moved, accept it by deleting the pin file the warning names and restarting the server. It pins your config as it is at that start.

#### What a run in your checkout can do

A run in your checkout works with your trust, the way a coding agent you start in your own repository does. It can create and move branches, tags and remote-tracking refs, because git shares those between worktrees. Every worktree also shares your checkout's `.git/config`, so a run could repoint `origin`; the pins keep that from steering the next fetch or your credentials. It doesn't keep a run away from your refs. If you want a run kept apart from your branches, give its project a repository the host clones instead of a checkout.

To review a run, open its worktree, or run `git log -p <branch> --not main main@{upstream}` from your checkout, with your base branch in place of `main`. For a base with no upstream, leave out `main@{upstream}`. That shows only the run's commits, whether it started from your base branch or from its upstream. Avoid `git diff main...<branch>`, which also shows upstream commits your `main` doesn't have. The branch stays checked out in the run's worktree, because a run can be continued later, after a question is answered or when you send it another turn, and it picks up in the same place. So git won't check that branch out a second time in your own tree. When you're done with a run, `fsdev worktrees <root> --remove <path>` frees the branch. It refuses while the worktree has uncommitted changes or a run is still working in it. See [`fsdev worktrees`](/docs/api/cli#fsdev-worktrees-root).

A fresh worktree has no `node_modules`. The coding agent installs them the way your repository tells it to. With pnpm that comes from the machine's shared store and takes seconds once the checkout has been installed.

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

