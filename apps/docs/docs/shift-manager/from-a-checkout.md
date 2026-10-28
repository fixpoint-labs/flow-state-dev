---
title: Working on Shift Manager
sidebar_label: From a checkout
description: "Run Shift Manager from a clone of the flow-state-dev repository: the fsd profile for working on the framework and on Shift Manager itself, and the devteam profile the repository's checks run against."
---

# Working on Shift Manager

If you've cloned the flow-state-dev repository, Shift Manager comes with two Labs ready to open, called profiles. **`fsd`** is the default: a Lab for working on this repository, Shift Manager included. **`devteam`** is the software team the repository's checks run against. Neither is in the published package.

## Before you start

The `fsd` profile's coding agent is Claude Code. Sign in to Claude Code, or set `ANTHROPIC_API_KEY`, before you start. Without either, the Lab refuses to start and says so.

The [Shift Coordinator](../workforce/shift-coordinator.md) answers on a model of its own, so its turns need `ANTHROPIC_API_KEY` or `AI_GATEWAY_API_KEY`. A worker that names no `model:`, such as one the Shift Coordinator hires, answers on the Lab's default model, `openai/gpt-6-luna`, so its turns need `OPENAI_API_KEY` or `AI_GATEWAY_API_KEY`.

To run the scripted coder (`stub`) instead of Claude Code, set `DEVFORCE_LAB_HARNESS=stub`. It writes one file and costs nothing. A `Coder:` line at start names the coder the Lab started with.

## Start it

```bash
pnpm shift-manager:dev
```

That opens the `fsd` profile with `--dev`, which serves Shift Manager's pages from source, so a change to a screen shows as you save it. `pnpm --filter @flow-state-dev/shift-manager start` runs the same profile on the built pages, and builds them first when they're older than their source.

To open the `devteam` profile instead, pass its config, a path from the repository root:

```bash
pnpm shift-manager:dev --config packages/shift-manager/teams/devteam/fsdev.config.mts
```

To open another Lab from a checkout, pass its config:

```bash
pnpm --filter @flow-state-dev/shift-manager dev --config ../my-lab/fsdev.config.mts
```

## The `fsd` profile

The profile is at `packages/shift-manager/teams/devteam/fsd.fsdev.config.mts`. The Lab has two projects from the start. **FSD** is the framework packages, and **Shift Manager** is this app. Both are shared with everyone in the Lab, and both point at this repository. Inbox is empty until a worker asks you something. The projects and the MCP servers they use are defined in `packages/shift-manager/teams/devteam/fsd-projects.mts`.

The Lab keeps its data in SQLite at `packages/shift-manager/.fsdev/fsd.sqlite`, or wherever `FSD_STORE` points. Delete the file to start fresh.

### Asking for work

Ask the Shift Coordinator for work on either project, and say which one, for example "on Shift Manager, make the empty Inbox say who to ask". A coding agent picks it up in a fresh worktree of your checkout, on a branch of its own, and works to this repository's `AGENTS.md` and `CLAUDE.md`.

Before cutting that branch, the Lab fetches the upstream your `main` tracks, usually `origin/main`, and starts from whichever is newer, that upstream or your local `main`. So you don't need to pull first, and commits you haven't pushed are kept. Your own `main`, its files and your index aren't touched.

If your `main` and its upstream each have commits the other lacks, the run is refused before anything is made, and the refusal names both commits. Pull or rebase, or push, then ask again. If the fetch fails, because you're offline for instance, the run starts from your local `main`, and a warning prints where you started Shift Manager.

The Lab pins the URL of each remote and the upstream your branches track the first time it starts with your checkout, and fetches only from those. If you change a remote's URL on purpose, the next run fetches nothing, starts from your local `main`, and prints a warning naming a pin file. If you change a branch's upstream, the run still fetches the pinned upstream and prints the same kind of warning. Either way, delete that pin file and restart Shift Manager to accept the change.

A coding run works in your checkout with your trust, the way Claude Code does when you start it there. It can create and move branches, tags and remote-tracking refs in your repository.

Only those two projects get a worktree of your checkout. Apart from that fetch, the Lab reaches no git remote, so a coding run on a project you add yourself, even one on this repository, is refused, naming the repository, and nothing is cloned.

### Reviewing a run

Review the work in the run's worktree, or from your checkout with:

```bash
git log -p <branch> --not main main@{upstream}
```

That shows only the run's commits, whichever of the two it started from. The branch stays checked out in its worktree, so git won't check it out a second time in yours.

### Giving runs Linear

Open [Settings](./settings.md) and paste a Linear API key, and every coding run you ask for on either project can read and update Linear, as you. Each user sets their own. A run for someone who hasn't set one works without Linear and says so.

For runs with nobody at the keyboard, such as the repository's checks or CI, `LINEAR_MCP_API_KEY` stands in for the key of the Lab's owner, the user Shift Manager opens as on your machine, until that user sets one. An `MCP servers:` line in the terminal when it starts says whether the owner has a key.

## The `devteam` profile

`devteam` is a software team, at `packages/shift-manager/teams/devteam/fsdev.config.mts`. Its workers' files sit beside the config; the [`teams/devteam` README](https://github.com/fixpoint-labs/flow-state-dev/tree/main/packages/shift-manager/teams/devteam) lays out the tree and the checks that run against it.

An EM worker leads workstreams and files the coder's tasks on each one's board, and a coder worker runs each task as a supervised coding run. On start the EM asks you to approve one feature, so Inbox has something in it. Three projects exist from the start: Storefront, where the Lab's second user has opened two workstreams, `feature` and `release`, both led by the EM, and Platform and Sandbox, with none. Each user talks to a project through its [project coordinator](../workforce/projects.md#talking-to-a-project), which opens a workstream when you ask it for new work.

Its [Shift Coordinator](../workforce/shift-coordinator.md) is a coordinator with the EM and the coder as delegates. Ask it for feature work with a line like `cart-badge: show a badge on the cart`, in the form `<issue-slug>: <what the feature is>`, and it hands your message to the EM. The EM files the feature as a row on the board, or answers that it filed nothing because your message names no feature.

Rows run on the scripted coder (`stub`), with no model. Set `DEVFORCE_LAB_HARNESS=claude-code` to run them on Claude Code instead; the Lab then checks for a Claude Code sign-in or `ANTHROPIC_API_KEY` at start, as the `fsd` profile does.

Usage shows how much of each Codex window your machine's Codex sign-in has used. Opening Usage asks the Codex CLI, at most once a minute. That read works only on your own machine (see [Reading usage left](../tools/codex.md#reading-usage-left)).

The Lab keeps its data in SQLite at `packages/shift-manager/.fsdev/devteam.sqlite`, or wherever `DEVTEAM_STORE` points, so projects, their workstreams and your conversations survive a restart. Delete the file to start fresh.

### Its Shift Coordinator's memory

The Shift Coordinator has [memory](../workforce/shift-coordinator.md#giving-it-memory): working memory within a conversation, a rolling digest across conversations, and the `memory/recall` tool to search it. By default it records nothing, so that memory stays empty; ask it to remember something for later and it says it can't keep it.

Start Shift Manager with `DEVTEAM_MEMORY_CAPTURE=1` to record each conversation into its memory after each answer, at the cost of extra model calls every turn. When the Shift Coordinator hands a request straight to a delegate, it takes no turn of its own, so nothing is recorded for that request. The request can appear as earlier context in a later turn that is recorded. Its memory is kept per user, apart from your other flows.
