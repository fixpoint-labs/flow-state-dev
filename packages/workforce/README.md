# @flow-state-dev/workforce

Agent registry and materialization for flow-state-dev.

An **Agent** is a named, reusable participant composed of a Persona (its system-prompt identity), a model, and tools. Register agents once, reference them as delegation workers via `agent-ref`, or compose them into any flow as standalone blocks.

## Quick Start

```ts
import { defineAgent, createAgentRegistry, materializeAgent } from "@flow-state-dev/workforce";
import { createSkillsLibrary } from "@flow-state-dev/orchestration";

const analyst = defineAgent({
  name: "research-analyst",
  description: "Investigates data sources and produces findings.",
  persona: "You are a senior research analyst. Be thorough and cite sources.",
  model: "openai/gpt-5.4-mini",
  allowedTools: ["webSearch", "readDocument"],
});

const registry = createAgentRegistry([analyst]);

const skills = createSkillsLibrary({
  catalog,
  agentRegistry: registry,
  materializeAgent,
  initialSkills,
});
```

Then a skill declares the agent as part of its team in `SKILL.md` — the
`agents:` field turns on delegation, and `agent-ref` staffs the seat from the
registry:

```yaml
---
description: Research a subject with a named analyst.
agents:
  analyst:
    agent-ref: research-analyst
    agent-overrides:
      model: openai/gpt-5.4-mini
---
Plan the work on your board — `addTask` a research task with `assignee: analyst`,
then call `runBoard` — and return the analyst's findings.
```

## Standalone Block

Use `agentBlock` to compose an agent directly into a flow action:

```ts
import { agentBlock } from "@flow-state-dev/workforce";

const block = agentBlock(analyst, { catalog });
// Input: { goal: string }, Output: string
```

## Structured Output & Capabilities

By default an agent emits free text (`z.string()`). Declare a structured `outputSchema` and the agent emits that typed shape on **both** shapes — mounted standalone, and delegated to a board as a worker — so one declaration answers what the agent emits however it is run. A delegated result lands on the completed task, where the coordinator reads it.

Two rules bound what may be declared, and both are checked at materialization, which throws a `StrictSchemaError` naming the agent and the offending field path:

- The root must be a bare `z.string()` or an object. Every other root — a wrapped string like `z.string().nullable()` included — is sent to the provider as a structured-output root, which must be an object.
- No field may parse to a value JSON cannot carry. A durable board round-trips the task record through `JSON.stringify`, so a transform (`z.string().transform(...)`), a `z.date()` / `z.coerce.date()`, a `z.bigint()` or a `z.map()` would read back as something else after a resume. `.refine()` and `z.preprocess()` are fine: neither changes the parsed value's type.

The declared shape is also subject to the same OpenAI-strict requirement as any generator output.

`usesCapabilities` accepts either a **string key** (resolved against the materialize-time `capabilityCatalog`) or a **capability reference** used as-is — including a `.with({ ... })`-configured capability, which keeps full preset typing (the same way `generator({ uses })` consumes capabilities).

Declaring a string key with **no `capabilityCatalog` supplied** refuses the materialization: nothing can resolve it, and dropping it would run the agent without a capability it declared. The throw is an `AgentCapabilityError` — a `FlowError` with code `agent_capability_unresolved` — naming the agent and the capability. A key the catalog simply doesn't carry is a different case, and follows the same additive-not-restrictive policy as an unknown tool key: it warns and is skipped. Capability references need no catalog and are never refused.

```ts
const pm = defineAgent({
  name: "portfolio-manager",
  description: "Sizes the position into a typed decision.",
  persona: { path: "personas/pm" },
  outputSchema: portfolioDecisionSchema, // typed result, standalone or delegated
  usesCapabilities: [
    tradingDesk.with({ valuationSpine: true }),    // typed capability ref
    "someSharedSkill",                             // string key (catalog)
  ],
});
```

## Persona Sourcing

An agent's persona can be sourced three ways:

| Form | Description |
|------|-------------|
| `string` | Bare system prompt, used verbatim. Simplest form for one-off agents. |
| `{ template, state? }` | Inline LiquidJS template rendered against state. |
| `{ path }` | Reference to a declared resource or collection instance, rendered live via `readContent()`. |

### Persona Collections

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

One name reaching a single worker from two of its levels is refused, naming both paths:

```ts
errors;
// [{ kind: "duplicate-skill-name",
//    path: "org/skills/triage",
//    paths: ["org/skills/triage", "teams/pentest/skills/triage"],
//    error: Error('Skill "triage" reaches seat "recon" from 2 levels — org/skills/triage
//                  and teams/pentest/skills/triage. Remove one: there is no precedence
//                  rule.') }]
```

The contested name is left out of `skills` entirely. The fix is a rename or a deletion; a
worker-level folder does not override its team's.

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

A record's **`body` reaches its flow as one setting, `instructions`**. A flow kind that takes
instructions declares `instructions` in its `configSchema`. A kind that doesn't will refuse a body by
name, so no worker flow has to check for one. Declaring the key makes the instructions available at
`config.instructions`; what the flow does with them is the flow's business.

A body that is empty or only whitespace contributes no `instructions` key at all; a body with content
is handed over verbatim, leading and trailing whitespace included. A record that declares
`instructions:` *and* carries a body is refused naming both sources. Whitespace is not a body, so a
record that declares `instructions:` and carries an empty or blank one hires on the frontmatter value.

`persona:` on a `defineAgent` is a different thing. A `WORKER.md` has no `persona` setting:
declaring it lands the worker in `readWorkforceDirectory`'s `errors`, or is refused by
`hireWorkforce` for a hand-built record. Spell it `instructions`.

Every problem is a startup misconfiguration: problems are collected and thrown as one error naming
every bad worker, and nothing is returned, so a bad record cannot leave a half-hired roster.

## Exports

| Export | Description |
|--------|-------------|
| `defineAgent(config)` | Create a validated Agent definition. |
| `createAgentRegistry(agents)` | Build an AgentRegistry (errors on duplicate name). |
| `materializeAgent(agent, opts)` | Turn an Agent into a worker-shaped or standalone BlockDefinition. |
| `agentBlock(agent, opts?)` | Shorthand for standalone agent block. |
| `definePersona(config)` | Declare a persona resource or collection. |
| `createWorkforceCapability(opts)` | Optional capability for DevTool surfacing. |
| `readWorkforceDirectory(root)` | Read a `teams/<id>/workers/<name>/` tree into one `WorkerManifest` per worker. Ships from the `./loader` subpath (Node only). |
| `readSeatSkills(root, { team, worker })` | Read one worker's skills across the org, team and worker levels into `InitialSkill[]`. Ships from the `./loader` subpath (Node only). |
| `hireWorkforce(manifests, { kinds })` | Turn worker records into one configured flow copy each, ordered by id. Pass `defineFlow(...)` results directly as `kinds`. |
| `WorkerManifest` | One worker record: `{ id, declared, body }`. |

## Error Semantics

| Error | When |
|-------|------|
| Duplicate agent name | `createAgentRegistry` construction |
| Agent not found | `materializeWorker` with unknown `agent-ref` |
| No registry configured | `agent-ref` used without `agentRegistry` on capability |
| No materializeAgent | Registry wired but materializer missing |
| Persona path not found | Execution time — resource must be declared |
| Persona empty content | Execution time — resource resolved but `readContent()` returned null |
| Worker folder unreadable | Collected in `readWorkforceDirectory`'s `errors`, keyed by the folder's path — never thrown |
| Workforce root unreadable | `readWorkforceDirectory` throws |
| Bad `team` or `worker` name | `readSeatSkills` throws |
| Skills root unreadable | `readSeatSkills` throws |
| Skills level unreadable | Collected in `readSeatSkills`'s `errors` as `kind: "unlistable-level"`, keyed by the level's path — an absent level is empty instead |
| Skill folder fails to load | Collected in `readSeatSkills`'s `errors` as `kind: "skill-load-failed"`, keyed by `<level>/<folder>` |
| Symlinked folder on the way to a level | Collected in `readSeatSkills`'s `errors` as `kind: "refused-symlinked-ancestor"`, keyed by that folder's path — never followed |
| Symlinked `skills/` folder at a level | Collected in `readSeatSkills`'s `errors` as `kind: "refused-symlinked-level"`, keyed by the level's path — never followed |
| One skill name at two of a seat's levels | Collected in `readSeatSkills`'s `errors` as `kind: "duplicate-skill-name"`, naming both paths; the name is left out of `skills` |
| `scope:` in a `SKILL.md` | Collected in `readSeatSkills`'s `errors` as `kind: "refused-scope-key"`, keyed by the skill's path |
| Worker cannot be hired | `hireWorkforce` — no `flow`, an unknown kind, a flow passed under a key that is not its own kind, a duplicate id, a setting or body the flow never declared, `instructions` given both in the frontmatter and as a body, or a `persona:` key. Collected: one error names every bad worker |
