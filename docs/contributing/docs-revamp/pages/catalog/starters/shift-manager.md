---
title: Shift Manager
type: catalog
description: "The browser app a Workforce team is worked through: asks, tasks, workstreams and projects in one tab."
---

import Figure from "@site/src/components/Figure";
import ALab from "./figures/a-lab.svg";

# Shift Manager

A team of AI workers is a folder of Markdown files and a server. Shift Manager is the browser app you work that team through: the questions the workers are waiting on you for, the tasks they are running, and the projects they belong to, all in one tab.

It stores nothing and knows nothing about your team. Every name on screen is read from the server while it runs, so one Shift Manager opens any team. That server is called a Lab: one `fsdev.config.mts` that default-exports a `FlowState` holding the team's workers. You point Shift Manager at the file. Run it from a folder with no config and no `--config`, and it stops with an error that tells you to pass one.

<Figure svg={ALab} caption="Shift Manager reads a Lab and keeps nothing" description={"On the left, a box for Shift Manager with four screens, Shift Coordinator, Inbox, Tasks and Projects, and a highlighted line saying it stores nothing of its own. An arrow labelled /api/flows runs right to a box for the Lab, one fsdev.config.mts. The Lab holds a FlowState default export, an org worker folder for the shift-coordinator, a support team worker folder for triage, an inventory of the organization's workers, and a hatched store, which outlives the request."} />

## Run it

Shift Manager is published to npm as `@flow-state-dev/shift-manager`. Install it in the project that holds your Lab's config, then point it at that config:

```bash title="terminal"
npm install @flow-state-dev/shift-manager
npx shift-manager --config ./fsdev.config.mts
```

It prints its address and opens it. The pages ship prebuilt, so there is nothing to compile. The [CLI reference](../../reference/cli.md) has the default address and port, which Node version it needs, how it finds a config when you leave out `--config`, and `--dev`, which restarts the Lab when you save a file.

Shift Manager builds nothing for the Lab, so the config has to default-export a server that is already set up: a `FlowState` with a store, a list of the organization's workers that the server reads when it starts (its *inventory*), and the user Shift Manager acts as, whose asks and sessions it shows. The [runtime reference](../../reference/runtime.md) says what each one needs.

## What you see

Shift Manager is research software. Several screens are placeholders that say what will fill them.

**Inbox** lists every approval and question a worker is waiting on you for, oldest first. Answer on the card, or reply to the worker beneath it. It lists asks in sessions you started and the runs those started, never another user's. It also lists asks from your workers' runs with no conversation; those you answer on the card alone, with no reply box.

**Tasks** lists every row on every board that isn't done, grouped by state, worker or workstream. Queued rows sit behind a toggle. Open one to see that worker's run as it happens, stop it with Interrupt, or follow it into the DevTool with *Open trace*.

**Projects** are shared with your organization or private to you. Each has a Stream tab for talking to its coordinator, a Workstreams tab, a Board of your own workstreams' tasks, and a Brief. [Projects](../workforce/projects.md) covers what a project is.

Roster, Messages, Routines, Usage and Settings sit beside these in the sidebar. A summary reading *as of 14:02* is not live; how and when the screens refresh is in the [Workforce reference](../../reference/workforce.md).

## The Shift Coordinator

Shift Manager opens on the Shift Coordinator: a summary of the asks waiting on you and the runs going, then your conversation with the worker named `shift-coordinator`. You declare it in the Lab's files, beside `teams/`:

```md title="workforce/org/workers/shift-coordinator/WORKER.md"
---
description: The user's one point of contact.
flow: agent
model: openai/gpt-6-luna
---
You are the Shift Coordinator for this Lab. Answer questions about who is working on what.
```

A Lab without one opens there too, with the summary and a line saying how to add one.

The Shift Coordinator is an ordinary worker your files declare. Shift Manager treats it differently from other workers:

- **Shift Manager finds it by name.** It opens on it, and shows it as "Shift Coordinator" wherever it names a worker.
- **The summary above it is Shift Manager's own.** It counts the asks waiting and the runs going, and each ask has the same Approve and Reject as Inbox. Answering one there clears it from Inbox.

Shift Manager gives it no tools of its own. A worker can hire and fire only if its own file names `hire` and `fire`; what they do is in the [Workforce reference](../../reference/workforce.md). A fire removes the worker at once; it waits for your approval only if the app wraps the tool in an approval step of its own.

You have one conversation with it, and your first line opens it. It answers you directly. To have it hand work to other workers, give it the coordinator flow; see [Coordinators](../workforce/coordinators.md).

## Your own keys

A project's coding runs (workers that edit code in their own copy of a repository) can be given tools beyond that copy, such as Linear, through MCP, the Model Context Protocol. Settings, in the sidebar, is where you give the Lab your key for each one. It lists each MCP server the Lab offers and whether you have set a key, with the date.

Paste a key to set it, paste another to replace it, or clear it. The page never shows a key back, so keep your own copy. A run you ask for uses your key. The run can call the server's tools but never sees the key.

A project also has to name the server before its runs get it, and a run says in its session when you have no key. A key is stored as you wrote it, so [where it lives](../../reference/stores.md) decides who can read it.

If Settings lists no servers, the Lab's host may not serve the key endpoints; the [HTTP API reference](../../reference/http-api.md) says which hosts do.

## Next

- [Coordinators](../workforce/coordinators.md): hand a conversation's work to other workers.
- [Projects](../workforce/projects.md): workstreams, project coordinators and the servers a project names.
- [Workforce reference](../../reference/workforce.md): what Shift Manager reads from a Lab, what it shows when something is missing, and how a project names an MCP server.
- [Harness runs reference](../../reference/harness-runs.md): which coding agents get a project's servers, and why a coding agent's own sign-in is set on the machine, not in Settings.
- [Standing rules](../workforce/standing-rules.md): the notes the Shift Coordinator keeps for you.
