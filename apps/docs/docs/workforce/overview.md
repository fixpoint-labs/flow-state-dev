---
title: Workforce
sidebar_position: 1
sidebar_label: Overview
description: Describe a roster of workers, run each on one shared copy of the flow it names, and talk to a worker in a session that names it.
---

# Workforce

`@flow-state-dev/workforce` runs a roster of workers on flows you already defined. A worker is a configuration: a `WORKER.md` your files declare, or one a user hires or forks for themselves. Each flow a worker names is registered once, as one shared copy, and every worker on it runs there.

A conversation with a worker is a session of its flow that names the worker when it is created. One session, one worker, for the session's whole life.

## Workforce or orchestration

Reach for Workforce when you want a named roster you address by opening a session.

Reach for [Orchestration](../orchestration/overview) when you want to coordinate units of work on a task board. A board worker is a block that claims tasks. A task's `assignee` can also name one of your standard workers. See [Giving a task to a worker](#giving-a-task-to-a-worker).

## What a Workforce app looks like

![A WORKER.md file in your repository is the description. readWorkforce turns files into plain records, and hireWorkforce gives back one copy of each flow a worker runs on, which your app registers. Every worker on a flow shares that copy. Sessions name their worker when they are created, and live in your store with the state and resources a worker writes. A worker a user hires or forks while the app runs is a row in their own data. A task's assignee can name a standard worker that takes tasks: the board runs the list, and Workforce finds the worker.](./workforce-overview.svg)

Workforce reads your files and runs them. Each `WORKER.md` is a standard worker every user has, run by one shared copy of the flow it names. A user can add workers of their own, which nobody else can reach. Each `MAILBOX.md` becomes a named session on a mailbox kind, the built-in one unless the file names another. Sessions, resources and boards work as they do on any flow, and live where they always do.

- **A user's own workers are data.** A worker a user hires or forks while the app runs is a row in their own data: every process sees it on the next turn, nothing restarts, and no other user can reach it. See [Hiring and forking](./durable-hire).
- **A mailbox is what a reader opens.** A mailbox is a named session on a kind the framework ships, and its transcript is the part of that conversation a person or another agent should read. A routed mailbox sends each post to the one member whose job fits it. See [Mailboxes](./mailboxes).
- **The screens are importable.** One navigator browses the whole workforce, and the roster and a board, as columns or as a live list, ship beside it as components from `@flow-state-dev/react`. See [Workforce components](./ui).

For a working example, the [kitchen-sink reference app](https://github.com/fixpoint-labs/flow-state-dev/tree/main/apps/kitchen-sink) is a support desk built this way: four specialists and one routed mailbox, declared under its `workforce/` folder, with a board for cases that need a person.

## Hire a roster

A worker on a team lives at `teams/<team>/workers/<name>/WORKER.md`, so `teams/engineering/workers/lead/` is `engineering.lead`. An org seat belongs to no team: it lives at `org/workers/<name>/WORKER.md` and goes by its folder name alone, so `org/workers/chief-of-staff/` is `chief-of-staff`.

```md
---
description: Holds the board.
model: openai/gpt-5.4-mini
---
You are the engineering lead. You break work into tasks and report what came back.
```

```ts
import { createWorkerInstallation, hireWorkforce } from "@flow-state-dev/workforce";
import { readWorkforce } from "@flow-state-dev/workforce/loader";

// `errors` is a worker that failed to load; `skillErrors` is one that loaded
// without a skill it should have had; `teamErrors` is a team file that failed.
// Each is collected rather than thrown, so an array you forget to check is
// one that reports nowhere.
const { workers, errors, skillErrors, teamErrors } = await readWorkforce("./workforce");
if (errors.length || skillErrors.length || teamErrors.length) {
  throw new Error(
    `workforce: ${errors.length} worker(s) failed to load, ` +
      `${skillErrors.length} loaded short, ` +
      `${teamErrors.length} team file(s) failed`,
  );
}

const installation = createWorkerInstallation({ standardWorkers: workers });
const flows = hireWorkforce(installation);

flowRegistry.registerMany(flows);
```

That worker file names no `flow:`, so it runs on the built-in worker flow, `agent`. `hireWorkforce` gives back one copy of `agent`, however many workers run on it, and the roster flow an app [hires and forks](./durable-hire) through. Its body becomes its instructions, and it talks. It sees the recent turns of the conversation it's in, and nothing it's told there reaches any other conversation.

A **skill** is a folder of instructions a worker can pull into a turn. `readWorkforce` collects the skills sitting beside each worker in the tree, and the built-in reads them. Each person keeps their own copy of a worker's skills. To talk to a worker, open a session that names it, as [Talking to a worker](./workers-on-disk.md#talking-to-a-worker) shows, and send `userId` beside `input`. The call never names the organization: every request runs in one, and [Authentication](../server/authentication.md#every-request-runs-in-an-organization) covers where it comes from. [The built-in worker](./built-in-worker.md) covers its settings, what your app can configure, and the rest of what it does not do.

To run a worker on a flow you wrote yourself, name that flow's kind in the worker's `flow:`. Here is `teams/engineering/workers/triage/WORKER.md`:

```md
---
description: Sends an incoming request to an answer or to a person.
flow: request-triage
---
Answer directly when the request is a question about a feature that already shipped.
```

Then pass the flow under that same kind:

```ts
import { requestTriageFlow } from "./flows";

const installation = createWorkerInstallation({
  standardWorkers: workers,
  workerFlows: { "request-triage": requestTriageFlow },
});
const flows = hireWorkforce(installation);
```

`requestTriageFlow` is your own flow, built on the installation, and `"request-triage"` is its `kind`. A record that names no `flow:` runs on the built-in, so one roster can run both. You get back one copy per flow, ordered by kind, and the roster flow.

Pass a flow under a key that is not its own `kind` and it is refused. [Workers on disk](./workers-on-disk.md#when-a-worker-needs-more-than-settings) walks through writing a worker flow of your own.

`hireWorkforce` reads no files and registers nothing itself. A refusal throws and returns nothing.

`readWorkforce` is Node-only (`@flow-state-dev/workforce/loader`). Import `createWorkerInstallation` and `hireWorkforce` from `@flow-state-dev/workforce`.

## Projects and the chief of staff

A **workstream** is a mailbox and the boards it holds: one place for the conversation about a piece of work, and the tasks people take to do it. You declare it in a `MAILBOX.md`, like any mailbox.

A **project** groups workstreams. It is a row your organization keeps, not a file: a title, an owner, its members, and the workstreams it groups. Everyone in the organization can see that a project exists. Only its members can read or post in its room, the one conversation they share with the workers your app puts there. See [Projects](./projects).

The **chief of staff** is an org-level worker a person asks about the organization: who works here, who is in a mailbox. Ask it for another worker and it hires one of your own. Ask it for one fewer and it puts the fire in front of you, and nothing is removed until you approve. Given the project tools, it also starts projects for the person who asks. A Lab that doesn't declare one doesn't have one. See [The chief of staff](./chief-of-staff).

## Giving a task to a worker

A task on a mailbox's board can name any of your standard workers that takes tasks, by the name `discover` lists: `engineering.lead`. When the board hands the task over, Workforce's worker lookup finds the worker of that name and the task runs in a session of its flow that names it, one run per task.

A worker on the built-in `agent` flow runs a task as one turn: its own instructions and tools, the task's title, goal and context as the message, and its answer as the task's result. A kind you write takes tasks when it declares a `work` task entry.

The name reaches the workers your files declare. A mailbox's board is the organization's, and whoever drains it opens the task's session, so it never hands a task to a user's own worker, which only its owner can open a session with. With the mailbox's filing check on, a task for a name nobody holds is refused when it is filed, naming it. A task whose worker was fired before it ran fails with the worker's name. No other worker picks it up.

[Handing a row to the worker it names](./mailboxes.md#handing-a-row-to-the-worker-it-names) has the wiring: the lookup, the filing check, and the board that hands tasks over.

## What it will not do

- It does not run your task boards. A board drains its rows. Workforce tells the board which worker a name means, and gives workers a way to take a task.
- It does not replace flows, sessions, or resources. A worker's sessions are sessions of the flow it runs on.
- Hiring at runtime writes no files. It stores the new worker as a row in the user's data, and the tree stays as you wrote it. See [Hiring and forking](./durable-hire.md).

## Related pages

- [Workers on disk](./workers-on-disk) — the folder tree, `WORKER.md`, `readWorkforce`, `hireWorkforce`, and talking to a worker.
- [The built-in worker](./built-in-worker) — the `agent` kind a record with no `flow:` runs on: its settings, tools, skills, and memory.
- [Documents on disk](./documents-on-disk) — a team's shared reference material as Markdown, installed as resources.
- [Code on disk](./code-on-disk) — your own flow kinds, blocks and capabilities in the same tree, registered by `fsdev gen`.
- [Capabilities on disk](./capabilities-on-disk) — what a capability in a `resources/` folder gives a worker, and how a worker's file picks its presets.
- [Packages on disk](./packages-on-disk) — a folder of instructions and the blocks a worker needs to follow them.
- [Mailboxes](./mailboxes) — several agents on one topic, with one durable transcript and nobody owning a row, optionally routing each post to one member.
- [Projects](./projects) — a row that groups workstreams, with one room its members share.
- [Inventory](./inventory) — a record of every seat and mailbox registered in an organization, readable by a block.
- [Hiring and forking](./durable-hire) — a user's own workers, hired, forked and fired while the app runs.
- [The chief of staff](./chief-of-staff) — the one worker a person asks to hire or fire workers of their own, with a fire waiting for their approval.
- [Workforce components](./ui) — browse your flow kinds, instances and sessions, and render a roster and boards, with React components.
- [Orchestration](../orchestration/overview) — the task board and the workers that drain it.
- [Agents](../orchestration/agents) — board workers, `definePersona`, and `createWorkforceCapability`.
- [Flows](../fundamentals/flows.md) — how a flow copy is configured and addressed.
