---
title: Supervisor
type: catalog
description: Fan out, review each result, and retry the ones rejected.
---

# Supervisor

Some work needs a second pair of eyes on every piece. Summarize forty support tickets, and you want each summary checked before it counts. `supervisor` splits a goal into tasks, runs your worker on each at the same time on a [task board](../../concepts/tasks-and-boards.md) (a stored list of tasks and the loop that works through it), has a reviewer judge each result, and sends rejected work back to the worker with the reviewer's feedback. When every task has settled, a synthesizer combines the approved results into one output.

Reach for it when:

- output quality matters and a bad result should be corrected, not skipped,
- each result needs its own approval before it counts as done,
- you want a retry budget that also covers review rejections.

If you don't need review, use [Parallel Tasks](./parallel-tasks.md). If tasks must run in a strict order, use [Plan and Execute](./plan-and-execute.md).

## Use it

The examples belong to a `digest` flow that summarizes support tickets. The worker handles one task. It declares `feedback` on its input, because a worker only receives the fields its schema declares, and `feedback` is how a retry learns what the reviewer wanted changed.

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
  maxAttemptsPerTask: 3,
  maxConcurrency: 4,
});
```

`supervisor` returns a sequencer, so a flow uses it like any other block. Its input is `{ goal: string }`. A planner (by default, a generator the pattern builds) splits the goal into tasks. Each task goes to the worker, then to the reviewer, which approves the output or rejects it. Approved output is the task's result. `maxConcurrency` (default 3) sets how many tasks run at once.

The default planner, reviewer and synthesizer use `model: "intent/synthesize"`, a model intent your app maps to a model. See [Models](../../reference/models.md).

Besides `name`, you need `worker` or, to route tasks by assignee, a `workers` registry. With a registry, each task goes to the worker named by its assignee, and that worker's output is reviewed on its own. Every other option is in the [patterns reference](../../reference/patterns.md).

## Write your own reviewer

The default reviewer is a generator that checks each output against `reviewCriteria`. To review differently, pass a block that takes a `ReviewerInput` and returns a `ReviewerVerdict`:

```ts title="src/flows/digest/blocks/check-length.ts"
import { handler } from "@flow-state-dev/core";
import {
  reviewerInputSchema,
  reviewerVerdictSchema,
} from "@flow-state-dev/patterns";

export const checkLength = handler({
  name: "check-length",
  inputSchema: reviewerInputSchema,
  outputSchema: reviewerVerdictSchema,
  execute: (input) => {
    const { summary } = input.workerOutput as { summary: string };
    return summary.length <= 400
      ? { decision: "approve" }
      : { decision: "reject", feedback: "Cut it to under 400 characters." };
  },
});
```

Add `reviewer: checkLength` to the `supervisor` call. The reviewer sees the task's `goal`, `attempts`, `workerOutput` and your `reviewCriteria`. A verdict's `decision` is `approve`, `reject` or `needs-revision`, and `feedback` is required on the last two. Both get the same retry and the same `failed-review` label. Use `needs-revision` when the output is close and needs specific fixes, and `reject` when it needs redoing. The default reviewer follows the same distinction. Pass `reviewer: false` to skip review, so every worker output counts as done.

## When a task is rejected

A rejected task goes back to `pending`, and the verdict's `feedback` reaches the worker's next run as `input.feedback`. `attempts` is 1 on the first run and 2 on the first retry. `maxAttemptsPerTask` (default 3) counts runs in all, so 3 means the first run plus two retries, and 1 means no retry. The worker never receives its earlier output, only the feedback, so a reviewer's feedback should say what to keep.

When the budget is spent, the task ends `errored` with the `failed-review` label and the other tasks carry on. The synthesizer sees only the results of `completed` tasks. A worker that throws spends the same budget, and its error message becomes the next run's `feedback`.

A second limit, `maxTotalRetries` (default 50), caps retries across the whole board. What happens when it runs out, the other failure labels and the task counts are in the [patterns reference](../../reference/patterns.md).

## Dependencies and the final output

A planner can give a task `deps`, a list of other task ids it waits for. Independent tasks run side by side. If a task ends `errored`, the tasks that depend on it are cancelled with the `skipped` label. [Task collections](../../reference/task-collections.md) has the dependency rules.

The supervisor returns whatever the synthesizer produces: a string by default, or the shape you pass as the supervisor's `outputSchema` option. A custom `synthesizer` block receives `{ goal, results }`, where `results` holds the `output` of every `completed` task.

A supervisor's tasks live for the request that called it. Nothing it plans survives a new request, so it is not a background queue. For a board that outlives a request, see [Task board](../../reference/task-board.md).

Cost scales with attempts. The reviewer runs once for each attempt that reaches it, so N tasks that each take two reviewed attempts make 2N worker calls and 2N reviewer calls, plus one planner call and one synthesizer call. An attempt where the worker throws skips its review.

## See also

- [Parallel Tasks](./parallel-tasks.md): fan-out without per-task review
- [Plan and Execute](./plan-and-execute.md): sequential, dependency-ordered execution with replanning
- [Round Robin](./round-robin.md): fixed-roster turn-taking with a judge, no per-task retry
- [Goal-seek loop](./goal-seek-loop.md): judges the whole board's result instead of each task
- [Task board](../../reference/task-board.md): the board the supervisor runs its tasks on
- [Patterns reference](../../reference/patterns.md): every option, label and limit
