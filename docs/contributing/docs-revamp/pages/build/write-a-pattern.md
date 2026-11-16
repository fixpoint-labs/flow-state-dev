---
title: Write your own pattern
type: recipe
description: A pattern is a factory that wraps taskBoard into a reusable block. Build a planMapReduce pattern from the same plan, seed, drain, reduce steps the built-in patterns use.
---

# Write your own pattern

The built-in patterns (`supervisor`, `planAndExecute`, `parallelTasks`) look like
separate tools, but each is a function that builds a [task board](../concepts/tasks-and-boards.md)
and returns a block. When a recurring shape of work doesn't match one of them, you
write your own the same way.

This recipe builds `planMapReduce`: plan the work, run one task per planned item,
then fold the results into one answer. The finished code is in
[`examples/guides/custom-pattern`](https://github.com/fixpoint-labs/flow-state-dev/tree/main/examples/guides/custom-pattern).
It assumes you know what a board and its drain are; if not, read
[Tasks and boards](../concepts/tasks-and-boards.md) first.

## 1. Decide what the pattern takes

Every board pattern runs the same four steps in one sequencer: plan the work, seed
the board with one task per item, drain it, reduce the finished tasks. The factory
hides those steps. A caller passes:

- `name`: unique within the flow. It prefixes every block the pattern builds.
- `inputSchema`: the schema of the input the pattern is mounted against.
- `plan`: a block whose output is `{ items: [{ id, input }] }`. Pass a handler for a
  fixed split or a generator to let a model plan.
- `map`: the block that does one task. It receives the task, and its output is what
  `reduce` sees.
- `reduce`: a function that folds the finished tasks' outputs into the result.
- `onError`: what a failing task does to the run. Optional, `"skip"` by default. See
  [When a task fails](#when-a-task-fails).

## 2. Write the factory

Build the board first, then the two blocks that sit around it. The board's
capability is how a block reads and writes its tasks, so `seed` and `reduce` both
list it in `uses`.

```ts title="src/lib/plan-map-reduce.ts"
import { handler, sequencer, type BlockDefinition } from "@flow-state-dev/core";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import { z, type ZodTypeAny } from "zod";

/** The shape a `plan` block must output. */
export const planOutputSchema = z.object({
  items: z.array(z.object({ id: z.string(), input: z.unknown() })),
});

export interface PlanMapReduceConfig<TResult> {
  name: string;
  inputSchema: ZodTypeAny;
  plan: BlockDefinition;
  map: BlockDefinition;
  reduce: (outputs: unknown[]) => TResult;
  onError?: "skip" | "fail";
}

export function planMapReduce<TResult>(
  config: PlanMapReduceConfig<TResult>,
): BlockDefinition {
  const board = taskBoard({
    name: `${config.name}-board`,
    workers: { map: config.map }, // one assignee, "map"
    onError: config.onError,
  });

  const seed = handler({
    name: `${config.name}-seed`,
    inputSchema: planOutputSchema,
    outputSchema: z.object({ seeded: z.number() }),
    uses: [board.capability],
    execute: async (input, ctx) => {
      await ctx.cap[board.capability.name].createTasks(
        input.items.map((item) => ({
          id: item.id,
          goal: item.id,
          assignee: "map",
          input: item.input,
        })),
      );
      return { seeded: input.items.length };
    },
  });

  const reduce = handler({
    name: `${config.name}-reduce`,
    inputSchema: z.unknown(),
    outputSchema: z.unknown(),
    uses: [board.capability],
    execute: async (_input, ctx): Promise<unknown> => {
      const done = await ctx.cap[board.capability.name].listTasks({ status: "completed" });
      return config.reduce(done.map((task) => task.output));
    },
  });

  return sequencer({ name: config.name, inputSchema: config.inputSchema })
    .step(config.plan)  // input becomes { items }
    .step(seed)         // one task per item
    .step(board.drain)  // run the tasks
    .step(reduce);      // fold the outputs
}
```

In the sequencer, each step's output is the next step's input. The types don't
check that, so a `plan` block whose output doesn't match `planOutputSchema` fails
when the flow runs. `reduce` ignores what the drain hands it and reads the
finished tasks through the board's capability.

An empty plan is fine. The seed writes no tasks, the drain has nothing to run, and
`reduce` folds an empty list.

### When a task fails

By default one failing `map` call does not fail the run. The error is recorded on
that task, the other tasks carry on, and `reduce` reads only completed tasks. If
`map` throws on ticket 7 of 20, `reduce` receives 19 outputs, the run completes, and
`testBlock` reports `error: null`. The failed ticket is missing without a trace in
the result.

To stop the whole batch on the first failure, pass `onError: "fail"` in the config.
The failure then aborts the drain and the error comes back non-null. Tasks are capped per board; the limits are in the
[task board reference](../reference/task-board.md).

### Where `uses` goes

Every block takes a `uses` slot, so a capability for `plan` or `map` goes on the
block you pass in. The factory forwards nothing. Built-in patterns such as
`supervisor` accept `uses` because they build default generators themselves and
install it on those. Here the only blocks the factory builds are `seed` and
`reduce`, and they already carry the board's capability.

## 3. Use it in a flow

A caller supplies the `plan` and `map` blocks and a `reduce` function, then mounts the result like any other block.
Here `planDocuments` turns a list of documents into one item each, and `countWords`
counts the words in one. Both are handlers, so the example needs no model key.

```ts title="src/flows/word-count/flow.ts"
import { defineFlow, handler } from "@flow-state-dev/core";
import { taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import { z } from "zod";
import { planMapReduce, planOutputSchema } from "../../lib/plan-map-reduce";

const inputSchema = z.object({ documents: z.array(z.string()) });

const planDocuments = handler({
  name: "plan-documents",
  inputSchema,
  outputSchema: planOutputSchema,
  execute: (input) => ({
    items: input.documents.map((text, i) => ({ id: `doc-${i}`, input: { text } })),
  }),
});

const countWords = handler({
  name: "count-words",
  inputSchema: taskWorkerInputSchema.extend({
    input: z.object({ text: z.string() }).optional(),
  }),
  outputSchema: z.object({ count: z.number() }),
  execute: (task) => {
    const text = task.input?.text.trim() ?? "";
    return { count: text === "" ? 0 : text.split(/\s+/).length };
  },
});

const wordCount = planMapReduce({
  name: "word-count",
  inputSchema,
  plan: planDocuments,
  map: countWords,
  reduce: (outputs) => ({
    total: (outputs as { count: number }[]).reduce((sum, out) => sum + out.count, 0),
  }),
});

const wordCountFlow = defineFlow({
  kind: "word-count",
  requireUser: true,
  actions: { count: wordCount },
  session: { stateSchema: z.object({}) },
});

export default wordCountFlow();
```

Make `plan` or `map` a `generator({ model: "openai/gpt-6-luna", ... })` and the
same pattern lets a model plan the work or process each item.

## 4. Run it

From the example's directory, with the flow registered in `fsdev.config.ts`, run
the action. Stdout is one JSON item per line, and the last line carries the output.

```bash
pnpm fsdev run word-count count -i '{"documents":["a b c","one two","single"]}' | jq -c 'select(.type == "flow_complete").output'
# {"total":6}
```

To test it without a terminal, call `testFlow({ flow, action: "count", userId, input })`
from `@flow-state-dev/testing`; `result.output` is `{ total: 6 }`.

## Show the progress

Because a board does the work, the pattern emits `task-change` and
`task-board-meta` items on its own. Render them with the `TaskPlan` component,
passing the board's name as `collectionId` and the session's items as `items`,
for example `session.items` from `useSession`.

```tsx title="src/app/word-count-progress.tsx"
"use client";

import type { OutputItem } from "@flow-state-dev/core/items";
import { TaskPlan } from "@/components/flow-state/task-plan";

export function WordCountProgress({ items }: { items: ReadonlyArray<OutputItem> }) {
  return <TaskPlan collectionId="word-count-board" items={items} />;
}
```

Without `items`, `TaskPlan` reads them from a `SessionItemsProvider` above it, and
with neither it gets no items and draws an empty board.

The item types and the component's install steps are in the
[items reference](../reference/items.md) and the [UI components reference](../reference/ui-components.md).

## Related

- [Tasks and boards](../concepts/tasks-and-boards.md): the seed, drain and read model a pattern packages.
- [Parallel tasks](../catalog/patterns/parallel-tasks.md): the built-in pattern closest to this one. [Plan and execute](../catalog/patterns/plan-and-execute.md) uses a generator as its planner.
- [Task board reference](../reference/task-board.md): the `taskBoard` options.
- [Task collections reference](../reference/task-collections.md): reading and writing a board's tasks.
