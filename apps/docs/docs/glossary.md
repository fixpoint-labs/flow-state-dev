---
title: Glossary
description: "The main terms in flow-state.dev, the package each comes from, and the lower pieces each is built from."
---

import Figure from "@site/src/components/Figure";
import LayersDrawing from "./glossary/layers.svg";
import CoreDrawing from "./glossary/core.svg";
import OrchestrationDrawing from "./glossary/orchestration.svg";
import WorkforceDrawing from "./glossary/workforce.svg";
import ShiftManagerDrawing from "./glossary/shift-manager.svg";

# Glossary

flow-state.dev is built in layers. A small set of primitives in Core (blocks, flows, sessions, resources) carries everything above it. Orchestration builds task boards out of those primitives, Workforce builds workers, coordinators and projects out of flows, sessions and resources, and Shift Manager is an app that reads what Workforce writes.

Most terms higher up are a lower term with a name and a rule added. A worker is a resource one user owns, naming the flow that runs it. A coordinator is a worker. A project is one row of a resource collection. The Built from column tells you where each term's data lives.

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
| **Item** | contracts | One typed record a request streams: a message, reasoning, a tool output, a component, a status, an error, a state or resource change, a suspension, and a few more. See [Items](./streaming/items.md). | Content and a visibility setting |
| **Block instance id** | contracts | The id of one attempt at one step in one run, `requestId:path:attempt`. A retry gets the next attempt number; a resumed request rebuilds the same id for the same attempt. | The request id and the step's path |
| **Block** | core | A typed unit of work with an input schema and an output schema. You define it, and the framework runs it. See [Blocks](./fundamentals/blocks.md). | Zod schemas and a block context (`ctx`) |
| **Block kind** | core | Exactly five: `handler` (plain code), `generator` (a model call), `evaluator` (a model judgment), `sequencer` (runs blocks in order) and `router` (picks one block to run). | Block |
| **Sequencer** | core | A block that composes other blocks with `step`, `tap`, `sideChain`, `parallel`, `forEach`, `loopBack`, `rescue` and the rest. See [Composition](./sequencers/overview.md). | Blocks and connectors |
| **Connector** | core | A small function that reshapes a value between two composed blocks (`connectInput`, `connectOutput`, or the first argument to `step`). See [Connectors](./sequencers/connectors.md). | Block context |
| **Side chain** | core | A block a sequencer starts without waiting for it. Its items are marked as side-chain output. | Sequencer, block |
| **Tool** | core | A block listed in a generator's `tools`, so the model can call it. There is no separate tool type. | Block |
| **Dispatcher block** | core | `dispatcher()` builds a handler that sends its input to an entry on another flow. It is not a sixth kind. | Handler |
| **Model resolver** | core | Turns a model string such as `openai/gpt-6-luna` into a model a generator can call, with fallbacks. See [Models](./fundamentals/models.md). | Configuration |
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
| **User** | core | A person, signed in, always inside one org. Every action is taken by one user. The framework has no system users: an app can make one, and to the framework it is just another user. | Principal |

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

<Figure svg={OrchestrationDrawing} caption="Orchestration: what a task board is made of" description={"A task is a row with a goal, a status and an optional assignee. Tasks live in a task collection, kept either in state or in a resource collection. A task board is a sequencer that drains the collection: a claim order picks the next ready task, the assignee routes it to a board worker, and a board worker is any block. Built on the board: the goal-seek loop wraps a drain with a judge, the harness manager is a board worker that runs a coding agent, and four patterns use a board."} />

| Term | Package | What it is | Built from |
|---|---|---|---|
| **Task** | orchestration | One unit of work: a goal, a status (`pending`, `in_progress`, `held`, `completed`, `errored` or `cancelled`), dependencies, an optional assignee, input and output. See [Task substrate](./orchestration/task-substrate.md). | None |
| **Task collection** | orchestration | Where tasks are kept, with one API (`createTask`, `claim`, `complete`, `fail`, `hold`, `ask`) whichever store backs it. | State, or a resource collection |
| **Task board** | orchestration | `taskBoard()`: drains a task collection with a pool of workers, holding back tasks whose dependencies aren't done. See [Task board](./orchestration/task-board.md). | Sequencer, task collection, capability |
| **Task tools** | orchestration | What a model changes a task with: the filer's `createTask`, `getTask`, `listTasks` and `updateTask`, and the worker's `reportProgress`. Each `updateTask` field has one rule: edits before the task starts, a cancel until it finishes. See [One task, five tools](./orchestration/task-board.md#one-task-five-tools). | Task, task board |
| **Board worker** | orchestration | A block that runs one claimed task. | Block |
| **Assignee** | orchestration | Who a task goes to: an entry in a task board's workers, or a name the board's assignee check accepts, such as one of a Workforce worker's delegates. A task's `assignee` names it, and it runs the task inline or dispatches it to a dispatch run in another session. A task whose assignee names no entry goes to the default assignee, or fails. See [Task board](./orchestration/task-board.md). | Board worker, task |
| **Claim order** | orchestration | The rule that picks the next ready task. By name: `topological` (the default), `fifo` or `priority`. You can also pass your own `ClaimOrder`. | Task collection |
| **Dispatch a task** | orchestration | Start a task on another worker now. How a recorded task starts depends on the board. On a conversation's board, `createTask` starts a task as soon as it is filed, and a task filed `held` doesn't start until `updateTask` releases it. On a board a drain runs, recording is enough: the drain starts each task when it claims it, and dispatches it when its assignee holds a `dispatcher()`. | Task, wait, dispatcher block |
| **Wait** | orchestration | What a caller does on a task it filed, or a request it dispatched, when its next step needs the result: `getTask({ id, wait: true })`, or `dispatcher({ wait: true })`. Its turn pauses until the work ends, or until the deadline, when it carries on with the work as it stands; the deadline cancels nothing. Nothing holds a request open while it lasts, and waits nest up to five deep. A board's `onIdle: "wait"` is a different setting: the board stays alive when it has nothing to do. | Dispatch a task |
| **Hand-off** | orchestration | A session that was doing the work passes it to another session, mid-work. Giving another worker new work isn't a hand-off; it's dispatching a task. | Dispatch a task |
| **Goal-seek loop** | orchestration | Drains a board, asks a judge whether the goal is met, replans, and drains again. See [Goal-seek loop](./orchestration/goal-seek-loop.md). | Task board, sequencer |
| **Flow policy** | orchestration | Which earlier tasks' results a worker sees. See [Flow policy](./orchestration/flow-policy.md). | Capability |
| **Skill** | orchestration | A `SKILL.md` folder, stored as a resource and loaded into a generator when needed. See [Skills](./skills/overview.md). | Resource collection, capability, tools |
| **Harness manager** | harness-manager | A board worker that turns one task into one supervised coding run in its own checkout, and checks the run's result before marking the task completed or errored. A run that asks a question has its task wait until someone answers. See [Harness manager](./orchestration/harness-manager.md). | Board worker, sequencer, harness block, resource collection |
| **Pattern** | patterns | A function that returns a composed block for a common shape. `supervisor`, `planAndExecute`, `parallelTasks` and `eventActors` run a task board; `debate`, `roundRobin` and `responseAuditor` don't. See [Patterns](./patterns/overview.md). | Sequencer, generators, sometimes a task board |

### Smaller packages

These sit beside Orchestration on Core and don't use a task board.

| Term | Package | What it is | Built from |
|---|---|---|---|
| **Memory tier** | memory | `working` (one session), `episodic`, `semantic` and `digest`. Each tier is one resource. See [Memory](./memory/overview.md). | Resource, capability |
| **Place** | workspace | Wherever an agent actually works, such as a folder on the host or in memory. Files sync between a place and resources. See [Workspace](./tools/workspace.md). | Resource collection |

## Workforce: workers, coordinators, projects

<Figure svg={WorkforceDrawing} caption="Workforce: what each term is made of" description={"Each Workforce term beside what it is made of. A worker is a resource in one user's scope that names its worker flow. A standard worker is read from the installation's files, the same for every user. A roster is one user's workers. A coordinator is a worker on the coordinator flow, with delegates from the same roster in its session. A project is one row, in the user's scope or the org's; a workstream is an entry in a shared project that only its owner writes, plus its lead's session. A project coordinator is one session per user per project."} />

| Term | Package | What it is | Built from |
|---|---|---|---|
| **Worker** | workforce | What you might call an agent: a configuration with an owner. It names the flow that runs it and carries its own instructions, skills and tools. A worker belongs to one user and acts as them. See [Workers on disk](./workforce/workers-on-disk.md). | A resource in the user's scope |
| **Worker flow** | workforce | The flow a worker runs on: the built-in `agent`, the coordinator, or a flow your app registers as a worker flow. Each is registered once, and every worker that names it shares that copy. See [The built-in worker](./workforce/built-in-worker.md). | Flow |
| **Standard worker** | workforce | A worker every user has, read from the installation's files and the same for everyone. Nobody can edit one. To change it for yourself, fork it. | Worker, the installation's files |
| **Fork** | workforce | Copies a standard worker into a worker of your own, starting from its configuration. | Worker |
| **Roster** | workforce | The workers one user has, standard ones included. See [Hiring and forking](./workforce/durable-hire.md). | Workers |
| **Address** | workforce | A worker's id: `team.name` for a team worker, the bare name for an org worker. A user's own worker is addressed by the id it was hired or forked under, on that user's roster. | None |
| **Team** | workforce | A folder of workers under `teams/<name>/`, with an optional `TEAM.md` whose body every worker on the team reads. A team is not a flow and has no address. | Workers |
| **Org worker** | workforce | A standard worker under `org/workers/<name>/`. It belongs to no team. | Standard worker |
| **Hire** | workforce | A user adds a worker of their own to their roster. `hireWorkforce` gives back one copy of each worker flow, which your app registers. | Worker |
| **Fire** | workforce | Removes one of a user's own workers from their roster. A standard worker leaves when its folder is deleted. | Worker |
| **Coordinator** | workforce | A worker that hands each message to other workers on the same roster, its delegates, as routed tasks. It picks by its own judgment, by best fit, in turn, or sends to everyone. See [Coordinators](./workforce/coordinators.md). | Worker, the coordinator flow |
| **Delegate** | workforce | A worker a conversation may delegate to, and the only workers it can give work to. A worker's file lists its delegates under `delegates:`, or `delegates: all` for the whole roster as it stands, and each conversation starts from that list. Always on the same user's roster; each works in its own session. | Worker |
| **Delegation** | workforce | Handing work to one of your delegates: giving work to a worker on your roster, checked against your roster. A coordinator delegates a message as a routed task; any worker with a delegate delegates a task. See [Delegating work](./workforce/delegating-work.md). | Dispatch a task, roster |
| **Door** | workforce | `respond`, the one public action that takes a message to a worker, on every worker flow. | Action |
| **Role** | workforce | What a worker flow does beside taking a message: `contributor` takes tasks on `work`, `manager` files tasks for its delegates and runs its board on `dispatch`, `coordinator` routes messages. A flow declares its roles when it is registered, and the hire refuses a role whose entries are missing. See [A worker flow's roles](./workforce/workers-on-disk.md#a-worker-flows-roles). | Worker flow, entry |
| **Inventory** | workforce | Org-wide records of every standard worker registered in an organization. See [Inventory](./workforce/inventory.md). | An org resource collection |
| **Project** | workforce | A body of work, private to you or shared with your org. See [Projects](./workforce/projects.md). | One row, in user or org scope |
| **Workstream** | workforce | One area of a shared project, with one owner. Its entry is read by the org and written only by its owner; its lead works it in a workstream session. | A resource row, a session |
| **Project coordinator** | workforce | Your coordinator for one project: one session per user per project. It reads every workstream's entry and hands work only to your own. | Coordinator, session |
| **Shift Coordinator** | workforce | The standard coordinator a user asks who works here, and asks to hire or fire. See [The Shift Coordinator](./workforce/shift-coordinator.md). | Standard worker, coordinator |
| **Package** | workforce | A `PACKAGE.md` folder of instructions and tools a worker can hold. See [Packages on disk](./workforce/packages-on-disk.md). | Tools, instructions |

## Shift Manager: screens over a Workforce

<Figure svg={ShiftManagerDrawing} caption="Shift Manager: what each screen reads" description={"Each Shift Manager screen beside what it reads. A Lab is a FlowState loaded from one fsdev config. The Shift Coordinator screen is a user's session with the Lab's Shift Coordinator worker. Inbox lists asks, which are suspended runs in workers' sessions waiting on a user. Tasks lists the tasks on your boards. Roster lists your workers, with on shift and off shift worked out from their tasks and asks. A project view shows a project, its workstreams with their progress, your own workstreams' boards, and your own project coordinator."} />

[Shift Manager](./shift-manager/overview.md) is a browser app, published as `@flow-state-dev/shift-manager`. It stores nothing of its own: every screen is a read of the Lab it serves.

| Term | Where | What it is | Built from |
|---|---|---|---|
| **Lab** | Shift Manager | The server one `fsdev.config.mts` default-exports, which Shift Manager serves and reads. | FlowState |
| **Team profile** | Shift Manager | A Lab config kept beside Shift Manager in this repository, which its `start` and `dev` scripts open. `devteam` is the one there. It isn't in the published package. | Lab |
| **Shift Coordinator** | Shift Manager | The home screen: a summary of what is waiting and running, then your conversation with your Shift Coordinator worker. | Shift Coordinator worker, session |
| **Ask** | Shift Manager | An approval or a question a worker's run is suspended on, waiting for a user. | Suspension |
| **Inbox** | Shift Manager | Everything a worker waits on you for, oldest first: the pending asks in sessions you started and the runs they started, and the questions a task waits on, one item per task. See [Building an Inbox](./orchestration/task-board.md#building-an-inbox). | Asks, task questions |
| **Tasks** | Shift Manager | Every task not done on your boards, grouped by state, worker or workstream. | Task, board |
| **Roster** | Shift Manager | Your workers, grouped as on shift (running a task, or waiting on you with a task waiting on questions or a pending ask) or off shift. Worked out on each read, not stored. | Roster, tasks, asks |
| **General** | Shift Manager | The group that lists org workers, the ones on no team. | Org worker |

## Words that mean two things

A few words are used in two places. The package tells you which one you're reading.

- **Worker.** In Workforce, a configuration one user owns. On a task board, a board worker: the block that runs a task. A task's assignee names a board worker, or, on a board that asks Workforce's worker lookup, one of your workers.
- **Kind.** A flow's `kind` is its name to the engine. Workforce calls the flow a worker runs on its worker flow.
- **Roster.** Your Workforce roster is your workers. Shift Manager's Roster screen shows them by what they are doing.
