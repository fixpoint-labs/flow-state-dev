/**
 * TraderProposalCard — dedicated doc renderer for the Phase 3 trader memo: the
 * direction, size, price levels, holding period, invalidation, and dependencies
 * the generic `ThesisHeader + ThesisBody` fall-through drew none of.
 *
 * PURELY PRESENTATIONAL. No transport, no schema, no commit, no stored field.
 *
 * Three rules, each in an exported pure helper because a rule inside JSX has no
 * reachable test in this node-env suite:
 *
 *  1. **It names no price level.** Every level word comes from
 *     `lib/trade-levels.ts` (`storedTradeLevelsFrom` packs, `buildTradeLevelModel`
 *     names, `tradeLineParts` formats). This file never spells "stop" or
 *     "target" and never hand-assembles the five-field level literal.
 *  2. **The levels have ONE owner here, and it is the trade line.** The metrics
 *     row STRIPS the level keys (`withoutLevelMetrics`) so no level is drawn
 *     twice; what counts as a level key stays inside `trade-levels.ts`.
 *  3. **The stance renders once.** `rating` and `direction` are two separate
 *     stance enums nothing forces to agree, so `direction` wins (it is what the
 *     levels were named from) and the header's rating chip is suppressed.
 *
 * Absence stays absent: an unpublished leg contributes no segment and an empty
 * list renders nothing (`LabeledBulletList` / `InvalidationList` own that rule).
 *
 * The class-level why, for every memo renderer: `CLAUDE.md` → "Theses view".
 */
import type { ReactElement } from "react";
import { ThesisHeader } from "./thesis-header";
import { ThesisBody } from "./thesis-body";
import { InvalidationList } from "@/components/summary/invalidation-list";
import { LabeledBulletList } from "@/components/summary/labeled-bullet-list";
import {
  buildTradeLevelModel,
  storedTradeLevelsFrom,
  tradeLineParts,
  withoutLevelMetrics,
} from "@/flows/analysis/lib/trade-levels";
import type { AgentName } from "@/flows/analysis/registry";
import type { MemoCitation, ThesisSection } from "@/flows/analysis/resources";
import { cn } from "@/lib/utils";

/**
 * The trader memo fields this card reads — a structural subset of the client
 * data the dispatcher already holds, declared here so the card stays decoupled
 * from the full `MemoClientData` type (the `LensMemoData` precedent).
 *
 * The four level fields are optional AND nullable: a memo written before
 * FIX-780 has no monitoring keys at all, so a read sees `undefined` rather than
 * `null` (BP-030).
 */
export type TraderMemoData = {
  label: string | null;
  headline: string | null;
  metrics: Record<string, string> | null;
  body: ReadonlyArray<ThesisSection> | null;
  citations: ReadonlyArray<MemoCitation> | null;
  direction: "long" | "short" | "flat" | null;
  sizePct: number | null;
  stopPrice?: number | null;
  targetPrice?: number | null;
  reassessBelowPrice?: number | null;
  invalidateAbovePrice?: number | null;
  holdingPeriod: string | null;
  invalidationCriteria: ReadonlyArray<string> | null;
  dependsOn: ReadonlyArray<string> | null;
};

/**
 * The metrics keys the structured trade line already draws, which the card
 * therefore drops from the chip grid.
 *
 * A DENYLIST, deliberately, and never to be inverted into an allowlist of the
 * keys known today: `metrics` is an unconstrained `Record<string, string>`, so
 * an allowlist would silently swallow a metric a later schema adds — which is
 * the exact defect this card exists to fix, rebuilt inside the fix. A denylist
 * fails in the safe direction: an unrecognized new metric renders and someone
 * sees it.
 *
 * Level names are NOT in this list and must never be added: they are stripped
 * by `withoutLevelMetrics`, inside the leaf that owns the vocabulary. `size`
 * and `holdingPeriod` are the free-form copies of `sizePct` / `holdingPeriod`,
 * and `direction` the free-form copy of the stance — nothing forces a copy to
 * agree with the typed field it mirrors, so a card that drew both could show a
 * reader two contradictory readings of its own position.
 */
const TRADE_LINE_METRIC_KEYS: ReadonlySet<string> = new Set([
  "direction",
  "size",
  "holdingPeriod",
]);

/** The trade one-liner's segments, in display order — direction, size, the
 *  named levels, holding period. Empty when the trader published none of them.
 *  Every segment comes from the shared formatter; this card contributes no
 *  vocabulary of its own. */
export function traderTradeLine(
  data: TraderMemoData | null,
): ReadonlyArray<string> {
  if (data === null) return [];
  return tradeLineParts(
    {
      direction: data.direction,
      sizePct: data.sizePct,
      holdingPeriod: data.holdingPeriod,
    },
    buildTradeLevelModel(storedTradeLevelsFrom(data)),
  );
}

/** What the shared header is given on a trader card. Both fields are overrides
 *  of the memo's stored values, and both are honesty rules — see the file
 *  header's rules 2 and 3. */
export type TraderHeaderModel = {
  /** Always null: the stance is the trade line's, so the header shows no second
   *  (and possibly disagreeing) one. Typed as the literal so reintroducing the
   *  stored `rating` here is a compile error, not a review catch. */
  rating: null;
  /** The stored bag minus the levels and minus every value the trade line
   *  already draws. Null when nothing survives, so no empty grid renders. */
  metrics: Record<string, string> | null;
};

export function traderHeaderModel(
  data: TraderMemoData | null,
): TraderHeaderModel {
  const stripped = withoutLevelMetrics(data?.metrics);
  const kept: Record<string, string> = {};
  for (const [key, value] of Object.entries(stripped)) {
    if (TRADE_LINE_METRIC_KEYS.has(key)) continue;
    kept[key] = value;
  }
  return {
    rating: null,
    metrics: Object.keys(kept).length > 0 ? kept : null,
  };
}

export type TraderProposalCardProps = {
  agent: AgentName;
  data: TraderMemoData | null;
  /** Forwarded to the shared header. Re-routing this memo into its own card
   *  would otherwise delete the only navigation affordance a memo has. */
  onJumpToTranscript?: (() => void) | null;
};

/**
 * Render the trader memo as a trade: the shared header (identity, headline,
 * the filtered metrics chips, the jump control), the trade one-liner, what
 * would invalidate the trade, what it depends on, and the written memo.
 */
export function TraderProposalCard({
  agent,
  data,
  onJumpToTranscript,
}: TraderProposalCardProps): ReactElement {
  const header = traderHeaderModel(data);
  const tradeLine = traderTradeLine(data);
  const body = data?.body ?? null;

  return (
    <article className="flex flex-col gap-5" aria-label="Trade proposal">
      <ThesisHeader
        agent={agent}
        label={data?.label ?? null}
        headline={data?.headline ?? null}
        rating={header.rating}
        metrics={header.metrics}
        onJumpToTranscript={onJumpToTranscript}
      />

      {tradeLine.length > 0 ? (
        <p
          className={cn(
            "flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-md border p-2.5",
            "border-[color:var(--c-border)] bg-[color:var(--c-surface-2)]",
            "font-mono text-[12px] text-[color:var(--c-fg)]",
          )}
          aria-label="Proposed trade"
        >
          {tradeLine.map((part, i) => (
            <span key={i}>
              {i > 0 ? (
                <span className="mr-2 text-[color:var(--c-fg-faint)]">·</span>
              ) : null}
              {part}
            </span>
          ))}
        </p>
      ) : null}

      <InvalidationList criteria={data?.invalidationCriteria ?? null} />
      <LabeledBulletList label="depends on" items={data?.dependsOn ?? []} />

      {body !== null && body.length > 0 ? (
        <ThesisBody body={body} citations={data?.citations ?? null} />
      ) : null}
    </article>
  );
}
