---
sidebar_position: 6
---

# Sequencer state

Sequencer state is an execution-local workspace for blocks that run inside one sequencer instance. It is not session state. It starts fresh for each sequencer run, and it is useful for plans, progress, intermediate findings, and loop coordination.

## Declaring state

```ts
import { handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const research = sequencer({
  name: "research",
  stateSchema: z.object({
    plan: z.array(z.string()).default([]),
    currentStep: z.number().default(0),
  }),
});

const planner = handler({
  name: "planner",
  sequencerStateSchema: z.object({
    plan: z.array(z.string()),
    currentStep: z.number(),
  }),
  execute: async (input, ctx) => {
    await ctx.sequencer?.patchState({
      plan: ["search docs", "summarize findings"],
      currentStep: 0,
    });
  },
});
```

The sequencer owns the actual `stateSchema`. Child blocks declare the slice they expect with `sequencerStateSchema`, which types `ctx.sequencer`.

## Access rules

`ctx.sequencer` points to the nearest enclosing sequencer that has state. If the block is not inside a stateful sequencer, it is `undefined`.

Use sequencer state when:

- The data is only meaningful during this pipeline execution.
- Multiple steps in one sequencer need to coordinate.
- A loop or side-chain needs shared progress state.

Use session, user, or org state when the data should survive beyond the current execution.

## Related pages

- [State and Scopes](/docs/fundamentals/state-and-scopes#sequencer-scope)
- [State targets and parents](/docs/advanced/state-targets-and-parents)
- [Transient slots](/docs/advanced/transient-slots)
