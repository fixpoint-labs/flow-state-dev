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

`description` is the only key the file itself requires. Three it refuses outright: `persona:`, `seatSkills:`, and `teamInstructions:` — the last two because a seat's skills are decided by where its folders sit and a team's instructions belong to its team, rather than by what one worker's file claims. `flow` names which of your flow kinds this worker runs. Leave it out and the worker is hired into [the built-in worker kind](./built-in-worker.md), which needs no flow of yours.

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

`skills` is the union of the three skills folders that worker draws from: the org's, its team's, and any sitting beside the worker itself. [Skills](./built-in-worker.md#skills) covers where each one goes and which workers read it. If you only want the worker records and not their skills, `readWorkforceDirectory` reads the same tree and leaves `skills` off.

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
- a `WORKER.md` that declares `persona:`, `seatSkills:` or `teamInstructions:`, none of which is a setting a worker declares;
- a team or worker folder name that breaks the naming rules;
- a symlink where a folder or a worker file belongs, refused rather than read;
- a directory that exists but cannot be listed, reported under its own path (`teams`, `teams/<team>`, or `teams/<team>/workers`) so the seats beneath it are not lost silently.

`readWorkforceDirectory` throws in two cases, and both are a wiring mistake rather than a bad folder: the root you passed cannot be read at all, or it is a symlink. A link is refused rather than followed, whichever way the path is written — with a trailing slash or without — because a roster loaded from wherever a link happens to point is not the one you configured. If your root is deliberately a link, pass the path it resolves to. A root that exists but has no `teams/` folder comes back as `{ workers: [], errors: [] }`.

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

A team's `channels/`, `resources/`, `skills/` or `tools/` folder, a `workers/` folder at the top of the tree, a `README.md` sitting inside `teams/<team>/workers/`, an OS or editor file such as `.DS_Store`: none of these produces a worker, and none is reported. The rule is that the path occupies a worker slot, `teams/<team>/workers/<worker>/`, not that the path looks like a worker. A team's `skills/` folder is read, by the separate walk described under [Skills](./built-in-worker.md#skills).

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

`kinds` is optional. A record that names no `flow:` is hired into [the built-in worker kind](./built-in-worker.md), which ships with the framework, so one roster can mix workers running your flows with workers running that one.

### The flow decides what a worker may declare

A flow kind declares its settings with `configSchema`. A kind you want to hire workers into starts
from `workerConfigSchema()` and extends it:

```ts
import { workerConfigSchema } from "@flow-state-dev/workforce";

export const customAgentFlow = defineFlow({
  kind: "custom-agent",
  cardinality: "collection",
  configSchema: workerConfigSchema().extend({
    instructions: z.string(), // the contract's own is optional; this kind requires one
    model: z.string().default("openai/gpt-5.4-mini"),
    tools: z.array(z.string()).default([]),
  }),
  actions: { run: { inputSchema, block: runTurn } },
});

export const intakeFlow = defineFlow({
  kind: "intake",
  cardinality: "collection",
  configSchema: workerConfigSchema().extend({ desk: z.string().default("front") }),
  actions: { run: { inputSchema, block: greet } },
});
```

`workerConfigSchema()` is the set of settings every seat's bag may carry, whatever kind it is: the
worker's own instructions, the skills its folders resolved, and a reserved `teamInstructions` that
nothing populates yet. Your kind's settings go on top with `.extend()`, at the same level, and the
schema stays closed around all of them.

You do not have to read any of it. A kind that composes the contract and never looks at the skills
runs exactly as it would otherwise. But a kind with nowhere to put them stops hiring: the seat
factory hands every worker the same settings, and a schema that cannot take them refuses at
startup, naming the worker and the line to add. The alternative was a seat that hired, ran, and
quietly held none of what its author's folders declared.

What hiring checks is what your schema accepts, not which function built it. Declaring those keys
by hand works too — composing is how you stay current, since a key added to the contract reaches a
composed kind for free and makes a hand-rolled one refuse at startup until you add it as well.

`cardinality: "collection"` is what lets one definition have many copies. A roster is exactly that: one copy per worker, each with its own id and its own settings. [Copies that differ by settings](../fundamentals/flows.md#copies-that-differ-by-settings) covers how a copy is configured, and [how an instance is addressed](../fundamentals/flows.md#how-an-instance-is-addressed) covers the URL each one answers on.

`hireWorkforce` reads `flow` to pick the kind, and `description` as a label for the roster. Everything else becomes that copy's settings and is parsed against the flow's `configSchema`, which is closed. So the flow's author, not the framework, decides what a worker of that kind may say about itself.

```ts
const lead = seats.find((seat) => seat.id === "engineering.lead")!;

lead.config;
// { instructions: "You are the engineering lead. …",
//   seatSkills: [],
//   model: "openai/gpt-5.4-mini",
//   tools: ["board", "search"] }
```

`seatSkills` is there because hiring hands it to every seat: this roster's folders held no skills for the lead, and present-and-empty is how that is spelled.

Schema defaults fill in. `support.intake` declared no settings beyond its `flow` and `description`, so it gets the `intake` flow's default `desk`:

```ts
const intake = seats.find((seat) => seat.id === "support.intake")!;

intake.config; // { seatSkills: [], desk: "front" }
```

Every `config` is frozen. A worker asking for something its flow never declared does not quietly run without it:

```
hireWorkforce refused 1 of 3 workers; nothing was hired:
  - worker "engineering.lead" — Flow "custom-agent" instance "engineering.lead"
    has an invalid config bag: "temperature" is not a declared setting.
```

Settings are spelled the way the flow declares them.

### The body arrives as `instructions`

A record's `body` is the worker's instructions, and it reaches the flow as one setting named `instructions`, alongside everything the record declared. Hiring imposes two settings in all: `instructions`, when the body is not empty, and `seatSkills`, always. A third, `teamInstructions`, is declared by the contract and reserved for a team-level layer; nothing fills it yet.

Every hireable kind has that setting, because `workerConfigSchema()` declares it — so a worker's body always has somewhere to arrive, and no worker flow has to check for one. A kind whose schema will not take what hiring imposes is the one that refuses, and it refuses every record on the roster rather than just the ones with a body:

```
hireWorkforce refused 1 of 3 workers; nothing was hired:
  - worker "support.intake" — Flow "intake" instance "support.intake"
    has an invalid config bag: "instructions", "seatSkills" is not a
    declared setting. Those keys are the framework's: every hireable kind
    admits `instructions`, `seatSkills` by composing `workerConfigSchema()`,
    which is where a seat's instructions and its resolved skills arrive.
    Wrap this kind's settings: `configSchema:
    workerConfigSchema().extend({ ...its own settings })`.
```

Note what the message does *not* say. It names the keys the schema would not take, not whether you
called a particular helper — hiring cannot tell the difference, and the sentence above about
hand-declaring is why.

The instructions are available at `config.instructions`. What the flow does with them is the flow's business: a worker flow usually hands them to its generator as the system prompt. A flow that never reads them hires cleanly and ignores what the file said.

A kind that wants instructions to be mandatory says so itself, by making the key required when it extends the contract — `workerConfigSchema().extend({ instructions: z.string() })`. Then a worker of that kind with no body is a failed hire.

A worker with no body is still fully addressable. It just carries no instructions: a body that is empty, or only whitespace, contributes no `instructions` key at all. A body that has content reaches the flow verbatim, leading and trailing whitespace included.

Declaring `instructions:` in the frontmatter *and* writing a body is refused, naming both sources. There is no precedence rule between them. Whitespace is not a body: a `WORKER.md` that sets `instructions:` in its frontmatter and leaves nothing but a blank line below the fences hires fine, on the frontmatter value.

`persona:` names something else here, [an agent's system prompt](../orchestration/agents.md#personas). A `WORKER.md` has no `persona` setting, so declaring one lands the worker in `errors` when the tree is read, or is refused by `hireWorkforce` for a hand-built record.

### When a hire is refused

Every problem here is a startup misconfiguration, so every problem throws. They are collected first, so one run names all of them and you fix them in one pass, and nothing is returned, so a bad record cannot leave you with a half-hired roster.

A record is refused when it:

- declares a `flow` that is present but empty, or only whitespace — that names no kind. Leave the key out entirely to get the built-in `agent` kind;
- names a kind that was not passed in `kinds`; the message lists the kinds that were, including `agent`;
- declares a setting its flow never declared, or omits one its flow requires;
- names a flow kind whose schema will not take what hiring imposes, leaving it nowhere to receive a seat's skills and instructions — composing `workerConfigSchema()` is the fix. That one refuses the whole roster, not just this record;
- declares `instructions:` and carries a body;
- declares `persona:`, `seatSkills:` or `teamInstructions:`, none of which is a setting a worker declares;
- shares an id with another record in the same call, which is two workers claiming one address.

`kinds` itself is checked too. A flow passed under a key that is not its own `kind` is refused. The copy would otherwise come back carrying the right worker's id, and run the other kind's graph once you registered it.

## When a worker needs more than settings

A `WORKER.md` is data: a description, the flow kind the worker runs, and that kind's settings. Behavior lives in the flow it names. So a worker that has to *do* something no kind on your roster does is a flow you define in your app, pass to `hireWorkforce` in `kinds`, and name in that worker's `flow:`.

Say the engineering team wants a worker that routes an incoming request in code, rather than asking a model where it should go. That is a flow kind of its own:

```ts
import { defineFlow, router } from "@flow-state-dev/core";
import { workerConfigSchema } from "@flow-state-dev/workforce";
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
  configSchema: workerConfigSchema().extend({
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

- Reading the tree does not resolve tool or capability names. `tools: [board, search]` comes off the file as two strings; whether anything backs those names is checked at the hire, by the kind the worker runs on. The built-in checks them [against its catalog](./built-in-worker.md#tools). A kind you write decides for itself.
- It does not read the whole tree. `readWorkforceDirectory` opens worker slots only, `teams/<team>/workers/<worker>/`; `readWorkforce` opens those plus the three skills folders each worker draws from ([Skills](./built-in-worker.md#skills)). A team's `resources/` folder is read by a separate walk, [`readResourcesDirectory`](./documents-on-disk.md). A team's `tools/` folder is layout, not input.
- It does not follow symlinks, at any level of the walk, including the root you hand it.
- It does not watch the tree. Read it once, at startup.
- It does not staff a [task board](../orchestration/task-board.md). A hired seat is an address you open a session against; a board's workers are in-process and claim tasks from a collection. A board calls its registry entries seats too. Same idea, different mechanism.
- It does not describe a channel. A `WORKER.md` mints one flow copy per record; a channel is a session on a shared kind, which is a different binding with a different reason. See [Channels](./channels.md).

## Related pages

- [Workforce](./overview) — what a hired roster is, and when to reach for it instead of a task board.
- [The built-in worker](./built-in-worker.md) — the `agent` kind a record with no `flow:` runs on, its tools, its skills, and its memory.
- [Skills](../skills/overview) — what a `SKILL.md` is and what goes in one.
- [Channels](./channels.md) — several agents on one topic, with one durable transcript and nobody owning a row.
- [Orchestration](../orchestration/overview) — coordinating units of work on a board.
- [Agents](../orchestration/agents) — board workers, personas, and `createWorkforceCapability`.
