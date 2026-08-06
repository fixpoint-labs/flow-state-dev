---
sidebar_position: 9
title: Building a research team
description: Build a multi-agent task board — a static board, runtime fan-out with a router, a skill that defines its own agent team, the two ways to staff an agent, and letting the model decide the tasks.
---

# Building a research team

This guide builds a small team of workers that research a subject together: analysts working in parallel, then a synthesizer that waits for them and writes the brief. You'll build it several ways, each a step up in how much the runtime decides for you.

**What we're building:** a task board where analysts run at the same time and a `synthesizer` starts only after they finish and combines their findings — first with a fixed set of tasks, then with a set decided at runtime.

**Concepts we'll cover:** worker blocks and `taskWorkerInputSchema`, the `taskBoard` factory, dependency gating with `deps`, reading upstream results off `input.deps`, runtime fan-out with a router, a skill that defines its own team of prompt agents and runs its own board, the two ways to staff an agent (inline prompt, registered agent), and letting the model plan the tasks at runtime.

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

This is the tutorial: it builds the team several ways, starting from code you write yourself. If you already know you want the model to plan the work and you just need to author one skill that does it, [Authoring a delegating skill](/guides/agents-command-the-board) takes that path start to finish instead.

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

The example's [`test/flow.test.ts`](https://github.com/fixpoint-labs/flow-state-dev/tree/main/examples/guides/research-team/test/flow.test.ts) drives this router with three competitors and asserts all four tasks (three analyzers + the synthesizer) complete.

There's a second way to grow a board at runtime: a worker on an already-running board can enqueue more tasks while it runs. That's the agent-driven path, and it's section 6.

## 4. The same team, as a skill that runs its own board

Both boards above are TypeScript — your code decides the tasks. A skill flips
that: the SKILL.md declares the *team* in an `agents:` map, and its instructions
tell the coordinating model how to plan the tasks itself. An agent is a
prompt-driven teammate — a persona that ships right inside the skill folder.

The next three sections are this tutorial's tour of that path, kept here so the
arc stays whole. [Authoring a delegating skill](/guides/agents-command-the-board)
is where it's taught in full, including staffing, the rosterless shortcut, and
the failure modes.

Binding an agent-declaring skill gives the generator a private task board, the
task tools (`addTask`, `listTasks`, …), and `runBoard` — a real board drain over
that board. The coordinator plans with `addTask` (assignee, deps, structured
input) and executes the whole graph with one `runBoard` call. The board is how
the work runs — there is no per-agent tool the coordinator calls directly.

```markdown title="skills/research-company/SKILL.md"
---
description: Multi-angle company research by a small team of analysts.
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

The `prompt-ref` personas live beside the SKILL.md, so the whole team travels
with the skill folder — no app wiring beyond the tool catalog:

```ts title="skills.ts"
import { createSkillsLibrary } from "@flow-state-dev/orchestration";
import { search, fetch } from "@flow-state-dev/tools";

export const skills = createSkillsLibrary({
  catalog: { search: search(), fetch: fetch() },
  initialSkills,
  // Inline `prompt`/`prompt-ref` agents need no registry — they materialize
  // straight from the SKILL.md. Reach for `agent-ref` (section 5) when you want
  // a named agent defined once and reused across skills.
});
```

Bind the skill to your conversation generator with
`uses: [skills.with({ active: ["research-company"] })]`. The example ships this
skill — plus a `competitor-analysis` variant where the coordinator picks the
competitors and fans out one analyzer per pick — under
[`src/skills/`](https://github.com/fixpoint-labs/flow-state-dev/tree/main/examples/guides/research-team/src/skills).
From the example directory,
`pnpm fsdev run research-team chat -i '{"message":"research ACME Corp"}'` runs it.
That one needs two keys: a model key, since the coordinator and the analyst
agents are all models, and a [search](/docs/tools/search) key, since the
analysts call `search` and it throws when no provider is configured.

Compared to the frozen graphs in sections 2 and 3, the agent now sets the
goals, the fan-out, and the dependencies per request. The board still does the
deterministic part — parallel dispatch, dependency gating, one settled result —
and its task-change stream drives a live plan UI without re-entering the
agent's history. When the graph *should* stay fixed in code, register a
`taskBoard(...).drain` block in the skills `catalog` and list it under
`allowed-tools` — [any block can be a tool](/docs/fundamentals/blocks#any-block-can-be-a-tool).

## 5. Two ways to staff an agent

Section 4's team is defined entirely inline — every agent is a `prompt-ref`
persona in the skill folder. That's one of two ways to fill a seat on the
board. The example's `competitor-analysis` skill shows both side by side.

**Inline prompt agent.** A `prompt` or `prompt-ref` right in the SKILL.md. The
persona travels with the skill; no app code registers it. This is section 4's
whole team, and the `discoverer` here:

```yaml
agents:
  discoverer:
    prompt-ref: ./reference/discover.md
    tools: [search, taskTools]
```

**A registered agent, by name.** Define an agent once with `defineAgent` — a
persona, a model, tools — and reference it from any skill with `agent-ref`. Reach
for this when several skills share the same participant, or when the agent is app
code you maintain outside the skill folder.

```ts title="agents.ts"
import { defineAgent, createAgentRegistry, materializeAgent } from "@flow-state-dev/workforce";

export const competitorAnalyst = defineAgent({
  name: "competitor-analyst",
  description: "Analyzes one competitor across positioning, pricing, and distribution.",
  persona:
    "You analyze ONE competitor and surface the facts a comparison writer will " +
    "use. Cover positioning, pricing, distribution, and differentiators. Cite sources.",
  model: "openai/gpt-5.4-mini",
  allowedTools: ["search", "fetch"],
});

export const agentRegistry = createAgentRegistry([competitorAnalyst]);
export { materializeAgent };
```

```yaml
agents:
  analyzer:
    agent-ref: competitor-analyst
```

Only registry agents need `agentRegistry` + `materializeAgent` on the library;
inline agents need neither:

```ts title="skills.ts"
import { agentRegistry, materializeAgent } from "./agents";

export const skills = createSkillsLibrary({
  catalog: { search: search(), fetch: fetch() },
  initialSkills,
  agentRegistry,      // resolves `agent-ref` names to registered agents
  materializeAgent,   // turns a resolved agent into the board worker the drain dispatches
});
```

`agent-overrides` on an `agent-ref` entry lets one skill swap a registered agent's
model or tools without touching its definition. See [Agents](/docs/orchestration/agents)
and [Delegation](/docs/skills/delegation) for personas, structured output, and the
agent resolution table. The example wires both forms in
[`src/agents.ts`](https://github.com/fixpoint-labs/flow-state-dev/tree/main/examples/guides/research-team/src/agents.ts).

A seat doesn't have to be a persona, and it doesn't have to be declared. The task
board dispatches any block as a worker (that's
[section 2](#2-the-code-first-board)), and a tool is a block — so every tool the
skill allows is already assignable, by its catalog key:

```yaml
allowed-tools: [httpGet]
agents:
  analyst:
    prompt: You read fetched page text and extract the key claims.
```

```
addTask({ goal: "fetch page A", assignee: "httpGet", input: { url: "https://a.example" } })
```

That runs as a plain function call — the task's `input` becomes the tool's
arguments, and no model turn happens. Use it for the deterministic seats: fetching,
calculating, reshaping a payload. It's the same tool the coordinator could call
inline; what you get by putting it on the board is `deps` ordering, parallelism, and
the output recorded on a task. One limit worth knowing before you plan around it: a
tool seat gets ordering from `deps` but can't read an upstream task's output. See
[Assigning a task to a tool](/docs/skills/delegation#assigning-a-task-to-a-tool)
for the full shape.

## 6. Let an agent decide the tasks

Section 3 grew a board at runtime with a router — your code decided the tasks. You
can also let the *model* decide. Two shapes, depending on where the plan lives.

**A delegation skill.** A skill that declares `agents:` gives its generator the
eight `taskTools` (`addTask`, `assignTask`, `completeTask`, …) plus `runBoard`. The
coordinating model plans the work as tasks on its private board — assignees, deps,
structured input — and runs the whole graph with one `runBoard` call. That drain is
a real board drain: independent tasks run in parallel, dep-gated tasks wait, and one
settled board comes back. The `competitor-analysis` skill does this — the
coordinator picks the competitors and fans out one analyzer per pick. An agent can
even decide its own fan-out mid-drain: give it `tools: [taskTools]` and it enqueues
follow-up tasks onto the same board while the drain runs. See
[Delegation](/docs/skills/delegation).

**A code-defined board as a tool.** When the graph should stay fixed in code — a
tuned dispatcher, a seeded task set, a custom collection backing — skip agents and
call a `taskBoard(...).drain` as a single tool (section 4). Your code owns the tasks;
the board's own dispatcher runs them under `concurrency`.

Both drain concurrently — a delegation board is a real board drain, not a serialized
loop of tool calls. The difference is who writes the tasks: the model, task by task,
or your code, up front.

The old ceiling here is gone: `taskTools` used to return `no_active_pattern` unless a
session-global pattern skill was active. Now the board a `taskTools` call commands is
whichever board its skill installed. With no delegation board resolvable at all, a
stray `taskTools` call returns `no_delegation_board` rather than throwing.

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
- [Authoring a delegating skill](/guides/agents-command-the-board) — the same ground from the authoring angle: one skill, start to finish, with staffing, the rosterless shortcut, and the failure modes.
- [Delegation](/docs/skills/delegation) — the `agents:` field, the private board, and the `taskTools` + `runBoard` reference.
- [Supervisor](/docs/patterns/supervisor) — add a review step before each result is written back.
