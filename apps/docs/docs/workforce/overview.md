---
title: Workforce
sidebar_position: 1
sidebar_label: Overview
description: Describe a roster of workers, hire them as addressable flow copies, and register what comes back.
---

# Workforce

`@flow-state-dev/workforce` turns a roster of workers into configured, addressable copies of flows you already defined. Describe each worker (usually as a `WORKER.md`), hire the roster, and register the copies that come back.

A hired worker is a **seat**: a flow instance with its own id. You open a session against it the way you open one against any other flow.

## Workforce or orchestration

Reach for Workforce when you want a named roster you address by opening a session.

Reach for [Orchestration](../orchestration/overview) when you want to coordinate units of work on a task board. A board worker is a block that claims tasks. A task's `assignee` can also name any of your hired workers, including one hired while the app runs. See [Giving a task to a worker](#giving-a-task-to-a-worker).

## What a Workforce app looks like

![A WORKER.md file in your repository is the description. readWorkforce turns files into plain records, hireWorkforce turns each record into a worker, a configured copy of a flow kind with its own id, and your app registers the workers. Sessions, state and resources a worker writes live in your store. A worker hired while the app runs is also written to the store as a roster row. A task's assignee can name any worker that takes tasks: the board runs the list, and Workforce finds the worker.](./workforce-overview.svg)

Workforce reads your files and hires them. Each `WORKER.md` becomes a flow copy with its own address. Each `MAILBOX.md` becomes a named session on a mailbox kind, the built-in one unless the file names another. Sessions, resources and boards work as they do on any flow, and live where they always do.

- **The roster outlives the process.** A team you hire while the app is running is still there after a restart or a redeploy, because the hire is written to the store your app uses. See [Hiring while the app runs](./durable-hire).
- **A mailbox is what a reader opens.** A mailbox is a named session on a kind the framework ships, and its transcript is the part of that conversation a person or another agent should read. A routed mailbox sends each post to the one member whose job fits it. See [Mailboxes](./mailboxes).
- **The screens are importable.** One navigator browses the whole workforce, and the roster and a board, as columns or as a live list, ship beside it as components from `@flow-state-dev/react`. See [Workforce components](./ui).
- **It does not run your task boards.** A board drains its rows. Workforce tells the board which worker a task's `assignee` means, and gives workers a way to take a task.
- **It adds to flows, sessions and resources, and replaces none of them.** Hiring at runtime adds to the roster in your files, and doesn't replace the tree.

For a working example, the [kitchen-sink reference app](https://github.com/fixpoint-labs/flow-state-dev/tree/main/apps/kitchen-sink) is a support desk built this way: four specialists and one routed mailbox, declared under its `workforce/` folder, with a board for cases that need a person.

## Hire a roster

A worker on a team lives at `teams/<team>/workers/<name>/WORKER.md`, so `teams/engineering/workers/lead/` hires as `engineering.lead`. An org seat belongs to no team: it lives at `org/workers/<name>/WORKER.md` and hires under its folder name alone, so `org/workers/chief-of-staff/` is `chief-of-staff`.

```md
---
description: Holds the board.
model: openai/gpt-5.4-mini
---
You are the engineering lead. You break work into tasks and report what came back.
```

```ts
import { hireWorkforce } from "@flow-state-dev/workforce";
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

const seats = hireWorkforce(workers);

flowRegistry.registerMany(seats);
```

That worker file names no `flow:`, so it runs on the built-in worker kind. Its body becomes its instructions, and it talks. It sees the recent turns of the conversation it's in, and nothing it's told there reaches any other conversation.

A **skill** is a folder of instructions a worker can pull into a turn. `readWorkforce` collects the skills sitting beside each worker in the tree, and the built-in reads them. Each organization keeps its own copy of a seat's skills. When you call the worker's action, send `userId` beside `input`. The call never names the organization: every request runs in one, and [Authentication](../server/authentication.md#every-request-runs-in-an-organization) covers where it comes from. [The built-in worker](./built-in-worker.md) covers its settings, what your app can configure, and the rest of what it does not do.

To run a worker on a flow you wrote yourself, name that flow's kind in the worker's `flow:`. Here is `teams/engineering/workers/triage/WORKER.md`:

```md
---
description: Sends an incoming request to an answer or to a person.
flow: request-triage
---
Answer directly when the request is a question about a feature that already shipped.
```

Then pass the flow under that same kind when you hire:

```ts
import { requestTriageFlow } from "./flows";

const seats = hireWorkforce(workers, {
  kinds: { "request-triage": requestTriageFlow },
});
```

`requestTriageFlow` is your own `defineFlow(...)`, and `"request-triage"` is its `kind`. A record that names no `flow:` is hired into the built-in, so one roster can run both. You get back one seat per worker, ordered by id.

Pass a flow under a key that is not its own `kind` and the hire is refused. [Workers on disk](./workers-on-disk.md#when-a-worker-needs-more-than-settings) walks through writing a flow kind of your own.

`hireWorkforce` reads no files and registers nothing. A refused hire throws and returns nothing.

`readWorkforce` is Node-only (`@flow-state-dev/workforce/loader`). Import `hireWorkforce` from `@flow-state-dev/workforce`.

## Projects, workstreams, and the seats that run them

A workstream is a mailbox with the boards it holds: one place for the conversation about a piece of work, and the rows people claim to do it. You declare it the way you declare any mailbox, in a `MAILBOX.md`.

A project groups workstreams. It is a record your organization keeps: a title, a status, an owner, its members, and links, stored once and visible to everyone in the organization. You don't write a file for each project. Each project has a room, one conversation its members share with the project's seats. You reach it through your own talk session, which your Lab shapes once for every project, in an org-level default template declared beside the collection in `org/resources/projects.ts`. A team that wants its own can still declare one in a `MAILBOX.md` with `mintFor: projects`. Only members read or post in a project's room. Other members' lines show up when your view next reads the room, not the instant they're posted. [Projects](./projects) covers the record and how to create one.

One seat helps a person run an organization. The chief of staff is who you ask who works here and who is in a mailbox. It also changes who works there: ask it for another seat and it hires one; ask it for one fewer and it puts the request in front of you to approve, and nothing is removed until you do. Given the project tools, it also starts projects for the person who asks, owned by them. The seats it hires belong to the organization, and other seats ask it rather than hiring for themselves. It is a seat on the built-in `agent` kind, declared under `org/workers/`, and a Lab that doesn't add it doesn't have one. See [The chief of staff](./chief-of-staff).

The chief of staff reads workstream mailboxes; it never opens, closes, or renames one.

## Giving a task to a worker

A task on a mailbox's board can name any of your workers that takes tasks, by the name `discover` lists: `engineering.lead`, or `frontend`, a worker hired a minute ago. When the board hands the task over, Workforce's worker lookup finds the worker of that name and the task runs on it, one run per task. The lookup reads the live registry, so a coordinator can hire a worker and give it work in the same conversation.

A worker on the built-in `agent` kind runs a task as one turn: its own instructions and tools, the task's title, goal and context as the message, and its answer as the task's result. A kind you write takes tasks when it declares a `work` task entry.

The name reaches your organization's workers, the ones your files declare, and the ones the member who filed the task hired for themselves, whoever later runs the list. It never reaches another member's own workers or another organization's. A name two of those workers share is refused as ambiguous. With the mailbox's filing check on, a task for a name nobody holds is refused when it is filed, naming it. A task whose worker was fired before it ran fails with the worker's name. No other worker picks it up.

[Handing a row to the worker it names](./mailboxes.md#handing-a-row-to-the-worker-it-names) has the wiring: the lookup, the filing check, and the board that hands tasks over.

## What it will not do

- It does not run your task boards. A board drains its rows. Workforce tells the board which worker a name means, and gives workers a way to take a task.
- It does not replace flows, sessions, or resources. Sessions and resources live on the seat you hired.
- Hiring at runtime writes no files. It stores the new seat as a row in the hired roster, which the app reads back at start alongside the seats your files declare, and the tree stays as you wrote it. See [Hiring while the app runs](./durable-hire.md).

## Related pages

- [Workers on disk](./workers-on-disk) — the folder tree, `WORKER.md`, `readWorkforce`, and `hireWorkforce`.
- [The built-in worker](./built-in-worker) — the `agent` kind a record with no `flow:` runs on: its settings, tools, skills, and memory.
- [Mailboxes](./mailboxes) — several agents on one topic, with one durable transcript and nobody owning a row, optionally routing each post to one member.
- [Inventory](./inventory) — a record of every seat and mailbox registered in an organization, readable by a block.
- [Documents on disk](./documents-on-disk) — a team's shared reference material as Markdown, installed as resources.
- [Code on disk](./code-on-disk) — your own flow kinds, blocks and capabilities in the same tree, registered by `fsdev gen`.
- [Capabilities on disk](./capabilities-on-disk) — what a capability in a `resources/` folder gives a worker, and how a worker's file picks its presets.
- [Hiring while the app runs](./durable-hire) — a roster hired at runtime, written to your store, reloaded on the next boot.
- [The chief of staff](./chief-of-staff) — the one seat a person asks to hire or fire, with a fire waiting for their approval.
- [Workforce components](./ui) — browse your flow kinds, instances and sessions, and render a roster and boards, with React components.
- [Orchestration](../orchestration/overview) — the task board and the workers that drain it.
- [Agents](../orchestration/agents) — board workers, `definePersona`, and `createWorkforceCapability`.
- [Flows](../fundamentals/flows.md) — how a flow copy is configured and addressed.
