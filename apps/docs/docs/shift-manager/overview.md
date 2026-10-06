---
title: Shift Manager
sidebar_label: Overview
description: "The browser app you run a Workforce team through. Point it at a Lab's config and work the team's asks, tasks, workstreams and projects in one tab."
---

# Shift Manager

Shift Manager is the browser app you run a [Workforce](../workforce/overview.md) team through. A team is served as a **Lab**: one `fsdev.config.mts` that default-exports a `FlowState` holding the team's workers and mailboxes. You point Shift Manager at that config, and it shows what the Lab holds.

It knows nothing about any particular Lab. Every name on screen is read from the Lab while it runs. The [glossary](../glossary.md#shift-manager-screens-over-a-workforce) lists its terms and what each screen reads.

It is research software. Several screens are placeholders that say what will fill them. It is published to npm as `@flow-state-dev/shift-manager`. The pages ship built, so there is nothing to compile.

## Run it

Install it in the project that holds your Lab's config, then point it at that config:

```bash
npm install @flow-state-dev/shift-manager
npx shift-manager --config ./fsdev.config.mts
```

Without `--config`, it looks for `fsdev.config.ts` (or `.mts`, `.js`, `.mjs`) in the current directory, the way `fsdev dev` does. It prints its address, `http://127.0.0.1:4300` by default, and opens it. One process serves the Lab's API under `/api/flows`, Shift Manager's pages, and the [DevTool](../devtool/overview.md) over the same Lab on a port of its own.

| Option | Default | What it does |
|--------|---------|--------------|
| `--config <path>` | `fsdev.config.*` in the current directory | The Lab's config. A relative path resolves from where you ran the command. |
| `--port <n>` | `4300` | `0` picks a free port. |
| `--host <host>` | `127.0.0.1` | A non-loopback host is refused unless the Lab authenticates requests, and always refused for a Lab that hands its page a bearer token. |
| `--shift <day\|night>` | `SHIFT_MANAGER_SHIFT`, else unset | Start on the light (`day`) or dark (`night`) look. Unset, the page follows your OS. |
| `--dev` | off | Restart the Lab when you save one of its files. See below. Loopback only. |
| `--assets <dir>` | the built pages in the package | Serve a different build of the pages, as it is. |
| `--no-open` | opens | Don't open the browser. |

The process runs from the directory you started it in, so a Lab's relative paths, such as a SQLite file, land where they would under `fsdev dev`. A config that doesn't load, or doesn't default-export a `FlowState`, stops the command with the loader's message.

If the DevTool's pages aren't installed, Shift Manager still starts, says so, and turns *Open trace* off. Install `@flow-state-dev/devtool` to get them.

### While you edit your Lab

Add `--dev` and leave it running. When you save a file your Lab loaded, a flow module or a file under the config's folder such as a `WORKER.md`, the Lab restarts by itself and the page reloads. Saving something the Lab didn't load, or its data file, does nothing.

If the Lab fails to start after a save, the error prints and Shift Manager waits for the next save. A restart is a new process: a Lab with in-memory stores starts empty each time, so use SQLite if you want your data to survive edits.

### Working on Shift Manager itself

In this repository, `pnpm --filter @flow-state-dev/shift-manager dev` runs the `devteam` profile with `--dev`. From a checkout, `--dev` also serves Shift Manager's pages from source, so a change to a screen shows as you save it. `start` runs the same profile on the built pages, and builds them first when they're older than their source.

To open another Lab from a checkout, pass its config:
`pnpm --filter @flow-state-dev/shift-manager dev --config ../my-lab/fsdev.config.mts`.

### The `devteam` profile

`devteam` is the team profile in this repository, at `teams/devteam/fsdev.config.mts`. It isn't in the published package, because it builds on the repository's own test Labs. It's a software team: an EM worker files features as rows on the team's board, and a coder worker runs each row as a supervised coding run. On start the EM asks you to approve one feature, so Inbox has something in it. Two projects exist from the start, Storefront and Platform.

Rows run on a scripted harness with no model. Set `DEVFORCE_LAB_HARNESS=claude-code` to run them on Claude Code instead. The Lab keeps its data in SQLite at `packages/shift-manager/.fsdev/devteam.sqlite`, or wherever `DEVTEAM_STORE` points. Delete the file to start fresh.

## What you see

These are Shift Manager's own screens and words. Where one maps onto a Workforce concept, the link goes to the package docs.

| Screen | What it is |
|--------|------------|
| **Shift Coordinator** | Where Shift Manager opens. A summary of the asks waiting on you and the runs going, then your conversation with the Lab's [chief of staff](../workforce/chief-of-staff.md). Without one, you get the summary and a line saying how to add one. |
| **Inbox** | Every approval and question a worker is waiting on you for, oldest first. Answer on the card, or reply to the worker under it. Inbox is not a [mailbox](../workforce/mailboxes.md). |
| **Tasks** | Every row on every board that isn't done, grouped by state, worker or workstream. Queued rows are behind a toggle. |
| **Roster** | Every worker, grouped as on shift (running a task), on call (waiting on you), or off shift. |
| **A workstream** | A declared [mailbox](../workforce/mailboxes.md) and the boards it holds, the same workstream a [project](../workforce/projects.md) groups. Tabs: Stream (the transcript, which you can post to), Board, Brief (the mailbox's charter) and Results. |
| **A project** | Groups workstreams and has one room its members share. Tabs: Stream (the room), Board, Workstreams and Brief. See [Projects](../workforce/projects.md) and [A room or a mailbox](../workforce/projects.md#a-room-or-a-mailbox). |
| **A task** | One worker's run, live, with Interrupt to stop it. *Open trace* opens the run's session in the DevTool (see [Opening a session from a link](../devtool/overview.md#opening-a-session-from-a-link)). |

The sidebar lists the projects with their workstreams under PROJECTS, then the teams under TEAMS. Workstreams that no project lists sit under **No project**. Jump to (⌘K) finds workstreams, workers, tasks and the Lab's readable documents.

A board has five columns: QUEUED, RUNNING, IN REVIEW, NEEDS YOU and DONE. In a workstream's composer, a message that starts with `@` and a worker's name goes to that worker's task in the workstream, not to the mailbox.

The switch at the bottom of the sidebar flips between Day shift (light) and Night shift (dark). Your pick is kept in that browser and wins over `--shift`.

For the components behind screens like these in your own app, see [Workforce components](../workforce/ui.md).

## What a Lab's config provides

Shift Manager reads a Lab only through the routes its `FlowState` serves. It builds nothing for the Lab, so the config has to export a server that is already set up:

- **A `FlowState` as the default export**, with a store. `inMemoryStores()` gives an empty Lab on every start. Use `sqliteStores` or `postgresStores` to keep what it holds across restarts.
- **An organization**, named by `resolvePrincipal` on `createFlowState`. Without one, the Lab runs in the development organization, `DEFAULT_ORG_ID`.
- **Open mailboxes.** Call `openMailboxes` at boot with the same `userId` you set in `devtool: { userId }`. Each mailbox is a workstream.
- **An open [inventory](../workforce/inventory.md)**, which TEAMS, PROJECTS, Inbox and the boards read. Without it, TEAMS and PROJECTS say there's none and the rest loads.
- **Who Shift Manager reads as**: `devtool: { userId }` on `createFlowState`, plus `bearerToken` when your resolver checks one. Shift Manager hands these to the page only on a loopback host.
- **Optionally, a chief of staff**: a worker named `chief-of-staff` on the built-in `agent` kind, declared under `org/workers/`. See [The chief of staff](../workforce/chief-of-staff.md).

A document under a `resources/` folder shows in Jump to only when its frontmatter sets `client.content.read: true`.

## Not there yet

Several parts are drawn as named empty states or disabled controls:

- On a task: Hand off, reassign and Open PR are disabled. Diff, Checks, acceptance criteria, reviewer, harness, tokens and cost are empty.
- A workstream's Results tab, and the IN REVIEW column, are always empty.
- On call means waiting on you. A worker that only waits on a webhook or a schedule reads off shift.
- Roster matches a task to a worker by its assignee. A task whose assignee matches no single worker counts for no one.
