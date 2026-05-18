---
sidebar_position: 10
sidebar_label: "Flow policy"
---

# Flow policy

Flow policy controls what a freshly dispatched Task Board worker knows about work that already happened in the same run. It also enables tool-result memoization so identical tool calls across tasks don't pay the same cost twice.

Both layers ship in `@flow-state-dev/utilities-task-flow` and are wired automatically by `taskBoard` (and by the patterns built on it) when you set the relevant config.

## What it solves

Plan-shaped patterns run a fan of workers against a shared goal. Each worker is its own generator with its own conversation history, which means it has no idea what the worker on the previous task already looked up. A planner decomposes "summarize this repo's release history" into ten tasks; six of them each independently fetch the same `package.json`. Same arguments, same cost, six round trips.

Worse, the second worker has no way to build on the first worker's reasoning. The dependency graph encodes ordering but not knowledge. If Task B is supposed to refine Task A's output, B needs to actually see what A produced and what A tried.

Flow policy gives the board two knobs for this. One layer captures every tool call any worker makes during the run into an observation ledger and lets you choose which of those observations to surface on the next worker's input. The other layer lets a tool block opt into result memoization, so identical calls within the run serve from cache.

## How it works

There are two independent layers.

**Layer A — observation ledger and flow policy.** The board maintains a per-run, in-memory ledger of every tool call made by any worker: tool name, arguments, result (or error), the task that made the call, whether it was a cache hit. Before each dispatch, the board asks the configured `TaskFlowPolicy` to pick a subset of those observations. The selection lands on the new worker's `TaskWorkerInput.priorWork` slot:

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

Workers can consume `observations` directly, render them with `formatPriorWork(priorWork)`, or fall back to ignoring the slot entirely. The board never injects prior work into prompts on its own — surfacing it is the worker's call.

**Layer B — tool-result memoization.** A tool block opts in by declaring `cacheable` on its `BlockConfig`. When the board has caching enabled, identical calls within the configured scope serve from cache. The cached `tool_output` item carries `cached: true` and `cacheAgeMs`; cross-task hits also carry `sourceTask: { collectionId, taskId }` so the DevTool transcript can show where the original call happened.

Identical in-flight calls within the same request coalesce into one execution. Errors are never cached.

## Built-in policies

All policies live on the `flowPolicy` namespace exported from `@flow-state-dev/utilities-task-flow`. The default for every Task Board topology is `flowPolicy.declaredDepsOnly()`.

| Policy | What it selects |
|---|---|
| `flowPolicy.none()` | Nothing. `priorWork.observations` is empty. |
| `flowPolicy.declaredDepsOnly()` | Observations from tasks listed in the new task's `deps`. |
| `flowPolicy.ancestors({ transitive })` | Like `declaredDepsOnly`, optionally walking the dep graph. |
| `flowPolicy.recentTrajectory({ n, maxTokens? })` | The last N observations across all tasks, regardless of deps. |
| `flowPolicy.allCompleted({ maxTokens? })` | Every observation from any currently-completed task. |
| `flowPolicy.compact({ recentN, summarizer? })` | v1 stub: keeps the recent N verbatim. Future iteration routes older observations through a summarizer. |
| `flowPolicy.custom(selectFn)` | Roll your own. |

The common pick for plan-and-execute-shaped work is recent trajectory:

```ts
import { taskBoard } from "@flow-state-dev/patterns";
import { flowPolicy } from "@flow-state-dev/utilities-task-flow";

const board = taskBoard({
  name: "research",
  worker: researchWorker,
  flowPolicy: flowPolicy.recentTrajectory({ n: 8 }),
});
```

## Configuring on a board

Both layers are board-level config. Setting either is enough; you can mix and match.

```ts
import { taskBoard } from "@flow-state-dev/patterns";
import { flowPolicy } from "@flow-state-dev/utilities-task-flow";

const board = taskBoard({
  name: "research",
  worker: researchWorker,

  // Layer A: which prior-task observations the next worker sees.
  flowPolicy: flowPolicy.recentTrajectory({ n: 8, maxTokens: 4000 }),

  // Layer B: per-run tool-result memoization.
  toolCache: {
    defaultTtl: 5 * 60 * 1000,   // 5 minutes
    defaultScope: "run",
    maxEntries: 5000,
  },
});
```

Pattern defaults:

- `planAndExecute` pins `flowPolicy.recentTrajectory({ n: 8 })`. Each step sees the last 8 tool observations across the run regardless of declared deps, which matches how the LLM-driven evaluator and replanner think about progress.
- `supervisor` pins `flowPolicy.declaredDepsOnly()`. Each worker is reviewed independently; cross-task chatter would muddle the review surface.
- Bare `taskBoard` defaults to `flowPolicy.declaredDepsOnly()` for every topology.

## Marking tools cacheable

A tool block opts into memoization through `BlockConfig.cacheable`. Pass `true` for defaults, or a config object to tune scope, TTL, key derivation, or a per-call guard:

```ts
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

const readArtifact = handler({
  name: "read-artifact",
  inputSchema: z.object({ key: z.string() }),
  outputSchema: z.object({ content: z.string() }),
  cacheable: { ttl: 60_000 },   // 60 seconds, default "run" scope
  execute: async (input, ctx) => {
    const artifact = await ctx.resources.artifacts.get(input.key);
    return { content: artifact.content };
  },
});
```

The full config shape:

```ts
type BlockCacheableConfig = {
  ttl?: number;                                       // ms; default falls back to store default
  scope?: "run" | "request" | "session";              // default "run"
  keyFn?: (input, ctx) => string;                     // override the cache key
  cacheIf?: (output, input) => boolean;               // skip writing when false
};
```

Scope choices:

- `run` — entries live for the current Task Board run. Reset when the board's outer sequencer completes. This is the default and the safest choice for plan-shaped work.
- `request` — entries live for the lifetime of the request. Useful when several sibling boards within one request might benefit from sharing.
- `session` — entries persist across requests within the same session. Use sparingly; session lifetimes are long and stale entries get hard to reason about.

Errors are never cached. If `execute` throws, no entry is written and the next caller re-runs the block.

**When not to mark a tool cacheable:**

- It mutates state. A write tool should always run.
- Its result depends on time, randomness, or external mutation not captured in `args`. A "get current price" tool will hand back stale prices.
- The cost of being wrong is high. A cached result that's 30 seconds out of date is fine for a config lookup, not fine for a position size.

Cross-task observation flow (Layer A) does not require cacheable tools to be useful — the ledger records every tool call regardless. Caching is a separate optimization.

## Writing a custom policy

`flowPolicy.custom` takes a `select` function with the same signature the built-ins implement:

```ts
import { flowPolicy, type TaskFlowPolicy } from "@flow-state-dev/utilities-task-flow";

const policy: TaskFlowPolicy = flowPolicy.custom(({ task, ledger, collection }) => {
  // Surface observations from declared deps, but also include any
  // errored observations from anywhere in the run — we want the
  // next worker to know what failed.
  const fromDeps = task.deps !== undefined ? ledger.fromTasks(task.deps) : [];
  const errors = ledger.all().filter((o) => o.error !== undefined);
  const combined = [...fromDeps, ...errors];

  return {
    observations: combined.map((o) => ({
      taskId: o.taskId,
      toolName: o.toolName,
      args: o.args,
      ...(o.result !== undefined ? { result: o.result } : {}),
      ...(o.error !== undefined ? { error: o.error } : {}),
      cached: o.cached,
      ts: o.ts,
    })),
    meta: {
      policy: "deps-plus-errors",
      selected: combined.length,
      available: ledger.all().length,
    },
  };
}, "deps-plus-errors");
```

The `ledger` argument is an `ObservationLedgerView` with helpers for the common selection shapes (`recent`, `fromTasks`, `fromAncestors`, `fromCompleted`, `bounded`). Use them when you can — they share the same token-bounding logic the built-in policies use.

## Observability

Both layers surface in the DevTool transcript without extra wiring.

- Cached tool calls get a `cached` badge. Cross-task hits get a `sourceTask` tag pointing at the original task in the same board collection.
- The `priorWork.meta` payload (policy name, selected count, available count, approximate token usage) is visible per dispatch, so you can see which observations were chosen and which were dropped.
- Every tool call still emits its standard `tool_output` item — cache hits don't go silent. They surface as a normal item with `cached: true` on the data.

## When to override the default

| Pattern shape | Recommended policy |
|---|---|
| Plan and Execute (default) | `flowPolicy.recentTrajectory({ n: 8 })` — already pinned |
| Supervisor (default) | `flowPolicy.declaredDepsOnly()` — already pinned |
| Topological / dep-graph fan-out | `flowPolicy.declaredDepsOnly()` or `flowPolicy.ancestors({ transitive: true })` |
| Independent fan-out, no deps | `flowPolicy.none()` — workers shouldn't see each other |
| Long-running coordinator with evolving context | `flowPolicy.recentTrajectory({ n, maxTokens })` |
| Anything where you want the new worker to see everything that's already done | `flowPolicy.allCompleted({ maxTokens })` |

Override sparingly. The default is the default because it's the safe pick — surfacing too much prior work is its own problem (longer prompts, more interference between unrelated reasoning chains). Reach for a different policy when you have a concrete reason.

## See also

- [Plan and Execute](./plan-and-execute) — the default `recentTrajectory({ n: 8 })` pin lives here
- [Supervisor](./supervisor) — defaults to `declaredDepsOnly` so each task's review stays focused
