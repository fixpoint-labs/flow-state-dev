---
sidebar_position: 9
title: Building a research team
description: Build a multi-agent task board from scratch — the code-first way, the runtime fan-out way, and the SKILL.md way.
---

# Building a research team

This guide builds a small team of workers that research a company together: two analysts working in parallel, then a synthesizer that waits for both and writes the brief. You'll build it three ways, each a step up in how much the runtime decides for you.

**What we're building:** a task board where a `market-analyst` and a `financial-analyst` run at the same time, and a `synthesizer` starts only after both finish and combines their findings.

**Concepts we'll cover:** worker blocks and `taskWorkerInputSchema`, the `taskBoard` factory, dependency gating with `deps`, reading upstream results off `input.deps`, runtime fan-out with the `taskTools` capability, the same team expressed as a `SKILL.md`, and assigning a task to a named agent.

Everything here lives in `@flow-state-dev/orchestration`. If you haven't met the pieces underneath, [Task board](/docs/orchestration/task-board) and [Task substrate](/docs/orchestration/task-substrate) are the reference.

---

## 1. The problem

Three units of work, with a shape:

```
market-analyst  ─┐
                 ├─→ synthesizer
financial-analyst┘
```

The two analysts are independent — run them together. The synthesizer depends on both — it can't start until they're done. Writing that coordination by hand means tracking who finished, holding the synthesizer back, and passing the analysts' output into it. The task board does all three.

## 2. The code-first board

A worker is a normal block. Its input is a `TaskWorkerInput` — the task's `goal`, its typed `input`, and (for tasks with dependencies) the outputs of the tasks it depended on. You extend `taskWorkerInputSchema` to type the `input` field for your workers.

Start with the two analysts. They're generators — they call a model. We give each one a lens through its prompt.

```ts title="src/flows/research/workers.ts"
import { generator } from "@flow-state-dev/core";
import { taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import { z } from "zod";

const analysisInput = taskWorkerInputSchema.extend({
  input: z.object({ company: z.string() }).optional(),
});

const analysisOutput = z.object({ findings: z.string() });

export const marketAnalyst = generator({
  name: "market-analyst",
  model: "openai/gpt-5.4-mini",
  inputSchema: analysisInput,
  outputSchema: analysisOutput,
  prompt:
    "You are a market analyst. Cover category, target customer, and " +
    "key differentiators. Be concise and cite sources.",
  user: (input) => `Analyze the market position of ${input.input?.company}.`,
});

export const financialAnalyst = generator({
  name: "financial-analyst",
  model: "openai/gpt-5.4-mini",
  inputSchema: analysisInput,
  outputSchema: analysisOutput,
  prompt:
    "You are a financial analyst. Cover revenue scale, trajectory, and " +
    "runway signals. Be concise and cite sources.",
  user: (input) => `Analyze the financial health of ${input.input?.company}.`,
});
```

Now the synthesizer. When a task declares dependencies, the board materializes those dependencies' outputs onto `input.deps`, keyed by task id, before the worker runs. So the synthesizer reads `input.deps` directly — no collection lookup, no glue.

```ts title="src/flows/research/workers.ts"
const synthesisInput = taskWorkerInputSchema.extend({
  input: z.object({ company: z.string() }).optional(),
});

export const synthesizer = generator({
  name: "synthesizer",
  model: "openai/gpt-5.4-mini",
  inputSchema: synthesisInput,
  outputSchema: z.object({ report: z.string() }),
  prompt:
    "You are a research lead. Combine the analysts' findings into one brief. " +
    "Lead with the takeaway, then the evidence, then the risks.",
  user: (input) => {
    const market = input.deps?.["market"] as { findings?: string } | undefined;
    const financial = input.deps?.["financial"] as { findings?: string } | undefined;
    return [
      `Write a research brief on ${input.input?.company}.`,
      `Market analysis: ${market?.findings ?? "(missing)"}`,
      `Financial analysis: ${financial?.findings ?? "(missing)"}`,
    ].join("\n\n");
  },
});
```

Wire the three into a board. The `workers` map keys are assignees; each task's `assignee` picks its worker. The `deps` on the synthesis task are what hold it back.

```ts title="src/flows/research/board.ts"
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import { marketAnalyst, financialAnalyst, synthesizer } from "./workers";

export const researchBoard = taskBoard({
  name: "research-board",
  collection: { collectionId: "research" },
  concurrency: 3,
  dispatcher: "topological",
  workers: {
    "market-analyst": marketAnalyst,
    "financial-analyst": financialAnalyst,
    synthesizer,
  },
  initialTasks: [
    { id: "market", goal: "market analysis", assignee: "market-analyst", input: { company: "ACME Corp" } },
    { id: "financial", goal: "financial analysis", assignee: "financial-analyst", input: { company: "ACME Corp" } },
    { id: "synth", goal: "combined brief", assignee: "synthesizer", deps: ["market", "financial"], input: { company: "ACME Corp" } },
  ],
});
```

`researchBoard.block` is a normal block. Drop it into a flow action, or run it in a test:

```ts title="src/flows/research/board.test.ts"
import { testBlock } from "@flow-state-dev/testing";
import { researchBoard } from "./board";

const result = await testBlock(researchBoard.block, { input: undefined });
// The two analysts run concurrently; `synth` only runs once both complete.
```

The `topological` dispatcher is what enforces the wait: it will not hand `synth` to a worker until every id in its `deps` has reached `completed`. You wrote the dependency; the board honored it.

## 3. Fan out at runtime

The board above knows all its tasks up front. Often you don't — you find the work while running. Say you want to research every competitor, but you don't know who they are until an agent looks.

Give a worker the `taskTools` capability and it can add tasks to the live board while it runs. The eight tools include `addTask`, which returns the new task's id.

```ts title="src/flows/research/discoverer.ts"
import { generator } from "@flow-state-dev/core";
import { taskTools } from "@flow-state-dev/orchestration";
import { taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";

export const discoverer = generator({
  name: "discoverer",
  model: "openai/gpt-5.4-mini",
  inputSchema: taskWorkerInputSchema,
  outputSchema: z.object({ queued: z.number() }),
  uses: [taskTools],
  prompt:
    "Identify 3-5 competitors for the target. For each, call " +
    "addTask({ goal, assignee: 'analyzer' }) and collect the returned ids. " +
    "Then call addTask({ goal: 'synthesize', assignee: 'synthesizer', " +
    "deps: [<all analyzer ids>] }). Return how many analyzer tasks you queued.",
  user: (input) => `Target: ${input.goal}`,
});
```

The discoverer queues one analyzer per competitor, then a synthesizer whose `deps` cover every analyzer it just created. The synthesizer waits for all of them. The board started with a single `discover` task and grew itself. This is the same substrate, driven at runtime instead of at definition time. Keep the fan-out bounded — every added task the synthesizer depends on is one more thing it waits for.

## 4. The same team as a skill

Both boards above are TypeScript. You can also describe the team in a `SKILL.md` file and let an agent invoke it. A `pattern: task-board` skill declares its workers, its initial tasks, and its board config in frontmatter. The prompts live in Markdown files next to it.

```markdown title="skills/research-company/SKILL.md"
---
description: Multi-angle company research by a small team of analysts.
pattern: task-board
workers:
  market-analyst:
    prompt-ref: ./reference/market.md
    tools: [search, fetch]
    visibility: sub
  financial-analyst:
    prompt-ref: ./reference/financials.md
    tools: [search, fetch]
    visibility: sub
  synthesizer:
    prompt-ref: ./reference/synthesis.md
    visibility: primary
initial-tasks:
  - id: market
    goal: Analyze market positioning of $ARGUMENTS. Cite sources.
    assignee: market-analyst
  - id: financials
    goal: Analyze financial health of $ARGUMENTS. Cite sources.
    assignee: financial-analyst
  - id: synth
    goal: Synthesize the reports into one brief for $ARGUMENTS.
    assignee: synthesizer
    deps: [market, financials]
pattern-config:
  concurrency: 2
  dispatcher: topological
  on-idle: complete
allowed-tools: [search, fetch, taskTools]
---

This skill runs a small team on a task board. The two analysts run in
parallel; the primary synthesizer waits on both and writes the final brief.
```

`visibility: primary` marks the one worker whose output reaches the conversation — the synthesizer here. The analysts run as `sub`: they stream for observability but stay out of history. The agent runs the team by calling `runSkill({ name: "research-company", input: "ACME Corp" })`, and `$ARGUMENTS` is substituted into each task goal. Because `taskTools` is in `allowed-tools`, a worker can still `addTask` mid-run if a gap surfaces. See [Pattern skills](/docs/skills/pattern-skills) for the full frontmatter reference.

## 5. Assign a task to a named agent

A worker so far has been a block or a prompt. It can also be an agent: a named participant with a persona, a model, and tools, defined once and reused across skills. Define one with `defineAgent`, register it, and reference it from a worker by name.

```ts title="src/agents.ts"
import { defineAgent, createAgentRegistry } from "@flow-state-dev/workforce";

const marketAnalystAgent = defineAgent({
  name: "market-analyst",
  description: "Analyzes market positioning and competitive differentiation.",
  persona:
    "You are a senior market analyst. Cover category, target customer, and " +
    "differentiators. Cite every claim.",
  model: "openai/gpt-5.4-mini",
  allowedTools: ["search", "fetch"],
});

export const agentRegistry = createAgentRegistry([marketAnalystAgent]);
```

In a pattern skill, a worker points at it with `agent-ref` instead of a prompt:

```yaml
workers:
  market-analyst:
    agent-ref: market-analyst
    agent-overrides:
      model: openai/gpt-5.4-mini
```

Now the same agent can staff a worker slot in any skill that references it, and `agent-overrides` lets one skill swap its model or tools without touching the definition. See [Agents](/docs/orchestration/agents) for personas, structured output, and the current limits.

## 6. When the board stops, and when it waits

A board needs a rule for when it's done. That rule is `onIdle`, and the default (`complete-or-blocked`) is what you want for a dependency graph like this one:

- If every task reaches `completed`, the board drains and stops.
- If an analyst fails, the synthesizer's dependency is never satisfied. Rather than spin forever, the board detects that nothing runnable is left and stops, reporting `terminationReason: "blocked-by-failures"`.

The final `task-board-meta` item carries that reason and a count of what completed, so the caller can tell "all done" from "stalled on a failure." If instead your board legitimately waits on work from outside — a human approval, an external event — you switch `onIdle` to `"complete"` or `"wait"`. Those modes are covered in [Task board](/docs/orchestration/task-board#termination-onidle-modes).

Whether a task blocks the request comes down to the same dependency graph: the synthesizer blocks on its analysts because you said so with `deps`. Nothing else waits on the synthesizer, so once it writes the brief, the drain is done.

## Where to go next

- [Task board](/docs/orchestration/task-board) — every config option, dispatcher, and termination mode.
- [Task substrate](/docs/orchestration/task-substrate) — the `Task` and `TaskCollection` contracts underneath.
- [Pattern skills](/docs/skills/pattern-skills) — the full `SKILL.md` frontmatter and the `taskTools` reference.
- [Supervisor](/docs/patterns/supervisor) — add a review step before each result is written back.
