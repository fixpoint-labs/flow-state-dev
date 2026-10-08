---
title: Hiring, forking and firing workers
sidebar_position: 11
sidebar_label: Hiring and forking
description: "A user's own workers: hire one, fork a standard worker, edit or fire it. Each is a row in the user's data, seen by every process on the next turn, and nobody else can reach it."
---

# Hiring, forking and firing workers

A worker your installation's files declare is a **standard worker**: every user has it, and
nobody can change it while the app runs. Everything else a user adds is a worker of their own,
stored in their data, and nobody else can see it.

## Hiring a worker

A hire writes one row to the user's roster, in the organization they're signed in to. Nothing is
registered and nothing restarts: the next turn on any of your processes can use it.

`hireWorkforce` registers a roster flow, `workforce-roster`, beside your worker flows. It carries
four actions: `hire`, `fork`, `edit` and `fire`. Send them as you would any action, in a session
of that flow:

```ts
import { createClient, createSessionClient } from "@flow-state-dev/client"

const sessions = createSessionClient({ baseUrl })
const { id: sessionId } = await sessions.createSession({ flowKind: "workforce-roster", userId })

const roster = createClient({ flowKind: "workforce-roster", userId, baseUrl })
await roster.sendAction("hire", { id: "scribe", flow: "agent", instructions: "Take short notes." }, { sessionId })
```

`hire` takes an id, the flow the worker runs on (`agent` when you leave it out), and its
settings, the same keys a `WORKER.md` accepts. The worker's flow checks the settings when the row
is saved. A bad value, a flow your installation doesn't run workers on or keeps for standard
workers, or an id already on the user's roster is refused, and nothing is written. An id can't be
a standard worker's: fork it instead.

The same four writes are blocks, from `createWorkerHireBlocks(installation)`, if you'd rather
mount them on a flow of your own or hand them to a model as tools:

```ts
import { createWorkerHireBlocks } from "@flow-state-dev/workforce"

const { hire, fork, edit, fire } = createWorkerHireBlocks(installation)
```

## Forking a worker

`fork` starts a new worker of the user's own from another worker's configuration, under a new id:

```ts
await roster.sendAction("fork", { from: "researcher", id: "my-researcher" }, { sessionId })
```

The fork keeps a copy of the standard worker's instructions, and doesn't change when your
installation's files do. Fork again to pick up a change. The standard worker doesn't change, for
this user or anyone else.

A fork starts with no conversations. The user's sessions with the worker they forked stay with
that worker.

## Changing or firing a worker

`edit` replaces each field you give it. The edit reaches the worker's next turn, in every
session. If the edit moves the worker to a different flow, its earlier sessions stop taking
messages, with both flows named: a session stays on the flow it was created on. Start a new
session to talk to the worker on its new flow.

`fire` deletes the row. Its past sessions stay readable to their owner. A new message to one is
refused with the worker named as fired. Every process sees the fire on the next turn.

## Who can reach a worker

Only its owner. A worker belongs to one user in one organization: another member can't list it,
open its sessions, send it a message or create a session with it. Asking for another user's
worker gets the same answer as asking for one that doesn't exist. A user who belongs to two
organizations has a separate roster in each.

## What is stored

Each worker the user hires or forks is one row in their user scope at `workforce/workers/<id>`.
A standard worker isn't stored: it is read from your files each time, so a deploy that changes a
file changes it for everyone. On the built-in `agent` flow, what a worker remembers is kept per
worker, so two of one user's workers never read each other's notes. On a flow you write, that is
up to you: see [Where a worker's data lives](./workers-on-disk.md#where-a-workers-data-lives).

## After a hire, refresh the roster

Read the roster again after each turn. A turn that hires, forks or fires changes it, and nothing
tells you which tool ran, so you don't need to watch for a tool's name.

```ts
import { createWorkforceClient } from "@flow-state-dev/workforce/browser"

const workforce = createWorkforceClient({ userId, baseUrl })
const workers = await workforce.roster()
// [{ id: "scribe", flow: "agent", standard: false, description: null },
//  { id: "researcher", flow: "agent", standard: true, description: "Finds things out." }]
```

To talk to one, see [Talking to a worker](./workers-on-disk.md#talking-to-a-worker).
