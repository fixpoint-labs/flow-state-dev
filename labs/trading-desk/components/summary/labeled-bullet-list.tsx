/**
 * LabeledBulletList — a mono sub-label over a bulleted list of stored strings.
 *
 * The Summary's structured lists (the research manager's risks / opportunities /
 * unresolved disagreements, the trader's invalidation criteria) are all the same
 * shape, so they share one component rather than one 30-line file per variant.
 *
 * Renders nothing on an empty list. That is a real-money gate, not a layout
 * nicety: an empty list is a field the desk did not publish, and empty chrome
 * under a heading reads as "the desk considered this and found nothing".
 *
 * This is the SUB-label variant, sized to sit inside a block that already has a
 * heading. A panel's own top-level section headings stay `h3` at their own size
 * (see `risk-panel.tsx`) — same list markup, different altitude.
 */
import type { ReactElement } from "react";

export type LabeledBulletListProps = {
  label: string;
  items: ReadonlyArray<string>;
};

export function LabeledBulletList({
  label,
  items,
}: LabeledBulletListProps): ReactElement | null {
  if (items.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[9.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
        {label}
      </span>
      <ul className="ml-3 list-disc text-[12px] leading-relaxed text-[color:var(--c-fg)]">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
