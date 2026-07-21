---
title: Agents
sidebar_position: 5
sidebar_label: Agents
description: Named, reusable participants composed of a persona, a model, and tools, registered once and referenced from pattern skills or composed as standalone blocks.
---

# Agents

An agent is a named, reusable participant you define once and use many times. It bundles three things: a persona (the system-prompt identity that says who the agent is and how it behaves), a model, and a set of tools it may call. Once registered, you reference an agent by name from a pattern skill's worker map, or drop it into any flow action as a standalone block.

The point is to stop copy-pasting the same prompt and tool list into every worker. You write the `research-analyst` once, then a supervisor skill, a plan-and-execute skill, and a one-off action can all point at it.

Agents live in `@flow-state-dev/workforce`. The type contracts they satisfy are declared in `@flow-state-dev/core`, so other packages can accept an agent registry without depending on workforce.

## defineAgent

`defineAgent` builds a validated agent definition. The config:

| Field | Meaning |
|-------|---------|
| `name` | Stable identifier. This is the key `agent-ref` resolves against. |
| `description` | Routing-facing summary shown in trace UI and the DevTool. Not the system prompt. |
| `persona` | The system-prompt source. A string, an inline template, or a resource path. |
| `model` | Model id. Falls back to the deps' default, then `intent/chat`. |
| `allowedTools` | Tool-catalog keys the agent may reference. |
| `usesCapabilities` | Capabilities the agent composes, as string keys or capability refs. |
| `outputSchema` | Structured output contract. Honored only for the standalone shape. |
| `itemVisibility` | Which items reach the client and history. Defaults to `{ client: true, history: false }`. |

A minimal agent needs a name, a description, a persona, and whatever tools it calls:

```ts
import { defineAgent, createAgentRegistry } from "@flow-state-dev/workforce";

const techBriefer = defineAgent({
  name: "tech-briefer",
  description: "Produces concise technology briefings from web research.",
  persona:
    "You are a senior technology analyst at a research firm. " +
    "Write concise, opinionated briefings. Lead with the takeaway, " +
    "then supporting evidence, then risks. Cite every claim. " +
    "If sources conflict, show the conflict rather than picking a side.",
  model: "openai/gpt-5.4-mini",
  allowedTools: ["search", "fetch"],
});

export const agentRegistry = createAgentRegistry([techBriefer]);
```

## Registry and materialization

An agent definition is inert on its own. Two steps turn it into something that runs.

`createAgentRegistry` builds a catalog from an array of agents. It errors on a duplicate name, so the registry is a single source of truth. `materializeAgent` turns an agent into a runnable block, either worker-shaped (for a pattern skill) or standalone (for a flow action).

You rarely call `materializeAgent` by hand. You hand it to the skills capability, which calls it when a pattern skill's worker resolves an `agent-ref`:

```ts
import { createAgentRegistry, materializeAgent } from "@flow-state-dev/workforce";
import { createSkillsCapability } from "@flow-state-dev/orchestration";
import { defaultPatternRegistry } from "@flow-state-dev/patterns";

const skillsCap = createSkillsCapability({
  catalog,
  agentRegistry,
  materializeAgent,
  patternRegistry: defaultPatternRegistry,
});
```

With that wiring in place, a pattern skill's `SKILL.md` references an agent from its `workers:` map. `agent-ref` names the agent; `agent-overrides` adjusts it for this skill:

```yaml
---
description: Multi-angle research on a company. Use when the user asks for a deep dive.
pattern: task-board

workers:
  analyst:
    agent-ref: tech-briefer
    agent-overrides:
      model: openai/gpt-5.4-mini
      tools: [search, fetch, readDocument]

initial-tasks:
  - id: market
    goal: Analyze the market positioning of $ARGUMENTS
    assignee: analyst
---
```

Overrides use REPLACE semantics, not merge. If `agent-overrides.tools` is present, it replaces the agent's `allowedTools` entirely; the two lists are not combined. Same for `model` and `itemVisibility`. The result is a deterministic, auditable tool surface per skill: you read the override block and know exactly what the worker can do.

There's no prompt or persona override. Changing an agent's persona is a change to the agent definition. If you need an ad-hoc prompt for one worker, use `prompt` or `prompt-ref` on the worker spec instead of `agent-ref`.

## Standalone block

`agentBlock` composes an agent directly into a flow action, no skill involved. It's a shorthand around the standalone materialization:

```ts
import { agentBlock } from "@flow-state-dev/workforce";

const briefingBlock = agentBlock(techBriefer, { catalog });
// Input: { goal: string }, Output: string
```

Mount `briefingBlock` in a sequencer or wire it as an action the same way you would any block.

## Structured output and capabilities

A standalone agent can return typed data instead of free text. Declare an `outputSchema` and the materialized generator emits that shape, subject to the same OpenAI-strict requirement as any generator output. Workers stay `z.string()` regardless, because the pattern machinery builds follow-on actions from a worker's text.

`usesCapabilities` accepts two forms in the same array: a string key resolved against the materialize-time capability catalog, or a capability reference used as-is. A reference can be preset-configured with `.presets({ ... })`, and the preset typing carries through, the same way `generator({ uses })` consumes capabilities.

```ts
import { defineAgent } from "@flow-state-dev/workforce";
import { tradingDeskCapability } from "./capabilities/trading-desk";
import { z } from "zod";

const positionSizerSchema = z.object({
  ticker: z.string(),
  action: z.enum(["buy", "sell", "hold"]),
  sizePct: z.number(),
});

const positionSizer = defineAgent({
  name: "position-sizer",
  description: "Sizes a position into a typed decision.",
  persona: { path: "personas/portfolio-manager" },
  outputSchema: positionSizerSchema, // standalone only
  usesCapabilities: [
    tradingDeskCapability.with({ valuationSpine: true }), // typed capability ref
    "marketDataAccess", // string key, resolved from the catalog
  ],
});
```

## Personas

A persona is the agent's identity, the system prompt. It can come from three sources.

| Form | Description |
|------|-------------|
| `string` | Bare system prompt, used verbatim. The simplest form. |
| `{ template, state? }` | Inline LiquidJS template rendered against optional state. |
| `{ path }` | A declared resource or collection instance, rendered live via `readContent()`. |

For resource-backed personas, `definePersona` declares them the same way skills are declared, as a collection over a path pattern with a content template:

```ts
import { definePersona } from "@flow-state-dev/workforce";

const personas = definePersona({
  pattern: "personas/*",
  contentTemplate: "You are a {{ state.role }}. {{ state.instructions }}",
});
```

An agent then sources its persona by path (`persona: { path: "personas/portfolio-manager" }`), and the content resolves live at execution time. A missing path or empty content surfaces as an execution-time error, not a definition-time one.

## Current limits

Agents are a young primitive. A few things are declared but not yet wired, and it's worth knowing before you lean on them:

- `usesSkills` is reserved. It's on the type, but nothing resolves it yet.
- `contextMode: "fork"` is not honored. Only `"inline"` runs today; a `"fork"` value is accepted but treated as inline.
- Agents are registered statically at build time through `createAgentRegistry`. There's no runtime registration.
- There's no cross-flow agent assignment and no Roles or Workstreams layer. An agent is referenced within a flow, by a skill or a standalone block, not assigned across flows.

## Related pages

- [Pattern skills](../skills/pattern-skills.md) — referencing agents from a worker map via `agent-ref`.
- [Task board](./task-board.md) — the drain that runs a skill's workers.
- [Orchestration overview](./overview.md) — how agents, the substrate, and the board fit together.
