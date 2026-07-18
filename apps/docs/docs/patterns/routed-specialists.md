---
sidebar_position: 8
---

# Routed Specialists

`routedSpecialists` coordinates multiple specialist agents over a shared writable workspace. An LLM controller reads the workspace state, decides which specialist to invoke next, and the loop continues until the controller signals convergence.

Use it when:

- The work benefits from independent expert perspectives that build on each other
- A single specialist can't solve the problem in one pass
- You want adaptive selection — the next move depends on what's already on the workspace

If specialists should fire concurrently and react to topic-keyed entries instead of being orchestrated, use [Event Actors](./event-actors) instead.

## Block composition

```
input
  → initWorkspace     (seed workspace state)
  → controller        (LLM: { specialist, done, reasoning })
  → recordIteration   (create Task in collection if !done)
  → dispatch          (route to specialist by name)
  → recordCompletion  (mark Task complete with output)
  → emitSnapshot      (live render in <Plan />)
  → checkLoop  → loopBack(controller)
  → synthesizer       (optional)
```

Per-iteration records live in a `TaskCollection`. Each iteration is a `Task` whose `assignee` names the picked specialist and whose `output` carries that specialist's return value. Query the collection to inspect the decision sequence post-run; the controller reads from it to build its history prompt.

## Minimal example

```typescript
import { generator, handler, sequencer } from "@flow-state-dev/core";
import { routedSpecialists, createWorkspace } from "@flow-state-dev/patterns/routedSpecialists";
import { z } from "zod";

const workspace = createWorkspace(z.object({
  goal: z.string(),
  research: z.string().optional(),
  analysis: z.string().optional(),
}));

const researcher = sequencer({ name: "researcher" })
  .step(generator({ /* ... reads workspace state, returns research notes ... */ }))
  .step(handler({
    name: "write-research",
    resources: { workspace },
    execute: async (out, ctx) => {
      await ctx.resources.workspace.patchState({ research: out as string });
      return { contributed: true };
    },
  }));

const analyst = sequencer({ name: "analyst" })
  .step(generator({ /* ... synthesizes patterns from research ... */ }))
  .step(handler({
    name: "write-analysis",
    resources: { workspace },
    execute: async (out, ctx) => {
      await ctx.resources.workspace.patchState({ analysis: out as string });
      return { contributed: true };
    },
  }));

export const research = routedSpecialists({
  name: "research-board",
  workspace,
  specialists: { researcher, analyst },
  maxIterations: 6,
  initialState: (input: { topic: string }) => ({ goal: input.topic }),
});
```

## Config

| Field | Type | Default | Description |
| ----- | ---- | ------- | ----------- |
| `name` | `string` | required | Pattern instance name (block-name prefix and TaskCollection id). |
| `workspace` | `DefinedResource` | required | Shared writable resource specialists read/write. Created via `createWorkspace(schema)`. |
| `specialists` | `Record<string, BlockDefinition>` | required | Specialist registry keyed by name. The controller picks one of these names per iteration. |
| `controller` | `BlockDefinition` | LLM default | Block that returns `{ specialist, done, reasoning }`. The default uses `model` + the workspace state + the iteration history. |
| `maxIterations` | `number` | `10` | Hard cap on iterations. |
| `maxHistory` | `number` | unlimited | Soft cap on the history window the default controller sees. |
| `initialState` | `object \| (input) => object` | — | Seeds workspace at start. |
| `instructions` | `string \| (input, ctx) => string` | — | Overall instructions for default controller and synthesizer. |
| `model` | `string` | `"openai/gpt-5.4-mini"` | Model for default blocks. |
| `synthesizer` | `BlockDefinition \| false` | LLM default | Final synthesis. Pass `false` to return raw `{ workspace, iterations, history }`. |
| `outputSchema` | `ZodTypeAny` | — | Output schema for the default synthesizer. |
| `collectionId` | `string` | `name` | Override for the TaskCollection id. |

## Output shape

When `synthesizer === false`:

```typescript
{
  workspace: WorkspaceState,
  iterations: number,
  history: Array<{
    iteration: number,
    specialist: string,
    reasoning: string,
    output: unknown,
  }>,
}
```

When a synthesizer is configured (default), the synthesizer receives the above shape and produces the final output.

## Substrate notes

The pattern stores per-iteration records in a sequencer-state-backed `TaskCollection` (`@flow-state-dev/orchestration`). The decision sequence renders natively in `<Plan />` and is queryable post-run via `collection.list({ status: "completed" })`. The shared workspace is a sibling writable resource — the pattern does not co-mingle workspace state with the TaskCollection.

## See also

- [Round Robin](./round-robin) — fixed roster in declared order, judge as terminator. The flip side of "controller picks next."
- [Event Actors](./event-actors) — actors react to entry topics in parallel; no controller.
- [Task Board](../orchestration/task-board) — concurrent drain over a `TaskCollection` with dependency gating and worker routing.
- [Supervisor](./supervisor) — plan, execute, review, replan loop.
