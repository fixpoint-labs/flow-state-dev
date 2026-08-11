/**
 * InvalidationList — the trader's `invalidationCriteria`: what would kill this
 * trade.
 *
 * It lives in its own module because trade levels appear in TWO places on the
 * Summary (the decision header's trade line, and the trade-levels fallback under
 * an unrenderable price chart) and "what invalidates this" has to travel with
 * them in both. One copy, two call sites — a second inline copy is how one of
 * them silently drifts out of date.
 *
 * Renders nothing when the trader published no criteria: an empty invalidation
 * list is missing signal, not "nothing invalidates this trade" (real-money
 * gate — never assert a judgement the desk did not make).
 */
import type { ReactElement } from "react";

export type InvalidationListProps = {
  criteria: ReadonlyArray<string> | null;
};

export function InvalidationList({
  criteria,
}: InvalidationListProps): ReactElement | null {
  if (criteria === null || criteria.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[9.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
        invalidated if
      </span>
      <ul className="ml-3 list-disc text-[12px] leading-relaxed text-[color:var(--c-fg)]">
        {criteria.map((c, i) => (
          <li key={i}>{c}</li>
        ))}
      </ul>
    </div>
  );
}
