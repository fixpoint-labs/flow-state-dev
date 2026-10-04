---
title: Glossary
description: "The main terms in flow-state.dev, the package each comes from, and the lower pieces each is built from."
---

# Glossary

flow-state.dev is built in layers. A small set of primitives in Core (blocks, flows, sessions, resources) carries everything above it. Orchestration builds task boards out of those primitives, Workforce builds workers and mailboxes out of flows and sessions, and Shift Manager is an app that reads what Workforce writes.

Most terms higher up are a lower term with a name and a rule added. A worker is a flow instance. A mailbox is a session. A project is one row of a resource collection. The Built from column tells you where each term's data lives.

Most terms link to their full page.

## The layers

![Five stacked layers. Contracts at the bottom holds the item types and block instance ids. Core above it holds blocks, flows, actions, scopes, resources and capabilities. The third layer holds Engine, which runs flows and stores what they write, Client and React for the browser, Orchestration, which builds tasks and task boards, and the smaller packages Memory, Tools and Workspace. The fourth layer holds the hosts and stores built on Engine, Workforce built on Core and Orchestration, and Patterns and Harness manager. Shift Manager sits on top: an app that serves a Workforce through the Engine and reads it.](./glossary/layers.svg)

A package uses only the layers under it. Workforce imports Core and Orchestration and nothing from Engine: when it needs to register a flow or open a session, your app passes in the function that does it.

## Core and Engine: from a block to a running flow

![Core builds up in five steps. A block is a typed unit of work, in one of five kinds. A sequencer is a block that runs other blocks in order. An action wraps one root block under a name. A flow is a kind that declares its actions, scopes, resources and capabilities. A flow instance is the flow called with an id and settings. The Engine registers instances and opens sessions on them, and each request on a session runs one action and streams items. Beside the chain, a tool is a block a generator may call, a capability bundles resources, state and tools a block pulls in with uses, and a resource collection is a family of resources keyed by a pattern.](./glossary/core.svg)

The top row builds left to right: each box is made of the one before it. The Engine row runs what the top row defines. A tool is an ordinary block, and so is a dispatcher.

### Contracts and Core

`@flow-state-dev/contracts` holds the shapes shared by the server and the browser. `@flow-state-dev/core` re-exports them and adds the builders.

| Term | Package | What it is | Built from |
|---|---|---|---|
| **Item** | contracts | One typed record a request streams: a message, reasoning, a tool output, a component, a status, an error, a state or resource change, a suspension, and a few more. See [Items](./streaming/items.md). | Content and a visibility setting |
| **Block instance id** | contracts | The id of one attempt at one step in one run, `requestId:path:attempt`. A retry gets the next attempt number; a resumed request rebuilds the same id for the same attempt. | The request id and the step's path |
| **Block** | core | A typed unit of work with an input schema and an output schema. You define it, and the framework runs it. See [Blocks](./fundamentals/blocks.md). | Zod schemas and a block context (`ctx`) |
| **Block kind** | core | Exactly five: `handler` (plain code), `generator` (a model call), `evaluator` (a model judgment), `sequencer` (runs blocks in order) and `router` (picks one block to run). | Block |
| **Sequencer** | core | A block that composes other blocks with `step`, `tap`, `sideChain`, `parallel`, `forEach`, `loopBack`, `rescue` and the rest. See [Composition](./sequencers/overview.md). | Blocks and connectors |
| **Connector** | core | A small function that reshapes a value between two composed blocks (`connectInput`, `connectOutput`, or the first argument to `step`). See [Connectors](./sequencers/connectors.md). | Block context |
| **Side chain** | core | A block a sequencer starts without waiting for it. Its items are marked as side-chain output. | Sequencer, block |
| **Tool** | core | A block listed in a generator's `tools`, so the model can call it. There is no separate tool type. | Block |
| **Dispatcher block** | core | `dispatcher()` builds a handler that sends its input to an entry on another flow. It is not a sixth kind. | Handler |
| **Model resolver** | core | Turns a model string such as `openai/gpt-5.4-mini` into a model a generator can call, with fallbacks. See [Models](./fundamentals/models.md). | Configuration |
| **Action** | core | A named entry point on a flow. It wraps one root block and adds an input schema, hooks, a token budget and durability settings. See [Actions](./fundamentals/actions.md). | One block |
| **Scope** | core | Where state lives and how long it lasts. There are four: `request`, `session`, `user` and `org`. See [State and scopes](./fundamentals/state-and-scopes.md). | None |
| **State** | core | Zod-typed data on a scope, or on one block (`ctx.self`). | Scope |
| **Session** | core | The scope that lasts as long as one conversation: its state, its history, its items. You open one against a flow instance. | Scope, flow instance |
| **Resource** | core | Named, typed data, with optional content, kept at `session`, `user` or `org` scope. See [Resources](./resources/overview.md). | Scope, state |
| **Resource collection** | core | A family of resources keyed by a pattern such as `files/*`, with `get`, `list`, `create`, `upsert` and `delete`. See [Collections](./resources/collections.md). | Resource |
| **Capability** | core | A bundle of resources, state schemas, prompt context, tools and helper functions a block or flow pulls in with `uses`. See [Capabilities](./fundamentals/capabilities.md). | Resources, state, tools, other capabilities |
| **Flow** | core | `defineFlow` with a `kind`. It declares actions, scope state, resources, capabilities, authentication and schedules. See [Flows](./fundamentals/flows.md). | Actions, scopes, resources, capabilities |
| **Flow instance** | core | A flow called with an id and settings: `myFlow({ id, config })`. Its id is its address. A `singleton` flow defaults the id to its kind; a `collection` flow needs one per instance. | Flow |
| **Harness block** | core | The shape every coding-agent block shares: it takes a prompt and returns a handle with an outcome, a final message, usage and cost. Claude Code, Codex and Cursor each ship one. See [Coding agents](./tools/coding-agents.md). | Block |
| **Suspension** | core | A run that stops to wait for a person's approval or answer, then resumes where it stopped. | Item, session |
| **Principal** | core | The verified caller of a request: a `userId` and an `orgId`. If you don't configure `resolvePrincipal`, every request runs in a built-in development organization. See [Authentication](./server/authentication.md). | None |

### Engine

`@flow-state-dev/engine` runs flows. Store adapters (`store-sqlite`, `store-postgres`) and host adapters (`node`, `next`, `vercel`) plug into it.

| Term | Package | What it is | Built from |
|---|---|---|---|
| **FlowState** | engine | What `createFlowState` returns: the server, holding your flow instances, stores and principal resolver. It serves the HTTP routes. See [Server setup](./server/setup.md). | Flow instances, stores |
| **Flow registry** | engine | The instances a FlowState answers for, each at its id. Two instances can't share an id. | Flow instance |
| **Request** | engine | One run of one action on one session. It streams items and can be resumed from where a client left off. See [Streaming](./streaming/overview.md). | Action, session, items |
| **Stores** | engine | Where sessions, requests, user and org state, resources, checkpoints and traces are kept. In-memory by default, SQLite or Postgres to persist. See [Persistence](./persistence/overview.md). | None |
| **Host adapter** | node, next, vercel | Serves a FlowState from one kind of host. See [Host adapters](./server/host-adapters.md). | FlowState |
| **Durable action** | core, engine | An action that writes a checkpoint at each step, so a crashed run resumes from its last one. See [Durable execution](./advanced/durable-execution.md). | Action, block instance id, stores |
| **Scheduled action** | core, scheduled | An action that runs on a cron schedule. See [Scheduled actions](./server/scheduled.md). | Action |

## Orchestration: a task board

![A task is a row with a goal, a status and an optional assignee. Tasks live in a task collection, kept either in state or in a resource collection. A task board is a sequencer that drains the collection: a dispatcher picks the next ready task, the assignee routes it to a board worker, and a board worker is any block. Built on the board: the goal-seek loop wraps a drain with a judge, the harness manager is a board worker that runs a coding agent, a skill agent becomes a generator board worker, and four patterns use a board.](./glossary/orchestration.svg)

| Term | Package | What it is | Built from |
|---|---|---|---|
| **Task** | orchestration | One unit of work: a goal, a status (`pending`, `in_progress`, `blocked`, `parked`, `completed`, `errored` or `cancelled`), dependencies, an optional assignee, input and output. See [Task substrate](./orchestration/task-substrate.md). | None |
| **Task collection** | orchestration | Where tasks are kept, with one API (add, claim, complete, fail, park) whichever store backs it. | State, or a resource collection |
| **Task board** | orchestration | `taskBoard()`: drains a task collection with a pool of workers, holding back tasks whose dependencies aren't done. See [Task board](./orchestration/task-board.md). | Sequencer, task collection, capability |
| **Board worker** | orchestration | A block that runs one claimed task. | Block |
| **Assignee** | orchestration | A task's routing key into the board's workers. A task with no matching worker goes to the default worker, or fails. | None |
| **Dispatcher** | orchestration | The rule that picks the next ready task. By name: `topological` (the default), `fifo` or `priority`. You can also pass in a classifier or event dispatcher. | Task collection |
| **Goal-seek loop** | orchestration | Drains a board, asks a judge whether the goal is met, replans, and drains again. See [Goal-seek loop](./orchestration/goal-seek-loop.md). | Task board, sequencer |
| **Flow policy** | orchestration | Which earlier tasks' results a worker sees. See [Flow policy](./orchestration/flow-policy.md). | Capability |
| **Skill** | orchestration | A `SKILL.md` folder, stored as a resource and loaded into a generator when needed. See [Skills](./skills/overview.md). | Resource collection, capability, tools |
| **Skill agent** | orchestration | An entry in a skill's `agents:` map. It becomes a generator that works tasks on a board. See [Agents](./orchestration/agents.md). | Generator, board worker |
| **Harness manager** | harness-manager | A board worker that turns one task into one supervised coding run in its own checkout, and checks the run's result before marking the task completed or errored. A run that asks a question parks its task until someone answers. See [Harness manager](./orchestration/harness-manager.md). | Board worker, sequencer, harness block, resource collection |
| **Pattern** | patterns | A function that returns a composed block for a common shape. `supervisor`, `planAndExecute`, `parallelTasks` and `eventActors` run a task board; `debate`, `roundRobin` and `responseAuditor` don't. See [Patterns](./patterns/overview.md). | Sequencer, generators, sometimes a task board |

### Smaller packages

These sit beside Orchestration on Core and don't use a task board.

| Term | Package | What it is | Built from |
|---|---|---|---|
| **Memory tier** | memory | `working` (one session), `episodic`, `semantic` and `digest`. Each tier is one resource. See [Memory](./memory/overview.md). | Resource, capability |
| **Place** | workspace | Wherever an agent actually works, such as a folder on the host or in memory. Files sync between a place and resources. See [Workspace](./tools/workspace.md). | Resource collection |

## Workforce: workers, mailboxes, projects

![Each Workforce term beside what it is made of. A worker, from WORKER.md, is a flow instance of a kind, the built-in agent kind unless it names another, with the address team.name. A hired roster row is a row of an org resource collection. A mailbox, from MAILBOX.md, is a session on the one mailbox flow; its members are worker ids and its transcript is the post items. A mailbox board is a task collection the mailbox holds but doesn't drain. The inventory is three org resource collections. A project is one row of the org projects collection, its room is more rows in an org collection, and each person reaches the room through their own session on the mailbox flow. A workstream is a declared mailbox together with the boards it holds.](./glossary/workforce.svg)

| Term | Package | What it is | Built from |
|---|---|---|---|
| **Worker** | workforce | One worker record, usually from a `WORKER.md` and sometimes built in code, hired into a flow instance with its own address. You open sessions against it like any flow. See [Workers on disk](./workforce/workers-on-disk.md). | Flow instance |
| **Address** | workforce | A worker's id: `team.name` for a team worker, the bare name for an org worker. A worker hired while the app runs is addressed `<org>.<name>`, or `<org>.~<user>.<name>` when one person owns it. | None |
| **Team** | workforce | A folder of workers under `teams/<name>/`, with an optional `TEAM.md` whose body every worker on the team reads. A team is not a flow and has no address. | Workers |
| **Org worker** | workforce | A worker under `org/workers/<name>/`. It belongs to no team. | Worker |
| **Built-in worker** | workforce | The `agent` kind every worker runs on unless its file names another `flow:`. See [The built-in worker](./workforce/built-in-worker.md). | Flow (collection), generator, skills |
| **Hire** | workforce | `hireWorkforce` turns each worker record into a flow instance. Your app registers what comes back. | Flow instance |
| **Roster** | workforce | The workers you hire. The ones hired while the app runs are kept as rows, so they come back after a restart. See [Hiring while the app runs](./workforce/durable-hire.md). | Org resource collection |
| **Fire** | workforce | Removes a worker hired while the app runs. A worker declared in a file leaves when its folder is deleted. | Roster row, inventory row |
| **Mailbox** | workforce | One `MAILBOX.md`: a named session on the shared `mailbox` flow, with members, a charter and a transcript. See [Mailboxes](./workforce/mailboxes.md). | Session, flow |
| **Member** | workforce | A worker id on a mailbox's member list. A post wakes each member whose flow kind handles posts, or only the chosen one on a routed mailbox. | Worker address |
| **Transcript** | workforce | The posts in a mailbox, rebuilt from the post items. | Items |
| **Routed mailbox** | workforce | A mailbox that hands each post to one member, picked by a model call over the members' descriptions, or a fallback. | Mailbox, evaluator |
| **Mailbox board** | workforce | A task collection a mailbox holds. The mailbox doesn't run a board over it. A worker whose flow runs a task board drains it, and that board's own board workers do the tasks. | Task collection |
| **Inventory** | workforce | Org-wide records of every worker and mailbox registered, and who is a member where. See [Inventory](./workforce/inventory.md). | Three org resource collections |
| **Project** | workforce | A row for a piece of work: title, brief, owner, member people, and the workstreams it groups. See [Projects](./workforce/projects.md). | One row of an org resource collection |
| **Room** | workforce | A project's one shared conversation. Its messages are stored at org scope, and each member person reads and posts through their own session on the mailbox flow. | Resource collection rows, sessions |
| **Workstream** | workforce | A declared mailbox, named by its full id, together with the boards it holds. A project lists the workstreams it groups, and each belongs to at most one project. | Mailbox, mailbox boards |
| **Chief of staff** | workforce | An org worker named `chief-of-staff` that a person asks who works here and asks to hire or fire. A fire waits for that person's approval. See [The chief of staff](./workforce/chief-of-staff.md). | Org worker, the hire tools |
| **Package** | workforce | A `PACKAGE.md` folder of instructions and tools a worker can hold. See [Packages on disk](./workforce/packages-on-disk.md). | Tools, instructions |

## Shift Manager: screens over a Workforce

![Each Shift Manager screen beside what it reads. A Lab is a FlowState loaded from one fsdev config. The Shift Coordinator is a person's session with the Lab's chief of staff worker. Inbox lists asks, which are suspended runs in workers' sessions waiting on a person. Tasks lists tasks on every mailbox board. Roster lists the workers in the inventory, with on shift, on call and off shift worked out from their tasks and asks. A workstream view shows a mailbox and its boards. A project view shows a project row and its room.](./glossary/shift-manager.svg)

[Shift Manager](./shift-manager/overview.md) is a browser app in this repository, not a published package. It stores nothing of its own: every screen is a read of the Lab it serves.

| Term | Where | What it is | Built from |
|---|---|---|---|
| **Lab** | Shift Manager | The server one `fsdev.config.mts` default-exports, which Shift Manager serves and reads. | FlowState |
| **Team profile** | Shift Manager | A Lab config kept beside Shift Manager in this repository, which its `start` and `dev` scripts open. `devteam` is the one there. It isn't in the published package. | Lab |
| **Shift Coordinator** | Shift Manager | The home screen: a summary of what is waiting and running, then your conversation with the Lab's chief of staff. | Chief of staff, session |
| **Ask** | Shift Manager | An approval or a question a worker's run is suspended on, waiting for a person. | Suspension |
| **Inbox** | Shift Manager | The pending asks in sessions you started and the runs they started, oldest first. Asks in another member's sessions aren't listed. Inbox is not a mailbox. | Asks |
| **Tasks** | Shift Manager | Every task not done, on every mailbox board, grouped by state, worker or workstream. | Task, mailbox board |
| **Roster** | Shift Manager | Every worker, grouped as on shift (running a task), on call (a parked task or a pending ask) or off shift. The grouping is worked out on each read, not stored. | Inventory, tasks, asks |
| **Staff** | Shift Manager | The group that lists org workers, the ones on no team. | Org worker |

## Words that mean two things

A few words are used in two places. The package tells you which one you're reading.

- **Worker.** In Workforce, a hired `WORKER.md`. On a task board, the block that runs a task. A task's assignee names a board worker, or, on a board that asks Workforce's worker lookup, any Workforce worker. See [Giving a task to a worker](./workforce/overview.md#giving-a-task-to-a-worker).
- **Member.** On a mailbox, a worker id. On a project, a person.
- **Dispatcher.** Core's `dispatcher()` is a block that sends to another flow. A task board's dispatcher is the rule that picks the next task.
- **Roster.** The Workforce roster is who is hired. Shift Manager's Roster is a screen over the inventory.
- **Inbox.** Shift Manager's list of asks. A mailbox is something else.
