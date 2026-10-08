---
title: Workers on disk
sidebar_position: 2
sidebar_label: Workers on disk
description: "Workforce convention: describe each worker in a folder, read the tree at startup, and run every worker on one shared copy of the flow it names."
---

# Workers on disk

Workforce is how you describe a roster of workers and run them. You can write each worker in TypeScript, or put each one in a folder and read the folder at startup.

`readWorkforce` turns a folder tree into plain records. `createWorkerInstallation` takes them as the standard workers every user has, and `hireWorkforce` gives back the flows to register: one copy of each flow a worker runs on, shared by every worker on it.

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

A seat can also sit at the organization level, beside the teams:

```
workforce/
  org/
    workers/
      chief-of-staff/
        WORKER.md
  teams/
    …
```

An org seat is one seat the whole organization shares, such as a chief of staff, rather than a member of any team.

Every example below reads the first tree, the one without `org/`.

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

`description` is the only key the file itself requires. In a [routed mailbox](./mailboxes.md#routing-a-mailbox), it is also what the route reads to decide whether a post is this worker's. The file refuses `persona:`, `seatSkills:`, `seatTools:`, `seatPackages:`, `seatId:` and `teamInstructions:` outright. A seat's skills and the blocks it can reach come from where its folders sit, and its team's instructions from that team's [`TEAM.md`](#what-a-teammd-says). `flow` names which of your flow kinds this worker runs. Leave it out and the worker runs on [the built-in worker flow](./built-in-worker.md), which needs no flow of yours.

`resources:` is a list of the [documents](./documents-on-disk.md) this worker may touch, chosen from the ones the app passed to the installation as `documents`. Each entry is a document's [ref](./documents-on-disk.md#a-documents-ref), the name it gets from where its file sits. A ref on its own is read-only. `<ref>: rw` grants writes, and `<ref>: ro` spells the default out. Leave the key out and the worker reaches every document the app passed as `documents`, on the flow's shared copy, and writes the ones that allow writes; `resources: []` is how you say it gets none.

Only documents are narrowed. The stores and boards its kind declares stay reachable and writable whatever the list says, and so do the resources the kind's own blocks declare. Where the documents come from is [below](#supplying-the-documents-a-seat-may-name).

`references:` is the companion list, over the documents in [`references/` folders](./documents-on-disk.md#who-reaches-what). Each entry is a ref on its own, with no mode, because nothing writes a reference. The list narrows what the worker's place in the tree already gives it — the organization's references, its own team's, and its own folder's — and naming one from outside that refuses the hire. Leave the key out and the worker reaches all of them; `references: []` is how you say it gets none.

`packages:` names the [packages](./packages-on-disk.md) this worker takes from its team's or the org's library, as a list: `packages: [escalation]`. The packages in its own `packages/` folder need no line.

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

![Two panels. references/: the file is the text, re-read on each request and never written by the product. Its folders are nested walls: the seat ada reads the organization's references, its own team's and its own folder's, but not a teammate's folder, another team's, or an org seat's. resources/: the file seeds a stored row at first boot, which the product, a block or the agent can then write, and later edits to the file do not change a written row. Its folder is only part of the name. Each organization gets its own row, and flowIsolation: true gives each seat its own](./documents-reach.svg)

Team documents work differently by folder. Under `teams/<team>/resources/` they reach every worker of the kind that installed them, whatever its team; under `teams/<team>/references/` they reach only that team's workers. [Who reaches what](./documents-on-disk.md#who-reaches-what) shows how to filter the first.

## A worker's identity

A worker's id is its team folder and its own folder joined with a dot. `teams/engineering/workers/lead/` becomes `engineering.lead`.

An org seat's id is its folder name alone, with no dot: `org/workers/chief-of-staff/` is `chief-of-staff`. Since a team seat's id always has a dot, the two can't collide. `chief-of-staff` and `engineering.chief-of-staff` are two different seats.

The team qualifier means every team can have a `lead` without checking what the other teams called theirs. The id is how everything else names the worker: a session's `workerId`, a mailbox's `members:`, a task handed to it. Its sessions run on the flow it names, so `engineering.lead` on `agent` is talked to in a session of `agent` created with `state: { workerId: "engineering.lead" }`.

### Names in the tree {#names-in-the-tree}

The same rule governs every name the convention reads, not just these two folders: teams, workers, mailboxes, documents, skills, and the files that declare your own flow kinds and blocks.

A name must be lowercase letters, digits, and single hyphens, at most 64 characters. So `api-designer` is fine. `API_Designer` and `api.designer` are refused when the tree is read, with the rule in the message.

A handful of otherwise-legal names are refused as well: `con`, `prn`, `aux`, `nul`, `com1` through `com9`, and `lpt1` through `lpt9`. Windows treats these as device names rather than filenames, whatever extension follows, so a tree containing one cannot be checked out on a Windows machine at all.

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
  packages?: PackageManifest[];      // the packages in its reach
}
```

`skills` is the union of the skills folders that worker draws from. A team seat draws from three: the org's, its team's, and any sitting beside the worker itself. An [org seat](#the-tree) draws from two: the org's and its own. [Skills](./built-in-worker.md#skills) covers where each one goes and which workers read it. If you only want the worker records and not their skills, `readWorkforceDirectory` reads the same tree and leaves `skills` off.

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

The subpath matters. `@flow-state-dev/workforce/loader` imports `node:fs`, so it only runs on Node. The package root, where `hireWorkforce` lives, is server code too. It reaches Node built-ins through the packages it builds on, so it is server-only. A browser component takes the names it needs from `@flow-state-dev/workforce/browser`, the one entry that reaches no Node built-in.

### When a folder is wrong

A folder that should have produced a worker and did not lands in `errors`, and the rest of the workers load anyway. Say the analyst's `WORKER.md` lost its `description`:

```ts
errors;
// [{ path: "teams/engineering/workers/analyst",
//    error: Error('WORKER.md in "analyst/" must declare a non-empty `description`') }]
```

An `errors[].path` never includes the root and is always slash-separated: it starts at `org/` or `teams/`. It names the folder that failed so you can go find it. It is not a path you can open.

What lands in `errors`:

- a worker folder with no `WORKER.md`, including one that holds only other files (custom behavior is [a flow kind](#when-a-worker-needs-more-than-settings), not a second file in the folder);
- a `WORKER.md` with no frontmatter, or one whose `description` is missing, empty, or not a string;
- a `WORKER.md` that declares `persona:`, `seatSkills:`, `seatTools:`, `seatPackages:`, `seatId:` or `teamInstructions:`, none of which is a setting a worker declares — team instructions go in the team's own [`TEAM.md`](#what-a-teammd-says);
- a team or worker folder name that breaks the naming rules;
- a symlink where a folder or a worker file belongs, refused rather than read;
- a directory that exists but cannot be listed, reported under its own path (`org`, `org/workers`, `teams`, `teams/<team>`, or `teams/<team>/workers`) so the seats beneath it are not lost silently.

`readWorkforceDirectory` throws when the root you passed cannot be read at all, and when that root is a symlink. A link is refused rather than followed, whichever way the path is written, with a trailing slash or without. If your root is deliberately a link, pass the path it resolves to. A root that exists but has no `org/workers/` and no `teams/` folder comes back as `{ workers: [], errors: [] }`.

#### Treat a non-empty `errors` as fatal

```ts
const { workers, errors, skillErrors, teamErrors, packageErrors } = await readWorkforce("./workforce");
if (errors.length || teamErrors.length || skillErrors.length || packageErrors.length) {
  const reported = [
    ...errors.map(({ path, error }) => `  ${path}: ${error.message}`),
    ...teamErrors.map(({ path, error }) => `  ${path}: ${error.message}`),
    ...packageErrors.map(({ path, error }) => `  ${path}: ${error.message}`),
    // One entry per seat, each carrying its own list — so this one is nested.
    ...skillErrors.flatMap(({ worker, errors }) =>
      errors.map(({ path, error }) => `  ${worker} — ${path}: ${error.message}`),
    ),
  ];
  throw new Error(
    `workforce: ${errors.length} worker(s), ${teamErrors.length} team file(s), ` +
      `${packageErrors.length} package(s) and ${skillErrors.length} seat(s)' skills ` +
      `failed to load\n${reported.join("\n")}`,
  );
}
```

`errors`, `teamErrors` and `packageErrors` are flat lists of `{ path, error, kind }`, where `kind` names which
condition the entry is — match on it rather than on `error.message`. `skillErrors` is not: it is one entry
per affected seat, `{ worker, errors }`, carrying that seat's own list — so it needs flattening
before it reads like the others.

A reported folder is a worker your app was supposed to have, so logging a warning and carrying on boots the app one worker short and says nothing else about it. A reported team file, skill or [package](./packages-on-disk.md) can cost a seat its instructions rather than costing you the seat, which is quieter still. Fail on all four at startup unless you have a specific reason to run a short roster.

### What is passed over in silence

A team's `mailboxes/`, `resources/`, `skills/` or `tools/` folder, a `workers/` folder at the top of the tree, a `README.md` sitting inside `teams/<team>/workers/`, an OS or editor file such as `.DS_Store`: none of these produces a worker, and none is reported. The rule is that the path occupies a worker slot, `teams/<team>/workers/<worker>/` or `org/workers/<worker>/`, not that the path looks like a worker.

`org/workers/<name>/` is a seat slot like a team's, so a folder there with no `WORKER.md` is reported. An org seat reads the organization's skills, packages and references, then its own folder's. It has no team, so no team's folders reach it and no `TEAM.md` instructions apply.

Passed over by the *worker* walk is not the same as unread. A team's `skills/` folder is read by the separate walk described under [Skills](./built-in-worker.md#skills), its `resources/` folder by [Documents on disk](./documents-on-disk.md), its `packages/` folder by [Packages on disk](./packages-on-disk.md), and its `TEAM.md` by the team walk described [above](#what-a-teammd-says). A `TEAM.md` anywhere else — at `org/`, or at the root — is read by nothing and reported by nothing. There is no org-wide instruction layer.

Inside a worker slot the opposite holds. A folder there that produces no worker is always named in `errors`.

## Hiring the roster

Every `WORKER.md` is a **standard worker**. Every user of every organization in the installation
has it, configured exactly as the file says, and nobody can edit it while the app runs. To change
one for yourself, [fork it](./durable-hire.md#forking-a-worker).

Each flow a worker names runs as one copy, shared by every worker that names it. A hundred
workers on `agent` are one registered flow, not a hundred. What makes them different is their
configuration, which the flow reads on each turn, and, on `agent`, their skills, which are kept
per worker. Long-term memory on `agent` is kept per person and shared by that person's workers on
it; it never reaches another person.

Hand the records to an installation, then ask `hireWorkforce` for the flows to register:

```ts
import { createWorkerInstallation, hireWorkforce } from "@flow-state-dev/workforce";
import { customAgentFlow, intakeFlow } from "./flows";

const installation = createWorkerInstallation({
  standardWorkers: workers,
  workerFlows: { "custom-agent": customAgentFlow, intake: intakeFlow },
});

const flows = hireWorkforce(installation);
flowRegistry.registerMany(flows);

flows.map((flow) => flow.id);
// ["agent", "custom-agent", "intake", "workforce-roster"]
```

One copy per flow, at the flow's own kind, plus `workforce-roster`, the flow an app
[hires, forks and fires](./durable-hire.md) through. The call reads no files and registers
nothing itself: you register what comes back.

`workerFlows` is optional. A record that names no `flow:` runs on
[the built-in worker flow](./built-in-worker.md), which the installation adds for you, so one
roster can mix workers on your flows with workers on that one.

### The flow decides what a worker may declare

A worker flow declares its settings with `configSchema`, starting from `workerConfigSchema()` and
extending it. It is built on the installation that runs its workers, so a flow in its own module
exports a `workerFlow(...)` builder, which the installation builds once, with itself:

```ts
import { defineFlow } from "@flow-state-dev/core";
import { workerConfigSchema, workerFlow } from "@flow-state-dev/workforce";

export const customAgentFlow = workerFlow((installation) =>
  defineFlow({
    kind: "custom-agent",
    configSchema: workerConfigSchema().extend({
      instructions: z.string(), // the contract's own is optional; this flow requires one
      model: z.string().default("openai/gpt-5.4-mini"),
      tools: z.array(z.string()).default([]),
    }),
    session: installation.session(),          // the session's worker, checked when it is created
    resources: { ...installation.resources }, // the user's workers, and the standard ones
    actions: { run: { inputSchema, block: runTurn(installation), userMessage: (input) => input.message } },
  }),
);

export const intakeFlow = workerFlow((installation) =>
  defineFlow({
    kind: "intake",
    configSchema: workerConfigSchema().extend({ desk: z.string().default("front") }),
    session: installation.session(),
    resources: { ...installation.resources },
    actions: { run: { inputSchema, block: greet(installation), userMessage: (input) => input.message } },
  }),
);
```

`workerConfigSchema()` is the set of settings every worker may carry, whatever flow it runs on: the
worker's own instructions, the skills its folders resolved, the blocks its own folders registered
and its `tools:` named, the [packages](./packages-on-disk.md#in-a-kind-of-your-own) it holds, and `teamInstructions` — what its team's [`TEAM.md`](#what-a-teammd-says)
said, when its team wrote one. Your flow's settings go on top with `.extend()`, at the same level, and the
schema stays closed around all of them.

You do not have to read any of it. A flow that composes the contract and never looks at the skills
runs exactly as it would otherwise. A flow with nowhere to put them refuses at startup, naming the
flow and the line to add.

What is checked is what your schema accepts, not which function built it, so declaring those keys
by hand works too. Composing is how you stay current: a key added to the contract reaches a
composed flow for free, and makes a hand-rolled one refuse at startup until you add it as well.

The installation reads keys of its own: `flow` to pick the flow, `description` as a label for the roster, [`resources`](#supplying-the-documents-a-seat-may-name) and `references` to decide which documents the worker reaches, and [`packages`](./packages-on-disk.md#giving-one-to-a-worker) to decide which library packages it holds. Everything else becomes that worker's settings and is parsed against the flow's `configSchema`, which is closed. So the flow's author, not the framework, decides what a worker on that flow may say about itself.

A turn reads its worker's settings by loading the worker. `ctx.flow.config` is the shared copy's
own, the same for every worker on it, so don't read a worker's settings there:

```ts
// inside runTurn, a block on the custom-agent flow
const worker = await installation.resolveWorker(ctx, "custom-agent");

worker.config;
// { instructions: "You are the engineering lead. …",
//   seatSkills: [],
//   seatTools: [],
//   seatId: "engineering.lead",
//   model: "openai/gpt-5.4-mini",
//   tools: ["board", "search"] }
```

`seatSkills` and `seatTools` are on every worker's configuration. This roster's folders held no skills for the lead and registered no blocks for it, so both come back empty.

Schema defaults fill in. `support.intake` declared no settings beyond its `flow` and `description`, so it gets the `intake` flow's default `desk`:

```ts
worker.config; // { seatSkills: [], seatTools: [], seatId: "support.intake", desk: "front" }
```

Every `config` is frozen. A worker asking for something its flow never declared does not quietly
run without it. A standard worker is refused when you call `hireWorkforce`, and nothing is
registered:

```
hireWorkforce: 1 standard worker problem(s); nothing was registered:
  - worker "engineering.lead" — Flow "custom-agent" instance "engineering.lead"
    has an invalid config bag: "temperature" is not a declared setting.
```

A user's own worker is checked the same way when it is hired or edited, and again on every turn.

Settings are spelled the way the flow declares them.

### Which flows can run workers

A worker runs on a flow. The flows you pass in `workerFlows`, with the built-in `agent`
underneath, are your app's worker flows. `hireWorkforce` checks each one before it registers
anything, and a worker that names a flow your app didn't pass is refused, by name.

A worker flow must:

- **Take the standard configuration.** Compose `workerConfigSchema()` into its `configSchema`, as
  [above](#the-flow-decides-what-a-worker-may-declare). If you declare the keys yourself, each must
  accept the value a worker brings and keep it as given: `seatId` is a string, for instance, and a
  transform that replaces it is refused.
- **Have one door.** Exactly one public action declares `userMessage` and takes `{ message }`, so
  an app can talk to any worker without knowing which flow it runs on.
- **Declare the installation's session.** `session: installation.session()` gives every session a
  readonly `workerId`, checked when the session is created. A flow without it is refused. Load the worker with `installation.resolveWorker` on
  every turn: in the flow's `request.onStarted`, or in the block that reads it.
- **Declare any resource with `writtenBy` through `sharedResource()`.** A resource that has a
  `writtenBy` field is declared with [`sharedResource()`](#sharing-something-from-a-worker), which
  adds the field itself. A resource you define by hand with a `writtenBy` field is refused, even
  when its shape is right.

A worker is either **standard** or **a user's own**. A standard worker is one a `WORKER.md` file
defines. A user's own worker is one they [hired or forked](./durable-hire.md), stored on their
roster.

To keep a flow for standard workers, so that no user's own worker runs on it, mark the entry:

```ts
const installation = createWorkerInstallation({
  standardWorkers: workers,
  workerFlows: {
    triage: triageFlow,
    coordinator: { flow: coordinatorFlow, standardOnly: true },
  },
});
```

A worker that names no flow runs on `agent`, and the mark is checked after that. To keep `agent`
for standard workers, pass it with the mark. The built-in is built on the installation, so pass
`workerFlows` as a function, which is read when first needed:

```ts
const installation = createWorkerInstallation({
  standardWorkers: workers,
  workerFlows: () => ({ agent: { flow: defineAgentWorkerFlow({ installation }), standardOnly: true } }),
});
```

A user's own worker that names no flow is then refused, and the message names `agent`.

Writing a library of worker flows? Check each one in your own tests, without an app:

```ts
import { workerFlowProblems } from "@flow-state-dev/workforce";

expect(workerFlowProblems("triage", triageFlow)).toEqual([]);
```

#### Where a worker's data lives

Session, request and user state belong to one user. Org scope is shared with every member of the
org: anything a flow writes there, every member's runs can read. A worker flow can write there
when that is what it's built to do, and nothing stops it.

The built-in `agent` keeps its own working state, such as its skills, in its user's scope. Write
your own worker flows the same way, and put what you mean to share in a shared resource.

When one registered flow runs many workers, each loading its worker with
[`resolveWorker`](https://github.com/fixpoint-labs/flow-state-dev/blob/main/packages/workforce/README.md#workers-as-data),
a user's workers on that flow share the user's scope. The built-in `agent` keeps each worker's
skills apart for you. A worker flow you write doesn't: anything it keeps at user scope is read by
every one of that user's workers on the flow. It never reaches another user, whose data is kept
apart.

If each worker should keep its own, put the worker in the key. Load the worker at the start of the
turn, then use its id:

```ts
import { defineResourceCollection } from "@flow-state-dev/core";
import { z } from "zod";

// One row per worker, in the user's scope.
const workerNotes = defineResourceCollection({
  pattern: "worker-notes/*",
  scope: "user",
  stateSchema: z.object({ text: z.string().default("") }),
});

// inside your flow's block, which declares `resources: { workerNotes, ...installation.resources }`
const worker = await installation.resolveWorker(ctx, "research");
await ctx.resources.workerNotes.upsert(worker.id, { text: "Prefers short answers." });
```

Use the id `resolveWorker` returns rather than one from the turn's input: it is the worker the
session was created with, checked on this turn. For skills, give your skills library a
`partitionBy` that returns the session's `workerId`:

```ts
createSkillsLibrary({ scope: "user", partitionBy: (ctx) => ctx.session.state.workerId });
```

A session's `workerId` can't change after it is created, so each session reads one worker's
skills. A run that `partitionBy` returns nothing for gets an empty catalog it can't write to, so a
session with no worker never reads every worker's skills.

#### Sharing something from a worker

To let a worker write something every member can read, declare a shared resource and write
through the helper. The entry records the user and the worker the turn loaded with
[`resolveWorker`](https://github.com/fixpoint-labs/flow-state-dev/blob/main/packages/workforce/README.md#workers-as-data),
as `{ userId, workerId }`. A turn that loaded no worker records `{ userId }` only.

```ts
import { sharedResource, writeShared } from "@flow-state-dev/workforce";

const notes = sharedResource("team-notes/*", { text: z.string() });

// inside a block that declares `resources: { notes }`
await writeShared(ctx, "notes", "launch", { text: "Launch moved to Friday." });
// stored, from a turn that loaded the worker "researcher" with resolveWorker:
//   { text: "Launch moved to Friday.", writtenBy: { userId: "alice", workerId: "researcher" } }
```

`writeShared` sets `writtenBy` from the session and ignores any `writtenBy` in its input, so
whoever calls your flow can't sign as someone else. The worker it records is the one the session
was created with. A block that writes the resource directly can
set any value, so trust `writtenBy` as far as you trust your worker flows' code. An entry written
without it is refused by the resource's own schema. A second write to the same key replaces the
entry, `writtenBy` included. Every member can read an entry.

Use `writtenBy` for display and audit, not to decide who may write. Who may write an entry comes
from the resource's scope and its ownership rules.

### The body arrives as `instructions`

A record's `body` is the worker's instructions, and it reaches the flow as one setting named `instructions`, alongside everything the record declared. Hiring imposes `instructions` when the body is not empty, `seatSkills`, `seatTools` and `seatId` always, `teamInstructions` when the record carries what its team's [`TEAM.md`](#what-a-teammd-says) said, and `seatPackages` when the worker holds a package.

Every worker knows its own id. It arrives as the `seatId` setting, the same id the team's `members:` lists, so a block that loaded the worker can read who it is without being told. A worker file can't set it. `writeShared` doesn't sign with it: it signs with the worker the turn loaded, as above.

What the refusals cover is what a **file** declares. No frontmatter may set `teamInstructions`, `seatSkills`, `seatTools` or `seatId`: they are refused in a `WORKER.md`, and by `hireWorkforce` for a record you built by hand. A `TEAM.md` refuses `teamInstructions` too. On a record you build yourself, the *fields* of the same name are yours to set, and hiring uses them. `skills` works the same way: whatever a record carries there arrives as the seat's `seatSkills`.

The two instruction settings stay apart. A worker's own text is never merged into its team's, so a kind can read one without the other. On the [built-in worker kind](./built-in-worker.md) both go into the prompt, the team's first and the worker's own last. That order is fixed, and it is an order rather than a ranking: nothing resolves a contradiction between the two, so a team rule and a worker rule that disagree are left to the model that reads them.

Every worker flow has that setting, because `workerConfigSchema()` declares it — so a worker's body always has somewhere to arrive, and no worker flow has to check for one. A flow whose schema will not take those settings is refused by `hireWorkforce` before anything is registered:

```
hireWorkforce refused 1 worker flow ("intake"); nothing was hired:
  - worker flow "intake" doesn't accept `instructions`, `seatSkills`, `seatTools`, …
    Compose it: `configSchema: workerConfigSchema().extend({ ...its own settings })`.
```

The instructions are available at `worker.config.instructions`, on the worker `resolveWorker` loaded. What the flow does with them is the flow's business: a worker flow usually hands them to its generator as the system prompt. A flow that never reads them hires cleanly and ignores what the file said.

A flow that wants instructions to be mandatory says so itself, by making the key required when it extends the contract — `workerConfigSchema().extend({ instructions: z.string() })`. Then a worker on that flow with no body is refused.

A worker with no body still runs. It just carries no instructions: a body that is empty, or only whitespace, contributes no `instructions` key at all. A body that has content reaches the flow verbatim, leading and trailing whitespace included.

Declaring `instructions:` in the frontmatter *and* writing a body is refused, naming both sources. There is no precedence rule between them. Whitespace is not a body: a `WORKER.md` that sets `instructions:` in its frontmatter and leaves nothing but a blank line below the fences hires fine, on the frontmatter value.

`persona:` names something else here, [an agent's system prompt](../orchestration/agents.md#personas). A `WORKER.md` has no `persona` setting, so declaring one lands the worker in `errors` when the tree is read, or is refused by `hireWorkforce` for a hand-built record.

### Supplying the documents a seat may name

A worker's `resources:` list selects from the documents your app declared, so the installation
has to be told which they are. Pass it the map `resourcesFromDocs` returned, as `documents`:

```ts
import { createWorkerInstallation, hireWorkforce, resourcesFromDocs } from "@flow-state-dev/workforce";
import { readResourcesDirectory } from "@flow-state-dev/workforce/loader";
import { customAgentFlow } from "./flows";

const { documents } = await readResourcesDirectory("./workforce");

const installation = createWorkerInstallation({
  standardWorkers: workers,
  workerFlows: { "custom-agent": customAgentFlow },
  documents: resourcesFromDocs(documents),
});
const flows = hireWorkforce(installation);
```

Every worker on a flow shares its one copy, so the flow declares every document any of its workers
might be granted, and narrows what each turn's model reaches with the installation's
`resourceVisibility` rule. Here is [the `custom-agent` flow](#the-flow-decides-what-a-worker-may-declare)
again with its documents:

```ts
import { defineFlow, handler } from "@flow-state-dev/core";
import { workerConfigSchema, workerFlow } from "@flow-state-dev/workforce";
import { boardResource } from "./resources";

export const customAgentFlow = workerFlow((installation) => {
  // The turn's worker, loaded on every run of a request, a resumed one included.
  const loadWorker = handler({
    name: "load-worker",
    inputSchema: z.unknown(),
    resources: { ...installation.resources },
    execute: async (_input, ctx) => ({ worker: (await installation.resolveWorker(ctx, "custom-agent")).id }),
  });
  return defineFlow({
    kind: "custom-agent",
    configSchema: workerConfigSchema().extend({
      instructions: z.string(),
      model: z.string().default("openai/gpt-5.4-mini"),
      tools: z.array(z.string()).default([]),
    }),
    session: installation.session(),
    resources: { ...installation.resources, ...installation.documents, board: boardResource },
    resourceVisibility: installation.resourceVisibility,
    request: { onStarted: loadWorker },
    actions: { run: { inputSchema, block: runTurn(installation), userMessage: (input) => input.message } },
  });
});
```

On each turn, the model's resource tools reach a document only when the worker loaded on that
turn is granted it: read and written for an `rw` grant, read only for a bare one. Every other
document answers exactly as one that doesn't exist, in listings, searches, reads and writes, and
through any tool you build on core's resource tools. A turn that loaded no worker reaches no
document. `board` is not a document, so no worker's list governs it. Your own block code that
names a document directly, as `ctx.resources.handbook`, isn't narrowed: that is your code, not
the model's reach.

`documents` is consulted only for a worker that declares `resources:`. A worker that does declare
one while `documents` is absent is refused, naming what is missing.

References go under a `references` option holding the map `referencesFromDocs` returned, and that one works the other way round: which references each worker reaches is worked out against it, so a flow holding references needs it. Leave it out, or pass a map missing one of them, and the roster is refused, naming every reference the installation was not given. [Installing the documents](./documents-on-disk.md#installing-the-documents) has the call with both maps.

A list that can't be resolved refuses the whole roster at `hireWorkforce`, naming the worker and what was wrong. The message calls one entry a grant and quotes the ref as the file spelled it, which here is `handbook` with two letters swapped:

```
hireWorkforce: 1 standard worker problem(s); nothing was registered:
  - worker "engineering.lead" — grants "teams/engineering/hanbdook", which is
    not a document this app declared. …
```

### When a hire is refused

For a standard worker, every problem here is a startup misconfiguration, so `hireWorkforce` throws. Problems are collected first, so one run names all of them and you fix them in one pass, and nothing is returned, so a bad file cannot leave you with a short roster. A user's own worker is checked the same way when it is hired or edited, and that write is refused, naming the problem.

A worker is refused when it:

- declares a `flow` that is present but empty, or only whitespace — that names no kind. Leave the key out entirely to get the built-in `agent` kind;
- names a flow that was not passed in `workerFlows`; the message lists the worker flows that were, including `agent`;
- declares a setting its flow never declared, or omits one its flow requires;
- declares `instructions:` and carries a body;
- declares `persona:`, `seatSkills:`, `seatTools:`, `seatPackages:`, `seatId:` or `teamInstructions:`, none of which is a setting a worker declares;
- declares a `packages:` line the hire step cannot resolve, or holds a package whose blocks clash with another tool it can call. [Packages on disk](./packages-on-disk.md#when-a-file-is-wrong) lists each case;
- declares `teamInstructions:` in its frontmatter, wherever that frontmatter came from — a team's instructions come from its [`TEAM.md`](#what-a-teammd-says) body, read by the loader;
- declares a `references:` list the hire step cannot resolve: a `references:` that is not a list, an entry that is not a ref, the same ref twice, or a ref naming a reference this worker cannot reach from where its folder sits — which includes every ref when no `references` map was passed. A worker whose id names no place in the tree is refused too, once its kind holds references;
- reaches a reference it did not name, the same way a document can come back through one of its kind's blocks;
- declares a `resources:` list the hire step cannot resolve: a `resources:` that is not a list at all, an entry that is neither a ref nor a one-key `ref: mode` mapping, a ref no document matches, a ref naming a document the app declared but did not install on this worker's kind, a mode that is neither `ro` nor `rw`, the same ref twice, `rw` on a document whose own frontmatter says `writable: false`, a ref colliding with a name the kind's own blocks declare, a ref the kind does declare at flow level while what it holds there is not that document, or the key at all when no `documents` were passed;
- reaches a document it never named, because one of its kind's blocks declares that document and a block's declaration merges back in after the worker's narrowed list is applied. Keep the document at flow level and let the block reach it there, or grant it to the worker deliberately;
- shares an id with another standard worker, which `createWorkerInstallation` refuses;
- is a user's own worker naming a flow kept for standard workers, or naming no flow when `agent`
  is kept.

`hireWorkforce` checks each flow in `workerFlows` too, before it registers anything. A flow is
refused when it is passed under a key that is not its own `kind`, has no door or more than one,
doesn't accept a worker's configuration, doesn't declare the installation's session, or has a
resource with `writtenBy` that `sharedResource()` didn't build. One run names every problem with
every flow, and nothing is registered.

A user's own worker that stops resolving after it was saved, because a tool it names was removed
or its flow is now kept for standard workers, isn't dropped: its next turn is refused, naming the
problem, and an `edit` fixes it.

## When a worker needs more than settings

A `WORKER.md` is data: a description, the flow the worker runs on, and that flow's settings. Behavior lives in the flow it names. So a worker that has to *do* something no flow on your roster does is a flow you define in your app, pass to the installation in `workerFlows`, and name in that worker's `flow:`.

Say the engineering team wants a worker that routes an incoming request in code, rather than asking a model where it should go. That is a flow kind of its own:

```ts
import { defineFlow, router } from "@flow-state-dev/core";
import { workerConfigSchema, workerFlow } from "@flow-state-dev/workforce";
import { z } from "zod";
import { answer, escalate } from "./triage-blocks";

const requestSchema = z.object({ message: z.string(), priority: z.number().default(0) });

export const requestTriageFlow = workerFlow((installation) => {
  // The decision is the flow's graph: a router block picks the branch from the
  // request itself. `answer` is a generator; `escalate` hands off to a person.
  // The threshold is the worker's own setting, read from the worker this turn
  // runs as. Every worker on the flow shares one copy, so `ctx.flow.config` is
  // the same for all of them.
  const triage = router({
    name: "triage",
    inputSchema: requestSchema,
    resources: { ...installation.resources },
    routes: [answer, escalate],
    execute: async (input, ctx) => {
      const worker = await installation.resolveWorker(ctx, "request-triage");
      return input.priority >= Number(worker.config.escalateAbove) ? escalate : answer;
    },
  });

  return defineFlow({
    kind: "request-triage",
    configSchema: workerConfigSchema().extend({
      instructions: z.string(),
      model: z.string().default("openai/gpt-5.4-mini"),
      escalateAbove: z.number().default(3),
    }),
    session: installation.session(),
    resources: { ...installation.resources },
    actions: { run: { inputSchema: requestSchema, block: triage, userMessage: (input) => input.message } },
  });
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

And at startup, the new flow goes in `workerFlows` beside the ones the rest of the roster runs:

```ts
import { createWorkerInstallation, hireWorkforce } from "@flow-state-dev/workforce";

const installation = createWorkerInstallation({
  standardWorkers: workers,
  workerFlows: { "custom-agent": customAgentFlow, "request-triage": requestTriageFlow },
});
const flows = hireWorkforce(installation);
```

`WORKER.md` is the only filename a worker slot is read for. A file of code sitting beside it changes nothing about the seat.

## Kinds and blocks from files

The snippet above names `request-triage` twice: once in the flow, once in the `workerFlows` map at startup. Add a third kind and you edit two places. Forget the second, and the app boots and then refuses every worker that named it.

There is a file convention for the code half too. Put a flow kind in `workforce/flows/workers/`, a block in a `blocks/` folder, and run `fsdev gen`: it writes a module of static imports that your app passes straight to `createWorkerInstallation`. Adding a flow becomes adding a file.

[Code on disk](./code-on-disk.md) covers that tree, the command, what it generates, and where a `blocks/` folder may sit.

## Talking to a worker

A conversation with a worker is a session, and a session runs one worker for its whole life.
You name the worker when the session is created. Messages after that never name it.

**1. Pick the worker.** The user's roster lists their own workers and the standard ones. Each
entry names the flow it runs on, as `flow` (most run on `agent`).

**2. Find or start the session.**

```ts
import { createWorkforceClient } from "@flow-state-dev/workforce/browser"

const workforce = createWorkforceClient({ userId, baseUrl })
const session = await workforce.ensureWorkerSession({ worker: "researcher" })
```

`createWorkforceClient` takes the same options as `createSessionClient`. Its
`ensureWorkerSession` returns the user's most recent session with that worker, and creates one
if there isn't one. It looks up the worker's flow for you. Two calls at once get the same
session, not two. If you move a worker to another flow, the next call starts a new session
there. When you only want to check, `findWorkerSession` takes the same argument and returns the
session or nothing.

Both are built on the session client, which you can call directly. Use it to start a second
conversation with the same worker:

```ts
import { createSessionClient } from "@flow-state-dev/client"

const sessions = createSessionClient({ baseUrl })
const mine = await sessions.listSessions({ flowKind: "agent", userId, state: { workerId: "researcher" } })
const fresh = await sessions.createSession({ flowKind: "agent", userId, state: { workerId: "researcher" } })
```

The server checks the worker when the session is created: it must be yours or a standard
one, and it must run on this flow. A worker that isn't yours is refused with the same answer
as one that doesn't exist. A session created without a worker is refused. `workerId` is a
readonly field of the session's state: nothing can change it after the create. It works the way
a project does in [Example: one session per project](../fundamentals/state-and-scopes.md#example-one-session-per-project).

**3. Talk to it.** An ordinary action on that session:

```ts
import { createClient } from "@flow-state-dev/client"

const agent = createClient({ flowKind: session.flowKind, userId, baseUrl })
await agent.sendAction("run", { message }, { sessionId: session.id })
```

A message that names a worker is refused. So is a turn on a session whose worker was fired, or
moved to another flow since the session was created.

In React, build the client once per user with `useMemo`. `useFlow` creates sessions with no
starting state, so a worker's flow refuses them: find or start the session with the client, then
make it the hook's active session.

```tsx
const workforce = useMemo(() => createWorkforceClient({ userId, baseUrl }), [userId, baseUrl])
const flow = useFlow({ flowKind: "agent" })

useEffect(() => {
  let current = true
  workforce.ensureWorkerSession({ worker: "researcher" }).then((session) => {
    if (current) flow.selectSession(session.id)
  })
  return () => {
    current = false
  }
}, [workforce])
```

Tasks and messages your other workers hand to this one open sessions the same way, naming the
worker when the session is created.

## What this does not do

- Reading the **Markdown** does not resolve tool or capability names. `tools: [board, search]` comes off the file as two strings; whether anything backs those names is checked at the hire, by the kind the worker runs on. The code walk is what registers the names a worker's list can resolve to. The built-in checks them [against its catalog](./built-in-worker.md#tools). A kind you write decides for itself.
- It does not read the whole tree. `readWorkforceDirectory` opens worker slots only, `org/workers/<worker>/` and `teams/<team>/workers/<worker>/`; `readWorkforce` opens those plus the skills folders each worker draws from ([Skills](./built-in-worker.md#skills)) and each worker's packages ([Packages on disk](./packages-on-disk.md)). A team's `resources/` documents are read by a separate loader at startup, [`readResourcesDirectory`](./documents-on-disk.md). Its `blocks/` folder is not read at startup at all — that folder is scanned when you build, by [`fsdev gen`](./code-on-disk.md). A `tools/` folder is not a slot this convention reads, and `fsdev gen` says so rather than passing it over.
- It does not follow symlinks inside the tree. A team, a worker slot, a `WORKER.md`, a skill folder — any of these that is a shortcut to somewhere else is refused rather than read. The root you hand it is refused too, with or without a trailing slash. It does not cover a root named through a `.` segment, or anything above the root, so a path that passes through a shortcut on its way in still reads. If you keep the tree behind a symlink on purpose, hand over the path it points at.
- It does not watch the tree. Read it once, at startup, and re-run `fsdev gen` when the code folders change.
- It does not run a [task board](../orchestration/task-board.md). A worker is someone you open a session with, and a name a board can hand a task to: see [Giving a task to a worker](./overview.md#giving-a-task-to-a-worker). A board's own workers are in-process and claim tasks from a collection.
- It does not describe a mailbox. A `WORKER.md` is one worker on its flow's shared copy; a mailbox is a session on a shared kind, which is a different binding with a different reason. See [Mailboxes](./mailboxes.md).

## Related pages

- [Workforce](./overview) — what a roster is, and when to reach for it instead of a task board.
- [Hiring and forking](./durable-hire.md) — a user's own workers, hired, forked, edited and fired while the app runs.
- [The built-in worker](./built-in-worker.md) — the `agent` kind a record with no `flow:` runs on, its tools, its skills, and its memory.
- [Code on disk](./code-on-disk.md) — your own flow kinds, blocks and capabilities in the same tree, registered by `fsdev gen`.
- [Skills](../skills/overview) — what a `SKILL.md` is and what goes in one.
- [Mailboxes](./mailboxes.md) — several agents on one topic, with one durable transcript and nobody owning a row.
- [Orchestration](../orchestration/overview) — coordinating units of work on a board.
- [Agents](../orchestration/agents) — board workers, personas, and `createWorkforceCapability`.
