---
title: Teammates
type: catalog
description: "A small team you talk to one worker at a time, whose workers message each other where you can see it."
---

import Figure from "@site/src/components/Figure";
import WhatItInstalls from "./figures/what-it-installs.svg";

# Teammates

Teammates is an app where you talk to a small team one worker at a time. A worker is a named agent with a job, briefed in a Markdown file. Each one gets a single long conversation, listed on the left of the screen.

Every worker has a conversation of its own, and when one messages another, a line appears in both. You open the line and read what the second worker did. Code changes run as background tasks that report back to the conversation you asked in.

It is a starter: a folder you read and copy, not something you add to an app.

## What you get

The screen has the worker list on the left, the open conversation in the centre and the open worker's panel on the right. Each row says what that worker is doing and how many entries are new.

Six workers come with it. Three you talk to, and three only run coding tasks.

| Worker | What it has that the others do not |
| --- | --- |
| Chief of Staff | Where you start. It can hand work to every other worker, and read a teammate's conversation without starting a turn there. |
| researcher | Web `search`, and the working folder's files. It names where each fact came from. |
| writer | The same file tools and `fetch`, but no `search`. |
| Claude Code, Codex, Cursor | One coding agent each, started by tasks. How a run is addressed and where it works are in [Harness runs](../../reference/harness-runs.md). |

The working folder is the git checkout the workers read and the coding agents change. The three you talk to keep one conversation going for weeks; how much of it each reads word for word is in the [Workforce reference](../../reference/workforce.md).

Each worker is one file. This is the shortest:

```md title="workforce/teams/teammates/workers/writer/WORKER.md"
---
name: writer
description: Drafts and tightens copy from real material, when you or another worker asks.
icon: "✎"
color: violet
tools: [globProjectSource, readProjectSource, grepProjectSource, fetch, listRoutines, saveRoutine, pauseRoutine, deleteRoutine]
---

You write and tighten copy. Write from the material, never from memory: read what the draft is about
in the working folder's files with `globProjectSource`, `grepProjectSource` and `readProjectSource`,
or a page with `fetch`. Keep each draft to the length asked.

When another worker messages you for a draft, write it and answer them the way their message says:
when they asked for a reply, your answer here goes back to them; when they didn't, answer with
`sendMessage`, replying to their message. When a task is filed for you, answer it here. When the
user asks you directly, answer them here.
```

A worker's id comes from its folder names, and the [WORKER.md reference](../../reference/worker-md.md) shows how. [Workers](../../concepts/workers.md) covers the file's settings.

## Install it

There is nothing to install. Teammates is a private package in the Flow State repository, at `labs/teammates`, and no `fsdev` command scaffolds it. To run it, work from a checkout of that repository:

```bash title="Terminal"
export AI_GATEWAY_API_KEY=...
pnpm --filter @flow-state-dev/teammates dev
```

That builds the screen, then `fsdev dev --app` serves it at the root of the URL on the `App:` line the command prints. The model is `openai/gpt-6-luna`.

The app reads a few variables in its `fsdev.config.mts`, among them the working folder (`TEAMMATES_WORKDIR`), a search provider's key and the user it acts as. The [Environment reference](../../reference/environment.md) lists the search keys. Coding runs need a coding agent this machine is signed in to, and researcher's `search` needs a search provider's key.

## Watch two workers talk

Put a launch date in the working folder's README, then tell Chief of Staff: "Ask researcher for our launch date, and help me outline the post."

In Chief of Staff's conversation a line reads **Messaged researcher**. In researcher's conversation the message reads **← Chief of Staff**. Open the line and a popup shows researcher's turn: what it read, what it did, and the reply it sent. The reply lands in Chief of Staff's conversation under researcher's name.

A message never interrupts the turn in progress. Type a second line to Chief of Staff before researcher has replied and its answer to you carries on. researcher's reply shows as a pending line, and Chief of Staff reads it right after that answer and uses it in its next line. The [messaging reference](../../reference/messaging.md) has the rest of what a message does. Sending, replies and waiting are covered in [Messaging between workers](../workforce/messaging.md).

## Start a coding task

Tell Chief of Staff: "Fix the typo in the README's first line." It files a coding task and the run shows its steps. Name an agent, such as Codex, and that agent runs it. Name none and Cursor runs it, with no question first.

A run works in its own git worktree under `.fsdev/teammates-runs/`, so your checkout's branch and working tree are never changed.

If the agent you name is not set up on this machine, the task fails at once with a line naming it and what to run:

```text
Codex isn't set up on this machine: Codex has no credential: Not logged in. Run `codex login`, or set CODEX_API_KEY. Then start the task again.
```

It does not fall back to another agent. The context strip over the conversation shows which agents are ready, and Chief of Staff starts coding tasks only on one marked ready and tells you what to run for one that isn't. [Harness runs](../../reference/harness-runs.md) has the rest.

## What it installs

The app is `createFlowState` with three kits. A kit is a feature an app installs. A slot is an opening a kit leaves for other kits to fill.

```ts title="host.mts"
import { claudeCode } from "@flow-state-dev/claude-code";
import { codexHarness } from "@flow-state-dev/codex";
import { cursorHarness } from "@flow-state-dev/cursor";
import { createFlowState } from "@flow-state-dev/engine";
import { harnesses } from "@flow-state-dev/harness-manager/kit";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { fetch, search } from "@flow-state-dev/tools";
import { projectSourceTools } from "@flow-state-dev/workforce";
import { workforce } from "@flow-state-dev/workforce/kit";
import { localWorkspaceHost } from "@flow-state-dev/workspace";

export function openTeammates(workdir: string) {
  const workspace = localWorkspaceHost({
    root: `${workdir}/.fsdev/teammates-runs`,
    remotes: { allow: [] },
    localRepositories: [workdir],
    source: () => ({ kind: "repo", repo: workdir }),
  });

  return createFlowState({
    kits: [
      workforce({
        directory: "./workforce",
        agent: {
          model: "openai/gpt-6-luna",
          // The tools the workers' `tools:` lines name.
          catalog: { ...projectSourceTools(workspace), search: search(), fetch: fetch() },
        },
      }),
      harnesses({ workspace, defaultHarness: "cursor", review: true }),
      claudeCode(),
    ],
    fill: { [harnesses.slots.harnesses]: [codexHarness(), cursorHarness()] },
    stores: { default: { primary: sqliteStores({ filename: ".fsdev/teammates.sqlite" }) } },
    durable: true,
    resolvePrincipal: () => ({ userId: "you", orgId: "teammates-lab" }),
  });
}
```

`workforce` reads the `workforce/` folder and serves the roster and the agent flow every conversation runs on. `harnesses` adds the `coder` flow every coding worker runs on, and opens the slot `harnesses.slots.harnesses`. The app fills that slot with Codex and Cursor, and `claudeCode()` is a kit that fills the slot itself, so it needs no `fill` entry. [Kits and slots](../../concepts/kits-and-slots.md) explains how kits fit.

Two views feed the screen. The `readiness` view of the `harnesses` flow reports which coding agents this machine is signed in to; [Harness runs](../../reference/harness-runs.md) says what it reports. A flow of the app's own, `lab-context`, serves a `context` view with the working folder, the model and the default agent.

<Figure svg={WhatItInstalls} caption="What the app is made of and what it stores" description={"A large box for the app holds three boxes side by side. On the left, the workforce folder, with the six worker folders highlighted as the part you edit and a TEAM.md file below them. In the middle, the three kits: workforce, harnesses and claudeCode. On the right, a store of conversations per user, with three hatched boxes for you with chief-of-staff, researcher and writer. An arrow runs from the kits to the folder, and another from the kits to the store. Notes say the worker files are read once at start and the store holds none, and that conversations outlive restarts and the app serves one user."} />

## Change it

**Rewrite a brief.** A worker's brief is the body of its `WORKER.md`, below the second `---`. The [Workforce folder reference](../../reference/workforce-folder.md) says when an edit applies and where a brief the whole team shares goes.

Editing the file and restarting changes writer for everyone who hasn't edited it, because the folder is read once at startup.

In the screen, **Edit** on a teammate's panel replaces its instructions and leaves `WORKER.md` untouched. The edit is your own copy of writer under the same id, stored as a row in your scope in the app's store. A turn already running keeps the instructions it started with, and the new ones apply from writer's next turn. A blank instructions box keeps the current ones. In an app with several users, another user in the same organization gets the file's writer.

**Reset to default** deletes your copy, and the file's version is read from the next turn. The conversation and its history stay as they were. The [Workforce reference](../../reference/workforce.md) covers the rest.

**Add a worker.** Add a folder with a `WORKER.md` that has a `description`:

```md title="workforce/teams/teammates/workers/proofreader/WORKER.md"
---
name: proofreader
description: Checks a draft for typos and sentences that do not parse.
---

You check drafts. Return the corrected text, then a list of what you changed.
```

After a restart, `teammates.proofreader` is on the list and Chief of Staff can hand it work. The [WORKER.md reference](../../reference/worker-md.md) covers `flow:` and which worker may hand work to which. **Hire a teammate** in the screen does the same from a name, a line and instructions, with no restart. A new coding agent is one more `WORKER.md`; its `flow:` and `harness:` settings are in the [Workforce reference](../../reference/workforce.md).

**Give a worker a tool.** A worker names its tools in `tools:`, and a written list is everything it can call. To let writer search the web, add `search` to its `tools:` line. The [WORKER.md reference](../../reference/worker-md.md) lists the names this app registers, where a name is looked up, and what happens to one nothing registers.

## Not wired yet

- writer has no tool that writes a file, so it answers with the draft rather than saving it.
- Workers can follow a pull request or run on a schedule when you ask. The panel's Routines list does not show them and always reads "None yet."
- There are no group chats, no new-chat button and no session list. Each worker has one conversation.
- The app takes every request as one user, `you` unless `TEAMMATES_USER` says otherwise. Nobody signs in.
