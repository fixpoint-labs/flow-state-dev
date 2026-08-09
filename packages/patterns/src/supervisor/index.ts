/**
 * Supervisor pattern — per-task review on the taskBoard substrate.
 *
 * Each registered worker is wrapped in a
 * `worker → reviewer → applyVerdict` sequencer (BP-011 — reviewer is
 * composed, never invoked from inside a handler's `execute`). On
 * `reject` / `needs-revision` the verdict feedback becomes the thrown
 * error message; the substrate's `recordError` + `maxAttempts`
 * machinery re-pends the task with feedback until the budget is
 * exhausted, then `labelFailedReviews` tags the terminal task.
 *
 * Pipeline:
 *   captureAndPlan → board.drain → cascadeSkipDependents (.tap)
 *   → labelFailedReviews (.tap) → synthesize
 */
import { sequencer, handler, generator, utility } from "@flow-state-dev/core";
import { flowPolicy } from "@flow-state-dev/orchestration";
import type {
  ItemVisibility,
  GeneratorHistoryConfig,
  GeneratorSlot,
  InstructionsSlot,
  SequencerDefinition,
  UsesSlot,
} from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z, type ZodTypeAny } from "zod";
import { taskBoard, createCascadeSkipDependents } from "@flow-state-dev/orchestration/task-board";
import {
  supervisorInputSchema,
  supervisorStateSchema,
  reviewerVerdictSchema,
  reviewerInputSchema,
  type SubTaskErrorStrategy,
  type SupervisorInput,
} from "./schemas";
import { createCaptureAndPlan } from "./blocks/capture-and-plan";
import { resolveGoalSynthesisStep } from "../shared/planning-entry";
import { buildReviewedWorker } from "./blocks/reviewer-check";
import { createSynthesize } from "./blocks/synthesize";
import { createLabelFailedReviews } from "./blocks/label-failed-reviews";

export {
  supervisorInputSchema,
  supervisorStateSchema,
  reviewerVerdictSchema,
  reviewerInputSchema,
  reviewOutputSchema,
  plannerOutputSchema,
  executableTaskSchema,
} from "./schemas";

export type {
  SupervisorInput,
  SupervisorState,
  ReviewOutput,
  PlannerOutput,
  ExecutableTask,
  ReviewerVerdict,
  ReviewerInput,
  SubTaskErrorStrategy,
} from "./schemas";

export { createCaptureAndPlan } from "./blocks/capture-and-plan";
export { buildReviewedWorker } from "./blocks/reviewer-check";
export { createSynthesize } from "./blocks/synthesize";
export { createLabelFailedReviews } from "./blocks/label-failed-reviews";
export { legacyWorkerAdapter } from "./blocks/legacy-worker-adapter";

export interface SupervisorConfig<
  TOutputSchema extends ZodTypeAny = ZodTypeAny,
> {
  name: string;
  /** Single uniform worker. Mutually exclusive with `workers`. */
  worker?: BlockDefinition<any, any>;
  /** Worker registry — `Record<assignee, BlockDefinition>`. */
  workers?: Record<string, BlockDefinition<any, any>>;
  instructions?: InstructionsSlot<SupervisorInput>;
  reviewCriteria?: string[];
  /** Per-task retry budget for review rejection. Default 3. */
  maxAttemptsPerTask?: number;
  /** Worker pool size. Default 3. */
  maxConcurrency?: number;
  /**
   * Creation bounds for the internal board (FIX-931). Defaults 500/100 —
   * unchanged behavior when unset. A planner that legitimately produces more
   * than the enqueue bound would otherwise fail its whole seed with no way to
   * raise the ceiling, so both are reachable here: a number, or `null` for
   * explicitly unbounded on that axis.
   */
  maxTotalTasks?: number | null;
  maxEnqueuedTasks?: number | null;
  /**
   * Cumulative failure retries the internal board may authorize, across every
   * task (FIX-948). Default 50 — a number, or `null` for explicitly unbounded.
   *
   * The two bounds above count only *new* tasks, so a task that keeps failing
   * keeps spending while both sit still. This is the one number that bounds
   * that. At the bound the failing task settles terminal `errored` instead of
   * re-pending, and the board reports `terminationReason:
   * "retry-budget-exhausted"`. `0` means "run every task once, never retry".
   *
   * Reachable here because it BINDS this pattern out of the box:
   * `maxAttemptsPerTask` defaults to 3, so a supervisor board retries by
   * default and a large plan on a flaky day can reach the ceiling
   * legitimately. Without this option the default would be an
   * un-opt-out-able ceiling on an existing pattern.
   */
  maxTotalRetries?: number | null;
  planner?: BlockDefinition<any, any>;
  /** Reviewer block. Pass `false` to disable per-task review entirely. */
  reviewer?: BlockDefinition<any, any> | false;
  synthesizer?: BlockDefinition<any, any>;
  outputSchema?: TOutputSchema;
  onSubTaskError?: SubTaskErrorStrategy;
  context?: GeneratorSlot<any, any>;
  history?: GeneratorHistoryConfig<any, any>;
  uses?: UsesSlot;
  reviewerVisibility?: ItemVisibility;
  synthesizerVisibility?: ItemVisibility;

  // -------------------------------------------------------------------------
  // FIX-827 additions (thin forward to the shared planning-entry layer)
  // -------------------------------------------------------------------------

  /**
   * How each task's `context` is populated when the planner didn't supply
   * one. `"goal"` (default) copies the goal into every gap-task; `false`
   * leaves it empty; a `BlockDefinition` fills per-task context in one call.
   * A planner-emitted `context` always wins.
   */
  taskContext?: "goal" | false | BlockDefinition<any, any>;

  /**
   * Synthesize a self-contained goal from conversation before planning.
   * `false` (default) uses the input goal verbatim; `true` runs a built-in
   * synthesizer; a `BlockDefinition` supplies a custom one.
   */
  synthesizeGoal?: boolean | BlockDefinition<any, any>;
}

/** Default reviewer — generator over `ReviewerInput → ReviewerVerdict`. */
function buildDefaultReviewer(opts: {
  name: string;
  reviewCriteria?: string[];
  itemVisibility?: ItemVisibility;
  context?: GeneratorSlot<any, any>;
  uses?: UsesSlot;
}) {
  const criteriaBlock =
    opts.reviewCriteria && opts.reviewCriteria.length > 0
      ? `\nEvaluation criteria:\n${opts.reviewCriteria
          .map((c, i) => `${i + 1}. ${c}`)
          .join("\n")}`
      : "";
  return generator({
    name: `${opts.name}-reviewer`,
    model: "intent/synthesize",
    inputSchema: reviewerInputSchema,
    outputSchema: reviewerVerdictSchema,
    ...(opts.context !== undefined ? { context: opts.context } : {}),
    ...(opts.uses ? { uses: opts.uses as any } : {}),
    itemVisibility: opts.itemVisibility ?? { client: true, history: false },
    prompt: [
      "You are a quality reviewer in a supervisor workflow.",
      "Evaluate the worker's output and return a verdict:",
      "- 'approve' when the output meets the goal and criteria.",
      "- 'reject' when it must be redone — provide actionable feedback.",
      "- 'needs-revision' when it's close but needs targeted fixes — provide actionable feedback.",
      "When rejecting or requesting revision, ALWAYS include feedback.",
      criteriaBlock || null,
    ],
    user: (input: unknown) =>
      typeof input === "string" ? input : JSON.stringify(input, null, 2),
  });
}

/**
 * Pull `{ title?, url }` entries out of `task.items()` slices, in
 * emission order, deduped by URL. First-title-wins on duplicates —
 * matches the order ordering. Tolerates missing fields and unexpected
 * shapes; renderer-shape guarantees aren't part of the synthesizer's
 * input contract.
 */
function collectUniqueSources(
  resultItems?: Array<{ taskId: string; goal: string; items: unknown[] }>,
): Array<{ url: string; title?: string }> {
  if (resultItems === undefined) return [];
  const out: Array<{ url: string; title?: string }> = [];
  const seen = new Set<string>();
  for (const entry of resultItems) {
    if (!Array.isArray(entry.items)) continue;
    for (const it of entry.items) {
      if (it === null || typeof it !== "object") continue;
      const item = it as { type?: unknown; url?: unknown; title?: unknown };
      if (item.type !== "source") continue;
      if (typeof item.url !== "string" || item.url.length === 0) continue;
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      out.push({
        url: item.url,
        ...(typeof item.title === "string" ? { title: item.title } : {}),
      });
    }
  }
  return out;
}

/** Default synthesizer — combines `{ goal, results }` into a final deliverable. */
function buildDefaultSynthesizer(opts: {
  name: string;
  outputSchema?: ZodTypeAny;
  context?: GeneratorSlot<any, any>;
  history?: GeneratorHistoryConfig<any, any>;
  uses?: UsesSlot;
  instructions?: InstructionsSlot<any>;
  itemVisibility?: ItemVisibility;
}) {
  const basePrompt = [
    "You are the final synthesis step in a supervisor workflow.",
    "Combine the workers' outputs into the FINAL DELIVERABLE the user requested.",
    "Your output IS the end product — not a summary or commentary.",
    "Merge overlapping content and resolve conflicts so the result reads as one unified piece.",
  ].join("\n");
  return generator({
    name: `${opts.name}-synthesizer`,
    model: "intent/synthesize",
    outputSchema: opts.outputSchema ?? z.string(),
    ...(opts.context !== undefined ? { context: opts.context } : {}),
    ...(opts.history !== undefined ? { history: opts.history } : {}),
    ...(opts.uses ? { uses: opts.uses as any } : {}),
    itemVisibility: opts.itemVisibility ?? { client: true, history: true },
    prompt: [opts.instructions, basePrompt],
    user: (input: unknown) => {
      if (typeof input === "string") return input;
      const data = input as {
        goal?: string;
        results?: unknown[];
        resultItems?: Array<{
          taskId: string;
          goal: string;
          items: unknown[];
        }>;
      };
      const parts: string[] = [];
      if (data.goal) parts.push(`Goal: ${data.goal}`);
      if (Array.isArray(data.results)) {
        data.results.forEach((r, i) => {
          parts.push(
            `--- Task ${i + 1} Result ---\n${typeof r === "string" ? r : JSON.stringify(r, null, 2)}`,
          );
        });
      }
      // FIX-480 §3.3: surface `source` items collected by workers so the
      // synthesizer can cite URLs without the LLM repeating them inside
      // structured output. Block is appended only when sources exist —
      // otherwise the prompt is byte-identical to pre-FIX-480.
      const sources = collectUniqueSources(data.resultItems);
      if (sources.length > 0) {
        const lines = sources
          .map((s) => `- ${s.title ? `${s.title}: ` : ""}${s.url}`)
          .join("\n");
        parts.push(`Sources:\n${lines}`);
      }
      return parts.join("\n\n");
    },
  });
}

/** Build a `supervisor` block. See module doc for pipeline shape. */
export function supervisor<TOutputSchema extends ZodTypeAny = ZodTypeAny>(
  config: SupervisorConfig<TOutputSchema>,
): SequencerDefinition<any, any> {
  const {
    name,
    worker,
    workers: workerRegistry,
    reviewCriteria,
    maxAttemptsPerTask = 3,
    maxConcurrency = 3,
    onSubTaskError = "skip",
    context,
    history,
    uses,
    reviewerVisibility,
    synthesizerVisibility,
    instructions,
    outputSchema,
  } = config;

  if (worker === undefined && workerRegistry === undefined) {
    throw new Error(
      `[supervisor] "${name}" requires either \`worker\` or \`workers\``,
    );
  }
  if (onSubTaskError === "retry") {
    console.warn(
      `[flow-state-dev] supervisor "${name}": onSubTaskError="retry" is not supported; ` +
        `treated as "skip". Use \`maxAttemptsPerTask\` for review-driven retries.`,
    );
  }
  const boardOnError: "skip" | "fail" =
    onSubTaskError === "fail" ? "fail" : "skip";

  const resolvedReviewer =
    config.reviewer === false
      ? undefined
      : (config.reviewer ??
        buildDefaultReviewer({
          name,
          reviewCriteria,
          itemVisibility: reviewerVisibility,
          context,
          uses,
        }));

  // Wrap each worker (uniform OR registry entry) in a reviewedWorker chain.
  const reviewedWorkers =
    workerRegistry !== undefined
      ? Object.fromEntries(
          Object.entries(workerRegistry).map(([key, block]) => [
            key,
            buildReviewedWorker({
              name,
              workerKey: key,
              workerBlock: block,
              reviewerGenerator: resolvedReviewer,
              reviewCriteria,
            }),
          ]),
        )
      : buildReviewedWorker({
          name,
          workerKey: "default",
          workerBlock: worker!,
          reviewerGenerator: resolvedReviewer,
          reviewCriteria,
        });

  const activePlanner =
    config.planner ??
    utility.decomposer({
      name: `${name}-planner`,
      ...(context !== undefined ? { context } : {}),
      ...(history !== undefined ? { history } : {}),
    });

  const activeSynthesizer =
    config.synthesizer ??
    buildDefaultSynthesizer({
      name,
      outputSchema,
      context,
      history,
      uses,
      instructions,
      itemVisibility: synthesizerVisibility,
    });

  // Relies on the substrate's default `onIdle: "complete-or-blocked"`
  // (FIX-626) so pendings whose deps `errored` don't deadlock the
  // drain — they get cascade-skipped after instead.
  const board = taskBoard({
    name: `${name}-board`,
    collection: { collectionId: name },
    // Reachable creation bounds (FIX-931): the board enforces them, so a caller
    // who legitimately needs a bigger board must be able to say so. Unset falls
    // through to the 500/100 defaults, and `board.caps` is what the seed writer
    // is handed, so the two can never disagree.
    ...(config.maxTotalRetries !== undefined
      ? { maxTotalRetries: config.maxTotalRetries }
      : {}),
    ...(config.maxTotalTasks !== undefined ? { maxTotalTasks: config.maxTotalTasks } : {}),
    ...(config.maxEnqueuedTasks !== undefined
      ? { maxEnqueuedTasks: config.maxEnqueuedTasks }
      : {}),
    workers: reviewedWorkers,
    concurrency: maxConcurrency,
    dispatcher: "topological",
    onError: boardOnError,
    // FIX-610: pin declaredDepsOnly explicitly. Supervisor workers
    // are reviewed per-task; widening visibility across all tasks
    // would let reviewers attribute reasoning to siblings that the
    // worker never actually consulted.
    flowPolicy: flowPolicy.declaredDepsOnly(),
  });

  const captureAndPlan = createCaptureAndPlan({
    name,
    planner: activePlanner,
    maxAttemptsPerTask,
    ...(config.taskContext !== undefined ? { taskContext: config.taskContext } : {}),
    // The board's bounds, so the planner's seed writes through a capped ref
    // rather than a second uncapped one over the same ledger (FIX-931).
    caps: board.caps,
  });

  // FIX-827: optional goal synthesis at the pipeline top (before
  // `stampOuterGoal`) so the synthesized goal reaches the outer state the
  // synthesizer reads, as well as the planner.
  const synthesizeGoalStep = resolveGoalSynthesisStep(config.synthesizeGoal, {
    name,
    inputSchema: supervisorInputSchema,
  });
  const cascadeSkipDependents = createCascadeSkipDependents({ name });
  const labelFailedReviews = createLabelFailedReviews({ name });
  const synthesize = createSynthesize({ name, synthesizer: activeSynthesizer });

  // captureAndPlan stamps `goal` on its OWN inner sequencer state — that
  // doesn't reach the outer pipeline's state where synthesize reads from.
  // Mirror the goal here so downstream blocks see it.
  const stampOuterGoal = handler({
    name: `${name}-stamp-outer-goal`,
    inputSchema: supervisorInputSchema,
    sequencerStateSchema: supervisorStateSchema,
    execute: async (input, ctx) => {
      await ctx.sequencer!.patchState({ goal: input.goal });
    },
  });

  // Loosely typed so the optional synthesis prefix can change the chain shape.
  let pipeline: any = sequencer({
    name,
    inputSchema: supervisorInputSchema,
    stateSchema: supervisorStateSchema,
  });
  if (synthesizeGoalStep !== undefined) pipeline = pipeline.step(synthesizeGoalStep);
  return pipeline
    .tap(stampOuterGoal)
    .step(captureAndPlan)
    .step(board.drain)
    .tap(cascadeSkipDependents)
    .tap(labelFailedReviews)
    .step(synthesize) as SequencerDefinition<any, any>;
}
