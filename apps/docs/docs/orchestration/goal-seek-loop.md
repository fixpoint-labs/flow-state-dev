---
sidebar_position: 4
sidebar_label: GoalSeekLoop
---

# GoalSeekLoop

GoalSeekLoop is a config-driven loop over a [Task Board](./task-board.md). It keeps re-draining the board until a judge says the goal is reached, or until it hits a mandatory iteration budget. It is the shared shape that Plan & Execute and Parallel Tasks were each hand-wiring on their own.

A "drain" here means one full pass of the board's workers over its pending tasks. A "judge" is any block that looks at the settled board and returns a verdict: keep going, or stop. GoalSeekLoop wires those two together into a loop that always terminates.

## Why a primitive

Several built-in recipes are the same loop underneath: produce some work, drain it, ask "are we done?", and if not, produce more and repeat. Each one used to hand-wire that loop its own way, with its own "keep going vs stop" dialect. Naming the loop once removes the duplication and the per-recipe configuration each dialect forced on skill authors.

Naming a primitive adds a concept to learn. The trade is worth it here: new looping behavior becomes config on one tested block instead of a fresh sequencer, and the recipes that fit collapse onto a single verdict contract.

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

`maxIterations` is mandatory and must be a finite positive integer. It is the hard backstop: the loop can never hang. When the budget is reached without a `done` verdict, the loop **lands** — it emits a termination item with `reason: "max-iterations"` and runs `finalize` over whatever settled, rather than throwing.

:::caution Cost hazard
Each outer iteration is a full board drain plus a judge call. A judge that returns `continue` with no new tasks re-drains a settled board with no progress — burning iterations until the cap. Keep the judge's `continue`/`replan` condition tied to real new work. Stall detection is not built in (see [non-goals](#non-goals)).
:::

## Writing a judge

The `judge` slot is bring-your-own: a block, a sub-sequencer, or an inline function returning a `Verdict`. GoalSeekLoop ships no per-dialect judge factories.

```ts
type Verdict =
  | { decision: "done"; reason: string }
  | { decision: "continue"; reason: string }
  | { decision: "replan"; reason: string; tasks?: TaskInit[] };
```

The three decisions do not collapse. `continue` re-drains existing in-flight work with no new tasks. `replan` adds work — either inline `tasks`, or via the `replanner` slot when the verdict carries none. Only `done` exits.

When your judge already produces some other decision shape, `mapToVerdict` adapts it and fills in a default `reason`, so a decision-only source is never treated as malformed:

```ts
import { mapToVerdict } from "@flow-state-dev/orchestration/task-board";

const verdict = mapToVerdict(evaluatorOutput, {
  decision: (o) => (o.decision === "complete" ? "done" : "continue"),
});
```

An LLM judge is the weakest exit signal — it can flap or hallucinate success — which is exactly why `maxIterations` is non-optional. A "board is empty" judge is nearly tautological as an outer judge (the board's own inner loop already drains to empty), so the real use for a single-pass loop is Parallel Tasks: one drain, then always `done`.

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

The board must be **request- or resource-backed** so its tasks survive across drains. A sequencer- or factory-backed board is rejected when you call `goalSeekLoop()`, as is a looping board (`maxIterations > 1`) whose `initialTasks` carry no stable id. Request backing is the default, so the common case needs no extra configuration.

## How the patterns map onto it

| Pattern | Judge | Iterations |
| --- | --- | --- |
| **Parallel Tasks** | inline always-`done` | one drain (`maxIterations: 1`) |
| **Plan & Execute** | its evaluator, mapped to a `Verdict` | re-plans across drains |
| **Supervisor** | not this — per-task review, a different axis | — |
| **Routed Specialists** | not yet re-expressed | — |

Supervisor's judge runs *inside* each worker as a retry budget, not across the whole board, so it is a different axis and stays as-is. See [Supervisor](../patterns/supervisor.md) for the contrast.

## Stream items

The loop emits one **`goal-seek-loop-termination`** component when it exits, carrying the termination `reason` (`converged`, `max-iterations`, or `judge-error`) and the drain count. It is a distinct component type with its own key, so it never clobbers the board's own completed `task-board-meta` snapshot that renderers scan. Renderers are otherwise unaffected.

## Non-goals

GoalSeekLoop deliberately does not include a composable termination algebra (`.or()`/`.and()`, cost or wall-clock budgets), built-in stall/no-progress detection, or a configurable inner-drain factory. Those are follow-ups if a real need appears; the judge slot plus `maxIterations` covers the shape today.

## See also

- [Task Board](./task-board.md) — the drain substrate GoalSeekLoop loops over.
- [Task Substrate](./task-substrate.md) — the `TaskCollection` underneath.
- [Plan & Execute](../patterns/plan-and-execute.md) — a full re-planning loop expressed on this primitive.
- [Parallel Tasks](../patterns/parallelTasks.md) — a single-pass loop.
