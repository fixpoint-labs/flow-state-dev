---
title: Workers
sidebar_label: Workers
description: "A worker is a named agent with a job and an owner. Standard workers come from your files; users hire, fork, edit and fire workers of their own."
---

import Figure from "@site/src/components/Figure";
import RosterDrawing from "./figures/roster.svg";

# Workers

A **worker** is an agent with a name, a job and an owner. You brief it in a Markdown file, the way you would brief a new colleague: what it's for, which model it uses, what it can reach.

```md title="workforce/teams/support/workers/triage/WORKER.md"
---
description: Reads each new ticket and says who should take it.
model: openai/gpt-6-luna
---
You triage support tickets. Say whether each one is a bug, a billing
question or a feature request, and who on the team should take it.
```

That file is a whole worker. The workforce kit reads the `workforce/` folder when your app starts, and the worker's id comes from where the file sits: this one is `support.triage`, the `triage` worker on the `support` team. A worker that belongs to no team lives under `workforce/org/workers/<name>/` and goes by its folder name alone.

Users talk to a worker, or hand it a task and come back later.

## A worker and an agent

In most frameworks an agent is a model in a loop that calls tools. Flow State has that piece, and it's a generator block with tools. A worker sits one level up. It is a configuration with an owner: its instructions, its model, its skills and tools, and the flow it runs on.

- **A worker runs on a flow.** A worker file that names no `flow:` runs on the built-in `agent` flow, which turns the file's body into instructions and talks. Name a flow of your own and the worker runs on that instead, which can be a fixed pipeline with no model in it at all. One roster can mix both.
- **A worker has an owner.** It works for one user and acts as them. Nobody else can open its sessions, send it a message, or read what it remembers.
- **A worker keeps its sessions.** Each conversation with it is a session, and so is each task it takes. They are stored, so a conversation is there tomorrow.

A task board's `workers` option is a different thing with a similar name: there, each entry is a block the board can hand a task to. A task can also name one of your workers by id, and the board then runs it in a session of that worker. [Tasks and boards](./tasks-and-boards) covers the board's side.

## Talking to a worker

To talk to a worker, open a session with it and send a message to its `respond` action. The workforce client finds the session or makes one:

```ts
import { createClient } from "@flow-state-dev/client";
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";

const fsd = createClient({ userId, baseUrl });
const workforce = createWorkforceClient(fsd);

const session = await workforce.ensureWorkerSession({ worker: "support.triage" });
await fsd
  .flow(session.flowKind)
  .send("respond", { message: "A customer says they were charged twice." }, { sessionId: session.id });
```

The worker sees the recent turns of the conversation it's in. Nothing said there reaches any other conversation.

## Standard workers and your own

A user's roster holds the standard workers and the user's own.

<Figure svg={RosterDrawing} caption="One user's roster" description={"A user's roster holds two kinds of worker. Standard workers are read from the WORKER.md files in the app's workforce folder: every user has them and they are the same for everyone. The user's own workers are rows in that user's data, and nobody else can reach them. Hire adds a new worker of the user's own. Fork copies a standard worker, or one of the user's own, under a new id. Edit changes one of the user's own workers. Edit on a standard worker makes the user's own copy under the same id, which their turns read instead of the file. Reset deletes that copy so the file is read again. Fire deletes one of the user's own workers. A standard worker can't be fired."} />

A **standard worker** comes from a file in your `workforce/` folder. Every user has it and it's the same for everyone. Change the file and redeploy, and every user who hasn't edited it gets the change.

One file gives each user a worker of their own. Alice and Bob both have the standard `support.triage`, and those are two workers, not one: Alice's answers for Alice, and Bob can't open her sessions with it, hand it work, or read what it remembers about her.

A **user's own worker** is one they hired or forked while the app runs. It's a row in their data, not a file. Every process sees it on the user's next turn, nothing restarts, and no other user can reach it. A user who belongs to two organizations has a separate roster in each.

## Hiring, forking, editing and firing

The workforce client carries one method for each change a user makes to their roster:

```ts
// A new worker of your own. `flow` defaults to "agent".
await workforce.hire({ id: "scribe", instructions: "Take short notes." });

// Your own copy of a standard worker, under a new id.
await workforce.fork("support.triage", "my-triage");

// Replace the fields you give.
await workforce.edit({ id: "my-triage", instructions: "Flag anything that mentions a refund." });

// Remove a worker of your own.
await workforce.fire("scribe");
```

Each one checks the change before it writes anything. If it's refused, nothing is written and the promise rejects with the reason, such as an id already on the roster or a setting the worker's flow doesn't accept.

**Hire** adds a worker under a new id, with its instructions, description, skills and settings: the same keys a `WORKER.md` takes. Its id can't be a standard worker's.

**Fork** starts a new worker from another one's configuration: its flow, description, instructions, skills and settings. The copy is a snapshot. A later change to the file doesn't reach it, so fork again to pick one up. A fork starts with no conversations.

**Edit** replaces each field you give and leaves the rest. The worker's next turn reads the change. A turn that's already running finishes with what it started with. An edit that moves the worker to another flow leaves its earlier conversations on the old one, where new messages are refused: start a new conversation to talk to it on the new flow.

Edit works on a standard worker too. The first edit copies the worker onto the user's own roster under the same id and applies the change there. From then on, that user's turns read their copy, and every other user gets the file. The copy keeps its conversations and the file's flow. To go back to the file, call `workforce.reset(id)`, which deletes the copy.

**Fire** deletes a worker of the user's own. Its past conversations stay readable to their owner, and a new message to one is refused, naming the worker as fired. A task assigned to a worker that was fired before the task ran fails, and the conversation that filed it hears so. A standard worker can't be fired: it comes from your files, so take it out of the folder instead.

A user can also ask a worker to do these things for them. Hire, fork, edit, reset and fire are also blocks, so a worker built to manage the roster can be handed them as tools.

## Keeping a roster on screen

A hire can come from another tab, another device or a worker's own turn, so a screen that lists workers should follow the roster rather than read it once. The roster is a view: an answer the server computes for a screen and recomputes when something it read changes.

```tsx
import { useView } from "@flow-state-dev/react";
import { rosterView } from "@flow-state-dev/workforce/browser";

function Roster() {
  const { value: workers } = useView(rosterView);
  if (workers === undefined) return <p>Loading…</p>;
  return (
    <ul>
      {workers.map((w) => (
        <li key={w.id}>{w.name ?? w.id}{w.standard ? " (standard)" : ""}</li>
      ))}
    </ul>
  );
}
```

Each row names the worker's id, its flow and whether it's standard. A standard worker the user has edited is listed once, as their copy.

## What a worker won't do

- It never acts for anyone but its owner.
- Users don't message each other's workers. To work together, they share a project, which has its own page.
- Hiring writes no files. Your `workforce/` folder stays exactly as you wrote it.

## Next

- [Tasks and boards](./tasks-and-boards): how a task reaches a worker and how it ends.
- The `WORKER.md` reference lists every key a worker file takes.
