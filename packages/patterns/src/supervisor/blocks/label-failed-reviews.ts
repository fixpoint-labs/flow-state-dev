/**
 * `labelFailedReviews` — post-drain audit: label every `errored` task
 * by failure category.
 *
 * Heuristic (driven by metadata stamped in `applyVerdict`):
 *   - `metadata.review.lastVerdict ∈ {"reject", "needs-revision"}`
 *     → `"failed-review"`. Reviewer rejected on final attempt.
 *   - `metadata.review.entered === true` AND `lastVerdict` unset
 *     → `"reviewer-error"`. Reviewer step itself threw.
 *   - No review metadata → `"worker-error"`. Worker failed before review.
 *
 * Wired in via `.tap()` per BP-012 (state-mutation only).
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { getOrCreateTaskCollection } from "@flow-state-dev/tasks";

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
      const collection = getOrCreateTaskCollection({
        ctx,
        backing: "request",
        collectionId,
      });
      for (const task of collection.list({ status: "errored" })) {
        const review = (task.metadata as
          | { review?: { entered?: boolean; lastVerdict?: string } }
          | undefined)?.review;
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
