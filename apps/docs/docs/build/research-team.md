---
title: Build a research team
type: tutorial
description: Build a flow where three analysts research competitors in parallel and a writer turns their notes into one comparison, then let a planner choose the competitors and see what happens when one analyst fails.
---

import Figure from "@site/src/components/Figure";
import BoardMoments from "./figures/the-board-at-three-moments.svg";

# Build a research team

This tutorial builds a research team: one analyst per competitor, all working at the same time, and a writer that turns their notes into a single comparison. Each of them is a model call. What connects them is bookkeeping: which analysts have finished, holding the writer back until they all have, and handing the writer what they found. You describe the work as a list of tasks, say which tasks wait on which, and give the list to a board that does the bookkeeping for you.

You start with a fixed list of three competitors, then let a planner decide the list when the request arrives. [Tasks and boards](../concepts/tasks-and-boards.md) explains the board itself. This page uses one with real models.

## What you will build

A flow with one action, `run`. It takes a request, researches each competitor, and returns the comparison. When one analyst fails, it returns which one and why, not half a comparison.

You need a project with `@flow-state-dev/core`, `@flow-state-dev/orchestration` and `zod` installed, the `@ai-sdk/openai` package, and `OPENAI_API_KEY` in `.env.local`. [Models](../concepts/models.md) covers other providers.

```text
src/flows/research/
  flow.ts
  board.ts
  blocks/analyst.ts
  blocks/writer.ts
  blocks/read-brief.ts
```

## 1 Two blocks: analyst and writer

A block is the framework's unit of work: a function, a model call, or a chain of them. A board runs a block for each task, and a model call is a `generator` block.

```ts title="src/flows/research/blocks/analyst.ts"
import { generator } from "@flow-state-dev/core";
import { taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import { z } from "zod";

export const analyst = generator({
  name: "analyst",
  model: "openai/gpt-6-luna",
  inputSchema: taskWorkerInputSchema,
  outputSchema: z.object({ findings: z.string() }),
  prompt:
    "You are a market analyst. Cover the company's customers, pricing and " +
    "how it differs from alternatives. Be concise.",
  user: (input) => input.goal,
});
```

```ts title="src/flows/research/blocks/writer.ts"
import { generator } from "@flow-state-dev/core";
import { taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import { z } from "zod";

export const writer = generator({
  name: "writer",
  model: "openai/gpt-6-luna",
  inputSchema: taskWorkerInputSchema,
  outputSchema: z.object({ brief: z.string() }),
  prompt:
    "You are a research lead. Combine the analysts' findings into one " +
    "comparison. Lead with the takeaway, then the evidence.",
  user: (input) => {
    const findings = Object.entries(input.deps ?? {})
      .map(([id, dep]) => `${id}: ${(dep as { findings: string }).findings}`)
      .join("\n\n");
    return `${input.goal}\n\n${findings}`;
  },
});
```

Both take the task as their input, which `taskWorkerInputSchema` describes. The analyst's message is the task's `goal`. The writer reads `input.deps`: the output of every task it waited on, keyed by task id. That is how the writer gets the three analysts' findings, with no query and no code to pass them along. [Task collections](../reference/task-collections.md) lists the other fields a block receives.

Nothing runs yet. Step 3 shows these two working.

## 2 A board with four tasks

```ts title="src/flows/research/board.ts"
import { taskBoard, type TaskAssigneeRegistry } from "@flow-state-dev/orchestration/task-board";
import { analyst } from "./blocks/analyst";
import { writer } from "./blocks/writer";

export const board = taskBoard({
  name: "research",
  workers: { analyst, writer } as TaskAssigneeRegistry,
  initialTasks: [
    { id: "acme", goal: "Research Acme", assignee: "analyst" },
    { id: "globex", goal: "Research Globex", assignee: "analyst" },
    { id: "initech", goal: "Research Initech", assignee: "analyst" },
    {
      id: "compare",
      goal: "Write the comparison",
      assignee: "writer",
      deps: ["acme", "globex", "initech"],
    },
  ],
});
```

`workers` maps each task's `assignee` to the block that does it. The cast to `TaskAssigneeRegistry` is there because, under TypeScript's `strict` mode, a block with a typed `outputSchema` does not fit the board's type for `workers`. `deps` on `compare` lists the three tasks it waits on, so it starts only after all three have finished. The board's loop, the drain, starts ready tasks together. [The task board reference](../reference/task-board.md) has the readiness rule and how many tasks run at once.

<Figure svg={BoardMoments} caption="The board at three moments" description={"Three boxes side by side, each listing the tasks acme, globex, initech and compare with their status. In the first, before the drain, all four are pending. In the second, while it runs, acme, globex and initech are in_progress and compare is pending; that row is highlighted as the one that cannot start yet. In the third, when the drain ends, all four are completed. Two notes below say that the drain starts the ready tasks together, so the three research tasks run at once, and that compare waits until all three are completed, then runs once."} />

## 3 Run it and read the result

Mount the drain in a flow. The drain returns a report on the run, not the comparison ([what it returns](../reference/task-board.md)), so add a step after it that reads the writer's task.

```ts title="src/flows/research/blocks/read-brief.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { board } from "../board";

export const readBrief = handler({
  name: "read-brief",
  inputSchema: z.unknown(),
  outputSchema: z.object({
    status: z.string(),
    brief: z.string().nullable(),
    failed: z.array(z.object({ id: z.string(), error: z.string().nullable() })),
  }),
  uses: [board.capability],
  execute: async (_input, ctx) => {
    const compare = await ctx.cap.research.getTask("compare");
    const errored = await ctx.cap.research.listTasks({ status: "errored" });
    return {
      status: compare?.status ?? "missing",
      brief: (compare?.output as { brief?: string } | undefined)?.brief ?? null,
      failed: errored.map((task) => ({ id: task.id, error: task.error ?? null })),
    };
  },
});
```

A capability is a bundle a block opts into with `uses`. `uses: [board.capability]` puts the board's tasks on `ctx.cap.research`, under the board's name. `getTask` reads one task and `listTasks` filters them. A task's `output` is what its block returned.

```ts title="src/flows/research/flow.ts"
import { defineFlow, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { board } from "./board";
import { readBrief } from "./blocks/read-brief";

const researchRun = sequencer({ name: "research-run", inputSchema: z.object({}) })
  .step(board.drain)
  .step(readBrief);

export default defineFlow({
  kind: "research",
  requireUser: true,
  actions: { run: researchRun },
})();
```

A sequencer chains blocks, and `.step` passes each block's output to the next. Run the action from the app's directory:

```bash
fsdev run research run -i '{}' --quiet
```

`fsdev run` prints one JSON line for each event. The last is `flow_complete`, and its `output` is what `readBrief` returned:

```text
{"type":"flow_complete","output":{"status":"completed","brief":"...","failed":[]},...}
```

The drain also reports on the board as it goes. To see how it stopped, filter for the last report:

```bash
fsdev run research run -i '{}' --quiet 2>/dev/null \
  | jq -c 'select(.type=="item_done" and .item.dataType=="task-board-meta" and .item.value.status=="completed") | .item.value'
```

Its `terminationReason`, the stop reason, is `all-completed` on this run. [The task board reference](../reference/task-board.md) lists every stop reason and the report's other fields.

## 4 Let a planner write the tasks

The three competitors are written into `board.ts`. A request for different companies needs a different file. Instead, let a block decide the list. The planner is a generator that returns the competitors, and a small step files one task for each before the drain starts.

```ts title="src/flows/research/blocks/plan-competitors.ts"
import { generator } from "@flow-state-dev/core";
import { z } from "zod";

export const planCompetitors = generator({
  name: "plan-competitors",
  model: "openai/gpt-6-luna",
  inputSchema: z.object({ request: z.string() }),
  outputSchema: z.object({ competitors: z.array(z.string()) }),
  prompt:
    "Name the companies the user wants compared. If they name one company, " +
    "name its three closest competitors.",
  user: (input) => input.request,
});
```

```ts title="src/flows/research/blocks/file-tasks.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { board } from "../board";

export const fileTasks = handler({
  name: "file-tasks",
  inputSchema: z.object({ competitors: z.array(z.string()) }),
  uses: [board.capability],
  execute: async (input, ctx) => {
    const ids = input.competitors.map((_, i) => `analyst-${i}`);
    await ctx.cap.research.createTasks([
      ...input.competitors.map((name, i) => ({
        id: `analyst-${i}`,
        goal: `Research ${name}`,
        assignee: "analyst",
      })),
      { id: "compare", goal: "Write the comparison", assignee: "writer", deps: ids },
    ]);
  },
});
```

In `board.ts`, delete `initialTasks`: the board starts empty. Then change the flow.

```ts title="src/flows/research/flow.ts"
import { defineFlow, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { board } from "./board";
import { fileTasks } from "./blocks/file-tasks";
import { planCompetitors } from "./blocks/plan-competitors";
import { readBrief } from "./blocks/read-brief";

const researchRun = sequencer({
  name: "research-run",
  inputSchema: z.object({ request: z.string() }),
})
  .step(planCompetitors)
  .tap(fileTasks)
  .step(board.drain)
  .step(readBrief);

export default defineFlow({
  kind: "research",
  requireUser: true,
  actions: { run: researchRun },
})();
```

`.tap` runs a block for its effect and passes the previous output through, so `fileTasks` adds tasks and the drain follows. [Task collections](../reference/task-collections.md) covers how a batch of tasks is filed.

```bash
fsdev run research run -i '{"request":"Compare Linear with its closest competitors"}' --quiet
```

If the planner returns Jira, Asana and Trello, the board holds `analyst-0` to `analyst-2` and `compare`, and the output has the same shape as before. With five names it would hold six tasks.

So the only thing that changed is where the tasks come from: a list in the flow, or a block's output filed before the drain. The workers, `deps` and failure behaviour are the same.

Three things to know before you run this for real users:

- **Each request has its own board.** This board's tasks live on the request, so two users sending requests at the same moment never see each other's tasks, and the tasks are gone when the request ends. Running the same request again starts from an empty board, whether the app runs in memory or on a persistent store. [Tasks and boards](../concepts/tasks-and-boards.md) covers keeping a list across requests.
- **Ids must be unique.** `analyst-${i}` gives each task its own id, because `i` differs per competitor. If a planner-built batch repeated an id, `createTasks` would refuse the whole batch and file nothing.
- **The board limits how many tasks a request can file.** A planner that names too many competitors makes `createTasks` throw, and none of the tasks are filed. The numbers are in [the task board reference](../reference/task-board.md).

## 5 When one analyst fails

Say `analyst-1` throws, because a model request times out. The board marks that task `errored` and keeps running whatever else is ready, so the other two analysts finish. `compare` depends on the one that failed, so it is cancelled and never runs. The run does not fail. A failed task is not retried unless it sets `maxAttempts`; [the reference](../reference/task-board.md) covers statuses and retries.

`readBrief` returns what is left:

```text
{"type":"flow_complete","output":{"status":"cancelled","brief":null,"failed":[{"id":"analyst-1","error":"model request timed out"}]},...}
```

`brief` is `null`. The writer's task is `cancelled`, with `error` set to `dep analyst-1 failed` and `causedBy` naming `analyst-1`. The `jq` command from step 3 shows a `terminationReason` of `blocked-by-failures`.

The board does not decide what the user sees. Your flow does. Here it reports the failed task and its error. The stop reason travels on the stream for a client or `jq` to read. Inside the flow, check the writer's `status`, as `readBrief` does. [Every stop reason](../reference/task-board.md) is in the reference.

## Where to go next

- [Tasks and boards](../concepts/tasks-and-boards.md) explains what a board stores and how long the list lasts.
- [Task board reference](../reference/task-board.md) lists the stop reasons, retries and limits.
- [Parallel Tasks](../catalog/patterns/parallel-tasks.md) is this plan, file and drain shape as a ready-made pattern.
