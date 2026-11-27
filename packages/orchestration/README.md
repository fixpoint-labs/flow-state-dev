# @flow-state-dev/orchestration

Tasks, the task board that drains them, and skills.

```bash
pnpm add @flow-state-dev/orchestration
```

```ts
import { handler } from "@flow-state-dev/core";
import { taskBoard, taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";

const worker = handler({
  name: "echo",
  inputSchema: taskWorkerInputSchema,
  execute: (input) => ({ result: `did ${input.goal}` }),
});

const board = taskBoard({
  name: "echo-board",
  workers: worker,
  initialTasks: [
    { id: "a", goal: "a" },
    { id: "b", goal: "b", deps: ["a"] },
  ],
});
// `board.drain` is a step in a parent sequencer.
```

Reference: [the `orchestration` section of the Flow State API reference](https://flow-state.dev/docs/reference/api/orchestration).
