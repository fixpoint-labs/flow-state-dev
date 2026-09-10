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

By default an agent emits free text (`z.string()`). A **standalone** agent can declare a structured `outputSchema` instead, and the materialized generator emits that typed shape — subject to the same OpenAI-strict requirement as any generator output. Delegation agents (the worker shape) always emit `z.string()`, because the board hands each task's text result back to the skill that planned it.

`usesCapabilities` accepts either a **string key** (resolved against the materialize-time `capabilityCatalog`) or a **capability reference** used as-is — including a `.with({ ... })`-configured capability, which keeps full preset typing (the same way `generator({ uses })` consumes capabilities).

Declaring a string key with **no `capabilityCatalog` supplied** refuses the materialization: nothing can resolve it, and dropping it would run the agent without a capability it declared. The throw is an `AgentCapabilityError` — a `FlowError` with code `agent_capability_unresolved` — naming the agent and the capability. A key the catalog simply doesn't carry is a different case, and follows the same additive-not-restrictive policy as an unknown tool key: it warns and is skipped. Capability references need no catalog and are never refused.

```ts
const pm = defineAgent({
  name: "portfolio-manager",
  description: "Sizes the position into a typed decision.",
  persona: { path: "personas/pm" },
  outputSchema: portfolioDecisionSchema, // standalone only; workers stay string
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
| `declared` | The frontmatter exactly as written. Keys are not checked against a list. |
| `body` | The Markdown below the frontmatter, verbatim. Empty when the worker has no instructions. |
| `codePath` | Set when the folder holds a `worker.ts`. Recorded, never imported. |

`description` is the only required setting in a `WORKER.md`. Team and worker folder names must be
lowercase letters, digits and single hyphens, at most 64 characters.

The reader builds nothing: no flow, no agent, no registry entry. It throws only when `root` itself
cannot be read — a folder that produces no worker lands in `errors`, keyed by its path, and every
other worker still loads. Treat a non-empty `errors` as fatal at startup unless you have a reason
to run a short roster.

The subpath is separate because the reader imports `node:fs`; the package root stays isomorphic.

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
