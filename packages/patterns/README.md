# @flow-state-dev/patterns

Reference implementations of established AI composition patterns using the @flow-state-dev framework.

Each pattern validates that the framework's block composition model handles a specific class of AI architecture cleanly, and serves as a reusable building block for consumer flows.

## Installation

```bash
pnpm add @flow-state-dev/patterns
```

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

> `parallelTasks` and `planAndExecute` are expressed on the [`goalSeekLoop`](https://flow-state.dev/docs/orchestration/goal-seek-loop) primitive (`parallelTasks` as a single pass, `planAndExecute` as a re-planning loop). Their public factories, config, and output shapes are unchanged.

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

#### Board bounds on the task-board patterns

`parallelTasks`, `planAndExecute`, and `supervisor` each build their own `taskBoard`, and each forwards the board's bounds from its own config:

| Option | Default | What it bounds |
| --- | --- | --- |
| `maxEnqueuedTasks` | `100` | Tasks addable while others are still `pending`. Refreshes as the board drains. |
| `maxTotalTasks` | `500` | Tasks the board may ever hold, terminal ones included. Never refunded. |
| `maxTotalRetries` | `50` | Failure retries the board may authorize, across every task. |

The creation caps take a positive integer or `null` (unbounded). `maxTotalRetries` takes a **nonnegative** integer or `null`, so `0` means "run every task once, never retry". Omission reapplies the default on all three.

At the retry bound the next failing task settles terminal `errored` instead of re-dispatching, and the board's completion item reports `terminationReason: "retry-budget-exhausted"`. `supervisor` reaches it soonest, since its `maxAttemptsPerTask` defaults to `3` and its tasks therefore retry by default:

```typescript
supervisor({
  name: "research-team",
  worker: analyst,
  maxTotalRetries: 1_000,   // or null for no bound
});
```

`eventActors` takes the two creation caps and no retry bound — it builds its task inits directly and never stamps a `maxAttempts`, so its tasks do not retry. Full semantics in the [Task board guide](https://flow-state.dev/docs/orchestration/task-board#bounding-the-retries).

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

### Event Actors

Stigmergic multi-agent coordination via topic subscriptions. Actors declare which entry topics they watch (`type:topic` glob patterns); when a matching entry is emitted, every matching actor's body runs concurrently as a `Task` on the unified substrate. No controller, no central loop. With `reEmit: true`, actor outputs that match the entry shape become new dispatched entries, creating reactive cascades up to `maxDepth`.

```typescript
import { createEventActorsWorkspace, actor, eventActors } from "@flow-state-dev/patterns/eventActors";

const rb = createEventActorsWorkspace({ name: "feedback", entries: entrySchema });

const monitor = actor({
  name: "slack-monitor",
  watch: ["observation:slack.*"],
  block: slackHandler,
});

const system = eventActors({
  name: "feedback",
  workspace: rb,
  actors: [monitor],
});

// Use system.emit in a sequencer to write entries with fan-out
```

**Key exports:** `eventActors`, `actor`, `createEventActorsWorkspace`, `matchTopic`, `compilePattern`, `createAppendEntry`, `normalizeToEntries`

### Task Board

Concurrent drain over a `TaskCollection` with dependency gating and per-task worker routing. Built on the unified Plan/Task substrate (`@flow-state-dev/orchestration`). Up to N workers run in parallel, each task is routed to the worker whose key matches `task.assignee`, and dependencies (`deps[]`) are respected via the topological dispatcher. Workers can enqueue new tasks mid-drain; the loop terminates when the board drains, or when no remaining pending task can be claimed (every pending has a non-`completed` dep — `onIdle: "complete-or-blocked"` default), or when `shouldExit` returns true in `wait` mode.

**Termination modes (`onIdle`)**:

- `"complete-or-blocked"` (default): exit on full drain OR when no `in_progress`/`awaiting_review` task is active and no `pending` task has all deps `completed`. Handles the DAG case where an upstream task errors and downstream pendings can never run.
- `"complete"`: exit only when no `pending`, `in_progress`, or `awaiting_review` tasks remain. Use when a pending task with a non-completed dep is a transient state an external pump will resolve.
- `"wait"`: never auto-exit; defer to a user-supplied `shouldExit` predicate. For long-running session-scoped boards.

The final `task-board-meta` item carries a `terminationReason: "all-completed" | "blocked-by-failures" | "retry-budget-exhausted"` field so callers can tell a clean drain from a dep-blocked exit, or from one the board's retry budget stopped, without inspecting `counts`.

```typescript
import { taskBoard, taskBoardStateSchema } from "@flow-state-dev/orchestration/task-board";

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

// board.drain plugs into a flow as an action; the parent sequencer's
// stateSchema must include taskBoardStateSchema (or the canonical
// Record<string, Task> at the configured stateKey).
```

#### Re-entry across an outer loop

The default backing is request-scoped, so `board.drain` re-entry works out of the box. Omit `collection` (or pass `{ collectionId }` to name it) and the `tasks` record lives on `ctx.request`, surviving every block boundary in the request — including subsequent `board.drain` invocations and adds from a sibling step before the first drain. This is what a replan loop needs: call the board across iterations, add new tasks between rounds, and each drain picks them up.

```typescript
const board = taskBoard({
  name: "replan-board",
  // request-scoped by default; nothing to restate
  // ...workers, dispatcher, etc.
});
```

The board API is identical across backings — request-state exposes the same atomic-state surface — so the mutation calls, retries, and `task-change` emission all work the same. Contention safety is the one place they differ: the state backings are compare-and-swap with retry, while the resource backing serializes writes within one execution context and then persists unconditionally, so it keeps claims exclusive among workers in one process but not across two. For single-invocation, per-call storage, opt into `{ backing: "sequencer", collectionId }`. For a board whose tasks outlive the request, declare a durable collection with `defineTaskCollection({ id, scope, stateSchema })` and pass it as `collection`.

`awaiting_review` is fully supported: standard dispatchers skip it, and the loop counts it as in-flight (resume from `awaiting_review` wakes the loop on the next idle poll). `reviewPolicy`, review UI, and the `tasks.review.requested` topic ship in Wave 2.

Workers are first-class block compositions, not callbacks. The pattern composes them via `.step(workerStep)` inside the worker's sequencer, with `.tap(recordSuccess)` and `.rescue([{ block: recordError }])` handling write-back — no handler wrapping the worker (BP-011). For registries, an internal `utility.keyedRouter` selects per `task.assignee`; each worker is pre-connected with the `Task → TaskWorkerInput` adapter so the router stays a pure key-keyed dispatch (BP-013).

`createCascadeSkipDependents` is a substrate building block consumers `.tap()` after `board.drain`: it transitively cancels any pending task whose deps include an `errored` task (stamping a `"skipped"` label), so dep-blocked pendings reach a terminal status instead of lingering. `planAndExecute` and `supervisor` both wire it this way.

**Key exports:** `taskBoard`, `taskBoardStateSchema`, `taskBoardWorkerStateSchema`, `taskBoardWorkerBodyStateSchema`, `claimResultSchema`, `taskWorkerInputSchema`, `checkBoardOutputSchema`, `createSeedCollection`, `createSelectNextReadyTask`, `createClaimTask`, `buildWorkerStep`, `packWorkerInput`, `createRecordSuccess`, `createRecordError`, `createCheckBoard`, `createCascadeSkipDependents`

### Round Robin

Fixed-roster, deterministic-order turn-taking. Every agent in the roster contributes once per round, in declared order. The loop exits when `maxRounds` is reached or when the optional `terminateWhen(ctx)` predicate returns true. A synthesizer composes the transcript as the terminal step by default; pass `synthesizer: false` to return the raw shape.

```typescript
import { roundRobin } from "@flow-state-dev/patterns/round-robin";

const editorial = roundRobin({
  name: "editorial-review",
  roster: [
    { name: "writer", role: "writer responsible for the original draft" },
    { name: "fact-checker", role: "fact-checker verifying every claim" },
    { name: "copy-editor", role: "copy editor polishing prose and clarity" },
  ],
  maxRounds: 3,
});
```

An optional `referee` runs after every round and audits the round's contributions for argument-quality issues (exaggeration, dismissed counter-arguments, unsupported claims). It returns `{ critique }`, accumulates in outer state as `refereeCritiques`, and the default roster agents render prior critiques into their prompts on subsequent rounds. The referee does **not** control termination.

Override any roster entry by passing a `block`. Per-turn audit records land in a sequencer-backed `TaskCollection` so DevTool sees the timeline. See [Round Robin](https://flow-state.dev/docs/patterns/round-robin) for the full reference.

When two or more `roundRobin()` instances appear in the same sequencer chain, set `accessorKey` to a distinct string on each — the pattern's internal blocks declare the contributions resource under that key, and the framework's resource-merge rejects the same key pointing at different `defineResource()` references. Default is `"contributions"`.

```typescript
const debate = roundRobin({
  name: "p2-debate",
  roster: bullBearRoster,
  contributions: phase2Contributions,
  // accessorKey defaults to "contributions"
});

const risk = roundRobin({
  name: "p4-risk",
  roster: riskRoster,
  contributions: phase4Contributions,
  accessorKey: "p4Contributions", // distinct so debate + risk can coexist
});
```

The final shape (before any synthesizer) is `{ rounds, contributions, refereeCritiques }`.

**Key exports:** `roundRobin`, `createRoundRobinContributions`, `createRosterAgent`, `createRoundRobinReferee`, `createRoundRobinSynthesize`, `createRoundRobinInitContributions`, `createRoundRobinRecordContribution`, `roundRobinInputSchema`, `roundRobinStateSchema`, `roundRobinContributionEntrySchema`, `roundRobinRefereeOutputSchema`, `roundRobinRefereeCritiqueSchema`

### Debate

Multi-round adversarial argumentation with assigned stances and a single judge that runs once at the end. Every debater speaks every round and sees all prior arguments from all debaters. The judge reads the full transcript and returns `{ verdict, winner, reasoning }`. Bias mitigations — name anonymization and per-round argument shuffling for the judge — are on by default.

```typescript
import { debate } from "@flow-state-dev/patterns/debate";

const proCon = debate({
  name: "feature-debate",
  debaters: [
    { name: "advocate", stance: "ship now" },
    { name: "skeptic", stance: "do not ship now" },
  ],
  maxRounds: 2,
});
```

Built on the Round Robin chassis; see that section for the loop substrate. Override any debater by passing a `block`; override the judge or the synthesizer with custom blocks. See [Debate](https://flow-state.dev/docs/patterns/debate) for the full reference, the bias-mitigation toggles, and the documented failure modes.

The pattern also accepts an optional `moderator` block. When provided, the moderator **opens each round** (runs before the round's debaters, right after `incrementRound`). It picks which debaters speak that round, may supply a `briefing` and `newAngle` that those debaters see, and may set `done: true` to make this the final round. The moderator sees the full transcript of all *prior* rounds — the current round's speakers haven't yet argued when the moderator decides. A separate `terminateWhen?: (ctx) => boolean` predicate is available for session-state-driven early exits that don't involve transcript analysis. See the full reference on the [Debate page](https://flow-state.dev/docs/patterns/debate) for the moderator output shape and behavior.

**Key exports:** `debate`, `createDebateTranscript`, `createDebater`, `createJudge`, `createModerator`, `createSynthesize`, `createInitTranscript`, `createRecordArgument`, `formatTranscriptForJudge`, `debateInputSchema`, `debateStateSchema`, `debateContributionEntrySchema`, `debateVerdictSchema`, `debateTranscriptStateSchema`, `debateModeratorOutputSchema`, `debateModeratorDecisionSchema`

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

## Accessing worker output items

Workers emit `message`, `source`, `tool_call`, and `reasoning` items naturally as they run. Synthesizer prompt builders, reviewer input builders, and replanners can read those emissions per-task via `TaskHandle.items()` instead of forcing the worker to pack everything into a structured `outputSchema`.

```typescript
import { getOrCreateTaskCollection } from "@flow-state-dev/orchestration";

// inside a block's async execute(input, ctx):
const collection = await getOrCreateTaskCollection({ ctx, backing: "request", collectionId: "my-plan" });

for (const task of collection.list({ status: "completed" })) {
  const items = task.items();
  const messages = items.filter((i) => i.type === "message");
  const sources = items.filter((i) => i.type === "source");
  const toolCalls = items.filter((i) => i.type === "tool_output");
  const finalText = task.output ?? messages.map((m) => /* join text */ "").join("\n");
  // …feed into your synthesizer's prompt
}
```

The window is `[first claimed, terminal]` for the task's lifecycle. Retries are included in the same window. `task-change` and `task-board-meta` items (substrate scaffolding) are excluded. Returns `[]` when the task has not been claimed.

`supervisor`'s default synthesizer already uses this — the `buildResults` handler returns `resultItems` alongside `results`, and the default user prompt appends a deduped `Sources:` block when `source` items are present in any worker's window. Custom synthesizers receive the same input shape and can ignore the new field if they don't need it.

The contract: workers emit naturally; parents pick what they want. No need to re-pack everything into `outputSchema` for downstream visibility.

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

## Benchmark adapters

`defaultBenchmarkRegistry` maps each comparable pattern to a `BenchmarkAdapter` so the cross-pattern benchmark harness can run them all against the same task suite. The benchmark engine resolves subjects through this lookup without knowing any pattern's internals. See the [Benchmarks docs](https://flow-state.dev/docs/testing/benchmarks).

The v1 roster has six entries:

```typescript
import { defaultBenchmarkRegistry } from "@flow-state-dev/patterns";

// supervisor, plan-and-execute, parallel-tasks, round-robin, debate, routed-specialists
```

Some patterns are intentionally left out of the roster:

- **`task-board`** — the substrate primitive the others compose. `parallel-tasks` is task-board plus a planner and a synthesizer, so benchmarking the board alongside its consumers would double-count the same coordination work. It also returns a `TaskBoardHandle` rather than a synthesized answer.
- **`event-actors`, `rlm`, `response-auditor`** — not `goal → answer` shaped. They don't map cleanly onto a single generic benchmark task and would need bespoke per-task glue (event-actors is event-driven, rlm is context-exploration scaffolding, response-auditor is a post-hoc sidechain over an existing response).

Adding a pattern to the benchmark is one entry. Define its adapter, add it to `defaultBenchmarkRegistry`, and add its name to the `patterns` list in the benchmark definition (`apps/pattern-benchmark/src/benchmark.ts`). No per-pattern harness wiring.

## Running tests

```bash
pnpm --filter @flow-state-dev/patterns test
```
