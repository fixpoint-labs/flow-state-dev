# FIX-1788 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

FIX-1788 publishes the specifics the epic's [ownership table](../../epics/FIX-1786/DOCS.md#ownership)
gives it: standard and non-standard workers, forking, and a session's worker. The shared
opening is the epic's, published by FIX-1796. Quoted prose follows the outsider rule
([`user-docs.md`](../../../docs/contributing/user-docs.md)) and uses the new terms: worker,
worker flow, user.

| Shipped names | |
|---|---|
| **Pinned** ([PLAN.md](PLAN.md#pinned-names)) | `worker` on `createSession` · `worker` on `listSessions` · the roster's `flow` · `createWorkforceClient` and its methods `findWorkerSession` and `ensureWorkerSession` · `workerFlows` (FIX-1789's) |
| **Drafts**, reconciled with the shipped code before publishing | `createCheck` and its `link` input · `serverOwned` · `createWorkerHireBlocks` · `fork` · the React hook `useWorkforce` · `useFlow`'s `worker` · `fsdev run --worker` · the upgrade command |

## UPDATE · `apps/docs/docs/configuration/flow.md` · the `session` table, two new rows after `client`

> | `createCheck` | function | none | Runs before a session of this flow is written, on every path that creates one: the create request, an action sent to a session id that doesn't exist yet, and a transport that opens sessions. It receives the verified caller and the create's `link` input. It refuses the create, or returns a value stored on the session that nothing can change afterwards. A create with no `link` input is refused. |
> | `serverOwned` | `string[]` | none | Session-state fields only your flow's code writes. Creating a session with a value for one is refused with a 400 that names the field. Use it for state that decides what a session may do and changes as it runs. |

## UPDATE · `apps/docs/docs/fundamentals/state-and-scopes.md` · "Creating sessions", a new last paragraph

> A caller can pass initial `state` when it creates a session. That suits preferences and
> drafts, and it is the wrong place for a value that grants anything: the caller wrote it. A
> value fixed for the session's life, such as which worker it runs, belongs to `createCheck`,
> which checks it before the session exists. A value your flow changes as it runs belongs in a
> `serverOwned` field: the create refuses a value for it, and only a block in your flow can set
> it.

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
> import { createWorkerHireBlocks } from "@flow-state-dev/workforce"
>
> const { hire, fork, fire } = createWorkerHireBlocks({ workerFlows })
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
> already on the user's roster is refused, and nothing is written. An id can't be a standard
> worker's: fork it instead.
>
> ## Forking a worker
>
> `fork` starts a new worker of the user's own from a standard worker's configuration, under a
> new id. The fork keeps a copy of the standard worker's instructions, and doesn't change when
> your installation's files do. Fork again to pick up a change. The standard worker doesn't
> change, for this user or anyone else.
>
> A fork starts with no conversations. The user's sessions with the worker they forked stay
> with that worker.
>
> ## Changing or firing a worker
>
> An edit to a worker reaches its next turn, in every session. If the edit moves the worker to
> a different flow, its earlier sessions stop taking messages, with both flows named: a session
> stays on the flow it was created on. Start a new session to talk to the worker on its new flow.
>
> `fire` deletes the row. Its past sessions stay readable to their owner. A new message to one
> is refused with the worker named as fired. Every process sees the fire on the next turn.
>
> ## Who can reach a worker
>
> Only its owner. A worker belongs to one user in one organization: another member can't list
> it, open its sessions, send it a message or create a session with it. A user who belongs to
> two organizations has a separate roster in each.
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
> runs. To change one for yourself, [fork it](./durable-hire.md#forking-a-worker).
>
> Each flow a worker names runs as one copy, shared by every worker that names it. A hundred
> workers on `agent` are one registered flow, not a hundred. What makes them different is their
> configuration, which the flow reads on each turn, and their memory, which is kept per worker.

## UPDATE · `apps/docs/docs/workforce/workers-on-disk.md` · a new section "Talking to a worker", before "What this does not do"

> ## Talking to a worker
>
> A conversation with a worker is a session, and a session runs one worker for its whole life.
> You name the worker when the session is created. Messages after that never name it.
>
> **1. Pick the worker.** The user's roster lists their own workers and the standard ones. Each
> entry names the flow it runs on, as `flow` (most run on `agent`).
>
> **2. Find or start the session.**
>
> ```ts
> import { createWorkforceClient } from "@flow-state-dev/workforce"
>
> const workforce = createWorkforceClient({ userId, baseUrl })
> const session = await workforce.ensureWorkerSession({ worker: "researcher" })
> ```
>
> `createWorkforceClient` takes the same options as `createSessionClient`. Its
> `ensureWorkerSession` returns the user's most recent session with that worker, and creates one
> if there isn't one. It looks up the worker's flow for you. Two calls at once get the same
> session, not two. If you move a worker to another flow, the next call starts a new session
> there. When you only want to check, `findWorkerSession` takes the same argument and returns the
> session or nothing.
>
> Both are built on the session client, which you can call directly. Use it to start a second
> conversation with the same worker:
>
> ```ts
> import { createSessionClient } from "@flow-state-dev/client"
>
> const sessions = createSessionClient({ baseUrl })
> const mine = await sessions.listSessions({ flowKind: "agent", userId, worker: "researcher" })
> const fresh = await sessions.createSession({ flowKind: "agent", userId, worker: "researcher" })
> ```
>
> The server checks the worker when the session is created: it must be yours or a standard
> one, and it must run on this flow. A worker that isn't yours is refused with the same answer
> as one that doesn't exist. A session created without a worker is refused. The link is stored
> where callers can't write it, and it never changes.
>
> **3. Talk to it.** An ordinary action on that session:
>
> ```ts
> import { createClient } from "@flow-state-dev/client"
>
> const agent = createClient({ flowKind: session.flowKind, userId, baseUrl })
> await agent.sendAction("run", { message }, { sessionId: session.id })
> ```
>
> In React, `useWorkforce` gives you the same client, and `useFlow` takes the worker, so it lists
> and creates only that worker's sessions:
>
> ```tsx
> const workforce = useWorkforce()
> const flow = useFlow({ flowKind: "agent", worker: "researcher", autoCreateSession: true })
> ```
>
> Tasks and messages your other workers hand to this one open sessions the same way, naming the
> worker when the session is created.

## UPDATE · `apps/docs/docs/persistence/overview.md` · a new section after the existing upgrade section for stored hire data

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

## UPDATE · `packages/workforce/README.md`, `packages/engine/README.md`, `packages/client/README.md`

> **workforce:** A worker is a row in its owner's data, run by one shared copy of the flow it
> names. `hire`, `fork` and `fire` write it. A session names its worker when it is created;
> `createWorkforceClient(...).ensureWorkerSession` and `findWorkerSession` find or start one.
>
> **engine:** `session.createCheck` checks a value at session create and stores it where nothing
> changes it; `session.serverOwned` names session-state fields the session create refuses.
>
> **client:** `createSession` takes `worker`, and `listSessions` filters by it.

## Publication ownership

FIX-1788 publishes these with P4, after its checks pass. `built-in-worker.md` is FIX-1789's;
the overview opening and the glossary are FIX-1796's. FIX-1790 owns the persistence page's org
section; the new section above sits beside it and links to it.
