/**
 * A coding run's review stop, read from its session's items: the latest one's
 * detail and id, and the verdict an accept sends. Pure: the items come from
 * the session feed (`src/app/`), and nothing here reaches the server.
 */
import type { OutputItem, SuspensionItem } from "@flow-state-dev/core/items";
import { reviewDetail, type ReviewDetail } from "@flow-state-dev/harness-manager/browser";
import type { ReviewAnswer, ReviewLand } from "../components/flow-state/review-hold";

/**
 * A run's latest review stop, read with harness-manager's browser reader, or
 * undefined before it makes one. The latest wins: a run sent back for changes
 * stops for review again.
 */
export function reviewStopOf(items: readonly OutputItem[]): ReviewDetail | undefined {
  const stop = latestReviewStop(items);
  return (stop && reviewDetail(stop.data)) ?? undefined;
}

/** The latest review stop's item, or undefined before the run makes one. */
const latestReviewStop = (items: readonly OutputItem[]) =>
  [...items].reverse().find((item): item is SuspensionItem => item.type === "suspension" && (item as SuspensionItem).kind === "review");

/**
 * The id of the latest review stop (its `suspensionId`, the id the board's review hold carries): one id per
 * review round. A run sent back, or a landing retried, stops for review again under a new id, which is how
 * the accept tells a new round from the one it answered, and a verdict names the round on screen.
 */
export function reviewStopIdOf(items: readonly OutputItem[]): string | undefined {
  return latestReviewStop(items)?.suspensionId;
}

/**
 * The verdict an accept sends: plain, or naming how the work lands. Without a `land` the key is
 * absent, so a plain accept on a run that can't land reads as it always did. Exported for its tests.
 */
export function acceptOf(land?: ReviewLand): ReviewAnswer {
  return land === undefined ? { verdict: "accepted" } : { verdict: "accepted", land };
}
