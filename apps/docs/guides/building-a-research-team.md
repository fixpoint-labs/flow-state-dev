---
sidebar_position: 9
title: Building a research team
description: Build a multi-agent task board — a static board, then runtime fan-out with a router.
---

# Building a research team

This guide builds a small team of workers that research a subject together: analysts working in parallel, then a synthesizer that waits for them and writes the brief. You'll build it two ways, the second a step up in how much the runtime decides for you.

**What we're building:** a task board where analysts run at the same time and a `synthesizer` starts only after they finish and combines their findings — first with a fixed set of tasks, then with a set decided at runtime.

**Concepts we'll cover:** worker blocks and `taskWorkerInputSchema`, the `taskBoard` factory, dependency gating with `deps`, reading upstream results off `input.deps`, and runtime fan-out with a router.

:::tip Full, runnable code
Every worker, board, router, and a passing test suite for this
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

The example's [`test/flow.test.ts`](https://github.com/fixpoint-labs/flow-state-dev/tree/main/examples/guides/research-team/test/flow.test.ts) drives this router with three competitors and asserts all four tasks (three analyzers + the synthesizer) complete.

## 4. When the board stops, and when it waits

A board needs a rule for when it's done. That rule is `onIdle`, and the default (`complete-or-blocked`) is what you want for a dependency graph like this one:

- If every task reaches `completed`, the board drains and stops.
- If an analyst fails, the synthesizer's dependency is never satisfied. Rather than spin forever, the board detects that nothing runnable is left and stops, reporting `terminationReason: "blocked-by-failures"`.

The final `task-board-meta` item carries that reason and a count of what completed, so the caller can tell "all done" from "stalled on a failure." If instead your board legitimately waits on work from outside — a human approval, an external event — you switch `onIdle` to `"complete"` or `"wait"`. Those modes are covered in [Task board](/docs/orchestration/task-board#termination-onidle-modes).

Whether a task blocks the request comes down to the same dependency graph: the synthesizer blocks on its analysts because you said so with `deps`. Nothing else waits on the synthesizer, so once it writes the brief, the drain is done.

## Where to go next

- [`examples/guides/research-team`](https://github.com/fixpoint-labs/flow-state-dev/tree/main/examples/guides/research-team) — the complete, tested source for this guide.
- [Task board](/docs/orchestration/task-board) — every config option, dispatcher, and termination mode.
- [Task substrate](/docs/orchestration/task-substrate) — the `Task` and `TaskCollection` contracts underneath.
- [Supervisor](/docs/patterns/supervisor) — add a review step before each result is written back.
