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
flow: worker-agent
description: Holds the board.
model: openai/gpt-5.4-mini
---
You are the engineering lead. You break work into tasks and report what came back.
```

```ts
import { readWorkforceDirectory } from "@flow-state-dev/workforce/loader";
import { hireWorkforce } from "@flow-state-dev/workforce";

const { workers, errors } = await readWorkforceDirectory("./workforce");
if (errors.length) throw new Error(`workforce: ${errors.length} worker(s) failed to load`);

const seats = hireWorkforce(workers, { kinds: { "worker-agent": workerAgentFlow } });
flowRegistry.registerMany(seats); // FlowInstance[], ordered by id
```

`workerAgentFlow` is your own `defineFlow(...)`. The record's frontmatter becomes that flow's config and its body arrives as `config.instructions`, so the flow's `configSchema` — not this package — decides what a worker may declare.

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
| `declared` | The frontmatter exactly as written. Keys are not checked against a list, beyond a required `description` and a refused `persona:`. |
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
to be included, and a skill beside the worker is no exception.

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
keyed. On a collision it is a key and not a ranking: no copy wins.

A level that isn't in the tree is empty, not an error — an app may keep no org skills, and a
worker may have none of its own. A level that exists and cannot be listed lands in `errors` under
its own path, and so does a skill folder that fails to load, under `<level>/<folder>`.

Every entry carries a `kind` alongside its `path` and `error`, naming which of the six conditions
in the table below it is. Match on that rather than on the message text when you want to tolerate
one class — a malformed skill folder, say — while still refusing another.

A `root` that cannot be read throws instead:
`Failed to read workforce directory "./workforce": ENOENT ...`.

Symlinks are never followed, and that holds for the folders on the way to a level as much as
for the level itself — `org`, `teams`, a team's folder, its `workers`, and the worker's own.
A symlinked one is refused into `errors` under its own path, so a link out of the tree cannot
pull skills in from outside the configured root.

`team` and `worker` follow the same naming rules as the folders they name: lowercase letters,
digits and single hyphens, at most 64 characters, and not `_meta`. A name outside those rules
throws.

A `SKILL.md` read this way may not declare `scope:` — a file that does is refused by name into
`errors` and left out of `skills`. The same file read directly by `readSkillsDirectory` still
loads.

The reader registers nothing and starts nothing. Wiring the records into a running seat is the
caller's job: pass `skills` as the `initialSkills` of the skills capability or library you build
for that worker.

## Hiring a workforce

`hireWorkforce` turns worker records into **seats**: one configured, addressable flow copy per worker.
It reads no files, builds no flow graph, and registers nothing. You pass the flow kinds your app
defined, and you register what comes back.

```ts
import { hireWorkforce, type WorkerManifest } from "@flow-state-dev/workforce";

const workers: WorkerManifest[] = [
  {
    id: "engineering.lead",
    declared: { flow: "worker-agent", description: "Holds the board.", model: "openai/gpt-5.4-mini" },
    body: "You are the engineering lead. You break work into tasks and report what came back.",
  },
  { id: "engineering.intake", declared: { flow: "intake", description: "The front door." }, body: "" },
];

const seats = hireWorkforce(workers, { kinds: { "worker-agent": workerAgentFlow, intake: intakeFlow } });
flowRegistry.registerMany(seats); // FlowInstance[], ordered by id
```

The factory reads **`flow`**, which names the kind to instantiate, and **`description`**, the roster
label. Everything else is that worker's settings, handed to the flow
verbatim and parsed against its `configSchema`. That schema is closed, so a setting the flow never
declared is refused by name at the hire.

A worker record declares data: a description, the kind it runs, and that kind's settings. Behavior
lives in the flow the kind names, so a worker that has to do something none of your kinds do is a
flow you define in your app and pass in `kinds`, named by that worker's `flow:`.

A record's **`body` reaches its flow as one setting, `instructions`**. A flow kind that takes
instructions declares `instructions` in its `configSchema`. A kind that doesn't will refuse a body by
name, so no worker flow has to check for one. Declaring the key makes the instructions available at
`config.instructions`; what the flow does with them is the flow's business.

A body that is empty or only whitespace contributes no `instructions` key at all; a body with content
is handed over verbatim, leading and trailing whitespace included. A record that declares
`instructions:` *and* carries a body is refused naming both sources. Whitespace is not a body, so a
record that declares `instructions:` and carries an empty or blank one hires on the frontmatter value.

A `WORKER.md` has no `persona` setting: declaring it lands the worker in
`readWorkforceDirectory`'s `errors`, or is refused by `hireWorkforce` for a hand-built record.
Spell it `instructions`.

Every problem is a startup misconfiguration: problems are collected and thrown as one error naming
every bad worker, and nothing is returned, so a bad record cannot leave a half-hired roster.

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

`createChannelFlow({ notify })` takes a block run once per declared member per post. It runs in its
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
channelInstances(channels, { kinds: { "my-channel": createMyChannelFlow() } });

// Or replace the built-in wholesale, keeping the standard behaviour with your own notify block.
channelInstances(channels, { kinds: { channel: createChannelFlow({ notify }) } });
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
| `definePersona(config)` | Declare a persona resource or collection. |
| `createWorkforceCapability(opts)` | Optional capability for DevTool surfacing. |
| `readWorkforceDirectory(root)` | Read a `teams/<id>/workers/<name>/` tree into one `WorkerManifest` per worker. Ships from the `./loader` subpath (Node only). |
| `readSeatSkills(root, { team, worker })` | Read one worker's skills across the org, team and worker levels into `InitialSkill[]`. Ships from the `./loader` subpath (Node only). |
| `hireWorkforce(manifests, { kinds })` | Turn worker records into one configured flow copy each, ordered by id. Pass `defineFlow(...)` results directly as `kinds`. |
| `WorkerManifest` | One worker record: `{ id, declared, body }`. |
| `createChannelFlow(options?)` | Build a channel kind. `options.notify` is the per-member fan-out block. |
| `channelFlow` | The built-in channel kind, seeded by `channelInstances` when you register none. |
| `channelInstances(manifests, { kinds? })` | Build time. One `FlowInstance` per distinct kind across the roster, the built-in seeded. Register these. |
| `openChannels(manifests, { client, userId })` | Runtime. One named session per record, carrying its members, charter and description. Idempotent. |
| `ChannelManifest` | One channel record: `{ id, declared, body }`. |
| `ChannelPostRefusedError` | A post refused on the channel's own terms; `reason` is `channel-not-bound` or `author-not-a-member`. |
| `channelPostInputSchema` / `channelReadOutputSchema` / `channelNotifyInputSchema` | The post, read and notify contracts. |
| `channelSessionStateSchema` / `channelTranscriptLineSchema` | A channel session's state, and one transcript line. |

## Error Semantics

| Error | When |
|-------|------|
| Duplicate agent name | `createWorkforceCapability` construction |
| Worker folder unreadable | Collected in `readWorkforceDirectory`'s `errors`, keyed by the folder's path — never thrown |
| Workforce root unreadable | `readWorkforceDirectory` throws |
| Bad `team` or `worker` name | `readSeatSkills` throws |
| Skills root unreadable | `readSeatSkills` throws |
| Skills level unreadable | Collected in `readSeatSkills`'s `errors` as `kind: "unlistable-level"`, keyed by the level's path — an absent level is empty instead |
| Skill folder fails to load | Collected in `readSeatSkills`'s `errors` as `kind: "skill-load-failed"`, keyed by `<level>/<folder>` |
| Symlinked folder on the way to a level | Collected in `readSeatSkills`'s `errors` as `kind: "refused-symlinked-ancestor"`, keyed by that folder's path — never followed |
| Symlinked `skills/` folder at a level | Collected in `readSeatSkills`'s `errors` as `kind: "refused-symlinked-level"`, keyed by the level's path — never followed |
| One skill name at more than one of a seat's levels | Collected in `readSeatSkills`'s `errors` as `kind: "duplicate-skill-name"`, keyed by the level the name was first seen at, with every colliding path on the entry's `paths`; the name is left out of `skills` |
| `scope:` in a `SKILL.md` | Collected in `readSeatSkills`'s `errors` as `kind: "refused-scope-key"`, keyed by the skill's path |
| Worker cannot be hired | `hireWorkforce` — no `flow`, an unknown kind, a flow passed under a key that is not its own kind, a duplicate id, a setting or body the flow never declared, `instructions` given both in the frontmatter and as a body, or a `persona:` key. Collected: one error names every bad worker |
| Channel cannot be bound | `channelInstances` — a `flow:` naming a kind nobody passed, a kind filed under another kind's key, a duplicate id, an `id:`, a `system:`, an undeclared key, a `members:` that is not a list of names, or `instructions:` given both in the frontmatter and as a body. Collected: one error names every bad channel, and nothing is registered |
| Channel cannot be opened | `openChannels` throws, naming the channel — except a 409, which means the id is taken. An open channel there is left alone; an empty session is bound |
| `channel-not-bound` | A `post` or `read` naming a session nobody opened. Per-request; nothing is written and the session stays inert |
| `author-not-a-member` | A `post` claiming an `author` outside the channel's declared members. Per-request; nothing is written |
| `external-dispatcher` | A flow-to-flow post on a host whose dispatcher hands work to an external queue. The public action route is unaffected |

## Scripts

```bash
pnpm --filter @flow-state-dev/workforce build
pnpm --filter @flow-state-dev/workforce typecheck
pnpm --filter @flow-state-dev/workforce test
```
