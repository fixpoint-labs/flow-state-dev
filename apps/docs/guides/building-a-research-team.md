---
sidebar_position: 9
title: Building a research team
description: Build a multi-agent task board — a static board, runtime fan-out with a router, calling the board from a skill, named agents, and agents that decide their own tasks.
---

# Building a research team

This guide builds a small team of workers that research a subject together: analysts working in parallel, then a synthesizer that waits for them and writes the brief. You'll build it several ways, each a step up in how much the runtime decides for you.

**What we're building:** a task board where analysts run at the same time and a `synthesizer` starts only after they finish and combines their findings — first with a fixed set of tasks, then with a set decided at runtime.

**Concepts we'll cover:** worker blocks and `taskWorkerInputSchema`, the `taskBoard` factory, dependency gating with `deps`, reading upstream results off `input.deps`, runtime fan-out with a router, calling a board as a tool from a skill, wiring the tool catalog, staffing a worker with a named agent, and letting an agent decide its own tasks.

:::tip Full, runnable code
Every worker, board, router, `SKILL.md`, and a passing test suite for this
guide lives in
[`examples/guides/research-team`](https://github.com/fixpoint-labs/flow-state-dev/tree/main/examples/guides/research-team),
wired into a `research-team` flow you can run with `fsdev` from the example
directory:

```bash
cd examples/guides/research-team
pnpm fsdev run research-team research -i '{}'
pnpm fsdev run research-team researchCompetitors -i '{"subject":"Linear","competitors":["Jira","Asana","Trello"]}'
```

Those two actions use plain-handler workers, so they run — and their tests
pass — with no API key. The snippets here are trimmed for reading; open the
example for the complete, tested source.
:::

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

A worker is a normal block. Its input is a `TaskWorkerInput` — the task's `goal`, its typed `input`, and (for tasks with dependencies) the outputs of the tasks it depended on. You extend `taskWorkerInputSchema` to type the `input` field.

A worker can be a `handler` (deterministic) or a `generator` (calls a model). The runnable example uses handlers so its tests need no API keys; here we show generator analysts, since a real analyst calls an LLM.

```ts title="workers.ts"
import { generator } from "@flow-state-dev/core";
import { taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import { z } from "zod";

const analysisInput = taskWorkerInputSchema.extend({
  input: z.object({ subject: z.string() }).optional(),
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
  user: (input) => `Analyze the market position of ${input.input?.subject}.`,
});
// financialAnalyst is the same shape with a financial-analysis prompt.
```

Now the synthesizer. When a task declares dependencies, the board materializes those dependencies' outputs onto `input.deps`, keyed by task id, before the worker runs. So the synthesizer reads `input.deps` directly — no collection lookup, no glue.

```ts title="workers.ts"
export const synthesizer = generator({
  name: "synthesizer",
  model: "openai/gpt-5.4-mini",
  inputSchema: taskWorkerInputSchema.extend({
    input: z.object({ subject: z.string() }).optional(),
  }),
  outputSchema: z.object({ report: z.string() }),
  prompt:
    "You are a research lead. Combine the analysts' findings into one brief. " +
    "Lead with the takeaway, then the evidence, then the risks.",
  user: (input) => {
    const findings = Object.values(input.deps ?? {})
      .map((dep) => (dep as { findings?: string })?.findings ?? "(missing)")
      .join("\n\n");
    return `Write a brief on ${input.input?.subject}.\n\n${findings}`;
  },
});
```

Wire the three into a board. The `workers` map keys are assignees; each task's `assignee` picks its worker. The `deps` on the synthesis task are what hold it back.

```ts title="board.ts"
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
    { id: "market", goal: "market analysis", assignee: "market-analyst", input: { subject: "ACME Corp" } },
    { id: "financial", goal: "financial analysis", assignee: "financial-analyst", input: { subject: "ACME Corp" } },
    {
      id: "synth",
      goal: "combined brief",
      assignee: "synthesizer",
      deps: ["market", "financial"],
      input: { subject: "ACME Corp" },
    },
  ],
});
```

`researchBoard.drain` is a normal block. Drop it into a flow action, or run it in a test — the example's [`test/board.test.ts`](https://github.com/fixpoint-labs/flow-state-dev/tree/main/examples/guides/research-team/test/board.test.ts) does exactly this and asserts both analysts complete, the synthesizer runs after them, and the dep outputs pass through:

```ts title="board.test.ts"
import { testBlock } from "@flow-state-dev/testing";
import { researchBoard } from "../src/board";

const result = await testBlock(researchBoard.drain, { input: undefined });
// The two analysts run concurrently; `synth` only runs once both complete.
```

The `topological` dispatcher is what enforces the wait: it will not hand `synth` to a worker until every id in its `deps` has reached `completed`. You wrote the dependency; the board honored it.

## 3. Fan out at runtime with a router

The board above knows all its tasks up front. Often you don't — the set of work depends on the request. You want one analyzer per competitor, but you don't know how many competitors there are until you look at the input.

A router is the clean way to handle this. A [router](/docs/fundamentals/blocks) is a block that, given its input, decides which block to run next. So: build a router that reads the request, computes one analyzer task per competitor plus a synthesizer that depends on all of them, and returns a task board seeded with exactly those tasks. The router is the block you mount; when it runs, it hands the board back, and the engine runs that board.

```ts title="research-router.ts"
import { router } from "@flow-state-dev/core";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import { z } from "zod";
import { analyst, synthesizer } from "./workers";

export const researchRequestSchema = z.object({
  subject: z.string(),
  competitors: z.array(z.string()),
});

export const researchRouter = router({
  name: "research-router",
  inputSchema: researchRequestSchema,
  outputSchema: z.unknown(),
  routes: [],
  validateRoute: () => true,
  execute: (request) => {
    const analyzerIds = request.competitors.map((_, i) => `analyze-${i}`);
    const initialTasks = [
      ...request.competitors.map((name, i) => ({
        id: analyzerIds[i],
        goal: `analyze ${name}`,
        assignee: "analyzer",
        input: { subject: name },
      })),
      {
        id: "synth",
        goal: `synthesize ${request.subject}`,
        assignee: "synthesizer",
        deps: analyzerIds,
        input: { subject: request.subject },
      },
    ];

    return taskBoard({
      name: "competitor-board",
      collection: { backing: "request", collectionId: "competitors" },
      concurrency: 4,
      dispatcher: "topological",
      workers: { analyzer: analyst("competitor"), synthesizer },
      initialTasks,
    }).drain;
  },
});
```

A few things worth calling out, because they answer "when does the board actually run":

- **The router runs first; the board runs second.** You mount `researchRouter`. When it executes, it builds a board seeded with the computed tasks and returns that board's block. The engine then runs the returned block — that's when the drain happens. There is no board running until the router hands one back.
- **`routes: []` + `validateRoute: () => true`** let the router return a board it constructed on this call, rather than picking from a fixed list. (A router normally selects among pre-declared `routes`; here the route is built per request.)
- **Seed through `initialTasks`, not a manual `addTask` in the router.** A router's `execute` must be replay-safe — on a resumed request it re-runs. The board's seed step is idempotent by task id, so re-running it never double-seeds. Do the seeding declaratively and you get that for free.

The example's [`test/research-router.test.ts`](https://github.com/fixpoint-labs/flow-state-dev/tree/main/examples/guides/research-team/test/research-router.test.ts) drives this router with three competitors and asserts all four tasks (three analyzers + the synthesizer) complete.

There's a second way to grow a board at runtime: a worker on an already-running board can enqueue more tasks while it runs. That's the agent-driven path, and it's section 6.

## 4. The same team, callable from a skill

Both boards above are TypeScript. A conversational agent can reach one of them by
calling it as a **tool**. A `taskBoard(...).drain` is a block, and
[any block can be a tool](/docs/fundamentals/blocks#any-block-can-be-a-tool): drop
the board into a generator's `tools:` and the generator calls the whole board as a
single tool. The board drains under its own concurrency, and only the finalized
brief re-enters the conversation — the analysts' intermediate work stays out of the
agent's history.

To reach it from a skill, register the drain block in the skills **catalog** and
list it under the skill's `allowed-tools`, the same way you'd list `search` or
`fetch`. The skill stays plain inline instructions; the board is just one of its
tools.

```ts title="skills.ts"
import { search } from "@flow-state-dev/tools/search";
import { fetch } from "@flow-state-dev/tools/fetch";
import { createSkillsLibrary } from "@flow-state-dev/orchestration";
import { researchBoard } from "./board";

// Wrap the board's drain as a tool the model can call with a { subject }.
const researchTeam = researchBoard.drain; // a block; the catalog exposes it as a tool

export const skills = createSkillsLibrary({
  // "search"/"fetch" are worker tools; "research-team" is the board-as-tool
  // a skill lists in its allowed-tools.
  catalog: { search: search(), fetch: fetch(), "research-team": researchTeam },
  initialSkills,
});
```

```markdown title="skills/research-company/SKILL.md"
---
description: Multi-angle company research by a small team of analysts.
context: inline
allowed-tools: [research-team]
---

When the user asks for company research, call the `research-team` tool with the
subject. It runs the analysts in parallel and returns the synthesized brief.
```

Bind the skill to your conversation generator with
`uses: [skills.with({ active: ["research-company"] })]`. The example ships this
skill — plus a dynamic `competitor-analysis` variant — under
[`src/skills/`](https://github.com/fixpoint-labs/flow-state-dev/tree/main/examples/guides/research-team/src/skills).
From the example directory,
`pnpm fsdev run research-team chat -i '{"message":"research ACME Corp"}'` runs it
(that path calls an LLM, so it needs an API key).

The board's own `visibility` settings still decide what streams: the synthesizer is
`primary` (its output reaches the conversation), the analysts are `sub` (they stream
for observability but stay out of history). Because the whole board runs inside one
tool call, only the finalized result lands in the agent's history regardless.

## 5. Staff a worker with a named agent

A board worker has been a block or a prompt. It can also be an **agent**: a named
participant with a persona, a model, and tools, defined once and reused. Define one
with `defineAgent`, then materialize it into a worker block for the board's
`workers` map.

```ts title="agents.ts"
import { defineAgent, createAgentRegistry, materializeAgent } from "@flow-state-dev/workforce";

const marketAnalystAgent = defineAgent({
  name: "market-analyst",
  description: "Analyzes market positioning and competitive differentiation.",
  persona:
    "You are a senior market analyst. Cover category, target customer, and " +
    "differentiators. Cite every claim.",
  model: "openai/gpt-5.4-mini",
  allowedTools: ["search", "fetch"], // catalog keys the agent may call
});

export const agentRegistry = createAgentRegistry([marketAnalystAgent]);
export { materializeAgent };
```

An agent also staffs a delegation worker. A skill that declares `workers:` gets a
private board and one callable tool per worker; a worker can point at an agent by
name with `agent-ref` instead of carrying a prompt:

```yaml
workers:
  market-analyst:
    agent-ref: market-analyst
    agent-overrides:
      model: openai/gpt-5.4-mini
```

Resolving `agent-ref` needs `agentRegistry` and `materializeAgent` on the skills
library:

```ts title="skills.ts"
import { agentRegistry, materializeAgent } from "./agents";

export const skills = createSkillsLibrary({
  catalog: { search: search(), fetch: fetch() },
  agentRegistry,      // resolves an `agent-ref` worker to its agent
  materializeAgent,   // turns that agent into a runnable worker block
  initialSkills,
});
```

The same agent can staff a worker in any skill that references it, and
`agent-overrides` lets one skill swap its model or tools without touching the
definition. See [Agents](/docs/orchestration/agents) and
[Delegation](/docs/skills/delegation) for personas, structured output, and the
worker resolution table.

## 6. Let an agent decide the tasks

Section 3 grew a board at runtime with a router — your code decided the tasks. You
can also let the *model* decide. Two shapes, depending on whether the work needs to
run concurrently.

**Serialized: delegation.** A skill that declares `workers:` gives its generator the
eight `taskTools` (`addTask`, `assignTask`, `completeTask`, …) plus a callable tool
per worker. The model tracks a plan on the board — a private ledger — and runs each
piece by calling a worker tool. Nothing auto-drains the ledger; the model drives.
This is the right shape when the model should stay in charge of each step. See
[Delegation](/docs/skills/delegation).

**Concurrent: a self-draining board as a tool.** When the runtime fan-out must run in
parallel — a discoverer finds N competitors and all N analyzers should run at once —
keep that inside a code-defined `taskBoard` and call it as a tool (section 4). The
discoverer worker adds its tasks to *that board's* collection via `taskTools`, and
the board's own dispatcher runs them under `concurrency`. The example's
`competitor-analysis` does exactly this. The board, not a serialized executive, does
the parallel work.

The old ceiling here is gone: `taskTools` used to return `no_active_pattern` unless a
session-global pattern skill was active. Now the board a `taskTools` call commands is
whichever board its skill installed — a delegation skill's private ledger, or the
code-defined board it runs inside.

## 7. When the board stops, and when it waits

A board needs a rule for when it's done. That rule is `onIdle`, and the default (`complete-or-blocked`) is what you want for a dependency graph like this one:

- If every task reaches `completed`, the board drains and stops.
- If an analyst fails, the synthesizer's dependency is never satisfied. Rather than spin forever, the board detects that nothing runnable is left and stops, reporting `terminationReason: "blocked-by-failures"`.

The final `task-board-meta` item carries that reason and a count of what completed, so the caller can tell "all done" from "stalled on a failure." If instead your board legitimately waits on work from outside — a human approval, an external event — you switch `onIdle` to `"complete"` or `"wait"`. Those modes are covered in [Task board](/docs/orchestration/task-board#termination-onidle-modes).

Whether a task blocks the request comes down to the same dependency graph: the synthesizer blocks on its analysts because you said so with `deps`. Nothing else waits on the synthesizer, so once it writes the brief, the drain is done.

## Where to go next

- [`examples/guides/research-team`](https://github.com/fixpoint-labs/flow-state-dev/tree/main/examples/guides/research-team) — the complete, tested source for this guide.
- [Task board](/docs/orchestration/task-board) — every config option, dispatcher, and termination mode.
- [Task substrate](/docs/orchestration/task-substrate) — the `Task` and `TaskCollection` contracts underneath.
- [Delegation](/docs/skills/delegation) — the `workers:` field, the private board, and the `taskTools` reference.
- [Supervisor](/docs/patterns/supervisor) — add a review step before each result is written back.
