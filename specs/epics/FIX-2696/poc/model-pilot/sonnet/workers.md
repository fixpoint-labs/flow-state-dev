---
title: Workers
sidebar_label: Workers
type: concept
description: A worker is a named configuration with an owner: its instructions, skills, tools and the flow it runs on. Standard workers come from files; a user's own are hired, forked, edited and fired while the app runs.
---

import Figure from "@site/src/components/Figure";
import WorkersDrawing from "./figures/workers.svg";

# Workers

A worker is a name and a job, usually done by an agent. You brief it in a Markdown file, the way you would brief a new colleague: what it's for, what it can use, who it can ask for help.

You can talk to a worker, or hand it a task and come back later. What it learns about you stays with you. The people you work with have rosters of their own.

## A worker is a file

The `workforce` kit reads worker files from the `workforce/` folder of your app. A worker on a team lives at `workforce/teams/<team>/workers/<name>/WORKER.md`, and its id is `<team>.<name>`:

```md
---
description: Finds things out and cites where it found them.
model: openai/gpt-6-luna
---
You are the researcher. Answer from sources, and say which one.
```

The settings sit between the fences and the instructions follow. `description` is the only required key. To change what the worker does, you edit the file.

To talk to it, open a session that names the worker and send it a message:

```ts
const workforce = createWorkforceClient(fsd);
const session = await workforce.ensureWorkerSession({ worker: "engineering.researcher" });
await fsd
  .flow(session.flowKind)
  .send("respond", { message: "Where are we on the launch?" }, { sessionId: session.id });
```

## Worker or agent

An agent is a pattern: a generator with tools, looping until it has an answer. A worker is who you configure to do a job, and an agent is one way it can do it.

- A worker names the flow it runs on. With no `flow:` line, that is the built-in `agent` flow, which runs the worker's instructions as a generator with its tools and skills. A worker can name a flow you wrote instead, and that flow can be a deterministic workflow with no model in it.
- A worker belongs to one user. An agent belongs to nobody. It is code.
- Many workers share one copy of a flow. Each conversation with a worker, and each task it takes, gets a session of its own.
- A worker has an id that other things address: a conversation, a delegate list, a task's `assignee`.

## Standard workers and your own

A worker declared in your files is a **standard worker**. Every user has it, and it is the same for everyone. Nobody changes the file while the app runs.

Everything else a user adds is a worker of their own. It is a row in that user's data, in their organization, and nobody else can list it, open its sessions or send it a message. Alice and Bob both have the standard researcher, but those are two workers. Alice's answers for Alice, and Bob can't read what it remembers about her.

<Figure svg={WorkersDrawing} caption="Standard workers and a user's own" description={"Two columns. On the left, standard workers: files in your repo, such as the researcher, the same for every user, and not editable while the app runs. On the right, a user's own workers: rows in that user's data, such as my-researcher, reachable only by that user. An arrow labelled fork runs from the standard researcher to my-researcher, and hire adds a new row. Below both columns, every worker names a flow; here both run on the built-in agent flow, one shared copy. Each conversation or task is a session of that flow naming its worker."} />

## Hiring, forking, editing and firing

The `workforce` kit serves a roster flow, `workforce-roster`, with one action per verb. Send them like any other action:

```ts
const roster = fsd.flow("workforce-roster");
const { id: sessionId } = await roster.createSession();

await roster.send("hire", { id: "scribe", instructions: "Take short notes." }, { sessionId });
await roster.send("fork", { from: "researcher", id: "my-researcher" }, { sessionId });
await roster.send("edit", { id: "my-researcher", instructions: "Cite every source." }, { sessionId });
await roster.send("fire", { id: "scribe" }, { sessionId });
```

Each write lands on the user's next turn, on any process, with no restart.

- **Hire** adds a worker: an id, the flow it runs on (`agent` if you leave it out), and the same settings a `WORKER.md` takes. The flow checks the settings first. A bad setting, a taken id, or the id of a standard worker is refused, and nothing is written.
- **Fork** copies a worker's configuration into a new worker of your own, under a new id. The copy is a snapshot. When the file changes, the fork doesn't, and you fork again to pick the change up.
- **Edit** replaces the fields you give it. Edit a standard worker and you get your own copy under the same id with your change applied, so you see the edited one and everyone else keeps the file's version. A `reset` deletes your copy and the file's version comes back.
- **Fire** deletes a worker of your own. Its past sessions stay readable. A new message to one is refused, naming the worker as fired. A standard worker can't be fired.

A refused write changes nothing, and the action's request ends `failed` with the reason. `send` returns when the write starts, so wait for it to settle before a write that depends on it:

```ts
const forked = await roster.send("fork", { from: "researcher", id: "my-researcher" }, { sessionId });
const { status } = await forked.wait();
if (status !== "completed") throw new Error(`fork ${status}`);
```

A screen that lists workers should follow the roster instead of reading it once, because a hire can come from another tab or from a worker's own turn. `workforce.watchRoster` hands you the roster, then hands it again each time it changes.

## Giving a worker work

A [task's](./tasks-and-boards) `assignee` can name a worker by id. A worker on the built-in `agent` flow runs the task as one turn: its instructions and tools, the task's goal and context as the message, its answer as the task's result. A worker can hand work to other workers on the same roster, its **delegates**, and every hand-over is checked against that roster. A **coordinator** is the worker built for it. It picks a delegate for each message and files tasks on its conversation's board.

A task whose worker was fired before it ran fails, and whoever filed it hears so. No other worker picks it up.

## What it won't do

Workers don't act for anyone but their owner, and users don't message each other through them. Hiring at runtime writes no files: the `workforce/` folder stays as you wrote it, and a user's own workers live in their data.
