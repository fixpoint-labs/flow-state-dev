---
title: The built-in worker
sidebar_position: 3
sidebar_label: The built-in worker
description: "The agent worker flow the framework ships: a worker that talks, steered by its own file, with tools, skills, and memory you add when you want them."
---

import Figure from "@site/src/components/Figure";
import BuiltInWorkerMemoryDrawing from "./built-in-worker-memory.svg";

# The built-in worker

Write a description and some instructions in a `WORKER.md`, name no `flow:`, and you have a worker that talks. It runs on a worker flow the framework ships, called `agent`.

```md
---
description: Holds the engineering board.
---

You are the engineering lead. You break work into tasks and report back.
```

```ts
import { createWorkerInstallation, hireWorkforce } from "@flow-state-dev/workforce";
import { readWorkforce } from "@flow-state-dev/workforce/loader";

const { workers } = await readWorkforce("./workforce");

const installation = createWorkerInstallation({ standardWorkers: workers });
flowRegistry.registerMany(hireWorkforce(installation));
```

No `workerFlows` argument, no flow of your own. Every worker that runs on `agent` shares its one registered copy, and each turn runs as the worker its session names. The body becomes the worker's instructions and steers its answers; `description` is a label for the roster and never reaches the model.

The settings a worker writes for itself are `instructions`, `model`, `tools`, the `skills` switches below, `capabilities` — which picks presets from the capabilities the worker flow carries, covered in [Capabilities on disk](./capabilities-on-disk.md) — and `packages`, which takes [packages](./packages-on-disk.md) from its team's or the org's library. Four more reach the worker in the same bag, put there by the installation rather than by the file: the team's instructions, the skills the worker's folders hold, the blocks its `tools:` resolved out of its own levels, and the instructions and blocks of the packages it holds. A file that declares one of those four is refused by name. `flow: agent` names the same flow explicitly, and hires the same way.

## Tools

A worker names its tools by key in `tools:`, and each key is resolved against what is registered for that worker: its own `blocks/` folder first, then its team's, then the worker flow's **catalog**. That last one is a map from key to tool your app passes when it builds the flow, since a file on disk can only carry a name. The first match wins. An org worker, one under `org/workers/`, has no team and no `blocks/` folder of its own, so its tools come from the catalog and from the packages it holds. A block in a [package](./packages-on-disk.md) the worker holds can be named there too; a name that is both a package block and a catalog tool is refused at the hire, naming both. A key nothing registers is refused at the hire, by name, and the refusal names both doors. An empty `tools:` means no tools, whatever is registered.

**Registering a name is not granting it.** Dropping a block into a team worker's own `blocks/` folder makes the name resolvable for that worker and nothing more; until the file lists it, the model is never handed it. [Blocks a worker can call](./code-on-disk.md#blocks-a-worker-can-call) covers where a folder may sit and the two rules that keep a registered name honest.

A written `tools:` list is the whole of what a worker can call. With no list, a worker can call the tools of the presets it selected in [`capabilities:`](./capabilities-on-disk.md#a-preset-carrying-a-tool) and the blocks of the packages it holds, and nothing else. A capability you attach through [`defineAgentWorkerFlow`'s `uses`](#configuring-the-worker-flow) can carry tools of its own, and a preset the flow switches on gives its tools only to the workers that select it. Memory is the case you meet first. Its `recall` and `connect` presets are on by default, and a worker that selected nothing and named no tools reaches the model with no tools. To give a worker one of them, select the preset in its `capabilities:`, or put the tool in the catalog and let the worker name it in `tools:`.

Everything else a capability brings is unaffected. Context injection, storage, and helpers arrive whatever `tools:` says, which is what the memory recipe [below](#giving-workers-memory) runs on: the worker reads what it remembers each turn and calls nothing to get it.

A worker's own settings can still put a **control** on it. A control is a piece of framework machinery rather than a tool from your catalog, and the setting that switched it on is what put it there, so `tools:` neither lists it nor holds it back:

- **The skill loader**, when the worker sets [`skills.activateTool`](#using-them). It lets the model pull a skill the worker holds into the turn as it runs.
- **The controls a capability preset declares**, when the worker selects that preset in its [`capabilities:`](./capabilities-on-disk.md#a-preset-carrying-a-tool) key. A preset's `controlTools` reach the worker even with `tools: []`.

The four [standing rules](./standing-rules.md) tools, `rules/read`, `rules/add`, `rules/change` and `rules/remove`, sit outside `tools:` too. Every worker on `agent` gets them on a turn a user's own message started, and no worker gets them on any other turn.

A skill cannot widen the catalog. Declaring a tool under a skill's `allowed-tools` does not grant it. Holding a package gives a worker with no `tools:` line that package's blocks; they are not added to the catalog. See [Packages on disk](./packages-on-disk.md#its-tools).

Checking `tools:` against a catalog is the built-in worker flow's rule, not a rule of `hireWorkforce`. A worker flow you write yourself declares its own settings, so what a `tools:` name is checked against is that flow's business. So is whether it declares `tools` at all.

What the key *means* is not. `tools` is reserved across hireable worker flows for one thing: the names of tools that worker may call. Hiring resolves each name against what is registered for that worker before your flow ever sees the bag, so the key is not available for unrelated configuration of your own — give that its own name.

## Configuring the worker flow

To give the built-in a tool catalog, build the worker flow yourself with `defineAgentWorkerFlow` and pass it under `agent`:

```ts
import { createWorkerInstallation, defineAgentWorkerFlow, hireWorkforce } from "@flow-state-dev/workforce";
import { readWorkforce } from "@flow-state-dev/workforce/loader";
import { boardTool, searchTool } from "./tools";

const { workers } = await readWorkforce("./workforce");

const installation = createWorkerInstallation({
  standardWorkers: workers,
  workerFlows: () => ({
    agent: defineAgentWorkerFlow({ installation, catalog: { board: boardTool, search: searchTool } }),
  }),
});
const flows = hireWorkforce(installation);
```

`workerFlows` is a function here because the built-in is built on the installation: it takes the installation's session, so each session names its worker, and loads that worker on every turn. The function is read when first needed. The copy you pass replaces the built-in rather than adding to it. It takes over for every worker that runs on `agent`: the records that leave `flow:` out, and any that name `agent` outright. A worker naming any other flow is unaffected. With no `workerFlows` at all the installation adds the built-in itself, and the workers have no tool catalog.

`defineAgentWorkerFlow` takes:

| Option | What it does |
| --- | --- |
| `installation` | The installation that runs this flow's workers. Required for a copy you register: `hireWorkforce` refuses a worker flow that doesn't declare the installation's session. |
| `catalog` | The tools every worker on this flow may name in `tools:`, by key — `workforce.gen.ts`'s `blocks` export goes straight in. Left out, the only names a worker can resolve are the ones its own folders register. Whatever a catalog tool declares as a resource is installed on the flow, for every worker on it. |
| `skills` | Skills every worker on this flow holds, on top of the ones its own folders hold. A name that collides with a skill a worker already holds is refused at the hire. |
| `model` | The model a worker uses when its own file names none. |
| `classifierModel` | The model behind `skills.enableLlmClassifier`, an optional per-turn check that decides whether a skill applies. [Using them](#using-them) covers what it costs. |
| `confidenceThreshold` | How sure that check must be before it counts a skill as matching. Defaults to `0.65`. |
| `uses` | Capabilities every worker on this flow carries, attached to the generator that answers. |
| `afterAnswer` | A block that runs after the worker answers, without changing the reply. In a conversation its failure is only logged; in a task it fails the attempt, unless the task was filed with its [result going to the conversation](./delegating-work.md#where-a-task-runs-and-where-its-result-goes). |
| `isolateUserState` | Keep this flow's user-scoped storage apart from other flows'. Every worker on `agent` shares one copy, so a user's workers on it still share the same user-scoped storage. |

`classifierModel` and `confidenceThreshold` belong to the worker flow: nothing reads either until a worker turns `skills.enableLlmClassifier` on, and a `WORKER.md` that names one is refused at the hire, by name, along with any other setting the flow does not declare. `uses` and `afterAnswer` are what [Giving workers memory](#giving-workers-memory) uses.

A replacement declares `kind: "agent"`, like any other flow passed under its own name.

## Taking a task

A worker on this flow takes tasks with no setup. When a [coordinator](./coordinators.md), a worker that hands work to other workers called its delegates, files a task for it, the worker runs the task as one turn in a task session of its own. The worker answers with its own instructions, tools and model. The message is the task's title, goal and context. The answer is stored as the task's result, and the task completes. If the turn fails, the attempt fails.

A task goes only to a worker on the filing user's roster, one your files declare or one of their own. Another user's worker is refused the way a worker nobody holds is. Filing a task, retries, and what the filing conversation hears are in [Handing out tasks](./coordinators.md#handing-out-tasks).

## What a worker keeps

A conversation keeps its recent turns, each worker keeps its own skills for each user, and long-term memory, once you add it, is kept per user and shared by that user's workers.

Standing rules, the notes you've asked a worker to keep, are kept per worker and per user, and read on every turn. See [Standing rules](./standing-rules.md).

<Figure svg={BuiltInWorkerMemoryDrawing} caption="What a built-in worker keeps, and who shares it" description={"A conversation holds recent turns, a worker's skills are kept per user, and memory is kept per user"} />

## Skills

A worker's skills are that worker's, kept in the scope of the user it runs for: two people never share one worker's copy. Send `userId` with the input. The skills read are the ones stored for that user.

Which skills a worker gets is decided by where the folders sit. Three places feed a worker on a team:

```
workforce/
  org/
    skills/
      house-style/          # every worker on every team
        SKILL.md
  teams/
    qa/
      skills/
        regression/         # every worker on the qa team
          SKILL.md
      workers/
        tester/
          WORKER.md
          skills/
            write-regression/   # this worker only
              SKILL.md
```

The `tester` worker holds all three. The `qa` lead next door holds the first two. Nobody on another team holds `regression` at all, and no one anywhere else holds `write-regression`.

An org worker is fed by two: `org/skills/` and its own `org/workers/<name>/skills/`.

`readWorkforce` resolves that union per worker. [Reading the tree](./workers-on-disk.md#reading-the-tree) covers the walk and what it reports.

A skill sitting beside a worker needs no list: the folder already says whose it is. Listing it in `skills:` does something different. It decides how the worker *uses* what it holds.

### Using them

Holding a skill is not the same as running with it. A skill a worker merely holds costs nothing until something activates it, and a worker that uses no skill on a turn pays for none of them.

Four things activate one. Three of them need nothing but a setting or a message:

```md
---
description: Writes regression tests for reported bugs.
tools: [runTests]
skills:
  active: [house-style]
  activateTool: true
---

You write regression tests for reported bugs.
```

- **`active`** lists the skills that are in context on every turn. Use it for the handful a worker should never be without — a house style, a format it always follows. Naming a skill it does not hold is refused, listing what it does hold.
- **A slash message.** Someone typing `/write-regression fix the flake` activates that skill for the turn. This always works, needs no setting, and only responds to what a user typed — a model emitting the same text does not trigger it.
- **`activateTool`** lets the model pull a skill in partway through a turn, once it knows what it is dealing with. Off by default, because turning it on puts a listing of everything the worker holds into every prompt.

The fourth is off by default. `skills.enableLlmClassifier` adds a small model call that decides whether a skill applies. It catches cases a slash and an always-on list miss. A slash match settles the turn before it runs, so it costs a provider round trip on every message that isn't one.

[Activation paths](../skills/activation.md) covers the same mechanisms for a flow of your own, where you wire them up yourself.

### Editing a skill later

A worker keeps a copy from the moment it first reads a skill. Fixing a typo in the company's copy does not reach a worker already running with it, and deleting a skill a worker has does not take it away either. A worker's drawer is its own.

Pulling an edit through is a separate, explicit act — `refreshSeededSkills` from `@flow-state-dev/orchestration`, given the skills you want refreshed. A refresh replaces the whole folder for each skill it touches, so a supporting file the source has dropped is gone afterwards, and so is anything that worker added inside that folder. A skill the worker deleted stays deleted. Check the returned `failed` list: a refresh that could not finish a skill names it there rather than reporting silence.

### Custom worker flows

Skills reach every hireable worker flow the same way, this one included: they arrive in the settings bag as `workerSkills`, because the flow's `configSchema` composed `workerConfigSchema()`. The built-in is built that way, and so is [a worker flow you define yourself](./workers-on-disk.md#the-flow-decides-what-a-worker-may-declare). That page has the contract and what it holds. Your flow is free to ignore the skills it receives. It can't skip the rest of the [worker flow contract](./workers-on-disk.md#which-flows-can-run-workers).

## Giving workers memory

The built-in sees only the conversation it's in: each turn, its model gets that conversation's last 50 turns and nothing said in any other. Memory costs tokens on every turn and latency on most of them, so it is something you switch on rather than something you inherit.

You turn it on by composing it into your own copy of the worker flow. A *capability* is a bundle you attach to a block — the context it injects, the tools it adds, the storage it needs — and memory ships as one. [Memory](../memory/overview.md) covers the system itself: its tiers, what each one stores, and every knob `system()` takes. What follows is how a roster of workers picks it up.

It rides on two options in the table above: `uses` and `afterAnswer`. Here is the whole recipe:

```ts
import { AGENT_FLOW, createWorkerInstallation, defineAgentWorkerFlow, hireWorkforce } from "@flow-state-dev/workforce";
import { readWorkforce } from "@flow-state-dev/workforce/loader";
import { system } from "@flow-state-dev/memory";
import { boardTool, searchTool } from "./tools";

const mem = system({
  model: "openai/gpt-6-luna",
  working: { capacity: 7 },
  episodic: true,
  semantic: true,
});

const { workers } = await readWorkforce("./workforce");

const installation = createWorkerInstallation({
  standardWorkers: workers,
  workerFlows: () => ({ [AGENT_FLOW]: remembers }),
});

const remembers = defineAgentWorkerFlow({
  installation,
  catalog: { board: boardTool, search: searchTool },
  uses: [
    mem.capability.presets({
      // Memory's two tools, off for the whole flow, so no worker can
      // select them. Leave them on and a worker selects them in `capabilities:`.
      recall: false,
      connect: false,
      // What the worker reads back each turn. Both are off by default.
      semantic: true,   // facts it has learned
      episodic: true,   // things that happened
    }),
  ],
  // The write side. Without this, nothing is ever recorded.
  afterAnswer: mem.captureFromItems,
});

const flows = hireWorkforce(installation);
```

Tell a worker something in one conversation and it knows it in the next. Memory is kept per user, and every worker on `agent` shares one copy, so one user's workers on it share what it remembers. It never reaches another user.

### The parts that are easy to get wrong

**Reach for `system()`, not `createMemoryCapability`.** The latter builds the read side only. Attach it and you get a worker that recites facts someone else stored and records nothing from its own conversations — a worker that looks like it remembers.

**`afterAnswer` is the write side.** Leave it out and the durable stores stay empty. It runs beside the answer rather than in front of it, so it cannot change what the worker said, and a capture that fails is not a failed conversation.

In a task, a capture that fails does fail the attempt, the same as any other background step, so the task runs again while it has attempts left. The exception is a task filed with `resultTo: "conversation"`, whose result [belongs to the conversation](./delegating-work.md#where-a-task-runs-and-where-its-result-goes) rather than to whoever filed it. It gets one attempt, so there the failed capture is logged and the task keeps its answer. To make the capture best-effort everywhere, give `afterAnswer` a block that catches its own errors.

**Turn `semantic` and `episodic` on.** They are off by default. Skip them and the durable stores fill up and are never read back, which is the failure that looks fine until someone starts a second conversation.

**`recall` and `connect` reach only the workers that select them.** They are memory's two tools: [`recall`](../memory/recall-tool.md) searches stored memory on demand, `connect` walks the relations between entities. A worker gets them by selecting them, and it can select them only if the flow leaves them on. To give a worker on-demand search, leave `recall` on (drop `recall: false` from the recipe) and let the worker select it:

```md
---
capabilities:
  memory: [recall]
---
```

A worker that writes a `tools:` line has to name the tool there instead. For that, put it in the flow's catalog under the key `memory/recall`. The key has to match the tool's own name; a catalog key that doesn't is refused when the flow is built:

```ts
const remembers = defineAgentWorkerFlow({
  catalog: { board: boardTool, search: searchTool, "memory/recall": mem.tool.recall() },
  // ...the rest as above
});
```

> To list a block under a different key, rename the block to match with
> [`.as({ name })`](../fundamentals/blocks.md#renaming-a-block-for-the-model-as). If a
> capability in `uses` and the catalog both list the renamed block, build it once and pass that
> one value to both. Each `.as()` call returns a new block, so two calls give two different
> blocks under one key, and `defineAgentWorkerFlow` throws
> (`refused catalog key "memory/recall"`).

Then the worker names it like any other tool:

```md
---
tools: [memory/recall]
---
```

### Whose memory it is

Every worker on `agent` runs on one shared copy, so what a worker remembers depends on the tier:

- **Long-term memory** (episodic, semantic and digest) is kept per user, in their user scope in
  the organization they're signed in to. One user's workers on `agent` share it: tell one of
  them something and another may recall it. It never crosses people: another user's workers
  can't read it. That is at the tiers' default `user` scope; a tier you set to `org` scope is
  shared with the whole organization.
- **Working memory** is kept per conversation. A conversation runs one worker for its whole life,
  so it is that worker's own.
- **Skills** are kept per worker, for each user, by the built-in itself.

`isolateUserState: true` keeps the `agent` flow's user-scoped storage apart from every other
flow's. It doesn't separate workers on `agent`: they share the one copy it keys on.

A memory tier can override that with its own `flowIsolation`, set on `episodic` or `semantic` in
`system()`. The `agent` flow can, for example, keep its episodes apart from the user's other
flows while sharing semantic facts with them. Per-tier isolation doesn't separate workers on
`agent` from each other either. See
[Sharing a tier across flows](../memory/configuration.md#sharing-a-tier-across-flows).

## Related pages

- [Workers on disk](./workers-on-disk.md) — the folder tree, `WORKER.md`, `readWorkforce`, `hireWorkforce`, and talking to a worker.
- [Workforce](./overview.md) — what a roster is, and when to reach for it instead of a task board.
- [Skills](../skills/overview.md) — what a `SKILL.md` is and what goes in one.
- [Activation paths](../skills/activation.md) — the ways a skill becomes active, and what each costs.
- [Memory](../memory/overview.md) — the tiers, and everything `system()` takes.
- [Standing rules](./standing-rules.md) — notes a worker keeps for you, and how to edit them.
