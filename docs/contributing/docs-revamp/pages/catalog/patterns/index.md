---
title: Patterns
type: catalog
sidebar_label: Overview
description: Eight ready-made ways to arrange several model calls around one job, how to pick between them, and how to measure the pick.
---

import Figure from "@site/src/components/Figure";
import EightShapes from "./figures/eight-shapes.svg";

# Patterns

A job that needs more than one model call tends to take one of a few shapes. Split it and run the pieces side by side. Check each result. Let a model choose the next step. Have several voices take turns. Each takes wiring to get right: what runs when, what a failure does, when to stop.

A pattern is one of those shapes, already wired. It is a function that returns a block, the unit you build AI work from, so it goes wherever any block goes. You supply the parts that are yours, such as the block that handles one task, and the pattern supplies the arrangement.

<Figure svg={EightShapes} caption="Eight shapes, one small drawing each" description={"Eight boxes in two rows, one per pattern, each holding a small drawing of its shape. parallelTasks: a goal fans out to three tasks that run side by side and feed one combine step. supervisor: the same fan-out, then a review of each task, with a dashed arrow back to the tasks that applies only when a result is rejected. planAndExecute: plan, then tasks in order, then an evaluate step, with dashed arrows from evaluate back to plan that apply only when replanning is turned on. routedSpecialists: a controller picks one of two specialists, which writes to a shared workspace that feeds back to the controller. roundRobin: four named agents in a ring, each passing to the next in a fixed order. debate: two debaters pass arguments to each other and both feed one judge. eventActors: an entry arrives and runs the two actors whose watch patterns match, while a third actor is left alone. responseAuditor: a finished answer goes to two analyzers, which produce annotations, and the answer itself is unchanged. A solid arrow means one step feeds the next. A dashed arrow means it holds only when its condition holds."} />

## Pick by the shape of the work

The first three break a goal into tasks. They differ on whether each result needs a review before it counts, and whether the plan should change as results come in.

| Pattern | Pick it when |
| --- | --- |
| [`parallelTasks`](./parallel-tasks.md) | The pieces are independent and you trust the block that does each task. One pass: split, run side by side, combine. |
| [`supervisor`](./supervisor.md) | Each result needs a review before it counts. A rejected result goes back to the block that did it, with feedback. |
| [`planAndExecute`](./plan-and-execute.md) | Tasks depend on each other, or the plan should change as results come in. Turn on `enableReplanning` for the second. |

The other five are arranged around something other than a task list.

| Pattern | Pick it when |
| --- | --- |
| [`routedSpecialists`](./routed-specialists.md) | You do not know the order of the work in advance. A controller reads a shared workspace and picks the next specialist each turn. |
| [`roundRobin`](./round-robin.md) | The roster and its order are the design, as in an editorial review. Everyone speaks once per round, in order. |
| [`debate`](./debate.md) | The answer has real tradeoffs, and you want a verdict rather than an average. Debaters argue assigned stances, and one judge decides at the end. |
| [`eventActors`](./event-actors.md) | Events trigger the work and no step knows which comes next. Each event runs the actors that watch for it. |
| [`responseAuditor`](./response-auditor.md) | You want a finished answer checked for bias or policy without holding it back. Attach it with `.sideChain()` after a generator: the answer streams first, the analyzers score it afterwards, and the answer is never changed. |

`eventActors` returns an object rather than a block. Put its `.emit` block in an action. Every other pattern returns the block itself.

Import every pattern from `@flow-state-dev/patterns`, except `responseAuditor`. The package root does not export it. Import it from `@flow-state-dev/patterns/response-auditor`.

A ninth, [`goalSeekLoop`](./goal-seek-loop.md), repeats the work until a judge says the goal is reached. Options, required fields, defaults and import paths for all nine are in the [patterns reference](../../reference/patterns.md). Several patterns run on a task board, a stored list of tasks and the loop that works through it, explained in [Tasks and boards](../../concepts/tasks-and-boards.md).

## Use one

The example is a `digest` flow that summarizes support tickets with `supervisor`. The block that does each task is passed as `worker`. Here it is a generator that summarizes one ticket:

```ts title="src/flows/digest/blocks/summarize-ticket.ts"
import { generator } from "@flow-state-dev/core";
import { z } from "zod";

export const summarizeTicket = generator({
  name: "summarize-ticket",
  model: "openai/gpt-6-luna",
  inputSchema: z.object({
    taskId: z.string(),
    goal: z.string(),
    feedback: z.string().optional(),
  }),
  outputSchema: z.object({ summary: z.string() }),
  prompt: "You summarize one support ticket in two sentences.",
  user: (input) =>
    input.feedback
      ? `Ticket: ${input.goal}\n\nPrior feedback: ${input.feedback}`
      : `Ticket: ${input.goal}`,
});
```

The supervisor wraps it:

```ts title="src/flows/digest/blocks/digest-tickets.ts"
import { supervisor } from "@flow-state-dev/patterns";
import { summarizeTicket } from "./summarize-ticket";

export const digestTickets = supervisor({
  name: "digest",
  worker: summarizeTicket,
  reviewCriteria: [
    "Names the customer's actual problem",
    "Two sentences or fewer",
  ],
});
```

An action is an entry point a client calls, and its block is the work it runs. A pattern fills that slot like any block:

```ts title="src/flows/digest/flow.ts"
import { defineFlow } from "@flow-state-dev/core";
import { digestTickets } from "./blocks/digest-tickets";

export const digestFlow = defineFlow({
  kind: "digest",
  actions: { digest: digestTickets },
});
```

## Measure on your own tasks

Which pattern fits depends on your tasks and your model, so measure.

`fsdev benchmark` runs each pattern you name, plus a single-generator baseline, over the same tasks on the same model. A separate judge model scores every output against a rubric you write per task, so the pattern is the only thing that varies.

To compare two patterns, write a `defineBenchmark` file that names both in `patterns` and your tasks in `tasks`, then run it:

```bash
fsdev benchmark ./benchmark.ts
```

Only six patterns can be benchmarked. The default registry names them `supervisor`, `plan-and-execute`, `parallel-tasks`, `round-robin`, `debate` and `routed-specialists`. `eventActors` and `responseAuditor` are not shaped as a goal in, answer out, so `fsdev benchmark` has no entry for them.

Add `--max-cost 0.50` to cap spending in dollars. When the sweep passes the cap it stops, prints a partial scorecard and exits with code 1, so a CI job running it sees a failure.

Read the overall ranking. `Δ vs baseline` is how far a pattern sits from the single call, and `credible` says whether that gap is big enough to trust. When it is false, raise `runs`. The results describe your tasks and your model, not patterns in general.

[Benchmark patterns on your own tasks](../../build/benchmark-patterns.md) walks through the task file, the flags and the scorecard, and the [CLI reference](../../reference/cli.md) lists every flag.

## Build your own

A custom pattern is usually a factory that wraps a task board and returns a block: plan the work, put the tasks on the board, run them, combine the results. When none fits, [write your own](../../build/write-a-pattern.md) or drop to the board directly. Every option is in the [patterns reference](../../reference/patterns.md).
