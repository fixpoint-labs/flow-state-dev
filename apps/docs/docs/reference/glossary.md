---
title: Glossary
type: reference
description: "The main terms in flow-state.dev, the package each comes from, and the lower pieces each is built from."
---

import Figure from "@site/src/components/Figure";
import LayersDrawing from "./figures/glossary-layers.svg";
import CoreDrawing from "./figures/glossary-core.svg";
import OrchestrationDrawing from "./figures/glossary-orchestration.svg";
import WorkforceDrawing from "./figures/glossary-workforce.svg";
import ShiftManagerDrawing from "./figures/glossary-shift-manager.svg";

# Glossary

flow-state.dev is built in layers. A small set of primitives in Core (blocks, flows, sessions, resources) carries everything above it. Orchestration builds task boards out of those primitives, Workforce builds workers, coordinators and projects out of flows, sessions and resources, and Shift Manager is an app that reads what Workforce writes.

Most terms higher up are a lower term with a name and a rule added. A worker is a resource one user owns, naming the flow that runs it. A coordinator is a worker. A project is one resource in a resource collection. The Built from column names the lower terms each one is made of.

Most terms link to their full page.

## The layers

<Figure svg={LayersDrawing} caption="Each layer is built from the ones below it" description={"Five stacked layers. Contracts at the bottom holds the item types and block instance ids. Core above it holds blocks, flows, actions, scopes, resources and capabilities. The third layer holds Engine, which runs flows and stores what they write, Client and React for the browser, Orchestration, which builds tasks and task boards, and the smaller packages Memory, Tools and Workspace. The fourth layer holds the hosts and stores built on Engine, Workforce built on Core and Orchestration, and Patterns and Harness manager. Shift Manager sits on top: an app that serves a Workforce through the Engine and reads it."} />

A package uses only the layers under it. Workforce imports Core and Orchestration and nothing from Engine: when it needs to register a flow or open a session, your app passes in the function that does it.

## Core and Engine: from a block to a running flow

<Figure svg={CoreDrawing} caption="Core: from a block to a running flow" description={"Core builds up in five steps. A block is a typed unit of work, in one of five kinds. A sequencer is a block that runs other blocks in order. An action wraps one root block under a name. A flow is a kind that declares its actions, scopes, resources and capabilities. A flow instance is the flow called with an id and settings. The Engine registers instances and opens sessions on them, and each request on a session runs one action and streams items. Beside the chain, a tool is a block a generator may call, a capability bundles resources, state and tools a block pulls in with uses, and a resource collection is a family of resources keyed by a pattern."} />

The top row builds left to right: each box is made of the one before it. The Engine row runs what the top row defines. A tool is an ordinary block, and so is a dispatcher.

### Contracts and Core

`@flow-state-dev/contracts` holds the shapes shared by the server and the browser. `@flow-state-dev/core` re-exports them and adds the builders.

| Term | Package | What it is | Built from |
|---|---|---|---|
| **Item** | contracts | One typed record a request streams: a message, reasoning, a tool output, a data item, a status, an error, a state or resource change, a suspension, and a few more. See [Items](./items.md). | Content and a visibility setting |
| **Block instance id** | contracts | The id of one attempt at one step in one run. See [Durable execution](./durable-execution.md). | The request id and the step's path |
| **Block** | core | A typed unit of work with an input schema and an output schema. You define it, and the framework runs it. See [Blocks](../concepts/blocks.md). | Zod schemas and a block context (`ctx`) |
| **Block kind** | core | Exactly five: `handler` (plain code), `generator` (a model call), `evaluator` (a model judgment), `sequencer` (runs blocks in order) and `router` (picks one block to run). | Block |
| **Sequencer** | core | A block that composes other blocks in order. See [Composition](../concepts/composition.md) and [Sequencer methods](./sequencer-methods.md). | Blocks and connectors |
| **Connector** | core | A small function that reshapes a value between two composed blocks. See [Sequencer methods](./sequencer-methods.md). | Block context |
| **Side chain** | core | A block a sequencer starts without waiting for it. See [Sequencer methods](./sequencer-methods.md). | Sequencer, block |
| **Tool** | core | A block listed in a generator's `tools`, so the model can call it. There is no separate tool type. | Block |
| **Dispatcher block** | core | `dispatcher()` builds a handler that sends its input to another flow. | Handler |
| **Model resolver** | core | Turns a model string such as `openai/gpt-6-luna` into a model a generator can call. See [Models](./models.md). | Configuration |
| **Action** | core | A named entry point on a flow. It wraps one root block. See [Flows and actions](../concepts/flows-and-actions.md). | One block |
| **Scope** | core | Where state lives and how long it lasts. There are four: `request`, `session`, `user` and `org`. See [State and scopes](../concepts/state-and-scopes.md). | None |
| **State** | core | Zod-typed data on a scope, or on one block (`ctx.self`). | Scope |
| **Session** | core | The scope that keeps many requests to one flow instance together as one record: its state, its history, its items. A chat conversation is one use of it. You open one against a flow instance. | Scope, flow instance |
| **Resource** | core | Named, typed data, with optional content, kept at `session`, `user` or `org` scope. See [Resources](../concepts/resources.md). | Scope, state |
| **Resource collection** | core | A family of resources keyed by a pattern such as `files/*`, with `get`, `list`, `create`, `upsert` and `delete`. See [Resources](./resources.md). | Resource |
| **Capability** | core | A bundle of resources, state schemas, prompt context, tools and helper functions a block or flow pulls in with `uses`. See [Capabilities](../concepts/capabilities.md). | Resources, state, tools, other capabilities |
| **Flow** | core | `defineFlow` with a `kind`. It declares actions, scope state, resources, capabilities, authentication and schedules. See [Flows and actions](../concepts/flows-and-actions.md). | Actions, scopes, resources, capabilities |
| **Flow instance** | core | A flow called with an id and settings: `myFlow({ id, config })`. Its id is its address. See [Flows](./flows.md). | Flow |
| **Kit** | core | The unit an app installs, made with `defineKit`. A flow is what the server runs; a kit packages flows for an app to install, and its `install` returns them. You pass kits to `createFlowState({ kits: [...] })` in any order: `workforce({ model })` and `harnesses({})` are both kits. A kit has no browser half. See [Kits and slots](../concepts/kits-and-slots.md). | Flows, slots |
| **Slot** | core | A typed place a kit declares for other kits to fill. A keyed slot (`slot.keyed(schema)`) holds entries by key: if two kits give the same key, the app refuses to start and the error names both. A list slot (`slot.list(schema)`) appends every contribution in install order. An app drops a kit's contribution with `kit.without(slot)`, or one keyed entry with `kit.without(slot, key)`. See [Kits](./kits.md). | Kit, a Zod schema |
| **Harness block** | core | The shape every coding-agent block shares: it takes a prompt and returns a handle with an outcome, a final message, usage and cost. Claude Code, Codex and Cursor each ship one. See [Coding harnesses](../concepts/coding-harnesses.md). | Block |
| **Suspension** | core | A run that stops to wait for a user's approval or answer, then resumes where it stopped. | Item, session |
| **Principal** | core | The verified caller of a request: a `userId` and an `orgId`. See [Authentication](./authentication.md). | None |
| **User** | core | The signed-in human making a request, always inside one org. Every action is taken by one user. The framework has no system users: an app can make one, and to the framework it is another user. | Principal |

### Engine

`@flow-state-dev/engine` runs flows. Store adapters (`store-sqlite`, `store-postgres`) and host adapters (`node`, `next`, `vercel`) plug into it.

| Term | Package | What it is | Built from |
|---|---|---|---|
| **FlowState** | engine | What `createFlowState` returns: the server, holding your flow instances, stores and principal resolver. It serves the HTTP routes. See [Serving flows](../concepts/serving-flows.md). | Flow instances, stores |
| **Flow registry** | engine | The instances a FlowState answers for, each at its id. See [Runtime](./runtime.md). | Flow instance |
| **Request** | engine | One run of one action on one session. See [Sessions, items and streaming](../concepts/sessions-items-and-streaming.md) and [Items](./items.md). | Action, session, items |
| **Stores** | engine | Where sessions, requests, state, resources, checkpoints and traces are kept. See [Stores](./stores.md). | None |
| **Host adapter** | node, next, vercel | Serves a FlowState from one kind of host. See [Serving flows](../concepts/serving-flows.md). | FlowState |
| **Durable action** | core, engine | An action that writes a checkpoint at each step, so a crashed run can resume. See [Durable execution](./durable-execution.md). | Action, block instance id, stores |
| **Scheduled action** | core, scheduled | An action that runs on a cron schedule. See [Schedules](./schedules.md). | Action |

## Orchestration: a task board

<Figure svg={OrchestrationDrawing} caption="Orchestration: what a task board is made of" description={"A task is a row with a goal, a status and an optional assignee. Tasks live in a task collection, kept either in state or in a resource collection. A task board is a sequencer that drains the collection: a claim order picks the next ready task, the assignee routes it to a board worker, and a board worker is any block. Built on the board: the goal-seek loop wraps a drain with a judge, the harness manager is a board worker that runs a coding agent, and four patterns use a board."} />

| Term | Package | What it is | Built from |
|---|---|---|---|
| **Task** | orchestration | One unit of work: a goal, a status, dependencies, an optional assignee, input and output. See [Task collections](./task-collections.md). | None |
| **Task collection** | orchestration | Where tasks are kept, whichever store backs them. See [Task collections](./task-collections.md). | State, or a resource collection |
| **Task board** | orchestration | `taskBoard()`: drains a task collection with a pool of workers, holding back tasks whose dependencies aren't done. See [Task board](./task-board.md). | Sequencer, task collection, capability |
| **Task tools** | orchestration | What a model changes a task with: the filer's `createTask`, `getTask`, `listTasks` and `updateTask`, and the worker's `reportProgress`. See [Task board](./task-board.md). | Task, task board |
| **Board worker** | orchestration | A block that runs one claimed task. | Block |
| **Assignee** | orchestration | Who a task goes to: one of a task board's workers, or, in Workforce, one of a worker's delegates. See [Task board](./task-board.md). | Board worker, task |
| **Claim order** | orchestration | The rule that picks the next ready task, such as `fifo` or `priority`. See [Task board](./task-board.md). | Task collection |
| **Dispatch a task** | orchestration | Start a task on another worker. See [Task board](./task-board.md). | Task, wait, dispatcher block |
| **Wait** | orchestration | What a caller does on a task it filed, or a request it dispatched, when its next step needs the result, with `getTask({ id, wait: true })` or `dispatcher({ wait: true })`. Its turn pauses until the work ends or a deadline passes. The deadline cancels nothing: the task keeps running, and the turn goes on without its result. A board's `onIdle: "wait"` is a different setting. See [Background work](./background-work.md). | Dispatch a task |
| **Hand-off** | orchestration | A session that was doing the work passes it to another session, mid-work. Giving another worker new work isn't a hand-off; it's dispatching a task. | Dispatch a task |
| **Goal-seek loop** | orchestration | Drains a board, asks a judge whether the goal is met, replans, and drains again. See [Goal-seek loop](../catalog/patterns/goal-seek-loop.md). | Task board, sequencer |
| **Flow policy** | orchestration | Which earlier tasks' results a worker sees. See [Task collections](./task-collections.md). | Capability |
| **Skill** | orchestration | A `SKILL.md` folder a generator loads when needed. See [Skills](../catalog/skills.md). | Resource collection, capability, tools |
| **Harness manager** | harness-manager | A board worker that turns one task into one supervised coding run in its own checkout. See [Harness runs](./harness-runs.md). | Board worker, sequencer, harness block, resource collection |
| **Pattern** | patterns | A function that returns a composed block for a common shape. See [Patterns](./patterns.md). | Sequencer, generators, sometimes a task board |

### Smaller packages

The `memory`, `tools` and `workspace` packages sit beside Orchestration on Core and don't use a task board.

| Term | Package | What it is | Built from |
|---|---|---|---|
| **Memory tier** | memory | One of four layers of memory: `working`, `episodic`, `semantic` and `digest`. See [Memory](./memory.md). | Resource, capability |
| **`tools`** | tools | The package's ready-made tools for a generator's `tools`: `search`, `fetch`, `crawl` and `createBashTool`, plus an MCP capability from `@flow-state-dev/tools/mcp`. See [Tools](../catalog/tools/index.md). | Tool, capability |
| **Place** | workspace | Wherever an agent actually works, such as a folder on the host or in memory. Files sync between a place and resources. See [Workspace](../catalog/tools/workspace.md). | Resource collection |

## Workforce: workers, coordinators, projects

<Figure svg={WorkforceDrawing} caption="Workforce: what each term is made of" description={"Each Workforce term beside what it is made of. A worker is a resource in one user's scope that names its worker flow. A standard worker is read from the installation's files, the same for every user. A roster is one user's workers. A coordinator is a worker on the coordinator flow, with delegates from the same roster in its session. A project is one resource, in the user's scope or the org's; a workstream is an entry in a shared project that only its owner writes, plus its lead's session. A project coordinator is one session per user per project."} />

| Term | Package | What it is | Built from |
|---|---|---|---|
| **Worker** | workforce | What you might call an agent: a configuration with an owner. It names the flow that runs it and carries its own instructions, skills and tools. A worker belongs to one user and acts as them. See [Workers](../concepts/workers.md). | A resource in the user's scope |
| **Worker flow** | workforce | The flow a worker runs on. See [Workforce](./workforce.md). | Flow |
| **Standard worker** | workforce | A worker every user has, read from the installation's files and the same for everyone. Nothing in the app writes the file. When you edit one, your first edit copies it onto your own roster under the same id. You see your copy, and every other user keeps seeing the file's version. A reset deletes your copy. See [Workforce](./workforce.md). | Worker, the installation's files |
| **Fork** | workforce | Copies a standard worker, or one of your own, into a new worker of your own under a new id, starting from its configuration. The copy is on your roster only. | Worker |
| **Roster** | workforce | The workers one user has, standard ones included. See [Workforce](../catalog/workforce/index.md). | Workers |
| **Address** | workforce | A worker's id. See [WORKER.md](./worker-md.md). | None |
| **Team** | workforce | A group of workers kept in one folder. See [The workforce folder](./workforce-folder.md). | Workers |
| **Org worker** | workforce | A standard worker under `org/workers/<name>/`. It belongs to no team. | Standard worker |
| **Hire** | workforce | A user adds a worker of their own to their roster. See [Workforce](./workforce.md). | Worker |
| **Fire** | workforce | Removes one of a user's own workers from their roster. | Worker |
| **Coordinator** | workforce | A worker that hands each message to other workers on the same roster, its delegates, by turning each into a task for one of them. See [Coordinators](../catalog/workforce/coordinators.md) and [Workforce](./workforce.md). | Worker, the coordinator flow |
| **Delegate** | workforce | A worker on your roster that one of your workers may give work to. Each works in its own session. See [WORKER.md](./worker-md.md). | Worker |
| **Delegation** | workforce | Giving a task to one of your delegates. A coordinator turns each message into a task for one delegate; other workers with delegates file tasks for them. See [Delegating work](../catalog/workforce/delegating-work.md). | Dispatch a task, roster |
| **Door** | workforce | `respond`, the one public action that takes a message to a worker, on every worker flow. | Action |
| **Role** | workforce | What a worker flow does beside taking a message: `contributor` takes tasks, `manager` files tasks for its delegates and runs its board, `coordinator` routes messages. See [Workforce](./workforce.md). | Worker flow |
| **Inventory** | workforce | Org-wide records of every standard worker registered in an organization. See [Workforce](./workforce.md). | An org resource collection |
| **Project** | workforce | A body of work, private to you or shared with your org. See [Projects](../catalog/workforce/projects.md). | A resource in a user or org resource collection |
| **Workstream** | workforce | One area of a shared project, with one owner. See [Projects](../catalog/workforce/projects.md). | A resource, a session |
| **Project coordinator** | workforce | Your coordinator for one project. It reads every workstream and hands work only to your own. | Coordinator, session |
| **Shift Coordinator** | workforce | The standard coordinator a user asks who works here, and asks to hire or fire. See [Shift Manager](../catalog/starters/shift-manager.md). | Standard worker, coordinator |
| **Package** | workforce | A `PACKAGE.md` folder of instructions and tools a worker can hold. See [The workforce folder](./workforce-folder.md). | Tools, instructions |

## Shift Manager: screens over a Workforce

<Figure svg={ShiftManagerDrawing} caption="Shift Manager: what each screen reads" description={"Each Shift Manager screen beside what it reads. A Lab is a FlowState loaded from one fsdev config. The Shift Coordinator screen is a user's session with the Lab's Shift Coordinator worker. Inbox lists asks, which are suspended runs in workers' sessions waiting on a user. Tasks lists the tasks on your boards. Roster lists your workers, with on shift and off shift worked out from their tasks and asks. A project view shows a project, its workstreams with their progress, your own workstreams' boards, and your own project coordinator."} />

[Shift Manager](../catalog/starters/shift-manager.md) is a browser app, published as `@flow-state-dev/shift-manager`. It stores nothing of its own: every screen is a read of the Lab it serves.

| Term | Where | What it is | Built from |
|---|---|---|---|
| **Lab** | Shift Manager | The server one `fsdev.config.mts` default-exports, which Shift Manager serves and reads. | FlowState |
| **Shift Coordinator** | Shift Manager | The home screen: a summary of what is waiting and running, then your conversation with your Shift Coordinator worker. | Shift Coordinator worker, session |
| **Ask** | Shift Manager | An approval or a question a worker's run is suspended on, waiting for a user. | Suspension |
| **Inbox** | Shift Manager | Everything a worker waits on you for, oldest first. It lists pending asks from your sessions and from the runs they started, and one item for each task waiting on questions. See [Building an Inbox](./task-board.md). | Asks, tasks waiting on questions |
| **Tasks** | Shift Manager | Every task not done on your boards, grouped by state, worker or workstream. | Task, board |
| **Roster** | Shift Manager | Your workers, grouped as on shift or off shift. A worker is on shift while it runs a task or waits on you: a pending ask, or a task waiting on your answer to a question. | Roster, tasks, asks |
| **General** | Shift Manager | The group that lists org workers, the ones on no team. | Org worker |

## Words that mean two things

A few words are used in two places. The package tells you which one you're reading.

- **Worker.** In Workforce, a configuration one user owns. On a task board, a board worker: the block that runs a task. A task's assignee names a board worker or, in Workforce, one of the filing worker's delegates.
- **Kind.** A block kind is one of the five (`handler`, `generator`, `evaluator`, `sequencer`, `router`). A flow's `kind` is its name to the engine.
- **Shift Coordinator.** In Workforce, the standard coordinator worker. In Shift Manager, the home screen where you talk to it.
- **Package.** The Package column names the npm package a term comes from. In Workforce, a package is a `PACKAGE.md` folder a worker can hold.
- **Roster.** Your Workforce roster is your workers. Shift Manager's Roster screen shows them by what they are doing.
