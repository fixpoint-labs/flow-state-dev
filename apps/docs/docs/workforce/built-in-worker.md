---
title: The built-in worker
sidebar_position: 3
sidebar_label: The built-in worker
description: "The agent kind the framework ships: a worker that talks, steered by its own file, with tools, skills, and memory you add when you want them."
---

# The built-in worker

Write a description and some instructions in a `WORKER.md`, name no `flow:`, and you have a worker that talks. It runs on a flow kind the framework ships, called `agent`.

```md
---
description: Holds the engineering board.
---

You are the engineering lead. You break work into tasks and report back.
```

```ts
import { hireWorkforce } from "@flow-state-dev/workforce";
import { readWorkforce } from "@flow-state-dev/workforce/loader";

const { workers } = await readWorkforce("./workforce");

const seats = hireWorkforce(workers);

flowRegistry.registerMany(seats);
```

No `kinds` argument, no flow of your own. The body becomes the worker's instructions and steers its answers; `description` is a label for the roster and never reaches the model.

Its settings are `instructions`, `model`, `tools`, the `skills` switches below, and `capabilities` — which picks presets from the capabilities the kind carries, covered in [Capabilities on disk](./capabilities-on-disk.md). `flow: agent` names the same kind explicitly, and hires the same way.

## A request needs an org

A worker's **skills** — the folders of instructions it can pull into a turn, covered [below](#skills) — are stored at org scope, so a request has to be bound to an org before the worker can run. One carrying only a `userId` fails before the model is reached:

```
Resource "skills" is not registered
```

The request has to resolve to an org. An app on the default principal resolver does that by sending an `orgId` with the request; an app that configures its own `resolvePrincipal` has to return the org from there, because the route reads the resolved principal and ignores a body `orgId` — a caller cannot name its own org. [The client reference](/docs/configuration/client) covers how a request carries one.

## Tools

A worker names its tools by key in `tools:`, and each key is resolved against what is registered for that worker: its own `blocks/` folder first, then its team's, then the kind's **catalog** — a map from key to tool that your app passes when it builds the kind, since a file on disk can only carry a name. The first match wins. A key nothing registers is refused at the hire, by name, and the refusal names both doors. An empty `tools:`, or none at all, means no tools, whatever is registered.

**Registering a name is not granting it.** Dropping a block into a worker's own folder makes the name resolvable for that worker and nothing more; until the file lists it, the model is never handed it. [Blocks a worker can call](./workers-on-disk.md#blocks-a-worker-can-call) covers where a folder may sit and the two rules that keep a registered name honest.

That list is the whole of what a worker can call. A capability you attach through [`defineAgentWorkerFlow`'s `uses`](#configuring-the-kind) can carry tools of its own, and they do not reach a worker: the model is handed the worker's own list and nothing else. Memory is the case you meet first. Its `recall` and `connect` presets are on by default, and a worker that named no tools still reaches the model with no tools. To give a worker one of them, put it in the catalog and let the worker name it, like any other tool.

Everything else a capability brings is unaffected. Context injection, storage, and helpers arrive whatever `tools:` says, which is what the memory recipe [below](#giving-workers-memory) runs on: the worker reads what it remembers each turn and calls nothing to get it.

A worker's own settings can still put a **control** on it. A control is a piece of framework machinery rather than a tool from your catalog, and the setting that switched it on is what put it there, so `tools:` neither lists it nor holds it back:

- **The skill loader**, when the worker sets [`skills.activateTool`](#using-them). It lets the model pull a skill the worker holds into the turn as it runs.
- **The delegation controls**, when a skill the worker holds declares `agents:`. Activating that skill puts the task board's eight tools and `runBoard` on the worker, so it can create tasks and run them.
- **The controls a capability preset declares**, when the worker selects that preset in its [`capabilities:`](./capabilities-on-disk.md#a-preset-carrying-a-tool) key. A preset's `controlTools` reach the worker; its `tools` do not.

A skill cannot widen the catalog. Declaring a tool under a skill's `allowed-tools` does not grant it. Neither does delegating: a worker the delegation seats is seated from the holding worker's catalog tools, so a worker with `tools: []` reaches nothing through a delegate — it can command the board, but the workers it commands are fenced. A block from a worker's own folder does not travel that way either: a delegated worker is its own seat, with its own folder and its own list.

Checking `tools:` against a catalog is the built-in kind's rule, not a rule of `hireWorkforce`. A kind you write yourself declares its own settings, so what a `tools:` name is checked against is that kind's business — and so is whether it declares `tools` at all.

What the key *means* is not. `tools` is reserved across hireable kinds for one thing: the names of tools that seat may call. Hiring resolves each name against what is registered for that seat before your kind ever sees the bag, so the key is not available for unrelated configuration of your own — give that its own name.

## Configuring the kind

To give the built-in a tool catalog, build the kind yourself with `defineAgentWorkerFlow` and pass it under `agent`:

```ts
import { defineAgentWorkerFlow, hireWorkforce } from "@flow-state-dev/workforce";
import { readWorkforce } from "@flow-state-dev/workforce/loader";
import { boardTool, searchTool } from "./tools";

const { workers } = await readWorkforce("./workforce");

const seats = hireWorkforce(workers, {
  kinds: {
    agent: defineAgentWorkerFlow({
      catalog: { board: boardTool, search: searchTool },
    }),
  },
});
```

`defineAgentWorkerFlow()` with no arguments is the built-in itself, so the copy you pass replaces it rather than adding to it. It takes over for every seat that runs on the `agent` kind: the records that leave `flow:` out, and any that name `agent` outright. A worker naming any other kind is unaffected. Hire with no `kinds` at all and the workers have no tool catalog.

`defineAgentWorkerFlow` takes:

| Option | What it does |
| --- | --- |
| `catalog` | The tools every worker of this kind may name in `tools:`, by key — `workforce.gen.ts`'s `blocks` export goes straight in. Left out, the only names a worker can resolve are the ones its own folders register. Whatever a catalog tool declares as a resource is installed on the kind, for every worker of it. |
| `skills` | Skills every worker of this kind holds, on top of the ones its own folders hold. A name that collides with a skill a worker already holds is refused at the hire. |
| `model` | The model a worker uses when its own file names none. |
| `classifierModel` | The model behind `skills.enableLlmClassifier`, an optional per-turn check that decides whether a skill applies. [Using them](#using-them) covers what it costs. |
| `confidenceThreshold` | How sure that check must be before it counts a skill as matching. Defaults to `0.65`. |
| `uses` | Capabilities every worker of this kind carries, attached to the generator that answers. |
| `afterAnswer` | A block that runs after the worker answers, without changing the reply. |
| `isolateUserState` | Give each worker its own user-scoped storage instead of one shared cell. |

`classifierModel` and `confidenceThreshold` belong to the kind: nothing reads either until a worker turns `skills.enableLlmClassifier` on, and a `WORKER.md` that names one is refused at the hire, by name, along with any other setting the kind does not declare. The last three are what [Giving workers memory](#giving-workers-memory) uses.

A replacement declares `kind: "agent"`, like any other kind passed under its own name. It also declares `cardinality: "collection"`, which is what lets one definition have many copies. Leave that out and each seat mints, then is refused when you register it.

## Skills

A worker's skills are that worker's. Each one keeps its own copy, so two workers on one roster never read each other's instructions.

Which skills a worker gets is decided by where the folders sit. Three places feed one worker:

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

`readWorkforce` resolves that union per worker — [Reading the tree](./workers-on-disk.md#reading-the-tree) covers the walk and what it reports.

A skill sitting beside a worker needs no list: the folder already says whose it is. Listing it in `skills:` does something different. It decides how the worker *uses* what it holds.

### Using them

Holding a skill is not the same as running with it. A skill a worker merely holds costs nothing until something activates it, and a worker that uses no skill on a turn pays for none of them.

Three things activate one:

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
- **A slash message.** Someone typing `/write-regression fix the flake` activates that skill for the turn. This always works, needs no setting, and only responds to what a person typed — a model emitting the same text does not trigger it.
- **`activateTool`** lets the model pull a skill in partway through a turn, once it knows what it is dealing with. Off by default, because turning it on puts a listing of everything the worker holds into every prompt.

A fourth path is off by default. `skills.enableLlmClassifier` adds a small model call that decides whether a skill applies. It catches cases a slash and an always-on list miss. A slash match settles the turn before it runs, so it costs a provider round trip on every message that isn't one.

[Activation paths](../skills/activation.md) covers the same mechanisms for a flow of your own, where you wire them up yourself.

### Editing a skill later

A worker keeps a copy from the moment it first reads a skill. Fixing a typo in the company's copy does not reach a worker already running with it, and deleting a skill a worker has does not take it away either. A worker's drawer is its own.

Pulling an edit through is a separate, explicit act — `refreshSeededSkills` from `@flow-state-dev/orchestration`, given the skills you want refreshed. A refresh replaces the whole folder for each skill it touches, so a supporting file the source has dropped is gone afterwards, and so is anything that worker added inside that folder. A skill the worker deleted stays deleted. Check the returned `failed` list: a refresh that could not finish a skill names it there rather than reporting silence.

### Custom worker kinds

Skills reach every hireable kind the same way, this one included: they arrive in the settings bag as `seatSkills`, because the kind's `configSchema` composed `workerConfigSchema()`. The built-in is built that way, and so is [a kind you define yourself](./workers-on-disk.md#the-flow-decides-what-a-worker-may-declare) — that page has the contract and what it holds. Your kind is free to ignore the skills it receives; what it cannot do is skip the door, since hiring hands the same settings to every seat.

## Giving workers memory

The built-in forgets everything between turns. Memory costs tokens on every turn and latency on most of them, so it is something you switch on rather than something you inherit.

You turn it on by composing it into your own copy of the kind. A *capability* is a bundle you attach to a block — the context it injects, the tools it adds, the storage it needs — and memory ships as one. [Memory](../memory/overview.md) covers the system itself: its tiers, what each one stores, and every knob `system()` takes. What follows is how a roster of workers picks it up.

It rides on the last three options in the table above — `uses`, `afterAnswer` and `isolateUserState`. Here is the whole recipe:

```ts
import { AGENT_KIND, defineAgentWorkerFlow, hireWorkforce } from "@flow-state-dev/workforce";
import { system } from "@flow-state-dev/memory";
import { boardTool, searchTool } from "./tools";

const mem = system({
  model: "openai/gpt-5.4-mini",
  working: { capacity: 7 },
  episodic: true,
  semantic: true,
});

const remembers = defineAgentWorkerFlow({
  catalog: { board: boardTool, search: searchTool },
  uses: [
    mem.capability.presets({
      // Memory's two tools, off. A tool reaches a worker through the kind's
      // catalog and the worker's own `tools:`, never through a capability.
      recall: false,
      connect: false,
      // What the worker reads back each turn. Both are off by default.
      semantic: true,   // facts it has learned
      episodic: true,   // things that happened
    }),
  ],
  // Each worker remembers separately.
  isolateUserState: true,
  // The write side. Without this, nothing is ever recorded.
  afterAnswer: mem.captureFromItems,
});

const seats = hireWorkforce(workers, { kinds: { [AGENT_KIND]: remembers } });
```

Tell a worker something in one conversation and it knows it in the next.

### The parts that are easy to get wrong

**Reach for `system()`, not `createMemoryCapability`.** The latter builds the read side only. Attach it and you get a worker that recites facts someone else stored and records nothing from its own conversations — a worker that looks like it remembers.

**`afterAnswer` is the write side.** Leave it out and the durable stores stay empty. It runs beside the answer rather than in front of it, so it cannot change what the worker said, and a capture that fails is not a failed conversation.

**Turn `semantic` and `episodic` on.** They are off by default. Skip them and the durable stores fill up and are never read back, which is the failure that looks fine until someone starts a second conversation.

**`recall` and `connect` are not how a worker searches.** They are memory's two tools: [`recall`](../memory/recall-tool.md) searches stored memory on demand, `connect` walks the relations between entities. Neither reaches a worker from the capability, so leaving the presets on buys nothing. To give a worker on-demand search, put the tool in the kind's catalog:

```ts
const remembers = defineAgentWorkerFlow({
  catalog: { board: boardTool, search: searchTool, recall: mem.tool.recall() },
  // ...the rest as above
});
```

Then the worker names it like any other tool:

```md
---
tools: [recall]
---
```

### What isolation does and does not give you

`isolateUserState: true` keys each worker's storage on that worker's id, so two workers serving the same person do not read each other's memory. Leave it off and they share one.

It is a decision for the whole kind. A roster is all-separate or all-shared; you cannot keep one shared store across the team while giving each worker its own of something else.

The flag decides *where* a worker's memory is stored, so anything that moves the key leaves the old memory behind. Renaming a worker does it, because the key is the worker's id. So does turning the flag on for a roster that has already been talking to people, because shared and separate are different places. Neither has a migration. Decide it before the roster has anything worth keeping, or accept that workers start fresh.

## Related pages

- [Workers on disk](./workers-on-disk.md) — the folder tree, `WORKER.md`, `readWorkforce`, and `hireWorkforce`.
- [Workforce](./overview.md) — what a hired roster is, and when to reach for it instead of a task board.
- [Skills](../skills/overview.md) — what a `SKILL.md` is and what goes in one.
- [Activation paths](../skills/activation.md) — the ways a skill becomes active, and what each costs.
- [Memory](../memory/overview.md) — the tiers, and everything `system()` takes.
