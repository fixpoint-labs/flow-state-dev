/**
 * How a thread ready for review reads its run's review: the branch shown
 * short, the commit count, and the judge's verdict as one line. Read from the
 * review stop's `data` (`ReviewDetail`), never parsed out of its prompt.
 */
import type { ReviewDetail } from "../adapter";

/** The most characters a branch's last segment keeps before its middle is cut. */
const SEGMENT_KEEP = 24;

/**
 * A branch as a card shows it: its last segment, which names the task and
 * phase. `conductor/t0/ha62…-h01…/t-7f3c--code` reads `…/t-7f3c--code`, and a
 * last segment longer than 24 characters keeps its start and end.
 */
export function shortBranch(branch: string): string {
  const parts = branch.split("/");
  let last = parts[parts.length - 1]!;
  if (last.length > SEGMENT_KEEP) last = `${last.slice(0, 10)}…${last.slice(-(SEGMENT_KEEP - 11))}`;
  return parts.length === 1 ? last : `…/${last}`;
}

/** "1 commit", "3 commits", or that they couldn't be read. */
export function commitCount(review: ReviewDetail): string {
  if (review.commits === null) return "Commits couldn't be read";
  return `${review.commits} commit${review.commits === 1 ? "" : "s"}`;
}

/** "Judge: done, 0.91", or that no judge read the run. */
export function judgeLine(review: ReviewDetail): string {
  if (review.judge === null) return "No judge read this run";
  return `Judge: ${review.judge.verdict}, ${review.judge.confidence.toFixed(2)}`;
}
