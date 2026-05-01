---
sidebar_position: 1
---

# Patterns Overview

The framework gives you four block primitives: `handler`, `generator`, `sequencer`, and `router`. Those primitives compose into higher-level building blocks, and those build into full agentic architectures. There are three tiers.

## The architecture hierarchy

```
Primitives → Utility Blocks → Composable Patterns
```

**Primitives** are the raw building blocks. You configure them directly when you need precise control over a single operation: a specific generator prompt, a handler that writes to state, a router that branches on a condition.

**Utility blocks** are single-block factories that wrap primitives into reusable, named capabilities. `utility.decomposer()` returns a generator pre-configured for task decomposition. `utility.summarizer()` returns one for summarization. You still get one block — it just has sensible defaults and a focused API. Some utilities are general-purpose (no adapter required). Others are adapter-driven: they require a provider configuration to connect to an external service.

**Composable patterns** are multi-block factory functions that return a fully wired sequencer. `parallelTasks()` returns a sequencer that handles decomposition, parallel dispatch, and merging. `supervisor()` returns one that adds per-task review with retries on rejection. These aren't single blocks — they're complete agentic workflows, composable within larger pipelines.

The line between utility blocks and composable patterns is clear: utility blocks are single blocks. Patterns are multi-block sequencer compositions.

## When to use each tier

Use **primitives directly** when you're building something specific that doesn't fit a pre-built shape. A custom routing block, a handler with bespoke state logic, a generator with a carefully tuned system prompt.

Use **utility blocks** when you need a standard LLM operation (summarize, decompose, analyze, synthesize) without reinventing the configuration. They're also the right choice inside custom sequencers — use `utility.decomposer()` as the planner step instead of building one from scratch.

Use **composable patterns** when you need a full agentic workflow. These are the right choice for multi-step, multi-agent tasks where you'd otherwise be wiring together decomposition, dispatch, review, and synthesis by hand.

## Utility blocks: general vs. adapter-driven

Most utility blocks work out of the box with any model:

```ts
import { utility } from "@flow-state-dev/core";

const summarize = utility.summarizer({ name: "summarize", granularity: "brief" });
const decompose = utility.decomposer({ name: "plan" });
const analyze = utility.analyzer({ name: "review", criteria: ["completeness", "accuracy"] });
```

A subset — the **strategy blocks** — require an external provider adapter: `searcher`, `retriever`, `networker`, `claimChecker`. These wrap external services (search engines, vector stores, web crawlers, fact-checking APIs) behind a standard block interface. You configure the adapter; the block handles the rest.

See [Core Utilities](./utility-blocks/core) and [Extension Utilities](./utility-blocks/extensions) for the full catalog.

## Composable patterns

The first three patterns use `utility.decomposer` internally to plan work. They differ in their dispatch model and feedback loop:

**Parallel Tasks** — single-pass fan-out/fan-in. Decomposes a goal, runs sub-tasks concurrently, merges results. No review, no loop. Use it when you trust the workers and just need parallel execution. (`coordinator()` is a deprecated alias for the same factory.)

**Supervisor** — fan-out with per-task review. Decomposes, dispatches, reviews each result as it completes, retries on rejection (up to `maxAttemptsPerTask`). Use it when output quality matters and individual results should be corrected, not just skipped.

**Plan and Execute** — sequential step-by-step with adaptive replanning. Plans a dependency-ordered task graph, executes one task at a time, evaluates progress, and optionally replans remaining tasks after each step. Use it when tasks are ordered and depend on each other's results.

**Response Auditor** — post-generation quality audit. Runs one or more analyzers in parallel against an AI response, each producing structured findings with scores, severity, and annotations. Use it when you need to detect bias, hallucination, policy violations, or other quality issues without modifying the response itself.

**Blackboard** — controller-driven multi-agent coordination via a shared workspace. Specialist blocks read from and write to a shared resource. An LLM controller reads the blackboard state and decides which specialist to invoke next, in a loop. Use it for incremental synthesis and directed problem-solving where a "what's next" decision is needed.

**Reactive Blackboard** — stigmergic multi-agent coordination via write-time fan-out. Actors subscribe to entry topics and react automatically when matching entries are written. No controller, no loop. Use it for event-driven systems, continuous monitoring, and broadcast scenarios where coordination is emergent.

**Drain Pool** — concurrent streaming dispatch over a dynamic, durable queue. N workers continuously pull items from a shared session-resource collection, process them, and loop until drained. Workers can enqueue follow-up items mid-drain. The parent sequencer waits for full completion. Bounded concurrency (exactly N workers, not `N^depth`), at-least-once semantics, durable via session resources.

## Pattern selection

```
Do your tasks depend on each other's outputs?
  No → are they parallel?
    Yes → Parallel Tasks (single-pass fan-out)
    No  → Plan and Execute with one task at a time
  Yes → Plan and Execute (dependency-ordered execution)

Do you need quality review on each result?
  Yes → Supervisor (per-task review with retry)
  No  → Parallel Tasks or Plan and Execute

Do you need to audit a generated response for quality issues?
  Yes → Response Auditor (parallel analyzers)
```

More specifically:

- **Single-pass fan-out with parallel workers** → [Parallel Tasks](./parallelTasks)
- **Parallel workers with per-task review and retry-on-rejection** → [Supervisor](./supervisor)
- **Sequential steps with dependency ordering and adaptive replanning** → [Plan and Execute](./plan-and-execute)
- **Post-generation quality audit with pluggable analyzers** → [Response Auditor](./response-auditor)
- **Controller-driven multi-agent workspace (incremental synthesis)** → [Routed Specialists](./routed-specialists)
- **Event-driven multi-agent coordination (broadcast/react)** → [Event Actors](./reactive-blackboard)
- **Concurrent dependency-aware drain over a Task Collection** → [Task Board](./task-board)
- **Complex hierarchical work where steps need their own sub-planning** → Plan and Execute with a Supervisor as the `stepExecutor`

The first three accept a custom `planner` override, so you can swap out `utility.decomposer` for a domain-specific planner if you need tighter control.
