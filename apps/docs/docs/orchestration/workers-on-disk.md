---
title: Workers on disk
sidebar_position: 8
sidebar_label: Workers on disk
description: Describe each of your app's AI workers in a folder — one Markdown file per worker — then read the tree at startup and hire the workers it describes.
---

# Workers on disk

An app with several collaborating AI workers has to say somewhere who each of them is: which model it runs on, which tools it may call, and what it has been told to do. You can write that in TypeScript, one worker at a time. You can also put each worker in a folder and read the folder.

A worker's folder holds one Markdown file, `WORKER.md`, and folders are grouped by team:

```
workforce/
  teams/
    engineering/
      workers/
        lead/WORKER.md
        api-designer/WORKER.md
        intake/WORKER.md
    marketing/
      workers/
        lead/WORKER.md
```

Someone who does not write TypeScript can add a worker to that tree, or change what one has been told to do, by editing a document.

## What a WORKER.md says

Settings between `---` fences, instructions below them:

```md
---
description: Holds the engineering board and breaks work into tasks.
flow: worker-agent
model: openai/gpt-5.4-mini
tools: [board, search]
---

You are the engineering lead. You do not write code yourself — you break
the request into tasks, assign them, and report what came back.
```

`description` is the only required setting. Everything else is whatever the worker needs to declare about itself, and it arrives exactly as you wrote it — the reader does not check the keys against a list, so a setting meaningful only to your own app travels through untouched.

The frontmatter is the same dialect a [`SKILL.md`](../skills/overview.md) uses. If you have written one of those, you already know what goes here.

## A worker whose shape is code

Some seats need more than a document can say. A folder holding a `worker.ts` instead of (or alongside) a `WORKER.md` is a valid worker, and its record carries the path to that file:

```ts
workers[1].codePath; // "workforce/teams/engineering/workers/router/worker.ts"
workers[1].declared; // {}
workers[1].body;     // ""
```

The file is recorded and never imported. Your app decides what to do with the path.

## A worker's identity

`readWorkforceDirectory` gives every worker one identity, its team and its own name joined by a dot. The folder `teams/engineering/workers/lead/` produces `engineering.lead`.

The team qualifier means every team can have a `lead` and a `reviewer` without checking what other teams called theirs. The dot is what keeps the identity addressable once a worker is running — the identity becomes part of a URL, and a `/` inside one does not survive the trip.

Both parts of the name come from folder names, and both must be lowercase letters, digits and single hyphens, at most 64 characters. So `api-designer` is fine; `API_Designer` and `api.designer` are refused when the tree is read, with the rule in the message. `_meta` is reserved.

## Reading the tree

Point `readWorkforceDirectory` at the root of the tree. It comes back with one record per worker:

```ts
import { readWorkforceDirectory } from "@flow-state-dev/workforce/loader";

const { workers, errors } = await readWorkforceDirectory("./workforce");

workers[0].id;       // "engineering.lead"
workers[0].declared; // { description: "…", flow: "worker-agent",
                     //   model: "openai/gpt-5.4-mini", tools: ["board", "search"] }
workers[0].body;     // "You are the engineering lead. …"
```

Each record carries what the folder said and nothing else. Reading the tree does not start anything: no flow is built, nothing is registered, and no model is contacted. Turning these records into workers you can talk to is a separate step.

## From a record to a running worker

Say your app runs three AI workers who collaborate: an intake desk, an engineering lead, an analyst. Each needs an address you can open a session against, and each needs its own settings — its model, its tools, the instructions that make it that worker and not another one.

You could write that by hand, three times. `hireWorkforce` does it in one call: you hand it a list of worker records and the flow kinds your app defined, and it hands back one running copy of a flow per worker. A **seat** is what comes back — one flow copy with its own address and its own settings.

```ts
import { hireWorkforce } from "@flow-state-dev/workforce";
import { workerAgentFlow, intakeFlow } from "./flows";

const seats = hireWorkforce(workers, {
  kinds: { "worker-agent": workerAgentFlow, intake: intakeFlow },
});

flowRegistry.registerMany(seats);
```

Two things it deliberately leaves to you. It does not build a flow — the record says *which* flow a worker runs and *how it is configured*, never what the flow does step by step. And it does not register anything: you register what comes back, so a workforce read from files and one written by hand arrive at the registry through the same door.

### A worker record

One record per worker. Nothing here is interpreted except the flow kind:

```ts
interface WorkerManifest {
  id: string;                          // "engineering.lead" — the whole identity, and the address
  declared: Record<string, unknown>;   // what the worker declared about itself
  body: string;                        // the worker's instructions, or "" for a seat with none
  codePath?: string;                   // set when the worker's folder holds a TypeScript file
}
```

The `id` is used exactly as written. It is the seat's flow instance id, so it is also the address you talk to it on: `POST /api/flows/engineering.lead/sessions`. Dots, not slashes — a `/` inside an id survives registration and then fails to route, which is a failure you would not find until somebody tried to use the worker.

Two keys inside `declared` mean something to the hire. `flow` names the kind, and `description` is a label for the roster. Everything else is that worker's settings, handed to its flow exactly as written.

### The flow decides what a worker may say about itself

A flow kind declares its settings with `configSchema`, and that schema is closed: a key it never declared is refused by name, at the hire, before anything runs.

```ts
export const workerAgentFlow = defineFlow({
  kind: "worker-agent",
  cardinality: "collection",
  configSchema: z.object({
    persona: z.string(),
    model: z.string().default("openai/gpt-5.4-mini"),
    tools: z.array(z.string()).default([]),
  }),
  // ...its graph builds a generator from `ctx.flow.config`.
});
```

So the flow's author, not the framework, decides what a worker of that kind may declare. A worker that asks for a `temperature` its flow never offered does not quietly run without one:

```
hireWorkforce refused 1 of 3 workers; nothing was hired:
  - worker "engineering.lead" — Flow "worker-agent" instance "engineering.lead"
    has an invalid config bag: "temperature" is not a declared setting.
```

Settings are written the way the flow declares them. There is no translation between how a record spells a setting's name and how the code spells it, on purpose — one such rule is how a convention picks up a dialect.

Copies, ids, and settings bags are covered in [Flows](../fundamentals/flows.md#copies-that-differ-by-settings); addressing is in [How an instance is addressed](../fundamentals/flows.md#how-an-instance-is-addressed).

### A worker's instructions are one setting

A record's `body` is the worker's instructions. It reaches the flow as a setting named `persona`, alongside everything the record declared:

```ts
seats[1].config;
// { model: "openai/gpt-5.4-mini", tools: ["board", "search"],
//   persona: "You are the engineering lead. …" }
```

`persona` is the one name the hire imposes — a body has no name of its own until something gives it one. Routing it through the settings bag is what makes the next part free.

A worker with no body is a **thin seat**: a fully addressable worker that carries no persona at all, because none was written. It is not a lesser kind of worker; it is a copy of a flow that was not written to take instructions.

```ts
seats[0].config; // {} — this record declared no settings and has no body
```

And a flow that never declared `persona` refuses a body by name, the same way it refuses any other undeclared setting:

```
hireWorkforce refused 1 of 2 workers; nothing was hired:
  - worker "engineering.intake" — Flow "intake" instance "engineering.intake"
    has an invalid config bag: "persona" is not a declared setting.
```

That is the whole reason the body travels as a setting: no worker flow has to check for one. Prose written under a seat whose flow does not want it is an error at startup rather than something the flow silently ignores.

Two other rules follow from the same place. A body that is only whitespace contributes no `persona` at all — whitespace is not instructions, and an empty string handed to a flow that requires a persona would be a worse lie than sending nothing. And a record that declares `persona:` *and* carries a body is refused, naming both sources: there is no precedence rule, because picking a winner would mean a worker's instructions live in two places.

### What refusal looks like

Every problem here is a startup misconfiguration, so every problem throws. They are collected first, so one run names all of them and you fix them in one pass — and nothing is returned, so a bad record cannot leave you with a half-hired roster:

- a record with no `flow`, so there is no kind to hire it into;
- a record naming a kind that was not passed to `kinds`, with the kinds that were;
- a flow passed under a key that is not its own kind, since the seat would otherwise run a different worker's graph;
- a setting the flow never declared, or a required one the record omits, in the flow's own words;
- a body handed to a flow kind with no `persona`;
- two records claiming one id, which is two workers claiming one address;
- a record that carries a `codePath` and no `flow`. Pointing a seat at a TypeScript file is not wired up, so such a record is refused by name rather than dropped — the message says the code path is recorded and not yet in use, which is different from saying you forgot something.

### What a hired worker is

A seat is a flow copy and nothing else. There is no second species and no separate registry of workers: an intake desk is a seat, a coordinator is a seat, and a worker with a personality is a seat whose flow was written to take one. What separates them is what their flow accepts, not what kind of thing they are.

That also means a seat is a **dispatch target** — an address you open a session against. It is not the same list as the in-process workers a [task board](./task-board.md) drains. Same idea, different mechanism, and keeping the two apart is deliberate.

## What comes back when a folder is wrong

A worker that could not be read does not throw. It lands in `errors`, keyed by the path of the folder, and every other worker still loads:

```ts
errors;
// [{ path: "teams/engineering/workers/intake",
//    error: Error("Worker folder \"intake\" has neither a WORKER.md nor a worker.ts") }]
```

Reading throws in one case only: the root you passed cannot be read at all. A root with no `teams/` folder is an empty result rather than an error.

Only worker folders are reported. A team's `resources/`, `skills/` or `tools/` folders, an organisation-level `workers/` folder, and anything else on the tree are passed over in silence. Inside `teams/<team>/workers/`, a folder that produces no worker is always named.

### Treat a non-empty `errors` as fatal

```ts
const { workers, errors } = await readWorkforceDirectory("./workforce");
if (errors.length) {
  throw new Error(
    `workforce: ${errors.length} worker(s) failed to load\n` +
      errors.map(({ path, error }) => `  ${path}: ${error.message}`).join("\n"),
  );
}
```

Logging a warning and carrying on is the tempting alternative and it fails badly. A reported folder is a worker your app was supposed to have, so the app boots one worker short and says nothing — while a mistyped *setting*, caught later when workers are hired, takes the whole boot down. The missing worker is the worse outcome and the quiet one. Fail on `errors` at startup unless you have a specific reason to run a short roster.

## What this does not do

- It does not resolve tool or capability names. `tools: [board, search]` is carried as two strings; whether those tools exist is checked when the worker is put to work.
- It does not read anything outside `teams/<team>/workers/<worker>/`. Team-level and organisation-level folders are part of the layout but nothing reads them.
- It does not register workers at runtime. The tree is read once, at startup.
