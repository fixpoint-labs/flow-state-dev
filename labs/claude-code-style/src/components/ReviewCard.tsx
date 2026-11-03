import type { ReviewDetail, TaskRow } from "../adapter";
import { ReviewHold } from "./flow-state/review-hold";

/**
 * A thread ready for review, said once, with the registry's review card drawn
 * for display only: the composer under it holds Resolve and the request for
 * changes. A coding thread shows its run's commits and the judge's verdict; a
 * thread with no run review (a plain worker's) shows its note instead; a
 * coding thread whose review isn't read yet shows the headline alone rather
 * than the stop's raw prompt.
 */
export function ReviewCard({ task, review }: { task: TaskRow; review: ReviewDetail | undefined }) {
  const note = review === undefined && task.harness === undefined ? task.waitingOn?.prompt : undefined;
  return (
    <div className="mx-3 min-w-0">
      <ReviewHold review={review} prompt={note} />
    </div>
  );
}
