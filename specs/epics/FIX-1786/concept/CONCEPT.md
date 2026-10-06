<!-- Source: the Linear document "Workforce: How It Should Work (concept doc)" attached to FIX-1786,
     https://linear.app/fixpoint-labs/document/workforce-how-it-should-work-concept-doc-167e8bbc8b1b ,
     fetched 2026-10-06 (updated 2026-10-06T01:12Z). Text verbatim except where review amended it: on
     2026-10-06 Jake asked that it say plainly that each worker names its own flow (the roster, Workers,
     Worker flows, the Flow and Worker terms, and the gap table's flow rows). Its six snapshot images are
     redrawn as SVGs in ../figures/concept-*.svg. This copy is canonical now; edit it, not the source. -->

# Workforce: How It Should Work

> **Where this differs from the epic, the epic binds.** This is the PRD as Jake wrote it; the
> epic's [decisions](../DECISIONS.md) and [rules](../BUSINESS-RULES.md) settle what it leaves
> open. One coordinator flow with a routing setting ([D2](../DECISIONS.md#d2)). Where an author
> declares a worker flow is [Q1](../DECISIONS.md#q1): a list the installation keeps, chosen at FIX-1789's spec gate on a POC of both. "Keeps a worker's state private" covers a worker's own state and user-scoped data; org scope is shared with the org by design, and the framework doesn't refuse a flow's writes there ([D3](../DECISIONS.md#d3)). A workstream is a project entry plus its
> lead's session; `MAILBOX.md` becomes `WORKER.md`; no transcript resource is built, so the
> `transcript:` key below isn't either ([decided in review](../DECISIONS.md#decided-in-review-recorded-so-no-child-reopens-them)).
> The boards are per [D5](../DECISIONS.md#d5) and [ER-9](../BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt). A worker's
> configuration is stored data a flow reads per run ([ER-2](../BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt)).
> The counts are 33 files and 15 boards today.

*Jake Hoffner · Oct 5, 2026. Diagrams are snapshots; the original, with live diagrams: [https://claude.ai/code/artifact/07d17e2a-089f-478d-8553-e6dcd8c5cc94](<https://claude.ai/code/artifact/07d17e2a-089f-478d-8553-e6dcd8c5cc94>)*

## Why this doc

The Workforce model we built is hard to hold in your head, even for the person who designed it. Explaining it better won't fix that, because the model itself is the problem.

This doc describes how Workforce should work, from first principles, in terms a new user could follow. Once we agree on it, we work backwards to the changes. The last section lists where today's code differs.

## Users, private and shared

**A user is always a person.** The framework doesn't own identity and has no system users. An app can create a "system user" of its own, and to the framework it's just another user.

**Everything is private to one user. The only shared things are shared resources.** Every session belongs to one user, and nobody else can open it. Something is shared only when it's written to a shared resource, such as a channel's conversation or a shared project.

The engine already works this way. What changes is that Workforce stops describing anything else as shared.

* **Private:** your workers, your private projects, every session.
* **Shared:** channels, shared projects and their workstream entries, org-level memory, and the worker library.
* **Workers are never shared.** Two users can each have a worker called "researcher" with the same configuration. They are still two different workers.

![Private and shared · one org, two users](../figures/concept-1-private-and-shared.svg)

Alice and Bob each have a researcher from the standard install, and they are two different workers. Alice's researcher answers in the channel as Alice. Bob copied a writer from the library onto his own roster.

## The parts, in the order you meet them

Each part uses only the ones above it.

1. **You.** A user, signed in, always inside one org.
2. **Your roster.** The workers you've added. They work only for you and act as you. Each one names the flow that runs it: the built-in agent, a coordinator that hands work to other workers, or a flow your app wrote.
3. **Your private projects.** Your own work, split into workstreams and tasks your workers pick up.
4. **Channels.** Shared conversations where users, and the workers acting for them, talk in the open. A later feature.
5. **Shared projects.** Shared work, split into workstreams. Each workstream has one owner, whose roster does it.

## Workers

**A worker is what might typically be referred to as an agent.** We call them workers because they might be a deterministic workflow, not a non-deterministically shaped flow which has its own true agency. A worker is backed up by a flow that controls how it runs, and is configured using a user-scoped resource. It names the flow that runs it and carries its own settings, such as instructions, tools and which memory it keeps. The resource belongs to one user.

**Each worker picks its flow, and each flow is a singleton.** An installation has many worker flows, and a worker's configuration names the one it runs on: `flow:` in its `WORKER.md`, or the same field on its resource. There is one registered copy of each flow, such as `agent` or the coordinator, and every worker that names it shares that copy. All of a flow's behavior lives there, including how it handles memory.

**A session is where a worker works.** Each session records which worker it belongs to and loads that worker's configuration when it runs. The server sets that link when the session is created, from a worker the user can read. A caller can never supply or change it.

![Workers, their flow and their sessions](../figures/concept-2-workers-flow-sessions.svg)

Alice's three workers are resources she owns. Her researcher and writer each name the `agent` flow and share its one copy; her launch coordinator names the coordinator flow. Bob's researcher names `agent` too: the same flow, a different worker. Alice's writer was copied from a library template.

### Worker flows

You learn one thing, a worker, and then the flows a worker can name. Two come built in, and an app adds its own.

| Flow | What it does |
| -- | -- |
| Agent | Does open-ended work itself. The default when a worker names none |
| Coordinator | Takes in work or messages and hands them to other workers, through its board or by a routing policy |
| The app's own | Whatever the app wrote and registered as a worker flow, such as a coder that drives a harness or a triage step that's a fixed workflow |

A coordinator can route by judgment, or by a fixed policy: best fit, round robin, or everyone answers. A coordinator with a fixed policy is what we used to call a mailbox. Someone has to be responsible for an inbox, and a coordinator is that someone.

A coordinator with a board splits work and tracks it. One without a board is a pure relay. That's the same line as the open question of one flow or two.

The chief of staff fits here: it's a standard coordinator at the top of your roster, whose delegates are your other workers and whose tools manage your roster.

### The worker contract

Not every flow can run a worker. A flow becomes available to workers only when it meets the **worker contract**:

* **It accepts a worker's standard configuration:** instructions, skills, tools, packages and the worker's id, plus its own settings beside them.
* **It has a door:** one public action that takes a message, so an app can talk to any worker without knowing its flow.
* **It keeps a worker's state private.** Anything shared goes through a shared resource, with attribution.

The installation registers which flows are worker flows. A worker's configuration can only name a registered worker flow, and the installation can keep some flows for standard workers only, so a user can't hire a non-standard worker onto them.

Most of this exists today. A flow is hireable when its config schema accepts the six keys of `workerConfigSchema()`, and its door is found from its actions (`packages/workforce/src/worker-config.ts`, `seat-door.ts`). The flows passed to the hire are the allowlist.

### How many sessions

A worker has no single long-running session. It gets a session per piece of work, and what carries over between them is its memory.

| Work | Sessions |
| -- | -- |
| A conversation with you | One per conversation |
| A task | One per task |
| Leading a workstream | One workstream session, lasting as long as the workstream |
| Talking to a project | One project coordinator session per user per project |

### Memory

The flow decides which memory layers a worker keeps, and a worker's configuration can turn layers on or off. The built-in `agent` flow could use four:

| Layer | Remembers | Shared with |
| -- | -- | -- |
| Session | What matters to this conversation or task | Nobody |
| Worker | How this worker operates, across all its sessions | Nobody |
| User | What any of your workers should know about you | Your other workers |
| Org | What matters about the work | The org, with each entry naming the user and worker that wrote it |

### Long-lived sessions

Workstream sessions, and agent sessions in general, may never end. A session has to keep working after weeks of history, the way long-running assistant bots do. So how a session manages its memory has to be configurable per flow and per worker: how much history it keeps word for word, when it summarizes, and what it moves into the memory layers above.

### Standard and non-standard workers

Every worker is one of two types, depending on where its configuration comes from.

|  | Standard worker | Non-standard worker |
| -- | -- | -- |
| Defined by | Files, written by whoever manages the installation | A user, at runtime |
| Stored as | A projected collection, read from the files | A user-scoped resource |
| Who has it | Every user, always the same | Only the user who hired or copied it |
| Can be changed by a user | No | Yes, by its owner |

You can't customize a standard worker. You can fork it, which hires a new non-standard worker starting from its configuration.

"Whoever manages the installation" isn't necessarily the app's developer. Every installed app can be configured, so it's whoever runs that installation. If you run it locally, that's you.

### The library

The org's library holds **templates** for non-standard workers only. Standard workers don't need one: every user already has them.

Sharing a worker publishes a template. Adding a template to your roster copies it into a new non-standard worker that you own. Your copy doesn't change when the template does, so nobody else can alter what runs with your access. When a template changes, you can be told an update exists and decide whether to take it.

### What this replaces

Today each worker is its own flow instance, registered in every process, with a pin that locks who can reach it. Its configuration lives in code and is rebuilt at every start from roster rows. Under this model:

* A hire is a write to data, not a registration in every process.
* Access is resource access. A user-scoped worker is private by construction, so pins aren't needed.
* Flow instances go away. Workforce is the only user of flows with several instances and of pins, so both can be deprecated now and removed later.

What it costs, and how each cost is handled:

* **Configuration becomes stored data.** Today it's deliberately never stored. Standard workers stay read from the files through a projected collection, so a deploy can't leave them stale. Only non-standard workers are stored, and their configuration has to tolerate old shapes, like any stored record.
* **Resources are declared on flows.** A resource collection is what defines a schema, so it's declared statically. Only standard workers, in files, can bring a resource with a new schema, and those are known at startup, so their flows declare them. A non-standard worker can only use collections its flow already has.
* **Validation moves.** Today a bad configuration fails at startup. A non-standard worker's configuration is checked when it's saved, and again when a session loads it.

The server sets a session's link to its worker. The worker resource is also user-scoped, so even a forged link would point at nothing the caller can read.

## Coordinators and transcripts

A coordinator is the worker responsible for an inbox. You or another worker send it something, and it decides who handles it, either by its own judgment or by a fixed routing policy. Its delegates do the work, each in their own session.

![A coordinator relaying a post, and a direct ask](../figures/concept-3-coordinator-relay.svg)

Alice posts to her launch coordinator, which uses best fit and hands the post to the researcher. When the writer only needs one fact, it asks the researcher directly, with no coordinator involved.

### How a coordinator works

| Part | What it is |
| -- | -- |
| Door | Where posts arrive, from you or from another worker |
| Delegates | The workers it can hand a post to. Each is a worker on the same user's roster, with an optional note on what it's good at |
| Routing | How it picks delegates for each post: its own judgment, best fit, round robin, or everyone |
| Delivery | Each picked delegate works the post in its own session, and its answer comes back to the coordinator |
| Transcript | Optional. One ordered script of posts and answers |

![A coordinator's parts, and how its delegates change](../figures/concept-4-coordinator-parts.svg)

Posts come in through the door, routing picks a delegate, and the answer comes back. Delegates change either directly or through the coordinator's own tool, and both paths are checked the same way.

### Managing delegates

Delegates live in the coordinator session's state. A new session copies the default delegates from the coordinator's configuration, then manages them in its own state. A change in one session never reaches the coordinator's other sessions, and each new session starts fresh from the defaults. Because a change never writes the configuration, it works the same on a standard coordinator, whose configuration can't be changed. Two paths change them, and both pass the same check:

* **Directly, and predictably:** you in the app, or the app's own code, adds or removes a delegate in a session. Changing the defaults is a change to the configuration: a non-standard worker's resource, or a standard worker's file.
* **By the coordinator itself:** it manages its own delegates with a tool, adding or removing them as the work needs.

The check is that a delegate must be a worker on the same user's roster. A coordinator can never delegate to someone else's worker.

A workstream's lead may need a different team for each workstream. The same rule covers it: each workstream session holds its own delegates, starting from the coordinator's defaults.

### What mailboxes enforced

Mailboxes had a contract of their own, and a coordinator has to keep three parts of it:

| Rule | Why |
| -- | -- |
| An answer doesn't trigger routing again | Today a worker's own post wakes nobody (`seatAuthored`). Without that, two workers answering each other would loop forever |
| One answer per delegate per post | A post delivered twice must not get two answers. Today the mailbox keeps one answer per post |
| Every routing decision is recorded | So you can see why a post went where it did. Today each routed post leaves a `mailbox-route` item |

A mailbox's member list was fixed when it opened, with no way to add or remove members. Delegates fix that.

### Workers chatting with each other

This is what channels originally meant, before they were renamed mailboxes. A coordinator with the everyone policy and a transcript is a group chat among your workers: each post goes to every delegate, and every answer lands in the transcript.

To let workers answer each other, the coordinator sends answers back out for a set number of rounds. The round limit replaces the old rule that a worker's post wakes nobody, so workers can talk without looping forever.

### When to use one

* **To ask one worker for one thing,** talk to it directly.
* **When the sender shouldn't need to know who handles it,** send it to a coordinator.
* **When work has to be split and tracked,** a coordinator uses its board. That's how a workstream's lead works.

### Transcripts

A session's own history already records what was said in it. A **transcript resource** is only needed for one coherent script of a conversation between several parties, read back in order. Then a coordinator with a fixed policy writes every post and answer into it.

Most coordinators don't need one. A workstream's lead decides what to surface in its own session and on the workstream entry.

**Decided:** a conversation between several workers is a resource, never a session. Workers can read it when they want to answer as part of one coherent conversation.

**Open: copy or projection.** A transcript can copy each line into the resource, or project lines from the sessions they were said in. Which one fits depends on whose sessions the lines come from.

* **One user's workers (the case now).** Every session involved is the same user's, so a projection crosses no privacy line. It stores each line once, at the cost of new plumbing. Our SQL stores can't join session items today, so a projected collection would look items up one by one. The memory and file stores would still copy.
* **Several users (later, with channels).** A projection would read other users' private sessions, which needs a special mechanism to keep data safe. A copy avoids that: it's the moment a line is published, written by its author, attributed, and fixed even if the source session is later edited or compacted.

Leaning: projection for one user's workers, if the plumbing is worth building. Copy whenever a transcript spans users.

## Channels and projects

### Channels

**Channels are a later feature.** The focus now is a single user's private workspace, so channels are described here to keep the model whole, not to be built yet.

**Rooms are removed.** Posting to a project's room becomes talking to the project's coordinator (see Projects). What goes away is a conversation shared between a project's members, which waits for channels. Shift Manager's Stream tab, today the rooms' one user, becomes the project coordinator's session.

A channel is a shared conversation with an access list: the whole org, or named users. Each user posts from their own session, and the lines land in one shared record.

A worker that answers in a channel answers for the user it belongs to, and each line records both, such as "Alice's researcher". If Bob's researcher answers too, those are two workers speaking for two users.

### Projects

A project is private or shared.

|  | Private project | Shared project |
| -- | -- | -- |
| Visible to | You | The org |
| Each workstream is owned by | You | One user |
| Who does the work | Your workers | Each owner's workers |

### Talking to a project

In a project, you talk to its **project coordinator**, not to workers. It's a coordinator session scoped to the project: one per user per project, so in a shared project each member has their own. It reads the project's shared data, such as every workstream's status, and routes what you ask to your own workstreams' leads and workers, then brings the answers back.

You rarely need to think about individual workers inside a project. When you do talk to one, it's through a session of its own: a direct conversation, or the session of a task it's working on.

Your project coordinator can only hand work to your own roster. To get something from another member's workstream, you read its entry, or ask the member.

### Workstreams

A workstream is one area of a project, owned by one user. It's made of three things that already exist:

1. **An entry on the project:** its title, its owner, the worker leading it, and its status. In a shared project, the org sees this entry.
2. **A lead worker**, usually a coordinator, which the owner picks from their roster.
3. **A workstream session:** the lead worker's lasting session for this workstream. Its board holds the workstream's tasks.

So a workstream needs no new flow. It's a project entry pointing at one of its owner's sessions. Only the owner can open that session. The org sees the entry, which the lead keeps up to date and which names the lead and the owner.

**Keeping it moving.** The lead's session wakes when a task finishes, on a schedule, or when the owner writes to it, and updates the entry each time. An entry that hasn't changed in a while shows as stale on the project.

In a private project, the same pieces exist, but only you see the entries. Later, owners on a shared project could agree in its channel who takes which workstream.

### How a workstream is stored

Each workstream is its own resource, in a collection keyed by its project: `workstreams/<project>/<workstream>`. Room lines are already keyed this way (`room-lines/<project>/<seq>`).

| Part | Where it lives |
| -- | -- |
| Owner, lead worker, workstream session id | The workstream's state |
| Status, due date, last updated | The workstream's state |
| Objectives, each with met or not, when, and by whom | The workstream's state, as a list |
| Latest status report | The workstream's content, as text |
| Title, brief, members | The project's own row, which holds no workstream data |

Why one resource per workstream rather than a list inside the project:

* **No contention.** Each owner's lead writes only its own workstream. One shared project row would make every owner's status update race every other's.
* **Ownership per row.** Only a workstream's owner can write it, and that rule is simplest when the row is the unit.
* **Room to grow.** Status reports and history don't bloat the project.

Objectives stay nested: they belong to one workstream, have one writer, and are always read with it. They'd move into their own collection only if they gained owners or assignees of their own.

**Project progress is computed, not stored.** A project view lists its workstreams by prefix and sums them: workstreams on track, objectives met, the nearest due date, anything stale. A total kept on the project row would drift from the workstreams and become another thing everyone writes.

A private project uses the same layout, at user scope.

![A shared project · two workstreams, two owners](../figures/concept-5-shared-project.svg)

The org sees each workstream, who owns it, and its results. Only the owner sees the tasks and the work behind them.

## How work flows

Work moves down through boards, and status comes back up. Every step runs in a session owned by the workstream's owner, so all of it acts as them.

1. A shared project has a workstream, owned by Alice.
2. The lead worker's workstream session breaks it into tasks on its board, usually large ones such as features.
3. Each task is assigned to a worker, which works it in a new task session.
4. A worker that needs to split its task uses its own session board, and can assign pieces to other workers the same way. This goes as deep as the work needs.
5. A worker that writes code can use a harness instead, which keeps its own task list.
6. As tasks finish, results move back up board by board, and the lead updates the workstream entry.

![How work flows · one workstream, down to a harness](../figures/concept-6-work-flows.svg)

The boards below the workstream are session-scoped and shared down their lineage, so a task session can settle its row on the board that assigned it. Task boards already hand off work this way today (`sharedToLineage`). A lineage stops at a flow, though ([the end-state POC](../poc/singleton-worker-link/README.md), leg C1): a row handed to a worker on another flow, such as a lead coordinator's row to an agent, can't sit on a board shared down the lineage. That board still stays its own, and only its own drains claim, wake on or settle its rows. How it does so is FIX-1794's to decide ([ER-9](../BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt)).

Everything in Alice's chain is hers. Bob's workers never appear in it: Bob's part of the project is his own workstream.

The lead is a coordinator, and so is any worker that splits its task and hands pieces on. There's nothing separate for routing work: it's always a worker.

## Naming

**Decided:** workstream, with an owner (not responsibility). Channel (not space). Mailbox is retired: it's a coordinator worker. A coordinator's workers are its delegates (not targets, members or recipients). Each task still has one assignee, picked from the delegates.

### One coordinator flow, or coordinator and relay?

A coordinator that routes by judgment and one that routes by a fixed policy could be two flows, or one flow with a routing setting.

**Open, and decided by the flow.** If the two styles run mostly the same flow, keep one flow with a routing setting. If they diverge a good deal, two flows are easier to manage.

## The security model

A behavior none of them explains is a bug in the model.

1. Every action is taken by one user, inside one org.
2. Every session is private to the user it belongs to.
3. A worker belongs to one user and acts as them. It never acts as itself or as anyone else.
4. A session's link to its worker is set by the server, from a worker the user can read, and never changes.
5. The only way to share is to write to a shared resource: a channel, a shared project, org memory, or the library.
6. Shared work enters a private roster only through its owner. A workstream is owned by a user, never by someone else's worker.
7. Everything written to a shared resource names who wrote it: the user, and the worker if one did.

## The standard install

The files on disk are the only control over rosters above the user. Whoever manages the installation writes them, and every org in that installation gets the same files. They describe the **standard install**: what every user starts with.

| A file defines | Every user gets |
| -- | -- |
| A standard worker, on any flow | That worker on their roster, read from the file, and the same for everyone |
| A channel or a shared resource | Access to the one shared copy in their org |
| A resource collection a standard worker needs | The collection, declared on the worker's flow |

The standard install guarantees consistency, not sharing. A standard worker called "researcher" exists for every user and behaves the same for each. Each user's sessions and memory with it are still private.

A standard worker always matches its file. Nobody can edit it, so a change to the file reaches every user. To change one for yourself, fork it into a non-standard worker.

### MAILBOX.md becomes WORKER.md

A mailbox is a coordinator, so it's declared like any other worker: a `WORKER.md` whose flow is the coordinator. Each `MAILBOX.md` key either moves or goes away.

| `MAILBOX.md` | In `WORKER.md` | Files using it today (of 32) |
| -- | -- | -- |
| `description:` | `description:`, unchanged | 32 |
| The body (the charter) | The body: the worker's instructions | 32 |
| `members:` | `delegates:` | 32 |
| `routing:` | `routing:` on the coordinator: judgment, best fit, round robin or everyone | 2 |
| `flow:` | `flow:`, unchanged, set to the coordinator flow | 2 |
| `boards:`, `boardActions:` | Removed. A coordinator's board lives on its session, and work that outlives a session belongs to a workstream | 14 and 3 |
| `mintFor: projects` | Removed with rooms and talk sessions | 0 |
| None | `transcript:` to keep a transcript resource, off by default | new |

Two rules come with it:

* **A standard coordinator can only name standard workers as delegates,** since those are the only workers every user is sure to have. A name that isn't one is refused at load. A user adds their own workers as delegates at runtime.
* **An old** `MAILBOX.md` **is refused at load, by name,** with the conversion above in the message. The framework is pre-1.0, and all 32 files are in this repo's goals, labs and kitchen-sink, so a loud refusal costs less than reading two formats.

The hard part is the 14 files with boards. Each one has to say whether its board was really a coordinator's working list (a session board) or shared work people track (a workstream on a project).

Held for later: treating the files like migrations, so that everything lives in data and loading the app brings the data in line with the files.

## Vocabulary

One term, one thing. Retired: person (say user), seat, hired seat, hired roster (say roster), desk, room, talk session, house, world, space, responsibility, mailbox, mailbox thread, target (say delegate), kind (say flow), and flow instance.

| Term | Means | Private or shared |
| -- | -- | -- |
| User | A person, signed in. The framework has no system users |  |
| Org | The boundary every user and resource sits inside |  |
| Session | One private conversation or piece of work. It may be long-lived | Private |
| Flow | The code that runs a worker. An installation has several, and each worker names one: a WORKER.md with flow:. One registered copy of each, shared by every worker that names it | Installation-level |
| Worker | What's often called an agent: a configuration with an owner, run by the flow it names | Private |
| Coordinator | A worker flow that hands work or messages to other workers, by judgment or by a fixed routing policy | Private |
| Standard worker | A worker every user has, read from the installation's files | Private sessions, same configuration for all |
| Non-standard worker | A worker a user hired, forked or copied, stored as a user-scoped resource | Private |
| Roster | The workers one user has hired, standard ones included, ready to be directed. Workforce is the package and the whole collaboration layer, and "private workforce" is fine in passing | Private |
| Template | A non-standard worker's configuration, published for others to copy | Shared |
| Worker library | The org's templates | Shared |
| Transcript resource | One ordered script of a conversation between several parties, kept only when needed | Follows its owner |
| Channel | A shared conversation with an access list | Shared |
| Project | A body of work, private or shared | Either |
| Workstream | One area of a project with one owner: a project entry plus its lead's workstream session | Entry follows its project; session is private |
| Workstream session | The lead coordinator's lasting session for a workstream, holding its board | Private |
| Task | A unit of work assigned to a worker, worked in its own task session | Private |
| Board | A list of tasks, belonging to a session | Private |
| Standard install | What every user starts with, defined by files | Installation-level |
| Worker contract | What a flow must meet to run workers: standard configuration, a door, private state | Installation-level |
| Door | The one public action that takes a message to a worker | Private |
| Delegate | A worker a coordinator can hand posts to. Always on the same user's roster | Private |
| Routing policy | How a coordinator picks delegates: judgment, best fit, round robin, or everyone | Private |
| Project coordinator | The coordinator session a user talks to a project through, one per user per project | Private |

### Retired terms the refactor removes

These terms are in today's code and docs, and go away in the refactor. Counts are files that mention the term, as of this doc's date: package source, then docs, then labs and apps.

| Retired term | Say instead | Where it lives today | Files |
| -- | -- | -- | -- |
| Seat, hired seat | Worker | `hireWorkforce`, `seatId`, `seatAddress`, `seat-door.ts`, the `seat*` config keys | 128 / 72 / 88 |
| Mailbox, `MAILBOX.md` | Coordinator | `mailboxFlow`, `openMailboxes`, `mailboxBoard`, `wakeMemberSeats`, the mailbox binder | 59 / 43 / 81 |
| Mailbox member, mailbox thread | Delegate, and the delegate's session | `members:` in `MAILBOX.md`, a woken worker's `mailbox:<id>` session | counted with mailbox |
| Room, talk session | The project coordinator. A conversation shared between members waits for channels | `projects/talk.ts`, `room-lines`, the talk template | 18 / 29 / 13 |
| Flow instance, as a worker | Worker resource, run by the singleton flow it names | `cardinality: "collection"` | 4 / 13 / 3 |
| Owner pin | Access to the worker resource | `ownerPin`, `register(flow, { pin })` | 30 / 11 / 6 |
| Hired roster | Roster: the user's hired workers, as worker resources | `defineHiredRosterCollection`, `workforce/roster/*` | 10 / 9 / 12 |
| Workstream, meaning a mailbox on a project | Workstream, as its own resource | the project row's `workstreams`, `setWorkstreams`, `workstream-claims/*` | 4 / 2 / 0 |
| Person, meaning the signed-in user | User | Comments and docs, such as "a person's message" for what reaches a worker's door | 55 / 50 / not counted |

"Target" never reached Workforce code; the engine's dispatch "target" is a different thing and stays. House, world, desk, space and responsibility only ever existed in drafts of this doc. None of them needs removing.

## Decisions and the gap to today

### Still open

- [X] **Workers as resources, flows as singletons.** Agreed. Flow instances and pins are deprecated now and removed later.
- [X] **Workstream, not responsibility. Channel, not space.** Agreed.
- [X] **Standard workers can't be customized.** Fork one into a non-standard worker instead.
- [X] **A mailbox is a worker flow.** Agreed: it's a coordinator, and "mailbox" is retired.
- [X] **Channels are a later feature.** The focus now is one user's private workspace.
- [ ] **One coordinator** flow or two? Open. One flow if the styles share most of the flow, two if they diverge.
- [X] **Where do a coordinator's delegates live?** Decided: in session state. Each session starts from the defaults in the coordinator's configuration and manages them from there, so the lock on standard workers never gets in the way.
- [X] **Can the coordinator change its own delegates?** Decided: yes, in its session's state.
- [ ] **The worker contract.** Recommend building on today's admission contract and door, and adding the private-state rule and a standard-only flag per flow.
- [ ] **Is a workstream a project entry plus its lead's workstream session?** Recommend yes. It needs no new flow, and its board is an ordinary session board. Store each workstream as its own resource under its project, and compute project progress from them.
- [X] **How do long-lived sessions manage memory?** Moved to the memory epic, [FIX-1775](https://linear.app/fixpoint-labs/issue/FIX-1775/epic-memory-and-session-context-management), updated with what this doc found: what's kept word for word, when it summarizes, and what moves to the memory layers, configurable per flow and per worker.
- [ ] **User-to-user communication.** Punted until we know we want it, and whether it belongs to the framework or the app.
- [ ] **Files as migrations.** Held for later.
- [ ] **MAILBOX.md becomes WORKER.md with the coordinator flow.** Recommend yes, refusing old files loudly with the conversion in the message.
- [ ] **The 14 mailbox boards.** Each becomes a session board or a workstream. Needs a pass over the goals that use them.
- [X] **Rooms are removed, and a project coordinator replaces them.** Decided. Their crash-safe answer record is the model for a coordinator's one-answer-per-delegate rule.
- [ ] **Multi-worker transcripts: copy into the resource, or project from sessions?** Punted. Within one user, projection is safe. Across users, copy, unless a special safety mechanism is built.
- [X] **In-flight work.** Decided: this is a large refactor, and it accounts for every piece of active work first. Each open PR either merges before the refactor starts, is closed as no longer relevant, or is shown not to touch what the refactor changes.

### Where today's code differs

*Checked against `main` at `74f9a4f68` in [EVOLUTION.md](../EVOLUTION.md#where-todays-code-differs-checked-against-main), which states the room and board facts precisely and updates the file counts.*

| Target | Today |
| -- | -- |
| A worker is a resource, and sessions load its configuration | Each worker is a flow instance with its configuration in code, rebuilt at every start from roster rows |
| Every flow is a singleton, and a worker names the one it runs on | A worker already names its flow, but each hire mints its own copy of that flow, registered under the worker's id (`hire.ts`). The `agent` flow does it as one kind with many instances (`cardinality: "collection"`) |
| Access to a worker is access to its resource | Instances carry pins, and only Workforce uses them |
| A worker contract decides which flows can run workers | Mostly there: a hireable flow's config schema accepts `workerConfigSchema()`, its door is found from its actions, and the flows passed to the hire are the allowlist. No standard-only flag, and no private-state rule. The configuration arrives as the flow copy's frozen `ctx.flow.config`, with `seatTools` as live blocks, so a stored worker can't carry it as is |
| Standard workers are a projected collection read from files | `WORKER.md` files become flow instances. Projected collections exist (`defineProjectedResourceCollection`), read-only |
| Workers are always private | A hire locked to the org alone is reachable by every member |
| Library templates are copied into your scope | There is no library |
| A coordinator is a worker flow, with delegates and routing policies | Mailboxes are their own flow, one session each. Best fit and wake-everyone exist; round robin doesn't |
| Delegates can be added and removed, directly or by the coordinator | A mailbox's members are fixed when it opens, with no join or leave |
| Answers don't re-route except in a bounded group chat | A worker's post wakes nobody (`seatAuthored`), so workers can't talk back and forth at all |
| Transcripts are a resource, kept only when needed | A mailbox's transcript is its session's items. Project rooms keep `room-lines` |
| Boards belong to sessions, shared down their lineage | Session boards with `sharedToLineage` exist, within one flow. Workforce boards belong to mailboxes and are org-scoped |
| A workstream is a project entry plus its lead's session | A workstream is a mailbox id on a project row |
| Tasks are assigned down the owner's chain, and run as the owner | A task's assignee names a board worker. A drain runs as whoever triggers it |
| Long-lived sessions with configurable memory management | A fixed turn window (`historyWindow`, `core/src/types/flow.ts`) and the memory package's tiers. Nothing compacts a session's own history |
| Projects can be private | Projects are org rows only |
| User data is kept per org | Only hired workers key user data by org |
| The chief of staff manages your own roster | The workers it hires belong to the org |
| Shared lines name the user and the worker | Project rooms already do. Mailbox lines all show the owner |
| A workstream is its own resource: readable by the project, writable only by its owner | Workstreams are mailbox ids on the project row, claimed through `workstream-claims/*`. Owner-private collections exist, but they hide rows from everyone else too. There's no rule for a row everyone can read and only its owner can write |
| You talk to a project through your project coordinator | A project has a room, reached through each member's talk session. Shift Manager's Project screen reads it in its Stream tab |
