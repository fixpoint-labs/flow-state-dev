---
title: Shift Manager
sidebar_label: Overview
description: "The browser app you run a Workforce team through. Point it at a Lab's config and work the team's asks, tasks, workstreams and projects in one tab."
---

# Shift Manager

Shift Manager is the browser app you run a [Workforce](../workforce/overview.md) team through. A team is served as a **Lab**: one `fsdev.config.mts` that default-exports a `FlowState` holding the team's workers. You point Shift Manager at that config, and it shows what the Lab holds.

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
| `--shift <day\|evening\|night>` | `SHIFT_MANAGER_SHIFT`, else unset | Start on that theme. Unset, the page starts on the theme your clock calls for (see [Themes](#themes)). |
| `--dev` | off | Restart the Lab when you save one of its files. See below. Loopback only. |
| `--assets <dir>` | the built pages in the package | Serve a different build of the pages, as it is. |
| `--no-open` | opens | Don't open the browser. |

The process runs from the directory you started it in, so a Lab's relative paths, such as a SQLite file, land where they would under `fsdev dev`. A config that doesn't load, or doesn't default-export a `FlowState`, stops the command with the loader's message.

If the DevTool's pages aren't installed, Shift Manager still starts, says so, and turns *Open trace* off. Install `@flow-state-dev/devtool` to get them.

### While you edit your Lab

Add `--dev` and leave it running. When you save a file your Lab loaded, a flow module or a file under the config's folder such as a `WORKER.md`, the Lab restarts by itself and the page reloads. Saving something the Lab didn't load, or its data file, does nothing.

If the Lab fails to start after a save, the error prints and Shift Manager waits for the next save. A restart is a new process: a Lab with in-memory stores starts empty each time, so use SQLite if you want your data to survive edits.

### Working on Shift Manager itself

In this repository, `pnpm shift-manager:dev` opens the `fsd` profile: a Lab for working on this repository with Shift Manager itself. It has two projects from the start. **FSD** is the framework packages, and **Shift Manager** is this app. Both are shared with everyone in the Lab, and both point at this repository. Inbox is empty until a worker asks you something.

Ask the [Shift Coordinator](../workforce/shift-coordinator.md) for work on either project, and say which one, for example "on Shift Manager, make the empty Inbox say who to ask". A coding agent picks it up in a fresh worktree of your checkout, on a branch of its own. Before cutting that branch, the Lab fetches the upstream your `main` tracks, usually `origin/main`, and starts from whichever is newer, that upstream or your local `main`. So you don't need to pull first, and commits you haven't pushed are kept. Your own `main`, its files and your index aren't touched.

If your `main` and its upstream each have commits the other lacks, the run is refused before anything is made, and the refusal names both commits. Pull or rebase, or push, then ask again. If the fetch fails, because you're offline for instance, the run compares your `main` with the copy of its upstream you last fetched instead, and a warning prints where you started Shift Manager.

Review the work in that worktree, or from your checkout with `git log -p <branch> --not main main@{upstream}`. That shows only the run's commits, whichever of the two it started from. The branch stays checked out in its worktree, so git won't check it out a second time in yours.

Only those two projects get a worktree of your checkout. Apart from that fetch, the Lab reaches no git remote, so a coding run on a project you add yourself, even one on this repository, is refused, naming the repository, and nothing is cloned.

Open **Settings** and paste a Linear API key, and every coding run you ask for on either project can read and update Linear, as you. Each user sets their own. A run for someone who hasn't set one works without Linear and says so. For runs with nobody at the keyboard, such as a goal check or CI, `LINEAR_MCP_API_KEY` stands in for the Lab's own user until that user sets a key. An `MCP servers:` line at start says whether the Lab's own user has a key.

The coding agent is Claude Code. Sign in to Claude Code, or set `ANTHROPIC_API_KEY`, before you start. Without either, the Lab refuses to start and says so. To run the scripted coder (`stub`) instead, which writes one file and costs nothing, set `DEVFORCE_LAB_HARNESS=stub`. A `Coder:` line at start names the coder it started with. The Shift Coordinator answers on a model of its own, so its turns need `ANTHROPIC_API_KEY` or `AI_GATEWAY_API_KEY`.

The Lab keeps its data in SQLite at `packages/shift-manager/.fsdev/fsd.sqlite`, or wherever `FSD_STORE` points. Delete the file to start fresh.

`pnpm shift-manager:dev` runs with `--dev`, which serves Shift Manager's pages from source, so a change to a screen shows as you save it. `pnpm --filter @flow-state-dev/shift-manager start` runs the same profile on the built pages, and builds them first when they're older than their source. To open the `devteam` profile instead, pass its config, a path from the repository root:
`pnpm shift-manager:dev --config packages/shift-manager/teams/devteam/fsdev.config.mts`.

To open another Lab from a checkout, pass its config:
`pnpm --filter @flow-state-dev/shift-manager dev --config ../my-lab/fsdev.config.mts`.

### The `devteam` profile

`devteam` is the profile this repository's checks run against. Open it with `--config`, as above.

It's at `teams/devteam/fsdev.config.mts`. It isn't in the published package, because it builds on the repository's own test Labs. It's a software team: an EM worker files features as rows on the team's board, and a coder worker runs each row as a supervised coding run. On start the EM asks you to approve one feature, so Inbox has something in it. Three projects exist from the start: Storefront, with two workstreams, and Platform and Sandbox, with none.

Its [Shift Coordinator](../workforce/shift-coordinator.md) is a coordinator with the EM and the coder as delegates. Ask it for feature work with a line like `cart-badge: show a badge on the cart`, in the form `<issue-slug>: <what the feature is>`, and its instructions have it hand the post to the EM. The EM files that feature as a row on the board, or answers that it filed nothing because the post names no feature.

Rows run on the scripted coder (`stub`), with no model. Set `DEVFORCE_LAB_HARNESS=claude-code` to run them on Claude Code instead; the Lab then checks for a Claude Code sign-in or `ANTHROPIC_API_KEY` at start, as the `fsd` profile does. The Lab keeps its data in SQLite at `packages/shift-manager/.fsdev/devteam.sqlite`, or wherever `DEVTEAM_STORE` points. Delete the file to start fresh.

The Shift Coordinator has [memory](../workforce/shift-coordinator.md#giving-it-memory): working memory within a conversation, a rolling digest across conversations, and the `memory/recall` tool to search it. By default it records nothing, so that memory stays empty; ask it to remember something for later and it says it can't keep it. Start Shift Manager with `DEVTEAM_MEMORY_CAPTURE=1` to record each conversation into its memory after each answer, at the cost of extra model calls every turn. Its memory is kept per user, apart from your other flows. Workers it hires onto the built-in `agent` flow get none.

## What you see

These are Shift Manager's own screens and words. Where one maps onto a Workforce concept, the link goes to the package docs.

| Screen | What it is |
|--------|------------|
| **Shift Coordinator** | Where Shift Manager opens. A summary of the asks waiting on you and the runs going, then your conversation with the Lab's [Shift Coordinator](../workforce/shift-coordinator.md). When the Shift Coordinator is a [coordinator](../workforce/coordinators.md), the DELEGATES panel lists who it hands this conversation's work to: add a worker from your roster, or remove one. A refused add shows why. Without a Shift Coordinator, you get the summary and a line saying how to add one. The gear at the right of its header opens the Shift Coordinator's settings, where its [standing rules](../workforce/standing-rules.md) are. |
| **Inbox** | Every approval and question a worker is waiting on you for, oldest first. Answer on the card, or reply to the worker under it. |
| **Tasks** | Every row on every board that isn't done, grouped by state, worker or workstream. Queued rows are behind a toggle. |
| **Roster** | Every worker, grouped as on shift (running a task, or waiting on you) or off shift. Each worker has a **Settings** button that opens its settings page. Its Rules section lists the notes the worker keeps for you, its [standing rules](../workforce/standing-rules.md), with when each was added and where it came from. Add, edit or delete them there; the next turn reads the change. For a worker whose flow doesn't keep rules, the section says so. |
| **A project** | Shared with your org, or private to you. Tabs: Stream (your own [project coordinator](../workforce/projects.md#talking-to-a-project)), Workstreams (every workstream's entry, with the progress worked out from them), Board (the tasks of your own workstreams) and Brief, which also names the project's repository, or says its coding work runs on the project's files. See [Projects](../workforce/projects.md). |
| **A workstream** | On a project, your own workstream opens on its lead's conversation. Someone else's opens on its details and latest report. |
| **Messages** | Every [message](../workforce/messaging-workers.md) one of your workers sent another, newest first, with a message and its answers kept together. Each line shows when it was sent, who sent it, who got it and its first line of text. The sender and the recipient are links: each opens the conversation that holds the message on that side. A message that wasn't delivered, or whose delivery couldn't be confirmed, says so. Messages aren't tasks, so nothing here shows on Tasks. |
| **Settings** | Your own keys for the MCP servers the Lab offers its projects' coding runs. See [Settings](./settings.md). |
| **A task** | One worker's run, live, with Interrupt to stop it. *Open trace* opens the run's session in the DevTool (see [Opening a session from a link](../devtool/overview.md#opening-a-session-from-a-link)). |

The sidebar lists, under PROJECTS, the org's shared projects and your own private ones, marked private, then the teams under TEAMS. A project's workstreams sit beneath it: the project you're on shows them, and the arrow beside any project shows or hides them. Jump to (⌘K) finds workstreams, workers, tasks and the Lab's readable documents. Press ⇧⌘K to open it ready to message the Shift Coordinator.

**Opening a workstream.** Ask your project coordinator, in the project's Stream tab, for work none of your workstreams there covers. The coordinator opens a workstream for that work, led by the worker on your roster whose description fits, such as your engineering manager for a feature, and hands your ask to the new workstream. The ask stays in the workstream's conversation as its brief. One worker can lead several of your workstreams, with a separate conversation and board for each. When nobody on your roster does the work, the coordinator says so; ask your Shift Coordinator to hire someone.

In your own app, `openWorkstream` takes whichever lead you name. See [Projects](../workforce/projects.md#workstreams).

Shift Coordinator, a workstream and a task also have a panel on the right. The sidebar and the right panel each collapse from their own toggle or from the keyboard: `[` for the sidebar, which shrinks to a column of icons, and `]` for the right panel, which shrinks to a strip. Each one's state is kept in the browser for the signed-in user. On a window narrower than 1180px, the right panel starts collapsed and opens over the center.

In a conversation, a message the worker sent another worker shows as its own line, *To &lt;worker&gt;: &lt;text&gt;*, with a link to Messages. One that was refused says it wasn't sent, and why. A message a worker received shows as *From &lt;worker&gt;: &lt;text&gt;*, under the sender's name.

A board has five columns: QUEUED, RUNNING, IN REVIEW, NEEDS YOU and DONE. In a workstream's composer, a message that starts with `@` and a worker's name goes to that worker's task in the workstream.

For the components behind screens like these in your own app, see [Workforce components](../workforce/ui.md).

## Themes

Shift Manager has three themes, named for the shift: Day, Evening and Night. Day and Evening are light, Evening a little warmer and darker; Night is dark.

The mark at the top of the sidebar is the control. Click it to step through Day, Evening and Night. The page fades to the new theme in under half a second, and your pick is kept in that browser.

The dot on the dashed arc above the mark shows the time of day: the left end is midnight, the top is noon. It follows your clock but never changes the theme.

Until you pick, the page opens on the theme your clock calls for: Day from 06:00, Evening from 16:00, Night from 19:00. `--shift` (or `SHIFT_MANAGER_SHIFT`) sets the starting theme instead, and a pick you've made wins over both.

## What a Lab's config provides

Shift Manager reads a Lab only through the routes its `FlowState` serves. It builds nothing for the Lab, so the config has to export a server that is already set up:

- **A `FlowState` as the default export**, with a store. `inMemoryStores()` gives an empty Lab on every start. Use `sqliteStores` or `postgresStores` to keep what it holds across restarts.
- **An organization**, named by `resolvePrincipal` on `createFlowState`. Without one, the Lab runs in the development organization, `DEFAULT_ORG_ID`.
- **An open [inventory](../workforce/inventory.md)**, which TEAMS, Roster and Inbox read to find the Lab's workers. Without it, TEAMS says there's none and the rest loads.
- **Who Shift Manager reads as**: `devtool: { userId }` on `createFlowState`, plus `bearerToken` when your resolver checks one. Shift Manager hands these to the page only on a loopback host.
- **Optionally, a Shift Coordinator**: a worker named `chief-of-staff`, declared under `org/workers/`. On the `coordinator` flow it also gets the DELEGATES panel. See [The Shift Coordinator](../workforce/shift-coordinator.md).

A document under a `resources/` folder shows in Jump to only when its frontmatter sets `client.content.read: true`.

## Not there yet

Several parts are drawn as named empty states or disabled controls:

- On a task: Hand off, reassign and Open PR are disabled. Diff, Checks, acceptance criteria, reviewer, harness, tokens and cost are empty.
- A workstream's Results tab, and the IN REVIEW column, are always empty.
- Roster matches a task to a worker by its assignee. A task whose assignee matches no single worker counts for no one.
