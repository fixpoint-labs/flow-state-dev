# FIX-1788 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

FIX-1788 publishes the specifics the epic's [ownership table](../../epics/FIX-1786/DOCS.md#ownership)
gives it: standard and non-standard workers, forking, and a session's worker. The shared
opening is the epic's, published by FIX-1796. Quoted prose follows the outsider rule
([`user-docs.md`](../../../docs/contributing/user-docs.md)). Names in it that `PLAN.md` doesn't
pin (the session-state option, the upgrade command, `fork`) are reconciled with the shipped
code before publishing. Q1's answer sets one sentence, marked below.

## UPDATE · `apps/docs/docs/configuration/flow.md` · the `session` table, a new row after `client`

> | `serverOwned` | `string[]` | none | Session-state fields only your flow's code writes. Creating a session with a value for one is refused with a 400 that names the field. Use it for anything that decides what a session may do, such as which worker it runs. |

## UPDATE · `apps/docs/docs/fundamentals/state-and-scopes.md` · "Creating sessions", a new last paragraph

> A caller can pass initial `state` when it creates a session. That suits preferences and
> drafts, and it is the wrong place for a value that grants anything: the caller wrote it.
> Declare such fields in `serverOwned`. The create then refuses a value for them, and only a
> block in your flow can set them, from something it checked.

## REPLACE · `apps/docs/docs/workforce/durable-hire.md` · the whole page

Title *Hiring, forking and firing workers*, sidebar label *Hiring and forking*. Everything from
"What the framework gives you" to "Limits" is replaced by:

> # Hiring, forking and firing workers
>
> A worker your installation's files declare is a **standard worker**: every user has it, and
> nobody can change it while the app runs. Everything else a user adds is a worker of their
> own, stored in their data, and nobody else can see it.
>
> ## Hiring a worker
>
> A hire writes one row to the user's roster, in the organization they're signed in to. Nothing
> is registered and nothing restarts: the next turn on any of your processes can use it.
>
> ```ts
> import { createSeatHireBlocks } from "@flow-state-dev/workforce"
>
> const { hire, fork, fire } = createSeatHireBlocks({ kinds })
>
> defineFlow({
>   kind: "roster-admin",
>   actions: { hire: { block: hire }, fork: { block: fork }, fire: { block: fire } },
> })
> ```
>
> `hire` takes an id, the flow the worker runs on, and its settings, the same keys a
> `WORKER.md` accepts. The worker's flow checks the settings when the row is saved. A bad
> value, a flow your installation doesn't run workers on or keeps for standard workers, or an id
> already on the user's roster
> is refused, and nothing is written. An id can't be a standard worker's: fork it instead.
>
> ## Forking a standard worker
>
> `fork` starts a new worker of the user's own from a standard worker's configuration, under a
> new id. The standard worker doesn't change, for this user or anyone else. *(Q1: the fork
> keeps a copy of the standard worker's instructions, and doesn't change when your
> installation's files do. Fork again to pick up a change.)*
>
> ## Firing a worker
>
> `fire` deletes the row. Its past sessions stay readable to their owner. A new message to one
> is refused with the worker named as fired. Every process sees the fire on the next turn.
>
> ## Who can reach a worker
>
> Only its owner. A worker belongs to one user in one organization: another member can't list
> it, open its sessions, send it a message or name it in a session of their own. A user who
> belongs to two organizations has a separate roster in each.
>
> ## What is stored
>
> Each worker the user hires or forks is one row in their user scope at `workforce/workers/<id>`.
> A standard worker isn't stored: it is read from your files each time, so a deploy that changes
> a file changes it for everyone. What a worker remembers is kept per worker, so two of one
> user's workers never read each other's notes.
>
> ## After a hire, refresh the roster
>
> A turn that hires, forks or fires names the roster as a collection it wrote, so a view that
> listens for written collections reloads it. You don't need to watch for a tool's name.

## UPDATE · `apps/docs/docs/workforce/workers-on-disk.md` · "Hiring the roster", opening paragraphs

> Every `WORKER.md` is a **standard worker**. Every user of every organization in the
> installation has it, configured exactly as the file says, and nobody can edit it while the app
> runs. To change one for yourself, [fork it](./durable-hire.md#forking-a-standard-worker).
>
> Each flow a worker names runs as one copy, shared by every worker that names it. A hundred
> workers on `agent` are one registered flow, not a hundred. What makes them different is their
> configuration, which the flow reads on each turn, and their memory, which is kept per worker.

## UPDATE · `apps/docs/docs/workforce/workers-on-disk.md` · a new section "Talking to a worker", before "What this does not do"

> ## Talking to a worker
>
> Send to the flow the worker runs on, and name the worker:
>
> ```ts
> await client.actions("agent").sendAction("run", { message, worker: "researcher" }, { sessionId })
> ```
>
> The first message links the session to that worker. The server checks the worker is yours or
> a standard one and that it runs on this flow, then records the link where callers can't write
> it. Later messages can leave `worker` out. Naming a different worker on a linked session is
> refused: start a new session instead. A worker that isn't yours is refused with the same answer
> as one that doesn't exist.
>
> Tasks and messages your other workers hand to this one open sessions the same way, through
> the same check.

## UPDATE · `apps/docs/docs/persistence/overview.md` · after "Upgrading: moving hired seats' stored data", a new section

> ## Upgrading: hired workers become worker rows
>
> Run this once after deploying a version where workers are stored per user, together with the
> step in [Which organization a record belongs to](#which-organization-a-record-belongs-to).
> Until it runs, hires made on the earlier version don't run, and the app's start reports how
> many are waiting.
>
> ```bash
> fsdev workforce upgrade-workers --store "$DATABASE_URL"
> ```
>
> - A worker one user hired becomes that user's worker, with its memory and its conversations.
> - A worker hired for a whole organization becomes a private copy for each member who has a
>   conversation with it, with that member's conversations and a copy of its memory. Members
>   who never used it get none.
>   Each copy then changes on its own.
> - A worker whose id its new owner already uses comes across under a new id, and the report
>   names both.
> - A worker whose flow your app no longer runs is reported and left where it is.
>
> Nothing is deleted. The earlier rows stay, and running the step again changes nothing it
> already moved.

## UPDATE · `packages/workforce/README.md` and `packages/engine/README.md`

> **workforce:** A worker is a row in its owner's data, run by one shared copy of the flow it
> names. `hire`, `fork` and `fire` write it; a session names its worker on its first message.
>
> **engine:** `session.serverOwned` names session-state fields the session create refuses.

## Publication ownership

FIX-1788 publishes these with P4, after its checks pass. `built-in-worker.md` is FIX-1789's;
the overview opening and the glossary are FIX-1796's. FIX-1790 owns the persistence page's org
section; the new section above sits beside it and links to it.
