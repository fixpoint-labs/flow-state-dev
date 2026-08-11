/**
 * ResearchSynthesisBlock — the research manager's Phase 2 verdict, in words.
 *
 * The RM is the participant that reads the whole bull/bear debate and says where
 * it landed. On the conviction strip it is one dot among twelve, indistinguishable
 * from an analyst; here it gets its stance, its conviction, and — the reason this
 * block exists — its `unresolvedDisagreements`, which is the desk's own answer to
 * "where do the analysts still diverge?" A dot on an axis cannot say that.
 *
 * Every field is a stored RM memo field read through the aggregate. Each
 * sub-section renders only when its list is non-empty, and the whole block
 * renders nothing when the RM published none of it — an absent synthesis reads
 * as absent, never as an empty verdict.
 */
import type { ReactElement } from "react";
import type { ResearchSynthesis } from "./aggregate";
import { cn } from "@/lib/utils";

export type ResearchSynthesisBlockProps = {
  synthesis: ResearchSynthesis;
};

const STANCE_CLASS: Record<"bullish" | "bearish" | "neutral", string> = {
  bullish: "text-[color:var(--c-live)]",
  bearish: "text-[color:var(--c-warn)]",
  neutral: "text-[color:var(--c-fg-muted)]",
};

export function ResearchSynthesisBlock({
  synthesis,
}: ResearchSynthesisBlockProps): ReactElement | null {
  const {
    stance,
    conviction,
    keyRisks,
    keyOpportunities,
    unresolvedDisagreements,
  } = synthesis;

  const hasAnything =
    stance !== null ||
    conviction !== null ||
    keyRisks.length > 0 ||
    keyOpportunities.length > 0 ||
    unresolvedDisagreements.length > 0;
  if (!hasAnything) return null;

  return (
    <section
      className={cn(
        "flex flex-col gap-3 rounded-md border p-3",
        "border-[color:var(--c-border)] bg-[color:var(--c-surface)]",
      )}
      aria-label="Research synthesis"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-mono text-[10.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
          Research synthesis
        </h3>
        {stance !== null ? (
          <span
            className={cn(
              "font-mono text-[12px] uppercase tracking-wider",
              STANCE_CLASS[stance],
            )}
          >
            {stance}
          </span>
        ) : null}
        {conviction !== null ? (
          <span className="font-mono text-[11px] text-[color:var(--c-fg-muted)]">
            conviction {conviction.toFixed(2)}
          </span>
        ) : null}
      </div>

      {/* Divergence first: it is the question this block exists to answer. */}
      <SynthesisList
        label="Unresolved disagreements"
        items={unresolvedDisagreements}
      />
      <SynthesisList label="Key risks" items={keyRisks} />
      <SynthesisList label="Key opportunities" items={keyOpportunities} />
    </section>
  );
}

function SynthesisList({
  label,
  items,
}: {
  label: string;
  items: ReadonlyArray<string>;
}): ReactElement | null {
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
