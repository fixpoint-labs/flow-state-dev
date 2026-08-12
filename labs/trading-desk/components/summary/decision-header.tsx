/**
 * DecisionHeader — the Summary's top block: the PM 5-tier rating bar (PmHero
 * idiom), the model-implied rating + band with clamp flag, the absolute and
 * relative ratings, decision confidence, the scenario the decision underwrites,
 * agree/differ-with-trader, and — as a sibling block, not nested under the
 * decision — the trader's proposed trade with its invalidation criteria.
 *
 * Every figure traces to a stored PM/trader field via the aggregate. When the
 * PM memo has not published, it renders a "Decision pending" state rather than a
 * fabricated rating (real-money gate); the trader's proposal still renders, so a
 * Summary opened between Phase 3 and Phase 5 shows the trade that exists rather
 * than nothing. The not-advice disclaimer is owned by the persistent StatusBar,
 * not duplicated here.
 */
import type { ReactElement } from "react";
import type {
  DecisionSummary,
  TradeLevels,
} from "./aggregate";
import {
  buildTradeLevelModel,
  tradeLineParts,
} from "@/flows/analysis/lib/trade-levels";
import { InvalidationList } from "./invalidation-list";
import { cn } from "@/lib/utils";

const TIERS = ["Sell", "Underweight", "Hold", "Overweight", "Buy"] as const;

type Tier = (typeof TIERS)[number];

export type DecisionHeaderProps = {
  ticker: string;
  date: string;
  decision: DecisionSummary;
  trade: TradeLevels;
};

export function DecisionHeader({
  ticker,
  date,
  decision,
  trade,
}: DecisionHeaderProps): ReactElement {
  const idx =
    decision?.finalRating != null
      ? TIERS.indexOf(decision.finalRating as Tier)
      : -1;

  return (
    <section
      className={cn(
        "flex flex-col gap-4 rounded-lg border p-4",
        "border-[color:var(--c-border)] bg-[color:var(--c-surface)]",
      )}
      aria-label="Decision"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[15px] font-semibold text-[color:var(--c-fg)]">
          {ticker || "—"}{" "}
          <span className="font-mono text-[11px] text-[color:var(--c-fg-faint)]">
            · {date || "—"}
          </span>
        </span>
        {decision?.decisionConfidence != null ? (
          <span className="font-mono text-[11px] text-[color:var(--c-fg-muted)]">
            confidence {decision.decisionConfidence.toFixed(2)}
          </span>
        ) : null}
      </div>

      {decision === null ? (
        <p className="text-[12.5px] text-[color:var(--c-fg-muted)]">
          Decision pending — the portfolio manager memo has not published for
          this run.
        </p>
      ) : (
        <>
          {decision.decisionSummary !== null &&
          decision.decisionSummary !== "" ? (
            <p className="text-[14px] leading-snug text-[color:var(--c-fg)]">
              {decision.decisionSummary}
            </p>
          ) : null}

          {/* 5-tier rating bar */}
          <div className="flex items-center justify-between gap-1">
            {TIERS.map((tier, i) => (
              <div
                key={tier}
                className="flex flex-1 flex-col items-center gap-1"
              >
                <span
                  className={cn(
                    "h-1.5 w-full rounded-sm",
                    i === idx
                      ? "bg-[color:var(--c-accent)]"
                      : "bg-[color:var(--c-surface-2)]",
                  )}
                />
                <span
                  className={cn(
                    "font-mono text-[9.5px] uppercase tracking-wider",
                    i === idx
                      ? "text-[color:var(--c-fg)]"
                      : "text-[color:var(--c-fg-faint)]",
                  )}
                >
                  {tier}
                </span>
              </div>
            ))}
          </div>

          {/* Model-implied rating + band + clamp flag, plus the PM's absolute
              (standalone) and relative (vs benchmark) calls. The 5-tier bar
              above is the decision; these two say what it means on each axis,
              and both are stored PM fields — omitted individually when the PM
              left one unpublished. */}
          {decision.modelImpliedRating !== null ||
          decision.ratingBand !== null ||
          decision.absoluteRating !== null ||
          decision.relativeRating !== null ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[color:var(--c-fg-muted)]">
              {decision.absoluteRating !== null ? (
                <span>
                  <span className="font-mono uppercase tracking-wider text-[color:var(--c-fg-faint)]">
                    absolute
                  </span>{" "}
                  {decision.absoluteRating}
                </span>
              ) : null}
              {decision.relativeRating !== null ? (
                <span>
                  <span className="font-mono uppercase tracking-wider text-[color:var(--c-fg-faint)]">
                    relative
                  </span>{" "}
                  {decision.relativeRating}
                </span>
              ) : null}
              {decision.modelImpliedRating !== null ? (
                <span>
                  <span className="font-mono uppercase tracking-wider text-[color:var(--c-fg-faint)]">
                    model-implied
                  </span>{" "}
                  {decision.modelImpliedRating}
                </span>
              ) : null}
              {decision.ratingBand !== null ? (
                <span>
                  <span className="font-mono uppercase tracking-wider text-[color:var(--c-fg-faint)]">
                    band
                  </span>{" "}
                  {decision.ratingBand.floor}–{decision.ratingBand.ceiling}
                </span>
              ) : null}
              {decision.ratingClamped === true ? (
                <span className="text-[color:var(--c-warn)]">
                  PM rating clamped to model band
                </span>
              ) : null}
            </div>
          ) : null}

          {/* The scenario bucket the PM says this decision underwrites. The
              scenario strip flags the same name visually; stating it here means
              the header does not depend on the strip having rendered. */}
          {decision.primaryScenario !== null ? (
            <p className="text-[11px] text-[color:var(--c-fg-muted)]">
              <span className="font-mono uppercase tracking-wider text-[color:var(--c-fg-faint)]">
                underwrites
              </span>{" "}
              {decision.primaryScenario}
            </p>
          ) : null}

          {decision.agreesWithTrader === true ? (
            <span className="text-[11px] text-[color:var(--c-live)]">
              ✓ agrees with trader
            </span>
          ) : decision.agreesWithTrader === false ? (
            <span className="text-[11px] text-[color:var(--c-warn)]">
              Differs from trader proposal
            </span>
          ) : null}
        </>
      )}

      {/* The trader's proposal is a SIBLING of the decision block, never nested
          inside it. The trader publishes in Phase 3 and the PM in Phase 5, so a
          Summary opened in that window has a stored trade — with its price
          levels and what would invalidate it — while `decision` is still null.
          Nesting this under the decision hid all of it, including on runs where
          the price chart was already drawing those same levels. */}
      <TradeBlock trade={trade} />
    </section>
  );
}

/**
 * The trader's proposed trade and what would kill it, attributed so it can never
 * be read as the PM's decision — this block renders in the "Decision pending"
 * state too, where it is the only trade content on the page.
 */
function TradeBlock({ trade }: { trade: TradeLevels }): ReactElement | null {
  if (trade === null) return null;
  const levels = buildTradeLevelModel({
    direction: trade.direction,
    stopPrice: trade.stopPrice,
    targetPrice: trade.targetPrice,
    reassessBelowPrice: trade.reassessBelowPrice,
    invalidateAbovePrice: trade.invalidateAbovePrice,
  });
  const parts = tradeLineParts(trade, levels);
  const criteria = trade.invalidationCriteria ?? [];
  if (parts.length === 0 && criteria.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[9.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
        trader proposal
      </span>
      {parts.length > 0 ? (
        <p className="font-mono text-[12px] text-[color:var(--c-fg)]">
          {parts.join(" · ")}
        </p>
      ) : null}
      {/* No "predates a fix" note here. The report carries exactly ONE such
          marker — the shared `ReportProvenanceNotice` at the top of the page,
          which takes a list of reasons so a later fix adds an entry instead of
          a second banner (FIX-1063). This block's job is to stop NAMING the two
          numbers, which the captioned segment above does; the disclosure is the
          notice's. */}
      <InvalidationList criteria={trade.invalidationCriteria} />
    </div>
  );
}

