/**
 * `labelFailedReviews` — post-drain audit: label every `errored` task
 * by failure category.
 *
 * Heuristic (driven by reviewer audit-state on the supervisor sequencer's
 * outer state, populated by `stampReviewEntered` / `applyVerdict`):
 *   - `reviewMetadata[taskId].lastVerdict ∈ {"reject", "needs-revision"}`
 *     → `"failed-review"`. Reviewer rejected on final attempt.
 *   - `reviewMetadata[taskId].entered === true` AND `lastVerdict` unset
 *     → `"reviewer-error"`. Reviewer step itself threw.
 *   - No reviewer audit slot → `"worker-error"`. Worker failed before review.
 *
 * Reading from supervisor sequencer state (in-memory, lock-serialized)
 * instead of `task.metadata` keeps reviewer-side audit traffic off the
 * task collection's CAS-driven request scope.
 *
 * Wired in via `.tap()` per BP-012 (state-mutation only).
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { getOrCreateTaskCollection } from "@flow-state-dev/orchestration";

export interface LabelFailedReviewsOptions {
  name: string;
}

/** Build the label-failed-reviews handler. */
export function createLabelFailedReviews(options: LabelFailedReviewsOptions) {
  const { name } = options;
  const collectionId = name;

  return handler({
    name: `${name}-label-failed-reviews`,
    inputSchema: z.unknown(),
    execute: async (_input, ctx) => {
      const collection = await getOrCreateTaskCollection({
        ctx,
        backing: "request",
        collectionId,
      });
      // Look up the supervisor sequencer by name (same approach as
      // reviewer-check) rather than `ctx.sequencer`, so the read still
      // works if this handler is ever wrapped inside another sequencer.
      const supervisorRef = ctx.getTarget<{
        reviewMetadata?: Record<string, { entered?: boolean; lastVerdict?: string }>;
      }>(name);
      const reviewMetadata = supervisorRef?.state.reviewMetadata ?? {};
      for (const task of collection.list({ status: "errored" })) {
        const review = reviewMetadata[task.id];
        const labels = task.labels ?? [];
        const label =
          review?.lastVerdict === "reject" ||
          review?.lastVerdict === "needs-revision"
            ? "failed-review"
            : review?.entered === true
              ? "reviewer-error"
              : "worker-error";
        if (!labels.includes(label)) {
          await collection.addLabel(task.id, label);
        }
      }
    },
  });
}
