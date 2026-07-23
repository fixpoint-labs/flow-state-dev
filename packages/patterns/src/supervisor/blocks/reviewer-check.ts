/**
 * `buildReviewedWorker` — wraps a worker block in a per-task review
 * sequencer.
 *
 * The reviewer is composed as a `.step(reviewerGenerator)` step in the
 * worker's own sequencer chain (BP-011 — reviewer is composed, not
 * invoked from inside a handler's `execute`). `applyVerdict` is a
 * pure handler that synchronously decides "throw or return" based on
 * the verdict already produced upstream — no `block.run` calls.
 *
 * Pipeline (per registered worker):
 *
 *   .tap(stashTaskId)         — capture taskId/goal/attempts on inner state
 *   .step(adaptedWorker)       — runs the user's worker (legacy adapter applied)
 *   .tap(stashWorkerOutput)    — capture worker output for applyVerdict
 *                                AND stamp reviewMetadata[taskId].entered=true
 *                                on the supervisor sequencer state
 *   .map(buildReviewerInput)   — adapt workerOutput → ReviewerInput
 *   .step(reviewerGenerator)   — produces ReviewerVerdict
 *   .step(applyVerdict)        — approve flows workerOutput through; reject throws
 *
 * Reviewer audit-state (`entered`, `lastVerdict`) lives on the supervisor
 * sequencer's outer state (`reviewMetadata[taskId]`) — not on the task
 * record's metadata. Keeping reviewer writes off the task collection's
 * mutation queue means the request-shared scope only sees the irreducible
 * claim/complete/fail traffic from `taskBoard`.
 *
 * When `reviewerGenerator` is undefined the wrapper short-circuits and
 * returns `legacyWorkerAdapter(workerBlock)` directly.
 */
import { sequencer, handler } from "@flow-state-dev/core";
import type { BlockDefinition, StateRef } from "@flow-state-dev/core/types";
import { z } from "zod";
import {
  getOrCreateTaskCollection,
  type TaskWorkerInput,
} from "@flow-state-dev/orchestration";
import { reviewerVerdictSchema, type ReviewerInput } from "../schemas";
import { legacyWorkerAdapter } from "./legacy-worker-adapter";

type SupervisorReviewState = {
  reviewMetadata: Record<
    string,
    { entered?: boolean; lastVerdict?: "approve" | "reject" | "needs-revision" }
  >;
};

/** Patch a single `reviewMetadata[taskId]` slot on the supervisor sequencer's
 * outer state without touching sibling slots. The supervisor sequencer is
 * looked up by name; if it can't be found (e.g. the worker is composed
 * outside a supervisor for testing), the write is a silent no-op. */
async function patchSupervisorReviewMetadata(
  target: StateRef<SupervisorReviewState> | undefined,
  taskId: string,
  patch: { entered?: boolean; lastVerdict?: "approve" | "reject" | "needs-revision" },
): Promise<void> {
  if (target === undefined) return;
  await target.atomicState((state) => {
    const previous = state.reviewMetadata?.[taskId] ?? {};
    return {
      reviewMetadata: {
        ...(state.reviewMetadata ?? {}),
        [taskId]: { ...previous, ...patch },
      },
    };
  });
}

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
) {
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

  // Stashes the worker output for `applyVerdict` to read AND stamps
  // `reviewMetadata[taskId].entered = true` on the supervisor sequencer's
  // outer state — the latter lets `labelFailedReviews` distinguish a
  // reviewer rejection from a worker- or reviewer-service error. Writing
  // to the supervisor sequencer (in-memory, lock-serialized) instead of
  // the task collection (request-scoped, CAS-driven) keeps reviewer
  // audit traffic off the shared mutation queue that
  // `claim` / `complete` / `fail` hit.
  const stashWorkerOutput = handler({
    name: `${name}-${workerKey}-stash-output`,
    inputSchema: z.unknown(),
    sequencerStateSchema: reviewedWorkerStateSchema,
    execute: async (workerOutput, ctx) => {
      await ctx.sequencer!.patchState({ workerOutput });
      const taskId = ctx.sequencer!.state.taskId;
      if (taskId !== undefined) {
        await patchSupervisorReviewMetadata(
          ctx.getTarget<SupervisorReviewState>(name),
          taskId,
          { entered: true },
        );
      }
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
  // Stamps `reviewMetadata[taskId].lastVerdict` on the supervisor
  // sequencer state either way so `labelFailedReviews` can detect
  // reviewer rejection on terminal tasks.
  const applyVerdict = handler({
    name: `${name}-${workerKey}-apply-verdict`,
    inputSchema: reviewerVerdictSchema,
    outputSchema: z.unknown(),
    sequencerStateSchema: reviewedWorkerStateSchema,
    execute: async (verdict, ctx) => {
      const { workerOutput, taskId } = ctx.sequencer!.state;
      if (taskId !== undefined) {
        await patchSupervisorReviewMetadata(
          ctx.getTarget<SupervisorReviewState>(name),
          taskId,
          { entered: true, lastVerdict: verdict.decision },
        );
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
      let goal: string | undefined;
      if (taskId !== undefined) {
        const collection = await getOrCreateTaskCollection({
          ctx,
          backing: "request",
          collectionId,
        });
        goal = collection.get(taskId)?.goal;
      }
      ctx.emit.status(
        goal !== undefined ? `Reviewing: ${goal}` : "Reviewing the result",
      );
    },
  });

  return sequencer({
    name: `${name}-${workerKey}-reviewed`,
    stateSchema: reviewedWorkerStateSchema,
  })
    .tap(stashTaskId)
    .step(adaptedWorker)
    .tap(stashWorkerOutput)
    .tap(emitReviewingStatus)
    .map(buildReviewerInput)
    .step(reviewerGenerator)
    .step(applyVerdict);
}
