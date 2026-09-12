---
title: Agents
sidebar_position: 7
sidebar_label: Agents
description: "The three things that can do a unit of work on a task board: an agent declared in a skill, a tool by its catalog key, or any block you register as a worker."
---

# Agents

A task board hands each task to a **worker**. Three different things can be that worker, and which one you reach for depends on where the work is described and whether it needs a model at all.

| The worker is | Where you declare it | Reach for it when |
|---|---|---|
| An agent | `agents:` in a skill's frontmatter | The work needs a model with its own persona and tools |
| A tool | Nothing to declare — every tool the skill allows is already assignable | The work is a function call, not a judgment |
| Any block | `taskBoard({ workers })`, in TypeScript | The graph is fixed in code rather than planned by a model |

The first two are how a *skill* staffs its board. The third is how *your code* does.

## An agent declared in a skill

An agent is a prompt-driven teammate that lives in the skill folder. You give it a persona and the tools it may call, and the coordinating generator assigns it tasks by name:

```yaml
---
description: Multi-angle company research delivered by a small team of analysts.
agents:
  market-analyst:
    prompt-ref: ./reference/market.md
    tools: [search, fetch]
  financial-analyst:
    prompt-ref: ./reference/financials.md
    tools: [search, fetch]
  synthesizer:
    prompt-ref: ./reference/synthesis.md
---
You run the board. Extract the target from the user's message, then:

1. `addTask` a market analysis — `assignee: "market-analyst"`.
2. `addTask` a financial analysis — `assignee: "financial-analyst"`.
3. `addTask` the synthesis — `assignee: "synthesizer"`, `deps` set to the two
   task ids returned above.
4. Call `runBoard` once. Surface the synthesizer task's report as-is.
```

The persona is either `prompt` (the body inline in the frontmatter) or `prompt-ref` (a path to a Markdown file beside the `SKILL.md`). Beside it you can set `tools` (catalog keys the agent may call itself), `model`, `visibility`, and `context-supply`. Every field is in [Delegation](../skills/delegation#declaring-agents).

Nothing in your app code registers these agents. The skill folder carries its own team, so copying the folder into another app carries the team with it. The only app-side wiring is the tool catalog the agents' `tools` keys resolve against.

A delegated agent returns free text. An agent entry has no output-schema field, so if you need a task's result as a typed shape, parse it after the board settles, or put a block on the board instead — see [Any block](#any-block-as-a-worker) below.

### The roster the coordinator sees

The coordinating generator picks assignees off a roster the skill builds from its `agents:` map: each agent key with a one-line purpose beside it. That purpose is the first non-blank line of the agent's prompt, cut off past 80 characters. So an inline persona's opening line doubles as routing copy. Write it as a summary of what the agent does, not as a preamble.

## A tool, by its catalog key

Some board nodes don't need a model. Fetching a document, running a calculation, reshaping a payload: routing that through an agent buys a model turn without getting a decision back.

You declare nothing for this. Every tool the skill allows is already assignable, by its catalog key:

```
addTask({ goal: "fetch page A", assignee: "httpGet", input: { url: "https://a.example" } })
```

The task's `input` becomes the tool's arguments, and no model turn happens. Tool seats don't appear on the coordinator's agent roster — it already has their descriptions from the tool surface. One limit to plan around: a tool seat gets its ordering from `deps` but can't read an upstream task's output. See [Assigning a task to a tool](../skills/delegation#assigning-a-task-to-a-tool).

## Any block as a worker

When your code owns the graph, skip skills entirely. `taskBoard` takes a name → block map and routes on `task.assignee`:

```ts
import { taskBoard } from "@flow-state-dev/orchestration/task-board";

const board = taskBoard({
  name: "research",
  workers: { marketAnalyst, financialAnalyst, synthesizer },
  initialTasks: [
    { id: "market", goal: "Analyze market positioning", assignee: "marketAnalyst" },
    { id: "financial", goal: "Analyze financial health", assignee: "financialAnalyst" },
    { id: "brief", goal: "Write the brief", assignee: "synthesizer", deps: ["market", "financial"] },
  ],
});
```

A worker here is an ordinary block, so it can be a handler with no model in it at all, and it declares its own `outputSchema`. [Task board](./task-board) is the reference for the registry, the dispatchers, and the termination modes.

## Borrowing an agent from a registry

A skill agent entry has a third resolution field, `agent-ref`, which names an agent resolved at run time instead of one written in the skill folder. It is an extension point rather than a ready-made feature. The framework routes the name; you supply what it resolves against.

To make `agent-ref` resolve, pass `createSkillsLibrary` both halves of a pair you write yourself:

- `agentRegistry` — an object with `get(name)` and `list()`, returning objects matching the `Agent` interface from `@flow-state-dev/core`.
- `materializeAgent` — a function turning one of those objects into the board worker the drain dispatches.

Without both, an `agent-ref` entry refuses when the skill's tool surface resolves, which for a statically bound skill is at build time:

```
Agent 'analyzer' uses agent-ref 'competitor-analyst' but no agentRegistry was
supplied to materializeWorker. The delegation surface does not resolve agent-ref
agents — use prompt/prompt-ref, or supply an agentRegistry to whatever wires
this board's workers.
```

An entry naming an agent the registry doesn't have refuses the same way, listing the names it does have.

`agent-overrides` adjusts a resolved agent for one skill, with REPLACE semantics rather than merge. If `agent-overrides.tools` is present it replaces the agent's tool list entirely; the two are not combined. Same for `model` and `visibility`. There's no prompt override: for an ad-hoc persona, use `prompt` or `prompt-ref` instead of `agent-ref`.

On the coordinator's roster an `agent-ref` entry is listed as `` agent `competitor-analyst` `` — its reference name and nothing else, with no one-line purpose beside it.

## Personas

A persona is a system prompt: who a participant is and how it behaves. In a skill, the persona is the `prompt` body or the `prompt-ref` file. When you'd rather hold it as editable state than as a file, `definePersona` declares it as a resource whose body renders from that state:

```ts
import { definePersona } from "@flow-state-dev/workforce";
import { z } from "zod";

export const analystPersona = definePersona({
  ref: "persona-analyst",
  contentTemplate: "You are a {{ state.role }}. Your beat is {{ state.beat }}.",
  stateSchema: z.object({ role: z.string(), beat: z.string() }),
  initialState: { role: "equity analyst", beat: "semiconductors" },
});
```

Read the rendered body with `readContent()` and hand it to a generator as its prompt:

```ts
import { generator } from "@flow-state-dev/core";

const analyst = generator({
  name: "analyst",
  resources: { persona: analystPersona },
  inputSchema: z.object({ question: z.string() }),
  model: "openai/gpt-5.4-mini",
  prompt: async (_input, ctx) => (await ctx.resources.persona.readContent()) ?? "",
  user: (input) => input.question,
});
```

Patch the resource's state and the next read renders the new body.

Pass `pattern` instead of `ref` for a collection, when one declaration should cover many personas:

```ts
const personas = definePersona({
  pattern: "personas/*",
  contentTemplate: "You are a {{ state.role }}. {{ state.instructions }}",
  stateSchema: z.object({ role: z.string(), instructions: z.string() }),
});
```

Both forms default to `scope: "org"`, so a persona is shared across users unless you say otherwise. The collection form takes no `initialState`: you create each instance, and `get` on one that doesn't exist throws. Everything on [Resources](../resources/overview) applies — `definePersona` is `defineResource` / `defineResourceCollection` with the content template already wired.

## `createWorkforceCapability`

`createWorkforceCapability({ agents })` takes an agent list or an `AgentRegistry` and returns a capability named `workforce`. Given a list, it throws at construction when two agents share a name. It contributes no tools, context, or resources to a block that puts it in `uses`.

## Hired workers

Workforce is a separate product. `hireWorkforce` turns a roster into configured flow copies you register and open a session against. A board's workers are blocks that claim tasks from a collection.

A hired worker's flow can mount a board, and that board's workers are any of the three above. A task's `assignee` never names a hired worker. See [Workforce](../workforce/overview).

## Related pages

- [Delegation](../skills/delegation) — every field on an `agents:` entry, and the board a skill installs.
- [Authoring a delegating skill](/guides/agents-command-the-board) — one skill, start to finish.
- [Context supply](./context-supply) — how much prior conversation a delegated agent reads.
- [Task board](./task-board) — the concurrent drain underneath all of this.
- [Workforce](../workforce/overview) — describe a roster, hire it, and register the copies. A hired worker is an address, not a board assignee.
