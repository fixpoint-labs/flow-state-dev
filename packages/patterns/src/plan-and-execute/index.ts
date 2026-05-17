/**
 * Plan-and-Execute pattern.
 *
 * Two-phase agentic architecture: a planner LLM decomposes a goal into
 * structured tasks, an executor drains them through a `taskBoard` (one
 * worker by default), and an evaluator decides whether to replan and
 * re-enter the board for another drain.
 *
 * Pipeline (post-FIX-447 migration onto the taskBoard substrate):
 *
 *   captureAndPlan
 *     → board.block                   ← loopBack target
 *     → cascadeSkipDependents
 *     → evaluatePlanProgress
 *     → .thenIf(decision === "replan", replanner)
 *     → .thenIf(Array.isArray(tasks), applyReplan)
 *     → .map(d => { decision: d.decision ?? "continue" })
 *     → .loopBack(board.block.name, { when: decision !== "complete" })
 *     → synthesize
 *
 * The board is request-backed (`{ backing: "request", collectionId:
 * name }`) so the same TaskCollection survives across `board.block`
 * re-entries inside the replan loop. Per-worker concurrency defaults to
 * 1 to preserve the legacy single-stream-per-step semantic; bump
 * `maxConcurrency` to fan out independent steps within a single drain.
 *
 * Output shape is preserved as `{ goal, status, tasks: [{ id, goal,
 * status, result?, error? }], completedSteps, totalSteps }` for
 * pre-migration consumers — see `synthesize.ts` for the substrate →
 * legacy status translation.
 */
import { sequencer, handler, generator, utility } from "@flow-state-dev/core";
import type {
  AgentType,
  GeneratorHistoryConfig,
  GeneratorSearchConfig,
  GeneratorSlot,
  ToolsSlot,
  UsesSlot,
  SequencerDefinition,
} from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z, type ZodTypeAny } from "zod";
import { taskBoard } from "../task-board";
import {
  planAndExecuteInputSchema,
  planAndExecuteStateSchema,
  type PlanAndExecuteState,
} from "./schemas";
import { createCaptureAndPlan } from "./blocks/capture-and-plan";
import { createCascadeSkipDependents } from "./blocks/cascade-skip-dependents";
import { createEvaluateProgress } from "./blocks/evaluate-progress";
import { createApplyReplan } from "./blocks/apply-replan";
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
export { createCascadeSkipDependents } from "./blocks/cascade-skip-dependents";
export {
  createSynthesize,
  createBuildPlanOutput,
  normalizeOutputStatus,
} from "./blocks/synthesize";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Resolvable string — static or computed at runtime from input and context. */
type InstructionsSlot = string | ((input: any, ctx: any) => string | Promise<string>);

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

  // -------------------------------------------------------------------------
  // Shared defaults — applied to default blocks only.
  // -------------------------------------------------------------------------

  /** Overall instructions for the pipeline. Composes with executionInstructions / synthesizeInstructions. */
  instructions?: InstructionsSlot;
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
  /** Agent type for default planner. Default: "sub". */
  plannerAgentType?: AgentType;
  /** Agent type for default executor. Default: "sub". */
  stepExecutorAgentType?: AgentType;
  /** Agent type for default synthesizer. Default: "primary". */
  synthesizerAgentType?: AgentType;
  /** Resources declared on the default executor. */
  resources?: Record<string, any>;
}

// ---------------------------------------------------------------------------
// Default replanner
// ---------------------------------------------------------------------------

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
    outputSchema: z.object({
      tasks: z.array(
        z.object({
          id: z.string(),
          goal: z.string(),
          deps: z.array(z.string()).default([]),
        }),
      ),
    }),
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
    "You are a focused task executor.",
    "Given a specific task, produce a substantive finding in 2-4 sentences with specific facts or insights.",
    "Use the web to find information if needed, you have search capabilities available to you.",
    "If prior task results are provided, build directly on that context — reuse their findings and sources rather than re-discovering what an upstream task already established.",
    "Return a JSON object with:",
    "- summary: your substantive finding",
    "- success: true if you found meaningful information, false if the information was unavailable or missing",
    "- reason: (only if success is false) a brief explanation of why the task could not be completed",
    "- sources: list of { title?, url } for the web sources that ACTUALLY informed your summary. Include sources reused from prior tasks if they shaped your answer. Do NOT list every URL the search returned — only the ones you specifically leveraged.",
  ].join("\n");

  return generator({
    name: `${config.name}-executor`,
    model: config.model ?? "intent/synthesize",
    inputSchema: z.object({
      stepId: z.string(),
      goal: z.string(),
      dependencyResults: z.record(z.unknown()).optional(),
    }),
    outputSchema: z.object({
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
    }),
    ...(config.context !== undefined ? { context: config.context } : {}),
    ...(config.tools !== undefined ? { tools: config.tools } : {}),
    ...(config.uses ? { uses: config.uses as any } : {}),
    ...(config.search !== undefined ? { search: config.search } : {}),
    ...(config.resources !== undefined ? { resources: config.resources } : {}),
    prompt: [config.instructions, basePrompt, config.executionInstructions],
    user: (input: { goal: string; dependencyResults?: Record<string, unknown> }) => {
      const parts = [`Task: ${input.goal}`];
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
    agentType: config.stepExecutorAgentType ?? "sub",
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
      deps?: Record<string, unknown>;
    };
    return {
      stepId: obj.taskId ?? "",
      goal: obj.goal ?? "",
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
    .then(adapted)
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
      `No research tasks completed. The plan encountered an error on the first task: ${firstError}`,
      `Downstream tasks were skipped as a result.`,
      `Acknowledge that you were unable to gather findings for this goal and briefly explain why based on the error above.`,
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

  return `Goal: ${input.goal}\n\nFindings:\n\n${findings}${sourcesSection}`;
}

function createDefaultSynthesizer(config: {
  name: string;
  model?: string;
  context?: GeneratorSlot<any, any>;
  history?: GeneratorHistoryConfig<any, any>;
  tools?: ToolsSlot;
  uses?: UsesSlot;
  instructions?: InstructionsSlot;
  synthesizeInstructions?: string;
  agentType?: AgentType;
}) {
  const basePrompt = [
    "You are synthesizing findings from a structured multi-step research process.",
    "Write a clear, direct final answer to the original goal.",
    "Integrate the findings into a coherent narrative — do not just summarize each step.",
    "Be specific and draw on the concrete facts gathered.",
    "When grounding a specific claim in a source, cite it inline as a Markdown link, e.g. [title](https://...). Don't link every sentence — only the ones that actually depend on a source.",
    "End the response with a 'Sources' section listing only the URLs you actually relied on to construct the answer. Do not aggregate every URL that was searched — only the ones that contributed. Format each line as '- [Title](URL)'.",
    "If no findings are available, briefly explain that the research could not be completed and why, without asking the user for more information.",
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
    agentType: config.agentType ?? "primary",
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
          agentType: config.synthesizerAgentType,
        }));

  // ------- Pattern-specific blocks ------------------------------------------

  const captureAndPlan = createCaptureAndPlan({
    name,
    planner,
    maxAttemptsPerTask,
  });

  // Single uniform worker — every task routes through `adaptedWorker`.
  // The substrate's worker registry path requires `task.assignee` which
  // the planner/replanner contracts don't carry, so we stay on the
  // uniform path even when the spec illustration shows a registry.
  //
  // `onIdle: "wait"` + `shouldExit` is a deliberate substitute for
  // `onIdle: "complete"`. With the topological dispatcher, a pending
  // task whose dep `errored` is never claimable but still counts in
  // `inFlightCount`, so the default `complete` mode would spin forever
  // waiting for tasks the dispatcher cannot pick. The custom predicate
  // exits the drain as soon as no claimable work remains — pendings
  // with `errored` deps are then cascade-skipped by
  // `cascadeSkipDependents` after the drain.
  const board = taskBoard({
    name: `${name}-board`,
    collection: { backing: "request", collectionId: name },
    workers: adaptedWorker,
    concurrency: maxConcurrency,
    dispatcher: "topological",
    onIdle: "wait",
    onError: "skip",
    shouldExit: (collection) => {
      // No active workers AND no claimable pending tasks → drain done.
      const active = collection.count({
        status: ["in_progress", "awaiting_review"],
      });
      if (active > 0) return false;

      const pending = collection.list({ status: "pending" });
      if (pending.length === 0) return true;

      const completedIds = new Set(
        collection
          .list({ status: "completed" })
          .map((t) => t.id),
      );
      // A pending task is claimable iff every dep is completed. Note
      // that `errored` and `cancelled` deps make a pending task
      // permanently unclaimable until cascade-skip runs.
      const claimable = pending.some((t) =>
        (t.deps ?? []).every((d) => completedIds.has(d)),
      );
      return !claimable;
    },
  });

  const cascadeSkipDependents = createCascadeSkipDependents({ name });
  const applyReplan = createApplyReplan({ name, maxAttemptsPerTask });
  const synthesize = createSynthesize({ name, synthesizer });

  // ------- Assemble pipeline -----------------------------------------------

  // captureAndPlan stamps `goal` on its OWN inner sequencer state — that
  // doesn't reach the outer pipeline's state where evaluator and synthesize
  // read from. Mirror the goal here so downstream blocks see it.
  const stampOuterGoal = handler({
    name: `${name}-stamp-outer-goal`,
    inputSchema: planAndExecuteInputSchema,
    sequencerStateSchema: planAndExecuteStateSchema,
    execute: async (input, ctx) => {
      await ctx.sequencer!.patchState({ goal: input.goal });
    },
  });

  const pipeline = sequencer({
    name,
    inputSchema: planAndExecuteInputSchema,
    stateSchema: planAndExecuteStateSchema,
  })
    .tap(stampOuterGoal)
    .then(captureAndPlan)
    .then(board.block)
    .tap(cascadeSkipDependents)
    .then(evaluator)
    // Replanner only runs when the evaluator asked for a replan AND
    // didn't pre-bake the new tasks. Pre-baked `tasks` bypasses the
    // LLM call and goes straight to applyReplan.
    .thenIf(
      (d) =>
        (d as { decision?: string }).decision === "replan" &&
        !Array.isArray((d as { tasks?: unknown }).tasks),
      replanner,
    )
    .thenIf(
      (d) => Array.isArray((d as { tasks?: unknown }).tasks),
      applyReplan,
    )
    .map((d) => ({
      decision: (d as { decision?: string }).decision ?? "continue",
    }))
    .loopBack(board.block.name, {
      when: (r) => (r as { decision?: string }).decision !== "complete",
      maxIterations,
    })
    .then(synthesize) as SequencerDefinition<any, any>;

  return pipeline;
}
