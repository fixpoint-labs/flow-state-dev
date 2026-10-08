# FIX-1796 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

This issue publishes the glossary and the epic's overview opening, and changes words on every
page that still uses a retired term. Proposed prose follows the outsider rule
([`user-docs.md`](../../../docs/contributing/user-docs.md)). There is no upgrading page
([epic D9](../../epics/FIX-1786/DECISIONS.md#d9)). Each operation below is reconciled against `main` when its PR is built: a row whose
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

A task board's seat becomes assignee ([D1](DECISIONS.md#d1)). The glossary defines assignee once,
here, and has no seat row.

> | **Assignee** | orchestration | Who a task goes to: an entry in a task board's workers, or a name the board's assignee check accepts, such as one of a Workforce worker's delegates. A task's `assignee` names it, and it runs the task inline or hands it off to a dispatch run in another session. A task whose assignee names no entry goes to the default assignee, or fails. See [Task board](./orchestration/task-board.md). | Board worker, task |
> | **Hand-off** | orchestration | Work leaves the current request for another session, and exactly one answer comes back later. A task whose assignee hands it off is one: the board tracks it until it's done. In Workforce, a hand-off to one of your workers is a delegation. | Dispatch, task |

*Amended after merge (epic [D10](../../epics/FIX-1786/DECISIONS.md#d10)):* the glossary gains
Hand-off here and Delegation in the Workforce section, and Delegate says what it means for any
worker. "Ask", a hand-off that waits for its answer, enters with the follow-up epic that builds it,
[FIX-1815](https://linear.app/fixpoint-labs/issue/FIX-1815); the glossary defines only what has
shipped (BR-17).

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
> | **Delegate** | workforce | A worker a conversation may delegate to. A worker's file lists its delegates under `delegates:`, and each conversation starts from that list. Always on the same user's roster; each works in its own session. | Worker |
> | **Delegation** | workforce | Handing work to one of your delegates: a hand-off to a worker on your roster, checked against your roster. A coordinator delegates a question as a post; any worker with a delegate that takes tasks delegates a task. See [Delegating work](./workforce/delegating-work.md). | Hand-off, roster |
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

## UPDATE · `apps/docs/docs/orchestration/task-board.md` · the board's seat, and Workforce's lines

The page's seat becomes assignee ([D1](DECISIONS.md#d1)). "Seats that hand off" becomes
"Assignees that hand off", anchor `#assignees-that-hand-off`, and every link to
`#seats-that-hand-off` follows: the page's own, and `server/background-work.md` on `main`. A
registry seat is an assignee, "Single uniform worker" is one worker for every assignee, and
`defaultWorker` is the default assignee. Its section "A board a mailbox holds" imports
Workforce: it goes with the mailbox (FIX-1792), or, if it is still there, moves to the Workforce
pages in the new terms. Any other line where a seat means a Workforce worker says worker.

The same goes for the board's seat elsewhere: `orchestration/agents.md`'s tool seats are tool
assignees and `orchestration/configuration.md` names the renamed fence, where those lines outlive
FIX-1814; `fundamentals/flows.md`'s "a seat on a task board" is an assignee, and the orchestration
README's "Handing tasks off through a dispatcher seat" says assignee. `skills/delegation.md` is
not renamed or kept: FIX-1814 deletes it with skill sub-agents, and with it the only page that
used "delegation" for skills (*amended after merge*, epic [D10](../../epics/FIX-1786/DECISIONS.md#d10)).

## UPDATE · `apps/docs/docs/orchestration/discovery.md` · description and opening

> One tool call that tells an agent what is in scope for it right now: the workers it can hand
> work to, the skills it can load, and the resources it can read.

The **seat** definition goes; a **worker** links to the glossary. The `seats` domain is now
`workers` ([D4](DECISIONS.md#d4)), in the examples and in `discover:`; the `mailboxes` domain and
its definition are FIX-1792's. The domain list is read off the tool at publish.

## PUBLISH · `apps/docs/docs/workforce/overview.md` · the opening

The epic's draft ([epic DOCS.md](../../epics/FIX-1786/DOCS.md#update--appsdocsdocsworkforceoverviewmd--opening-and-what-a-workforce-app-looks-like))
is canonical and not copied here. Publish it in P2, with Q2's answer (private projects in), no
library lines, and each sentence checked against `main`.

## Every other page

A sentence that uses a retired term keeps its meaning with the new term: no section is added,
moved or removed. Those pages are not copied here. On Workforce's pages, "person" says user where it
means the signed-in user, and stays where it means someone else.

## Ownership

Every operation here is FIX-1796's. The per-page Workforce prose is each child's own
([epic DOCS.md](../../epics/FIX-1786/DOCS.md#ownership)); this issue only changes its words.
