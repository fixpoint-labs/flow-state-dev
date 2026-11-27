---
title: Routed Specialists
type: catalog
description: A controller picks the next specialist over a shared workspace until it converges.
---

# Routed Specialists

Some work has no fixed order. A researcher gathers notes, an analyst finds patterns in them, and only then do you know whether the researcher needs a second pass. Which specialist goes next depends on what is already written down.

`routedSpecialists` runs that. You register specialists, each one a block, and give them a shared *workspace*, a writable resource they read and update. A *controller* looks at the workspace each pass and either names the next specialist or says the work is done. The default controller is an LLM. A built-in *synthesizer* then turns the final workspace into the answer.

Use it when:

- The work benefits from independent expert perspectives that build on each other.
- A single specialist can't solve the problem in one pass.
- The next specialist is chosen based on what is already in the workspace.

If specialists should run concurrently and react to topic-keyed entries, with no controller, use [Event Actors](./event-actors.md). If the roster and its order are fixed, use [Round Robin](./round-robin.md).

## How a run goes

Each pass, the controller returns `{ specialist, done, reasoning }`. If it names a specialist, that specialist runs, writes to the workspace, and the controller decides again. One specialist runs per pass, never two at once. The run ends when the controller returns `done: true`, or when `maxIterations` is reached.

The workspace is where specialists share work. Specialists don't receive it as input. A specialist reads it as `ctx.resources.workspace.state` and writes with `ctx.resources.workspace.patchState({ ... })`, and it must declare `resources: { workspace }` on itself to do either.

## Install it

```bash
pnpm add @flow-state-dev/patterns
```

`routedSpecialists` and `createWorkspace` come from `@flow-state-dev/patterns`, or from the subpath `@flow-state-dev/patterns/routed-specialists`.

## Use it

The workspace goes in a file both the specialists and the pattern import.

```ts title="src/flows/research/workspace.ts"
import { createWorkspace } from "@flow-state-dev/patterns";
import { z } from "zod";

export const researchWorkspace = createWorkspace(
  z.object({
    goal: z.string(),
    research: z.string().optional(),
    analysis: z.string().optional(),
  }),
);
```

Each specialist is a block in its own file. This one is a sequencer: a generator writes the notes, then a handler stores them in the workspace.

```ts title="src/flows/research/blocks/researcher.ts"
import { generator, handler, sequencer } from "@flow-state-dev/core";
import { researchWorkspace } from "../workspace";

export const researcher = sequencer({ name: "researcher" })
  .step(
    generator({
      name: "research-notes",
      model: "openai/gpt-6-luna",
      resources: { workspace: researchWorkspace },
      prompt: "Write short research notes on the goal.",
      user: (_input, ctx) => `Goal: ${ctx.resources.workspace.state.goal}`,
    }),
  )
  .step(
    handler({
      name: "write-research",
      resources: { workspace: researchWorkspace },
      execute: async (out, ctx) => {
        await ctx.resources.workspace.patchState({ research: out as string });
        return { contributed: true };
      },
    }),
  );
```

`analyst` has the same shape. Its generator reads `research` and its handler writes `analysis`.

```ts title="src/flows/research/blocks/analyst.ts"
import { generator, handler, sequencer } from "@flow-state-dev/core";
import { researchWorkspace } from "../workspace";

export const analyst = sequencer({ name: "analyst" })
  .step(
    generator({
      name: "analyse-notes",
      model: "openai/gpt-6-luna",
      resources: { workspace: researchWorkspace },
      prompt: "Find patterns and gaps in the research notes.",
      user: (_input, ctx) => `Notes: ${ctx.resources.workspace.state.research ?? ""}`,
    }),
  )
  .step(
    handler({
      name: "write-analysis",
      resources: { workspace: researchWorkspace },
      execute: async (out, ctx) => {
        await ctx.resources.workspace.patchState({ analysis: out as string });
        return { contributed: true };
      },
    }),
  );
```

The pattern goes in its own file.

```ts title="src/flows/research/blocks/research-board.ts"
import { routedSpecialists } from "@flow-state-dev/patterns";
import { researchWorkspace } from "../workspace";
import { researcher } from "./researcher";
import { analyst } from "./analyst";

export const researchBoard = routedSpecialists({
  name: "research-board",
  workspace: researchWorkspace,
  specialists: { researcher, analyst },
  maxIterations: 6,
  initialState: (input) => ({ goal: (input as { topic: string }).topic }),
});
```

Add `researchBoard` as a step in the flow, with input like `{ topic: "EU battery regulation" }`. `initialState` seeds the workspace once, at the start. The controller picks `researcher` or `analyst` by the keys of `specialists`. A specialist's return value is recorded as that pass's `output`.

`maxIterations` counts repeats after the first pass, so a controller that never says done gets `maxIterations + 1` passes. Hitting the cap is not an error: the run returns its output as usual. Every other option is in the [patterns reference](../../reference/patterns.md).

## What comes back

By default the synthesizer's output is the result. Pass `synthesizer: false` to get the raw `{ workspace, iterations, history }`, where `iterations` counts controller decisions, including the final `done` one, and `history` lists each completed specialist run, oldest first, as `{ iteration, specialist, reasoning, output }`. Pass your own block as `synthesizer` and it receives that same shape. The [patterns reference](../../reference/patterns.md) has the details.

## Replace the controller

Any block that returns `{ specialist, done, reasoning }` can be the `controller`. Use one when the choice is a rule, not a judgment, such as "always analyse after research". A custom controller receives the pattern's input, not the history. To act on progress, read the workspace.

A controller that names a specialist you did not register, or returns `specialist: null` without `done: true`, fails that pass. The loop carries on and picks again.

## When a specialist fails

A specialist that throws does not stop the run. The pass is recorded as failed, a `specialist failed: <message>` status is emitted, and the controller picks again. A failed pass is not in `history`, and the default controller does not see that it was tried. It sees the workspace.

## Inspecting a run

Each pass emits a status line naming the specialist it invoked. After each pass the pattern also emits a `routedSpecialists` data item, a structured record on the stream, carrying the workspace state, the iteration number, the current specialist and whether the run is done. Register a container renderer under `routedSpecialists` to show it: `renderers={{ container: { routedSpecialists: ResearchProgress } }}`.

Each pass that picked a specialist is also recorded as a task, a unit of work from the orchestration package (see [Task Board](../../concepts/tasks-and-boards.md)). The [patterns reference](../../reference/patterns.md) says where those records live and how to read them.

## What it won't do

- Run specialists concurrently. One runs per pass.

## See also

- [Round Robin](./round-robin.md) for a fixed roster in declared order.
- [Event Actors](./event-actors.md) for actors that react to entry topics in parallel.
- [Task Board](../../concepts/tasks-and-boards.md) for concurrent drain over a task collection with dependency gating.
- [Supervisor](./supervisor.md) for plan, execute, review, replan.
- [Patterns reference](../../reference/patterns.md) for config fields, output shape, the run's block sequence and where its records live.
