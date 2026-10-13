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
model: openai/gpt-5.4-mini
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
| `id` | The worker's whole identity, `"<teamId>.<workerName>"` — e.g. `"engineering.lead"`. An org worker's id is its folder name alone, with no dot: `org/workers/chief-of-staff/` is `"chief-of-staff"`, a different worker from `"engineering.chief-of-staff"`. `parseDeclaredWorkerId` reads either shape back. |
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
**`description`**, the roster label, and **[`resources`](#the-documents-a-worker-may-touch)**, the
documents this worker may touch. Everything else is that worker's settings, parsed against the
flow's `configSchema`. That schema is closed, so a setting the flow never declared is refused by
name: for a standard worker by `hireWorkforce`, before anything is registered, and for a user's
own worker when it is hired or edited.

A worker flow declares the installation's session (`session: installation.session()`), so every
session names its worker in a readonly `workerId`, checked when the session is created, and loads
that worker on every turn with `installation.resolveWorker(ctx, flowKind)`. `hireWorkforce` refuses a
worker flow that doesn't declare it.

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

The same check also requires one door, that the flow declares the installation's session, and
that any resource with `writtenBy` comes from `sharedResource()`. The door is exactly one public action that declares `userMessage` and takes
`{ message }`, so an app can talk to any worker without knowing its flow; none, or two, refuses. A
resource with a `writtenBy` field is declared with `sharedResource()`, which adds the field; one
defined by hand is refused, even with the right shape.
`workerFlowProblems(name, flow)` runs the same check without an app, for a library's own
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

`defineAgentWorkerFlow` takes three more app-level options beyond its catalog, skills and model
choices. All three are optional. `defineAgentWorkerFlow()` with no arguments builds the stock
worker.

| Option | What it does |
| --- | --- |
| `uses` | Capabilities attached to every worker's answer generator. The skills binding stays first and is never displaced. A capability passed as a plain ref brings its own storage with it; one passed as a `(ctx) => refs` resolver brings none, so anything it needs has to be declared statically somewhere. |
| `afterAnswer` | A block run after the answer as a side-chain. It receives the reply text as a string, it cannot change the answer, and a failure in it does not fail the turn. Absent, nothing runs after the answer. |
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

#### The memory recipe

Memory is one thing you can pass through these options. Install `@flow-state-dev/memory`
separately:

```ts
import { AGENT_FLOW, createWorkerInstallation, defineAgentWorkerFlow, hireWorkforce } from "@flow-state-dev/workforce";
import { system } from "@flow-state-dev/memory";

const mem = system({
  model: "openai/gpt-5.4-mini",
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
  model: "openai/gpt-5.4-mini",
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
approval before a fire is yours to add as a step before it, as the chief of staff guide shows.

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
| `defineWorkerInventoryCollection()` | registered worker, at `inventory/workers/<id>` | `id`, `kind` (the worker flow the standard worker runs on), `door` (the action that takes a user's message, or `null`), `hired` and `incarnation` (`false` and `null` on every row `openInventory` writes, since it lists only standard workers) |

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
  named `updateWorkstream`: it takes only the changes and writes the workstream its session leads
  (`not-a-workstream-session` elsewhere).
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
  owner isn't the workstream's. A task session filed from a project's conversation works in that
  project, and one filed from a conversation with no project works in the project its task names
  as `input.project`, for that project's members only (`not-a-member`). `no-project` when none
  applies. The block that asks it must hold `projectWorkspaceCapability`; with harness-manager, pass
  it on `uses`:

  ```ts
  harnessManager({
    // ...the board and the rest, as usual
    workspace: localWorkspaceHost({ root, remotes: { allow: ["github.com"] }, source: projectWorkspace() }),
    uses: [projectWorkspaceCapability],
  });
  ```

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
can't read is refused. Its `readProject` tool (`projectCoordinatorTools`) reads every entry. Its
delegates are the user's open workstreams in the project, one per workstream: the lead, with the
workstream's address as the target, so it hands work only to the user's own workstreams. They
follow the workstreams: the session's delegate list starts with one per open workstream the first
time it's read; `openWorkstream` adds one; `updateWorkstream` removes it when the status becomes
`"done"` and adds it back when it leaves `"done"`; and a hand-off to one is delivered into the
session the user's entry names, looked up at delivery, so the post lands in that workstream's
session.

To let the coordinator open workstreams, add `listLeads: workstreams.listLeadsTool` and
`openWorkstream: workstreams.openWorkstreamTool.as({ name: "openWorkstream" })` to its catalog and name
both in its `tools:`. Asked for work none of the user's workstreams covers, it lists the leads,
opens a workstream with the one whose description fits (leaving `project` out, so it opens in the
coordinator's own project), and hands the ask to it at `<project.visibility>/<project.id>/<id>`,
built from the returned workstream. Inside the owner's own coordinator turn, the new workstream can
take the hand-off as soon as `openWorkstream` returns.

`listLeads` returns every worker that can lead, whether or not it suits the work, and a coordinator
with a single lead tends to pick it. To have the open refuse that pick, pass `defineWorkstreamBlocks({ installation,
leadFlows, leadFit: { model: "openai/gpt-5.4-mini" } })`: `openWorkstreamTool` then makes one call
to that model asking whether the lead's description (as `listLeads` shows it) says it does the work in
the workstream's title and objectives. If the answer is no, the open is refused with `lead-doesnt-fit` and nothing
is written; the message tells the worker to pick another lead from `listLeads`, or, if none does the work, to open
nothing and say a worker for it has to be hired first. A failed call, or a lead with no description,
lets the open through. The check runs after every other refusal, and an open of a workstream that is
already open with the same lead isn't checked again. The tool's answer carries `leadFit`: `{ checked: true }`,
or `{ checked: false, why }` with `why` one of `already-open`, `no-description` or `unanswered: <error>`.
Without `leadFit`, `openWorkstreamTool` is `openWorkstream`. Opens
through the `openWorkstream` action, such as a user's own open from the app, are never checked.

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
  transport options `createSessionClient` takes: `baseUrl`, `apiPath`, and `fetcher`, a
  `(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>` used for every request. Wrap
  `fetch` to add the caller's credential, such as an `Authorization` header, and pass the same
  `fetcher` to `createClient`. The server decides who the caller is with `resolvePrincipal` on
  `createFlowState`. See [Authentication](https://flow-state.dev/docs/server/authentication),
  [Host adapters](https://flow-state.dev/docs/server/host-adapters) for serving it, and
  [Serving it to your users](https://flow-state.dev/docs/workforce/overview#serving-it-to-your-users).

  ```ts
  import { createClient } from "@flow-state-dev/client";
  import { createWorkforceClient } from "@flow-state-dev/workforce/browser";

  // fetcher: wraps fetch to add the caller's credential, as described above
  const workforce = createWorkforceClient({ userId, baseUrl, fetcher });

  const roster = await workforce.roster();
  // [{ id: "scribe", flow: "research", standard: false, description: "Takes notes." },
  //  { id: "researcher", flow: "research", standard: true, description: "Finds things out." }]

  const session = await workforce.ensureWorkerSession({ worker: roster[0].id });
  // { id: "wks_…", flowKind: "research", userId, createdAt, updatedAt, … }

  const research = createClient({ flowKind: session.flowKind, userId, baseUrl, fetcher });
  const { status, request } = await research.sendAction("run", { message: "Summarize the launch notes." }, {
    sessionId: session.id,
  });
  // status: "in_progress" | "completed" | "failed" | "incomplete"; use request.id to connect to its stream
  ```

  In React, build the client once with `useMemo` over the same options. `useFlow` creates sessions
  with no starting state, which a worker flow refuses, so find or start the session with the client
  and select it on the hook (`flow.selectSession(session.id)`).

  `ensureWorkerSession` returns the user's most recent session with the worker, or creates one.
  Two calls at once get the same session. `findWorkerSession` takes the same argument and returns
  the session or `undefined`, creating nothing. Both throw `No worker "<id>" on your roster.` for a
  worker that isn't on the user's roster. The roster flow keeps one session per user, of the
  flow kind `workforce-roster`; if you list every flow's sessions, filter out
  `flowKind === "workforce-roster"`. Two first calls at once may create two roster sessions, which
  is harmless: the roster lives in the user's scope, not in either session.

## Coordinators

A coordinator is a worker that hands each post to other workers on the same user's roster, its
**delegates**, by `judgment`, `best-fit`, `round-robin` or `everyone`. It runs on the
`coordinator` flow, registered on the installation like any worker flow. A delegate's flow
declares the task entry that takes a delegated post; the built-in `agent` flow declares it,
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
  task: { actions: { [DELEGATED_POST_ENTRY]: delegatedPostEntry(door) } }, // takes delegated posts
});

const coordinatorFlow = defineCoordinatorFlow({
  installation,
  delegateFlows: [researchFlow],     // the flows a delivery can reach
  routeModel: "typesafe-ai/jev",     // best fit's one evaluator call; typesafe-ai/jev reports confidence
  agent: { catalog, uses },          // what you give defineAgentWorkerFlow: the judgment turn is the agent's
  roundDeadlineMs: 5 * 60_000,       // optional: how long a round waits for its answers (the default)
});
```

Earlier versions declared the entry under `internal.actions` and named the hand-off tool `handOff`.
A delegate flow that still declares it there makes `defineCoordinatorFlow` throw, and a worker
whose `tools:` names `handOff` is refused at load; each message names the replacement.

The judgment turn is the built-in agent's own turn. A coordinator worker's `model`, `tools`,
`skills` and `capabilities` read the way an `agent` worker's do, against the catalog and
capabilities you pass as `agent`. The four delegate tools and `dispatchTask` are on every
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

- **Routing.** `judgment` runs the coordinator's own turn, which hands the post on with
  `dispatchTask` (`post: true`, the delegate as `assignee`) or answers itself. `best-fit` sends a
  follow-up to the delegate still working the
  user's last post, else makes one evaluator call over each delegate's note or description and
  the coordinator's own description, reading the post with the conversation's recent lines. When
  that call fails and `routeModel` is a model string, best fit asks once more as a language model
  (`coordinator-route-ask`). The pick has no confidence. An id the resolver can only generate
  with still routes.
  A pick of the coordinator runs its judgment turn. Best fit can't place a post when the call
  fails, answers with something that isn't a choice, has no one to pick, or picks a delegate
  below `minConfidence:` (or with no confidence, or one outside 0 to 1, while it is set). That post goes to the
  fallback, else the judgment turn. If that turn fails too, nobody takes the post, and the
  conversation says so. The judgment turn's model sees each delegate's answer prefixed
  `<worker id>, a delegate in this conversation, answered:`, and each post the routing
  handed to delegates followed by a note of where it went.
  `round-robin` sends each post to the next delegate in list order, skipping one that can't be
  reached. `everyone` sends it to each delegate that can be reached. When no delegate can be
  reached, nobody takes the post, and the conversation says so.
- **Recent lines.** Every post is routed and delivered with the conversation's recent lines: the
  user's posts, the coordinator's own replies and the delegates' answers that landed, oldest
  first, each under who wrote it (the user's id, the coordinator's worker id, or the
  answering delegate's worker id). They are the last 10, at most 4,000 characters of text in all,
  counted back from the newest; the line that crosses the cap is cut short with `…`, and older ones
  are left out. They come from this conversation's own messages, as far back as the session's
  history window reaches (its last 50 completed turns), never another conversation's. An answer
  that has just landed is among them even before the request that landed it has finished. Best fit
  reads the post with them, so a follow-up to a delegate's answer can go back to that delegate; the
  other policies don't route by them. An evaluation model passed as `routeModel` (a scripted one
  in a test, say) is handed `{ recent, post }`, each line and the post as `{ from, text }`.
  Whatever the policy, the delegate that takes a post is shown them when its generator's `history`
  is `delegatedPostHistory`: one user-role message just before the post, never system text, for
  that turn only. The built-in `agent` flow's turn uses it. The delegate's own session never keeps
  them.
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
  wakes after the deadline: a user's post, an answer, or another delegate's report. That wake
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
  Every worker flow built on `installation.session()` refuses `delegates`, `fallback`,
  `taskNotices` and `splitParent` the same way, including a flow that has no such field.
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
  coordinator's own turn hands it a post with `dispatchTask`, the refusal adds the delegates that take
  posts, `Delegates here that take posts: <ids>.`, or `No delegate here takes posts.` when none does.
- **Delivery.** Each post is one task per delegate per round on the conversation's board, so its
  answer lands under the delegate's name once. Each
  delegate's task runs in its own session per conversation, created naming the delegate as its
  worker, and reused for that conversation's later posts. A post's task can be cancelled from the
  board, but not reassigned, completed, failed or blocked. The board answers task actions only
  while one of the conversation's delegates takes tasks, and `no_delegation_board` otherwise. The
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
  when it was refused at the cap on open rounds), and `fit`: why best fit handed the post to the
  fallback or the judgment turn (`reason`: `coordinator`, `below-floor`, `no-confidence`,
  `failed`, `not-a-choice` or `no-delegates`, with the `choice`, its `confidence` and the
  `minConfidence` where there are some). When best fit's evaluator call failed and it asked again
  as a language model, `evaluationFailed` carries the evaluator's error. Render it apart from the
  conversation's lines. App code
  reads the records with `createSessionClient(...).listSessionRequests(sessionId, { includeItems: true })`,
  keeping each request's `items` whose `type` is `"component"` and `component` is
  `COORDINATOR_ROUTE`; the record is the item's `data`. Without `includeItems: true` there are no
  `items` to read.

`hireWorkforce` refuses a broken standard coordinator at load, naming the problem: a `rounds:`
above 3 (`rounds can be at most 3`), a `routing:` outside the four, a `fallback:` that isn't one
of its `delegates:`, a `minConfidence:` outside 0 to 1 or on a coordinator that doesn't route by
`best-fit`, or a delegate named twice. `installation.standardWorkerProblems()` returns the
same problems without throwing.

A coordinator conversation also keeps a task board of its own. The coordinator's turn carries
Orchestration's task tools (`dispatchTask`, `addTask`, `assignTask`, `listTasks`, `answerTask` and
the rest), and the conversation's session takes them as actions named for the board:
`dispatchTask_tasks`, `addTask_tasks`, `listTasks_tasks` and so on.

An assignee must be one of the conversation's delegates whose flow takes tasks. Any other is
answered `{ ok: false, error: "unknown_assignee: …" }`, and nothing is stored.

`addTask` records a task; `dispatchTask` starts it in its task session, which belongs to you.
Find it with `findWorkerSession({ worker, taskId, filingSessionId })`. A recorded task starts
when `dispatchTask` names its `taskId`; `assignTask` changes its owner and leaves it recorded.
`dispatchTask` returns once the task is stored, without waiting for it to run, unless it is
given `wait: true`. Unless
it waited, the conversation hears once when the task ends; a waiting turn gets the answer instead. See
[Handing out tasks](https://flow-state.dev/docs/workforce/coordinators#handing-out-tasks).

A worker files tasks when its `WORKER.md`'s `delegates:` names one that takes tasks, on a flow
that carries the session board: the built-in `agent` and `coordinator` flows do, and your own flow
does through `defineSessionBoard({ installation, flowKind })` (see its row under Exports). A worker with no such delegate gets no task tools, and its actions answer
`{ ok: false, error: "no_delegation_board" }`. A task's worker can split it the same way, up to
five boards deep and 100 tasks under one top task; a filing past either is answered
`{ ok: false, error: "total_task_cap_exceeded" }`. Raise the 100 with `hireWorkforce`'s
`taskChainLimit`. See [Delegating work](https://flow-state.dev/docs/workforce/delegating-work).

A worker on a task turn has `parkOnQuestion`: it parks the task on its question, and the
conversation hears it. `answerTask_tasks` (or the coordinator's `answerTask` tool) answers it, and
the task picks up in its own session with the answer as its next message, without spending a
retry. A task's session stays open after the task finishes: message its worker there, or file a
follow-up with `dispatchTask`'s `followUpOf`, which runs in the same session with the same worker.

A browser reads its user's boards through the ordinary collection read: `tasks`, fetched through
any of that user's sessions on a flow that carries the session board, answers every one of their
conversations' rows in one listing, paged like any collection read, and none of another user's. Each row's key starts with the
conversation it was filed in; `sessionIdOfFiling`, from `./browser`, reads that conversation's
session id back out of it. Only the board's fields go out (goal, status, assignee, run, timestamps
and the like), never a task's input, output or metadata.

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
`sessionIdOfFiling` (the conversation a board row was filed in), the same values
the root exports, and reaches no Node built-in.

## Exports

| Export | Description |
|--------|-------------|
| `defineAgentWorkerFlow(options?)` | Build the `agent` worker flow, the one the framework ships. With `installation` it is the copy every worker on `agent` shares: it declares the installation's session and documents, loads the turn's worker in `request.onStarted`, and refuses a turn whose input names a worker; called with factory options (`AgentWorkerFlowOptions`) it is the replacement you register under `agent`. Its flow declares `run` (public) and a `work` task entry that takes the tasks a conversation files for its workers. |
| `AGENT_FLOW` | The kind name (`"agent"`) the hire step defaults to, and the key a replacement registers under. |
| `definePersona(config)` | Declare a persona resource or collection. |
| `createWorkforceCapability({ roster, inventory, sources? })` | The discovery door. Installs the `workers` source plus whatever other domains' sources you pass, and contributes one control tool, `discover`, which lists the standard workers the files declare. |
| `workforceManifestSources({ roster, inventory })` | The `workers` source on its own, for an app assembling its own manifest registry. |
| `createWorkerInstallation({ standardWorkers?, workerFlows?, workerBlocks?, packageBlocks?, documents?, references?, skills?, packages?, projectCoordinator? })` | The worker model's one module (see [Workers as data](#workers-as-data)). `projectCoordinator` names the standard worker on the `coordinator` flow every user's project coordinator runs as (see [Projects](#projects)); any other worker throws. Returns `resources` and `session()` for a worker flow to spread in, the `createCheck` that names a session's worker at create, `resolveWorker(ctx, flowKind)` for each turn, `standardWorker(id)`, `workerFlows()` and `configurationProblems(id, row)`. `workerFlows` may be a function, read when first needed. |
| `installation.rosterWorker(ctx, id)` / `installation.standardWorkerProblems()` | The worker an id names on the session user's roster, read by id (`undefined` for another user's, as for a missing one); and every standard worker's configuration problems, for a load-time refusal. |
| `installation.roster(ctx)` | The session user's whole roster, as it stands when called: their own workers and every standard worker, sorted by id, each a `RosterWorker` (whose `delegates` lists the worker ids its configuration names; empty when none). The block must declare `installation.resources`. |
| `defineCoordinatorFlow({ installation, delegateFlows, routeModel, agent?, roundDeadlineMs? })` | The `coordinator` worker flow (see [Coordinators](#coordinators)): `run`, `addDelegate`, `removeDelegate`, `setFallback` and `listDelegates`. Its judgment is the agent's turn, built with the `agent` options; `agent.isolateUserState` keys this flow's user-scoped storage by its copy, as it does `agent`'s. `roundDeadlineMs` is how long a round waits for its answers (five minutes by default); a value that isn't a positive whole number of milliseconds throws. |
| `defineSessionBoard({ installation, flowKind })` | The task-filing kit for a worker flow of your own (see [Delegating work](https://flow-state.dev/docs/workforce/delegating-work)): `tools` for the model block's `uses` (Orchestration's nine task tools, present only while the session has a delegate that takes tasks), `actions` (the nine as `<tool>_tasks`, plus `addDelegate`, `removeDelegate`, `setFallback` and `listDelegates`), `resources`, `sessionStateShape` for `installation.session(...)`, `serverOwned` for `session.serverOwned`, `entries(turn)` for `internal: { actions }`, and `files(ctx)` / `taskDelegates(ctx)` to read whether the session files and who takes its tasks. |
| `delegatedPostEntry(turn)` | The `onDelegatedPost` task entry that makes a flow's workers delegates that take posts: `task: { actions: { [DELEGATED_POST_ENTRY]: delegatedPostEntry(turn) } }`. It takes a post's task from the conversation's board, runs `turn` on it, and ends the task with the reply. At the round's deadline, while the turn is still running, it tells the coordinator so the round can close. The turn isn't stopped; a later answer lands once. |
| `delegatedPostOnFinished` | A delegate flow's request `onFinished`: when a delegated run is cancelled, it tells the coordinator, which fails the post's task, so the round doesn't wait for its deadline. The built-in `agent` flow sets it. |
| `delegatedPostHistory` | A delegate flow generator's `history`, in place of `history: true`: the session's history, and on a delegated post that came with the conversation's recent lines, one user-role message just before the post (`Recent lines in the conversation with <coordinator> before this post, oldest first:`, then `- <from>: <text>` per line), for that turn only and never stored. On any other turn it is the session's history unchanged. The built-in `agent` flow's turn uses it. |
| `coordinatorConfigSchema()`, `coordinatorRouteRecordSchema`, `COORDINATOR_FLOW`, `COORDINATOR_ROUTE` | A coordinator's configuration, its routing record, the flow's kind and the record's component name. |
| `workerFlow(build, { standardOnly? })` | A worker flow built on its installation, for a flow in its own file: the installation calls `build(installation)` once. Goes in `workerFlows`, and is what `fsdev gen`'s `workerFlows` holds. |
| `inventoryWorkers(installation)` | The standard workers as `openInventory` takes workers: each worker's id, its flow and that flow's actions. |
| `workerConfigOf(ctx)` | The configuration of the worker the turn loaded, synchronously, for a prompt, a tool list or a step condition. Throws when the turn loaded no worker: call `installation.resolveWorker` in the flow's `request.onStarted`. |
| `createWorkerHireBlocks(installation)` | `{ hire, fork, edit, fire }`: writes to the caller's own roster, each checked as a turn would check it before anything is written, each refusing a standard worker's id. |
| `defineWorkerRosterFlow(installation, actions?)` | The roster flow (`workforce-roster`), which declares the two worker collections so a client reads a user's roster through one session of it. Mount the hire blocks on it as actions. |
| `createWorkforceClient({ userId, baseUrl?, apiPath?, fetcher? })` | `roster()`, `findWorkerSession(criteria)` and `ensureWorkerSession(criteria)`, over the session and resource clients. `criteria` is a `WorkerSessionCriteria`: `worker`, and optional keys such as `projectId`, which finds or starts the user's project coordinator for that project. From `./browser` only. |
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
| `hireWorkforce(installation, { taskChainLimit? })` | The flows to register for an installation: one copy of each worker flow, under its name, and the roster flow (`workforce-roster`) with `hire`, `fork`, `edit` and `fire`. Throws, naming every problem, when a worker flow misses the contract or doesn't declare the installation's session, or when a standard worker would be refused on its first turn; nothing is registered. `taskChainLimit` is the most tasks one top task may have under it, at any depth (100 when omitted); a value that isn't a whole number of at least 1 throws. |
| `mergeWorkerFlows(flows, workers)` | Add the flows `hireWorkforce` returned to your app's flows record under their ids, for `createFlowState({ flows })`. Throws, naming the id, when one is already in `flows`. |
| `workerFlowProblems(name, flow)` | Every way `flow`, registered as `name`, misses the worker contract: a name that is not its `kind`, a configuration it refuses by key or by value, or takes but rewrites, no door or two, a resource with `writtenBy` that `sharedResource()` didn't build. An empty list for a worker flow. The check `hireWorkforce` runs, exported for a library's own tests. |
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
| `defineProjectBlocks()` | Returns `{ createProject, setRepository, setBrief, readProject, listProjects, readProjectFiles, actions }`. See [Projects](#projects). |
| `defineWorkstreamBlocks({ installation, leadFlows, leadFit? })` | Returns `{ openWorkstream, openWorkstreamTool, updateWorkstream, updateWorkstreamTool, listLeadsTool, actions }`. `openWorkstreamTool` is the open for a worker; with `leadFit: { model }`, it refuses with `lead-doesnt-fit` when the lead's description doesn't say it does the work. Each lead flow declares `workstreamOpenedEntry()` under `internal.actions[WORKSTREAM_OPENED_ENTRY]`, as the built-in `agent` flow does; one that doesn't throws. See [Projects](#projects). |
| `readProject` / `projectProgress(entries, now)` / `STALE_AFTER_MS` / `DONE_STATUS` | A project's row, entries and progress, and the progress function itself (also from `./browser`): counts by status, objectives met, the next due date, and the entries not done and unchanged for `STALE_AFTER_MS` (seven days). `"done"` is the one status with a meaning. |
| `parseWorkstreamEntry(path, state)` | One entry read off its storage key and checked against `workstreamEntrySchema`, with its `project`, `owner` and `id`; `undefined` for a key that isn't an entry. Also from `./browser`, for a browser reading entries through the resource routes. |
| `projectCoordinatorTools` | `{ readProject }`, the project coordinator's tool: put it in `defineCoordinatorFlow({ agent: { catalog } })` and name it in the coordinator's `tools:`. Add `setBrief` and `setRepository` from `defineProjectBlocks()` for it to manage its own project. |
| `linkedProjectOf(state)` | The `{ visibility, id }` a session's state links it to by its `projectId`, or `undefined`. |
| `projectWorkspace({ checkouts? })` / `projectWorkspaceCapability` / `ProjectCheckout` | A run source for a coding run on a project: from the workstream its session leads or was filed from, the project its conversation belongs to, or the project its task names. `checkouts` (`ProjectCheckout[]`: `{ remote, checkout, projects, baseRef? }`) sends the listed shared projects' runs, in their own organization, to a checkout on this machine. The capability holds the collections it reads. See [Projects](#projects). |
| `createWorkerLookup({ installation })` | Which standard worker a task's name means. Returns `{ find, flowKind, state, filingCheck }`. `find(name)` answers `{ found: true, flowId }`, or `{ found: false, reason, message }` with `reason` `not-found` or `takes-no-tasks` (a worker whose flow declares no `work` task entry). `flowKind` and `state` are a `per-task` dispatcher's targets: the flow of the worker the task's `assignee` names, and a starting state naming that worker. |
| `WORKER_TASK_ENTRY` | `"work"`, the task entry a worker flow takes tasks through. |
| `workerTaskEntry({ name, turn \| block })` / `WorkerTaskEntryOptions` / `WorkerTaskBlockInput` / `conversationLedgers` / `filingConversationBoard` | The `work` task entry for a worker flow of your own: `task: { actions: { work: workerTaskEntry({ name, turn }) } }`. Each task a coordinator files for one of its workers runs as one `turn` (`{ message }` in, the answer out), or, with `block` instead (one or the other, refused at build otherwise), as a block handed the task itself plus `claim` (`{ collectionId, partition, incarnationId }`, the board the task was claimed from, never read from the task), in a task session of its own, and the conversation that filed it is told when it ends. A flow whose `work` entry is built any other way takes no conversation task: `listDelegates` reports it as taking `nothing`, and a filing for it is refused. `conversationLedgers(ledgerId, ctx, partition)` finds the board of the conversation a task came from; pass it to a harness manager that takes tasks from conversations. `filingConversationBoard(ctx)` answers, in a task session, that conversation's board with the entry and flow that run it there, for a message door over the session's run. A coding run's `projectWorkspace()` finds its project from the filing workstream, then the project of the conversation that filed it, then the task's `input.project` (`{ visibility, id }`, checked against the run's own user), then the `board` claim. |
| `defineWorkerInventoryCollection()` | The worker inventory: one org-scoped row per registered worker, at `inventory/workers/<workerId>`. Takes no options; install what it returns under a block's `resources`. |
| `WorkerInventoryRow` | One row of the inventory. |
| `workerInventoryRowSchema` | The Zod schema behind the row type. Closed: an undeclared key is dropped on the way in. |
| `openInventory(roster, options)` | Write the inventory at boot: one row per worker. Takes `InventoryRoster` (the workers to register) and `OpenInventoryOptions` (the `run` callback, `workerWriter`, `userId`, `orgId`). Returns `{ workers, problems }`. |
| `inventoryWriterActions()` | The action that writes the inventory's rows, keyed by its name (`registerWorkersInInventory`). Spread it into a flow's `internal.actions`, never `actions`: its input is row data, with nothing to check it against. Name that flow as `openInventory`'s `workerWriter`. |
| `INVENTORY_REGISTER_WORKERS` | The action name the writer runs: `"registerWorkersInInventory"`. |
| `INVENTORY_WORKER_WRITER_SESSION` | The session id the worker-registration action runs under when `workerWriter` names none: `"inventory-binder"`. |
| `InventoryRoster` / `InventoryWorker` / `InventoryWorkerWriter` | What `openInventory` takes: the roster (`{ workers }`), one worker (`{ id, kind, actions }`: its `door` action read from `actions`, `{}` for a worker with none), and which flow writes the rows (`{ flowKind, sessionId? }`). |
| `InventoryActionRequest` / `InventoryBinding` | What the `run` callback receives (`{ action, input, userId, orgId, flowKind, sessionId, source? }` — `source` is `"internal"` on the request and must reach `runAction`), and what one boot of `openInventory` returns (`{ workers, problems }`). |
| `OpenInventoryOptions` | The options `openInventory` takes: `run`, `workerWriter`, `userId`, `orgId`. |
| `workerDoorOf(worker)` / `WorkerDoor` | A hired worker's door: the one public action its worker flow declares with `userMessage` and a `{ message }` input. Returns `{ door, problem? }`. `door` is the action name, or `null` when the flow has none or more than one. `problem` is set when there are two or more, and names them. `openInventory` writes it on the worker's row. A worker flow with none or two is refused when hired, so a hired worker always has one. |

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
