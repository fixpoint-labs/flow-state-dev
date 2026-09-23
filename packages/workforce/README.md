# @flow-state-dev/workforce

The seat factory for flow-state-dev.

A **worker** is a flow kind plus its instructions. Describe each one as a `WORKER.md` record, then hire the roster: `hireWorkforce` turns those records into one configured, addressable flow copy per worker, which you register.

## Quick Start

Describe the roster on disk, read it, hire it, register what comes back.

```
workforce/teams/engineering/workers/lead/WORKER.md
```

```md
---
description: Holds the board.
model: openai/gpt-5.4-mini
---
You are the engineering lead. You break work into tasks and report what came back.
```

`readDeclaredRoster` reads that tree — every worker, team, document and channel declared in it —
and lists whatever failed to load on `problems`.

```ts
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";
import { hireWorkforce } from "@flow-state-dev/workforce";

const roster = await readDeclaredRoster("./workforce");
if (roster.problems.length) {
  throw new Error(`workforce: ${roster.problems.map((p) => `${p.layer} ${p.path}`).join(", ")}`);
}

const seats = hireWorkforce(roster.workers);
flowRegistry.registerMany(seats); // FlowInstance[], ordered by id
```

That record names no `flow:`, so it is hired into the built-in `agent` kind and needs no `kinds`
argument. Its body becomes its instructions and steers its answers.

The built-in stores each worker's skills at org scope. Organization identity is unconditional, so
every admitted request carries one and a caller cannot name its own org.

To run a worker on a flow you wrote, name that flow's `kind` in the record's `flow:` and pass the
flow under the same key:

```ts
const seats = hireWorkforce(workers, { kinds: { "custom-agent": customAgentFlow } });
```

`customAgentFlow` is your own `defineFlow(...)`. The record's frontmatter becomes that flow's config
and its body arrives as `config.instructions`, so the flow's `configSchema` — not this package —
decides what a worker may declare. One roster can mix both.

## Personas

Use `definePersona` to declare resource-backed personas (parallel to Skills):

```ts
import { definePersona } from "@flow-state-dev/workforce";

const personas = definePersona({
  pattern: "personas/*",
  contentTemplate: "You are a {{ state.role }}. {{ state.instructions }}",
});
```

## Reading a workforce from files

Describe each worker in a folder instead of in code. `readWorkforceDirectory` walks
`<root>/teams/<teamId>/workers/<workerName>/`, reads each worker's `WORKER.md`, and returns
one record per worker. `readWorkforce` wraps it, joining each seat's resolved skills and its
team's instructions onto the records it hands back.

```ts
import { readWorkforceDirectory } from "@flow-state-dev/workforce/loader";

const { workers, errors } = await readWorkforceDirectory("./workforce");
if (errors.length) throw new Error(`workforce: ${errors.length} worker(s) failed to load`);
```

Each record is plain data:

| Field | Description |
|-------|-------------|
| `id` | The worker's whole identity, `"<teamId>.<workerName>"` — e.g. `"engineering.lead"`. |
| `declared` | The frontmatter exactly as written. Keys are not checked against a list, beyond a required `description` and four refused ones: `persona:`, `seatSkills:`, `seatTools:` and `teamInstructions:`. |
| `body` | The Markdown below the frontmatter, verbatim. Empty when the worker has no instructions. |

`description` is the only required setting in a `WORKER.md`. Team and worker folder names must be
lowercase letters, digits and single hyphens, at most 64 characters.

A `WORKER.md` may also carry `resources:`, a list of the [file-declared
documents](#reading-documents-from-files) that seat may touch. The loader carries it through onto `declared` untouched, the way it carries every key it does
not name; [the hire step](#the-documents-a-seat-may-touch) is where a ref meets the documents it
could match.

### The optional team file

A team may also carry a `TEAM.md` at `<root>/teams/<teamId>/TEAM.md`: a required `description`,
and a body holding the instructions every worker on that team is given. The file is optional, and
a team without one loads exactly as it does without it — no layer, no placeholder, nothing
reported.

`readTeamsDirectory` reads it on its own; `readWorkforce` reads it once per call and joins the
result onto that team's worker records.

```ts
import { readWorkforce } from "@flow-state-dev/workforce/loader";

const { workers, teams, errors, skillErrors, teamErrors } = await readWorkforce("./workforce");
```

| Field | Description |
|-------|-------------|
| `teams` | One `TeamManifest` per team that has a `TEAM.md` — `id`, `description`, `declared`, and `instructions` (absent when the body is empty or whitespace). |
| `teamErrors` | One entry per `TEAM.md` that failed, keyed by its path. The team's workers still load, without the layer. |
| `errors` | One entry per worker slot that failed: a seat the app does not have. |
| `skillErrors` | One entry per seat whose skills loaded short, carrying that seat's id and its own error list. |

All three are collected rather than thrown. Treating any of them as fatal is the caller's call.
`errors` and `teamErrors` are flat `{ path, error, kind }` lists, where `kind` is that reader's own
closed union of conditions — narrow on it rather than matching `error.message`. `skillErrors` is one
entry per affected seat, `{ worker, errors }`, so it needs flattening before it reads like the other
two.

A `TEAM.md` refuses `id:`, `flow:`, `instructions:` and `teamInstructions:` — the first two because
the convention derives them, the last two because the body is already the instructions.

A hired seat then receives **two** instruction settings, never merged: `instructions` (its own
body) and `teamInstructions` (its team's). Both are absent rather than empty when there are none.
The [built-in worker kind](../../docs/architecture/workforce-default-worker-kind.md) composes them
into its prompt in a fixed order — the team's first, the seat's own last.

The reader builds nothing: no flow, no agent, no registry entry. It throws only when `root` itself
cannot be read or is a symlink — a folder that produces no worker lands in `errors`, keyed by its
path, and every other worker still loads. Treat a non-empty `errors` as fatal at startup unless you
have a reason to run a short roster.

The subpath is separate because the reader imports `node:fs`; the package root stays isomorphic.

## Reading one seat's skills

A skill is a folder with a `SKILL.md` in it. In a workforce tree, one worker's skills are spread
across three folders: the org's, its team's, and any sitting beside the worker itself.

```
workforce/org/skills/triage/SKILL.md
workforce/teams/pentest/skills/port-scan/SKILL.md
workforce/teams/pentest/skills/review/SKILL.md
workforce/teams/audit/skills/review/SKILL.md            # a different `review`
workforce/teams/pentest/workers/recon/WORKER.md
workforce/teams/pentest/workers/recon/skills/sweep/SKILL.md
```

`readSeatSkills` reads all three for one worker and returns the records `initialSkills` takes.

```ts
import { readSeatSkills } from "@flow-state-dev/workforce/loader";

const { skills, errors } = await readSeatSkills("./workforce", {
  team: "pentest",
  worker: "recon",
});
if (errors.length) throw new Error(`skills: ${errors.length} entries failed to load`);

skills.map((s) => s.name).sort(); // ["port-scan", "review", "sweep", "triage"]
```

Every skill folder at those three levels is read. Nothing has to be listed anywhere for a skill
to be included.

The set comes back level by level: the org's first, then the team's, then the worker's own. Each
entry is `{ name, skillMd, files }`, the same record `readSkillsDirectory` returns — `name` is the
folder name, bare, with no team prefix.

Two calls naming different teams read different folders. Each result holds only what its own
call read:

```ts
const recon = await readSeatSkills("./workforce", { team: "pentest", worker: "recon" });
const clerk = await readSeatSkills("./workforce", { team: "audit", worker: "clerk" });
// recon.skills has pentest's `review`; clerk.skills has audit's. Neither carries the other.
```

One name reaching a single worker from more than one of its levels is refused. All three levels
count, so a collision can span two of them or all three:

```ts
errors;
// [{ kind: "duplicate-skill-name",
//    path: "org/skills/triage",
//    paths: [
//      "org/skills/triage",
//      "teams/pentest/skills/triage",
//      "teams/pentest/workers/recon/skills/triage",
//    ],
//    error: Error('Skill "triage" reaches seat "recon" from 3 levels — org/skills/triage
//                  and teams/pentest/skills/triage and
//                  teams/pentest/workers/recon/skills/triage. Remove one: there is no
//                  precedence rule.') }]
```

`paths` holds every file competing for the name, in the order the levels are read: the org's, then
the team's, then the worker's own. None of them reaches `skills` — the contested name is left out
of the set entirely. A worker-level folder does not override its team's, and a team's does not
override the org's. The fix is a rename or a deletion.

`path` is `paths[0]`, the level the name was first seen at, which is how every entry in `errors` is
keyed.

A level that isn't in the tree is empty, not an error — an app may keep no org skills, and a
worker may have none of its own. A level that exists and cannot be listed lands in `errors` under
its own path, and so does a skill folder that fails to load, under `<level>/<folder>`.

Every entry carries a `kind` alongside its `path` and `error`, naming the condition it is; the
conditions are listed under [Error Semantics](#error-semantics). Match on `kind` rather than on the
message text when you want to tolerate one class (a malformed skill folder, say) and still refuse
another.

A `root` that cannot be read throws instead:
`Failed to read workforce directory "./workforce": ENOENT ...`. So does a `root` that is a symlink:
`Symlinked workforce directory "./workforce" — refused for safety`, with a trailing slash or
without. If you run a linked root deliberately, pass the path it resolves to.

Symlinks are never followed, and that holds for the folders on the way to a level as much as
for the level itself — `org`, `teams`, a team's folder, its `workers`, and the worker's own.
A symlinked one is refused into `errors` under its own path, so a link out of the tree cannot
pull skills in from outside the configured root.

`team` and `worker` follow the same naming rules as the folders they name: lowercase letters,
digits and single hyphens, at most 64 characters, and not `_meta`. A name outside those rules
throws.

A `SKILL.md` read this way may not declare `scope:`. A file that does lands in `errors` under
`kind: "refused-scope-key"` and is left out of `skills`: where the folder sits is what decides which
workers read it. `readSkillsDirectory` applies no such rule, so a folder you read both ways can load
there and be missing from a seat's set. Drop the key and both readers agree.

The reader registers nothing and starts nothing. Wiring the records into a running seat is the
caller's job: pass `skills` as the `initialSkills` of the skills capability or library you build
for that worker — or let [`readWorkforce`](#reading-a-workforce-from-files) do it.

## Reading the whole roster at once

`readDeclaredRoster` reads one workforce tree — the folder holding `org/` and `teams/` — and hands
back everything declared in it, plus one list of what failed to load.

```ts
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";

const roster = await readDeclaredRoster("./workforce");
const seats = hireWorkforce(roster.workers);
```

| Field | What it holds |
|-------|---------------|
| `workers` | One `WorkerManifest` per worker, each carrying its own resolved skills. The records `hireWorkforce` takes. |
| `teams` | One `TeamManifest` per team that wrote a [`TEAM.md`](#the-optional-team-file). A team without one is absent, not present-and-empty. |
| `documents` | One `ResourceDoc` per [document](#reading-documents-from-files), from every `resources/` folder the convention reads. |
| `references` | One `ResourceDoc` per [reference](#reading-documents-from-files), from every `references/` folder, each carrying the `filePath` it was read from. |
| `channels` | One `ChannelManifest` per [channel](#declaring-channels-in-files) under `teams/<id>/channels/`. There is no `org/channels/` level, the way there is for documents. |
| `problems` | Everything that did not load. Empty for a tree that loads cleanly. |

Each list arrives in tree order.

Each record's `skills` reaches the built-in `agent` kind as its `seatSkills` setting, imposed by
the hire step the way a body is imposed as `instructions`. A `WORKER.md` declaring `seatSkills:`
itself is refused by name at both the loader and the hire step — where a skill folder sits is
what decides who can see it.

For seats alone, without documents or channels, read the worker half with
[`readWorkforce`](#reading-a-workforce-from-files).

### What did not load

Every record that loaded is in the roster whether or not others failed, so a tree with problems
resolves rather than throwing:

```ts
roster.problems;
// [{ layer: "worker",
//    path: "teams/qa/workers/broken",
//    error: Error('Worker folder "broken" has no WORKER.md. ...') },
//  { layer: "skill",
//    path: "org/skills/house-style",
//    worker: "qa.tester",
//    error: Error('Missing SKILL.md in "house-style/"') },
//  { layer: "document",
//    path: "org/resources/loose.md",
//    error: Error('"loose.md" has no frontmatter — a resource file needs at least a
//                  `description`') },
//  { layer: "channel",
//    path: "teams/qa/channels/standup",
//    error: Error('CHANNEL.md in "standup/" must declare a non-empty `description`') }]
```

`layer` is one of `worker`, `skill`, `team`, `document`, `reference` or `channel`, and the entries
arrive in that order: worker slots, then each seat's skills, then team files, then documents, then
references, then channels, and last a `reference` entry per basename claimed in both slots. `path`
is the path that failed, relative to the root. `error` is the original `Error`, `cause` chain
intact.

`worker` is set on the `skill` layer and nowhere else. A skills level that several seats read fails
once per seat that read it, each entry naming its seat.

An entry carries no `kind`. To branch on one exact condition, call that layer's own reader and
match on the codes under [Error Semantics](#error-semantics).

Nothing here decides what is fatal. Refuse the boot on any problem, or on the layers you care
about:

```ts
const missingSeats = roster.problems.filter((p) => p.layer === "worker");
if (missingSeats.length) {
  throw new Error(`workforce: no seat at ${missingSeats.map((p) => p.path).join(", ")}`);
}
```

It throws on the root and nothing else: a path that cannot be read, a path that is a symlink, or
one spelled with an interior `..` that steps back through an earlier segment (pass the path that
resolves to). Everything below the root is collected, including a team, worker, channel or document
whose name breaks the naming rules.

## Hiring a workforce

`hireWorkforce` turns worker records into **seats**: one configured, addressable flow copy per worker.
It reads no files, builds no flow graph, and registers nothing. You pass the flow kinds your app
defined, and you register what comes back.

```ts
import { hireWorkforce, type WorkerManifest } from "@flow-state-dev/workforce";

const workers: WorkerManifest[] = [
  {
    id: "engineering.lead",
    declared: { flow: "custom-agent", description: "Holds the board.", model: "openai/gpt-5.4-mini" },
    body: "You are the engineering lead. You break work into tasks and report what came back.",
  },
  { id: "engineering.intake", declared: { flow: "intake", description: "The front door." }, body: "" },
];

const seats = hireWorkforce(workers, { kinds: { "custom-agent": customAgentFlow, intake: intakeFlow } });
flowRegistry.registerMany(seats); // FlowInstance[], ordered by id
```

The factory reads three keys of its own: **`flow`**, which names the kind to instantiate,
**`description`**, the roster label, and **[`resources`](#the-documents-a-seat-may-touch)**, the
documents this seat may touch. Everything else is that worker's settings, handed to the flow
verbatim and parsed against its `configSchema`. That schema is closed, so a setting the flow never
declared is refused by name at the hire.

### The documents a seat may touch

A `WORKER.md` may list the [file-declared documents](#reading-documents-from-files) that seat is
allowed to reach, chosen from the ones its kind was installed with:

```md
---
description: Holds the engineering board and breaks work into tasks.
flow: custom-agent
resources:
  - teams/engineering/handbook
  - teams/engineering/board-notes: rw
---
```

A ref on its own is read-only: the seat reads the document, and a write is refused both at the
resource handle and through the model's own write tool. `<ref>: rw` grants writes, and
`<ref>: ro` spells the default out.

**Absent and empty are different answers.** A seat whose file has no `resources:` key reaches every
document its kind installed, and writes the ones that allow writes. `resources: []` is how a file
says a seat gets none.

**Only documents are narrowed.** The stores, boards and anything else the kind declares at flow
level stay reachable and writable whatever a seat's list says, and so do the resources the kind's
own blocks declare.

For a ref to resolve, the hire step has to be told which entries in the kind's map are documents.
Hand it the same catalog you spread into the flow:

```ts
import { defineFlow } from "@flow-state-dev/core";
import { hireWorkforce, resourcesFromDocs, workerConfigSchema } from "@flow-state-dev/workforce";
import { readResourcesDirectory } from "@flow-state-dev/workforce/loader";
import { inputSchema, runTurn } from "./blocks";
import { boardResource } from "./resources";

const { documents } = await readResourcesDirectory("./workforce");
const catalog = resourcesFromDocs(documents);

const customAgentFlow = defineFlow({
  kind: "custom-agent",
  cardinality: "collection",
  configSchema: workerConfigSchema(),
  resources: { board: boardResource, ...catalog },
  actions: { run: { inputSchema, block: runTurn } },
});

const seats = hireWorkforce(workers, {
  kinds: { "custom-agent": customAgentFlow },
  documents: catalog,
});
```

One catalog, spread into the flow and passed to the hire. Which entries in that map are documents
is what the `documents` option answers: `board` above is not one, and no seat's list governs it.

`documents` is consulted only for a seat that declares `resources:`. A roster where none does hires
the same whether it is passed or not, and a seat that does declare one while `documents` is absent
is refused, naming what is missing.

Every problem with a list refuses the whole roster, naming the seat: a `resources:` that is not a
list at all, an entry that is neither a ref nor a one-key `ref: mode` mapping, a ref no document
matches, a ref naming a document the app declared but did not install on this seat's kind, a mode
that is neither `ro` nor `rw`, the same ref twice, `rw` on a document whose own frontmatter says
`writable: false`, a ref colliding with a name the kind's own blocks already declare, and a ref the
kind does declare at flow level while what it holds there is not the document the app passed — the
two cannot be told apart, so the hire refuses rather than guessing.

One more is checked on the seat after it is built rather than on the list: if a document the seat
did **not** name is reachable anyway — because one of the kind's blocks declares that same document,
and a block's declaration is merged back in after a seat's narrowed map replaces the flow-level one
— the hire refuses, naming the ref and the kind. Keep such a document at flow level and let the
block reach it from there, or grant it to the seat deliberately.

`resources:` never reaches the kind's settings. It is the factory's key, like `flow` and
`description`, so a kind that declares a `resources` setting of its own does not receive one from a
file.

`references:` is the sibling key, over the documents in `references/` folders. It narrows within a
wall the tree already imposes rather than selecting from everything the kind installed, and its
entries take no mode — see [What a seat reaches](#what-a-seat-reaches).

### What a hireable kind must admit

A worker kind is an ordinary flow. What makes it *hireable* is that its `configSchema` composes
`workerConfigSchema()`, which declares the four settings a seat's bag may carry:

| Setting | What it holds |
| --- | --- |
| `instructions?` | The worker's own instructions — its file body, or the frontmatter key. Imposed when the body is not empty, absent when it has none. |
| `teamInstructions?` | The instructions its team wrote — read from that team's [`TEAM.md`](#the-optional-team-file). Imposed when its team wrote any, absent when the team wrote none or has no file. Never merged with `instructions`. |
| `seatSkills` | The skills its folders resolved for it, in level order. Imposed on every seat, present and empty when there are none. |
| `seatTools` | The blocks this seat's `tools:` resolved to from its own folders, already resolved. Imposed on every seat, present and empty when there are none. Live blocks, not names — names that resolved to the kind's catalog stay on the kind's own `tools` setting. |

So hiring imposes all four: `instructions` when the body is not empty, `seatSkills` and `seatTools`
always, and `teamInstructions` when the seat's team wrote a `TEAM.md`. A kind that reads
`teamInstructions` for a seat whose team wrote none gets `undefined` — absent, never an empty
string, which is what keeps "this team said nothing" and "this team said nothing *yet*" from being
the same value in the bag.

**One key is reserved across kinds: `tools`.** It is not part of the contract — your kind declares it or leaves it out — but if you declare it, it means the names of tools that seat may call, because the hire step reads it. A name in a worker's `tools:` is resolved against what is registered for that seat (its own `blocks/` folder, then its team's, then your kind's catalog), and the ones that resolved to the seat's own folders arrive on `seatTools` as live blocks instead. You decide what to check the remaining names against, and you may declare no `tools` at all. What the key is not available for is unrelated string configuration, which hiring would rewrite — give that its own name.

Add your kind's own settings on top, at the same level:

```ts
import { workerConfigSchema } from "@flow-state-dev/workforce";

const triage = defineFlow({
  kind: "request-triage",
  cardinality: "collection",
  configSchema: workerConfigSchema().extend({ desk: z.string().default("front") }),
  actions: { run: { inputSchema, block: triageWork } },
});
```

`desk` sits at the top level beside the four, where the schema closes it: a worker file that writes
a key your kind never declared is still refused by name. If your kind genuinely holds open-ended
data, give it one declared key whose own schema is a record, rather than a nested bag of keys you
did name.

Reading any of it is optional. A kind that composes the contract and never looks at `seatSkills`
is not an error. What is not optional is the door: the factory hands every seat a bag, so a kind
whose schema cannot take it refuses at the hire, for the whole roster, with a message naming the
worker and the fix. That is a one-line change per kind.

What is checked is what your schema accepts, not which function built it — so a kind that declares
these keys by hand hires just the same. Composing is what keeps it current: when a key is added to
the contract, a composed kind picks it up, and a hand-rolled one refuses at boot naming the new key
until you add it.

Three of the four are never authored. A worker file that writes `seatSkills:`, `seatTools:` or
`teamInstructions:` is refused by name, at the loader and at the hire: a seat's skills and its own
blocks are the folders it can see, and a team's instructions come from its team's `TEAM.md` body.
That last key is refused in a `TEAM.md` too — the file an author would most reasonably try it in —
so all three doors refuse it, from one exported constant rather than a literal spelled into each.

**A record that leaves `flow:` out is hired into the built-in `agent` kind** — it talks, its body
arrives as its instructions, and it reads the skills its own folders hold plus any the app seeded
through `defineAgentWorkerFlow({ skills })`. It has no memory: nothing it is told survives the
turn. `kinds` is therefore optional. A `flow:` that is present but empty or whitespace-only
refuses, because it names no kind — only an absent key means the built-in.

Configure that kind by replacing it. Build the flow with `defineAgentWorkerFlow` and pass it under
`agent` (`kinds: { agent: defineAgentWorkerFlow({ catalog, skills }) }`). It takes over for every
seat that runs on the `agent` kind — the records that leave `flow:` out, and any that name `agent`
— and leaves a worker on any other kind alone. A flow of your own registered under `agent` must
declare `kind: "agent"` and `cardinality: "collection"`; without the second, each seat mints and is
then refused when you register it, because a singleton's id is its kind.

A worker record declares data: a description, the kind it runs, and that kind's settings. Behavior
lives in the flow the kind names, so a worker that has to do something none of your kinds do is a
flow you define in your app and pass in `kinds`, named by that worker's `flow:`.

A record's **`body` reaches its flow as one setting, `instructions`**. Every hireable kind declares
that setting by composing `workerConfigSchema()`, so a body always has somewhere to arrive and no
worker flow has to check for one; the instructions are available at `config.instructions`, and what
the flow does with them is the flow's business. A kind that wants instructions to be mandatory makes
the key required when it extends the contract — `workerConfigSchema().extend({ instructions:
z.string() })` — and a worker of that kind with no body is then a failed hire.

A body that is empty or only whitespace contributes no `instructions` key at all; a body with content
is handed over verbatim, leading and trailing whitespace included. A record that declares
`instructions:` *and* carries a body is refused naming both sources. Whitespace is not a body, so a
record that declares `instructions:` and carries an empty or blank one hires on the frontmatter value.

A `WORKER.md` has no `persona` setting: declaring it lands the worker in
`readWorkforceDirectory`'s `errors`, or is refused by `hireWorkforce` for a hand-built record.
Spell it `instructions`.

### Composing capabilities into the built-in kind

`defineAgentWorkerFlow` takes three more app-level options beyond its catalog, skills and model
choices. All three are optional. `defineAgentWorkerFlow()` with no arguments builds the stock
worker.

| Option | What it does |
| --- | --- |
| `uses` | Capabilities attached to every worker's answer generator. The skills binding stays first and is never displaced. A capability passed as a plain ref brings its own storage with it; one passed as a `(ctx) => refs` resolver brings none, so anything it needs has to be declared statically somewhere. |
| `afterAnswer` | A block run after the answer as a side-chain. It receives the reply text as a string, it cannot change the answer, and a failure in it does not fail the turn. Absent, nothing runs after the answer. |
| `isolateUserState` | Forwarded to `defineFlow`. Gives each worker its own user-scoped storage, keyed on the worker's id, instead of one cell shared across the roster. Default `false`. |

**The tools fence.** A worker's `tools:` is the complete set of tools it can call. The kind maps
those names against the catalog and hands the model that list and nothing else. A skill does not
widen it: a skill's `allowed-tools` are validated against the catalog but never registered, and a
skill's delegated workers are seated from the holding worker's own list. Nor does a capability
passed through `uses`: whatever tools it carries, the worker's own `tools:` is what the model gets.
Everything else the capability brings — context, storage, helpers — arrives as usual.

What does reach a worker without appearing in `tools:` is a **control**, which is framework
machinery rather than a tool from the app's catalog, switched on by the worker's own settings:

- the **skill loader**, when a worker sets `skills.activateTool: true` — it pulls a skill the worker
  already holds into the turn;
- the **delegation surface**, when a skill the worker holds declares `agents:`, which puts the task
  board's eight tools plus `runBoard` on the worker;
- the **controls a capability preset declares**, when the worker selects that preset in its
  `capabilities:` key — a preset's `controlTools` reach the worker, its `tools` do not.

#### The memory recipe

Memory is one thing you can pass through these options. Install `@flow-state-dev/memory`
separately:

```ts
import { AGENT_KIND, defineAgentWorkerFlow, hireWorkforce } from "@flow-state-dev/workforce";
import { system } from "@flow-state-dev/memory";

const mem = system({
  model: "openai/gpt-5.4-mini",
  working: { capacity: 7 },
  episodic: true,
  semantic: true,
});

const remembers = defineAgentWorkerFlow({
  catalog: appTools,
  uses: [
    mem.capability.presets({
      recall: false,    // a tool — reaches a worker through the catalog, not here
      connect: false,   // same
      semantic: true,   // context injection; OFF by default
      episodic: true,   // context injection; OFF by default
    }),
  ],
  isolateUserState: true,
  afterAnswer: mem.captureFromItems,
});

const seats = hireWorkforce(workers, { kinds: { [AGENT_KIND]: remembers } });
```

Each of these fails quietly if you skip it:

- **`system()`, not `createMemoryCapability`.** The latter builds the read side only, producing a
  worker that recalls what something else stored and records nothing of its own.
- **`afterAnswer` is the write side.** Without it the durable stores are never written.
- **`semantic` and `episodic` on.** They are off by default, and without them the durable stores
  would be written and never read back.

`recall` and `connect` are memory's two tools, and the recipe leaves them off: a worker here reads
what it remembers as injected context, and a capability's tools do not reach a worker in any case.
A worker that wants on-demand search gets the tool through the catalog
(`catalog: { recall: mem.tool.recall() }`) and names it in its own `tools:`.

Isolation is a decision for the whole kind: a roster is all-isolated or all-shared.

`isolateUserState` decides **where** a worker's user-scoped data is keyed, so anything that
changes the key leaves the old data behind. Two ways that happens, both with no migration:
**renaming a worker** (the key is its id), and **flipping the flag on a roster already in use**
(shared and isolated are different cells). Decide it before the roster carries anything worth
keeping.

Every problem is a startup misconfiguration: problems are collected and thrown as one error naming
every bad worker, and nothing is returned, so a bad record cannot leave a half-hired roster.

## Kinds and blocks from files

The `kinds` map above names each kind a second time, after the flow already declared it. There is a
file convention for that half too: put a flow under `workforce/flows/workers/` or
`workforce/flows/channels/`, or a block under `workforce/blocks/`, and the basename is the name it
registers under.

```
workforce/
  flows/
    workers/request-triage.ts                        ← default-exports a flow, cardinality: "collection"
    channels/standup.ts                              ← default-exports a flow, singleton (the default)
  blocks/triage.ts                                   ← a block any worker may name
  teams/engineering/blocks/build-status.ts           ← a block this team's workers may name
  teams/engineering/workers/triage/blocks/page.ts    ← a block this one worker may name
```

`fsdev gen` walks those folders and writes `workforce/workforce.gen.ts` beside them, exporting
`kinds`, `channelKinds`, `blocks` and `seatBlocks` — parameters `hireWorkforce`,
`channelInstances`, a task board and a worker kind's tool catalog already take. The same file
carries `resourceModules`, covered in [Resource modules from files](#resource-modules-from-files).

```ts
import { defineAgentWorkerFlow, hireWorkforce } from "@flow-state-dev/workforce";
import { blocks, kinds, seatBlocks } from "./workforce/workforce.gen";

const agent = defineAgentWorkerFlow({ catalog: blocks });
const seats = hireWorkforce(workers, { kinds: { ...kinds, agent }, seatBlocks });
```

A `blocks/` folder **registers** a name: `workforce/blocks/` for every worker, a team's for that
team's workers, a worker's own for that worker. It does not grant use — a worker still names the
block in its `tools:`, and a name resolves nearest first (its own folder, its team's, the catalog).
Two rules are checked before any worker runs: the file's basename, the map key and the block's own
`name` must agree, and a block in a worker's own folder may read a store the kind installed but may
not declare one of its own.

Discovery is a **build step**, not something this package does while your app runs. A walk at startup
works on a Node host and finds nothing on a bundled one, because after a Next or Vercel build those
files are no longer separate modules. Static imports are identical on both. Commit the generated
file, run `fsdev gen` in front of your build, and give `fsdev gen --check` its own CI step — inside a
build script it would regenerate the file and always pass.

The generator reads the tree and opens none of the modules in it, so it refuses only what a walker
can see: an illegal basename, a directory inside a locked folder, one basename claimed by both flow
folders, and a folder that is present and unreadable. Refusals are collected, so one run names all of
them. A file that exports the wrong shape fails your own `tsc` against the generated module; a flow
whose `kind` disagrees with its basename is refused at the hire.

Passing `kinds` by hand keeps working, unchanged, and composes with a generated map with no
precedence rule.

### Resource modules from files

The same command walks every `resources/` folder the convention reads and exports a fourth map,
`resourceModules`, keyed by the same ref a document of that name in that folder would get (the table
under [Reading documents from files](#reading-documents-from-files)). A `resources/` folder takes
Markdown documents and TypeScript modules side by side: a `.md` file is a document, and a `.ts` file
default-exports a capability or a resource.

```
workforce/teams/engineering/resources/
  handbook.md      ← a document, unchanged
  research.ts      ← default-exports a capability or a resource
```

```ts
import { resourceModules } from "./workforce/workforce.gen";
```

One ref has one owner: a `.md` and a `.ts` of one name in one folder are refused by name at
generation, rather than one of them quietly winning.

What a module exports is checked by your own `tsc` against the generated map's types, because the
walk never opens a module. `ResourceModuleExport` is what a module in the organisation's or a team's
folder may be; `WorkerResourceModuleExport` is the narrower type the generated map holds a module in
one **worker's own** `resources/` folder to — a resource, never a capability, because every seat of a
kind shares that kind's capabilities and one installed from a single worker's folder would change
every other seat. The generated file carries that sentence beside the entries it applies to.

### Installing what was found

The two kinds of module have two destinations, so `splitResourceModules` separates them and your app
writes the two lines:

```ts
import { resourcesFromDocs, splitResourceModules } from "@flow-state-dev/workforce";
import { resourceModules } from "./workforce/workforce.gen";

const { capabilities, resources } = splitResourceModules(resourceModules);

const agent = defineAgentWorkerFlow({ uses: capabilities, /* ... */ });
const flowResources = { ...resourcesFromDocs(documents), ...resources };
```

A capability goes to the worker kind's `uses`, which is the same option you pass one by hand, and the
resources it declares for itself reach the flow from there. A plain resource module merges into the
one resource map, under its own ref, beside the documents. Nothing is installed on your behalf —
returning both and letting you spread them keeps the wiring in your own source, the same way
`resourcesFromDocs` does.

### What one seat picks up

A capability installed on a kind reaches every seat of that kind. A worker's own file names which of
its presets *that* seat wants:

```md
---
description: Holds the board.
capabilities:
  research: [briefing]
---
```

A seat that names nothing carries each installed capability's own defaults, which is what every seat
gets without the key. Naming presets **adds** to that — there is no spelling that takes one away.
Which capabilities a workforce may reach is the app's call, made where it builds the kind; a worker
file picks among them.

The whole selection is checked when the roster is hired, so a typo is a refusal at boot rather than a
failed answer in front of a user. A seat is refused, by name, when it names:

- a capability its kind does not carry
- a preset the capability does not declare
- a preset the app turned off where it installed the capability
- a preset on a capability declared with a `config` block
- a preset whose surface has to exist before a request runs (`resources`, a state schema, `model`,
  `providerOptions` or `caching`)

The last three are the app's to set where it installs the capability.

Only the built-in `agent` kind reads this key. A kind of your own reads whatever its own settings
schema declares.

## Reading documents from files

A team's shared documents — a handbook, a glossary, an escalation procedure — can be Markdown files
instead of `defineResource` stanzas. Frontmatter is settings and the body is the document, the same
bargain `WORKER.md` makes.

**Two folders, one namespace.** The convention reads `references/` and `resources/` at the same four
levels and mints refs for both by the same rule, so one basename claimed in both at one level is
refused rather than resolved. What differs is what the document is once installed:

| Folder | Content an agent reads | Writable | Reach |
| --- | --- | --- | --- |
| `references/` | the file, re-read whenever an execution context is built | no. `writable`, `llmWritable`, `render` and `flowIsolation` come from the folder, and a file declaring any of them is refused | the org's, the seat's own team's, and the seat's own folder's — derived from the tree |
| `resources/` | the file's body seeds a row; the row is the source from then on | yes, unless the file says otherwise | every document the flow was installed with |

A reference changes when someone edits the file and deploys. A `resources/` document can change from
inside the product. Put standing material an author owns under `references/`, and anything an agent
writes under `resources/`.

**A document is a file, not a folder.** It is `<name>.md` directly in the slot, unlike a worker or a
skill, which is a folder with a fixed file inside it. A directory in either slot lands in `errors`
rather than being passed over.

Four places are read, in both slots — the org level, a team, and a worker's own folder under either
of those:

| Path | Ref |
|------|-----|
| `<root>/org/<slot>/<name>.md` | `<name>` |
| `<root>/teams/<teamId>/<slot>/<name>.md` | `teams/<teamId>/<name>` |
| `<root>/teams/<teamId>/workers/<worker>/<slot>/<name>.md` | `teams/<teamId>/workers/<worker>/<name>` |
| `<root>/org/workers/<worker>/<slot>/<name>.md` | `workers/<worker>/<name>` |

A worker's own folder is how two seats each get their own `runbook` without their authors
coordinating a name. The ref drops `org/` for an org worker, exactly as an org document's does.

```md
---
description: How the engineering team works — on-call, review, escalation.
llmReadable: true
---

# Engineering handbook

Escalate anything customer-visible within 15 minutes.
```

`readResourcesDirectory` walks all four and returns one record per document; `resourcesFromDocs`
turns those records into the resource map you already pass to a flow. `readReferencesDirectory` and
`referencesFromDocs` are the same pair over `references/`. Both maps spread into one flow, and both
are passed to `hireWorkforce`:

```ts
import { defineFlow } from "@flow-state-dev/core";
import { hireWorkforce, referencesFromDocs, resourcesFromDocs } from "@flow-state-dev/workforce";
import { readReferencesDirectory, readResourcesDirectory } from "@flow-state-dev/workforce/loader";
import { answerQuestion } from "./blocks";
import { ticketResource } from "./resources";

const references = await readReferencesDirectory("./workforce");
const resources = await readResourcesDirectory("./workforce");
for (const { errors } of [references, resources]) {
  if (errors.length) throw new Error(`workforce: ${errors.length} document(s) failed to load`);
}

const documents = resourcesFromDocs(resources.documents);
const referenceMap = referencesFromDocs(references.documents);

export const supportFlow = defineFlow({
  kind: "support",
  actions: { answer: { block: answerQuestion } },
  resources: { ticket: ticketResource, ...documents, ...referenceMap },
});

const seats = hireWorkforce(workers, {
  kinds: { support: supportFlow },
  documents,
  references: referenceMap,
});
```

`references` is what tells the hire which entries on a kind's map are references, and the tree wall
applies only to the entries it names. So once a kind holds references, the option is required: omit
it, or pass a map that is missing one of them, and `hireWorkforce` throws, naming every reference it
was not given. A kind that holds none needs no map. A ref passed in both maps is refused as well,
naming it.

**Every file-declared document is org-scoped, and nothing needs declaring for that.** Organization
identity is unconditional, so every admitted request carries one and the org resource registry is
always built. A request with no organization is refused at the door rather than arriving empty, so a
block reads a document with nothing extra declared:

```ts
// ./blocks.ts
import { generator, readResourceContentTool } from "@flow-state-dev/core";

export const answerQuestion = generator({
  name: "answer-question",
  model: "openai/gpt-5.4-mini",
  prompt: "Answer support questions. Check the team handbook before you answer.",
  tools: [readResourceContentTool()],
});
```

Each record is plain data:

| Field | Description |
|-------|-------------|
| `ref` | The document's identity and storage key, taken from where the file sits — see the table above. It is also the accessor key, so a team's handbook is `ctx.resources["teams/engineering/handbook"]` and one seat's runbook is `ctx.resources["teams/pentest/workers/recon/runbook"]`. |
| `declared` | The frontmatter exactly as written. A file that declares one of the refused settings below produces no record at all, so nothing is stripped here. |
| `body` | The Markdown below the frontmatter, verbatim. For a `resources/` document it becomes the resource's content. |
| `filePath` | The absolute path the file was read from. A reference is served from it, so a hand-built reference record must set it and `referencesFromDocs` throws without it. Carried on a `resources/` record too, where nothing reads it. |

**Merge the map yourself.** A flow copy created with `supportFlow({ resources })` *replaces* the
definition's map rather than merging with it, so passing `resourcesFromDocs(documents)` there on its
own drops whatever resources the flow kind declared. Spread it into your own map, as above.

### What a seat reaches

**A reference is walled by where its file sits.** A seat reaches the org's references, its own
team's, and its own folder's. Another team's and a teammate's are not on its map at all, so
`ctx.resources.get` on one throws `is not registered`. No install-side filter is involved and there
is no setting that widens the wall: a reference reaches more people by moving up the tree. Seats are
read from `teams/<teamId>/workers/<name>/`, so a reference under `org/workers/<name>/references/`
sits beside the org level rather than above any seat, and no seat reaches it.

A `references:` list in a `WORKER.md` narrows within that wall. Each entry is a ref on its own —
there is no mode, since nothing writes a reference. An entry naming a reference the seat could not
already reach refuses the whole roster, and so does a malformed list or a duplicated ref. Leaving
the key out means every reference at or above the seat; `references: []` means none.

**A `resources/` folder is a namespace, not a visibility boundary — at every level.** Every
file-declared document is org-scoped, and a flow's resource tools reach every installed document
marked `llmReadable` with no per-team filter. Installing a whole tree on one flow makes every team's
documents reachable from it. To give a team's seats only its own, filter the records before
installing:

```ts
const engineering = resourcesFromDocs(
  resources.documents.filter((d) => d.ref.startsWith("teams/engineering/")),
);
```

This holds for a worker's folder too: putting a `resources/` document under `workers/recon/`
addresses it to that seat, it does not keep it from the others. Every seat hired into one kind
shares that kind's flow definition, so by default all of them read the same row.

**Filtering decides what a kind installs; a seat's own file decides what that seat reaches.** A
`resources:` list in a `WORKER.md` narrows one seat within a kind and can take a document
read-only — see [The documents a seat may touch](#the-documents-a-seat-may-touch). A ref for a
document this kind was not installed with is refused at the hire, so the filter above holds.

**To make a `resources/` document that seat's alone, say so in the document.** A file whose
frontmatter carries `flowIsolation: true` gets one row per seat: the seat that writes it reads it
back, and a sibling seat asking for the same document gets its own empty copy rather than an error.

```md
---
description: This seat's own working notes.
flowIsolation: true
---
```

A worker folder without that line is an address, not a boundary. It is a `resources/` setting: a
`references/` file declaring it is refused, and a reference's boundary is where its file sits.

### Moving a document from `resources/` to `references/`

Moving the file is the whole job unless something wrote that document while it lived in
`resources/`. The written body is still stored, and a stored body wins over the file, so agents keep
reading the old write.

```ts
import { clearShadowedReferences, describeShadowedReferences } from "@flow-state-dev/workforce";

const result = await clearShadowedReferences({
  references: referenceMap,
  orgId,
  content: stores.content,
  installedOn: { id: flow.id, isolatesOrgState: false },
  // dryRun: true,
});
console.log(describeShadowedReferences(result));
// references: 1 of 4 were shadowed by a stored write and have been cleared — teams/engineering/handbook.
// Each now serves its file again.
```

The result is `{ cleared, checked, dryRun, scopeId }`. Each entry in `cleared` is
`{ ref, shadowedContent }`, carrying the body that had been served in the file's place — the last
place that text exists, so log or keep it before deciding the clear was right. `dryRun: true`
reports the same finding, deletes nothing, and makes the sentence read "WOULD be cleared". Running
it again over a migrated tree clears nothing, and it never touches a `resources/` document.

`installedOn` is `{ id, isolatesOrgState }` for the flow the references are installed on. A flow
that isolates its org scope stores content under a different address, so a wrong value here looks in
the wrong place, finds nothing, and reports success. Read `isolatesOrgState` off the flow. For an org
or flow id containing `:` or a backslash it throws. That address needs the engine's own escaping, so
clear those rows with the engine's store helpers instead.

### What a file may and may not declare

**`description` is required.** A file without one lands in `errors`. It reaches the resource with
the rest of the frontmatter, and nothing puts it in front of a model. Write it for whoever opens the
tree. Frontmatter never reaches an agent either way: a reference is served with its `---` block
stripped, and a `resources/` document is installed with its parsed body.

**The convention owns identity, storage and content.** Where a document lives decides all three, so
a file may not declare any of `scope`, `ref`, `stateSchema`, `default`, `content`, `contentFile`,
`contentTemplate` or `contentTemplateRef`. Each is refused by name rather than quietly ignored, and
so is `prefetchMode: "lazy"`: a file-declared document is always loaded eagerly. Everything else is
carried through as written, so `llmReadable`, `llmWritable`, `writable`, `allowedExtensions` and
`metadata` all reach the resource.

A `references/` file may not declare `writable`, `llmWritable`, `render` or `flowIsolation` either,
`writable: false` included, even though it agrees with the folder. A reference is read-only on both
doors: `writeContent()` throws a `FlowError` with code `resource_read_only`, and the model is never
offered the write tool for it. A document that needs to be written belongs in `resources/`.

A document that needs a state schema, a render function, reactive bindings or an edge graph stays in
code. Those are functions, and a Markdown file cannot hold one. Session- and user-scoped resources
are not file-declared.

Document, team and worker folder names all follow one rule: lowercase letters, digits and
single hyphens, at most 64 characters. A worker folder's documents load whether or not the folder
holds a `WORKER.md`, and a slot with no seat file is reported separately by
`readWorkforceDirectory`. A non-`.md` file in the slot is passed over in silence. An absent `org/`
root or document folder is not an error. A team may have no documents.

### What did not load

Either reader throws only when `root` itself cannot be read or is a symlink. Everything else lands
in `errors`, one entry per thing that should have produced a document and did not. Each entry is
`{ kind, path, error }`, keyed by a path relative to the root, with `kind` naming the condition (see
[Error Semantics](#error-semantics)):

```ts
errors;
// [{ kind: "folder-where-file-belongs",
//    path: "teams/marketing/resources/handbook",
//    error: Error('"handbook" is a directory. A resource is a file, not a folder — write
//                  the document as "handbook.md" in this resources/ folder instead.') }]
```

Neither reader sees the other's slot, so neither reports a basename claimed by both.
`readDeclaredRoster` reads the whole tree and puts that collision in its `problems`, naming both
files; `hireWorkforce` throws on the same collision for a catalog that never passed a loader.

`resourcesFromDocs` and `referencesFromDocs` throw instead of collecting, because a record that
cannot become a resource is a startup misconfiguration.

## Channels

A **channel** is a place several agents talk about one topic, with one durable transcript, where
nobody is assigned the work and nobody closes it out. This package ships the flow kind that runs one,
plus the two calls that bind a roster of channels to it.

The identity rule is the thing to get straight first, because it is not the one `WORKER.md` teaches:
**one kind is one instance, and one channel is one named session on that instance.** A hundred
channel records are a hundred sessions on a single registered flow. What differs per channel (who its
members are, what its charter says, what has been said in it) lives in that session's state.

You register nothing to use channels. The built-in kind is seeded for you.

```ts
import { channelInstances, openChannels, type ChannelManifest } from "@flow-state-dev/workforce";

const channels: ChannelManifest[] = [
  {
    id: "engineering.standup",
    declared: {
      members: ["engineering.lead", "engineering.analyst"],
      description: "Where the engineering team posts daily status.",
    },
    body: "Post what you finished, what you're on, and what's blocking you.",
  },
];

// Build time. One instance per distinct kind, not per record.
flowRegistry.registerMany(channelInstances(channels)); // one instance, id "channel"

// Runtime, once the host is up. One named session per record.
await openChannels(channels, { client: sessionClient, userId: "u_42" });
```

The two calls are separate because they happen at two different times: an instance is registered
when the server is built, and a session can only be opened once it is running. `openChannels` needs
a `userId` because a session belongs to one user, as *What a transcript proves* below explains.

Every channel session runs in an organization, and your app does not name it. The server binds it
from the caller's verified identity, which is whatever your
[`resolvePrincipal`](https://flow-state.dev/docs/server/authentication#every-request-runs-in-an-organization)
returned; an app that configures no authentication gets the reserved `DEFAULT_ORG_ID`. Storage at
organization scope resolves against it inside the channel, including file-declared documents and a
channel board's rows. A session's organization is fixed when the session is created, so open your
channels as a caller whose verified identity already carries the organization you want them in.

A record declares five keys and no others: `flow` (which kind, optional), `description`, `members`,
`boards`, and `instructions` (or a body, which is the same setting). The list is closed and checked
at `channelInstances`: an undeclared key, an `id:`, a `system:`, or a body alongside `instructions:`
each refuse by name.

### Declaring channels in files

A channel can be a folder with a `CHANNEL.md` in it, the way a worker is a folder with a
`WORKER.md`. `readChannelsDirectory` walks `<root>/teams/<teamId>/channels/<channelName>/` and
hands back the same `ChannelManifest[]` the two calls above take.

```
workforce/teams/engineering/channels/standup/CHANNEL.md
workforce/teams/engineering/channels/incidents/CHANNEL.md
```

```md
---
description: Where the engineering team posts daily status.
flow: channel
members: [engineering.lead, engineering.analyst]
---

Post what you finished, what you're on, and what's blocking you.
```

```ts
import { readChannelsDirectory } from "@flow-state-dev/workforce/loader";

const { channels, errors } = await readChannelsDirectory("./workforce");
if (errors.length) throw new Error(`workforce: ${errors.length} channel(s) failed to load`);

flowRegistry.registerMany(channelInstances(channels));
```

Each record is plain data:

| Field | Description |
|-------|-------------|
| `id` | `"<teamId>.<channelName>"`, minted from the two folder names — e.g. `"engineering.standup"`. This is the channel's session id. An `id:` in the frontmatter does not set it, and refuses. |
| `declared` | The frontmatter exactly as written. A `CHANNEL.md` must set `description`, and cannot set `system:`; either one fails at load. The rest of what a channel may declare (`flow`, `members`, `boards`, `instructions`) is checked when you call `channelInstances`, so a misspelled key loads without complaint and refuses at registration. |
| `body` | The Markdown below the frontmatter — the channel's charter. |

**A channel is a folder, not a file**, unlike a resource. A loose file in a `channels/` folder is
passed over, so a `README.md` sitting beside the channel folders is fine. Team and channel folder
names must be lowercase letters, digits and single hyphens, at most 64 characters. A team with no
`channels/` folder is not an error: an app can declare no channels in files, or build some records
by hand and read the rest.

The reader builds nothing: no instance, no session, no registry entry. A `flow:` naming a kind you
never passed is not caught here; `channelInstances` refuses it. It throws only when `root` itself
cannot be read or is a symlink. A folder that produces no channel lands in `errors`, keyed by its
path, and every other channel still loads. Treat a non-empty `errors` as fatal at startup unless you
have a reason to run a short roster.

The subpath is separate because the reader imports `node:fs`; the package root stays isomorphic.

### Posting and reading

`post` and `read` are declared both as public actions and as internal entries, so a client and
another flow reach the same blocks. A post addresses the channel's **session id**:

```ts
const postToStandup = dispatcher({
  name: "post-to-standup",
  flowKind: "channel",                          // the shared instance
  action: "post",
  inputSchema: z.object({ body: z.string() }),
  session: { id: () => "engineering.standup" }, // the channel
  payload: (input) => ({ body: input.body, author: "engineering.lead" }),
});
```

Address `{ id }`, never `{ key }`: a key-derived session resolves to a different session for every
poster, so the channel never sees the post. Nothing detects that mistake.

A flow-to-flow post needs in-process dispatch. On a deployment whose dispatcher hands work to an
external queue, a delivery into an existing session refuses `external-dispatcher` by name. The public
action route still works; the dispatch door does not.

A post into a session nobody opened refuses `channel-not-bound` and writes nothing. The shared
instance answers for every session id and the action path creates what it does not find, so
boundness, not existence, is what makes a session a channel.

### Holding a board

`boards:` declares durable task ledgers the channel keeps, as a list of plain local names:

```yaml
members: [engineering.lead, engineering.analyst]
boards: [followups]
```

The ledger id is minted from the channel that holds it — `engineering.incidents` holding
`followups` is `engineering.incidents.followups` — and no record writes it. A board name is a plain
local name: not empty, no whitespace, none of `.` `/` `*` `[` `]`, and not `__proto__`, `prototype`
or `constructor`. The dot is the one that matters, since it is the join and a name carrying one
would address another channel's board.

A channel holding one or more boards declares two more actions, `fileTask` and `readBoard`, public
and internal like `post` and `read`. Both take the board's **local** name; `fileTask` hands back
`{ board, boardId, taskId, status }`, and the row's id is minted rather than chosen. Naming a board
the channel does not hold refuses `board-not-declared` and lists what it does hold; naming another
channel's board refuses the same way. `read` gains a `boards` key listing the local names; a channel
holding none omits it and declares neither action.

`readBoard` returns a declared projection of each row, not the whole record: the board's own facts,
without the execution coordinates (`claimedBy`, the lease) or the substrate's write provenance.
`channelBoardRowSchema` is that shape.

A board's ledger is readable directly by a browser, which is what lets a UI draw the board as
columns without going through an action. The ledger is org-scoped, so that read resolves against the
organization the reading session belongs to. What crosses is `id`, `title`, `goal`, `status`,
`assignee`, `priority`, `attempts`, `maxAttempts`, `deps`, `labels`, `error`, `createdAt`,
`updatedAt`, `startedAt` and `completedAt`.

The channel owns the ledger and runs nothing. A seat that claims rows resolves the same declaration
with `channelBoard`, declares it as a resource, and drains it:

```ts
import { channelBoard } from "@flow-state-dev/workforce";

const followups = channelBoard("engineering.incidents", "followups");
const board = taskBoard({ name: "followups", collection: followups, workers });

defineFlow({
  kind: "analyst",
  // A seat that only drains declares the ledger itself. A seat that composes
  // `channelBoardTaskTools(followups)` does not — the capability declares it.
  resources: { [followups.id]: followups },
  actions: { drain: { block: board.drain } },
});
```

`channelBoard` returns the same ledger the channel writes to, carrying its `id`, so the two sides
agree on both the rows and the board's settings.

The channel's id and the board's name are retyped at that call and nothing checks them against the
tree. A typo does not fail: it resolves a second, empty ledger, and the only signal is the
unattended-board warning below.

`channelBoardTaskTools(board)` is the model's door onto one. Compose it in the seat kind's `uses`
and the seat holds all eight task tools over that board, each name carrying the board's id —
`addTask_engineering_incidents_followups` and so on for `assignTask`, `updateTask`, `listTasks`,
`completeTask`, `failTask`, `blockTask` and `cancelTask`. Composing the capability also declares the
ledger, so the seat's flow does not declare it again. A seat's `tools:` list can neither grant these
nor fence them out. A narrower set is a different capability.

Compose it once per board; a seat holding two boards holds sixteen tools and the names say which
board each writes to. A channel board is org-scoped, so it cannot be declared by a block colocated
in a seat's own folder; that refuses at hire.

Pass `hireWorkforce` the roster's minted ids as `channelBoards` and it warns on stderr for any board
no hired seat declares, naming the channel and the board. It never refuses: a channel may keep a
board that only people read.

Renaming or moving a channel's folder re-keys its boards, because a board id is derived from where
the channel sits. Rows filed under the old id stay at the old key, nothing migrates them and nothing
refuses. The unattended-board warning is what makes it visible, since the seat still names the id
that moved.

### What a transcript proves

A session is bound to one user, so **every line of a given channel carries the same `principal`**,
the server-derived identity the post ran under. The optional `author` is a label the poster supplied,
stored beside `authorVerified: false`, and it is the only thing distinguishing participants. The
members check on `author` is a validity check against the declared roster, not authentication. Build
an audit or approval flow on this and you get a far weaker guarantee than the field names suggest.

### Waking members

`defineChannelFlow({ notify })` takes a block run once per declared member per post. The roster it
walks is the whole declared list, the poster included, so a block that should not wake the writer
compares the delivery's `author` against the `member` it was handed and returns without delivering.
It runs in its own request, outside the post's turn, so a slow delivery never delays the next post. A delivery that
fails is recorded; the post stays written and membership is unchanged. Without a slot, posts land and
nobody is woken.

The framework carries the policy and your app supplies the addresses: the framework will not pick a
dispatch target out of stored data, so a notify block declares its own recipients.

### Registering your own kind

The escape hatch, not a setup step. Reach for it when the workflow graph genuinely diverges. A
standup, a DM and an announce channel are all channels on the one built-in kind, differentiated by
members and charter.

```ts
// A kind of your own, alongside the built-in.
channelInstances(channels, { kinds: { "my-channel": defineMyChannelFlow() } });

// Or replace the built-in wholesale, keeping the standard behaviour with your own notify block.
channelInstances(channels, { kinds: { channel: defineChannelFlow({ notify }) } });
```

Your factory carries the same contract the built-in does: `cardinality: "singleton"`, so
`flow.id === flow.kind`. A `flow:` naming a kind you did not pass refuses by name and never falls
back to the built-in. The `kinds` map is the whole registration surface; there is no second API.

### What channels do not do yet

No join or leave verb, no delete or retirement, and no summary pass over a long transcript.
Membership is the declared list and nothing else writes it, so changing who is in a channel means
editing the record and opening a fresh channel. Re-running `openChannels` over an open channel
finds it bound and leaves its session alone, so the three settings written at create — `members:`,
the charter (a body or `instructions:`) and `description:` — keep whatever they were opened with.
`flow:` is settled at create too, since it picks the session's kind. Re-opening is not a migration.

`boards:` is the one that does reach: the board list is built onto the kind from the roster on
every bind and is never stored on the session, so adding a board to an open channel's file makes it
usable the next time you run.
It does repair a channel whose id was claimed before it was opened — a post that arrives first
leaves an empty session there, and re-running binds it.

## Hiring at runtime, and reloading at boot

`hireWorkforce` turns records into flow instances, whether those records came from files or from
somewhere else. To keep a runtime hire across restarts, store it and read it back.

```ts
import { defineHiredRosterCollection, reloadHiredSeats } from "@flow-state-dev/workforce";
```

`defineHiredRosterCollection()` is an org-scoped resource collection at `workforce/roster/*`, one
row per hired seat. Install it under the block that does the hiring, and write the row with
`create()` before you register the seat. `create()` throws when the key already exists, and that
throw is what refuses a second hire of the same seat, including two arriving at once — so you need
no lock and no check of your own. Reach for `upsert()` here and you lose the refusal without any
sign that you did.

If registration then fails, delete the row you just created before reporting the failure. A hire
that did not take should not leave a seat waiting at the next start.

The collection is readable by a browser, so a roster panel can name the seats without an action in
between. Because it is org-scoped, that read resolves against the reading session's own
organization. What crosses is `seatId`, `flow` and `instructions`. The settings bag stays
on the server.

A row holds the seat's id within its organization, the flow kind, the settings bag and the
instructions. The envelope is this package's to version; the settings bag is handed back to the
kind untouched, including keys this version has never heard of, because that bag belongs to the
kind's own schema.

`reloadHiredSeats` reads those rows back when the app starts:

```ts
const { seats, problems } = await reloadHiredSeats({
  stores,           // the runtime's resolved stores
  orgIds,           // which organizations to reload; you decide the policy
  kinds,            // the same kinds map you pass to hireWorkforce
});

for (const seat of seats) {
  try { flowstate.register(seat); }
  catch (err) { problems.push(`${seat.id} — ${String(err)}`); }
}
```

A reloaded seat is addressed `<orgId>.<seatId>`, so two organizations can both hold a seat called
`support.ada`. The organization must be a single address segment — lowercase letters, digits and
single hyphens, up to 64 characters, and no dots, since a dot is what joins the two halves.

Register the seats yourself, one at a time, and fold any refusal into the same list. That is not
ceremony: a seat the registry refuses is one seat that cannot run, not a reason for the app to fail
to start, and admitting them as a batch would make it one.

It takes the organizations rather than discovering them, because which organizations an app reloads
is the app's decision and not one this package can make for it.

`problems` is the part to handle rather than log — the same shape `openInventory` returns, for the
same reason: the caller owns start-up policy. A row naming a kind you no longer ship, or carrying a
setting that kind no longer accepts, comes back here with its reason instead of throwing. The other
seats still hire, the app still starts, and the row is left exactly as it was — nothing is repaired
or deleted on your behalf.

A read the store will not complete rejects, and a set of organizations larger than the cap rejects
too, naming both numbers. The cap is `maxOrgs`, 100 by default; the read's own bound is `timeoutMs`,
10000ms by default, and it covers the whole set rather than each organization. Neither returns a
partial roster, because a short roster that looks complete is the failure this is guarding against.

The roster and the inventory are different collections. A roster row at
`workforce/roster/<seatId>` is the durable hire: `hire` writes it, `fire` deletes it. An
inventory row at `inventory/seats/<address>` means *was registered in this organization* and
is never removed.

`createSeatHireCapability`'s `hire` tool writes both. `discover` lists a seat when it is still
hired or still declared in a worker file, and has been registered in this organization. Pass
`hiredRoster` on `createWorkforceCapability` so a runtime hire is listed the same way a
file-declared seat is. A file-declared description wins over a same-id hire. After `fire`,
the inventory row remains and `discover` withholds the seat.

### Hire and fire as catalog tools

`createSeatHireCapability` puts `hire` and `fire` on a worker kind's catalog. Install it with
`defineAgentWorkerFlow({ uses: [seatHire] })`. A seat has to name those tools in `tools:`.
An empty `tools:` list means the seat cannot call them.

The seat is hired in the caller's organization. A body `orgId` is ignored.
Hire will not register a seat without an owner pin `{ orgId, userId? }` taken
from the hire row's roster owner — not from the address.

```ts
import {
  createSeatHireCapability,
  createWorkforceCapability,
  defineAgentWorkerFlow,
  hireWorkforce,
  HIRED_ROSTER_RESOURCE,
  SEAT_INVENTORY_RESOURCE,
  type HireOptions,
} from "@flow-state-dev/workforce";
import type { FlowInstance } from "@flow-state-dev/core";

const kinds: NonNullable<HireOptions["kinds"]> = {};
const roster = { workers: [], channels: [] };
const held = new Map<string, FlowInstance>();
const live = {
  register: (seat: FlowInstance, _pin: { orgId: string; userId?: string }) => {
    held.set(seat.id, seat);
  },
  unregister: (id: string) => held.delete(id),
  kindAt: (id: string) => held.get(id)?.kind,
};

const seatHire = createSeatHireCapability({
  kinds,
  register: live.register,
  unregister: live.unregister,
  kindAt: live.kindAt,
});

const workforce = createWorkforceCapability({
  roster, // or readDeclaredRoster(...)'s result
  inventory: { seats: SEAT_INVENTORY_RESOURCE },
  hiredRoster: HIRED_ROSTER_RESOURCE,
});

kinds.agent = defineAgentWorkerFlow({ uses: [seatHire, workforce] });

const [manager] = hireWorkforce(
  [{ id: "eng.manager", declared: { tools: ["hire", "fire"] }, body: "Expands the roster." }],
  { kinds },
);
```

Pass the same `kinds` object you pass to `hireWorkforce`. A kind you add on that object after
the factory runs is hireable.

| Option | Role |
|--------|------|
| `kinds` | The same map `hireWorkforce` takes. Omit it and only built-in `agent` is hireable, unless `allowKinds` excludes it. |
| `register(seat, pin)` | Admit the minted flow at its address. `pin` is `{ orgId, userId? }` from the hire row's roster owner. Hire refuses rather than omit it. |
| `unregister(id)` | Release the address in this process. Returns whether it was held. |
| `kindAt?(id)` | Kind serving an address right now. Hire uses it to refuse a second hire of a live seat. Fire uses it to refuse a file-declared seat. Omit it and a duplicate seat is still refused. |
| `allowKinds?` | Subset of kinds this tool may mint. |
| `channelBoards?` | Ledger ids forwarded so an unattended board warns. Hire does not attach boards. |

**`hire`** takes `{ seatId, flow, settings?, instructions?, orgId? }` (extra keys are refused)
and returns `{ seatId, address, warning? }`. `address` is `<orgId>.<seatId>`.

A successful hire leaves a roster row and an inventory row. A thrown `register` leaves neither.
A duplicate seat is refused. It does not invent a kind. It does not attach boards. `warning`
is present when a named channel board is unattended.

It refuses an unknown kind or one outside `allowKinds` (and lists the hireable ones), an
address already served, and a request with no organization.

**`fire`** takes `{ seatId, orgId? }` (extra keys are refused) and returns
`{ seatId, address, released }`. It deletes the roster row. The inventory row stays. It
unregisters the address when the live kind matches the stored kind. When a different kind
holds the address, the roster row is deleted and `released` is `false`. After `fire`,
`discover` withholds the seat.

It refuses when this organization hired no seat, or when a live file-declared seat sits at that
address (removed by editing its folder, not by firing it).

**Pairing with `discover`.** Compose both capabilities on the kind and pass
`inventory: { seats: SEAT_INVENTORY_RESOURCE }` plus `hiredRoster: HIRED_ROSTER_RESOURCE`.
Pass both keys so `discover` lists a runtime hire the same way it lists a file-declared seat.
Omit `hiredRoster` and it lists only file-declared seats.

## The live inventory

The tree tells you what a workforce is meant to be. A `WORKER.md` declares a seat, a `CHANNEL.md`
declares a channel, and both are read once at boot. Neither answers what is open right now, or which
channels a given seat is in, and a block cannot walk folders to find out.

The inventory holds those answers as data: three org-scoped resource collections, one row per seat,
one row per open channel, and one row per seat-in-channel. They are ordinary collections, so a block
reads them the way it reads any other resource.

| Factory | One row per | Fields |
|---------|-------------|--------|
| `defineSeatInventoryCollection()` | registered seat, at `inventory/seats/<seatId>` | `id`, `kind` (the worker kind the seat was hired into) |
| `defineChannelInventoryCollection()` | open channel, at `inventory/channels/<channelId>` | `id`, `kind` (the channel kind that opened it), `members` (seat ids, `[]` when absent), `openedAt` (ISO string, or `null` when absent) |
| `defineMembershipIndexCollection()` | seat-in-channel, at `inventory/members/<seatId>/<channelId>` | `seatId`, `channelId` |

### Writing the inventory at boot

The rows are written by `openInventory`, which runs after `openChannels`:

```ts
import {
  channelInstances,
  hireWorkforce,
  openChannels,
  openInventory,
} from "@flow-state-dev/workforce";

const seats = hireWorkforce(roster.workers);
const instances = channelInstances(roster.channels, { inventory: true });

flowRegistry.registerMany([...seats, ...instances]);
// server starts here

await openChannels(roster.channels, { client, userId: "u_boot" });

await openInventory(
  { seats, channels: roster.channels },
  {
    run,
    seatWriter: { flowKind: "channel" },
    userId: "u_boot",
    orgId: "org_acme",
  }
);
```

The writer needs both halves. `channelInstances(roster.channels, { inventory: true })` builds the
built-in channel kind carrying the registration actions and the three collections.
`openInventory(...)` runs those actions: once per channel, once for all seats.

Leave both out and channels work without an inventory. Nothing is declared, nothing is written.

**What `openInventory` writes:**

- One row per seat at `inventory/seats/<seatId>`, carrying `{ id, kind }`.
- One row per channel at `inventory/channels/<channelId>`, carrying `{ id, kind, members, openedAt }`.
- One row per member per channel at `inventory/members/<seatId>/<channelId>`.

**The `run` door.** `run` is your app's door into a flow: it takes the request `openInventory`
builds, runs it through your runtime, and rejects when the action fails. A door that hands back a
failed run as an ordinary value reports every channel registered while writing nothing. **It must
also forward `request.source` into `runAction`'s own `source` option** —
`runAction({ ..., source: request.source })` — because the seat write sets `source: "internal"` on
its request and needs that value carried through. A door that drops it does not become insecure, it
becomes unable to write seats at all: the seat write shows up named in `problems` instead.

**Where the seat rows go.** Seat rows need a flow to run in, because a resource collection can only
be written from inside a flow. `seatWriter: { flowKind: "channel" }` names the built-in, which
carries the writer when built with `inventory: true`. Any flow that spreads `inventoryWriterActions`
will do.

**`registerSeatsInInventory` is boot machinery, not a caller-addressed action.** Unlike channel
registration, which is public because its empty input and the channel's own already-open session
state make it harmless from any caller, the seat write has no session to derive from — its whole
input IS the row data. It lives only in the flow's `internal.actions` map, which a caller-addressed
HTTP or MCP request can never resolve into (`resolveEntry` reads one map per dispatch type with no
fallback); the only way in is the trusted, direct `runAction({ source: "internal", ... })` call
`openInventory`'s own request makes. A hand-rolled kind that spreads `inventoryWriterActions(kind)`
must make the same split itself — see that function's own doc comment for the shape.

**What the channel rows hold.** `members` is the seat ids the channel's session holds, read by the
channel itself. An edit to `members:` in a `CHANNEL.md` does not reach a channel that is already
open, so it does not reach the row either. The `post` and `fileTask` blocks check membership against
the channel's session state, not the inventory; the row is a copy for finding things, not the check.

**Running it twice.** Every write is an upsert keyed by the record's id. Nothing duplicates, and a
channel that has been open since an earlier boot keeps its original `openedAt`.

**Nothing is deleted.** A row stays where it is when a later roster no longer names the seat or
channel.

**What lands in `problems`.** `openInventory` returns `{ seats, channels, problems }`. A channel
whose session is not open, or whose kind declares no registration action, is named in `problems` and
the rest of the roster is still attempted.

### Custom channel kinds

A channel kind you wrote yourself gets rows when it spreads `inventoryWriterActions` into its
`actions`. The string it passes is the value that appears as `kind` on that channel's rows.

```ts
defineFlow({
  kind: "briefing",
  cardinality: "singleton",
  session: { stateSchema: channelSessionStateSchema },
  actions: { ...myActions, ...inventoryWriterActions("briefing") },
});
```

A kind passed under `channelInstances`'s `kinds` option is yours to build. The `inventory: true`
flag reaches the built-in only.

### Reading the inventory

Each factory takes no options. Install what it returns under any block's `resources` map:

```ts
import {
  defineChannelInventoryCollection,
  defineMembershipIndexCollection,
  defineSeatInventoryCollection,
  membershipPrefix,
} from "@flow-state-dev/workforce";
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

const seats = defineSeatInventoryCollection();
const channels = defineChannelInventoryCollection();
const memberships = defineMembershipIndexCollection();

const seatChannels = handler({
  name: "seat-channels",
  inputSchema: z.object({ seatId: z.string() }),
  outputSchema: z.object({ channelIds: z.array(z.string()) }),
  resources: { memberships },
  execute: async (input, ctx) => {
    const rows = await ctx.resources.memberships.list(membershipPrefix(input.seatId));
    return { channelIds: rows.map((row) => row.state.channelId) };
  },
});
```

Keys are relative to each collection's own prefix, so `upsert("engineering.lead", row)` on the seat
inventory lands at `inventory/seats/engineering.lead`. `list()` hands back resource refs, and the row
itself is on `ref.state`. The membership index takes a two-segment key, which is what `membershipKey`
builds; the next section covers it.

A row joins back to the declared record on the id and nothing else. The `id` on a seat row is the
id `discover` looks up: the `WORKER.md` folder's id for a file-declared seat, or `<orgId>.<seatId>`
for a seat written by `hire`. The `id` on a channel row is the `"<teamId>.<channelName>"` that is
also the channel's session id.

The rows are org-scoped and shared across flows. Every flow running under the same `orgId` reads the
same rows, whichever flow wrote them and whichever
[tenant](https://flow-state.dev/docs/fundamentals/state-and-scopes#multi-tenant-isolation) it runs
under, and a flow under a different `orgId` reads none of them. That holds whether or not the app
sets [`isolateOrgState`](https://flow-state.dev/docs/advanced/flow-isolation).

Each row schema is closed, so a key it does not declare is dropped on the way in rather than stored.
`id` and `kind` are required and the schema rejects a row without them. `members` and `openedAt` are
optional, and a row without them parses. The schemas ship as `seatInventoryRowSchema`,
`channelInventoryRowSchema` and `membershipIndexRowSchema` alongside the row types, for checking what
you are about to write.

### Listing one seat's channels

The channel inventory answers who is in a channel. The membership index answers the reverse: one row
per membership, keyed seat first, so a seat's channels are something you can list by prefix.
`membershipKey` builds the key for a single row; `membershipPrefix` builds the prefix for the list.

```ts
import { membershipPrefix } from "@flow-state-dev/workforce";

const seatChannels = handler({
  name: "seat-channels",
  inputSchema: z.object({ seatId: z.string() }),
  outputSchema: z.object({ channelIds: z.array(z.string()) }),
  resources: { memberships },
  execute: async (input, ctx) => {
    const rows = await ctx.resources.memberships.list(membershipPrefix(input.seatId));
    return { channelIds: rows.map((row) => row.state.channelId) };
  },
});
```

Both helpers return keys relative to the collection's prefix, which is what `upsert`, `get` and
`list` take. `membershipKey("engineering.lead", "engineering.standup")` is
`"engineering.lead/engineering.standup"`, and `membershipPrefix("engineering.lead")` is
`"engineering.lead/"`. That trailing slash is the reason to use the helper rather than build the
string yourself: without it, `"engineering.lead"` also matches `"engineering.leadership"`, and one
seat reads another seat's channels.

**Listing a seat's channels reads every membership row.** `list(membershipPrefix(seatId))` fetches
every membership row under the org before the prefix narrows it, so the cost grows with the org
rather than with the seat.

Both helpers throw when an id cannot be one whole path segment, naming the argument at fault:

```ts
membershipKey("engineering/lead", "engineering.standup");
// Error: Inventory seatId "engineering/lead" must not contain a path separator …

membershipPrefix("");
// Error: Inventory seatId must not be empty
```

## Exports

| Export | Description |
|--------|-------------|
| `defineAgentWorkerFlow(options?)` | Build the flow behind the `agent` worker kind — `agent` is one kind of worker, and this is the flow it resolves to. Called with no arguments it *is* the built-in a record with no `flow:` is hired into; called with factory options (`AgentWorkerFlowOptions`) it is the replacement you register under `agent`. |
| `AGENT_KIND` | The kind name (`"agent"`) the hire step defaults to, and the key a replacement registers under. |
| `definePersona(config)` | Declare a persona resource or collection. |
| `createWorkforceCapability({ roster, inventory, hiredRoster?, sources? })` | The discovery door. Installs the seat and channel sources plus whatever other domains' sources you pass, and contributes one control tool, `discover`. Pass `hiredRoster` so a runtime hire is listed the same way a file-declared seat is. Omit it and `discover` lists only file-declared seats. |
| `workforceManifestSources({ roster, inventory, hiredRoster? })` | The seat and channel sources on their own, for an app assembling its own manifest registry. Same `hiredRoster?` meaning as `createWorkforceCapability`. |
| `createSeatHireCapability({ kinds, register, unregister, kindAt?, allowKinds?, channelBoards? })` | Puts catalog tools `hire` and `fire` on a worker kind. Compose it into `defineAgentWorkerFlow({ uses })`. A seat names those tools in `tools:` or cannot call them. Writes the hired roster and `inventory/seats/*`. The seat is hired in the caller's organization; a body `orgId` is ignored. `register` receives `{ orgId, userId? }` from the hire row's roster owner; hire refuses rather than omit it. |
| `registerHiredSeat(register, seat, pin)` | The hire writer's register path. Refuses when `pin` has no `orgId`. The pin is the hire row's roster owner, not the address. |
| `HiredSeatOwnerPin` | `{ orgId, userId? }`. `userId` is present only for a user-owned hire row. |
| `SEAT_HIRE_CAPABILITY` | The capability name, `"seat-hire"`. |
| `HIRED_ROSTER_RESOURCE` | Registry key the seat-hire capability installs the hired roster under, `"hiredRoster"`. Pass it as `hiredRoster` on `createWorkforceCapability` so `discover` reads the same collection. |
| `SEAT_INVENTORY_RESOURCE` | Registry key the seat-hire capability installs the seat inventory under, `"seatInventory"`. Pass it as `inventory.seats` on `createWorkforceCapability`. |
| `SEAT_DISCOVER_KEY` | The pinned worker-file key, `"discover"` — the domains one seat sees, out of what its scope carries. Narrows only: a seat can never reach a domain the app did not install. |
| `readDeclaredRoster(root)` | Read the whole tree in one call — workers with their skills, teams, documents and channels — plus one list of everything that failed to load, each entry tagged with the layer that reported it. Collects rather than throws, so the boot policy stays yours. Ships from the `./loader` subpath (Node only). |
| `readWorkforce(root)` | Read the tree into worker records that already carry their own skills — `readWorkforceDirectory` joined with `readSeatSkills` per seat. Reach for it when seats are all you need. Ships from the `./loader` subpath (Node only). |
| `readWorkforceDirectory(root)` | Read a `teams/<id>/workers/<name>/` tree into one `WorkerManifest` per worker, without their skills. Ships from the `./loader` subpath (Node only). |
| `readSeatSkills(root, { team, worker })` | Read one worker's skills across the org, team and worker levels into `InitialSkill[]`. Ships from the `./loader` subpath (Node only). |
| `openRoot(root)` / `walkTeams(root, report)` | The walk every reader above shares: open the configured root (throwing on a symlinked or unreadable one, with or without a trailing separator, and on one spelled with a `..` that steps back through an earlier segment — pass the path it resolves to; a `.` segment and anything above the root are not checked), then enumerate `teams/`, reporting a team folder that is refused or unreadable and yielding the rest. `report` may be `async` and is awaited before the walk moves on. What a reader does *inside* a team stays its own. Ships from the `./loader` subpath (Node only). |
| `classify(path)` / `openStructuralDirectory(path, reportAs)` | One path's kind without following symlinks, and one structural folder's entries — or the reason the walk stops there, or neither when it is simply absent. Ships from the `./loader` subpath (Node only). |
| `refusedSymlink(what, name)` / `unreadable(what, name, cause)` / `IGNORED_ENTRIES` | The one wording for each refusal, and the one set of names that never denote anything in the tree — a `ReadonlySet` that cannot be written to, since every reader in the process reads it. Ships from the `./loader` subpath (Node only). |
| `validateSegment(segment, label)` | The one rule for what a name in this tree may be — lowercase letters, digits and single hyphens, under 64 characters, not reserved. Throws naming the segment and what it would have become. Ships from the `./loader` subpath (Node only). |
| `discoverWorkforceCode(root)` | Walk `flows/workers/`, `flows/channels/` and `blocks/` one level deep, every `resources/` folder the convention reads, and every `blocks/` folder inside the team tree, returning what they hold on `files`, `resourceModules` and `seatBlocks` — each ordered by path — plus the `searched` patterns. Reads the tree only — it opens none of the modules it finds. Throws a `WorkforceCodeError` carrying every refusal. Ships from the `./codegen` subpath (Node only). |
| `renderWorkforceCode(files, modules, seatBlocks?)` | Render a discovery's `files`, `resourceModules` and `seatBlocks` as a module of static imports exporting `kinds`, `channelKinds`, `blocks`, `seatBlocks` and `resourceModules`. Pass all three: the third parameter defaults to `[]`, so omitting it renders an empty `seatBlocks` map and reports nothing. Deterministic: the same tree renders the same bytes. `fsdev gen` is a thin command over this and the call above. Ships from the `./codegen` subpath. |
| `hireWorkforce(manifests, { kinds, seatBlocks, channelBoards, documents, references })` | Turn worker records into one configured flow copy each, ordered by id. Pass `defineFlow(...)` results directly as `kinds`, `workforce.gen.ts`'s `seatBlocks` export as `seatBlocks`, and, when any seat file declares `resources:`, the map `resourcesFromDocs` returns as `documents`. Pass the map `referencesFromDocs` returns as `references` whenever a kind installs any: it is what marks those entries as references, the per-seat tree wall is derived against it, and a kind holding references it was not given refuses the whole roster. `channelBoards` is optional and advisory: give it the roster's minted board ids and unattended boards are warned about on stderr. |
| `unattendedBoardWarnings(boardIds, seats)` | The unattended-board warning strings `hireWorkforce` prints. The `hire` tool puts the same sentences on `warning` when a named board has no seat that declares it. |
| `workerConfigSchema()` | The admission contract every hireable worker kind composes: `configSchema: workerConfigSchema().extend({ ...its own settings })`. Declares `instructions?`, `teamInstructions?`, `seatSkills` and `seatTools`. A kind whose schema cannot take what hiring imposes refuses the whole roster at startup. A fresh schema per call. |
| `seatSkillSchema` | One skill as it rides into the bag — `{ name, skillMd, files? }`, closed. The shape `seatSkills` is an array of; reach for it when declaring your own variant of that key. |
| `WorkerConfig` | The parsed shape of `workerConfigSchema()` — what every hireable kind receives, whatever else it extends on. |
| `readResourcesDirectory(root)` | Read every `resources/` folder in the tree — org, team, and each worker's own — into one `ResourceDoc` per document. Ships from the `./loader` subpath (Node only). |
| `resourcesFromDocs(documents)` | Turn document records into the flow resource map, keyed by each document's ref. Spread it into your own `resources`. |
| `readReferencesDirectory(root)` | Read every `references/` folder in the tree — org, team, and each worker's own — into one `ResourceDoc` per document, each carrying its `filePath`. Same result shape and same error kinds as `readResourcesDirectory`. Ships from the `./loader` subpath (Node only). |
| `referencesFromDocs(references)` | Turn reference records into the flow resource map, keyed by ref. Each entry is served from its file and is read-only. Throws naming the ref for a record with no `filePath`. |
| `clearShadowedReferences(input)` / `describeShadowedReferences(result)` | Clear the stored rows left behind when a document moves from `resources/` to `references/`, for one org, and render the result as one log line. Takes `{ references, orgId, content, installedOn, dryRun? }`; returns `{ cleared, checked, dryRun, scopeId }`. |
| `splitResourceModules(resourceModules)` | Split the generated map into `{ capabilities, resources }` — the capabilities a worker kind installs through `uses`, and the resources that merge into the one resource map. Installs nothing: you pass both on, at your own call site. Throws naming the ref when an entry can be neither. |
| `DeclaredRoster` / `DeclaredProblem` | What `readDeclaredRoster` returns: `{ workers, teams, documents, references, channels, problems }`, and one problem: `{ layer, path, error, worker? }`, where `layer` is `worker`, `skill`, `team`, `document`, `reference` or `channel`. |
| `WorkerManifest` | One worker record: `{ id, declared, body, skills? }`. |
| `ResourceDoc` | One document record: `{ ref, declared, body, filePath? }`. |
| `mintResourceRef(teamId, workerName, name)` | The one rule that names a resource, whichever door read it — the ref a document or a module called `name` in that folder gets. Throws naming the segment that breaks the rules. Ships from the `./loader` subpath (Node only). |
| `ResourceModules` | The generated `resourceModules` map: one entry per discovered module, keyed by its ref. |
| `ResourceModuleExport` / `WorkerResourceModuleExport` | What a module in the organisation's or a team's `resources/` folder may be — a capability or a resource — and the narrower type a worker's own folder is held to: a resource, never a capability. |
| `SeatCapabilitySelection` | What a worker file's `capabilities:` key parses to — capability name to the presets that seat wants. Read by the built-in `agent` kind; validated at the hire. |
| `defineChannelFlow(options?)` | Build a channel kind. `options.notify` is the per-member fan-out block. |
| `channelFlow` | The built-in channel kind, seeded by `channelInstances` when you register none. |
| `channelInstances(manifests, { kinds?, inventory? })` | Build time. One `FlowInstance` per distinct kind across the roster, the built-in seeded. Pass `inventory: true` to install the registration actions and the three inventory collections on the built-in channel kind. Register these. |
| `openChannels(manifests, { client, userId })` | Runtime. One named session per record, carrying its members, charter and description. The server binds each session's organization. Idempotent. |
| `readChannelsDirectory(root)` | Read a `teams/<id>/channels/<name>/` tree into one `ChannelManifest` per channel. Ships from the `./loader` subpath (Node only). |
| `ChannelManifest` | One channel record: `{ id, declared, body }`. |
| `channelBoard(channelId, boardName)` | The one declaration for a channel's board, carrying its minted `id`. Pass it to `taskBoard({ collection })`, and to `channelBoardTaskTools`. Throws when the name is not a plain local name. |
| `channelBoardTaskTools(board)` | Capability granting a seat all eight task tools over one channel board, board-qualified by name. List it in the seat kind's `uses`; it declares the ledger too. |
| `channelBoardIds(manifests)` | Every minted id across a roster, sorted and deduped — what `hireWorkforce`'s `channelBoards` takes. |
| `ChannelBoardCollection` | A `DefinedTaskCollection` carrying its minted `id`. |
| `channelBoardRowSchema` | One row as `readBoard` publishes it: the board's facts, without execution coordinates or write provenance. |
| `channelFileTaskInputSchema` / `channelFileTaskOutputSchema` / `channelReadBoardInputSchema` / `channelReadBoardOutputSchema` | The `fileTask` and `readBoard` contracts. |
| `ChannelPostRefusedError` | A post refused on the channel's own terms; `reason` is `channel-not-bound` or `author-not-a-member`. |
| `channelPostInputSchema` / `channelReadOutputSchema` / `channelNotifyInputSchema` | The post, read and notify contracts. |
| `channelSessionStateSchema` / `channelTranscriptLineSchema` | A channel session's state, and one transcript line. |
| `defineHiredRosterCollection()` | The hired roster's browser collection: one org-scoped row per org-visible seat, at `workforce/roster/<seatId>`. One segment, so a user-owned row is not listed. Takes no options. Write org-visible rows with `create()` — its already-exists throw is what refuses a duplicate hire, and `upsert()` loses that refusal silently. |
| `defineHiredRosterPrivateCollection()` | The branded server-side writer for a user-owned row, at `workforce/roster/~<escaped user>/<seatId>`. No browser read. Registration admits that pattern only from this function. A block that holds it lists and writes the session user's rows only. Any other pattern that can reach those rows, including `workforce/roster/**`, `workforce/roster/[owner]/notes`, and a parameterised pattern such as `workforce/[area]/[owner]/[seat]`, is refused. |
| `hiredSeatRowSchema` / `HiredSeatRow` | One roster row — `{ seatId, flow, settings, instructions, owningOrgId, ownerUserId }`. `owningOrgId` and `ownerUserId` are nullable and default to `null`. The envelope is closed; `settings` is a passthrough bag belonging to the kind's own schema. |
| `HIRED_ROSTER_PREFIX` | The roster's storage prefix, `"workforce/roster/"`. Moving it strands every roster already written. |
| `seatAddress(orgId, seatId, ownerUserId?)` / `splitSeatAddress(orgId, address)` | Join an organization and a seat id into the address a hired seat answers on, and take the seat id back out. Org-visible is `<org>.<seatId>`. User-owned is `<org>.~<user>.<seatId>`, with the user escaped. The pin is the hire row, not the address. Throws when the organization is not one legal address segment, or when the seat id starts with `~`. |
| `toHiredSeatRow(input)` / `parseHiredSeatRow(value)` | Build a row from what a hire supplied, and read a stored value back into one. `parseHiredSeatRow` returns `{ row }` or `{ problem }` — it never throws and never rewrites the stored value. |
| `hiredRosterStorageKey(row)` | `seatId` for an org-visible row, `~<escaped user>/<seatId>` for a user-owned one. The user id is escaped, so a `/` in it stays one segment. |
| `hiredSeatManifest(orgId, row)` / `hiredSeatRowFromManifest(orgId, manifest)` | Turn a row into the record `hireWorkforce` mints from, and back. Each returns `{ ... }` or `{ problem }`. A row whose `owningOrgId` disagrees with `orgId` is a problem and is not minted. A legacy row (`owningOrgId` null) binds `orgId`. The manifest's `ownerPin` is `{ orgId, userId? }`. |
| `registerHiredSeat(register, seat, pin)` | The hire writer's register. Calls `register(seat, pin)` only when `pin.orgId` is present. Omitting the pin throws, and `register` is not called. Wrap the engine door as `(seat, pin) => state.register(seat, { pin })`. App and kind flows do not use this. |
| `reloadHiredSeats(options)` | Read each organization's stored roster at boot and hire what it names. Takes `{ stores, orgIds, kinds?, maxOrgs?, timeoutMs? }` and returns `{ seats, problems }`. **It registers nothing** — loop the seats and `register(seat, { pin: seat.ownerPin })` one at a time, folding refusals into `problems`. Rejects (loading nothing) past the org cap (`maxOrgs`, default 100) or when the whole read does not complete in its bound (`timeoutMs`, default 10000). |
| `DEFAULT_MAX_RELOAD_ORGS` / `DEFAULT_ROSTER_READ_TIMEOUT_MS` | The two bounds' defaults: 100 organizations, and 10000 ms for the whole read. |
| `HiredRosterReload` / `HiredRosterStores` / `ReloadHiredSeatsOptions` / `RowProblem` | What the reload returns, the slice of the runtime's stores it reads through, its options, and the `{ problem }` shape a row that could not be read comes back as. |
| `defineSeatInventoryCollection()` | The seat inventory: one org-scoped row per registered seat, at `inventory/seats/<seatId>`. Takes no options; install what it returns under a block's `resources`. |
| `defineChannelInventoryCollection()` | The channel inventory: one org-scoped row per open channel, at `inventory/channels/<channelId>`, carrying the channel's `members` and `openedAt`. Takes no options. |
| `defineMembershipIndexCollection()` | The membership index: one org-scoped row per seat-in-channel, at `inventory/members/<seatId>/<channelId>`, so one seat's channels can be listed by prefix. Takes no options. |
| `membershipKey(seatId, channelId)` | The membership index key for one row, relative to the collection's prefix. Throws when either id is not one whole path segment. |
| `membershipPrefix(seatId)` | The prefix that lists one seat's memberships, trailing slash included, relative to the collection's prefix. Refuses the same ids `membershipKey` does. |
| `SeatInventoryRow` / `ChannelInventoryRow` / `MembershipIndexRow` | One row of each of the three collections. |
| `seatInventoryRowSchema` / `channelInventoryRowSchema` / `membershipIndexRowSchema` | The Zod schema behind each row type. Closed: an undeclared key is dropped on the way in. |
| `openInventory(roster, options)` | Write the inventory at boot: one row per seat, one row per channel, one row per membership. Takes `InventoryRoster` (the seats and channels to register) and `OpenInventoryOptions` (the `run` door, `seatWriter`, `userId`, `orgId`). Returns `{ seats, channels, problems }`. |
| `inventoryWriterActions(kind)` | The two blocks a custom channel kind installs to get inventory rows, keyed by action name. Split them: `registerChannelInInventory` into `actions` (public, safe — empty input), `registerSeatsInInventory` into `internal.actions` (its input is the row data, with nothing to check it against). The string is the `kind` value those rows carry. |
| `INVENTORY_REGISTER_CHANNEL` / `INVENTORY_REGISTER_SEATS` | The action names the writer runs: `"registerChannelInInventory"` and `"registerSeatsInInventory"`. |
| `INVENTORY_SEAT_WRITER_SESSION` | The session id the seat-registration action runs under when `seatWriter` names none: `"inventory-binder"`. |
| `InventoryRoster` / `InventorySeat` / `InventorySeatWriter` | What `openInventory` takes: the roster (`{ seats, channels }`), one seat (`{ id, kind }`), and which flow writes the seat rows (`{ flowKind }`). |
| `InventoryActionRequest` / `InventoryBinding` | What the `run` door receives (`{ action, input, userId, orgId, flowKind, sessionId, source? }` — `source` is `"internal"` on the seat request and must reach `runAction`), and what one boot of `openInventory` returns (`{ seats, channels, problems }`). |
| `OpenInventoryOptions` | The options `openInventory` takes: `run`, `seatWriter`, `userId`, `orgId`. |

## Error Semantics

| Error | When |
|-------|------|
| Two sources claiming one discovery domain | `createWorkforceCapability` construction, naming both registration sites |
| A worker file's `discover:` names something that is not one of the four domains | The mint, by name, listing `seats`, `channels`, `skills`, `resources`. A correctly spelled domain the scope does not carry is *not* an error — the seat simply sees nothing for it |
| Worker folder unreadable | Collected in `readWorkforceDirectory`'s `errors`, keyed by the folder's path — never thrown |
| Workforce root unreadable or symlinked | `readWorkforceDirectory` and `readWorkforce` throw — the root is never followed through a link |
| Anything below the root, read as one tree | Collected in `readDeclaredRoster`'s `problems`, one entry per thing that did not load, tagged with the layer that reported it — never thrown |
| Workforce root unreadable, symlinked, or spelled with an interior `..`, read as one tree | `readDeclaredRoster` throws, naming the path — its only throw |
| One seat's skills failed to load | Collected in `readWorkforce`'s `skillErrors`, one entry per affected seat, each carrying that seat's id and `readSeatSkills`' own error list |
| Bad `team` or `worker` name | `readSeatSkills` throws |
| Skills root unreadable or symlinked | `readSeatSkills` throws — the root is never followed through a link |
| Skills level unreadable | Collected in `readSeatSkills`'s `errors` as `kind: "unlistable-level"`, keyed by the level's path — an absent level is empty instead |
| Skill folder fails to load | Collected in `readSeatSkills`'s `errors` as `kind: "skill-load-failed"`, keyed by `<level>/<folder>` |
| Symlinked folder on the way to a level | Collected in `readSeatSkills`'s `errors` as `kind: "refused-symlinked-ancestor"`, keyed by that folder's path — never followed |
| Symlinked `skills/` folder at a level | Collected in `readSeatSkills`'s `errors` as `kind: "refused-symlinked-level"`, keyed by the level's path — never followed |
| One skill name at more than one of a seat's levels | Collected in `readSeatSkills`'s `errors` as `kind: "duplicate-skill-name"`, keyed by the level the name was first seen at, with every colliding path on the entry's `paths`; the name is left out of `skills` |
| `scope:` in a `SKILL.md` | Collected in `readSeatSkills`'s `errors` as `kind: "refused-scope-key"`, keyed by the skill's path |
| Worker cannot be hired | `hireWorkforce` — an empty or whitespace-only `flow`, an unknown kind, a flow passed under a key that is not its own kind, a duplicate id, a setting or body the flow never declared, a `tools:` name nothing registers for that seat, a registered block whose key and own `name` disagree, a block in a worker's own folder that declares a resource, a skill name reaching one seat from both the app's `skills` and its own folders, a `resources:` list the hire step cannot resolve (a `resources:` that is not a list, an entry that is neither a ref nor a one-key `ref: mode` mapping, a ref no document matches, a ref naming a document the app declared but did not install on this seat's kind, a mode other than `ro` or `rw`, the same ref twice, `rw` on a document declaring itself `writable: false`, a ref colliding with a name the kind's own blocks declare, a ref the kind declares at flow level while what it holds there is not that document, or the key itself with no `documents` passed), a document a seat did not name that its minted flow reaches anyway because one of the kind's blocks declares it, a `references:` list the hire step cannot resolve (a `references:` that is not a list, an entry that is not a ref, the same ref twice, or a ref naming a reference this seat cannot reach from its place in the tree — including every ref when no `references` map was passed), a seat id that names no place in the tree while its kind holds references, a reference the seat did not name that its minted flow reaches anyway, `instructions` given both in the frontmatter and as a body, a flow kind whose schema will not take what hiring imposes (composing `workerConfigSchema()` is the fix), or a `persona:`, `seatSkills:`, `seatTools:` or `teamInstructions:` key. Collected: one error names every bad worker |
| A `resources/` slot, `org/`, `teams/`, a team folder, a `workers/` level or a worker folder unreadable or symlinked | Collected in `readResourcesDirectory`'s `errors` as `kind: "unreadable-slot"`, keyed by that folder's path — an absent folder is empty instead |
| A directory where a document file belongs | Collected in `readResourcesDirectory`'s `errors` as `kind: "folder-where-file-belongs"`, keyed by the directory's path |
| Document file fails to load | Collected in `readResourcesDirectory`'s `errors` as `kind: "document-load-failed"`, keyed by the file's path — an unusable name, a symlink, an unreadable file, no frontmatter, or a missing `description` |
| A setting the convention derives, or `prefetchMode: "lazy"`, in a document file | Collected in `readResourcesDirectory`'s `errors` as `kind: "refused-declaration"`, keyed by the file's path |
| Workforce root unreadable or symlinked, read for documents | `readResourcesDirectory` throws — the root is never followed through a link |
| Document cannot become a resource | `resourcesFromDocs` throws naming the ref — a setting the convention derives, a lazy `prefetchMode`, or frontmatter `defineResource` itself rejects |
| Any of the four conditions above, in a `references/` folder | `readReferencesDirectory` reports the same `kind`s at the same paths, and throws on the same root conditions |
| `writable`, `llmWritable`, `render` or `flowIsolation` in a reference file | Collected in `readReferencesDirectory`'s `errors` as `kind: "refused-declaration"`, keyed by the file's path — at either value |
| One basename claimed by a `references/` and a `resources/` file at one level | Collected in `readDeclaredRoster`'s `problems` on the `reference` layer, naming both files. Neither single-folder reader sees it |
| Reference cannot become a resource | `referencesFromDocs` throws naming the ref — a setting the convention derives, a lazy `prefetchMode`, a record with no `filePath`, or frontmatter `defineResource` itself rejects |
| One ref passed to `hireWorkforce` as both a document and a reference | `hireWorkforce` throws before hiring anything, naming every ref in both maps |
| A reference row cannot be addressed | `clearShadowedReferences` throws when the org id — or, for a flow that isolates its org scope, the flow id — contains `:` or a backslash |
| A `channels/` slot, `teams/` or a team folder unreadable or symlinked | Collected in `readChannelsDirectory`'s `errors` as `kind: "unreadable-slot"`, keyed by that folder's path — an absent folder is empty instead |
| Channel folder fails to load | Collected in `readChannelsDirectory`'s `errors` as `kind: "channel-load-failed"`, keyed by the folder's path — an unusable name, a symlink, or a missing, unreadable or malformed `CHANNEL.md` |
| `system:` in a `CHANNEL.md` | Collected in `readChannelsDirectory`'s `errors` as `kind: "refused-declaration"`, keyed by the channel folder's path |
| Workforce root unreadable or symlinked, read for channels | `readChannelsDirectory` throws — the root is never followed through a link |
| Channel cannot be bound | `channelInstances` — a `flow:` naming a kind nobody passed, a kind filed under another kind's key, a duplicate id, an `id:`, a `system:`, an undeclared key, a `members:` that is not a list of names, a `boards:` that is not a list of plain names, a board name carrying a dot or declared twice, a minted board id two channels would share, or `boards:` on a custom kind that does not support them. Also `instructions:` given both in the frontmatter and as a body. Collected: one error names every bad channel, and nothing is registered |
| Channel cannot be opened | `openChannels` throws, naming the channel — except a 409, which means the id is taken. An open channel there is left alone, and this kind's own empty session is bound. Anything else holding the id — another flow's session, another user's, or one carrying state that is not a readable channel — is named and refused rather than released |
| `channel-not-bound` | A `post` or `read` naming a session nobody opened. Per-request; nothing is written and the session stays inert |
| `author-not-a-member` | A `post` claiming an `author` outside the channel's declared members. Per-request; nothing is written |
| `external-dispatcher` | A flow-to-flow post on a host whose dispatcher hands work to an external queue. The public action route is unaffected |
| Inventory id is not one path segment | `membershipKey` and `membershipPrefix` throw, naming the offending argument: an empty id, one containing `/` or `\`, or `.` and `..` |
| Unknown kind on `hire` | The tool, listing the hireable kinds. Writes nothing. |
| Address already served | The `hire` tool, naming the address and the live kind. Writes nothing. |
| Hire or fire with no organization | The tool. The verified principal carries no org, and the roster is org-scoped. |
| `fire` names no roster row | The tool. "This organization hired no seat" when nothing is live at that address. A live file-declared seat is refused as removed by editing its folder, not by firing it. |
| Inventory write with no org | `openInventory` throws before writing anything — the three collections are org-scoped |
| Seat inventory write with no seatWriter | `openInventory` throws when passed seats and no `seatWriter` — a seat has no session of its own, so its row needs a flow to run in |
| Channel or seat registration failed | Collected in `openInventory`'s `problems`: a channel whose session is not open, whose kind declares no registration action, or whose action failed; a seat write that failed. The rest of the roster is still attempted |

## Scripts

```bash
pnpm --filter @flow-state-dev/workforce build
pnpm --filter @flow-state-dev/workforce typecheck
pnpm --filter @flow-state-dev/workforce test
```
