---
title: Workers on disk
sidebar_position: 8
sidebar_label: Workers on disk
description: "Describe each of your app's AI workers in a folder, read the tree at startup, and hire what it describes as running, addressable flow copies."
---

# Workers on disk

An app with several AI workers has to say somewhere who each one is: which model it runs on, which tools it may call, what it has been told to do. You can write that in TypeScript, one worker at a time. You can also put each worker in a folder and read the folder at startup.

Two calls do that. `readWorkforceDirectory` turns a folder tree into plain records. `hireWorkforce` turns those records into running flow copies you register.

## The tree

Worker folders are grouped by team, under a root you choose:

```
workforce/
  teams/
    engineering/
      workers/
        lead/WORKER.md
        analyst/WORKER.md
    support/
      workers/
        intake/WORKER.md
```

Three workers in two teams. Someone who does not write TypeScript can add a fourth, or change what one of them has been told to do, by editing a document.

Every example below reads this tree.

## What a WORKER.md says

Settings between the `---` fences, instructions below them:

```md
---
description: Holds the engineering board and breaks work into tasks.
flow: worker-agent
model: openai/gpt-5.4-mini
tools: [board, search]
---

You are the engineering lead. You do not write code yourself. You break the
request into tasks, assign them, and report what came back.
```

`description` is the only key the file itself requires. `flow` names which of your flow kinds this worker runs, and [hiring](#hiring-the-roster) needs it. Everything else is whatever the worker needs to say about itself, and it arrives exactly as written: keys are not checked against a list, so a setting only your own app understands travels through untouched.

The frontmatter is the same dialect a [`SKILL.md`](../skills/overview.md) uses. If you have written one of those, you already know the shape.

## A worker's identity

A worker's id is its team folder and its own folder joined with a dot. `teams/engineering/workers/lead/` becomes `engineering.lead`.

The team qualifier means every team can have a `lead` without checking what the other teams called theirs. The dot matters because the id is also the address: a hired worker is a flow instance, reached at `POST /api/flows/engineering.lead/actions/run`, and an id containing a `/` registers fine and then fails to route.

Both folder names must be lowercase letters, digits, and single hyphens, at most 64 characters each. So `api-designer` is fine. `API_Designer`, `api.designer`, and the reserved name `_meta` are refused when the tree is read, with the rule in the message.

## Reading the tree

Point `readWorkforceDirectory` at the root:

```ts
import { readWorkforceDirectory } from "@flow-state-dev/workforce/loader";

const { workers, errors } = await readWorkforceDirectory("./workforce");
```

You get one record per worker:

```ts
interface WorkerManifest {
  id: string;                        // "engineering.lead"
  declared: Record<string, unknown>; // the frontmatter, exactly as written
  body: string;                      // the instructions below it, or "" for none
  codePath?: string;                 // set when the folder also holds a worker.ts
}
```

For the `lead` folder above:

```ts
const lead = workers.find((worker) => worker.id === "engineering.lead")!;

lead.declared;
// { description: "Holds the engineering board and breaks work into tasks.",
//   flow: "worker-agent",
//   model: "openai/gpt-5.4-mini",
//   tools: ["board", "search"] }
lead.body;     // "You are the engineering lead. …"
lead.codePath; // undefined
```

Reading the tree starts nothing. No flow is built, nothing is registered, and no model is contacted. Turning records into workers you can talk to is a separate call.

The subpath matters. `@flow-state-dev/workforce/loader` imports `node:fs`, so it only runs on Node. The package root, where `hireWorkforce` lives, stays isomorphic.

### A folder that holds a worker.ts

Some seats need more than a document can express, so a worker folder may also hold a `worker.ts`. The path to that file is recorded on the record as `codePath`. Nothing here imports it.

A `worker.ts` goes **beside** a `WORKER.md`, not instead of one. A folder holding only a `worker.ts` is read into a record, but that record declares no flow kind, and [`hireWorkforce` refuses a record with no flow kind](#when-a-hire-is-refused). To hire the seat, give the folder a `WORKER.md` naming the kind it runs:

```
    support/
      workers/
        intake/
          WORKER.md
          worker.ts
```

```ts
const intake = workers.find((worker) => worker.id === "support.intake")!;

intake.declared.flow; // "intake"
intake.codePath;      // "workforce/teams/support/workers/intake/worker.ts"
```

That worker hires off its `WORKER.md` like any other, and what your app does with `codePath` is yours to decide.

`codePath` is the root you passed with the worker's path joined onto it, in your platform's separators. It is absolute when your root was, and you can hand it straight to `import()` or `readFile` from wherever you called the loader.

### When a folder is wrong

A folder that should have produced a worker and did not lands in `errors`, and the rest of the workers load anyway:

```ts
errors;
// [{ path: "teams/engineering/workers/analyst",
//    error: Error('WORKER.md in "analyst/" must declare a non-empty `description`') }]
```

Unlike `codePath`, an `errors[].path` never includes the root and is always slash-separated: it starts at `teams/`. It names the folder that failed so you can go find it. It is not a path you can open.

What lands in `errors`:

- a worker folder holding neither a `WORKER.md` nor a `worker.ts`;
- a `WORKER.md` with no frontmatter, or one whose `description` is missing, empty, or not a string;
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

A team's `resources/`, `skills/` or `tools/` folder, a `workers/` folder at the top of the tree, a `README.md` sitting inside `teams/<team>/workers/`, an OS or editor file such as `.DS_Store`: none of these are read, and none are reported. The rule is that the path occupies a worker slot, `teams/<team>/workers/<worker>/`, not that the path looks like a worker.

Inside a worker slot the opposite holds. A folder there that produces no worker is always named in `errors`.

## Hiring the roster

`hireWorkforce` takes the records and the flow kinds your app defined, and hands back one configured copy of a flow per worker. A **seat** is what comes back: a flow copy with its own id and its own settings.

```ts
import { hireWorkforce } from "@flow-state-dev/workforce";
import { workerAgentFlow, intakeFlow } from "./flows";

const seats = hireWorkforce(workers, {
  kinds: { "worker-agent": workerAgentFlow, intake: intakeFlow },
});

flowRegistry.registerMany(seats);

seats.map((seat) => seat.id);
// ["engineering.analyst", "engineering.lead", "support.intake"] — ordered by id
```

Pass `defineFlow(...)` results directly as `kinds`. The call reads no files and builds no flow graph; your flows already exist, and a record only says which one a worker runs and how that copy is configured. It registers nothing either, so a workforce read from files and one written by hand arrive at the registry through the same door.

### The flow decides what a worker may declare

A flow kind declares its settings with `configSchema`:

```ts
export const workerAgentFlow = defineFlow({
  kind: "worker-agent",
  cardinality: "collection",
  configSchema: z.object({
    persona: z.string(),
    model: z.string().default("openai/gpt-5.4-mini"),
    tools: z.array(z.string()).default([]),
  }),
  actions: { run: { inputSchema, block: runTurn } },
});
```

Two keys in `declared` are read by `hireWorkforce` itself. `flow` picks the kind, and `description` is a label for the roster. Everything else becomes that copy's settings and is parsed against the flow's `configSchema`, which is closed. So the flow's author, not the framework, decides what a worker of that kind may say about itself.

```ts
const lead = seats.find((seat) => seat.id === "engineering.lead")!;

lead.config;
// { persona: "You are the engineering lead. …",
//   model: "openai/gpt-5.4-mini",
//   tools: ["board", "search"] }
```

Schema defaults fill in. `support.intake` declared no settings beyond its `flow` and `description`, so it gets whatever the `intake` flow defaults to (here, a `desk` of `"front"`):

```ts
const intake = seats.find((seat) => seat.id === "support.intake")!;

intake.config; // { desk: "front" }
```

Every `config` is frozen, and carries that worker's settings only. A worker asking for something its flow never declared does not quietly run without it:

```
hireWorkforce refused 1 of 3 workers; nothing was hired:
  - worker "engineering.lead" — Flow "worker-agent" instance "engineering.lead"
    has an invalid config bag: "temperature" is not a declared setting.
```

Settings are spelled the way the flow declares them. There is no translation between the name in the file and the name in the schema.

Copies, ids, and settings bags are covered in [Flows](../fundamentals/flows.md#copies-that-differ-by-settings); addressing is in [How an instance is addressed](../fundamentals/flows.md#how-an-instance-is-addressed).

### Instructions arrive as `persona`

A record's `body` is the worker's instructions, and it reaches the flow as one setting named `persona`, alongside everything the record declared. That is the only setting name the hire imposes.

A flow that declares `persona` takes instructions. A flow that does not refuses a body by name, the same way it refuses any other undeclared setting, so no worker flow has to check for one:

```
hireWorkforce refused 1 of 3 workers; nothing was hired:
  - worker "support.intake" — Flow "intake" instance "support.intake"
    has an invalid config bag: "persona" is not a declared setting.
```

A worker with no body is a **thin seat**: fully addressable, carrying no persona because none was written. A body that is only whitespace counts as none, and contributes no `persona` key.

Declaring `persona:` in the frontmatter *and* writing a body is refused, naming both sources. There is no precedence rule between them.

### When a hire is refused

Every problem here is a startup misconfiguration, so every problem throws. They are collected first, so one run names all of them and you fix them in one pass, and nothing is returned, so a bad record cannot leave you with a half-hired roster.

A record is refused when it:

- declares no `flow`, so there is no kind to hire it into. A record read from a folder holding only a `worker.ts` is refused here, and the message says to give the seat a `flow:`;
- names a kind that was not passed in `kinds`; the message lists the kinds that were;
- declares a setting its flow never declared, or omits one its flow requires;
- carries a body for a flow kind that declares no `persona`;
- declares `persona:` and carries a body;
- shares an id with another record in the same call, which is two workers claiming one address.

`kinds` itself is checked too. A flow passed under a key that is not its own `kind` is refused, because that seat would mint, register under the worker's id, and then run a different worker's graph.

## What this does not do

- It does not resolve tool or capability names. `tools: [board, search]` is carried as two strings, and whether those tools exist is checked when the worker is put to work.
- It does not read anything outside `teams/<team>/workers/<worker>/`. Team-level and organization-level folders are part of the layout, and nothing here reads them.
- It does not follow symlinks, at any level of the walk.
- It does not watch the tree. Read it once, at startup.
- It does not staff a [task board](./task-board.md). A seat is an address you open a session against; a board's workers are in-process and claim tasks from a collection. Same idea, different mechanism.
