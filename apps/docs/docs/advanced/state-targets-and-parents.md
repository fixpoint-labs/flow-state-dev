---
sidebar_position: 11
---

# State Targets and Parents

Targets give a block typed access to the state of **named ancestor blocks** in the execution tree. A block running inside a sequencer can reach up and read or write the sequencer's state — without knowing exactly where in the flow it lives.

Targets address a named ancestor's [block state](/docs/advanced/block-state) by name; `ctx.parent`, covered below, addresses the *immediate* parent's state without naming it at all.

This is a power-user surface. Most flows don't need it. When you do — typically a leaf block that reports progress to an enclosing sequencer, or a worker that writes findings back to a coordinator — `targetStateSchemas` is what you reach for.

## `targetStateSchemas`

Add `targetStateSchemas` to any `handler`, `generator`, or `router` config:

```ts
const progressReporter = handler({
  name: "progress-reporter",
  inputSchema: z.object({ step: z.number(), total: z.number() }),
  outputSchema: z.number(),
  targetStateSchemas: {
    research: z.object({ progress: z.number() }),
  },
  execute: async (input, ctx) => {
    const pct = Math.round((input.step / input.total) * 100);
    // ctx.targets.research is StateRef<{ progress: number }> | undefined
    await ctx.targets.research?.patchState({ progress: pct });
    return pct;
  },
});
```

Each entry in `targetStateSchemas` declares:

- The **name** of the ancestor block (its `name` config field).
- The **partial state schema** this block expects to read or write on that ancestor.

The framework infers `ctx.targets.<name>` as `StateRef<...> | undefined`. All the standard scope state operations are available on the ref: `state` for reads, `patchState`, `incState`, `pushState`, `setStateRecord`, `deleteStateRecord`, `atomicState`.

## Why `?.`

Target handles are always `| undefined`. If the block runs outside the expected topology — in a test, in a different flow, or with the ancestor not yet executed — the target may not exist. Guard every access:

```ts
// Read
const progress = ctx.targets.research?.state.progress ?? 0;

// Write
await ctx.targets.research?.patchState({ progress: 75 });
```

The `undefined` handle is by design. Blocks declare what they *want* via `targetStateSchemas`; the framework provides what's actually available at runtime. This keeps blocks reusable across topologies — a progress reporter can run inside a research pipeline or standalone, and it degrades gracefully when no target is present.

## Resolution: siblings first, then ancestors

`ctx.targets.<name>` and the dynamic `ctx.getTarget(name)` resolve in two passes:

1. **Siblings** — already-dispatched blocks at the current execution level, most-recent dispatch wins. This is how a later block in a sequencer finds an earlier one.
2. **Ancestors** — walks up the parent execution chain. This is how a deeply nested block finds an enclosing sequencer or a block from an outer sequence.

Returns `undefined` if no block with that name exists in either pass.

### Ambiguity errors

If multiple ancestors share the same name, the framework throws `AmbiguousBlockNameError`:

```ts
throw new AmbiguousBlockNameError(
  `getTarget("research") is ambiguous from block instance "process-chunk[3]". Matching instances: research[1], research[7]`
);
```

This forces you to be explicit. The fix is usually to give one of the blocks a more specific name — a duplicate-named ancestor chain is almost always a sign that the topology has drifted and someone needs to disambiguate.

### Ambiguity is intentional safety

The framework refuses to *guess* which ancestor you mean. In a deeply nested pipeline, picking "the closest one" silently is a bug factory — a refactor that adds an outer sequencer with the same name would change behavior with no test failure to catch it. Failing loudly at the first cross-block read is the right tradeoff.

## `ctx.parent`: the immediate parent's state

`ctx.parent` reaches the block's *immediate* parent — no name required. Declare the shape you expect with `parentStateSchema`:

```ts
const activateSkill = handler({
  name: "activate-skill",
  parentStateSchema: z.object({ activeSkills: z.array(z.string()) }),
  execute: async (input, ctx) => {
    await ctx.parent?.pushState?.("activeSkills", input.id);
  },
});
```

This is the tightest-scoped of the three ancestor handles — it only ever reaches one level up, and only when the immediate parent declared its own `stateSchema`. See [Block State](/docs/advanced/block-state) for the full picture, including how `ctx.self` and `ctx.parent` are two sides of the same container.

## `ctx.targets` vs `ctx.sequencer` vs `ctx.parent`

All three reach into ancestor state. Different use cases:

| | `ctx.sequencer` | `ctx.targets.<name>` | `ctx.parent` |
|---|---|---|---|
| **What it points to** | Nearest enclosing sequencer | Specific named ancestor | Immediate parent, whatever kind it is |
| **Typing** | Inferred from the sequencer's `stateSchema` | Inferred from `targetStateSchemas` entry | Inferred from `parentStateSchema` |
| **Use case** | Access the direct parent pipeline | Cross-sequencer coordination | A child (e.g. a generator tool) writing back to exactly the block that dispatched it |

Use `ctx.sequencer` when a block cooperates with its immediate parent — a chain of steps sharing per-run state. Use `ctx.targets.<name>` when a block needs to communicate with a *specific* ancestor, possibly across multiple nesting levels. Use `ctx.parent` when you only ever care about whoever dispatched you directly, regardless of its name or kind.

## Dynamic access via `ctx.getTarget`

When you don't know the target name at compile time, use `ctx.getTarget`:

```ts
const dynamic = ctx.getTarget<{ progress: number }>("some-block");
await dynamic?.patchState({ progress: 50 });
```

`getTarget` is the runtime escape hatch:

- It accepts an optional type parameter for ergonomic casting.
- It uses the same sibling-then-ancestor resolution as `ctx.targets.<name>`.
- It throws `AmbiguousBlockNameError` on the same conditions.

For well-known relationships, prefer `targetStateSchemas` — the type flows through without a manual cast, and the block self-documents which ancestors it expects. `getTarget` is the right tool when the target name is computed (a routing key, a configuration value) or when writing generic utilities.

## A worked example

A research pipeline reports progress to its outermost sequencer from a deeply nested chunk processor:

```ts
import { handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

// Outer sequencer carries progress state on its own instance state.
const researchPipeline = sequencer({
  name: "research-pipeline",
  inputSchema: z.object({ query: z.string() }),
  stateSchema: z.object({ progress: z.number().default(0) }),
});

// Inner block declares which ancestor it needs.
const processChunk = handler({
  name: "process-chunk",
  inputSchema: z.object({ chunk: z.string(), total: z.number(), index: z.number() }),
  outputSchema: z.string(),
  targetStateSchemas: {
    "research-pipeline": z.object({ progress: z.number() }),
  },
  execute: async (input, ctx) => {
    const pct = Math.round(((input.index + 1) / input.total) * 100);
    // Fully typed: StateRef<{ progress: number }> | undefined
    await ctx.targets["research-pipeline"]?.patchState({ progress: pct });
    return `processed:${input.chunk}`;
  },
});

// Nested sequencer uses the reporter.
const chunkProcessor = sequencer({ name: "chunk-processor" })
  .step(splitIntoChunks)
  .forEach(processChunk, { maxConcurrency: 3 });

// Wire into the outer pipeline.
researchPipeline
  .step(fetchSources)
  .step(chunkProcessor)   // process-chunk inside reaches up to research-pipeline
  .step(synthesize);
```

The point: `processChunk` doesn't know how many sequencers wrap it, only that an ancestor named `"research-pipeline"` carries a `{ progress: number }` shape. It works regardless of nesting depth, and the type system catches schema drift on either side.

## Where to next

- **[Block State](/docs/advanced/block-state)** — the underlying primitive; `ctx.self`, `ctx.parent`, `ctx.sequencer`, and `ctx.targets` are four addressing modes over the same container.
- **[State Operations](/docs/fundamentals/state-operations)** — the full operation reference shared by every scope and target.
- **[Sequencer State](/docs/advanced/sequencer-state)** — the per-execution scope `ctx.sequencer` points to.
- **[Blocks](/docs/fundamentals/blocks)** — block configuration, including the `targetStateSchemas` field.
