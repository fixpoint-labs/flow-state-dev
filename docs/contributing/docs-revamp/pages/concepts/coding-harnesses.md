---
title: Coding harnesses
type: concept
description: A coding agent such as Claude Code, Codex or Cursor, run as one block in a checkout of its own, with a verdict read before its task counts as done.
---

import Figure from "@site/src/components/Figure";
import SupervisedRun from "./figures/a-supervised-run.svg";
import HarnessSlot from "./figures/the-harness-is-a-slot.svg";

# Coding harnesses

A coding harness is how an app hands a coding agent a job and gets back work it can trust. Point an agent at code and it edits the directory you are working in. Then it stops, and stopping looks like finished.

So a harness gives the agent a directory of its own, and holds the task open until a verdict says the work is done.

## If you know coding agents

The agent is the one you already use at a terminal: Claude Code, Codex or Cursor, each the vendor's own. It takes a prompt, works in a loop in a directory, and reports what it did.

The difference is who runs it. Flow State runs the agent as a step with a typed input and a typed result, in a directory it prepared, and decides when the work counts.

## The model

Take a task called `fix-cart-test`. It sits on a board, filed for the worker `engineering.coder`, with the goal "make `cart.test.ts` pass". The run happens in a checkout, a directory and git branch made for that task. When the agent stops, a verdict is read. Only then does the task complete.

<Figure svg={SupervisedRun} caption="A supervised run: checkout, agent, verdict" description={"Three boxes from left to right. The task fix-cart-test, with its goal, worker engineering.coder and harness claude-code, is on the board and has a hatched top because it outlives the request. An arrow leads to the run, claude-code working in its own git branch and its own directory, with a note that it is set up apart from your working tree. An arrow leads to the verdict: status completed, outcome finished, pnpm test passes. The last row, then the task completes, is highlighted. A dashed arrow runs from the verdict back to the task and is labelled not done."} />

## A coding agent as a block

A harness is a block, one step of a flow. On its own it needs a prompt and nothing else:

```ts title="src/flows/tidy/blocks/tidy-imports.ts"
import { claudeCodeAgent } from "@flow-state-dev/claude-code";

export const tidyImports = claudeCodeAgent();
// Step it in a flow with { prompt: "Tidy the imports in src/." }
```

It returns one result shape whichever agent ran, so code that reads it does not change when the agent does. A block like this has no checkout and no verdict. Those come from the harness kit, a feature an app installs. The [Harness runs](../reference/harness-runs.md) reference lists the fields.

## Install the kit

The harness kit turns coding tasks into supervised runs. It needs Workforce, the kit that runs workers, and an agent to run:

```ts title="fsdev.config.ts"
import { claudeCode } from "@flow-state-dev/claude-code";
import { createFlowState } from "@flow-state-dev/engine";
import { harnesses } from "@flow-state-dev/harness-manager/kit";
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
    harnesses({ workspace, checks: { commands: ["pnpm test"] } }),
    claudeCode(),
  ],
});
```

`workspace` says where runs work and where their files come from, and `checks` are commands a run has to pass. A worker is an agent defined by a file, and it becomes a coding worker with two lines:

```md title="workforce/teams/engineering/workers/coder/WORKER.md"
---
description: Fixes failing tests in the shop's repository.
flow: coder
harness: claude-code
---

Fix what the task describes. Keep the change small.
```

## Its own checkout

Each task gets its own git branch and its own directory, and a retry picks up the work already in it. Two users working the same issue get separate checkouts. Setting up a run never touches your working tree or index. They do share the repository's refs: a run can create or move branches and tags in a repo you list in `localRepositories`.

The checkout is where the agent is pointed, not a jail. The sandbox on its harness sets what it may run, and `claudeCode()` as installed above has none: it can run shell commands as the server's user, so a task, or a file the agent reads, can reach the rest of the machine. [Harness runs](../reference/harness-runs.md) has the workspace options and how to turn on each agent's sandbox.

## A verdict before it counts

The agent finishing and the task being done are separate facts. A task completes when the run ended normally and, if it changed files, your `checks` pass in the checkout. For a task with a goal, the judge, on by default, reads the goal against the agent's answer and its commits. A confident "not done" fails the attempt; a doubtful one, or a judge that errors, leaves the decision to the checks. A run that opened a pull request waits for it instead: the task completes when the pull request merges, even if the judge said not done, and the judge's reason shows as a note on the task. A run that spends its turns or budget stops cleanly and is not done.

Anything short of done fails the attempt, and the next attempt is told why. A green check is evidence, not proof: the checkout's scripts are ones the agent could edit. Set `review: true` on the kit to have a user read the commits before the task completes. The order of the conditions and the run's statuses are in [Harness runs](../reference/harness-runs.md).

## Asking you a question

A task can stop and wait on you. While it waits it holds no lease and no checkout, and starts no other run. The question shows in your Inbox, the list of things waiting on a user. The judge puts one there when it cannot tell whether the goal is met, and a review you turned on waits there too. By default the agent does not ask you questions itself. [Harness runs](../reference/harness-runs.md) shows how to let it.

You answer a question in the Inbox, or by typing a line in the run's session. The answer resumes the same coding session in the same checkout, and does not use up a retry. A review is answered in the Inbox: accepting it completes the task, and asking for changes sends your words to the same session for one more run.

## Choosing a harness

Agents go in a slot called `harnesses`. A slot is an opening the harness kit leaves for other kits to fill, and each agent is one value in it. A worker's `harness:` line names one by id.

<Figure svg={HarnessSlot} caption="The agent is a value in a slot" description={"Three boxes from left to right. The worker file for engineering.coder says flow coder and harness claude-code; the harness line is highlighted as the one line you change. An arrow leads to the coder flow, which takes the checkout, runs the agent and reads the verdict, the same for every agent. An arrow leads to the harnesses slot, which holds two values in boxes, claude-code from claudeCode() and codex from codexHarness()."} />

Moving `engineering.coder` from Claude Code to Codex changes the `harness:` line to `codex`, and puts Codex's value in the slot. Codex is not a kit like Claude Code, so it goes in with `fill`, which puts values into a slot another kit opened. In `fsdev.config.ts`, drop `claudeCode()` from `kits` and add `fill` beside it:

```ts title="fsdev.config.ts"
import { codexHarness } from "@flow-state-dev/codex";
import { createFlowState } from "@flow-state-dev/engine";
import { harnesses } from "@flow-state-dev/harness-manager/kit";
import { workforce } from "@flow-state-dev/workforce/kit";
// workspace as in the first example

export default createFlowState({
  kits: [
    workforce({ agent: { model: "openai/gpt-6-luna" } }),
    harnesses({ workspace, checks: { commands: ["pnpm test"] } }),
  ],
  fill: { [harnesses.slots.harnesses]: [codexHarness()] },
});
```

The flow does not change, and what differs between agents, such as the sandbox, lives inside each harness value. Before each task the flow checks that the named harness can run on this machine. If it can't, say Codex has never been signed in here, the task fails at once with the reason and what to run, such as `codex login`. It never falls back to another agent.

## What it gets you

- **Failures stay in a branch.** A failed attempt leaves its changes on its own branch, not in your checkout.
- **Done means checked.** `fix-cart-test` is not closed because the agent went quiet.
- **Questions wait for you.** Your answer continues the same session, without using a retry.
- **Agents are interchangeable.** Switching from Claude Code to Codex changes the worker's `harness:` line and the slot's value. The flow stays the same.

## How it fits with the others

A coding worker is a [worker](./workers.md) on the `coder` flow. A lead that delegates to it files a task on a [board](./tasks-and-boards.md), and the run is the work of that task.

## Next

- [Harness runs](../reference/harness-runs.md) has run states, the verdict contract, workspace options and per-agent differences.
- [Workers](./workers.md) covers the file that makes `engineering.coder`.
- [Kits and slots](./kits-and-slots.md) covers how the harness kit and an agent fit together.
