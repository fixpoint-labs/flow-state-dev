# @flow-state-dev/workforce

The seat factory for flow-state-dev.

A **worker** is a configuration plus an owner, run by one shared copy of the flow it names. Describe
each standard worker as a `WORKER.md` record; every user has those. Users hire or fork workers of
their own while the app runs, as rows in their own data. `createWorkerInstallation` holds both, and
`hireWorkforce` gives back the flows to register: one copy of each worker flow, and the roster flow.

## Quick Start

Describe the roster on disk, read it, build the installation, register what comes back.

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

`readDeclaredRoster` reads that tree — every worker, team, document and mailbox declared in it —
and lists whatever failed to load on `problems`.

```ts
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";
import { createWorkerInstallation, hireWorkforce } from "@flow-state-dev/workforce";

const roster = await readDeclaredRoster("./workforce");
if (roster.problems.length) {
  throw new Error(`workforce: ${roster.problems.map((p) => `${p.layer} ${p.path}`).join(", ")}`);
}

const installation = createWorkerInstallation({ standardWorkers: roster.workers });
const flows = hireWorkforce(installation);
flowRegistry.registerMany(flows); // ["agent", "workforce-roster"]
```

That record names no `flow:`, so it runs on the built-in `agent` flow and needs no `workerFlows`
option. Its body becomes its instructions and steers its answers. Every worker on `agent` shares
its one copy; a session names its worker when it is created, and each turn loads it.

The built-in keeps each worker's skills apart, per user, so two workers never share skills and
two people never share one worker's.

To talk to it, find or start a session with the worker, then send to the flow it names:

```ts
import { createClient } from "@flow-state-dev/client";
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";

const workforce = createWorkforceClient({ userId, baseUrl });
const session = await workforce.ensureWorkerSession({ worker: "engineering.lead" });
await createClient({ flowKind: session.flowKind, userId, baseUrl }).sendAction("run", { message }, { sessionId: session.id });
```

To run a worker on a flow you wrote, name that flow's `kind` in the record's `flow:` and pass the
flow under the same key. A worker flow is built on the installation, so a flow in its own module
exports a `workerFlow(...)` builder:

```ts
const installation = createWorkerInstallation({
  standardWorkers: workers,
  workerFlows: { "custom-agent": customAgentFlow }, // workerFlow((installation) => defineFlow({ ... }))
});
```

The record's frontmatter becomes that worker's configuration, parsed by the flow's `configSchema`,
and its body arrives as `instructions`, so the flow — not this package — decides what a worker may
declare. A turn reads it from `installation.resolveWorker(ctx, kind).config`. One roster can mix
both. [Workers as data](#workers-as-data) has the whole contract.

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
`<root>/org/workers/<workerName>/` and `<root>/teams/<teamId>/workers/<workerName>/`, reads each
worker's `WORKER.md`, and returns one record per worker. `readWorkforce` wraps it, joining each seat's resolved skills, its
team's instructions and the [packages](#packages-from-files) in its reach onto the records it hands back.
An org seat has no team, so its record carries no `teamInstructions`, and its skills come from two
levels, the org's and its own.

```ts
import { readWorkforceDirectory } from "@flow-state-dev/workforce/loader";

const { workers, errors } = await readWorkforceDirectory("./workforce");
if (errors.length) throw new Error(`workforce: ${errors.length} worker(s) failed to load`);
```

Each record is plain data:

| Field | Description |
|-------|-------------|
| `id` | The worker's whole identity, `"<teamId>.<workerName>"` — e.g. `"engineering.lead"`. An org seat's id is its folder name alone, with no dot: `org/workers/chief-of-staff/` is `"chief-of-staff"`, a different seat from `"engineering.chief-of-staff"`. `parseDeclaredSeatId` reads either shape back. |
| `declared` | The frontmatter exactly as written. Keys are not checked against a list, beyond a required `description` and six refused ones: `persona:`, `seatSkills:`, `seatTools:`, `seatPackages:`, `seatId:` and `teamInstructions:`. |
| `body` | The Markdown below the frontmatter, verbatim. Empty when the worker has no instructions. |

`description` is the only required setting in a `WORKER.md`. Team and worker folder names must be
lowercase letters, digits and single hyphens, at most 64 characters.

An org seat, under `org/workers/<name>/`, is one seat the whole organization shares rather
than a member of a team. Its folder is a worker slot like a team's, so one with no `WORKER.md` is
reported in `errors`. An org seat reads the org's skills, packages and references, then its own folder's;
no team level reaches it, and no `TEAM.md` instructions.

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

The subpath is separate because the reader imports `node:fs`. The package root is server-only too:
it reaches Node built-ins through the packages it builds on. A browser component imports from
[`./browser`](#importing-from-a-browser-component).

## Reading one seat's skills

A skill is a folder with a `SKILL.md` in it. In a workforce tree, a team seat's skills are spread
across three folders: the org's, its team's, and any sitting beside the worker itself. An org seat (`org/workers/<worker>/`) has no team, so it reads two: the org's `org/skills/` and its own `org/workers/<worker>/skills/`.

```
workforce/org/skills/triage/SKILL.md
workforce/teams/pentest/skills/port-scan/SKILL.md
workforce/teams/pentest/skills/review/SKILL.md
workforce/teams/audit/skills/review/SKILL.md            # a different `review`
workforce/teams/pentest/workers/recon/WORKER.md
workforce/teams/pentest/workers/recon/skills/sweep/SKILL.md
```

`readSeatSkills` reads them for one worker and returns the records `initialSkills` takes. Pass `team`
for a team seat; leave it out for an org seat.

```ts
import { readSeatSkills } from "@flow-state-dev/workforce/loader";

const { skills, errors } = await readSeatSkills("./workforce", {
  team: "pentest",
  worker: "recon",
});
if (errors.length) throw new Error(`skills: ${errors.length} entries failed to load`);

skills.map((s) => s.name).sort(); // ["port-scan", "review", "sweep", "triage"]
```

Every skill folder at those levels is read. Nothing has to be listed anywhere for a skill
to be included.

The set comes back level by level: the org's first, then the team's (for a team seat), then the worker's own. Each
entry is `{ name, skillMd, files }`, the same record `readSkillsDirectory` returns — `name` is the
folder name, bare, with no team prefix.

Two calls naming different teams read different folders. Each result holds only what its own
call read:

```ts
const recon = await readSeatSkills("./workforce", { team: "pentest", worker: "recon" });
const clerk = await readSeatSkills("./workforce", { team: "audit", worker: "clerk" });
// recon.skills has pentest's `review`; clerk.skills has audit's. Neither carries the other.
```

One name reaching a single worker from more than one of its levels is refused. Every level
counts, so on a team seat a collision can span two of them or all three:

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
const flows = hireWorkforce(createWorkerInstallation({ standardWorkers: roster.workers }));
```

| Field | What it holds |
|-------|---------------|
| `workers` | One `WorkerManifest` per worker, each carrying its own resolved skills. The standard workers `createWorkerInstallation` takes. |
| `teams` | One `TeamManifest` per team that wrote a [`TEAM.md`](#the-optional-team-file). A team without one is absent, not present-and-empty. |
| `documents` | One `ResourceDoc` per [document](#reading-documents-from-files), from every `resources/` folder the convention reads. |
| `references` | One `ResourceDoc` per [reference](#reading-documents-from-files), from every `references/` folder, each carrying the `filePath` it was read from. |
| `mailboxes` | One `MailboxManifest` per [mailbox](#declaring-mailboxes-in-files) under `teams/<id>/mailboxes/`. There is no `org/mailboxes/` level, the way there is for documents. |
| `problems` | Everything that did not load. Empty for a tree that loads cleanly. |

Each list arrives in tree order.

Each record's `skills` reaches the built-in `agent` kind as its `seatSkills` setting, imposed by
the hire step the way a body is imposed as `instructions`. A `WORKER.md` declaring `seatSkills:`
itself is refused by name at both the loader and the hire step — where a skill folder sits is
what decides who can see it.

For seats alone, without documents or mailboxes, read the worker half with
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
//  { layer: "mailbox",
//    path: "teams/qa/mailboxes/standup",
//    error: Error('MAILBOX.md in "standup/" must declare a non-empty `description`') }]
```

`layer` is one of `worker`, `skill`, `team`, `package`, `document`, `reference` or `mailbox`, and
the entries arrive in that order: worker slots, then each seat's skills, then team files, then
packages, then documents, then references, then mailboxes, and last a `reference` entry per basename claimed in both slots. `path`
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
resolves to). Everything below the root is collected, including a team, worker, mailbox or document
whose name breaks the naming rules.

## Hiring a workforce

`createWorkerInstallation` takes the standard workers and the worker flows your app defined, and
`hireWorkforce` gives back the flows to register: **one copy of each worker flow**, at the flow's own
kind, and the roster flow (`workforce-roster`). Every worker on a flow shares its one copy. A hire,
fork or fire is a write to the user's data. Every process sees it on the next turn.

```ts
import { createWorkerInstallation, hireWorkforce, type WorkerManifest } from "@flow-state-dev/workforce";

const workers: WorkerManifest[] = [
  {
    id: "engineering.lead",
    declared: { flow: "custom-agent", description: "Holds the board.", model: "openai/gpt-5.4-mini" },
    body: "You are the engineering lead. You break work into tasks and report what came back.",
  },
  { id: "engineering.intake", declared: { flow: "intake", description: "The front door." }, body: "" },
];

const installation = createWorkerInstallation({
  standardWorkers: workers,
  workerFlows: { "custom-agent": customAgentFlow, intake: intakeFlow }, // workerFlow(...) builders
});
const flows = hireWorkforce(installation);
flowRegistry.registerMany(flows); // agent, custom-agent, intake, workforce-roster
```

The installation reads three keys of its own: **`flow`**, which names the flow the worker runs on,
**`description`**, the roster label, and **[`resources`](#the-documents-a-seat-may-touch)**, the
documents this worker may touch. Everything else is that worker's settings, parsed against the
flow's `configSchema`. That schema is closed, so a setting the flow never declared is refused by
name: for a standard worker by `hireWorkforce`, before anything is registered, and for a user's
own worker when it is hired or edited.

A worker flow declares the installation's session (`session: installation.session()`), so every
session names its worker in a readonly `workerId`, checked when the session is created, and loads
that worker on every turn with `installation.resolveWorker(ctx, kind)`. `hireWorkforce` refuses a
worker flow that doesn't declare it.

A worker takes a person's message through its flow's **door**: the one public action the flow
declares with `userMessage` and a `{ message }` input. `openInventory` writes it on the worker's
[inventory row](#the-inventory) as `door`. Every worker flow has exactly one: a flow with none, or
with two, is refused when `hireWorkforce` checks its worker flows, naming the flow.

### The documents a seat may touch

A `WORKER.md` may list the [file-declared documents](#reading-documents-from-files) that worker is
allowed to reach, chosen from the ones the app declared:

```md
---
description: Holds the engineering board and breaks work into tasks.
flow: custom-agent
resources:
  - teams/engineering/handbook
  - teams/engineering/board-notes: rw
---
```

A ref on its own is read-only: the worker's model reads the document, and a write through its
resource tools is refused. `<ref>: rw` grants writes, and `<ref>: ro` spells the default out. A
document the worker isn't granted answers its model exactly as one that doesn't exist, through
core's resource tools and any tool built on them. That is the flow's `resourceVisibility` rule,
which the installation supplies: block code that names a document directly is not narrowed.

**Absent and empty are different answers.** A worker whose file has no `resources:` key reaches every
document the app passed to the installation as `documents`, on the flow's shared copy, and writes
the ones that allow writes. `resources: []` is how a file
says a worker gets none.

**Only documents are narrowed.** The stores, boards and anything else the flow declares stay
reachable and writable whatever a worker's list says.

For a ref to resolve, the installation has to be told which documents the app declared. Hand it the
map `resourcesFromDocs` returned, and declare `installation.documents` and the installation's
`resourceVisibility` on the flow:

```ts
import { defineFlow } from "@flow-state-dev/core";
import { createWorkerInstallation, resourcesFromDocs, workerConfigSchema, workerFlow } from "@flow-state-dev/workforce";
import { readResourcesDirectory } from "@flow-state-dev/workforce/loader";
import { inputSchema, loadWorker, runTurn } from "./blocks";
import { boardResource } from "./resources";

const { documents } = await readResourcesDirectory("./workforce");

const customAgentFlow = workerFlow((installation) =>
  defineFlow({
    kind: "custom-agent",
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { board: boardResource, ...installation.resources, ...installation.documents },
    resourceVisibility: installation.resourceVisibility,
    request: { onStarted: loadWorker(installation) }, // installation.resolveWorker(ctx, "custom-agent")
    actions: { run: { inputSchema, block: runTurn, userMessage: (input) => input.message } },
  }),
);

const installation = createWorkerInstallation({
  standardWorkers: workers,
  workerFlows: { "custom-agent": customAgentFlow },
  documents: resourcesFromDocs(documents),
});
```

The flow declares every document any of its workers may be granted, and the rule narrows each
turn's model to its own worker's: a turn that loaded no worker reaches no document. `board` above
is not a document, and no worker's list governs it.

`documents` is consulted only for a worker that declares `resources:`. A worker that does declare
one while `documents` is absent is refused, naming what is missing.

Every problem with a list refuses the worker, naming it: a `resources:` that is not a
list at all, an entry that is neither a ref nor a one-key `ref: mode` mapping, a ref no document
matches, a ref naming a document the app declared but did not install on this worker's flow, a mode
that is neither `ro` nor `rw`, the same ref twice, `rw` on a document whose own frontmatter says
`writable: false`, a ref colliding with a name the kind's own blocks already declare, and a ref the
kind does declare at flow level while what it holds there is not the document the app passed.

One more is checked on the worker's configuration rather than on the list: if a document the worker
did **not** name is reachable anyway — because one of the flow's blocks declares that same
document — it is refused, naming the ref and the flow. Keep such a document at flow level and let
the block reach it from there, or grant it to the worker deliberately.

`resources:` never reaches the flow's settings. It is the installation's key, like `flow` and
`description`, so a flow that declares a `resources` setting of its own does not receive one from a
file.

`references:` is the sibling key, over the documents in `references/` folders. It narrows within a
wall the tree already imposes rather than selecting from everything the kind installed, and its
entries take no mode — see [What a seat reaches](#what-a-seat-reaches).

### What a hireable kind must admit

A worker kind is an ordinary flow. What makes it *hireable* is that its `configSchema` composes
`workerConfigSchema()`, which declares the settings a seat's bag may carry:

| Setting | What it holds |
| --- | --- |
| `instructions?` | The worker's own instructions — its file body, or the frontmatter key. Imposed when the body is not empty, absent when it has none. |
| `teamInstructions?` | The instructions its team wrote — read from that team's [`TEAM.md`](#the-optional-team-file). Imposed when its team wrote any, absent when the team wrote none or has no file. Never merged with `instructions`. |
| `seatSkills` | The skills its folders resolved for it, in level order. Imposed on every seat, present and empty when there are none. |
| `seatTools` | The blocks this seat's `tools:` resolved to from its own folders and the packages it holds, already resolved. Imposed on every seat, present and empty when there are none. Live blocks, not names — names that resolved to the kind's catalog stay on the kind's own `tools` setting. |
| `seatPackages?` | The [packages](#packages-from-files) this seat holds, in the order it holds them: `{ name, path, instructions?, tools }[]`, where `tools` is the package's blocks. Imposed when the seat holds at least one, absent otherwise. |
| `seatId` | The worker's own id — the one a mailbox's `members:` lists and checks an author against. Imposed on every worker. A block reads it from the worker the turn loaded (`installation.resolveWorker(ctx, kind).config.seatId`), never from `ctx.flow.config`, which the shared copy holds once for every worker. |

So hiring imposes `instructions` when the body is not empty, `seatSkills`, `seatTools` and `seatId`
always, `teamInstructions` when the seat's team wrote a `TEAM.md`, and `seatPackages` when the seat
holds a package. A kind that reads
`teamInstructions` for a seat whose team wrote none gets `undefined` — absent, never an empty
string, which is what keeps "this team said nothing" and "this team said nothing *yet*" from being
the same value in the bag.

**One key is reserved across kinds: `tools`.** It is not part of the contract — your kind declares it or leaves it out — but if you declare it, it means the names of tools that seat may call, because the hire step reads it. (On the built-in `agent` kind, a seat with no `tools:` line can also call what its own file chose: the tools of the capability presets it selected under `capabilities:`, and the blocks of the packages it holds. A written line is the whole grant.) A name in a worker's `tools:` is resolved against what is registered for that seat (its own `blocks/` folder, then its team's, along with the blocks of the packages it holds, then your kind's catalog; an org seat has neither folder, so only the last two apply), and the ones that resolved to the seat's own folders or packages arrive on `seatTools` as live blocks instead. You decide what to check the remaining names against, and you may declare no `tools` at all. What the key is not available for is unrelated string configuration, which hiring would rewrite — give that its own name.

Add your kind's own settings on top, at the same level:

```ts
import { workerConfigSchema, workerFlow } from "@flow-state-dev/workforce";

const triage = workerFlow((installation) =>
  defineFlow({
    kind: "request-triage",
    configSchema: workerConfigSchema().extend({ desk: z.string().default("front") }),
    session: installation.session(),
    resources: { ...installation.resources },
    actions: {
      run: { inputSchema: z.object({ message: z.string() }), block: triageWork(installation), userMessage: (input) => input.message },
    },
  }),
);
```

`desk` sits at the top level beside the contract's keys, where the schema closes it: a worker file that writes
a key your kind never declared is still refused by name. If your kind genuinely holds open-ended
data, give it one declared key whose own schema is a record, rather than a nested bag of keys you
did name.

Reading any of it is optional. A kind that composes the contract and never looks at `seatSkills`
is not an error. What is not optional is that your schema can take the bag: `hireWorkforce` checks
every flow in `workerFlows`, and the built-in `agent`, before it registers anything, and a flow
whose schema refuses a key of the contract, or the value a worker supplies for one, refuses the
whole call with a message naming the flow and the fix.

What is checked is what your schema accepts, not which function built it — so a kind that declares
these keys by hand hires just the same, as long as each key takes the value a hire supplies
(`seatId` is a string). Composing is what keeps it current: when a key is added to the contract, a
composed kind picks it up, and a hand-rolled one refuses at boot naming the new key until you add
it.

The same check also requires one door, that the flow declares the installation's session, and
that any resource with `writtenBy` comes from `sharedResource()`. The door is exactly one public action that declares `userMessage` and takes
`{ message }`, so an app can talk to any worker without knowing its flow; none, or two, refuses. A
resource with a `writtenBy` field is declared with `sharedResource()`, which adds the field; one
defined by hand is refused, even with the right shape.
`workerFlowProblems(name, flow)` runs the same check without an app, for a library's own
tests. [Which flows can run workers](https://flow-state.dev/docs/workforce/workers-on-disk#which-flows-can-run-workers) has the whole contract.

Only `instructions` is ever authored. A worker file that writes `seatSkills:`, `seatTools:`,
`seatPackages:`, `seatId:` or `teamInstructions:` is refused by name, at the loader and by the installation: a seat's
skills, its own blocks and its packages are the folders it can see, its id is its record's, and a team's instructions come
from its team's `TEAM.md` body.
That last key is refused in a `TEAM.md` too — the file an author would most reasonably try it in —
so all three doors refuse it, from one exported constant rather than a literal spelled into each.

**A record that leaves `flow:` out runs on the built-in `agent` flow** — it talks, its body
arrives as its instructions, and it reads the skills its own folders hold plus any the app seeded
through `defineAgentWorkerFlow({ skills })`. It sees the earlier turns of the conversation it is
in, up to the session's history window (the last 50 by default), and nothing from any other
conversation. `workerFlows` is therefore optional. A `flow:` that is present but empty or whitespace-only
refuses, because it names no kind — only an absent key means the built-in.

A worker on `agent` is talked to through the flow's `run` action, which takes `{ message }`, in a
session that names the worker. A message that names a worker is refused: the session already does.
The message is kept as the caller's turn in that conversation, so a conversation reads as both
sides.

Configure that flow by replacing it. Build it with `defineAgentWorkerFlow({ installation, ... })`
and pass it under `agent`, with `workerFlows` as a function, since the flow is built on the
installation:
`workerFlows: () => ({ agent: defineAgentWorkerFlow({ installation, catalog, skills }) })`. It takes
over for every worker that runs on `agent` — the records that leave `flow:` out, and any that name
`agent` — and leaves a worker on any other flow alone. A flow of your own registered under `agent`
must declare `kind: "agent"`.

A worker record declares data: a description, the kind it runs, and that kind's settings. Behavior
lives in the flow the kind names, so a worker that has to do something none of your kinds do is a
flow you define in your app and pass in `workerFlows`, named by that worker's `flow:`.

A record's **`body` reaches its flow as one setting, `instructions`**. Every hireable kind declares
that setting by composing `workerConfigSchema()`, so a body always has somewhere to arrive and no
worker flow has to check for one; the instructions are available at `config.instructions`, and what
the flow does with them is the flow's business. A flow that wants instructions to be mandatory makes
the key required when it extends the contract — `workerConfigSchema().extend({ instructions:
z.string() })` — and a worker on it with no body is then refused.

A body that is empty or only whitespace contributes no `instructions` key at all; a body with content
is handed over verbatim, leading and trailing whitespace included. A record that declares
`instructions:` *and* carries a body is refused naming both sources. Whitespace is not a body, so a
record that declares `instructions:` and carries an empty or blank one runs on the frontmatter value.

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
| `isolateUserState` | Forwarded to `defineFlow`. Keys the flow's user-scoped storage by its copy, apart from the person's other flows. Every worker on `agent` shares the one copy, so a person's workers on it still share the same user-scoped storage. Default `false`. |

**The tools fence.** A worker that writes a `tools:` line can call exactly the tools it lists,
whatever it selected under `capabilities:`. The kind maps those names against the catalog and hands
the model that list and nothing else; `tools: []` means no tool. A worker with no `tools:` line can
call the tools of every capability preset its own file selects under `capabilities:`, including a
preset whose tools are a function built per turn, and every block of every package it holds. A
preset the kind switches on by default gives its tools only to the workers that select it. A worker with no `tools:` line whose selected presets list
different tools under one name is refused at the hire; the refusal names the worker, the tool, and
both presets, and suggests selecting one of them or writing a `tools:` line. A worker that writes a
line is hired whatever its presets' tools are named, and gets exactly its list.

A skill does not widen the grant: a skill's `allowed-tools` are validated against the catalog but
never registered. Everything else
a capability brings — context, storage, helpers — arrives whatever `tools:` says.

What does reach a worker without appearing in `tools:` is a **control**, which is framework
machinery rather than a tool from the app's catalog, switched on by the worker's own settings:

- the **skill loader**, when a worker sets `skills.activateTool: true` — it pulls a skill the worker
  already holds into the turn;
- the **controls a capability preset declares**, when the worker selects that preset in its
  `capabilities:` key — a preset's `controlTools` reach the worker even with `tools: []`.

#### The memory recipe

Memory is one thing you can pass through these options. Install `@flow-state-dev/memory`
separately:

```ts
import { AGENT_KIND, createWorkerInstallation, defineAgentWorkerFlow, hireWorkforce } from "@flow-state-dev/workforce";
import { system } from "@flow-state-dev/memory";

const mem = system({
  model: "openai/gpt-5.4-mini",
  working: { capacity: 7 },
  episodic: true,
  semantic: true,
});

const installation = createWorkerInstallation({
  standardWorkers: workers,
  workerFlows: () => ({ [AGENT_KIND]: remembers }),
});

const remembers = defineAgentWorkerFlow({
  installation,
  catalog: appTools,
  uses: [
    mem.capability.presets({
      recall: false,    // a tool; off here, so no worker can select it
      connect: false,   // same
      semantic: true,   // context injection; OFF by default
      episodic: true,   // context injection; OFF by default
    }),
  ],
  afterAnswer: mem.captureFromItems,
});

const flows = hireWorkforce(installation);
```

Each of these fails quietly if you skip it:

- **`system()`, not `createMemoryCapability`.** The latter builds the read side only, producing a
  worker that recalls what something else stored and records nothing of its own.
- **`afterAnswer` is the write side.** Without it the durable stores are never written.
- **`semantic` and `episodic` on.** They are off by default, and without them the durable stores
  would be written and never read back.

`recall` and `connect` are memory's two tools, and the recipe turns them off: a worker here reads
what it remembers as injected context. Both are on by default, and a preset on by default gives its
tools only to a worker that selects it. For on-demand search, leave `recall` on and have the worker
select it (`capabilities: { memory: [recall] }`) with no `tools:` line. A worker that writes a
`tools:` line gets it through the catalog (`catalog: { "memory/recall": mem.tool.recall() }`) and
lists `memory/recall` in its `tools:`. The key has to match the tool's own name; a catalog key that
doesn't is refused when the kind is built.

Every worker on `agent` shares the one copy. Long-term memory (episodic, semantic and digest) is
kept in the person's user scope, so one person's workers on `agent` share it, and it never reaches
another person or organization. Working memory is kept per conversation, and each conversation runs
one worker. Skills are kept per worker. Keeping a capability's data apart per worker is the app's,
as for any data a worker flow keeps per user ([Workers as data](#workers-as-data)).

Every problem with a standard worker is a startup misconfiguration: `hireWorkforce` collects them
and throws one error naming every bad worker, and registers nothing, so a bad record cannot leave a
short roster.

## Kinds and blocks from files

The `workerFlows` map above names each flow a second time, after the flow already declared it. There is a
file convention for that half too: put a flow under `workforce/flows/workers/` or
`workforce/flows/mailboxes/`, or a block under `workforce/blocks/`, and the basename is the name it
registers under.

```
workforce/
  flows/
    workers/request-triage.ts                        ← default-exports a workerFlow(...) builder
    mailboxes/standup.ts                              ← default-exports a flow, singleton (the default)
  blocks/triage.ts                                   ← a block any worker may name
  teams/engineering/blocks/build-status.ts           ← a block this team's workers may name
  teams/engineering/workers/triage/blocks/page.ts    ← a block this one worker may name
  teams/engineering/workers/triage/packages/runbook/PACKAGE.md          ← a package this worker holds
  teams/engineering/workers/triage/packages/runbook/blocks/restart.ts   ← one of its tools
```

`fsdev gen` walks those folders and writes `workforce/workforce.gen.ts` beside them, exporting
`kinds`, `mailboxKinds`, `blocks`, `seatBlocks` and `packageBlocks` — parameters
`createWorkerInstallation`, `mailboxInstances`, a task board and a worker flow's tool catalog
already take. The same file
carries `resourceModules`, covered in [Resource modules from files](#resource-modules-from-files).

```ts
import { createWorkerInstallation, defineAgentWorkerFlow, hireWorkforce } from "@flow-state-dev/workforce";
import { blocks, kinds, packageBlocks, seatBlocks } from "./workforce/workforce.gen";

const installation = createWorkerInstallation({
  standardWorkers: workers,
  workerFlows: () => ({ ...kinds, agent: defineAgentWorkerFlow({ installation, catalog: blocks }) }),
  seatBlocks,
  packageBlocks,
});
const flows = hireWorkforce(installation);
```

A `blocks/` folder **registers** a name: `workforce/blocks/` for every worker, a team's for that
team's workers, a team seat's own for that seat. An org seat (`org/workers/<name>/`) has no `blocks/`
folder, and `fsdev gen` refuses one there: it gets tools from the catalog and the packages it holds. A folder does not grant use — a worker still names the
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

Passing `workerFlows` by hand works too, and composes with a generated map with no precedence
rule.

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

### Packages from files

A **package** is a folder a worker holds: a `PACKAGE.md` whose body is instructions, and a `blocks/`
folder of tools. The frontmatter takes `description`, a label for people, and no other key.

```
workforce/
  org/packages/house-style/PACKAGE.md                               ← the org's library
  teams/support/packages/escalation/PACKAGE.md                      ← the team's library
  teams/support/packages/escalation/blocks/page-oncall.ts
  teams/support/workers/billing/packages/refunds/PACKAGE.md         ← this worker's own
  teams/support/workers/billing/packages/refunds/blocks/issue-refund.ts
```

A worker holds every package in its own `packages/` folder. A library package reaches a worker only
when its `WORKER.md` names it, `packages: [escalation]`, looked up in the team's library first,
then the org's. A library package no worker names reaches nobody.

On the built-in `agent` kind, a held package's body is in the prompt on every turn, after the team's
instructions and the worker's own. A worker with no `tools:` line can call every block of every
package it holds. A written `tools:` line is the whole list, and a package block can be named on
it; `tools: []` gets the text and no tools.

`readWorkforce` puts the packages in each worker's reach on its record as `packages`
(`PackageManifest[]`: the org's library, its team's, and its own folder; an org seat has no team's) and reports refused package
folders on `packageErrors`. `readDeclaredRoster` reports the same entries on its `package` layer.
The blocks come from `fsdev gen`'s `packageBlocks` export, keyed by package path and then block
name; pass it to `createWorkerInstallation`, which decides from each worker's folder and `packages:`
line which packages it holds. Leave `packageBlocks` out and a held package brings its instructions and no tools.

```ts
import { readWorkforce } from "@flow-state-dev/workforce/loader";
import { kinds, packageBlocks, seatBlocks } from "./workforce/workforce.gen";

const { workers, errors, packageErrors } = await readWorkforce("./workforce");
if (errors.length || packageErrors.length) throw new Error("workforce: failed to load");

const installation = createWorkerInstallation({ standardWorkers: workers, workerFlows: kinds, seatBlocks, packageBlocks });
const flows = hireWorkforce(installation);
```

A flow of your own receives what a worker holds on `seatPackages`, and only when it holds at least one;
composing `workerConfigSchema()` is what lets its schema accept the key.

Reported by the loader, on `packageErrors`: a `PACKAGE.md` that is missing, has no frontmatter or
no `description`, or declares another key; a `resources/`, `references/`, `skills/` or `packages/`
folder inside a package; any symlink; a file directly inside `packages/`. Refused by the hire, one
message naming every bad worker: a `packages:` name no library in reach offers (the message names
both folders it looked in); a name the worker's own folder and a library both offer; a package
block whose name clashes with the worker's own or team blocks, another held package, a catalog tool
the worker's `tools:` line names, or a picked preset's tool; a package block whose registered name
differs from its own `name`; a package block that declares a store; a package with blocks in the
worker's own folder that failed to load. A failed package with no blocks shows up only on
`packageErrors`, so treat that list as fatal at boot. A clash with a preset tool
built per turn fails that turn instead, with a "two tools named" error.

Packages are read at startup and found by `fsdev gen`. Nothing loads one partway through a
conversation, a package carries no documents, and a block added or removed needs `fsdev gen` again.

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
`referencesFromDocs` are the same pair over `references/`. Both maps are passed to
`createWorkerInstallation`, and a worker flow spreads `installation.documents`, which holds both:

```ts
import { defineFlow } from "@flow-state-dev/core";
import {
  createWorkerInstallation,
  hireWorkforce,
  referencesFromDocs,
  resourcesFromDocs,
  workerConfigSchema,
  workerFlow,
} from "@flow-state-dev/workforce";
import { readReferencesDirectory, readResourcesDirectory } from "@flow-state-dev/workforce/loader";
import { answerQuestion } from "./blocks";
import { ticketResource } from "./resources";

const references = await readReferencesDirectory("./workforce");
const resources = await readResourcesDirectory("./workforce");
for (const { errors } of [references, resources]) {
  if (errors.length) throw new Error(`workforce: ${errors.length} document(s) failed to load`);
}

const supportFlow = workerFlow((installation) =>
  defineFlow({
    kind: "support",
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { ticket: ticketResource, ...installation.resources, ...installation.documents },
    resourceVisibility: installation.resourceVisibility,
    actions: { answer: { inputSchema, block: answerQuestion(installation), userMessage: (input) => input.message } },
  }),
);

const installation = createWorkerInstallation({
  standardWorkers: workers,
  workerFlows: { support: supportFlow },
  documents: resourcesFromDocs(resources.documents),
  references: referencesFromDocs(references.documents),
});
const flows = hireWorkforce(installation);
```

`references` is what tells the installation which entries are references, and
[which workers reach which reference](#what-a-seat-reaches) is decided only for the entries it names.
So once a flow holds references, the option is required: omit it, or pass a map that is missing one of them, and `hireWorkforce` throws, naming every reference it
was not given. A flow that holds none needs no map. A ref passed in both maps is refused as well,
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
is no setting that widens the wall: a reference reaches more people by moving up the tree. A
reference under `org/workers/<name>/references/` belongs to the org seat at that folder: it reaches
that seat and no other. An org seat has no team, so no team's references reach it.

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
files; `createWorkerInstallation` throws on the same collision for a catalog that never passed a loader.

`resourcesFromDocs` and `referencesFromDocs` throw instead of collecting, because a record that
cannot become a resource is a startup misconfiguration.

## Mailboxes

A **mailbox** is a place several agents talk about one topic, with one durable transcript, where
nobody is assigned the work and nobody closes it out. This package ships the flow kind that runs one,
plus the two calls that bind a roster of mailboxes to it.

The identity rule is the thing to get straight first, because it is not the one `WORKER.md` teaches:
**one kind is one instance, and one mailbox is one named session on that instance.** A hundred
mailbox records are a hundred sessions on a single registered flow. What differs per mailbox (who its
members are, what its charter says, what has been said in it) lives in that session's state.

You register nothing to use mailboxes. The built-in kind is seeded for you.

```ts
import { mailboxInstances, openMailboxes, type MailboxManifest } from "@flow-state-dev/workforce";

const mailboxes: MailboxManifest[] = [
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
flowRegistry.registerMany(mailboxInstances(mailboxes)); // one instance, id "mailbox"

// Runtime, once the host is up. One named session per record.
await openMailboxes(mailboxes, {
  client: {
    createSession: sessionClient.createSession,
    deleteSession: sessionClient.deleteSession,
    // The stored record, not `sessionClient.getSession`: see below.
    getSession: async (id) => {
      const stored = await runtime.stores.session.get(id);
      if (stored === undefined) throw new Error(`no session "${id}"`);
      return stored;
    },
  },
  userId: "u_42",
});
```

`getSession` reads the session from the store because the binder needs a mailbox's whole state to
tell an open mailbox from an empty one it may replace. The session API sends a client only the state
a flow exposes, and a mailbox exposes none, so through it every open mailbox would look empty. The
example reads the store by the bare id, which is its storage key in a single-tenant app.

The two calls are separate because they happen at two different times: an instance is registered
when the server is built, and a session can only be opened once it is running. `openMailboxes` needs
a `userId` because a session belongs to one user, as *What a transcript proves* below explains.

Every mailbox session runs in an organization, and your app does not name it. The server binds it
from the caller's verified identity, which is whatever your
[`resolvePrincipal`](https://flow-state.dev/docs/server/authentication#every-request-runs-in-an-organization)
returned; an app that configures no authentication gets the reserved `DEFAULT_ORG_ID`. Storage at
organization scope resolves against it inside the mailbox, including file-declared documents and a
mailbox board's rows. A session's organization is fixed when the session is created, so open your
mailboxes as a caller whose verified identity already carries the organization you want them in.

A record declares eight keys and no others: `flow` (which kind, optional), `description`, `members`,
`boards`, `instructions` (or a body, which is the same setting), `routing` (see the mailboxes
guide, "Routing a mailbox"), `boardActions`, and `mintFor` (see [Projects](#projects): it makes
the file a project talk template, not a mailbox). `boardActions: true` exposes each of the mailbox's
boards' task tools as mailbox actions (`cancelTask_<mailbox>_<board>` and its seven siblings), each
working only in its own mailbox's session; it is off by default, because anyone who can reach the
mailbox can then settle or reassign its rows. An opted-in board whose action names come out the
same as any other board's, opted in or not, such as `eng.feature`'s `work` and `eng_feature`'s `work`
(both `…_eng_feature_work`), refuses at `mailboxInstances` with an error naming both; rename a mailbox
or a board. The list is closed and checked
at `mailboxInstances`: an undeclared key, an `id:`, a `system:`, or a body alongside `instructions:`
each refuse by name.

### Declaring mailboxes in files

A mailbox can be a folder with a `MAILBOX.md` in it, the way a worker is a folder with a
`WORKER.md`. `readMailboxesDirectory` walks `<root>/teams/<teamId>/mailboxes/<mailboxName>/` and
hands back the same `MailboxManifest[]` the two calls above take.

```
workforce/teams/engineering/mailboxes/standup/MAILBOX.md
workforce/teams/engineering/mailboxes/incidents/MAILBOX.md
```

```md
---
description: Where the engineering team posts daily status.
flow: mailbox
members: [engineering.lead, engineering.analyst]
---

Post what you finished, what you're on, and what's blocking you.
```

```ts
import { readMailboxesDirectory } from "@flow-state-dev/workforce/loader";

const { mailboxes, errors } = await readMailboxesDirectory("./workforce");
if (errors.length) throw new Error(`workforce: ${errors.length} mailbox(es) failed to load`);

flowRegistry.registerMany(mailboxInstances(mailboxes));
```

Each record is plain data:

| Field | Description |
|-------|-------------|
| `id` | `"<teamId>.<mailboxName>"`, minted from the two folder names — e.g. `"engineering.standup"`. This is the mailbox's session id. An `id:` in the frontmatter does not set it, and refuses. |
| `declared` | The frontmatter exactly as written. A `MAILBOX.md` must set `description`, and cannot set `system:`; either one fails at load. The rest of what a mailbox may declare (`flow`, `members`, `boards`, `instructions`, `routing`) is checked when you call `mailboxInstances`, so a misspelled key loads without complaint and refuses at registration. |
| `body` | The Markdown below the frontmatter — the mailbox's charter. |

**A mailbox is a folder, not a file**, unlike a resource. A loose file in a `mailboxes/` folder is
passed over, so a `README.md` sitting beside the mailbox folders is fine. Team and mailbox folder
names must be lowercase letters, digits and single hyphens, at most 64 characters. A team with no
`mailboxes/` folder is not an error: an app can declare no mailboxes in files, or build some records
by hand and read the rest.

The reader builds nothing: no instance, no session, no registry entry. A `flow:` naming a kind you
never passed is not caught here; `mailboxInstances` refuses it. It throws only when `root` itself
cannot be read or is a symlink. A folder that produces no mailbox lands in `errors`, keyed by its
path, and every other mailbox still loads. Treat a non-empty `errors` as fatal at startup unless you
have a reason to run a short roster.

The subpath is separate because the reader imports `node:fs`. The package root is server-only too:
it reaches Node built-ins through the packages it builds on. A browser component imports from
[`./browser`](#importing-from-a-browser-component).

### Posting and reading

`post` and `read` are both reachable by a client and by another flow, and a dispatched
`post` is the same kind of line as a client `post`. Neither sets `seatAuthored`, so hearing
members wake whether or not the payload sets `author`. A seat's `post-to-mailbox` tool and a
routed answer are the lines with `seatAuthored: true`, and `wakeMemberSeats` wakes nobody for
those. A woken seat of the built-in `agent` kind sees the writer as `author`, or as `principal`
when there is no `author`. `read` is the same call either way. A post addresses the
mailbox's **session id**:

```ts
const postToStandup = dispatcher({
  name: "post-to-standup",
  flowKind: "mailbox",                          // the shared instance
  action: "post",
  inputSchema: z.object({ body: z.string() }),
  session: { id: () => "engineering.standup" }, // the mailbox
  payload: (input) => ({ body: input.body, author: "engineering.lead" }),
});
```

Address `{ id }`, never `{ key }`: a key-derived session resolves to a different session for every
poster, so the mailbox never sees the post. Nothing detects that mistake.

A flow-to-flow post works where dispatch runs in process, or where queue workers share a lease
backend (`WorkerAdapter.leaseBackend`). On a deployment whose dispatcher hands work to an external
queue and whose adapter supplies no shared lease backend, a post into an opened mailbox is refused
with `external-dispatcher`. A post through the public action route is written there, but its
notify block never runs: no member is woken and a routed mailbox doesn't answer.

A post into a session nobody opened refuses `mailbox-not-bound` and writes nothing. The shared
instance answers for every session id and the action path creates what it does not find, so
boundness, not existence, is what makes a session a mailbox.

Each post leaves one `mailbox-post` item on the mailbox's session, and that item is the line.
A page renders the mailbox from those items; `read` is for models and other flows, returns the
lines inside the session's history window, and never reaches a browser. `author` on a client
`post` is an optional unverified label, stored with `authorVerified: false`. A name that is not a
declared member is refused (`author-not-a-member`) and nothing is written. It does not decide who
`wakeMemberSeats` wakes. `principal` is the mailbox session's user, the same on every line.

### Holding a board

`boards:` declares durable task ledgers the mailbox keeps, as a list of plain local names:

```yaml
members: [engineering.lead, engineering.analyst]
boards: [followups]
```

The ledger id is minted from the mailbox that holds it — `engineering.incidents` holding
`followups` is `engineering.incidents.followups` — and no record writes it. A board name is a plain
local name: not empty, no whitespace, none of `.` `/` `*` `[` `]`, and not `__proto__`, `prototype`
or `constructor`, and not `lock`, in any case. The dot is the one that matters, since it is the join
and a name carrying one would address another mailbox's board. `lock` is reserved because it would
mint an id ending in `.lock`, which a git branch can't carry, so a coding run could never work that
board.

A mailbox holding one or more boards declares two more actions, `fileTask` and `readBoard`,
reachable by a client and by another flow. Unlike `post`, each is the same block either way. Both
take the board's **local** name; `fileTask` hands back
`{ board, boardId, taskId, status }`, and the row's id is minted rather than chosen. Naming a board
the mailbox does not hold refuses `board-not-declared` and lists what it does hold; naming another
mailbox's board refuses the same way. `read` gains a `boards` key listing the local names; a mailbox
holding none omits it and declares neither action.

`readBoard` returns a declared projection of each row, not the whole record: the board's own facts,
without the claim's execution coordinates (`claimedBy`, the lease) or the substrate's write
provenance. The one coordinate it does carry is `run`, the handed-off run working the task, so a
reader can open that run. `mailboxBoardRowSchema` is that shape.

A board's ledger is readable directly by a browser, which is what lets a UI draw the board as
columns without going through an action. The ledger is org-scoped, so that read resolves against the
organization the reading session belongs to. What crosses is `id`, `title`, `goal`, `status`,
`assignee`, `run`, `priority`, `attempts`, `maxAttempts`, `deps`, `labels`, `error`, `createdAt`,
`updatedAt`, `startedAt` and `completedAt`.

The mailbox owns the ledger and runs nothing. A seat that claims rows resolves the same declaration
with `mailboxBoard`, declares it as a resource, and drains it:

```ts
import { mailboxBoard } from "@flow-state-dev/workforce";

const followups = mailboxBoard("engineering.incidents", "followups");
const board = taskBoard({ name: "followups", collection: followups, workers });

defineFlow({
  kind: "analyst",
  // A seat that only drains declares the ledger itself. A seat that composes
  // `mailboxBoardTaskTools(followups)` does not — the capability declares it.
  resources: { [followups.id]: followups },
  actions: { drain: { block: board.drain } },
});
```

`mailboxBoard` returns the same ledger the mailbox writes to, carrying its `id`, so the two sides
agree on both the rows and the board's settings.

The mailbox's id and the board's name are retyped at that call and nothing checks them against the
tree. A typo does not fail: it resolves a second, empty ledger, and the only signal is the
unattended-board warning below.

`mailboxBoardTaskTools(board)` is the model's door onto one. Compose it in the seat kind's `uses`
and the seat holds all eight task tools over that board, each name carrying the board's id —
`addTask_engineering_incidents_followups` and so on for `assignTask`, `updateTask`, `listTasks`,
`completeTask`, `failTask`, `blockTask` and `cancelTask`. Composing the capability also declares the
ledger, so the seat's flow does not declare it again. A seat's `tools:` list can neither grant these
nor fence them out. A narrower set is a different capability.

Compose it once per board; a seat holding two boards holds sixteen tools and the names say which
board each writes to. A mailbox board is org-scoped, so it cannot be declared by a block colocated
in a seat's own folder; that refuses at `hireWorkforce`.

Pass `hireWorkforce` the roster's minted ids as `mailboxBoards` and it warns on stderr for any board
no registered flow declares, naming the mailbox and the board. It never refuses: a mailbox may keep a
board that only people read. Each warning prints once per process, so a dev server that re-runs
the hire on every hot reload says it once, and only a board that newly goes unattended prints again.

Renaming or moving a mailbox's folder re-keys its boards, because a board id is derived from where
the mailbox sits. Rows filed under the old id stay at the old key, nothing migrates them and nothing
refuses. The unattended-board warning is what makes it visible, since the seat still names the id
that moved.

### Handing a row to the worker it names

A row's `assignee` can name any standard worker, by the name `discover` lists, when the board
draining the ledger asks the worker lookup who the name means. A mailbox's board is the
organization's, and whoever drains it opens the task's session, so it never reaches a user's own
worker: only that worker's owner can open a session with it.

```ts
import { defineFlow, dispatcher } from "@flow-state-dev/core";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import {
  WORKER_TASK_ENTRY,
  createWorkerInstallation,
  createWorkerLookup,
  defineAgentWorkerFlow,
  defineMailboxFlow,
  hireWorkforce,
  mailboxBoard,
  mailboxBoardIds,
  mailboxInstances,
} from "@flow-state-dev/workforce";

const boardIds = mailboxBoardIds(mailboxes);
const installation = createWorkerInstallation({
  standardWorkers: workers,
  // gives the agent flow a `work` task entry
  workerFlows: () => ({ agent: defineAgentWorkerFlow({ installation, taskLists: boardIds }) }),
});
const flows = hireWorkforce(installation, { mailboxBoards: boardIds });

const lookup = createWorkerLookup({ installation });

const mailboxKinds = mailboxInstances(mailboxes, {
  kinds: { mailbox: defineMailboxFlow({ checkAssignee: lookup.filingCheck() }) },
});

const followups = mailboxBoard("engineering.incidents", "followups");
const board = taskBoard({
  name: "followups-desk",
  boardId: followups.id, // hand off under the ledger's id
  collection: followups,
  workers: {},
  defaultWorker: dispatcher({
    name: "hand-to-named-worker",
    action: WORKER_TASK_ENTRY,
    session: "per-task",
    flowKind: lookup.flowKind,
    state: lookup.state, // the task's session is born naming its worker
  }),
});
const desk = defineFlow({ kind: "followups-desk", actions: { drain: { block: board.drain } } })();
```

`createWorkerLookup({ installation })` returns `{ find(name), flowKind, state, filingCheck(aliases?) }`.
`find` answers `{ found: true, flowId }` or `{ found: false, reason, message }`, `reason` being
`not-found` or `takes-no-tasks`. It finds a standard worker, read from the installation on every
call; a worker whose flow declares no `work` task entry is `takes-no-tasks`, which still carries the
`flowId` the name means. `state` gives each task's session its starting state, naming the worker
the row names, so the flow's create check confirms it.

`flowKind` is the `TaskFlowTarget` for a board's `defaultWorker`: `not-found` answers nothing, which
refuses the hand-over `flow-not-found` naming the assignee; `takes-no-tasks` throws
`[workforce] task "<id>" could not be handed over: <message>`. Either way the attempt fails through
the board's error path. `filingCheck(aliases?)` is `defineMailboxFlow`'s `checkAssignee`: it
returns `undefined` for a name the lookup finds, else the message, which `fileTask` throws as
`MailboxPostRefusedError` with `reason: "unknown-assignee"` before writing anything. `aliases` maps a
board id to the names a board over that ledger keeps in its own `workers`
(`{ [followups.id]: ["analyst"] }`); those pass without the lookup.

`defineAgentWorkerFlow({ taskLists })` gives the agent kind a `work` task entry fed by
`mailboxTaskLists(taskLists, { allowSessionState: true })`: one turn per task, with the task's title,
goal and context as the message and the answer as the task's result. Without `taskLists` the kind
takes no tasks, and that includes the built-in a hire with no `workerFlows` uses. A kind of your own takes
tasks with `task: { actions: { work: { block, from: mailboxTaskLists(boardIds) } } }`. Hand tasks
over `per-task` so each runs in a session of its own.

### What a transcript proves

A session is bound to one user, so **every line of a given mailbox carries the same `principal`**,
the server-derived identity the post ran under. It does not name the poster. The optional `author`
is an unverified label, stored beside `authorVerified: false`, and `authorVerified` is always
`false`. There is no verified per-participant identity on a line. The members check on `author` is
a validity check against the declared roster, not authentication. A line a seat wrote also has
`seatAuthored: true`. A client `post` never does, including one that sets `author`. Build an audit
or approval flow on these fields and you get a far weaker guarantee than the names suggest.

### Waking members

`defineMailboxFlow({ notify })` takes a block run once per declared member per post. The roster it
walks is the whole declared list, the poster included. A block that should skip a seat's own post
reads `input.seatAuthored === true`. Comparing `author` to `member` only skips a delivery when the
caller claimed that name. `author` is an unverified claim. `principal` is the mailbox session's
user and is the same on every line, so it does not name the poster.
The delivery runs in its own request, outside the post's turn, so a slow delivery never delays the next post. A delivery that
fails is recorded; the post stays written and membership is unchanged. Without a slot, posts land and
nobody is woken.

The framework carries the policy and your app supplies the addresses: the framework will not pick a
dispatch target out of stored data, so a notify block declares its own recipients.

`wakeMemberSeats(flows, { installation, fallback? })` is the notify block for
`defineMailboxFlow({ notify })`. It wakes each member that names a standard worker on a flow that
declares the internal `onMailboxPost` entry, once per post, in one conversation per worker per
mailbox, created naming that worker. A user's own worker isn't woken as a member. A seat's line (`seatAuthored: true`) wakes nobody. A
client `post` wakes each hearing member whether or not it sets `author`. Members whose seat can't
hear a post get `fallback`, or nothing, including on a seat's line. The fallback is not sent to a
member who would have been woken. Pass the flows
`hireWorkforce` returned, and call it before you build mailboxes. The built-in `agent` kind declares
`onMailboxPost`; a kind of your own hears posts by declaring it too. See the mailboxes guide,
"Waking agent seats".

### Routing a mailbox

A mailbox whose file declares `routing:` with a `fallback:` member sends each client `post` to one
member instead of waking them all, including a post that sets `author`. A seat's line
(`seatAuthored: true`) is not routed, and `wakeMemberSeats` wakes nobody for it. Build the kind
with a route:

```ts
defineMailboxFlow({
  notify: wakeMemberSeats(flows, { installation }),
  route: routeByPurpose(flows, { model: "typesafe-ai/jev", installation }),
});
```

`routeByPurpose(flows, { model, installation })` places each client `post` in this order: the member the last
client `post` was routed to by the evaluator or the fallback, until it answers (a post held this way holds
nothing, and neither does one whose route isn't recorded yet); else one evaluator call (block name
`mailbox-route`) choosing among the members whose seat hears posts and has a description, each
described by its `WORKER.md` `description:`; else the `fallback:` member, when that call fails or
answers outside the options, or when no member has a description and there is no call. The model
must be able to evaluate. Only the chosen member
is notified, with `routed: true` and `recent` (the mailbox's last 20 lines) on its delivery, and
each decision is kept as one `mailbox-route` item on the mailbox's session, never as a line. The
two fallbacks differ: `routing: fallback:` names a member who takes a post the route can't place,
while `wakeMemberSeats`'s `fallback` is a block run for members whose seat can't hear a post, and a
routed post never reaches it. A mailbox without the line is not routed, even on a routed kind: its
notify block runs for every member. `mailboxInstances` refuses a `routing:` on a kind built without
a route, and a fallback that isn't a member with a seat the route can reach.

Every mailbox on a kind built with a route (`defineMailboxFlow({ route })`) keeps its last 20 lines,
and the person's last post with where it went, in its session state under `mailboxRouteLedger`,
whether or not its `MAILBOX.md` declares `routing:`. Each post updates it. So neither the lines a
routed member sees nor the hold is limited by the session's history window. The exception is the first post after a mailbox's kind gains a route: its first post on a kind built with one, or its first after the mailbox was posted to while the app ran its kind without a route. That post is never held, and its member sees only the earlier
lines still inside the history window, which can be fewer than 20. Removing `routing:` from a
mailbox's file and restoring it loses no lines. A client `post` made while it was removed holds
nothing, so the next routed post after it is placed by the evaluator or the fallback. A mailbox on a
kind built without a route keeps no record.

Cancelling a routed post's fan-out (the request that picks the member and wakes it) may not stop the
answer. If it is cancelled before the route is recorded in `mailboxRouteLedger`, nobody is woken, the
`fallback:` member included. If the route was already recorded there, the chosen member is woken and
answers, though the fan-out ends `aborted`. After a cancel, a `mailbox-route` item can name a member
who was never woken.

Routing works where dispatch runs in process, or where queue workers share a lease backend
(`WorkerAdapter.leaseBackend`). Behind a dispatcher that hands work to an external queue without
one, a post is written but its notify block never runs, so no member is
picked or woken and nothing answers.

### Registering your own kind

The escape hatch, not a setup step. Reach for it when the workflow graph genuinely diverges. A
standup, a DM and an announce mailbox are all mailboxes on the one built-in kind, differentiated by
members and charter.

```ts
// A kind of your own, alongside the built-in.
mailboxInstances(mailboxes, { kinds: { "my-mailbox": defineMyMailboxFlow() } });

// Or replace the built-in wholesale, keeping the standard behaviour with your own notify block.
mailboxInstances(mailboxes, { kinds: { mailbox: defineMailboxFlow({ notify }) } });
```

Your factory carries the same contract the built-in does: `cardinality: "singleton"`, so
`flow.id === flow.kind`. A `flow:` naming a kind you did not pass refuses by name and never falls
back to the built-in. The `kinds` map is the whole registration surface; there is no second API.

### What mailboxes do not do yet

No join or leave verb, no delete or retirement, and no summary pass over a long transcript.
Membership is the declared list and nothing else writes it, so changing who is in a mailbox means
editing the record and opening a fresh mailbox. Re-running `openMailboxes` over an open mailbox
finds it bound and leaves its session alone, so the three settings written at create — `members:`,
the charter (a body or `instructions:`) and `description:` — keep whatever they were opened with.
`flow:` is settled at create too, since it picks the session's kind. Re-opening is not a migration.

`boards:` is the one that does reach: the board list is built onto the kind from the roster on
every bind and is never stored on the session, so adding a board to an open mailbox's file makes it
usable the next time you run.
It does repair a mailbox whose id was claimed before it was opened — a post that arrives first
leaves an empty session there, and re-running binds it.

### Upgrading from channels

Mailboxes used to be called channels, everywhere, and the old names are not read.

- **Files.** Rename `teams/<team>/channels/<name>/CHANNEL.md` to `teams/<team>/mailboxes/<name>/MAILBOX.md`,
  and `workforce/flows/channels/` to `workforce/flows/mailboxes/`. A tree that still has the old
  names reports an error for each one, and `fsdev gen` refuses to run. Neither is skipped.
- **Code.** Every `channel` export has a `mailbox` name: `channelFlow` is `mailboxFlow`,
  `openChannels` is `openMailboxes`, `ChannelManifest` is `MailboxManifest`. A transcript line is a
  `mailbox-post` item.
- **Stored data.** A store written before the rename does not open: `openMailboxes` stops on a
  session of the old kind, and `findPreRenameMarks` finds the rest for a host's boot check. Start
  from an empty store. Old conversations, and the inventory rows that listed old channels, are not
  carried over.

## Hire, fork and fire as tools

A user's own workers are rows on their roster ([Workers as data](#workers-as-data)), written by the
roster flow's `hire`, `fork`, `edit` and `fire` actions, which `hireWorkforce` registers. A hire,
fork or fire is a write to the user's data. Every process sees it on the next turn.

To let a worker hire or fire for the person it talks to, hand the same blocks to a model as tools.
A catalog key is the tool's own name, so give each block that name and what the model reads about
it: `hire` with `.as()`, and `fire` as a sequencer when it should wait for an approval first. Put
the pair in the worker flow's catalog:

```ts
import { sequencer } from "@flow-state-dev/core";
import { createWorkerHireBlocks, defineAgentWorkerFlow } from "@flow-state-dev/workforce";

const { hire, fire } = createWorkerHireBlocks(installation);
const rosterTools = {
  hire: hire.as({ name: "hire", description: "Hire a worker of the person's own." }),
  fire: sequencer({ name: "fire", description: "Fire one of the person's own workers.", inputSchema: fire.inputSchema, outputSchema: fire.outputSchema })
    .tap(askFire) // your own `human_approval` suspension, if a fire should wait for the person
    .step(fire),
};

const agent = defineAgentWorkerFlow({ installation, catalog: rosterTools });
```

A worker holds `hire` or `fire` only when its own `tools:` names them. Each write goes to the roster
of the person whose turn it is: a worker can't hire for anyone else. The blocks write at once; an
approval before a fire is yours to add as a step before it, as the chief of staff guide shows.

### Posting to a mailbox from a seat

`workerMailboxPostCapability` puts one tool, `post-to-mailbox`, on a worker flow's catalog. Install
it with `defineAgentWorkerFlow({ installation, uses: [workerMailboxPostCapability] })`, or in your
own worker flow's `uses`, and a worker names the tool in `tools:` to use it. Its input is
`{ mailbox, body }` and nothing else, so an `author` from the model is refused.

Outside a routed turn (below), the tool posts through the built-in mailbox kind with the id of the
worker the turn loaded (as `members:` lists it) as `author`, so the mailbox's member check applies.
The worker comes from the session, never from the input or a setting. The line has
`seatAuthored: true`, so `wakeMemberSeats` wakes nobody for it. A client `post` that sets `author`
to the same worker id wakes hearing members. A turn that loaded no worker posts nothing.
Passing `mailboxPostCapability` to `defineAgentWorkerFlow({ installation })` puts this one in its
place.

The tool returns once the post is handed to the mailbox, as `{ handedTo, note }`. A refusal by the
mailbox, such as an author who is not a member, lands on the mailbox's request, not in the seat's
turn. A refusal at dispatch fails the call by name: `session-not-found` for an id nobody opened,
`session-not-addressable` for a session on another mailbox kind, and `external-dispatcher` behind
a dispatcher that hands work to an external queue without a shared lease backend. The tool works
only where dispatch runs in process or is arbitrated over a shared lease backend.

In a routed mailbox, a routed member of the built-in `agent` kind has a non-empty reply handed to
the mailbox as its answer, whether or not it calls the tool. A tool call into that mailbox during
the turn is handed over as the answer first, and the reply lands only if the tool's answer didn't,
for instance because the mailbox failed to write it. A second tool call there posts nothing and
tells the model its answer was already handed to the mailbox. A call into any other mailbox during
that turn goes through `seatPost`. An empty reply posts nothing, and fails the run unless the tool
handed an answer over in that turn.

The reply and the tool's answer both land through an internal entry of the mailbox kind, one only a
dispatch can reach, never a client. It applies `post`'s member check and the same `seatId` author,
and the line has `seatAuthored: true`.
Each post gets at most one answer line. Once one lands, any other answer to that post lands
nothing, even one sent at the same moment. An answer the mailbox refuses writes nothing and doesn't
use up the post's one answer line; the refusal is a failed request on the mailbox's session. A kind
of your own receives `routed: true` and `recent` (the mailbox's last 20 lines) and has nothing
posted for it.

Also exported: `MAILBOX_POST_CAPABILITY` (`"mailbox-post"`), `POST_TO_MAILBOX_TOOL`
(`"post-to-mailbox"`) and `postToMailboxInputSchema`.

## The inventory

The tree tells you what a workforce is meant to be. A `WORKER.md` declares a seat, a `MAILBOX.md`
declares a mailbox, and both are read once at boot. Neither can tell a block which seats and mailboxes
were actually registered in an organization, or which mailboxes a given seat is in, and a block cannot
walk folders to find out.

The inventory keeps that record as data: three org-scoped resource collections, one row per
registered seat, one row per registered mailbox, and one row per seat-in-mailbox. They are ordinary
collections, so a block reads them the way it reads any other resource.

**A row means registered, not open.** It records that a seat or mailbox was registered in this
organization, not that the seat is working or the mailbox is open now. Nothing deletes a row for
going missing. A runtime-hired seat's row is removed when it is fired, and only the row its own
hire published (it carries that hire's `incarnation`). When a `MAILBOX.md` becomes a project talk
template (`mintFor: projects`), the next `openInventory` removes its mailbox row and membership
rows, and discovery never lists a template as a mailbox. A mailbox's `members` are the ones it had
when it registered.

| Factory | One row per | Fields |
|---------|-------------|--------|
| `defineSeatInventoryCollection()` | registered seat, at `inventory/seats/<seatId>` | `id`, `kind` (the worker flow the standard worker runs on), `door` (the action that takes a person's message, or `null`), `hired` (`false`: only standard workers are listed), `incarnation` (`null`) |
| `defineMailboxInventoryCollection()` | registered mailbox, at `inventory/mailboxes/<mailboxId>` | `id`, `kind` (the mailbox kind that opened it), `members` (seat ids, `[]` when absent), `openedAt` (ISO string, or `null` when absent) |
| `defineMembershipIndexCollection()` | seat-in-mailbox, at `inventory/members/<seatId>/<mailboxId>` | `seatId`, `mailboxId` |

All three are readable by a browser through the ordinary collection read
(`listCollectionItems` from `@flow-state-dev/client`), from any session whose flow declares them.
Each row comes back with the fields in the table and nothing else. The read answers for the session's
own organization, which the server takes from the session, never from the request.

### Writing the inventory at boot

The rows are written by `openInventory`, which runs after `openMailboxes`:

```ts
import {
  mailboxInstances,
  hireWorkforce,
  openMailboxes,
  openInventory,
} from "@flow-state-dev/workforce";

const flows = hireWorkforce(createWorkerInstallation({ standardWorkers: roster.workers }));
const instances = mailboxInstances(roster.mailboxes, { inventory: true });

flowRegistry.registerMany([...seats, ...instances]);
// server starts here

await openMailboxes(roster.mailboxes, { client, userId: "u_boot" }); // `client` as above

await openInventory(
  { seats, mailboxes: roster.mailboxes },
  {
    run,
    seatWriter: { flowKind: "mailbox" },
    userId: "u_boot",
    orgId: "org_acme",
  }
);
```

The writer needs both halves. `mailboxInstances(roster.mailboxes, { inventory: true })` builds the
built-in mailbox kind carrying the registration actions and the three collections.
`openInventory(...)` runs those actions: once per mailbox, once for all seats.

Leave both out and mailboxes work without an inventory. Nothing is declared, nothing is written.

**What `openInventory` writes:**

- One row per seat at `inventory/seats/<seatId>`, carrying `{ id, kind, door }`.
- One row per mailbox at `inventory/mailboxes/<mailboxId>`, carrying `{ id, kind, members, openedAt }`.
- One row per member per mailbox at `inventory/members/<seatId>/<mailboxId>`.

**The `run` callback.** `run` is the callback your app hands `openInventory` to run an action: it
takes the request `openInventory` builds, runs it through your runtime, and rejects when the action
fails. A `run` callback that hands back a
failed run as an ordinary value reports every mailbox registered while writing nothing. **It must
also forward `request.source` into `runAction`'s own `source` option**
(`runAction({ ..., source: request.source })`). The seat write's request carries
`source: "internal"`, and it runs only when that value arrives. A `run` callback that drops `source` makes
the seat write fail, and `problems` names it.

**Where the seat rows go.** Seat rows need a flow to run in, because a resource collection can only
be written from inside a flow. `seatWriter: { flowKind: "mailbox" }` names the built-in, which
carries the writer when built with `inventory: true`. Any flow carrying the writer actions will do
(see [Custom mailbox kinds](#custom-mailbox-kinds)).

**`registerSeatsInInventory` is a boot-only action.** Mailbox registration takes no input and
builds its row from the mailbox's own open session, so it is safe as a public action. The seat
write's whole input is the row data, so it lives only in the flow's `internal.actions` map. An HTTP
or MCP request never reaches that map; the only way in is the direct
`runAction({ source: "internal", ... })` call `openInventory` makes. A kind of your own makes the
same split: see [Custom mailbox kinds](#custom-mailbox-kinds).

**What the mailbox rows hold.** `members` is the seat ids the mailbox's session held when it
registered, read by the mailbox itself. An edit to `members:` in a `MAILBOX.md` does not reach a mailbox that is already
open, so it does not reach the row either. The `post` and `fileTask` blocks check membership against
the mailbox's session state, not the inventory; the row is a copy for finding things, not the check.

**Running it twice.** Every write is an upsert keyed by the record's id. Nothing duplicates, and a
mailbox registered on an earlier boot keeps its original `openedAt`. A row stays where it is when a
later roster no longer names the seat or mailbox. The seats are the standard workers
(`inventorySeats(installation)`); a user's own workers are on their roster, never in the inventory.

**What lands in `problems`.** `openInventory` returns `{ seats, mailboxes, problems }`. `seats` counts
the seat rows that landed, as the seat action reports it when `run` returns the action's output (or a
run result carrying it as `output`). A mailbox
whose session is not open, or whose kind declares no registration action, is named in `problems` and
the rest of the roster is still attempted.

### Custom mailbox kinds

A mailbox kind you wrote yourself gets rows when it carries the blocks
`inventoryWriterActions(kind)` returns. Put `registerMailboxInInventory` in `actions`, and
`registerSeatsInInventory` and `retireMailboxesInInventory` in `internal.actions`; do not spread the
whole return into `actions`. The string you pass is the value that appears as `kind` on that
mailbox's rows.

```ts
const writer = inventoryWriterActions("briefing");

defineFlow({
  kind: "briefing",
  cardinality: "singleton",
  session: { stateSchema: mailboxSessionStateSchema },
  actions: { ...myActions, registerMailboxInInventory: writer.registerMailboxInInventory },
  internal: {
    actions: {
      registerSeatsInInventory: writer.registerSeatsInInventory,
      retireMailboxesInInventory: writer.retireMailboxesInInventory,
    },
  },
});
```

A kind passed under `mailboxInstances`'s `kinds` option is yours to build. The `inventory: true`
flag reaches the built-in only.

### Reading the inventory

Each factory takes no options. Install what it returns under any block's `resources` map:

```ts
import {
  defineMailboxInventoryCollection,
  defineMembershipIndexCollection,
  defineSeatInventoryCollection,
  membershipPrefix,
} from "@flow-state-dev/workforce";
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

const seats = defineSeatInventoryCollection();
const mailboxes = defineMailboxInventoryCollection();
const memberships = defineMembershipIndexCollection();

const seatMailboxes = handler({
  name: "seat-mailboxes",
  inputSchema: z.object({ seatId: z.string() }),
  outputSchema: z.object({ mailboxIds: z.array(z.string()) }),
  resources: { memberships },
  execute: async (input, ctx) => {
    const rows = await ctx.resources.memberships.list(membershipPrefix(input.seatId));
    return { mailboxIds: rows.map((row) => row.state.mailboxId) };
  },
});
```

Keys are relative to each collection's own prefix, so `upsert("engineering.lead", row)` on the seat
inventory lands at `inventory/seats/engineering.lead`. `list()` hands back resource refs, and the row
itself is on `ref.state`. The membership index takes a two-segment key, which is what `membershipKey`
builds; the next section covers it.

A row joins back to the declared record on the id and nothing else. The `id` on a seat row is the
id `discover` looks up: the `WORKER.md` folder's id for a file-declared seat, or `<orgId>.<seatId>`
for a seat written by `hire`. The `id` on a mailbox row is the `"<teamId>.<mailboxName>"` that is
also the mailbox's session id.

The rows are org-scoped and shared across flows. Every flow running under the same `orgId` reads the
same rows, whichever flow wrote them and whichever
[tenant](https://flow-state.dev/docs/fundamentals/state-and-scopes#multi-tenant-isolation) it runs
under, and a flow under a different `orgId` reads none of them. That holds whether or not the app
sets [`isolateOrgState`](https://flow-state.dev/docs/advanced/flow-isolation).

Each row schema is closed, so a key it does not declare is dropped on the way in rather than stored.
`id` and `kind` are required and the schema rejects a row without them. `members` and `openedAt` are
optional, and a row without them parses. The schemas ship as `seatInventoryRowSchema`,
`mailboxInventoryRowSchema` and `membershipIndexRowSchema` alongside the row types, for checking what
you are about to write.

### Listing one seat's mailboxes

The mailbox inventory answers who is in a mailbox. The membership index answers the reverse: one row
per membership, keyed seat first, so a seat's mailboxes are something you can list by prefix.
`membershipKey` builds the key for a single row; `membershipPrefix` builds the prefix for the list.

```ts
import { membershipPrefix } from "@flow-state-dev/workforce";

const seatMailboxes = handler({
  name: "seat-mailboxes",
  inputSchema: z.object({ seatId: z.string() }),
  outputSchema: z.object({ mailboxIds: z.array(z.string()) }),
  resources: { memberships },
  execute: async (input, ctx) => {
    const rows = await ctx.resources.memberships.list(membershipPrefix(input.seatId));
    return { mailboxIds: rows.map((row) => row.state.mailboxId) };
  },
});
```

Both helpers return keys relative to the collection's prefix, which is what `upsert`, `get` and
`list` take. `membershipKey("engineering.lead", "engineering.standup")` is
`"engineering.lead/engineering.standup"`, and `membershipPrefix("engineering.lead")` is
`"engineering.lead/"`. That trailing slash is the reason to use the helper rather than build the
string yourself: without it, `"engineering.lead"` also matches `"engineering.leadership"`, and one
seat reads another seat's mailboxes.

**Listing a seat's mailboxes reads every membership row.** `list(membershipPrefix(seatId))` fetches
every membership row under the org before the prefix narrows it, so the cost grows with the org
rather than with the seat.

Both helpers throw when an id cannot be one whole path segment, naming the argument at fault:

```ts
membershipKey("engineering/lead", "engineering.standup");
// Error: Inventory seatId "engineering/lead" must not contain a path separator …

membershipPrefix("");
// Error: Inventory seatId must not be empty
```

## Projects

A project is a row in the organization's `projects` collection: a title, a brief, an owner, its
`members`, the workstreams (declared mailboxes, from any team) it groups, the git remote its code
lives in (`repository`, or `null`), and each member's talk session. Declare the collection once in `workforce/org/resources/projects.ts` with
`defineProjectsCollection()`. The guide is the docs site's Workforce → Projects page.

```ts
import { defineProjectBlocks } from "@flow-state-dev/workforce";

const projects = defineProjectBlocks();
defineFlow({ kind: "lab", actions: { ...projects.actions } });
```

- **`createProject { id, title, brief?, members?, workstreams?, repository? }`** writes a row with `create`.
  The owner is the calling session's owner, and is always a member. An id held by another owner,
  `unassigned`, a workstream not in the mailbox inventory, and a workstream another project holds
  are each refused, and nothing is half written. The same owner re-sending an id gets the row back
  (`created: false`) and its talk session bound if it wasn't.
- **`setWorkstreams { projectId, workstreams }`** replaces the list. Members only.
- **`setRepository { project: { visibility, id }, repository }`** sets, changes or clears (`null`) the repository and
  returns `{ project }`. Members only. Nothing else on the row moves, and of two members setting it
  at once one value is kept whole. A value must be a remote, the address you'd pass to `git clone`:
  both writes refuse a path, a value starting with `-`, a control character, a remote-helper address (`ext::…`), a user
  or password on `http(s)`, and a password on any scheme, with `invalid-repository`, and never
  repeat the value. `git@host:org/repo` and `ssh://git@host/org/repo` are accepted. Stored rows
  aren't re-parsed on read: treat a missing `repository` as `null`, or read through
  `projectRowSchema.parse`.
- **`readProjectFiles { project: { visibility, id } }`** returns `{ files: [{ path, size }] }` (size in UTF-8 bytes,
  never the body, since the output is logged as the tool result), the files the
  project keeps in the org's `project-files` collection (`defineProjectFilesCollection()`), at
  `project-files/<projectId>/<path>`. Members only. The collection is org-scoped, shared, lazy, and
  has no browser read.
- **`projectWorkspace({ board })`** is a run source for a workspace host (`@flow-state-dev/workspace`):
  for a run on that mailbox board, the repository of the project that holds the board's
  workstream, with the project's files beside the checkout, or the project's files alone when it
  has no repository. It reads only the workstream's claim and the project row, and refuses the run
  with `no-project` when no project holds the workstream and `not-a-member` when the run's owner is
  not one of the project's members. The block that asks it must hold
  `projectWorkspaceCapability`; with harness-manager, pass it on `uses`:

  ```ts
  const work = mailboxBoard("eng.feature", "work");
  harnessManager({
    boardCollectionId: work.id,
    boardCollection: work,
    workspace: localWorkspaceHost({ root, remotes: { allow: ["github.com"] }, source: projectWorkspace({ board: work }) }),
    uses: [projectWorkspaceCapability],
    // ...
  });
  ```
- **As a worker's tools.** Put the writes in `defineAgentWorkerFlow({ catalog })` under the names a worker's
  `tools:` spells. A catalog key must be the tool's own name, so give each that name with
  `projects.createProject.as({ name: "createProject", description: "…" })`. The owner is the session the seat
  answers in, so the project belongs to the person who asked. A kind that also reads the mailbox
  inventory (the `discover` door) declares it with `projectWritesMailboxInventory`: a flow refuses a
  second declaration of the collection beside the writes'.
- **The talk entries** are built into every mailbox kind. A talk session is a mailbox-kind session
  whose state names a project (`resourceId`), which grants nothing: every entry checks the
  session's owner against the row's `members` first, and refuses `not-a-member`.
  `join { projectId }` returns the member's one talk session: the one the project lists for them,
  or else the calling session. `bind` does what `join` does, as an internal entry for trusted code.
  `post { body }` adds a person's line to `room-lines`. `answer` is how a seat's reply reaches the
  room; you don't call it. `read { after }` returns committed lines after a cursor, 200 at most,
  with the room's `charter` and `seats`. On any other mailbox session, `post`, `read` and `answer`
  work on the mailbox's transcript, and `read` ignores `after`.

Refusals are `ProjectRefusedError`, with a `reason`.

**The talk template** is a room's seats and charter, shared by every project. Declare the
org-level default beside the collection, and pass the org's resource map to `mailboxInstances`:

```ts
// workforce/org/resources/projects.ts
export default defineProjectsCollection({
  talk: { seats: ["engineering.lead", "chief-of-staff"], charter: "Plan the work; say what is blocked." }
});

// at boot
const { resources } = splitResourceModules(resourceModules);
mailboxInstances(mailboxes, { kinds, resources });
```

Or declare it in a team's `MAILBOX.md` with `mintFor: projects`: its `members:` are the seats, and
its body is the charter. A template is never opened and never registered in the inventory. Seats
are full seat ids from any team (`engineering.lead`) or a dotless org seat id (`chief-of-staff`).
Talk sessions run on the built-in `mailbox` kind, so pass it built with a `notify` block, as
`kinds: { mailbox: defineMailboxFlow({ notify: wakeMemberSeats(seats) }) }`.
`mailboxInstances` refuses, with its other refusals, a template that declares `flow:`, `boards:`,
`routing:` or `boardActions:`, a `mintFor:` that names no collection in `resources` or names one
other than the projects collection (under whatever key you passed it), a bad or repeated seat id, seats on a `mailbox` kind built with no `notify`
block (none of them would wake), and a second template for the collection at either site.
The first call that finds the template registers it for the process. Every later call builds its
`mailbox` kind holding it, with or without `resources`, and a later call that finds a different
template throws.
`createProject` always gets the creator's talk session ready. With a template, so does any other
code that creates a project inside a flow turn. A `post` in a project's room wakes each seat once,
under the poster, with the room's last 20 lines. A seat's reply lands in
the room through `answer`, once per post and seat, so a repeated delivery adds no second line. A
seat answers only for itself: each delivery carries an `answerToken` issued to that seat, and the
answer hands it back as `token` (the built-in agent kind does this for you; a kind of your own
passes it through). An answer with no token, naming another seat, or sent through a session other than the poster's is refused. The
template is built onto the kind at every boot, so an edit reaches every project's room at the next
restart.

## Workers as data

A worker is data: a row its owner holds in their user scope, or a standard worker your files
declare, run by one registered copy of the flow it names. A session names its worker once, when it
is created, and each turn loads it. A hire, fork or fire is a write to the user's data. Every
process sees it on the next turn.

```ts
import { defineFlow } from "@flow-state-dev/core";
import { createWorkerInstallation, hireWorkforce, workerConfigSchema } from "@flow-state-dev/workforce";

const installation = createWorkerInstallation({
  standardWorkers: roster,                  // readWorkforce(...)'s workers
  workerFlows: () => ({ research: researchFlow }),
});

const researchFlow = defineFlow({
  kind: "research",
  configSchema: workerConfigSchema(),
  session: installation.session(),          // a readonly `workerId`, and the create check
  resources: { ...installation.resources }, // the user's workers, and the standard ones
  actions: { run: { inputSchema, block: door, userMessage: (i) => i.message } },
});

// inside the door's block, which also declares `installation.resources`:
const worker = await installation.resolveWorker(ctx, "research");
worker.config.instructions; // the worker's own, as the flow's configSchema parsed them
worker.reaches("handbook"); // its document grants, applied on this turn

const flows = hireWorkforce(installation); // research, agent, and the roster flow
```

Register every flow `hireWorkforce` returns: one copy of each worker flow, and the roster flow,
`workforce-roster`, which carries the `hire`, `fork`, `edit` and `fire` actions below.
`createWorkerHireBlocks(installation)` returns the same four as blocks, to mount elsewhere or hand
to a model as [tools](#hire-fork-and-fire-as-tools).

- **Creating a session.** A session of a worker flow is created with `state: { workerId }`. The
  worker must be the creating user's own or a standard one. Asking for another user's worker
  returns the same 404 as asking for one that doesn't exist. A worker on another flow is refused
  with a 400 naming both flows. A session created with no worker is refused, and so is an action
  sent to a session id that doesn't exist yet. `workerId` is readonly: nothing changes it after the
  create.
- **Each turn.** `resolveWorker(ctx, flowKind)` loads the session's worker and resolves its tools,
  skills and packages against what the installation registers. Read the worker's settings from
  `worker.config`: `ctx.flow.config` is the flow's own config, the same for every worker on it.
  Load it in the flow's `request.onStarted`, or in the block that reads it. A request that waited
  for a person runs again when the answer arrives, and a step that already finished isn't run
  again: its recorded output is reused, so a worker loaded in an earlier step is gone on the
  resumed run. The built-in `agent` loads it in `request.onStarted`.
  When the turn can't run, `resolveWorker` throws `WorkerTurnRefusedError` and nothing is written:
  - the worker was fired: its sessions stay readable; start a session with another worker;
  - the worker now runs on another flow: call `ensureWorkerSession` again, which starts a session
    on the new flow;
  - it names a tool, skill or package this installation doesn't register: `edit` the worker to drop
    or replace the name, or register it; the next turn reads the change;
  - it is one of the user's own workers on a flow marked `standardOnly`: `edit` it onto another
    flow.
- **A worker's own data.** Data a flow keeps per user is shared by all of that user's workers on
  the flow, and never reaches another user. Keeping one worker's data apart from the user's other
  workers is the flow author's job: key a collection by the worker the turn loaded, or use a
  skills library with `partitionBy` reading the session's readonly `workerId`
  ([Partitioning a library](../orchestration/README.md#partitioning-a-library)). The framework
  neither refuses nor partitions it for you. The built-in `agent` keeps each worker's skills apart.

  ```ts
  // a user-scoped collection `worker-notes/*`, declared on the block beside `installation.resources`
  const worker = await installation.resolveWorker(ctx, "research");
  await ctx.resources.workerNotes.upsert(worker.id, { text: "Prefers short answers." });
  ```
- **What a worker's model reaches.** A worker flow declares every document any of its workers may be
  granted (`...installation.documents`) and sets `resourceVisibility: installation.resourceVisibility`.
  Each turn's model then reaches only the documents the turn's worker is granted, read-only where
  its grant is, through core's resource tools and the `discover` door; every other document answers
  as one that doesn't exist. A turn that loaded no worker reaches no document. Block code that names
  a document directly is not narrowed. The built-in `agent` sets this for you.
- **The roster.** Each worker the user hires or forks is a row at `workforce/workers/<id>` in their
  user scope, one roster per organization. Every write is checked the way a turn would check it,
  and a standard worker's id is refused with a suggestion to fork it:
  - `hire({ id, flow?, description?, instructions?, skills?, settings? })` returns `{ id, flow }`;
    `flow` defaults to `agent`, and `settings` takes the keys a `WORKER.md` frontmatter accepts. A
    skill nothing registers is refused with the skills that are, as in
    `Worker "scribe" names skill "license auditing", which this installation doesn't register. Remove it, or register it. Skills it registers: "cite", "summarize". Nothing was written.`
    (or `It registers no skills.` when there are none);
  - `fork({ from, id })` returns `{ id, flow }`, copying a standard worker's, or one of the user's
    own, configuration: its flow, description, instructions, team instructions, skill names and
    settings; a later edit to the files doesn't reach the fork;
  - `edit({ id, flow?, description?, instructions?, skills?, settings? })` returns `{ id, flow }`,
    replacing each field given;
  - `fire({ id })` returns `{ id }` and deletes the row.
- **From an app.** `createWorkforceClient`, from `@flow-state-dev/workforce/browser`, takes the
  transport options `createSessionClient` takes:

  ```ts
  import { createClient } from "@flow-state-dev/client";
  import { createWorkforceClient } from "@flow-state-dev/workforce/browser";

  const workforce = createWorkforceClient({ userId, baseUrl });

  const roster = await workforce.roster();
  // [{ id: "scribe", flow: "research", standard: false, description: "Takes notes." },
  //  { id: "researcher", flow: "research", standard: true, description: "Finds things out." }]

  const session = await workforce.ensureWorkerSession({ worker: roster[0].id });
  // { id: "wks_…", flowKind: "research", userId, createdAt, updatedAt, … }

  const research = createClient({ flowKind: session.flowKind, userId, baseUrl });
  const { requestId } = await research.sendAction("run", { message: "Summarize the launch notes." }, {
    sessionId: session.id,
  });
  ```

  In React, build the client once with `useMemo` over the same options. `useFlow` creates sessions
  with no starting state, which a worker flow refuses, so find or start the session with the client
  and select it on the hook (`flow.selectSession(session.id)`).

  `ensureWorkerSession` returns the user's most recent session with the worker, or creates one.
  Two calls at once get the same session. `findWorkerSession` takes the same argument and returns
  the session or `undefined`, creating nothing. The roster flow keeps one session per user, of the
  kind `workforce-roster`; if you list every flow's sessions, filter out
  `flowKind === "workforce-roster"`. Two first calls at once may create two roster sessions, which
  is harmless: the roster lives in the user's scope, not in either session.

## Coordinators

A coordinator is a worker that hands each post to other workers on the same user's roster, its
**delegates**, by `judgment`, `best-fit`, `round-robin` or `everyone`. It runs on the
`coordinator` flow, registered on the installation like any worker flow. A delegate's flow
declares the internal entry that takes a delegated post; the built-in `agent` flow declares it,
and your own flow does with `delegatedPostEntry`. The site's
[Coordinators](https://flow-state.dev/docs/workforce/coordinators) page walks through setting one up.

```ts
import {
  createWorkerInstallation,
  DELEGATED_POST_ENTRY, // "onDelegatedPost"
  defineCoordinatorFlow,
  delegatedPostEntry,
  delegatedPostOnFinished,
  workerConfigSchema,
} from "@flow-state-dev/workforce";

const researchFlow = defineFlow({
  kind: "research",
  configSchema: workerConfigSchema(),
  session: installation.session(),
  resources: { ...installation.resources },
  request: { onFinished: delegatedPostOnFinished }, // reports a cancelled delegated post
  actions: { run: { inputSchema, block: door, userMessage: (i) => i.message } },
  internal: { actions: { [DELEGATED_POST_ENTRY]: delegatedPostEntry(door) } }, // takes delegated posts
});

const coordinatorFlow = defineCoordinatorFlow({
  installation,
  delegateFlows: [researchFlow],     // the flows a delivery can reach
  routeModel: "openai/gpt-5.4-mini", // best fit's one evaluator call
  agent: { catalog, uses },          // what you give defineAgentWorkerFlow: the judgment turn is the agent's
  roundDeadlineMs: 5 * 60_000,       // optional: how long a round waits for its answers (the default)
});
```

The judgment turn is the built-in agent's own turn. A coordinator worker's `model`, `tools`,
`skills` and `capabilities` read the way an `agent` worker's do, against the catalog and
capabilities you pass as `agent`. The four delegate tools and `handOff` are on every coordinator,
whatever its `tools:` line grants.

A coordinator's file names its defaults:

```md
---
flow: coordinator
delegates: [researcher, scribe]
routing: best-fit        # judgment (the default), best-fit, round-robin or everyone
fallback: scribe         # one of the delegates
rounds: 0                # how many times an answer goes back out: 0 (the default) to 3
---
```

- **Routing.** `judgment` runs the coordinator's own turn, which hands the post on with its
  `handOff` tool or answers itself. `best-fit` sends a follow-up to the delegate still working the
  person's last post, else makes one evaluator call over each delegate's note or description, else
  sends it to the fallback, else runs the judgment turn. If that turn fails too, nobody takes the
  post, and the conversation says so. `round-robin` sends each post to the next delegate in list
  order, skipping one that can't be reached. `everyone` sends it to each delegate that can be
  reached. When no delegate can be reached, nobody takes the post, and the conversation says so.
- **Rounds.** With `rounds:` above 0, a delegate's answer goes back out, at most that many times.
  `best-fit` and `round-robin` route each answer again as it lands, never to its own author.
  `everyone` waits for the round to close, then sends each delegate the other delegates' answers
  in one delivery. `judgment` waits for the round to close, then runs the coordinator's turn once
  with the round's answers; its hand-offs in that turn go out in the next round. A round closes
  when each of its delegates has answered, failed or been cancelled, or when its deadline passes
  (`roundDeadlineMs`, five minutes by default). A delegate that answers after that has its answer
  land once, and the answer goes no further. Each delegate gets a post at most once per round, so
  a post costs at most delegates × (rounds + 1) delegate turns.
- **When a delegate says nothing.** A delegate flow tells the coordinator about a failed turn, a
  turn still running at the deadline, and, with `delegatedPostOnFinished` as its request
  `onFinished`, a cancelled run. A delegate that says nothing at all, because its process stopped
  or it was cancelled before its turn started, holds its round only until the conversation next
  wakes after the deadline: a person's post, an answer, or another delegate's report. That wake
  closes the round and sends its answers on. With no later activity in the conversation, the
  answers that landed stay, and nothing goes on.
- **Open rounds.** A conversation keeps at most 50 rounds open at once. A post that would open one
  more is still delivered, but its round isn't opened: its answers land once and go no further,
  and its routing record's `note` says so. The rounds already open go on.
- **Delegates per conversation.** Each conversation starts from a copy of the defaults, and its
  changes stay in it. Change them with the `addDelegate({ worker, note? })`,
  `removeDelegate({ worker })` and `setFallback({ worker | null })` actions, and read them with
  `listDelegates({})`. Each returns `{ delegates, fallback, max, filingSessionId }`, the list after
  the call. `listDelegates` also gives each delegate, read from the roster when it is called, its
  worker's `description` (`null` when it has none) and `takes`, from its flow: `posts`, `tasks`,
  `both`, or `nothing` (fired, or on a flow that takes neither, with a `null` description). A refused
  change writes nothing and fails its request with the refusal as the error message. The
  coordinator's turn has the same four as tools, which hand a refusal back to the model as
  `{ refused }`. A session create can't set them: one whose `state` carries `delegates`
  is refused with a 400,
  `Session state field "delegates" is written only by flow "coordinator"; a caller cannot set it.`
- **Who can be a delegate.** A worker on the conversation's user's own roster, one of theirs or a
  standard one, whose flow takes a delegated post or a task. A conversation holds at most 25. A
  standard coordinator's defaults can name only standard workers; `createWorkerInstallation`
  refuses the file otherwise. The refusals:
  - another user's worker, or one nobody holds: `No worker "<id>" on your roster.`
  - a flow that takes neither:
    `Worker "<id>" runs on flow "<flow>", which takes neither a delegated post nor a task.`
  - one already on the list: `"<id>" is already a delegate in this conversation.`
  - a 26th: `This conversation already has 25 delegates, the most it can hold. Remove one first.`
  - removing one that isn't on the list: `"<id>" isn't a delegate in this conversation.`
  - a fallback that isn't on the list:
    `"<id>" isn't a delegate in this conversation, so it can't be the fallback.`

  A worker whose flow takes tasks but no posts can be added. A post handed to it is skipped, and
  the routing record gives the reason
  `Worker "<id>" runs on flow "<flow>", which can't take a delegated post.` When the
  coordinator's own turn hands it a post with `handOff`, the refusal adds the delegates that take
  posts, `Delegates here that take posts: <ids>.`, or `No delegate here takes posts.` when none does.
- **Delivery.** Each delegate gets its own session per conversation, created naming the delegate
  as its worker, and reused for that conversation's later posts. Its answer lands in the
  conversation under the delegate's name, once, however many times it is sent. The session
  carries the conversation's `filingSessionId`, which `listDelegates` returns, so an app finds it
  with `findWorkerSession({ worker, filingSessionId })`. A conversation deleted and created again
  under the same id has a new `filingSessionId`, and its delegates get new sessions. A lookup
  naming only `{ worker }` never returns a delegate's session.
- **The record.** Every routing decision leaves one `coordinator-route` component item:
  `postId`, `round`, `policy`, `by` (`judgment`, `held`, `evaluated`, `fallback`,
  `round-robin`, `everyone` or `unplaced`), `delegates` (each with `worker`, `outcome` of
  `delivered`, `skipped` or `failed`, and a `reason` when it wasn't delivered), `none` (why
  nobody was delivered to, when nobody was), and `note` (why the round's answers go no further,
  when it was refused at the cap on open rounds). Render it apart from the conversation's lines.

`hireWorkforce` refuses a broken standard coordinator at load, naming the problem: a `rounds:`
above 3 (`rounds can be at most 3`), a `routing:` outside the four, a `fallback:` that isn't one
of its `delegates:`, or a delegate named twice. `installation.standardWorkerProblems()` returns the
same problems without throwing.

## Importing from a browser component

The package root is server code. The mailbox floor reaches the task board, which imports
`node:async_hooks`, so a bundler building a client component can fail on any root import it cannot
drop. A client component imports the few names a panel reads with from the `./browser` subpath:

```ts
"use client";
import {
  MAILBOX_POST_COMPONENT,
  createWorkforceClient,
  type MailboxTranscriptLine,
} from "@flow-state-dev/workforce/browser";
```

It exports `createWorkforceClient`, `deriveWorkerSessionId`, `isDerivedWorkerSessionId`,
`ROSTER_FLOW_KIND`, `WORKER_ID_STATE_KEY`, `MAILBOX_POST_COMPONENT`, `mailboxTranscriptLineSchema`,
`MailboxTranscriptLine`, `COORDINATOR_KIND`, `COORDINATOR_ROUTE` and `COORDINATOR_JUDGMENT` (the
coordinator's own turn's answer name, which its messages carry as `agentName`), the same values
the root exports, and reaches no Node built-in.

## Exports

| Export | Description |
|--------|-------------|
| `defineAgentWorkerFlow(options?)` | Build the flow behind the `agent` worker kind — `agent` is one kind of worker, and this is the flow it resolves to. With `installation` it is the copy every worker on `agent` shares: it declares the installation's session and documents, loads the turn's worker in `request.onStarted`, and refuses a turn whose input names a worker; called with factory options (`AgentWorkerFlowOptions`) it is the replacement you register under `agent`. Its flow declares `run` (public) and `onMailboxPost` (internal, for a mailbox's notify block), and with `taskLists` a `work` task entry. |
| `AGENT_KIND` | The kind name (`"agent"`) the hire step defaults to, and the key a replacement registers under. |
| `definePersona(config)` | Declare a persona resource or collection. |
| `createWorkforceCapability({ roster, inventory, sources? })` | The discovery door. Installs the seat and mailbox sources plus whatever other domains' sources you pass, and contributes one control tool, `discover`, which lists the standard workers the files declare and the mailboxes. |
| `workforceManifestSources({ roster, inventory })` | The seat and mailbox sources on their own, for an app assembling its own manifest registry. |
| `createWorkerInstallation({ standardWorkers?, workerFlows?, seatBlocks?, packageBlocks?, documents?, references?, skills?, packages? })` | The worker model's one module (see [Workers as data](#workers-as-data)). Returns `resources` and `session()` for a worker flow to spread in, the `createCheck` that names a session's worker at create, `resolveWorker(ctx, flowKind)` for each turn, `standardWorker(id)`, `workerFlows()` and `configurationProblems(id, row)`. `workerFlows` may be a function, read when first needed. |
| `installation.rosterWorker(ctx, id)` / `installation.standardWorkerProblems()` | The worker an id names on the session user's roster, read by id (`undefined` for another user's, as for a missing one); and every standard worker's configuration problems, for a load-time refusal. |
| `defineCoordinatorFlow({ installation, delegateFlows, routeModel, agent?, roundDeadlineMs? })` | The `coordinator` worker flow (see [Coordinators](#coordinators)): `run`, `addDelegate`, `removeDelegate`, `setFallback` and `listDelegates`. Its judgment is the agent's turn, built with the `agent` options. `roundDeadlineMs` is how long a round waits for its answers (five minutes by default); a value that isn't a positive whole number of milliseconds throws. |
| `delegatedPostEntry(turn)` | The internal `onDelegatedPost` entry that makes a flow's workers delegates that take posts. On a post whose answer can go back out, it also tells the coordinator when it has no answer: at once when its turn fails, and at the round's deadline while its turn is still running. The turn isn't stopped; a later answer still lands once. |
| `delegatedPostOnFinished` | A delegate flow's request `onFinished`: when a delegated post's run is cancelled before its answer went back, it tells the coordinator, so the round doesn't wait for its deadline. The built-in `agent` flow sets it. |
| `coordinatorConfigSchema()`, `coordinatorRouteRecordSchema`, `COORDINATOR_KIND`, `COORDINATOR_ROUTE` | A coordinator's configuration, its routing record, the flow's kind and the record's component name. |
| `workerFlow(build, { standardOnly? })` | A worker flow built on its installation, for a flow in its own file: the installation calls `build(installation)` once. Goes in `workerFlows`, and is what `fsdev gen`'s `kinds` holds. |
| `inventorySeats(installation)` | The standard workers as `openInventory` takes seats: each worker's id, its flow and that flow's actions. |
| `workerConfigOf(ctx)` | The configuration of the worker the turn loaded, synchronously, for a prompt, a tool list or a step condition. Throws when the turn loaded no worker: call `installation.resolveWorker` in the flow's `request.onStarted`. |
| `createWorkerHireBlocks(installation)` | `{ hire, fork, edit, fire }`: writes to the caller's own roster, each checked as a turn would check it before anything is written, each refusing a standard worker's id. |
| `defineWorkerRosterFlow(installation, actions?)` | The roster flow (`workforce-roster`), which declares the two worker collections so a client reads a user's roster through one session of it. Mount the hire blocks on it as actions. |
| `createWorkforceClient({ userId, baseUrl?, apiPath?, fetcher? })` | `roster()`, `findWorkerSession({ worker, filingSessionId? })` and `ensureWorkerSession({ worker, filingSessionId? })`, over the session and resource clients. From `./browser` only. |
| `deriveWorkerSessionId({ userId, orgId, flow, criteria })` / `isDerivedWorkerSessionId(id)` | The id `ensureWorkerSession` creates a session at, and the shape a worker flow's create check reserves for the user it derives to. |
| `WorkerTurnRefusedError` | What `resolveWorker` throws when a turn can't run as the session's worker; nothing is written. |
| `defineWorkerCollection()` / `workerRowSchema` / `parseWorkerRow(value)` | The user's worker collection at `workforce/workers/*`, user scope, and its row. |
| `WORKER_ID_STATE_KEY`, `WORKERS_RESOURCE`, `STANDARD_WORKERS_RESOURCE`, `ROSTER_FLOW_KIND` | The readonly session-state field naming a session's worker (`"workerId"`), the accessors the two worker collections are declared under, and the roster flow's kind. |
| `HiredSeatOwnerPin` | Another name for core's `InstanceOwnerPin`: `{ orgId, userId? }`, with `userId` present only for a user-owned hire row. Either name works wherever the other is expected. |
| `SEAT_DISCOVER_KEY` | The pinned worker-file key, `"discover"` — the domains one seat sees, out of what its scope carries. Narrows only: a seat can never reach a domain the app did not install. |
| `readDeclaredRoster(root)` | Read the whole tree in one call — workers with their skills and packages in reach, teams, documents and mailboxes — plus one list of everything that failed to load, each entry tagged with the layer that reported it. Collects rather than throws, so the boot policy stays yours. Ships from the `./loader` subpath (Node only). |
| `readWorkforce(root)` | Read the tree into worker records that already carry their own skills and the packages in their reach — `readWorkforceDirectory` joined with `readSeatSkills` per seat and `readPackagesDirectory`. Returns `{ workers, errors, skillErrors, teams, teamErrors, packageErrors }`. Reach for it when seats are all you need. Ships from the `./loader` subpath (Node only). |
| `readWorkforceDirectory(root)` | Read every `org/workers/<name>/` and `teams/<id>/workers/<name>/` folder into one `WorkerManifest` per worker, org seats first, without their skills. Ships from the `./loader` subpath (Node only). |
| `readPackagesDirectory(root)` | Read every `packages/<name>/PACKAGE.md` at the org, team and worker levels into one `PackageManifest` each, returning `{ packages, errors }`. Ships from the `./loader` subpath (Node only). |
| `readSeatSkills(root, { team, worker })` | Read one worker's skills across the org, team and worker levels into `InitialSkill[]`. Leave `team` out for an org seat: it reads `org/skills` and `org/workers/<worker>/skills`. Ships from the `./loader` subpath (Node only). |
| `parseDeclaredSeatId(id)` | Read a declared seat's id back into its folders: `"<name>"` is an org seat, `{ name }`; `"<teamId>.<name>"` a team seat, `{ team, name }`. `undefined` for an id that matches neither shape. For a runtime-hired seat, pass `seatId`, not `id`: its `id` is the `<orgId>.<seatId>` address, which would parse as a team seat. Ships from the package root. |
| `openRoot(root)` / `walkTeams(root, report)` | The walk every reader above shares: open the configured root (throwing on a symlinked or unreadable one, with or without a trailing separator, and on one spelled with a `..` that steps back through an earlier segment — pass the path it resolves to; a `.` segment and anything above the root are not checked), then enumerate `teams/`, reporting a team folder that is refused or unreadable and yielding the rest. `report` may be `async` and is awaited before the walk moves on. What a reader does *inside* a team stays its own. Ships from the `./loader` subpath (Node only). |
| `classify(path)` / `openStructuralDirectory(path, reportAs)` | One path's kind without following symlinks, and one structural folder's entries — or the reason the walk stops there, or neither when it is simply absent. Ships from the `./loader` subpath (Node only). |
| `refusedSymlink(what, name)` / `unreadable(what, name, cause)` / `IGNORED_ENTRIES` | The one wording for each refusal, and the one set of names that never denote anything in the tree — a `ReadonlySet` that cannot be written to, since every reader in the process reads it. Ships from the `./loader` subpath (Node only). |
| `validateSegment(segment, label)` | The one rule for what a name in this tree may be — lowercase letters, digits and single hyphens, under 64 characters, not reserved. Throws naming the segment and what it would have become. Ships from the `./loader` subpath (Node only). |
| `discoverWorkforceCode(root)` | Walk `flows/workers/`, `flows/mailboxes/` and `blocks/` one level deep, every `resources/` folder the convention reads, every `blocks/` folder inside the team tree, and every package's `blocks/` folder, returning what they hold on `files`, `resourceModules`, `seatBlocks` and `packageBlocks` — each ordered by path — plus the `searched` patterns. Reads the tree only — it opens none of the modules it finds. Throws a `WorkforceCodeError` carrying every refusal. Ships from the `./codegen` subpath (Node only). |
| `findPreRenameMarks(store, { mailboxIds, orgIds })` | Read a store for what marks it as written before the rename: any session on the old built-in kind, a listed mailbox whose request history holds an old item (read page by page, all of it), an organization holding inventory rows under the old key. Returns `{ sessions, organizations }`, both empty for a store that is not old. Reads only. Keyed on the store rather than the kind, since a custom kind kept its name. For a host's boot check before `openMailboxes`. |
| `describePreRenameMarks(marks)` | The marks above as one clause for a boot message ("written before … : mailbox "…" (…)"). The host adds what to do about it. |
| `PRE_RENAME_NAMES` | The names the rename retired, frozen: record file and folder, kinds folder, kind, item components, inventory prefix and discovery domain. For recognising old data and seeding tests, never for reading it. |
| `renderWorkforceCode(files, modules, seatBlocks?, packageBlocks?)` | Render a discovery's `files`, `resourceModules`, `seatBlocks` and `packageBlocks` as a module of static imports exporting `kinds`, `mailboxKinds`, `blocks`, `resourceModules`, `seatBlocks` and `packageBlocks`. Pass all four: the last two default to `[]`, so omitting one renders an empty map and reports nothing. Deterministic: the same tree renders the same bytes. `fsdev gen` is a thin command over this and the call above. Ships from the `./codegen` subpath. |
| `hireWorkforce(installation, { mailboxBoards? })` | The flows to register for an installation: one copy of each worker flow, at its kind, and the roster flow (`workforce-roster`) with `hire`, `fork`, `edit` and `fire`. Throws, naming every problem, when a worker flow misses the contract or doesn't declare the installation's session, or when a standard worker would be refused on its first turn; nothing is registered. With `mailboxBoards`, warns once per process for a board no registered flow declares. |
| `mergeSeatFlows(flows, seats)` | Add the flows `hireWorkforce` returned to your app's flows record under their ids, for `createFlowState({ flows })`. Throws, naming the id, when one is already in `flows`. |
| `unattendedBoardWarnings(boardIds, seats)` | The unattended-board warning strings `hireWorkforce` prints. The `hire` tool puts the same sentences on `warning` when a named board has no seat that declares it. |
| `workerFlowProblems(name, flow)` | Every way `flow`, registered as `name`, misses the worker contract: a name that is not its `kind`, a configuration it refuses by key or by value, or takes but rewrites, no door or two, a resource with `writtenBy` that `sharedResource()` didn't build. An empty list for a worker flow. The check `hireWorkforce` runs, exported for a library's own tests. |
| `sharedResource(pattern, shape)` | An org-scoped collection whose every entry carries a required `writtenBy: { userId, workerId? }` beside the fields of `shape`. An entry written without it is refused by the resource's own schema. The only way to declare a resource with `writtenBy` on a worker flow: the contract refuses one defined by hand, or a copy of this one with its schema replaced. |
| `writeShared(ctx, accessor, key, data)` / `WrittenBy` | Write one entry of a shared resource, creating or replacing it, stamped with the session's user and, when the turn loaded the session's worker with `resolveWorker`, that worker's id. A `writtenBy` in `data` is ignored, and so are a `seatId` setting and a `workerId` in the session's state: a turn that loaded no worker records the user alone. Flow code that writes the resource directly can set its own value, so `writtenBy` is as trustworthy as the registered flow's code; it is for display and audit, never for deciding who may write. |
| `workerConfigSchema()` | The admission contract every hireable worker kind composes: `configSchema: workerConfigSchema().extend({ ...its own settings })`. Declares `instructions?`, `teamInstructions?`, `seatSkills`, `seatTools`, `seatPackages?` and `seatId`. A kind whose schema cannot take what hiring imposes refuses the whole roster at startup. A fresh schema per call. |
| `seatPackageSchema` | One held package as it rides into the bag — `{ name, path, instructions?, tools }`, closed. The shape `seatPackages` is an array of. |
| `seatSkillSchema` | One skill as it rides into the bag — `{ name, skillMd, files? }`, closed. The shape `seatSkills` is an array of; reach for it when declaring your own variant of that key. |
| `WorkerConfig` | The parsed shape of `workerConfigSchema()` — what every hireable kind receives, whatever else it extends on. |
| `readResourcesDirectory(root)` | Read every `resources/` folder in the tree — org, team, and each worker's own — into one `ResourceDoc` per document. Ships from the `./loader` subpath (Node only). |
| `resourcesFromDocs(documents)` | Turn document records into the flow resource map, keyed by each document's ref. Spread it into your own `resources`. |
| `readReferencesDirectory(root)` | Read every `references/` folder in the tree — org, team, and each worker's own — into one `ResourceDoc` per document, each carrying its `filePath`. Same result shape and same error kinds as `readResourcesDirectory`. Ships from the `./loader` subpath (Node only). |
| `referencesFromDocs(references)` | Turn reference records into the flow resource map, keyed by ref. Each entry is served from its file and is read-only. Throws naming the ref for a record with no `filePath`. |
| `clearShadowedReferences(input)` / `describeShadowedReferences(result)` | Clear the stored rows left behind when a document moves from `resources/` to `references/`, for one org, and render the result as one log line. Takes `{ references, orgId, content, installedOn, dryRun? }`; returns `{ cleared, checked, dryRun, scopeId }`. |
| `splitResourceModules(resourceModules)` | Split the generated map into `{ capabilities, resources }` — the capabilities a worker kind installs through `uses`, and the resources that merge into the one resource map. Installs nothing: you pass both on, at your own call site. Throws naming the ref when an entry can be neither. |
| `DeclaredRoster` / `DeclaredProblem` | What `readDeclaredRoster` returns: `{ workers, teams, documents, references, mailboxes, problems }`, and one problem: `{ layer, path, error, worker? }`, where `layer` is `worker`, `skill`, `team`, `package`, `document`, `reference` or `mailbox`. |
| `WorkerManifest` | One worker record: `{ id, declared, body, skills?, teamInstructions?, packages? }`. |
| `PackageManifest` | One package record: `{ name, path, level, team?, worker?, description, instructions? }`, where `level` is `org`, `team` or `worker` and `path` is the key its blocks sit under on `packageBlocks`. |
| `ResourceDoc` | One document record: `{ ref, declared, body, filePath? }`. |
| `mintResourceRef(teamId, workerName, name)` | The one rule that names a resource, whichever door read it — the ref a document or a module called `name` in that folder gets. Throws naming the segment that breaks the rules. Ships from the `./loader` subpath (Node only). |
| `ResourceModules` | The generated `resourceModules` map: one entry per discovered module, keyed by its ref. |
| `ResourceModuleExport` / `WorkerResourceModuleExport` | What a module in the organisation's or a team's `resources/` folder may be — a capability or a resource — and the narrower type a worker's own folder is held to: a resource, never a capability. |
| `SeatCapabilitySelection` | What a worker file's `capabilities:` key parses to — capability name to the presets that seat wants. Read by the built-in `agent` kind; validated at the hire. |
| `defineMailboxFlow(options?)` | Build a mailbox kind. `options.notify` is the per-member fan-out block. `options.route` is the route from `routeByPurpose`. `options.checkAssignee(assignee, listId, ctx)` runs before `fileTask` files a row naming an assignee: return `undefined` to file it, or the sentence to refuse with (`unknown-assignee`). Pass `createWorkerLookup(...).filingCheck(aliases)`. |
| `wakeMemberSeats(flows, { installation?, fallback? })` | The notify block for `defineMailboxFlow({ notify })`. Wakes each member that names a standard worker on a flow declaring `onMailboxPost`, once per post, in that worker's own conversation per mailbox, and never on a worker's line. |
| `routeByPurpose(seats, { model })` | The route a mailbox kind takes as `defineMailboxFlow({ route })`. For a mailbox that declares `routing:`, each client `post` goes to one member: the member the last client `post` was routed to, until it answers (a held post holds nothing), else one evaluator call's pick among the members with a description (block name `mailbox-route`), else the declared fallback. A seat's line (`seatAuthored: true`) is not routed. A member of the built-in `agent` kind answers with the mailbox's last 20 lines in view, and its reply is posted into the mailbox as its line, once per post. Needs in-process dispatch or queue workers that share a lease backend. Throws without a `model`. |
| `mailboxRouteRecordSchema` / `MailboxRouteRecord` / `MAILBOX_ROUTE_COMPONENT` / `MAILBOX_ROUTE_EVALUATOR` | One route decision as it is kept on the mailbox's session (`{ postId, by, member?, reason? }`, where `by` is `held`, `evaluated`, `fallback` or `failed`), the component name it is kept under, and the route evaluator's block name. Both names are `"mailbox-route"`. |
| `MailboxRoute` / `MailboxRouting` | What `routeByPurpose` returns, and a mailbox file's `routing:` as read (`{ fallback }`). |
| `mailboxFlow` | The built-in mailbox kind, seeded by `mailboxInstances` when you register none. |
| `mailboxInstances(manifests, { kinds?, inventory?, resources? })` | Build time. One `FlowInstance` per distinct kind across the roster, the built-in seeded. Pass `inventory: true` to install the registration actions and the three inventory collections on the built-in mailbox kind. Pass the org's resource map as `resources` to read project talk templates (see [Projects](#projects)); with a template registered, the `mailbox` kind is returned holding it even when no mailbox runs on it. Register these. |
| `defineProjectsCollection({ talk? })` | The organization's `projects` collection: org-scoped, shared across flows, browser-readable through `expose`. `talk` is the org-level talk template: the first one declared stands, the same one again is a no-op, and a different one throws. You can call `defineProjectsCollection()` anywhere you need it. Every call returns the same declaration, so they never conflict. `defineRoomLinesCollection`, `defineRoomSeqCollection` and `defineWorkstreamClaimsCollection` declare the room and the claims; none has a browser read. |
| `projectWritesMailboxInventory` | The mailbox inventory declaration the project writes read. A flow that installs the writes and reads the inventory itself declares that read with this object, under any accessor; its own `defineMailboxInventoryCollection()` there is a resource collision when the flow is built. |
| `defineProjectBlocks()` | Returns `{ createProject, setWorkstreams, actions }`. See [Projects](#projects). A created project's `bind` is dispatched to the built-in `mailbox` kind. |
| `projectWorkspace({ board })` / `projectWorkspaceCapability` | A run source for a coding run on a project's mailbox board, and the capability holding the collections it reads. See [Projects](#projects). |
| `openMailboxes(manifests, { client, userId })` | Runtime. One named session per record, carrying its members, charter and description. The server binds each session's organization. Idempotent. |
| `readMailboxesDirectory(root)` | Read a `teams/<id>/mailboxes/<name>/` tree into one `MailboxManifest` per mailbox. Ships from the `./loader` subpath (Node only). |
| `MailboxManifest` | One mailbox record: `{ id, declared, body }`. |
| `mailboxBoard(mailboxId, boardName)` | The one declaration for a mailbox's board, carrying its minted `id`. Pass it to `taskBoard({ collection })`, and to `mailboxBoardTaskTools`. Throws when the name is not a plain local name. |
| `mailboxBoardTaskTools(board)` | Capability granting a seat all eight task tools over one mailbox board, board-qualified by name. List it in the seat kind's `uses`; it declares the ledger too. |
| `mailboxBoardIds(manifests)` | Every minted id across a roster, sorted and deduped — what `hireWorkforce`'s `mailboxBoards` and `defineAgentWorkerFlow`'s `taskLists` take. |
| `mailboxTaskLists(boardIds, { allowSessionState? })` | A `TaskBinding` for a task entry's `from`: the entry takes tasks from any of these mailbox boards, resolved in the running organization. A board id outside the list is refused `UnknownTaskLedgerError`. |
| `createWorkerLookup({ installation })` | Which standard worker a task's name means. Returns `{ find, flowKind, state, filingCheck }`; see [Handing a row to the worker it names](#handing-a-row-to-the-worker-it-names). |
| `WORKER_TASK_ENTRY` | `"work"`, the task entry a worker kind takes tasks through. |
| `MailboxBoardCollection` | A `DefinedTaskCollection` carrying its minted `id`. |
| `mailboxBoardRowSchema` | One row as `readBoard` publishes it: the board's facts and the `run` working the task, without the claim's coordinates (`claimedBy`, the lease) or write provenance. |
| `mailboxFileTaskInputSchema` / `mailboxFileTaskOutputSchema` / `mailboxReadBoardInputSchema` / `mailboxReadBoardOutputSchema` | The `fileTask` and `readBoard` contracts. |
| `MailboxPostRefusedError` | A post or filing refused on the mailbox's own terms; `reason` is `mailbox-not-bound`, `author-not-a-member`, `board-not-declared`, `board-needs-an-org`, `mailbox-is-a-template` or `unknown-assignee`. |
| `mailboxPostInputSchema` / `mailboxReadOutputSchema` / `mailboxNotifyInputSchema` | The post, read and notify contracts. |
| `mailboxSessionStateSchema` / `mailboxTranscriptLineSchema` | A mailbox session's state, and one transcript line. On a kind built with a route, a mailbox's state also carries `mailboxRouteLedger`, which this schema does not describe. |
| `MAILBOX_POST_COMPONENT` / `emitMailboxPostLine(ctx, line)` / `readMailboxPostLines(ctx, schema)` | The component name a post's line is kept under; keep a line as that item, resolving once it is stored and rejecting if the write fails; read the posted lines in the history window back, parsed by the kind's own line schema. For a mailbox kind of your own. |
| `HiredRosterReload` / `HiredRosterOrgReload` / `HiredRosterStores` / `ReloadHiredSeatsOptions` / `RowProblem` | What the reload returns, one organization's share of it, the slice of the runtime's stores it reads through, its options, and the `{ problem }` shape a row that could not be read comes back as. |
| `defineSeatInventoryCollection()` | The seat inventory: one org-scoped row per registered seat, at `inventory/seats/<seatId>`. Takes no options; install what it returns under a block's `resources`. |
| `defineMailboxInventoryCollection()` | The mailbox inventory: one org-scoped row per registered mailbox, at `inventory/mailboxes/<mailboxId>`, carrying the mailbox's `members` and `openedAt`. Takes no options. |
| `defineMembershipIndexCollection()` | The membership index: one org-scoped row per seat-in-mailbox, at `inventory/members/<seatId>/<mailboxId>`, so one seat's mailboxes can be listed by prefix. Takes no options. |
| `membershipKey(seatId, mailboxId)` | The membership index key for one row, relative to the collection's prefix. Throws when either id is not one whole path segment. |
| `membershipPrefix(seatId)` | The prefix that lists one seat's memberships, trailing slash included, relative to the collection's prefix. Refuses the same ids `membershipKey` does. |
| `SeatInventoryRow` / `MailboxInventoryRow` / `MembershipIndexRow` | One row of each of the three collections. |
| `seatInventoryRowSchema` / `mailboxInventoryRowSchema` / `membershipIndexRowSchema` | The Zod schema behind each row type. Closed: an undeclared key is dropped on the way in. |
| `openInventory(roster, options)` | Write the inventory at boot: one row per seat, one row per mailbox, one row per membership. Takes `InventoryRoster` (the seats and mailboxes to register) and `OpenInventoryOptions` (the `run` callback, `seatWriter`, `userId`, `orgId`). Returns `{ seats, mailboxes, problems }`. |
| `inventoryWriterActions(kind)` | The three blocks a custom mailbox kind installs to get inventory rows, keyed by action name. Split them: `registerMailboxInInventory` into `actions` (public, safe — empty input); `registerSeatsInInventory` and `retireMailboxesInInventory` into `internal.actions` (their input is row data or ids to remove, with nothing to check it against). The string is the `kind` value those rows carry. |
| `INVENTORY_REGISTER_MAILBOX` / `INVENTORY_REGISTER_SEATS` / `INVENTORY_RETIRE_MAILBOXES` | The action names the writer runs: `"registerMailboxInInventory"`, `"registerSeatsInInventory"` and `"retireMailboxesInInventory"`. |
| `INVENTORY_SEAT_WRITER_SESSION` | The session id the seat-registration action runs under when `seatWriter` names none: `"inventory-binder"`. |
| `InventoryRoster` / `InventorySeat` / `InventorySeatWriter` | What `openInventory` takes: the roster (`{ seats, mailboxes }`), one seat (`{ id, kind, actions, config? }`: a hired seat as is, its `door` action read from `actions`, `{}` for a seat with none; its row's `hired` read from `config.seatId`, `null` without `config`), and which flow writes the seat rows (`{ flowKind }`). |
| `InventoryActionRequest` / `InventoryBinding` | What the `run` callback receives (`{ action, input, userId, orgId, flowKind, sessionId, source? }` — `source` is `"internal"` on the seat request and must reach `runAction`), and what one boot of `openInventory` returns (`{ seats, mailboxes, problems }`). |
| `OpenInventoryOptions` | The options `openInventory` takes: `run`, `seatWriter`, `userId`, `orgId`. |
| `seatDoorOf(seat)` / `SeatDoor` | A hired seat's door: the one public action its kind declares with `userMessage` and a `{ message }` input. Returns `{ door, problem? }`. `door` is the action name, or `null` when the kind has none or more than one. `problem` is set when there are two or more, and names them. `openInventory` writes it on the seat's row. A worker flow with none or two is refused when hired, so a hired seat always has one. |

## Error Semantics

| Error | When |
|-------|------|
| Two sources claiming one discovery domain | `createWorkforceCapability` construction, naming both registration sites |
| A worker file's `discover:` names something that is not one of the four domains | The mint, by name, listing `seats`, `mailboxes`, `skills`, `resources`. A correctly spelled domain the scope does not carry is *not* an error — the seat simply sees nothing for it |
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
| Worker flow misses the contract | `hireWorkforce`, before anything is registered — a flow passed under a key that is not its own kind, a configuration it refuses by key or by value, or takes but rewrites (composing `workerConfigSchema()` is the fix), no door or two, no installation session, or a resource with `writtenBy` that `sharedResource()` didn't build. Collected: one error names every problem with every flow, and nothing is hired |
| Worker cannot run | For a standard worker, `hireWorkforce`; for a user's own worker, the `hire`, `fork` or `edit` that saves it, and its turn — an empty or whitespace-only `flow`, an unknown flow, a user's own worker naming a flow marked `standardOnly` (or naming none, when `agent` is marked), a duplicate standard id (`createWorkerInstallation`), a setting or body the flow never declared, a `tools:` name nothing registers for that seat, a registered block whose key and own `name` disagree, a block in a worker's own folder that declares a resource, a skill name reaching one seat from both the app's `skills` and its own folders, a `resources:` list the hire step cannot resolve (a `resources:` that is not a list, an entry that is neither a ref nor a one-key `ref: mode` mapping, a ref no document matches, a ref naming a document the app declared but did not install on this worker's flow, a mode other than `ro` or `rw`, the same ref twice, `rw` on a document declaring itself `writable: false`, a ref colliding with a name the kind's own blocks declare, a ref the kind declares at flow level while what it holds there is not that document, or the key itself with no `documents` passed), a document a worker did not name that the worker's flow reaches anyway because one of the kind's blocks declares it, a `references:` list the hire step cannot resolve (a `references:` that is not a list, an entry that is not a ref, the same ref twice, or a ref naming a reference this seat cannot reach from its place in the tree — including every ref when no `references` map was passed), a seat id that names no place in the tree while its kind holds references, a reference the worker did not name that the worker's flow reaches anyway, `instructions` given both in the frontmatter and as a body, a `packages:` list the hire step cannot resolve (not a list of names, a name no library in reach offers, or a name both its own folder and a library offer), a held package's block that clashes with another tool the seat can call, registers under a name other than its own, or declares a store, a package with blocks in its own folder that failed to load, or a `persona:`, `seatSkills:`, `seatTools:`, `seatPackages:`, `seatId:` or `teamInstructions:` key. Collected: one error names every bad worker |
| A roster write refused | The `hire`, `fork`, `edit` or `fire` block: a standard worker's id (suggesting a fork), an id already on the caller's roster, a worker that isn't the caller's, a flow that isn't a worker flow or is kept for standard workers, or a configuration its flow refuses. Nothing is written. |
| A turn on a session whose worker can't run | `resolveWorker` throws `WorkerTurnRefusedError`, naming the worker: fired, moved to another flow, a name that no longer resolves, or a flow now kept for standard workers. Nothing is written; the session stays readable. |
| Package folder fails to load | Collected in `readPackagesDirectory`'s and `readWorkforce`'s `packageErrors` as `kind: "package-load-failed"` (a symlinked or badly named folder, or a missing, unreadable or malformed `PACKAGE.md`), `"refused-entry"` (a file in `packages/`, or a documents, skills or packages folder or a symlink inside a package), or `"unreadable-slot"`, keyed by the path. The package is left out whole |
| Package block clashes with a preset tool built per turn | That turn fails with a "two tools named" error |
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
| One ref passed to `createWorkerInstallation` as both a document and a reference | Refused before anything is registered, naming every ref in both maps |
| A reference row cannot be addressed | `clearShadowedReferences` throws when the org id — or, for a flow that isolates its org scope, the flow id — contains `:` or a backslash |
| A `mailboxes/` slot, `teams/` or a team folder unreadable or symlinked | Collected in `readMailboxesDirectory`'s `errors` as `kind: "unreadable-slot"`, keyed by that folder's path — an absent folder is empty instead |
| Mailbox folder fails to load | Collected in `readMailboxesDirectory`'s `errors` as `kind: "mailbox-load-failed"`, keyed by the folder's path — an unusable name, a symlink, or a missing, unreadable or malformed `MAILBOX.md` |
| `system:` in a `MAILBOX.md` | Collected in `readMailboxesDirectory`'s `errors` as `kind: "refused-declaration"`, keyed by the mailbox folder's path |
| A record file or records folder under its name from before the rename | Collected in `readMailboxesDirectory`'s `errors` as `kind: "pre-rename-record"`, one per old file (or one for a folder holding none), keyed by the old path and naming where it belongs now. Never read as a mailbox |
| The kinds folder from before the rename, or a kind file named for the built-in's name from before it | `discoverWorkforceCode` refuses it by name in its `WorkforceCodeError`, so `fsdev gen` generates nothing. A session on that name would read as old data |
| Workforce root unreadable or symlinked, read for mailboxes | `readMailboxesDirectory` throws — the root is never followed through a link |
| Mailbox cannot be bound | `mailboxInstances` — a `flow:` naming a kind nobody passed, a kind filed under another kind's key, a duplicate id, an `id:`, a `system:`, an undeclared key, a `members:` that is not a list of names, a `boards:` that is not a list of plain names, a board name carrying a dot or declared twice, a minted board id two mailboxes would share, `boards:` on a custom kind that does not support them, or a `kinds` key that is the built-in's name from before the rename (refused before anything else). Also `instructions:` given both in the frontmatter and as a body. For a talk template (`mintFor:`, or the org default): `boards:`, `routing:` or `boardActions:` on it, a `mintFor:` naming no collection in `resources` or one other than the projects collection, a seat that is not a seat id or is listed twice, a kind filed under another kind's key or one `defineMailboxFlow` did not build, seats on a kind with no `notify` block, or a second template for the collection. Collected: one error names every bad mailbox, and nothing is registered |
| Mailbox cannot be opened | `openMailboxes` throws, naming the mailbox — except a 409, which means the id is taken. An open mailbox there is left alone, and this kind's own empty session is bound. Anything else holding the id — another flow's session, another user's, or one carrying state that is not a readable mailbox — is named and refused rather than released. A session of the kind from before the rename is refused as a store to reset, never as a collision |
| `mailbox-not-bound` | A `post` or `read` naming a session nobody opened. Per-request; nothing is written and the session stays inert |
| `author-not-a-member` | A `post` claiming an `author` outside the mailbox's declared members. Per-request; nothing is written |
| `unknown-assignee` | A `fileTask` naming an assignee the mailbox kind's `checkAssignee` refuses: no worker holds the name, two do, or its kind takes no tasks. Per-request; nothing is written |
| `external-dispatcher` | A flow-to-flow post into an opened mailbox on a host whose dispatcher hands work to an external queue and shares no lease backend. A post through the public action route is written, but its notify block never runs: no member is woken and a routed mailbox doesn't answer |
| Inventory id is not one path segment | `membershipKey` and `membershipPrefix` throw, naming the offending argument: an empty id, one containing `/` or `\`, or `.` and `..` |
| Inventory write with no org | `openInventory` throws before writing anything — the three collections are org-scoped |
| Seat inventory write with no seatWriter | `openInventory` throws when passed seats and no `seatWriter` — a seat has no session of its own, so its row needs a flow to run in |
| Mailbox or seat registration failed | Collected in `openInventory`'s `problems`: a mailbox whose session is not open, whose kind declares no registration action, or whose action failed; a seat write that failed. The rest of the roster is still attempted |

## Scripts

```bash
pnpm --filter @flow-state-dev/workforce build
pnpm --filter @flow-state-dev/workforce typecheck
pnpm --filter @flow-state-dev/workforce test
```
