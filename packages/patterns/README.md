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

### Blackboard

Controller-driven multi-agent coordination. Specialist blocks read from and write to a shared workspace resource. An LLM controller reads the blackboard state and decides which specialist to invoke next, in a `.loopBack()` loop.

```typescript
import { blackboard, createBlackboard } from "@flow-state-dev/patterns/blackboard";
```

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

### Drain Pool

Concurrent streaming dispatch over a dynamic, durable queue. N workers pull items from a shared session-resource collection, process them, and loop until drained. Workers can enqueue follow-up items mid-drain. The parent sequencer waits for full completion.

At-least-once semantics (lease-based recovery); callers own idempotency.

```typescript
import { drainPool } from "@flow-state-dev/patterns/drain-pool";

const pool = drainPool({
  name: "jobs",
  item: jobSchema,
  concurrency: 8,
  initialItems: seeds,
  block: ({ enqueue }) =>
    sequencer({ name: "job-body" })
      .then(runJob)
      .tap(enqueue((result) => result.followUps ?? [])),
});

// pool.block plugs into a flow; pool.queue is auto-installed
// as a session resource. Use pool.enqueue externally only for
// pre-drain seeding — mid-drain enqueue must happen inside a
// worker body (see docs for the correctness constraint).
```

**Key exports:** `drainPool`, `createDrainPoolItemSchema`, `drainPoolProjectionSchema`, `drainPoolWorkerStateSchema`, `drainPoolItemMetaSchema`, `createSeedPool`, `createLeaseNext`, `createMarkDoneSuccess`, `createMarkDoneError`, `createCheckPool`, `createEnqueueHelper`

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
| **supervisor** | planner (supervisor LLM), synthesizer | workers (supervisor translates per-task via `context` field), reviewer |
| **blackboard** | controller, synthesizer | specialists (keep their domain roles) |

### Composition rules

- **Additive, not replacing.** `instructions` is prepended before a sub-block's default prompt, never replaces it.
- **Consumer overrides skip injection.** If you provide a custom `controller`, `planner`, or `synthesizer` block, `instructions` is not injected into that override — the override owns its own prompt.
- **Granular hooks compose.** PaE's `executionInstructions` and `synthesizeInstructions` still work: `instructions` comes first, granular ones are appended after.

### Supervisor task `context` field

The supervisor pattern includes a `context` field on tasks (`ExecutableTask`). When `instructions` is provided, the supervisor planner is told to distill relevant parts into each task's `context` field. This keeps `goal` clean (what to do) and `context` separate (how/stance/constraints). Workers receive `{ id, goal, context?, feedback? }`.

## Shared Plan Schema

All plan-oriented patterns (`planAndExecute`, `supervisor`) share a common base schema for interoperability with the `<Plan />` UI component.

```typescript
import {
  BasePlanSchema,
  BasePlanTaskSchema,
  emitPlanSnapshot,
  type BasePlan,
  type BasePlanTask,
} from "@flow-state-dev/patterns";
```

**`BasePlanTask` status vocabulary:**

| Status | Pattern | Meaning |
|---|---|---|
| `pending` | P&E | Queued, not yet started |
| `in_progress` | both | Actively executing |
| `completed` | both | Done successfully |
| `failed` | P&E | Hard failure |
| `skipped` | P&E | Bypassed (dependency not met) |
| `needs-revision` | Supervisor | Quality gate failed |
| `escalated` | Supervisor | Out of scope |

**`emitPlanSnapshot(ctx, plan)`** emits a `ComponentItem` with `component: "plan"` into the chat stream. Both `planAndExecute` and `supervisor` call this automatically. Custom patterns can call it directly:

```typescript
import { emitPlanSnapshot, type BasePlan } from "@flow-state-dev/patterns";

emitPlanSnapshot(ctx, { goal, tasks, status, iteration });
```

Pair with the `<Plan />` component from `@flow-state-dev/ui` — or use `chatAssistantRenderers` which includes it by default.

## Running tests

```bash
pnpm --filter @flow-state-dev/patterns test
```
