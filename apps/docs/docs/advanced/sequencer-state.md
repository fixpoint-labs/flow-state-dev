---
sidebar_position: 12
---

# Sequencer State

The four persistence scopes — `request`, `session`, `user`, `org` — are tied to identity. Sequencer state has a different lifetime: it lives for one execution of one sequencer instance, then it's gone. No store, no version history, no checkpoint.

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
  execute: async (input, ctx) => {
    await ctx.sequencer!.patchState({
      plan: ["search", "analyze", "summarize"],
      currentStep: 0,
    });
    return input;
  },
});

const executor = handler({
  name: "executor",
  sequencerStateSchema: z.object({
    currentStep: z.number(),
    findings: z.record(z.string()),
  }),
  execute: async (input, ctx) => {
    const step = ctx.sequencer!.state.currentStep;
    await ctx.sequencer!.patchState({
      findings: { [`step-${step}`]: "result..." },
    });
    await ctx.sequencer!.incState({ currentStep: 1 });
    return input;
  },
});
```

`sequencerStateSchema` on each block declares what state shape it expects from its enclosing sequencer. Like session/user/org schemas, these bubble up — the framework merges them and catches conflicts at build time.

`ctx.sequencer` resolves to the **nearest enclosing sequencer** that declares a `stateSchema`. If the block isn't inside a sequencer (or the sequencer has no state schema), `ctx.sequencer` is `undefined` — guard with `?.` or assert with `!` when you know the topology.

## The durability boundary

This is the part to internalize. Sequencer state is **in-memory only**:

- It lives in process memory for the duration of the sequencer's execution.
- It is **not** persisted to any store.
- It is **not** included in checkpoints or session snapshots.
- On a process restart mid-execution, sequencer state is gone — same as any other in-memory value.

Compare with the persistence scopes (when wired to a durable store like sqlite or postgres):

| | Sequencer | Session / User / Org |
|---|---|---|
| Lifetime | One execution | Across requests / users / orgs |
| Persisted | No | Yes (with a durable store) |
| Survives restart | No | Yes |
| Concurrency model | FIFO lock per container | CAS retry loop |
| Throws `ConcurrentModificationError`? | No | Yes |

The mutation model details are in [State Mutation Model](/docs/state/mutation-model). The short version: sequencer scope serializes mutators through an in-process queue, so it never sees the version conflicts that drive `ConcurrentModificationError`. The cost of safety is zero, and the operation surface (`patchState`, `incState`, etc.) is identical to the durable scopes.

### Why sequencer state isn't durable

It would be a footgun. Sequencers are execution units, not identity boundaries. Persisting their per-run state across restarts would force every flow author to think about resumption semantics — which fields are safe to recover, which would be stale, what happens if the schema changed mid-deploy. None of that pays off, because sequencer state is for *coordination during a run*. If you need data to survive a restart, that's session/user/org state by definition.

## Transient slots

`transientSlot()` is the inverse marker — a way to opt **out** of even the limited surface that sequencer state offers on the SSE stream:

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

Use transient slots for high-frequency or worker-local fields where you want the in-memory coordination but don't want every write to ride the stream. The task-board pattern uses them for fields like `lastClaimed` — workers polling every loop tick would otherwise flood the stream with no-value events.

Apply `transientSlot()` **last** in the schema chain (after `.optional()`, `.default()`, etc.) so the marker sits on the outermost schema instance referenced by the parent `z.object` shape:

```ts
// Right
field: transientSlot(z.string().optional())

// Wrong — the marker is buried under .optional()
field: z.string().transient().optional()  // would not work; .transient() doesn't exist this way
```

### Mixed patches

If a single `patchState` call writes both a transient slot and a normal field, the framework strips the transient keys from the SSE delta but persists the rest. Callers don't have to split writes — write what makes sense, the boundary is enforced at emit time.

## Reaching across sequencers

If a deeply nested block needs to read or write state on a *specific* outer sequencer (rather than the nearest one), use `targetStateSchemas` and `ctx.targets.<name>`. See [State Targets and Parents](/docs/advanced/state-targets-and-parents).

## Where to next

- **[State Operations](/docs/fundamentals/state-operations)** — the full operation reference; sequencer scope shares the same surface.
- **[State Mutation Model](/docs/state/mutation-model)** — why the in-memory path uses a FIFO lock instead of CAS.
- **[State Targets and Parents](/docs/advanced/state-targets-and-parents)** — typed access to ancestor state by name.
