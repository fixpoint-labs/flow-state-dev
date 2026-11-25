# Scopes and Sessions: How It Should Work

## Why this doc

Several of the hardest parts of FSD to explain, task boards above all, exist mainly to work around one rule: a session can't reach data that belongs to another session, even when both belong to the same user. Each feature that needed to look across sessions built its own way around that rule, and those workarounds now make up a large share of what a newcomer has to learn.

This doc describes how scopes and sessions should work. It describes the target first. The gap to today, with the files it was read from, is in a companion file, [Scopes and Sessions: Gaps to Today](scopes-and-sessions-gaps.md).

## Base terms

**A user is always a person, signed in, inside one org.** The framework has no system users.

**The owner is the only access boundary.** An owner is one user, inside one org, under one tenant when the app has tenants. Nothing that belongs to Alice is ever reachable by Bob, and nothing Alice owns in one org or tenant is reachable from her requests in another. The one way to share is to write to something stored for the whole org.

**A scope is a place to keep a copy, not a lock.** It says how many copies of a resource exist, and which copy "mine" means by default. It never decides who may look.

**A session belongs to one user and runs one flow.** It's one conversation with a person, or one piece of work. A flow is the code a session runs, such as the built-in agent flow or an app's coder flow.

**A session keeps a log and has state.** Its log is the record of what happened in it, which the user reads as its history. Its state is its flow's working memory. Data meant to be read from anywhere else goes in a resource, not in state.

## The parts, in the order you meet them

Each part uses only the ones above it.

1. **The user.** Who every request runs as, and the boundary nothing crosses.
2. **Scopes.** Where the copies of a resource live: one per session, one per user, or one per org.
3. **Definitions.** The shape of a resource, registered once by name, so any flow can reach it.
4. **Your own copy.** The copy a block reaches without naming anything.
5. **Another session's copy.** The copy a block reaches when it names another of the user's sessions on purpose.
6. **Writes across sessions.** How a session changes data in another session, and what checks and records that.
7. **Child sessions.** A session started from another one, and what it knows about where it came from.
8. **Looking across every session.** How one view shows what's in all of a user's sessions at once.

## The cast

Every example uses these.

| Name | What it is |
| -- | -- |
| Alice | A user in the Acme org |
| Bob | Another user in the Acme org |
| em (worker) | Alice's engineering manager. It hands work out and doesn't write code. Runs on the built-in agent flow |
| coder (worker) | Alice's coding worker. Runs on the coder flow |
| launch chat (session) | Alice's conversation with em about the launch |
| CSV task session (session) | The session coder works one task in: "Add CSV export" |
| work (board) | A task board, kept per session |
| preferences (resource) | Alice's settings, kept per user |
| playbook (resource) | Acme's shared engineering playbook, kept per org |

## The user

Every request runs as exactly one user, inside one org. The server sets that identity. A caller never supplies it.

The user is the line nothing crosses. Alice's sessions, her copies of every per-session and per-user resource, and her workers are hers alone. Bob reaches none of them, and no setting changes that. The only data both of them reach is data kept per org, such as the playbook.

Inside a per-org copy, the same line can run between rows. A row can belong to one user, so that only she can read it, or only she can change it. That's the user boundary applied inside a shared copy, not a second kind of permission.

## Scopes

A scope answers one question: **how many copies of this resource are there?**

| Scope | Copies | "Mine" means | Example |
| -- | -- | -- | -- |
| Session | One per session | The copy in the session I'm running in | work (board) |
| User | One per user | My copy | preferences |
| Org | One for the whole org | The org's copy | playbook |

A per-session resource is the same shape repeated many times. Alice's launch chat has a work board. So does her CSV task session, and so does every other session that uses one. They are separate copies of one definition, the way two rows of a table share their columns.

A scope never makes data private from its own user. Alice's launch chat can look at the work board in her CSV task session whenever it has a reason to. The scope only decides which copy she gets when she doesn't say.

```mermaid
flowchart LR
  subgraph Alice["Alice: the boundary"]
    direction TB
    L["launch chat<br/>work board copy"]
    T["CSV task session<br/>work board copy"]
    P["Alice's preferences<br/>one per user"]
    L -. "reads on purpose" .-> T
  end
  subgraph Bob["Bob"]
    BS["Bob's sessions<br/>their own copies"]
  end
  O[("playbook<br/>one per org")]
  Alice --> O
  Bob --> O
```

*Copies inside a user, and a shared one outside.* Each of Alice's sessions has its own copy of the work board, and the launch chat can read the task session's copy on purpose. The only thing Alice and Bob both reach is the org's playbook.

### What this replaces

Today a per-session resource is reachable only from its own session, or, when it opts in, from sessions that share its *lineage*: the chain of child sessions started on the same flow. A child started on a different flow gets a lineage of its own. So any data a task needs to reach across flows has been moved up to per-user scope, and then split back up by session inside that one copy. The task board is the main case, and the gap table lists the others.

What it costs, and how each cost is handled:

* **Reaching across sessions must stay deliberate.** A block that lists or claims tasks must not sweep every session's board by accident. That was the real bug the per-user board fixed. Here a sweep always acts on one copy, and reaching another copy means naming it (rule 9).
* **Session ids aren't secrets.** A caller can choose a session's id, so the check that a named session is the user's reads the session's stored owner. It never trusts anything about the id itself (rule 5).

## Definitions

A definition is a resource's shape: its name, its scope, and the shape of its data. Every definition is **registered by name** with the installation, the same way blocks will be. A definition that other flows need to reach, such as a board, is marked **shared**, and any flow reaches it by its name. No flow has to import the module that defined it.

A definition that isn't marked shared stays reachable only from the flows that declare it, and can keep a separate copy per flow instance, as today's flow isolation does. That's where a flow's internal or background state lives: data no other flow's model should be able to pull into its context. A name is not an access check, so reach by name is opt-in.

Registration is where shapes are checked. One name has one definition per installation, and a second, different definition under a taken name is refused when the app starts. Two flows that genuinely need separate data use two names.

So looking across sessions is always allowed, and the way to look is by a registered name. The registry, not each flow, is what makes coder and em agree on what a work board row looks like.

A board is the example used throughout:

```ts
// Anywhere in the app. Registering it is what makes "work" exist.
// A board is always a shared definition: other flows reach it by name.
defineBoard({ name: "work", scope: "session" });

// Any flow, by name: the common board API.
const work = boards(ctx, "work");
```

* **Who owns it:** the installation's registry. The module that calls `defineBoard` is where it's written, not who may use it.
* **Where it's stored:** under its name, in each scope copy: `work/<task id>` inside a session's space.
* **How many exist:** one definition per name. Its copies are one per session that uses it.

Two boards in one session are two names, `work` and `triage`, with two sets of copies.

### How a definition gets registered

A definition is declared on the blocks that use it, the way resources are declared today, and it rises with those blocks into every flow that includes them. The registry is every installed flow's declarations put together. Two different shapes under one name are refused when the app starts. So a block that needs a board still carries its own declaration and stays portable, and there's no second place to register anything.

A flow that declares nothing about a board still reaches it by name, because some installed flow declared it. If no installed flow declares it, the name finds nothing. With board names typed from the registry, that's an error when the app is built, not at run time.

### Storage and behaviour

Including a board in a flow used to mean two things at once. They are separate.

| | Storage | Behaviour |
| -- | -- | -- |
| What it is | The rows: one copy per session | What makes it a board rather than a list: claiming and handing out tasks, the entry that hears a task's ending, the entry a worker takes a task on, the model's tools |
| Where it comes from | The registry | Blocks and actions a flow includes |
| Who needs it | Nobody installs it. A session's copy is made the first time anyone writes to it, from any flow | Each flow, for the parts it uses |
| Example | The launch chat's copy of the work board appears when em files the first task | The em flow includes the board's tools and its ending entry. The coder flow includes the board's task entry |

So "the flow a board lives on" stops being a useful idea. The coder flow doesn't declare the work board's storage, but it includes the board's task entry so it can work tasks, and it reaches the launch chat's copy by name.

## Your own copy

A block reaches its own copy without naming anything: the copy for the session it runs in, for the user it runs as, or for the org.

```ts
const mine = boards(ctx, "work");       // the work board in this session
await mine.create({ goal: "Add CSV export", assignee: "coder" });
```

Every operation that goes over a whole copy acts on this copy unless the block names another: listing it, counting it, claiming the next task from it, and hearing about its changes. Nothing goes over every session's copy as a side effect.

## Another session's copy

A block reaches another session's copy by naming the session. This works the same way for every per-session resource, not only boards:

```ts
ctx.resources.notes                              // my session's notes
ctx.resources.at({ session: launchChatId }).notes // the launch chat's notes, by name

// A board is reached the same way. boards() is a thin wrapper that gives
// the copy a task-board API: create, get, list, claim, settle.
const launch = boards(ctx, "work", { session: launchChatId });
const row = launch.get(taskId);
```

`boards(ctx, name, { session })` adds nothing to the reach. It resolves the board through `ctx.resources.at({ session })` and wraps the copy it gets. So rule 5 is a promise about resources in general, and the next feature that needs another session's data uses the same call instead of building its own way around.

The server checks one thing: the named session has the same owner as this request, meaning the same user, the same org and the same tenant, each compared against what the session record stores. Session ids are chosen by callers, so the id proves nothing by itself. A session that fails the check gets nothing, in the same way as one that doesn't exist, so a caller can't learn which ids are taken. That includes Alice's own session in another org: it is answered as missing, not refused. No other permission is involved. Within one owner, reaching another session is always allowed. A child run inherits the org and tenant of the request that started it.

The spec for this check needs a refusal test for each way it can fail: another user, the same user in another org, and the same user under another tenant.

| Question | Answer |
| -- | -- |
| Who can do it | Any block running as the same user |
| What it needs | The session's id, and the resource's registered name |
| What it reaches | That session's copy of that resource, nothing more |
| What it can't reach | Another user's sessions, or the same user's sessions in another org or tenant, ever |

### When to use it

* **To read or change where your own work came from**, such as coder settling its task on the launch chat's board, name the session.
* **To show something across every session**, don't name sessions one by one. Use the one-call read across sessions (see *Looking across every session*).
* **For data that belongs to the user rather than to any one session**, such as a coding run's record that every later conversation should find, keep it per user, keyed by what it's about.

## Writes across sessions

A session may write to another session's copy the same way it writes to its own:

```ts
const theirs = boards(ctx, "work", { session: launchChatId });
await theirs.create({ goal: "Write the release note", assignee: "writer" });
```

Three things hold for every such write:

* **The definition's own checks run.** A board keeps a **claim** on each running task: its record of which session is working that task right now. Every write that works a running task, settling included, checks the claim, so only the session working the task can make it, and a stale or second worker is refused. A write from another session gets no way around that.
* **The owning session hears it.** A write from another session notifies the owning session exactly as a write from inside it would. Whether that starts a turn is the definition's call, not the write's. A board's task ending starts its filer's turn.
* **The writing request records it.** A write is part of the request that made it, so the CSV task session's own history shows that it settled a task in the launch chat.

What the owning session's own history shows of a write that came from elsewhere is open. One option is that the write goes through a named action of the definition, such as a board's settle. An action can record itself in the owning session's history too, so the launch chat shows "the CSV task session settled this". The other is that a plain write is enough, and the owning session's history shows only what it heard. See *Decisions*.

### Why writes aren't locked

Forbidding them is what produced the workarounds this doc removes. Each time a session needed to change another session's data, a feature copied the data into per-user scope, or relayed it through a message, or stamped values into a child at birth. The definition's checks are what keep a write safe: the claim on a task, the shape of a row. The scope doesn't need to keep it safe as well.

## Child sessions

A child session is one a session starts for some piece of work. When em hands "Add CSV export" to coder, the CSV task session is a child of the launch chat. A child can run on any flow.

A child carries two things: the id of the session that started it, and the work it was started for, passed in when it starts. Nothing else is shared with it implicitly.

**The work names its own board.** For a task, the work is the task's id, the session whose board it sits on, and the values fixed when it was filed, such as the project it belongs to. A block reaches the task it's running through that, not through the session's parent:

```ts
// In the CSV task session, on the coder flow
const filedOn = boards(ctx, "work", { session: ctx.task.session });
```

The two usually match, but not always. A workstream's lead session is opened once and then takes tasks routed to it from several conversations. Its parent is the session that opened it, while each task it works sits on the board of the conversation that routed it. So "which board is my task on" is answered by the task, every time, and "who started me" by the parent.

**Fixed values stay fixed.** Some values belong to the work as it was filed and must not change after, even if the parent's data does. A task keeps the project it was filed under when its conversation later switches projects. Those values ride on the task row and arrive with the work. Reading the parent live is only for values that should follow the parent.

There's no chain of sessions that quietly shares data, and no second rule for children on the same flow versus another flow. What the child is given is explicit, and whatever else it needs, it reads from the parent, or writes to it, by name.

| Work | Sessions |
| -- | -- |
| A conversation with a worker | One per conversation |
| A task | One per task, a child of the session that filed it |
| A follow-up on a finished task | The same session as the task it follows |

### What this replaces

Today two mechanisms stand in for "the child acts on the parent's data":

* **Lineage sharing.** A resource can opt in to one copy shared by a parent and its same-flow children, so two sessions act on one resource. A child on another flow starts a lineage of its own, because one lineage space can't hold two flows' declarations of the same name. On `main`, the only resource that opts in outside tests is a Kitchen Sink demo board, plus the task board's own rule that a session-scoped board which hands out work must opt in.
* **Copies at birth.** The server copies values from the parent's state into each child, "however many hops down". Some are fixed on purpose, such as a task's project, which must not move when its conversation's does. Others are copies only because the child couldn't read the parent.

Naming the parent covers lineage sharing and the copies that only stood in for a read. The values fixed on purpose move onto the task row, where they already partly live, and arrive with the work. The registry removes the clash between two flows' declarations.

## Looking across every session

Some screens need everything at once: an Inbox of everything waiting on Alice, or a board of every task in every one of her sessions.

A screen asks that question through a **view**, as [Reading, Writing and Installing](reading-writing-installing.md#views) defines it: a read-only question the server answers fresh, here at user scope, with no session opened. That doc's board is exactly this case. This section adds only what the view's block calls to get its rows, a read of a definition's copies across all of the owner's sessions in one call:

```ts
const open = await boards.acrossSessions(ctx, "work").list({ status: "open" });
// each row comes back with the session it belongs to
```

In the SQL stores this is one query, not one per session. Rows are already stored with the session they belong to, and the sessions table already records each session's user. The store joins the two: every row of the work board, in any session that belongs to Alice, that matches the filter. "Belongs to Alice" is the same owner rule that naming a session uses: the same user, the same tenant and the same org, compared so that a missing tenant or org matches only a missing one. The user id alone isn't enough, because one user id can exist under several tenants or orgs. The sessions table needs an index over that whole owner. The engine already reads a user's pending approvals this way, in one query joined across sessions (`packages/engine/src/context/request-sessions.ts:23-26`). It needs two things the stores will have anyway: the parts of a key that vary are indexed (rule 12), and a field a definition filters on, such as a task's status, has an index the definition declares. The filesystem store, used in development, walks the user's session folders instead.

* **Who owns it:** the engine. Nothing extra is written for it, so there's nothing to keep in step.
* **Where it's stored:** nowhere new. It reads every session's copy through one query.
* **How many exist:** one query per call, however many sessions the user has.

A view can still name one session when that's all it needs, and `ctx.sessions.list()` still lists sessions with their flow and status.

So there is one way for a screen to see across sessions, a user-scope view, and one way for that view's block to fetch the rows, this read. No second cross-session task story sits beside the view.

**It must keep the view's notices right.** A view records what each of its runs read, and a watcher hears a change to anything it read. A read across sessions reads copies in many sessions, including ones created after the view last ran. So the read records one change topic for the definition and the owner, not one per session copy, and every write to any session's copy of that definition publishes on that topic. Then Alice's board hears a task filed in a session that didn't exist when she opened it.

### What this replaces

Today each cross-session view builds its own path. Shift Manager reads the user's whole task store through the first session whose flow happens to declare it, then regroups the rows by conversation. The coding board looks up a session's lineage to recompute where its tasks are stored. The Inbox view reads every conversation's tasks at once.

## How it flows

Alice asks em, in the launch chat, to add CSV export.

1. **Alice posts in the launch chat.** Her request runs as Alice, in the launch chat.
2. **em files a task.** `boards(ctx, "work").create(...)` writes to the launch chat's own copy of the work board.
3. **The board hands the task to coder.** The engine starts the CSV task session on the coder flow, as a child of the launch chat. It is given the launch chat's id and the task.
4. **coder reads its task.** The task names its board: `boards(ctx, "work", { session: ctx.task.session }).get(taskId)`. The server checks that the launch chat is Alice's, and it is.
5. **coder splits the work.** It files two pieces on its own copy of the work board, in the CSV task session. A task filed while working another task is its sub-task, so these two are sub-tasks of the CSV task.
6. **Alice opens her task view.** It reads the work board across all her sessions in one query: the CSV task on the launch chat's board, and its two sub-tasks on the task session's board, all running.
7. **The sub-tasks finish, and then coder finishes.** It settles its task on the launch chat's copy. The claim checks that this session holds the task. The CSV task session's request records the settle.
8. **em hears the ending.** A write from another session notifies the owning session as a local write would, and a board's task ending starts its filer's turn. em's next turn in the launch chat runs once, because of the ending, and tells Alice. Her task view shows all three tasks as done.

```mermaid
flowchart LR
  A["Alice posts<br/>launch chat"] --> F["em files task<br/>launch chat's board"]
  F --> C["CSV task session<br/>child, coder flow"]
  C -->|"reads its task<br/>on the board it names"| F
  C --> P["coder files sub-tasks<br/>task session's board"]
  P --> S["coder settles<br/>on launch chat's board"]
  S --> W["em's next turn<br/>tells Alice"]
  F -. "one query" .-> V["Alice's task view<br/>across sessions"]
  P -. "one query" .-> V
```

*One task, two sessions, two copies of one board.* The only reach across sessions is coder naming the launch chat, once to read and once to settle, and Alice's view reading every session's copy in one query.

Bob never appears. Even if coder were handed the id of one of Bob's sessions, both the read and the write would be answered exactly as if that session didn't exist.

## Naming debates

### What to call a session's copy

| Name | Says | Fits | Familiar from | Risk |
| -- | -- | -- | -- | -- |
| Copy | One of many of the same thing | Plain, and the doc's own word | Everyday speech | Sounds like a duplicate that can drift |
| Instance | One realization of a definition | Matches "definition" | Programming | Already used for flow instances |
| Namespace | A space names live in | Says why it exists | Programming | Describes the space, not the data |

**Recommend copy** in docs and prose, with "a session's copy of the work board". Nothing in the API needs the noun: `boards(ctx, "work")` and `{ session }` say it. This changes if users read "copy" as "duplicate that can go stale".

### How to reach a board, and another session's copy

| Shape | Example | Fits | Risk |
| -- | -- | -- | -- |
| Reach on every resource, boards as a thin wrapper | `ctx.resources.at({ session }).notes`, `boards(ctx, "work", { session })` | One rule for all per-session data; boards get a friendly API on top | Two spellings for a board's copy, the raw resource and the wrapper |
| A board-only lookup | `boards(ctx, "work", { session })` and nothing else | Small surface | Every other resource needs its own way across, the pattern this doc ends |
| A sessions handle | `ctx.sessions.get(id).boards("work")` | One place for everything about a session | A second way to reach the same copy |

The sessions handle exists today: a block can ask the engine about its user's other sessions, meaning their flow, the state fields their flow marks readable, their history, and a list of them. It reaches no resources.

**Decided: reach on every resource, with `boards()` as a thin wrapper.** Board names are typed from the registry the way flow names are, so a typo fails when the app is built. The raw resource is there for code that needs the rows as stored; everything that works tasks uses `boards()`. The sessions handle stays for what isn't a resource.

## The rules

A behavior none of these rules explains is a bug in the model.

1. Every request runs as one user, inside one org. The server sets both.
2. The owner (one user, in one org, under one tenant) is the only access boundary. Nothing of one owner's is reachable by another, including the same user in another org or tenant. Sharing means writing to a resource kept per org.
3. A scope decides how many copies of a resource exist and which one "mine" means. It never decides who may look.
4. A block reaches its own copy without naming it.
5. A block may read or write another session's copy of any resource by naming that session and the resource (`ctx.resources.at({ session })`; a board's wrapper uses the same call). The server checks only that the session belongs to the same owner (the same user, tenant and org), using the session's stored owner, and answers a session that isn't the user's exactly like one that doesn't exist.
6. A resource name has one registered definition per installation. A second, different definition under a taken name is refused when the app starts. Only a definition marked shared is reachable by name from any flow. Any other definition is reachable only from the flows that declare it, and may keep a separate copy per flow instance.
7. A write from another session runs the definition's own checks, such as a task's claim, exactly as a local write does. Apart from rule 5's owner check, which is about the user, scope adds no check of its own.
8. A write from another session notifies the owning session exactly as a local write would. Whether that starts a turn is the definition's call.
9. An operation that goes over a whole copy (listing, counting, claiming the next task, hearing its changes) goes over one copy: your own, or the one you named. Nothing sweeps every session by accident.
10. A child session knows the session that started it and the work it was started for, and nothing else implicitly. The work names the board its task sits on and carries the values fixed at filing. Anything else the child needs from its parent, it reaches by naming the parent.
11. Data that belongs to a user rather than to one session is kept per user, keyed by what it's about, never by a session's id.
12. Every part of a resource's key that varies (a session, a board, a task id) can be filtered on by the store without a scan. No feature reaches its rows by building a prefix out of encoded values.
13. Reading a definition's copies across all of a user's sessions is one call and, in the SQL stores, one query. Nothing reads a pile of sessions one by one to build a view.

## Vocabulary

One term, one thing. Retired: lineage (say child session, and name the parent), shared to lineage, partition (say a session's copy), filing session (say the session that filed it, or the parent), board above (say the parent's board), conversation (when it means any session, including a task's: say session), carrier session.

| Term | Means | Turns on |
| -- | -- | -- |
| User | A person, signed in, inside one org | |
| Org | What every user and every shared resource sits inside | |
| Session | One conversation or piece of work, belonging to one user and running one flow | Owned by one user |
| Conversation | A session with a person in it, such as the launch chat | |
| Flow | The code a session runs, such as the agent flow or the coder flow | |
| Session log | The record of what happened in a session, read as its history | |
| Session state | A flow's working memory for one session. Other sessions read only the fields its flow marks readable | |
| Child session | A session started by another session. It keeps its parent's id and is given the work it was started for | Owned by the same user |
| Sub-task | A task filed while working another task, on the working session's board | |
| Claim | A board's record of which session is working a task right now | Guards every write that works the task |
| Filer | The session that filed a task, which hears how it ended | |
| Installation | One running app with its registry, flows and stores | |
| Scope | How many copies of a resource exist: per session, per user, per org | Never who may look |
| Definition | A resource's name, scope and shape, registered once with the installation | One per name; shared or not |
| Shared definition | A definition any flow can reach by name, such as a board | Opt-in |
| Owner | One user, in one org, under one tenant when there are tenants. The access boundary | |
| Registry | The installation's list of definitions (and, later, blocks) by name | |
| Copy | One scope's data for one definition, such as the launch chat's work board | Per session, user or org |
| Your own copy | The copy a block reaches without naming anything | |
| Another session's copy | A copy reached by naming another session of the same user | Read and write, under the definition's checks |
| Action | A named write a definition offers, such as a board's settle | Open: whether cross-session writes must use one |
| Board | A task list registered with `defineBoard`, usually kept per session | |

### Retired terms

The terms this model retires, where each lives in code and docs today, and how many files mention it, are listed in [the gaps file](scopes-and-sessions-gaps.md#retired-terms-the-refactor-removes).

## Decisions

- [X] **Scopes are copies, and the user is the boundary.** Agreed in discussion.
- [ ] **Sessions of one user can write to each other's copies.** Leaning yes: `theirs.create(...)` is fine. The definition's checks guard the write, and the writing request records it.
- [ ] **Do cross-session writes go through named actions?** Open, to explore. Actions let the owning session's history show who changed what from where. Plain writes are simpler and are already recorded by the writing request. Recommend plain writes by default, with a definition free to offer actions where its history matters, such as a board's settle. Would change: a support or audit need to answer "who changed this conversation's data" from the conversation alone.
- [X] **Definitions are registered by name.** Agreed in direction: one registry for resource definitions, and later blocks, so flows reach a board by name without a shared import. Recommend typing names from the registry so a typo fails at build time.
- [ ] **What a model's task tools look like with several boards.** Open, to explore. A `board` argument on one set of tools, or tools per board. Needs the real use cases first: when does one worker file on two boards in one turn?
- [ ] **Lineage sharing goes.** Leaning yes. It was meant to let two sessions act on one resource, and a child reaching its parent by name covers that. On `main` its only real user is a Kitchen Sink demo board.
- [ ] **The server stops copying parent values into child state.** Recommend yes, with lineage: a child reads its parent by name. Would change: a value the child needs on every turn where reading the parent adds measurable cost.
- [X] **Key parts are indexed, not prefixed.** Every part of a resource key that varies can be filtered on by the SQL stores without a scan, as its own refactor. This retires the prefix reads everywhere, not only for tasks.
- [ ] **Reading across sessions in one query.** Recommend `boards.acrossSessions(ctx, "work")`, answered by the SQL stores as one query that joins rows to the sessions table by owner, with indexed key parts and declared field indexes. No separately kept per-user index, which would have to be updated on every write. Would change: the join turns out slow for users with many thousands of sessions, where a kept index pays for itself.
- [X] **Definitions are declared on blocks and rise into flows, and the registry is their union.** Agreed: option (a).
- [X] **Reaching another session is a resource feature.** `ctx.resources.at({ session })` works for every per-session resource; `boards(ctx, name, { session })` is a thin wrapper over it that gives a board's copy its task API.
- [X] **Screens see across sessions through a user-scope view.** Agreed in direction: the across-sessions read is what a view's block calls, not a second way for screens to read. It follows [Reading, Writing and Installing](reading-writing-installing.md).
- [ ] **The change topic for a read across sessions.** Open. Recommend one topic per definition per owner, published by every write to any session's copy, so a view hears copies made after it last ran. Would change: that topic is too noisy for an owner with many busy sessions, where a narrower topic per filter would pay off.
- [ ] **Turns started by writes from other sessions.** Open. Rule 8 lets a definition start a turn when another session writes. A burst of endings (fifty sub-tasks settling at once) must not start fifty turns. Recommend that turns started this way coalesce per session, as a board's notices already do, and that the spec checks fan-out before it is built.
- [ ] **Cost of the cross-session query.** Open. The decision above weighs session count. Row count may bite first: a user with thousands of open tasks. Recommend paging the across-sessions read from the start, and measuring both on a seeded store before the spec settles the indexes.
- [ ] **Filesystem store parity.** Open. The SQL stores answer the across-sessions read in one query; the filesystem store walks folders. Recommend the same results and order from both, held by the store conformance suite, so `fsdev run` and tests behave as production does.
- [ ] **Session state across sessions.** Open. Recommend keeping today's rule: another session reads only the state fields its flow marks readable. State is the flow's working memory. Data meant to be read elsewhere belongs in a resource.
- [ ] **Tenants inside per-user data.** Punted. A tenant is a customer of an app that hosts many customers on one install, a level above the org. Per-user data today is keyed by user and org, not tenant, and Workforce puts the tenant into its row ids by hand. Out of scope here, but the gap is real.
- [ ] **Moving existing data.** Punted to the spec. Six per-user collections are keyed by a session-derived value today. Each needs a decision: become per-session, or stay per-user keyed by its subject.

## Where today's code differs

The gap between this model and today's code is in [Scopes and Sessions: Gaps to Today](scopes-and-sessions-gaps.md). It has three parts: where today's code differs (each claim cited to the file it was read from), the retired terms with file counts, and what else this simplifies with an estimate of the code it removes. This doc is the model; that file is the backlog a spec works from.
