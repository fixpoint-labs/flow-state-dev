---
title: Create your own pattern
sidebar_label: Create your own pattern
description: A pattern is a factory that wraps taskBoard into a reusable block. Build a planMapReduce pattern from the same plan → drain → reduce skeleton the built-in patterns use.
---

# Create your own pattern

The built-in patterns — `supervisor`, `planAndExecute`, `parallelTasks` — look
like distinct primitives, but they're all the same thing underneath: a factory
that wraps [`taskBoard`](/docs/orchestration/task-board) and hands back a block.
When a recurring shape of work doesn't quite match a built-in, you write your
own the same way.

This guide builds `planMapReduce` — plan the work, fan the items across a
worker, then fold the results — and a flow that uses it. The runnable, tested
code is in
[`examples/guides/custom-pattern`](https://github.com/fixpoint-labs/flow-state-dev/tree/main/examples/guides/custom-pattern).

If you haven't yet, read [The board lifecycle](./board-lifecycle) first — a
pattern is exactly the "seed, drain, read" lifecycle packaged up, and this
guide assumes you know what `board.block` does.

## The skeleton

Every board-backed pattern is the same moves against one collection:

```
plan the work  →  seed the collection  →  drain via board.block  →  reduce the results
```

A pattern factory wires those into a sequencer and exposes a small config so
callers never touch the board directly. The value of writing a pattern is that
the wiring lives in one place and every caller gets it right.

## Plan is a block, not a function

The one design decision worth dwelling on: **`plan` is a block, not a plain
function.** Real planning usually calls a model — a generator that looks at the
input and decides how much work there is and what each unit should be. So the
pattern takes a `plan` *block* whose output is the list of items to map over. A
consumer can hand it a deterministic handler (for cheap or fixed splits) or a
generator (to let a model plan), and the pattern doesn't care which.

```ts title="plan-map-reduce.ts"
/** The shape a `plan` block must output. */
export const planOutputSchema = z.object({
  items: z.array(z.object({ id: z.string(), input: z.unknown() })),
});

export interface PlanMapReduceConfig<TResult> {
  name: string;
  inputSchema: ZodTypeAny;
  /** A block (often a generator) that turns the input into items to map over. */
  plan: BlockDefinition;
  /** The worker block that processes one item. */
  map: BlockDefinition;
  /** Fold the completed workers' outputs into the final result. Pure. */
  reduce: (outputs: unknown[]) => TResult;
}
```

## The factory

Build the board once, then the blocks around it. The board is request-backed so
the seed and reduce blocks — which run outside `board.block` — can resolve the
same collection:

```ts title="plan-map-reduce.ts"
export function planMapReduce<TResult>(
  config: PlanMapReduceConfig<TResult>,
): BlockDefinition {
  const collectionId = config.name;

  const board = taskBoard({
    name: config.name,
    collection: { backing: "request", collectionId },
    workers: { map: config.map },   // one assignee, staffed by the caller's worker
    initialTasks: [],               // seeded from the plan below
  });

  const seed = handler({
    name: `${config.name}-seed`,
    inputSchema: planOutputSchema,   // consumes the plan block's output
    outputSchema: z.object({ seeded: z.number() }),
    execute: async (input, ctx) => {
      const collection = await getOrCreateTaskCollection({ ctx, backing: "request", collectionId });
      for (const item of input.items) {
        await collection.addTask({ id: item.id, goal: item.id, assignee: "map", input: item.input });
      }
      return { seeded: input.items.length };
    },
  });

  const reduce = handler({
    name: `${config.name}-reduce`,
    inputSchema: z.unknown(),
    outputSchema: z.unknown(),
    execute: async (_input, ctx) => {
      const collection = await getOrCreateTaskCollection({ ctx, backing: "request", collectionId });
      const outputs = collection.list({ status: "completed" }).map((task) => task.output);
      return config.reduce(outputs);
    },
  });

  return sequencer({ name: config.name, inputSchema: config.inputSchema })
    .step(config.plan)  // input → { items }
    .step(seed)         // enqueue one task per item
    .step(board.block)  // drain
    .step(reduce);      // fold the collected outputs
}
```

Three things worth calling out:

- **`plan` runs first as a real step**, and its `{ items }` output is the seed
  block's input. Swap the handler for a generator and a model plans the work.
- **`reduce` reads through `ctx`, not its input.** It resolves the collection by
  id and folds the completed outputs, so it ignores whatever the drain handed it.
- **Nothing here is board-internal.** `taskBoard`, `getOrCreateTaskCollection`,
  and the block builders are all public. A pattern is ordinary composition.

## Using it

A consumer writes a plan block, a worker, and a reducer, then mounts the block
like any other:

```ts title="word-count-flow.ts"
const wordCountBlock = planMapReduce({
  name: "word-count",
  inputSchema,
  plan: planDocuments, // input → { items: one per document }
  map: countWords,     // a handler (or a generator) that counts one document
  reduce: (outputs) => ({
    total: outputs.reduce<number>((sum, o) => sum + ((o as { count?: number })?.count ?? 0), 0),
  }),
});

export const wordCountFlow = defineFlow({
  kind: "word-count",
  actions: { count: { block: wordCountBlock } },
  session: { stateSchema: z.object({}) },
});
```

```bash
cd examples/guides/custom-pattern
pnpm fsdev run word-count count -i '{"documents":["a b c","one two","single"]}'
# → { total: 6 }
```

The plan and map blocks are deterministic handlers here so the example runs with
no key. Make `plan` (or `map`) a `generator({ model: "openai/gpt-5.4-mini", … })`
and the same pattern lets a model plan the work or process each item — the
pattern doesn't care whether its blocks call a model.

## Progress comes for free

Because the board is doing the work, your pattern emits `task-change` (per-task
lifecycle) and `task-board-meta` (board-level aggregate) items automatically.
Pair them with `<TaskPlan />` from `@flow-state-dev/ui` and a consumer gets a
live progress view without your pattern rendering anything.

## Where to look next

- **The built-in patterns are the reference.** `parallelTasks` is the closest
  minimal shape to this guide; `supervisor` and `planAndExecute` add review and
  replan loops on the same skeleton — and `planAndExecute`'s planner is a real
  generator, exactly the `plan`-as-a-block idea taken to its conclusion. See the
  [Patterns](/docs/patterns/overview) docs.
- **The `create-pattern` skill** in the repo scaffolds a pattern with tests and
  docs if you're building one for real.

## Related

- [The board lifecycle](./board-lifecycle) — the seed/drain/read model a pattern packages.
- [Building a research team](./building-a-research-team) — task boards from scratch.
- [Task board](/docs/orchestration/task-board) — the `taskBoard` config reference.
