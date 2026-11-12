# @flow-state-dev/harness-manager

A task-board worker that turns a row into a supervised coding run, with the coding agent as a slot you fill.

```bash
pnpm add @flow-state-dev/harness-manager
```

```ts
import { harnessManager } from "@flow-state-dev/harness-manager";
import { claudeCodeAgent } from "@flow-state-dev/claude-code";

const manager = harnessManager({
  boardCollectionId,
  boardCollection: tasks,
  tenant,
  phase: implementPhase(),
  workspace: { root, sourceRepo, baseRef },
  runTimeoutMs: 30 * 60_000,
  harness: ({ cwd, resume, onSession, onUsage, onActivity }) =>
    claudeCodeAgent({ cwd, resume, onSession, onUsage, onActivity, detached: true, recordWork: true }),
});
```

Reference: [the `harness-manager` section of the Flow State API reference](https://flow-state.dev/docs/reference/api/harness-manager).
