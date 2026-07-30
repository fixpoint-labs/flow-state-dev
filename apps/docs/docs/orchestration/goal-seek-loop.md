---
title: GoalSeekLoop
sidebar_position: 4
sidebar_label: GoalSeekLoop
description: A config-driven loop over a task board that re-drains until a judge says the goal is reached, or until a mandatory iteration budget runs out.
---

# GoalSeekLoop

GoalSeekLoop is a config-driven loop over a [task board](./task-board.md). It keeps re-draining the board until a judge says the goal is reached, or until it hits a mandatory iteration budget. Several built-in patterns are the same loop underneath: produce work, drain it, ask whether we're done, repeat. `planAndExecute` and `parallelTasks` are both built on it.

A "drain" here means one full pass of the board's workers over its pending tasks. A "judge" is any block that looks at the settled board and returns a verdict: keep going, or stop. GoalSeekLoop wires those two together into a loop that always terminates.

## The loop

```
seed → drain → judge → (replan) → repeat → finalize
```

- **seed** produces the initial tasks (the "plan") and writes them to the board.
- **drain** runs the board's workers to completion once.
- **judge** returns a `Verdict` over the settled board.
- **replan** adds new work when the judge asks for it.
- the loop repeats from **drain** until the judge says `done`.
- **finalize** synthesizes a result over the settled board.

The loop's `maxIterations` is mandatory and must be a finite positive integer. It counts total drains, and it is the hard backstop: the loop can never hang. When the budget is reached without a `done` verdict, the loop emits a termination item with `reason: "max-iterations"` and runs `finalize` over whatever settled, rather than throwing.

The board has a field of the same name. `taskBoard`'s own `maxIterations` is a per-worker safety cap on a single drain (default 10,000); the loop's is the number of drains. Setting one says nothing about the other.

:::caution Cost hazard
Each outer iteration is a full board drain plus a judge call. A judge that returns `continue` with no new tasks re-drains a settled board with no progress, burning iterations until the cap. Keep the judge's `continue`/`replan` condition tied to real new work. Stall detection is not built in (see [Limits](#limits)).
:::

## Writing a judge

The `judge` slot is a block, a sub-sequencer, or an inline function returning a `Verdict`. You write the judge; there are no built-in judge factories.

```ts
type Verdict =
  | { decision: "done"; reason: string }
  | { decision: "continue"; reason: string }
  | { decision: "replan"; reason: string; tasks?: TaskInit[] };
```

`continue` re-drains existing in-flight work with no new tasks. `replan` adds work, either inline `tasks` or via the `replanner` slot when the verdict carries none. Only `done` exits.

The loop stops by default when the judge throws, returns something that isn't a `Verdict`, or asks to `replan` without producing work (no non-empty `tasks`, no `replanner` configured). It exits with `reason: "judge-error"` and still runs `finalize` over the settled board. Pass `onError: "fail"` to have the failure propagate as a request error instead. A failure in `seed` or in the drain itself always propagates either way.

When your judge already produces some other decision shape, `mapToVerdict` adapts it and fills in a default `reason`, so a decision-only source is never treated as malformed:

```ts
import { mapToVerdict } from "@flow-state-dev/orchestration/task-board";

const verdict = mapToVerdict(evaluatorOutput, {
  decision: (o) => (o.decision === "complete" ? "done" : "continue"),
});
```

An LLM judge can flap or hallucinate success, which makes it the weakest exit signal you can give the loop. A "board is empty" judge is nearly tautological as an outer judge, since the board's own drain already runs until nothing is left. The single-pass shape (one drain, then always `done`) is what `parallelTasks` uses.

## A small example

```ts
import { taskBoard, goalSeekLoop } from "@flow-state-dev/orchestration/task-board";

const board = taskBoard({
  name: "research",
  collection: { collectionId: "research" }, // request-backed (the default)
  workers: researchWorker,
});

const loop = goalSeekLoop({
  name: "research",
  board,
  seed: planResearch, // writes tasks via ctx.cap.research.addTasks(...)
  // Keep draining until nothing failed; otherwise re-drain to retry.
  judge: async ({ collection }) => {
    const failed = collection.list().filter((t) => t.status === "errored");
    return failed.length === 0
      ? { decision: "done", reason: "converged" }
      : { decision: "continue", reason: "retrying failed tasks" };
  },
  maxIterations: 4,
});
```

The board must be **request- or resource-backed** so its tasks survive across drains. `goalSeekLoop()` throws at construction, before anything runs, on a sequencer- or factory-backed board. Request backing is the default, so the common case needs no extra configuration.

It also throws when the loop's `maxIterations` is greater than 1 and the board's `initialTasks` include a task with no `id`: an idless initial task is re-added on every drain. Give each initial task an `id`, or seed through the loop's own `seed` slot. A single-drain loop (`maxIterations: 1`) is unaffected.

## How the patterns map onto it

| Pattern | Judge | Iterations |
| --- | --- | --- |
| `parallelTasks` | inline always-`done` | one drain (`maxIterations: 1`) |
| Plan and Execute | its evaluator, mapped to a `Verdict` | re-plans across drains |
| Supervisor | not this loop; per-task review is a different axis | — |
| `routedSpecialists` | not built on this loop | — |

Supervisor's judge runs *inside* each worker as a retry budget, not across the whole board. See [Supervisor](../patterns/supervisor.md) for the contrast.

## Using a goalSeekLoop as a tool

A `goalSeekLoop` is a block, and [any block can be a tool](../fundamentals/blocks#any-block-can-be-a-tool). Drop one into a generator's `tools:` array and the generator can call the whole loop as a single tool. The loop drains, judges, replans, and finalizes internally; only the finalized result re-enters the generator's conversation history. The per-iteration work (worker outputs, judge verdicts, replan steps) stays out of the caller's history.

A chat agent can reach for a multi-step recipe without being wrapped in one.

```ts
import { goalSeekLoop, taskBoard } from "@flow-state-dev/orchestration/task-board";
import { generator } from "@flow-state-dev/core";
import { z } from "zod";

const board = taskBoard({ name: "research", workers: researchWorker });

const deepResearch = goalSeekLoop({
  name: "deep-research",
  inputSchema: z.object({ question: z.string() }),
  board,
  seed: planQuestions,
  judge: assessCoverage,
  replanner: proposeFollowups,
  maxIterations: 4,
  finalize: synthesizeAnswer,
});

const chatAgent = generator({
  name: "chat-agent",
  model: "openai/gpt-5.4-mini",
  tools: [deepResearch], // callable directly, no wrapper needed
});
```

When the model calls `deep-research`, the framework runs the loop to completion and feeds `finalize`'s projected output back as the tool result. The generator declares the loop's own `inputSchema` as the tool's input, so the model supplies `{ question }` and gets the synthesized answer. Nothing about the board internals leaks in.

A skill can wire this too: register the loop block in the skills catalog and list it under the skill's `allowed-tools`. See [Delegation](../skills/delegation#running-a-board-as-a-tool).

## Stream items

The loop emits one `goal-seek-loop-termination` component when it exits:

```ts
{ collectionId: string; reason: string; iterations: number }
```

`iterations` is the number of drains that ran. `reason` is the terminating verdict's reason: your judge's own string when it returned `done`, `max-iterations` when the budget ran out, or `judge-error` when the judge failed under the default `onError: "skip"`. The item is emitted client- and history-invisible, so it never renders and never enters model history. It's there for tooling reading the live stream.

## Limits

GoalSeekLoop does not include a composable termination algebra (`.or()`/`.and()`, cost or wall-clock budgets), built-in stall or no-progress detection, or a configurable inner-drain factory. Termination is the judge slot plus `maxIterations`.

## See also

- [Task board](./task-board.md) — the drain substrate GoalSeekLoop loops over.
- [Task substrate](./task-substrate.md) — the `TaskCollection` underneath.
- [Plan and Execute](../patterns/plan-and-execute.md) — a full re-planning loop expressed on this primitive.
- [parallelTasks](../patterns/parallelTasks.md) — a single-pass loop.
