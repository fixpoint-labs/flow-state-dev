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
 *   captureAndPlan → board.block → cascadeSkipDependents (.tap)
 *   → labelFailedReviews (.tap) → synthesize
 */
import { sequencer, handler, generator, utility } from "@flow-state-dev/core";
import type {
  AgentType,
  GeneratorHistoryConfig,
  GeneratorSlot,
  SequencerDefinition,
  UsesSlot,
} from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z, type ZodTypeAny } from "zod";
import { taskBoard } from "../task-board";
import { createCascadeSkipDependents } from "../plan-and-execute/blocks/cascade-skip-dependents";
import {
  supervisorInputSchema,
  supervisorStateSchema,
  reviewerVerdictSchema,
  reviewerInputSchema,
  type SubTaskErrorStrategy,
} from "./schemas";
import { createCaptureAndPlan } from "./blocks/capture-and-plan";
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

type InstructionsSlot =
  | string
  | ((input: any, ctx: any) => string | Promise<string>);

export interface SupervisorConfig<
  TOutputSchema extends ZodTypeAny = ZodTypeAny,
> {
  name: string;
  /** Single uniform worker. Mutually exclusive with `workers`. */
  worker?: BlockDefinition<any, any>;
  /** Worker registry — `Record<assignee, BlockDefinition>`. */
  workers?: Record<string, BlockDefinition<any, any>>;
  instructions?: InstructionsSlot;
  reviewCriteria?: string[];
  /** Per-task retry budget for review rejection. Default 3. */
  maxAttemptsPerTask?: number;
  /** Worker pool size. Default 3. */
  maxConcurrency?: number;
  planner?: BlockDefinition<any, any>;
  /** Reviewer block. Pass `false` to disable per-task review entirely. */
  reviewer?: BlockDefinition<any, any> | false;
  synthesizer?: BlockDefinition<any, any>;
  outputSchema?: TOutputSchema;
  onSubTaskError?: SubTaskErrorStrategy;
  context?: GeneratorSlot<any, any>;
  history?: GeneratorHistoryConfig<any, any>;
  uses?: UsesSlot;
  reviewerAgentType?: AgentType;
  synthesizerAgentType?: AgentType;
}

/** Default reviewer — generator over `ReviewerInput → ReviewerVerdict`. */
function buildDefaultReviewer(opts: {
  name: string;
  reviewCriteria?: string[];
  agentType?: AgentType;
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
    agentType: opts.agentType ?? "sub",
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
  instructions?: InstructionsSlot;
  agentType?: AgentType;
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
    agentType: opts.agentType ?? "primary",
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
    reviewerAgentType,
    synthesizerAgentType,
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
          agentType: reviewerAgentType,
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
      agentType: synthesizerAgentType,
    });

  // `onIdle: "wait"` + `shouldExit` mirrors plan-and-execute so pendings
  // whose deps `errored` don't deadlock the drain — they get
  // cascade-skipped after instead.
  const board = taskBoard({
    name: `${name}-board`,
    collection: { backing: "request", collectionId: name },
    workers: reviewedWorkers,
    concurrency: maxConcurrency,
    dispatcher: "topological",
    onIdle: "wait",
    onError: boardOnError,
    shouldExit: (collection) => {
      if (
        collection.count({ status: ["in_progress", "awaiting_review"] }) > 0
      )
        return false;
      const pending = collection.list({ status: "pending" });
      if (pending.length === 0) return true;
      const completedIds = new Set(
        collection.list({ status: "completed" }).map((t) => t.id),
      );
      return !pending.some((t) =>
        (t.deps ?? []).every((d) => completedIds.has(d)),
      );
    },
  });

  const captureAndPlan = createCaptureAndPlan({
    name,
    planner: activePlanner,
    maxAttemptsPerTask,
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

  return sequencer({
    name,
    inputSchema: supervisorInputSchema,
    stateSchema: supervisorStateSchema,
  })
    .tap(stampOuterGoal)
    .then(captureAndPlan)
    .then(board.block)
    .tap(cascadeSkipDependents)
    .tap(labelFailedReviews)
    .then(synthesize);
}
