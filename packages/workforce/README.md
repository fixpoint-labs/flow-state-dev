# @flow-state-dev/workforce

The worker factory for flow-state-dev.

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
model: openai/gpt-6-luna
---
You are the engineering lead. You break work into tasks and report what came back.
```

`readDeclaredRoster` reads that tree — every worker, team and document declared in it —
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

const fsd = createClient({ userId, baseUrl });
const workforce = createWorkforceClient(fsd);
const session = await workforce.ensureWorkerSession({ worker: "engineering.lead" });
await fsd.flow(session.flowKind).send("respond", { message }, { sessionId: session.id });
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
declare. A turn reads it from `installation.resolveWorker(ctx, flowKind).config`. One roster can mix
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
worker's `WORKER.md`, and returns one record per worker. `readWorkforce` wraps it, joining each worker's resolved skills, its
team's instructions and the [packages](#packages-from-files) in its reach onto the records it hands back.
An org worker has no team, so its record carries no `teamInstructions`, and its skills come from two
levels, the org's and its own.

```ts
import { readWorkforceDirectory } from "@flow-state-dev/workforce/loader";

const { workers, errors } = await readWorkforceDirectory("./workforce");
if (errors.length) throw new Error(`workforce: ${errors.length} worker(s) failed to load`);
```

Each record is plain data:

| Field | Description |
|-------|-------------|
| `id` | The worker's whole identity, `"<teamId>.<workerName>"` — e.g. `"engineering.lead"`. An org worker's id is its folder name alone, with no dot: `org/workers/shift-coordinator/` is `"shift-coordinator"`, a different worker from `"engineering.shift-coordinator"`. `parseDeclaredWorkerId` reads either shape back. |
| `declared` | The frontmatter exactly as written. Keys are not checked against a list, beyond a required `description` and six refused ones: `persona:`, `workerSkills:`, `workerTools:`, `workerPackages:`, `workerId:` and `teamInstructions:`. |
| `body` | The Markdown below the frontmatter, verbatim. Empty when the worker has no instructions. |

`description` is the only required setting in a `WORKER.md`. Team and worker folder names must be
lowercase letters, digits and single hyphens, at most 64 characters.

An org worker, under `org/workers/<name>/`, is one worker the whole organization shares rather
than a member of a team. Its folder is a worker slot like a team's, so one with no `WORKER.md` is
reported in `errors`. An org worker reads the org's skills, packages and references, then its own folder's;
no team level reaches it, and no `TEAM.md` instructions.

A `WORKER.md` may also carry `resources:`, a list of the [file-declared
documents](#reading-documents-from-files) that worker may touch. The loader carries it through onto `declared` untouched, the way it carries every key it does
not name; [the hire step](#the-documents-a-worker-may-touch) is where a ref meets the documents it
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
| `errors` | One entry per worker slot that failed: a worker the app does not have. |
| `skillErrors` | One entry per worker whose skills loaded short, carrying that worker's id and its own error list. |

All three are collected rather than thrown. Treating any of them as fatal is the caller's call.
`errors` and `teamErrors` are flat `{ path, error, kind }` lists, where `kind` is that reader's own
closed union of conditions — narrow on it rather than matching `error.message`. `skillErrors` is one
entry per affected worker, `{ worker, errors }`, so it needs flattening before it reads like the other
two.

A `TEAM.md` refuses `id:`, `flow:`, `instructions:` and `teamInstructions:` — the first two because
the convention derives them, the last two because the body is already the instructions.

A hired worker then receives **two** instruction settings, never merged: `instructions` (its own
body) and `teamInstructions` (its team's). Both are absent rather than empty when there are none.
The [built-in worker flow](../../docs/architecture/workforce-default-worker-flow.md) composes them
into its prompt in a fixed order — the team's first, the worker's own last.

The reader builds nothing: no flow, no agent, no registry entry. It throws only when `root` itself
cannot be read or is a symlink — a folder that produces no worker lands in `errors`, keyed by its
path, and every other worker still loads. Treat a non-empty `errors` as fatal at startup unless you
have a reason to run a short roster.

The subpath is separate because the reader imports `node:fs`. The package root is server-only too:
it reaches Node built-ins through the packages it builds on. A browser component imports from
[`./browser`](#importing-from-a-browser-component).

## Reading one worker's skills

A skill is a folder with a `SKILL.md` in it. In a workforce tree, a team worker's skills are spread
across three folders: the org's, its team's, and any sitting beside the worker itself. An org worker (`org/workers/<worker>/`) has no team, so it reads two: the org's `org/skills/` and its own `org/workers/<worker>/skills/`.

```
workforce/org/skills/triage/SKILL.md
workforce/teams/pentest/skills/port-scan/SKILL.md
workforce/teams/pentest/skills/review/SKILL.md
workforce/teams/audit/skills/review/SKILL.md            # a different `review`
workforce/teams/pentest/workers/recon/WORKER.md
workforce/teams/pentest/workers/recon/skills/sweep/SKILL.md
```

`readWorkerSkills` reads them for one worker and returns the records `initialSkills` takes. Pass `team`
for a team worker; leave it out for an org worker.

```ts
import { readWorkerSkills } from "@flow-state-dev/workforce/loader";

const { skills, errors } = await readWorkerSkills("./workforce", {
  team: "pentest",
  worker: "recon",
});
if (errors.length) throw new Error(`skills: ${errors.length} entries failed to load`);

skills.map((s) => s.name).sort(); // ["port-scan", "review", "sweep", "triage"]
```

Every skill folder at those levels is read. Nothing has to be listed anywhere for a skill
to be included.

The set comes back level by level: the org's first, then the team's (for a team worker), then the worker's own. Each
entry is `{ name, skillMd, files }`, the same record `readSkillsDirectory` returns — `name` is the
folder name, bare, with no team prefix.

Two calls naming different teams read different folders. Each result holds only what its own
call read:

```ts
const recon = await readWorkerSkills("./workforce", { team: "pentest", worker: "recon" });
const clerk = await readWorkerSkills("./workforce", { team: "audit", worker: "clerk" });
// recon.skills has pentest's `review`; clerk.skills has audit's. Neither carries the other.
```

One name reaching a single worker from more than one of its levels is refused. Every level
counts, so on a team worker a collision can span two of them or all three:

```ts
errors;
// [{ kind: "duplicate-skill-name",
//    path: "org/skills/triage",
//    paths: [
//      "org/skills/triage",
//      "teams/pentest/skills/triage",
//      "teams/pentest/workers/recon/skills/triage",
//    ],
//    error: Error('Skill "triage" reaches worker "recon" from 3 levels — org/skills/triage
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
there and be missing from a worker's set. Drop the key and both readers agree.

The reader registers nothing and starts nothing. Wiring the records into a running worker is the
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
| `problems` | Everything that did not load. Empty for a tree that loads cleanly. |

Each list arrives in tree order.

Each record's `skills` reaches the built-in `agent` worker flow as its `workerSkills` setting, imposed by
the hire step the way a body is imposed as `instructions`. A `WORKER.md` declaring `workerSkills:`
itself is refused by name at both the loader and the hire step — where a skill folder sits is
what decides who can see it.

For workers alone, without documents, read the worker half with
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
//                  `description`') }]
```

`layer` is one of `worker`, `skill`, `team`, `package`, `document` or `reference`, and
the entries arrive in that order: worker slots, then each worker's skills, then team files, then
packages, then documents, then references, and last a `reference` entry per basename claimed in both slots. `path`
is the path that failed, relative to the root. `error` is the original `Error`, `cause` chain
intact.

`worker` is set on the `skill` layer and nowhere else. A skills level that several workers read fails
once per worker that read it, each entry naming its worker.

An entry carries no `kind`. To branch on one exact condition, call that layer's own reader and
match on the codes under [Error Semantics](#error-semantics).

Nothing here decides what is fatal. Refuse the boot on any problem, or on the layers you care
about:

```ts
const missingWorkers = roster.problems.filter((p) => p.layer === "worker");
if (missingWorkers.length) {
  throw new Error(`workforce: no worker at ${missingWorkers.map((p) => p.path).join(", ")}`);
}
```

It throws on the root and nothing else: a path that cannot be read, a path that is a symlink, or
one spelled with an interior `..` that steps back through an earlier segment (pass the path that
resolves to). Everything below the root is collected, including a team, worker or document
whose name breaks the naming rules.

## Hiring a workforce

`createWorkerInstallation` takes the standard workers and the worker flows your app defined, and
`hireWorkforce` gives back the flows to register: **one copy of each worker flow**, at the flow's own
flow kind, and the roster flow (`workforce-roster`). Every worker on a flow shares its one copy. A hire,
fork or fire is a write to the user's data. Every process sees it on the next turn.

```ts
import { createWorkerInstallation, hireWorkforce, type WorkerManifest } from "@flow-state-dev/workforce";

const workers: WorkerManifest[] = [
  {
    id: "engineering.lead",
    declared: { flow: "custom-agent", description: "Holds the board.", model: "openai/gpt-6-luna" },
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

A worker flow declares its **roles** where it is registered: `contributor` (takes tasks on `work`,
from `workerTaskEntry`), `manager` (files tasks for its delegates and runs its board on `dispatch`,
with `onTaskSettled`, from `defineSessionBoard`), and `coordinator` (the built-in coordinator's).
Put them on the builder, `workerFlow(build, { roles: ["manager"] })`, or on the entry,
`{ flow, roles: ["contributor"] }`. The built-in `agent` and `coordinator` declare their own. A flow
that declares none takes no tasks and files none. Every hire path (`hireWorkforce`, a reload, a
user's runtime hire) checks the roles before any worker runs: see
[What a hireable worker flow must admit](#what-a-hireable-worker-flow-must-admit).

**Upgrading a host.** A worker's door is `respond` and a board's pass is `dispatch`, on every
worker flow. Call
`upgradeWorkerEntryNames(runtime.stores, flows, { incarnationOf: resolveRequestIncarnation })`
(the last from `@flow-state-dev/engine`) once at host start, with the copies `hireWorkforce`
returned, after `getRuntime()` and before `getRouter()`, which starts the sweep that fires
wakes: a request an earlier version left unfinished under `run` (or `message`) resumes as
`respond`, and a request or wake under `runTaskBoard` as `dispatch`. It rewrites only what a
registered worker flow has under the new name and not the old, so another flow's own `run` is
untouched, and a second call finds nothing. Let a failure fail the start: a host that serves
anyway keeps records it can't resume, so Shift Manager and Kitchen Sink refuse to serve when the
call throws. Drain BullMQ queues (or let them empty) before deploying this version: a job queued
under an old action name fails.

The roster flow also keeps the user's schedules: `saveSchedule`, `deleteSchedule` and
`listSchedules` (each with its next run), and a fire through the
[scheduled-dispatch endpoint](../scheduled/README.md) files an ordinary task on the named worker's
board, as the user. `hireWorkforce(installation, { schedules: { index } })` mirrors them into a
schedule index; see [Recurring work](https://flow-state.dev/docs/workforce/delegating-work#recurring-work).

The installation reads three keys of its own: **`flow`**, which names the flow the worker runs on,
**`description`**, the roster label, and **[`resources`](#the-documents-a-worker-may-touch)**, the
documents this worker may touch. Everything else is that worker's settings, parsed against the
flow's `configSchema`. That schema is closed, so a setting the flow never declared is refused by
name: for a standard worker by `hireWorkforce`, before anything is registered, and for a user's
own worker when it is hired or edited.

A worker flow declares the installation's session (`session: installation.session()`), so every
session names its worker in a readonly `workerId`, checked when the session is created, and loads
that worker on every turn with `installation.resolveWorker(ctx, flowKind)`. `hireWorkforce` refuses a
worker flow that doesn't declare it. The same session state (`installation.sessionStateShape`)
carries `workProjectId` (`WORK_PROJECT_STATE_KEY`), the project a user set their own conversation
to work in, as `<visibility>/<id>`. Only the `setWorkProject` action writes it, and a create that
seeds it is refused with a 400 naming the field (see [Projects](#projects)).

A worker takes a user's message through its flow's **door**: the one public action the flow
declares with `userMessage` and a `{ message }` input. `openInventory` writes it on the worker's
[inventory row](#the-inventory) as `door`. Every worker flow has exactly one: a flow with none, or
with two, is refused when `hireWorkforce` checks its worker flows, naming the flow.

### The documents a worker may touch

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
import {
  createWorkerInstallation,
  MESSAGE_RECEIVED_ENTRY,
  messageReceivedEntry,
  resourcesFromDocs,
  workerConfigSchema,
  workerFlow,
  workerMessagesResources,
} from "@flow-state-dev/workforce";
import { readResourcesDirectory } from "@flow-state-dev/workforce/loader";
import { inputSchema, loadWorker, runTurn } from "./blocks";
import { boardResource } from "./resources";

const { documents } = await readResourcesDirectory("./workforce");

const customAgentFlow = workerFlow((installation) =>
  defineFlow({
    kind: "custom-agent",
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { board: boardResource, ...installation.resources, ...installation.documents, ...workerMessagesResources },
    resourceVisibility: installation.resourceVisibility,
    request: { onStarted: loadWorker(installation) }, // installation.resolveWorker(ctx, "custom-agent")
    actions: { respond: { inputSchema, block: runTurn, userMessage: (input) => input.message } },
    internal: {
      actions: { [MESSAGE_RECEIVED_ENTRY]: messageReceivedEntry({ installation, flowKind: "custom-agent" }) },
    },
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
`writable: false`, a ref colliding with a name the worker flow's own blocks already declare, and a ref the
flow does declare at flow level while what it holds there is not the document the app passed.

One more is checked on the worker's configuration rather than on the list: if a document the worker
did **not** name is reachable anyway — because one of the flow's blocks declares that same
document — it is refused, naming the ref and the flow. Keep such a document at flow level and let
the block reach it from there, or grant it to the worker deliberately.

`resources:` never reaches the flow's settings. It is the installation's key, like `flow` and
`description`, so a flow that declares a `resources` setting of its own does not receive one from a
file.

`references:` is the sibling key, over the documents in `references/` folders. It narrows within a
wall the tree already imposes rather than selecting from everything the worker flow installed, and its
entries take no mode — see [What a worker reaches](#what-a-worker-reaches).

### What a hireable worker flow must admit

A worker flow is an ordinary flow. What makes it *hireable* is that its `configSchema` composes
`workerConfigSchema()`, which declares the settings a worker's bag may carry:

| Setting | What it holds |
| --- | --- |
| `instructions?` | The worker's own instructions — its file body, or the frontmatter key. Imposed when the body is not empty, absent when it has none. |
| `teamInstructions?` | The instructions its team wrote — read from that team's [`TEAM.md`](#the-optional-team-file). Imposed when its team wrote any, absent when the team wrote none or has no file. Never merged with `instructions`. |
| `workerSkills` | The skills its folders resolved for it, in level order. Imposed on every worker, present and empty when there are none. |
| `workerTools` | The blocks this worker's `tools:` resolved to from its own folders and the packages it holds, already resolved. Imposed on every worker, present and empty when there are none. Live blocks, not names — names that resolved to the worker flow's catalog stay on the worker flow's own `tools` setting. |
| `workerPackages?` | The [packages](#packages-from-files) this worker holds, in the order it holds them: `{ name, path, instructions?, tools }[]`, where `tools` is the package's blocks. Imposed when the worker holds at least one, absent otherwise. |
| `workerId` | The worker's own id, the one a coordinator's `delegates:` and a task's `assignee` name it by. Imposed on every worker. A block reads it from the worker the turn loaded (`installation.resolveWorker(ctx, flow).config.workerId`), never from `ctx.flow.config`, which the shared copy holds once for every worker. |

So hiring imposes `instructions` when the body is not empty, `workerSkills`, `workerTools` and `workerId`
always, `teamInstructions` when the worker's team wrote a `TEAM.md`, and `workerPackages` when the worker
holds a package. A worker flow that reads
`teamInstructions` for a worker whose team wrote none gets `undefined` — absent, never an empty
string, which is what keeps "this team said nothing" and "this team said nothing *yet*" from being
the same value in the bag.

**One key is reserved across worker flows: `tools`.** It is not part of the contract — your flow declares it or leaves it out — but if you declare it, it means the names of tools that worker may call, because the hire step reads it. (On the built-in `agent` worker flow, a worker with no `tools:` line can also call what its own file chose: the tools of the capability presets it selected under `capabilities:`, and the blocks of the packages it holds. A written line is the whole grant.) A name in a worker's `tools:` is resolved against what is registered for that worker (its own `blocks/` folder, then its team's, along with the blocks of the packages it holds, then your flow's catalog; an org worker has neither folder, so only the last two apply), and the ones that resolved to the worker's own folders or packages arrive on `workerTools` as live blocks instead. You decide what to check the remaining names against, and you may declare no `tools` at all. What the key is not available for is unrelated string configuration, which hiring would rewrite — give that its own name.

Add your flow's own settings on top, at the same level:

```ts
import {
  MESSAGE_RECEIVED_ENTRY,
  messageReceivedEntry,
  workerConfigSchema,
  workerFlow,
  workerMessagesResources,
} from "@flow-state-dev/workforce";

const triage = workerFlow((installation) =>
  defineFlow({
    kind: "request-triage",
    configSchema: workerConfigSchema().extend({ desk: z.string().default("front") }),
    session: installation.session(),
    resources: { ...installation.resources, ...workerMessagesResources },
    actions: {
      respond: { inputSchema: z.object({ message: z.string() }), block: triageWork(installation), userMessage: (input) => input.message },
    },
    internal: {
      actions: { [MESSAGE_RECEIVED_ENTRY]: messageReceivedEntry({ installation, flowKind: "request-triage" }) },
    },
  }),
);
```

`desk` sits at the top level beside the contract's keys, where the schema closes it: a worker file that writes
a key your flow never declared is still refused by name. If your flow genuinely holds open-ended
data, give it one declared key whose own schema is a record, rather than a nested bag of keys you
did name.

Reading any of it is optional. A worker flow that composes the contract and never looks at `workerSkills`
is not an error. What is not optional is that your schema can take the bag: `hireWorkforce` checks
every flow in `workerFlows`, and the built-in `agent`, before it registers anything, and a flow
whose schema refuses a key of the contract, or the value a worker supplies for one, refuses the
whole call with a message naming the flow and the fix.

What is checked is what your schema accepts, not which function built it — so a worker flow that declares
these keys by hand hires just the same, as long as each key takes the value a hire supplies
(`workerId` is a string). Composing is what keeps it current: when a key is added to the contract, a
composed flow picks it up, and a hand-rolled one refuses at boot naming the new key until you add
it.

The same check also requires a door named `respond`, the entries the flow's roles need, that the
flow declares the installation's session, and that any resource with `writtenBy` comes from
`sharedResource()`. The door is the one public action that declares `userMessage` and takes
`{ message }`, named `respond` on every worker flow, so an app can talk to any worker without
knowing its flow; a flow with none, with a second, or with its message action under another name
refuses, the last naming the action to rename. A resource with a `writtenBy` field is declared with
`sharedResource()`, which adds the field; one defined by hand is refused, even with the right shape.

`hireWorkforce` also requires every worker flow to carry an internal `onMessageReceived` entry built
by `messageReceivedEntry`, so any worker can be [messaged](#worker-messages); a flow without one, or
with a hand-built entry under that name, is refused, naming the flow. `defineSessionBoard`'s `entries(turn)`
includes it. A flow whose model is offered `sendMessage` (the kit's `messages` in a block's static
`uses`) must also carry the kit's `dispatch` pass, which sends a message again until it lands; one
without it is refused, naming the flow. Spread `entries(turn)` and declare the `manager` role.

Each declared role's entries must be there, in their section, carrying their factory's mark, and
take the input their caller sends:

| Role | Entries | Built by |
| --- | --- | --- |
| `contributor` | `work` (task) | `workerTaskEntry` |
| `manager` | `dispatch`, `onTaskSettled` (internal) | `defineSessionBoard`'s `entries(turn)` |
| `coordinator` | a manager's, plus `routeOn`, `roundDeadline`, `changeWorkstreamDelegate` (internal) | `defineCoordinatorFlow` |

The check runs the other way too: a piece of a role's factory (a `workerTaskEntry`; the board's
entries, its task actions or its delegate actions) on a flow that doesn't declare the role is
refused. An entry of the flow's own that only shares a name is its own, never a role's. Each
problem names the flow, the role, the entry and the fix.
`workerFlowProblems(name, flow, roles?)` runs the same check without an app, for a library's own
tests. [Which flows can run workers](https://flow-state.dev/docs/workforce/workers-on-disk#which-flows-can-run-workers) has the whole contract.

Only `instructions` is ever authored. A worker file that writes `workerSkills:`, `workerTools:`,
`workerPackages:`, `workerId:` or `teamInstructions:` is refused by name, at the loader and by the installation: a worker's
skills, its own blocks and its packages are the folders it can see, its id is its record's, and a team's instructions come
from its team's `TEAM.md` body.
That last key is refused in a `TEAM.md` too — the file an author would most reasonably try it in —
so all three doors refuse it, from one exported constant rather than a literal spelled into each.

**A record that leaves `flow:` out runs on the built-in `agent` flow** — it talks, its body
arrives as its instructions, and it reads the skills its own folders hold plus any the app seeded
through `defineAgentWorkerFlow({ skills })`. It sees the earlier turns of the conversation it is
in, up to the session's history window (the last 50 by default), and nothing from any other
conversation. `workerFlows` is therefore optional. A `flow:` that is present but empty or whitespace-only
refuses, because it names no flow — only an absent key means the built-in.

A worker on `agent` is talked to through the flow's `respond` action, which takes `{ message }`, in a
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

A worker record declares data: a description, the worker flow it runs, and that flow's settings. Behavior
lives in the flow the record names, so a worker that has to do something none of your worker flows do is a
flow you define in your app and pass in `workerFlows`, named by that worker's `flow:`.

A record's **`body` reaches its flow as one setting, `instructions`**. Every hireable worker flow declares
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

### Composing capabilities into the built-in worker flow

`defineAgentWorkerFlow` takes four more app-level options beyond its catalog, skills and model
choices. All four are optional. `defineAgentWorkerFlow()` with no arguments builds the stock
worker.

| Option | What it does |
| --- | --- |
| `uses` | Capabilities attached to every worker's answer generator. The skills binding stays first and is never displaced. A capability passed as a plain ref brings its own storage with it; one passed as a `(ctx) => refs` resolver brings none, so anything it needs has to be declared statically somewhere. |
| `afterAnswer` | A block run after the answer as a side-chain. It receives the reply text as a string and cannot change the answer. A failure in it never fails a conversation turn; in a task it fails the attempt, except in a task whose result goes to the conversation (`resultTo: "conversation"`), where it is logged and the task keeps its answer. Absent, nothing runs after the answer. |
| `answerAgain` | `true`, or a block run after each answer. When it returns `{ message }`, the worker answers again in the same request with that message as its input. `true` hands the worker the tasks it filed that finished while it answered; see [Answering again with finished tasks](#answering-again-with-finished-tasks). Takes effect only on a flow built with `installation`. Absent, a turn answers once (and again after its plan), and every task result is heard after the turn. |
| `isolateUserState` | Forwarded to `defineFlow`. Keys the flow's user-scoped storage by its copy, apart from the user's other flows. Every worker on `agent` shares the one copy, so a user's workers on it still share the same user-scoped storage. Default `false`. |

**The tools fence.** A worker that writes a `tools:` line can call exactly the tools it lists,
whatever it selected under `capabilities:`. The worker flow maps those names against the catalog and hands
the model that list and nothing else; `tools: []` means no tool. A worker with no `tools:` line can
call the tools of every capability preset its own file selects under `capabilities:`, including a
preset whose tools are a function built per turn, and every block of every package it holds. A
preset the flow switches on by default gives its tools only to the workers that select it. A worker with no `tools:` line whose selected presets list
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

The four standing-rules tools (`rules/read`, `rules/add`, `rules/change`, `rules/remove`) sit
outside `tools:` too: see [Standing rules](#standing-rules).

#### The memory recipe

Memory is one thing you can pass through these options. Install `@flow-state-dev/memory`
separately:

```ts
import { AGENT_FLOW, createWorkerInstallation, defineAgentWorkerFlow, hireWorkforce } from "@flow-state-dev/workforce";
import { system } from "@flow-state-dev/memory";

const mem = system({
  model: "openai/gpt-6-luna",
  working: { capacity: 7 },
  episodic: true,
  semantic: true,
});

const installation = createWorkerInstallation({
  standardWorkers: workers,
  workerFlows: () => ({ [AGENT_FLOW]: remembers }),
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
doesn't is refused when the worker flow is built.

Every worker on `agent` shares the one copy. Long-term memory (episodic, semantic and digest) is
kept in the user's own scope, so one user's workers on `agent` share it, and it never reaches
another user or organization. Working memory is kept per conversation, and each conversation runs
one worker. Skills are kept per worker. Keeping a capability's data apart per worker is the app's,
as for any data a worker flow keeps per user ([Workers as data](#workers-as-data)).

Every problem with a standard worker is a startup misconfiguration: `hireWorkforce` collects them
and throws one error naming every bad worker, and registers nothing, so a bad record cannot leave a
short roster.

#### Standing rules

Workers on `agent` and coordinators keep standing rules: notes a user asked a worker to keep,
one list per worker per user, put in the prompt on every turn that worker takes for that user
(after its instructions, team instructions and packages). The worker edits them with four tools,
`rules/read`, `rules/add`, `rules/change` and `rules/remove`, offered only on a turn a user's own
message started and not fenced by `tools:`. A task turn, a routed task included, and a delegate's
answer get none. A write posts a line in the conversation, such as
`✎ Rule added (3 of 20): "Name the project before giving a status."`, that the model doesn't get
back as history.

An app reads and edits them through the workforce client:

```ts
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";

const workforce = createWorkforceClient(fsd); // fsd: your app's client from @flow-state-dev/client
const { version } = await workforce.standingRules("eng-lead", { op: "read" });
await workforce.standingRules("eng-lead", { op: "add", version, text: "Name the project first." });
```

`input` is `{ op: "read" }`, `{ op: "add", version, text }`,
`{ op: "change", version, number, current, text }` or `{ op: "remove", version, number, current }`.
Each call answers `{ version, rules: [{ number, text, addedAt, sessionId }], line? }`. A write
against a stale version, an add to a full list, a rule that isn't one line of 1 to 300 characters,
or a change or remove whose `current` isn't that rule's text is refused: the promise rejects with
the reason and nothing changes. The tools go through the same check.

Limits: 20 rules (`MAX_RULES`), 300 characters each (`MAX_RULE_CHARS`). The list lives in the
`standing-rules` resource (`STANDING_RULES_RESOURCE`) in the user's own scope; a browser can
read it and can't write it. A fork starts with none, and a worker moved to another worker flow
leaves its rules behind. If the list can't be read, the turn runs without it and says so in a
status line. See
[Standing rules](https://flow-state.dev/docs/workforce/standing-rules).

#### Answering again with finished tasks

A worker that hands tasks to its delegates hears their results after its reply, each as a line in
the conversation and a turn of its own. With `answerAgain: true`, a result that lands while the
worker is still answering shows up in that same request, and the worker answers again with it.

```ts
const agent = defineAgentWorkerFlow({ installation, catalog: appTools, answerAgain: true });
```

After the worker answers a user's message, each task the conversation filed whose ending hasn't
been heard yet, usually one that finished while the worker answered, is said once, as a line under
the delegate's name:

```text
Task "Look up the code" (t-1) completed by scout: The code is rc-4f2a.
```

The worker is then told:

```text
These tasks you handed out finished while you answered:

- Task "Look up the code" (t-1) completed by scout: The code is rc-4f2a.

Use their results now: answer again, building on what you already said.
```

Its next text comes after the line, in the same request. A task that ends during that answer is
picked up the same way once it finishes. A result handed over inside the turn isn't said again
after it, and wakes no extra turn.

The endings handed over are completions, final failures, cancels the worker didn't make itself,
and parks that ask a question, for a task whose result goes back to the filer (the default). A task
filed with `resultTo: "conversation"`, a retry, and a task some request waits on with
`getTask({ wait: true })` keep their usual path.

To change the wording, pass `finishedTasksAnswerAgain({ message })` instead of `true`:

```ts
import { defineAgentWorkerFlow, finishedTasksAnswerAgain } from "@flow-state-dev/workforce";

const agent = defineAgentWorkerFlow({
  installation,
  catalog: appTools,
  answerAgain: finishedTasksAnswerAgain({
    message: (finished) => `Done while you answered:\n${finished.map((f) => f.line).join("\n")}`,
  }),
});
```

For full control, build your own block around `takeFinishedTasks`. It takes what finished, says
each line in the conversation, and returns `FinishedTask[]`: `{ taskId, ending, worker?, line }`,
where `ending` is `"completed"`, `"errored"` or `"cancelled"` and `worker` is the
delegate the line was said under. It returns `[]` when nothing finished.

```ts
import { handler, sequencer } from "@flow-state-dev/core";
import { defineAgentWorkerFlow, takeFinishedTasks, type FinishedTask } from "@flow-state-dev/workforce";

const agent = defineAgentWorkerFlow({
  installation,
  catalog: appTools,
  answerAgain: sequencer({ name: "lab-answer-again" })
    .step(takeFinishedTasks)
    .step(
      handler({
        name: "lab-finished-message",
        execute: (finished: FinishedTask[]) =>
          finished.length === 0
            ? {}
            : { message: `Done while you answered:\n${finished.map((f) => f.line).join("\n")}` },
      })
    ),
});
```

Any block works as `answerAgain`. Its input is the worker's latest answer. It
returns `{ message?: string }`; a non-empty `message` makes the worker answer again, and `{}` ends
it.

Limits:

- At most `MAX_ANSWERS_AGAIN` (3) answers again per request. The answer the worker gives after its
  own plan of steps counts toward the same cap. When the plan and `answerAgain` both have something
  in the same round, the worker answers once about both.
- An answering-again turn files no step for the worker itself. A task it files for a delegate is
  dispatched as usual.
- Only a turn started by a user's own message to the worker (`respond`) takes anything. In a
  task's turn, a turn a task's ending woke, or a turn another worker's message started,
  `takeFinishedTasks` returns `[]` and results arrive after the turn.
- A result that lands during a long answer waits until that answer ends. One that lands after the
  last check arrives after the turn.
- A final failure the [Error Reporter](#error-reporter) hasn't picked up yet is heard after the turn.
- Each result is said at most once. If the process dies after a result is taken and before its line
  is said, the line is dropped.
- `defineCoordinatorFlow`'s `agent` options don't take `answerAgain`.

## Worker flows and blocks from files

The `workerFlows` map above names each flow a second time, after the flow already declared it. There is a
file convention for that half too: put a worker flow under `workforce/flows/workers/`, or a block under `workforce/blocks/`, and the basename is the name it
registers under.

```
workforce/
  flows/
    workers/request-triage.ts                        ← default-exports a workerFlow(...) builder
  blocks/triage.ts                                   ← a block any worker may name
  teams/engineering/blocks/build-status.ts           ← a block this team's workers may name
  teams/engineering/workers/triage/blocks/page.ts    ← a block this one worker may name
  teams/engineering/workers/triage/packages/runbook/PACKAGE.md          ← a package this worker holds
  teams/engineering/workers/triage/packages/runbook/blocks/restart.ts   ← one of its tools
```

`fsdev gen` walks those folders and writes `workforce/workforce.gen.ts` beside them, exporting
`workerFlows`, `blocks`, `workerBlocks` and `packageBlocks` — parameters
`createWorkerInstallation`, a task board and a worker flow's tool catalog
already take. The same file
carries `resourceModules`, covered in [Resource modules from files](#resource-modules-from-files).
This package supplies the generator `fsdev gen` runs, through its `./fsdev-gen` export; the command
finds it because your app depends on `@flow-state-dev/workforce`, and reads `workforce/` unless you
pass `--root`.

```ts
import { createWorkerInstallation, defineAgentWorkerFlow, hireWorkforce } from "@flow-state-dev/workforce";
import { blocks, packageBlocks, workerBlocks, workerFlows } from "./workforce/workforce.gen";

const installation = createWorkerInstallation({
  standardWorkers: workers,
  workerFlows: () => ({ ...workerFlows, agent: defineAgentWorkerFlow({ installation, catalog: blocks }) }),
  workerBlocks,
  packageBlocks,
});
const flows = hireWorkforce(installation);
```

A `blocks/` folder **registers** a name: `workforce/blocks/` for every worker, a team's for that
team's workers, a team worker's own for that worker. An org worker (`org/workers/<name>/`) has no `blocks/`
folder, and `fsdev gen` refuses one there: it gets tools from the catalog and the packages it holds. A folder does not grant use — a worker still names the
block in its `tools:`, and a name resolves nearest first (its own folder, its team's, the catalog).
Two rules are checked before any worker runs: the file's basename, the map key and the block's own
`name` must agree, and a block in a worker's own folder may read a store the worker flow installed but may
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
one **worker's own** `resources/` folder to — a resource, never a capability, because every worker on a
worker flow shares that flow's capabilities and one installed from a single worker's folder would change
every other worker. The generated file carries that sentence beside the entries it applies to.

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

A capability goes to the worker flow's `uses`, which is the same option you pass one by hand, and the
resources it declares for itself reach the flow from there. A plain resource module merges into the
one resource map, under its own ref, beside the documents. Nothing is installed on your behalf —
returning both and letting you spread them keeps the wiring in your own source, the same way
`resourcesFromDocs` does.

### What one worker picks up

A capability installed on a worker flow reaches every worker on that flow. A worker's own file names which of
its presets *that* worker wants:

```md
---
description: Holds the board.
capabilities:
  research: [briefing]
---
```

A worker that names nothing carries each installed capability's own defaults, which is what every worker
gets without the key. Naming presets **adds** to that — there is no spelling that takes one away.
Which capabilities a workforce may reach is the app's call, made where it builds the worker flow; a worker
file picks among them.

The whole selection is checked when the roster is hired, so a typo is a refusal at boot rather than a
failed answer in front of a user. A worker is refused, by name, when it names:

- a capability its worker flow does not carry
- a preset the capability does not declare
- a preset the app turned off where it installed the capability
- a preset on a capability declared with a `config` block
- a preset whose surface has to exist before a request runs (`resources`, a state schema, `model`,
  `providerOptions` or `caching`)

The last three are the app's to set where it installs the capability.

Only the built-in `agent` worker flow reads this key. A worker flow of your own reads whatever its own settings
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

On the built-in `agent` worker flow, a held package's body is in the prompt on every turn, after the team's
instructions and the worker's own. A worker with no `tools:` line can call every block of every
package it holds. A written `tools:` line is the whole list, and a package block can be named on
it; `tools: []` gets the text and no tools.

`readWorkforce` puts the packages in each worker's reach on its record as `packages`
(`PackageManifest[]`: the org's library, its team's, and its own folder; an org worker has no team's) and reports refused package
folders on `packageErrors`. `readDeclaredRoster` reports the same entries on its `package` layer.
The blocks come from `fsdev gen`'s `packageBlocks` export, keyed by package path and then block
name; pass it to `createWorkerInstallation`, which decides from each worker's folder and `packages:`
line which packages it holds. Leave `packageBlocks` out and a held package brings its instructions and no tools.

```ts
import { readWorkforce } from "@flow-state-dev/workforce/loader";
import { packageBlocks, workerBlocks, workerFlows } from "./workforce/workforce.gen";

const { workers, errors, packageErrors } = await readWorkforce("./workforce");
if (errors.length || packageErrors.length) throw new Error("workforce: failed to load");

const installation = createWorkerInstallation({ standardWorkers: workers, workerFlows, workerBlocks, packageBlocks });
const flows = hireWorkforce(installation);
```

A flow of your own receives what a worker holds on `workerPackages`, and only when it holds at least one;
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
| `references/` | the file, re-read whenever an execution context is built | no. `writable`, `llmWritable`, `render` and `flowIsolation` come from the folder, and a file declaring any of them is refused | the org's, the worker's own team's, and the worker's own folder's — derived from the tree |
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

A worker's own folder is how two workers each get their own `runbook` without their authors
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
  MESSAGE_RECEIVED_ENTRY,
  messageReceivedEntry,
  referencesFromDocs,
  resourcesFromDocs,
  workerConfigSchema,
  workerFlow,
  workerMessagesResources,
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
    resources: { ticket: ticketResource, ...installation.resources, ...installation.documents, ...workerMessagesResources },
    resourceVisibility: installation.resourceVisibility,
    actions: { answer: { inputSchema, block: answerQuestion(installation), userMessage: (input) => input.message } },
    internal: {
      actions: { [MESSAGE_RECEIVED_ENTRY]: messageReceivedEntry({ installation, flowKind: "support" }) },
    },
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
[which workers reach which reference](#what-a-worker-reaches) is decided only for the entries it names.
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
  model: "openai/gpt-6-luna",
  prompt: "Answer support questions. Check the team handbook before you answer.",
  tools: [readResourceContentTool()],
});
```

Each record is plain data:

| Field | Description |
|-------|-------------|
| `ref` | The document's identity and storage key, taken from where the file sits — see the table above. It is also the accessor key, so a team's handbook is `ctx.resources["teams/engineering/handbook"]` and one worker's runbook is `ctx.resources["teams/pentest/workers/recon/runbook"]`. |
| `declared` | The frontmatter exactly as written. A file that declares one of the refused settings below produces no record at all, so nothing is stripped here. |
| `body` | The Markdown below the frontmatter, verbatim. For a `resources/` document it becomes the resource's content. |
| `filePath` | The absolute path the file was read from. A reference is served from it, so a hand-built reference record must set it and `referencesFromDocs` throws without it. Carried on a `resources/` record too, where nothing reads it. |

**Merge the map yourself.** A flow copy created with `supportFlow({ resources })` *replaces* the
definition's map rather than merging with it, so passing `resourcesFromDocs(documents)` there on its
own drops whatever resources the flow definition declared. Spread it into your own map, as above.

### What a worker reaches

**A reference is walled by where its file sits.** A worker reaches the org's references, its own
team's, and its own folder's. Another team's and a teammate's are not on its map at all, so
`ctx.resources.get` on one throws `is not registered`. No install-side filter is involved and there
is no setting that widens the wall: a reference reaches more people by moving up the tree. A
reference under `org/workers/<name>/references/` belongs to the org worker at that folder: it reaches
that worker and no other. An org worker has no team, so no team's references reach it.

A `references:` list in a `WORKER.md` narrows within that wall. Each entry is a ref on its own —
there is no mode, since nothing writes a reference. An entry naming a reference the worker could not
already reach refuses the whole roster, and so does a malformed list or a duplicated ref. Leaving
the key out means every reference at or above the worker; `references: []` means none.

**A `resources/` folder is a namespace, not a visibility boundary — at every level.** Every
file-declared document is org-scoped, and a flow's resource tools reach every installed document
marked `llmReadable` with no per-team filter. Installing a whole tree on one flow makes every team's
documents reachable from it. To give a team's workers only its own, filter the records before
installing:

```ts
const engineering = resourcesFromDocs(
  resources.documents.filter((d) => d.ref.startsWith("teams/engineering/")),
);
```

This holds for a worker's folder too: putting a `resources/` document under `workers/recon/`
addresses it to that worker, it does not keep it from the others. Every worker hired onto one worker flow
shares that flow's definition, so by default all of them read the same row.

**Filtering decides what a worker flow installs; a worker's own file decides what that worker reaches.** A
`resources:` list in a `WORKER.md` narrows one worker within its flow and can take a document
read-only — see [The documents a worker may touch](#the-documents-a-worker-may-touch). A ref for a
document this worker flow was not installed with is refused at the hire, so the filter above holds.

**To make a `resources/` document that worker's alone, say so in the document.** A file whose
frontmatter carries `flowIsolation: true` gets one row per worker: the worker that writes it reads it
back, and a sibling worker asking for the same document gets its own empty copy rather than an error.

```md
---
description: This worker's own working notes.
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
holds a `WORKER.md`, and a slot with no worker file is reported separately by
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

## Hire, fork and fire as tools

A user's own workers are rows on their roster ([Workers as data](#workers-as-data)), written by the
roster flow's `hire`, `fork`, `edit` and `fire` actions, which `hireWorkforce` registers. A hire,
fork or fire is a write to the user's data. Every process sees it on the next turn.

To let a worker hire or fire for the user it talks to, hand the same blocks to a model as tools.
A catalog key is the tool's own name, so give each block that name and what the model reads about
it: `hire` with `.as()`, and `fire` as a sequencer when it should wait for an approval first. Put
the pair in the worker flow's catalog:

```ts
import { sequencer } from "@flow-state-dev/core";
import { createWorkerHireBlocks, defineAgentWorkerFlow } from "@flow-state-dev/workforce";

const { hire, fire } = createWorkerHireBlocks(installation);
const rosterTools = {
  hire: hire.as({ name: "hire", description: "Hire a worker of the user's own." }),
  fire: sequencer({ name: "fire", description: "Fire one of the user's own workers.", inputSchema: fire.inputSchema, outputSchema: fire.outputSchema })
    .tap(askFire) // your own `human_approval` suspension, if a fire should wait for the user
    .step(fire),
};

const agent = defineAgentWorkerFlow({ installation, catalog: rosterTools });
```

A worker holds `hire` or `fire` only when its own `tools:` names them. Each write goes to the roster
of the user whose turn it is: a worker can't hire for anyone else. The blocks write at once; an
approval before a fire is yours to add as a step before it, as the Shift Coordinator guide shows.

## The inventory

The tree tells you what a workforce is meant to be. A `WORKER.md` declares a worker, and it is read
once at boot. It can't tell a block which workers were actually registered in an organization, and a
block cannot walk folders to find out.

The inventory keeps that record as data: one org-scoped resource collection, one row per registered
worker. It is an ordinary collection, so a block reads it the way it reads any other resource.

**A row means registered, not working.** It records that a worker was registered in this
organization, not that it is running now. Nothing deletes a row for going missing, so a row stays
where it is when a later roster no longer names the worker. The rows are the standard workers
(`inventoryWorkers(installation)`); a user's own workers are on their roster, never in the inventory.

| Factory | One row per | Fields |
|---------|-------------|--------|
| `defineWorkerInventoryCollection()` | registered worker, at `inventory/workers/<id>` | `id`, `kind` (the worker flow the standard worker runs on), `door` (the action that takes a user's message, or `null`), `rules` (whether its flow declares the standing rules action), `hired` and `incarnation` (`false` and `null` on every row `openInventory` writes, since it lists only standard workers) |

The collection is readable by a browser through the ordinary collection read
(`listCollectionItems` from `@flow-state-dev/client`), from any session whose flow declares it: the
roster flow's, or any flow carrying `inventoryWriterActions()`. Each row comes back with the fields in
the table and nothing else. The read answers for the session's own organization, which the server
takes from the session, never from the request.

### Writing the inventory at boot

The rows are written by an action that runs inside a flow, so they need a flow to run in. Spread
`inventoryWriterActions()` into a flow's `internal.actions`, register it, and name it as
`workerWriter` when you call `openInventory`:

```ts
import { defineFlow } from "@flow-state-dev/core";
import {
  createWorkerInstallation,
  hireWorkforce,
  inventoryWorkers,
  inventoryWriterActions,
  openInventory,
} from "@flow-state-dev/workforce";

const installation = createWorkerInstallation({ standardWorkers: roster.workers });
const flows = hireWorkforce(installation);
const inventoryWriter = defineFlow({
  kind: "inventory-writer",
  actions: {},
  internal: { actions: { ...inventoryWriterActions() } },
})();

flowRegistry.registerMany([...flows, inventoryWriter]);
// server starts here

const { workers, problems } = await openInventory(
  { workers: inventoryWorkers(installation) },
  {
    run,
    workerWriter: { flowKind: "inventory-writer" }, // runs in session "inventory-binder" unless you pass `sessionId`
    userId: "u_boot",
    orgId: "org_acme",
  }
);
```

`openInventory` writes one row per worker at `inventory/workers/<id>`, in one run of the writer's
`registerWorkersInInventory` action.

**Keep the writer in `internal.actions`.** Its whole input is the row data, with nothing to check it
against, so it never goes in the public `actions` map. An HTTP or MCP request never reaches
`internal.actions`; the only way in is the direct `runAction({ source: "internal", ... })` call
`openInventory` makes.

**The `run` callback.** `run` is the callback your app hands `openInventory` to run an action: it
takes the request `openInventory` builds, runs it through your runtime, and rejects when the action
fails. A `run` callback that hands back a failed run as an ordinary value reports the rows written
while writing nothing. **It must also forward `request.source` into `runAction`'s own `source`
option** (`runAction({ ..., source: request.source })`). The request carries `source: "internal"`,
and the write runs only when that value arrives. A `run` callback that drops `source` makes the write
fail, and `problems` names it.

**Running it twice.** Every write is an upsert keyed by the worker's id. Nothing duplicates.

**What lands in `problems`.** `openInventory` returns `{ workers, problems }`. `workers` counts the rows
that landed, as the action reports it when `run` returns the action's output (or a run result
carrying it as `output`); any other return counts the rows sent. A write that fails is named once in
`problems`, with every worker whose row could not be written.

### Reading the inventory

The factory takes no options. Install what it returns under any block's `resources` map:

```ts
import { handler } from "@flow-state-dev/core";
import { defineWorkerInventoryCollection } from "@flow-state-dev/workforce";
import { z } from "zod";

const workers = defineWorkerInventoryCollection();

const registeredWorkers = handler({
  name: "registered-workers",
  inputSchema: z.object({}),
  outputSchema: z.object({ ids: z.array(z.string()) }),
  resources: { workers },
  execute: async (_input, ctx) => {
    const rows = await ctx.resources.workers.list();
    return { ids: rows.map((row) => row.state.id) };
  },
});
```

Keys are relative to the collection's own prefix, so `upsert("engineering.lead", row)` lands at
`inventory/workers/engineering.lead`. `list()` hands back resource refs, and the row itself is on
`ref.state`.

A row joins back to the declared record on the id and nothing else. The `id` on a row is the id
`discover` looks up: the `WORKER.md` folder's id.

The rows are org-scoped and shared across flows. Every flow running under the same `orgId` reads the
same rows, whichever flow wrote them and whichever
[tenant](https://flow-state.dev/docs/fundamentals/state-and-scopes#multi-tenant-isolation) it runs
under, and a flow under a different `orgId` reads none of them. That holds whether or not the app
sets [`isolateOrgState`](https://flow-state.dev/docs/advanced/flow-isolation).

The row schema is closed, so a key it does not declare is dropped on the way in rather than stored.
`id` and `kind` are required and the schema rejects a row without them. The schema ships as
`workerInventoryRowSchema` beside the `WorkerInventoryRow` type, for checking what you are about to write.

## Projects

A project is a row with a title, a brief, an owner, its `members` and the git remote its code
lives in (`repository`, or `null`). A **shared** project is a row of the organization's
`projects` collection, which everyone in the org lists and reads. A **private** project is the same
row in its creator's own user scope, which nobody else lists or reads, with its creator alone in its
`members`. A project's address is `{ visibility, id }`, and every read and write after the create takes
one (`openWorkstream` can leave it out in a conversation that belongs to a project); another user's
private project is refused as `no-such-project`. The roster flow `hireWorkforce` returns, the
coordinator flow, the project blocks and `openWorkstream` declare both collections; a
flow of your own that works on project rows without them puts `defineProjectsCollection()` and
`definePrivateProjectsCollection()` in its `resources` under `PROJECTS_RESOURCE` and
`PRIVATE_PROJECTS_RESOURCE`. The guide is the docs site's Workforce → Projects page, under
"Declaring the collections".

```ts
import { defineProjectBlocks, defineWorkstreamBlocks } from "@flow-state-dev/workforce";

const projects = defineProjectBlocks();
const workstreams = defineWorkstreamBlocks({ installation, leadFlows: [agent] });
defineFlow({ kind: "projects", actions: { ...projects.actions, ...workstreams.actions } });
```

- **`createProject { id, title, brief?, visibility?, members?, repository? }`** writes a
  row with `create` and returns `{ project, visibility, created }`. `visibility` defaults to
  `"shared"`. The owner is the calling session's owner, and is always in `members`. An id another owner's
  shared project holds (`project-id-held`), `unassigned` (`invalid-project-id`) and a private project
  naming anyone else in `members` (`private-has-members`) are each refused, and nothing is written. The same
  owner re-sending an id gets the row back (`created: false`). A project's workstreams are the
  entries `openWorkstream` writes, not a list on its row.
- **`openWorkstream { project?, id, title, lead, due?, objectives? }`** opens a workstream the caller
  owns. Left out, `project` is the project the calling conversation belongs to (a project
  coordinator's conversation belongs to its project; a user's own coordinator belongs to none);
  in a conversation that belongs to no project it is refused `no-such-project`. A conversation that
  belongs to a project opens only there: naming another is refused `other-project`, and nothing is
  written. The open makes an entry at `workstreams/<projectId>/<~owner>/<id>`, and the lead's
  workstream session, owned by the caller, whose id the entry records. The lead is a worker on the caller's roster, on
  one of `leadFlows`, that lists delegates (`delegates:`), since a lead runs its workstream through
  them. Returns `{ workstream, opened }`; opening it again hands the entry back
  (`opened: false`). Refused: `not-a-member` on a shared project, `no-such-worker`, `cannot-lead`
  (a lead off `leadFlows`, or one that lists no delegates), `lead-differs`, `invalid-workstream-id`, `lead-doesnt-fit` (from `openWorkstreamTool` with `leadFit` set only, see below), and `too-many-workstreams` past 25 open workstreams per
  owner per project when the installation names a project coordinator.
- **`updateWorkstream { project, owner?, id, title?, status?, due?, objectives?, report? }`** changes
  an entry and returns `{ workstream }`. `status` is a label of up to 80 characters; `"done"` marks
  it finished. `objectives` is the whole list, each met or not; `report` is the entry's content. The
  entries are an owner-writes collection, so a write to anyone else's entry throws
  `A row of an owner-writes collection is written only by the user it belongs to.`, whichever flow
  sends it. Nothing deletes an entry. **`updateWorkstreamTool`** is the same write as the lead's tool,
  named `updateWorkstream`: it takes only the changes, all but `title` (`updateOwnWorkstreamInputSchema`), and
  writes the workstream its session leads (`not-a-workstream-session` elsewhere). A workstream's title is
  its owner's to change, through `updateWorkstream` or the project coordinator's `editWorkstream`.
- **`editWorkstreamTool`** is a tool named `editWorkstream` for the owner's project coordinator.
  It takes `{ project?, id, title?, status?, due?, objectives? }` (`editWorkstreamInputSchema`,
  strict) and returns `{ workstream }`. It always writes the caller's own entry, with no `owner`
  and no `report` (the report stays the lead's). `project` resolves as for `setBrief`
  (`no-such-project`, `other-project`), and an id the caller has no workstream under is refused
  `no-such-workstream`, including another worker's.
- **`listLeadsTool`** is a tool named `listLeads` for whoever picks a lead. It takes no input and
  returns `{ leads: [{ id, description }] }` (`listLeadsOutputSchema`; `description` is a string or
  `null`): every worker on the caller's roster, their own and the standard ones, that can lead a
  workstream, as the roster stands when the tool runs.
- **`readProject { project }`** returns `{ project, visibility, workstreams, progress }`: every entry,
  oldest first, without reports, and the progress worked out from them at read (`projectProgress`),
  never stored. A browser reads the same entries through the resource routes and parses each with
  `parseWorkstreamEntry` from `./browser`.
- **`listProjects {}`** returns `{ projects }`: the projects the caller is a member of, each as
  `{ visibility, id, title, repository }` (`repository` is `null` when it has none). Shared ones
  come first, then the caller's private ones, each by id. A shared project whose `members` leave the caller
  out is left out, though its row is readable in the organization.
- **`setRepository { project?: { visibility, id }, repository }`** sets, changes or clears (`null`) the repository and
  returns `{ project }`. Members only. Nothing else on the row moves, and of two project members setting it
  at once one value is kept whole. A value must be a remote, the address you'd pass to `git clone`:
  both writes refuse a path, a value starting with `-`, a control character, a remote-helper address (`ext::…`), a user
  or password on `http(s)`, and a password on any scheme, with `invalid-repository`, and never
  repeat the value. `git@host:org/repo` and `ssh://git@host/org/repo` are accepted.
- **`setMcpServers { project?: { visibility, id }, mcpServers }`** replaces the project's list of
  MCP server names; `[]` clears it. Members only; nothing else on the row moves. A name must be one
  the host offers, `defineProjectBlocks({ mcpServers })`: refusals `unknown-mcp-server` (naming what
  it offers) and `invalid-mcp-server` (anything that isn't a bare lowercase name, never repeated).
  `createProject` takes the same `mcpServers`. A row stored before the field reads `[]`.
- **`setBrief { project?: { visibility, id }, brief }`** sets, changes or clears (`null`) the brief and
  returns `{ project }`. Members only; nothing else on the row moves.
- **Leaving `project` out** of `setRepository` or `setBrief` changes the project the calling
  conversation is linked to, as a project coordinator's is (`linkedProjectOf(session.state)` reads it).
  With no linked project it is refused with `no-such-project`, and a linked conversation naming
  another project is refused with `other-project`, so a project coordinator changes only its own.
- **`readProjectFiles { project: { visibility, id } }`** returns `{ files: [{ path, size }] }` (size in UTF-8 bytes,
  never the body, since the output is logged as the tool result), the files the project keeps at
  `project-files/<projectId>/<path>`, in the org's `project-files` collection for a shared project
  and in the owner's scope for a private one. Members only. Neither collection has a browser read.
- **`projectWorkspace()`** is a run source for a workspace host (`@flow-state-dev/workspace`):
  the repository of the project the run works for, with the project's files beside the checkout, or
  the project's files alone when it has no repository. A run in a workstream's session, or a task
  session filed from one, works for that workstream, and is refused `not-the-owner` when the run's
  owner isn't the workstream's. A task session filed from a project's conversation, or from a
  conversation set to a project with `setWorkProject`, works in that project, and one filed from a
  conversation with no project works in the project its task names as `input.project`, for that
  project's members only (`not-a-member`). A task filed from a workstream, a project's conversation
  or a conversation set to a project that names a project in `input.project` is filed naming
  that conversation's project instead, and a worker filing there is told that project in its
  task tools' context, so it has no project to name. `no-project` when none applies. The block that asks it
  must hold `projectWorkspaceCapability`; with harness-manager, pass it on `uses`:

  ```ts
  harnessManager({
    // ...the board and the rest, as usual
    workspace: localWorkspaceHost({ root, remotes: { allow: ["github.com"] }, source: projectWorkspace() }),
    uses: [projectWorkspaceCapability],
  });
  ```

- **`setWorkProject`**, on the workforce client, sets the project one of the user's own
  conversations with a worker works in. From then on its coding runs, and every task it files, work
  in that project, as for a project's conversation above:

  ```ts
  const workforce = createWorkforceClient(fsd); // fsd: your app's client
  // A worker's one conversation, at the first job that needs files
  await workforce.setWorkProject("lead", { visibility: "shared", id: "apollo" });
  // A new session, after the user picks a project
  const session = await fsd.flow("lab-main").createSession({ state: { workerId: "main" } });
  await workforce.setWorkProject("main", { visibility: "shared", id: "apollo" }, { sessionId: session.id });
  ```

  Without `sessionId` it sets the user's default conversation with the worker, creating it if there
  is none. With one, it sets that session, which must be the user's and run that worker. It resolves
  to `{ project }`. Calling it again replaces the project. Tasks already filed keep the project they
  were filed in, including one still waiting on the board and one handed to a delegate's ongoing
  session, with what that delegate files while working it. A run already started stays where it is.
  Nothing clears it. A refusal rejects with an `Error` whose message starts `Refused:`, and nothing
  is stored: a shared project the user isn't a member of (`not-a-member`), a private project that
  isn't theirs or a project that doesn't exist, a project coordinator's, a task's, a delegate's or a
  workstream lead's session, each named, and a session of another worker than the one named.
  Membership is checked again on every run. The action is `setWorkProject`
  (`SET_WORK_PROJECT_ACTION`, input `{ project: { visibility, id } }`): the `agent`, `coordinator`
  and Error Reporter flows declare it, and a worker flow of your own adds
  `[SET_WORK_PROJECT_ACTION]: setWorkProjectAction` to its `actions`. A project coordinator's
  conversation takes its project from `ensureWorkerSession({ worker, projectId })` instead.

- **`projectMcpTools(servers, { operator })`** is a resolver for a coding harness's per-run
  tools, in `claudeCodeAgent`'s `mcpTools` shape. It finds the run's project and owner the way
  `projectWorkspace()` does, connects to each server the project names in `servers`
  (`{ [name]: { url, seedEnv? } }`, HTTP only) with the owner's stored key, through one
  `createMcpManager`, and answers each connected server's tools, whose `call` goes through that
  connection. The key goes in the connection's headers only. `seedEnv` is read only for
  `operator`, and only while that user has no stored key. A server with no key, one the host no
  longer offers and one whose connection fails are each skipped, and the run's session says so.
  `named(ctx)` answers the names alone, for a harness that takes no relayed tools. The block that
  calls it holds `projectWorkspaceCapability` and `mcpCredentialsCapability`:

  ```ts
  claudeCodeAgent({
    uses: [projectWorkspaceCapability, mcpCredentialsCapability],
    mcpTools: projectMcpTools({ linear: { url: "https://mcp.linear.app/mcp" } }, { operator: "u_ops" }),
  });
  ```

  Each user's key is `mcp-credentials/<server>` at user scope, `{ value, setAt }`
  (`defineMcpCredentialsCollection()`); a browser read exposes `setAt` only. Write it from a route
  of your own, not an action, since an action's input is kept on its request record;
  `mcpCredentialProblem(value)` says why a value can't be stored, without repeating it.

  Pass `checkouts` to have some projects' runs work in a checkout on the server's machine
  instead of a clone. Each entry gives a `remote`, the absolute `checkout` path, the `projects`
  it serves, shared projects only, by `{ orgId, id, tenantId? }`, and an optional `baseRef` (the
  checkout's `HEAD` when omitted). A run uses the checkout only when its project is shared and
  listed with the run's own organization and tenant, as the server verified them, and its
  `repository` equals `remote` exactly; every other run is answered the usual way. List the same path
  in the host's `localRepositories`. A relative path, a `remote` a project couldn't store, or a
  project listed twice is refused when `projectWorkspace()` is called.

  ```ts
  projectWorkspace({
    checkouts: [{
      remote: "https://github.com/acme/acme.git",
      checkout: "/home/me/acme",
      projects: [{ orgId: "acme", id: "web" }, { orgId: "acme", id: "api" }],
      baseRef: "main",
    }],
  })
  ```
- **As a worker's tools.** Put the writes in `defineAgentWorkerFlow({ catalog })` under the names a worker's
  `tools:` spells. A catalog key must be the tool's own name, so give each that name with
  `projects.createProject.as({ name: "createProject", description: "…" })`. The owner is the session the worker
  answers in, so the project or workstream belongs to the user who asked.

Refusals are `ProjectRefusedError`, with a `reason`.

**The project coordinator.** Each user talks to a project through their own project coordinator: a
session of the standard worker `createWorkerInstallation({ projectCoordinator })` names (a worker on
the `coordinator` flow), one per user per project, found or started with
`ensureWorkerSession({ worker, projectId: { visibility, id } })`. A create for a project the user
can't read is refused. Its `readProject` tool (`projectCoordinatorTools`) reads every entry, each
marked `yours: true` when the session's user owns it. Its
delegates are the user's open workstreams in the project, one per workstream: the lead, with the
workstream's address as the target, so it hands work only to the user's own workstreams. They
follow the workstreams: the session's delegate list starts with one per open workstream the first
time it's read; `openWorkstream` adds one; `updateWorkstream` and `editWorkstream` remove it when the status becomes
`"done"` and add it back when it leaves `"done"`; and a routed task to one, filed with its `target`, runs in the
session the user's entry names, resolved at filing, so the message lands in that workstream's
session.

To let the coordinator open workstreams, add `listLeads: workstreams.listLeadsTool` and
`openWorkstream: workstreams.openWorkstreamTool.as({ name: "openWorkstream" })` to its catalog and name
both in its `tools:`. Asked for work none of the user's workstreams covers, it lists the leads,
opens a workstream with the one whose description fits (leaving `project` out, so it opens in the
coordinator's own project), and hands the request to it at `<project.visibility>/<project.id>/<id>`,
built from the returned workstream. Inside the owner's own coordinator turn, the new workstream can
take the dispatch as soon as `openWorkstream` returns.

To let it change the user's workstreams (title, status, due date, objectives), add
`editWorkstream: workstreams.editWorkstreamTool` to its catalog (the block is already named, so no
`.as()`) and name `editWorkstream` in its `tools:`. When it runs in the owner's own coordinator turn, closing
a workstream drops its delegate in that turn, so a later dispatch in the turn never targets it.

`listLeads` returns every worker that can lead, whether or not it suits the work, and a coordinator
with a single lead tends to pick it. To have the open refuse that pick, pass `defineWorkstreamBlocks({ installation,
leadFlows, leadFit: { model: "openai/gpt-6-luna" } })`: `openWorkstreamTool` then runs the one fit check
best fit routes by, on that model, about the chosen lead: its choices are the lead, by its description (as
`listLeads` shows it), *none fits*, and *the work doesn't say its sort*, for the workstream's title and
objectives. Only *none fits* refuses the open, with `lead-doesnt-fit`, and nothing is written; work that doesn't
say its sort, such as a bare name, passes. The check asks as an evaluator first and, on a model string, once more
as a language model when that fails, as best fit does. A refusal's message tells the worker to pick another lead
from `listLeads`, or, if none does the work, to open nothing and say a worker for it has to be hired first.
A failed check, an answer that isn't one of its choices, or a lead with no description,
lets the open through. The check runs after every other refusal, and an open of a workstream that is
already open with the same lead isn't checked again. The tool's answer carries `leadFit`: `{ checked: true }`,
or `{ checked: false, why }` with `why` one of `already-open`, `no-description` or `unanswered: <why>`.
Without `leadFit`, `openWorkstreamTool` is `openWorkstream`. Opens
through the `openWorkstream` action, such as a user's own open from the app, are never checked.

## Workers as data

A worker is data: a row its owner holds in their user scope, or a standard worker your files
declare, run by one registered copy of the flow it names. A session names its worker once, when it
is created, and each turn loads it. A hire, fork or fire is a write to the user's data. Every
process sees it on the next turn.

```ts
import { defineFlow } from "@flow-state-dev/core";
import {
  createWorkerInstallation,
  hireWorkforce,
  MESSAGE_RECEIVED_ENTRY,
  messageReceivedEntry,
  workerConfigSchema,
  workerMessagesResources,
} from "@flow-state-dev/workforce";

const installation = createWorkerInstallation({
  standardWorkers: roster,                  // readWorkforce(...)'s workers
  workerFlows: () => ({ research: researchFlow }),
});

const researchFlow = defineFlow({
  kind: "research",
  configSchema: workerConfigSchema(),
  session: installation.session(),          // a readonly `workerId`, and the create check
  resources: { ...installation.resources, ...workerMessagesResources }, // the user's workers, the standard ones, the message log
  actions: { respond: { inputSchema, block: door, userMessage: (i) => i.message } },
  internal: { actions: { [MESSAGE_RECEIVED_ENTRY]: messageReceivedEntry({ installation, flowKind: "research" }) } },
});

// inside the door's block, which also declares `installation.resources`:
const worker = await installation.resolveWorker(ctx, "research");
worker.config.instructions; // the worker's own, as the flow's configSchema parsed them
worker.reaches("handbook"); // its document grants, applied on this turn

const flows = hireWorkforce(installation); // research, agent, and the roster flow
```

Register every flow `hireWorkforce` returns: one copy of each worker flow, and the roster flow,
`workforce-roster`, which carries the `hire`, `fork`, `edit` and `fire` actions below. A session
of it also reads the organization's worker inventory (`inventory/workers/*`), so a user can see
who the organization's workers are.
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
  for a user runs again when the answer arrives, and a step that already finished isn't run
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
  app's client from `createClient` and reads and writes through it, as that client's user and
  over its transport. To send the caller's credential, give `createClient` a `fetcher` that wraps
  `fetch` and adds it, such as an `Authorization` header; every workforce call then carries it
  too. The server decides who the caller is with `resolvePrincipal` on
  `createFlowState`. See [Authentication](https://flow-state.dev/docs/server/authentication),
  [Host adapters](https://flow-state.dev/docs/server/host-adapters) for serving it, and
  [Serving it to your users](https://flow-state.dev/docs/workforce/overview#serving-it-to-your-users).

  ```ts
  import { createClient } from "@flow-state-dev/client";
  import { createWorkforceClient } from "@flow-state-dev/workforce/browser";

  // fetcher: wraps fetch to add the caller's credential, as described above
  const fsd = createClient({ userId, baseUrl, fetcher });
  const workforce = createWorkforceClient(fsd);

  const roster = await workforce.roster();
  // [{ id: "scribe", flow: "research", standard: false, description: "Takes notes." },
  //  { id: "researcher", flow: "research", standard: true, description: "Finds things out." }]

  const session = await workforce.ensureWorkerSession({ worker: roster[0].id });
  // { id: "wks_…", flowKind: "research", userId, createdAt, updatedAt, … }

  const sent = await fsd.flow(session.flowKind).send("respond", { message: "Summarize the launch notes." }, {
    sessionId: session.id,
  });
  const { status } = await sent.wait(); // or follow it live with sent.stream({ ... })
  ```

  In React, build the client once with `useMemo` over the same options. `useFlow` creates sessions
  with no starting state, which a worker flow refuses, so find or start the session with the client
  and select it on the hook (`flow.selectSession(session.id)`).

  `ensureWorkerSession` returns the user's conversation with the worker, or creates it.
  Two calls at once get the same session. Messages from other workers (see
  [Worker messages](#worker-messages)) land in it. A session the user started at any other id is
  never returned. `findWorkerSession` takes the same argument and returns
  the session or `undefined`, creating nothing. `listWorkerSessions(worker)` returns every
  conversation the user has with the worker on its current flow, whatever id it was opened at,
  as `{ session, isDefault }` entries: the one `ensureWorkerSession` returns comes first with
  `isDefault: true`, the rest follow by latest activity. It creates nothing, and leaves out a
  task's session, a coordinator's delegate session, a workstream lead's session and a project
  coordinator's session. All three throw `No worker "<id>" on your roster.` for a
  worker that isn't on the user's roster. The roster flow keeps one session per user, of the
  flow kind `workforce-roster`; if you list every flow's sessions, filter out
  `flowKind === "workforce-roster"`. Two first calls at once may create two roster sessions, which
  is harmless: the roster lives in the user's scope, not in either session.

## Coordinators

A coordinator is a worker that hands each user message to other workers on the same user's
roster, its **delegates**, by `judgment`, `best-fit`, `round-robin` or `everyone`. It hands a
message on by filing a **routed task** for each delegate: an ordinary task on the conversation's
board with `session: "ongoing"` (the delegate's one session for the conversation),
`resultTo: "conversation"` (the answer lands there, under the delegate's name) and one attempt.
It runs on the `coordinator` flow, registered on the installation like any worker flow. A
delegate is a worker whose flow takes tasks: the built-in `agent` flow does, and your own flow
does once its `work` entry is built with `workerTaskEntry`. The site's
[Coordinators](https://flow-state.dev/docs/workforce/coordinators) page walks through setting one up.

```ts
import {
  createWorkerInstallation,
  defineCoordinatorFlow,
  MESSAGE_RECEIVED_ENTRY,
  messageReceivedEntry,
  workerConfigSchema,
  workerMessagesResources,
  workerTaskEntry,
} from "@flow-state-dev/workforce";

const researchFlow = defineFlow({
  kind: "research",
  configSchema: workerConfigSchema(),
  session: installation.session(),
  resources: { ...installation.resources, ...workerMessagesResources },
  actions: { respond: { inputSchema, block: door, userMessage: (i) => i.message } },
  task: { actions: { work: workerTaskEntry({ name: "research-task", turn: door }) } }, // takes tasks, routed ones included
  internal: { actions: { [MESSAGE_RECEIVED_ENTRY]: messageReceivedEntry({ installation, flowKind: "research" }) } },
});

const coordinatorFlow = defineCoordinatorFlow({
  installation,
  routeModel: "typesafe-ai/jev",     // best fit's one evaluator call; typesafe-ai/jev reports confidence
  agent: { catalog, uses },          // what you give defineAgentWorkerFlow: the judgment turn is the agent's
  roundDeadlineMs: 5 * 60_000,       // optional: how long a round waits for its answers (the default)
});
```

A routed task's turn is handed `{ message }`: `<from>, through <coordinator>: <message>`, and,
when the coordinator's turn filed it with a goal of its own, `Your task: <goal>` after it.

Upgrading: a worker whose `tools:` names `handOff` is refused at load, with a message naming
`createTask` and the routing settings.

The judgment turn is the built-in agent's own turn. A coordinator worker's `model`, `tools`,
`skills` and `capabilities` read the way an `agent` worker's do, against the catalog and
capabilities you pass as `agent`. The four delegate tools and the task tools are on every
coordinator, whatever its `tools:` line grants.

A coordinator's file names its defaults:

```md
---
flow: coordinator
delegates: [researcher, scribe]
routing: best-fit        # judgment (the default), best-fit, round-robin or everyone
fallback: scribe         # one of the delegates
minConfidence: 0.7       # best-fit only: a delegate pick below this goes to the fallback, else the coordinator's own turn
rounds: 0                # how many times an answer goes back out: 0 (the default) to 3
---
```

- **Routing.** `judgment` runs the coordinator's own turn, which hands the message on with
  `createTask` (the delegate as `assignee`, a `goal`, `session: "ongoing"`,
  `resultTo: "conversation"`, and `target` for a workstream's record) or answers itself; on that
  turn the server attaches the user's message, as written, to each such task it files.
  `maxAttempts` left out reads 1, and any other value is refused (`conversation_result_one_attempt`).
  A `createTask` naming no assignee is refused (`routed_assignee_required`), and one naming a
  delegate that can't take it is refused (`not_routed`) with the delegates that can. Routing never
  hands a message to the coordinator itself. `best-fit` sends a follow-up to the delegate still
  working the user's last message, else makes one evaluator call over each delegate's note or
  description and the coordinator's own description, reading the message with the conversation's
  recent lines. When
  that call fails and `routeModel` is a model string, best fit asks once more as a language model
  (`coordinator-route-ask`). The pick has no confidence. An id the resolver can only generate
  with still routes.
  A pick of the coordinator runs its judgment turn. Best fit can't place a message when the call
  fails, answers with something that isn't a choice, has no one to pick, or picks a delegate
  below `minConfidence:` (or with no confidence, or one outside 0 to 1, while it is set). That message goes to the
  fallback, else the judgment turn. If that turn fails too, nobody takes the message, and the
  conversation says so (`Nobody took this message: …`). The judgment turn's model sees each
  delegate's answer prefixed `<worker id>, a delegate in this conversation, answered:`, and each
  message the routing handed to delegates followed by a note of where it went.
  `round-robin` sends each message to the next delegate in list order, skipping one that can't be
  reached. `everyone` sends it to each delegate that can be reached. When no delegate can be
  reached, nobody takes the message, and the conversation says so.
- **Recent lines.** Every message is routed and delivered with the conversation's recent lines: the
  user's messages, the coordinator's own replies and the delegates' answers that landed, oldest
  first, each under who wrote it (the user's id, the coordinator's worker id, or the
  answering delegate's worker id). They are the last 10, at most 4,000 characters of text in all,
  counted back from the newest; the line that crosses the cap is cut short with `…`, and older ones
  are left out. They come from this conversation's own messages, as far back as the session's
  history window reaches (its last 50 completed turns), never another conversation's. An answer
  that has just landed is among them even before the request that landed it has finished. Best fit
  reads the message with them, so a follow-up to a delegate's answer can go back to that delegate; the
  other policies don't route by them. An evaluation model passed as `routeModel` (a scripted one
  in a test, say) is handed `{ recent, post }`, each line and the message as `{ from, text }`.
  Whatever the policy, a delegate on the built-in `agent` flow is shown them as one user-role
  message just before the message, never system text, for that turn only. A flow of your own
  built with `workerTaskEntry({ turn })` is handed the message only; to show its model the lines
  too, give its generator `history: routedTaskHistory`. The delegate's own session never keeps
  them.
- **Rounds.** With `rounds:` above 0, a delegate's answer goes back out, at most that many times.
  `best-fit` and `round-robin` route each answer again as it lands, never to its own author.
  `everyone` waits for the round to close, then sends each delegate the other delegates' answers
  in one delivery. `judgment` waits for the round to close, then runs the coordinator's turn once
  with the round's answers; what it files in that turn goes out in the next round. A round closes
  when each of its routed tasks has ended (answered, failed or cancelled), or when its deadline
  passes (`roundDeadlineMs`, five minutes by default). A delegate that answers after that has its
  answer land once, and the answer goes no further. Each delegate gets a message at most once per
  round, so a message costs at most delegates × (rounds + 1) delegate turns.
- **The deadline.** On a host that keeps wakes (durable execution and a store with a wake store),
  a round closes at its deadline even across a restart. On a host that keeps none, it closes at its
  deadline while the process runs; after a restart it closes at the conversation's next activity
  past the deadline, and with none the answers that landed stay and nothing goes on.
- **Open rounds.** A conversation keeps at most 50 rounds open at once. A message that would open one
  more is still delivered, but its round isn't opened: its answers land once and go no further,
  and its routing record's `note` says so. The rounds already open go on.
- **Delegates per conversation.** Each conversation starts from a copy of the defaults, and its
  changes stay in it. Change them with the `addDelegate({ worker, note? })`,
  `removeDelegate({ worker })` and `setFallback({ worker | null })` actions, and read them with
  `listDelegates({})`. Each returns `{ delegates, fallback, max, filingSessionId }`, the list after
  the call. `listDelegates` also gives each delegate, read from the roster when it is called, its
  worker's `description` (`null` when it has none) and `takes`, from its flow: `tasks`, or
  `nothing` (fired, or on a flow that takes no task, with a `null` description). A refused
  change writes nothing and fails its request with the refusal as the error message. Every
  worker with a board has `listDelegates` as a tool. The coordinator's turn has `addDelegate`,
  `removeDelegate` and `setFallback` as tools only when its `WORKER.md` sets
  `editsOwnDelegates: true` (`false` by default); they hand a refusal back to the model as
  `{ refused }`. A worker whose file says `delegates: all` delegates to the whole roster, read on
  each call rather than pinned, itself included. A session create can't set them: one whose `state` carries `delegates`
  is refused with a 400,
  `Session state field "delegates" is written only by flow "coordinator"; a caller cannot set it.`
  Every worker flow built on `installation.session()` refuses `delegates`, `fallback`,
  `taskNotices` and `routedFrom` the same way, including a flow that has no such field.
- **Who can be a delegate.** A worker on the conversation's user's own roster, one of theirs or a
  standard one, whose flow takes tasks. A conversation holds at most 25. A
  standard coordinator's defaults can name only standard workers; `createWorkerInstallation`
  refuses the file otherwise. The refusals:
  - another user's worker, or one nobody holds: `No worker "<id>" on your roster.`
  - a flow that takes no task:
    `Worker "<id>" runs on flow "<flow>", which takes no task, so it can't be a delegate.`
  - one already on the list: `"<id>" is already a delegate in this conversation.`
  - a 26th: `This conversation already has 25 delegates, the most it can hold. Remove one first.`
  - removing one that isn't on the list: `"<id>" isn't a delegate in this conversation.`
  - a fallback that isn't on the list:
    `"<id>" isn't a delegate in this conversation, so it can't be the fallback.`
- **Delivery.** Each message is one routed task per delegate per round on the conversation's
  board (id `routed:<message>:<round>:<delegate>`), so its answer lands under the delegate's name
  once and the same pick twice files one task. Each delegate's routed tasks run in its own session
  per conversation, created naming the delegate as its worker, one at a time: a second message to
  a busy delegate waits, pending, until the first ends. A delegate that files work of its own for a
  message keeps its routed task open until that work ends, and answers from the turn that hears it
  end. A routed task the coordinator's own turn filed that fails lands once as the delegate's
  line, naming the task and its error, and wakes that turn, which can file it again; one a
  routing policy filed lands once as the delegate's line, `<delegate> couldn't answer: <the
  error>`, and wakes no turn. A routed task's cancel says
  nothing, however it was filed. A routed task is listed, read and cancelled like any task; its
  `session`, `resultTo` and `target` are set at filing and refused on `updateTask` (`filing_setting_fixed`). A routed task
  to a workstream's record runs in that workstream's session, one at a time there too: one from
  another conversation's board waits until the open one ends. Upgrading: a message an earlier
  version stored for a delegate is read as a routed task and worked once. The
  session carries the conversation's `filingSessionId`, which `listDelegates` returns, so an app finds it
  with `findWorkerSession({ worker, filingSessionId })`. A conversation deleted and created again
  under the same id has a new `filingSessionId`, and its delegates get new sessions. A lookup
  naming only `{ worker }` never returns a delegate's session. Only the delivery opens one:
  `ensureWorkerSession({ worker, filingSessionId })` returns it but never creates it, and a session
  create whose `state` carries `filingSessionId` is refused with a 400.
- **The record.** Every routing decision leaves one `coordinator-route` component item:
  `postId`, `round`, `policy`, `by` (`judgment`, `held`, `evaluated`, `fallback`,
  `round-robin`, `everyone` or `unplaced`), `delegates` (each with `worker`, `outcome` of
  `delivered`, `skipped` or `failed`, and a `reason` when it wasn't delivered), `none` (why
  nobody was delivered to, when nobody was), `note` (why the round's answers go no further,
  when it was refused at the cap on open rounds), and `fit`: why best fit handed the message to the
  fallback or the judgment turn (`reason`: `coordinator`, `below-floor`, `no-confidence`,
  `failed`, `not-a-choice` or `no-delegates`, with the `choice`, its `confidence` and the
  `minConfidence` where there are some). When best fit's evaluator call failed and it asked again
  as a language model, `evaluationFailed` carries the evaluator's error. Render it apart from the
  conversation's lines. App code
  reads the records with `fsd.sessions.requests(sessionId, { includeItems: true })`,
  keeping each request's `items` whose `type` is `"component"` and `component` is
  `COORDINATOR_ROUTE`; the record is the item's `data`. Without `includeItems: true` there are no
  `items` to read.

`hireWorkforce` refuses a broken standard coordinator at load, naming the problem: a `rounds:`
above 3 (`rounds can be at most 3`), a `routing:` outside the four, a `fallback:` that isn't one
of its `delegates:`, a `minConfidence:` outside 0 to 1 or on a coordinator that doesn't route by
`best-fit`, or a delegate named twice. `installation.standardWorkerProblems()` returns the
same problems without throwing.

### The coordinator's task board

A coordinator conversation also keeps a task board of its own. The coordinator's turn carries
Orchestration's task tools (`createTask`, `getTask`, `listTasks` and `updateTask`), and the
conversation's session takes them as actions named for the board:
`createTask_tasks`, `updateTask_tasks`, `listTasks_tasks` and so on. A turn working a task also
has `reportProgress` (the `progress` entry of the session board), which is not an action.

An assignee must be one of the running session's delegates whose flow takes tasks, in a task
session as in a conversation. Any other assignee is answered `{ ok: false, error: "unknown_assignee: …" }`, and nothing is stored.

`createTask` starts a task in its task session, which belongs to you.
Find it with `findWorkerSession({ worker, taskId, filingSessionId })`. `createTask` with
`held: true` files it held; it starts when `updateTask` releases it (`status: "pending"`). Before
a task starts, `updateTask` can change any of its fields, its assignee included; after, only a
cancel or a message lands. `createTask` returns once the task is stored, without waiting for it to run. Unless
a turn waits on it with `getTask({ id, wait: true })`, the conversation hears once when the task
ends; a waiting turn gets the answer instead. See
[Handing out tasks](https://flow-state.dev/docs/workforce/coordinators#handing-out-tasks). On a host
with durable execution, an ending whose notice was lost (a crash right after the task ended) is
heard within seconds, without anyone opening the conversation, through the session's wake.

## Filing tasks from any worker

A worker files tasks when its `WORKER.md`'s `delegates:` names one that takes tasks, on a flow
that carries the session board: the built-in `agent` and `coordinator` flows do, and your own flow
does through `defineSessionBoard({ installation, flowKind })` (see its row under Exports). A worker with no such delegate has nothing to file for, and its actions answer
`{ ok: false, error: "no_delegation_board" }`.

### Steps

A worker can also file tasks naming **itself**: each is a **step**, kept on the session's own
`plan` ledger, never handed to a session. When its turn ends, the same request works the steps one
at a time, each a turn of the worker on the step's brief and the results of its `deps`, then the
worker answers once more, told how every step ended; that answer is the request's result (a task's
result in a task session). A request with no step costs nothing more.

- **Who gets them.** On the built-in `agent` and `coordinator` flows a worker's turn has the task
  tools for its steps whatever its delegates; your own flow gets steps by wrapping its turn in the
  kit's `planned(turn)`.
- **Who files them.** Only the worker's own turn files a step (an action naming the worker is
  refused), and the turn that answers files none.
- **What a call can't do.** A step isn't waited on, held or finished by a call, and `updateTask`
  doesn't move a step to a delegate or a delegate's task to the worker.
- **A step in its own session.** A step filed `session: "new"` runs in a new session of the same
  worker, through its own `work` entry. The request waits for it before the next step, which sees
  its result. `"ongoing"` is refused, and so is `"new"` on a flow that takes no task of its own.
- **Limits.** Steps count toward the 100 tasks under a top task and add no depth, except a step in
  its own session, which is one board deeper.

Any worker's turn, a task's included, can wait on a task it filed with
`getTask({ id, wait: true })`, up to five waits deep. See
[Working in steps](https://flow-state.dev/docs/workforce/delegating-work#working-in-steps).

### Splitting a task

A task's worker can split it into pieces for its own delegates; a piece for any other worker is
refused with `unknown_assignee`. An unassigned piece goes to
its delegate when it has exactly one. Each piece carries `filedByTask`, the task it was split from.
The task stays running while a piece is open, with no lease (`waitingOn: "filed"`). Each piece's
ending wakes a turn in the task session, which decides what it means: a failed piece fails nothing
by itself. Once no piece holds it, the task completes with its output like any task's: the latest
`reportProgress` checkpoint, else the answer of the last turn a piece's ending woke. A turn that
throws fails the attempt. Read a piece's result from its own row (`listTasks({ filedByTask })`,
`getTask`). A message to the worker in its task session doesn't hold the task and isn't part of it:
while the task's turn is running, it is answered after that turn, and an error in that answer
doesn't fail the task. To change open work, steer it with `updateTask`'s `message`. Run a workforce that splits on a host with durable
execution: if the server stops between a piece's ending and its notice reaching the task session,
a durable host delivers the notice when it starts again; without durable execution the task stays
`in_progress` with nothing to wake it. Splitting goes up to
five boards deep and 100 tasks under one top task; a filing past either is answered
`{ ok: false, error: "total_task_cap_exceeded" }`. Raise the 100 with `hireWorkforce`'s
`taskChainLimit`. See [Delegating work](https://flow-state.dev/docs/workforce/delegating-work).

### Questions, messages and follow-ups

A worker on a task turn has `askQuestion`: the task waits on its question, which the user's
Inbox lists. The answer is a message naming the question, `updateTask_tasks({ id, question,
message })`, from the Inbox, a line typed in the task's session, or the coordinator's `updateTask`
tool. The coordinator answers a question only when the task runs in a session of its own. When the task runs in the delegate's ongoing session, you answer it. The task takes one more turn in its own
session, on the same attempt, with the answer, without spending a retry. The worker that filed
the task hears each midway question as a message naming the task and the question's id, so it can
answer without `getTask` first (see [Worker messages](#worker-messages) → A task's question). The worker also has
`waitForUser`, which stops its turn for the user's approval or review; only the user answers that,
in the Inbox.

`updateTask_tasks({ id, message })`, or the coordinator's `updateTask` tool, steers a task that
hasn't finished: the message is kept on the task and reaches its worker's next model call, or the
first attempt's brief, without spending a retry. A task waiting on pieces it filed gets a turn with
it at once, and one that lands after the worker's last model call gets one more turn before the
task settles (`STEER_TURN_ENTRY`, an internal entry on the worker flow; see the table below). A line typed to
the built-in `agent` worker in the task's own session (its `respond` action) does the same while the
task, or the latest of its follow-ups, is unfinished: it answers `{ steered: <that task's id> }`
and runs no reply of its own. Once the task has finished, a line there is an ordinary turn,
answered from everything the session holds, and the task doesn't change. A finished task takes no
message; to correct or build on it, use `createTask`'s `followUpOf`, which runs in the same
session with the same worker, and `getTask` on the original then shows the follow-up's output as
`current`.
A follow-up can be filed while that task still runs: a session works one task at a time, so it
waits until the task ends.

### Filing from code, and reading boards from a browser

Code filing through the board's ref chooses, per task, `session: "new" | "ongoing"` (its own task
session, or the session where that delegate works for this conversation) and
`resultTo: "filer" | "conversation"`. A conversation-result task takes one attempt, and a wait on
it is refused. Both are a conversation's settings: from a task session the filing is refused
(`setting_not_from_task_session`). When a task fails, is retried or is cancelled, the open pieces
it filed are cancelled within seconds.

A browser reads its user's boards through the ordinary collection read: `tasks`, fetched through
any of that user's sessions on a flow that carries the session board, answers every one of their
conversations' rows in one listing, paged like any collection read, and none of another user's. Each row's key starts with the
conversation it was filed in; `sessionIdOfFiling`, from `./browser`, reads that conversation's
session id back out of it. Only the board's fields go out (goal, status, assignee, run, timestamps
and the like), never a task's input, output or metadata.

### After upgrading

Rows an earlier version wrote can owe a notice, an Error Reporter report, or the
settle of a [split task](https://flow-state.dev/docs/workforce/delegating-work#splitting-a-task)
whose pieces have all ended but which hasn't completed, with no wake to pay it. A split an earlier
version stored reads as `in_progress`, `waitingOn: "filed"`, and its pieces hold it. So does a
task an earlier version held open for a message queued to its session: its work had answered, and
it settles with that answer once checked. Call `backfillBoardWakes(stores, { userCell })` once at host
start, with the runtime's `stores` and `userCell: (userId, orgId) => resolveUserStorageKey(userId,
orgId, { id: "", isolateUserState: false })` (from `@flow-state-dev/engine`): it owes a wake, due
now, in each session holding such a debt, and returns how many. It is safe to run again, and
answers `0` on a store without wakes. A Shift Manager Lab runs it at start. `userCell` maps a
user and org to the storage key of that user's state, where conversation boards keep their rows;
those rows stay in the user's shared state even on a flow with `isolateUserState`, so a
flow-isolated key (`{ id: flowId, isolateUserState: true }`) finds nothing. Types:
`BoardWakeBackfillStores`, `BoardWakeBackfillOptions`.

`sendMessage` to `{ task: id }` doesn't reach a task an earlier version filed: it answers
`no_task_session`. Message the worker by id instead.

## Worker messages

A worker can send any other worker on its user's roster a short message: a question, an FYI, a
heads-up. Workers on the built-in `agent` flow and the coordinator flow get the `sendMessage` tool
on every turn. On a flow built with `defineSessionBoard`, add the kit's `messages` to the model
block's `uses`. The tool's description lists the workers the send would take, by id and
description, leaving out the sender and any worker that hears only in its tasks' sessions.

```json
{ "to": "shift-coordinator", "text": "What's the codename for the spring launch?" }
```

Send to talk; call when the worker needs to use the answer now; file a task for work that should be tracked.

- **Sending.** The input is `{ to, text, inReplyTo? }` and nothing else (a call adds `wait`, `deadline` and `callId`, below); `text` holds up to 8,000
  characters. `to` is a worker's id, `{ task: id }` or `{ session: id }` (see
  [Addressing a task or a conversation](#addressing-a-task-or-a-conversation)). Once the message is written to the log, the tool answers `{ sent: "msg_…" }`: it is on its
  way, not yet landed. A refused one answers
  `{ ok: false, error }`, nothing sent, the error starting with a code: `not_a_worker` (the session
  runs no worker), `empty_message`, `message_too_long`, `not_yourself`, `no_worker` (also for
  another user's worker), `worker_unavailable` (the roster row has a problem), `task_sessions_only`
  (file it a task instead), `no_such_message` (`inReplyTo` names no message the `to` worker sent
  you, or is passed with `{ task }` or `{ session }`), `budget`, `per_request_limit` or
  `not_delivered` (the recipient's host refused the first delivery for good; the error
  carries its reason). A task or session target adds its own codes,
  below, and so does a call.
- **Receiving.** A message arrives on the recipient flow's internal `onMessageReceived` entry
  (`MESSAGE_RECEIVED_ENTRY`). The session it lands in gets two items: a `From <sender>: <text>`
  line under the sender's name that the model reads in history and the client never receives, and
  a client-only component item `workforce:received` (`RECEIVED_MESSAGE_COMPONENT`) with `data`
  `{ id, from, text, inReplyTo?, budget, call }`, for an app to draw. Then the flow's turn, if it gave one, runs
  with a `MessageReceived` (`{ id, from, text, call, inReplyTo?, budget }`; `call` is `true` when the
  sender waits for the reply). A copy delivered twice wakes the recipient once; a recipient mid-turn hears it after
  that turn. A message to a conversation stopped for the user (an approval or an input), or, in a
  task's session, to a task held on the user's stop or question, lands once nothing holds it; while
  it waits its row has `queuedBehind: "user"`. Coordinators hear messages whatever their routing, in their own turn.
- **Where it lands.** An answer lands in the session the original was sent from, even a task's
  session whose task has finished. A message to the worker that filed the sender's current task
  (or delegate session) lands in the conversation that filed it. A message to the project
  coordinator from work in a project lands in that project's conversation. Anything else lands in
  the recipient's own conversation with the user, the session `ensureWorkerSession({ worker })`
  returns, opened when absent.
- **Answering.** Nothing is sent back automatically. The recipient answers with `sendMessage`, `to`
  the sender and `inReplyTo` the message's id. A turn that ends in plain text answers no one, and
  not answering is a valid answer. A plain message doesn't wait for its answer.
- **Calls.** `{ to, text, wait: true, deadline? }` sends the message and waits, in the same turn,
  for the recipient's reply: the final text of the recipient's turn on it (cut to 8,000
  characters); the recipient's prompt tells it to answer there, not with `sendMessage`. The tool
  answers `{ status: "answered", callId, reply }`. At the deadline it answers
  `{ status: "running", callId, recipient? }` (`recipient: "waiting_on_person"` when the message
  waits behind the user); nothing is stopped and the reply is kept. `{ callId, deadline? }` waits
  again for it, sending nothing, writing no row and spending no budget. `{ status: "failed",
  callId, error }` when the message was refused or couldn't be delivered (`not_delivered: …`) or
  the recipient's turn failed. `deadline` is in ms, defaults to the host's wait default (5
  minutes) and must lie within the host's `waitDeadlines` bounds (1 s to 24 h by default). The
  user stopping the calling request ends the call; the recipient's turn runs on. Refusals,
  nothing sent: `wait_unavailable` (the host needs durable execution, a store that keeps wakes
  and a sweeper; the call is never turned into a send), `wait_deadline_out_of_range`,
  `wait_already_pending` (one wait per model step, shared with `getTask`'s `wait`),
  `wait_too_deep` (waits nest at most 5 deep), `no_such_call` (no call with that id from this
  conversation), `wait_again_only` (`callId` with anything but `deadline`), `missing_message`
  (neither `to` and `text` nor `callId`) and `deadline_without_wait`.
- **Hearing only in task sessions.** A worker flow whose entry is built with
  `hears: "task-sessions"` hears messages only in its tasks' sessions. A message to one of its
  workers by name is refused with `task_sessions_only`, and nothing is sent.
- **A task's question.** When a task asks midway (`askQuestion`, `askMidway(ctx, board,
  [{ prompt }])`, or a coding run's own question in Shift Manager's `devteam` Lab), its filer
  gets one message per question, from the task's worker, in the conversation that filed the task;
  it wakes that worker's `onMessageReceived` turn like any message. The text is
  `Your task "<title, else goal>" (<task id>) asks: "<question>"`, then
  `Answer it with updateTask({ id: "<task id>", question: "<question id>", message }), or leave it to the user, who sees it in their Inbox.`
  For a task filed with `target` or `targetSessionId` the second line is
  `The user answers it from their Inbox; it isn't yours to answer.` (the filer's answer is refused with
  `question_is_the_users`). A long question is cut with an ellipsis to fit one message. The id is
  `q:<task id>:<question id>`, so a replayed turn sends nothing new; it spends no budget and a
  spent budget doesn't refuse it. The Inbox lists the task once either way; the message adds no Inbox entry and blocks nothing.
  Nothing is sent when the task was filed from its own session, when no worker filed it (your server
  code did), or when the task's worker flow doesn't mount `messageReceivedEntry`: the question is
  then in the Inbox only, and `getTask` reads it.
- **Budget.** Each line the user types starts a budget of `hopLimit` (6) messages for everything
  descending from it, across every worker, plus at most `perTurn` (3) sent from any one request. A
  fresh budget also starts for a task filed held, when it is released, and for a request with
  nothing behind it. A task a woken worker files, and a delegate's ongoing session, draw on the
  filer's budget. Filing a task spends nothing; a refused send and a task's question to its filer
  spend nothing. A woken turn's
  `budget` (and the session kit's prompt) says how many more messages the exchange can send. Set
  both with `hireWorkforce(installation, { messages: { hopLimit, perTurn } })`; each must be a
  whole number of at least 1, or `hireWorkforce` throws.
- **The log.** Every message is a row in the user's `workforce/messages/*` collection
  (`WORKER_MESSAGES_RESOURCE`, rows parsed by `workerMessageRowSchema`), readable from the browser
  through the user's roster session or any session on a flow that declares
  `workerMessagesResources`: `id` (`msg_…`, or `q:<task id>:<question id>` for a task's
  question), `from`, `to`, `text`, `exchange`, `inReplyTo`, `fromSession`,
  `fromFlow`, `toSession`, `toFlow`, `toState` (the state the recipient's conversation starts
  with), `chain` (optional), `hop` (from 1), `status` (`MESSAGE_STATUSES`: `unconfirmed`,
  `delivered`, `refused` or `undeliverable`), `reason` (why it was refused or couldn't be
  delivered, or, while `unconfirmed`, why the last try failed), `takenBy` (the
  `onMessageReceived` request that took it), `deliveredAs` and `deliveredAt` (the request it
  landed in, and when; set once), `resent` (`{ n, at }`: how many times it was sent again, and when
  last), `toldAt` (when the sending session was told it was refused or couldn't be delivered) and
  `at`, plus `addressedBy` (`"task"` or `"session"`,
  absent for a worker's id) and `toTask` (the task, when `addressedBy` is `"task"`), and for a call
  `call: true`, `deadlineAt` (when the sender stops waiting, ms) and `repliedAt` (when the reply was
  given, ms), plus `queuedBehind: "user"` while a message waits behind the user. Another user's
  rows are never returned.
- **Delivery.** `status` is `unconfirmed` until the recipient's `onMessageReceived` takes the
  message, `delivered` once it lands in the recipient's conversation, `refused` (final, with
  `reason`), or `undeliverable` when nobody took it within the host's `maxDebtAgeMs` (a day by
  default). Until it lands, the sending session's board pass sends it again: 2 seconds after the
  send, then at a doubling gap up to 5 minutes. Each resend checks the recipient again, so a message to a
  worker fired since the send is refused (`no_worker` or `worker_unavailable`). A busy host turning it
  away for now (`dispatch-rejected`), `no-dispatch-operation`, `flow-not-found` and a thrown
  dispatch are sent again; `no-entry`, a missing or unaddressable session and a refused session
  create are final. A message is heard once: however many copies arrive, it lands once and wakes
  one turn, and if a delivery stops partway, the next copy finishes it. A message that can't land after the tool answered `{ sent }` leaves one
  line in the sending session, `Your message msg_… to <worker> wasn't delivered: <reason>.`, which
  its next turn reads; no turn is started for it. Resends run on the session's wake, so they need a
  host that keeps wakes; without one, an owed message is sent again only when that session's board
  pass runs for something else. A worker flow that offers `sendMessage` without the session kit's
  `entries(turn)` is refused at hire; a flow that sends from its own code with no kit (`sendMessage(ctx, …)`)
  sends once.

A message is not a task: it files no row, owes no result, and doesn't count toward `taskChainLimit`.

### Addressing a task or a conversation

`to: { task: id }` lands in the session working that task, or that worked it, after its current
turn ends; the task's status, output and attempts don't change. `to: { session: id }` lands in one
of the user's own conversations, such as a second conversation with a worker or a project
coordinator's conversation for one project. Either wakes the worker running that session. A
refused send leaves no log row and spends no budget:

- `no_task_session`: no task of the user's with that id has a session. An unknown id, a task that
  hasn't started, and another user's task all answer this.
- `no_session`: the session is missing, or another user's, organization's or tenant's.
- `not_a_conversation`: the session works a task or is a delegate's session (message the task with
  `{ task }`), or runs a worker that hears only in task sessions.
- `no_worker`: the worker in that session is off the roster. `worker_unavailable`: it has moved to
  another flow, or its roster row has a problem.
- `not_yourself`: the session the message is sent from.
- `task_running`: for a worker that hears only in task sessions (the coder), `{ task }` is refused
  while the task or a follow-up in its session is still open; a message never reaches work in
  progress. Once they have all finished, the message wakes the worker there. A coding flow answers
  it from the coding session by passing `harnessTalkTurn` from `@flow-state-dev/harness-manager` as
  its message `turn`.

`checkTaskTarget(ctx, installation, taskId)` and `checkTargetSession(ctx, installation, sessionId,
of)` are the checks on their own, answering a `TargetCheck` (`{ ok: true, target: { sessionId,
worker } }` or `{ ok: false, error }`); `MessageTarget` is the type of `to`. A session target
needs a host whose `requestHost` carries `sessions` (the engine's does).

Every worker flow must carry an `onMessageReceived` built by `messageReceivedEntry`:
`hireWorkforce` refuses one that doesn't, naming the flow, and refuses a hand-built entry under
that name too. The session kit's `entries(turn)` includes it, with the turn wrapped by
`promptedMessageTurn`. A flow without the kit mounts it itself and adds the log to its resources:

```ts
import {
  MESSAGE_RECEIVED_ENTRY,
  messageReceivedEntry,
  promptedMessageTurn,
  workerMessagesResources,
} from "@flow-state-dev/workforce";

defineFlow({
  kind: "triage",
  // ...
  resources: { ...installation.resources, ...workerMessagesResources },
  internal: {
    actions: {
      [MESSAGE_RECEIVED_ENTRY]: messageReceivedEntry({ installation, flowKind: "triage", turn: promptedMessageTurn(answer) }),
    },
  },
});
```

`turn` is optional (left out, a message lands as its two items and nothing runs).
`promptedMessageTurn(turn)` adapts a block that takes `{ message }`, handing it
`receivedMessagePrompt(received)`: who wrote, the text, how to answer, and the budget left. See
[Messaging other workers](https://flow-state.dev/docs/workforce/messaging-workers).

## Error Reporter

A worker that turns each failure that stayed failed into one bug report, previews it to the operator, and files it to a tracker through a project's MCP servers. It takes a request that settled failed (the engine's `errorCapture` event marked `final`), a task, a routed one included, on a conversation board that ended errored (sent with the failure's notice to the filing conversation, and sent again with it if that notice is lost; a cancelled one, a routed task whose run was stopped included, ends `cancelled` and is not reported; a user who cancelled because something went wrong describes it to the reporter instead), a coordinator crash that best fit answered with "Nobody took this message" (sent by the coordinator, since its request completes), and a problem a user describes in its conversation. User docs: [The Error Reporter](https://flow-state.dev/docs/workforce/error-reporter).

```ts
import { createErrorReporter, defineErrorReporterFlow, defineErrorReporterIntakeFlow } from "@flow-state-dev/workforce";

const reporter = createErrorReporter({
  worker: "error-reporter",                       // a WORKER.md whose flow is `error-reporter`
  operator: { userId: "olive", orgId: "acme" },   // who previews and files
  tracker: { project: "shared/storefront" },      // absent: reports are kept, never filed
});
const reporterFlow = defineErrorReporterFlow({ reporter, installation, harness, mcpTools }); // a worker flow
const intake = defineErrorReporterIntakeFlow({ reporter });                                  // a plain flow

createFlowState({ flows: { /* ..., intake */ }, durable: true, errorCapture: reporter.capture });
await reporter.bind(host); // after the runtime exists; restarts owed work
```

- **One report per fingerprint** (flow, action, error code, normalized message). A repeat raises the count; a redelivered occurrence counts once. At most `limits.newPerWindow` (5) new reports per `limits.windowMs` (1 hour); the rest go into one storm report.
- **Secrets are redacted at intake**, before a row, a held request or a storm entry is written: the environment's keys, `secrets()`, and the operator's stored MCP keys.
- **The draft run has no tracker tools.** A separate filing run gets the tracker project's MCP servers, and a failed filing is tried again.
- **Preview.** The draft waits on a `human_input` suspension (so the runtime needs `durable: true`) until the operator files or dismisses it, unless `preview.autoFile` or `preview.autoFileAfterMs` say otherwise.
- **A filed report's repeats** add a comment at most every `limits.commentEveryMs`.
- **It never reports its own failures**, and runs on its own flow, never through a coordinator.

## Importing from a browser component

The package root is server code. It reaches the task board, which imports
`node:async_hooks`, so a bundler building a client component can fail on any root import it cannot
drop. A client component imports the few names a panel reads with from the `./browser` subpath:

```ts
"use client";
import { COORDINATOR_FLOW, createWorkforceClient } from "@flow-state-dev/workforce/browser";
```

It exports `createWorkforceClient`, `deriveWorkerSessionId`, `isDerivedWorkerSessionId`,
`ROSTER_FLOW`, `WORKER_ID_STATE_KEY`, `COORDINATOR_FLOW`, `COORDINATOR_ROUTE`, `COORDINATOR_JUDGMENT` (the
coordinator's own turn's answer name, which its messages carry as `agentName`) and
`sessionIdOfFiling` (the conversation a board row was filed in), `RULE_TOOLS`, `MAX_RULES`,
`MAX_RULE_CHARS`, `STANDING_RULES_ACTION`, `STANDING_RULES_LINE`, `SET_WORK_PROJECT_ACTION`,
`WORK_PROJECT_STATE_KEY`, `SEND_MESSAGE_TOOL` (the
tool a sent message is a call to), `MESSAGE_RECEIVED_ENTRY`, `RECEIVED_MESSAGE_COMPONENT` (the
component a received message is drawn by), `WORKER_MESSAGES_PATTERN`,
`WORKER_MESSAGES_RESOURCE` and `workerMessageRowSchema`, the same values the root exports, and reaches no Node built-in.

## Exports

| Export | Description |
|--------|-------------|
| `defineAgentWorkerFlow(options?)` | Build the `agent` worker flow, the one the framework ships. With `installation` it is the copy every worker on `agent` shares: it declares the installation's session and documents, loads the turn's worker in `request.onStarted`, and refuses a turn whose input names a worker; called with factory options (`AgentWorkerFlowOptions`) it is the replacement you register under `agent`. Its flow declares `run` (public) and a `work` task entry that takes the tasks a conversation files for its workers. |
| `AGENT_FLOW` | The kind name (`"agent"`) the hire step defaults to, and the key a replacement registers under. |
| `takeFinishedTasks` / `finishedTaskSchema` / `FinishedTask` | A handler block that takes the tasks this conversation filed whose endings haven't been heard yet, says each as a line under its delegate's name, and returns them as `{ taskId, ending, worker?, line }[]`. Input is ignored. `[]` outside a turn a user's own message started (see [Answering again with finished tasks](#answering-again-with-finished-tasks)). |
| `finishedTasksAnswerAgain({ message? })` / `FinishedTasksAnswerAgainOptions` | The block `answerAgain: true` uses: `takeFinishedTasks`, then `{ message }` built from the lines, or `{}` when nothing finished. `message(finished)` replaces the default wording. |
| `MAX_ANSWERS_AGAIN` | `3`, the most times one request answers again after its turn, the answer after a plan included. |
| `definePersona(config)` | Declare a persona resource or collection. |
| `createWorkforceCapability({ roster, inventory, sources? })` | The discovery door. Installs the `workers` source plus whatever other domains' sources you pass, and contributes one control tool, `discover`, which lists the standard workers the files declare. |
| `workforceManifestSources({ roster, inventory })` | The `workers` source on its own, for an app assembling its own manifest registry. |
| `createWorkerInstallation({ standardWorkers?, workerFlows?, workerBlocks?, packageBlocks?, documents?, references?, skills?, packages?, projectCoordinator? })` | The worker model's one module (see [Workers as data](#workers-as-data)). `projectCoordinator` names the standard worker on the `coordinator` flow every user's project coordinator runs as (see [Projects](#projects)); any other worker throws. Returns `resources` and `session()` for a worker flow to spread in, the `createCheck` that names a session's worker at create, `resolveWorker(ctx, flowKind)` for each turn, `standardWorker(id)`, `workerFlows()` and `configurationProblems(id, row)`. `workerFlows` may be a function, read when first needed. |
| `installation.rosterWorker(ctx, id)` / `installation.standardWorkerProblems()` | The worker an id names on the session user's roster, read by id (`undefined` for another user's, as for a missing one); and every standard worker's configuration problems, for a load-time refusal. |
| `installation.roster(ctx)` | The session user's whole roster, as it stands when called: their own workers and every standard worker, sorted by id, each a `RosterWorker` (whose `delegates` lists the worker ids its configuration names; empty when none). The block must declare `installation.resources`. |
| `defineCoordinatorFlow({ installation, routeModel, agent?, roundDeadlineMs? })` | The `coordinator` worker flow (see [Coordinators](#coordinators)): `respond`, `addDelegate`, `removeDelegate`, `setFallback` and `listDelegates`. Its judgment is the agent's turn, built with the `agent` options; `agent.isolateUserState` keys this flow's user-scoped storage by its copy, as it does `agent`'s. `roundDeadlineMs` is how long a round waits for its answers (five minutes by default); a value that isn't a positive whole number of milliseconds throws. |
| `defineSessionBoard({ installation, flowKind })` | The task-filing kit for a worker flow of your own (see [Delegating work](https://flow-state.dev/docs/workforce/delegating-work)): `tools` for the model block's `uses` (Orchestration's task tools, present only while the session has a delegate that takes tasks), `progress` for the same `uses` (`reportProgress` on a turn working a task), `delegateTools` for the same `uses` (`listDelegates`, plus `addDelegate`, `removeDelegate` and `setFallback` on a worker set to `editsOwnDelegates: true`), `actions` (the task tools as `<tool>_tasks`, plus `addDelegate`, `removeDelegate`, `setFallback` and `listDelegates`), `resources`, `sessionStateShape` for `installation.session(...)`, `serverOwned` for `session.serverOwned`, `messages` for the same `uses` (the `sendMessage` tool; see [Worker messages](#worker-messages)), `entries(turn)` for `internal: { actions }`, which carries `onTaskSettled` (where each ending of a task the session filed arrives, once) and `onMessageReceived` (where a worker message arrives), `planned(turn)` to wrap a turn so the steps its worker files for itself run in its request (use the wrapped turn for `run`, the task entry and `entries`), and `files(ctx)` / `taskDelegates(ctx)` to read whether the session files and who takes its tasks. |
| `coordinatorConfigSchema()`, `coordinatorRouteRecordSchema`, `COORDINATOR_FLOW`, `COORDINATOR_ROUTE` | A coordinator's configuration, its routing record, the flow's kind and the record's component name. |
| `workerFlow(build, { standardOnly?, roles? })` | A worker flow built on its installation, for a flow in its own file: the installation calls `build(installation)` once. `roles` declares what it does beside taking a message (`contributor`, `manager`), checked at hire. Goes in `workerFlows`, and is what `fsdev gen`'s `workerFlows` holds. |
| `WORKER_ROLES` / `WorkerRole` | The roles a worker flow may declare: `contributor`, `manager`, `coordinator`. |
| `upgradeWorkerEntryNames(stores, flows, { incarnationOf })` / `EntryNameUpgradeStores` / `EntryNameUpgradeOptions` / `EntryNameFlow` / `EntryNameRequest` | Run once at host start, before `getRouter()`, with `hireWorkforce`'s copies and the engine's `resolveRequestIncarnation` as `incarnationOf`: rewrites unfinished requests stored under a worker's old door (`run`, `message`) to `respond`, and requests and wakes under `runTaskBoard` to `dispatch`, on the registered worker flows only. Each rewrite is fenced on the record's incarnation, and the live-request registry's entries are renamed too. Returns `{ requests, wakes, leftover }`: how many writes applied, and how many wakes kept changing through every attempt to move them (each warned of, and moved by the next start). |
| `inventoryWorkers(installation)` | The standard workers as `openInventory` takes workers: each worker's id, its flow and that flow's actions. |
| `workerConfigOf(ctx)` | The configuration of the worker the turn loaded, synchronously, for a prompt, a tool list or a step condition. Throws when the turn loaded no worker: call `installation.resolveWorker` in the flow's `request.onStarted`. |
| `createWorkerHireBlocks(installation)` | `{ hire, fork, edit, fire }`: writes to the caller's own roster, each checked as a turn would check it before anything is written, each refusing a standard worker's id. |
| `defineWorkerRosterFlow(installation, actions?)` | The roster flow (`workforce-roster`), which declares the two worker collections so a client reads a user's roster through one session of it. Mount the hire blocks on it as actions. |
| `createWorkforceClient(fsd)` | `roster()`, `findWorkerSession(criteria)`, `ensureWorkerSession(criteria)`, `listWorkerSessions(worker)` (the user's conversations with the worker as `WorkerSessionEntry` rows, `{ session, isDefault }`, the default first, then by latest activity), `standingRules(worker, input)` (see [Standing rules](#standing-rules)) and `setWorkProject(worker, { visibility, id }, { sessionId? })` (see [Projects](#projects)), through the client it is given (any `createClient` client; it reads `userId`, `flow`, `sessions` and `resources`). `criteria` is a `WorkerSessionCriteria`: `worker`, and optional keys such as `projectId`, which finds or starts the user's project coordinator for that project. From `./browser` only. |
| `RULE_TOOLS`, `MAX_RULES`, `MAX_RULE_CHARS`, `STANDING_RULES_ACTION`, `STANDING_RULES_LINE`, `STANDING_RULES_RESOURCE` | The four rule tools' names, the list's limits (20 and 300), the flow action `standingRules` calls, the `agentName` a rule write's line carries, and the resource the list is kept under. All but `STANDING_RULES_RESOURCE` are also exported from `./browser`. |
| `SET_WORK_PROJECT_ACTION` / `setWorkProjectAction` / `WORK_PROJECT_STATE_KEY` | The action `setWorkProject` calls (`"setWorkProject"`), the action itself for a worker flow of your own to declare under that name, and the server-owned session-state field it writes (`"workProjectId"`, `<visibility>/<id>`). The two constants are also exported from `./browser`. |
| `deriveWorkerSessionId({ userId, orgId, flow, criteria })` / `isDerivedWorkerSessionId(id)` | The id `ensureWorkerSession` creates a session at, and the shape a worker flow's create check reserves for the user it derives to. |
| `WorkerTurnRefusedError` | What `resolveWorker` throws when a turn can't run as the session's worker; nothing is written. |
| `defineWorkerCollection()` / `workerRowSchema` / `parseWorkerRow(value)` | The user's worker collection at `workforce/workers/*`, user scope, and its row. |
| `WORKER_ID_STATE_KEY`, `WORKERS_RESOURCE`, `STANDARD_WORKERS_RESOURCE`, `ROSTER_FLOW` | The readonly session-state field naming a session's worker (`"workerId"`), the accessors the two worker collections are declared under, and the roster flow's name. |
| `WORKER_DISCOVER_KEY` | The pinned worker-file key, `"discover"` — the domains one worker sees, out of what its scope carries. Narrows only: a worker can never reach a domain the app did not install. |
| `readDeclaredRoster(root)` | Read the whole tree in one call — workers with their skills and packages in reach, teams and documents — plus one list of everything that failed to load, each entry tagged with the layer that reported it. Collects rather than throws, so the boot policy stays yours. Ships from the `./loader` subpath (Node only). |
| `readWorkforce(root)` | Read the tree into worker records that already carry their own skills and the packages in their reach — `readWorkforceDirectory` joined with `readWorkerSkills` per worker and `readPackagesDirectory`. Returns `{ workers, errors, skillErrors, teams, teamErrors, packageErrors }`. Reach for it when workers are all you need. Ships from the `./loader` subpath (Node only). |
| `readWorkforceDirectory(root)` | Read every `org/workers/<name>/` and `teams/<id>/workers/<name>/` folder into one `WorkerManifest` per worker, org workers first, without their skills. Ships from the `./loader` subpath (Node only). |
| `readPackagesDirectory(root)` | Read every `packages/<name>/PACKAGE.md` at the org, team and worker levels into one `PackageManifest` each, returning `{ packages, errors }`. Ships from the `./loader` subpath (Node only). |
| `readWorkerSkills(root, { team, worker })` | Read one worker's skills across the org, team and worker levels into `InitialSkill[]`. Leave `team` out for an org worker: it reads `org/skills` and `org/workers/<worker>/skills`. Ships from the `./loader` subpath (Node only). |
| `parseDeclaredWorkerId(id)` | Read a declared worker's id back into its folders: `"<name>"` is an org worker, `{ name }`; `"<teamId>.<name>"` a team worker, `{ team, name }`. `undefined` for an id that matches neither shape. For a runtime-hired worker, pass `workerId`, not `id`: its `id` is the `<orgId>.<workerId>` address, which would parse as a team worker. Ships from the package root. |
| `openRoot(root)` / `walkTeams(root, report)` | The walk every reader above shares: open the configured root (throwing on a symlinked or unreadable one, with or without a trailing separator, and on one spelled with a `..` that steps back through an earlier segment — pass the path it resolves to; a `.` segment and anything above the root are not checked), then enumerate `teams/`, reporting a team folder that is refused or unreadable and yielding the rest. `report` may be `async` and is awaited before the walk moves on. What a reader does *inside* a team stays its own. Ships from the `./loader` subpath (Node only). |
| `classify(path)` / `openStructuralDirectory(path, reportAs)` | One path's entry kind without following symlinks, and one structural folder's entries — or the reason the walk stops there, or neither when it is simply absent. Ships from the `./loader` subpath (Node only). |
| `refusedSymlink(what, name)` / `unreadable(what, name, cause)` / `IGNORED_ENTRIES` | The one wording for each refusal, and the one set of names that never denote anything in the tree — a `ReadonlySet` that cannot be written to, since every reader in the process reads it. Ships from the `./loader` subpath (Node only). |
| `validateSegment(segment, label)` | The one rule for what a name in this tree may be — lowercase letters, digits and single hyphens, under 64 characters, not reserved. Throws naming the segment and what it would have become. Ships from the `./loader` subpath (Node only). |
| `discoverWorkforceCode(root)` | Walk `flows/workers/` and `blocks/` one level deep, every `resources/` folder the convention reads, every `blocks/` folder inside the team tree, and every package's `blocks/` folder, returning what they hold on `files`, `resourceModules`, `workerBlocks` and `packageBlocks` — each ordered by path — plus the `searched` patterns. Reads the tree only — it opens none of the modules it finds. Throws a `WorkforceCodeError` carrying every refusal. Ships from the `./codegen` subpath (Node only). |
| `renderWorkforceCode(files, modules, workerBlocks?, packageBlocks?)` | Render a discovery's `files`, `resourceModules`, `workerBlocks` and `packageBlocks` as a module of static imports exporting `workerFlows`, `blocks`, `resourceModules`, `workerBlocks` and `packageBlocks`. Pass all four: the last two default to `[]`, so omitting one renders an empty map and reports nothing. Deterministic: the same tree renders the same bytes. `fsdev gen` is a thin command over this and the call above. Ships from the `./codegen` subpath. |
| `hireWorkforce(installation, { taskChainLimit?, messages? })` | The flows to register for an installation: one copy of each worker flow, under its name, and the roster flow (`workforce-roster`) with `hire`, `fork`, `edit` and `fire`. Throws, naming every problem, when a worker flow misses the contract or doesn't declare the installation's session, or when a standard worker would be refused on its first turn; nothing is registered. `taskChainLimit` is the most tasks one top task may have under it, at any depth (100 when omitted); a value that isn't a whole number of at least 1 throws. `messages: { hopLimit?, perTurn? }` limits [worker messages](#worker-messages) (6 and 3 when omitted), under the same rule. |
| `SEND_MESSAGE_TOOL` / `MESSAGE_RECEIVED_ENTRY` / `RECEIVED_MESSAGE_COMPONENT` / `WORKER_MESSAGES_RESOURCE` / `WORKER_MESSAGES_PATTERN` / `workerMessageRowSchema` / `WorkerMessageRow` / `MAX_MESSAGE_CHARS` / `DEFAULT_MESSAGE_HOP_LIMIT` / `DEFAULT_MESSAGES_PER_TURN` / `sendMessageInputSchema` | [Worker messages](#worker-messages): the tool's name (`"sendMessage"`), the entry a message arrives on (`"onMessageReceived"`), the component item type a received message is drawn by (`"workforce:received"`), the log's accessor and pattern and its row schema, the 8,000-character cap, the default limits (6 and 3), and the tool's input schema. Also exported: `MESSAGE_STATUSES`, `MessageAddress`, `workerMessagesCollection` and `workerMessagesResources` (the log as a flow resource), and `sendMessage(ctx, installation, flowKind, { to, text, inReplyTo? }, from, { id? })`, the send the tool runs, answering a `SendOutcome` (`{ ok: true, id }` or `{ ok: false, error }`); its input type is `SendMessageInput`. Pass a server-chosen `id` to make a repeated send one message: when its row already exists, the repeat writes nothing, spends no budget and answers `{ ok: true, id }`. The tool never passes one. `checkTaskTarget` / `checkTargetSession` / `MessageTarget` / `TargetCheck` / `CheckedTarget`: see [Addressing a task or a conversation](#addressing-a-task-or-a-conversation). |
| `messageReceivedEntry({ installation, flowKind, turn?, hears? })` / `MessageHearing` | The `onMessageReceived` internal entry every worker flow carries (see [Worker messages](#worker-messages)). `turn` runs with a `MessageReceived` after the message lands; left out, nothing runs. `hears: "task-sessions"` (`MessageHearing`) makes the flow's workers hear only in their tasks' sessions, refusing a message by name with `task_sessions_only`. The session kit's `entries(turn)` includes one. |
| `messageReceivedSchema` / `MessageReceived` / `messageReceivedInputSchema` | What a turn hears, `{ id, from, text, call, inReplyTo?, budget }` (`call` is `true` for a call, whose reply is the turn's final text; `budget` is how many more messages the exchange can send), and what the entry takes, `{ messageId }`. |
| `promptedMessageTurn(turn)` / `receivedMessagePrompt(received)` | Wrap a block that takes `{ message }` so it can serve as `messageReceivedEntry`'s `turn`, and the text it hands that block: who wrote, which message, how to answer with `sendMessage` and `inReplyTo`, and the budget left; for a call, that the sender is waiting and the reply is the turn's final text. |
| `mergeWorkerFlows(flows, workers)` | Add the flows `hireWorkforce` returned to your app's flows record under their ids, for `createFlowState({ flows })`. Throws, naming the id, when one is already in `flows`. |
| `workerFlowProblems(name, flow, roles?)` | Every way `flow`, registered as `name` with `roles`, misses the worker contract: a name that is not its `kind`, a configuration it refuses by key or by value, or takes but rewrites, no `respond` door (or a second door, or its door under another name), a declared role's entry missing, not its factory's or refusing its input, a role's piece on a flow that doesn't declare the role, a resource with `writtenBy` that `sharedResource()` didn't build. `roles` defaults to a built-in flow's own, and none for any other. An empty list for a worker flow. The check `hireWorkforce` runs, exported for a library's own tests. |
| `sharedResource(pattern, shape)` | An org-scoped collection whose every entry carries a required `writtenBy: { userId, workerId? }` beside the fields of `shape`. An entry written without it is refused by the resource's own schema. The only way to declare a resource with `writtenBy` on a worker flow: the contract refuses one defined by hand, or a copy of this one with its schema replaced. |
| `writeShared(ctx, accessor, key, data)` / `WrittenBy` | Write one entry of a shared resource, creating or replacing it, stamped with the session's user and, when the turn loaded the session's worker with `resolveWorker`, that worker's id. A `writtenBy` in `data` is ignored, and so are a `workerId` setting and a `workerId` in the session's state: a turn that loaded no worker records the user alone. Flow code that writes the resource directly can set its own value, so `writtenBy` is as trustworthy as the registered flow's code; it is for display and audit, never for deciding who may write. |
| `workerConfigSchema()` | The admission contract every hireable worker flow composes: `configSchema: workerConfigSchema().extend({ ...its own settings })`. Declares `instructions?`, `teamInstructions?`, `workerSkills`, `workerTools`, `workerPackages?` and `workerId`. A worker flow whose schema cannot take what hiring imposes refuses the whole roster at startup. A fresh schema per call. |
| `workerPackageSchema` | One held package as it rides into the bag — `{ name, path, instructions?, tools }`, closed. The shape `workerPackages` is an array of. |
| `workerSkillSchema` | One skill as it rides into the bag — `{ name, skillMd, files? }`, closed. The shape `workerSkills` is an array of; reach for it when declaring your own variant of that key. |
| `WorkerConfig` | The parsed shape of `workerConfigSchema()` — what every hireable worker flow receives, whatever else it extends on. |
| `readResourcesDirectory(root)` | Read every `resources/` folder in the tree — org, team, and each worker's own — into one `ResourceDoc` per document. Ships from the `./loader` subpath (Node only). |
| `resourcesFromDocs(documents)` | Turn document records into the flow resource map, keyed by each document's ref. Spread it into your own `resources`. |
| `readReferencesDirectory(root)` | Read every `references/` folder in the tree — org, team, and each worker's own — into one `ResourceDoc` per document, each carrying its `filePath`. Same result shape and same error kinds as `readResourcesDirectory`. Ships from the `./loader` subpath (Node only). |
| `referencesFromDocs(references)` | Turn reference records into the flow resource map, keyed by ref. Each entry is served from its file and is read-only. Throws naming the ref for a record with no `filePath`. |
| `clearShadowedReferences(input)` / `describeShadowedReferences(result)` | Clear the stored rows left behind when a document moves from `resources/` to `references/`, for one org, and render the result as one log line. Takes `{ references, orgId, content, installedOn, dryRun? }`; returns `{ cleared, checked, dryRun, scopeId }`. |
| `splitResourceModules(resourceModules)` | Split the generated map into `{ capabilities, resources }` — the capabilities a worker flow installs through `uses`, and the resources that merge into the one resource map. Installs nothing: you pass both on, at your own call site. Throws naming the ref when an entry can be neither. |
| `DeclaredRoster` / `DeclaredProblem` | What `readDeclaredRoster` returns: `{ workers, teams, documents, references, problems }`, and one problem: `{ layer, path, error, worker? }`, where `layer` is `worker`, `skill`, `team`, `package`, `document` or `reference`. |
| `WorkerManifest` | One worker record: `{ id, declared, body, skills?, teamInstructions?, packages? }`. |
| `PackageManifest` | One package record: `{ name, path, level, team?, worker?, description, instructions? }`, where `level` is `org`, `team` or `worker` and `path` is the key its blocks sit under on `packageBlocks`. |
| `ResourceDoc` | One document record: `{ ref, declared, body, filePath? }`. |
| `mintResourceRef(teamId, workerName, name)` | The one rule that names a resource, whichever door read it — the ref a document or a module called `name` in that folder gets. Throws naming the segment that breaks the rules. Ships from the `./loader` subpath (Node only). |
| `ResourceModules` | The generated `resourceModules` map: one entry per discovered module, keyed by its ref. |
| `ResourceModuleExport` / `WorkerResourceModuleExport` | What a module in the organisation's or a team's `resources/` folder may be — a capability or a resource — and the narrower type a worker's own folder is held to: a resource, never a capability. |
| `WorkerCapabilitySelection` | What a worker file's `capabilities:` key parses to — capability name to the presets that worker wants. Read by the built-in `agent` worker flow; validated at the hire. |
| `defineProjectsCollection()` / `definePrivateProjectsCollection()` | The shared projects (`projects/*` at org scope) and the private ones (the same keys at each user's scope), both shared across flows and browser-readable through `expose`. Every call returns the same declaration, so they never conflict. `defineProjectFilesCollection` and `definePrivateProjectFilesCollection` declare the files; neither has a browser read. |
| `defineProjectBlocks({ mcpServers? })` | Returns `{ createProject, setRepository, setMcpServers, setBrief, readProject, listProjects, readProjectFiles, actions }`. `mcpServers` names the MCP servers a project may name; absent, none. See [Projects](#projects). |
| `projectMcpTools(servers, { operator?, env? })` / `ProjectMcpServers` / `ProjectMcpToolsResolver` | The resolver a coding harness calls once per run for its project's MCP tools, relayed through FSD's own connection with the run owner's key. See [Projects](#projects). |
| `defineMcpCredentialsCollection()` / `mcpCredentialsCapability` / `mcpCredentialProblem(value)` / `MCP_CREDENTIALS_PREFIX` | Each user's MCP server keys, `mcp-credentials/*` at user scope (client read: `setAt` only), the capability the resolving block holds, and the check a key route runs on a value. |
| `checkedMcpServers(names, offered)` / `isMcpServerName(value)` | The check both project writes run on `mcpServers`. |
| `defineWorkstreamBlocks({ installation, leadFlows, leadFit? })` | Returns `{ openWorkstream, openWorkstreamTool, updateWorkstream, updateWorkstreamTool, editWorkstreamTool, listLeadsTool, actions }`. `editWorkstreamTool` (input `editWorkstreamInputSchema`) is a project coordinator's change to one of the caller's own workstreams by id. `openWorkstreamTool` is the open for a worker; with `leadFit: { model }`, it asks best fit's one fit check about the lead and refuses with `lead-doesnt-fit` only when the check answers that none fits. Each lead flow declares `workstreamOpenedEntry()` under `internal.actions[WORKSTREAM_OPENED_ENTRY]`, as the built-in `agent` flow does; one that doesn't throws. See [Projects](#projects). |
| `readProject` / `projectProgress(entries, now)` / `STALE_AFTER_MS` / `DONE_STATUS` | A project's row, entries and progress, and the progress function itself (also from `./browser`): counts by status, objectives met, the next due date, and the entries not done and unchanged for `STALE_AFTER_MS` (seven days). `"done"` is the one status with a meaning. |
| `parseWorkstreamEntry(path, state)` | One entry read off its storage key and checked against `workstreamEntrySchema`, with its `project`, `owner` and `id`; `undefined` for a key that isn't an entry. Also from `./browser`, for a browser reading entries through the resource routes. |
| `projectCoordinatorTools` | `{ readProject }`, the project coordinator's tool, which marks each workstream `yours` when the user it talks to owns it: put it in `defineCoordinatorFlow({ agent: { catalog } })` and name it in the coordinator's `tools:`. Add `setBrief` and `setRepository` from `defineProjectBlocks()` for it to manage its own project. |
| `linkedProjectOf(state)` | The `{ visibility, id }` a session's state links it to by its `projectId`, or `undefined`. |
| `projectWorkspace({ checkouts? })` / `projectWorkspaceCapability` / `ProjectCheckout` | A run source for a coding run on a project: from the workstream its session leads or was filed from, the project its conversation belongs to or was set to, or the project its task names. `checkouts` (`ProjectCheckout[]`: `{ remote, checkout, projects, baseRef? }`) sends the listed shared projects' runs, in their own organization, to a checkout on this machine. The capability holds the collections it reads. See [Projects](#projects). |
| `createWorkerLookup({ installation })` | Which standard worker a task's name means. Returns `{ find, flowKind, state, filingCheck }`. `find(name)` answers `{ found: true, flowId }`, or `{ found: false, reason, message }` with `reason` `not-found` or `takes-no-tasks` (a worker whose flow declares no `work` task entry). `flowKind` and `state` are a `per-task` dispatcher's targets: the flow of the worker the task's `assignee` names, and a starting state naming that worker. |
| `WORKER_TASK_ENTRY` | `"work"`, the task entry a worker flow takes tasks through. |
| `workerTaskEntry({ name, turn \| block })` / `WorkerTaskEntryOptions` / `WorkerTaskBlockInput` / `conversationLedgers` / `filingConversationBoard` | The `work` task entry for a worker flow of your own: `task: { actions: { work: workerTaskEntry({ name, turn }) } }`. Each task a coordinator files for one of its workers runs as one `turn` (`{ message }` in, the answer out), or, with `block` instead (one or the other, refused at build otherwise), as a block handed the task itself plus `claim` (`{ collectionId, partition, incarnationId }`, the board the task was claimed from, never read from the task), in a task session of its own, and the conversation that filed it is told when it ends. A flow whose `work` entry is built any other way takes no conversation task: `listDelegates` reports it as taking `nothing`, and a filing for it is refused. `conversationLedgers(ledgerId, ctx, partition)` finds the board of the conversation a task came from; pass it to a harness manager that takes tasks from conversations. `filingConversationBoard(ctx)` answers, in a task session, that conversation's board with the entry and flow that run it there (`{ tasks, runEntry, filingFlow, filingSession }`), for a door over the session's run (`harnessSessionDoor`'s `board`). A coding run's `projectWorkspace()` finds its project from the filing workstream, then the project of the conversation that filed it, then the task's `input.project` (`{ visibility, id }`, checked against the run's own user), then the `board` claim. |
| `STEER_TURN_ENTRY` / `steerTurnEntry({ name, turn \| block, concurrency? })` / `SteerTurnEntryOptions` / `startOwedSteerTurn(ctx, row, flowKind?)` | The turn a task is owed for a message no request of its attempt took: one that landed after its worker's last model call, or while it waited on pieces it filed. Declare it beside `work` on a worker flow of your own, with the same `turn` or `block`: `internal: { actions: { [STEER_TURN_ENTRY]: steerTurnEntry({ name, turn }) } }`. A `turn` gets the messages as its message; a `block` gets the task as the board packs it, messages included. The messages it takes also show in the session as lines from their senders, so a later turn there reads them. Its answer is the task's result, as a woken turn's is. `startOwedSteerTurn` starts that turn in the session the row's run link names. The turn runs even if that first start is lost. A coding flow's `harnessSessionDoor` takes it as `onSteered`. |
| `defineWorkerInventoryCollection()` | The worker inventory: one org-scoped row per registered worker, at `inventory/workers/<workerId>`. Takes no options; install what it returns under a block's `resources`. |
| `WorkerInventoryRow` | One row of the inventory. |
| `workerInventoryRowSchema` | The Zod schema behind the row type. Closed: an undeclared key is dropped on the way in. |
| `openInventory(roster, options)` | Write the inventory at boot: one row per worker. Takes `InventoryRoster` (the workers to register) and `OpenInventoryOptions` (the `run` callback, `workerWriter`, `userId`, `orgId`). Returns `{ workers, problems }`. |
| `inventoryWriterActions()` | The action that writes the inventory's rows, keyed by its name (`registerWorkersInInventory`). Spread it into a flow's `internal.actions`, never `actions`: its input is row data, with nothing to check it against. Name that flow as `openInventory`'s `workerWriter`. |
| `INVENTORY_REGISTER_WORKERS` | The action name the writer runs: `"registerWorkersInInventory"`. |
| `INVENTORY_WORKER_WRITER_SESSION` | The session id the worker-registration action runs under when `workerWriter` names none: `"inventory-binder"`. |
| `InventoryRoster` / `InventoryWorker` / `InventoryWorkerWriter` | What `openInventory` takes: the roster (`{ workers }`), one worker (`{ id, kind, actions }`: its `door` action and `rules` read from `actions`, `{}` for a worker with none), and which flow writes the rows (`{ flowKind, sessionId? }`). |
| `InventoryActionRequest` / `InventoryBinding` | What the `run` callback receives (`{ action, input, userId, orgId, flowKind, sessionId, source? }` — `source` is `"internal"` on the request and must reach `runAction`), and what one boot of `openInventory` returns (`{ workers, problems }`). |
| `OpenInventoryOptions` | The options `openInventory` takes: `run`, `workerWriter`, `userId`, `orgId`. |
| `workerDoorOf(worker)` / `WorkerDoor` | A hired worker's door: `respond`, the public action its worker flow declares with `userMessage` and a `{ message }` input. Returns `{ door, problem? }`. `door` is `"respond"`, or `null` with `problem` saying what to fix when the flow has none, a second, or its door under another name. `openInventory` writes it on the worker's row. Such a flow is refused when hired, so a hired worker's door is always `respond`. |

## Error Semantics

| Error | When |
|-------|------|
| Two sources claiming one discovery domain | `createWorkforceCapability` construction, naming both registration sites |
| A worker file's `discover:` names something that is not one of the three domains | The mint, by name, listing `workers`, `skills`, `resources`. A correctly spelled domain the scope does not carry is *not* an error — the worker sees nothing for it |
| Worker folder unreadable | Collected in `readWorkforceDirectory`'s `errors`, keyed by the folder's path — never thrown |
| Workforce root unreadable or symlinked | `readWorkforceDirectory` and `readWorkforce` throw — the root is never followed through a link |
| Anything below the root, read as one tree | Collected in `readDeclaredRoster`'s `problems`, one entry per thing that did not load, tagged with the layer that reported it — never thrown |
| Workforce root unreadable, symlinked, or spelled with an interior `..`, read as one tree | `readDeclaredRoster` throws, naming the path — its only throw |
| One worker's skills failed to load | Collected in `readWorkforce`'s `skillErrors`, one entry per affected worker, each carrying that worker's id and `readWorkerSkills`' own error list |
| Bad `team` or `worker` name | `readWorkerSkills` throws |
| Skills root unreadable or symlinked | `readWorkerSkills` throws — the root is never followed through a link |
| Skills level unreadable | Collected in `readWorkerSkills`'s `errors` as `kind: "unlistable-level"`, keyed by the level's path — an absent level is empty instead |
| Skill folder fails to load | Collected in `readWorkerSkills`'s `errors` as `kind: "skill-load-failed"`, keyed by `<level>/<folder>` |
| Symlinked folder on the way to a level | Collected in `readWorkerSkills`'s `errors` as `kind: "refused-symlinked-ancestor"`, keyed by that folder's path — never followed |
| Symlinked `skills/` folder at a level | Collected in `readWorkerSkills`'s `errors` as `kind: "refused-symlinked-level"`, keyed by the level's path — never followed |
| One skill name at more than one of a worker's levels | Collected in `readWorkerSkills`'s `errors` as `kind: "duplicate-skill-name"`, keyed by the level the name was first seen at, with every colliding path on the entry's `paths`; the name is left out of `skills` |
| `scope:` in a `SKILL.md` | Collected in `readWorkerSkills`'s `errors` as `kind: "refused-scope-key"`, keyed by the skill's path |
| Worker flow misses the contract | `hireWorkforce`, before anything is registered — a flow passed under a key that is not its own kind, a configuration it refuses by key or by value, or takes but rewrites (composing `workerConfigSchema()` is the fix), no door or two, no installation session, or a resource with `writtenBy` that `sharedResource()` didn't build. Collected: one error names every problem with every flow, and nothing is hired |
| Worker cannot run | For a standard worker, `hireWorkforce`; for a user's own worker, the `hire`, `fork` or `edit` that saves it, and its turn — an empty or whitespace-only `flow`, an unknown flow, a user's own worker naming a flow marked `standardOnly` (or naming none, when `agent` is marked), a duplicate standard id (`createWorkerInstallation`), a setting or body the flow never declared, a `tools:` name nothing registers for that worker, a registered block whose key and own `name` disagree, a block in a worker's own folder that declares a resource, a skill name reaching one worker from both the app's `skills` and its own folders, a `resources:` list the hire step cannot resolve (a `resources:` that is not a list, an entry that is neither a ref nor a one-key `ref: mode` mapping, a ref no document matches, a ref naming a document the app declared but did not install on this worker's flow, a mode other than `ro` or `rw`, the same ref twice, `rw` on a document declaring itself `writable: false`, a ref colliding with a name the worker flow's own blocks declare, a ref the flow declares at flow level while what it holds there is not that document, or the key itself with no `documents` passed), a document a worker did not name that the worker's flow reaches anyway because one of the flow's blocks declares it, a `references:` list the hire step cannot resolve (a `references:` that is not a list, an entry that is not a ref, the same ref twice, or a ref naming a reference this worker cannot reach from its place in the tree — including every ref when no `references` map was passed), a worker id that names no place in the tree while its worker flow holds references, a reference the worker did not name that the worker's flow reaches anyway, `instructions` given both in the frontmatter and as a body, a `packages:` list the hire step cannot resolve (not a list of names, a name no library in reach offers, or a name both its own folder and a library offer), a held package's block that clashes with another tool the worker can call, registers under a name other than its own, or declares a store, a package with blocks in its own folder that failed to load, or a `persona:`, `workerSkills:`, `workerTools:`, `workerPackages:`, `workerId:` or `teamInstructions:` key. Collected: one error names every bad worker |
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
| Inventory write with no org | `openInventory` throws before writing anything — the collection is org-scoped |
| Worker inventory write with no workerWriter | `openInventory` throws when passed workers and no `workerWriter` — a worker has no session of its own, so its row needs a flow to run in |
| Worker registration failed | Collected in `openInventory`'s `problems`, once, naming every worker whose row could not be written |

## Scripts

```bash
pnpm --filter @flow-state-dev/workforce build
pnpm --filter @flow-state-dev/workforce typecheck
pnpm --filter @flow-state-dev/workforce test
```
