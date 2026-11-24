---
title: Projects
type: catalog
description: A project is a body of work with an owner, shared with an organization or kept private, split into workstreams, and talked to through each user's own worker.
---

import Figure from "@site/src/components/Figure";
import ASharedProject from "./figures/a-shared-project.svg";

# Projects

A project is a body of work that several users can work on together without sharing a conversation. It has a title, a brief, an owner, and the work inside it divided into **workstreams**, each an area of the work with one owner. Each user reaches the project through a worker of their own: a named agent defined in a Markdown file. Every user gets their own copy.

People on a team need to see where a piece of work stands. They do not need to read each other's conversations with their workers. A project is built around that split. The project and each workstream's entry in it are shared with the **organization**, the group of users your app serves together. Every conversation and every session of a worker stays with the user it belongs to.

A project is not a folder. It is a stored record your app creates while it runs, by your own code or by a worker acting for a user. Workers are files, projects are records.

<Figure svg={ASharedProject} caption="One shared project, reached through each user's own worker" description={"At the top, a hatched box, the shared project apollo, holding two entries: checkout, Alice's entry, and billing, Bob's entry, both read by everyone. Below it, two columns. On the left, Alice's project coordinator, hatched, holding project-coordinator, which is highlighted as her own session of it; below that, Alice's workstream session, hatched, where alice-lead works checkout. On the right, the same for Bob, with bob-lead working billing. An arrow numbered 01 runs up from each coordinator to the project, because it reads every entry. An arrow numbered 02 runs down from each coordinator to its own user's workstream session, because it hands work only there. Two red lines run from Bob's coordinator and Bob's session toward Alice's boxes and end in a bar: Bob cannot read them. Hatched boxes are stored records."} />

## What you get

- **A shared view of the work.** Bob reads Alice's `checkout` entry (its status, due date, objectives and latest report) without asking her.
- **Private conversations.** Alice's coordinator and her workstream session are closed to Bob.
- **A coordinator of your own for each project.** It starts the first time you ask for it and is the same one every time after.
- **One owner per workstream.** Only Alice changes `checkout`, though everyone reads it.

## Install it

Projects come with the [workforce kit](./index.md). The kit does not serve a projects flow of its own, so your app adds one, names a coordinator worker, and hands the flow to the kit.

The flow is the project blocks' actions, plus the workstream blocks' actions, which need the kit's installation (the workers the kit has loaded):

```ts title="src/flows/projects/flow.ts"
import { defineFlow } from "@flow-state-dev/core";
import {
  AGENT_FLOW,
  PROJECTS_FLOW,
  defineProjectBlocks,
  defineWorkstreamBlocks,
  workstreamOpenedEntry,
  type WorkerInstallation,
} from "@flow-state-dev/workforce";

const agentLeads = { kind: AGENT_FLOW, internal: { actions: { onWorkstreamOpened: workstreamOpenedEntry() } } };
const projectBlocks = defineProjectBlocks();

export function projectsFlow(installation: WorkerInstallation) {
  const workstreamBlocks = defineWorkstreamBlocks({ installation, leadFlows: [agentLeads] });
  return defineFlow({
    kind: PROJECTS_FLOW,
    actions: { ...projectBlocks.actions, ...workstreamBlocks.actions },
  })();
}
```

`agentLeads` names the worker flows whose workers may lead a workstream. The built-in `agent` flow is one. The `onWorkstreamOpened` entry lets a flow's workers lead: when a workstream opens, it starts the lead's session. The kit builds the flow when it loads, so the config hands it a builder:

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import { projectCoordinatorTools, type WorkerInstallation } from "@flow-state-dev/workforce";
import { workforce } from "@flow-state-dev/workforce/kit";
import { projectsFlow } from "./src/flows/projects/flow";

export default createFlowState({
  kits: [
    workforce({
      directory: "./workforce",
      projectCoordinator: "project-coordinator",
      coordinator: {
        routeModel: "openai/gpt-6-luna",
        agent: { catalog: { ...projectCoordinatorTools } },
      },
    }),
  ],
  fill: {
    [workforce.slots.flows]: {
      projects: (installation: WorkerInstallation) => [projectsFlow(installation)],
    },
  },
});
```

`projectCoordinator` names the worker each user talks to about a project. `projectCoordinatorTools` gives that worker its `readProject` tool, and the worker's file picks it:

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

## Use it

### Private and shared

Alice creates `apollo` with a client call. Whoever sends it owns the project, and the input has no owner field:

```ts title="src/lib/create-apollo.ts"
import { createClient } from "@flow-state-dev/client";

export async function createApollo(userId: string) {
  const projects = createClient({ userId, baseUrl: "" }).flow("projects");
  const session = await projects.createSession();
  await projects.send(
    "createProject",
    { id: "apollo", title: "Apollo", brief: "Ship the new checkout.", visibility: "shared", members: ["bob"] },
    { sessionId: session.id },
  );
  return session.id;
}
```

A **shared** project lives in the organization. Everyone in it can read the project and every workstream's entry. Only the project's members open workstreams in it: the owner, plus the users named in `members`. A **private** project lives with its creator: nobody else can list it, open it or read anything in it, and it has no members but its owner. A call from anyone else that names it is refused `no-such-project`, exactly as if it did not exist. If you belong to more than one organization, a private project shows only in the organization you made it in. Leave `visibility` out and the project is shared. Visibility and members are fixed when the project is created: nothing changes them later. The [workforce reference](../../reference/workforce.md) lists the `createProject` fields and defaults, and the address and visibility rules.

Every later call addresses the project by its visibility and its id, `{ visibility: "shared", id: "apollo" }`, so a private `apollo` and a shared `apollo` are two projects.

### Workstreams

A workstream is one area of a project: an entry on the project, plus a session of the worker that leads it. Alice opens `checkout`, led by one of her own workers:

```ts title="src/lib/open-checkout.ts"
import { createClient } from "@flow-state-dev/client";

export async function openCheckout(userId: string, sessionId: string) {
  const projects = createClient({ userId, baseUrl: "" }).flow("projects");
  return projects.send(
    "openWorkstream",
    {
      project: { visibility: "shared", id: "apollo" },
      id: "checkout",
      title: "Checkout",
      lead: "engineering.lead",
      due: "2026-11-30",
      objectives: ["Ship guest checkout"],
    },
    { sessionId },
  );
}
```

The lead is one of your own workers that lists delegates in its file, since a lead runs its workstream through them.

A workstream has exactly one owner, one lead and one session. The owner is whoever opened it, and only the owner changes the entry. The lead is chosen when the workstream is opened and never changes: opening `checkout` again with another lead is refused `lead-differs`, and two opens at once leave one entry and one session. The session is a long-lived session of the lead, owned by the workstream's owner. Alice's `checkout` and Bob's `checkout` are two workstreams.

The lead keeps the entry current from its session: status, due date, objectives and a report. Everyone who can read the project reads those. Only Alice opens the session itself.

### Talking to a project

Each user talks to a project through their own **project coordinator**, a session of the coordinator worker named in the config. There is one per user per project. `ensureWorkerSession` starts it on the first call and returns the same one every time after:

```ts title="src/lib/ask-coordinator.ts"
import { createClient } from "@flow-state-dev/client";
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";

export async function askCoordinator(userId: string) {
  const fsd = createClient({ userId, baseUrl: "" });
  const session = await createWorkforceClient(fsd).ensureWorkerSession({
    worker: "project-coordinator",
    projectId: { visibility: "shared", id: "apollo" },
  });
  await fsd.flow(session.flowKind).send("respond", { message: "How is the project going?" }, { sessionId: session.id });
}
```

Alice and Bob get two sessions of the same worker file, one coordinator per user, and Bob cannot read or post to Alice's. The coordinator reads the whole project through `readProject`. When you ask it for work, it hands the request to the lead of one of your own workstreams, never to someone else's. The [workforce reference](../../reference/workforce.md) has what `readProject` returns, and how a delegation is refused.

## Slots it opens

Projects open no slot of their own.

## Slots it fills and views it serves

Projects fill the workforce kit's `flows` slot, with the flow above. Projects serve one view, `checkRepository`, which reports whether a project's repository (the git remote its coding runs work from) is set up. It is present when you pass a `checkRepository` option to `defineProjectBlocks`. [Harnesses](../harnesses/index.md) covers repositories.

## Change it

`setBrief` changes a project's brief, and `null` clears it:

```ts title="src/lib/set-brief.ts"
import { createClient } from "@flow-state-dev/client";

export async function setBrief(userId: string, sessionId: string) {
  const projects = createClient({ userId, baseUrl: "" }).flow("projects");
  return projects.send(
    "setBrief",
    { project: { visibility: "shared", id: "apollo" }, brief: "Ship the new checkout before the holiday freeze." },
    { sessionId },
  );
}
```

Give a coordinator the tools in its `catalog` (the tools its config lets it choose from) and it can open and edit workstreams, set the brief, and set the project's repository on its own. The [workforce reference](../../reference/workforce.md) has who may call `setBrief` and lists the tools.

## Next

- [Coordinators](./coordinators.md), the workers a project coordinator is one of.
- [Delegating work](./delegating-work.md), how a lead hands a workstream's work to its delegates.
- [Harnesses](../harnesses/index.md), for a project's repository and the coding runs that use it.
- [The workforce reference](../../reference/workforce.md), for the project's fields, its collections and every refusal.
