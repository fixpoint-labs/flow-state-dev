---
title: Goal-seek loop
type: catalog
description: A loop over a task board that re-drains until a judge says the goal is reached, or until a mandatory iteration budget runs out.
---

# Goal-seek loop

Some work isn't done after one pass. You research a question, look at what came back, and find a gap, so you research again. `goalSeekLoop` is that cycle as a block: it seeds a [task board](../../concepts/tasks-and-boards.md) (a stored list of tasks and the loop that works through it), drains it, asks a judge whether the goal is reached, and drains again until the judge says yes or the budget runs out. [Plan and Execute](./plan-and-execute.md) and [Parallel Tasks](./parallel-tasks.md) are both built on it.

A drain is one full pass of the board's workers over every task they can run. A judge is any block or function that looks at the board after a drain and returns a verdict: keep going, or stop. The settled board is the board's tasks as the last drain left them, whatever their status: completed, errored or cancelled.

## The loop

```
seed → drain → judge → (replan) → drain again → … → finalize
```

- **seed** writes the first tasks to the board, once.
- **drain** runs the board's workers until nothing more can start.
- **judge** returns a verdict over the board.
- **replan** adds tasks when the judge asks for them.
- **finalize** turns the settled board into the loop's output.

`maxIterations` is required. It is the number of drains, and it is what guarantees the loop ends. Two things end a healthy loop, and the [termination item](#stream-items) says which: the judge's `done`, carrying the judge's own `reason`, or the last allowed drain ending without `done`, which becomes `done` with reason `"max-iterations"`. Either way the loop doesn't throw, and `finalize` runs over whatever settled. The board's own `maxIterations` is a separate cap inside a single drain. Details of the budget, errors and construction rules are on the [patterns reference](../../reference/patterns.md).

## Writing a judge

You write the judge. It is an inline function, a block or a sequencer, and it returns one of three verdicts, each with a `reason` string:

- `done` ends the loop.
- `continue` drains again with no new tasks. Use it when a task is yet to finish.
- `replan` adds work, as a `tasks` array on the verdict or from a `replanner` option (a block that returns tasks) when the verdict has none.

A judge that throws, or returns a malformed verdict (one with no `reason` counts), ends the loop with reason `"judge-error"`, and `finalize` runs anyway. Set `onError: "fail"` to make that a request error instead. A failure in `seed` or in a drain is a request error either way.

An inline judge receives `{ collection, drainResult }`, where `drainResult` summarizes the drain that ran. `collection.list()` returns the board's tasks, each with an `id`, `goal`, `status` and `output`.

:::caution Cost
Every iteration is a full drain plus a judge call. A judge that returns `continue` over a finished board re-drains it with nothing to do until the cap.
:::

Whether the loop stops once the goal is actually met depends on what the judge checks. An LLM asked "are we done?" can flap or report success that isn't there. A check on a concrete property of the settled tasks holds up better.

## Use it

The examples belong to a `research` flow. The worker answers one task. It is a handler that takes `taskWorkerInputSchema`, whose `input.goal` is the task's text.

```ts title="src/flows/research/blocks/research-worker.ts"
import { handler } from "@flow-state-dev/core";
import { taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import { z } from "zod";

export const researchWorker = handler({
  name: "research-worker",
  inputSchema: taskWorkerInputSchema,
  outputSchema: z.string(),
  execute: async (input) => `Findings for: ${input.goal}`,
});
```

The board holds the tasks between drains. Its default storage lasts for the request, which is what the loop needs.

```ts title="src/flows/research/blocks/research-board.ts"
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import { researchWorker } from "./research-worker";

export const researchBoard = taskBoard({
  name: "research",
  collection: { collectionId: "research" },
  workers: researchWorker,
});
```

The seed writes the first tasks through the board's capability, which is named after the board. Give every task an `id`.

```ts title="src/flows/research/blocks/plan-research.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { researchBoard } from "./research-board";

export const planResearch = handler({
  name: "plan-research",
  inputSchema: z.object({ question: z.string() }),
  uses: [researchBoard.capability],
  execute: async (input, ctx) => {
    await ctx.cap.research.createTasks([
      { id: "background", goal: `Background on: ${input.question}` },
      { id: "sources", goal: `Primary sources for: ${input.question}` },
    ]);
  },
});
```

The loop asks for three answers. While fewer have completed, the judge replans with one more task.

```ts title="src/flows/research/blocks/research-loop.ts"
import { goalSeekLoop } from "@flow-state-dev/orchestration/task-board";
import { z } from "zod";
import { planResearch } from "./plan-research";
import { researchBoard } from "./research-board";

export const researchLoop = goalSeekLoop({
  name: "research-loop",
  inputSchema: z.object({ question: z.string() }),
  board: researchBoard,
  seed: planResearch,
  judge: ({ collection }) => {
    const tasks = collection.list();
    const completed = tasks.filter((t) => t.status === "completed");
    return completed.length >= 3
      ? { decision: "done", reason: "three answers" }
      : {
          decision: "replan",
          reason: "need more coverage",
          tasks: [{ id: `follow-up-${tasks.length}`, goal: "Find another source" }],
        };
  },
  maxIterations: 4,
});
```

With no `finalize`, the loop returns the settled board: its tasks, plus `results`, the outputs of the completed ones. `goalSeekLoop` builds a sequencer, so a flow uses it like any block.

## Patterns built on it

| Pattern | Judge | Drains |
| --- | --- | --- |
| `parallelTasks` | always `done` | one |
| `planAndExecute` | its evaluator, mapped to a verdict | as many as it replans |

[Supervisor](./supervisor.md) is not built on this loop. Its reviewer runs inside each task as a retry budget, not across the whole board.

## As a tool

A `goalSeekLoop` is a block, and [any block can be a tool](../../concepts/generators-and-tools.md). Put it in a generator's `tools` and the model calls the whole loop as one tool, supplying the loop's `inputSchema`. Only the loop's final output returns to the conversation. The per-drain work stays out of the model's history.

```ts title="src/flows/research/blocks/chat-agent.ts"
import { generator } from "@flow-state-dev/core";
import { researchLoop } from "./research-loop";
import { z } from "zod";

export const chatAgent = generator({
  name: "chat-agent",
  model: "openai/gpt-6-luna",
  prompt: "Answer the user. For questions that need sources, call the research loop.",
  inputSchema: z.object({ message: z.string() }),
  user: (input) => input.message,
  tools: [researchLoop],
  // Show the reply in the chat and keep it in history.
  itemVisibility: { client: true, history: true },
});
```

## When a task waits

A drain can leave a task waiting on a person's answer, or on an event outside the board. The loop ends that pass without judging or running `finalize`, and the drain doesn't use up an iteration. The call returns the board as the drain left it, with the waiting task left `in_progress`, and the termination item below carries the stop reason. After the person answers, run the loop again; the next drain picks the waiting task back up. This needs a board whose tasks outlive the request, such as one backed by `defineTaskCollection` instead of the default request storage. The stop reasons are on the [task board reference](../../reference/task-board.md).

## Stream items

The loop emits one `goal-seek-loop-termination` data item when it exits, a structured record carrying the collection id, the stop reason and the drain count. It is for tooling: it stays on the request's items, and never reaches a client or model history. Every field and reason is on the [items reference](../../reference/items.md).

## Limits

There is no cost or wall-clock budget and no stall detection. The only ways the loop ends are the judge and `maxIterations`. To stop on cost or time, check it in your judge.

## Next

- [Patterns reference](../../reference/patterns.md): every `goalSeekLoop` option, `onError`, `mapToVerdict`, and the rules checked at construction.
- [Task board reference](../../reference/task-board.md): drain behavior, waiting, and the board's own caps.
- [Plan and Execute](./plan-and-execute.md): a full replanning loop built on this one.
- [Parallel Tasks](./parallel-tasks.md): the single-pass case.
