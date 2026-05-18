# @flow-state-dev/utilities-task-flow

Substrate utilities for shaping how information flows through plan-shaped Task Board patterns (Plan & Execute, Supervisor, Coordinator, bare `taskBoard`).

Two independent layers, each opt-in via Task Board config:

- **Tool-result memoization** — per-tool `BlockConfig.cacheable` opt-in plus a board-level `toolCache` config. Identical calls within a configured scope serve from cache; identical in-flight calls in the same request coalesce into one execution. Errors are never cached.
- **Task flow policy** — a board-level observation ledger plus a `TaskFlowPolicy` that picks which prior-task observations the next worker sees on its `TaskWorkerInput.priorWork` slot.

The user-facing guide lives at [`apps/docs/docs/patterns/flow-policy.md`](../../apps/docs/docs/patterns/flow-policy.md). This README documents the package's exported API surface.

## Tool cache

### Marking a tool cacheable

A handler (or any block kind that runs as a tool) declares `cacheable` on its config:

```ts
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

const readArtifact = handler({
  name: "read-artifact",
  inputSchema: z.object({ key: z.string() }),
  outputSchema: z.object({ content: z.string() }),
  cacheable: { ttl: 60_000 },
  execute: async (input, ctx) => {
    const artifact = await ctx.resources.artifacts.get(input.key);
    return { content: artifact.content };
  },
});
```

Shorthand `cacheable: true` uses store defaults. Full config:

```ts
type BlockCacheableConfig = {
  ttl?: number;                                       // ms; 0 disables; falls back to store default (5 min)
  scope?: "run" | "request" | "session";              // default "run"
  keyFn?: (input, ctx) => string;                     // override the default JSON-shape key
  cacheIf?: (output, input) => boolean;               // skip writing the entry when false
};
```

### Enabling the cache on a board

```ts
import { taskBoard } from "@flow-state-dev/patterns";

const board = taskBoard({
  name: "research",
  worker: researchWorker,
  toolCache: {
    defaultTtl: 5 * 60 * 1000,
    defaultScope: "run",
    maxEntries: 5000,
  },
});
```

When the cache is enabled, every tool installed on a worker generator that declares `cacheable` participates. Tools without `cacheable` continue to run uncached.

### Cached `tool_output` shape

A cache hit still emits a normal `tool_output` item — it does not go silent. The item's data carries two extra fields:

- `cached: true`
- `cacheAgeMs: number`

Cross-task hits also carry `sourceTask: { collectionId, taskId }` so the DevTool transcript can link back to the original call.

### Coalescing

Two workers calling the same cacheable tool with identical arguments at the same time share a single in-flight execution. The second caller awaits the first caller's promise. This holds within one request — cross-request coalescing is intentionally out of scope.

## Flow policy

### Built-in policies

All policies live on the `flowPolicy` namespace:

```ts
import { flowPolicy } from "@flow-state-dev/utilities-task-flow";
```

| Policy | What it selects |
| -- | -- |
| `flowPolicy.none()` | Empty observation set. |
| `flowPolicy.declaredDepsOnly()` | Observations from tasks listed in the new task's `deps`. Default for every Task Board topology. |
| `flowPolicy.ancestors({ transitive })` | Declared deps, optionally walking the dep graph. |
| `flowPolicy.recentTrajectory({ n, maxTokens? })` | The last N observations across all tasks regardless of deps. Pinned by `planAndExecute`. |
| `flowPolicy.allCompleted({ maxTokens? })` | Every observation from any currently-completed task. |
| `flowPolicy.compact({ recentN, summarizer? })` | v1 stub: keeps the recent N verbatim. Future iteration routes older observations through a summarizer. |
| `flowPolicy.custom(selectFn, name?)` | Bring your own selection function. |

### Wiring on a board

```ts
import { taskBoard } from "@flow-state-dev/patterns";
import { flowPolicy } from "@flow-state-dev/utilities-task-flow";

const board = taskBoard({
  name: "research",
  worker: researchWorker,
  flowPolicy: flowPolicy.recentTrajectory({ n: 8 }),
});
```

Pattern defaults:

- `planAndExecute` pins `flowPolicy.recentTrajectory({ n: 8 })`.
- `supervisor` pins `flowPolicy.declaredDepsOnly()` explicitly.
- Bare `taskBoard` defaults to `flowPolicy.declaredDepsOnly()` for every topology.

### `TaskPriorWork`

The board materializes the selection onto each worker's `TaskWorkerInput.priorWork`:

```ts
interface TaskPriorWork {
  observations: ReadonlyArray<{
    taskId?: string;
    toolName: string;
    args: unknown;
    result?: unknown;
    error?: string;
    cached: boolean;
    ts: number;
  }>;
  narrative?: string;
  meta?: {
    policy: string;
    selected: number;
    available: number;
    tokensApprox?: number;
  };
}
```

Workers read the slot directly, render it with the exported `formatPriorWork(priorWork)` helper, or ignore it. The board never injects prior work into prompts on its own.

### Custom policies

```ts
import { flowPolicy, type TaskFlowPolicy } from "@flow-state-dev/utilities-task-flow";

const policy: TaskFlowPolicy = flowPolicy.custom(({ task, ledger }) => {
  const fromDeps = task.deps !== undefined ? ledger.fromTasks(task.deps) : [];
  const errors = ledger.all().filter((o) => o.error !== undefined);
  const combined = [...fromDeps, ...errors];
  return {
    observations: combined.map((o) => ({ ...o })),
    meta: { policy: "deps-plus-errors", selected: combined.length, available: ledger.all().length },
  };
}, "deps-plus-errors");
```

The `ledger` argument is an `ObservationLedgerView` with helpers (`recent`, `fromTasks`, `fromAncestors`, `fromCompleted`, `bounded`) that share the same token-bounding logic the built-ins use.

## Capability install for non-board use

Both layers are also exposed as capabilities (`createToolCacheCapability`, `createObservationLedgerCapability`) for standalone generators that want either behavior without running under a Task Board. The board wires them automatically when the corresponding config is set; the capability surface is the same one the board uses internally.

## See also

- [Flow policy guide](../../apps/docs/docs/patterns/flow-policy.md) — concepts, observability, when to override defaults.
- `@flow-state-dev/tasks` — the substrate this package extends.
- `@flow-state-dev/patterns` — `taskBoard`, `planAndExecute`, `supervisor` consumers.
