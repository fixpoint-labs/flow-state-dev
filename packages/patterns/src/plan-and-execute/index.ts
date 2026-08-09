/**
 * Plan-and-Execute pattern.
 *
 * Two-phase agentic architecture: a planner LLM decomposes a goal into
 * structured tasks, an executor drains them through a `taskBoard` (one
 * worker by default), and an evaluator decides whether to replan and
 * re-enter the board for another drain.
 *
 * Expressed on the `goalSeekLoop` primitive (FIX-910). The pattern supplies the
 * loop's slots and `goalSeekLoop` assembles the judge-gated drain loop:
 *
 *   seed:      synthesizeGoal? → stampOuterGoal → captureAndPlan
 *   afterDrain: cascadeSkipDependents
 *   judge:     evaluator → (replanner on replan-without-tasks) → Verdict
 *   finalize:  synthesize
 *   onError:   "fail"   (an evaluator throw propagates, as before)
 *
 * The replan branch stays *inside* the judge adapter (not `goalSeekLoop`'s
 * generic `replanner` slot) because P&E's public `replanner` contract is fed the
 * evaluator's full output, which the normalized `Verdict` would drop.
 *
 * The board uses the default request backing (`{ collectionId: name }`)
 * so the same TaskCollection survives across `board.drain` re-entries
 * inside the replan loop. Per-worker concurrency defaults to
 * 1 to preserve the legacy single-stream-per-step semantic; bump
 * `maxConcurrency` to fan out independent steps within a single drain.
 *
 * Output shape is preserved as `{ goal, status, tasks: [{ id, goal,
 * status, result?, error? }], completedSteps, totalSteps }` for
 * pre-migration consumers — see `synthesize.ts` for the substrate →
 * legacy status translation.
 */
import { sequencer, handler, generator, utility } from "@flow-state-dev/core";
import { flowPolicy } from "@flow-state-dev/orchestration";
import type { TaskInit } from "@flow-state-dev/orchestration";
import type {
  ItemVisibility,
  GeneratorHistoryConfig,
  GeneratorSearchConfig,
  GeneratorSlot,
  InstructionsSlot,
  ToolsSlot,
  UsesSlot,
  SequencerDefinition,
} from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z, type ZodTypeAny } from "zod";
import {
  taskBoard,
  createCascadeSkipDependents,
  goalSeekLoop,
  type Verdict,
} from "@flow-state-dev/orchestration/task-board";
import {
  planAndExecuteInputSchema,
  planAndExecuteStateSchema,
  type PlanAndExecuteInput,
  type PlanAndExecuteState,
} from "./schemas";
import { createCaptureAndPlan } from "./blocks/capture-and-plan";
import { resolveGoalSynthesisStep } from "../shared/planning-entry";
import { createEvaluateProgress } from "./blocks/evaluate-progress";
import { createSynthesize, normalizeOutputStatus } from "./blocks/synthesize";

// ---------------------------------------------------------------------------
// Re-exports (schemas + block factories)
// ---------------------------------------------------------------------------

export {
  PlanSchema,
  PlanStepSchema,
  PlanTaskSchema,
  planAndExecuteStateSchema,
  planAndExecuteInputSchema,
  iterationOutputSchema,
  evaluatorVerdictSchema,
} from "./schemas";

export type {
  Plan,
  PlanStep,
  PlanTask,
  PlanAndExecuteState,
  PlanAndExecuteInput,
  IterationOutput,
  EvaluatorVerdict,
} from "./schemas";

export {
  createEvaluateProgress as evaluatePlanProgress,
  createTaskEvaluator,
  createLLMEvaluator,
} from "./blocks/evaluate-progress";

export { createCaptureAndPlan } from "./blocks/capture-and-plan";
export { createApplyReplan } from "./blocks/apply-replan";
// Re-exported from the task-board substrate (its true home, FIX-631) to
// preserve plan-and-execute's public subpath API.
export { createCascadeSkipDependents } from "@flow-state-dev/orchestration/task-board";
export {
  createSynthesize,
  createBuildPlanOutput,
  normalizeOutputStatus,
} from "./blocks/synthesize";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface PlanAndExecuteConfig<
  TOutputSchema extends ZodTypeAny = ZodTypeAny,
> {
  /** Name for this plan-and-execute instance. Required. */
  name: string;

  /** Planner block. Default: `utility.decomposer()`. */
  planner?: BlockDefinition<any, any>;

  /**
   * Worker block. Receives `{ stepId, goal, dependencyResults? }` —
   * the legacy P&E worker contract — by default; the pattern adapts
   * the substrate `TaskWorkerInput` into that shape so existing
   * consumers keep working.
   */
  stepExecutor?: BlockDefinition<any, any>;

  /** Evaluator block. Default: built-in (no-LLM unless `enableReplanning`). */
  evaluator?: BlockDefinition<any, any>;

  /** Replanner block. Invoked when the evaluator returns `decision: "replan"`. */
  replanner?: BlockDefinition<any, any>;

  /** Hard cap on replan-loop iterations. Default: 3. */
  maxIterations?: number;

  /** Whether the LLM evaluator path is active. Default: false. */
  enableReplanning?: boolean;

  /**
   * Final synthesizer. Receives the legacy plan shape and returns the
   * pattern's final output. Pass `false` to disable synthesis (the
   * legacy plan shape is returned directly).
   */
  synthesizer?: BlockDefinition<any, any> | false;

  /** Output schema for the final synthesized result (default synthesizer only). */
  outputSchema?: TOutputSchema;

  /** Model id for default planner / executor / replanner / synthesizer. */
  model?: string;

  // -------------------------------------------------------------------------
  // FIX-447 additions
  // -------------------------------------------------------------------------

  /**
   * Per-task retry budget stamped onto every seeded `TaskInit`. Default
   * `1` — single attempt, no retries (preserves pre-migration behavior).
   */
  maxAttemptsPerTask?: number;

  /**
   * Worker pool size for the underlying `taskBoard`. Default `1`
   * (sequential drain, matching pre-migration semantics). Bump to
   * fan out independent dep-free steps within a single drain.
   */
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
   * Reachable here because `maxAttemptsPerTask` can be raised above its
   * default of 1, at which point this board retries and the budget binds it.
   */
  maxTotalRetries?: number | null;

  // -------------------------------------------------------------------------
  // FIX-827 additions
  // -------------------------------------------------------------------------

  /**
   * How each task's `context` is populated when the planner didn't supply
   * one. `"goal"` (default): copy the (synthesized) goal into every
   * gap-task — free, deterministic, the fix for workers being blind to the
   * data their task needs, and in this mode a planner-emitted `context`
   * always wins (only gaps are filled). `false`: leave context empty
   * (pre-FIX-827 behavior). A `BlockDefinition`: run once over
   * `{ goal, tasks }` to fill per-task context with a cheap model or a
   * deterministic step; the block owns the returned contexts (it should
   * preserve planner-emitted `context` itself if desired).
   */
  taskContext?: "goal" | false | BlockDefinition<any, any>;

  /**
   * Synthesize a self-contained goal from conversation before planning.
   * `false` (default): use the input goal verbatim. `true`: run a built-in
   * history-aware synthesizer so history-dependent requests ("now do that
   * for all of them") plan, replan, and synthesize against a coherent
   * objective. A `BlockDefinition`: supply a custom synthesizer.
   */
  synthesizeGoal?: boolean | BlockDefinition<any, any>;

  // -------------------------------------------------------------------------
  // Shared defaults — applied to default blocks only.
  // -------------------------------------------------------------------------

  /** Overall instructions for the pipeline. Composes with executionInstructions / synthesizeInstructions. */
  instructions?: InstructionsSlot<PlanAndExecuteInput>;
  /** Context slot applied to all default blocks. */
  context?: GeneratorSlot<any, any>;
  /** History slot applied to default planner and synthesizer. */
  history?: GeneratorHistoryConfig<any, any>;
  /** Tools assigned to default blocks. */
  tools?: ToolsSlot;
  /** Web search applied to default executor. */
  search?: boolean | GeneratorSearchConfig;
  /** Instructions appended to the default executor's prompt. */
  executionInstructions?: string;
  /** Instructions appended to the default synthesizer's prompt. */
  synthesizeInstructions?: string;

  /** Capabilities to install on default blocks. */
  uses?: UsesSlot;
  /** Item visibility for default planner. Default: `{ client: true, history: false }`. */
  plannerVisibility?: ItemVisibility;
  /** Item visibility for default executor. Default: `{ client: true, history: false }`. */
  stepExecutorVisibility?: ItemVisibility;
  /** Item visibility for default synthesizer. Default: `{ client: true, history: true }`. */
  synthesizerVisibility?: ItemVisibility;
  /** Resources declared on the default executor. */
  resources?: Record<string, any>;
}

// ---------------------------------------------------------------------------
// Default replanner
// ---------------------------------------------------------------------------

/** Output schema for the default replanner generator — the new tasks to add. */
export const replannerOutputSchema = z.object({
  tasks: z.array(
    z.object({
      id: z.string(),
      goal: z.string(),
      deps: z.array(z.string()).default([]),
    }),
  ),
});

function createDefaultReplanner(config: {
  name: string;
  model?: string;
  context?: GeneratorSlot<any, any>;
  history?: GeneratorHistoryConfig<any, any>;
  tools?: ToolsSlot;
  uses?: UsesSlot;
}) {
  return generator({
    name: `${config.name}-replanner`,
    activeStatusMessage: "Adjusting the plan",
    model: config.model ?? "openai/gpt-5.4-mini",
    ...(config.context !== undefined ? { context: config.context } : {}),
    ...(config.history !== undefined ? { history: config.history } : {}),
    ...(config.tools !== undefined ? { tools: config.tools as any } : {}),
    ...(config.uses ? { uses: config.uses as any } : {}),
    outputSchema: replannerOutputSchema,
    sequencerStateSchema: planAndExecuteStateSchema,
    search: true,
    prompt: [
      "You are a plan replanner.",
      "Given the current plan state with completed, failed, and pending tasks,",
      "generate an updated list of remaining tasks to achieve the original goal.",
      "Each task must have a unique id and clear goal.",
      "Only output the NEW tasks that should be added; do not repeat completed work.",
    ].join("\n"),
    user: (_input: unknown, ctx) => {
      // The replanner reads the goal from outer state and the per-task
      // status snapshot from the request collection — same source the
      // evaluator and synthesizer consult, so all three see one
      // canonical view of progress.
      return JSON.stringify(
        { goal: ctx.sequencer!.state.goal ?? "" },
        null,
        2,
      );
    },
  });
}

// ---------------------------------------------------------------------------
// Default executor + legacy worker adapter
// ---------------------------------------------------------------------------

/** Output schema for the default executor generator — a task finding. */
export const executorOutputSchema = z.object({
  summary: z.string(),
  success: z.boolean(),
  reason: z.string().default(""),
  sources: z
    .array(
      z.object({
        title: z.string().default(""),
        url: z.string(),
      }),
    )
    .default([]),
});

/**
 * Build the default executor — a research generator returning
 * `{ summary, success, reason?, sources? }`.
 *
 * Input schema is the legacy `{ stepId, goal, dependencyResults? }`
 * shape. The substrate `TaskWorkerInput` is adapted by
 * `wrapWorkerForLegacyContract` below.
 */
function createDefaultExecutor(config: PlanAndExecuteConfig<any>) {
  const basePrompt = [
    "You are a focused task executor completing one step of a larger plan.",
    "Produce the complete result this step requires. Match the depth to the task: show full working for calculations or logic, give the full text for a draft, critique, or spec, list every item for an enumeration. Be concise only when the step is genuinely simple.",
    "Most steps — reasoning, math, critique, planning, writing — are answered directly from your own knowledge. When a step needs external or current facts and web search is available to you, use it and record the sources; otherwise answer directly and leave sources empty.",
    "If prior task results are provided, build directly on them — reuse their conclusions and sources rather than redoing upstream work.",
    "Return a JSON object with:",
    "- summary: the complete result of this step — the actual answer or work, not a description of it",
    "- success: true if you completed the step, false only if it genuinely could not be done",
    "- reason: (only if success is false) a brief explanation",
    "- sources: an array of { title?, url } objects, one entry per web source you actually relied on. Leave it an empty array for steps answered without external lookup — never invent sources.",
  ].join("\n");

  return generator({
    name: `${config.name}-executor`,
    model: config.model ?? "intent/synthesize",
    inputSchema: z.object({
      stepId: z.string(),
      goal: z.string(),
      context: z.string().optional(),
      dependencyResults: z.record(z.unknown()).optional(),
    }),
    outputSchema: executorOutputSchema,
    ...(config.context !== undefined ? { context: config.context } : {}),
    ...(config.tools !== undefined ? { tools: config.tools } : {}),
    ...(config.uses ? { uses: config.uses as any } : {}),
    ...(config.search !== undefined ? { search: config.search } : {}),
    ...(config.resources !== undefined ? { resources: config.resources } : {}),
    prompt: [config.instructions, basePrompt, config.executionInstructions],
    user: (input: { goal: string; context?: string; dependencyResults?: Record<string, unknown> }) => {
      const parts = [`Task: ${input.goal}`];
      // FIX-827: per-task support text (the request slice this task needs).
      if (typeof input.context === "string" && input.context.length > 0) {
        parts.push(`Context: ${input.context}`);
      }
      if (
        input.dependencyResults &&
        Object.keys(input.dependencyResults).length > 0
      ) {
        const sections = Object.entries(input.dependencyResults).map(
          ([depId, r]) => formatDependencyContext(depId, r),
        );
        parts.push(
          `\nContext from prior tasks:\n${sections.join("\n\n---\n\n")}`,
        );
      }
      return parts.join("\n");
    },
    itemVisibility: config.stepExecutorVisibility ?? { client: true, history: false },
  });
}

/**
 * Format a single dep's output as a labeled context block — summary
 * first, then a "Sources used in this task" list when the dep recorded
 * any. Workers reuse the URLs by citing them in their own `sources`
 * array, so links propagate down the task chain without
 * re-discovering.
 */
function formatDependencyContext(depId: string, value: unknown): string {
  if (value === null || value === undefined) {
    return `From ${depId}: (no output)`;
  }
  if (typeof value === "string") {
    return `From ${depId}:\n${value}`;
  }
  if (typeof value !== "object") {
    return `From ${depId}: ${String(value)}`;
  }
  const obj = value as Record<string, unknown>;
  const summary =
    "summary" in obj && typeof obj.summary === "string"
      ? obj.summary
      : JSON.stringify(value);
  const sources = Array.isArray(obj.sources)
    ? (obj.sources as Array<{ title?: string; url: string }>).filter(
        (s) => typeof s?.url === "string" && s.url.length > 0,
      )
    : [];
  const sourceLines = sources
    .map((s) => `- ${s.title ? `${s.title}: ` : ""}${s.url}`)
    .join("\n");
  const sourcesPart =
    sourceLines.length > 0
      ? `\nSources used in this task:\n${sourceLines}`
      : "";
  return `From ${depId}:\n${summary}${sourcesPart}`;
}

/**
 * Adapt a legacy P&E worker (input shape `{ stepId, goal,
 * dependencyResults? }`) to the substrate's `TaskWorkerInput` (shape
 * `{ taskId, goal, deps?, ... }`).
 *
 * Two responsibilities:
 *   - Pre-connect input: substrate `TaskWorkerInput` → legacy shape.
 *   - Throw on `success: false` so the substrate marks the task
 *     `errored`. Without this, soft-failures pass through as
 *     `completed` and downstream cascade-skip never fires.
 *
 * The wrapper is composed as a sequencer (no `block.run` inside
 * handler — BP-011) so the user's worker remains a first-class step.
 */
function wrapWorkerForLegacyContract(
  name: string,
  worker: BlockDefinition<any, any>,
): SequencerDefinition<any, any> {
  // Pre-connect adapts the substrate's TaskWorkerInput to legacy.
  const adapted = worker.connectInput<unknown>((input: unknown) => {
    const obj = input as {
      taskId?: string;
      goal?: string;
      context?: string;
      deps?: Record<string, unknown>;
    };
    return {
      stepId: obj.taskId ?? "",
      goal: obj.goal ?? "",
      // FIX-827: thread per-task context through to the legacy worker contract.
      ...(obj.context !== undefined ? { context: obj.context } : {}),
      ...(obj.deps && Object.keys(obj.deps).length > 0
        ? { dependencyResults: obj.deps }
        : {}),
    };
  });

  // Throw-on-soft-failure. The wrapper sequencer keeps the worker as
  // a first-class step (BP-011) and uses `.tap()` for the soft-fail
  // check (BP-012, no return-input).
  const checkSoftFailure = handler({
    name: `${name}-check-soft-failure`,
    inputSchema: z.unknown(),
    execute: (output) => {
      const obj = output as { success?: unknown; reason?: unknown } | null;
      if (
        obj !== null &&
        typeof obj === "object" &&
        obj.success === false
      ) {
        const reason =
          typeof obj.reason === "string"
            ? obj.reason
            : "Task did not produce a result";
        throw new Error(reason);
      }
    },
  });

  return sequencer({
    name: `${name}-worker-adapted`,
  })
    .step(adapted)
    .tap(checkSoftFailure);
}

// ---------------------------------------------------------------------------
// Synthesizer prompt builder (preserved for backward compat)
// ---------------------------------------------------------------------------

export interface SynthesizerPromptInput {
  goal: string;
  completedSteps: number;
  tasks: Array<{ goal: string; status: string; result?: unknown; error?: string }>;
}

/**
 * Builds the user prompt for a plan synthesizer from completed task
 * results. Exported so custom synthesizers can reuse the same
 * formatting.
 */
export function buildSynthesizerUserPrompt(input: SynthesizerPromptInput): string {
  if (input.completedSteps === 0) {
    const failed = input.tasks.filter((t) => t.status === "failed");
    const firstError = failed[0]?.error ?? "unknown error";
    return [
      `Goal: ${input.goal}`,
      ``,
      `The planned steps did not complete (first error: ${firstError}).`,
      `Answer the goal directly and completely from your own knowledge instead. Produce the full deliverable it asks for — do not mention the failed plan or ask for more input.`,
    ].join("\n");
  }

  const allSources: Array<{ title?: string; url: string }> = [];
  const findings = input.tasks
    .filter((t) => t.status === "completed")
    .map((t, i) => {
      const r = t.result as Record<string, unknown> | null | undefined;
      const summary =
        r && typeof r === "object" && "summary" in r
          ? String(r.summary)
          : JSON.stringify(t.result);
      if (r && typeof r === "object" && Array.isArray(r.sources)) {
        allSources.push(
          ...(r.sources as Array<{ title?: string; url: string }>),
        );
      }
      return `${i + 1}. ${t.goal}\n   ${summary}`;
    })
    .join("\n\n");

  const seen = new Set<string>();
  const uniqueSources = allSources.filter((s) => {
    if (seen.has(s.url)) return false;
    seen.add(s.url);
    return true;
  });
  const sourcesSection =
    uniqueSources.length > 0
      ? `\n\nSources:\n${uniqueSources
          .map((s) => `- ${s.title ? `${s.title}: ` : ""}${s.url}`)
          .join("\n")}`
      : "";

  return `Goal: ${input.goal}\n\nStep results:\n\n${findings}${sourcesSection}`;
}

function createDefaultSynthesizer(config: {
  name: string;
  model?: string;
  context?: GeneratorSlot<any, any>;
  history?: GeneratorHistoryConfig<any, any>;
  tools?: ToolsSlot;
  uses?: UsesSlot;
  instructions?: InstructionsSlot<any>;
  synthesizeInstructions?: string;
  itemVisibility?: ItemVisibility;
}) {
  const basePrompt = [
    "You are producing the final answer to the original goal from the results of a multi-step plan.",
    "Write the complete deliverable the goal asks for, in full: if it asks to solve a problem, give the full solution with its reasoning; if it asks for a plan, recommendation, critique, or spec, produce exactly that, completely.",
    "Integrate the step results into one coherent answer — do not just list or summarize each step.",
    "Preserve the substance the steps produced: keep the actual computations, assignments, arguments, and items rather than abstracting them away.",
    "Only when the steps drew on external sources: cite them inline as Markdown links and end with a 'Sources' section listing just the URLs you relied on, each as '- [Title](URL)'. If the answer used no external sources — as most reasoning, critique, and planning goals do — include no Sources section.",
    "Always produce the best complete answer you can from the available step results. Never say the work could not be completed, and never ask for more input.",
  ].join("\n");

  return generator({
    name: `${config.name}-synthesizer`,
    activeStatusMessage: "Putting it all together",
    model: config.model ?? "openai/gpt-5.4-mini",
    ...(config.context !== undefined ? { context: config.context } : {}),
    ...(config.history !== undefined ? { history: config.history } : {}),
    ...(config.tools !== undefined ? { tools: config.tools } : {}),
    ...(config.uses ? { uses: config.uses as any } : {}),
    inputSchema: z.object({
      goal: z.string(),
      status: z.string().optional(),
      tasks: z.array(
        z.object({
          id: z.string(),
          goal: z.string(),
          status: z.string(),
          result: z.unknown().optional(),
          error: z.string().optional(),
        }),
      ),
      completedSteps: z.number(),
      totalSteps: z.number(),
    }),
    outputSchema: z.string(),
    prompt: [config.instructions, basePrompt, config.synthesizeInstructions],
    user: buildSynthesizerUserPrompt,
    itemVisibility: config.itemVisibility ?? { client: true, history: true },
  });
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a `planAndExecute` block. Composes a `taskBoard` with a
 * planner front and an evaluator/replanner replan-loop, returning a
 * sequencer that drains task work then synthesizes the result.
 */
export function planAndExecute<
  TOutputSchema extends ZodTypeAny = ZodTypeAny,
>(config: PlanAndExecuteConfig<TOutputSchema>): SequencerDefinition<any, any> {
  const {
    name,
    maxIterations = 3,
    enableReplanning = false,
    maxAttemptsPerTask = 1,
    maxConcurrency = 1,
  } = config;

  // ------- Default block resolution -----------------------------------------

  const stepExecutor = config.stepExecutor ?? createDefaultExecutor(config);
  // Always wrap user/default workers so soft-failures throw and the
  // legacy `{ stepId, goal, dependencyResults? }` contract holds.
  const adaptedWorker = wrapWorkerForLegacyContract(name, stepExecutor);

  const plannerContext: GeneratorSlot<any, any> | undefined =
    config.instructions && !config.planner
      ? [
          ...(config.context
            ? Array.isArray(config.context)
              ? config.context
              : [config.context]
            : []),
          async (_input: any, ctx: any) => {
            const resolved =
              typeof config.instructions! === "function"
                ? await config.instructions!(_input, ctx)
                : config.instructions!;
            return resolved
              ? `Overall instructions for this workflow:\n${resolved}`
              : null;
          },
        ]
      : config.context;

  const planner =
    config.planner ??
    utility.decomposer({
      name: `${name}-planner`,
      model: config.model,
      context: plannerContext,
      history: config.history,
    });

  const evaluator =
    config.evaluator ??
    createEvaluateProgress({
      name,
      enableReplanning,
      maxIterations,
      model: config.model,
    });

  const replanner =
    config.replanner ??
    createDefaultReplanner({
      name,
      model: config.model,
      context: config.context,
      history: config.history,
      tools: config.tools,
      uses: config.uses,
    });

  const synthesizer =
    config.synthesizer === false
      ? false
      : (config.synthesizer ??
        createDefaultSynthesizer({
          name,
          model: config.model,
          context: config.context,
          history: config.history,
          tools: config.tools,
          uses: config.uses,
          instructions: config.instructions,
          synthesizeInstructions: config.synthesizeInstructions,
          itemVisibility: config.synthesizerVisibility,
        }));

  // ------- Pattern-specific blocks ------------------------------------------

  // NOTE: `captureAndPlan` is built AFTER the board (below), because its
  // planner-seed step resolves the board's ledger into its own
  // `TaskCollectionRef` and must be handed `board.caps` (FIX-931). Reading the
  // caps off the board rather than restating them keeps one definition.

  // FIX-827: optional goal synthesis. Composed at the pipeline top (before
  // `stampOuterGoal`) so the synthesized goal reaches BOTH the outer state
  // — which the replanner and synthesizer read — and the planner.
  const synthesizeGoalStep = resolveGoalSynthesisStep(config.synthesizeGoal, {
    name,
    inputSchema: planAndExecuteInputSchema,
    model: config.model,
  });

  // Single uniform worker — every task routes through `adaptedWorker`.
  // The substrate's worker registry path requires `task.assignee` which
  // the planner/replanner contracts don't carry, so we stay on the
  // uniform path even when the spec illustration shows a registry.
  //
  // Relies on the substrate's default `onIdle: "complete-or-blocked"`
  // (FIX-626): a pending task whose dep `errored` is never claimable,
  // and the substrate now exits the drain as soon as no claimable work
  // remains. Pendings with `errored` deps get cascade-skipped by
  // `cascadeSkipDependents` after the drain.
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
    workers: adaptedWorker,
    concurrency: maxConcurrency,
    dispatcher: "topological",
    onError: "skip",
    // FIX-610: plan-shaped patterns benefit most from seeing prior
    // tool traffic from anywhere in the run, not just declared deps.
    // A recent-trajectory window (8 by default) is what lets a later
    // step skip re-doing a search an earlier step already ran while
    // staying bounded — callers can override on the underlying
    // taskBoard if they want a stricter policy.
    flowPolicy: flowPolicy.recentTrajectory({ n: 8 }),
  });

  const captureAndPlan = createCaptureAndPlan({
    name,
    planner,
    maxAttemptsPerTask,
    ...(config.taskContext !== undefined ? { taskContext: config.taskContext } : {}),
    // The board's bounds, so the planner's seed writes through a capped ref
    // rather than a second uncapped one over the same ledger (FIX-931).
    caps: board.caps,
  });

  const cascadeSkipDependents = createCascadeSkipDependents({ name });
  const synthesize = createSynthesize({ name, synthesizer });

  // ------- Assemble on goalSeekLoop (FIX-910) ------------------------------

  // captureAndPlan stamps `goal` on its OWN inner sequencer state — that
  // doesn't reach the loop-owner state where the evaluator and synthesize
  // read from. Mirror the goal here so downstream blocks see it. When goal
  // synthesis ran first, the chain value carries the synthesized goal, so
  // this stamps the synthesized goal into the loop state too (FIX-827).
  const stampOuterGoal = handler({
    name: `${name}-stamp-outer-goal`,
    inputSchema: planAndExecuteInputSchema,
    sequencerStateSchema: planAndExecuteStateSchema,
    execute: async (input, ctx) => {
      await ctx.sequencer!.patchState({ goal: input.goal });
    },
  });

  // Seed (the loop's produce step): optional goal synthesis, then stamp the
  // goal, then plan + seed the board. No `stateSchema` here so the inner blocks
  // resolve `ctx.sequencer` up to the loop-owner container (where `goal` lives).
  let seed: any = sequencer({
    name: `${name}-plan`,
    inputSchema: planAndExecuteInputSchema,
  });
  if (synthesizeGoalStep !== undefined) seed = seed.step(synthesizeGoalStep);
  seed = seed.tap(stampOuterGoal).step(captureAndPlan);

  // Judge adapter (a block judge, so it receives the raw drain output directly —
  // preserving a custom evaluator's legacy input): run P&E's evaluator, run
  // P&E's own replanner on a replan-without-tasks (its legacy contract is the
  // evaluator's full output, NOT goalSeekLoop's lossy Verdict), then map to a
  // Verdict. The self-cap reason is keyed on the iteration count both evaluator
  // variants patch: a `complete` at `iteration >= maxIterations` reports
  // `max-iterations`, an earlier `complete` reports `converged`.
  const judgeAdapter = sequencer({ name: `${name}-judge`, inputSchema: z.unknown() })
    .step(evaluator)
    .stepIf(
      (d: unknown) =>
        (d as { decision?: string }).decision === "replan" &&
        !Array.isArray((d as { tasks?: unknown }).tasks),
      replanner,
    )
    .map((out: unknown, ctx): Verdict => {
      const iteration =
        (ctx.sequencer?.state as { iteration?: number } | undefined)?.iteration ?? 0;
      const o = out as { decision?: string; reasoning?: string; tasks?: unknown };
      // The replanner ran — its output is `{ tasks }` with no `decision`.
      if (o.decision === undefined && Array.isArray(o.tasks)) {
        return { decision: "replan", reason: "replan", tasks: o.tasks as TaskInit[] };
      }
      if (o.decision === "complete") {
        return {
          decision: "done",
          reason: iteration >= maxIterations ? "max-iterations" : "converged",
        };
      }
      if (o.decision === "replan") {
        return Array.isArray(o.tasks)
          ? { decision: "replan", reason: "replan", tasks: o.tasks as TaskInit[] }
          : { decision: "replan", reason: "replan" };
      }
      return { decision: "continue", reason: o.reasoning ?? "continue" };
    });

  return goalSeekLoop({
    name,
    inputSchema: planAndExecuteInputSchema,
    stateSchema: planAndExecuteStateSchema,
    board,
    seed,
    afterDrain: cascadeSkipDependents,
    judge: judgeAdapter,
    maxAttemptsPerTask,
    ...(config.taskContext !== undefined ? { taskContext: config.taskContext } : {}),
    maxIterations,
    finalize: synthesize,
    // Parity: today's P&E has no rescue around `.step(evaluator)`, so an
    // evaluator throw must propagate as a request error, not be swallowed as a
    // judge-error termination.
    onError: "fail",
  }) as SequencerDefinition<any, any>;
}
