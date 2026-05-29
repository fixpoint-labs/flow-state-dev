---
sidebar_position: 12
---

# Sequencer State

The four persistence scopes — `request`, `session`, `user`, `org` — are tied to identity. Sequencer state is tied to execution: it lives for one execution of one sequencer instance and is checkpointed at every step boundary so the run can resume after an interruption (FIX-401). When the run finishes, the state is done.

When blocks inside a sequencer need to share data — a plan one block built and the next blocks act on, partial findings accumulating across steps — sequencer state is the right primitive.

## Declaring sequencer state

A sequencer declares its state with `stateSchema`:

```ts
const pipeline = sequencer({
  name: "research-pipeline",
  inputSchema: z.string(),
  stateSchema: z.object({
    plan: z.array(z.string()).default([]),
    currentStep: z.number().default(0),
    findings: z.record(z.string()).default({}),
  }),
});
```

Each time this sequencer executes, it gets a fresh state container initialized from the schema defaults. The state lives for the duration of that one execution.

## Reading and writing from blocks

Blocks inside the sequencer access it via `ctx.sequencer`:

```ts
const planner = handler({
  name: "planner",
  sequencerStateSchema: z.object({
    plan: z.array(z.string()),
    currentStep: z.number(),
  }),
  execute: async (_input, ctx) => {
    await ctx.sequencer!.patchState({
      plan: ["search", "analyze", "summarize"],
      currentStep: 0,
    });
  },
});

const executor = handler({
  name: "executor",
  sequencerStateSchema: z.object({
    currentStep: z.number(),
    findings: z.record(z.string()),
  }),
  execute: async (_input, ctx) => {
    const step = ctx.sequencer!.state.currentStep;
    await ctx.sequencer!.patchState({
      findings: { [`step-${step}`]: "result..." },
    });
    await ctx.sequencer!.incState({ currentStep: 1 });
  },
});
```

`planner` and `executor` only mutate `ctx.sequencer.state`; they have no transformation to feed downstream. They declare no `outputSchema` and chain into a sequencer with `.tap()` rather than `.step()`.

`sequencerStateSchema` on each block declares what state shape it expects from its enclosing sequencer. Like session/user/org schemas, these bubble up — the framework merges them and catches conflicts at build time.

`ctx.sequencer` resolves to the **nearest enclosing sequencer** that declares a `stateSchema`. If the block isn't inside a sequencer (or the sequencer has no state schema), `ctx.sequencer` is `undefined` — guard with `?.` or assert with `!` when you know the topology.

## Typing sequencer state via declarations

When a sequencer declares `stateSchema`, the framework uses it to type `ctx.sequencer.state` throughout the pipeline — in every block step and in every DSL callback.

Blocks that need to read or write sequencer state declare the fields they depend on via `sequencerStateSchema`. The framework merges these declarations and checks for conflicts at build time. Blocks don't need to redeclare fields they don't touch.

```ts
import { sequencer, handler } from "@flow-state-dev/core";
import { z } from "zod";

const pipeline = sequencer({
  name: "research-pipeline",
  inputSchema: z.string(),
  stateSchema: z.object({
    plan: z.array(z.string()).default([]),
    currentStep: z.number().default(0),
    findings: z.record(z.string()).default({}),
  }),
});

const planner = handler({
  name: "planner",
  sequencerStateSchema: z.object({
    plan: z.array(z.string()),
    currentStep: z.number(),
  }),
  execute: async (_input, ctx) => {
    // ctx.sequencer!.state.plan — string[]
    // ctx.sequencer!.state.currentStep — number
    await ctx.sequencer!.patchState({
      plan: ["search", "analyze", "summarize"],
      currentStep: 0,
    });
  },
});

const research = pipeline
  .tap(planner)
  // DSL callbacks also see the typed state
  .stepIf(
    (_, ctx) => ctx.sequencer.state.currentStep < 3,
    executeStep
  );
```

DSL callbacks — `.map`, `.tap`, `.tapIf`, `.stepIf`, `.workIf`, `.forEach`, `.doUntil`, `.exitIf`, `.throwIf`, `.branch`, and inline connector functions — all receive a `ctx` where `ctx.sequencer.state` is typed from the sequencer's `stateSchema`. If the sequencer has no `stateSchema`, `ctx.sequencer` is `undefined` as before.

## The durability boundary

Sequencer state has a different lifetime from the persistence scopes — but it is **not** purely in-memory.

At every step boundary, durable sequencers checkpoint their state via the `CheckpointStore` (FIX-401). Each write is keyed by `(requestId, blockInstanceId)` and overwrites the prior record — latest-only semantics, so storage is constant per sequencer regardless of step count. The Phase 2 resume runtime (FIX-141) reads the latest checkpoint to pick up after an interrupted request.

Sequencers default to `durable: true`. Opt out for tests or single-shot ephemeral pipelines where checkpointing is unwanted overhead:

```ts
sequencer({
  name: "ephemeral-pipeline",
  durable: false,
  stateSchema: z.object({ /* ... */ }),
});
```

When the sequencer reaches a terminal frame (success / error / cancel), the final checkpoint is **retained** by default for post-mortem inspection. Operators that want eager GC opt in via `flow.request.cleanupCheckpointsOnTerminal: true`.

Compare with the persistence scopes (when wired to a durable store like sqlite or postgres):

| | Sequencer | Session / User / Org |
|---|---|---|
| Lifetime tied to | Sequencer instance execution | Identity (request / session / user / org) |
| Persistence model | Latest-only checkpoint per instance | Versioned per-scope record |
| Survives restart | Yes (when `durable: true`) — resume runtime rehydrates | Yes (with a durable store) |
| Concurrency model | FIFO lock per container | CAS retry loop |
| Throws `ConcurrentModificationError`? | No | Yes |

The mutation model details are in [State Mutation Model](/docs/state/mutation-model). The short version: sequencer scope serializes mutators through an in-process queue, so it never sees the version conflicts that drive `ConcurrentModificationError`. The cost of safety is zero, and the operation surface (`patchState`, `incState`, etc.) is identical to the durable scopes.

### Why not just use session state?

Sequencer state is scoped to *one execution of one sequencer instance*. Session state lives across every request in a conversation. Even though both are durable, they answer different questions:

- A planner's `currentStep`, a research pipeline's accumulating findings, a worker's claim — these belong to a single run. Resumed if the run is interrupted, gone when the run completes.
- Conversation mode, message counts, accumulated user-visible context — these belong to the conversation, across many runs.

Use sequencer state for *coordination during a run that should resume cleanly if interrupted*. Use session state for anything the next request might care about.

## Transient slots

Sequencer state checkpoints carry every field by default. `transientSlot()` is the opt-out — for fields that should stay in-memory only, never enter the durable checkpoint, and never ride the SSE stream:

```ts
import { sequencer, transientSlot } from "@flow-state-dev/core";

const counter = sequencer({
  name: "counter",
  stateSchema: z.object({
    count: z.number().default(0),
    // Worker-local scratch. Stays in memory but never appears on the SSE
    // stream and resets to its schema default on resume.
    lastClaimed: transientSlot(z.boolean().default(false)),
  }),
});
```

A transient slot:

- **Holds its value** across the sequencer's run, readable by later steps via `ctx.sequencer.state`.
- **Does not emit** `state_change` items on the SSE stream.
- **Does not appear** in `state_snapshot` payloads, so it never enters the durable checkpoint store and resets to its schema default on resume.

Use transient slots for high-frequency or worker-local fields where you want in-memory coordination but don't want every write riding the stream or surviving a resume. The task-board pattern uses them for fields like `lastClaimed` — workers polling every loop tick would otherwise flood the stream with no-value events, and the value is meaningless after a resume anyway.

Apply `transientSlot()` **last** in the schema chain (after `.optional()`, `.default()`, etc.) so the marker sits on the outermost schema instance referenced by the parent `z.object` shape:

```ts
// Right
field: transientSlot(z.string().optional())
```

### Mixed patches

If a single `patchState` call writes both a transient slot and a normal field, the framework strips the transient keys from the SSE delta but persists the rest. Callers don't have to split writes — write what makes sense, the boundary is enforced at emit time.

## Reaching across sequencers

If a deeply nested block needs to read or write state on a *specific* outer sequencer (rather than the nearest one), use `targetStateSchemas` and `ctx.targets.<name>`. See [State Targets and Parents](/docs/advanced/state-targets-and-parents).

## Where to next

- **[State Operations](/docs/fundamentals/state-operations)** — the full operation reference; sequencer scope shares the same surface.
- **[State Mutation Model](/docs/state/mutation-model)** — why the in-memory path uses a FIFO lock instead of CAS.
- **[State Targets and Parents](/docs/advanced/state-targets-and-parents)** — typed access to ancestor state by name.
