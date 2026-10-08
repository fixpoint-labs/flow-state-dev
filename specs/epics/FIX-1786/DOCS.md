# FIX-1786 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

The shared story, written once, and who publishes each specific. Proposed reader-facing prose
follows the outsider rule ([`user-docs.md`](../../../docs/contributing/user-docs.md)): it says
what Workforce does, never what it used to do. Each child's own `DOCS.md` carries its specifics.

## UPDATE · `apps/docs/docs/workforce/overview.md` · opening and "What a Workforce app looks like"

> # Workforce
>
> `@flow-state-dev/workforce` gives each user a roster of workers: agents, or deterministic
> workflows, that work for that user and act as them.
>
> One rule covers who sees what: a worker's own state and your user data are private to you,
> while shared resources and org-scope data are shared with your org, and a flow writes to org
> scope only when its author built it to. Your workers, your private projects and every session
> are yours alone. A shared project and its workstream entries are shared, and each line
> written there names the user and the worker that wrote it.
>
> A **worker** is a configuration with an owner: its instructions, skills, tools, and the
> flow that runs it. Each worker names its own flow: the built-in agent, a coordinator, or a
> flow your app registers. A flow is registered once, and every worker that names it shares
> that copy. Each piece of work gets its own session: one per conversation, one per task, and one
> lasting session for a workstream it leads.
>
> Some workers are **standard**. Your installation's files define them, every user has them,
> and nobody can edit them. To change one for yourself, fork it: you get a worker of your own
> that starts from its configuration.
>
> A worker can hand work to other workers on your roster, its **delegates**. That is
> **delegation**, and every hand-over is checked against your roster. A **coordinator** is the
> worker built for it: it picks a delegate for each message by its own judgment, by best fit, in
> turn, or sends to everyone.

![Private and shared, one org and two users: each user's workers and private projects sit in their own private area; a channel, a shared project and the worker library sit in the shared area; standard workers come from the installation's files](figures/concept-1-private-and-shared.svg)

> For example, Alice and Bob each have the standard researcher. They are two workers, not
> one: Alice's answers for Alice, and Bob can't open her sessions, name her researcher as a
> delegate, or read what it remembers about her.
>
> **What this doesn't do.** Users don't message each other through Workforce, and there are
> no shared conversations between users yet. A worker never acts for anyone but its owner.

The figure ships as the docs' own SVG, redrawn from this concept figure. The library follows
the MVP, so the MVP release neither draws nor mentions it. When FIX-1795 ships, it adds the
library to the figure's shared area, "the org's worker library" to the shared list above, and
two sentences after forking: "You can also copy a template from your org's library. Your copy
doesn't change when the template does."

## UPDATE · `apps/docs/docs/workforce/projects.md` · opening

> A project is a body of work, private to you or shared with your org. A shared project is
> split into **workstreams**, and each workstream has one owner. The org sees each
> workstream's entry: its title, its owner, the worker leading it, its status and its
> objectives. Only the owner sees the tasks and the work behind them.
>
> You talk to a project through your own **project coordinator**: one session per user per
> project. It reads every workstream's status and routes what you ask to your own
> workstreams' leads. To get something from another member's workstream, read its entry or
> ask the member.
>
> Progress is computed from the workstreams each time you look, so nothing on the project
> row drifts from them. An entry nobody has updated for a while shows as stale.

## Ownership

| Material | Publisher | Specific draft |
|---|---|---|
| The overview opening and its figure | FIX-1796, once the assembled behaviour is verified | This document |
| Standard and non-standard workers, forking, a session's worker (`workers-on-disk.md`, `durable-hire.md`); narrowing what the model reaches on a turn (`resources/overview.md`) | FIX-1788 | Its `DOCS.md` |
| Which flows can run workers (`built-in-worker.md` → custom worker flows) | FIX-1789 | Its `DOCS.md` |
| Which org a user's record belongs to (`persistence/overview.md`) | FIX-1790 | Its `DOCS.md` |
| CREATE `coordinators.md`; the chief of staff page reworded | FIX-1791 | Its `DOCS.md` |
| REMOVE `mailboxes.md`. No upgrading page: there are no consumers to upgrade ([D9](DECISIONS.md#d9)) | FIX-1792 | Its `DOCS.md` |
| `projects.md` opening above; the room figures removed; `shift-manager/overview.md`'s Project view | FIX-1793 | Its `DOCS.md` |
| Giving a task to a worker, down the chain | FIX-1794 | Its `DOCS.md` |
| CREATE `delegating-work.md` ("Delegating work"): any worker files tasks for its delegates, and splits a task down the chain; the coordinators page's filing paragraph points there | FIX-1802 | Its `DOCS.md` |
| REMOVE `skills/delegation.md` (Skills → Delegation), and every line elsewhere that teaches skill sub-agents (`agents:`) | FIX-1814, which has no spec ([D10](DECISIONS.md#d10)) | Its PR |
| CREATE `library.md`; the library's lines in the overview opening and its figure | FIX-1795, with its build after the MVP | Its `DOCS.md` and the note above |
| `glossary.md` → the Workforce section, and assignee, defined once in the task-board section with no seat row ([D7](DECISIONS.md#d7)); `orchestration/task-board.md`'s seat, "Seats that hand off" among it, renamed assignee; every remaining retired term | FIX-1796 | Its `DOCS.md` |

Each specific publishes with its implementation. The overview opening waits until the
behaviour it promises is on `main`; it doesn't publish because this spec merged. No unchanged
page is copied here.

**One word per thing, on every page ([D10](DECISIONS.md#d10), ER-12).** "Delegation" means
Workforce's only: handing work to a worker on the user's roster, checked against that roster. A
page about orchestration says hand-off. "Mailbox" isn't used. Once FIX-1814 removes the Skills →
Delegation page, no published page uses "delegation" for skills.
