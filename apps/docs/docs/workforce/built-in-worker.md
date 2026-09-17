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

Its settings are `instructions`, `model`, `tools`, and the `skills` switches below. `flow: agent` names the same kind explicitly, and hires the same way.

## A request needs an org

A worker's **skills** — the folders of instructions it can pull into a turn, covered [below](#skills) — are stored at org scope, so a request has to be bound to an org before the worker can run. One carrying only a `userId` fails before the model is reached:

```
Resource "skills" is not registered
```

The request has to resolve to an org. An app on the default principal resolver does that by sending an `orgId` with the request; an app that configures its own `resolvePrincipal` has to return the org from there, because the route reads the resolved principal and ignores a body `orgId` — a caller cannot name its own org. [The client reference](/docs/configuration/client) covers how a request carries one.

## Tools

A worker names its tools by key in `tools:`, and the keys come from the kind's **catalog**: a map from key to tool that your app passes when it builds the kind, since a file on disk can only carry a name. Naming a key the catalog does not carry is refused at the hire, by name. An empty `tools:`, or none at all, means no catalog tools, whatever else the catalog holds.

`tools:` is not the only way a tool reaches a worker, though:

- **The skill loader**, when the worker sets [`skills.activateTool`](#using-them). It lets the model pull a skill the worker holds into the turn as it runs. It is not a catalog tool, so `tools:` neither lists it nor holds it back.
- **A tool a capability carries**, when you attach one through `defineAgentWorkerFlow`'s `uses`. A capability's tools reach every worker of the kind whatever that worker's `tools:` names, so turn tool-bearing presets off unless you want them on the whole roster. [Giving workers memory](#giving-workers-memory) does exactly that.
- **The delegation controls**, when a skill the worker holds declares `agents:`. Activating that skill puts the task board's eight tools and `runBoard` on the worker, so it can create tasks and run them. They are not catalog tools either, and `tools: []` does not hold them back.

Past those three, a skill cannot widen the catalog. Declaring a tool under a skill's `allowed-tools` does not grant it. Neither does delegating: a worker the delegation seats is seated from the holding worker's `tools:`, so a worker with `tools: []` reaches no catalog tool through a delegate — it can command the board, but the workers it commands are fenced.

Checking `tools:` against a catalog is the built-in kind's rule, not a rule of `hireWorkforce`. A kind you write yourself declares its own settings, so whether a `tools:` name is checked against anything is that kind's business.

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
| `catalog` | The tools workers may name in `tools:`, by key. Left out, the built-in has no tools at all. |
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
      // Memory's two tools, turned off. `recall` searches stored memory on
      // demand; `connect` traverses relations between entities. See below.
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

**Turn `recall` and `connect` off.** They arrive as tools (`recall` searches stored memory on demand, `connect` walks the relations between entities), and a capability's tools reach every worker of the kind whatever its `tools:` names. With them off, a worker reads what it knows as injected context every turn instead of searching on request. If you want on-demand search back, put the [recall tool](../memory/recall-tool.md) in your app's own catalog, where a worker opts in by naming it like any other tool.

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
