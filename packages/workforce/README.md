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

```ts
import { readWorkforce } from "@flow-state-dev/workforce/loader";
import { hireWorkforce } from "@flow-state-dev/workforce";

const { workers, errors } = await readWorkforce("./workforce");
if (errors.length) throw new Error(`workforce: ${errors.length} worker(s) failed to load`);

const seats = hireWorkforce(workers);
flowRegistry.registerMany(seats); // FlowInstance[], ordered by id
```

That record names no `flow:`, so it is hired into the built-in `agent` kind and needs no `kinds`
argument. Its body becomes its instructions and steers its answers.

The built-in stores each worker's skills at org scope, so **a request to one of these workers has
to resolve to an org**. One that resolves to a `userId` alone fails with `Resource "skills" is not
registered` before the model is reached. On the default principal resolver, send an `orgId` with
the request; if you configure your own `resolvePrincipal`, return the org from there — the route
reads the resolved principal and ignores a body `orgId`, so a caller cannot name its own org.

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
for that worker — or let `readWorkforce` do it, below.

### Reading the whole roster at once

`readWorkforce` does both walks and hands back records that already carry their skills, which is
what `hireWorkforce` needs to give each seat its own catalog:

```ts
import { readWorkforce } from "@flow-state-dev/workforce/loader";

const { workers, errors, skillErrors } = await readWorkforce("./workforce");
// workers[0].skills — that seat's org ∪ team ∪ own union, resolved
const seats = hireWorkforce(workers);
```

Two error channels, because they are different severities: `errors` is a worker slot that failed
(a seat the app does not have), `skillErrors` is a seat that loaded short, one entry per affected
seat. Both are collected rather than thrown; treating either as fatal is the caller's call.

The record's `skills` reaches the built-in `agent` kind as its `seatSkills` setting, imposed by
the hire step the way a body is imposed as `instructions`. A `WORKER.md` declaring `seatSkills:`
itself is refused by name at both the loader and the hire step — where a skill folder sits is
what decides who can see it.

**Every hireable kind receives it**, because every hireable kind composes `workerConfigSchema()`,
which declares the key. There is no opting in and no opting out: hiring hands the same settings to
every seat, and a kind whose schema cannot take them refuses the whole roster at startup. Reading
them is still optional — a kind that ignores `seatSkills` runs exactly as it did before.

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

The factory reads **`flow`**, which names the kind to instantiate, and **`description`**, the roster
label. Everything else is that worker's settings, handed to the flow
verbatim and parsed against its `configSchema`. That schema is closed, so a setting the flow never
declared is refused by name at the hire.

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
runs exactly as it did before — ignoring the bag is not an error. What is not optional is the door:
the factory hands every seat a bag, so a kind whose schema cannot take it refuses at the hire, for
the whole roster, with a message naming the worker and the fix. That is a one-line change per kind,
and it is what replaces a seat that used to hire, run, and silently hold none of what its author's
files declared.

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
`kinds`, `channelKinds`, `blocks` and `seatBlocks` — four parameters `hireWorkforce`,
`channelInstances`, a task board and a worker kind's tool catalog already take.

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

**A resource is a file, not a folder.** A document is `<name>.md` directly in `resources/`, unlike
a worker or a skill, which is a folder with a fixed file inside it. A directory in a `resources/`
slot lands in `errors` rather than being passed over.

Four places are read — the org level, a team, and a worker's own folder under either of those:

| Path | Ref |
|------|-----|
| `<root>/org/resources/<name>.md` | `<name>` |
| `<root>/teams/<teamId>/resources/<name>.md` | `teams/<teamId>/<name>` |
| `<root>/teams/<teamId>/workers/<worker>/resources/<name>.md` | `teams/<teamId>/workers/<worker>/<name>` |
| `<root>/org/workers/<worker>/resources/<name>.md` | `workers/<worker>/<name>` |

A worker's `resources/` folder is how two seats each get their own `runbook` without their authors
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
turns those records into the resource map you already pass to a flow.

```ts
import { defineFlow } from "@flow-state-dev/core";
import { resourcesFromDocs } from "@flow-state-dev/workforce";
import { readResourcesDirectory } from "@flow-state-dev/workforce/loader";
import { answerQuestion } from "./blocks";
import { ticketResource } from "./resources";

const { documents, errors } = await readResourcesDirectory("./workforce");
if (errors.length) throw new Error(`resources: ${errors.length} document(s) failed to load`);

export const supportFlow = defineFlow({
  kind: "support",
  actions: { answer: { block: answerQuestion } },
  resources: { ticket: ticketResource, ...resourcesFromDocs(documents) },
});
```

**The flow needs an org identity, and it will not ask for one on its own.** Every file-declared
document is org-scoped, and a flow collects `requiresOrg` from its blocks, not from its resource
map. So the flow above accepts a request carrying only a `userId`, builds no org resource registry,
and every document is then missing: `ctx.resources.get("teams/engineering/handbook")` throws
`is not registered`, and `readResourceContentTool` says the same. Declare `requireOrg: true` on the
blocks that read a document, and a request without an org is refused at the door instead of arriving
empty:

```ts
// ./blocks.ts
import { generator, readResourceContentTool } from "@flow-state-dev/core";

export const answerQuestion = generator({
  name: "answer-question",
  model: "openai/gpt-5.4-mini",
  requireOrg: true,
  prompt: "Answer support questions. Check the team handbook before you answer.",
  tools: [readResourceContentTool()],
});
```

Each record is plain data:

| Field | Description |
|-------|-------------|
| `ref` | The document's identity and storage key, taken from where the file sits — see the table above. It is also the accessor key, so a team's handbook is `ctx.resources["teams/engineering/handbook"]` and one seat's runbook is `ctx.resources["teams/pentest/workers/recon/runbook"]`. |
| `declared` | The frontmatter exactly as written. A file that declares one of the refused settings below produces no record at all, so nothing is stripped here. |
| `body` | The Markdown below the frontmatter, verbatim. It becomes the resource's content. |

**Merge the map yourself.** A flow copy created with `supportFlow({ resources })` *replaces* the
definition's map rather than merging with it, so passing `resourcesFromDocs(documents)` there on its
own drops whatever resources the flow kind declared. Spread it into your own map, as above.

**A folder is a namespace, not a visibility boundary — at every level.** Every file-declared
document is org-scoped, and a flow's resource tools reach every installed document marked
`llmReadable` with no per-team filter. Installing a whole tree on one flow makes every team's
documents reachable from it. To give a team's seats only its own, filter the records before
installing:

```ts
const engineering = resourcesFromDocs(
  documents.filter((d) => d.ref.startsWith("teams/engineering/")),
);
```

This holds for a worker's folder too, and it is the thing most worth being clear about: putting a
document under `workers/recon/` addresses it to that seat, it does not keep it from the others. Every
seat hired into one kind shares that kind's flow definition, so by default all of them read the same
row.

**To make a document that seat's alone, say so in the document.** A file whose frontmatter carries
`flowIsolation: true` gets one row per seat: the seat that writes it reads it back, and a sibling
seat asking for the same document gets its own empty copy rather than an error.

```md
---
description: This seat's own working notes.
flowIsolation: true
---
```

Both sentences are owed together. A worker folder without that line is an address, not a boundary.

**`description` is required.** A file without one lands in `errors`. It reaches the resource with
the rest of the frontmatter, and nothing puts it in front of a model. Write it for whoever opens the
tree.

**The convention owns identity, storage and content.** Where a document lives decides all three, so
a file may not declare any of `scope`, `ref`, `stateSchema`, `default`, `content`, `contentFile`,
`contentTemplate` or `contentTemplateRef`. Each is refused by name rather than quietly ignored, and
so is `prefetchMode: "lazy"`: a file-declared document is always loaded eagerly. Everything else is
carried through as written, so `llmReadable`, `llmWritable`, `writable`, `allowedExtensions` and
`metadata` all reach the resource.

A document that needs a state schema, a render function, reactive bindings or an edge graph stays in
code — those are functions, and a Markdown file cannot hold one. Session- and user-scoped resources
are not file-declared.

Document, team and worker folder names all follow one rule: lowercase letters, digits and
single hyphens, at most 64 characters. A worker folder's documents load whether or not the folder
holds a `WORKER.md` — this reader answers a question about a file, and a slot with no seat file is
reported separately by `readWorkforceDirectory`. A non-`.md` file in the slot is passed over in silence. An
absent `org/` root or `resources/` folder is not an error — a team may have no documents.

`readResourcesDirectory` throws only when `root` itself cannot be read or is a symlink. Everything
else lands in `errors`, one entry per thing that should have produced a document and did not. Each
entry is `{ kind, path, error }`, keyed by a path relative to the root, with `kind` naming the
condition (see [Error Semantics](#error-semantics)):

```ts
errors;
// [{ kind: "folder-where-file-belongs",
//    path: "teams/marketing/resources/handbook",
//    error: Error('"handbook" is a directory. A resource is a file, not a folder — write
//                  the document as "handbook.md" in this resources/ folder instead.') }]
```

`resourcesFromDocs` throws instead of collecting, because a record that cannot become a resource is a
startup misconfiguration.

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

Pass `orgId` alongside it. It is the org each channel session is opened under, and resources
stored at org scope resolve inside it. File-declared documents are all org-scoped, so a channel
opened without an org cannot read one. The argument decides the org only on an app that has not
configured [authentication](https://flow-state.dev/docs/server/authentication); where a
`resolvePrincipal` is in place, each session takes the org of the verified caller, so open your
channels as a caller whose identity already carries the org you want. Re-opening cannot move a
session between orgs. If you pass an `orgId` and a channel at that id is already open under a
different org, or under none, `openChannels` names that channel and stops; delete that session so
the next run opens the channel fresh, or drop the `orgId`.

A record declares four keys and no others: `flow` (which kind, optional), `description`, `members`,
and `instructions` (or a body, which is the same setting). The list is closed and checked at
`channelInstances`: an undeclared key, an `id:`, a `system:`, or a body alongside `instructions:`
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
| `declared` | The frontmatter exactly as written. A `CHANNEL.md` must set `description`, and cannot set `system:`; either one fails at load. The rest of what a channel may declare (`flow`, `members`, `instructions`) is checked when you call `channelInstances`, so a misspelled key loads without complaint and refuses at registration. |
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

### What a transcript proves

A session is bound to one user, so **every line of a given channel carries the same `principal`**,
the server-derived identity the post ran under. The optional `author` is a label the poster supplied,
stored beside `authorVerified: false`, and it is the only thing distinguishing participants. The
members check on `author` is a validity check against the declared roster, not authentication. Build
an audit or approval flow on this and you get a far weaker guarantee than the field names suggest.

### Waking members

`defineChannelFlow({ notify })` takes a block run once per declared member per post. It runs in its
own request, outside the post's turn, so a slow delivery never delays the next post. A delivery that
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
does nothing, which also means an edited record does not reach it. Re-opening is not a migration.
It does repair a channel whose id was claimed before it was opened — a post that arrives first
leaves an empty session there, and re-running binds it.

## The live inventory

The tree tells you what a workforce is meant to be. A `WORKER.md` declares a seat, a `CHANNEL.md`
declares a channel, and both are read once at boot. Neither answers what is open right now, or which
channels a given seat is in, and a block cannot walk folders to find out.

The inventory holds those answers as data: three org-scoped resource collections, one row per seat,
one row per open channel, and one row per seat-in-channel. They are ordinary collections, so a block
reads them the way it reads any other resource.

**Nothing in the framework writes these rows yet.** Install the collections and your app is their
only writer.

| Factory | One row per | Fields |
|---------|-------------|--------|
| `defineSeatInventoryCollection()` | registered seat, at `inventory/seats/<seatId>` | `id`, `kind` (the worker kind the seat was hired into) |
| `defineChannelInventoryCollection()` | open channel, at `inventory/channels/<channelId>` | `id`, `kind` (the channel kind that opened it), `members` (seat ids, `[]` when absent), `openedAt` (ISO string, or `null` when absent) |
| `defineMembershipIndexCollection()` | seat-in-channel, at `inventory/members/<seatId>/<channelId>` | `seatId`, `channelId` |

Each factory takes no options. Install what it returns under any block's `resources` map:

```ts
import { handler } from "@flow-state-dev/core";
import {
  defineChannelInventoryCollection,
  defineMembershipIndexCollection,
  defineSeatInventoryCollection,
  membershipKey,
} from "@flow-state-dev/workforce";
import { z } from "zod";

const seats = defineSeatInventoryCollection();
const channels = defineChannelInventoryCollection();
const memberships = defineMembershipIndexCollection();

const recordChannelOpened = handler({
  name: "record-channel-opened",
  inputSchema: z.object({ channelId: z.string(), members: z.array(z.string()) }),
  outputSchema: z.object({ memberCount: z.number() }),
  resources: { seats, channels, memberships },
  execute: async (input, ctx) => {
    await ctx.resources.channels.upsert(input.channelId, {
      id: input.channelId,
      kind: "channel",
      members: input.members,
      openedAt: new Date().toISOString(),
    });

    for (const seatId of input.members) {
      await ctx.resources.seats.upsert(seatId, { id: seatId, kind: "agent" });
      await ctx.resources.memberships.upsert(membershipKey(seatId, input.channelId), {
        seatId,
        channelId: input.channelId,
      });
    }

    return { memberCount: input.members.length };
  },
});
```

Keys are relative to each collection's own prefix, so `upsert("engineering.lead", row)` on the seat
inventory lands at `inventory/seats/engineering.lead`. `list()` hands back resource refs, and the row
itself is on `ref.state`. The membership index takes a two-segment key, which is what `membershipKey`
builds above; the next section covers it.

A row joins back to the declared record on the id and nothing else. The `id` on a seat row is the
`id` the `WORKER.md` folder minted, and the `id` on a channel row is the `"<teamId>.<channelName>"`
that is also the channel's session id.

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
| `createWorkforceCapability(opts)` | Optional capability for DevTool surfacing. |
| `readWorkforce(root)` | Read the tree into records that already carry their own skills — `readWorkforceDirectory` joined with `readSeatSkills` per seat. What most apps want. Ships from the `./loader` subpath (Node only). |
| `readWorkforceDirectory(root)` | Read a `teams/<id>/workers/<name>/` tree into one `WorkerManifest` per worker, without their skills. Ships from the `./loader` subpath (Node only). |
| `readSeatSkills(root, { team, worker })` | Read one worker's skills across the org, team and worker levels into `InitialSkill[]`. Ships from the `./loader` subpath (Node only). |
| `openRoot(root)` / `walkTeams(root, report)` | The walk every reader above shares: open the configured root (throwing on a symlinked or unreadable one, with or without a trailing separator, and on one spelled with a `..` that steps back through an earlier segment — pass the path it resolves to; a `.` segment and anything above the root are not checked), then enumerate `teams/`, reporting a team folder that is refused or unreadable and yielding the rest. `report` may be `async` and is awaited before the walk moves on. What a reader does *inside* a team stays its own. Ships from the `./loader` subpath (Node only). |
| `classify(path)` / `openStructuralDirectory(path, reportAs)` | One path's kind without following symlinks, and one structural folder's entries — or the reason the walk stops there, or neither when it is simply absent. Ships from the `./loader` subpath (Node only). |
| `refusedSymlink(what, name)` / `unreadable(what, name, cause)` / `IGNORED_ENTRIES` | The one wording for each refusal, and the one set of names that never denote anything in the tree — a `ReadonlySet` that cannot be written to, since every reader in the process reads it. Ships from the `./loader` subpath (Node only). |
| `validateSegment(segment, label)` | The one rule for what a name in this tree may be — lowercase letters, digits and single hyphens, under 64 characters, not reserved. Throws naming the segment and what it would have become. Ships from the `./loader` subpath (Node only). |
| `discoverWorkforceCode(root)` | Walk `flows/workers/`, `flows/channels/` and `blocks/` one level deep, and every `resources/` folder the convention reads, returning what they hold on `files` and `resourceModules`, each ordered by path. Reads the tree only — it opens none of the modules it finds. Throws a `WorkforceCodeError` carrying every refusal. Ships from the `./codegen` subpath (Node only). |
| `renderWorkforceCode(files, modules)` | Render a discovery's `files` and its `resourceModules` as a module of static imports exporting `kinds`, `channelKinds`, `blocks` and `resourceModules`. Deterministic: the same tree renders the same bytes. `fsdev gen` is a thin command over this and the call above. Ships from the `./codegen` subpath. |
| `hireWorkforce(manifests, { kinds, seatBlocks })` | Turn worker records into one configured flow copy each, ordered by id. Pass `defineFlow(...)` results directly as `kinds`, and `workforce.gen.ts`'s `seatBlocks` export as `seatBlocks`. |
| `workerConfigSchema()` | The admission contract every hireable worker kind composes: `configSchema: workerConfigSchema().extend({ ...its own settings })`. Declares `instructions?`, `teamInstructions?`, `seatSkills` and `seatTools`. A kind whose schema cannot take what hiring imposes refuses the whole roster at startup. A fresh schema per call. |
| `seatSkillSchema` | One skill as it rides into the bag — `{ name, skillMd, files? }`, closed. The shape `seatSkills` is an array of; reach for it when declaring your own variant of that key. |
| `WorkerConfig` | The parsed shape of `workerConfigSchema()` — what every hireable kind receives, whatever else it extends on. |
| `readResourcesDirectory(root)` | Read every `resources/` folder in the tree — org, team, and each worker's own — into one `ResourceDoc` per document. Ships from the `./loader` subpath (Node only). |
| `resourcesFromDocs(documents)` | Turn document records into the flow resource map, keyed by each document's ref. Spread it into your own `resources`. |
| `splitResourceModules(resourceModules)` | Split the generated map into `{ capabilities, resources }` — the capabilities a worker kind installs through `uses`, and the resources that merge into the one resource map. Installs nothing: you pass both on, at your own call site. Throws naming the ref when an entry can be neither. |
| `WorkerManifest` | One worker record: `{ id, declared, body, skills? }`. |
| `ResourceDoc` | One document record: `{ ref, declared, body }`. |
| `mintResourceRef(teamId, workerName, name)` | The one rule that names a resource, whichever door read it — the ref a document or a module called `name` in that folder gets. Throws naming the segment that breaks the rules. Ships from the `./loader` subpath (Node only). |
| `ResourceModules` | The generated `resourceModules` map: one entry per discovered module, keyed by its ref. |
| `ResourceModuleExport` / `WorkerResourceModuleExport` | What a module in the organisation's or a team's `resources/` folder may be — a capability or a resource — and the narrower type a worker's own folder is held to: a resource, never a capability. |
| `SeatCapabilitySelection` | What a worker file's `capabilities:` key parses to — capability name to the presets that seat wants. Read by the built-in `agent` kind; validated at the hire. |
| `defineChannelFlow(options?)` | Build a channel kind. `options.notify` is the per-member fan-out block. |
| `channelFlow` | The built-in channel kind, seeded by `channelInstances` when you register none. |
| `channelInstances(manifests, { kinds? })` | Build time. One `FlowInstance` per distinct kind across the roster, the built-in seeded. Register these. |
| `openChannels(manifests, { client, userId, orgId? })` | Runtime. One named session per record, carrying its members, charter and description, opened under `orgId` when one is given. Idempotent. |
| `readChannelsDirectory(root)` | Read a `teams/<id>/channels/<name>/` tree into one `ChannelManifest` per channel. Ships from the `./loader` subpath (Node only). |
| `ChannelManifest` | One channel record: `{ id, declared, body }`. |
| `ChannelPostRefusedError` | A post refused on the channel's own terms; `reason` is `channel-not-bound` or `author-not-a-member`. |
| `channelPostInputSchema` / `channelReadOutputSchema` / `channelNotifyInputSchema` | The post, read and notify contracts. |
| `channelSessionStateSchema` / `channelTranscriptLineSchema` | A channel session's state, and one transcript line. |
| `defineSeatInventoryCollection()` | The seat inventory: one org-scoped row per registered seat, at `inventory/seats/<seatId>`. Takes no options; install what it returns under a block's `resources`. |
| `defineChannelInventoryCollection()` | The channel inventory: one org-scoped row per open channel, at `inventory/channels/<channelId>`, carrying the channel's `members` and `openedAt`. Takes no options. |
| `defineMembershipIndexCollection()` | The membership index: one org-scoped row per seat-in-channel, at `inventory/members/<seatId>/<channelId>`, so one seat's channels can be listed by prefix. Takes no options. |
| `membershipKey(seatId, channelId)` | The membership index key for one row, relative to the collection's prefix. Throws when either id is not one whole path segment. |
| `membershipPrefix(seatId)` | The prefix that lists one seat's memberships, trailing slash included, relative to the collection's prefix. Refuses the same ids `membershipKey` does. |
| `SeatInventoryRow` / `ChannelInventoryRow` / `MembershipIndexRow` | One row of each of the three collections. |
| `seatInventoryRowSchema` / `channelInventoryRowSchema` / `membershipIndexRowSchema` | The Zod schema behind each row type. Closed: an undeclared key is dropped on the way in. |

## Error Semantics

| Error | When |
|-------|------|
| Duplicate agent name | `createWorkforceCapability` construction |
| Worker folder unreadable | Collected in `readWorkforceDirectory`'s `errors`, keyed by the folder's path — never thrown |
| Workforce root unreadable or symlinked | `readWorkforceDirectory` and `readWorkforce` throw — the root is never followed through a link |
| One seat's skills failed to load | Collected in `readWorkforce`'s `skillErrors`, one entry per affected seat, each carrying that seat's id and `readSeatSkills`' own error list |
| Bad `team` or `worker` name | `readSeatSkills` throws |
| Skills root unreadable or symlinked | `readSeatSkills` throws — the root is never followed through a link |
| Skills level unreadable | Collected in `readSeatSkills`'s `errors` as `kind: "unlistable-level"`, keyed by the level's path — an absent level is empty instead |
| Skill folder fails to load | Collected in `readSeatSkills`'s `errors` as `kind: "skill-load-failed"`, keyed by `<level>/<folder>` |
| Symlinked folder on the way to a level | Collected in `readSeatSkills`'s `errors` as `kind: "refused-symlinked-ancestor"`, keyed by that folder's path — never followed |
| Symlinked `skills/` folder at a level | Collected in `readSeatSkills`'s `errors` as `kind: "refused-symlinked-level"`, keyed by the level's path — never followed |
| One skill name at more than one of a seat's levels | Collected in `readSeatSkills`'s `errors` as `kind: "duplicate-skill-name"`, keyed by the level the name was first seen at, with every colliding path on the entry's `paths`; the name is left out of `skills` |
| `scope:` in a `SKILL.md` | Collected in `readSeatSkills`'s `errors` as `kind: "refused-scope-key"`, keyed by the skill's path |
| Worker cannot be hired | `hireWorkforce` — an empty or whitespace-only `flow`, an unknown kind, a flow passed under a key that is not its own kind, a duplicate id, a setting or body the flow never declared, a `tools:` name nothing registers for that seat, a registered block whose key and own `name` disagree, a block in a worker's own folder that declares a resource or `requireOrg`, a skill name reaching one seat from both the app's `skills` and its own folders, `instructions` given both in the frontmatter and as a body, a flow kind whose schema will not take what hiring imposes (composing `workerConfigSchema()` is the fix), or a `persona:`, `seatSkills:`, `seatTools:` or `teamInstructions:` key. Collected: one error names every bad worker |
| A `resources/` slot, `org/`, `teams/`, a team folder, a `workers/` level or a worker folder unreadable or symlinked | Collected in `readResourcesDirectory`'s `errors` as `kind: "unreadable-slot"`, keyed by that folder's path — an absent folder is empty instead |
| A directory where a document file belongs | Collected in `readResourcesDirectory`'s `errors` as `kind: "folder-where-file-belongs"`, keyed by the directory's path |
| Document file fails to load | Collected in `readResourcesDirectory`'s `errors` as `kind: "document-load-failed"`, keyed by the file's path — an unusable name, a symlink, an unreadable file, no frontmatter, or a missing `description` |
| A setting the convention derives, or `prefetchMode: "lazy"`, in a document file | Collected in `readResourcesDirectory`'s `errors` as `kind: "refused-declaration"`, keyed by the file's path |
| Workforce root unreadable or symlinked, read for documents | `readResourcesDirectory` throws — the root is never followed through a link |
| Document cannot become a resource | `resourcesFromDocs` throws naming the ref — a setting the convention derives, a lazy `prefetchMode`, or frontmatter `defineResource` itself rejects |
| A `channels/` slot, `teams/` or a team folder unreadable or symlinked | Collected in `readChannelsDirectory`'s `errors` as `kind: "unreadable-slot"`, keyed by that folder's path — an absent folder is empty instead |
| Channel folder fails to load | Collected in `readChannelsDirectory`'s `errors` as `kind: "channel-load-failed"`, keyed by the folder's path — an unusable name, a symlink, or a missing, unreadable or malformed `CHANNEL.md` |
| `system:` in a `CHANNEL.md` | Collected in `readChannelsDirectory`'s `errors` as `kind: "refused-declaration"`, keyed by the channel folder's path |
| Workforce root unreadable or symlinked, read for channels | `readChannelsDirectory` throws — the root is never followed through a link |
| Channel cannot be bound | `channelInstances` — a `flow:` naming a kind nobody passed, a kind filed under another kind's key, a duplicate id, an `id:`, a `system:`, an undeclared key, a `members:` that is not a list of names, or `instructions:` given both in the frontmatter and as a body. Collected: one error names every bad channel, and nothing is registered |
| Channel cannot be opened | `openChannels` throws, naming the channel — except a 409, which means the id is taken. An open channel there is left alone, and this kind's own empty session is bound. Anything else holding the id — another flow's session, another user's, or one carrying state that is not a readable channel — is named and refused rather than released |
| `channel-not-bound` | A `post` or `read` naming a session nobody opened. Per-request; nothing is written and the session stays inert |
| `author-not-a-member` | A `post` claiming an `author` outside the channel's declared members. Per-request; nothing is written |
| `external-dispatcher` | A flow-to-flow post on a host whose dispatcher hands work to an external queue. The public action route is unaffected |
| Inventory id is not one path segment | `membershipKey` and `membershipPrefix` throw, naming the offending argument: an empty id, one containing `/` or `\`, or `.` and `..` |

## Scripts

```bash
pnpm --filter @flow-state-dev/workforce build
pnpm --filter @flow-state-dev/workforce typecheck
pnpm --filter @flow-state-dev/workforce test
```
