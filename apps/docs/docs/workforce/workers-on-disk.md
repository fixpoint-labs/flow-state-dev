---
title: Workers on disk
sidebar_position: 2
sidebar_label: Workers on disk
description: "Workforce convention: describe each worker in a folder, read the tree at startup, and hire what it describes as addressable flow copies."
---

# Workers on disk

Workforce is how you describe a roster of workers and hire it as addressable flow copies. You can write each worker in TypeScript, or put each one in a folder and read the folder at startup.

`readWorkforce` turns a folder tree into plain records. `hireWorkforce` turns those records into flow copies you register.

## The tree

Worker folders are grouped by team, under a root you choose:

```
workforce/
  teams/
    engineering/
      workers/
        lead/
          WORKER.md
        analyst/
          WORKER.md
    support/
      workers/
        intake/
          WORKER.md
```

Three workers in two teams. Someone who does not write TypeScript can add a fourth, or change what one of them has been told to do, by editing a document.

Every example below reads this tree.

## What a WORKER.md says

Settings between the `---` fences, instructions below them:

```md
---
description: Holds the engineering board and breaks work into tasks.
flow: custom-agent
model: openai/gpt-5.4-mini
tools: [board, search]
---

You are the engineering lead. You do not write code yourself. You break the
request into tasks, assign them, and report what came back.
```

`description` is the only key the file itself requires, and `persona:` the only one it refuses. `flow` names which of your flow kinds this worker runs. Leave it out and [hiring](#hiring-the-roster) gives you [the built-in worker](#the-worker-you-get-without-writing-one).

Reading the file checks no other key. Whatever else you write lands on the record spelled exactly as you spelled it. The flow a worker names has the final say: at hiring it [refuses a setting it never declared](#the-flow-decides-what-a-worker-may-declare).

The frontmatter is the same dialect a [`SKILL.md`](../skills/overview.md) uses. If you have written one of those, you already know the shape.

## A worker's identity

A worker's id is its team folder and its own folder joined with a dot. `teams/engineering/workers/lead/` becomes `engineering.lead`.

The team qualifier means every team can have a `lead` without checking what the other teams called theirs. The dot matters because the id is also the address: a hired worker is a flow instance, reached at `POST /api/flows/engineering.lead/actions/run`, and an id containing a `/` registers fine and then fails to route.

Both folder names must be lowercase letters, digits, and single hyphens, at most 64 characters each. So `api-designer` is fine. `API_Designer` and `api.designer` are refused when the tree is read, with the rule in the message.

## Reading the tree

Point `readWorkforce` at the root:

```ts
import { readWorkforce } from "@flow-state-dev/workforce/loader";

const { workers, errors, skillErrors } = await readWorkforce("./workforce");
```

You get one record per worker:

```ts
interface WorkerManifest {
  id: string;                        // "engineering.lead"
  declared: Record<string, unknown>; // the frontmatter, exactly as written
  body: string;                      // the instructions below it, or "" for none
  skills?: InitialSkill[];           // the skills this worker can see
}
```

`skills` is the union of the skills folders that worker draws from — see [Skills](#skills) below. If you only want the worker records and not their skills, `readWorkforceDirectory` reads the same tree and leaves `skills` off.

For the `lead` folder above:

```ts
const lead = workers.find((worker) => worker.id === "engineering.lead")!;

lead.declared;
// { description: "Holds the engineering board and breaks work into tasks.",
//   flow: "custom-agent",
//   model: "openai/gpt-5.4-mini",
//   tools: ["board", "search"] }
lead.body;     // "You are the engineering lead. …"
```

Reading the tree starts nothing. No flow is built, nothing is registered, and no model is contacted. Turning records into workers you can talk to is a separate call.

The subpath matters. `@flow-state-dev/workforce/loader` imports `node:fs`, so it only runs on Node. The package root, where `hireWorkforce` lives, stays isomorphic.

### When a folder is wrong

A folder that should have produced a worker and did not lands in `errors`, and the rest of the workers load anyway. Say the analyst's `WORKER.md` lost its `description`:

```ts
errors;
// [{ path: "teams/engineering/workers/analyst",
//    error: Error('WORKER.md in "analyst/" must declare a non-empty `description`') }]
```

An `errors[].path` never includes the root and is always slash-separated: it starts at `teams/`. It names the folder that failed so you can go find it. It is not a path you can open.

What lands in `errors`:

- a worker folder with no `WORKER.md`, including one that holds only other files (custom behavior is [a flow kind](#when-a-worker-needs-more-than-settings), not a second file in the folder);
- a `WORKER.md` with no frontmatter, or one whose `description` is missing, empty, or not a string;
- a `WORKER.md` that declares `persona:`, which is not a setting a worker declares;
- a team or worker folder name that breaks the naming rules;
- a symlink where a folder or a worker file belongs, refused rather than read;
- a directory that exists but cannot be listed, reported under its own path (`teams`, `teams/<team>`, or `teams/<team>/workers`) so the seats beneath it are not lost silently.

`readWorkforceDirectory` throws in exactly one case: the root you passed cannot be read at all. A root that exists but has no `teams/` folder comes back as `{ workers: [], errors: [] }`.

#### Treat a non-empty `errors` as fatal

```ts
const { workers, errors } = await readWorkforceDirectory("./workforce");
if (errors.length) {
  throw new Error(
    `workforce: ${errors.length} worker(s) failed to load\n` +
      errors.map(({ path, error }) => `  ${path}: ${error.message}`).join("\n"),
  );
}
```

Logging a warning and carrying on is the tempting alternative, and it fails quietly. A reported folder is a worker your app was supposed to have, so the app boots one worker short and says nothing about it. Fail on `errors` at startup unless you have a specific reason to run a short roster.

### What is passed over in silence

A team's `resources/`, `skills/` or `tools/` folder, a `workers/` folder at the top of the tree, a `README.md` sitting inside `teams/<team>/workers/`, an OS or editor file such as `.DS_Store`: none of these produces a worker, and none is reported. The rule is that the path occupies a worker slot, `teams/<team>/workers/<worker>/`, not that the path looks like a worker. A team's `skills/` folder is still read, by the separate walk described under [Skills](#skills).

Inside a worker slot the opposite holds. A folder there that produces no worker is always named in `errors`.

## Hiring the roster

`hireWorkforce` takes the records and the flow kinds your app defined, and hands back one configured copy of a flow per worker. A **seat** is what comes back: a flow copy with its own id and its own settings.

```ts
import { hireWorkforce } from "@flow-state-dev/workforce";
import { customAgentFlow, intakeFlow } from "./flows";

const seats = hireWorkforce(workers, {
  kinds: { "custom-agent": customAgentFlow, intake: intakeFlow },
});

flowRegistry.registerMany(seats);

seats.map((seat) => seat.id);
// ["engineering.analyst", "engineering.lead", "support.intake"] — ordered by id
```

Pass `defineFlow(...)` results directly as `kinds`. The call reads no files and builds no flow graph; your flows already exist, and a record only says which one a worker runs and how that copy is configured. It registers nothing either. You register what comes back.

### The flow decides what a worker may declare

A flow kind declares its settings with `configSchema`:

```ts
export const customAgentFlow = defineFlow({
  kind: "custom-agent",
  cardinality: "collection",
  configSchema: z.object({
    instructions: z.string(),
    model: z.string().default("openai/gpt-5.4-mini"),
    tools: z.array(z.string()).default([]),
  }),
  actions: { run: { inputSchema, block: runTurn } },
});

export const intakeFlow = defineFlow({
  kind: "intake",
  cardinality: "collection",
  configSchema: z.object({ desk: z.string().default("front") }),
  actions: { run: { inputSchema, block: greet } },
});
```

`cardinality: "collection"` is what lets one definition have many copies. A roster is exactly that: one copy per worker, each with its own id and its own settings. [Copies that differ by settings](../fundamentals/flows.md#copies-that-differ-by-settings) covers how a copy is configured, and [how an instance is addressed](../fundamentals/flows.md#how-an-instance-is-addressed) covers the URL each one answers on.

`hireWorkforce` reads `flow` to pick the kind, and `description` as a label for the roster. Everything else becomes that copy's settings and is parsed against the flow's `configSchema`, which is closed. So the flow's author, not the framework, decides what a worker of that kind may say about itself.

```ts
const lead = seats.find((seat) => seat.id === "engineering.lead")!;

lead.config;
// { instructions: "You are the engineering lead. …",
//   model: "openai/gpt-5.4-mini",
//   tools: ["board", "search"] }
```

Schema defaults fill in. `support.intake` declared no settings beyond its `flow` and `description`, so it gets the `intake` flow's default `desk`:

```ts
const intake = seats.find((seat) => seat.id === "support.intake")!;

intake.config; // { desk: "front" }
```

Every `config` is frozen. A worker asking for something its flow never declared does not quietly run without it:

```
hireWorkforce refused 1 of 3 workers; nothing was hired:
  - worker "engineering.lead" — Flow "custom-agent" instance "engineering.lead"
    has an invalid config bag: "temperature" is not a declared setting.
```

Settings are spelled the way the flow declares them.

### The body arrives as `instructions`

A record's `body` is the worker's instructions, and it reaches the flow as one setting named `instructions`, alongside everything the record declared. That is the only setting name the hire imposes.

A flow kind that takes instructions declares `instructions` in its `configSchema`. A kind that doesn't will refuse a body by name, the same way it refuses any other undeclared setting, so no worker flow has to check for one:

```
hireWorkforce refused 1 of 3 workers; nothing was hired:
  - worker "support.intake" — Flow "intake" instance "support.intake"
    has an invalid config bag: "instructions" is not a declared setting.
```

Declaring the key is what makes the instructions available, at `config.instructions`. What the flow does with them is the flow's business: a worker flow usually hands them to its generator as the system prompt. A flow that declares `instructions` and never reads it hires cleanly and ignores what the file said.

A worker with no body is still fully addressable. It just carries no instructions: a body that is empty, or only whitespace, contributes no `instructions` key at all. A body that has content reaches the flow verbatim, leading and trailing whitespace included.

Declaring `instructions:` in the frontmatter *and* writing a body is refused, naming both sources. There is no precedence rule between them. Whitespace is not a body: a `WORKER.md` that sets `instructions:` in its frontmatter and leaves nothing but a blank line below the fences hires fine, on the frontmatter value.

`persona:` names something else here, [an agent's system prompt](../orchestration/agents.md#personas). A `WORKER.md` has no `persona` setting, so declaring one lands the worker in `errors` when the tree is read, or is refused by `hireWorkforce` for a hand-built record.

### When a hire is refused

Every problem here is a startup misconfiguration, so every problem throws. They are collected first, so one run names all of them and you fix them in one pass, and nothing is returned, so a bad record cannot leave you with a half-hired roster.

A record is refused when it:

- declares a `flow` that is present but empty, or only whitespace — that names no kind. Leave the key out entirely to get the built-in `agent` kind;
- names a kind that was not passed in `kinds`; the message lists the kinds that were, including `agent`;
- declares a setting its flow never declared, or omits one its flow requires;
- carries a body for a flow kind that declares no `instructions`;
- declares `instructions:` and carries a body;
- declares `persona:`, which is not a setting a worker declares;
- shares an id with another record in the same call, which is two workers claiming one address.

`kinds` itself is checked too. A flow passed under a key that is not its own `kind` is refused. The copy would otherwise come back carrying the right worker's id, and run the other kind's graph once you registered it.

## The worker you get without writing one

A record that leaves `flow:` out entirely is hired into the built-in worker kind. Its body becomes that worker's instructions, and it talks.

```md
---
description: Holds the engineering board.
---

You are the engineering lead. You break work into tasks and report back.
```

The built-in has no memory — see [Giving workers memory](#giving-workers-memory) for how to change that. Its settings are `instructions`, `model`, `tools`, and the `skills` switches below.

A worker names its tools by key in `tools:`, and the keys come from the kind's **catalog**: a map from key to tool that your app passes when it builds the kind, since a file on disk can only carry a name. A built-in worker may call the keys its own `tools:` lists, plus one tool that arrives only when the worker turns on [`skills.activateTool`](#using-them). Nothing else reaches it. Naming a key the catalog does not carry is refused at the hire, by name. An empty `tools:`, or none at all, means no catalog tools, whatever else the catalog holds.

That extra tool is the skill loader: it lets the model pull a skill the worker holds into the turn as it runs. It is not a catalog tool, so `tools:` neither lists it nor holds it back.

Skills do not widen the list any other way. A skill a worker holds can declare `allowed-tools`, and naming a tool there does not grant it. A skill that delegates work to other workers is fenced the same way: those workers are seated from the holding worker's `tools:`, so a worker with `tools: []` reaches no catalog tool through a delegate either.

That fence is the built-in kind's rule, not a rule of `hireWorkforce`. A kind you write yourself declares its own settings, so whether a `tools:` name is checked against a catalog at all is that kind's business, and a capability mounted on its generator can put a tool in front of a worker that never named one.

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

`defineAgentWorkerFlow()` with no arguments *is* the built-in, so the copy you pass replaces it rather than adding to it. It takes over for the seats that run on the `agent` kind: the records that leave `flow:` out, and any that name `agent` outright. A worker naming any other kind is unaffected. A roster hired with no `kinds` at all therefore carries an empty tool catalog.

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

A skill sitting beside a worker needs no list — the folder already says whose it is. Listing it in `skills:` does something different: it decides how the worker *uses* what it holds.

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

A fourth path is off by default. `skills.enableLlmClassifier` adds a small model call at the front of each turn that decides whether a skill applies. It catches cases a slash and an always-on list miss, and it costs a provider round trip on every message.

### Editing a skill later

A worker keeps a copy from the moment it first reads a skill. Fixing a typo in the company's copy does not reach a worker already running with it, and deleting a skill a worker has does not take it away either. A worker's drawer is its own.

Pulling an edit through is a separate, explicit act — `refreshSeededSkills` from `@flow-state-dev/orchestration`, given the skills you want refreshed. A refresh replaces the whole folder for each skill it touches, so a supporting file the source has dropped is gone afterwards, and so is anything that worker added inside that folder. A skill the worker deleted stays deleted. Check the returned `failed` list: a refresh that could not finish a skill names it there rather than reporting silence.

### Custom worker kinds

Skills are handed to a worker only when its flow kind declares a `seatSkills` setting. The built-in does. A [kind you define yourself](#when-a-worker-needs-more-than-settings) does not until you add the key, so adding an org-wide skills folder never breaks workers running on your own kinds.

## Giving workers memory

The built-in forgets everything between turns. Memory costs tokens on every turn and latency on most of them, so it is something you switch on rather than something you inherit.

You turn it on by composing it into your own copy of the kind. A *capability* is a bundle you attach to a block — the context it injects, the tools it adds, the storage it needs — and memory ships as one. [Memory](../memory/overview.md) covers the system itself: its tiers, what each one stores, and every knob `system()` takes. What follows is how a roster of workers picks it up.

Three of `defineAgentWorkerFlow`'s options carry it:

- `uses` — capabilities every worker of this kind carries.
- `afterAnswer` — a block that runs after the worker answers.
- `isolateUserState` — give each worker its own storage instead of one shared cell.

Here is the whole recipe:

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

**Turn `recall` and `connect` off.** They arrive as tools (`recall` searches stored memory on demand, `connect` walks the relations between entities), and a worker may call exactly the tools its `tools:` setting names. Leaving them on puts a tool on a worker that asked for none. With them off, the worker reads what it knows as injected context every turn instead of searching on request. If you want on-demand search back, put the [recall tool](../memory/recall-tool.md) in your app's own catalog, where a worker opts in by naming it like any other tool.

### What isolation does and does not give you

`isolateUserState: true` keys each worker's storage on that worker's id, so two workers serving the same person do not read each other's memory. Leave it off and they share one.

It is a decision for the whole kind. A roster is all-separate or all-shared; you cannot keep one shared store across the team while giving each worker its own of something else.

The flag decides *where* a worker's memory is stored, so anything that moves the key leaves the old memory behind. Renaming a worker does it, because the key is the worker's id. So does turning the flag on for a roster that has already been talking to people, because shared and separate are different places. Neither has a migration. Decide it before the roster has anything worth keeping, or accept that workers start fresh.


## When a worker needs more than settings

A `WORKER.md` is data: a description, the flow kind the worker runs, and that kind's settings. Behavior lives in the flow it names. So a worker that has to *do* something no kind on your roster does is a flow you define in your app, pass to `hireWorkforce` in `kinds`, and name in that worker's `flow:`.

Say the engineering team wants a worker that routes an incoming request in code, rather than asking a model where it should go. That is a flow kind of its own:

```ts
import { defineFlow, router } from "@flow-state-dev/core";
import { z } from "zod";
import { answer, escalate } from "./triage-blocks";

const requestSchema = z.object({ subject: z.string(), priority: z.number() });

// The decision is the flow's graph: a router block picks the branch from the
// request itself. `answer` is a generator; `escalate` hands off to a person.
// `flowConfigSchema` declares the slice of the flow's settings this block
// reads, and they arrive as `ctx.flow.config`.
const triage = router({
  name: "triage",
  inputSchema: requestSchema,
  flowConfigSchema: z.object({ escalateAbove: z.number() }),
  routes: [answer, escalate],
  execute: (input, ctx) =>
    input.priority >= ctx.flow.config.escalateAbove ? escalate : answer,
});

export const requestTriageFlow = defineFlow({
  kind: "request-triage",
  cardinality: "collection",
  configSchema: z.object({
    instructions: z.string(),
    model: z.string().default("openai/gpt-5.4-mini"),
    escalateAbove: z.number().default(3),
  }),
  actions: { run: { inputSchema: requestSchema, block: triage } },
});
```

A worker that runs it, at `teams/engineering/workers/triage/WORKER.md`:

```md
---
description: Sends an incoming request to an answer or to a human.
flow: request-triage
escalateAbove: 4
---

Answer directly when the request is a question about a feature that already
shipped. Keep it to a paragraph, and name the page you took the answer from.
```

And at startup, the new kind goes in `kinds` beside the ones the rest of the roster runs:

```ts
import { hireWorkforce } from "@flow-state-dev/workforce";

const seats = hireWorkforce(workers, {
  kinds: { "custom-agent": customAgentFlow, "request-triage": requestTriageFlow },
});
```

`WORKER.md` is the only filename a worker slot is read for. A file of code sitting beside it changes nothing about the seat.

## What this does not do

- Reading the tree does not resolve tool or capability names. `tools: [board, search]` comes off the file as two strings; whether anything backs those names is checked at the hire, by the kind the worker runs on. The built-in checks them against its catalog. A kind you write decides for itself.
- It does not read the whole tree. `readWorkforceDirectory` opens worker slots only, `teams/<team>/workers/<worker>/`; `readWorkforce` opens those plus the three skills folders each worker draws from ([Skills](#skills)). A team's `resources/` or `tools/` folder is layout, not input.
- It does not follow symlinks, at any level of the walk.
- It does not watch the tree. Read it once, at startup.
- It does not staff a [task board](../orchestration/task-board.md). A hired seat is an address you open a session against; a board's workers are in-process and claim tasks from a collection. A board calls its registry entries seats too. Same idea, different mechanism.
- It does not describe a channel. A `WORKER.md` mints one flow copy per record; a channel is a session on a shared kind, which is a different binding with a different reason. See [Channels](./channels.md).

## Related pages

- [Workforce](./overview) — what a hired roster is, and when to reach for it instead of a task board.
- [Skills](../skills/overview) — what a `SKILL.md` is and what goes in one.
- [Activation paths](../skills/activation.md) — the ways a skill becomes active, and what each costs.
- [Channels](./channels.md) — several agents on one topic, with one durable transcript and nobody owning a row.
- [Orchestration](../orchestration/overview) — coordinating units of work on a board.
- [Agents](../orchestration/agents) — board workers, personas, and `createWorkforceCapability`.
