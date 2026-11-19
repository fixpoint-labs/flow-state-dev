---
title: Harnesses
type: catalog
description: Run a coding agent such as Claude Code, Codex or Cursor on a task in a checkout of its own, and hold the task open until checks and, if you ask, a user say the work is done.
---

import Figure from "@site/src/components/Figure";
import WhatThisInstalls from "./figures/what-this-installs.svg";
import OneRun from "./figures/one-run.svg";

# Harnesses

The harnesses kit lets an app hand a coding task to a coding agent and get back work it can trust. Point an agent at a directory and it edits whatever is there. Then it stops, and stopping looks like finished.

So the kit gives each task a checkout of its own, a git branch in a directory made for it, and holds the task open until your checks say the work is done. The agent is a value you plug in: Claude Code, Codex or Cursor.

Harnesses is a kit, a feature an app installs with one config line. It needs Workforce, the kit that runs workers, each a named agent defined by a Markdown file. [Coding harnesses](../../concepts/coding-harnesses.md) explains the model. This page is what the kit adds.

<Figure svg={WhatThisInstalls} caption="What the harnesses kit installs" description={"Three columns. On the left, your app: a coding worker file with flow coder and harness codex, and fsdev.config.ts calling workforce, harnesses with a workspace, and fill with codexHarness. Arrows lead from the worker file to the coder flow, which runs each coding task in its own checkout, and from the config to the harnesses flow, which says which agents can run here. An arrow leads from the harnesses flow to its one view, readiness, with a row per agent filled. Along the bottom, the kit opens one slot for agents, harnesses, which is highlighted, and fills two slots in Workforce: workerFlows, which adds the coder flow, and uses, which adds agent readiness to context. Two notes say the kit requires Workforce, and that claudeCode is a kit that fills the slot while Codex and Cursor are values the app fills in."} />

## What you get

- **A checkout per task.** A task such as `fix-cart-test` runs on its own branch. A failed attempt leaves its changes there, and a retry continues from them.
- **A verdict before done.** The task completes when the run ended normally and your checks pass in its checkout, not when the agent goes quiet.
- **Questions that wait.** A task can stop on a question to a user, and its checkout waits on disk for the answer.
- **Any agent.** A worker moves from Claude Code to Codex by changing one line of its file.
- **Project code.** With one setting, a task works in the repository of its conversation's project.

## Install it

```bash title="Terminal"
pnpm add @flow-state-dev/harness-manager @flow-state-dev/claude-code @anthropic-ai/claude-agent-sdk @flow-state-dev/workforce @flow-state-dev/workspace @flow-state-dev/orchestration
```

```ts title="fsdev.config.ts"
import { claudeCode } from "@flow-state-dev/claude-code";
import { createFlowState } from "@flow-state-dev/engine";
import { codingDrainBudgetMs, harnesses } from "@flow-state-dev/harness-manager/kit";
import { localWorkspaceHost } from "@flow-state-dev/workspace";
import { workforce } from "@flow-state-dev/workforce/kit";

const repo = "/work/acme-shop";

const workspace = localWorkspaceHost({
  root: "./runs",
  remotes: { allow: [] },
  localRepositories: [repo],
  source: () => ({ kind: "repo", repo }),
});

export default createFlowState({
  kits: [
    workforce({ agent: { model: "openai/gpt-6-luna" } }),
    harnesses({ workspace }),
    claudeCode(),
  ],
  // Pass the options you give harnesses(); none here.
  dispatchDrainTimeoutMs: codingDrainBudgetMs({}),
});
```

`workspace` is the one required key. Its `root` is the directory every checkout is made under, and its `source` says where each run's files come from. Here every run is cut from `/work/acme-shop`.

`codingDrainBudgetMs` takes the same `checks`, `project`, `judge`, `idleTimeoutMs` and `runTimeoutMs` you give `harnesses`, so a shutdown waits long enough for a full run. [Harness runs](../../reference/harness-runs.md) has the default.

A worker becomes a coding worker with two lines in its file:

```md title="workforce/teams/engineering/workers/coder/WORKER.md"
---
description: Fixes failing tests in the shop's repository.
flow: coder
harness: claude-code
---

Fix what the task describes. Keep the change small.
```

The body is the worker's instructions in the run's brief. [Harness runs](../../reference/harness-runs.md) covers the worker file's other lines.

## Use it

### Where a run works

<Figure svg={OneRun} caption="One run, with the kit's config keys" description={"Three boxes from left to right. The task fix-cart-test, with goal cart.test.ts passes, worker engineering.coder and harness claude-code, is on the board and has a hatched top because it outlives the request. An arrow leads to the run, claude-code in its own checkout, cut from workspace, on its own git branch and stopped by idleTimeoutMs when it goes quiet. An arrow leads to the verdict: checks pnpm test, judge reads the goal, and review off unless set. The last row, then the task completes, is highlighted. A dashed arrow runs from the verdict back to the task, labelled not done. Three notes say the run starts in a checkout made from workspace, that checks, judge and review decide in that order, and that not done sends the task back to the board with the reason."} />

Each task gets a git worktree on its own branch, such as `conductor/fix-cart-test-3fa9c1`, in a folder under `root`. A retry lands in the same directory. The checkout is where the agent is pointed, not a jail: Claude Code as installed above can run shell commands as the server's user. [Harness runs](../../reference/harness-runs.md) has the checkout layout, setup commands, sandboxes and the run timeout.

### The verdict

A task completes when its run ended normally and the commands in `checks` pass in the run's checkout. The judge, on by default, can also hold it open: an evaluation model that reads the run against the task's goal and answers done, not done or ask. It holds a task only when it is at least 70% sure; below that, not done and ask count as done, and a judge that errors or times out leaves the checks to decide alone. With `pullRequests` on, also the default, a pull request the run opened holds the task until it merges or closes, even when the judge says not done. With `review` on, a user's review does too.

Add `checks: { commands: ["pnpm test"] }` to the kit and `fix-cart-test` completes only when `pnpm test` passes in its checkout. A green check is evidence, not proof: the checkout's scripts are ones the agent could edit.

Anything short of done fails the attempt, and the next attempt's brief says why. [Harness runs](../../reference/harness-runs.md) has the five conditions in order, the run states and the shape of a completed task's output.

### Questions to a user

When the judge can't decide from the goal, it asks a user. A review asks one too. The question shows in the user's Inbox, the list of things waiting on a user, and a user answers there or by typing a line in the run's session. A screen of your own answers a review like this:

```ts title="src/lib/review.ts"
import type { Client } from "@flow-state-dev/client";
import { createInboxClient, type InboxItem } from "@flow-state-dev/orchestration/inbox";

export async function acceptReview(client: Client, item: InboxItem) {
  await createInboxClient(client).answer(item, { value: { verdict: "accepted" } });
}

export async function askForChanges(client: Client, item: InboxItem, words: string) {
  await createInboxClient(client).answer(item, { value: { verdict: "revise", words } });
}
```

While a review waits, the task stays in progress on the same attempt. `accepted` completes the task. `revise` sends `words` to the same session for one more run, and a run that commits again comes back for review. If the host's deadline for a waiting user passes first, the task completes marked `review: "deadline"`, never as accepted. Reviews need a host with durable execution, one that can resume a waiting task after a restart. [Harness runs](../../reference/harness-runs.md) has the question channel and review answers.

### Reading a run's changes on a page

With `review: true` on the kit, the review's data lists the files the commits changed. The `RunChanges` component, added with `fsdev ui add run-changes`, draws them:

```tsx title="src/app/inbox/review-changes.tsx"
import { RunChanges } from "@/components/flow-state/run-changes";

type ReviewData = {
  files: { path: string; added: number | null; removed: number | null }[] | null;
  fileCount: number | null;
  added: number | null;
  removed: number | null;
};

export function ReviewChanges({ data }: { data: ReviewData }) {
  if (data.files === null) return <p>The changes could not be read.</p>;
  return (
    <RunChanges
      files={data.files}
      fileCount={data.fileCount ?? undefined}
      added={data.added ?? undefined}
      removed={data.removed ?? undefined}
    />
  );
}
```

The kit serves no view of one file's patch; [Harness runs](../../reference/harness-runs.md) covers the data's shape and what an app can add.

### A project's code and files

Set `project: true` and a task works in its session's project: it needs one, runs in its checkout, and passes the project's checks in place of the kit's `checks`. The host's `source` must be `projectWorkspace()`:

```ts title="src/lib/workspace.ts"
import { localWorkspaceHost } from "@flow-state-dev/workspace";
import { projectWorkspace } from "@flow-state-dev/workforce";

export const workspace = localWorkspaceHost({
  root: "./runs",
  remotes: { allow: ["github.com"] },
  source: projectWorkspace(),
});
```

Pass it as `harnesses({ workspace, project: true })`. [Harness runs](../../reference/harness-runs.md) lists what is refused, such as a task whose session has no project.

A project with a repository runs in a fresh branch of it. A project with none starts each run from the project's files and saves what it writes back. [Projects](../workforce/projects.md) covers both, and the project's checks.

## Slots it opens

The kit opens one slot, `harnesses`. Each entry is a coding agent with an `id`, which a worker's `harness:` line names. `defaultHarness` is the agent a worker with no `harness:` line runs on. [Harness runs](../../reference/harness-runs.md) has the entry's fields.

Claude Code is a kit that fills it. Codex and Cursor are plain values, so the app fills them with `fill`, after `pnpm add @flow-state-dev/codex @openai/codex-sdk@0.164.0`. The `workspace` here is the one from [A project's code and files](#a-projects-code-and-files), so it adds `project: true`:

```ts title="fsdev.config.ts"
import { codexHarness } from "@flow-state-dev/codex";
import { createFlowState } from "@flow-state-dev/engine";
import { harnesses } from "@flow-state-dev/harness-manager/kit";
import { workforce } from "@flow-state-dev/workforce/kit";
import { workspace } from "./src/lib/workspace";

export default createFlowState({
  kits: [
    workforce({ agent: { model: "openai/gpt-6-luna" } }),
    harnesses({ workspace, project: true, defaultHarness: "codex" }),
  ],
  fill: { [harnesses.slots.harnesses]: [codexHarness()] },
});
```

## Slots it fills and views it serves

The kit requires `workforce`. It fills Workforce's `workerFlows` slot with the `coder` flow, which every coding worker runs, and its `uses` slot with a capability that tells a worker which agents are ready.

The `harnesses` flow serves one view, `readiness`: a row per agent filled, readable with no session. Before each task starts, the `coder` flow checks that the worker's agent can run on this machine. If it can't, the task fails at once with the reason and what to run to fix it, and it never moves to another agent. A worker file whose `harness:` line names an agent nobody filled stops the app at start, naming that agent. [Harness runs](../../reference/harness-runs.md) has its fields and how readiness is checked.

## Change it

Besides `workspace`, the kit takes `defaultHarness`, `review`, `pullRequests`, `judge` (on by default), `checks`, `project`, `idleTimeoutMs`, `runTimeoutMs` and `logReadiness`. An unknown key is refused. `idleTimeoutMs` stops a run after 20 minutes with no output from its agent. `runTimeoutMs` is an optional cap on a run's total time, 4 hours by default; `0` turns it off. [Harness runs](../../reference/harness-runs.md) has each key's default, which option wins when a worker's file and the kit disagree, and how to replace the `coder` flow with your own.

## Next

- [Coding harnesses](../../concepts/coding-harnesses.md): the model, a checkout and a verdict, and why the agent is a slot.
- [Harness runs](../../reference/harness-runs.md): run states, the verdict contract, workspace options and every config key.
- [Projects](../workforce/projects.md): the project a coding task works in.
- [Workforce](../workforce/index.md): the kit this one requires.
