/**
 * InvalidationList — the trader's `invalidationCriteria`: what would kill this
 * trade.
 *
 * It lives in its own module because trade levels appear in TWO places on the
 * Summary (the decision header's trade block, and the trade-levels fallback under
 * an unrenderable price chart) and "what invalidates this" has to travel with
 * them in both. One copy, two call sites — a second inline copy is how one of
 * them silently drifts out of date.
 *
 * Renders nothing when the trader published no criteria: an empty invalidation
 * list is missing signal, not "nothing invalidates this trade" (real-money
 * gate — never assert a judgement the desk did not make).
 */
import type { ReactElement } from "react";
import { LabeledBulletList } from "./labeled-bullet-list";

export type InvalidationListProps = {
  criteria: ReadonlyArray<string> | null;
};

export function InvalidationList({
  criteria,
}: InvalidationListProps): ReactElement | null {
  return <LabeledBulletList label="invalidated if" items={criteria ?? []} />;
}
