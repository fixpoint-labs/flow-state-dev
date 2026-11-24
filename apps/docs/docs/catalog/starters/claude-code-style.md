---
title: The Claude Code-style starter
type: catalog
description: A coding app in the browser, with sessions on the left, the conversation in the centre and background tasks on the right, to run from this repository and copy from.
---

import Figure from "@site/src/components/Figure";
import Installs from "./figures/claude-code-style-installs.svg";

# The Claude Code-style starter

The Claude Code-style starter is a coding app that runs in a browser. Sessions are listed on the left, the conversation you type into is in the centre, and the long jobs run in the background on the right. It is for the way coding with an agent tends to go: you want to keep talking while a change is being made, and you do not want the change made in the branch you are working in.

So you talk to one main worker, a named agent briefed in a Markdown file. It answers what it can in the same turn, including questions about your project's files, and hands a code change to a coding agent (Claude Code, Codex or Cursor) that works in its own copy of your repository. The result comes back into the conversation as one line you can open.

The app is the folder `labs/claude-code-style`. The package is private and no `fsdev` command creates an app from it, so you run it from a checkout of this repository and copy the pieces you want into your own app.

## What you get

The app has two views, Sessions and Projects. **Sessions** is the layout above: a session is one stored record of a piece of work with the main worker. When the main worker starts a background task, its title and status appear in the conversation as one line, and clicking the line opens the task's reply. **Projects** turns each request into tasks, each in a session of its own, on a board grouped by state. The [Task board reference](../../reference/task-board.md) lists the task actions and the five board groups.

A *Coder* chip beside Send picks who makes a code change: Auto (Claude Code), Plan first (Claude Code in plan mode, which reads and answers with a plan and changes nothing), Codex or Cursor. Any choice but Auto adds a line such as `Coder: Codex` to what you send, and the main worker's instructions tell it to hand the change to that coder. The [Harness runs reference](../../reference/harness-runs.md) lists the four choices and how each agent runs.

## Run it

```bash
pnpm --filter @flow-state-dev/claude-code-style dev
```

Open the address it prints as `App:`. The model runs through the AI Gateway, so the host needs `AI_GATEWAY_API_KEY`, and each coder needs its own sign-in. State is stored in SQLite files under the data folder, and the app serves one user with no sign-in. Every `CLAUDE_CODE_STYLE_*` setting is optional and is read in the app's `fsdev.config.mts`; the [Environment reference](../../reference/environment.md) lists the keys the model and each coder read.

## Where a coding run makes its changes

In a git worktree of the project's repository, on a branch of its own. The branch is in your repository, so you can find it, and your checked-out branch and files do not change. A repository not listed in `CLAUDE_CODE_STYLE_REPOSITORIES` is cloned under the data folder instead.

The repository has to be a `file://` address whose committed `.gitignore` ignores `.fsdev/`, and the project picker checks both before it creates the project. What counts as a finished run, and when a coding task waits for your review, are in the [Harness runs reference](../../reference/harness-runs.md).

## What it installs

<Figure svg={Installs} caption="Three kits, with coders filling the harness slot" description={"A large box for the app claude-code-style holds four things. On the left, a kit called workforce, which provides the desk team's workers and the agent flow. In the middle, a kit called harnesses, which provides the coder flow and a readiness view, and carries a highlighted row, slot: harnesses, where coders plug in. On the right, three boxes stacked: claudeCode with plan true, a kit that fills the slot itself, then codexHarness and cursorHarness, values put in by fill. An arrow from each of the three runs to the harnesses kit, meaning it fills a slot."} />

A kit is a feature an app installs in one line of config, and a slot is an opening one kit leaves for others. The app's config is three kits and a `fill`. The config below is trimmed for copying into your own app. It writes the model and the repository path out directly, while the app itself reads them from the settings above.

```ts title="fsdev.config.ts"
import { fileURLToPath } from "node:url";
import { claudeCode } from "@flow-state-dev/claude-code";
import { codexHarness } from "@flow-state-dev/codex";
import { cursorHarness } from "@flow-state-dev/cursor";
import { createFlowState } from "@flow-state-dev/engine";
import { harnesses } from "@flow-state-dev/harness-manager/kit";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { workforce } from "@flow-state-dev/workforce/kit";
import { projectWorkspace } from "@flow-state-dev/workforce";
import { localWorkspaceHost } from "@flow-state-dev/workspace";

const workspace = localWorkspaceHost({
  root: ".fsdev/runs",
  remotes: { allow: ["file"] },
  localRepositories: ["/home/you/code/shop"],
  source: projectWorkspace(),
});

export default createFlowState({
  kits: [
    workforce({
      directory: fileURLToPath(new URL("./workforce", import.meta.url)),
      agent: { model: "openai/gpt-6-luna" },
    }),
    harnesses({ workspace, project: true, logReadiness: true }),
    claudeCode({ plan: true }),
  ],
  fill: { [harnesses.slots.harnesses]: [codexHarness(), cursorHarness()] },
  stores: { default: { primary: sqliteStores({ filename: ".fsdev/lab.db" }) } },
  durable: true,
  resolvePrincipal: () => ({ userId: "u_lab", orgId: "shop" }),
});
```

`workforce` reads the workers from the `workforce/` folder. `harnesses` adds the `coder` flow, the one flow every coding worker runs on. `claudeCode` is a kit that fills the harness slot itself. Codex is not a kit: `codexHarness()` returns a plain value, and the app puts it in `fill`. `source: projectWorkspace()` says each run's files come from the project the task belongs to. The [Harness runs reference](../../reference/harness-runs.md) lists what the kit adds and how each agent fills the slot.

A worker that names a harness nobody filled is refused when the app starts; the [Kits reference](../../reference/kits.md) shows the error. A harness this machine cannot run fails the task at once and says why, and the task never moves to another harness. The [Harness runs reference](../../reference/harness-runs.md) covers the environment a run starts with.

## Change it

**Point it at your repository.** Start the app from inside the repository, or name it in the setting. If a fresh worktree needs an install, name the command too in `CLAUDE_CODE_STYLE_SETUP`; it runs in each new worktree before the coding run.

```bash
CLAUDE_CODE_STYLE_REPOSITORIES=/home/you/code/shop \
CLAUDE_CODE_STYLE_SETUP="pnpm install --frozen-lockfile" \
pnpm --filter @flow-state-dev/claude-code-style dev
```

Then make a project in the picker: a name, and the repository as `file:///home/you/code/shop`.

**Change the main worker's brief.** It is `workforce/teams/desk/workers/main/WORKER.md`: frontmatter, then the brief as the body. The brief tells the worker to open each reply with a line saying what it will do, to do its own part in full and hand the long pieces to background tasks, to read the project's files itself, and to send code changes to `desk.coder`. Edit those sentences. The [WORKER.md reference](../../reference/worker-md.md) lists the frontmatter settings, including `flow` and `delegates`.

**Add a coder worker for one harness.** A worker can run on any harness the config fills, and needs no new flow. The lab already has one coder per filled harness: `desk.coder-codex` is this file, and the main worker's `delegates` lists it. The *Coder* chip changes the coder for one message; a worker like this always uses its harness:

```md title="workforce/teams/desk/workers/coder-codex/WORKER.md"
---
description: Changes the code in the session's project, through Codex.
flow: coder
harness: codex
---
```

A coder for a harness you add has the same shape, with its own `harness:` line. Add its id to the main worker's `delegates`, tell the brief when to use it, and sign its agent in on the machine; the [Environment reference](../../reference/environment.md) names the credential. The *Coder* chip's choices are a constant in the app's own source, so a harness of your own also needs an entry in `CODER_CHOICES` in `src/components/Composer.tsx`.

## What it won't do

- No file diffs of a run's changes.
- No permission prompts. A coding run works with nobody to approve a tool call.
- No form field for a project's checks.
- Repositories are `file://` only.
- One user. Every request is taken as that user, whatever user it names, and `CLAUDE_CODE_STYLE_USER` sets which one.

The [Harness runs reference](../../reference/harness-runs.md) has the detail on each.

## Next

- [Coding harnesses](../../concepts/coding-harnesses.md): what a harness is and what the `coder` flow does with one.
- [Harnesses](../harnesses/index.md): the kit's options, and the other agents it fills.
- [Kits and slots](../../concepts/kits-and-slots.md): how `fill` and `claudeCode` meet in a slot.
