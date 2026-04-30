/**
 * `buildReviewedWorker` — wraps a worker block in a per-task review
 * sequencer.
 *
 * The reviewer is composed as a `.then(reviewerGenerator)` step in the
 * worker's own sequencer chain (BP-011 — reviewer is composed, not
 * invoked from inside a handler's `execute`). `applyVerdict` is a
 * pure handler that synchronously decides "throw or return" based on
 * the verdict already produced upstream — no `block.run` calls.
 *
 * Pipeline (per registered worker):
 *
 *   .tap(stashTaskId)         — capture taskId/goal/attempts on inner state
 *   .then(adaptedWorker)       — runs the user's worker (legacy adapter applied)
 *   .tap(stashWorkerOutput)    — capture worker output for applyVerdict
 *   .tap(stampReviewEntered)   — set metadata.review.entered for failed-review labelling
 *   .map(buildReviewerInput)   — adapt workerOutput → ReviewerInput
 *   .then(reviewerGenerator)   — produces ReviewerVerdict
 *   .then(applyVerdict)        — approve flows workerOutput through; reject throws
 *
 * When `reviewerGenerator` is undefined the wrapper short-circuits and
 * returns `legacyWorkerAdapter(workerBlock)` directly.
 */
import { sequencer, handler } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z } from "zod";
import {
  getOrCreateTaskCollection,
  type TaskWorkerInput,
} from "@flow-state-dev/tasks";
import { reviewerVerdictSchema, type ReviewerInput } from "../schemas";
import { legacyWorkerAdapter } from "./legacy-worker-adapter";

const reviewedWorkerStateSchema = z.object({
  taskId: z.string().optional(),
  goal: z.string().optional(),
  attempts: z.number().int().nonnegative().optional(),
  workerOutput: z.unknown().optional(),
});

export interface BuildReviewedWorkerOptions {
  name: string;
  workerKey: string;
  workerBlock: BlockDefinition<any, any>;
  reviewerGenerator?: BlockDefinition<any, any>;
  reviewCriteria?: string[];
}

/** Build a per-task reviewed worker. See module doc for pipeline shape. */
export function buildReviewedWorker(
  options: BuildReviewedWorkerOptions,
): BlockDefinition<any, any> {
  const { name, workerKey, workerBlock, reviewerGenerator, reviewCriteria } =
    options;
  const collectionId = name;
  const adaptedWorker = legacyWorkerAdapter(workerBlock);

  if (reviewerGenerator === undefined) return adaptedWorker;

  const stashTaskId = handler({
    name: `${name}-${workerKey}-stash-task`,
    inputSchema: z.unknown(),
    sequencerStateSchema: reviewedWorkerStateSchema,
    execute: async (input, ctx) => {
      const twi = input as TaskWorkerInput;
      await ctx.sequencer!.patchState({
        taskId: twi.taskId,
        goal: twi.goal,
        attempts: typeof twi.attempts === "number" ? twi.attempts : 1,
      });
    },
  });

  const stashWorkerOutput = handler({
    name: `${name}-${workerKey}-stash-output`,
    inputSchema: z.unknown(),
    sequencerStateSchema: reviewedWorkerStateSchema,
    execute: async (workerOutput, ctx) => {
      await ctx.sequencer!.patchState({ workerOutput });
    },
  });

  // `metadata.review.entered = true` lets `labelFailedReviews`
  // distinguish reviewer rejections from worker / reviewer-service errors.
  const stampReviewEntered = handler({
    name: `${name}-${workerKey}-stamp-review-entered`,
    inputSchema: z.unknown(),
    sequencerStateSchema: reviewedWorkerStateSchema,
    execute: async (_input, ctx) => {
      const taskId = ctx.sequencer!.state.taskId;
      if (taskId === undefined) return;
      await getOrCreateTaskCollection({
        ctx,
        backing: "request",
        collectionId,
      }).patchMetadata(taskId, { review: { entered: true } });
    },
  });

  function buildReviewerInput(
    workerOutput: unknown,
    ctx: { sequencer?: { state: z.infer<typeof reviewedWorkerStateSchema> } },
  ): ReviewerInput {
    const state = ctx.sequencer!.state;
    return {
      taskId: state.taskId ?? "",
      goal: state.goal ?? "",
      attempts: state.attempts ?? 1,
      workerOutput,
      ...(reviewCriteria && reviewCriteria.length > 0
        ? { criteria: reviewCriteria }
        : {}),
    };
  }

  // approve → flow upstream workerOutput through; reject/needs-revision
  // → throw so substrate's recordError + maxAttempts handle the retry.
  // Stamps `metadata.review.lastVerdict` either way so
  // `labelFailedReviews` can detect reviewer rejection on terminal tasks.
  const applyVerdict = handler({
    name: `${name}-${workerKey}-apply-verdict`,
    inputSchema: reviewerVerdictSchema,
    outputSchema: z.unknown(),
    sequencerStateSchema: reviewedWorkerStateSchema,
    execute: async (verdict, ctx) => {
      const { workerOutput, taskId } = ctx.sequencer!.state;
      if (taskId !== undefined) {
        await getOrCreateTaskCollection({
          ctx,
          backing: "request",
          collectionId,
        }).patchMetadata(taskId, {
          review: { entered: true, lastVerdict: verdict.decision },
        });
      }
      if (verdict.decision === "approve") return workerOutput;
      throw new Error(
        verdict.feedback ?? `Reviewer ${verdict.decision} the task output`,
      );
    },
  });

  // Surface a clear "now reviewing" status when the worker output is in
  // hand and the reviewer LLM is about to look at it. The earlier
  // claim-time "Working..." status persists through the worker
  // run; this overrides it briefly during review.
  const emitReviewingStatus = handler({
    name: `${name}-${workerKey}-reviewing-status`,  
    inputSchema: z.unknown(),
    sequencerStateSchema: reviewedWorkerStateSchema,
    execute: async (_input, ctx) => {
      const taskId = ctx.sequencer!.state.taskId;
      const goal =
        taskId !== undefined
          ? getOrCreateTaskCollection({
              ctx,
              backing: "request",
              collectionId,
            }).get(taskId)?.goal
          : undefined;
      ctx.emitStatus(
        goal !== undefined ? `Reviewing: ${goal}` : "Reviewing the result",
      );
    },
  });

  return sequencer({
    name: `${name}-${workerKey}-reviewed`,
    stateSchema: reviewedWorkerStateSchema,
  })
    .tap(stashTaskId)
    .then(adaptedWorker)
    .tap(stashWorkerOutput)
    .tap(stampReviewEntered)
    .tap(emitReviewingStatus)
    .map(buildReviewerInput)
    .then(reviewerGenerator)
    .then(applyVerdict) as BlockDefinition<any, any>;
}
