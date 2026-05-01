# @flow-state-dev/patterns

Reference implementations of established AI composition patterns using the @flow-state-dev framework.

Each pattern validates that the framework's block composition model handles a specific class of AI architecture cleanly, and serves as a reusable building block for consumer flows.

## Patterns

### RLM (Recursive Language Model)

Implements the Recursive Language Model architecture ([Gao et al. 2025](https://alexzhang13.github.io/blog/2025/rlm/)). An LM that never sees the full context directly — instead using tools to explore, search, and recursively sub-query over large contexts.

**What it validates:**
- Generator-as-tool composition (generator listed in another generator's `tools` array)
- Handler blocks as LLM-callable tools (peek, grep, chunk)
- Session resources for large context storage
- Depth control via tool set restriction (leaf generators omit the recursive tool)

**Zero framework changes required.**

```typescript
import { rlmPipeline, rlmQueryInputSchema, contextResourceStateSchema } from "@flow-state-dev/patterns";

// Wire into your flow as an action
const myFlow = defineFlow({
  actions: {
    rlm: {
      inputSchema: rlmQueryInputSchema,
      block: rlmPipeline
    }
  },
  session: {
    resources: {
      context: { stateSchema: contextResourceStateSchema, writable: true }
    }
  }
});
```

See `apps/kitchen-sink` for a full integration example.

### parallelTasks

Single-pass fan-out/fan-in orchestration backed by `taskBoard`. Decomposes a goal into sub-tasks, dispatches a worker concurrently for each, and synthesizes the completed results. No feedback loop.

`coordinator()` is a deprecated alias — same config shape, emits a one-time deprecation warning.

```typescript
import { parallelTasks } from "@flow-state-dev/patterns";
import { handler } from "@flow-state-dev/core";

const block = parallelTasks({
  name: "research",
  worker: researchWorker,  // receives TaskWorkerInput { taskId, goal, input, ... }
  maxConcurrency: 5,
});
```

**Key exports:** `parallelTasks`, `parallelTasksInputSchema`

### Routed Specialists

Controller-driven multi-agent coordination. Specialist blocks read from and write to a shared writable workspace resource. An LLM controller reads the workspace state and decides which specialist to invoke next, in a `.loopBack()` loop. Per-iteration records live in a `TaskCollection` so the decision sequence is first-class data.

```typescript
import { routedSpecialists, createWorkspace } from "@flow-state-dev/patterns/routedSpecialists";

const workspace = createWorkspace(workspaceSchema);

const pattern = routedSpecialists({
  name: "research",
  workspace,
  specialists: { researcher, analyst, critic },
  maxIterations: 8,
});
```

**Key exports:** `routedSpecialists`, `createWorkspace`, `controllerOutputSchema`

### Reactive Blackboard

Stigmergic multi-agent coordination via write-time fan-out. Actors subscribe to entry topics on a shared resource and react automatically when matching entries are written. No controller, no loop — dispatch happens via `forEachBackground`, and reactions run as background sidechains.

```typescript
import { reactiveBlackboard, actor, mesh } from "@flow-state-dev/patterns/reactive-blackboard";

const rb = reactiveBlackboard({ name: "feedback", entries: entrySchema });

const monitor = actor({
  name: "slack-monitor",
  watch: ["observation:slack.*"],
  body: slackHandler,
});

const system = mesh({
  name: "feedback",
  blackboard: rb,
  actors: [monitor],
});

// Use system.emit in a sequencer to write entries with fan-out
```

**Key exports:** `reactiveBlackboard`, `actor`, `mesh`, `matchTopic`, `compilePattern`, `createAppendEntry`, `createReactiveBlackboard`

### Task Board

Concurrent drain over a `TaskCollection` with dependency gating and per-task worker routing. Built on the unified Plan/Task substrate (`@flow-state-dev/tasks`). Up to N workers run in parallel, each task is routed to the worker whose key matches `task.assignee`, and dependencies (`deps[]`) are respected via the topological dispatcher. Workers can enqueue new tasks mid-drain; the loop terminates when the board drains (or `shouldExit` returns true in `wait` mode).

```typescript
import { taskBoard, taskBoardStateSchema } from "@flow-state-dev/patterns/task-board";

const board = taskBoard({
  name: "research-board",
  collection: { collectionId: "research" },
  concurrency: 3,
  dispatcher: "topological",
  workers: {
    "market-analyst": marketAnalyst,
    "financial-analyst": financialAnalyst,
    synthesizer: synthesizer,
  },
  initialTasks: [
    { id: "m", goal: "market", assignee: "market-analyst" },
    { id: "f", goal: "financial", assignee: "financial-analyst" },
    { id: "s", goal: "synthesize", assignee: "synthesizer", deps: ["m", "f"] },
  ],
});

// board.block plugs into a flow as an action; the parent sequencer's
// stateSchema must include taskBoardStateSchema (or the canonical
// Record<string, Task> at the configured stateKey).
```

#### Re-entry across an outer loop

The default `collection: { collectionId: "..." }` puts the `tasks` record on the board's own sequencer state. That state is per-invocation, so calling `board.block` twice from a parent sequencer produces two independent collections. For boards that need to be re-entered — typically a replan loop that calls `board.block` across iterations and adds new tasks between rounds — opt into the request-scoped backing:

```typescript
const board = taskBoard({
  name: "replan-board",
  collection: { backing: "request", collectionId: "replan-board" },
  // ...workers, dispatcher, etc.
});
```

The collection then lives on `ctx.request` and survives every block boundary in the request, including subsequent `board.block` invocations. CAS semantics are identical to the sequencer-state default — request-state exposes the same atomic-state surface — so contention safety, retries, and `task-change` emission all work the same. Lifetime is the request, not the session; for cross-request boards, use a caller-supplied factory with a session/user/org-scoped resource collection.

`awaiting_review` is fully supported per FIX-443 §10.1: standard dispatchers skip it, and the loop counts it as in-flight (resume from `awaiting_review` wakes the loop on the next idle poll). `reviewPolicy`, review UI, and the `tasks.review.requested` topic ship in Wave 2.

Workers are first-class block compositions, not callbacks. The pattern composes them via `.then(workerStep)` inside the worker's sequencer, with `.tap(recordSuccess)` and `.rescue([{ block: recordError }])` handling write-back — no handler wrapping the worker (BP-011). For registries, an internal `router` selects per `task.assignee` (BP-013, with `connectInput` adapting `Task → TaskWorkerInput` inside the router's `execute`).

**Key exports:** `taskBoard`, `taskBoardStateSchema`, `taskBoardWorkerStateSchema`, `taskBoardWorkerBodyStateSchema`, `claimResultSchema`, `taskWorkerInputSchema`, `checkBoardOutputSchema`, `createSeedCollection`, `createSelectNextReadyTask`, `createClaimTask`, `buildWorkerStep`, `packWorkerInput`, `createRecordSuccess`, `createRecordError`, `createCheckBoard`

## Pattern-Level `instructions`

All three coordination patterns (`planAndExecute`, `supervisor`, `blackboard`) accept an `instructions` prop — a top-level "team brief" that the pattern digests across its internal sub-blocks. This lets consumers apply a role, stance, or set of rules without rebuilding sub-blocks.

```typescript
import { supervisor } from "@flow-state-dev/patterns/supervisor";

const block = supervisor({
  name: "research",
  worker: myWorker,
  instructions: "You are in debate mode. Challenge every claim and demand evidence.",
});
```

`instructions` is a slot: `string | ((input, ctx) => string | Promise<string>)`. Dynamic functions are useful when the instructions depend on session state (e.g., a mode selector):

```typescript
const block = planAndExecute({
  name: "research",
  instructions: (_input, ctx) => {
    const mode = ctx.session.state.mode;
    return mode === "debate" ? DEBATE_PROMPT : ASK_PROMPT;
  },
});
```

### Digestion rules

Each pattern decides which sub-blocks receive `instructions`. The table below shows what receives them and what does not:

| Pattern | Receives `instructions` | Does not receive |
|---------|------------------------|------------------|
| **plan-and-execute** | planner (via context), executor, synthesizer | — |
| **supervisor** | planner, synthesizer | workers (planner can pass per-task `context`), reviewer |
| **blackboard** | controller, synthesizer | specialists (keep their domain roles) |

### Composition rules

- **Additive, not replacing.** `instructions` is prepended before a sub-block's default prompt, never replaces it.
- **Consumer overrides skip injection.** If you provide a custom `controller`, `planner`, or `synthesizer` block, `instructions` is not injected into that override — the override owns its own prompt.
- **Granular hooks compose.** PaE's `executionInstructions` and `synthesizeInstructions` still work: `instructions` comes first, granular ones are appended after.

### Supervisor task `context` field

The supervisor planner may include a `context` field on each task (alongside `id`, `goal`, `deps`, `assignee`). The pattern stamps that string onto the seeded `TaskInit.input`, so workers receive it as `TaskWorkerInput.input`. Use it for per-task stance/constraint guidance distilled from overall `instructions`.

Pre-migration workers that declared the legacy `executableTaskSchema` (input shape `{ id, goal, context?, feedback? }`) keep working — `legacyWorkerAdapter` translates `TaskWorkerInput → ExecutableTask` transparently.

## Task Progress Rendering

`planAndExecute` and `supervisor` emit `task-change` (per-task lifecycle) and `task-board-meta` (board-level aggregate) `ComponentItem`s via the `taskBoard` substrate. Pair with `<TaskPlan />` from `@flow-state-dev/ui` for rendering.

```typescript
// In your UI registry or renderer setup:
import { TaskPlan } from "@flow-state-dev/ui/task-plan";

// Bind to the pattern's collectionId (same as config.name by default):
<TaskPlan collectionId="my-plan" />
```

### Deprecated type exports

`BasePlanSchema`, `BasePlanTaskSchema`, and the `BasePlan` / `BasePlanTask` / `PlanMeta` / `PlanTaskUpdate` types remain exported for backward compatibility. They are not used by the patterns internally.

```typescript
import {
  BasePlanSchema,
  BasePlanTaskSchema,
  type BasePlan,
  type BasePlanTask,
} from "@flow-state-dev/patterns";
```

The `emitPlanMeta`, `emitTaskUpdate`, and `emitPlanSnapshot` runtime helpers have been retired. Patterns that tracked tasks via those helpers should migrate to `taskBoard`.

## Running tests

```bash
pnpm --filter @flow-state-dev/patterns test
```
