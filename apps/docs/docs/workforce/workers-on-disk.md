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
      TEAM.md
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

`TEAM.md` is optional, and only engineering has one here. It says what that team is and what every worker on it is told. See [What a TEAM.md says](#what-a-teammd-says).

Every example below reads this tree.

## What a WORKER.md says

Settings between the `---` fences, instructions below them:

```md
---
description: Holds the engineering board and breaks work into tasks.
flow: custom-agent
model: openai/gpt-5.4-mini
tools: [board, search]
resources:
  - teams/engineering/handbook
  - teams/engineering/board-notes: rw
---

You are the engineering lead. You do not write code yourself. You break the
request into tasks, assign them, and report what came back.
```

`description` is the only key the file itself requires. It refuses `persona:`, `seatSkills:`, `seatTools:` and `teamInstructions:` outright. A seat's skills and the blocks it can reach come from where its folders sit, and its team's instructions from that team's [`TEAM.md`](#what-a-teammd-says). `flow` names which of your flow kinds this worker runs. Leave it out and the worker is hired into [the built-in worker kind](./built-in-worker.md), which needs no flow of yours.

`resources:` is a list of the [documents](./documents-on-disk.md) this worker may touch, chosen from the ones its kind holds. Each entry is a document's [ref](./documents-on-disk.md#a-documents-ref), the name it gets from where its file sits. A ref on its own is read-only. `<ref>: rw` grants writes, and `<ref>: ro` spells the default out. Leave the key out and the worker reaches every document its kind installed, and writes the ones that allow writes; `resources: []` is how you say it gets none.

Only documents are narrowed. The stores and boards its kind declares stay reachable and writable whatever the list says, and so do the resources the kind's own blocks declare. Where the documents come from is [below](#supplying-the-documents-a-seat-may-name).

Reading the file checks no other key. Whatever else you write lands on the record spelled exactly as you spelled it. The flow a worker names has the final say: at hiring it [refuses a setting it never declared](#the-flow-decides-what-a-worker-may-declare).

The frontmatter is the same dialect a [`SKILL.md`](../skills/overview.md) uses. If you have written one of those, you already know the shape.

## What a TEAM.md says

A `TEAM.md` at the top of a team's folder describes the team and holds the instructions every
worker on it carries:

```md
---
description: Red-team operations for the customer pentest lab.
---

Stay inside the engagement's scope. Never touch a host the brief does not name.
```

The file is optional. A team without one loads normally, and nothing is
reported.

`description` is required when the file exists, and it comes back on the loader's result.
Everything else you write in the frontmatter lands on the team record spelled the way you spelled
it, apart from the keys the file refuses: `id:`, which is the folder's name; `flow:`, which belongs
to a seat's `WORKER.md`; `instructions:`, which the body already is; and `teamInstructions:`, which
the framework fills in from this body and no file may set.

The body is the instructions. They reach every worker on the team, as a setting of their own:

```ts
const { workers, teams, teamErrors } = await readWorkforce("./workforce");

teams.map((team) => team.id);
// ["engineering"]

workers.find((worker) => worker.id === "engineering.lead")?.teamInstructions;
// "Stay inside the engagement's scope. Never touch a host the brief does not name.\n"
```

A body that is empty, or only whitespace, is not instructions. The team still loads, with its
description, and its workers carry no team layer at all — the same rule a worker's own body
follows.

A broken `TEAM.md` lands in `teamErrors`, keyed by its path, and the team's workers still load
without the layer. Treat a non-empty `teamErrors` as fatal for the same reason you treat `errors`
that way: booting past it runs those workers short of instructions someone wrote for them.

### What a team folder keeps to itself

Instructions written in a `TEAM.md` reach only that team's workers. They ride each worker's own
configuration, so a worker on another team never sees them.

Documents under `teams/<team>/resources/` work the other way. They are installed on a worker
*kind*, so every worker of that kind can read every team's documents. The folder addresses a
document; it does not fence it. To give one team's workers only its own documents, filter the
records before installing them: [A folder is a namespace, not a visibility
boundary](./documents-on-disk.md#a-folder-is-a-namespace-not-a-visibility-boundary) shows how, and
covers a worker's own folder too.

## A worker's identity

A worker's id is its team folder and its own folder joined with a dot. `teams/engineering/workers/lead/` becomes `engineering.lead`.

The team qualifier means every team can have a `lead` without checking what the other teams called theirs. The dot matters because the id is also the address: a hired worker is a flow instance, reached at `POST /api/flows/engineering.lead/actions/run`, and an id containing a `/` registers fine and then fails to route.

### Names in the tree {#names-in-the-tree}

The same rule governs every name the convention reads, not just these two folders: teams, workers, channels, documents, skills, and the files that declare your own flow kinds and blocks.

A name must be lowercase letters, digits, and single hyphens, at most 64 characters. So `api-designer` is fine. `API_Designer` and `api.designer` are refused when the tree is read, with the rule in the message.

A handful of otherwise-legal names are refused as well: `con`, `prn`, `aux`, `nul`, `com1` through `com9`, and `lpt1` through `lpt9`. Windows treats these as device names rather than filenames, whatever extension follows, so a tree containing one cannot be checked out on a Windows machine at all.

That last refusal covers every name above except a **skill** folder. Skills are read by their own loader, which checks the lowercase-hyphen rule and not the device list, so a skill called `con` loads on macOS and Linux and then breaks the checkout for anyone on Windows. Nothing stops you naming one that way; don't.

## Reading the tree

Point `readWorkforce` at the root:

```ts
import { readWorkforce } from "@flow-state-dev/workforce/loader";

const { workers, errors, skillErrors, teamErrors } = await readWorkforce("./workforce");
```

A team file that failed is reported in `teamErrors` rather than in `errors`, and a worker that
loaded without a skill it should have had in `skillErrors`. Check each of them; see [Treat a
non-empty `errors` as fatal](#treat-a-non-empty-errors-as-fatal).

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
- a `WORKER.md` that declares `persona:`, `seatSkills:`, `seatTools:` or `teamInstructions:`, none of which is a setting a worker declares — team instructions go in the team's own [`TEAM.md`](#what-a-teammd-says);
- a team or worker folder name that breaks the naming rules;
- a symlink where a folder or a worker file belongs, refused rather than read;
- a directory that exists but cannot be listed, reported under its own path (`teams`, `teams/<team>`, or `teams/<team>/workers`) so the seats beneath it are not lost silently.

`readWorkforceDirectory` throws when the root you passed cannot be read at all, and when that root is a symlink. A link is refused rather than followed, whichever way the path is written, with a trailing slash or without. If your root is deliberately a link, pass the path it resolves to. A root that exists but has no `teams/` folder comes back as `{ workers: [], errors: [] }`.

#### Treat a non-empty `errors` as fatal

```ts
const { workers, errors, skillErrors, teamErrors } = await readWorkforce("./workforce");
if (errors.length || teamErrors.length || skillErrors.length) {
  const reported = [
    ...errors.map(({ path, error }) => `  ${path}: ${error.message}`),
    ...teamErrors.map(({ path, error }) => `  ${path}: ${error.message}`),
    // One entry per seat, each carrying its own list — so this one is nested.
    ...skillErrors.flatMap(({ worker, errors }) =>
      errors.map(({ path, error }) => `  ${worker} — ${path}: ${error.message}`),
    ),
  ];
  throw new Error(
    `workforce: ${errors.length} worker(s), ${teamErrors.length} team file(s) and ` +
      `${skillErrors.length} seat(s)' skills failed to load\n${reported.join("\n")}`,
  );
}
```

`errors` and `teamErrors` are flat lists of `{ path, error, kind }`, where `kind` names which
condition the entry is — match on it rather than on `error.message`. `skillErrors` is not: it is one entry
per affected seat, `{ worker, errors }`, carrying that seat's own list — so it needs flattening
before it reads like the other two.

A reported folder is a worker your app was supposed to have, so logging a warning and carrying on boots the app one worker short and says nothing else about it. A reported team file or skill costs a seat its instructions rather than costing you the seat, which is quieter still. Fail on all three at startup unless you have a specific reason to run a short roster.

### What is passed over in silence

A team's `channels/`, `resources/`, `skills/` or `tools/` folder, a `workers/` folder at the top of the tree, a `README.md` sitting inside `teams/<team>/workers/`, an OS or editor file such as `.DS_Store`: none of these produces a worker, and none is reported. The rule is that the path occupies a worker slot, `teams/<team>/workers/<worker>/`, not that the path looks like a worker.

Passed over by the *worker* walk is not the same as unread. A team's `skills/` folder is read by the separate walk described under [Skills](./built-in-worker.md#skills), its `resources/` folder by [Documents on disk](./documents-on-disk.md), and its `TEAM.md` by the team walk described [above](#what-a-teammd-says). A `TEAM.md` anywhere else — at `org/`, or at the root — is read by nothing and reported by nothing. There is no org-wide instruction layer.

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
worker's own instructions, the skills its folders resolved, the blocks its own folders registered
and its `tools:` named, and `teamInstructions` — what its team's [`TEAM.md`](#what-a-teammd-says)
said, when its team wrote one. Your kind's settings go on top with `.extend()`, at the same level, and the
schema stays closed around all of them.

You do not have to read any of it. A kind that composes the contract and never looks at the skills
runs exactly as it would otherwise. A kind with nowhere to put them stops hiring: the seat factory
hands every worker the same settings, and a schema that cannot take them refuses at startup, naming
the worker and the line to add.

What hiring checks is what your schema accepts, not which function built it, so declaring those
keys by hand works too. Composing is how you stay current: a key added to the contract reaches a
composed kind for free, and makes a hand-rolled one refuse at startup until you add it as well.

`cardinality: "collection"` is what lets one definition have many copies. A roster is exactly that: one copy per worker, each with its own id and its own settings. [Copies that differ by settings](../fundamentals/flows.md#copies-that-differ-by-settings) covers how a copy is configured, and [how an instance is addressed](../fundamentals/flows.md#how-an-instance-is-addressed) covers the URL each one answers on.

`hireWorkforce` reads three keys of its own: `flow` to pick the kind, `description` as a label for the roster, and [`resources`](#supplying-the-documents-a-seat-may-name) to decide which documents the copy is minted with. Everything else becomes that copy's settings and is parsed against the flow's `configSchema`, which is closed. So the flow's author, not the framework, decides what a worker of that kind may say about itself.

```ts
const lead = seats.find((seat) => seat.id === "engineering.lead")!;

lead.config;
// { instructions: "You are the engineering lead. …",
//   seatSkills: [],
//   seatTools: [],
//   model: "openai/gpt-5.4-mini",
//   tools: ["board", "search"] }
```

`seatSkills` and `seatTools` are on every seat hiring produces. This roster's folders held no skills for the lead and registered no blocks for it, so both come back empty.

Schema defaults fill in. `support.intake` declared no settings beyond its `flow` and `description`, so it gets the `intake` flow's default `desk`:

```ts
const intake = seats.find((seat) => seat.id === "support.intake")!;

intake.config; // { seatSkills: [], seatTools: [], desk: "front" }
```

Every `config` is frozen. A worker asking for something its flow never declared does not quietly run without it:

```
hireWorkforce refused 1 of 3 workers; nothing was hired:
  - worker "engineering.lead" — Flow "custom-agent" instance "engineering.lead"
    has an invalid config bag: "temperature" is not a declared setting.
```

Settings are spelled the way the flow declares them.

### The body arrives as `instructions`

A record's `body` is the worker's instructions, and it reaches the flow as one setting named `instructions`, alongside everything the record declared. Hiring imposes `instructions` when the body is not empty, `seatSkills` and `seatTools` always, and `teamInstructions` when the record carries what its team's [`TEAM.md`](#what-a-teammd-says) said.

What the refusals cover is what a **file** declares. No frontmatter may set `teamInstructions`, `seatSkills` or `seatTools`: they are refused in a `WORKER.md`, and at hiring for a record you built by hand. A `TEAM.md` refuses `teamInstructions` too. On a record you build yourself, the *fields* of the same name are yours to set, and hiring uses them. `skills` works the same way: whatever a record carries there arrives as the seat's `seatSkills`.

The two instruction settings stay apart. A worker's own text is never merged into its team's, so a kind can read one without the other. On the [built-in worker kind](./built-in-worker.md) both go into the prompt, the team's first and the worker's own last. That order is fixed, and it is an order rather than a ranking: nothing resolves a contradiction between the two, so a team rule and a worker rule that disagree are left to the model that reads them.

Every hireable kind has that setting, because `workerConfigSchema()` declares it — so a worker's body always has somewhere to arrive, and no worker flow has to check for one. A kind whose schema will not take what hiring imposes is the one that refuses, and it refuses every record on the roster rather than just the ones with a body:

```
hireWorkforce refused 1 of 3 workers; nothing was hired:
  - worker "support.intake" — Flow "intake" instance "support.intake"
    has an invalid config bag: "instructions", "seatSkills", "seatTools"
    is not a declared setting. Those keys are the framework's: every
    hireable kind admits `instructions`, `seatSkills`, `seatTools` by
    composing `workerConfigSchema()`, which is where everything the hire
    step imposes on a seat arrives.
    Wrap this kind's settings: `configSchema:
    workerConfigSchema().extend({ ...its own settings })`.
```

The instructions are available at `config.instructions`. What the flow does with them is the flow's business: a worker flow usually hands them to its generator as the system prompt. A flow that never reads them hires cleanly and ignores what the file said.

A kind that wants instructions to be mandatory says so itself, by making the key required when it extends the contract — `workerConfigSchema().extend({ instructions: z.string() })`. Then a worker of that kind with no body is a failed hire.

A worker with no body is still fully addressable. It just carries no instructions: a body that is empty, or only whitespace, contributes no `instructions` key at all. A body that has content reaches the flow verbatim, leading and trailing whitespace included.

Declaring `instructions:` in the frontmatter *and* writing a body is refused, naming both sources. There is no precedence rule between them. Whitespace is not a body: a `WORKER.md` that sets `instructions:` in its frontmatter and leaves nothing but a blank line below the fences hires fine, on the frontmatter value.

`persona:` names something else here, [an agent's system prompt](../orchestration/agents.md#personas). A `WORKER.md` has no `persona` setting, so declaring one lands the worker in `errors` when the tree is read, or is refused by `hireWorkforce` for a hand-built record.

### Supplying the documents a seat may name

A worker's `resources:` list selects from the documents its kind was installed with, so the hire step has to be told which entries in a kind's resource map are documents. Pass it the same map you spread into the flow. Here is [the `custom-agent` kind](#the-flow-decides-what-a-worker-may-declare) again with its documents installed — the action's `inputSchema` and `runTurn`, and the `workers` you loaded, are the same ones as there:

```ts
import { defineFlow } from "@flow-state-dev/core";
import { hireWorkforce, resourcesFromDocs, workerConfigSchema } from "@flow-state-dev/workforce";
import { readResourcesDirectory } from "@flow-state-dev/workforce/loader";
import { boardResource } from "./resources";

const { documents } = await readResourcesDirectory("./workforce");
const catalog = resourcesFromDocs(documents);

export const customAgentFlow = defineFlow({
  kind: "custom-agent",
  cardinality: "collection",
  configSchema: workerConfigSchema().extend({
    instructions: z.string(),
    model: z.string().default("openai/gpt-5.4-mini"),
    tools: z.array(z.string()).default([]),
  }),
  resources: { board: boardResource, ...catalog },
  actions: { run: { inputSchema, block: runTurn } },
});

const seats = hireWorkforce(workers, {
  kinds: { "custom-agent": customAgentFlow },
  documents: catalog,
});
```

One catalog, spread into the flow and handed to the hire. Which entries in that map are documents is what the `documents` option answers: `board` above is not one, and no worker's list governs it.

`documents` is consulted only for a worker that declares `resources:`. A roster where none does hires the same whether you pass it or not. A worker that does declare one while `documents` is absent is refused, naming what is missing.

A list the hire step cannot resolve refuses the whole roster, naming the worker and what was wrong. The message calls one entry a grant and quotes the ref as the file spelled it, which here is `handbook` with two letters swapped:

```
hireWorkforce refused 1 of 3 workers; nothing was hired:
  - worker "engineering.lead" — grants "teams/engineering/hanbdook", which is
    not a document this app declared. A grant selects from the documents passed
    to hireWorkforce as `documents`; it cannot declare one.
```

### When a hire is refused

Every problem here is a startup misconfiguration, so every problem throws. They are collected first, so one run names all of them and you fix them in one pass, and nothing is returned, so a bad record cannot leave you with a half-hired roster.

A record is refused when it:

- declares a `flow` that is present but empty, or only whitespace — that names no kind. Leave the key out entirely to get the built-in `agent` kind;
- names a kind that was not passed in `kinds`; the message lists the kinds that were, including `agent`;
- declares a setting its flow never declared, or omits one its flow requires;
- names a flow kind whose schema will not take what hiring imposes, leaving it nowhere to receive a seat's skills and instructions — composing `workerConfigSchema()` is the fix. That one refuses the whole roster, not just this record;
- declares `instructions:` and carries a body;
- declares `persona:`, `seatSkills:`, `seatTools:` or `teamInstructions:`, none of which is a setting a worker declares;
- declares `teamInstructions:` in its frontmatter, wherever that frontmatter came from — a team's instructions come from its [`TEAM.md`](#what-a-teammd-says) body, read by the loader;
- declares a `resources:` list the hire step cannot resolve: a `resources:` that is not a list at all, an entry that is neither a ref nor a one-key `ref: mode` mapping, a ref no document matches, a ref naming a document the app declared but did not install on this worker's kind, a mode that is neither `ro` nor `rw`, the same ref twice, `rw` on a document whose own frontmatter says `writable: false`, a ref colliding with a name the kind's own blocks declare, a ref the kind does declare at flow level while what it holds there is not that document, or the key at all when no `documents` were passed;
- reaches a document it never named, because one of its kind's blocks declares that document and a block's declaration merges back in after the worker's narrowed list is applied. Keep the document at flow level and let the block reach it there, or grant it to the worker deliberately;
- shares an id with another record in the same call, which is two workers claiming one address.

`kinds` itself is checked too. A flow passed under a key that is not its own `kind` is refused.

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

## Kinds and blocks from files

The snippet above names `request-triage` twice: once in the flow, once in the `kinds` map at startup. Add a third kind and you edit two places. Forget the second, and the app boots and then refuses every worker that named it.

There is a file convention for the code half too. Put a flow kind in `workforce/flows/workers/`, a block in a `blocks/` folder, and run `fsdev gen`: it writes a module of static imports that your app passes straight to `hireWorkforce`. Adding a kind becomes adding a file.

[Code on disk](./code-on-disk.md) covers that tree, the command, what it generates, and where a `blocks/` folder may sit.

## What this does not do

- Reading the **Markdown** does not resolve tool or capability names. `tools: [board, search]` comes off the file as two strings; whether anything backs those names is checked at the hire, by the kind the worker runs on. The code walk is what registers the names a worker's list can resolve to. The built-in checks them [against its catalog](./built-in-worker.md#tools). A kind you write decides for itself.
- It does not read the whole tree. `readWorkforceDirectory` opens worker slots only, `teams/<team>/workers/<worker>/`; `readWorkforce` opens those plus the three skills folders each worker draws from ([Skills](./built-in-worker.md#skills)). A team's `resources/` documents are read by a separate loader at startup, [`readResourcesDirectory`](./documents-on-disk.md). Its `blocks/` folder is not read at startup at all — that folder is scanned when you build, by [`fsdev gen`](./code-on-disk.md). A `tools/` folder is not a slot this convention reads, and `fsdev gen` says so rather than passing it over.
- It does not follow symlinks inside the tree. A team, a worker slot, a `WORKER.md`, a skill folder — any of these that is a shortcut to somewhere else is refused rather than read. The root you hand it is refused too, with or without a trailing slash. It does not cover a root named through a `.` segment, or anything above the root, so a path that passes through a shortcut on its way in still reads. If you keep the tree behind a symlink on purpose, hand over the path it points at.
- It does not watch the tree. Read it once, at startup, and re-run `fsdev gen` when the code folders change.
- It does not staff a [task board](../orchestration/task-board.md). A hired seat is an address you open a session against; a board's workers are in-process and claim tasks from a collection. A board calls its registry entries seats too. Same idea, different mechanism.
- It does not describe a channel. A `WORKER.md` mints one flow copy per record; a channel is a session on a shared kind, which is a different binding with a different reason. See [Channels](./channels.md).

## Related pages

- [Workforce](./overview) — what a hired roster is, and when to reach for it instead of a task board.
- [The built-in worker](./built-in-worker.md) — the `agent` kind a record with no `flow:` runs on, its tools, its skills, and its memory.
- [Code on disk](./code-on-disk.md) — your own flow kinds, blocks and capabilities in the same tree, registered by `fsdev gen`.
- [Skills](../skills/overview) — what a `SKILL.md` is and what goes in one.
- [Channels](./channels.md) — several agents on one topic, with one durable transcript and nobody owning a row.
- [Orchestration](../orchestration/overview) — coordinating units of work on a board.
- [Agents](../orchestration/agents) — board workers, personas, and `createWorkforceCapability`.
