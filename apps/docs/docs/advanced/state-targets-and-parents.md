---
sidebar_position: 5
---

# State targets and parents

Nested flows sometimes need to coordinate with an enclosing block. Use these APIs sparingly. Most data should move through sequencer inputs and outputs.

## `ctx.sequencer`

`ctx.sequencer` points at the nearest enclosing sequencer with a `stateSchema`.

```ts
const step = handler({
  name: "step",
  sequencerStateSchema: z.object({
    progress: z.number(),
  }),
  execute: async (_input, ctx) => {
    await ctx.sequencer?.incState({ progress: 1 });
  },
});
```

Use this when a step needs to update its direct pipeline's execution state.

## `targetStateSchemas`

When a block needs a specific named ancestor, declare it:

```ts
const processChunk = handler({
  name: "process-chunk",
  targetStateSchemas: {
    "research-pipeline": z.object({ progress: z.number() }),
  },
  execute: async (input, ctx) => {
    await ctx.targets["research-pipeline"]?.patchState({
      progress: input.percent,
    });
  },
});
```

`ctx.targets.<name>` is always optional. The block may run in a test or in another topology where that ancestor does not exist.

## `ctx.getTarget()`

Use `ctx.getTarget(name)` when the target name is dynamic:

```ts
const target = ctx.getTarget<{ progress: number }>(input.targetName);
await target?.patchState({ progress: 50 });
```

Resolution is nearest-first:

1. Already-dispatched siblings at the current execution level.
2. Ancestors in the parent execution chain.

If multiple ancestors share the same name, the runtime throws an ambiguity error instead of guessing.

## `ctx.parent`

`ctx.parent` gives a nested block the immediate parent's name, kind, and input. Use it when a pattern needs the parent input for context but the child's own input has already been transformed.

```ts
const audit = handler({
  name: "audit",
  parentInputSchema: z.object({ message: z.string() }),
  execute: async (_input, ctx) => {
    const originalMessage = ctx.parent?.input.message;
    await writeAuditLog(originalMessage);
  },
});
```

Prefer explicit connectors when the parent input is part of normal business data. `ctx.parent` is for pattern internals and audit-style context.

## Related pages

- [State and Scopes](/docs/fundamentals/state-and-scopes#target-state)
- [Sequencer state](/docs/advanced/sequencer-state)
- [Sequencer side-chains](/docs/advanced/sequencer-side-chains)
