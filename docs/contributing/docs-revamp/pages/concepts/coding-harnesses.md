---
title: Coding harnesses
type: concept
description: A coding agent such as Claude Code, Codex or Cursor, run as one block in a checkout of its own, with a verdict read before its task counts as done.
---

import Figure from "@site/src/components/Figure";
import SupervisedRun from "./figures/a-supervised-run.svg";
import HarnessSlot from "./figures/the-harness-is-a-slot.svg";

# Coding harnesses

A coding harness is how an app hands a coding agent a job and gets back work it can trust. Two things go wrong when you point an agent at code. It edits the directory you are working in. And it stops, and you take stopping for finished.

So a harness gives the agent a directory of its own, and holds the task open until a verdict says the work is done.

## If you know coding agents

The agent is the one you already use at a terminal: Claude Code, Codex or Cursor, each the vendor's own. It takes a prompt, works in a loop in a directory, and reports what it did.

The difference is who runs it. Flow State runs the agent as a step with a typed input and a typed result, in a directory it prepared, and decides when the work counts.

## The model

Take a task, `fix-cart-test`, filed for `engineering.coder` with the goal "make `cart.test.ts` pass". The run happens in a checkout made for that task. When the agent stops, a verdict is read. Only then does the task complete.

<Figure svg={SupervisedRun} caption="A supervised run: checkout, agent, verdict" description={"Three boxes from left to right. The task fix-cart-test, with its goal, worker engineering.coder and harness claude-code, is on the board and has a hatched top because it outlives the request. An arrow leads to the run, claude-code working in its own git branch and its own directory, with a note that your working tree is not edited. An arrow leads to the verdict: status completed, outcome finished, pnpm test passes. The last row, then the task completes, is highlighted. A dashed arrow runs from the verdict back to the task and is labelled not done."} />

## A coding agent as a block

A harness is a block, so a sequencer can step it. On its own it needs a prompt and nothing else:

```ts title="src/flows/tidy/blocks/tidy-imports.ts"
import { claudeCodeAgent } from "@flow-state-dev/claude-code";

export const tidyImports = claudeCodeAgent();
// Step it in a sequencer with { prompt: "Tidy the imports in src/." }
```

It returns a handle with `status`, `outcome` and `finalMessage`. Every agent returns the same shape, so code that reads the handle works the same whichever agent made it. A block like this has no checkout and no verdict. Those come from the harness kit.

## Install the kit

The harness kit turns coding tasks into supervised runs. It needs Workforce, and an agent to run:

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

`workspace` says where runs work and where their files come from, and `checks` are commands a run has to pass. A worker becomes a coding worker with two lines:

```md title="workforce/teams/engineering/workers/coder/WORKER.md"
---
description: Fixes failing tests in the shop's repository.
flow: coder
harness: claude-code
---

Fix what the task describes. Keep the change small.
```

## Its own checkout

Each task gets its own git branch and its own directory under the workspace's `root`. A retry lands in the same directory with the work it already did.

Your checkout's working tree, index and branches are not edited. A repository you list in `localRepositories` shares its git refs with runs, so a run can create or move branches and tags there. Leave it out of the list and the host clones it instead.

The checkout is where the agent is pointed, not a jail. The sandbox on its harness sets what it may run.

## A verdict before it counts

The agent finishing and the task being done are separate facts. When the agent stops, the run is read in order:

- `status` must be `completed`: it ended normally.
- `outcome` must be `finished`. A run that spends its turns or budget reports `stopped-at-limit`, which is not done.
- Every command in `checks` must pass in the checkout, if the run changed files.
- A judge reads the goal against the answer and the commits, and says done, not done or ask.

Anything short of done fails the attempt, and the next attempt's brief carries the reason. A green check is evidence, not proof: the checkout's scripts are ones the agent could edit. Set `review: true` on the kit to have someone read the commits before the task completes.

## Asking you a question

When a run needs a decision, the task stops and waits, and nothing is spent while you think. The question shows in your Inbox. The agent can ask when its brief tells it where to leave a question, and the judge asks when it cannot tell whether the goal is met.

You answer in the Inbox, or by typing a line in the run's session. The answer resumes the same coding session in the same checkout, and does not use up a retry.

## Choosing a harness

The harness is a slot: one value for each agent. A worker's `harness:` line names one by id.

<Figure svg={HarnessSlot} caption="The agent is a value in a slot" description={"Three boxes from left to right. The worker file for engineering.coder says flow coder and harness claude-code; the harness line is highlighted as the one line you change. An arrow leads to the coder flow, which takes the checkout, runs the agent and reads the verdict, the same for every agent. An arrow leads to the harnesses slot, which holds two values in boxes, claude-code from claudeCode() and codex from codexHarness()."} />

Moving `engineering.coder` from Claude Code to Codex changes the `harness:` line to `codex`, and fills the slot with Codex's value. Codex is not a kit like Claude Code, so it goes in with `fill`:

```ts title="fsdev.config.ts"
import { codexHarness } from "@flow-state-dev/codex";
import { harnesses } from "@flow-state-dev/harness-manager/kit";

export const fill = { [harnesses.slots.harnesses]: [codexHarness()] };
```

Pass that `fill` to `createFlowState` beside `kits`. The flow does not change, and what differs between agents, such as the sandbox, lives inside each harness value. A harness that is not set up on the machine fails the task at once and says why. It never moves to another agent.

## What it gets you

- **Your tree is safe.** A failed attempt leaves its mess in a branch, not in your checkout.
- **Done means checked.** `fix-cart-test` is not closed because the agent went quiet.
- **Questions wait for you.** Your answer continues the same session.
- **Agents are interchangeable.** Switching from Claude Code to Codex is a line in a file.

## How it fits with the others

A coding worker is a [worker](./workers.md) on the `coder` flow. A lead that delegates to it files a task on a [board](./tasks-and-boards.md), and the run is the work of that task.

## Next

- [Harness runs](../reference/harness-runs.md) has run states, the verdict contract, workspace options and per-agent differences.
- [Workers](./workers.md) covers the file that makes `engineering.coder`.
- [Kits and slots](./kits-and-slots.md) covers how the harness kit and an agent fit together.
