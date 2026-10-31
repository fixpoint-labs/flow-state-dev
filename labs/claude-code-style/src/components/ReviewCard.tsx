import type { ReviewDetail, TaskRow } from "../adapter";
import { commitCount, judgeLine, shortBranch } from "../lib/review";

/** The most commit subjects the card lists; the rest are counted. */
const SUBJECTS_SHOWN = 3;

/**
 * A thread ready for review, said once: a headline, its commits on the branch
 * (shown short, the full name on hover), and the judge's verdict on one small
 * line with its reason under it. A thread with no run review (a plain
 * worker's) shows its note instead; a coding thread whose review isn't read
 * yet shows the headline alone rather than the stop's raw prompt.
 */
export function ReviewCard({ task, review }: { task: TaskRow; review: ReviewDetail | undefined }) {
  const note = review === undefined && task.harness === undefined ? task.waitingOn?.prompt : undefined;
  const more = review === undefined ? 0 : (review.commits ?? review.subjects.length) - Math.min(review.subjects.length, SUBJECTS_SHOWN);
  return (
    <section
      aria-label="Ready for review"
      className="mx-3 min-w-0 border border-success bg-success/10 px-3 py-2 text-sm [overflow-wrap:anywhere]"
    >
      <div className="font-semibold">Ready for review</div>
      {note ? <p className="mt-0.5 text-xs whitespace-pre-wrap">{note}</p> : null}
      {review ? (
        <>
          <div className="mt-0.5 flex min-w-0 flex-wrap gap-x-1 text-xs">
            <span className="shrink-0">{commitCount(review)}</span>
            {review.branch === null ? null : (
              <>
                <span className="shrink-0">on</span>
                <code title={review.branch} data-review-branch className="min-w-0 truncate font-mono [overflow-wrap:normal]">
                  {shortBranch(review.branch)}
                </code>
              </>
            )}
          </div>
          {review.subjects.length > 0 ? (
            <ul className="mt-1 text-xs text-muted-foreground">
              {review.subjects.slice(0, SUBJECTS_SHOWN).map((subject, i) => (
                <li key={i} title={subject} className="truncate [overflow-wrap:normal]">
                  · {subject}
                </li>
              ))}
              {more > 0 ? <li>· and {more} more</li> : null}
            </ul>
          ) : null}
          <div className="mt-1.5 text-xs" data-review-judge>
            <span className="font-semibold">{judgeLine(review)}</span>
            {review.judge ? (
              <p title={review.judge.reason} className="mt-0.5 line-clamp-3 text-muted-foreground">
                {review.judge.reason}
              </p>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
