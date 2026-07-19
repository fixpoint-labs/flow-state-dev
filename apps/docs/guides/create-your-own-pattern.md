---
title: Create your own pattern
sidebar_label: Create your own pattern
description: A pattern is a factory that wraps taskBoard into a reusable block. Build a mapReduce pattern from the same skeleton the built-in patterns use.
---

# Create your own pattern

The built-in patterns — `supervisor`, `planAndExecute`, `parallelTasks` — look
like distinct primitives, but they're all the same thing underneath: a factory
that wraps [`taskBoard`](/docs/orchestration/task-board) and hands back a block.
When a recurring shape of work doesn't quite match a built-in, you write your
own the same way.

This guide builds `mapReduce` — fan a list of items across a worker, then fold
the results — and a flow that uses it. The runnable, tested code is in
[`examples/guides/custom-pattern`](https://github.com/fixpoint-labs/flow-state-dev/tree/main/examples/guides/custom-pattern).

If you haven't yet, read [The board lifecycle](./board-lifecycle) first — a
pattern is exactly the "seed, drain, read" lifecycle packaged up, and this
guide assumes you know what `board.block` does.

## The skeleton

Every board-backed pattern is three moves against one collection:

```
seed the collection  →  drain via board.block  →  read the results back
```

A pattern factory just wires those three into a sequencer and exposes a small
config so callers never touch the board directly. That's the whole idea. The
value of writing a pattern is that the wiring lives in one place and every
caller gets it right.

## The config

Decide what the caller supplies and what you own. For `mapReduce`, the caller
brings three things — how to turn the input into items, the worker, and the fold
— and the pattern owns the board, the seeding, and the gather:

```ts title="map-reduce.ts"
export interface MapReduceConfig<TInput, TItem, TResult> {
  name: string;
  inputSchema: ZodTypeAny;
  /** Turn the flow input into the list of items to map over. */
  plan: (input: TInput) => Array<{ id: string; input: TItem }>;
  /** The worker block that processes one item. */
  map: BlockDefinition;
  /** Fold the completed workers' outputs into the final result. Pure. */
  reduce: (outputs: unknown[]) => TResult;
}
```

## The factory

Build the board once, then the three blocks around it. Note that the board is
request-backed so the seed and reduce blocks — which run outside `board.block` —
can resolve the same collection:

```ts title="map-reduce.ts"
export function mapReduce<TInput, TItem, TResult>(
  config: MapReduceConfig<TInput, TItem, TResult>,
): BlockDefinition {
  const collectionId = config.name;

  const board = taskBoard({
    name: config.name,
    collection: { backing: "request", collectionId },
    workers: { map: config.map },   // one assignee, staffed by the caller's worker
    initialTasks: [],               // seeded dynamically below
  });

  const seed = handler({
    name: `${config.name}-seed`,
    inputSchema: config.inputSchema,
    outputSchema: z.object({ seeded: z.number() }),
    execute: async (input, ctx) => {
      const collection = await getOrCreateTaskCollection({ ctx, backing: "request", collectionId });
      const items = config.plan(input as TInput);
      for (const item of items) {
        await collection.addTask({ id: item.id, goal: item.id, assignee: "map", input: item.input });
      }
      return { seeded: items.length };
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
    .tap(seed)          // a tap, so it passes the input through
    .step(board.block)  // drain
    .step(reduce);      // fold the collected outputs
}
```

Three things worth calling out:

- **`seed` is a `.tap`.** A tap runs a block for its state mutation (here, adding
  tasks) and passes the original input through to the next step, so the drain
  still sees the action input if it needs it.
- **`reduce` reads through `ctx`, not its input.** It resolves the collection by
  id and folds the completed outputs, so it ignores whatever the drain handed
  it.
- **Nothing here is board-internal.** `taskBoard`, `getOrCreateTaskCollection`,
  and the block builders are all public. A pattern is ordinary composition.

## Using it

A consumer writes a worker and a reducer and mounts the block like any other:

```ts title="word-count-flow.ts"
const wordCountBlock = mapReduce({
  name: "word-count",
  inputSchema,
  plan: (input) => input.documents.map((text, i) => ({ id: `doc-${i}`, input: { text } })),
  map: countWords, // a handler (or a generator) that counts one document
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
pnpm fsdev run word-count count -i '{"documents":["a b c","one two","single"]}'
# → { total: 6 }
```

The worker here is a deterministic handler so the example runs with no key. Swap
it for a `generator({ model: "openai/gpt-5.4-mini", … })` and the same pattern
fans an LLM call across every item — the pattern doesn't care whether its worker
calls a model.

## Progress comes for free

Because the board is doing the work, your pattern emits `task-change` (per-task
lifecycle) and `task-board-meta` (board-level aggregate) items automatically.
Pair them with `<TaskPlan />` from `@flow-state-dev/ui` and a consumer gets a
live progress view without your pattern rendering anything.

## Where to look next

- **The built-in patterns are the reference.** `parallelTasks` is the closest
  minimal shape to this guide; `supervisor` and `planAndExecute` add review and
  replan loops on the same skeleton. See the [Patterns](/docs/patterns/overview) docs.
- **The `create-pattern` skill** in the repo scaffolds a pattern with tests and
  docs if you're building one for real.

## Related

- [The board lifecycle](./board-lifecycle) — the seed/drain/read model a pattern packages.
- [Building a research team](./building-a-research-team) — task boards from scratch.
- [Task board](/docs/orchestration/task-board) — the `taskBoard` config reference.
