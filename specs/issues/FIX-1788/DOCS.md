# FIX-1788 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

FIX-1788 publishes the specifics the epic's [ownership table](../../epics/FIX-1786/DOCS.md#ownership)
gives it: standard and non-standard workers, forking, a session's worker, and narrowing what the
model reaches on a turn. The shared
opening is the epic's, published by FIX-1796. Quoted prose follows the outsider rule
([`user-docs.md`](../../../docs/contributing/user-docs.md)) and uses the new terms: worker,
worker flow, user.

| Shipped names | |
|---|---|
| **Pinned** ([PLAN.md](PLAN.md#pinned-names)) | a worker flow's readonly `workerId`, set with `createSession({ state })` and listed with `listSessions({ state })` · the roster's `flow` · `createWorkforceClient` and its methods `findWorkerSession` and `ensureWorkerSession`, with the criteria key `worker` · `workerFlows` (FIX-1789's) |
| **Published with P1** ([#2850](https://github.com/fixpoint-labs/flow-state-dev/pull/2850)) | `session.createCheck` · `session.serverOwned` · readonly `stateSchema` fields · `listSessions({ state })` · `fsdev run --seed-session` on a flow that binds its sessions |
| **Drafts**, reconciled with the shipped code before publishing | `createWorkerHireBlocks` · `fork` · the React hook `useWorkforce` · the per-turn resource visibility rule, named by P4 ([D7](DECISIONS.md#d7)) |

## Published with P1 · the session's starting state, readonly fields and the create check

P1 ([#2850](https://github.com/fixpoint-labs/flow-state-dev/pull/2850)) published these, so they
are no longer drafts here: the `session` table in `apps/docs/docs/configuration/flow.md`
(`stateSchema`'s readonly fields, `createCheck`, `serverOwned`), "Creating sessions" and
"Example: one session per project" in `apps/docs/docs/fundamentals/state-and-scopes.md`, and the
`state` option and filter in `apps/docs/docs/api/client.md`. A worker flow is that example with a
worker in place of a project; the pages below link to it rather than repeat it.

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
> a file changes it for everyone. On the built-in `agent` flow, what a worker remembers is kept per
> worker, so two of one user's workers never read each other's notes. On a flow you write, that is
> up to you: see [Where a worker's data lives](./workers-on-disk.md#where-a-workers-data-lives).
>
> ## After a hire, refresh the roster
>
> Read the roster again after each turn. A turn that hires, forks or fires changes it, and
> nothing tells you which tool ran, so you don't need to watch for a tool's name.

## UPDATE · `apps/docs/docs/workforce/workers-on-disk.md` · "Hiring the roster", opening paragraphs

> Every `WORKER.md` is a **standard worker**. Every user of every organization in the
> installation has it, configured exactly as the file says, and nobody can edit it while the app
> runs. To change one for yourself, [fork it](./durable-hire.md#forking-a-worker).
>
> Each flow a worker names runs as one copy, shared by every worker that names it. A hundred
> workers on `agent` are one registered flow, not a hundred. What makes them different is their
> configuration, which the flow reads on each turn, and, on `agent`, their memory, which is kept
> per worker.

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
> const mine = await sessions.listSessions({ flowKind: "agent", userId, state: { workerId: "researcher" } })
> const fresh = await sessions.createSession({ flowKind: "agent", userId, state: { workerId: "researcher" } })
> ```
>
> The server checks the worker when the session is created: it must be yours or a standard
> one, and it must run on this flow. A worker that isn't yours is refused with the same answer
> as one that doesn't exist. A session created without a worker is refused. `workerId` is a
> readonly field of the session's state: nothing can change it after the create. It works the way
> a project does in [Example: one session per project](../fundamentals/state-and-scopes.md#example-one-session-per-project).
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
> In React, `useWorkforce` gives you the same client. `useFlow` creates sessions with no starting
> state, so a worker's flow refuses them: find or start the session with the client, then make it
> the hook's active session.
>
> ```tsx
> const workforce = useWorkforce()
> const flow = useFlow({ flowKind: "agent" })
>
> const session = await workforce.ensureWorkerSession({ worker: "researcher" })
> flow.selectSession(session.id)
> ```
>
> Tasks and messages your other workers hand to this one open sessions the same way, naming the
> worker when the session is created.

## UPDATE · `apps/docs/docs/workforce/workers-on-disk.md` · "Where a worker's data lives", a new last part

> On one flow, a user's workers share that user's scope. The built-in `agent` keeps each worker's
> skills apart for you, with a skills library partitioned by worker. A worker flow you write doesn't: anything it keeps at user scope is shared
> by every one of that user's workers on the flow. It never reaches another user, whose data is
> kept apart.
>
> If each worker should keep its own, put the worker in the key. Load the worker at the start of
> the turn, then use its id:
>
> ```ts
> import { defineResourceCollection } from "@flow-state-dev/core"
> import { z } from "zod"
>
> // One row per worker, in the user's scope.
> const notes = defineResourceCollection({
>   pattern: "worker-notes/*",
>   scope: "user",
>   stateSchema: z.object({ text: z.string().default("") }),
> })
>
> // inside your flow's block, which declares `resources: { notes, ...installation.resources }`
> const worker = await installation.resolveWorker(ctx, "research")
> await ctx.resources.notes.upsert(worker.id, { text: "Prefers short answers." })
> ```
>
> Use the id `resolveWorker` returns rather than reading the session's state yourself: it is the
> worker the session was created with, checked on this turn. For skills, give your skills library a
> `partitionBy` that returns the session's `workerId`. A run it returns nothing for gets an empty
> catalog it can't write to, so a session with no worker never reads every worker's skills.

## UPDATE · `apps/docs/docs/resources/overview.md` · "LLM access patterns", a new last paragraph

The rule's real name replaces the description when P4 publishes.

> A flow can also narrow what the model reaches on a single turn. Give the turn a visibility rule,
> and the built-in resource tools, and any tool you build on them, treat a resource the rule hides
> as one that doesn't exist: it isn't listed, searched, read or written, and asking for it by its
> uri gets the same answer as asking for a missing one. With no rule, the model reaches what it
> reaches today. The rule decides what the model sees, not what your code does: a block that
> reads a resource by reference still reads it. Workforce sets the rule for you, so a worker's
> model reaches only the documents its `WORKER.md` grants, even when many workers share one flow.

## UPDATE · `packages/workforce/README.md`, `packages/engine/README.md`, `packages/client/README.md`

> **workforce:** A worker is a row in its owner's data, run by one shared copy of the flow it
> names. `hire`, `fork` and `fire` write it. A session names its worker when it is created;
> `createWorkforceClient(...).ensureWorkerSession` and `findWorkerSession` find or start one.
>
> **engine** and **client** were documented with P1: readonly session-state fields, the optional
> `session.createCheck`, `session.serverOwned`, and `listSessions({ state })`. Nothing more here.

## Publication ownership

FIX-1788 publishes these with P4, after its checks pass. `built-in-worker.md` is FIX-1789's;
the overview opening and the glossary are FIX-1796's. There is no upgrade section: nothing reads
a hire made before this release ([epic D9](../../epics/FIX-1786/DECISIONS.md#d9)).
