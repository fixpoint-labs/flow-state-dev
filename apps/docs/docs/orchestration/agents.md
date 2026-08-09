---
title: Agents
sidebar_position: 7
sidebar_label: Agents
description: Named, reusable participants composed of a persona, a model, and tools, registered once and referenced as delegation agents or composed as standalone blocks.
---

# Agents

An agent is a named, reusable participant you define once and use many times. It bundles a persona (the system-prompt identity that says who the agent is and how it behaves), a model, and the tools it may call. Once registered, you reference an agent by name from a skill's `agents:` map (as a delegation agent), or drop it into any flow action as a standalone block.

The point is to stop copy-pasting the same prompt and tool list into every worker. You write the `research-analyst` once, then a supervisor skill, a plan-and-execute skill, and a one-off action can all point at it.

Agents live in `@flow-state-dev/workforce`. The type contracts they satisfy are declared in `@flow-state-dev/core`.

## defineAgent

`defineAgent` builds a validated agent definition. The config:

| Field | Meaning |
|-------|---------|
| `name` | Stable identifier. This is the key `agent-ref` resolves against. |
| `description` | Required one-line summary of what the agent is for. A label on the definition: nothing reads it at runtime, and it is not the system prompt. |
| `persona` | The system-prompt source. A string, an inline template, or a resource path. |
| `model` | Model id. Falls back to the default model set where the agent is materialized (`workerModelId` on the skills library, `defaultModelId` on `agentBlock`), then `intent/chat`. |
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

An agent definition is inert on its own. `createAgentRegistry` builds a catalog from an array of agents, and errors on a duplicate name. `materializeAgent` turns an agent into a runnable block, either worker-shaped (for a board seat in a delegation skill) or standalone (for a flow action).

You rarely call `materializeAgent` by hand. You hand it to the skills library, which calls it when a skill's `agent-ref` entry resolves:

```ts
import { createAgentRegistry, materializeAgent } from "@flow-state-dev/workforce";
import { createSkillsLibrary } from "@flow-state-dev/orchestration";

const skills = createSkillsLibrary({
  catalog,
  agentRegistry,
  materializeAgent,
  initialSkills,
});
```

With that wiring in place, a skill's `SKILL.md` references an agent from its `agents:` map. Declaring `agents:` turns on delegation for a generator that binds the skill; `agent-ref` names the agent, and `agent-overrides` adjusts it for this skill:

```yaml
---
description: Multi-angle research on a company. Use when the user asks for a deep dive.

agents:
  analyst:
    agent-ref: tech-briefer
    agent-overrides:
      model: openai/gpt-5.4-mini
      tools: [search, fetch, readDocument]
---
You are the research lead. Plan the work on your board: `addTask` one task per
angle, each `assignee: "analyst"`. Then call `runBoard` and synthesize the
settled tasks' output.
```

The generator that bound the skill (the coordinator) picks assignees off a roster the skill builds from its `agents:` map: each agent key with a one-line purpose beside it. For an `agent-ref` entry that purpose is the referenced agent's name. For a `prompt` or `prompt-ref` entry it is the first line of the prompt, cut off past 80 characters. So an inline prompt's opening line doubles as routing copy: write it as a summary of what the agent does, not as a preamble. The coordinator's [tools are assignable too](../skills/delegation#assigning-a-task-to-a-tool), by their catalog key, and they don't appear on this roster — it already has their descriptions from the tool surface.

Overrides use REPLACE semantics, not merge. If `agent-overrides.tools` is present, it replaces the agent's `allowedTools` entirely; the two lists are not combined. Same for `model` and `visibility` (the frontmatter key for `itemVisibility`). Read the override block and you know exactly what the agent can do.

There's no prompt or persona override. Changing an agent's persona is a change to the agent definition. If you need an ad-hoc prompt for one agent, use `prompt` or `prompt-ref` on the agent spec instead of `agent-ref`.

## Standalone block

`agentBlock` composes an agent directly into a flow action, no skill involved. It's a shorthand around the standalone materialization:

```ts
import { agentBlock } from "@flow-state-dev/workforce";

const briefingBlock = agentBlock(techBriefer, { catalog });
// Input: { goal: string }, Output: string
```

Mount `briefingBlock` in a sequencer or wire it as an action the same way you would any block.

## Structured output and capabilities

A standalone agent can return typed data instead of free text. Declare an `outputSchema` and the materialized generator emits that shape, subject to the same OpenAI-strict requirement as any generator output. Delegation agents stay `z.string()` regardless. A delegated agent's output is read off its completed task on the board, not returned inline to the coordinator.

`usesCapabilities` accepts two forms in the same array: a string key resolved against the materialize-time capability catalog, or a capability reference used as-is. A reference can be configured with `.with({ ... })`, and the preset typing carries through, the same way `generator({ uses })` consumes capabilities.

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

A persona is the agent's identity, the system prompt.

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

- `usesSkills` is on the type, but nothing resolves it.
- `contextMode` on an agent definition is not honored. A `"fork"` value is accepted and treated as inline. To have a delegated agent inherit the parent conversation, set `context-supply: conversation` on the skill's agent entry instead. That field works on `prompt` / `prompt-ref` entries; on an `agent-ref` entry it throws. See [Context supply](./context-supply.md).
- Agents are registered statically at build time through `createAgentRegistry`. There's no runtime registration.
- An agent is referenced within a flow, by a skill or a standalone block. There's no cross-flow assignment.

## Related pages

- [Delegation](../skills/delegation.md) — referencing agents from an `agents:` map via `agent-ref`.
- [Task board](./task-board.md) — the concurrent drain you can call as a tool.
- [Orchestration overview](./overview.md) — how agents, the substrate, and the board fit together.
