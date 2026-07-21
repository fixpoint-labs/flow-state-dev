# @flow-state-dev/workforce

Agent registry and materialization for flow-state-dev.

An **Agent** is a named, reusable participant composed of a Persona (its system-prompt identity), a model, and tools. Register agents once, reference them from pattern skills via `agent-ref`, or compose them into any flow as standalone blocks.

## Quick Start

```ts
import { defineAgent, createAgentRegistry, materializeAgent } from "@flow-state-dev/workforce";
import { createSkillsCapability } from "@flow-state-dev/orchestration";

const analyst = defineAgent({
  name: "research-analyst",
  description: "Investigates data sources and produces findings.",
  persona: "You are a senior research analyst. Be thorough and cite sources.",
  model: "openai/gpt-5.4-mini",
  allowedTools: ["webSearch", "readDocument"],
});

const registry = createAgentRegistry([analyst]);

const skillsCap = createSkillsCapability({
  catalog,
  agentRegistry: registry,
  materializeAgent,
  patternRegistry,
});
```

Then in a pattern skill's `SKILL.md`:

```yaml
workers:
  analyst:
    agent-ref: research-analyst
    agent-overrides:
      model: openai/gpt-5.4-mini
```

## Standalone Block

Use `agentBlock` to compose an agent directly into a flow action:

```ts
import { agentBlock } from "@flow-state-dev/workforce";

const block = agentBlock(analyst, { catalog });
// Input: { goal: string }, Output: string
```

## Structured Output & Capabilities

By default an agent emits free text (`z.string()`). A **standalone** agent can declare a structured `outputSchema` instead, and the materialized generator emits that typed shape — subject to the same OpenAI-strict requirement as any generator output. Workers always emit `z.string()`, because the skills pattern machinery builds follow-on actions from text.

`usesCapabilities` accepts either a **string key** (resolved against the materialize-time `capabilityCatalog`) or a **capability reference** used as-is — including a `.presets({ ... })`-configured capability, which keeps full preset typing (the same way `generator({ uses })` consumes capabilities).

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

## Error Semantics

| Error | When |
|-------|------|
| Duplicate agent name | `createAgentRegistry` construction |
| Agent not found | `materializeWorker` with unknown `agent-ref` |
| No registry configured | `agent-ref` used without `agentRegistry` on capability |
| No materializeAgent | Registry wired but materializer missing |
| Persona path not found | Execution time — resource must be declared |
| Persona empty content | Execution time — resource resolved but `readContent()` returned null |
