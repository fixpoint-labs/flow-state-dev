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
one record per worker.

```ts
import { readWorkforceDirectory } from "@flow-state-dev/workforce/loader";

const { workers, errors } = await readWorkforceDirectory("./workforce");
if (errors.length) throw new Error(`workforce: ${errors.length} worker(s) failed to load`);
```

Each record is plain data:

| Field | Description |
|-------|-------------|
| `id` | The worker's whole identity, `"<teamId>.<workerName>"` — e.g. `"engineering.lead"`. |
| `declared` | The frontmatter exactly as written. Keys are not checked against a list, beyond a required `description` and three refused ones: `persona:`, `seatSkills:` and `teamInstructions:`. |
| `body` | The Markdown below the frontmatter, verbatim. Empty when the worker has no instructions. |

`description` is the only required setting in a `WORKER.md`. Team and worker folder names must be
lowercase letters, digits and single hyphens, at most 64 characters.

The reader builds nothing: no flow, no agent, no registry entry. It throws only when `root` itself
cannot be read — a folder that produces no worker lands in `errors`, keyed by its path, and every
other worker still loads. Treat a non-empty `errors` as fatal at startup unless you have a reason
to run a short roster.

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
`Failed to read workforce directory "./workforce": ENOENT ...`.

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
`workerConfigSchema()`, which declares the three settings a seat's bag may carry:

| Setting | What it holds |
| --- | --- |
| `instructions?` | The worker's own instructions — its file body, or the frontmatter key. Imposed when the body is not empty, absent when it has none. |
| `teamInstructions?` | **Reserved: nothing populates it yet.** It is here so a kind composes the contract once and does not change again when the team-level layer arrives. Always absent today. |
| `seatSkills` | The skills its folders resolved for it, in level order. Imposed on every seat, present and empty when there are none. |

So hiring imposes two of the three today. The third is a declared door with nothing coming through
it, and a kind that reads it gets `undefined` regardless of what any team has written.

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

`desk` sits at the top level beside the three, where the schema closes it: a worker file that writes
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

Two of the three are never authored. A worker file that writes `seatSkills:` or `teamInstructions:`
is refused by name, at the loader and at the hire: a seat's skills are the folders it can see, and
a team's instructions are its team's.

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
| `uses` | Capabilities attached to every worker's answer generator. The skills binding stays first and is never displaced. A capability passed as a plain ref brings its own storage with it; one passed as a `(ctx) => refs` resolver contributes context and tools only, and its storage has to be declared statically somewhere. |
| `afterAnswer` | A block run after the answer as a side-chain. It receives the reply text as a string, it cannot change the answer, and a failure in it does not fail the turn. Absent, nothing runs after the answer. |
| `isolateUserState` | Forwarded to `defineFlow`. Gives each worker its own user-scoped storage, keyed on the worker's id, instead of one cell shared across the roster. Default `false`. |

**The tools fence.** A worker's `tools:` decides which of the app's catalog tools it can call, and
the generator's own `tools:` mapping is the only path a catalog tool takes onto a worker. A skill
does not widen it: a skill's `allowed-tools` are validated against the catalog but never
registered, and a skill's delegated workers are seated from the holding worker's own list.

Two tools reach a worker without appearing in `tools:`, and neither is a catalog tool:

- the **skill loader**, when a worker sets `skills.activateTool: true` — it pulls a skill the worker
  already holds into the turn;
- any tool a **capability** carries, when the kind is built with `uses`. Those reach every worker of
  the kind whatever its `tools:` names, so turn tool-bearing presets off unless you want them on the
  whole roster.

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
      recall: false,    // a tool — off, per the fence above
      connect: false,   // a tool — off
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
- **`semantic` and `episodic` on.** They are off by default, and with `recall` off as well the
  durable stores would be written and never read back.
- **`recall` and `connect` off.** They are memory's tool-bearing presets, so left on they reach every
  worker of the kind whatever its `tools:` names. A worker that wants on-demand search gets the
  recall tool through the app's own catalog, where it opts in by name.

Isolation is a decision for the whole kind: a roster is all-isolated or all-shared.

`isolateUserState` decides **where** a worker's user-scoped data is keyed, so anything that
changes the key leaves the old data behind. Two ways that happens, both with no migration:
**renaming a worker** (the key is its id), and **flipping the flag on a roster already in use**
(shared and isolated are different cells). Decide it before the roster carries anything worth
keeping.

Every problem is a startup misconfiguration: problems are collected and thrown as one error naming
every bad worker, and nothing is returned, so a bad record cannot leave a half-hired roster.

## Reading documents from files

A team's shared documents — a handbook, a glossary, an escalation procedure — can be Markdown files
instead of `defineResource` stanzas. Frontmatter is settings and the body is the document, the same
bargain `WORKER.md` makes.

**A resource is a file, not a folder.** A document is `<name>.md` directly in `resources/`, unlike
a worker or a skill, which is a folder with a fixed file inside it. A directory in a `resources/`
slot lands in `errors` rather than being passed over.

Two levels are read:

| Path | Ref |
|------|-----|
| `<root>/org/resources/<name>.md` | `<name>` |
| `<root>/teams/<teamId>/resources/<name>.md` | `teams/<teamId>/<name>` |

```md
---
description: How the engineering team works — on-call, review, escalation.
llmReadable: true
---

# Engineering handbook

Escalate anything customer-visible within 15 minutes.
```

`readResourcesDirectory` walks both roots and returns one record per document; `resourcesFromDocs`
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
| `ref` | The document's identity and storage key — a bare name at the org level, `teams/<teamId>/<name>` for a team's. It is also the accessor key, so a team's handbook is `ctx.resources["teams/engineering/handbook"]`. |
| `declared` | The frontmatter exactly as written. A file that declares one of the refused settings below produces no record at all, so nothing is stripped here. |
| `body` | The Markdown below the frontmatter, verbatim. It becomes the resource's content. |

**Merge the map yourself.** A flow copy created with `supportFlow({ resources })` *replaces* the
definition's map rather than merging with it, so passing `resourcesFromDocs(documents)` there on its
own drops whatever resources the flow kind declared. Spread it into your own map, as above.

**The team folder is a namespace, not a visibility boundary.** Every file-declared document is
org-scoped, and a flow's resource tools reach every installed document marked `llmReadable` with no
per-team filter. Installing a whole tree on one flow makes every team's documents reachable from it.
To give a team's seats only its own, filter the records before installing:

```ts
const engineering = resourcesFromDocs(
  documents.filter((d) => d.ref.startsWith("teams/engineering/")),
);
```

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

Document and team folder names follow the same rules as worker folders: lowercase letters, digits and
single hyphens, at most 64 characters. A non-`.md` file in the slot is passed over in silence. An
absent `org/` root or `resources/` folder is not an error — a team may have no documents.

`readResourcesDirectory` throws only when `root` itself cannot be read. Everything else lands in
`errors`, one entry per thing that should have produced a document and did not. Each entry is
`{ kind, path, error }`, keyed by a path relative to the root, with `kind` naming the condition (see
[Error Semantics](#error-semantics)):

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
| `openRoot(root)` / `walkTeams(root, report)` | The walk every reader above shares: open the configured root (throwing on a symlinked or unreadable one, however the path is spelled), then enumerate `teams/`, reporting a team folder that is refused or unreadable and yielding the rest. `report` may be `async` and is awaited before the walk moves on. What a reader does *inside* a team stays its own. Ships from the `./loader` subpath (Node only). |
| `classify(path)` / `openStructuralDirectory(path, reportAs)` | One path's kind without following symlinks, and one structural folder's entries — or the reason the walk stops there, or neither when it is simply absent. Ships from the `./loader` subpath (Node only). |
| `refusedSymlink(what, name)` / `unreadable(what, name, cause)` / `IGNORED_ENTRIES` | The one wording for each refusal, and the one set of names that never denote anything in the tree — a `ReadonlySet` that cannot be written to, since every reader in the process reads it. Ships from the `./loader` subpath (Node only). |
| `hireWorkforce(manifests, { kinds })` | Turn worker records into one configured flow copy each, ordered by id. Pass `defineFlow(...)` results directly as `kinds`. |
| `workerConfigSchema()` | The admission contract every hireable worker kind composes: `configSchema: workerConfigSchema().extend({ ...its own settings })`. Declares `instructions?`, `teamInstructions?` (reserved) and `seatSkills`. A kind whose schema cannot take what hiring imposes refuses the whole roster at startup. A fresh schema per call. |
| `seatSkillSchema` | One skill as it rides into the bag — `{ name, skillMd, files? }`, closed. The shape `seatSkills` is an array of; reach for it when declaring your own variant of that key. |
| `WorkerConfig` | The parsed shape of `workerConfigSchema()` — what every hireable kind receives, whatever else it extends on. |
| `readResourcesDirectory(root)` | Read `org/resources/` and `teams/<id>/resources/` into one `ResourceDoc` per document. Ships from the `./loader` subpath (Node only). |
| `resourcesFromDocs(documents)` | Turn document records into the flow resource map, keyed by each document's ref. Spread it into your own `resources`. |
| `WorkerManifest` | One worker record: `{ id, declared, body, skills? }`. |
| `ResourceDoc` | One document record: `{ ref, declared, body }`. |
| `defineChannelFlow(options?)` | Build a channel kind. `options.notify` is the per-member fan-out block. |
| `channelFlow` | The built-in channel kind, seeded by `channelInstances` when you register none. |
| `channelInstances(manifests, { kinds? })` | Build time. One `FlowInstance` per distinct kind across the roster, the built-in seeded. Register these. |
| `openChannels(manifests, { client, userId })` | Runtime. One named session per record, carrying its members, charter and description. Idempotent. |
| `readChannelsDirectory(root)` | Read a `teams/<id>/channels/<name>/` tree into one `ChannelManifest` per channel. Ships from the `./loader` subpath (Node only). |
| `ChannelManifest` | One channel record: `{ id, declared, body }`. |
| `ChannelPostRefusedError` | A post refused on the channel's own terms; `reason` is `channel-not-bound` or `author-not-a-member`. |
| `channelPostInputSchema` / `channelReadOutputSchema` / `channelNotifyInputSchema` | The post, read and notify contracts. |
| `channelSessionStateSchema` / `channelTranscriptLineSchema` | A channel session's state, and one transcript line. |

## Error Semantics

| Error | When |
|-------|------|
| Duplicate agent name | `createWorkforceCapability` construction |
| Worker folder unreadable | Collected in `readWorkforceDirectory`'s `errors`, keyed by the folder's path — never thrown |
| Workforce root unreadable | `readWorkforceDirectory` and `readWorkforce` throw |
| One seat's skills failed to load | Collected in `readWorkforce`'s `skillErrors`, one entry per affected seat, each carrying that seat's id and `readSeatSkills`' own error list |
| Bad `team` or `worker` name | `readSeatSkills` throws |
| Skills root unreadable | `readSeatSkills` throws |
| Skills level unreadable | Collected in `readSeatSkills`'s `errors` as `kind: "unlistable-level"`, keyed by the level's path — an absent level is empty instead |
| Skill folder fails to load | Collected in `readSeatSkills`'s `errors` as `kind: "skill-load-failed"`, keyed by `<level>/<folder>` |
| Symlinked folder on the way to a level | Collected in `readSeatSkills`'s `errors` as `kind: "refused-symlinked-ancestor"`, keyed by that folder's path — never followed |
| Symlinked `skills/` folder at a level | Collected in `readSeatSkills`'s `errors` as `kind: "refused-symlinked-level"`, keyed by the level's path — never followed |
| One skill name at more than one of a seat's levels | Collected in `readSeatSkills`'s `errors` as `kind: "duplicate-skill-name"`, keyed by the level the name was first seen at, with every colliding path on the entry's `paths`; the name is left out of `skills` |
| `scope:` in a `SKILL.md` | Collected in `readSeatSkills`'s `errors` as `kind: "refused-scope-key"`, keyed by the skill's path |
| Worker cannot be hired | `hireWorkforce` — an empty or whitespace-only `flow`, an unknown kind, a flow passed under a key that is not its own kind, a duplicate id, a setting or body the flow never declared, a `tools:` name the built-in's catalog does not carry, a skill name reaching one seat from both the app's `skills` and its own folders, `instructions` given both in the frontmatter and as a body, a flow kind that has not composed `workerConfigSchema()`, or a `persona:`, `seatSkills:` or `teamInstructions:` key. Collected: one error names every bad worker |
| A `resources/` slot, `org/`, `teams/` or a team folder unreadable or symlinked | Collected in `readResourcesDirectory`'s `errors` as `kind: "unreadable-slot"`, keyed by that folder's path — an absent folder is empty instead |
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

## Scripts

```bash
pnpm --filter @flow-state-dev/workforce build
pnpm --filter @flow-state-dev/workforce typecheck
pnpm --filter @flow-state-dev/workforce test
```
