---
title: Agents
sidebar_position: 7
sidebar_label: Agents
description: "What does a unit of work on a task board: any block you register as a worker, the persona you give a model-backed one, and how Workforce workers fit in."
---

# Agents

A task board hands each task to a **worker**: any block you register on the board. This page covers registering workers, giving a model-backed one a persona, and how Workforce workers relate to a board's.

## Any block as a worker

`taskBoard` takes a name → block map and routes on `task.assignee`:

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

## Personas

A persona is a system prompt: who a participant is and how it behaves. When you'd rather hold it as editable state than as a string in code, `definePersona` declares it as a resource whose body renders from that state:

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

`createWorkforceCapability({ roster, inventory })` returns a capability named `workforce` that gives every seat of the kind one tool: `discover`, which answers what seats and mailboxes have been registered, and whatever other domains you hand it. Pass the declared roster and the registry keys the [inventory](../workforce/inventory)'s seat and mailbox rows are mounted under. See [Discovery](./discovery).

## Workforce workers

Workforce is a separate product. A Workforce worker is a configuration run by one shared copy of the flow it names, and you talk to it by opening a session that names it. A board's workers are blocks that claim tasks from a collection.

A worker flow can mount a board, and that board's workers are blocks like any other. A task's `assignee` can also name a standard Workforce worker: a board whose `defaultWorker` asks Workforce's worker lookup hands the task to the worker of that name. See [Giving a task to a worker](../workforce/overview#giving-a-task-to-a-worker).

## Related pages

- [Task board](./task-board) — the concurrent drain underneath all of this.
- [Workforce](../workforce/overview) — describe a roster, hire it, and register the copies. A hired worker is an address you open a session against, and a name you can give a task to.
