# @flow-state-dev/patterns

Composition patterns built on the task board: parallel tasks, plan and execute, supervisor, blackboard.

```bash
pnpm add @flow-state-dev/patterns
```

```ts
import { parallelTasks } from "@flow-state-dev/patterns";

const research = parallelTasks({
  name: "research",
  worker: researchWorker, // receives TaskWorkerInput { taskId, goal, input, ... }
  maxConcurrency: 5,
});
```

Reference: [the `patterns` section of the Flow State API reference](https://flow-state.dev/docs/reference/api/patterns).
