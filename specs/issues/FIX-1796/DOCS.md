# FIX-1796 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

This issue publishes the glossary and the epic's overview opening, and changes words on every
page that still uses a retired term. Proposed prose follows the outsider rule
([`user-docs.md`](../../../docs/contributing/user-docs.md)); only the upgrading page says what
changed. Each operation below is reconciled against `main` when its PR is built: a row whose
behaviour isn't there is held, not published. Watch for: em-dashes as connectors, "powerful" and
"seamless", and a term used before it is introduced.

## UPDATE · `apps/docs/docs/glossary.md` · the opening

> flow-state.dev is built in layers. A small set of primitives in Core (blocks, flows, sessions,
> resources) carries everything above it. Orchestration builds task boards out of those
> primitives, Workforce builds workers, coordinators and projects out of flows, sessions and
> resources, and Shift Manager is an app that reads what Workforce writes.
>
> Most terms higher up are a lower term with a name and a rule added. A worker is a resource one
> user owns, naming the flow that runs it. A coordinator is a worker. A project is one row of a
> resource collection. The Built from column tells you where each term's data lives.

## UPDATE · `glossary.md` · Core table, after **Principal**

> | **User** | core | A person, signed in, always inside one org. Every action is taken by one user. The framework has no system users: an app can make one, and to the framework it is just another user. | Principal |

## UPDATE · `glossary.md` · task-board table, replacing **Assignee**

A task board keeps "seat" ([D1](DECISIONS.md#d1)). Once Workforce's seat is gone, this is its
only meaning, so the glossary defines it here and nowhere else, beside the assignee it is part of.

> | **Seat** | orchestration | A place on a task board: a name in its registry that holds a board worker, or a dispatcher that hands the task to another session. See [Task board](./orchestration/task-board.md). | Board worker |
> | **Assignee** | orchestration | The seat a task names: a seat on one specific task. A task whose assignee has no seat goes to the default worker, or fails. | Seat, task |

## REPLACE · `glossary.md` · "Workforce: workers, mailboxes, projects"

> ## Workforce: workers, coordinators, projects
>
> ![Each Workforce term beside what it is made of. A worker is a resource in one user's scope that names its worker flow. A standard worker is read from the installation's files, the same for every user. A roster is one user's workers. A coordinator is a worker on the coordinator flow, with delegates from the same roster in its session. A project is one row, in the user's scope or the org's; a workstream is an entry in a shared project that only its owner writes, plus its lead's session. A project coordinator is one session per user per project.](./glossary/workforce.svg)
>
> | Term | Package | What it is | Built from |
> |---|---|---|---|
> | **Worker** | workforce | What you might call an agent: a configuration with an owner. It names the flow that runs it and carries its own instructions, skills and tools. A worker belongs to one user and acts as them. See [Workers on disk](./workforce/workers-on-disk.md). | A resource in the user's scope |
> | **Worker flow** | workforce | The flow a worker runs on: the built-in `agent`, the coordinator, or a flow your app registers as a worker flow. Each is registered once, and every worker that names it shares that copy. See [The built-in worker](./workforce/built-in-worker.md). | Flow |
> | **Standard worker** | workforce | A worker every user has, read from the installation's files and the same for everyone. Nobody can edit one. To change it for yourself, fork it. | Worker, the installation's files |
> | **Fork** | workforce | Copies a standard worker into a worker of your own, starting from its configuration. | Worker |
> | **Roster** | workforce | The workers one user has, standard ones included. | Workers |
> | **Coordinator** | workforce | A worker that hands each post to other workers on the same roster, its delegates. It picks by its own judgment, by best fit, in turn, or sends to everyone. See [Coordinators](./workforce/coordinators.md). | Worker, the coordinator flow |
> | **Delegate** | workforce | A worker a coordinator can hand posts to. Always on the same user's roster. Each answers in its own session. | Worker |
> | **Door** | workforce | The one public action that takes a message to a worker. | Action |
> | **Project** | workforce | A body of work, private to you or shared with your org. See [Projects](./workforce/projects.md). | One row, in user or org scope |
> | **Workstream** | workforce | One area of a shared project, with one owner. Its entry is read by the org and written only by its owner; its lead works it in a workstream session. | A resource row, a session |
> | **Project coordinator** | workforce | Your coordinator for one project: one session per user per project. It reads every workstream's entry and hands work only to your own. | Coordinator, session |
> | **Chief of staff** | workforce | The standard coordinator a user asks who works here, and asks to hire or fire. See [The chief of staff](./workforce/chief-of-staff.md). | Standard worker, coordinator |
>
> Rows for team, package, address, inventory, hire and fire are kept where `main` still has them,
> reworded in these terms.

Template and the worker library are added by FIX-1795 when it ships; not here.

## UPDATE · `glossary.md` · Shift Manager rows that name a retired term

> | **Shift Coordinator** | Shift Manager | The home screen: a summary of what is waiting and running, then your conversation with your chief of staff. | Chief of staff, session |
> | **Inbox** | Shift Manager | The pending asks in sessions you started and the runs they started, oldest first. | Asks |
> | **Tasks** | Shift Manager | Every task not done on your boards, grouped by state, worker or workstream. | Task, board |
> | **Roster** | Shift Manager | Your workers, grouped as on shift (running a task), on call (a parked task or a pending ask) or off shift. Worked out on each read, not stored. | Roster, tasks, asks |

## REPLACE · `glossary.md` · "Words that mean two things"

> - **Worker.** In Workforce, a configuration one user owns. On a task board, a board worker:
>   the block that runs a task. A task's assignee names a board worker, or, on a board that asks
>   Workforce's worker lookup, one of your workers.
> - **Kind.** A flow's `kind` is its name to the engine. Workforce calls the flow a worker runs
>   on its worker flow.
> - **Dispatcher.** Core's `dispatcher()` is a block that sends to another flow. A task board's
>   dispatcher is the rule that picks the next task.
> - **Roster.** Your Workforce roster is your workers. Shift Manager's Roster screen shows them
>   by what they are doing.

## UPDATE · the glossary's figures

`glossary/workforce.svg` is redrawn to the alt text above. `glossary/layers.svg` says "workers,
coordinators and projects" where it says "workers and mailboxes"; `glossary/shift-manager.svg`
loses its mailbox-board and room cells. Each keeps the projects-plates style ([FIX-1746](https://linear.app/fixpoint-labs/issue/FIX-1746)).

## UPDATE · `apps/docs/docs/orchestration/task-board.md` · only Workforce's lines

The page keeps "seat" and its "Seats that hand off" heading ([D1](DECISIONS.md#d1)). Its section
"A board a mailbox holds" imports Workforce: it goes with the mailbox (FIX-1792), or, if it is
still there, moves to the Workforce pages in the new terms. Any other line where a seat means a
Workforce worker says worker.

## UPDATE · `apps/docs/docs/orchestration/discovery.md` · description and opening

> One tool call that tells an agent what is in scope for it right now: the workers it can hand
> work to, the skills it can load, and the resources it can read.

The **seat** and **mailbox** definitions go; a **worker** links to the glossary. The domain names
`seats` and `mailboxes` stay, because the tool takes them as input ([D1](DECISIONS.md#d1)); the
page describes each one in the new terms, read off the tool at publish.

## UPDATE · `apps/docs/docs/workforce/upgrading.md` · new section

> ## Names changed in this release
>
> Each idea now has one name. The table lists every public name that changed; there are no
> aliases, so update imports and reads, and the type checker finds the rest.
>
> | Package | Was | Now |
> |---|---|---|
> | `@flow-state-dev/workforce` | `seatId`, `seatSkills`, `seatTools`, `seatPackages` | `workerId`, `workerSkills`, `workerTools`, `workerPackages` |
> | every package | the rest | the package's changelog for this release |
>
> A worker flow whose configuration schema composes `workerConfigSchema()` gets the new keys with
> no change. One that declares them by hand is refused at startup, and the message names the
> key it is missing. Saved data keeps its stored names, so nothing needs moving.

The rows are completed from the changesets when P1 is built; the one above is pinned.

## PUBLISH · `apps/docs/docs/workforce/overview.md` · the opening

The epic's draft ([epic DOCS.md](../../epics/FIX-1786/DOCS.md#update--appsdocsdocsworkforceoverviewmd--opening-and-what-a-workforce-app-looks-like))
is canonical and not copied here. Publish it in P2, with Q2's answer (private projects in), no
library lines, and each sentence checked against `main`.

## Every other page

A sentence that uses a retired term keeps its meaning with the new term: no section is added,
moved or removed. Those pages are not copied here. "Person" stays where it means any human.

## Ownership

Every operation here is FIX-1796's. The per-page Workforce prose is each child's own
([epic DOCS.md](../../epics/FIX-1786/DOCS.md#ownership)); this issue only changes its words.
