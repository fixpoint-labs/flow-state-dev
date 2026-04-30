/**
 * `evaluatePlanProgress` — replan-loop arbiter.
 *
 * Reads the request-scoped TaskCollection (post-drain), increments the
 * outer sequencer's `iteration` counter, and decides whether to
 * `continue` (drain again, useful only after a replan adds fresh work),
 * `complete` (exit the loop), or `replan` (call the configured
 * replanner block next).
 *
 * Two modes:
 *
 * - **`enableReplanning: false` (default)** — `createTaskEvaluator`
 *   returns a synchronous handler. Single-pass: the first invocation
 *   resolves to `complete` once the seeded tasks have drained.
 *
 * - **`enableReplanning: true`** — `createEvaluateProgress` returns a
 *   handler that pre-flights the iteration cap + "no-work-remaining"
 *   shortcut, calls the LLM evaluator only when needed, and emits a
 *   `task-board-meta` extension when the verdict is `"replan"`.
 *
 * Custom evaluators (`config.evaluator`) replace the default but the
 * outer pipeline still consumes the same `{ decision, ... }` shape;
 * see the `evaluatorVerdictSchema` in `../schemas.ts`.
 */
import { handler, generator, sequencer } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z } from "zod";
import { getOrCreateTaskCollection, type Task } from "@flow-state-dev/tasks";
import {
  iterationOutputSchema,
  planAndExecuteStateSchema,
} from "../schemas";
import { TASK_BOARD_META_COMPONENT_TYPE } from "../../task-board/blocks/board-meta";

export const evaluatorOutputSchema = z
  .object({
    decision: z.enum(["continue", "replan", "complete"]),
    reasoning: z.string(),
    tasks: z.array(z.unknown()).optional(),
  })
  .passthrough();

/**
 * Strict variant for the LLM evaluator's `response_format`. OpenAI's
 * structured-output mode requires every JSON-schema property to declare
 * a `type`, which `z.array(z.unknown())` does not (items become `{}`).
 * Spell out a concrete shape for inline-replan tasks so the request
 * passes structured-output validation while preserving the feature.
 */
const llmEvaluatorTaskSchema = z.object({
  id: z.string().optional(),
  goal: z.string(),
  deps: z.array(z.string()).optional(),
});

const llmEvaluatorOutputSchema = z.object({
  decision: z.enum(["continue", "replan", "complete"]),
  reasoning: z.string(),
  tasks: z.array(llmEvaluatorTaskSchema).optional(),
});

/**
 * Preflight output schema for the replanning evaluator pipeline.
 *
 * `skipLLM: true` means the iteration cap was hit and `verdict` carries
 * the synthesised `complete` result; the LLM evaluator must not run.
 * `skipLLM: false` means the LLM evaluator owns the decision and
 * `verdict` is absent.
 */
const evaluatorPreflightSchema = z.discriminatedUnion("skipLLM", [
  z.object({
    skipLLM: z.literal(true),
    verdict: evaluatorOutputSchema,
  }),
  z.object({
    skipLLM: z.literal(false),
  }),
]);

interface DefaultEvaluatorOptions {
  /** Pattern name (also the request collection id). */
  name: string;
  /** Hard iteration cap — preempts the evaluator decision when reached. */
  maxIterations: number;
}

/** True when at least one task is still claimable in the collection. */
function hasExecutableWork(tasks: readonly Task[]): boolean {
  const satisfied = new Set(
    tasks
      .filter(
        (t) => t.status === "completed" || t.status === "cancelled",
      )
      .map((t) => t.id),
  );
  return tasks.some(
    (t) =>
      (t.status === "pending" || t.status === "in_progress") &&
      (t.deps ?? []).every((d) => satisfied.has(d)),
  );
}

/**
 * Default no-LLM evaluator. Increments `iteration`, applies the
 * iteration cap, and resolves to `complete` when no executable tasks
 * remain in the collection.
 */
export function createTaskEvaluator(options: DefaultEvaluatorOptions) {
  const { name, maxIterations } = options;
  const collectionId = name;

  return handler({
    name: `${name}-evaluate`,
    inputSchema: z.unknown(),
    outputSchema: iterationOutputSchema,
    sequencerStateSchema: planAndExecuteStateSchema,
    execute: async (_input, ctx) => {
      const previous = (ctx.sequencer!.state.iteration as number | undefined) ?? 0;
      const iteration = previous + 1;
      await ctx.sequencer!.patchState({ iteration });

      if (iteration >= maxIterations) {
        return { decision: "complete" as const };
      }

      const collection = getOrCreateTaskCollection({
        ctx,
        backing: "request",
        collectionId,
      });
      const tasks = collection.list();

      if (!hasExecutableWork(tasks)) {
        return { decision: "complete" as const };
      }
      return { decision: "continue" as const };
    },
  });
}

/**
 * LLM-backed evaluator. The prompt receives a snapshot of the current
 * collection (id/goal/status/output/error/feedback per task) and the
 * caller's overall goal, and returns a `{ decision, reasoning }`.
 */
export function createLLMEvaluator(options: {
  name: string;
  model?: string;
}): BlockDefinition<any, any> {
  const { name, model } = options;
  const collectionId = name;

  return generator({
    name: `${name}-evaluate-llm`,
    model: model ?? "openai/gpt-5.4-mini",
    outputSchema: llmEvaluatorOutputSchema,
    sequencerStateSchema: planAndExecuteStateSchema,
    prompt: [
      "You are a plan progress evaluator.",
      "Given the current state of a multi-step plan, determine the next action:",
      "- 'continue': more steps remain and the plan is on track",
      "- 'replan': the plan needs adjustment based on results so far (steps failed or goals shifted)",
      "- 'complete': all steps are done or the overall goal has been achieved",
      "Be concise in your reasoning.",
    ].join("\n"),
    user: (_input: unknown, ctx) => {
      const collection = getOrCreateTaskCollection({
        ctx,
        backing: "request",
        collectionId,
      });
      const tasks = collection.list();
      return JSON.stringify(
        {
          goal: ctx.sequencer!.state.goal,
          iteration: ctx.sequencer!.state.iteration,
          tasks: tasks.map((t: Task) => ({
            id: t.id,
            goal: t.goal,
            status: t.status,
            output: t.output,
            error: t.error,
            feedback: t.feedback,
          })),
        },
        null,
        2,
      );
    },
  }) as BlockDefinition<any, any>;
}

export interface CreateEvaluateProgressOptions {
  /** Pattern name (also the request collection id). */
  name: string;
  /** When false → default no-LLM evaluator; when true → wrap LLM evaluator. */
  enableReplanning: boolean;
  /** Hard cap on replan-loop iterations. */
  maxIterations: number;
  /** Model id for the LLM evaluator path. */
  model?: string;
}

/**
 * Build the active evaluator block based on configuration.
 *
 * - `enableReplanning: false` → `createTaskEvaluator` (single handler,
 *   no LLM, no sequencer overhead).
 * - `enableReplanning: true` → a sequencer composition:
 *
 *     `preflight` → `.thenIf(!skipLLM, llmEvaluator)` → `.map(normalize)`
 *     → `.tap(emitReplanningMeta)`
 *
 *   The preflight handler increments `iteration`, applies the
 *   iteration cap, and short-circuits with a synthesised `complete`
 *   verdict when the cap is reached. Otherwise it hands off to the
 *   LLM evaluator. The trailing `.tap()` patches `status: "replanning"`
 *   and emits the `task-board-meta` extension when the verdict is
 *   `"replan"`.
 *
 * The wrapper sequencer intentionally has no `stateSchema` — that lets
 * `ctx.sequencer` resolve to the outer pipeline's state container so
 * the preflight and tap can read/patch `iteration` and `status` on the
 * pipeline state, not a fresh shadow.
 */
export function createEvaluateProgress(
  options: CreateEvaluateProgressOptions,
): BlockDefinition<any, any> {
  if (!options.enableReplanning) {
    return createTaskEvaluator(options) as BlockDefinition<any, any>;
  }

  const llmEvaluator = createLLMEvaluator(options);
  const collectionId = options.name;

  // Step 1: increment iteration, apply the cap, decide whether the LLM
  // must run. Returns a discriminated union so the next step can branch
  // on `skipLLM` without re-reading state.
  const preflight = handler({
    name: `${options.name}-evaluate-preflight`,
    inputSchema: z.unknown(),
    outputSchema: evaluatorPreflightSchema,
    sequencerStateSchema: planAndExecuteStateSchema,
    execute: async (_input, ctx) => {
      const previous =
        (ctx.sequencer!.state.iteration as number | undefined) ?? 0;
      const iteration = previous + 1;
      await ctx.sequencer!.patchState({ iteration });

      if (iteration >= options.maxIterations) {
        return {
          skipLLM: true as const,
          verdict: {
            decision: "complete" as const,
            reasoning: "max iterations reached",
          },
        };
      }

      // In replanning mode the LLM owns the decision even when no
      // pending work remains — `replan` is still a valid verdict. The
      // no-work shortcut applies only in single-pass mode (handled by
      // `createTaskEvaluator`). The cap is the only synchronous guard.
      return { skipLLM: false as const };
    },
  });

  // Step 3: side-effect-only tap. Patches pattern status and emits the
  // `task-board-meta` extension when the resolved verdict is `replan`.
  // Wired with `.tap()` per BP-012 — no `outputSchema`, no return.
  const emitReplanningMeta = handler({
    name: `${options.name}-evaluate-emit-replan`,
    inputSchema: evaluatorOutputSchema,
    sequencerStateSchema: planAndExecuteStateSchema,
    execute: async (verdict, ctx) => {
      if (verdict.decision !== "replan") return;
      await ctx.sequencer!.patchState({ status: "replanning" });
      ctx.emitComponent(
        TASK_BOARD_META_COMPONENT_TYPE,
        { collectionId, status: "replanning" },
        { key: collectionId },
      );
    },
  });

  // Compose. The wrapper sequencer has no `stateSchema` so the inner
  // steps' `ctx.sequencer` resolves up to the outer pipeline's state
  // (where `iteration` and `status` actually live).
  return sequencer({
    name: `${options.name}-evaluate`,
    inputSchema: z.unknown(),
  })
    .then(preflight)
    // The LLM evaluator reads `goal` / `iteration` / `tasks` from `ctx`,
    // not from input — so no input adapter is needed. We just pass the
    // preflight output through; the evaluator ignores it.
    .thenIf((r) => r.skipLLM === false, llmEvaluator)
    // Normalise the union back to the verdict shape the outer pipeline
    // consumes (`{ decision, reasoning, tasks? }`).
    .map((r) => {
      if (typeof r === "object" && r !== null && "skipLLM" in r) {
        // Preflight short-circuit: only `skipLLM: true` reaches here
        // because `skipLLM: false` was replaced by the LLM verdict.
        return (r as { skipLLM: true; verdict: z.infer<typeof evaluatorOutputSchema> }).verdict;
      }
      return r as z.infer<typeof evaluatorOutputSchema>;
    })
    .tap(emitReplanningMeta) as BlockDefinition<any, any>;
}
