---
sidebar_position: 9
title: Building a research team
description: Build a multi-agent task board — a static board, runtime fan-out with a router, the SKILL.md form, named agents, and agents that enqueue their own work.
---

# Building a research team

This guide builds a small team of workers that research a subject together: analysts working in parallel, then a synthesizer that waits for them and writes the brief. You'll build it several ways, each a step up in how much the runtime decides for you.

**What we're building:** a task board where analysts run at the same time and a `synthesizer` starts only after they finish and combines their findings — first with a fixed set of tasks, then with a set decided at runtime.

**Concepts we'll cover:** worker blocks and `taskWorkerInputSchema`, the `taskBoard` factory, dependency gating with `deps`, reading upstream results off `input.deps`, runtime fan-out with a router, the same team as a `SKILL.md`, wiring the tool catalog, assigning work to a named agent, and letting an agent enqueue its own tasks.

:::tip Full, runnable code
Every worker, board, router, and a passing test suite for this guide lives in
[`examples/guides/research-team`](https://github.com/fixpoint-labs/flow-state-dev/tree/main/examples/guides/research-team).
The snippets here are trimmed for reading; open the example for the complete,
tested source. Its workers are plain handlers so the tests run with no API keys.
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

`researchBoard.block` is a normal block. Drop it into a flow action, or run it in a test — the example's [`test/board.test.ts`](https://github.com/fixpoint-labs/flow-state-dev/tree/main/examples/guides/research-team/test/board.test.ts) does exactly this and asserts both analysts complete, the synthesizer runs after them, and the dep outputs pass through:

```ts title="board.test.ts"
import { testBlock } from "@flow-state-dev/testing";
import { researchBoard } from "../src/board";

const result = await testBlock(researchBoard.block, { input: undefined });
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
    }).block;
  },
});
```

A few things worth calling out, because they answer "when does the board actually run":

- **The router runs first; the board runs second.** You mount `researchRouter`. When it executes, it builds a board seeded with the computed tasks and returns that board's block. The engine then runs the returned block — that's when the drain happens. There is no board running until the router hands one back.
- **`routes: []` + `validateRoute: () => true`** let the router return a board it constructed on this call, rather than picking from a fixed list. (A router normally selects among pre-declared `routes`; here the route is built per request.)
- **Seed through `initialTasks`, not a manual `addTask` in the router.** A router's `execute` must be replay-safe — on a resumed request it re-runs. The board's seed step is idempotent by task id, so re-running it never double-seeds. Do the seeding declaratively and you get that for free.

The example's [`test/research-router.test.ts`](https://github.com/fixpoint-labs/flow-state-dev/tree/main/examples/guides/research-team/test/research-router.test.ts) drives this router with three competitors and asserts all four tasks (three analyzers + the synthesizer) complete.

There's a second way to grow a board at runtime: a worker on an already-running board can enqueue more tasks while it runs. That's the agent-driven path, and it's section 6.

## 4. The same team as a skill

Both boards above are TypeScript. You can also describe the team in a `SKILL.md` file and let an agent invoke it. A `pattern: task-board` skill declares its workers, initial tasks, and board config in frontmatter; the prompts live in Markdown files next to it.

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
allowed-tools: [search, fetch]
---

This skill runs a small team on a task board. The two analysts run in
parallel; the primary synthesizer waits on both and writes the final brief.
```

### Where `search` and `fetch` come from

Those `tools:` entries are string keys into a **tool catalog** you provide when you wire the skills capability. The catalog maps each key to a real tool block. You build it once and hand it to `createSkillsCapability`:

```ts title="skills.ts"
import { search } from "@flow-state-dev/tools/search";
import { fetch } from "@flow-state-dev/tools/fetch";
import { createSkillsCapability } from "@flow-state-dev/orchestration";
import { defaultPatternRegistry } from "@flow-state-dev/patterns";

export const skillsCap = createSkillsCapability({
  // The keys here ("search", "fetch") are exactly what a worker's `tools:`
  // and the skill's `allowed-tools:` reference. Unknown keys warn and drop.
  catalog: { search: search(), fetch: fetch() },
  patternRegistry: defaultPatternRegistry, // enables `pattern: task-board` skills
  initialSkills,
});
```

Attach it to the generator that runs your conversation with `uses: [skillsCap]`. That generator gets a `runSkill` tool; the agent runs the team by calling `runSkill({ name: "research-company", input: "ACME Corp" })`, and `$ARGUMENTS` is substituted into each task goal.

`visibility: primary` marks the one worker whose output reaches the conversation — the synthesizer. The analysts run as `sub`: they stream for observability but stay out of history. See [Pattern skills](/docs/skills/pattern-skills) for the full frontmatter reference.

## 5. Assign a task to a named agent

A worker so far has been a block or a prompt. It can also be an **agent**: a named participant with a persona, a model, and tools, defined once and reused across skills. Define one with `defineAgent` and register it.

```ts title="agents.ts"
import { defineAgent, createAgentRegistry, materializeAgent } from "@flow-state-dev/workforce";

const marketAnalystAgent = defineAgent({
  name: "market-analyst",
  description: "Analyzes market positioning and competitive differentiation.",
  persona:
    "You are a senior market analyst. Cover category, target customer, and " +
    "differentiators. Cite every claim.",
  model: "openai/gpt-5.4-mini",
  allowedTools: ["search", "fetch"], // the same catalog keys from section 4
});

export const agentRegistry = createAgentRegistry([marketAnalystAgent]);
export { materializeAgent };
```

### Installing the registry

The registry doesn't do anything until it's wired into the skills capability. Pass `agentRegistry` and `materializeAgent` (both from `@flow-state-dev/workforce`) alongside the catalog — that's the seam that resolves `agent-ref` workers:

```ts title="skills.ts"
import { agentRegistry, materializeAgent } from "./agents";

export const skillsCap = createSkillsCapability({
  catalog: { search: search(), fetch: fetch() },
  patternRegistry: defaultPatternRegistry,
  agentRegistry,      // resolves an `agent-ref` worker to its agent
  materializeAgent,   // turns that agent into a runnable worker block
  initialSkills,
});
```

Now a pattern-skill worker can point at the agent by name instead of a prompt:

```yaml
workers:
  market-analyst:
    agent-ref: market-analyst
    agent-overrides:
      model: openai/gpt-5.4-mini
```

The same agent can staff a worker slot in any skill that references it, and `agent-overrides` lets one skill swap its model or tools without touching the definition. See [Agents](/docs/orchestration/agents) for personas, structured output, and the current limits.

## 6. Let an agent add tasks and assign workers

Section 3 grew a board at runtime with a router — your code decided the tasks. Under a pattern skill, an agent can grow the board itself while it runs. A worker with the `taskTools` capability gets eight board-mutation tools, including `addTask` (enqueue work) and `assignTask` (hand a task to a different worker).

Give the deciding worker `taskTools` in its own `tools:` list. Here a discoverer finds competitors and enqueues one analyzer per competitor plus a synthesizer that waits on all of them:

```markdown title="skills/competitor-analysis/SKILL.md"
---
description: Competitor analysis by a team that sizes itself to the landscape.
pattern: task-board
workers:
  discoverer:
    prompt-ref: ./reference/discover.md
    tools: [search, taskTools]   # taskTools installs the eight board-mutation tools
    visibility: sub
  analyzer:
    prompt-ref: ./reference/analyze.md
    tools: [search, fetch]
    visibility: sub
  synthesizer:
    prompt-ref: ./reference/synthesize.md
    visibility: primary
initial-tasks:
  - id: discover
    goal: >-
      Find 3-5 competitors for $ARGUMENTS. Call addTask once per competitor
      (assignee "analyzer"), collect the returned ids, then addTask a
      synthesizer (assignee "synthesizer") whose deps cover every analyzer.
    assignee: discoverer
pattern-config:
  concurrency: 4
  dispatcher: topological
  on-idle: complete
allowed-tools: [search, fetch, taskTools]
---
```

This is the same fan-out shape as section 3's router, but the model decides it from inside a running board rather than your code deciding it up front. The discoverer's prompt instructs it to call `addTask({ goal, assignee: "analyzer" })` per competitor and one `addTask({ goal, assignee: "synthesizer", deps: [...] })`.

Two things to keep straight:

- **`taskTools` must be on the worker's own `tools:` list** — putting it only in the top-level `allowed-tools` does not install it on pattern workers.
- **`taskTools` resolves the *active pattern skill's* board.** It works here because the skill activated a board. On a bare code-first `taskBoard` (sections 2–3) there is no active pattern, so `taskTools` returns `no_active_pattern` — that's why runtime fan-out in code uses the router instead.

See [Pattern skills](/docs/skills/pattern-skills) for the full `taskTools` reference.

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
- [Pattern skills](/docs/skills/pattern-skills) — the full `SKILL.md` frontmatter and the `taskTools` reference.
- [Supervisor](/docs/patterns/supervisor) — add a review step before each result is written back.
